/*
 * Testing Portal – tests of stage 5 (character set, identifiers and field formats).
 * Failing files are clean generated files with one text replaced.
 */
'use strict';
module.exports = async t => {
  const { ok, head, gen, validate, TP, clean03, clean09 } = t;
  const base = v => (v === '09' ? clean09 : clean03);
  const groups = (rep, rule) => rep.groups.filter(g => g.rule === rule);
  const ids = rep => rep.groups.filter(g => /^[56]\./.test(g.rule)).map(g => g.rule + (g.part ? '-' + g.part : '')).sort().join(',');
  // one replacement; the test fails if the text was not found
  const edit = (xml, a, b) => { const out = xml.replace(a, b); if (out === xml) throw new Error(`edit not applied: ${a}`); return out; };
  // the report has exactly the stage 5–6 findings `want` ("5.1" or "5.6-cdtr"), with severity and code
  async function expect(label, xml, v, want, opts = {}) {
    const rep = await validate(xml, v, opts.country || 'AT', opts.over);
    const got = ids(rep);
    const g = want ? rep.groups.find(x => x.rule + (x.part ? '-' + x.part : '') === want.split(',')[0]) : null;
    const sevOk = !want || !opts.sev || (g && g.severity === opts.sev);
    const codeOk = !want || opts.code === undefined || (g && g.code === opts.code);
    const msgOk = !opts.msg || (g && opts.msg.test(g.items[0].message));
    const countOk = !opts.count || (g && g.count === opts.count);
    ok(got === (want || '') && sevOk && codeOk && msgOk && countOk, `${label} (.${v})`, `got ${got}${g ? ` | ${g.severity} ${g.code} x${g.count} | ${g.items[0].message}` : ''}`);
    return rep;
  }

  head('stage 5: clean files (stages 5 and 6)');
  {
    // SEPA types only in SEPA countries (UA is not one)
    const sepaTypes = ['SEPA', 'SEPA_INST'];
    const where = type => (sepaTypes.includes(type) ? ['AT', 'CZ', 'RO'] : ['AT', 'CZ', 'RO', 'UA']);
    const bad = [], info = new Map();
    let runs = 0;
    for (const type of gen.TYPES) for (const country of where(type)) for (const v of ['03', '09']) {
      const xml = gen.generate({ version: v, transactions: 6, blocks: 2, type, country, uetr: v === '09', lei: v === '09' });
      const r = await t.rules(xml, v, country);
      runs++;
      for (const f of r.findings) {
        if (!(f.stage === 5 || f.stage === 6)) continue;
        if (f.severity === 'I') info.set(f.rule, (info.get(f.rule) || 0) + 1);
        else bad.push(`${type} ${country} .${v}: ${f.rule}${f.part ? '-' + f.part : ''} ${f.message}`);
      }
    }
    ok(bad.length === 0, `${runs} clean files (every type, its countries, .03 and .09 with UETR and LEI): no error or warning of stages 5 and 6`, bad.slice(0, 5).join('\n'));
    ok(info.size === 0, 'and no information hint of stages 5 and 6', [...info].join(', '));
  }

  head('stage 5: character set (5.1, 5.2)');
  for (const v of ['03', '09']) {
    await expect('5.1 "&" in a SEPA creditor name', edit(base(v), '<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>Lindenhof &amp; Metall GmbH</Nm>'), v, '5.1',
      { sev: 'E', code: 'RR10', count: 1, msg: /Cdtr\/Nm, "Lindenhof & Metall GmbH".*SEPA character set: &\. Allowed are A–Z a–z 0–9 \/ - \? : \( \) \. , ' \+ and space/ });
    await expect('5.2 "ü" in a SEPA creditor name: transliterated', edit(base(v), '<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>Lindenhöf Müller GmbH</Nm>'), v, '5.2',
      { sev: 'W', code: 'RR10', msg: /ö→o ü→u/ });
  }
  {
    const v = '03';
    await expect('5.1 and 5.2 both: "Müller & Co"', edit(clean03, '<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>Müller &amp; Co</Nm>'), v, '5.1,5.2');
    await expect('5.2 a no-break space is shown as U+00A0', edit(clean03, '<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>Lindenhof Metall GmbH</Nm>'), v, '5.2', { msg: /U\+00A0→space/ });
    await expect('5.1 a zero-width space is shown as U+200B', edit(clean03, '<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>Lindenhof​Metall GmbH</Nm>'), v, '5.1', { msg: /: U\+200B\./ });
    await expect('5.1 header value (InitgPty/Nm) uses the country set of AT: "€" not allowed', edit(clean03, '<InitgPty><Nm>Beispiel Handels GmbH</Nm>', '<InitgPty><Nm>Beispiel € GmbH</Nm>'), v, '5.1',
      { msg: /InitgPty\/Nm.*character set "basic-latin" of AT: €/ });
    await expect('header value with "&" or "#": allowed in the country set of AT', edit(edit(clean03, '<InitgPty><Nm>Beispiel Handels GmbH</Nm>', '<InitgPty><Nm>Beispiel &amp; Handels GmbH</Nm>'), /<MsgId>MSG-/, '<MsgId>MSG#'), v, '');
    await expect('5.1 block value (Dbtr/Nm) of a SEPA block uses the SEPA set', edit(clean03, '<Dbtr><Nm>Beispiel Handels GmbH</Nm>', '<Dbtr><Nm>Beispiel &amp; Handels GmbH</Nm>'), v, '5.1', { count: 1, msg: /Dbtr\/Nm.*SEPA character set/ });
    const cz = gen.generate({ version: '03', transactions: 4, blocks: 1, type: 'DOMESTIC', country: 'CZ' });
    await expect('CZ domestic payment: "&" allowed in the country set', edit(cz, /<Nm>Lindenhof Metall GmbH<\/Nm>/, '<Nm>Lindenhof &amp; Metall</Nm>'), v, '', { country: 'CZ' });
    await expect('5.1 CZ domestic, country set changed (setting charsets.basic-latin)', edit(cz, /<Nm>Lindenhof Metall GmbH<\/Nm>/, '<Nm>Lindenhof &amp; Metall</Nm>'), v, '5.1',
      { country: 'CZ', over: { charsets: { 'basic-latin': "A-Za-z0-9/\\-?:().,'+ " } }, msg: /"basic-latin" of CZ: &/ });
    const ua = gen.generate({ version: '09', transactions: 4, blocks: 1, type: 'CROSS_BORDER', country: 'UA' });
    await expect('5.1 cross-border payment uses the SWIFT X set', edit(ua, /<Nm>Lindenhof Metall GmbH<\/Nm>/, '<Nm>Lindenhof &amp; Metall</Nm>'), '09', '5.1', { country: 'UA', msg: /SWIFT X character set: &/ });
    await expect('a set that is null switches 5.1 off for it (charsets.sepa null)', edit(clean03, '<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>Lindenhof &amp; Metall GmbH</Nm>'), v, '', { over: { charsets: { sepa: null } } });
    {
      // a set without "-", ":" and ".": the ids with "-" are reported, the dates, amounts and IBANs are not
      const rep = await validate(clean03, v, 'AT', { charsets: { 'basic-latin': 'A-Za-z0-9 ', sepa: 'A-Za-z0-9 ' } });
      const places = rep.groups.filter(g => g.rule === '5.1').flatMap(g => g.items.map(i => i.xpath.replace(/\[\d+\]/g, '').split('/').pop()));
      ok(places.includes('MsgId') && places.includes('EndToEndId') && !places.some(p => /CreDtTm|ReqdExctnDt|CtrlSum|InstdAmt|IBAN|BIC/.test(p)),
        'typed values (dates, amounts, IBAN) are left to the XSD for 5.1, text values are checked', [...new Set(places)].join(' '));
    }
  }

  head('stage 5: control characters, spaces, reference ids (5.3–5.5)');
  for (const v of ['03', '09']) {
    await expect('5.3 a tab inside the remittance text', edit(base(v), '<Ustrd>Invoice 4000</Ustrd>', '<Ustrd>Invoice&#9;4000</Ustrd>'), v, '5.3', { sev: 'E', code: 'RR10', msg: /control characters: tab/ });
  }
  await expect('5.3 a line break inside a name', edit(clean03, '<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>Lindenhof\nMetall GmbH</Nm>'), '03', '5.3', { msg: /line break/ });
  await expect('5.4 a line break at the end is 5.4 only, not 5.3', edit(clean03, '<Ustrd>Invoice 4000</Ustrd>', '<Ustrd>Invoice 4000\n</Ustrd>'), '03', '5.4-spaces');
  await expect('5.4 leading space', edit(clean03, '<Ustrd>Invoice 4000</Ustrd>', '<Ustrd> Invoice 4000</Ustrd>'), '03', '5.4-spaces', { sev: 'E', code: 'CH16' });
  {
    const rep = await validate(edit(clean09, /<Dt>([0-9-]+)<\/Dt>/, '<Dt>$1 </Dt>'), '09');
    ok(ids(rep) === '' && rep.suppressed.some(i => i.rule === '5.4') && rep.groups.some(g => g.rule === '2.10'), 'a date with a trailing space: the XSD reports it (2.10), 5.4 is suppressed', ids(rep));
  }
  // review 2026-11-19: a blank debtor name is 4.15 only; ultimate debtor name of spaces with an Id is 5.4-blank
  await expect('5.4 debtor name of spaces only: left to 4.15', edit(clean03, '<Dbtr><Nm>Beispiel Handels GmbH</Nm>', '<Dbtr><Nm>   </Nm>'), '03', '');
  await expect('5.4 ultimate debtor name of spaces with an Id', edit(clean03, '<ChrgBr>SLEV</ChrgBr>', '<UltmtDbtr><Nm>   </Nm><Id><OrgId><Othr><Id>X1</Id></Othr></OrgId></Id></UltmtDbtr><ChrgBr>SLEV</ChrgBr>'), '03', '5.4-blank', { sev: 'E', count: 1 });
  {
    const rep = await validate(edit(clean03, '<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>   </Nm>'), '03');
    ok(ids(rep) === '' && rep.groups.some(g => g.rule === '4.28'), 'a creditor name of spaces only is 4.28, not 5.4', ids(rep));
  }
  for (const v of ['03', '09']) {
    await expect('5.5 EndToEndId starting with "/"', edit(base(v), '<EndToEndId>E2E-000001</EndToEndId>', '<EndToEndId>/E2E-000001</EndToEndId>'), v, '5.5', { sev: 'E', code: 'CH16', msg: /EndToEndId "\/E2E-000001" starts with "\/"/ });
  }
  await expect('5.5 InstrId with "//"', edit(clean03, '<InstrId>INS-000001</InstrId>', '<InstrId>INS//000001</InstrId>'), '03', '5.5', { msg: /contains "\/\/"/ });
  await expect('5.5 PmtInfId ending with "/"', edit(clean03, '<PmtInfId>PMT-01</PmtInfId>', '<PmtInfId>PMT-01/</PmtInfId>'), '03', '5.5', { msg: /ends with "\/"/ });
  await expect('a "/" inside an id is fine', edit(clean03, '<EndToEndId>E2E-000001</EndToEndId>', '<EndToEndId>E2E/000001</EndToEndId>'), '03', '');

  head('stage 5: IBAN, BIC, country codes, LEI, scheme codes (5.6–5.12)');
  const ibanOf = xml => /<CdtrAcct><Id><IBAN>([^<]+)</.exec(xml)[1];
  const dbtrIban = xml => /<DbtrAcct><Id><IBAN>([^<]+)</.exec(xml)[1];
  const wrongCheck = ib => ib.slice(0, 2) + String((+ib.slice(2, 4) + 1) % 100).padStart(2, '0') + ib.slice(4);
  for (const v of ['03', '09']) {
    const b = base(v);
    await expect('5.6-dbtr wrong check digits', edit(b, dbtrIban(b), wrongCheck(dbtrIban(b))), v, '5.6-dbtr', { sev: 'E', code: 'AC02', count: 1, msg: /debtor IBAN .* check digits are wrong/ });
    await expect('5.6-cdtr wrong length', edit(b, `<IBAN>${ibanOf(b)}</IBAN>`, `<IBAN>${ibanOf(b)}1</IBAN>`), v, '5.6-cdtr', { code: 'AC03', msg: /has 23 characters; an IBAN of DE has 22/ });
  }
  await expect('5.6-cdtr country without IBAN', edit(clean03, `<IBAN>${ibanOf(clean03)}</IBAN>`, `<IBAN>${gen.iban('US', '12345678901234')}</IBAN>`), '03', '5.6-cdtr', { msg: /US is not a country of the IBAN registry/ });
  await expect('5.6-cdtr BBAN structure (letters in an Austrian IBAN)', edit(clean03, `<IBAN>${ibanOf(clean03)}</IBAN>`, `<IBAN>${gen.iban('AT', 'ABCDE00000000001')}</IBAN>`), '03', '5.6-cdtr', { msg: /structure of an IBAN of AT/ });
  await expect('5.6-other: IBAN of the creditor agent account', edit(clean03, /(<\/CdtrAgt>)/, `$1<CdtrAgtAcct><Id><IBAN>${wrongCheck(ibanOf(clean03))}</IBAN></Id></CdtrAgtAcct>`), '03', '5.6-other', { code: 'AC01', msg: /IBAN of CdtrAgtAcct/ });
  {
    const rep = await validate(edit(clean03, '<ChrgBr>SLEV</ChrgBr>', `<ChrgBr>SLEV</ChrgBr><ChrgsAcct><Id><IBAN>${wrongCheck(dbtrIban(clean03))}</IBAN></Id></ChrgsAcct>`), '03');
    ok(!rep.groups.some(g => g.rule === '5.6'), 'the charges account IBAN is left to 4.18 (no 5.6)', ids(rep));
  }
  for (const [v, tag] of [['03', 'BIC'], ['09', 'BICFI']]) {
    await expect(`5.7 ${tag} with country code QQ`, edit(base(v), `<${tag}>DEMODEFF</${tag}>`, `<${tag}>DEMOQQFF</${tag}>`), v, '5.7', { sev: 'E', code: 'RC01', msg: /"QQ" \(characters 5–6\)/ });
    await expect(`5.8 test ${tag} (8th character 0)`, edit(base(v), `<${tag}>DEMOATWW</${tag}>`, `<${tag}>DEMOATW0</${tag}>`), v, '5.8', { sev: 'W', code: 'RC01', count: 1, msg: /DbtrAgt is a test BIC/ });
  }
  await expect('5.7 BIC as an organisation id (BICOrBEI)', edit(clean03, '<InitgPty><Nm>Beispiel Handels GmbH</Nm>', '<InitgPty><Nm>Beispiel Handels GmbH</Nm><Id><OrgId><BICOrBEI>DEMOQQWW</BICOrBEI></OrgId></Id>'), '03', '5.7', { msg: /of InitgPty/ });
  await expect('5.7 .09 AnyBIC', edit(clean09, '<InitgPty><Nm>Beispiel Handels GmbH</Nm>', '<InitgPty><Nm>Beispiel Handels GmbH</Nm><Id><OrgId><AnyBIC>DEMOQQWW</AnyBIC></OrgId></Id>'), '09', '5.7');
  for (const v of ['03', '09']) {
    await expect('5.10 debtor country QQ', edit(base(v), /(<Dbtr><Nm>[^<]*<\/Nm><PstlAdr><TwnNm>[^<]*<\/TwnNm><Ctry>)AT/, '$1QQ'), v, '5.10', { sev: 'E', code: 'BE09', count: 1, msg: /"QQ" of Dbtr\/PstlAdr\/Ctry/ });
  }
  {
    const rep = await validate(edit(clean03, '<Ctry>DE</Ctry></PstlAdr></Cdtr>', '<Ctry>QQ</Ctry></PstlAdr></Cdtr>'), '03');
    ok(!rep.groups.some(g => g.rule === '5.10'), 'the creditor country is left to 4.29 (no 5.10)', ids(rep));
    const xk = await validate(edit(clean03, /(<Dbtr><Nm>[^<]*<\/Nm><PstlAdr><TwnNm>[^<]*<\/TwnNm><Ctry>)AT/, '$1XK'), '03');
    ok(!xk.groups.some(g => g.rule === '5.10'), 'XK (Kosovo) is a valid country code');
  }
  {
    const lei09 = gen.generate({ version: '09', transactions: 4, blocks: 1, lei: true });
    const lei = /<LEI>([^<]+)</.exec(lei09)[1];
    const badLei = lei.slice(0, 18) + String((+lei.slice(18) + 1) % 100).padStart(2, '0');
    await expect('5.11 LEI with wrong check digits', edit(lei09, `<LEI>${lei}</LEI>`, `<LEI>${badLei}</LEI>`), '09', '5.11', { sev: 'E', code: 'CH16', msg: /Dbtr\/Id\/OrgId\/LEI/ });
  }
  const withId = (xml, id) => edit(xml, /(<\/PstlAdr>)(<\/Cdtr>)/, `$1<Id>${id}</Id>$2`);
  for (const v of ['03', '09']) {
    await expect('5.12-org unknown organisation id scheme', withId(base(v), '<OrgId><Othr><Id>123</Id><SchmeNm><Cd>XXXX</Cd></SchmeNm></Othr></OrgId>'), v, '5.12-org', { sev: 'W', code: null, msg: /organisation id of Cdtr/ });
  }
  await expect('5.12-prvt unknown private id scheme', withId(clean03, '<PrvtId><Othr><Id>123</Id><SchmeNm><Cd>XXXX</Cd></SchmeNm></Othr></PrvtId>'), '03', '5.12-prvt');
  await expect('known scheme codes TXID and ARNU', withId(withId(clean03, '<OrgId><Othr><Id>123</Id><SchmeNm><Cd>TXID</Cd></SchmeNm></Othr></OrgId>'), '<PrvtId><Othr><Id>9</Id><SchmeNm><Cd>ARNU</Cd></SchmeNm></Othr></PrvtId>'), '03', '');

  head('stage 5: functions');
  {
    const F = TP.functions;
    TP.context = t.contextFor('AT');
    ok(F.tpCharsetChars('basic-latin') === 'U+0020–U+007E', 'the set basic-latin is described with code points', F.tpCharsetChars('basic-latin'));
    ok(F.tpControlChars('a\tb\nc\u0085') === 'tab, line break, U+0085', 'control characters in words', F.tpControlChars('a\tb\nc\u0085'));
  }
};
