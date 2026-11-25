'use strict';
/*
 * Tests of stage 7, payment-type rules (rules/stages/07-payment-types.sch).
 * Every check: a file that breaks it (id, part, severity, level) and clean files that pass;
 * settings: the default, a changed value and null. Failing files are clean generated files
 * with text replaced; they pass the XSD.
 */
module.exports = async t => {
  const { ok, head, gen, validate, TP } = t;

  // ---------- helpers (as in 03-context.test.js)
  const change = (xml, a, b, all) => { const out = all ? xml.split(a).join(b) : xml.replace(a, b); if (out === xml) throw new Error(`test edit did not change the file: ${a}`); return out; };
  const groupsOf = (rep, id) => { const [rule, part = null] = id.split('-'); return rep.groups.filter(g => g.rule === rule && (g.part || null) === part); };
  const show = rep => JSON.stringify(rep.groups.map(g => [g.rule + (g.part ? '-' + g.part : ''), g.severity, g.level, g.count, g.items[0].message.slice(0, 200)]));
  async function withCountry(patch, fn) {
    const core = TP.rulesCore, orig = core.runRuleSets;
    core.runRuleSets = (S, sets, xml, v, c, ctx) => orig(S, sets, xml, v, c, { ...ctx, countryConfig: { ...ctx.countryConfig, ...patch } });
    try { return await fn(); } finally { core.runRuleSets = orig; }
  }
  // settings where no guideline check covers the SEPA limits of 7.6
  const OWN_NAMES = { guideline: { maxLength: { Nm: null } } };
  const OWN_RMT = { guideline: { remittance: { combined: true, maxUstrd: null, maxStrd: null } } };
  async function fails(label, xml, v, country, id, want = {}, over, now) {
    const rep = await validate(xml, v, country, over, now);
    const gs = groupsOf(rep, id), g = gs[0];
    const good = gs.length === 1 && g.severity === (want.sev || 'E') && (!want.level || g.level === want.level) && (want.count == null || g.count === want.count)
      && (want.code === undefined || g.code === want.code) && (!want.msg || want.msg.test(g.items[0].message)) && !rep.groups.some(x => x.source === 'xsd' || /engine/.test(x.rule));
    ok(good, `${id} ${label} (.${v})`, show(rep));
    return rep;
  }
  async function passes(label, xml, v, country, ids, over, now) {
    const rep = await validate(xml, v, country, over, now);
    const hit = rep.groups.filter(g => ids.includes(g.rule) || ids.includes(`${g.rule}-${g.part}`) || /engine/.test(g.rule) || g.source === 'xsd');
    ok(!hit.length, `${label} (.${v}): no ${ids.join(', ')}`, show(rep));
    return rep;
  }
  const NOW = new Date(2026, 10, 18, 10, 0, 0); // 18 November 2026, 10:00 local time
  const file = (v, o = {}) => gen.generate({ version: v, transactions: 4, blocks: 2, now: NOW, ...o });
  const noSum = x => x.replace(/<CtrlSum>[^<]*<\/CtrlSum>/g, '');
  const firstAmount = (x, val) => change(noSum(x), /(<InstdAmt Ccy="[A-Z]{3}">)[^<]*/, `$1${val}`);
  const BIC = '<BIC(?:FI)?>';
  const re = s => new RegExp(s.replace(/<BIC>/g, BIC).replace(/<\/BIC>/g, '</BIC(?:FI)?>'));
  const long = n => 'N'.repeat(n);
  const deIban = gen.iban('DE', '999999990000002000'), trIban = gen.iban('TR', '0006100519786457841326');
  const chIban = gen.iban('CH', '00762011623852957'), gbIban = gen.iban('GB', 'NWBK60161331926819');
  const onDate = (x, v, d) => x.replace(v === '09' ? /<ReqdExctnDt><Dt>[^<]*<\/Dt><\/ReqdExctnDt>/g : /<ReqdExctnDt>[^<]*<\/ReqdExctnDt>/g,
    v === '09' ? `<ReqdExctnDt><Dt>${d}</Dt></ReqdExctnDt>` : `<ReqdExctnDt>${d}</ReqdExctnDt>`).replace(/<CreDtTm>[^<]*<\/CreDtTm>/, '<CreDtTm>2026-11-18T09:00:00</CreDtTm>');

  head('stage 7: payment-type rules');

  // ---------- clean files: no error or warning of stage 7 where the type applies; hints listed
  {
    const bad = [], hints = new Set();
    for (const country of gen.COUNTRIES) for (const type of gen.TYPES) for (const v of ['03', '09']) {
      if ((type === 'SEPA' || type === 'SEPA_INST') && !TP.functions.list('sepa').has(country)) continue; // 3.6
      const rep = await validate(gen.generate({ version: v, transactions: 3, blocks: 1, type, country, uetr: v === '09', lei: v === '09' }), v, country);
      for (const g of rep.groups.filter(x => x.stage === 7 || /engine/.test(x.rule))) { if (g.severity === 'I') hints.add(`${g.rule} on ${type}`); else bad.push(`${country} ${type} .${v}: ${show(rep)}`); }
    }
    ok(!bad.length, 'clean files of every type and country, .03 and .09: no stage-7 error or warning', bad.join('\n'));
    ok([...hints].sort().join(', ') === '7.26 on INTRA_BANK, 7.27 on BUDGET', 'clean files: the only stage-7 hints are 7.26 (intra-bank) and 7.27 (budget)', [...hints].join(', '));
  }

  for (const v of ['03', '09']) {
    const sepa = file(v), inst = file(v, { type: 'SEPA_INST', country: 'SK' }), xb = file(v, { type: 'CROSS_BORDER' });
    const atDom = file(v, { type: 'DOMESTIC' }); // EUR to AT creditors, no service level: SEPA
    const czDom = file(v, { type: 'DOMESTIC', country: 'CZ' }), czUrg = file(v, { type: 'DOMESTIC_URGENT', country: 'CZ' });

    // ---------- 7.1 SEPA: EUR
    await fails('SEPA credit transfer in USD', change(sepa, 'Ccy="EUR"', 'Ccy="USD"'), v, 'AT', '7.1', { level: 'tx', count: 1, code: 'AM03', msg: /currency is USD/ });
    await fails('SEPA credit transfer with EqvtAmt transferred in USD', change(sepa, /<Amt><InstdAmt Ccy="EUR">([^<]*)<\/InstdAmt><\/Amt>/, '<Amt><EqvtAmt><Amt Ccy="EUR">$1</Amt><CcyOfTrf>USD</CcyOfTrf></EqvtAmt></Amt>'), v, 'AT', '7.1', { count: 1 });
    await passes('SEPA Instant in USD is 7.10, not 7.1', change(inst, 'Ccy="EUR"', 'Ccy="USD"'), v, 'SK', ['7.1']);

    // ---------- 7.2 SEPA, SEPA Instant: creditor IBAN of a SEPA country
    await fails('creditor IBAN of Turkey with service level SEPA', change(sepa, /(<CdtrAcct><Id><IBAN>)[^<]*/, `$1${trIban}`), v, 'AT', '7.2', { level: 'tx', count: 1, code: 'AC03', msg: /TR, which is not in the SEPA scheme/ });
    await fails('creditor account not an IBAN', change(sepa, /<CdtrAcct><Id><IBAN>[^<]*<\/IBAN>/, '<CdtrAcct><Id><Othr><Id>12345678</Id></Othr>'), v, 'AT', '7.2', { count: 1, msg: /12345678, which is not an IBAN/ });
    await fails('SEPA Instant to a Turkish IBAN', change(inst, /(<CdtrAcct><Id><IBAN>)[^<]*/, `$1${trIban}`), v, 'SK', '7.2', { count: 1 });

    // ---------- 7.3 SEPA: every service level given is SEPA
    const nurg = change(atDom, '<ReqdExctnDt>', '<PmtTpInf><SvcLvl><Cd>NURG</Cd></SvcLvl></PmtTpInf><ReqdExctnDt>');
    // review 2026-11-19: a payment with another service level than SEPA is not an implicit SEPA payment (cross-border here)
    await passes('EUR within SEPA with service level NURG: not SEPA, so no 7.3', nurg, v, 'AT', ['7.3']);
    await passes('a code outside the ISO list is left to 4.36', change(atDom, '<ReqdExctnDt>', '<PmtTpInf><SvcLvl><Cd>XXXX</Cd></SvcLvl></PmtTpInf><ReqdExctnDt>'), v, 'AT', ['7.3']);
    if (v === '09') await fails('.09: service levels SEPA and URGP', change(sepa, '<SvcLvl><Cd>SEPA</Cd></SvcLvl>', '<SvcLvl><Cd>SEPA</Cd></SvcLvl><SvcLvl><Cd>URGP</Cd></SvcLvl>'), v, 'AT', '7.3', { count: 2, msg: /URGP is given/ });

    // ---------- 7.4 SEPA, SEPA Instant: charge bearer SLEV
    await fails('SEPA with SHAR', change(sepa, '<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SHAR</ChrgBr>'), v, 'AT', '7.4', { count: 2, code: 'CH16' });
    await fails('EUR within SEPA without service level (SEPA by payment type) with DEBT: a warning', change(atDom, '<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>DEBT</ChrgBr>'), v, 'AT', '7.4-implicit', { count: 2, sev: 'W' });
    await fails('SEPA Instant with SHAR', change(inst, '<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SHAR</ChrgBr>'), v, 'SK', '7.4', { count: 2, msg: /SEPA Instant/ });

    // ---------- 7.5 SEPA, SEPA Instant: amount limits (settings limits.sepaMinAmount, limits.sepaMaxAmount)
    const big = firstAmount(sepa, '1000000000.00');
    await fails('amount above 999,999,999.99', big, v, 'AT', '7.5', { level: 'tx', count: 1, code: 'AM02', msg: /above the SEPA maximum of 999999999\.99 EUR/ });
    await passes('sepaMaxAmount null', big, v, 'AT', ['7.5'], { limits: { sepaMaxAmount: null } });
    await fails('sepaMaxAmount 1000000000.00 changed down to 100.00', sepa, v, 'AT', '7.5', {}, { limits: { sepaMaxAmount: '100.00' } });
    const small = firstAmount(sepa, '50.00');
    await fails('sepaMinAmount 100.00, an amount of 50.00', small, v, 'AT', '7.5', { count: 1, msg: /below the SEPA minimum of 100 EUR/ }, { limits: { sepaMinAmount: '100.00' } });
    await passes('default minimum 0.01, an amount of 50.00', small, v, 'AT', ['7.5']);
    const zero = await validate(firstAmount(sepa, '0.00'), v, 'AT');
    ok(groupsOf(zero, '4.21').length === 1 && !groupsOf(zero, '7.5').length, `7.5 an amount of zero is 4.21 only (.${v})`, show(zero));

    // ---------- 7.6 SEPA, SEPA Instant: names at most 70, one remittance part
    // With the default settings 6.4 (guideline.maxLength Nm 70) and 4.38 (guideline.remittance) report these
    // problems for every payment type, so 7.6 leaves them to those checks (merge 2026-11-18).
    await passes('creditor name of 71 characters, default settings: 6.4 only', change(sepa, '<Nm>Lindenhof Metall GmbH</Nm>', `<Nm>${long(71)}</Nm>`), v, 'AT', ['7.6']);
    await passes('two unstructured remittance lines, default settings: 4.38 only', change(sepa, '<Ustrd>Invoice 4000</Ustrd>', '<Ustrd>Invoice 1</Ustrd><Ustrd>Invoice 2</Ustrd>'), v, 'AT', ['7.6']);
    await fails('creditor name of 71 characters, 6.4 switched off in checks', change(sepa, '<Nm>Lindenhof Metall GmbH</Nm>', `<Nm>${long(71)}</Nm>`), v, 'AT', '7.6-name', { count: 1 }, { checks: { '6.4': { enabled: false } } });
    await fails('creditor name of 71 characters', change(sepa, '<Nm>Lindenhof Metall GmbH</Nm>', `<Nm>${long(71)}</Nm>`), v, 'AT', '7.6-name', { level: 'tx', count: 1, code: 'CH15', msg: /creditor name has 71 characters/ }, OWN_NAMES);
    await passes('creditor name of 70 characters', change(sepa, '<Nm>Lindenhof Metall GmbH</Nm>', `<Nm>${long(70)}</Nm>`), v, 'AT', ['7.6']);
    await fails('debtor name of 71 characters', change(sepa, '<Dbtr><Nm>Beispiel Handels GmbH</Nm>', `<Dbtr><Nm>${long(71)}</Nm>`), v, 'AT', '7.6-name', { level: 'block', count: 1, msg: /Payment block PMT-01: the debtor name/ }, OWN_NAMES);
    await fails('ultimate creditor name of 71 characters', change(sepa, '</CdtrAcct>', `</CdtrAcct><UltmtCdtr><Nm>${long(71)}</Nm></UltmtCdtr>`), v, 'AT', '7.6-name', { count: 1, msg: /ultimate creditor/ }, OWN_NAMES);
    await fails('SEPA Instant ultimate debtor of the block, 71 characters', change(inst, '<ChrgBr>SLEV</ChrgBr>', `<UltmtDbtr><Nm>${long(71)}</Nm></UltmtDbtr><ChrgBr>SLEV</ChrgBr>`), v, 'SK', '7.6-name', { level: 'block', count: 1 }, OWN_NAMES);
    await passes('cross-border creditor name of 71 characters: not a SEPA rule', change(xb, '<Nm>Lindenhof Metall GmbH</Nm>', `<Nm>${long(71)}</Nm>`), v, 'AT', ['7.6']);
    await fails('two unstructured remittance lines', change(sepa, '<Ustrd>Invoice 4000</Ustrd>', '<Ustrd>Invoice 1</Ustrd><Ustrd>Invoice 2</Ustrd>'), v, 'AT', '7.6-rmt', { level: 'tx', count: 1, code: 'CH15', msg: /2 unstructured and 0 structured/ }, OWN_RMT);
    const strd = '<Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>RF18539007547034</Ref></CdtrRefInf></Strd>';
    await fails('one unstructured and one structured part', change(sepa, '<Ustrd>Invoice 4000</Ustrd>', `<Ustrd>Invoice 1</Ustrd>${strd}`), v, 'AT', '7.6-rmt', { count: 1 }, OWN_RMT);
    await passes('one structured part only', change(sepa, '<Ustrd>Invoice 4000</Ustrd>', strd), v, 'AT', ['7.6'], OWN_RMT);

    // ---------- 7.8 SEPA, SEPA Instant: unstructured address (warning; setting guideline.unstructuredAddress)
    const adrDe = /<PstlAdr><StrtNm>Industriestrasse<\/StrtNm><BldgNb>1<\/BldgNb><PstCd>40210<\/PstCd><TwnNm>Duesseldorf<\/TwnNm><Ctry>DE<\/Ctry><\/PstlAdr>/;
    const unstr = change(sepa, adrDe, '<PstlAdr><Ctry>DE</Ctry><AdrLine>Industriestrasse 1</AdrLine><AdrLine>40210 Duesseldorf</AdrLine></PstlAdr>');
    await fails('creditor address with country and address lines only', unstr, v, 'AT', '7.8', { sev: 'W', level: 'tx', count: 1, code: null, msg: /creditor address of a SEPA payment is unstructured/ });
    await fails('creditor address lines only', change(sepa, adrDe, '<PstlAdr><AdrLine>Industriestrasse 1, 40210 Duesseldorf</AdrLine></PstlAdr>'), v, 'AT', '7.8', { sev: 'W', count: 1 });
    await fails('debtor address lines only', change(sepa, '<PstlAdr><TwnNm>Wien</TwnNm><Ctry>AT</Ctry></PstlAdr>', '<PstlAdr><AdrLine>Wien</AdrLine></PstlAdr>'), v, 'AT', '7.8', { sev: 'W', level: 'block', count: 1, msg: /Payment block PMT-01: the debtor address/ });
    await passes('hybrid address (town, country and an address line)', change(sepa, adrDe, '<PstlAdr><TwnNm>Duesseldorf</TwnNm><Ctry>DE</Ctry><AdrLine>Industriestrasse 1</AdrLine></PstlAdr>'), v, 'AT', ['7.8']);
    await passes('guideline.unstructuredAddress false (4.30 reports it)', unstr, v, 'AT', ['7.8'], { guideline: { unstructuredAddress: false } });
    await passes('guideline.unstructuredAddress null', unstr, v, 'AT', ['7.8'], { guideline: { unstructuredAddress: null } });

    // ---------- 7.9 SEPA, SEPA Instant: debtor address for a creditor's bank in a non-EEA SEPA country
    const toCh = change(change(sepa, /(<CdtrAcct><Id><IBAN>)[^<]*/, `$1${chIban}`), re('<CdtrAgt><FinInstnId><BIC>DEMODEFF</BIC>'), `<CdtrAgt><FinInstnId><${v === '09' ? 'BICFI' : 'BIC'}>DEMOCHZZ</${v === '09' ? 'BICFI' : 'BIC'}>`);
    const noDbtrAdr = x => change(x, '<PstlAdr><TwnNm>Wien</TwnNm><Ctry>AT</Ctry></PstlAdr>', '');
    await fails('creditor bank in CH, block without debtor address', noDbtrAdr(toCh), v, 'AT', '7.9', { level: 'tx', count: 1, code: 'CH21', msg: /in CH, a SEPA country outside the EEA/ });
    await passes('creditor bank in CH, debtor address given', toCh, v, 'AT', ['7.9']);
    await fails('creditor IBAN of GB, no creditor agent, no debtor address', noDbtrAdr(change(change(sepa, /(<CdtrAcct><Id><IBAN>)[^<]*/, `$1${gbIban}`), re('<CdtrAgt><FinInstnId><BIC>DEMODEFF</BIC></FinInstnId></CdtrAgt>'), '')), v, 'AT', '7.9', { count: 1, msg: /in GB/ });
    await passes('creditor banks in the EEA, no debtor address', noDbtrAdr(sepa), v, 'AT', ['7.9']);

    // ---------- 7.10 SEPA Instant: EUR
    await fails('SEPA Instant in USD', change(inst, 'Ccy="EUR"', 'Ccy="USD"'), v, 'SK', '7.10', { level: 'tx', count: 1, code: 'FF05', msg: /currency is USD/ });

    // ---------- 7.11 SEPA Instant: executed today (setting guideline.scheduledInstant); the time of the check is fixed
    const instOn = d => onDate(inst, v, d);
    await fails('SEPA Instant dated tomorrow', instOn('2026-11-19'), v, 'SK', '7.11', { level: 'block', count: 2, code: 'NARR', msg: /2026-11-19 is in the future, but its 2 SEPA Instant payments/ }, null, NOW);
    await passes('SEPA Instant dated today', instOn('2026-11-18'), v, 'SK', ['7.11'], null, NOW);
    await passes('the same file checked a day later', instOn('2026-11-19'), v, 'SK', ['7.11'], null, new Date(2026, 10, 19, 10, 0, 0));
    await passes('guideline.scheduledInstant true', instOn('2026-11-19'), v, 'SK', ['7.11'], { guideline: { scheduledInstant: true } }, NOW);
    const past = await validate(instOn('2026-11-17'), v, 'SK', null, NOW);
    ok(groupsOf(past, '4.10').length === 1 && !groupsOf(past, '7.11').length, `7.11 a date in the past is 4.10 only (.${v})`, show(past));
    await passes('a SEPA credit transfer dated tomorrow', onDate(sepa, v, '2026-11-19'), v, 'AT', ['7.11'], null, NOW);
    if (v === '09') await fails('.09: SEPA Instant with a date and time tomorrow', change(inst, /<ReqdExctnDt><Dt>[^<]*<\/Dt><\/ReqdExctnDt>/, '<ReqdExctnDt><DtTm>2026-11-19T10:00:00</DtTm></ReqdExctnDt>'), v, 'SK', '7.11', { count: 1, msg: /2026-11-19 is in the future/ }, null, NOW);

    // ---------- 7.12 SEPA Instant: limit (setting limits.instantMaxAmount, default null)
    await fails('instantMaxAmount 100.00', inst, v, 'SK', '7.12', { level: 'tx', code: 'AM02', msg: /limit for SEPA Instant payments of 100 EUR/ }, { limits: { instantMaxAmount: '100.00' } });
    await passes('instantMaxAmount null (default)', inst, v, 'SK', ['7.12']);

    // ---------- 7.13 domestic: local currency
    await fails('domestic payment in CZ in USD', change(czDom, 'Ccy="CZK"', 'Ccy="USD"'), v, 'CZ', '7.13', { level: 'tx', count: 1, code: 'AM03', sev: 'W', msg: /must be in CZK, but the currency is USD/ });
    await fails('domestic urgent payment in CZ in USD', change(czUrg, 'Ccy="CZK"', 'Ccy="USD"'), v, 'CZ', '7.13', { count: 1, sev: 'W' });
    await fails('domestic payment in CZ in USD, settings checks."7.13" back to an error', change(czDom, 'Ccy="CZK"', 'Ccy="USD"'), v, 'CZ', '7.13', { count: 1, sev: 'E' }, { checks: { '7.13': { severity: 'E' } } });
    const czEur = await validate(change(czDom, 'Ccy="CZK"', 'Ccy="EUR"'), v, 'CZ');
    ok(czEur.blocks[0].txs[0].type === 'SEPA' && !groupsOf(czEur, '7.13').length, `7.13 EUR to a CZ creditor is a SEPA payment, not domestic (.${v})`, show(czEur));

    // ---------- 7.14 domestic: creditor IBAN of the country (a foreign IBAN makes the payment cross-border)
    const czDe = await validate(change(czDom, /(<CdtrAcct><Id><IBAN>)[^<]*/, `$1${deIban}`), v, 'CZ');
    ok(czDe.blocks[0].txs[0].type === 'CROSS_BORDER' && !groupsOf(czDe, '7.14').length, `7.14 a German creditor IBAN in a CZK payment: cross-border, so 7.14 cannot fire (.${v})`, show(czDe));

    // ---------- 7.15 domestic: service level and local instrument in the country's lists (null = any)
    const dom = (patch, fn) => withCountry({ domestic: { serviceLevels: null, localInstruments: null, highValueThreshold: null, ...patch } }, fn);
    await dom({ serviceLevels: ['NURG'] }, () => fails('URGP, the country allows NURG', czUrg, v, 'CZ', '7.15', { level: 'tx', count: 4, code: 'FF04', msg: /service level URGP is not used for domestic payments in CZ\. Allowed in CZ: service levels NURG/ }));
    await dom({ serviceLevels: ['URGP'] }, () => passes('URGP, the country allows URGP', czUrg, v, 'CZ', ['7.15']));
    await dom({ serviceLevels: [] }, () => fails('URGP, the country allows no service level', czUrg, v, 'CZ', '7.15', { count: 4, msg: /service levels none/ }));
    await passes('country lists null (default)', czUrg, v, 'CZ', ['7.15']);
    const oncl = change(czDom, '<ReqdExctnDt>', '<PmtTpInf><LclInstrm><Cd>ONCL</Cd></LclInstrm></PmtTpInf><ReqdExctnDt>');
    await dom({ localInstruments: ['SDCL'] }, () => fails('local instrument ONCL, the country allows SDCL', oncl, v, 'CZ', '7.15', { count: 2, msg: /local instrument ONCL/ }));

    // ---------- 7.16 domestic standard: high-value threshold (country domestic.highValueThreshold, default null)
    await dom({ highValueThreshold: '1000.00' }, () => fails('threshold 1000.00 CZK', czDom, v, 'CZ', '7.16', { sev: 'W', level: 'tx', code: null, msg: /above the high-value threshold of 1000 CZK/ }));
    await dom({ highValueThreshold: '1000.00' }, () => passes('threshold 1000.00 CZK, urgent payments', czUrg, v, 'CZ', ['7.16']));
    await passes('threshold null (default)', czDom, v, 'CZ', ['7.16']);

    // ---------- 7.17 cross-border: creditor agent BIC, or clearing id with name and address
    const clr = '<ClrSysMmbId><MmbId>026009593</MmbId></ClrSysMmbId>';
    await fails('creditor agent with a clearing member id only', change(xb, re('<CdtrAgt><FinInstnId><BIC>DEMOUS33</BIC>'), `<CdtrAgt><FinInstnId>${clr}`), v, 'AT', '7.17', { level: 'tx', count: 1, code: 'RC04', msg: /missing: name, address/ });
    await passes('clearing member id, name and address', change(xb, re('<CdtrAgt><FinInstnId><BIC>DEMOUS33</BIC>'), `<CdtrAgt><FinInstnId>${clr}<Nm>Demo Bank</Nm><PstlAdr><TwnNm>New York</TwnNm><Ctry>US</Ctry></PstlAdr>`), v, 'AT', ['7.17']);

    // ---------- 7.18 cross-border: unstructured address (warning)
    const xbUnstr = change(xb, /<PstlAdr><StrtNm>Fifth Avenue<\/StrtNm>[^]*?<\/PstlAdr>/, '<PstlAdr><AdrLine>Fifth Avenue 1</AdrLine><AdrLine>New York NY 10001</AdrLine></PstlAdr>');
    await fails('creditor address lines only', xbUnstr, v, 'AT', '7.18', { sev: 'W', level: 'tx', count: 1, code: null, msg: /cross-border payment is unstructured/ });
    await fails('debtor address lines only', change(xb, '<PstlAdr><TwnNm>Wien</TwnNm><Ctry>AT</Ctry></PstlAdr>', '<PstlAdr><AdrLine>Wien</AdrLine></PstlAdr>'), v, 'AT', '7.18', { sev: 'W', level: 'block', count: 1 });
    await passes('guideline.unstructuredAddress false', xbUnstr, v, 'AT', ['7.18', '7.8'], { guideline: { unstructuredAddress: false } });

    // ---------- 7.19 cross-border: no SLEV
    await fails('cross-border with SLEV', change(xb, '<ChrgBr>SHAR</ChrgBr>', '<ChrgBr>SLEV</ChrgBr>'), v, 'AT', '7.19', { level: 'tx', count: 2, code: 'CH16', msg: /Use SHAR, DEBT or CRED/ });

    // ---------- 7.20 cross-border between EEA banks in an EEA currency: SHAR
    const eea = change(change(czDom, /(<CdtrAcct><Id><IBAN>)[^<]*/g, `$1${deIban}`), /OTHRCZ22/g, 'DEMODEFF');
    await fails('CZK from CZ to DE with DEBT', change(eea, '<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>DEBT</ChrgBr>', true), v, 'CZ', '7.20', { level: 'tx', count: 4, code: 'CH16', msg: /EEA \(CZ and DE\) and CZK is an EEA currency/ });
    await passes('CZK from CZ to DE with SHAR', change(eea, '<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SHAR</ChrgBr>', true), v, 'CZ', ['7.20', '7.19']);
    const eeaSlev = await validate(eea, v, 'CZ');
    ok(groupsOf(eeaSlev, '7.19').length === 1 && /Use SHAR \(both banks/.test(groupsOf(eeaSlev, '7.19')[0].items[0].message) && !groupsOf(eeaSlev, '7.20').length, `7.20 with SLEV: only 7.19, which asks for SHAR (.${v})`, show(eeaSlev));
    await passes('USD from CZ to DE with DEBT (not an EEA currency)', change(change(eea, '<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>DEBT</ChrgBr>', true), 'Ccy="CZK"', 'Ccy="USD"', true), v, 'CZ', ['7.20']);

    // ---------- 7.21 cross-border: IBAN for IBAN countries, else a plausible account number
    await fails('account number with #', change(xb, '<Id>000700000</Id>', '<Id>0007#0000</Id>'), v, 'AT', '7.21', { level: 'tx', count: 1, code: 'AC03', msg: /0007#0000 contains characters/ });
    await passes('account number with - / and a space', change(xb, '<Id>000700000</Id>', '<Id>0007-0000/1 A</Id>'), v, 'AT', ['7.21']);
    await fails('account number for a bank in DE', change(xb, 'DEMOUS33', 'DEMODEFF'), v, 'AT', '7.21', { count: 1, msg: /accounts in DE have IBANs/ });

    // ---------- 7.22 cross-border: purpose or regulatory reporting for listed destinations (setting crossBorder.purposeRequiredFor)
    const needs = { crossBorder: { purposeRequiredFor: ['US'] } };
    await fails('destination US in the list', xb, v, 'AT', '7.22', { level: 'tx', count: 4, code: 'RR05', msg: /payments to US need a purpose code/ }, needs);
    await fails('one with a purpose code, one with regulatory reporting', change(change(xb, '<RmtInf><Ustrd>Invoice 4000', '<Purp><Cd>SUPP</Cd></Purp><RmtInf><Ustrd>Invoice 4000'), '<RmtInf><Ustrd>Invoice 4001', '<RgltryRptg><Dtls><Cd>101</Cd></Dtls></RgltryRptg><RmtInf><Ustrd>Invoice 4001'), v, 'AT', '7.22', { count: 2 }, needs);
    await passes('purposeRequiredFor [] (default)', xb, v, 'AT', ['7.22']);
    await passes('purposeRequiredFor null', xb, v, 'AT', ['7.22'], { crossBorder: { purposeRequiredFor: null } });

    // ---------- 7.23 cross-border: retired currency (warning; setting crossBorder.retiredCurrencies)
    const bgn = change(xb, 'Ccy="USD"', 'Ccy="BGN"');
    await fails('BGN', bgn, v, 'AT', '7.23', { sev: 'W', level: 'tx', count: 1, code: 'AM03', msg: /BGN is no longer in use/ });
    await passes('retiredCurrencies []', bgn, v, 'AT', ['7.23'], { crossBorder: { retiredCurrencies: [] } });
    await passes('retiredCurrencies null', bgn, v, 'AT', ['7.23'], { crossBorder: { retiredCurrencies: null } });
    const hrk = await validate(change(xb, 'Ccy="USD"', 'Ccy="HRK"'), v, 'AT');
    ok(!groupsOf(hrk, '7.23').length, `7.23 HRK, no longer an active ISO code, is left to 4.23 (.${v})`, show(hrk));

    // ---------- 7.24 cross-border: intermediary agent BIC
    await fails('intermediary agent without BIC', change(xb, '</Amt>', '</Amt><IntrmyAgt1><FinInstnId><Nm>Demo Correspondent</Nm></FinInstnId></IntrmyAgt1>'), v, 'AT', '7.24', { level: 'tx', count: 1, code: 'RC11', msg: /IntrmyAgt1/ });
    await passes('intermediary agent with BIC', change(xb, '</Amt>', `</Amt><IntrmyAgt1><FinInstnId><${v === '09' ? 'BICFI' : 'BIC'}>DEMODEFF</${v === '09' ? 'BICFI' : 'BIC'}></FinInstnId></IntrmyAgt1>`), v, 'AT', ['7.24']);

    // ---------- 7.25 cross-border: texts a downstream format would cut (warning; setting crossBorder.truncateLength)
    const xbLong = change(xb, '<Nm>Lindenhof Metall GmbH</Nm>', `<Nm>${long(40)}</Nm>`);
    await fails('creditor name of 40 characters', xbLong, v, 'AT', '7.25', { sev: 'W', level: 'tx', count: 1, code: 'RR08', msg: /Cdtr\/Nm \(40 characters, kept 35\)/ });
    await fails('debtor name of 40 characters', change(xb, '<Dbtr><Nm>Beispiel Handels GmbH</Nm>', `<Dbtr><Nm>${long(40)}</Nm>`), v, 'AT', '7.25', { sev: 'W', level: 'block', count: 1, msg: /Dbtr\/Nm \(40 characters/ });
    await fails('truncateLength with Cdtr/Nm 20', xb, v, 'AT', '7.25', { sev: 'W', count: 4 }, { crossBorder: { truncateLength: { 'Cdtr/Nm': 20 } } });
    await passes('truncateLength null', xbLong, v, 'AT', ['7.25'], { crossBorder: { truncateLength: null } });
    await passes('a SEPA creditor name of 40 characters', change(sepa, '<Nm>Lindenhof Metall GmbH</Nm>', `<Nm>${long(40)}</Nm>`), v, 'AT', ['7.25']);

    // ---------- 7.26 intra-bank, 7.27 budget: hints
    await fails('intra-bank transfers', file(v, { type: 'INTRA_BANK', country: 'RS' }), v, 'RS', '7.26', { sev: 'I', level: 'tx', count: 4, code: null, msg: /intra-bank transfer: the creditor's bank DEMORSWW/ });
    const roBudget = file(v, { type: 'BUDGET', country: 'RO' });
    await fails('budget payments with category purpose TAXS', roBudget, v, 'RO', '7.27', { sev: 'I', level: 'tx', count: 4, code: null, msg: /category purpose TAXS/ });
    await fails('budget payments to a treasury IBAN (RO, TREZ)', change(roBudget, '<PmtTpInf><CtgyPurp><Cd>TAXS</Cd></CtgyPurp></PmtTpInf>', '', true), v, 'RO', '7.27', { sev: 'I', count: 4, msg: /is a treasury account/ });
  }

  // catalogue: every stage-7 rule has a title and a hint; 7.6 has its two parts
  const cat = t.catalogue.rules;
  const ids = Object.keys(cat).filter(k => cat[k].stage === 7 && k !== '7.7');
  ok(ids.every(k => cat[k].title && cat[k].hint) && cat['7.6'].parts && cat['7.6'].parts.name && cat['7.6'].parts.rmt, 'catalogue: stage-7 checks have a title and a hint, 7.6 its parts name and rmt', ids.filter(k => !cat[k].title || !cat[k].hint).join(', '));
};
