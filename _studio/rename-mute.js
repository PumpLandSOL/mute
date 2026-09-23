// one-shot: HUSH -> MUTE identifiers, vocabulary, defaults (already applied; don't re-run)
const fs = require('fs');
const files = ['server/index.js', 'client/src/app.js', 'client/index.html', 'client/view.html', '_studio/dev.js', '_studio/shots.cjs', ...fs.readdirSync('_studio').filter((f) => /^e2e-.*\.cjs$/.test(f)).map((f) => '_studio/' + f)];
const R = [[/HUSH_MINT/g, 'MUTE_MINT'], [/hushLive/g, 'muteLive'], [/HUSH_LIVE/g, 'MUTE_LIVE'], [/hushPrice/g, 'mutePrice'], [/HUSH/g, 'MUTE'], [/Hush/g, 'Mute'], [/hush/g, 'mute'], [/hUSD/g, 'mUSD'], [/husd/g, 'musd'],
  [/Uncloak/g, 'Unmute'], [/uncloak/g, 'unmute'], [/Cloaked/g, 'Muted'], [/cloaked/g, 'muted'], [/Cloak/g, 'Mute'], [/cloak/g, 'mute'],
  [/doesn't echo/g, 'makes no sound'], [/Money that<br>doesn't <span class="iri">echo\.<\/span>/g, 'Dollars with<br>the <span class="iri">sound off.</span>'], [/No echo/g, 'No sound'], [/no echo/g, 'no sound']];
for (const f of files) { let s = fs.readFileSync(f, 'utf8'); for (const [a, b] of R) s = s.replace(a, b); fs.writeFileSync(f, s); }
let s = fs.readFileSync('server/index.js', 'utf8');
s = s.replace(/const MUTE_MINT = .*\n/, "const MUTE_MINT = process.env.MUTE_MINT || '';   // $MUTE on Robinhood Chain — set at launch\n").replace('|| 8212', '|| 8220');
fs.writeFileSync('server/index.js', s);
for (const f of files.filter((x) => /_studio/.test(x))) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/localhost:8212/g, 'localhost:8220').replace(/\|\| 8212/g, '|| 8220').replace(/localhost:8214/g, 'localhost:8222'));
