// capture real UI states from a local dev server for the demo video. usage: node shots.cjs (server on :8214, DEV_FAUCET)
'use strict';
const { open, sleep } = require('./cdp.cjs'); const path = require('path'); const fs = require('fs');
const B = 'http://localhost:8222', Wt = '0x00000000000000000000000000000000000000d1';
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  await fetch(B + '/api/dev/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: Wt, amount: 5000 }) });
  const c = await open(B + '/?w=' + Wt, 1440, 860, 9511); await sleep(2500);
  const S = async (n) => { await sleep(900); await c.shot(path.join(OUT, n + '.png')); console.log(n); };
  const js = (s) => c.ev(`(async()=>{const $=(i)=>document.getElementById(i);const tab=(t)=>document.querySelector('.tabs button[data-tab='+t+']').click();const set=(v,i)=>{const e=$(i||'in');e.value=v;e.dispatchEvent(new Event('input'));};${s}})()`);
  await S('01-home');
  await js(`tab('mint');set(2500);`); await S('02-mint-typed');
  await js(`$('act').click();`); await sleep(600); await js(`$('toast').className='toast';`); await S('03-minted');
  await js(`tab('shield');set(2000);`); await S('04-mute-typed');
  await js(`$('act').click();`); await sleep(600); await js(`$('toast').className='toast';`); await S('05-muted');
  await js(`tab('send');set(250);$('memo').value='for the thing';`); await S('06-drop-typed');
  await js(`$('act2').click();`); await sleep(700); await js(`$('toast').className='toast';`); await S('07-drop-link');
  await js(`document.querySelector('#nav [data-ch=signal]').click();`); await S('08-signal');
  await js(`document.querySelector('#nav [data-ch=desk]').click();tab('dark');`); await sleep(400); await js(`set(500);`); await S('09-desk');
  await js(`document.querySelector('#nav [data-ch=erase]').click();`); await S('10-erase');
  await js(`document.querySelector('#nav [data-ch=bonds]').click();tab('bond');`); await sleep(300); await js(`set(1000);`); await S('11-cryo');
  await js(`document.querySelector('#nav [data-ch=home]').click();$('b-priv-eye').click();`); await S('12-reveal');
  c.close();
})().catch((e) => { console.error(e); process.exit(1); });
