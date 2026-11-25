/*
 * Testing Portal – tests of stage 6 (CMIplus guideline). With the default
 * settings most checks find nothing, so each check is tested with settings
 * changed through the `over` argument of validate (and null = off).
 */
'use strict';
module.exports = async t => {
  const { ok, head, gen, validate, TP, clean03, clean09 } = t;
  const base = v => (v === '09' ? clean09 : clean03);
  const ids = rep => rep.groups.filter(g => g.stage === 6).map(g => g.rule + (g.part ? '-' + g.part : '')).sort().join(',');
  const edit = (xml, a, b) => { const out = xml.replace(a, b); if (out === xml) throw new Error(`edit not applied: ${a}`); return out; };
  async function expect(label, xml, v, want, opts = {}) {
    const rep = await validate(xml, v, opts.country || 'AT', opts.over);
    const got = ids(rep);
    const g = want ? rep.groups.find(x => x.rule + (x.part ? '-' + x.part : '') === (opts.of || want.split(',')[0])) : null;
    const checks = [
      !want || !opts.sev || (g && g.severity === opts.sev),
      !want || opts.code === undefined || (g && g.code === opts.code),
      !opts.msg || (g && opts.msg.test(g.items[0].message)),
      !opts.count || (g && g.count === opts.count),
      !opts.level || (g && g.level === opts.level)
    ];
    ok(got === (want || '') && checks.every(Boolean), `${label} (.${v})`, `got ${got}${g ? ` | ${g.severity} ${g.code} ${g.level} x${g.count} | ${g.items[0].message}` : ''}`);
    return rep;
  }
  const G = o => ({ guideline: o });

  head('stage 6: element lists (6.1, 6.2)');
  for (const v of ['03', '09']) {
    await expect('6.1 transaction: Purp/Cd mandatory', base(v), v, '6.1', { over: G({ mandatory: { transaction: ['Purp/Cd'] } }), sev: 'E', code: 'CH21', count: 20, level: 'tx', msg: /has no Purp\/Cd/ });
    await expect('6.2-forbidden transaction: RmtInf/Ustrd', base(v), v, '6.2-forbidden', { over: G({ forbidden: { transaction: ['RmtInf/Ustrd'] } }), sev: 'E', code: 'CH17', count: 20 });
  }
  await expect('6.1 file: InitgPty/Id mandatory', clean03, '03', '6.1', { over: G({ mandatory: { file: ['InitgPty/Id'] } }), level: 'file', msg: /group header has no InitgPty\/Id/ });
  await expect('6.1 block: two paths, one missing', clean03, '03', '6.1', { over: G({ mandatory: { block: ['Dbtr/PstlAdr/Ctry', 'UltmtDbtr'] } }), level: 'block', count: 2, msg: /has no UltmtDbtr,/ });
  await expect('6.1 present elements: no finding', clean03, '03', '', { over: G({ mandatory: { file: ['InitgPty/Nm'], block: ['DbtrAgt'], transaction: ['Cdtr/PstlAdr/Ctry', 'RmtInf'] } }) });
  await expect('6.2-ignored block: BtchBookg', clean03, '03', '6.2-ignored', { over: G({ ignored: { block: ['BtchBookg'] } }), sev: 'W', code: 'CH17', count: 2, level: 'block' });
  await expect('6.2-forbidden file: InitgPty/Nm', clean03, '03', '6.2-forbidden', { over: G({ forbidden: { file: ['InitgPty/Nm'] } }), level: 'file' });
  await expect('6.1 and 6.2 lists null: off', clean03, '03', '', { over: G({ mandatory: null, forbidden: null, ignored: null }) });

  head('stage 6: occurrences and lengths (6.3, 6.4)');
  const twoUstrd = v => edit(base(v), '<Ustrd>Invoice 4000</Ustrd>', '<Ustrd>Invoice 4000</Ustrd><Ustrd>Second line</Ustrd>');
  for (const v of ['03', '09']) {
    await expect('6.3 two Ustrd (RmtInf/Ustrd 1)', twoUstrd(v), v, '6.3', { over: G({ maxOccurs: { 'RmtInf/Ustrd': 1 } }), sev: 'E', code: 'CH17', count: 1, level: 'tx', msg: /RmtInf contains Ustrd 2 times \(at most 1\)/ });
    await expect('6.3 two Ustrd with the default settings: left to 4.38 (remittance.maxUstrd)', twoUstrd(v), v, '');
  }
  await expect('6.3 limit 2: no finding', twoUstrd('03'), '03', '', { over: G({ maxOccurs: { 'RmtInf/Ustrd': 2 } }) });
  await expect('6.3 maxOccurs null: off', twoUstrd('03'), '03', '', { over: G({ maxOccurs: null }) });
  await expect('6.3 the most specific key wins (Ustrd 1, RmtInf/Ustrd null)', twoUstrd('03'), '03', '', { over: G({ maxOccurs: { Ustrd: 1, 'RmtInf/Ustrd': null } }) });
  await expect('6.3 three AdrLine in the debtor address (block level)', edit(clean03, '<Dbtr><Nm>Beispiel Handels GmbH</Nm><PstlAdr><TwnNm>Wien</TwnNm><Ctry>AT</Ctry>', '<Dbtr><Nm>Beispiel Handels GmbH</Nm><PstlAdr><TwnNm>Wien</TwnNm><Ctry>AT</Ctry><AdrLine>a</AdrLine><AdrLine>b</AdrLine><AdrLine>c</AdrLine>'), '03', '6.3',
    { level: 'block', msg: /Dbtr\/PstlAdr contains AdrLine 3 times \(at most 2\)/ });
  const longName = v => edit(base(v), '<Nm>Lindenhof Metall GmbH</Nm>', `<Nm>${'Lindenhof Metall '.repeat(5)}GmbH</Nm>`);
  for (const v of ['03', '09']) {
    await expect('6.4 creditor name of 89 characters (default Nm 70)', longName(v), v, '6.4', { sev: 'E', code: 'CH16', count: 1, msg: /Cdtr\/Nm has 89 characters; the CMIplus guideline allows 70/ });
  }
  await expect('6.4 limit 100: no finding', longName('03'), '03', '', { over: G({ maxLength: { Nm: 100 } }) });
  await expect('6.4 Cdtr/Nm null switches the limit off for the creditor', longName('03'), '03', '', { over: G({ maxLength: { Nm: 70, 'Cdtr/Nm': null } }) });
  await expect('6.4 RmtInf/Ustrd 10: every remittance text', clean03, '03', '6.4', { over: G({ maxLength: { 'RmtInf/Ustrd': 10 } }), count: 20, msg: /RmtInf\/Ustrd has 12 characters/ });
  await expect('6.4 counts characters, not bytes (70 umlauts)', edit(clean03, '<Nm>Lindenhof Metall GmbH</Nm>', `<Nm>${'ä'.repeat(70)}</Nm>`), '03', '');

  head('stage 6: file limits (6.5)');
  await expect('6.5-file 10 transactions allowed', clean03, '03', '6.5-file', { over: { limits: { maxTransactionsPerFile: 10 } }, sev: 'E', code: 'NARR', level: 'file', msg: /20 transactions; CMIplus accepts at most 10/ });
  await expect('6.5-blocks 1 block allowed', clean09, '09', '6.5-blocks', { over: { limits: { maxBlocksPerFile: 1 } }, level: 'file' });
  await expect('6.5-block 5 transactions per block', clean03, '03', '6.5-block', { over: { limits: { maxTransactionsPerBlock: 5 } }, level: 'block', count: 2 });
  await expect('6.5 limits at the counts: no finding', clean03, '03', '', { over: { limits: { maxTransactionsPerFile: 20, maxBlocksPerFile: 2, maxTransactionsPerBlock: 10 } } });

  head('stage 6: currencies (6.6)');
  // 6.6 checks only what the country file lists per payment type; the currency of SEPA, SEPA Instant and
  // domestic payments is checked by stage 7 (7.1, 7.10, 7.13) (decided at the merge, 2026-11-18)
  const C = currencies => ({ _country: { currencies } });
  const usd = v => edit(base(v), 'Ccy="EUR"', 'Ccy="USD"');
  for (const v of ['03', '09']) {
    await expect('6.6 SEPA payment in USD, country file SEPA: EUR', usd(v), v, '6.6', { over: C({ SEPA: ['EUR'] }), sev: 'E', code: 'AM03', count: 1, msg: /USD is not supported for SEPA credit transfer payments in AT; supported: EUR/ });
    await expect('6.6 SEPA payment in USD, no currencies in the country file: left to stage 7', usd(v), v, '');
  }
  const czDom = gen.generate({ version: '03', transactions: 4, blocks: 1, type: 'DOMESTIC', country: 'CZ' });
  await expect('6.6 CZ domestic payment in USD, country file DOMESTIC: CZK', edit(czDom, 'Ccy="CZK"', 'Ccy="USD"'), '03', '6.6', { country: 'CZ', over: C({ DOMESTIC: ['CZK'] }), msg: /USD is not supported for Domestic standard payments in CZ; supported: CZK/ });
  await expect('6.6 CZ domestic payment in CZK or EUR listed: no finding', edit(czDom, 'Ccy="CZK"', 'Ccy="EUR"'), '03', '', { country: 'CZ', over: C({ DOMESTIC: ['CZK', 'EUR'], SEPA: ['EUR'] }) });
  await expect('6.6 cross-border payment in any currency', gen.generate({ version: '09', transactions: 4, blocks: 1, type: 'CROSS_BORDER', country: 'UA' }).replace(/Ccy="USD"/g, 'Ccy="JPY"').replace(/(<InstdAmt Ccy="JPY">\d+)\.\d+/g, '$1'), '09', '', { country: 'UA' });
  await expect('6.6 cross-border list in the country file', gen.generate({ version: '09', transactions: 4, blocks: 1, type: 'CROSS_BORDER', country: 'UA' }), '09', '6.6', { country: 'UA', over: C({ CROSS_BORDER: ['EUR'] }), count: 4 });
  await expect('6.6 EqvtAmt: the currency of transfer counts', edit(clean03, /<Amt><InstdAmt Ccy="EUR">([^<]*)<\/InstdAmt><\/Amt>/, '<Amt><EqvtAmt><Amt Ccy="EUR">$1</Amt><CcyOfTrf>USD</CcyOfTrf></EqvtAmt></Amt>'), '03', '6.6', { over: C({ SEPA: ['EUR'] }), msg: /currency USD/ });
  {
    const F = TP.functions;
    const ctx = t.contextFor('CZ');
    TP.context = { ...ctx, countryConfig: { ...ctx.countryConfig, currencies: { DOMESTIC: ['CZK', 'EUR'], CROSS_BORDER: ['USD', 'EUR'], SEPA: null } } };
    ok(F.tpCurrenciesFor('DOMESTIC') === 'CZK EUR' && F.tpCurrenciesFor('CROSS_BORDER') === 'USD EUR' && F.tpCurrenciesFor('SEPA') === '' && F.tpCurrenciesFor('SEPA_INST') === ''
      && F.tpCurrenciesFor('DOMESTIC_URGENT') === '' && F.tpCurrenciesFor('INTRA_BANK') === '' && F.tpCurrenciesFor('BUDGET') === '' && F.tpCurrenciesFor('') === '',
    '6.6 country currencies per type: only the listed types are checked; null = any',
    ['DOMESTIC', 'CROSS_BORDER', 'SEPA', 'SEPA_INST', 'DOMESTIC_URGENT', 'INTRA_BANK', 'BUDGET'].map(x => `${x}=${F.tpCurrenciesFor(x)}`).join(' '));
  }

  head('stage 6: batch booking (6.8)');
  const batch = v => base(v).replace(/<BtchBookg>false<\/BtchBookg>/g, '<BtchBookg>true</BtchBookg>');
  await expect('batch booking true, one currency: no finding', batch('03'), '03', '');
  for (const v of ['03', '09']) {
    await expect('6.8-allowed batch booking not supported', batch(v), v, '6.8-allowed', { over: G({ batchBooking: { allowed: false } }), sev: 'E', code: 'NARR', count: 2, level: 'block' });
    await expect('6.8-currency batch booking with EUR and USD in one block', edit(batch(v), 'Ccy="EUR"', 'Ccy="USD"'), v, '6.8-currency', { of: '6.8-currency', msg: /2 currencies \(USD, EUR\)/ });
  }
  await expect('6.8 singleCurrencyPerBlock false', edit(batch('03'), 'Ccy="EUR"', 'Ccy="USD"'), '03', '', { over: G({ batchBooking: { singleCurrencyPerBlock: false } }) });
  await expect('6.8 batchBooking null: off', edit(batch('03'), 'Ccy="EUR"', 'Ccy="USD"'), '03', '', { over: G({ batchBooking: null }) });
  await expect('6.8 BtchBookg 1 counts as true', base('03').replace(/<BtchBookg>false<\/BtchBookg>/g, '<BtchBookg>1</BtchBookg>'), '03', '6.8-allowed', { over: G({ batchBooking: { allowed: false } }) });

  head('stage 6: code subsets, initiating party id (6.9, 6.10)');
  for (const v of ['03', '09']) {
    await expect('6.9-svclvl SEPA outside the subset', base(v), v, '6.9-svclvl', { over: G({ codes: { serviceLevel: ['URGP'] } }), sev: 'E', code: 'FF04', count: 2 });
  }
  await expect('6.9 SEPA inside the subset', clean03, '03', '', { over: G({ codes: { serviceLevel: ['SEPA', 'URGP'] } }) });
  await expect('6.9 an empty list checks nothing', clean03, '03', '', { over: G({ codes: { serviceLevel: [] } }) });
  const purp = (xml, cd) => xml.replace(/<RmtInf>/g, `<Purp><Cd>${cd}</Cd></Purp><RmtInf>`);
  await expect('6.9-purp GDDS outside the subset', purp(clean03, 'GDDS'), '03', '6.9-purp', { over: G({ codes: { purpose: ['SALA'] } }), code: 'FF07', count: 20 });
  await expect('6.9 a code not in the ISO list is 4.34, not 6.9', purp(clean03, 'QQQQ'), '03', '', { over: G({ codes: { purpose: ['SALA'] } }) });
  await expect('6.9-ctgypurp TAXS outside the subset (RO budget payment)', gen.generate({ version: '09', transactions: 3, blocks: 1, type: 'BUDGET', country: 'RO' }), '09', '6.9-ctgypurp', { country: 'RO', over: G({ codes: { categoryPurpose: ['SALA'] } }), code: 'FF06' });
  await expect('6.9-lclinstrm INST outside the subset', gen.generate({ version: '03', transactions: 3, blocks: 1, type: 'SEPA_INST', country: 'AT' }), '03', '6.9-lclinstrm', { over: G({ codes: { localInstrument: ['SDCL'] } }), code: 'FF05' });
  const initg = (xml, id) => edit(xml, '<InitgPty><Nm>Beispiel Handels GmbH</Nm>', `<InitgPty><Nm>Beispiel Handels GmbH</Nm><Id><OrgId><Othr><Id>${id}</Id></Othr></OrgId></Id>`);
  for (const v of ['03', '09']) {
    await expect('6.10 initiating party id not 8 digits', initg(base(v), '12345'), v, '6.10', { over: G({ initiatingPartyIdPattern: '^[0-9]{8}$' }), sev: 'E', code: 'NARR', level: 'file', msg: /"12345" does not have the format/ });
  }
  await expect('6.10 matching id', initg(clean03, '12345678'), '03', '', { over: G({ initiatingPartyIdPattern: '^[0-9]{8}$' }) });
  await expect('6.10 pattern null (default): off', initg(clean03, '12345'), '03', '');
  {
    const rep = await validate(initg(clean03, '1'), '03', 'AT', G({ initiatingPartyIdPattern: '([' }));
    const g = rep.groups.find(x => x.rule === '6.10');
    ok(g && /setting guideline\.initiatingPartyIdPattern is not a valid regular expression/.test(g.items[0].message) && !rep.groups.some(x => /engine/.test(x.rule)), 'an invalid pattern is reported in 6.10, the other checks still run', g ? g.items[0].message : ids(rep));
  }

  head('stage 6: debtor accounts and agents, ultimate parties (6.11, 6.12)');
  for (const v of ['03', '09']) {
    await expect('6.11-accounts two debtor accounts', base(v), v, '6.11-accounts', { over: G({ multipleDebtorAccounts: false }), sev: 'E', code: 'NARR', level: 'file', msg: /2 debtor accounts \(AT/ });
  }
  const bic = v => (v === '09' ? 'BICFI' : 'BIC');
  const secondAgent = v => { const b = base(v); const i = b.lastIndexOf(`<DbtrAgt><FinInstnId><${bic(v)}>DEMOATWW`); return b.slice(0, i) + `<DbtrAgt><FinInstnId><${bic(v)}>DEMOATW2XXX` + b.slice(i + `<DbtrAgt><FinInstnId><${bic(v)}>DEMOATWW`.length); };
  for (const v of ['03', '09']) {
    await expect('6.11-agents two debtor agents', secondAgent(v), v, '6.11-agents', { over: G({ multipleDebtorAgents: false }), level: 'file', msg: /2 debtor agents \(DEMOATWW, DEMOATW2\)/ });
  }
  await expect('6.11 the same bank with and without branch code is one agent', base('03').replace(/(<DbtrAgt><FinInstnId><BIC>DEMOATWW)(<\/BIC>)(?![\s\S]*<DbtrAgt>)/, '$1XXX$2'), '03', '', { over: G({ multipleDebtorAgents: false }) });
  await expect('6.11 default (allowed): no finding', secondAgent('03'), '03', '');
  const ultimate = v => edit(edit(base(v), '<ChrgBr>SLEV</ChrgBr>', '<UltmtDbtr><Nm>Beispiel Tochter GmbH</Nm></UltmtDbtr><ChrgBr>SLEV</ChrgBr>'), /(<\/CdtrAcct>)/, '$1<UltmtCdtr><Nm>Lindenhof Holding</Nm></UltmtCdtr>');
  for (const v of ['03', '09']) {
    await expect('6.12 ultimate parties not supported', ultimate(v), v, '6.12-cdtr,6.12-dbtr', { over: G({ ultimateParties: false }), sev: 'W', code: 'CH17' });
  }
  await expect('6.12 supported only for cross-border payments', ultimate('03'), '03', '6.12-cdtr,6.12-dbtr', { over: G({ ultimateParties: ['CROSS_BORDER'] }), msg: /SEPA credit transfer payments/ });
  await expect('6.12 supported for SEPA', ultimate('03'), '03', '', { over: G({ ultimateParties: ['SEPA', 'SEPA_INST'] }) });
  await expect('6.12 default (true): no finding', ultimate('03'), '03', '');
  await expect('6.12 UltmtDbtr on the transaction', edit(clean03, /(<\/Amt>)/, '$1<UltmtDbtr><Nm>X</Nm></UltmtDbtr>'), '03', '6.12-dbtr', { over: G({ ultimateParties: false }), level: 'tx' });
};
