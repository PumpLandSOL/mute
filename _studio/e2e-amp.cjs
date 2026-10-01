// Amplifier E2E: two muted holders with equal balances; one holds $MUTE (vault ledger) -> gets the bigger Silent Yield slice.
'use strict';
const path = require('path'); const os = require('os'); const { spawn } = require('child_process'); const S = require('../server/evmsig');
const PORT = 8227, B = 'http://localhost:' + PORT; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  · ' + x : '')); };
const post = (u, b) => fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const mk = (k) => ({ k, w: S.pubToAddress(S.mul(S.G, k)) });
async function auth(u) { const s = await (await fetch(B + '/api/session?wallet=' + u.w)).json(); return { exp: s.exp, sig: S.signPersonal(s.message, u.k) }; }
(async () => {
  const DP = path.join(os.tmpdir(), 'mute-amp-' + Date.now() + '.json');
  const fs = require('fs');
  const A = mk(0x1111n), Bh = mk(0x2222n), C = mk(0x3333n);
  // pre-seed the ledger: A holds 6M $MUTE in the vault (2x tier), B holds none; both mute the same amount
  fs.writeFileSync(DP, JSON.stringify({ v: 2, v3: true, wallets: { [A.w]: { usdg: 0, mute: 6e6, musd: 0, priv: 0 } } }));
  const srv = spawn(process.execPath, [path.join(__dirname, 'dev.js')], { env: { ...process.env, PORT: String(PORT), DATA_PATH: DP, MUTE_MINT: '0x0000000000000000000000000000000000000001' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/config')).ok) break; } catch {} await sleep(200); }
    const aA = await auth(A), aB = await auth(Bh), aC = await auth(C);
    for (const [u, a] of [[A, aA], [Bh, aB]]) { await post('/api/dev/faucet', { wallet: u.w, amount: 1000 }); await post('/api/mint', { wallet: u.w, amount: 1000, auth: a }); await post('/api/shield', { wallet: u.w, amount: 1000, auth: a }); }
    const ac = async (u, a) => post('/api/account', { wallet: u.w, auth: a });
    let xA = await ac(A, aA), xB = await ac(Bh, aB);
    ok('A is on the 2x tier', xA.amp.mult === 2, JSON.stringify(xA.amp));
    ok('B is on 1x with next tier shown', xB.amp.mult === 1 && xB.amp.next && xB.amp.next.min === 1e6);
    const eA0 = xA.quietEarned, eB0 = xB.quietEarned;
    await post('/api/dev/faucet', { wallet: C.w, amount: 5000 }); await post('/api/mint', { wallet: C.w, amount: 4000, auth: aC });
    await post('/api/shield', { wallet: C.w, amount: 4000, auth: aC }); await post('/api/unshield', { wallet: C.w, amount: 3000, auth: aC });   // C pays real fees
    xA = await ac(A, aA); xB = await ac(Bh, aB);
    const gA = xA.quietEarned - eA0, gB = xB.quietEarned - eB0;
    ok('both earned Silent Yield from C\'s fees', gA > 0 && gB > 0, 'A +' + gA.toFixed(4) + ' B +' + gB.toFixed(4));
    ok('A earned ~2x B on equal muted balances', gB > 0 && Math.abs(gA / gB - 2) < 0.15, 'ratio ' + (gA / gB).toFixed(3));
    const m = await (await fetch(B + '/api/metrics')).json(); ok('metrics expose tiers + amplified count', m.quiet.tiers.length === 3 && m.quiet.amplified >= 1, JSON.stringify(m.quiet.tiers) + ' amplified=' + m.quiet.amplified);
  } catch (e) { console.error(e); fail++; } finally { srv.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
