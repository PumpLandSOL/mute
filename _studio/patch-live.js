// one-shot: every number on the site comes from something real. (run once)
//  - mUSD supply / collateral = the real ledger; reserve = USDG actually in the treasury on Robinhood Chain
//  - mUSD price = $1 (always redeemable 1:1 against the reserve); no random wobble
//  - $MUTE price = DexScreener when MUTE_MINT trades, otherwise null; supply = on-chain totalSupply
//  - until $MUTE trades: CR = 100% (mUSD fully USDG-backed), bonds/Cryo closed, $MUTE payouts wait, Erase queues
//  - no simulated shielded activity; Signal shows real transactions only
'use strict';
const fs = require('fs'); const path = require('path');
const F = path.join(__dirname, '..', 'server', 'index.js'); let s = fs.readFileSync(F, 'utf8');
const AF = path.join(__dirname, '..', 'client', 'src', 'app.js'); let a = fs.readFileSync(AF, 'utf8');
if (s.includes('LIVE_PX()')) throw new Error('already patched');
const rep = (x, y) => { if (!s.includes(x)) throw new Error('missing: ' + x.slice(0, 70)); s = s.split(x).join(y); };
const repA = (x, y) => { if (!a.includes(x)) throw new Error('missing(app): ' + x.slice(0, 70)); a = a.split(x).join(y); };

// one-time migration: drop the seeded/simulated numbers, rebuild from real wallets
rep("if (!db.shielded.feed) db.shielded.feed = [];", `if (!db.shielded.feed) db.shielded.feed = [];
if (db.v3 !== true) {   // v3: live numbers only — seeded supply, simulated pool activity and simulated burns are removed
  const ws = Object.values(db.wallets || {});
  db.musdSupply = ws.reduce((t, x) => t + (x.musd || 0) + (x.priv || 0) + (x.stake || 0), 0) + Object.values(ws).reduce((t, x) => t + ((x.dark || []).reduce((q, p) => q + (p.margin || p.amt || 0), 0)), 0);
  db.collateralUsd = db.musdSupply; db.musdPrice = 1; db.cr = 1; db.mutePrice = 0; db.muteSupply = 0;
  db.shielded = { commitments: [], nullifiers: 0, notes: 0, totalValue: ws.reduce((t, x) => t + (x.priv || 0), 0), txCount: 0, root: base58(sha('empty')), feed: [] };
  db.shred = { svcUsd: 0, burnedMute: 0, burnedUsd: 0, epochs: 0, burns: [] };
  db.v3 = true;
}`);

// price + CR helpers
rep("let MUTE_LIVE = { px: 0, liq: 0, pair: '', t: 0 };", `let MUTE_LIVE = { px: 0, liq: 0, pair: '', t: 0 };
const LIVE_PX = () => MUTE_LIVE.px > 0 && Date.now() - MUTE_LIVE.t < 10 * 60e3;   // a real, recent $MUTE price
const CR_TARGET = +(process.env.CR_TARGET || 0.9);
let MUTE_SUPPLY = 0;
async function pollMuteSupply() { if (!MUTE_MINT) return; try { MUTE_SUPPLY = hexToNum(await rpc('eth_call', [{ to: MUTE_MINT, data: '0x18160ddd' }, 'latest']), 18); } catch (e) {} }
setInterval(pollMuteSupply, 60000); pollMuteSupply();`);

// tick: no random walks, no simulated activity
const t0 = s.indexOf('function tick() {'), t1 = s.indexOf('// ---------- views ----------');
if (t0 < 0 || t1 < 0) throw new Error('tick block');
s = s.slice(0, t0) + `function tick() {
  const now = Date.now(); const dt = (now - db.lastTick) / 1000; if (dt < TICK_SEC) return; db.lastTick = now;
  db.musdPrice = 1;                                   // redeemable 1:1 against the reserve
  db.mutePrice = LIVE_PX() ? MUTE_LIVE.px : 0;        // real market price or nothing
  db.cr = LIVE_PX() ? CR_TARGET : 1;                  // until $MUTE trades, every mUSD is 100% USDG
  shredBurn(now);
  save();
}

` + s.slice(t1);

// Erase only burns at a real price
rep("  if (shred.svcUsd < SHRED_MIN_USD) return;", "  if (shred.svcUsd < SHRED_MIN_USD || !LIVE_PX()) return;");
// mint: no division by a missing price
rep("const burnMute = algoUsd / db.mutePrice;", "const burnMute = LIVE_PX() ? algoUsd / db.mutePrice : 0;");
// redeem: no $MUTE share without a price
rep("const mintMute = (rn * (1 - db.cr)) / db.mutePrice;", "const mintMute = LIVE_PX() ? (rn * (1 - db.cr)) / db.mutePrice : 0;");
// bonds / Cryo need a real $MUTE price
rep("if (now > BOND.end) return json(res, 200, { error: 'bonds are closed' });", "if (now > BOND.end) return json(res, 200, { error: 'bonds are closed' }); if (!LIVE_PX()) return json(res, 200, { error: 'bonds open once $MUTE trades' });");
// Window: rewards accrue in USD; paying them in $MUTE needs a real price
rep("      const px = Math.max(0.000001, db.mutePrice); let mute = usd / px;", "      if (!LIVE_PX()) return json(res, 200, { error: 'rewards are paid in $MUTE once it trades. They keep accruing until then' });\n      const px = Math.max(0.000001, db.mutePrice); let mute = usd / px;");
rep("function happyView(u, now) { accrue(u, now); const px = Math.max(0.000001, db.mutePrice); return { staked: u.stake || 0, accruedUsd: u.stakeAcc || 0, accruedMute: (u.stakeAcc || 0) / px,",
    "function happyView(u, now) { accrue(u, now); const px = Math.max(0.000001, db.mutePrice); return { staked: u.stake || 0, accruedUsd: u.stakeAcc || 0, accruedMute: LIVE_PX() ? (u.stakeAcc || 0) / px : 0,");

// metrics: real values, nulls where there is nothing real to show
rep("    musdPrice: +db.musdPrice.toFixed(4), pegStatus: db.musdPrice >= 1.001 ? 'above' : db.musdPrice <= 0.999 ? 'below' : 'at',",
    "    musdPrice: 1, pegStatus: 'at', muteTrading: LIVE_PX(), reserveOnchain: CHAIN.ok ? CHAIN.treasuryUsdg : null,");
rep("    mutePrice: db.mutePrice, muteSupply: db.muteSupply, muteMarketCap: db.mutePrice * db.muteSupply,",
    "    mutePrice: LIVE_PX() ? MUTE_LIVE.px : null, muteSupply: MUTE_SUPPLY || null, muteMarketCap: LIVE_PX() && MUTE_SUPPLY ? MUTE_LIVE.px * MUTE_SUPPLY : null, muteLiquidity: LIVE_PX() ? MUTE_LIVE.liq : null,");
fs.writeFileSync(F, s);

// ---------- client ----------
repA("const cr = M ? M.cr : 0.9, vp = M ? M.mutePrice : 0.85;", "const cr = M ? M.cr : 1, vp = M && M.mutePrice ? M.mutePrice : 0;");
repA("$('s-col').textContent = '$' + big(M.collateralUsd);", "$('s-col').textContent = M.reserveOnchain != null ? '$' + big(M.reserveOnchain) : '$' + big(M.collateralUsd);");
fs.writeFileSync(AF, a);
console.log('live numbers patched');
