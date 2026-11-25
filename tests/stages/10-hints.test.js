/*
 * Testing Portal – tests of stage 10 (warnings and hints), M2.
 * Every check: a file that breaks it (id, part, severity) and the clean files;
 * every setting: default, a changed value and null (off).
 * Holidays, cut-off times and accepted versions are in the country file, which
 * the harness reads from disk: withCountry() lays values over it for one run.
 */
'use strict';
module.exports = async t => {
  const { ok, head, gen, rules, TP } = t;
  const at = (d, h = 10, m = 0) => new Date(2026, 10, d, h, m, 0); // November 2026, local time
  const now = at(18); // Wednesday 18 November 2026, 10:00
  const pin = (xml, date = '2026-11-19') => xml.replace(/(<ReqdExctnDt>(?:<Dt>)?)\d{4}-\d{2}-\d{2}/g, `$1${date}`);
  const file = (v, o = {}, date) => pin(gen.generate({ version: v, transactions: 20, blocks: 2, ...(v === '09' ? { uetr: true, lei: true } : {}), ...o }), date);
  const key = f => (f.part ? `${f.rule}-${f.part}` : f.rule);
  const of = (r, id) => r.findings.filter(f => key(f) === id);
  const stage10 = r => r.findings.filter(f => f.stage === 10);
  const ids = list => [...new Set(list.map(key))].sort().join(',');
  async function withCountry(patch, fn) {
    const names = ['tpNonBusinessDay', 'tpCutOff', 'tpCountry'], orig = names.map(n => globalThis[n]);
    names.forEach((n, i) => { globalThis[n] = (...a) => { Object.assign(TP.context.countryConfig, patch); return orig[i](...a); }; });
    try { return await fn(); } finally { names.forEach((n, i) => { globalThis[n] = orig[i]; }); }
  }
  const run = (xml, v, o = {}) => { const go = () => rules(xml, v, o.c || 'AT', o.over, o.now || now); return o.country ? withCountry(o.country, go) : go(); };
  const expect = async (label, xml, v, id, { n = 1, sev, block, msg, ...o } = {}) => {
    const r = await run(xml, v, o);
    const f = of(r, id);
    ok(f.length === n && f.every(x => (!sev || x.severity === sev) && (block === undefined || x.block === block) && (!msg || msg.test(x.message)) && x.line > 0),
      `${id} ${label}`, `got ${f.length}: ${JSON.stringify(f.slice(0, 3).map(x => [x.severity, x.block, x.tx, x.message]))} / stage 10: ${ids(stage10(r))}`);
    return r;
  };
  const none = async (label, xml, v, id, o = {}) => { const r = await run(xml, v, o); ok(of(r, id).length === 0, `${id} not reported: ${label}`, JSON.stringify(of(r, id).slice(0, 2).map(x => x.message))); };

  head('stage 10: warnings and hints (M2)');

  // clean files of every payment type and country, .03 and .09
  const hints = {};
  const bad = [];
  for (const c of ['AT', 'CZ', 'RO', 'UA', 'SK', 'HU', 'RS', 'HR', 'BA']) {
    const sepa = t.contextFor(c).countryConfig.sepa;
    for (const type of gen.TYPES) {
      if (!sepa && type.startsWith('SEPA')) continue;
      for (const v of ['03', '09']) {
        const xml = pin(gen.generate({ version: v, transactions: 6, blocks: 2, country: c, type, uetr: v === '09', lei: v === '09' }), type === 'SEPA_INST' ? '2026-11-18' : '2026-11-19');
        for (const x of stage10(await run(xml, v, { c }))) if (x.severity === 'I') hints[key(x) + ' .' + v] = 1; else bad.push(`${c} ${type} .${v}: ${key(x)} ${x.message}`);
      }
    }
  }
  ok(bad.length === 0, 'clean files of every payment type and country, .03 and .09: no stage-10 error or warning', bad.slice(0, 5).join(' | '));
  ok(Object.keys(hints).join(',') === '10.8 .03', 'and only the information 10.8, on .03 files', Object.keys(hints).join(','));

  // 10.1 execution date not a business day
  for (const v of ['03', '09']) {
    await expect(`.${v}: Saturday 21 November`, file(v, {}, '2026-11-21'), v, '10.1', { n: 2, sev: 'W', msg: /2026-11-21 is a Saturday/ });
    await expect(`.${v}: Friday 25 December, EUR: a TARGET closing day`, file(v, {}, '2026-12-25'), v, '10.1', { n: 2, sev: 'W', msg: /TARGET closing day \(Christmas Day\)/ });
    await none(`.${v}: Friday 25 December, CZK domestic (TARGET only for EUR)`, file(v, { country: 'CZ', type: 'DOMESTIC' }, '2026-12-25'), v, '10.1', { c: 'CZ' });
    await none(`.${v}: SEPA Instant on Saturday 21 November`, file(v, { type: 'SEPA_INST' }, '2026-11-21'), v, '10.1', { now: at(21) });
    await none(`.${v}: a past Sunday (4.10 reports the date)`, file(v, {}, '2026-11-15'), v, '10.1');
    await expect(`.${v}: country holiday 19 November (country file)`, file(v, { country: 'CZ', type: 'DOMESTIC' }), v, '10.1', { n: 2, c: 'CZ', country: { holidays: [{ date: '2026-11-19', name: 'Test day' }] }, msg: /holiday in CZ \(Test day\)/ });
    await expect(`.${v}: a yearly country holiday "11-19"`, file(v, { country: 'CZ', type: 'DOMESTIC' }), v, '10.1', { n: 2, c: 'CZ', country: { holidays: ['11-19'] } });
  }
  await expect('.09: ReqdExctnDt/DtTm on a Sunday', file('09').replace(/<ReqdExctnDt><Dt>2026-11-19<\/Dt>/, '<ReqdExctnDt><DtTm>2026-11-22T09:00:00</DtTm>'), '09', '10.1', { n: 1, block: 1, msg: /Sunday/ });

  // 10.2 cut-off time (country file "cutOff")
  for (const v of ['03', '09']) {
    const today = file(v, {}, '2026-11-18');
    await none(`.${v}: cutOff null (default)`, today, v, '10.2', { now: at(18, 23, 30) });
    await expect(`.${v}: cutOff "14:00", today at 15:10`, today, v, '10.2', { n: 2, sev: 'I', now: at(18, 15, 10), country: { cutOff: '14:00' }, msg: /now 15:10, after the cut-off time of 14:00/ });
    await none(`.${v}: cutOff "14:00", today at 13:59`, today, v, '10.2', { now: at(18, 13, 59), country: { cutOff: '14:00' } });
    await none(`.${v}: cutOff "14:00", execution tomorrow`, file(v), v, '10.2', { now: at(18, 15, 10), country: { cutOff: '14:00' } });
    await none(`.${v}: cutOff per type, SEPA 16:00, at 15:10`, today, v, '10.2', { now: at(18, 15, 10), country: { cutOff: { SEPA: '16:00', default: '12:00' } } });
    await expect(`.${v}: cutOff per type, default 12:00, CZK domestic at 15:10`, file(v, { country: 'CZ', type: 'DOMESTIC' }, '2026-11-18'), v, '10.2', { n: 2, c: 'CZ', now: at(18, 15, 10), country: { cutOff: { SEPA: '16:00', default: '12:00' } } });
    await none(`.${v}: SEPA Instant with cutOff "14:00"`, file(v, { type: 'SEPA_INST' }, '2026-11-18'), v, '10.2', { now: at(18, 15, 10), country: { cutOff: '14:00' } });
  }

  // 10.3 text CMIplus would shorten (hints.truncateLength)
  for (const v of ['03', '09']) {
    const base = file(v);
    await none(`.${v}: hints.truncateLength {} (default)`, base, v, '10.3');
    await expect(`.${v}: Cdtr/Nm limited to 10`, base, v, '10.3', { n: 20, sev: 'W', over: { hints: { truncateLength: { 'Cdtr/Nm': 10 } } }, msg: /Cdtr\/Nm has \d+ characters, only the first 10 are kept/ });
    await expect(`.${v}: InitgPty/Nm limited to 8 (group header)`, base, v, '10.3', { n: 1, over: { hints: { truncateLength: { 'InitgPty/Nm': 8 } } }, msg: /Group header.*"Beispiel"/ });
    await expect(`.${v}: Dbtr/Nm limited to 8 (each block)`, base, v, '10.3', { n: 2, over: { hints: { truncateLength: { 'Dbtr/Nm': 8 } } }, msg: /Payment block PMT-0\d/ });
    await none(`.${v}: Cdtr/Nm limited to 70`, base, v, '10.3', { over: { hints: { truncateLength: { 'Cdtr/Nm': 70 } } } });
    await none(`.${v}: hints.truncateLength null`, base, v, '10.3', { over: { hints: { truncateLength: null } } });
  }

  // 10.6 recommended data
  for (const v of ['03', '09']) {
    const base = file(v);
    const cz = file(v, { country: 'CZ', type: 'DOMESTIC' });
    const noAdr = x => x.replace(/(<EndToEndId>E2E-000001<\/EndToEndId>[\s\S]*?<\/Nm>)<PstlAdr>[\s\S]*?<\/PstlAdr>/, '$1');
    const unstr = x => x.replace(/(<EndToEndId>E2E-000001<\/EndToEndId>[\s\S]*?<\/Nm>)<PstlAdr>[\s\S]*?<\/PstlAdr>/, '$1<PstlAdr><Ctry>CZ</Ctry><AdrLine>Hauptstrasse 1</AdrLine><AdrLine>1000 Praha</AdrLine></PstlAdr>');
    await expect(`.${v}: SEPA creditor without postal address`, noAdr(base), v, '10.6-address', { n: 1, sev: 'I', msg: /no postal address/ });
    await expect(`.${v}: domestic creditor with an unstructured address`, unstr(cz), v, '10.6-address', { n: 1, c: 'CZ', msg: /only an unstructured address/ });
    await none(`.${v}: SEPA creditor with an unstructured address (7.8)`, unstr(base), v, '10.6-address');
    await none(`.${v}: domestic unstructured, guideline.unstructuredAddress false (an error elsewhere)`, unstr(cz), v, '10.6-address', { c: 'CZ', over: { guideline: { unstructuredAddress: false } } });
    await none(`.${v}: cross-border creditor without postal address (stage 7)`, noAdr(file(v, { country: 'UA', type: 'CROSS_BORDER' })), v, '10.6-address', { c: 'UA' });
    await none(`.${v}: hints.recommend.address false`, noAdr(base), v, '10.6-address', { over: { hints: { recommend: { address: false } } } });

    await none(`.${v}: purpose, hints.recommend.purpose false (default)`, base, v, '10.6-purpose');
    await expect(`.${v}: purpose switched on, one transaction with Purp`, base.replace(/(<EndToEndId>E2E-000001<\/EndToEndId>[\s\S]*?)(<RmtInf>)/, '$1<Purp><Cd>SUPP</Cd></Purp>$2'), v, '10.6-purpose', { n: 19, sev: 'I', over: { hints: { recommend: { purpose: true } } } });

    const initg = x => x.replace('<InitgPty><Nm>Beispiel Handels GmbH</Nm>', '<InitgPty><Nm>Treasury Services AG</Nm>');
    await expect(`.${v}: initiating party is not the debtor, no ultimate debtor`, initg(base), v, '10.6-ultimate', { n: 2, sev: 'I', msg: /Treasury Services AG/ });
    await none(`.${v}: and no 10.10 for the same blocks`, initg(base), v, '10.10');
    const withUlt = initg(base).replace('<ChrgBr>SLEV</ChrgBr>', '<UltmtDbtr><Nm>Tochter GmbH</Nm></UltmtDbtr><ChrgBr>SLEV</ChrgBr>');
    await expect(`.${v}: block 1 has an ultimate debtor: 10.6 only for block 2`, withUlt, v, '10.6-ultimate', { n: 1, block: 2 });
    await expect(`.${v}: and 10.10 for block 1`, withUlt, v, '10.10', { n: 1, sev: 'I', block: 1 });
    await expect(`.${v}: hints.recommend.ultimate false: 10.10 for both blocks`, initg(base), v, '10.10', { n: 2, over: { hints: { recommend: { ultimate: false } } } });
    await none(`.${v}: and no 10.6 ultimate`, initg(base), v, '10.6-ultimate', { over: { hints: { recommend: { ultimate: false } } } });
    await none(`.${v}: initiating party in capitals is the debtor`, base.replace('<InitgPty><Nm>Beispiel Handels GmbH</Nm>', '<InitgPty><Nm>BEISPIEL HANDELS GMBH</Nm>'), v, '10.10');
  }
  {
    const noLei = file('09', { lei: false });
    await none('.09: LEI, hints.recommend.lei false (default)', noLei, '09', '10.6-lei');
    await expect('.09: LEI switched on, debtor without LEI', noLei, '09', '10.6-lei', { n: 2, sev: 'I', over: { hints: { recommend: { lei: true } } } });
    await none('.09: LEI switched on, debtor with LEI', file('09'), '09', '10.6-lei', { over: { hints: { recommend: { lei: true } } } });
    await none('.03: LEI switched on (no LEI element in .03)', file('03'), '03', '10.6-lei', { over: { hints: { recommend: { lei: true } } } });
  }

  // 10.7 hybrid address
  for (const v of ['03', '09']) {
    const base = file(v);
    await expect(`.${v}: creditor address with AdrLine`, base.replace(/(<EndToEndId>E2E-000001<\/EndToEndId>[\s\S]*?<Ctry>[A-Z]{2}<\/Ctry>)/, '$1<AdrLine>c/o Lager 3</AdrLine>'), v, '10.7', { n: 1, sev: 'I', msg: /address of Cdtr/ });
    await expect(`.${v}: debtor address with AdrLine (block)`, base.replace(/(<Dbtr><Nm>[^<]*<\/Nm><PstlAdr><TwnNm>[^<]*<\/TwnNm><Ctry>AT<\/Ctry>)/, '$1<AdrLine>Postfach 12</AdrLine>'), v, '10.7', { n: 1, block: 1, msg: /address of Dbtr/ });
    await none(`.${v}: country and address lines only (unstructured)`, base.replace(/(<EndToEndId>E2E-000001<\/EndToEndId>[\s\S]*?<\/Nm>)<PstlAdr>[\s\S]*?<\/PstlAdr>/, '$1<PstlAdr><Ctry>DE</Ctry><AdrLine>Hauptstrasse 1</AdrLine></PstlAdr>'), v, '10.7');
  }

  // 10.8 pain.001.001.03 used
  await expect('.03: default (hints.version03 true)', file('03'), '03', '10.8', { n: 1, sev: 'I' });
  await none('.09', file('09'), '09', '10.8');
  await none('.03: hints.version03 false', file('03'), '03', '10.8', { over: { hints: { version03: false } } });
  await none('.03: country accepts only .03', file('03'), '03', '10.8', { country: { versions: ['03'] } });

  // 10.9 close to a limit (limits.*, hints.nearLimitShare 0.9)
  for (const v of ['03', '09']) {
    const base = file(v);
    const lim = (l, s) => ({ over: { limits: l, hints: s === undefined ? {} : { nearLimitShare: s } } });
    await none(`.${v}: limits null (default)`, base, v, '10.9-transactions');
    await expect(`.${v}: 20 transactions, limit 22 (90 % = 19.8)`, base, v, '10.9-transactions', { n: 1, sev: 'I', ...lim({ maxTransactionsPerFile: 22 }) });
    await expect(`.${v}: 20 transactions, limit 20`, base, v, '10.9-transactions', { n: 1, ...lim({ maxTransactionsPerFile: 20 }) });
    await none(`.${v}: 20 transactions, limit 19 (above it: 6.5)`, base, v, '10.9-transactions', lim({ maxTransactionsPerFile: 19 }));
    await none(`.${v}: 20 transactions, limit 30`, base, v, '10.9-transactions', lim({ maxTransactionsPerFile: 30 }));
    await expect(`.${v}: limit 30, nearLimitShare 0.5`, base, v, '10.9-transactions', { n: 1, ...lim({ maxTransactionsPerFile: 30 }, 0.5) });
    await none(`.${v}: limit 22, nearLimitShare null`, base, v, '10.9-transactions', lim({ maxTransactionsPerFile: 22 }, null));
    await expect(`.${v}: 2 blocks, limit 2`, base, v, '10.9-blocks', { n: 1, ...lim({ maxBlocksPerFile: 2 }) });
    await expect(`.${v}: 10 transactions per block, limit 11`, base, v, '10.9-block', { n: 2, ...lim({ maxTransactionsPerBlock: 11 }) });
  }

  // RX.1 (M1): now on the transaction
  await expect('.03: EndToEndId NOTPROVIDED', file('03').replace('<EndToEndId>E2E-000002</EndToEndId>', '<EndToEndId>NOTPROVIDED</EndToEndId>'), '03', 'X.1', { n: 1, sev: 'I' });

  // functions
  {
    const F = TP.functions;
    TP.context = t.contextFor('AT', { hints: { truncateLength: {} } });
    ok(F.tpTruncated({ nodeType: 1, firstChild: null }) === '', 'tpTruncated: no setting, nothing to check');
    TP.context.countryConfig = { cutOff: { SEPA: '14:00', SEPA_INST: '23:00', default: '15:30', DOMESTIC: null } };
    ok(F.cutOffFor('SEPA') === '14:00' && F.cutOffFor('SEPA_INST') === '23:00' && F.cutOffFor('CROSS_BORDER') === '15:30' && F.cutOffFor('DOMESTIC') === '', 'cut-off per payment type, default, null');
    TP.context.countryConfig = { cutOff: '14:00' };
    ok(F.cutOffFor('SEPA') === '14:00' && F.cutOffFor('SEPA_INST') === '' && F.cutOffFor('') === '', 'one cut-off for all but SEPA Instant');
    TP.context.countryConfig = { cutOff: '2pm' };
    ok(F.cutOffFor('SEPA') === '', 'a cut-off that is not HH:MM is ignored');
  }
};
