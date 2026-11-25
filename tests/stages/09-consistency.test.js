/*
 * Testing Portal – tests of stage 9 (in-file consistency and duplicates), M2.
 * Every check: a file that breaks it (id, part, severity, code, count) and the
 * clean files. Files are clean generated files with a text replaced.
 */
'use strict';
module.exports = async t => {
  const { ok, head, gen, rules, validate } = t;
  const now = new Date(2026, 10, 18, 10, 0, 0); // Wednesday 18 November 2026, 10:00
  // fixed execution dates, so the tests do not depend on the day they run
  const pin = (xml, date = '2026-11-19') => xml.replace(/(<ReqdExctnDt>(?:<Dt>)?)\d{4}-\d{2}-\d{2}/g, `$1${date}`);
  const file = (v, o = {}) => pin(gen.generate({ version: v, transactions: 20, blocks: 2, ...(v === '09' ? { uetr: true, lei: true } : {}), ...o }));
  const of = (r, id) => r.findings.filter(f => (f.part ? `${f.rule}-${f.part}` : f.rule) === id);
  const stage9 = r => r.findings.filter(f => f.stage === 9);
  const ids = list => [...new Set(list.map(f => (f.part ? `${f.rule}-${f.part}` : f.rule)))].sort().join(',');
  const run = (xml, v, c = 'AT', over) => rules(xml, v, c, over, now);
  const txOf = (xml, e2e) => { const i = xml.indexOf(`<EndToEndId>${e2e}</EndToEndId>`); const a = xml.lastIndexOf('      <CdtTrfTxInf>', i); const b = xml.indexOf('</CdtTrfTxInf>', i) + 14; return xml.slice(a, b); };
  const expect = async (label, xml, v, id, { n, sev, code, c, over, block } = {}) => {
    const r = await run(xml, v, c, over);
    const f = of(r, id);
    ok(f.length === (n || 1) && f.every(x => (!sev || x.severity === sev) && (code === undefined || x.code === code) && (block === undefined || x.block === block) && x.message && x.line > 0),
      `${id} ${label}`, `got ${f.length}: ${JSON.stringify(f.map(x => [x.severity, x.code, x.block, x.tx, x.message]))} / stage 9: ${ids(stage9(r))}`);
    return r;
  };
  const none = async (label, xml, v, id, c, over) => { const r = await run(xml, v, c, over); ok(of(r, id).length === 0, `${id} not reported: ${label}`, JSON.stringify(of(r, id).map(x => x.message))); return r; };

  head('stage 9: consistency and duplicates (M2)');

  // clean files: every payment type in the countries where it applies, .03 and .09
  const hints = new Set();
  let bad = [];
  for (const c of ['AT', 'CZ', 'RO', 'UA', 'SK', 'HU', 'RS', 'HR', 'BA']) {
    const sepa = t.contextFor(c).countryConfig.sepa;
    for (const type of gen.TYPES) {
      if (!sepa && type.startsWith('SEPA')) continue;
      for (const v of ['03', '09']) {
        const xml = type === 'SEPA_INST' ? pin(gen.generate({ version: v, transactions: 6, blocks: 2, country: c, type, uetr: v === '09', lei: v === '09' }), '2026-11-18')
          : pin(gen.generate({ version: v, transactions: 6, blocks: 2, country: c, type, uetr: v === '09', lei: v === '09' }));
        const f = stage9(await run(xml, v, c));
        for (const x of f) if (x.severity === 'I') hints.add(x.rule); else bad.push(`${c} ${type} .${v}: ${x.rule} ${x.message}`);
      }
    }
  }
  ok(bad.length === 0, 'clean files of every payment type and country, .03 and .09: no stage-9 error or warning', bad.slice(0, 5).join(' | '));
  ok(hints.size === 0, 'and no stage-9 information hint', [...hints].join(','));

  for (const v of ['03', '09']) {
    const base = file(v);
    // 9.1 (M1)
    await expect(`.${v}: two blocks with PmtInfId PMT-01`, base.replace('<PmtInfId>PMT-02</PmtInfId>', '<PmtInfId>PMT-01</PmtInfId>'), v, '9.1', { n: 2, sev: 'E', code: 'DU02' });

    // 9.2 InstrId
    await expect(`.${v}: InstrId INS-000001 twice`, base.replace('<InstrId>INS-000003</InstrId>', '<InstrId>INS-000001</InstrId>'), v, '9.2', { n: 2, sev: 'E', code: 'DU05' });
    await none(`.${v}: InstrId left out`, base.replace(/<InstrId>[^<]*<\/InstrId>/g, ''), v, '9.2');

    // 9.3 EndToEndId (M1), now on the transaction
    const r93 = await expect(`.${v}: EndToEndId E2E-000001 twice`, base.replace('<EndToEndId>E2E-000003</EndToEndId>', '<EndToEndId>E2E-000001</EndToEndId>'), v, '9.3', { n: 2, sev: 'W', code: 'DU04' });
    ok(of(r93, '9.3').every(f => /\/CdtTrfTxInf\[\d+\]$/.test(f.xpath)), `9.3 .${v}: reported on the transaction`, of(r93, '9.3').map(f => f.xpath).join(' '));
    await none(`.${v}: NOTPROVIDED in every transaction`, base.replace(/<EndToEndId>[^<]*<\/EndToEndId>/g, '<EndToEndId>NOTPROVIDED</EndToEndId>'), v, '9.3');

    // 9.5 possible duplicate: tx 1 copied with new ids into the same block (after tx 1) and into block 2
    const tx1 = txOf(base, 'E2E-000001');
    const copy = (id) => tx1.replace('E2E-000001', id).replace('INS-000001', id.replace('E2E', 'INS')).replace(/<UETR>[^<]*<\/UETR>/, '<UETR>1b4e28ba-2fa1-41d2-883f-0016d3cca427</UETR>');
    const dupSame = base.replace(tx1, tx1 + '\n' + copy('E2E-900001'));
    await expect(`.${v}: a copy of transaction 1 with other ids in the same block`, dupSame, v, '9.5', { n: 2, sev: 'W', code: 'AM05' });
    const r95 = await run(dupSame, v);
    ok(of(r95, '9.5').some(f => /E2E-900001/.test(f.message)) && of(r95, '9.5').some(f => /E2E-000001/.test(f.message)), `9.5 .${v}: each names the other transaction`, of(r95, '9.5').map(f => f.message).join(' | '));
    const tx2 = txOf(base, 'E2E-000002');
    await expect(`.${v}: the copy in the other block (same execution date)`, base.replace(tx2, tx2 + '\n' + copy('E2E-900001')), v, '9.5', { n: 2 });
    const amt = /<InstdAmt Ccy="EUR">([^<]*)</.exec(tx1)[1];
    await expect(`.${v}: the same amount written as ${amt}0`, base.replace(tx1, tx1 + '\n' + copy('E2E-900001').replace(`>${amt}<`, `>${amt}0<`)), v, '9.5', { n: 2 });
    await none(`.${v}: other remittance text`, base.replace(tx1, tx1 + '\n' + copy('E2E-900001').replace(/<Ustrd>[^<]*/, '<Ustrd>Invoice 9999')), v, '9.5');
    await none(`.${v}: other amount`, base.replace(tx1, tx1 + '\n' + copy('E2E-900001').replace(`>${amt}<`, '>1.00<')), v, '9.5');
    await none(`.${v}: the copy in a block with another execution date`, base.replace(tx2, tx2 + '\n' + copy('E2E-900001')).replace(/(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<ReqdExctnDt>(?:<Dt>)?)2026-11-19/, '$12026-11-20'), v, '9.5');

    // 9.6 creditor account = debtor account
    const dbtrIban = /<DbtrAcct><Id><IBAN>([^<]*)</.exec(base)[1];
    const self = base.replace(/(<EndToEndId>E2E-000001<\/EndToEndId>[\s\S]*?<CdtrAcct><Id><IBAN>)[^<]*/, `$1${dbtrIban}`);
    await expect(`.${v}: creditor IBAN = debtor IBAN`, self, v, '9.6', { n: 1, sev: 'E', code: 'NARR' });
    await none(`.${v}: same IBAN, account currencies EUR and USD`, self.replace(`<DbtrAcct><Id><IBAN>${dbtrIban}</IBAN></Id>`, `<DbtrAcct><Id><IBAN>${dbtrIban}</IBAN></Id><Ccy>EUR</Ccy>`).replace(`<CdtrAcct><Id><IBAN>${dbtrIban}</IBAN></Id>`, `<CdtrAcct><Id><IBAN>${dbtrIban}</IBAN></Id><Ccy>USD</Ccy>`), v, '9.6');
    const othr = base.replace(/<DbtrAcct><Id><IBAN>[^<]*<\/IBAN>/, '<DbtrAcct><Id><Othr><Id>1234567</Id></Othr>').replace(/(<EndToEndId>E2E-000001<\/EndToEndId>[\s\S]*?<CdtrAcct><Id>)<IBAN>[^<]*<\/IBAN>/, '$1<Othr><Id>1234567</Id></Othr>');
    await none(`.${v}: same other id (Othr) at two different banks`, othr, v, '9.6');
    await expect(`.${v}: same other id (Othr) at the same bank`, othr.replace(/(<EndToEndId>E2E-000001<\/EndToEndId>[\s\S]*?<CdtrAgt><FinInstnId><BIC(?:FI)?>)[^<]*/, '$1DEMOATWW'), v, '9.6', { n: 1, sev: 'E' });

    // 9.7 same debtor account, different names
    const iban2 = /<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<DbtrAcct><Id><IBAN>([^<]*)</.exec(base)[1];
    const sameAcct = base.replace(`<IBAN>${iban2}</IBAN>`, `<IBAN>${dbtrIban}</IBAN>`);
    const otherName = sameAcct.replace(/(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<Dbtr><Nm>)[^<]*/, '$1Beispiel Holding AG');
    const r97 = await expect(`.${v}: block 2 has the account of block 1 and another debtor name`, otherName, v, '9.7', { n: 1, sev: 'W', code: null, block: 2 });
    ok(/PMT-01/.test(of(r97, '9.7')[0].message) && /Beispiel Holding AG/.test(of(r97, '9.7')[0].message), `9.7 .${v}: the message names the other block and both names`, of(r97, '9.7')[0].message);
    await none(`.${v}: same account, the name in capitals`, sameAcct.replace(/(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<Dbtr><Nm>)[^<]*/, '$1BEISPIEL HANDELS GMBH'), v, '9.7');

    // 9.8 same account, date and payment type in two blocks
    const r98 = await expect(`.${v}: two SEPA blocks of one account on one date`, sameAcct, v, '9.8', { n: 1, sev: 'I', code: null, block: 2 });
    ok(/PMT-01/.test(of(r98, '9.8')[0].message) && /SEPA credit transfer/.test(of(r98, '9.8')[0].message), `9.8 .${v}: names the first block and the payment type`, of(r98, '9.8')[0].message);
    await none(`.${v}: the same account on two dates`, sameAcct.replace(/(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<ReqdExctnDt>(?:<Dt>)?)2026-11-19/, '$12026-11-20'), v, '9.8');
    await none(`.${v}: the same account, a SEPA block and a block with service level URGP`, sameAcct.replace(/(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<PmtTpInf>)<SvcLvl><Cd>SEPA<\/Cd><\/SvcLvl>/, '$1<SvcLvl><Cd>URGP</Cd></SvcLvl>'), v, '9.8');

    // 9.10 ultimate debtor = debtor
    const ult = '<UltmtDbtr><Nm>Beispiel Handels GmbH</Nm></UltmtDbtr>';
    await expect(`.${v}: UltmtDbtr of block 1 has the debtor name`, base.replace('<ChrgBr>SLEV</ChrgBr>', ult + '<ChrgBr>SLEV</ChrgBr>'), v, '9.10', { n: 1, sev: 'I', code: null, block: 1 });
    await expect(`.${v}: UltmtDbtr of transaction 1 in capitals`, base.replace(/(<EndToEndId>E2E-000001<\/EndToEndId>[\s\S]*?)(<CdtrAgt>)/, `$1${ult.replace('Beispiel Handels GmbH', 'BEISPIEL HANDELS GMBH')}$2`), v, '9.10', { n: 1 });
    await none(`.${v}: UltmtDbtr with another name`, base.replace('<ChrgBr>SLEV</ChrgBr>', '<UltmtDbtr><Nm>Tochter GmbH</Nm></UltmtDbtr><ChrgBr>SLEV</ChrgBr>'), v, '9.10');
  }

  // 9.4 UETR (.09 only)
  {
    const base = file('09');
    const u = [...base.matchAll(/<UETR>([^<]*)<\/UETR>/g)].map(m => m[1]);
    await expect('.09: the UETR of transaction 1 also in transaction 2', base.replace(`<UETR>${u[1]}</UETR>`, `<UETR>${u[0]}</UETR>`), '09', '9.4', { n: 2, sev: 'E', code: 'NARR' });
    await none('.09 without UETR', file('09', { uetr: false }), '09', '9.4');
  }

  // the edited files are valid for the XSD: the findings are not about invalid values
  {
    const base = file('09');
    const dbtrIban = /<DbtrAcct><Id><IBAN>([^<]*)</.exec(base)[1];
    const xml = base.replace('<ChrgBr>SLEV</ChrgBr>', '<UltmtDbtr><Nm>Beispiel Handels GmbH</Nm></UltmtDbtr><ChrgBr>SLEV</ChrgBr>')
      .replace(/(<EndToEndId>E2E-000001<\/EndToEndId>[\s\S]*?<CdtrAcct><Id><IBAN>)[^<]*/, `$1${dbtrIban}`);
    const rep = await validate(xml, '09', 'AT', null, now);
    ok(!rep.groups.some(g => g.source === 'xsd') && rep.groups.some(g => g.rule === '9.6') && rep.groups.some(g => g.rule === '9.10'), 'an XSD-valid .09 file with 9.6 and 9.10: both reported, no XSD error', rep.groups.map(g => g.rule).join(','));
  }

  // speed: groups of 5,000 equal values stay linear (a lookup takes one entry, never counts the group)
  {
    let big = pin(gen.generate({ version: '09', transactions: 5000, blocks: 2500, uetr: true }));
    big = big.replace(/<InstrId>[^<]*<\/InstrId>/g, '<InstrId>SAME</InstrId>').replace(/<DbtrAcct><Id><IBAN>[^<]*<\/IBAN>/g, '<DbtrAcct><Id><IBAN>AT483200000012345864</IBAN>');
    const t0 = Date.now();
    const r = await run(big, '09');
    const ms = r.timings.sets['stages/09-consistency@09'];
    ok(of(r, '9.2').length === 5000 && of(r, '9.8').length === 2499 && ms < 5000, `5,000 equal InstrIds and 2,500 blocks of one account: 9.2 x5000, 9.8 x2499, stage 9 in ${(ms / 1000).toFixed(1)} s`, `${of(r, '9.2').length} ${of(r, '9.8').length} ${Date.now() - t0}`);
  }
};
