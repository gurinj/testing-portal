/*
 * Tests for the points of the independent review of M2 (2026-11-19).
 * Each test names the review point it covers.
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async t => {
  const { ok, head, gen, rules, validate, TP } = t;
  const ROOT = path.resolve(__dirname, '../..');
  const ids = rep => rep.groups.map(g => g.rule + (g.part ? '-' + g.part : '')).filter(r => r !== '10.8').sort().join(',');

  head('review of M2 (2026-11-19)');

  // 1. a block with one creditor at the debtor's own bank, or a tax payment, is not a mixed block (3.7)
  {
    const base = gen.generate({ version: '03', transactions: 4, blocks: 1 }).replace(/<PmtTpInf><SvcLvl><Cd>SEPA<\/Cd><\/SvcLvl><\/PmtTpInf>/, '');
    const own = base.replace(/(<CdtrAgt><FinInstnId><BIC>)[A-Z0-9]+(<\/BIC>)/, '$1DEMOATWW$2').replace(/(<CdtrAcct><Id><IBAN>)DE/, '$1AT');
    const r = await rules(own.replace(/<IBAN>(AT\d{2})[0-9]+<\/IBAN>(?=<\/Id><\/CdtrAcct>)/, (m, a) => `<IBAN>${gen.iban('AT', '99999' + '00000001234')}</IBAN>`), '03');
    const types = [...new Set(r.summary.blocks[0].txs.map(x => x.type))].sort().join(',');
    ok(types === 'INTRA_BANK,SEPA' && r.summary.blocks[0].type === 'SEPA', 'review 1: a SEPA block with one intra-bank payment is a SEPA block', `${types} → ${r.summary.blocks[0].type}`);
    ok(!r.findings.some(f => f.rule === '3.7'), 'review 1: and is not reported as mixed (3.7)', r.findings.map(f => f.rule).join(','));
    const cz = gen.generate({ version: '09', transactions: 4, blocks: 1, type: 'DOMESTIC', country: 'CZ' }).replace('</CdtTrfTxInf>', '<Purp><Cd>TAXS</Cd></Purp></CdtTrfTxInf>');
    const tax = cz.replace(/<CdtTrfTxInf>\s*<PmtId>/, '<CdtTrfTxInf><PmtId>').replace(/(<CdtTrfTxInf><PmtId><InstrId>INS-000001<\/InstrId>[\s\S]*?<\/PmtId>)/, '$1<PmtTpInf><CtgyPurp><Cd>TAXS</Cd></CtgyPurp></PmtTpInf>');
    const rt = await rules(tax, '09', 'CZ');
    ok(rt.summary.blocks[0].txs.some(x => x.type === 'BUDGET') && !rt.findings.some(f => f.rule === '3.7'), 'review 1: a CZ domestic block with one tax payment is not mixed', rt.summary.blocks[0].txs.map(x => x.type).join(','));
    const mixed = gen.generate({ version: '03', transactions: 2, blocks: 1, type: 'CROSS_BORDER', country: 'CZ' });
    const twoTypes = mixed.replace(/<Amt><InstdAmt Ccy="USD">/, '<Amt><InstdAmt Ccy="CZK">').replace(/<CdtrAcct><Id><Othr><Id>[0-9]+<\/Id><\/Othr><\/Id><\/CdtrAcct>/, `<CdtrAcct><Id><IBAN>${gen.iban('CZ', '9999' + '0000000000005001')}</IBAN></Id></CdtrAcct>`).replace(/<CdtrAgt><FinInstnId><BIC>DEMOUS33<\/BIC>/, '<CdtrAgt><FinInstnId><BIC>OTHRCZ22</BIC>');
    const rm = await rules(twoTypes, '03', 'CZ');
    ok(rm.findings.some(f => f.rule === '3.7'), 'review 1: a block with a domestic and a cross-border payment is still mixed (3.7)', rm.summary.blocks[0].txs.map(x => x.type).join(','));
  }

  // 2. EUR to a SEPA country with another service level is not an implicit SEPA payment
  {
    const F = TP.functions;
    TP.context = t.contextFor('AT');
    const f = svc => F.classify({ svc, ccy: 'EUR', cdtrIban: 'DE89370400440532013000', dbtrBic: 'DEMOATWW' });
    ok(f([]) === 'SEPA' && f(['SEPA']) === 'SEPA' && f(['G001']) === 'CROSS_BORDER' && f(['NURG']) === 'CROSS_BORDER' && f(['URGP']) === 'CROSS_BORDER',
      'review 2: EUR AT→DE is SEPA without service level or with SEPA, cross-border with G001, NURG or URGP', ['', 'SEPA', 'G001', 'NURG', 'URGP'].map(x => f(x ? [x] : [])).join(','));
    const gpi = gen.generate({ version: '09', transactions: 2, blocks: 1 }).replace('<SvcLvl><Cd>SEPA</Cd></SvcLvl>', '<SvcLvl><Cd>G001</Cd></SvcLvl>').replace('<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SHAR</ChrgBr>');
    const r = await validate(gpi, '09');
    ok(!r.groups.some(g => g.rule === '7.3' || g.rule === '7.4'), 'review 2: a gpi EUR payment AT→DE with SHAR gets no SEPA findings (7.3, 7.4)', ids(r));
  }

  // 3. cross-border without postal addresses: 7.18-missing
  {
    const cb = gen.generate({ version: '03', transactions: 3, blocks: 1, type: 'CROSS_BORDER', country: 'UA' }).replace(/<PstlAdr>[\s\S]*?<\/PstlAdr>/g, '');
    const r = await validate(cb, '03', 'UA');
    const g = r.groups.filter(x => x.rule === '7.18' && x.part === 'missing');
    ok(g.length && g[0].severity === 'W' && g.reduce((n, x) => n + x.count, 0) === 4, 'review 3: cross-border payments without debtor and creditor address: 7.18-missing (3 creditors, 1 debtor)', JSON.stringify(g.map(x => [x.level, x.count])));
    const clean = await validate(gen.generate({ version: '03', transactions: 3, blocks: 1, type: 'CROSS_BORDER', country: 'UA' }), '03', 'UA');
    ok(!clean.groups.some(x => x.rule === '7.18'), 'review 3: with addresses: no 7.18');
  }

  // 4. the report builder with many findings in one big block (was quadratic)
  {
    const n = 5000;
    const items = [];
    for (let i = 1; i <= n; i++) for (let k = 0; k < 3; k++) items.push({ source: 'rules', rule: '9.2', stage: 9, severity: 'E', level: 'tx', block: 1, tx: i, xpath: `/x[${i}]`, message: 'm' });
    const summary = { blocks: [{ n: 1, txs: Array.from({ length: n }, (_, i) => ({ n: i + 1, amount: '1.00', ccy: 'EUR' })) }], grp: {} };
    const t0 = Date.now();
    const rep = TP.report.build({ findings: items, summary, catalogue: t.catalogue, settings: {} });
    const ms = Date.now() - t0;
    ok(ms < 2000 && rep.blocks[0].txs.every(x => x.status === 'RJCT' && x.own === 3) && rep.blocks[0].findings === 3 * n, `review 4: report of ${n} transactions with ${3 * n} findings in ${ms} ms`, `${ms} ms`);
  }

  // 5. a wrong value in a country file does not stop the checks
  {
    const xml = gen.generate({ version: '03', transactions: 3, blocks: 1, type: 'INTRA_BANK', country: 'AT' });
    let r1, r2, err = '';
    try { r1 = await rules(xml, '03', 'AT', { _country: { bankBics: 'DEMOATWW' } }); r2 = await rules(xml, '03', 'AT', { _country: { budgetIbanPattern: '^AT[0-9' } }); } catch (e) { err = e.message; }
    ok(!err && r1 && r2 && !r1.findings.some(f => /engine/.test(f.rule)) && r1.summary.blocks[0].txs.every(x => x.type === 'INTRA_BANK'), 'review 5: bankBics as a string or a broken budgetIbanPattern do not stop the rules', err);
    const problems = {};
    for (const f of fs.readdirSync(path.join(ROOT, 'config/countries')).filter(f => f.endsWith('.json'))) {
      const p = TP.functions.checkCountryConfig(JSON.parse(fs.readFileSync(path.join(ROOT, 'config/countries', f), 'utf8')));
      if (p.length) problems[f] = p;
    }
    ok(!Object.keys(problems).length, 'review 5: every country file has the right types (checkCountryConfig)', JSON.stringify(problems));
    ok(TP.functions.checkCountryConfig({ code: 'AT', bankBics: 'X', budgetIbanPattern: '^AT[0-9', holidays: ['25.12.2026'] }).length === 3, 'review 5: checkCountryConfig finds wrong types');
  }

  // 6. one problem, one finding
  {
    const clean = gen.generate({ version: '03', transactions: 2, blocks: 1 });
    for (const [label, from, to, want] of [
      ['debtor name of spaces: 4.15 only', '<Dbtr><Nm>Beispiel Handels GmbH</Nm>', '<Dbtr><Nm>   </Nm>', '4.15'],
      ['initiating party name of spaces without Id: 4.5 only', /<InitgPty><Nm>[^<]*<\/Nm>/, '<InitgPty><Nm>  </Nm>', '4.5']
    ]) {
      const r = await validate(clean.replace(from, to), '03');
      ok(ids(r) === want, `review 6a: ${label}`, ids(r));
    }
    const blk2 = gen.generate({ version: '03', transactions: 4, blocks: 2 });
    const other = blk2.replace(/(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<DbtrAcct><Id><IBAN>)AT\d{2}[0-9]+/, (m, a) => a + gen.iban('DE', '370400440532013000'));
    const r = await validate(other, '03');
    ok(r.groups.some(g => g.rule === '3.2') && !r.groups.some(g => g.rule === '3.4'), 'review 6b: a block with a debtor IBAN of another country: 3.2, not 3.4 as well', ids(r));
    const r34 = await validate(other, '03', 'AT', { checks: { '3.2': { enabled: false }, '3.3': { enabled: false } } });
    ok(r34.groups.some(g => g.rule === '3.4'), 'review 6b: with 3.2 and 3.3 off, 3.4 reports the two countries', ids(r34));
    const cz = gen.generate({ version: '03', transactions: 2, blocks: 1, type: 'DOMESTIC', country: 'CZ' }).replace(/Ccy="CZK"/g, 'Ccy="XYZ"');
    const rc = await validate(cz, '03', 'CZ');
    ok(rc.groups.some(g => g.rule === '4.23') && !rc.groups.some(g => ['7.1', '7.10', '7.13', '6.6'].includes(g.rule)), 'review 6c: a currency that is not ISO 4217: 4.23 only', ids(rc));
    const chk = clean.replace('<PmtMtd>TRF</PmtMtd>', '<PmtMtd>CHK</PmtMtd>').replace(/<CdtrAcct>[\s\S]*?<\/CdtrAcct>/g, '');
    const rk = await validate(chk, '03');
    ok(!rk.groups.some(g => g.rule === '4.31'), 'review 6d: a cheque without creditor account: no 4.31', ids(rk));
    TP.context = t.contextFor('AT', { guideline: { remittance: { combined: false, maxUstrd: '1', maxStrd: '1' } } });
    ok(TP.functions.tpRemittanceCovered() === true, 'review 6e: remittance limits as strings ("1") count as numbers for 7.6/4.38');
  }

  // 7. domestic payment in a foreign currency: a warning until confirmed
  {
    const usd = gen.generate({ version: '03', transactions: 2, blocks: 1, type: 'DOMESTIC', country: 'CZ' }).replace(/Ccy="CZK"/g, 'Ccy="USD"');
    const r = await validate(usd, '03', 'CZ');
    const g = r.groups.find(x => x.rule === '7.13');
    ok(g && g.severity === 'W' && g.overridden, 'review 7: CZ→CZ in USD: 7.13 is a warning (settings checks."7.13")', g && g.severity);
  }

  // 9. a null reason code in settings.checks removes the code
  {
    const dup = gen.generate({ version: '03', transactions: 4, blocks: 1 }).replace('<EndToEndId>E2E-000003</EndToEndId>', '<EndToEndId>E2E-000001</EndToEndId>');
    const r = await validate(dup, '03', 'AT', { checks: { '9.3': { code: null } } });
    const g = r.groups.find(x => x.rule === '9.3');
    ok(g && g.code === null, 'review 9: checks."9.3".code null removes the reason code', g && String(g.code));
  }

  // 11. bank results hold no file name
  {
    const src = fs.readFileSync(path.join(ROOT, 'tests/run-bank.js'), 'utf8');
    ok(!/\bfile: f\b/.test(src), 'review 11: the results of the bank test mode do not contain the file name');
  }
};
