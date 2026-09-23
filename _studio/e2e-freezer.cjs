// THE FREEZER E2E: lock-bond at deeper discount, no early claim, yield paid at unlock from the Happy Hour pool. Run with FREEZER_LOCK_DAYS tiny.
const B = 'http://localhost:8220'; const U = '0x0000000000000000000000000000000000000311';
const post = (u, b) => fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: U, ...b }) }).then((r) => r.json());
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  · ' + x : '')); if (!c) fails++; };
const f = (n) => Math.round(n * 100) / 100;
(async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const m0 = await (await fetch(B + '/api/metrics')).json(); const F = m0.bonds.freezer;
  ok('metrics.bonds.freezer present', F && F.discount === 0.3 && F.apy === 0.8, JSON.stringify(F));
  ok('freezer price = market × 0.7', Math.abs(F.price - m0.bonds.market * 0.7) < 1e-12);
  await post('/api/dev/faucet', { amount: 1000 });
  const b = await post('/api/bond', { amount: 200, lock: true });
  ok('freezer 200 USDG → MUTE at −30%', b.ok && b.lock && Math.abs(b.muteOut - 200 / (b.market * 0.7)) < 1e-6, `${Math.round(b.muteOut)} MUTE @ ${b.price} apy ${b.apy}`);
  ok('locked, nothing claimable', b.bonds.locked > 0 && b.bonds.claimable === 0, `locked ${Math.round(b.bonds.locked)}`);
  const e = await post('/api/bond/claim', {}); ok('early claim refused', /nothing/.test(e.error || ''), e.error);
  const m1 = await (await fetch(B + '/api/metrics')).json(); ok('freezer stats + reserve grew', m1.bonds.freezer.n >= 1 && m1.bonds.freezer.lockedMute > 0 && f(m1.collateralUsd - m0.collateralUsd) === 200);
  await new Promise((r) => setTimeout(r, 3500));
  const paid0 = m1.happy.paidMute;
  const c = await post('/api/bond/claim', {}); const exp = b.muteOut * 0.8 * (+process.env.LOCK_MS || 3000) / 31536000000;
  ok('unlock pays principal + frozen yield', c.ok && c.frozenMute > 0 && Math.abs(c.claimedMute - (b.muteOut + c.frozenMute)) < 1e-6, `principal ${Math.round(b.muteOut)} yield ${c.frozenMute.toExponential(3)} (expected ~${exp.toExponential(3)})`);
  const m2 = await (await fetch(B + '/api/metrics')).json();
  ok('yield drawn from the Happy Hour pool, not printed', m2.happy.paidMute > paid0 && Math.abs(m2.happy.paidMute - paid0 - c.frozenMute) < 1e-9);
  ok('freezer lockedMute released', m2.bonds.freezer.lockedMute < m1.bonds.freezer.lockedMute);
  const c2 = await post('/api/bond/claim', {}); ok('no double yield', /nothing/.test(c2.error || ''), c2.error);
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
})();
