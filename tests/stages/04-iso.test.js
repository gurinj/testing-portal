/*
 * Testing Portal – tests of stage 4, generic ISO business rules (M2).
 * Run by tests/run-tests.js. Every check has a test that breaks it (the
 * finding appears with its id, part and severity) and the clean files that
 * pass; checks with a setting are tested with the default, a changed value
 * and null (off). Failing files are clean generated files with text replaced.
 */
'use strict';

module.exports = async t => {
  const { ok, head, gen, rules, validate, TP } = t;
  head('stage 4: generic ISO business rules (M2)');

  const VERSIONS = ['03', '09'];
  const base = { '03': gen.generate({ version: '03', transactions: 4, blocks: 2 }), '09': gen.generate({ version: '09', transactions: 4, blocks: 2, uetr: true, lei: true }) };
  const bic = v => (v === '09' ? 'BICFI' : 'BIC');
  const sig = f => f.rule + (f.part ? '-' + f.part : '');
  const keyOf = o => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
  const tally4 = list => { const a = {}; for (const f of list) { const k = `${sig(f)}:${f.severity}`; a[k] = (a[k] || 0) + 1; } return keyOf(a); };
  const stage4 = async (xml, v, country = 'AT', over, now) => (await rules(xml, v, country, over, now)).findings.filter(f => f.stage === 4);

  /* replace text in a file: each [from, to] must change it, else null */
  const edit = (xml, ...pairs) => {
    let out = xml;
    for (const [from, to] of pairs) { const next = out.replace(from, to); if (next === out) return null; out = next; }
    return out;
  };
  /* the stage-4 findings of an edited file are exactly `want` ({ 'id-part:severity': count }) */
  async function expect4(label, xml, v, want, opts = {}) {
    if (!xml) return ok(false, label, 'the edit did not change the file');
    const got = await stage4(xml, v, opts.country || 'AT', opts.over, opts.now);
    ok(tally4(got) === keyOf(want), label, `got ${tally4(got)} expected ${keyOf(want)}\n       ${got.map(f => f.message).join(' | ')}`);
    return got;
  }
  /* the full report (XSD and rules) of an edited file has these rules (and no stage-4 rule beyond them) */
  async function expectReport(label, xml, v, wantRules, opts = {}) {
    if (!xml) return ok(false, label, 'the edit did not change the file');
    const rep = await validate(xml, v, opts.country || 'AT', opts.over);
    // 10.8 (information) is on every .03 file (merge of stage 10, 2026-11-18)
    const got = rep.groups.filter(g => g.rule !== '10.8').map(g => g.rule + (g.part ? '-' + g.part : '')).sort().join(',');
    ok(got === [...wantRules].sort().join(','), label, got);
    return rep;
  }

  // the first transaction's creditor address and the first block's elements, as generated
  const CDTR_ADR = /<PstlAdr><StrtNm>Industriestrasse<\/StrtNm><BldgNb>1<\/BldgNb><PstCd>40210<\/PstCd><TwnNm>Duesseldorf<\/TwnNm><Ctry>DE<\/Ctry><\/PstlAdr>/;
  const adr = inner => `<PstlAdr>${inner}</PstlAdr>`;
  const DBTR = '<Dbtr><Nm>Beispiel Handels GmbH</Nm>';
  const INITG = '<InitgPty><Nm>Beispiel Handels GmbH</Nm></InitgPty>';
  const FIRST_RMT = /<RmtInf><Ustrd>Invoice 4000<\/Ustrd><\/RmtInf>/;
  const firstAgent = v => new RegExp(`<CdtrAgt><FinInstnId><${bic(v)}>DEMODEFF</${bic(v)}></FinInstnId></CdtrAgt>`);
  const SEPA_PTI = '<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>';

  /* ---------------------------------------------------------------- clean files */
  {
    const sepa = TP.functions.list('sepa');
    const bad = [];
    let n = 0;
    for (const v of VERSIONS) for (const country of gen.COUNTRIES) for (const type of gen.TYPES) {
      if ((type === 'SEPA' || type === 'SEPA_INST') && !sepa.has(country)) continue; // SEPA payments only from SEPA countries
      const xml = gen.generate({ version: v, transactions: 3, blocks: 1, type, country, uetr: v === '09', lei: v === '09' });
      const f = await stage4(xml, v, country);
      n++;
      if (f.length) bad.push(`${v} ${country} ${type}: ${tally4(f)}`);
    }
    ok(!bad.length, `clean files of every payment type and country (${n} files, .03 and .09 with UETR and LEI): no stage-4 finding`, bad.slice(0, 10).join(' | '));
    for (const v of VERSIONS) {
      const f = await stage4(base[v], v);
      ok(!f.length, `clean .${v} file with 4 transactions in 2 blocks: no stage-4 finding`, tally4(f));
    }
  }

  /* ---------------------------------------------------------------- group header */
  for (const v of VERSIONS) {
    const b = base[v];
    await expect4(`.${v} 4.1 MsgId of spaces`, edit(b, [/<MsgId>[^<]*<\/MsgId>/, '<MsgId>   </MsgId>']), v, { '4.1:E': 1 });
    const g = await expect4(`.${v} 4.5 InitgPty without name and id`, edit(b, [INITG, '<InitgPty><CtryOfRes>AT</CtryOfRes></InitgPty>']), v, { '4.5:E': 1 });
    ok(g && g[0] && /\/GrpHdr\[1\]\/InitgPty\[1\]$/.test(g[0].xpath) && g[0].level === 'file', `.${v} 4.5 is reported on InitgPty, file level`, g && g[0] && g[0].xpath);
    await expect4(`.${v} 4.5 InitgPty name of spaces`, edit(b, [INITG, '<InitgPty><Nm>  </Nm></InitgPty>']), v, { '4.5:E': 1 });
    await expect4(`.${v} 4.5 InitgPty with an id only passes`, edit(b, [INITG, '<InitgPty><Id><OrgId><Othr><Id>ATU12345678</Id></Othr></OrgId></Id></InitgPty>']), v, {});
  }
  await expectReport('4.1 an empty MsgId is the XSD (2.6), not 4.1', edit(base['03'], [/<MsgId>[^<]*<\/MsgId>/, '<MsgId></MsgId>']), '03', ['2.6']);
  await expectReport('4.5 an empty InitgPty name is the XSD (2.6), not 4.5', edit(base['03'], [INITG, '<InitgPty><Nm></Nm></InitgPty>']), '03', ['2.6']);
  {
    // 4.2: future (E) and age (W, through settings checks."4.2-age") in .09 too; the rest is tested in tests/run-tests.js
    const now = new Date();
    const at = d => base['09'].replace(/<CreDtTm>[^<]*<\/CreDtTm>/, `<CreDtTm>${new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19)}</CreDtTm>`);
    await expect4('.09 4.2 creation time 2 hours ahead: part future', at(new Date(now.getTime() + 2 * 3600000)), '09', { '4.2-future:E': 1 });
    const old = await validate(at(new Date(now.getTime() - 40 * 86400000)), '09');
    ok(old.groups.some(x => x.rule === '4.2' && x.part === 'age' && x.severity === 'W'), '.09 4.2 a file 40 days old: part age, a warning');
  }
  // 4.3 and 4.4 (M1): the defects nboftxs and ctrlsum in tests/run-tests.js

  /* ---------------------------------------------------------------- payment block */
  for (const v of VERSIONS) {
    const b = base[v];
    const f6 = await expect4(`.${v} 4.6 PmtInfId of spaces`, edit(b, ['<PmtInfId>PMT-01</PmtInfId>', '<PmtInfId>  </PmtInfId>']), v, { '4.6:E': 1 });
    ok(f6 && f6[0] && f6[0].level === 'block' && /PmtInfId\[1\]$/.test(f6[0].xpath), `.${v} 4.6 is reported on PmtInfId, block level`, f6 && f6[0] && f6[0].xpath);
    await expect4(`.${v} 4.7 block NbOfTxs wrong`, edit(b, ['<NbOfTxs>2</NbOfTxs>', '<NbOfTxs>3</NbOfTxs>']), v, { '4.7:E': 1 });
    await expect4(`.${v} 4.8 block CtrlSum wrong`, edit(b, [/(<NbOfTxs>2<\/NbOfTxs>\s*<CtrlSum>)[^<]*/, '$11.00']), v, { '4.8:E': 1 });
    const f15 = await expect4(`.${v} 4.15 debtor without a name`, edit(b, [DBTR, '<Dbtr>']), v, { '4.15:E': 1 });
    ok(f15 && f15[0] && /PmtInf\[1\]\/Dbtr\[1\]$/.test(f15[0].xpath), `.${v} 4.15 is reported on Dbtr`, f15 && f15[0] && f15[0].xpath);
    await expect4(`.${v} 4.15 debtor name of spaces`, edit(b, [DBTR, '<Dbtr><Nm> </Nm>']), v, { '4.15:E': 1 });
    const agt = new RegExp(`<DbtrAgt><FinInstnId><${bic(v)}>DEMOATWW</${bic(v)}></FinInstnId></DbtrAgt>`);
    await expect4(`.${v} 4.17 debtor agent with a name only`, edit(b, [agt, '<DbtrAgt><FinInstnId><Nm>Demo Bank</Nm></FinInstnId></DbtrAgt>']), v, { '4.17:E': 1 });
    await expect4(`.${v} 4.17 debtor agent with a clearing member id only passes`, edit(b, [agt, '<DbtrAgt><FinInstnId><ClrSysMmbId><ClrSysId><Cd>ATBLZ</Cd></ClrSysId><MmbId>99999</MmbId></ClrSysMmbId></FinInstnId></DbtrAgt>']), v, {});
    // 4.18: charges account and its agent (after ChrgBr in the block)
    const chrgs = (acct, agt) => edit(b, ['<ChrgBr>SLEV</ChrgBr>', `<ChrgBr>SLEV</ChrgBr>${acct}${agt}`]);
    const okIban = gen.iban('AT', '9999900000777777');
    const badIban = okIban.slice(0, 2) + String((+okIban.slice(2, 4) + 1) % 100).padStart(2, '0') + okIban.slice(4);
    const agtOf = x => `<ChrgsAcctAgt><FinInstnId><${bic(v)}>${x}</${bic(v)}></FinInstnId></ChrgsAcctAgt>`;
    await expect4(`.${v} 4.18 valid charges account at a branch of the debtor agent passes`, chrgs(`<ChrgsAcct><Id><IBAN>${okIban}</IBAN></Id></ChrgsAcct>`, agtOf('DEMOATWWXXX')), v, {});
    const f18 = await expect4(`.${v} 4.18 charges account IBAN with wrong check digits: part iban`, chrgs(`<ChrgsAcct><Id><IBAN>${badIban}</IBAN></Id></ChrgsAcct>`, ''), v, { '4.18-iban:E': 1 });
    ok(f18 && f18[0] && /check digits/.test(f18[0].message) && /ChrgsAcct\[1\]\/Id\[1\]\/IBAN\[1\]$/.test(f18[0].xpath), `.${v} 4.18 iban: says why, on the IBAN`, f18 && f18[0] && f18[0].message);
    await expect4(`.${v} 4.18 charges account of 19 characters: part iban`, chrgs(`<ChrgsAcct><Id><IBAN>${okIban.slice(0, 19)}</IBAN></Id></ChrgsAcct>`, ''), v, { '4.18-iban:E': 1 });
    await expect4(`.${v} 4.18 charges account agent without a charges account: part account`, chrgs('', agtOf('DEMOATWW')), v, { '4.18-account:E': 1 });
    await expect4(`.${v} 4.18 charges account agent of another bank: part agent`, chrgs(`<ChrgsAcct><Id><IBAN>${okIban}</IBAN></Id></ChrgsAcct>`, agtOf('OTHRATWW')), v, { '4.18-agent:E': 1 });
    await expect4(`.${v} 4.18 charges account with another account id (Othr) is not checked`, chrgs('<ChrgsAcct><Id><Othr><Id>12345</Id></Othr></Id></ChrgsAcct>', ''), v, {});
    // 4.19: ultimate debtor on the block (before ChrgBr) and on a transaction (before CdtrAgt)
    await expect4(`.${v} 4.19 ultimate debtor of the block without name and id`, edit(b, ['<ChrgBr>SLEV</ChrgBr>', '<UltmtDbtr><CtryOfRes>AT</CtryOfRes></UltmtDbtr><ChrgBr>SLEV</ChrgBr>']), v, { '4.19:E': 1 });
    const f19 = await expect4(`.${v} 4.19 ultimate debtor of a transaction without name and id`, edit(b, [firstAgent(v), m => `<UltmtDbtr><CtryOfRes>AT</CtryOfRes></UltmtDbtr>${m}`]), v, { '4.19:E': 1 });
    ok(f19 && f19[0] && f19[0].level === 'tx', `.${v} 4.19 on a transaction is a transaction finding`);
    await expect4(`.${v} 4.19 ultimate debtor with a name passes`, edit(b, ['<ChrgBr>SLEV</ChrgBr>', '<UltmtDbtr><Nm>Tochter GmbH</Nm></UltmtDbtr><ChrgBr>SLEV</ChrgBr>']), v, {});
  }
  {
    // 4.12 (.09 only): execution date with a time
    const dttm = edit(base['09'], [/<ReqdExctnDt><Dt>([^<]*)<\/Dt><\/ReqdExctnDt>/, '<ReqdExctnDt><DtTm>$1T10:00:00</DtTm></ReqdExctnDt>']);
    const f = await expect4('.09 4.12 ReqdExctnDt/DtTm, setting executionDateTime false (default)', dttm, '09', { '4.12:E': 1 });
    ok(f && f[0] && /ReqdExctnDt\[1\]\/DtTm\[1\]$/.test(f[0].xpath), '.09 4.12 is reported on DtTm', f && f[0] && f[0].xpath);
    await expect4('.09 4.12 executionDateTime true: DtTm allowed', dttm, '09', {}, { over: { guideline: { executionDateTime: true } } });
    await expect4('.09 4.12 executionDateTime null: not checked', dttm, '09', {}, { over: { guideline: { executionDateTime: null } } });
  }
  {
    const b = base['03'];
    await expect4('4.16 debtor account currency XYZ', edit(b, [/(<DbtrAcct><Id><IBAN>[^<]*<\/IBAN><\/Id>)/, '$1<Ccy>XYZ</Ccy>']), '03', { '4.16:E': 1 });
    await expect4('4.16 debtor account currency EUR passes', edit(b, [/(<DbtrAcct><Id><IBAN>[^<]*<\/IBAN><\/Id>)/, '$1<Ccy>EUR</Ccy>']), '03', {});
    await expectReport('4.16 debtor account currency eur is the XSD (2.7), not 4.16', edit(b, [/(<DbtrAcct><Id><IBAN>[^<]*<\/IBAN><\/Id>)/, '$1<Ccy>eur</Ccy>']), '03', ['2.7']);
    await expect4('.09 4.16 debtor account currency XYZ', edit(base['09'], [/(<DbtrAcct><Id><IBAN>[^<]*<\/IBAN><\/Id>)/, '$1<Ccy>XYZ</Ccy>']), '09', { '4.16:E': 1 });
  }

  /* ---------------------------------------------------------------- transaction */
  for (const v of VERSIONS) {
    const b = base[v];
    const f13 = await expect4(`.${v} 4.13 payment type information on block and transaction`, edit(b, ['<Amt>', `${SEPA_PTI}<Amt>`]), v, { '4.13:E': 1 });
    ok(f13 && f13[0] && f13[0].level === 'tx' && /CdtTrfTxInf\[1\]\/PmtTpInf\[1\]$/.test(f13[0].xpath), `.${v} 4.13 is reported on the transaction's PmtTpInf`, f13 && f13[0] && f13[0].xpath);
    await expect4(`.${v} 4.13 payment type information on the transactions only passes`, edit(b, [SEPA_PTI, ''], [SEPA_PTI, ''], ['<Amt>', `${SEPA_PTI}<Amt>`]), v, {});
    await expect4(`.${v} 4.14 charge bearer on block and transaction`, edit(b, [/(<\/Amt>)(\s*<CdtrAgt>)/, '$1<ChrgBr>SLEV</ChrgBr>$2']), v, { '4.14:E': 1 });
    await expect4(`.${v} 4.14 charge bearer on the transactions only passes`, edit(b, ['<ChrgBr>SLEV</ChrgBr>', ''], ['<ChrgBr>SLEV</ChrgBr>', ''], [/(<\/Amt>)(\s*<CdtrAgt>)/g, '$1<ChrgBr>SLEV</ChrgBr>$2']), v, {});
    await expect4(`.${v} 4.20 EndToEndId of spaces`, edit(b, ['<EndToEndId>E2E-000001</EndToEndId>', '<EndToEndId>   </EndToEndId>']), v, { '4.20:E': 1 });
    await expect4(`.${v} 4.20 EndToEndId NOTPROVIDED passes`, edit(b, ['<EndToEndId>E2E-000001</EndToEndId>', '<EndToEndId>NOTPROVIDED</EndToEndId>']), v, {});
    const f21 = await expect4(`.${v} 4.21 amount 0.00 (and the control sums)`, edit(b, [/(<InstdAmt Ccy="EUR">)[^<]*/, '$10.00']), v, { '4.21:E': 1, '4.4:E': 1, '4.8:E': 1 });
    ok(f21 && f21.find(f => f.rule === '4.21') && /\/Amt\[1\]\/InstdAmt\[1\]$/.test(f21.find(f => f.rule === '4.21').xpath), `.${v} 4.21 is reported on InstdAmt, as in M1`);
    const f22 = await expect4(`.${v} 4.22 JPY with decimals`, edit(b, [/<InstdAmt Ccy="EUR">([^<]*)</, '<InstdAmt Ccy="JPY">$1<']), v, { '4.22:E': 1 });
    ok(f22 && f22[0] && /\/InstdAmt\[1\]$/.test(f22[0].xpath), `.${v} 4.22 is reported on InstdAmt, as in M1`);
    const f23 = await expect4(`.${v} 4.23 amount in XYZ`, edit(b, ['Ccy="EUR"', 'Ccy="XYZ"']), v, { '4.23:E': 1 });
    ok(f23 && f23[0] && /XYZ/.test(f23[0].message) && /InstdAmt\[1\]$/.test(f23[0].xpath), `.${v} 4.23 names the currency, on InstdAmt`, f23 && f23[0] && f23[0].message);
    await expect4(`.${v} 4.23 amount in HRK (withdrawn in 2023)`, edit(b, ['Ccy="EUR"', 'Ccy="HRK"']), v, { '4.23:E': 1 });
    await expect4(`.${v} 4.23 creditor account currency XYZ`, edit(b, [/(<CdtrAcct><Id><IBAN>[^<]*<\/IBAN><\/Id>)/, '$1<Ccy>XYZ</Ccy>']), v, { '4.23:E': 1 });
    await expect4(`.${v} 4.23 charges account currency XYZ`, edit(b, ['<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SLEV</ChrgBr><ChrgsAcct><Id><Othr><Id>1</Id></Othr></Id><Ccy>XYZ</Ccy></ChrgsAcct>']), v, { '4.23:E': 1 });
    const eqvt = cot => edit(b, [/<Amt><InstdAmt Ccy="EUR">([^<]*)<\/InstdAmt><\/Amt>/, `<Amt><EqvtAmt><Amt Ccy="EUR">$1</Amt><CcyOfTrf>${cot}</CcyOfTrf></EqvtAmt></Amt>`]);
    await expect4(`.${v} 4.24 equivalent amount with currency of transfer USD passes`, eqvt('USD'), v, {});
    await expect4(`.${v} 4.24 currency of transfer XYZ: part currency`, eqvt('XYZ'), v, { '4.24-currency:E': 1 });
    await expect4(`.${v} 4.24 equivalent amount in XYZ: 4.23 on the amount`, edit(eqvt('USD'), ['<Amt Ccy="EUR">', '<Amt Ccy="XYZ">']), v, { '4.23:E': 1 });
    await expect4(`.${v} 4.24 equivalentAmount false: part supported`, eqvt('USD'), v, { '4.24-supported:E': 1 }, { over: { guideline: { equivalentAmount: false } } });
    await expect4(`.${v} 4.24 equivalentAmount null: not checked`, eqvt('USD'), v, {}, { over: { guideline: { equivalentAmount: null } } });
    // 4.25: exchange rate information (after Amt); UnitCcy exists in .09 only
    const xr = inner => edit(b, [/(<\/Amt>)(\s*<CdtrAgt>)/, `$1<XchgRateInf>${inner}</XchgRateInf>$2`]);
    await expect4(`.${v} 4.25 rate type AGRD without contract id: part contract, a warning`, xr('<XchgRate>1.1</XchgRate><RateTp>AGRD</RateTp>'), v, { '4.25-contract:W': 1 });
    await expect4(`.${v} 4.25 rate type AGRD with contract id passes`, xr('<XchgRate>1.1</XchgRate><RateTp>AGRD</RateTp><CtrctId>FX-1</CtrctId>'), v, {});
    await expect4(`.${v} 4.25 rate type SPOT without contract id passes`, xr('<XchgRate>1.1</XchgRate><RateTp>SPOT</RateTp>'), v, {});
    // 4.29: creditor country
    const f29 = await expect4(`.${v} 4.29 creditor country QQ`, edit(b, ['<Ctry>DE</Ctry></PstlAdr></Cdtr>', '<Ctry>QQ</Ctry></PstlAdr></Cdtr>']), v, { '4.29:E': 1 });
    ok(f29 && f29[0] && /Cdtr\[1\]\/PstlAdr\[1\]\/Ctry\[1\]$/.test(f29[0].xpath) && /QQ/.test(f29[0].message), `.${v} 4.29 is reported on Cdtr/PstlAdr/Ctry with the value`, f29 && f29[0] && f29[0].xpath);
    await expect4(`.${v} 4.29 creditor country XK (Kosovo) passes`, edit(b, ['<Ctry>DE</Ctry></PstlAdr></Cdtr>', '<Ctry>XK</Ctry></PstlAdr></Cdtr>']), v, {});
    await expect4(`.${v} 4.31 creditor account missing`, edit(b, [/<CdtrAcct>.*?<\/CdtrAcct>/, '']), v, { '4.31:E': 1 });
    // 4.32: ultimate creditor (after CdtrAcct)
    const ult = inner => edit(b, [/(<CdtrAcct>.*?<\/CdtrAcct>)/, `$1<UltmtCdtr>${inner}</UltmtCdtr>`]);
    await expect4(`.${v} 4.32 ultimate creditor without name and id`, ult('<CtryOfRes>DE</CtryOfRes>'), v, { '4.32:E': 1 });
    await expect4(`.${v} 4.32 ultimate creditor name of spaces`, ult('<Nm>  </Nm>'), v, { '4.32:E': 1 });
    await expect4(`.${v} 4.32 ultimate creditor with an id passes`, ult('<Id><PrvtId><Othr><Id>X-1</Id></Othr></PrvtId></Id>'), v, {});
  }
  await expectReport('4.23 amount currency eur is the XSD (2.7), not 4.23', edit(base['03'], ['Ccy="EUR"', 'Ccy="eur"']), '03', ['2.7']);
  await expectReport('4.29 creditor country de is the XSD (2.7), not 4.29', edit(base['03'], ['<Ctry>DE</Ctry></PstlAdr></Cdtr>', '<Ctry>de</Ctry></PstlAdr></Cdtr>']), '03', ['2.7']);
  {
    const b = base['09'];
    const xr = inner => edit(b, [/(<\/Amt>)(\s*<CdtrAgt>)/, `$1<XchgRateInf>${inner}</XchgRateInf>$2`]);
    const f = await expect4('.09 4.25 unit currency USD on a EUR transaction: part unit, a warning', xr('<UnitCcy>USD</UnitCcy><XchgRate>1.1</XchgRate>'), '09', { '4.25-unit:W': 1 });
    ok(f && f[0] && /USD/.test(f[0].message) && /EUR/.test(f[0].message), '.09 4.25 unit names both currencies', f && f[0] && f[0].message);
    await expect4('.09 4.25 unit currency EUR passes', xr('<UnitCcy>EUR</UnitCcy><XchgRate>1.1</XchgRate>'), '09', {});
    await expect4('.09 4.25 unit currency CZK of the debtor account passes', edit(xr('<UnitCcy>CZK</UnitCcy><XchgRate>25.1</XchgRate>'), [/(<DbtrAcct><Id><IBAN>[^<]*<\/IBAN><\/Id>)/, '$1<Ccy>CZK</Ccy>']), '09', {});
    await expect4('.09 4.23 unit currency XYZ (not also 4.25)', xr('<UnitCcy>XYZ</UnitCcy><XchgRate>1.1</XchgRate>'), '09', { '4.23:E': 1 });
  }
  {
    // 4.26: creditor agent for cross-border payments
    for (const v of VERSIONS) {
      const cb = gen.generate({ version: v, transactions: 2, blocks: 1, type: 'CROSS_BORDER', country: 'UA' });
      const noAgt = edit(cb, [/<CdtrAgt>.*?<\/CdtrAgt>/, '']);
      await expect4(`.${v} 4.26 cross-border payment without creditor agent`, noAgt, v, { '4.26:E': 1 }, { country: 'UA' });
      await expect4(`.${v} 4.26 clean cross-border payments pass`, cb, v, {}, { country: 'UA' });
      await expect4(`.${v} 4.26 SEPA payment without creditor agent passes (BIC optional)`, edit(base[v], [/<CdtrAgt>.*?<\/CdtrAgt>/, '']), v, {});
    }
  }
  {
    // 4.27: clearing system member ids, on any agent
    for (const v of VERSIONS) {
      const b = base[v];
      const clr = (cd, mmb) => `<ClrSysMmbId>${cd == null ? '' : `<ClrSysId>${cd}</ClrSysId>`}<MmbId>${mmb}</MmbId></ClrSysMmbId>`;
      const onCdtrAgt = (cd, mmb) => edit(b, [firstAgent(v), `<CdtrAgt><FinInstnId><${bic(v)}>DEMODEFF</${bic(v)}>${clr(cd, mmb)}</FinInstnId></CdtrAgt>`]);
      await expect4(`.${v} 4.27 USABA 026009593 passes`, onCdtrAgt('<Cd>USABA</Cd>', '026009593'), v, {});
      const f = await expect4(`.${v} 4.27 USABA 12345: part member`, onCdtrAgt('<Cd>USABA</Cd>', '12345'), v, { '4.27-member:E': 1 });
      ok(f && f[0] && /9 digits/.test(f[0].message) && /MmbId\[1\]$/.test(f[0].xpath), `.${v} 4.27 member: says the format, on MmbId`, f && f[0] && f[0].message);
      await expect4(`.${v} 4.27 GBDSC 20-00-00: part member`, onCdtrAgt('<Cd>GBDSC</Cd>', '20-00-00'), v, { '4.27-member:E': 1 });
      await expect4(`.${v} 4.27 system XXXXX: part code`, onCdtrAgt('<Cd>XXXXX</Cd>', '12345'), v, { '4.27-code:E': 1 });
      await expect4(`.${v} 4.27 a listed system without a known format (CZ) passes`, onCdtrAgt('<Cd>CZ</Cd>', 'anything'), v, {});
      await expect4(`.${v} 4.27 proprietary system (Prtry) is not checked`, onCdtrAgt('<Prtry>OWN</Prtry>', 'x1'), v, {});
      await expect4(`.${v} 4.27 member id without a system is not checked`, edit(b, [firstAgent(v), `<CdtrAgt><FinInstnId>${clr(null, '12')}</FinInstnId></CdtrAgt>`]), v, {});
      const agt = new RegExp(`<DbtrAgt><FinInstnId><${bic(v)}>DEMOATWW</${bic(v)}>`);
      const fd = await expect4(`.${v} 4.27 debtor agent ATBLZ 123: part member, block level`, edit(b, [agt, m => m + clr('<Cd>ATBLZ</Cd>', '123')]), v, { '4.27-member:E': 1 });
      ok(fd && fd[0] && fd[0].level === 'block', `.${v} 4.27 on the debtor agent is a block finding`);
      await expect4(`.${v} 4.27 intermediary agent DEBLZ 1234: part member`, edit(b, [firstAgent(v), m => `<IntrmyAgt1><FinInstnId>${clr('<Cd>DEBLZ</Cd>', '1234')}</FinInstnId></IntrmyAgt1>${m}`]), v, { '4.27-member:E': 1 });
    }
  }

  /* ---------------------------------------------------------------- postal addresses (4.30) */
  for (const v of VERSIONS) {
    const b = base[v];
    const cdtr = inner => edit(b, [CDTR_ADR, adr(inner)]);
    const S = '<StrtNm>Industriestrasse</StrtNm><BldgNb>1</BldgNb><PstCd>40210</PstCd>';
    await expect4(`.${v} 4.30 hybrid address with 2 lines passes`, cdtr(`${S}<TwnNm>Duesseldorf</TwnNm><Ctry>DE</Ctry><AdrLine>c/o Lager Nord</AdrLine><AdrLine>Tor 3</AdrLine>`), v, {});
    const fl = await expect4(`.${v} 4.30 hybrid address with 3 lines: part lines`, cdtr(`${S}<TwnNm>Duesseldorf</TwnNm><Ctry>DE</Ctry><AdrLine>a</AdrLine><AdrLine>b</AdrLine><AdrLine>c</AdrLine>`), v, { '4.30-lines:E': 1 });
    ok(fl && fl[0] && /Cdtr\[1\]\/PstlAdr\[1\]$/.test(fl[0].xpath) && fl[0].level === 'tx', `.${v} 4.30 is reported on the address`, fl && fl[0] && fl[0].xpath);
    const fm = await expect4(`.${v} 4.30 structured address without TwnNm: part missing`, cdtr(`${S}<Ctry>DE</Ctry>`), v, { '4.30-missing:E': 1 });
    ok(fm && fm[0] && /TwnNm/.test(fm[0].message) && !/Ctry/.test(fm[0].message), `.${v} 4.30 missing names TwnNm only`, fm && fm[0] && fm[0].message);
    await expect4(`.${v} 4.30 structured address without Ctry: part missing`, cdtr(`${S}<TwnNm>Duesseldorf</TwnNm>`), v, { '4.30-missing:E': 1 });
    await expect4(`.${v} 4.30 hybrid address without TwnNm and Ctry and 3 lines: parts missing and lines`, cdtr(`${S}<AdrLine>a</AdrLine><AdrLine>b</AdrLine><AdrLine>c</AdrLine>`), v, { '4.30-missing:E': 1, '4.30-lines:E': 1 });
    const fr = await expect4(`.${v} 4.30 address line repeats PstCd and TwnNm: part repeat`, cdtr(`${S}<TwnNm>Duesseldorf</TwnNm><Ctry>DE</Ctry><AdrLine>40210 Duesseldorf</AdrLine>`), v, { '4.30-repeat:E': 1 });
    ok(fr && fr[0] && /PstCd 40210/.test(fr[0].message) && /TwnNm Duesseldorf/.test(fr[0].message), `.${v} 4.30 repeat names what is repeated`, fr && fr[0] && fr[0].message);
    await expect4(`.${v} 4.30 address line repeats StrtNm (other case): part repeat`, cdtr(`${S}<TwnNm>Duesseldorf</TwnNm><Ctry>DE</Ctry><AdrLine>INDUSTRIESTRASSE 1</AdrLine>`), v, { '4.30-repeat:E': 1 });
    await expect4(`.${v} 4.30 town inside a longer word is not a repeat`, cdtr(`${S}<TwnNm>Duesseldorf</TwnNm><Ctry>DE</Ctry><AdrLine>Duesseldorfer Hof, 2. Stock</AdrLine>`), v, {});
    // unstructured (Ctry and AdrLine, or AdrLine only), Ctry only: 7.8 / 7.18 warn, 4.30 only when unstructured addresses are not allowed
    const unstr = cdtr('<Ctry>DE</Ctry><AdrLine>Industriestrasse 1</AdrLine><AdrLine>40210 Duesseldorf</AdrLine>');
    const lines = cdtr('<AdrLine>Industriestrasse 1</AdrLine><AdrLine>40210 Duesseldorf</AdrLine><AdrLine>Germany</AdrLine>');
    const ctryOnly = cdtr('<Ctry>DE</Ctry>');
    await expect4(`.${v} 4.30 unstructured address (Ctry and 2 AdrLine) passes by default`, unstr, v, {});
    await expect4(`.${v} 4.30 unstructured address (3 AdrLine) passes by default`, lines, v, {});
    await expect4(`.${v} 4.30 address with Ctry only passes by default`, ctryOnly, v, {});
    const off = { over: { guideline: { unstructuredAddress: false } } };
    await expect4(`.${v} 4.30 unstructuredAddress false: Ctry and AdrLine is part unstructured`, unstr, v, { '4.30-unstructured:E': 1 }, off);
    await expect4(`.${v} 4.30 unstructuredAddress false: AdrLine only is part unstructured`, lines, v, { '4.30-unstructured:E': 1 }, off);
    await expect4(`.${v} 4.30 unstructuredAddress false: Ctry only is part missing`, ctryOnly, v, { '4.30-missing:E': 1 }, off);
    await expect4(`.${v} 4.30 unstructuredAddress false: clean file passes`, b, v, {}, off);
    await expect4(`.${v} 4.30 unstructuredAddress null: unstructured allowed`, unstr, v, {}, { over: { guideline: { unstructuredAddress: null } } });
    // other addresses: debtor (block), agent, ultimate creditor
    const fdb = await expect4(`.${v} 4.30 debtor address without TwnNm: block level`, edit(b, [/(<Dbtr><Nm>[^<]*<\/Nm><PstlAdr>)<TwnNm>[^<]*<\/TwnNm>/, '$1<StrtNm>Ring 1</StrtNm>']), v, { '4.30-missing:E': 1 });
    ok(fdb && fdb[0] && fdb[0].level === 'block', `.${v} 4.30 on the debtor address is a block finding`);
    await expect4(`.${v} 4.30 creditor agent address with 3 lines: part lines`, edit(b, [firstAgent(v), `<CdtrAgt><FinInstnId><${bic(v)}>DEMODEFF</${bic(v)}><Nm>Demo Bank</Nm>${adr('<TwnNm>Duesseldorf</TwnNm><Ctry>DE</Ctry><AdrLine>a</AdrLine><AdrLine>b</AdrLine><AdrLine>c</AdrLine>')}</FinInstnId></CdtrAgt>`]), v, { '4.30-lines:E': 1 });
    await expect4(`.${v} 4.30 initiating party address without Ctry: file level`, edit(b, [INITG, `<InitgPty><Nm>Beispiel Handels GmbH</Nm>${adr('<TwnNm>Wien</TwnNm>')}</InitgPty>`]), v, { '4.30-missing:E': 1 });
  }
  {
    // .09: more structured elements; RmtLctnDtls/PstlAdr is a name and address (Nm, Adr)
    const b = base['09'];
    await expect4('.09 4.30 address with BldgNm and Ctry only: part missing', edit(b, [CDTR_ADR, adr('<BldgNm>Haus Nord</BldgNm><Ctry>DE</Ctry>')]), '09', { '4.30-missing:E': 1 });
    const rlt = inner => edit(b, [FIRST_RMT, m => `<RltdRmtInf><RmtLctnDtls><Mtd>POST</Mtd><PstlAdr><Nm>Buchhaltung</Nm><Adr>${inner}</Adr></PstlAdr></RmtLctnDtls></RltdRmtInf>${m}`]);
    await expect4('.09 4.30 remittance location address (Nm and Adr) passes, also when unstructured addresses are not allowed', rlt('<TwnNm>Wien</TwnNm><Ctry>AT</Ctry>'), '09', {}, { over: { guideline: { unstructuredAddress: false } } });
    const fa = await expect4('.09 4.30 remittance location address without TwnNm: on Adr', rlt('<StrtNm>Ring 1</StrtNm><Ctry>AT</Ctry>'), '09', { '4.30-missing:E': 1 });
    ok(fa && fa[0] && /PstlAdr\[1\]\/Adr\[1\]$/.test(fa[0].xpath), '.09 4.30 the remittance location address is checked on Adr', fa && fa[0] && fa[0].xpath);
    const r03 = edit(base['03'], [FIRST_RMT, m => `<RltdRmtInf><RmtLctnMtd>POST</RmtLctnMtd><RmtLctnPstlAdr><Nm>Buchhaltung</Nm><Adr><StrtNm>Ring 1</StrtNm><Ctry>AT</Ctry></Adr></RmtLctnPstlAdr></RltdRmtInf>${m}`]);
    await expect4('.03 4.30 remittance location address (RmtLctnPstlAdr/Adr) without TwnNm', r03, '03', { '4.30-missing:E': 1 });
  }

  /* ---------------------------------------------------------------- codes */
  for (const v of VERSIONS) {
    const b = base[v];
    const instr = cd => edit(b, [/(<CdtrAcct>.*?<\/CdtrAcct>)/, `$1<InstrForCdtrAgt><Cd>${cd}</Cd></InstrForCdtrAgt>`]);
    await expect4(`.${v} 4.33 instruction HOLD passes (default list)`, instr('HOLD'), v, {});
    await expect4(`.${v} 4.33 instructionCodes [PHOB]: HOLD not supported`, instr('HOLD'), v, { '4.33:E': 1 }, { over: { guideline: { instructionCodes: ['PHOB'] } } });
    await expect4(`.${v} 4.33 instructionCodes []: none supported`, instr('PHOB'), v, { '4.33:E': 1 }, { over: { guideline: { instructionCodes: [] } } });
    await expect4(`.${v} 4.33 instructionCodes null: not checked`, instr('HOLD'), v, {}, { over: { guideline: { instructionCodes: null } } });
    const purp = cd => edit(b, [FIRST_RMT, m => `<Purp><Cd>${cd}</Cd></Purp>${m}`]);
    await expect4(`.${v} 4.34 purpose SALA passes`, purp('SALA'), v, {});
    const f34 = await expect4(`.${v} 4.34 purpose ZZZZ`, purp('ZZZZ'), v, { '4.34:E': 1 });
    ok(f34 && f34[0] && /ZZZZ/.test(f34[0].message) && /Purp\[1\]\/Cd\[1\]$/.test(f34[0].xpath), `.${v} 4.34 names the code, on Purp/Cd`);
    await expect4(`.${v} 4.35 category purpose ZZZZ (block)`, edit(b, [SEPA_PTI, '<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><CtgyPurp><Cd>ZZZZ</Cd></CtgyPurp></PmtTpInf>']), v, { '4.35:E': 1 });
    await expect4(`.${v} 4.35 category purpose SUPP passes`, edit(b, [SEPA_PTI, '<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><CtgyPurp><Cd>SUPP</Cd></CtgyPurp></PmtTpInf>']), v, {});
    await expect4(`.${v} 4.36 service level SEPX`, edit(b, ['<SvcLvl><Cd>SEPA</Cd></SvcLvl>', '<SvcLvl><Cd>SEPX</Cd></SvcLvl>']), v, { '4.36:E': 1 });
    const lcl = inner => edit(b, [SEPA_PTI, `<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm>${inner}</LclInstrm></PmtTpInf>`]);
    await expect4(`.${v} 4.37 local instrument INST passes`, lcl('<Cd>INST</Cd>'), v, {});
    await expect4(`.${v} 4.37 local instrument INSX: part code`, lcl('<Cd>INSX</Cd>'), v, { '4.37-code:E': 1 });
    await expect4(`.${v} 4.37 proprietary local instrument, setting [] (default): part proprietary`, lcl('<Prtry>EXPRESS</Prtry>'), v, { '4.37-proprietary:E': 1 });
    await expect4(`.${v} 4.37 proprietary local instrument in the setting passes`, lcl('<Prtry>EXPRESS</Prtry>'), v, {}, { over: { guideline: { localInstrumentProprietary: ['EXPRESS'] } } });
    await expect4(`.${v} 4.37 localInstrumentProprietary null: not checked`, lcl('<Prtry>EXPRESS</Prtry>'), v, {}, { over: { guideline: { localInstrumentProprietary: null } } });
  }
  {
    const b = base['09'];
    await expect4('.09 4.36 two service levels, the second unknown: one finding', edit(b, ['<SvcLvl><Cd>SEPA</Cd></SvcLvl>', '<SvcLvl><Cd>SEPA</Cd></SvcLvl><SvcLvl><Cd>ABCD</Cd></SvcLvl>']), '09', { '4.36:E': 1 });
    await expect4('.09 4.36 SEPA Instant file (INST, SEPA) passes', gen.generate({ version: '09', transactions: 2, type: 'SEPA_INST', country: 'SK' }), '09', {}, { country: 'SK' });
    await expectReport('4.34 a purpose code of 5 characters is the XSD (2.6), not 4.34', edit(base['03'], [FIRST_RMT, m => `<Purp><Cd>ABCDE</Cd></Purp>${m}`]), '03', ['2.6']);
    await expectReport('4.33 an instruction code XXXX is the XSD (2.8), not 4.33', edit(base['03'], [/(<CdtrAcct>.*?<\/CdtrAcct>)/, '$1<InstrForCdtrAgt><Cd>XXXX</Cd></InstrForCdtrAgt>']), '03', ['2.8']);
    const rep = await validate(edit(base['03'], ['<SvcLvl><Cd>SEPA</Cd></SvcLvl>', '<SvcLvl><Cd>SEPX</Cd></SvcLvl>']), '03');
    const g = rep.groups.find(x => x.rule === '4.36');
    ok(g && g.title && g.hint && g.code === 'FF04' && g.level === 'block', '4.36 in the report: title, hint, reason code FF04, block level', g && JSON.stringify([g.title, g.code, g.level]));
  }

  /* ---------------------------------------------------------------- remittance (4.38, 4.39) */
  for (const v of VERSIONS) {
    const b = base[v];
    const rmt = inner => edit(b, [FIRST_RMT, `<RmtInf>${inner}</RmtInf>`]);
    const strd = ref => `<Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${ref}</Ref></CdtrRefInf></Strd>`;
    const two = rmt('<Ustrd>Invoice 1</Ustrd><Ustrd>Invoice 2</Ustrd>');
    const both = rmt(`<Ustrd>Invoice 1</Ustrd>${strd('RF18539007547034')}`);
    await expect4(`.${v} 4.38 two Ustrd, maxUstrd 1 (default): part count`, two, v, { '4.38-count:E': 1 });
    await expect4(`.${v} 4.38 maxUstrd 2: two Ustrd pass`, two, v, {}, { over: { guideline: { remittance: { maxUstrd: 2 } } } });
    await expect4(`.${v} 4.38 maxUstrd null: not counted`, two, v, {}, { over: { guideline: { remittance: { maxUstrd: null } } } });
    await expect4(`.${v} 4.38 two Strd, maxStrd 1 (default): part count`, rmt(strd('RF18539007547034') + strd('RF18539007547034')), v, { '4.38-count:E': 1 });
    const fb = await expect4(`.${v} 4.38 Ustrd and Strd, combined false (default): part combined`, both, v, { '4.38-combined:E': 1 });
    ok(fb && fb[0] && /RmtInf\[1\]$/.test(fb[0].xpath), `.${v} 4.38 is reported on RmtInf`, fb && fb[0] && fb[0].xpath);
    await expect4(`.${v} 4.38 combined true: Ustrd and Strd pass`, both, v, {}, { over: { guideline: { remittance: { combined: true } } } });
    await expect4(`.${v} 4.38 combined null: not checked`, both, v, {}, { over: { guideline: { remittance: { combined: null } } } });
    await expect4(`.${v} 4.39 SCOR RF18539007547034 passes`, rmt(strd('RF18539007547034')), v, {});
    const f39 = await expect4(`.${v} 4.39 SCOR RF19539007547034: wrong check digits`, rmt(strd('RF19539007547034')), v, { '4.39:E': 1 });
    ok(f39 && f39[0] && /Ref\[1\]$/.test(f39[0].xpath) && /RF19539007547034/.test(f39[0].message), `.${v} 4.39 is reported on Ref with the value`);
    await expect4(`.${v} 4.39 SCOR rf18 5390 0754 7034 (lower case, spaces) passes`, rmt(strd('rf18 5390 0754 7034')), v, {});
    await expect4(`.${v} 4.39 SCOR RF18-539007 (a character that is not allowed)`, rmt(strd('RF18-539007')), v, { '4.39:E': 1 });
    await expect4(`.${v} 4.39 SCOR reference that is not RF (1234567) is not checked`, rmt(strd('1234567')), v, {});
    await expect4(`.${v} 4.39 SCOR reference RFQ-2026 is not an RF reference`, rmt(strd('RFQ-2026')), v, {});
    await expect4(`.${v} 4.39 a reference of another type is not checked`, rmt(strd('RF19539007547034').replace('<Cd>SCOR</Cd>', '<Cd>CINV</Cd>')), v, {});
  }

  /* ---------------------------------------------------------------- regulatory reporting (4.40) */
  for (const v of VERSIONS) {
    const b = base[v];
    const rr = ctry => edit(b, [FIRST_RMT, m => `<RgltryRptg><DbtCdtRptgInd>DEBT</DbtCdtRptgInd><Dtls><Ctry>${ctry}</Ctry><Cd>101</Cd><Inf>Goods</Inf></Dtls></RgltryRptg>${m}`]);
    await expect4(`.${v} 4.40 regulatory reporting for DE passes`, rr('DE'), v, {});
    await expect4(`.${v} 4.40 details country QQ: part country`, rr('QQ'), v, { '4.40-country:E': 1 });
    await expect4(`.${v} 4.40 regulatoryReporting false: part allowed`, rr('DE'), v, { '4.40-allowed:E': 1 }, { over: { guideline: { regulatoryReporting: false } } });
    await expect4(`.${v} 4.40 regulatoryReporting null: not checked`, rr('DE'), v, {}, { over: { guideline: { regulatoryReporting: null } } });
  }
  await expectReport('4.40 a details code of 11 characters is the XSD (2.6), not 4.40', edit(base['03'], [FIRST_RMT, m => `<RgltryRptg><Dtls><Cd>12345678901</Cd></Dtls></RgltryRptg>${m}`]), '03', ['2.6']);

  /* ---------------------------------------------------------------- report and settings */
  {
    // a part can be switched off or changed in settings.checks, like any check
    const lcl = edit(base['03'], [SEPA_PTI, '<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Prtry>EXPRESS</Prtry></LclInstrm></PmtTpInf>']);
    const offRep = await validate(lcl, '03', 'AT', { checks: { '4.37-proprietary': { enabled: false } } });
    ok(!offRep.groups.some(g => g.rule === '4.37') && offRep.disabled['4.37-proprietary'] === 1, 'checks."4.37-proprietary".enabled false: dropped and counted', JSON.stringify(offRep.disabled));
    const wRep = await validate(lcl, '03', 'AT', { checks: { '4.37-proprietary': { severity: 'W' } } });
    const g = wRep.groups.find(x => x.rule === '4.37');
    ok(g && g.severity === 'W' && g.part === 'proprietary' && g.title === t.catalogue.rules['4.37'].parts.proprietary.title, 'checks."4.37-proprietary".severity W: a warning with the title of the part', g && JSON.stringify([g.severity, g.title]));
    // every assert of stage 4 has a catalogue title and hint, and every part its own title
    const cat = t.catalogue.rules;
    const missing = [];
    for (let n = 1; n <= 40; n++) { const c = cat[`4.${n}`]; if (!c || !c.title || !c.hint) missing.push(`4.${n}`); else for (const [p, x] of Object.entries(c.parts || {})) if (!x.title || !x.hint) missing.push(`4.${n}-${p}`); }
    ok(!missing.length, 'catalogue: every stage-4 check and part has a title and a hint', missing.join(', '));
  }
};
