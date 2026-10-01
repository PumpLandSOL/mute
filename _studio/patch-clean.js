// one-shot UI cleanup: shorter copy, less bold, tidier hero + numbers. Same aesthetic. (run once)
'use strict';
const fs = require('fs'); const path = require('path');
const HF = path.join(__dirname, '..', 'client', 'index.html'), AF = path.join(__dirname, '..', 'client', 'src', 'app.js');
let h = fs.readFileSync(HF, 'utf8'), a = fs.readFileSync(AF, 'utf8');
if (h.includes('/* clean pass */')) throw new Error('already patched');
// replace the inner HTML of the element on the line that contains `key`, keeping the tag that opens with `open`
const swapIn = (src, key, open, close, inner) => { const lines = src.split('\n'); const i = lines.findIndex((l) => l.includes(key)); if (i < 0) throw new Error('missing: ' + key); const l = lines[i]; const s = l.indexOf(open, l.indexOf(key) - open.length - 40 > 0 ? 0 : 0); const st = l.indexOf('>', l.indexOf(open)) + 1; const en = l.indexOf(close, st); if (st <= 0 || en < 0) throw new Error('shape: ' + key); lines[i] = l.slice(0, st) + inner + l.slice(en); return lines.join('\n'); };
const rep = (src, x, y) => { if (!src.includes(x)) throw new Error('missing: ' + x.slice(0, 60)); return src.split(x).join(y); };

// ---------- CSS ----------
h = rep(h, '</style>', `/* clean pass */
.lead b,.fine b,.step p b,.ph .dd b{font-weight:inherit;color:inherit}
.fine{max-width:58ch;font-size:14.5px}.fine+.fine{margin-top:10px}
.heroG h1{font-size:clamp(28px,3.1vw,44px);line-height:1.16}
.heroG .orb{width:210px}.heroG{grid-template-columns:minmax(0,1fr) 210px}
.note{font-size:12.5px;margin-bottom:12px}.note b{font-weight:400;color:var(--ink)}
.stat .v{font-size:22px}
</style>`);

// ---------- hero ----------
h = swapIn(h, '<p class="lead"><b>mUSD</b>', '<p class="lead"', '</p>', 'A dollar on Robinhood Chain you can mute. Amount, sender and recipient never reach the ledger.');
h = rep(h, 'id="cta-demo">Deposit USDG · bond at −20%</button>', 'id="cta-demo">Deposit USDG</button>');
h = rep(h, 'data-go="quiet">Silent Yield · earn 40% of all fees</button>', 'data-go="quiet">Silent Yield · 40% of fees</button>');

// ---------- channels: one or two short lines each ----------
const L = h.split('\n'); const idx = (k) => { const i = L.findIndex((l) => l.includes(k)); if (i < 0) throw new Error('missing: ' + k); return i; };
const setLine = (k, html) => { const i = idx(k); const ind = L[i].match(/^\s*/)[0]; L[i] = ind + html; };
setLine('<p class="fine"><b>40% of every protocol fee', '<p class="fine">40% of every fee is split across muted balances the moment it is paid, as mUSD, inside the mute.</p>');
setLine('<p class="fine"><b>No staking. No lock.', '<p class="fine">No staking, no lock, nothing to claim. Funded by usage, so nothing is printed.</p>');
L.splice(idx('<p class="fine"><b>Nothing is printed to pay for it.'), 1);
setLine('<p class="fine" style="margin-top:0">Every entry below is public.', '<p class="fine" style="margin-top:0">Everything an observer can see. A muted transfer is one nullifier and one commitment.</p>');
setLine('<p class="fine">Commit <b>muted mUSD</b> to tokenized stocks.', '<p class="fine">Long or short tokenized stocks at 1x from your muted balance. Ticker, size and P&amp;L stay private.</p>');
setLine('<p class="fine"><b>Bonds.</b>', '<p class="fine">Bonds: $MUTE at 20% off, vesting over 5 days. Your USDG goes to the reserve.</p>');
setLine('<p class="fine"><b>Cryo.</b>', '<p class="fine">Cryo: 30% off, locked 48 hours, earning 80% APY while locked.</p>');
setLine('<p class="fine">Temporary by design.', '<p class="fine">Stake mUSD, earn $MUTE from a fixed pool. When the pool or the clock runs out, it closes.</p>');
setLine('<p class="fine"><b>30 bps</b> on mute', '<p class="fine">Fees fund Silent Yield. The rest buys $MUTE at market and removes it from supply.</p>');
setLine('<p class="fine" style="margin-top:0">Anyone who claims your', '<p class="fine" style="margin-top:0">Wallets that join through your link or claim your Drop pay you 20% of their fees, forever.</p>');
setLine('<p class="fine"><b>Top relays.</b>', '<p class="fine">Top relays · addresses masked</p>');
h = L.join('\n');
h = swapIn(h, '<h2>Drop<span class="tag">PAY LINK</span></h2><p class="fine"', '<p class="fine"', '</p>', 'Send muted dollars as a link. Whoever opens it claims them. No recipient is ever named.');
h = swapIn(h, '<h2>Mirror<span class="tag">VIEW KEY</span></h2><p class="fine"', '<p class="fine"', '</p>', 'A read-only key to your muted balance. Share it with one person. It can never spend.');
h = swapIn(h, '<h3>Mint mUSD</h3><p>', '<p', '</p>', 'Deposit USDG and receive $1 mUSD. Redeem any time.');
h = swapIn(h, '<h3>Mute it</h3><p>', '<p', '</p>', 'Your mUSD becomes a note only you can read.');
h = swapIn(h, '<h3>Send without a trace</h3><p>', '<p', '</p>', 'Amount and both parties stay hidden. The ledger sees one nullifier, one commitment.');

// ---------- vault notes: one line ----------
const note = (k, inner) => { const i = a.indexOf(k); if (i < 0) throw new Error('missing note: ' + k); const st = a.lastIndexOf('<div class="note"', i); const s2 = a.indexOf('>', st) + 1; const en = a.indexOf('</div>', i); a = a.slice(0, s2) + inner + a.slice(en); };
note('<b>Blind Desk.</b> Commit muted mUSD', 'Long or short a stock from your muted balance. 1x, live tape.');
note('<b>Bond USDG for $MUTE at', "$MUTE at ${Bd ? fmt(Bd.discount * 100, 0) : 20}% off, vesting ${Bd ? Bd.vestDays : 5} days. ${Bd && !Bd.open ? 'Bonds are closed.' : ''}");
note('<b>Cryo:</b> your USDG enters', "Cryo: ${F ? fmt(F.discount * 100, 0) : 30}% off, locked ${F ? F.lockDays * 24 : 48}h, earning ${F ? fmt(F.apy * 100, 0) : 80}% APY.");
note('Send <b>USDG on Robinhood Chain</b> to the treasury', 'Send USDG on Robinhood Chain. Credited once the receipt confirms. Minimum 50.');
note('Stake public mUSD in <b>the Window</b>', "Stake mUSD for ${V ? fmt(V.apy * 100, 0) : '—'}% APY in $MUTE. Unstake any time. ${V && !V.live ? 'The Window is ' + (V.startsIn > 0 ? 'not open yet' : 'over') + '.' : ''}");
note('Mint $1-pegged <b>mUSD</b> with deposited USDG', 'Mint $1 mUSD from deposited USDG.');
note('Move public mUSD into the <b>shielded pool</b>', 'Mute mUSD. Only you can read the balance, and it earns Silent Yield.');
note('Send muted mUSD. The <b>amount and both parties', 'Send muted. Amount and both parties stay hidden.');
note('<b>Or leave a drop:</b>', 'Or create a Drop link, no address needed.');
note('Burn mUSD to recover your', 'Redeem visible mUSD for USDG. Unmute first if it is muted.');

// vocabulary: the UI says mute, not shield
for (const [x, y] of [['>Shield mUSD<', '>Mute mUSD<'], ['>Unshield<', '>Unmute<'], ['`shielded ${', '`muted ${'], ['`unshielded ${', '`unmuted ${'], ['Shielded balance', 'Muted balance'], ['into your shielded balance', 'into your muted balance'], ['your shielded balance and history', 'your muted balance and history']]) if (a.includes(x)) a = a.split(x).join(y);

// numbers: price precision that fits the size of the number, no clutter in stat cells
a = rep(a, "const big = (n) =>", "const px = (n) => (n == null || !isFinite(n)) ? '—' : n >= 1 ? fmt(n, 2) : n >= 0.01 ? fmt(n, 4) : (+n).toPrecision(3);\nconst big = (n) =>");
a = rep(a, "$('bd-price').textContent = '$' + fmt(Bd.price, 6); $('bd-market').textContent = '$' + fmt(Bd.market, 6);", "$('bd-price').textContent = '$' + px(Bd.price); $('bd-market').textContent = '$' + px(Bd.market);");
a = rep(a, "$('bd-sold').textContent = '$' + fmt(Bd.soldUsd, 0) + ' · ' + big(Bd.soldMute) + ' MUTE';", "$('bd-sold').textContent = '$' + big(Bd.soldUsd);");
a = rep(a, "$('fg-price').textContent = '$' + fmt(Bd.freezer.price, 6) + ' (−' + fmt(Bd.freezer.discount * 100, 0) + '%)'; $('fg-locked').textContent = big(Bd.freezer.lockedMute) + ' MUTE · ' + Bd.freezer.n + ' in cryo';", "$('fg-price').textContent = '$' + px(Bd.freezer.price); $('fg-locked').textContent = big(Bd.freezer.lockedMute) + ' MUTE';");
a = rep(a, "'$' + fmt(L && F ? F.price : Bd.price, 6) + ' · $' + fmt(Bd.market, 6)", "'$' + px(L && F ? F.price : Bd.price) + ' · $' + px(Bd.market)");
a = rep(a, "@ $${fmt(b.px, 6)}", "@ $${px(b.px)}");
fs.writeFileSync(HF, h); fs.writeFileSync(AF, a); console.log('cleaned');
