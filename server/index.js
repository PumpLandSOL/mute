// MUTE — a private, fractional-algorithmic stablecoin on Robinhood Chain (Phase I: off-chain ledger, real privacy primitives).
//   mUSD  : the stablecoin, pegged to $1 (fractional-algorithmic, Frax-style)
//   MUTE  : the governance/share token ($MUTE on Robinhood Chain)
//   Privacy: shield mUSD -> hold a private balance -> send shielded (amount + parties hidden).
// Real crypto primitives (commitments / nullifiers / x25519-encrypted notes / Merkle tree),
// but the peg + ledger run off-chain in Phase I and the trustless ZK proof arrives with the on-chain phases.
// Algorithmic stablecoins are high-risk (see UST/Terra). Dependency-free.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { generateKeyPairSync, sign, createHash, createHmac, randomBytes, randomInt, diffieHellman, createCipheriv } = require('crypto');

const PORT = process.env.PORT || 8220;
const ROOT = path.join(__dirname, '..');
const DATA_PATH = process.env.DATA_PATH || path.join(ROOT, 'data.json');
const STABLE = 'mUSD', GOV = 'MUTE';
const MUTE_MINT = process.env.MUTE_MINT || '';   // $MUTE on Robinhood Chain — set at launch
const TREASURY = (process.env.TREASURY || '0x580Aa9df627A396F32aE649EC427a4Cb430a5eD2');   // MUTE treasury on Robinhood Chain: every USDG deposit is verified against this address
const TICK_SEC = +(process.env.TICK_SEC || 5);
const SEED = { usdg: 0, mute: 0, musd: 0, priv: 0 };   // real deposits only — nothing is seeded

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(buf) { let n = BigInt('0x' + Buffer.from(buf).toString('hex')); let o = ''; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } for (const b of buf) { if (b === 0) o = '1' + o; else break; } return o || '1'; }
const sha = (s) => createHash('sha256').update(s).digest();
const rawX = (pk) => { const d = pk.export({ type: 'spki', format: 'der' }); return d.subarray(d.length - 32); };

// ---------- protocol state ----------
let db = {
  musdPrice: 1.0, musdSupply: 1_250_000, mutePrice: 0.85, muteSupply: 100_000_000,
  cr: 0.9,                       // collateral ratio (fractional-algorithmic)
  collateralUsd: 1_125_000,      // ETH+USDG reserves backing mUSD
  lastTick: Date.now(), wallets: {},
  shielded: { commitments: [], nullifiers: 0, notes: 0, totalValue: 0, txCount: 0, root: base58(sha('empty')), feed: [] },
};
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))); } catch (e) {}
if (!db.wallets) db.wallets = {};
if (db.v !== 2) { db.wallets = {}; db.v = 2; }   // v2: real deposits only — the seeded paper ledger is wiped
if (!db.shielded) db.shielded = { commitments: [], nullifiers: 0, notes: 0, totalValue: 0, txCount: 0, root: base58(sha('empty')), feed: [] };
if (!db.shielded.feed) db.shielded.feed = [];
// ---------- THE SHRED: punch service charge -> MUTE buyback & burn ----------
const SVC = { shield: 0.003, send: 0.003, unshield: 0.003, redeem: 0.005 }; // 30 / 30 / 30 / 50 bps
const SHRED_MIN_USD = 25;
if (!db.shred) db.shred = { svcUsd: 0, burnedMute: 0, burnedUsd: 0, epochs: 0, burns: [] };
const shred = db.shred;
const PUNCH_CUT = +(process.env.PUNCH_CUT || 0.20);   // share of every service charge that goes to the wallet who brought the payer across
// ---------- QUIET YIELD: a share of every REAL fee streams to muted mUSD holders, pro-rata, paid in mUSD ----------
// Only fees paid by real wallets are shared. The fee is mUSD that is already collateral-backed, so paying it to holders prints nothing.
const QUIET_CUT = +(process.env.QUIET_CUT || 0.40);
if (!db.quiet) db.quiet = { paid: 0, n: 0, day: [] };
function quietPay(pool) {
  if (!(pool > 0)) return 0; const hs = Object.values(db.wallets).filter((x) => x.priv > 0.000001); const tot = hs.reduce((a, x) => a + x.priv, 0); if (!(tot > 0)) return 0;
  for (const x of hs) { const g = pool * x.priv / tot; x.priv += g; x.quietEarned = (x.quietEarned || 0) + g; }
  db.shielded.totalValue += pool; const now = Date.now(); db.quiet.paid += pool; db.quiet.n++; db.quiet.day.push([now, pool]); while (db.quiet.day.length && now - db.quiet.day[0][0] > 864e5) db.quiet.day.shift();
  return pool;
}
function quietView() { const hs = Object.values(db.wallets).filter((x) => x.priv > 0.000001); const tot = hs.reduce((a, x) => a + x.priv, 0); const now = Date.now(); const d = db.quiet.day.filter((e) => now - e[0] <= 864e5).reduce((a, e) => a + e[1], 0); return { cut: QUIET_CUT, paid: db.quiet.paid, payouts: db.quiet.n, paid24h: d, holders: hs.length, muted: tot, apr: tot > 0 ? d * 365 / tot : 0 }; }
function svc(kind, amt, w) {
  const f = amt * SVC[kind]; let cut = 0;
  if (w && w.ref && db.wallets[w.ref]) { cut = f * PUNCH_CUT; const fm = db.wallets[w.ref]; fm.musd += cut; fm.earned = (fm.earned || 0) + cut; db.punch.paid += cut; }
  const q = w ? quietPay((f - cut) * QUIET_CUT) : 0;
  shred.svcUsd += f - cut - q; return amt - f;
}
if (!db.punch) db.punch = { paid: 0, guests: 0 };
function bind(w, addr, refAddr) { refAddr = (refAddr || '').toLowerCase(); if (w.ref || !isWallet(refAddr) || refAddr === addr) return false; const fm = W(refAddr); w.ref = refAddr; w.refTs = Date.now(); fm.guests = (fm.guests || 0) + 1; db.punch.guests++; hist(fm, { type: 'guest', amt: 0, to: addr }); return true; }
const redact = (addr) => addr.slice(0, 4) + '████' + addr.slice(-4);
function referrers() { return Object.entries(db.wallets).filter(([, x]) => (x.guests || 0) > 0).map(([addr, x]) => ({ who: redact(addr), guests: x.guests || 0, earned: x.earned || 0 })).sort((p, q) => q.guests - p.guests || q.earned - p.earned).slice(0, 10); }
function shredBurn(now) {
  if (shred.svcUsd < SHRED_MIN_USD) return;
  const usd = shred.svcUsd; const px = Math.max(0.0001, db.mutePrice); const mute = usd / px;
  db.muteSupply = Math.max(0, db.muteSupply - mute); shred.svcUsd = 0; shred.burnedMute += mute; shred.burnedUsd += usd; shred.epochs++;
  const id = base58(sha('shred|' + shred.epochs + '|' + usd.toFixed(6) + '|' + mute.toFixed(6) + '|' + now));
  shred.burns.unshift({ id, usd, mute, px, ts: now, epoch: shred.epochs }); if (shred.burns.length > 40) shred.burns.pop();
}
let saveT = null; function save() { if (saveT) return; saveT = setTimeout(() => { saveT = null; try { fs.writeFileSync(DATA_PATH, JSON.stringify(db)); } catch (e) {} }, 800); }
const isWallet = (s) => /^0x[a-fA-F0-9]{40}$/.test(s);
function W(a) { a = a.toLowerCase(); return db.wallets[a] || (db.wallets[a] = { usdg: SEED.usdg, mute: SEED.mute, musd: SEED.musd, priv: SEED.priv, seeded: true }); }

// ---------- chain: real USDG deposits to TREASURY, verified on-chain ----------
const USDG = { addr: (process.env.USDG_ADDR || '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168').toLowerCase(), dec: 6 };   // USDG on Robinhood Chain (6 dp)
const RPCS = (process.env.RH_RPCS || 'https://rpc.mainnet.chain.robinhood.com').split(',');
const MIN_DEPOSIT = +(process.env.MIN_DEPOSIT || 50);   // USDG — smaller transfers are NOT credited
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CHAIN = { ok: false, block: 0, treasuryUsdg: 0, treasuryMute: 0, lastRead: 0, errs: 0 };
const hexToNum = (h, dec) => { if (!h || h === '0x') return 0; const bi = BigInt(h); const d = 10n ** BigInt(dec || 18); return Number(bi / d) + Number(bi % d) / Number(d); };
async function rpc(method, params) {
  let err; for (const u of RPCS) { try { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ac.signal }); clearTimeout(tm);
    const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; } catch (e) { err = e; CHAIN.errs++; } }
  throw err || new Error('rpc');
}
const balOf = (token, dec, who) => rpc('eth_call', [{ to: token, data: '0x70a08231' + who.slice(2).padStart(64, '0') }, 'latest']).then((r) => hexToNum(r, dec));
async function pollChain() { try { CHAIN.block = Number(BigInt(await rpc('eth_blockNumber', []))); CHAIN.treasuryUsdg = await balOf(USDG.addr, USDG.dec, TREASURY); CHAIN.treasuryMute = MUTE_MINT ? await balOf(MUTE_MINT, 18, TREASURY) : 0; CHAIN.ok = true; CHAIN.lastRead = Date.now(); } catch (e) { CHAIN.ok = false; } }
setInterval(pollChain, 30000); pollChain();
if (!db.txs) db.txs = {};
if (!db.treasuryIn) db.treasuryIn = { usdg: 0, n: 0 };
async function creditDeposit(w, txHash) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) throw 'paste the transaction hash';
  txHash = txHash.toLowerCase(); if (db.txs[txHash]) throw 'already credited';
  const [tx, rc] = await Promise.all([rpc('eth_getTransactionByHash', [txHash]), rpc('eth_getTransactionReceipt', [txHash])]);
  if (!tx) throw 'tx not found'; if (!rc) throw 'pending — try again in a few seconds'; if (rc.status !== '0x1') throw 'tx reverted';
  if ((tx.from || '').toLowerCase() !== w) throw 'tx not from your wallet';
  let amt = 0;
  for (const lg of rc.logs || []) {
    if ((lg.address || '').toLowerCase() !== USDG.addr || lg.topics[0] !== TRANSFER_TOPIC) continue;
    const from = '0x' + lg.topics[1].slice(26), to = '0x' + lg.topics[2].slice(26);
    if (from.toLowerCase() === w && to.toLowerCase() === TREASURY.toLowerCase()) amt += hexToNum(lg.data, USDG.dec);
  }
  if (!(amt > 0)) throw 'no USDG transfer to the treasury in this tx';
  if (amt < MIN_DEPOSIT) throw 'minimum deposit is ' + MIN_DEPOSIT + ' USDG — this transfer (' + amt.toFixed(2) + ') is not credited';
  const u = W(w); u.usdg += amt; u.deposited = (u.deposited || 0) + amt;
  db.txs[txHash] = { w, amt, block: Number(BigInt(rc.blockNumber)), ts: Date.now() }; db.treasuryIn.usdg += amt; db.treasuryIn.n++; save();
  return { amt, tx: txHash, block: db.txs[txHash].block };
}
// ---------- withdrawals: USDG leaves the ledger into a queue the treasury pays out by hand (no hot key on this server) ----------
if (!db.queue) db.queue = [];
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// ---------- THE HAPPY: temporary mUSD staking, paid in $MUTE from a FIXED pre-funded pool. No printing. Hard end. ----------
const HAPPY = {
  apy: +(process.env.HAPPY_APY || 0.40),               // 40% APY, in mUSD terms
  pool: +(process.env.HAPPY_POOL || 5_000_000),         // MUTE set aside by the treasury for the whole season
  cap: +(process.env.HAPPY_CAP || 250_000),             // max mUSD staked protocol-wide
  start: +(process.env.HAPPY_START || 1),                // open now
  end: +(process.env.HAPPY_END || 1792886400000),       // 2026-10-25 00:00 UTC, then it is over
};
if (!db.happy) db.happy = { staked: 0, paidMute: 0, paidUsd: 0, stakers: 0 };
const HAPPY_BOOST = { apy: +(process.env.HAPPY_BOOST_APY || 1.00), end: +(process.env.HAPPY_BOOST_END || 1790553600000) };   // 100% APY through 2026-09-28, then back to HAPPY.apy
const happyApy = (now) => now < HAPPY_BOOST.end ? HAPPY_BOOST.apy : HAPPY.apy;
function happyLive(now) { return now >= HAPPY.start && now < HAPPY.end && db.happy.paidMute < HAPPY.pool; }
function accrue(u, now) {   // reward accrues in mUSD terms per second while happy hour is live
  if (!u.stake) return; const t0 = u.stakeT || now; const t1 = Math.min(now, HAPPY.end);
  if (t1 > t0 && happyLive(t0)) u.stakeAcc = (u.stakeAcc || 0) + u.stake * happyApy(t0) * (t1 - t0) / 31536000000;
  u.stakeT = now;
}
function happyView(u, now) { accrue(u, now); const px = Math.max(0.000001, db.mutePrice); return { staked: u.stake || 0, accruedUsd: u.stakeAcc || 0, accruedMute: (u.stakeAcc || 0) / px, since: u.stakeSince || null }; }

// ---------- PHASE III: The Note (pay links) + The Carbon Copy (view keys) ----------
//   The Note : lock shielded mUSD behind a secret; anyone holding the link claims it into their own shielded balance.
//              No recipient address is ever named. On the ledger it is one nullifier + one commitment, like any private send.
//   The Carbon Copy : a read-only view key. Whoever holds it can read your private balance and history and can never spend.
//              Selective disclosure — show an auditor, a partner, a court exactly what you choose, and nobody else.
if (!db.links) db.links = {};
if (!db.viewSalt) db.viewSalt = base58(randomBytes(32));
const hist = (w, e) => { w.hist = w.hist || []; w.hist.unshift({ ts: Date.now(), ...e }); if (w.hist.length > 200) w.hist.pop(); };
const linkId = (secret) => base58(sha('note|' + secret));
function viewKeyOf(addr) { const mac = createHmac('sha256', db.viewSalt).update('seal|' + addr.toLowerCase()).digest().subarray(0, 16); return base58(Buffer.concat([Buffer.from(addr.slice(2), 'hex'), mac])); }
function walletOfViewKey(key) { try { let n = 0n; for (const ch of key) { const i = B58.indexOf(ch); if (i < 0) return null; n = n * 58n + BigInt(i); } let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex; let buf = Buffer.from(hex, 'hex'); let lead = 0; for (const ch of key) { if (ch === '1') lead++; else break; } buf = Buffer.concat([Buffer.alloc(lead), buf]); if (buf.length !== 36) return null; const addr = '0x' + buf.subarray(0, 20).toString('hex'); return viewKeyOf(addr) === key ? addr : null; } catch (e) { return null; } }

// ---------- BONDS: USDG in, discounted $MUTE out, vested. The USDG stays in reserve and mints NOTHING, so every bond over-collateralizes mUSD. ----------
const BOND = {
  discount: +(process.env.BOND_DISCOUNT || 0.20),          // 20% below market
  vestMs: +(process.env.BOND_VEST_DAYS || 5) * 864e5,      // linear vest
  capUsd: +(process.env.BOND_CAP_USD || 5000),             // per-day capacity
  end: +(process.env.BOND_END || 1792886400000),  // same close as happy hour
  // THE FREEZER: lock the bond. Deeper discount, hard 48-hour lock, and the locked MUTE earns APY in MUTE paid from the Happy Hour pool (fixed, no printing).
  lockDiscount: +(process.env.FREEZER_DISCOUNT || 0.30), lockMs: +(process.env.FREEZER_LOCK_DAYS || 2) * 864e5, lockApy: +(process.env.FREEZER_APY || 0.80),
  min: 50,
};
if (!db.bonds) db.bonds = { soldUsd: 0, soldMute: 0, n: 0, day: 0, dayUsd: 0 };
if (!db.freezer) db.freezer = { lockedMute: 0, usd: 0, n: 0, yieldMute: 0 };
const freezerPrice = () => Math.max(0.000001, db.mutePrice) * (1 - BOND.lockDiscount);
const freezerYield = (b, now) => b.lock ? b.mute * BOND.lockApy * (Math.min(now, b.ts + BOND.lockMs) - b.ts) / 31536000000 : 0;
function bondDay() { const d = Math.floor(Date.now() / 864e5); if (db.bonds.day !== d) { db.bonds.day = d; db.bonds.dayUsd = 0; } return db.bonds; }
const bondPrice = () => Math.max(0.000001, db.mutePrice) * (1 - BOND.discount);
function bondView(u, now) { const list = (u.bonds || []).map((b) => { const len = b.lock ? BOND.lockMs : BOND.vestMs; let k = Math.min(1, Math.max(0, (now - b.ts) / len)); if (b.lock && k < 1) k = 0; const vested = b.mute * k; const y = freezerYield(b, now); return { id: b.id, usd: b.usd, mute: b.mute, price: b.price, ts: b.ts, lock: !!b.lock, vestEnd: b.ts + len, vested, yieldMute: y, claimable: Math.max(0, vested - b.claimed) + (b.lock && k >= 1 && !b.yieldPaid ? y : 0), claimed: b.claimed }; }); return { list, claimable: list.reduce((x, b) => x + b.claimable, 0), pending: list.reduce((x, b) => x + (b.mute - b.claimed), 0), locked: list.filter((b) => b.lock && b.claimed < b.mute).reduce((x, b) => x + b.mute, 0), freezing: list.filter((b) => b.lock && b.claimed < b.mute).reduce((x, b) => x + b.yieldMute, 0) }; }

// ---------- THE DARK POOL: shielded 1x exposure to tokenized stocks, priced off the exchange tape, settled in shielded mUSD ----------
//   Ticker, size, side and P&L live inside the shield. The ledger sees one nullifier + one commitment per open/close, same as any private send.
//   No leverage. Position and open-interest caps. Tape must be fresh (< 15 min) or the market is closed to new trades. Shorts are capped at 95% loss.
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36';
const DARK_FEED = { HOOD: 'HOOD', TSLA: 'TSLA', NVDA: 'NVDA', AAPL: 'AAPL', SPY: 'SPY', COIN: 'COIN', MSTR: 'MSTR', GLD: 'GLD', BTC: 'BTC-USD', ETH: 'ETH-USD' };
const DARK = { fee: +(process.env.DARK_FEE || 0.003), maxPos: +(process.env.DARK_MAX_POS || 1000), maxOi: +(process.env.DARK_MAX_OI || 25000), fresh: 15 * 60e3, liq: 0.95 };
const TAPE = {};   // sym -> { px, ts, at }
async function pollTape() {
  for (const [sym, q] of Object.entries(DARK_FEED)) {
    try { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 9000);
      const r = await fetch(YF + encodeURIComponent(q) + '?range=1d&interval=1m&includePrePost=true', { headers: { accept: 'application/json', 'user-agent': UA }, signal: ac.signal }); clearTimeout(tm); if (!r.ok) continue;
      const res = (await r.json()).chart.result[0]; const m = res.meta; let v = +m.regularMarketPrice, ts = m.regularMarketTime * 1000;
      const T = res.timestamp || [], C = (res.indicators.quote[0] && res.indicators.quote[0].close) || [];
      for (let i = C.length - 1; i >= 0; i--) if (C[i] != null && T[i] * 1000 > ts) { v = +C[i]; ts = T[i] * 1000; break; }
      if (v > 0) TAPE[sym] = { px: v, ts, at: Date.now() };
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  markDark();
}
setInterval(pollTape, 30000); pollTape();
const tapeFresh = (sym) => { const t = TAPE[sym]; return !!t && (Date.now() - t.ts) < DARK.fresh; };
if (!db.dark) db.dark = { oi: 0, open: 0, opened: 0, closed: 0, volume: 0, fees: 0, housePnl: 0, liqs: 0 };
const posPnl = (p, px) => p.side === 'long' ? p.notional * (px - p.entry) / p.entry : p.notional * (p.entry - px) / p.entry;
function closePos(w, p, px, why) {   // settle into the shield
  let pnl = posPnl(p, px); if (pnl < -p.notional * DARK.liq) pnl = -p.notional * DARK.liq;
  const fee = p.notional * DARK.fee; const back = Math.max(0, p.notional + pnl - fee);
  w.priv += back; shred.svcUsd += fee - quietPay(fee * QUIET_CUT); db.dark.fees += fee; db.dark.housePnl -= pnl; db.dark.oi = Math.max(0, db.dark.oi - p.notional); db.dark.open = Math.max(0, db.dark.open - 1); db.dark.closed++; if (why === 'liq') db.dark.liqs++;
  w.dark = (w.dark || []).filter((x) => x.id !== p.id); hist(w, { type: 'dark-close', amt: back, memo: p.sym + ' ' + p.side + ' · ' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) });
  sh.nullifiers++; const { C, note } = shieldNote(back, shKeys[randomInt(0, shKeys.length)].pub); pushShTx({ sig: base58(randomBytes(32)), type: 'private', nullifier: nullifierOf('d', sh.notes), commitment: C, note, proof: simProof(), ts: Date.now() });
  return { pnl, fee, back };
}
function markDark() {   // auto-close anything past the loss cap
  for (const [addr, w] of Object.entries(db.wallets)) for (const p of (w.dark || []).slice()) { const t = TAPE[p.sym]; if (!t) continue; if (posPnl(p, t.px) <= -p.notional * DARK.liq) closePos(w, p, t.px, 'liq'); }
}
function darkView(u) { return (u.dark || []).map((p) => { const t = TAPE[p.sym]; const px = t ? t.px : p.entry; const pnl = Math.max(-p.notional * DARK.liq, posPnl(p, px)); return { ...p, px, pnl, fresh: tapeFresh(p.sym) }; }); }

// ---------- privacy primitives (real) ----------
const shKeys = [];
function shInit() { for (let i = 0; i < 16; i++) { const kp = generateKeyPairSync('x25519'); shKeys.push({ pub: kp.publicKey, addr: base58(rawX(kp.publicKey)), secret: base58(randomBytes(12)) }); } }
const commitTo = (amt, owner, bl) => base58(sha('cm|' + amt + '|' + owner + '|' + bl));
const nullifierOf = (sec, i) => base58(sha('nf|' + sec + '|' + i));
function merkleRoot(lv) { if (!lv.length) return base58(sha('empty')); let l = lv.slice(); while (l.length > 1) { const n = []; for (let i = 0; i < l.length; i += 2) n.push(base58(sha(l[i] + (l[i + 1] || l[i])))); l = n; } return l[0]; }
function encNote(pub, pt) { const e = generateKeyPairSync('x25519'); const s = diffieHellman({ privateKey: e.privateKey, publicKey: pub }); const k = sha(s); const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', k, iv); const ct = Buffer.concat([c.update(Buffer.from(pt)), c.final()]); return base58(Buffer.concat([rawX(e.publicKey), iv, c.getAuthTag(), ct])); }
const simProof = () => base58(randomBytes(40));
const sh = db.shielded;
function pushShTx(tx) { sh.feed.unshift(tx); if (sh.feed.length > 60) sh.feed.pop(); sh.txCount++; if (sh.commitments.length > 1024) sh.commitments = sh.commitments.slice(-1024); sh.root = merkleRoot(sh.commitments); }
function shieldNote(amount, recipPub) { const bl = base58(randomBytes(8)); const C = commitTo(amount, recipPub ? base58(rawX(recipPub)) : 'anon', bl); sh.commitments.push(C); sh.notes++; return { C, note: encNote(recipPub || shKeys[0].pub, amount + '|' + bl) }; }

// ---------- $MUTE price: Robinhood Chain pools (DexScreener) when MUTE_MINT is set ----------
let MUTE_LIVE = { px: 0, liq: 0, pair: '', t: 0 };
async function pollMute() {
  if (!MUTE_MINT) return;
  try { const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + MUTE_MINT); if (!r.ok) return;
    const ps = ((await r.json()).pairs || []).filter((p) => p.chainId === 'robinhood' && +p.priceUsd > 0).sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
    if (ps[0]) { MUTE_LIVE = { px: +ps[0].priceUsd, liq: (ps[0].liquidity && ps[0].liquidity.usd) || 0, pair: ps[0].pairAddress || '', t: Date.now() }; db.mutePrice = MUTE_LIVE.px; } } catch (e) {}
}
setInterval(pollMute, 20000); pollMute();

// ---------- peg / algo tick ----------
function tick() {
  const now = Date.now(); const dt = (now - db.lastTick) / 1000; if (dt < TICK_SEC) return; db.lastTick = now;
  // mean-reverting mUSD price around $1
  db.musdPrice += (1 - db.musdPrice) * 0.18 + (Math.random() - 0.5) * 0.0035;
  db.musdPrice = Math.max(0.97, Math.min(1.03, db.musdPrice));
  // algorithmic collateral ratio: above peg -> lower CR (more algo); below -> raise CR (more backing)
  const target = db.musdPrice > 1.001 ? db.cr - 0.01 : db.musdPrice < 0.999 ? db.cr + 0.01 : db.cr;
  db.cr += (Math.max(0.55, Math.min(1, target)) - db.cr) * 0.25;
  // MUTE price drifts (captures protocol value)
  if (!MUTE_LIVE.px) db.mutePrice = Math.max(0.05, db.mutePrice * (1 + (Math.random() - 0.49) * 0.02));
  // simulated shielded activity (keeps the privacy pool alive)
  const n = randomInt(0, 3);
  for (let i = 0; i < n; i++) {
    const roll = Math.random(); const recip = shKeys[randomInt(0, shKeys.length)];
    if (roll < 0.3) { const amt = svc('shield', randomInt(200, 6000)); const { C, note } = shieldNote(amt, recip.pub); sh.totalValue += amt; pushShTx({ sig: base58(randomBytes(32)), type: 'shield', commitment: C, note, ts: now }); }
    else if (roll < 0.85) { const { C, note } = shieldNote(svc('send', randomInt(50, 5000)), recip.pub); sh.nullifiers++; pushShTx({ sig: base58(randomBytes(32)), type: 'private', nullifier: nullifierOf(recip.secret, sh.notes + i), commitment: C, note, proof: simProof(), ts: now }); }
    else { const amt = svc('unshield', randomInt(200, 4000)); sh.nullifiers++; sh.totalValue = Math.max(0, sh.totalValue - amt); pushShTx({ sig: base58(randomBytes(32)), type: 'unshield', nullifier: nullifierOf(recip.secret, sh.notes + i), publicAmount: amt, ts: now }); }
  }
  shredBurn(now);
  save();
}

// ---------- views ----------
const num = (v, hi) => { let n = +v; if (!isFinite(n) || n <= 0) return 0; return hi != null ? Math.min(n, hi) : n; };
function metrics() {
  const backing = db.collateralUsd / Math.max(1, db.musdSupply);
  return {
    stable: STABLE, gov: GOV, mint: MUTE_MINT, treasury: TREASURY, network: 'robinhood', chainId: 4663, explorer: 'https://explorer.mainnet.chain.robinhood.com', muteLive: MUTE_LIVE.px ? MUTE_LIVE : null, peg: 1.0,
    musdPrice: +db.musdPrice.toFixed(4), pegStatus: db.musdPrice >= 1.001 ? 'above' : db.musdPrice <= 0.999 ? 'below' : 'at',
    musdSupply: db.musdSupply, musdMarketCap: db.musdPrice * db.musdSupply,
    cr: db.cr, collateralUsd: db.collateralUsd, backingRatio: backing,
    mutePrice: db.mutePrice, muteSupply: db.muteSupply, muteMarketCap: db.mutePrice * db.muteSupply,
    minDeposit: MIN_DEPOSIT, chain: { ok: CHAIN.ok, block: CHAIN.block, treasuryUsdg: CHAIN.treasuryUsdg, treasuryMute: CHAIN.treasuryMute, lastRead: CHAIN.lastRead, usdg: USDG.addr, rpc: RPCS[0] },
    deposits: { usdg: db.treasuryIn.usdg, n: db.treasuryIn.n }, dark: { markets: Object.keys(DARK_FEED).map((sym) => ({ sym, px: TAPE[sym] ? TAPE[sym].px : null, ts: TAPE[sym] ? TAPE[sym].ts : null, fresh: tapeFresh(sym) })), open: db.dark.open, opened: db.dark.opened, closed: db.dark.closed, volume: db.dark.volume, fees: db.dark.fees, liqs: db.dark.liqs, fee: DARK.fee, maxPos: DARK.maxPos, maxOi: DARK.maxOi, full: db.dark.oi >= DARK.maxOi }, bonds: (() => { const B = bondDay(); return { discount: BOND.discount, vestDays: BOND.vestMs / 864e5, capUsd: BOND.capUsd, leftToday: Math.max(0, BOND.capUsd - B.dayUsd), soldUsd: B.soldUsd, soldMute: B.soldMute, n: B.n, price: bondPrice(), market: db.mutePrice, end: BOND.end, open: Date.now() <= BOND.end, min: BOND.min, freezer: { discount: BOND.lockDiscount, lockDays: BOND.lockMs / 864e5, apy: BOND.lockApy, price: freezerPrice(), lockedMute: db.freezer.lockedMute, usd: db.freezer.usd, n: db.freezer.n, yieldMute: db.freezer.yieldMute } }; })(), punch: { cut: PUNCH_CUT, guests: db.punch.guests, paid: db.punch.paid, board: referrers() }, notes: { created: Object.keys(db.links).length, open: Object.values(db.links).filter((L) => !L.claimed).length, claimed: Object.values(db.links).filter((L) => L.claimed).length }, queue: { open: db.queue.filter((q) => q.status === 'queued').length, openUsd: db.queue.filter((q) => q.status === 'queued').reduce((a, q) => a + q.amt, 0), paid: db.queue.filter((q) => q.status === 'paid').length },
    happy: { ...HAPPY, apy: happyApy(Date.now()), baseApy: HAPPY.apy, boost: { apy: HAPPY_BOOST.apy, end: HAPPY_BOOST.end, live: Date.now() < HAPPY_BOOST.end, endsIn: Math.max(0, HAPPY_BOOST.end - Date.now()) }, live: happyLive(Date.now()), staked: db.happy.staked, stakers: db.happy.stakers, paidMute: db.happy.paidMute, paidUsd: db.happy.paidUsd, poolLeft: Math.max(0, HAPPY.pool - db.happy.paidMute), poolLeftUsd: Math.max(0, HAPPY.pool - db.happy.paidMute) * db.mutePrice, endsIn: Math.max(0, HAPPY.end - Date.now()), startsIn: Math.max(0, HAPPY.start - Date.now()) },
    shred: { svcUsd: shred.svcUsd, burnedMute: shred.burnedMute, burnedUsd: shred.burnedUsd, epochs: shred.epochs, minUsd: SHRED_MIN_USD, bps: { shield: 30, send: 30, unshield: 30, redeem: 50 }, burns: shred.burns.slice(0, 8).map((b) => ({ id: b.id.slice(0, 8) + '…' + b.id.slice(-4), usd: b.usd, mute: b.mute, px: b.px, ts: b.ts, epoch: b.epoch })) },
    quiet: quietView(),
    shielded: { totalValue: sh.totalValue, notes: sh.notes, nullifiers: sh.nullifiers, txCount: sh.txCount, root: sh.root },
    feed: sh.feed.slice(0, 10).map((t) => ({ sig: t.sig.slice(0, 6) + '…' + t.sig.slice(-4), type: t.type, publicAmount: t.publicAmount || null, ts: t.ts })),
  };
}
function account(addr) { const w = W(addr); const now = Date.now(); return { wallet: addr, usdg: w.usdg, mute: w.mute, musd: w.musd, priv: w.priv, deposited: w.deposited || 0, quietEarned: w.quietEarned || 0, dark: darkView(w), bonds: bondView(w, now), ref: w.ref || null, guests: w.guests || 0, earned: w.earned || 0, happy: happyView(w, now), queue: db.queue.filter((q) => q.wallet === addr.toLowerCase()).slice(0, 10) }; }

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve(req, res) { let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/client/index.html'; if (u === '/view') u = '/client/view.html'; const f = path.normalize(path.join(ROOT, u)); if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); } fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); }); }
function json(res, c, o) { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e4) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); }); }

http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/api/config') return json(res, 200, { stable: STABLE, gov: GOV, mint: MUTE_MINT, treasury: TREASURY, network: 'robinhood', chainId: 4663, explorer: 'https://explorer.mainnet.chain.robinhood.com', muteLive: MUTE_LIVE.px ? MUTE_LIVE : null });
  if (u === '/api/metrics') return json(res, 200, metrics());
  if (req.method === 'POST') {
    const d = await body(req);
    if (u === '/api/note/peek') { const L = db.links[linkId(String(d.secret || ''))]; if (!L) return json(res, 200, { error: 'no such note' }); return json(res, 200, { amt: L.amt, memo: L.memo, claimed: L.claimed, ts: L.ts }); }
    if (u === '/api/view') { const addr = walletOfViewKey(String(d.key || '')); if (!addr) return json(res, 200, { error: 'invalid view key' }); const v = W(addr); return json(res, 200, { ok: true, wallet: addr, priv: v.priv, staked: v.stake || 0, hist: (v.hist || []).slice(0, 100), notesOpen: Object.values(db.links).filter((L) => !L.claimed).length, root: sh.root, t: Date.now() }); }
    if (u === '/api/account') { if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'paste a valid Robinhood Chain address' }); const aw = W(d.wallet); if (d.ref) { const fresh = !(aw.deposited || 0) && !(aw.hist || []).length; if (fresh && bind(aw, d.wallet.toLowerCase(), d.ref)) save(); } return json(res, 200, account(d.wallet)); }
    if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'connect a wallet first' });
    const w = W(d.wallet);

    if (u === '/api/mint') { // collateral + MUTE -> mUSD
      const m = num(d.amount); if (!m) return json(res, 200, { error: 'enter an amount' });
      const needUsdg = m * db.cr; const algoUsd = m * (1 - db.cr); const burnMute = algoUsd / db.mutePrice;
      if (w.usdg < m) return json(res, 200, { error: 'not enough USDG — deposit first' });
      // the algorithmic slice is paid in USDG too: it buys MUTE at market and burns it via the shred (nothing is printed to mint mUSD)
      w.usdg -= m; w.musd += m; db.musdSupply += m; db.collateralUsd += needUsdg; db.muteSupply = Math.max(0, db.muteSupply - burnMute);
      shred.svcUsd += algoUsd; save();
      return json(res, 200, { ok: true, minted: m, usedUsdg: needUsdg, algoUsd, burnedMute: burnMute, ...account(d.wallet) });
    }
    if (u === '/api/dev/faucet' && process.env.DEV_FAUCET === '1') { w.usdg += num(d.amount) || 0; save(); return json(res, 200, { ok: true, ...account(d.wallet) }); }   // LOCAL TESTING ONLY — never set DEV_FAUCET in production
    if (u === '/api/deposit') { try { const r = await creditDeposit(d.wallet.toLowerCase(), d.tx); return json(res, 200, { ok: true, ...r, ...account(d.wallet) }); } catch (e) { return json(res, 200, { error: String(e.message || e) }); } }
    if (u === '/api/bond') { // USDG ledger -> discounted MUTE, vested. USDG stays in reserve. Nothing minted.
      const now = Date.now(); if (now > BOND.end) return json(res, 200, { error: 'bonds are closed' });
      const x = num(d.amount, w.usdg); if (!x) return json(res, 200, { error: 'not enough USDG — deposit first' }); if (x < BOND.min) return json(res, 200, { error: 'minimum bond is ' + BOND.min + ' USDG' });
      const B = bondDay(); if (B.dayUsd + x > BOND.capUsd) return json(res, 200, { error: 'today\'s bond capacity is spent — ' + (BOND.capUsd - B.dayUsd).toFixed(2) + ' USDG left' });
      const lock = !!d.lock; const price = lock ? freezerPrice() : bondPrice(); const mute = x / price;
      w.usdg -= x; db.collateralUsd += x; B.dayUsd += x; B.soldUsd += x; B.soldMute += mute; B.n++; if (lock) { db.freezer.lockedMute += mute; db.freezer.usd += x; db.freezer.n++; }
      w.bonds = w.bonds || []; w.bonds.push({ id: base58(randomBytes(6)), usd: x, mute, price, ts: now, claimed: 0, lock }); hist(w, { type: lock ? 'freezer' : 'bond', amt: x }); save();
      return json(res, 200, { ok: true, bonded: x, muteOut: mute, price, market: db.mutePrice, lock, unlockAt: lock ? now + BOND.lockMs : now + BOND.vestMs, apy: lock ? BOND.lockApy : 0, ...account(d.wallet) });
    }
    if (u === '/api/bond/claim') { const now = Date.now(); let got = 0, frozen = 0; for (const b of w.bonds || []) { if (b.lock) { if (now < b.ts + BOND.lockMs) continue; const c = b.mute - b.claimed; if (c > 0) { b.claimed = b.mute; got += c; db.freezer.lockedMute = Math.max(0, db.freezer.lockedMute - c); } if (!b.yieldPaid) { let y = freezerYield(b, now); const left = HAPPY.pool - db.happy.paidMute; if (y > left) y = Math.max(0, left); b.yieldPaid = true; frozen += y; db.happy.paidMute += y; db.happy.paidUsd += y * db.mutePrice; db.freezer.yieldMute += y; } continue; } const k = Math.min(1, (now - b.ts) / BOND.vestMs); const c = Math.max(0, b.mute * k - b.claimed); b.claimed += c; got += c; } if (got + frozen < 1e-9) return json(res, 200, { error: 'nothing vested or unlocked yet' }); w.mute += got + frozen; save(); return json(res, 200, { ok: true, claimedMute: got + frozen, frozenMute: frozen, ...account(d.wallet) }); }
    if (u === '/api/withdraw') { // ledger -> payout queue (treasury pays by hand, then marks it paid). asset: USDG (default) or MUTE
      const asset = d.asset === 'MUTE' ? 'MUTE' : 'USDG';
      const x = num(d.amount, asset === 'MUTE' ? w.mute : w.usdg); if (!x) return json(res, 200, { error: 'nothing to withdraw' }); if (asset === 'USDG' && x < 1) return json(res, 200, { error: 'minimum 1 USDG' });
      if (asset === 'MUTE') w.mute -= x; else w.usdg -= x;
      const q = { id: base58(randomBytes(6)), wallet: d.wallet.toLowerCase(), amt: x, asset, ts: Date.now(), status: 'queued', tx: null }; db.queue.unshift(q); if (db.queue.length > 500) db.queue.pop(); save();
      return json(res, 200, { ok: true, queued: q, ...account(d.wallet) });
    }
    if (u === '/api/admin/queue') { if (!ADMIN_KEY || d.key !== ADMIN_KEY) return json(res, 200, { error: 'no' }); return json(res, 200, { ok: true, queue: db.queue.slice(0, 100), deposits: Object.entries(db.txs).map(([tx, t]) => ({ tx, ...t })).slice(-50) }); }
    if (u === '/api/admin/paid') { if (!ADMIN_KEY || d.key !== ADMIN_KEY) return json(res, 200, { error: 'no' }); const q = db.queue.find((x) => x.id === d.id); if (!q) return json(res, 200, { error: 'no such item' }); q.status = 'paid'; q.tx = d.tx || null; q.paidTs = Date.now(); save(); return json(res, 200, { ok: true, q }); }
    if (u === '/api/stake') { // mUSD -> happy hour
      const now = Date.now(); if (!happyLive(now)) return json(res, 200, { error: 'happy hour is not open' });
      const x = num(d.amount, w.musd); if (!x) return json(res, 200, { error: 'nothing to stake' });
      if (db.happy.staked + x > HAPPY.cap) return json(res, 200, { error: 'happy hour is full — cap ' + HAPPY.cap.toLocaleString() + ' mUSD' });
      accrue(w, now); if (!w.stake) { db.happy.stakers++; w.stakeSince = now; } w.musd -= x; w.stake = (w.stake || 0) + x; w.stakeT = now; db.happy.staked += x; save();
      return json(res, 200, { ok: true, staked: x, ...account(d.wallet) });
    }
    if (u === '/api/unstake') { const now = Date.now(); accrue(w, now); const x = num(d.amount, w.stake || 0); if (!x) return json(res, 200, { error: 'nothing staked' });
      const xn = svc('unshield', x, w); w.stake -= x; w.musd += xn; db.happy.staked = Math.max(0, db.happy.staked - x); if (w.stake <= 0) { w.stake = 0; db.happy.stakers = Math.max(0, db.happy.stakers - 1); } save();
      return json(res, 200, { ok: true, unstaked: xn, fee: x - xn, ...account(d.wallet) });
    }
    if (u === '/api/claim') { const now = Date.now(); accrue(w, now); const usd = w.stakeAcc || 0; if (usd < 0.01) return json(res, 200, { error: 'nothing to claim yet' });
      const px = Math.max(0.000001, db.mutePrice); let mute = usd / px; const left = HAPPY.pool - db.happy.paidMute; if (left <= 0) return json(res, 200, { error: 'the pool is spent — happy hour is over' }); if (mute > left) mute = left;
      w.stakeAcc = 0; w.mute += mute; db.happy.paidMute += mute; db.happy.paidUsd += mute * px; save();
      return json(res, 200, { ok: true, claimedMute: mute, claimedUsd: mute * px, ...account(d.wallet) });
    }
    if (u === '/api/redeem') { // mUSD -> collateral + MUTE
      const r = num(d.amount, w.musd); if (!r) return json(res, 200, { error: 'nothing to redeem' });
      const rn = svc('redeem', r, w); const outUsdg = rn * db.cr; const mintMute = (rn * (1 - db.cr)) / db.mutePrice;
      w.musd -= r; w.usdg += outUsdg; w.mute += mintMute; db.musdSupply = Math.max(0, db.musdSupply - r); db.collateralUsd = Math.max(0, db.collateralUsd - outUsdg); db.muteSupply += mintMute; save();
      return json(res, 200, { ok: true, redeemed: r, gotUsdg: outUsdg, gotMute: mintMute, ...account(d.wallet) });
    }
    if (u === '/api/note/create') { // lock shielded mUSD behind a secret link
      const x = num(d.amount, w.priv); if (!x) return json(res, 200, { error: 'not enough private balance' }); if (x < 1) return json(res, 200, { error: 'minimum 1 mUSD' });
      const secret = base58(randomBytes(16)); const id = linkId(secret); const xn = svc('send', x, w);
      w.priv -= x; sh.nullifiers++; const { C, note } = shieldNote(xn, shKeys[randomInt(0, shKeys.length)].pub);
      db.links[id] = { amt: xn, memo: String(d.memo || '').slice(0, 80), ts: Date.now(), claimed: false, by: d.wallet.toLowerCase(), from: base58(sha('from|' + d.wallet.toLowerCase() + '|' + secret)) };
      pushShTx({ sig: base58(randomBytes(32)), type: 'private', nullifier: nullifierOf('n', sh.notes), commitment: C, note, proof: simProof(), ts: Date.now() });
      hist(w, { type: 'note', amt: x, id }); save();
      return json(res, 200, { ok: true, secret, id, amt: xn, fee: x - xn, ...account(d.wallet) });
    }
    if (u === '/api/note/claim') { // anyone holding the secret claims it into THEIR shielded balance
      const L = db.links[linkId(String(d.secret || ''))]; if (!L) return json(res, 200, { error: 'no such note' }); if (L.claimed) return json(res, 200, { error: 'this note was already claimed' });
      L.claimed = true; L.claimedTs = Date.now(); w.priv += L.amt; if (L.by) bind(w, d.wallet.toLowerCase(), L.by); hist(w, { type: 'claimed', amt: L.amt, memo: L.memo }); save();
      return json(res, 200, { ok: true, claimed: L.amt, memo: L.memo, ...account(d.wallet) });
    }
    if (u === '/api/carbon') { return json(res, 200, { ok: true, viewKey: viewKeyOf(d.wallet) }); }
    if (u === '/api/dark/open') { // shielded mUSD -> a hidden position
      const sym = String(d.sym || '').toUpperCase(); if (!DARK_FEED[sym]) return json(res, 200, { error: 'unknown market' });
      if (!tapeFresh(sym)) return json(res, 200, { error: sym + ' tape is closed right now — try when the market is open' });
      const side = d.side === 'short' ? 'short' : 'long'; const x = num(d.amount, w.priv); if (!x) return json(res, 200, { error: 'not enough shielded mUSD' }); if (x < 10) return json(res, 200, { error: 'minimum 10 mUSD' });
      if (x > DARK.maxPos) return json(res, 200, { error: 'max ' + DARK.maxPos + ' mUSD per position' }); if (db.dark.oi + x > DARK.maxOi) return json(res, 200, { error: 'the pool is full for now' });
      const fee = x * DARK.fee; const notional = x - fee; const px = TAPE[sym].px;
      w.priv -= x; shred.svcUsd += fee - quietPay(fee * QUIET_CUT); db.dark.fees += fee; db.dark.oi += notional; db.dark.open++; db.dark.opened++; db.dark.volume += notional;
      const p = { id: base58(randomBytes(6)), sym, side, notional, entry: px, ts: Date.now() }; w.dark = w.dark || []; w.dark.push(p); hist(w, { type: 'dark-open', amt: x, memo: sym + ' ' + side });
      sh.nullifiers++; const { C, note } = shieldNote(notional, shKeys[randomInt(0, shKeys.length)].pub); pushShTx({ sig: base58(randomBytes(32)), type: 'private', nullifier: nullifierOf('d', sh.notes), commitment: C, note, proof: simProof(), ts: Date.now() }); save();
      return json(res, 200, { ok: true, opened: p, ...account(d.wallet) });
    }
    if (u === '/api/dark/close') { const p = (w.dark || []).find((x) => x.id === d.id); if (!p) return json(res, 200, { error: 'no such position' }); if (!tapeFresh(p.sym)) return json(res, 200, { error: p.sym + ' tape is closed — closes settle when the market is open' });
      const r = closePos(w, p, TAPE[p.sym].px, 'user'); save(); return json(res, 200, { ok: true, closed: r, ...account(d.wallet) }); }
    if (u === '/api/shield') { // public mUSD -> private
      const s = num(d.amount, w.musd); if (!s) return json(res, 200, { error: 'nothing to shield' });
      const sn = svc('shield', s, w); w.musd -= s; w.priv += sn; sh.totalValue += sn; hist(w, { type: 'shield', amt: sn }); const { C, note } = shieldNote(sn, shKeys[0].pub);
      pushShTx({ sig: base58(randomBytes(32)), type: 'shield', commitment: C, note, ts: Date.now() }); save();
      return json(res, 200, { ok: true, shielded: sn, fee: s - sn, ...account(d.wallet) });
    }
    if (u === '/api/send') { // shielded transfer — amount + parties hidden
      if (!isWallet(d.to || '')) return json(res, 200, { error: 'enter a valid recipient address' });
      const x = num(d.amount, w.priv); if (!x) return json(res, 200, { error: 'not enough private balance' });
      const xn = svc('send', x, w); w.priv -= x; const r = W(d.to); r.priv += xn; sh.nullifiers++; hist(w, { type: 'sent', amt: x, to: d.to.toLowerCase() }); hist(r, { type: 'received', amt: xn });
      const { C, note } = shieldNote(xn, shKeys[randomInt(0, shKeys.length)].pub);
      pushShTx({ sig: base58(randomBytes(32)), type: 'private', nullifier: nullifierOf('u', sh.notes), commitment: C, note, proof: simProof(), ts: Date.now() }); save();
      return json(res, 200, { ok: true, sent: xn, fee: x - xn, ...account(d.wallet) });
    }
    if (u === '/api/unshield') { // private -> public
      const un = num(d.amount, w.priv); if (!un) return json(res, 200, { error: 'nothing to unshield' });
      const unn = svc('unshield', un, w); w.priv -= un; w.musd += unn; hist(w, { type: 'unshield', amt: un }); sh.totalValue = Math.max(0, sh.totalValue - un); sh.nullifiers++;
      pushShTx({ sig: base58(randomBytes(32)), type: 'unshield', nullifier: nullifierOf('u', sh.notes), publicAmount: un, ts: Date.now() }); save();
      return json(res, 200, { ok: true, unshielded: unn, fee: un - unn, ...account(d.wallet) });
    }
  }
  serve(req, res);
}).listen(PORT, () => console.log('MUTE (' + STABLE + '/' + GOV + ') on Robinhood Chain · :' + PORT));

shInit();
setInterval(tick, 1000);
