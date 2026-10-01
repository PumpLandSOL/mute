// Real-UI wallet E2E: a mock EIP-6963 wallet holding a real secp256k1 key connects, signs the session,
// and drives every vault feature through the actual buttons. Also proves unsigned / forged requests are refused.
// usage: node _studio/e2e-wallet.cjs   (spawns its own dev server on :8223 with a fresh DATA_PATH)
'use strict';
const http = require('http'); const path = require('path'); const os = require('os'); const { spawn } = require('child_process');
const { open, sleep } = require('./cdp.cjs'); const S = require('../server/evmsig');
const PORT = 8223, B = 'http://localhost:' + PORT, SIGNER = 8233;
const KEY = 0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318n;   // throwaway test key
const ME = S.pubToAddress(S.mul(S.G, KEY)); const OTHER = '0x00000000000000000000000000000000000000e9';
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  · ' + x : '')); };
const post = (u, b) => fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());

// tiny signer the mock wallet calls (stands in for the wallet's key store)
const signer = http.createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); if (req.method === 'OPTIONS') return res.end(); const { msg } = JSON.parse(b || '{}'); res.end(JSON.stringify({ sig: S.signPersonal(msg, KEY) })); }); }).listen(SIGNER);

const MOCK = `(() => {
  const ME = '${ME}'; let chain = '0x1';
  const provider = { isMetaMask: true, _l: {}, on(e, f) { (this._l[e] = this._l[e] || []).push(f); },
    async request({ method, params }) {
      window.__calls = (window.__calls || []).concat(method);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ME];
      if (method === 'eth_chainId') return chain;
      if (method === 'wallet_switchEthereumChain') { if (window.__noRH) { const e = new Error('Unrecognized chain ID'); e.code = 4902; throw e; } chain = params[0].chainId; return null; }
      if (method === 'wallet_addEthereumChain') { window.__noRH = false; chain = params[0].chainId; return null; }
      if (method === 'personal_sign') { const r = await fetch('http://localhost:${SIGNER}', { method: 'POST', body: JSON.stringify({ msg: params[0] }) }).then((r) => r.json()); return r.sig; }
      if (method === 'eth_sendTransaction') { window.__tx = params[0]; return '0x' + 'ab'.repeat(32); }
      throw new Error('unsupported ' + method);
    } };
  window.__noRH = true;   // first switch fails with 4902 so the add-chain path is exercised
  const info = { uuid: 'mock-1', name: 'Mock Wallet', icon: '', rdns: 'io.mock.wallet' };
  const other = { uuid: 'mock-2', name: 'Other Wallet', icon: '', rdns: 'io.other.wallet' };
  const otherProv = { async request() { throw new Error('wrong wallet used'); }, on() {} };
  const announce = () => { dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) })); dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: other, provider: otherProv }) })); };
  addEventListener('eip6963:requestProvider', announce); announce();
  window.ethereum = otherProv;   // a hijacking wallet owns window.ethereum: the picker must avoid it
})();`;

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'dev.js')], { env: { ...process.env, PORT: String(PORT), DATA_PATH: path.join(os.tmpdir(), 'mute-e2e-wallet-' + Date.now() + '.json') }, stdio: 'ignore' });
  let c;
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/config')).ok) break; } catch {} await sleep(200); }
    // --- API-level security ---
    await post('/api/dev/faucet', { wallet: ME, amount: 5000 });
    const un = await post('/api/mint', { wallet: ME, amount: 10 }); ok('unsigned mint refused', !!un.error && un.auth === true, un.error);
    const sess = await (await fetch(B + '/api/session?wallet=' + ME.toLowerCase())).json();
    const forged = await post('/api/send', { wallet: ME, to: OTHER, amount: 1, auth: { exp: sess.exp, sig: S.signPersonal(sess.message, 12345n) } }); ok('signature from another key refused', forged.error === 'signature is not from this wallet', forged.error);
    const peek = await post('/api/account', { wallet: ME }); ok('unsigned account hides private balance', peek.priv === null && peek.locked === true);

    // --- real UI with the mock wallet ---
    c = await open('about:blank', 1440, 900, 9633);
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
    await c.send('Page.navigate', { url: B + '/' }); await sleep(3500);
    const js = (s) => c.ev(`(async()=>{const $=(i)=>document.getElementById(i);const sl=(ms)=>new Promise(r=>setTimeout(r,ms));const tab=async(t)=>{document.querySelector('.tabs button[data-tab='+t+']').click();await sl(150);};const set=(v,i)=>{const e=$(i||'in');e.value=v;e.dispatchEvent(new Event('input'));};${s}})()`);
    await js(`$('connect').click();`); await sleep(500);
    const picker = await js(`return [...document.querySelectorAll('#wlist .wpick')].map(b=>b.textContent.trim())`);
    ok('two wallets → picker shown', picker && picker.length === 2, JSON.stringify(picker));
    await js(`[...document.querySelectorAll('#wlist .wpick')].find(b=>/Mock/.test(b.textContent)).click();`); await sleep(2500);
    const st = await js(`return {btn:$('connect').textContent, calls:window.__calls, auth:!!localStorage.getItem('mute_auth_${ME.toLowerCase()}'), toast:$('toast').textContent}`);
    ok('connected via picked wallet', /^0x/.test(st.btn) && st.btn.toLowerCase().startsWith(ME.slice(0, 4).toLowerCase()), st.btn + ' · ' + st.toast);
    ok('unknown chain was added (4902 path)', st.calls.includes('wallet_addEthereumChain'));
    ok('session signed in wallet', st.auth && st.calls.includes('personal_sign'));
    const acc = async () => post('/api/account', { wallet: ME.toLowerCase(), auth: JSON.parse(await js(`return localStorage.getItem('mute_auth_${ME.toLowerCase()}')`)) });
    const act = async (t, setup, btn = 'act') => { await js(`await tab('${t}');${setup};$('${btn}').click();await sl(1500);`); const toast = await js(`return $('toast').textContent+'|'+$('toast').className`); return toast; };
    let t;
    t = await act('mint', `set(1000)`); let a = await acc(); ok('mint via UI', a.musd === 1000, t);
    t = await act('shield', `set(600)`); a = await acc(); ok('mute via UI', a.priv > 595 && a.priv < 600.01, t + ' priv=' + a.priv);
    t = await act('send', `$('to').value='${OTHER}';set(50)`); a = await acc(); ok('muted send via UI', a.priv < 550 && !/err/.test(t), t);
    t = await act('send', `set(25);$('memo').value='hi'`, 'act2'); const link = await js(`return (document.querySelector('.linkbox code')||{}).textContent||''`); ok('drop link via UI', /#claim=/.test(link), t);
    t = await act('bond', `set(100)`); a = await acc(); const bdis = await js(`return $('act').disabled`); ok('bonds cannot sell $MUTE the treasury lacks', a.bonds.list.length === 0 && (bdis || /bonds open once|capacity is set/.test(t)), bdis ? 'button disabled' : t);
    t = await act('happy', `set(200)`); a = await acc(); ok('Window stake via UI', a.happy.staked === 200, t);
    t = await act('dark', `set(100)`); a = await acc(); ok('Blind Desk open via UI (needs live tape)', a.dark.length === 1 || /tape|closed|market/i.test(t), t);
    t = await act('redeem', `set(100)`); a = await acc(); ok('redeem via UI', a.musd < 700 && !/err/.test(t), t);
    t = await act('redeem', `set(50)`, 'act3'); a = await acc(); ok('withdraw queued via UI', a.queue.length === 1, t);
    t = await act('deposit', `set(60)`); const tx = await js(`return window.__tx`); ok('deposit sends USDG transfer to treasury on RH', tx && tx.data.startsWith('0xa9059cbb') && tx.data.includes('580aa9df627a396f32ae649ec427a4cb430a5ed2'), t);
    await js(`$('b-priv-eye') && $('b-priv-eye').click();`); await sleep(400);
    const shown = await js(`return document.body.innerText.includes('${(await acc()).priv.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}')`); ok('reveal shows the signed private balance', shown);
    await js(`document.querySelector('#nav [data-ch=proof]').click();`); await sleep(1500); await js(`$('sc-verify').click();`); await sleep(2500);
    const sc = await js(`return $('sc-out').innerText`); ok('Sound Check verifies in the browser', /VERIFIED/.test(sc) && /adds up/.test(sc), sc.trim().slice(-60));
    const errs = await js(`return window.__errs||[]`); ok('no page errors', !errs.length, JSON.stringify(errs));
  } catch (e) { console.error(e); fail++; } finally { if (c) c.close(); srv.kill(); signer.close(); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
