// MUTE launch tweets. node tweets.js -> prints char counts (limit 245) and writes ../X-KIT.md
'use strict';
const fs = require('fs'); const path = require('path');
const BIO = "Dollars with the sound off. mUSD: a private dollar on Robinhood Chain. Mute it and the amount, sender and recipient never reach the ledger. $MUTE";
const T = [
  ['hype video', 'mute-hype-10s.mp4', `Every transfer you make is loud.

Who paid. Who got paid. How much. Forever.

MUTE is a dollar on Robinhood Chain with the sound off.

Mint mUSD. Mute it. Send it.

mutemoneyrh.xyz`],
  ['the ledger graphic', 'mute-ledger.png', `Same dollar. Two footprints.

Normal stablecoin transfer: sender, recipient, amount. Public forever.

Muted mUSD transfer: one nullifier, one commitment.
No amount. No sender. No recipient.

That's the product.`],
  ['demo video', 'mute-demo-20s.mp4', `20 seconds inside MUTE.

→ mint mUSD against USDG
→ mute it, your balance goes silent
→ send muted, or leave a Drop link
→ Blind Desk: stocks, fully muted
→ fees pay muted holders + erase $MUTE

mutemoneyrh.xyz`],
  ['features', 'mute-features.png', `Live in the MUTE console:

Drop · muted pay links
Mirror · read-only view keys
Blind Desk · muted stock positions
Silent Yield · 40% of fees to muted holders
Bonds −20% · Cryo −30%
Erase · fees buy $MUTE and delete it`],
  ['how it works', 'mute-howitworks.png', `Three moves. No names.

01 Mint: USDG in. Most is collateral, the rest buys $MUTE and erases it.
02 Mute: your mUSD becomes a note only you can read.
03 Send: the amount and both parties never reach the ledger.`],
  ['silent yield', 'mute-keyart.png', `Get paid to stay silent.

40% of every MUTE fee is split across muted mUSD balances the moment it's paid.

No staking. No lock. No claim button.
Funded by usage, so nothing is printed.

mutemoneyrh.xyz`],
  ['docs', 'mute-banner.png', `The MUTE docs are live.

How the peg holds, what muting writes on-chain, Drops, Mirror view keys, Blind Desk limits, every fee and where it goes.

Read before you mint:
mutemoneyrh.xyz/docs`],
];
let bad = 0;
const out = [`# MUTE · X kit\n\n**Handle:** @MuteMoneyRH · **Site:** https://mutemoneyrh.xyz · **Docs:** https://mutemoneyrh.xyz/docs · **Chain:** Robinhood Chain (4663)\n\n**Name:** MUTE\n**Bio** (${BIO.length}/160):\n\`\`\`\n${BIO}\n\`\`\`\n**PFP:** \`brand/mute-pfp.png\` · **Banner:** \`brand/mute-banner.png\`\n\n## Launch tweets (all ≤245 chars)\n`];
T.forEach(([name, asset, txt], i) => {
  const n = [...txt].length; if (n > 245) bad++; console.log(String(i + 1).padStart(2), name.padEnd(20), n);
  out.push(`**${i + 1} · ${name}** (\`brand/${asset}\`, ${n} chars)\n\`\`\`\n${txt}\n\`\`\`\n`);
});
if (BIO.length > 160) { console.log('BIO too long', BIO.length); bad++; }
if (bad) { console.log('OVER LIMIT'); process.exit(1); }
fs.writeFileSync(path.join(__dirname, '..', 'X-KIT.md'), out.join('\n')); console.log('wrote X-KIT.md');
