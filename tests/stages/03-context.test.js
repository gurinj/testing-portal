'use strict';
/*
 * Tests of stage 3, country context and payment type (rules/stages/03-country-context.sch).
 * Every check: a file that breaks it (id, part, severity, level) and clean files that pass.
 * Failing files are clean generated files with one text replaced; they pass the XSD.
 */
module.exports = async t => {
  const { ok, head, gen, validate, TP } = t;
  const MINE = ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7'];

  // ---------- helpers
  const change = (xml, a, b, all) => { const out = all ? xml.split(a).join(b) : xml.replace(a, b); if (out === xml) throw new Error(`test edit did not change the file: ${a}`); return out; };
  const groupsOf = (rep, id) => { const [rule, part = null] = id.split('-'); return rep.groups.filter(g => g.rule === rule && (g.part || null) === part); };
  const show = rep => JSON.stringify(rep.groups.map(g => [g.rule + (g.part ? '-' + g.part : ''), g.severity, g.level, g.count, g.items[0].message.slice(0, 160)]));
  // the country file as the rules see it, changed for one test (the harness reads config/countries/<CC>.json)
  async function withCountry(patch, fn) {
    const core = TP.rulesCore, orig = core.runRuleSets;
    core.runRuleSets = (S, sets, xml, v, c, ctx) => orig(S, sets, xml, v, c, { ...ctx, countryConfig: typeof patch === 'function' ? patch(ctx.countryConfig) : { ...ctx.countryConfig, ...patch } });
    try { return await fn(); } finally { core.runRuleSets = orig; }
  }
  // the finding is there once as a group, with this severity, level, count and message; no XSD finding
  async function fails(label, xml, v, country, id, want = {}, over, now) {
    const rep = await validate(xml, v, country, over, now);
    const gs = groupsOf(rep, id), g = gs[0];
    const good = gs.length === 1 && g.severity === (want.sev || 'E') && (!want.level || g.level === want.level) && (want.count == null || g.count === want.count)
      && (!want.code || g.code === want.code) && (!want.msg || want.msg.test(g.items[0].message)) && !rep.groups.some(x => x.source === 'xsd' || /engine/.test(x.rule));
    ok(good, `${id} ${label} (.${v})`, show(rep));
    return rep;
  }
  async function passes(label, xml, v, country, ids, over, now) {
    const rep = await validate(xml, v, country, over, now);
    const hit = rep.groups.filter(g => ids.includes(g.rule) || ids.includes(`${g.rule}-${g.part}`) || /engine/.test(g.rule));
    ok(!hit.length, `${label} (.${v}): no ${ids.join(', ')}`, show(rep));
    return rep;
  }
  const file = (v, o = {}) => gen.generate({ version: v, transactions: 4, blocks: 2, ...o });
  const bicEl = v => (v === '09' ? 'BICFI' : 'BIC');

  head('stage 3: country context and payment type');

  // ---------- clean files: no error or warning of stage 3 where the type applies
  {
    const bad = [];
    for (const country of gen.COUNTRIES) for (const type of gen.TYPES) for (const v of ['03', '09']) {
      const rep = await validate(gen.generate({ version: v, transactions: 3, blocks: 1, type, country, uetr: v === '09', lei: v === '09' }), v, country);
      const sepaType = type === 'SEPA' || type === 'SEPA_INST';
      const inSepa = TP.functions.list('sepa').has(country);
      const mine = rep.groups.filter(g => g.stage === 3);
      if (sepaType && !inSepa) { if (!(mine.length === 1 && mine[0].rule === '3.6')) bad.push(`${country} ${type} .${v}: ${show(rep)}`); }
      else if (mine.length) bad.push(`${country} ${type} .${v}: ${show(rep)}`);
    }
    ok(!bad.length, 'clean files of every type and country, .03 and .09: no stage-3 finding (SEPA types outside SEPA: only 3.6)', bad.join('\n'));
  }

  for (const v of ['03', '09']) {
    const base = file(v);

    // ---------- 3.1 the selected country has a country file
    await fails('a country without a country file (DE)', base, v, 'DE', '3.1', { level: 'file', msg: /DE/ });
    await withCountry({ code: 'AT', name: 'AT', versions: ['03', '09'], error: 'Not found' }, () =>
      fails('the page could not load the country file (placeholder with an error)', base, v, 'AT', '3.1', { level: 'file' }));
    await passes('AT has its country file', base, v, 'AT', ['3.1']);

    // ---------- 3.2 debtor IBAN country = selected country
    const czIban = gen.iban('CZ', '99990000000012340001');
    const dbtr2 = change(base, /(<DbtrAcct><Id><IBAN>)[^<]*/, `$1${czIban}`);
    await fails('debtor IBAN of CZ, file checked for AT', dbtr2, v, 'AT', '3.2', { level: 'block', count: 1, code: 'NARR', msg: new RegExp(czIban) });
    await passes('the same file checked for CZ: block 1 fits, block 2 does not', dbtr2, v, 'CZ', ['3.1']);
    const rep32 = await validate(dbtr2, v, 'CZ');
    ok(groupsOf(rep32, '3.2').length === 1 && groupsOf(rep32, '3.2')[0].items[0].block === 2, `3.2 checked for CZ: only block 2 (.${v})`, show(rep32));
    const lower = change(base, /(<DbtrAcct><Id><IBAN>)AT/, '$1at');
    const repLow = await validate(lower, v, 'AT');
    ok(!groupsOf(repLow, '3.2').length && repLow.groups.some(g => g.rule === '2.7'), `3.2 not reported for an IBAN that fails the XSD (.${v})`, show(repLow));

    // ---------- 3.3 debtor agent BIC country = selected country
    const bic2 = change(base, `<${bicEl(v)}>DEMOATWW</${bicEl(v)}></FinInstnId></DbtrAgt>`, `<${bicEl(v)}>DEMOCZPP</${bicEl(v)}></FinInstnId></DbtrAgt>`);
    await fails('debtor agent BIC of CZ, file checked for AT', bic2, v, 'AT', '3.3', { level: 'block', count: 1, code: 'RC03', msg: /DEMOCZPP/ });
    await passes('a BIC of CZ in block 1 does not make the file one of two countries (IBAN first)', bic2, v, 'AT', ['3.4']);

    // ---------- 3.4 one debtor country per file
    const two = change(base, /(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<DbtrAcct><Id><IBAN>)[^<]*/, `$1${czIban}`);
    // review 2026-11-19: 3.2/3.3 report the block; 3.4 only when both are switched off
    await passes('blocks of AT and CZ: 3.2 reports the block, not 3.4 as well', two, v, 'AT', ['3.4']);
    await fails('blocks of AT and CZ, 3.2 and 3.3 off', two, v, 'AT', '3.4', { level: 'file', count: 1, code: 'NARR', msg: /AT \(block PMT-01\); CZ \(block PMT-02\)/ }, { checks: { '3.2': { enabled: false }, '3.3': { enabled: false } } });
    await passes('guideline.oneCountryPerFile false', two, v, 'AT', ['3.4'], { guideline: { oneCountryPerFile: false }, checks: { '3.2': { enabled: false }, '3.3': { enabled: false } } });
    await passes('guideline.oneCountryPerFile null', two, v, 'AT', ['3.4'], { guideline: { oneCountryPerFile: null }, checks: { '3.2': { enabled: false }, '3.3': { enabled: false } } });
    // without a debtor IBAN the BIC gives the country
    const othr = change(change(base, /(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<DbtrAcct><Id>)<IBAN>[^<]*<\/IBAN>/, '$1<Othr><Id>12345678</Id></Othr>'),
      /(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<DbtrAgt><FinInstnId><BIC(?:FI)?>)DEMOATWW/, '$1DEMOCZPP');
    await fails('block 2 without IBAN, its BIC is of CZ, 3.2 and 3.3 off', othr, v, 'AT', '3.4', { msg: /CZ \(block PMT-02\)/ }, { checks: { '3.2': { enabled: false }, '3.3': { enabled: false } } });

    // ---------- 3.5 payment type can be determined
    const xb = file(v, { type: 'CROSS_BORDER' });
    const unknown = change(change(xb, /<CdtrAgt><FinInstnId><BIC(?:FI)?>DEMOUS33<\/BIC(?:FI)?><\/FinInstnId><\/CdtrAgt>/, ''), '<Ctry>US</Ctry>', '');
    const rep35 = await fails('creditor country unknown and USD in AT', unknown, v, 'AT', '3.5', { level: 'tx', count: 1, code: 'FF03', msg: /USD is not the local currency EUR/ });
    ok(rep35.blocks[0].txs[0].typeLabel === 'Not determined', `3.5 the report shows the type "Not determined" (.${v})`, rep35.blocks[0].txs[0].typeLabel);
    const eurUnknown = change(unknown, 'Ccy="USD"', 'Ccy="EUR"');
    await passes('creditor country unknown but the local currency: domestic', eurUnknown, v, 'AT', ['3.5']);

    // ---------- 3.6 payment type supported in the selected country
    const uaSepa = gen.generate({ version: v, transactions: 3, blocks: 1, country: 'UA', type: 'SEPA' });
    await fails('SEPA credit transfers from UA (not in SEPA)', uaSepa, v, 'UA', '3.6', { level: 'tx', count: 3, code: 'FF03', msg: /not in the SEPA scheme/ });
    const uaInst = gen.generate({ version: v, transactions: 3, blocks: 1, country: 'XK', type: 'SEPA_INST' });
    await fails('SEPA Instant from XK (not in SEPA)', uaInst, v, 'XK', '3.6', { count: 3 });
    await withCountry({ paymentTypes: ['SEPA', 'SEPA_INST', 'DOMESTIC'] }, async () => {
      await fails('country paymentTypes without CROSS_BORDER, a cross-border file', xb, v, 'AT', '3.6', { count: 4, msg: /paymentTypes: SEPA, SEPA_INST, DOMESTIC/ });
      await passes('country paymentTypes with SEPA, a SEPA file', base, v, 'AT', ['3.6']);
    });
    await withCountry({ paymentTypes: [] }, () => fails('country paymentTypes [] (nothing offered)', base, v, 'AT', '3.6', { count: 4 }));
    await withCountry({ paymentTypes: ['SEPA'] }, () => passes('a list decides: SEPA listed for UA', uaSepa, v, 'UA', ['3.6']));
    await passes('country paymentTypes null: every type in AT, cross-border', xb, v, 'AT', ['3.6']);

    // ---------- 3.7 one payment type per block
    // AT, EUR to AT creditors without service level: SEPA; one creditor IBAN of Turkey makes it cross-border
    const dom = file(v, { type: 'DOMESTIC' });
    const trIban = gen.iban('TR', '0006100519786457841326');
    const mixed = change(dom, /(<CdtrAcct><Id><IBAN>)[^<]*/, `$1${trIban}`);
    await fails('a block with SEPA and cross-border payments', mixed, v, 'AT', '3.7', { level: 'block', count: 1, code: 'FF03', msg: /Cross-border \(SWIFT\): 1, SEPA credit transfer: 1/ });
    await passes('guideline.onePaymentTypePerBlock false', mixed, v, 'AT', ['3.7'], { guideline: { onePaymentTypePerBlock: false } });
    await passes('guideline.onePaymentTypePerBlock null', mixed, v, 'AT', ['3.7'], { guideline: { onePaymentTypePerBlock: null } });
    // block 1 of "unknown": one transaction without a type (3.5) and one cross-border
    const rep37 = await validate(unknown, v, 'AT');
    ok(!groupsOf(rep37, '3.7').length && groupsOf(rep37, '3.5').length === 1, `3.7 a transaction without a type does not make its block mixed (.${v})`, show(rep37));
  }

  // the report and the rules agree on the type
  const ra = await validate(gen.generate({ version: '09', transactions: 4, blocks: 1, type: 'DOMESTIC', country: 'AT' }), '09', 'AT');
  ok(ra.blocks[0].type === 'SEPA' && !ra.groups.some(g => MINE.includes(g.rule)), 'EUR to AT creditors without service level: SEPA in the report, no stage-3 finding', show(ra));
};
