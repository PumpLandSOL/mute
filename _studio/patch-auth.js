// one-shot: signed wallet sessions on every MUTE action (run once)
'use strict';
const fs = require('fs'); const path = require('path');
const F = path.join(__dirname, '..', 'server', 'index.js'); let s = fs.readFileSync(F, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('anchor missing: ' + a.slice(0, 60)); s = s.replace(a, b); };
if (s.includes('requireSess')) throw new Error('already patched');

rep("const isWallet = (s) => /^0x[a-fA-F0-9]{40}$/.test(s);", `const isWallet = (s) => /^0x[a-fA-F0-9]{40}$/.test(s);
// ---------- signed vault sessions ----------
// Every action that moves value must carry a personal_sign session from the wallet that owns the vault.
const { recoverPersonal } = require('./evmsig');
const SESSIONS = new Map();
const sessionMsg = (w, exp) => ['MUTE vault session', 'Wallet: ' + w, 'Expires: ' + exp, 'No gas. No transaction.'].join('\\n');
function sessOk(w, auth) { try { requireSess(w, auth); return true; } catch (e) { return false; } }
function requireSess(w, auth) {
  if (!auth || !auth.sig || !auth.exp) throw 'sign in with your wallet first';
  const exp = +auth.exp; if (!(exp > Date.now())) throw 'session expired, sign in again'; if (exp > Date.now() + 8 * 864e5) throw 'bad session';
  const key = w + ':' + exp + ':' + auth.sig; if (SESSIONS.get(key)) return true;
  let who; try { who = recoverPersonal(sessionMsg(w, exp), auth.sig); } catch (e) { throw 'bad signature'; }
  if (who !== w) throw 'signature is not from this wallet';
  if (SESSIONS.size > 5000) SESSIONS.clear(); SESSIONS.set(key, 1); return true;
}`);

rep("  if (u === '/api/metrics') return json(res, 200, metrics());", `  if (u === '/api/metrics') return json(res, 200, metrics());
  if (u === '/api/session') { const w = (new URL(req.url, 'http://x').searchParams.get('wallet') || '').toLowerCase(); if (!isWallet(w)) return json(res, 200, { error: 'bad wallet' }); const exp = Date.now() + 7 * 864e5; return json(res, 200, { exp, message: sessionMsg(w, exp) }); }`);

// account: private fields only for the signed owner
rep("save(); } return json(res, 200, account(d.wallet)); }", "save(); } const acc = account(d.wallet); if (!sessOk(d.wallet.toLowerCase(), d.auth)) { acc.priv = null; acc.quietEarned = null; acc.dark = []; acc.locked = true; } return json(res, 200, acc); }");

rep("    if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'connect a wallet first' });\n    const w = W(d.wallet);",
`    if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'connect a wallet first' });
    if (!['/api/admin/queue', '/api/admin/paid', '/api/dev/faucet', '/api/deposit'].includes(u)) { try { requireSess(d.wallet.toLowerCase(), d.auth); } catch (e) { return json(res, 200, { error: String(e), auth: true }); } }
    const w = W(d.wallet);`);
fs.writeFileSync(F, s); console.log('patched');
