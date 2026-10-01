// Sound Check E2E: proofs for several wallets verify against the published root, fragments add up, totals match the ledger,
// a tampered balance fails, and no proof exposes another wallet's exact balance.
'use strict';
const path = require('path'); const os = require('os'); const { spawn } = require('child_process'); const { createHash } = require('crypto'); const S = require('../server/evmsig');
const PORT = 8228, B = 'http://localhost:' + PORT; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  · ' + x : '')); };
const post = (u, b) => fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const hx = (s) => createHash('sha256').update(s).digest('hex');
const mk = (k) => ({ k, w: S.pubToAddress(S.mul(S.G, k)) });
async function auth(u) { const s = await (await fetch(B + '/api/session?wallet=' + u.w)).json(); return { exp: s.exp, sig: S.signPersonal(s.message, u.k) }; }
function verify(r, bump = 0) { let all = true, sum = 0; for (const fr of r.fragments) { let cur = { h: hx('leaf|' + r.wallet + '|' + r.salt + '|' + fr.nonce + '|' + (fr.cents + bump)), s: fr.cents + bump }; sum += fr.cents; for (const p of fr.path) { const L = p.side === 'L' ? p : cur, R = p.side === 'L' ? cur : p; cur = { h: hx('node|' + L.h + '|' + R.h + '|' + (L.s + R.s)), s: L.s + R.s }; } all = all && cur.h === r.root && cur.s === r.total; } return all && sum === r.cents; }
(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'dev.js')], { env: { ...process.env, PORT: String(PORT), DATA_PATH: path.join(os.tmpdir(), 'mute-sc-' + Date.now() + '.json') }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/config')).ok) break; } catch {} await sleep(200); }
    const us = [0x51n, 0x52n, 0x53n, 0x54n, 0x55n].map(mk); const amts = [1234.56, 50, 999.99, 3000, 77.7]; const au = [];
    for (let i = 0; i < us.length; i++) { au[i] = await auth(us[i]); await post('/api/dev/faucet', { wallet: us[i].w, amount: amts[i] }); }
    await post('/api/mint', { wallet: us[0].w, amount: 1000, auth: au[0] }); await post('/api/shield', { wallet: us[0].w, amount: 600, auth: au[0] });   // mixed balance types
    console.log('waiting for the tree…'); await sleep(4500);
    const v0 = await (await fetch(B + '/api/soundcheck')).json();
    ok('tree published with all 5 wallets', v0.leaves === 5, 'root ' + v0.root.slice(0, 12) + '… total $' + v0.total);
    const expect = amts.reduce((t, x) => t + x, 0) - 600 * 0.003;   // the mute fee left the system as Erase/Silent Yield; muted holder got the yield back
    ok('published total ≈ sum of all balances', Math.abs(v0.total - expect) < 2.5, 'total ' + v0.total + ' vs ~' + expect.toFixed(2));
    const proofs = []; for (let i = 0; i < us.length; i++) proofs[i] = await post('/api/soundcheck/proof', { wallet: us[i].w, auth: au[i] });
    ok('every wallet gets 4 fragments', proofs.every((p) => p.ok && p.fragments.length === 4));
    ok('every proof verifies against the root', proofs.every((p) => verify(p)));
    ok('fragments add up to each balance', proofs.every((p) => p.fragments.reduce((t, f) => t + f.cents, 0) === p.cents));
    ok('tampered balance fails', !verify(proofs[1], 1));
    const exact = new Set(proofs.map((p) => p.cents)); let leak = 0; for (const p of proofs) for (const f of p.fragments) for (const s of f.path) if (s.s !== 0 && exact.has(s.s) && s.s !== p.cents) leak++;
    ok('no sibling equals another wallet\'s exact balance', leak === 0, 'exact matches ' + leak);
    const un = await post('/api/soundcheck/proof', { wallet: us[2].w }); ok('proofs need the wallet\'s signed session', !!un.error && un.auth === true, un.error);
    ok('reserve read on-chain', v0.reserve !== undefined && v0.treasury, 'reserve ' + v0.reserve + ' block ' + v0.block);
  } catch (e) { console.error(e); fail++; } finally { srv.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
