// one-shot: EIP-6963 multi-wallet connect, verified Robinhood Chain, signed sessions, real error messages (run once)
'use strict';
const fs = require('fs'); const path = require('path');
const F = path.join(__dirname, '..', 'client', 'src', 'app.js'); let s = fs.readFileSync(F, 'utf8');
const H = path.join(__dirname, '..', 'client', 'index.html'); let h = fs.readFileSync(H, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('anchor missing: ' + a.slice(0, 70)); s = s.replace(a, b); };
if (s.includes('eip6963')) throw new Error('already patched');

// api(): every POST carries the signed session; an auth error triggers one sign-in and a retry
rep("const api = (u, b) => fetch(u, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : undefined).then((r) => r.json());",
`const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
async function api(u, b) {
  if (!b) return fetch(u).then((r) => r.json());
  const withAuth = () => (b.wallet && typeof wallet !== 'undefined' && b.wallet === wallet ? Object.assign({}, b, { auth: getAuth() }) : b);
  let r = await post(u, withAuth());
  if (r && r.auth && u !== '/api/account') { const ok = await signIn(); if (ok) r = await post(u, withAuth()); }
  return r;
}`);

const oldStart = s.indexOf("const CHAIN_HEX = '0x1237';"); const oldEnd = s.indexOf("$('wmodal').onclick");
if (oldStart < 0 || oldEnd < 0) throw new Error('connect block not found');
s = s.slice(0, oldStart) + `const CHAIN_HEX = '0x1237';
const errMsg = (e) => { const m = (e && (e.data && e.data.message || e.message)) || String(e || ''); if (e && e.code === 4001 || /reject|denied|cancel/i.test(m)) return 'request rejected in wallet'; return m.replace(/^Error:\\s*/, '').slice(0, 140) || 'wallet error'; };
// EIP-6963: list every injected wallet instead of trusting whichever one grabbed window.ethereum
const WALLETS = [];
addEventListener('eip6963:announceProvider', (e) => { const d = e.detail; if (d && d.provider && !WALLETS.some((x) => x.info.uuid === d.info.uuid)) WALLETS.push(d); });
dispatchEvent(new Event('eip6963:requestProvider'));
let ETH = null;
const evm = () => { if (ETH) return ETH; const rd = localStorage.getItem('mute_rdns'); const m = rd && WALLETS.find((x) => x.info.rdns === rd); return m ? (ETH = m.provider) : (window.ethereum || null); };
async function ensureChain(eth) {
  const cur = async () => String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
  if (await cur() === CHAIN_HEX) return;
  try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] }); }
  catch (e) {
    if (e && (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902) || /unrecognized|not added|unknown chain/i.test(e.message || ''))) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: ['https://explorer.mainnet.chain.robinhood.com'] }] });
    } else throw e;
  }
  if (await cur() !== CHAIN_HEX) throw new Error('switch your wallet to Robinhood Chain (4663). This wallet may not support it: use MetaMask or Rabby');
}
// signed session: one free signature proves you own the vault. Nothing moves without it.
const AKEY = () => 'mute_auth_' + wallet;
function getAuth() { try { const a = JSON.parse(localStorage.getItem(AKEY()) || 'null'); return a && a.exp > Date.now() + 6e4 ? a : null; } catch (e) { return null; } }
async function signIn() {
  if (!wallet) return false; if (getAuth()) return true;
  const eth = evm(); if (!eth) { toast('connect a wallet to sign in (a pasted address is view-only)', true); return false; }
  try {
    const m = await (await fetch('/api/session?wallet=' + wallet)).json(); if (m.error) throw new Error(m.error);
    toast('sign the message in your wallet to unlock your vault (free, no transaction)');
    const sig = await eth.request({ method: 'personal_sign', params: [m.message, wallet] });
    localStorage.setItem(AKEY(), JSON.stringify({ sig, exp: m.exp })); return true;
  } catch (e) { toast(errMsg(e), true); return false; }
}
async function useWallet(eth, rdns) {
  ETH = eth; if (rdns) localStorage.setItem('mute_rdns', rdns); $('wmodal').classList.remove('on');
  try {
    const acc = await eth.request({ method: 'eth_requestAccounts' });
    if (!acc || !acc.length) throw new Error('no account returned by the wallet');
    await ensureChain(eth);
    wallet = acc[0].toLowerCase(); localStorage.setItem('mute_w', wallet); setConnected();
    if (eth.on && !eth._muteBound) { eth._muteBound = 1; eth.on('accountsChanged', (a) => { if (a && a.length) { wallet = a[0].toLowerCase(); localStorage.setItem('mute_w', wallet); setConnected(); loadAccount(); } }); eth.on('chainChanged', (c) => { if (String(c).toLowerCase() !== CHAIN_HEX) toast('wallet left Robinhood Chain, switch back to use MUTE', true); }); }
    await signIn(); toast('wallet connected · Robinhood Chain'); await loadAccount();
  } catch (e) { toast(errMsg(e), true); }
}
async function connectPhantom() {                                // name kept for the call sites
  dispatchEvent(new Event('eip6963:requestProvider')); await new Promise((r) => setTimeout(r, 120));
  const list = WALLETS.filter((x) => x.provider);
  if (list.length > 1) {                                          // several wallets installed: let the user pick
    $('wlist').innerHTML = list.map((x, i) => '<button class="btn wide wpick" data-i="' + i + '" style="display:flex;align-items:center;gap:12px;margin-bottom:8px;justify-content:flex-start">' + (x.info.icon ? '<img src="' + x.info.icon + '" width="22" height="22" alt="">' : '') + x.info.name.replace(/[<>]/g, '') + '</button>').join('');
    $('wlist').querySelectorAll('.wpick').forEach((b) => b.onclick = () => { const x = list[+b.dataset.i]; useWallet(x.provider, x.info.rdns); });
    $('wmsg').textContent = 'Choose a wallet. MetaMask and Rabby support Robinhood Chain.'; $('wmodal').classList.add('on'); return;
  }
  const eth = list.length ? list[0].provider : window.ethereum;
  if (!eth) { $('wlist').innerHTML = ''; $('wmsg').textContent = 'No EVM wallet detected. Install MetaMask or Rabby to connect, or paste an address to view a vault (read-only).'; $('wmodal').classList.add('on'); return; }
  return useWallet(eth, list.length ? list[0].info.rdns : '');
}
$('connect').onclick = async () => {
  if (wallet) {                                                   // already connected -> disconnect
    localStorage.removeItem(AKEY()); wallet = ''; localStorage.removeItem('mute_w'); A = null; setConnected(); renderAccount(); toast('disconnected'); return;
  }
  await connectPhantom();
};
` + s.slice(oldEnd);

// deposit: verified chain + real error text
rep("    await ensureChain(eth);\n    const units", "    await ensureChain(eth);\n    const units");
rep("  } catch (e) { toast('transaction cancelled', true); }", "  } catch (e) { toast(errMsg(e), true); }");
// pasted address = read-only
rep("setConnected(); $('wmodal').classList.remove('on'); toast('vault opened');", "setConnected(); $('wmodal').classList.remove('on'); toast('vault opened read-only. Connect a wallet to act');");

h = h.replace(`<p>No EVM wallet detected. Paste a Robinhood Chain address to open your vault, or install MetaMask or Rabby to connect directly.</p>`,
  `<p id="wmsg">No EVM wallet detected. Install MetaMask or Rabby to connect, or paste an address to view a vault (read-only).</p>\n  <div id="wlist" style="margin:14px 0 10px"></div>`);
if (!h.includes('id="wlist"')) throw new Error('modal anchor missing');
fs.writeFileSync(F, s); fs.writeFileSync(H, h); console.log('patched');
