// Dark Pool E2E (dev server, DEV_FAUCET=1). Uses BTC (24/7 tape) so it runs any hour.
const B = 'http://localhost:8220'; const U = '0x0000000000000000000000000000000000000410';
const post = (u, b) => fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: U, ...b }) }).then((r) => r.json());
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  · ' + x : '')); if (!c) fails++; };
const f = (n) => Math.round(n * 100) / 100;
(async () => {
  for (let i = 0; i < 20; i++) { const m = await (await fetch(B + '/api/metrics')).json(); if (m.dark && m.dark.markets.some((x) => x.px)) break; await new Promise((r) => setTimeout(r, 1000)); }
  const m0 = await (await fetch(B + '/api/metrics')).json();
  const live = m0.dark.markets.filter((x) => x.fresh).map((x) => x.sym);
  ok('tape polled, some market live', m0.dark.markets.length === 10 && live.length > 0, 'live: ' + live.join(',') + ' · HOOD $' + (m0.dark.markets.find((x) => x.sym === 'HOOD') || {}).px);
  const sym = live.includes('BTC') ? 'BTC' : live[0];
  await post('/api/dev/faucet', { amount: 2000 }); await post('/api/mint', { amount: 1500 }); const sh = await post('/api/shield', { amount: 1400 });
  const bad = await post('/api/dark/open', { sym: 'XXX', side: 'long', amount: 50 }); ok('unknown market refused', bad.error === 'unknown market');
  const lo = await post('/api/dark/open', { sym, side: 'long', amount: 5 }); ok('min 10 enforced', /minimum/.test(lo.error || ''));
  const big = await post('/api/dark/open', { sym, side: 'long', amount: 5000 }); ok('per-position cap enforced', /max 1000/.test(big.error || ''), big.error);
  const m1 = await (await fetch(B + '/api/metrics')).json(); const p0 = m1.shred.svcUsd;
  const op = await post('/api/dark/open', { sym, side: 'long', amount: 100 });
  ok('opened long from shielded balance', op.ok && op.opened.sym === sym && f(op.opened.notional) === 99.7 && op.opened.entry > 0, `${sym} @ ${op.opened.entry}`);
  ok('shield debited 100', f(sh.priv - op.priv) === 100);
  ok('position in account view with live pnl', op.dark.length >= 1 && typeof op.dark[0].pnl === 'number', 'pnl ' + f(op.dark[0].pnl));
  const m2 = await (await fetch(B + '/api/metrics')).json();
  ok('fee 0.3 → shred', f(m2.shred.svcUsd - p0) === 0.3 || m2.shred.epochs > m1.shred.epochs, 'Δ ' + f(m2.shred.svcUsd - p0));
  ok('metrics.dark counts open, notional not exposed', m2.dark.open >= 1 && m2.dark.oi === undefined, JSON.stringify({ open: m2.dark.open, volume: m2.dark.volume }));
  ok('ledger feed shows a private tx (indistinguishable)', m2.feed[0] && m2.feed[0].type === 'private');
  const sh2 = await post('/api/dark/open', { sym, side: 'short', amount: 50 }); ok('short opens too', sh2.ok && sh2.opened.side === 'short');
  const cl = await post('/api/dark/close', { id: op.opened.id }); ok('close settles into shield (notional ± pnl − fee)', cl.ok && Math.abs(cl.closed.back - (99.7 + cl.closed.pnl - 99.7 * 0.003)) < 1e-6, `pnl ${f(cl.closed.pnl)} back ${f(cl.closed.back)}`);
  const nope = await post('/api/dark/close', { id: op.opened.id }); ok('cannot close twice', nope.error === 'no such position');
  const v = await post('/api/view', { key: (await post('/api/carbon', {})).viewKey }); ok('seal shows dark-open / dark-close in history', v.hist.some((x) => x.type === 'dark-open') && v.hist.some((x) => x.type === 'dark-close'));
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
})();
