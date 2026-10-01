// one-shot: SOUND CHECK — live proof of reserves for private money. (run once)
// Liabilities: every wallet's USD balance (USDG + visible mUSD + muted mUSD + Window stake + Blind Desk marks + queued USDG withdrawals)
// becomes a salted leaf in a Merkle-sum tree. Only the root + total are published. Each holder can fetch their own path and
// verify in the browser that their exact balance is inside the published total. Reserve = USDG in the treasury, read on-chain.
'use strict';
const fs = require('fs'); const path = require('path');
const SF = path.join(__dirname, '..', 'server', 'index.js'), HF = path.join(__dirname, '..', 'client', 'index.html'), AF = path.join(__dirname, '..', 'client', 'src', 'app.js');
let s = fs.readFileSync(SF, 'utf8'), h = fs.readFileSync(HF, 'utf8'), a = fs.readFileSync(AF, 'utf8');
if (s.includes('SOUND CHECK')) throw new Error('already patched');
const rep = (src, x, y) => { if (!src.includes(x)) throw new Error('missing: ' + x.slice(0, 70)); return src.split(x).join(y); };

// ---------- server ----------
s = rep(s, '// ---------- views ----------', `// ---------- SOUND CHECK: Merkle-sum proof of liabilities vs on-chain reserve ----------
const hx = (str) => createHash('sha256').update(str).digest('hex');
const ZERO = { h: hx('mute|empty'), s: 0 };
const SC_FRAG = 4;
const cents = (n) => Math.max(0, Math.round((+n || 0) * 100));
function liabOf(addr, w) {
  const dark = darkView(w).reduce((t, p) => t + Math.max(0, p.notional + p.pnl), 0);
  const queued = db.queue.filter((q) => q.wallet === addr && q.status === 'queued' && (q.asset || 'USDG') === 'USDG').reduce((t, q) => t + q.amt, 0);
  return (w.usdg || 0) + (w.musd || 0) + (w.priv || 0) + (w.stake || 0) + dark + queued;
}
let SC = { root: ZERO.h, total: 0, leaves: 0, ts: 0, levels: [[ZERO]], index: {}, history: [] };
function buildSoundCheck() {
  // each balance is split into SC_FRAG random fragments and all fragments are shuffled, so a sibling in any proof
  // is a random piece of an unknown wallet's balance, never someone's exact balance
  const frags = [];
  for (const [addr, w] of Object.entries(db.wallets)) {
    const c = cents(liabOf(addr, w)); if (!c) continue;
    if (!w.scSalt) w.scSalt = randomBytes(16).toString('hex');
    const cuts = Array.from({ length: SC_FRAG - 1 }, () => randomInt(0, c + 1)).sort((x, y) => x - y); let prev = 0;
    cuts.concat([c]).forEach((cut, j) => { const part = cut - prev; prev = cut; const nonce = randomBytes(8).toString('hex'); frags.push({ addr, j, nonce, part, h: hx('leaf|' + addr + '|' + w.scSalt + '|' + nonce + '|' + part), s: part }); });
  }
  for (let i = frags.length - 1; i > 0; i--) { const k = randomInt(0, i + 1); [frags[i], frags[k]] = [frags[k], frags[i]]; }
  const index = {}; frags.forEach((fr, i) => { (index[fr.addr] = index[fr.addr] || []).push({ i, nonce: fr.nonce, part: fr.part }); });
  const leaves = frags.map((fr) => ({ h: fr.h, s: fr.s }));
  let lv = leaves.length ? leaves : [ZERO]; const levels = [lv];
  while (lv.length > 1) { const nx = []; for (let i = 0; i < lv.length; i += 2) { const L = lv[i], R = lv[i + 1] || ZERO; nx.push({ h: hx('node|' + L.h + '|' + R.h + '|' + (L.s + R.s)), s: L.s + R.s }); } lv = nx; levels.push(lv); }
  const top = lv[0]; const now = Date.now();
  SC = { root: top.h, total: top.s, leaves: Object.keys(index).length, ts: now, levels, index, history: [{ root: top.h, total: top.s, leaves: Object.keys(index).length, ts: now, reserve: CHAIN.ok ? CHAIN.treasuryUsdg : null, block: CHAIN.block }].concat(SC.history).slice(0, 48) };
}
function soundProof(addr) {
  const mine = SC.index[addr]; if (!mine) return null; const w = db.wallets[addr];
  const fragments = mine.map(({ i, nonce, part }) => { const path = []; let k = i;
    for (let d = 0; d < SC.levels.length - 1; d++) { const lv = SC.levels[d]; const sib = k % 2 ? lv[k - 1] : (lv[k + 1] || ZERO); path.push({ side: k % 2 ? 'L' : 'R', h: sib.h, s: sib.s }); k = Math.floor(k / 2); }
    return { nonce, cents: part, path }; });
  return { wallet: addr, salt: w.scSalt, cents: fragments.reduce((t, x) => t + x.cents, 0), fragments, root: SC.root, total: SC.total, ts: SC.ts };
}
function soundView() { const res = CHAIN.ok ? CHAIN.treasuryUsdg : null; const tot = SC.total / 100; return { root: SC.root, total: tot, leaves: SC.leaves, ts: SC.ts, reserve: res, block: CHAIN.block, treasury: TREASURY, coverage: res != null && tot > 0 ? res / tot : null, history: SC.history.slice(0, 12).map((x) => ({ root: x.root.slice(0, 10) + '…' + x.root.slice(-6), total: x.total / 100, leaves: x.leaves, ts: x.ts, reserve: x.reserve })) }; }
setInterval(buildSoundCheck, 60e3); setTimeout(buildSoundCheck, 3e3);

// ---------- views ----------`);
s = rep(s, "  if (u === '/api/metrics') return json(res, 200, metrics());", "  if (u === '/api/metrics') return json(res, 200, metrics());\n  if (u === '/api/soundcheck') return json(res, 200, soundView());");
s = rep(s, "    const w = W(d.wallet);\n", "    const w = W(d.wallet);\n    if (u === '/api/soundcheck/proof') { const p = soundProof(d.wallet.toLowerCase()); return json(res, 200, p ? { ok: true, ...p } : { error: SC.ts ? 'your balance enters the next tree (rebuilt every minute)' : 'first tree is being built' }); }\n");
fs.writeFileSync(SF, s);

// ---------- client ----------
h = rep(h, '      <button data-ch="proto"><i>08</i><span>Protocol</span></button>', '      <button data-ch="proof"><i>✓</i><span>Sound Check</span></button>\n      <button data-ch="proto"><i>08</i><span>Protocol</span></button>');
h = rep(h, '    <section class="ch" data-ch="proto">', `    <section class="ch" data-ch="proof">
      <div class="kick">sound check · proof of reserves</div>
      <h1>Private balances. <span class="iri">Public solvency.</span><span class="tag">LIVE</span></h1>
      <p class="fine">Every balance is sealed into a Merkle-sum tree. Only the root and the total are published. The reserve is read from Robinhood Chain.</p>
      <div class="read">
        <div class="stat"><div class="l">reserve · on-chain USDG</div><div class="v g" id="sc-res">—</div></div>
        <div class="stat"><div class="l">liabilities · all balances</div><div class="v" id="sc-tot">—</div></div>
        <div class="stat"><div class="l">coverage</div><div class="v g" id="sc-cov">—</div></div>
        <div class="stat"><div class="l">balances in tree</div><div class="v" id="sc-n">—</div></div>
        <div class="stat"><div class="l">tree rebuilt</div><div class="v" id="sc-ts">—</div></div>
        <div class="stat"><div class="l">block</div><div class="v" id="sc-blk">—</div></div>
      </div>
      <div class="ca" style="margin-top:22px"><span class="t">ROOT</span><code id="sc-root">—</code></div>
      <div class="cta"><button class="btn fill" id="sc-verify">Verify my balance</button><a class="btn ghost" id="sc-ex" target="_blank" rel="noopener">Treasury on explorer</a></div>
      <div class="led" id="sc-out"></div>
    </section>

    <section class="ch" data-ch="proto">`);
a = rep(a, "async function loadMetrics() { M = await api('/api/metrics'); renderMetrics(); }", `async function loadMetrics() { M = await api('/api/metrics'); renderMetrics(); loadSound(); }
// ---------- Sound Check: proof of reserves, verified in this browser ----------
let SCV = null;
async function loadSound() { try { SCV = await api('/api/soundcheck'); } catch (e) { return; } if (!SCV || SCV.error) return;
  $('sc-res').textContent = SCV.reserve != null ? '$' + fmt(SCV.reserve, 2) : '—'; $('sc-tot').textContent = '$' + fmt(SCV.total, 2);
  $('sc-cov').textContent = SCV.coverage != null ? fmt(SCV.coverage * 100, 1) + '%' : (SCV.total > 0 ? '—' : 'no balances yet'); $('sc-n').textContent = fmt(SCV.leaves, 0);
  $('sc-ts').textContent = SCV.ts ? ago(SCV.ts) : '—'; $('sc-blk').textContent = SCV.block ? '#' + fmt(SCV.block, 0) : '—'; $('sc-root').textContent = SCV.root;
  $('sc-ex').href = (M && M.explorer ? M.explorer : 'https://explorer.mainnet.chain.robinhood.com') + '/address/' + SCV.treasury; }
const sha = async (str) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)))].map((b) => b.toString(16).padStart(2, '0')).join('');
$('sc-verify').onclick = async () => {
  if (needWallet()) return; const r = await api('/api/soundcheck/proof', { wallet }); if (r.error) return toast(r.error, true);
  const rows = []; let good = true, sum = 0;
  for (const [n, fr] of r.fragments.entries()) {
    let cur = { h: await sha('leaf|' + r.wallet + '|' + r.salt + '|' + fr.nonce + '|' + fr.cents), s: fr.cents }; sum += fr.cents;
    for (const p of fr.path) { const L = p.side === 'L' ? p : cur, R = p.side === 'L' ? cur : p; cur = { h: await sha('node|' + L.h + '|' + R.h + '|' + (L.s + R.s)), s: L.s + R.s }; }
    const ok = cur.h === r.root && cur.s === r.total; good = good && ok;
    rows.push('<div class="r"><span class="ty shield">fragment ' + (n + 1) + '</span><span class="sg">' + fr.path.length + ' hashes up to the root · ' + cur.h.slice(0, 14) + '…</span><span class="am" style="color:' + (ok ? 'var(--a)' : 'var(--red)') + '">' + (ok ? '✓' : '✕') + '</span></div>');
  }
  good = good && sum === r.cents;
  rows.unshift('<div class="r"><span class="ty">balance</span><span class="sg">your balance $' + fmt(r.cents / 100, 2) + ', split into ' + r.fragments.length + ' fragments</span><span class="am">' + (sum === r.cents ? 'adds up' : 'mismatch') + '</span></div>');
  rows.push('<div class="r"><span class="ty ' + (good ? 'burn' : '') + '">root</span><span class="sg">' + r.root.slice(0, 16) + '… · total $' + fmt(r.total / 100, 2) + '</span><span class="am" style="color:' + (good ? 'var(--a)' : 'var(--red)') + '">' + (good ? 'VERIFIED' : 'MISMATCH') + '</span></div>');
  $('sc-out').innerHTML = rows.join(''); toast(good ? 'verified in your browser: your balance is inside the published total' : 'proof did not match the root', !good);
};`);
fs.writeFileSync(HF, h); fs.writeFileSync(AF, a); console.log('sound check patched');
