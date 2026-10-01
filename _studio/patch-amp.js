// one-shot: THE AMPLIFIER — $MUTE holders earn a bigger share of Silent Yield. (run once)
// Weight = muted mUSD × tier multiplier. Tier from $MUTE held: wallet balance read on-chain + $MUTE in the vault ledger.
// Nothing is printed: the same 40% fee pool is split, holders just get a larger slice of it.
'use strict';
const fs = require('fs'); const path = require('path');
const SF = path.join(__dirname, '..', 'server', 'index.js'), HF = path.join(__dirname, '..', 'client', 'index.html'), AF = path.join(__dirname, '..', 'client', 'src', 'app.js');
let s = fs.readFileSync(SF, 'utf8'), h = fs.readFileSync(HF, 'utf8'), a = fs.readFileSync(AF, 'utf8');
if (s.includes('AMP_TIERS')) throw new Error('already patched');
const rep = (src, x, y) => { if (!src.includes(x)) throw new Error('missing: ' + x.slice(0, 70)); return src.split(x).join(y); };

// ---------- server ----------
s = rep(s, "function quietPay(pool) {", `// ---------- THE AMPLIFIER: $MUTE held boosts your share of Silent Yield ----------
const AMP_TIERS = (process.env.AMP_TIERS || '1000000:1.5,5000000:2,20000000:3').split(',').map((t) => t.split(':').map(Number)).filter((t) => t[0] > 0 && t[1] >= 1).sort((x, y) => x[0] - y[0]);
const AMP = {};   // wallet -> { bal, t } on-chain $MUTE balance cache
function ampHeld(addr) { const w = db.wallets[addr]; return ((AMP[addr] && AMP[addr].bal) || 0) + ((w && w.mute) || 0); }
function ampMult(addr) { const held = ampHeld(addr); let m = 1; for (const [min, x] of AMP_TIERS) if (held >= min) m = x; return m; }
function ampView(addr) { const held = ampHeld(addr), m = ampMult(addr); const next = AMP_TIERS.find((t) => held < t[0]); return { held, mult: m, next: next ? { min: next[0], mult: next[1], need: next[0] - held } : null, read: AMP[addr] ? AMP[addr].t : 0 }; }
async function ampRefresh(addr) { if (!MUTE_MINT || !isWallet(addr)) return; const c = AMP[addr]; if (c && Date.now() - c.t < 120e3) return; try { const bal = await balOf(MUTE_MINT, 18, addr); AMP[addr] = { bal, t: Date.now() }; } catch (e) {} }
async function ampSweep() { const hs = Object.entries(db.wallets).filter(([, x]) => x.priv > 0.000001).map(([k]) => k).slice(0, 200); for (const k of hs) { await ampRefresh(k); await new Promise((r) => setTimeout(r, 150)); } }
setInterval(ampSweep, 5 * 60e3); setTimeout(ampSweep, 15e3);
function quietPay(pool) {`);
s = rep(s, "  if (!(pool > 0)) return 0; const hs = Object.values(db.wallets).filter((x) => x.priv > 0.000001); const tot = hs.reduce((a, x) => a + x.priv, 0); if (!(tot > 0)) return 0;\n  for (const x of hs) { const g = pool * x.priv / tot; x.priv += g; x.quietEarned = (x.quietEarned || 0) + g; }",
  "  if (!(pool > 0)) return 0; const hs = Object.entries(db.wallets).filter(([, x]) => x.priv > 0.000001).map(([k, x]) => [x, x.priv * ampMult(k)]); const tot = hs.reduce((t, e) => t + e[1], 0); if (!(tot > 0)) return 0;\n  for (const [x, wt] of hs) { const g = pool * wt / tot; x.priv += g; x.quietEarned = (x.quietEarned || 0) + g; }");
s = rep(s, "return { cut: QUIET_CUT, paid: db.quiet.paid,", "return { tiers: AMP_TIERS, amplified: Object.entries(db.wallets).filter(([k, x]) => x.priv > 0.000001 && ampMult(k) > 1).length, cut: QUIET_CUT, paid: db.quiet.paid,");
s = rep(s, "function account(addr) { const w = W(addr); const now = Date.now(); return { wallet: addr,", "function account(addr) { const w = W(addr); const now = Date.now(); ampRefresh(addr.toLowerCase()); return { amp: ampView(addr.toLowerCase()), wallet: addr,");
fs.writeFileSync(SF, s);

// ---------- client: tiers + your tier on the Silent Yield channel, boost in the vault ----------
h = rep(h, `      <p class="fine">No staking, no lock, nothing to claim. Funded by usage, so nothing is printed.</p>`,
`      <p class="fine">No staking, no lock, nothing to claim. Funded by usage, so nothing is printed.</p>
      <h2 style="margin-top:44px">The Amplifier<span class="tag">NEW</span></h2>
      <p class="fine" style="margin-top:0">Hold $MUTE and your muted balance earns a bigger share of the same fee stream.</p>
      <div class="amp" id="amp-tiers"></div>
      <div class="kv" style="max-width:520px;margin-top:14px"><span>Your tier</span><b id="amp-me">connect to see</b></div>`);
h = rep(h, '</style>', `.amp{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--edge);margin-top:18px;max-width:720px;clip-path:polygon(var(--cut) 0,100% 0,100% calc(100% - var(--cut)),calc(100% - var(--cut)) 100%,0 100%,0 var(--cut))}
.amp div{background:var(--hull);padding:16px 14px}.amp .x{font-family:'Michroma';font-size:22px}.amp .h{font-size:11.5px;color:var(--mut);letter-spacing:.08em;margin-top:6px}.amp div.on{background:linear-gradient(100deg,#00c80522,#19d81f26,#7dff8a1c)}.amp div.on .x{color:var(--a)}
</style>`);
h = rep(h, '<b id="q-me" style="color:var(--a)">—</b>', '<b id="q-me" style="color:var(--a)">—</b></div><div class="kv" style="border:none;padding-top:0"><span>Amplifier</span><b id="amp-v">—</b>');
a = rep(a, "  if (M.quiet) { const Q = M.quiet;", `  if (M.quiet && M.quiet.tiers) { const me = A && A.amp; const rows = [[0, 1]].concat(M.quiet.tiers); $('amp-tiers').innerHTML = rows.map((t) => '<div class="' + (me && me.mult === t[1] ? 'on' : '') + '"><div class="x">' + t[1] + 'x</div><div class="h">' + (t[0] ? big(t[0]) + '+ $MUTE' : 'muted, no $MUTE') + '</div></div>').join(''); }
  if (M.quiet) { const Q = M.quiet;`);
a = rep(a, "function renderAccount() {", `function renderAmp() { const me = A && A.amp; $('amp-v').textContent = me ? me.mult + 'x' : '—'; $('amp-me').textContent = !A ? 'connect to see' : me.mult + 'x · ' + big(me.held) + ' $MUTE held' + (me.next ? ' · ' + big(me.next.need) + ' more for ' + me.next.mult + 'x' : ' · max tier'); }
function renderAccount() { renderAmp();`);
fs.writeFileSync(HF, h); fs.writeFileSync(AF, a); console.log('amplifier patched');
