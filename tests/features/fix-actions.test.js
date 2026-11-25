/*
 * M3 fix actions and config/fixes.json (docs/specs/M3.md, section 3; helper f1).
 * For every fix of config/fixes.json: a file with the finding, the proposal (kind, ticked or not),
 * the change applied, the file validated again: the finding is gone and no new finding appears
 * (other than one that the first finding hid). Where .03 and .09 differ, both. Then the cases
 * where no change can be made (they stay manual, with a reason, and never throw), the coverage of
 * every check of stages 2–10, and the speed on 10,000 transactions.
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async t => {
  const { ok, head, gen, validate, contextFor, TP, ROOT } = t;
  for (const f of ['locate.js', 'edit.js', 'checks.js', 'propose.js']) require(path.join(ROOT, 'js/fix', f));
  for (const f of fs.readdirSync(path.join(ROOT, 'js/fix/actions')).filter(f => f.endsWith('.js')).sort()) require(path.join(ROOT, 'js/fix/actions', f));
  const fixes = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/fixes.json'), 'utf8'));
  const F = TP.fix, U = TP.fix.util;
  const keyOf = g => g.rule + (g.part ? '-' + g.part : '');
  const keysOf = r => new Set(r.groups.map(keyOf));
  const tripped = new Set();
  const P = '/Document[1]/CstmrCdtTrfInitn[1]';

  // replace text, failing loudly when a replacement does not match (a test that tests nothing)
  function edit(xml, ...pairs) {
    let x = xml;
    for (const [a, b] of pairs) {
      const y = typeof a === 'string' ? x.replace(a, b) : x.replace(a, b);
      if (y === x) throw new Error(`test file edit did not match: ${a}`);
      x = y;
    }
    return x;
  }
  const opts = (c, over, now) => { const ctx = contextFor(c, over); return { fixes, settings: ctx.settings, country: c, countryConfig: ctx.countryConfig, now: now || null }; };
  const kindOf = def => (TP.fix.actions[def.action] || {}).kind || 'calculated';

  /*
   * One round trip. o: { xml, v, country, over, now, key, value (typed or chosen), hidden (keys that may
   * appear: the finding hid them), pick(p) (which proposal of that key), check(p, out, r2) → [ok, detail], what }
   */
  async function trip(label, o) {
    const v = o.v || '03', c = o.country || 'AT';
    const name = `${o.key} (.${v}) ${label}`;
    let r1;
    try { r1 = await validate(o.xml, v, c, o.over, o.now); } catch (e) { return ok(false, name, e.stack); }
    if (r1.stop || !keysOf(r1).has(o.key)) return ok(false, `${name}: the test file has the finding`, r1.stop ? 'stopped' : [...keysOf(r1)].join(', '));
    const res = F.propose(r1, o.xml, opts(c, o.over, o.now));
    const p = res.proposals.find(x => keyOf(x) === o.key && (!o.pick || o.pick(x)));
    if (!p) return ok(false, `${name}: a change is proposed`, JSON.stringify(res.manual.filter(m => keyOf(m) === o.key)));
    tripped.add(o.key);
    const def = F.defOf(fixes, p);
    const wantSel = kindOf(def) === 'calculated' && !def.changesPayment;
    ok(p.kind === kindOf(def) && p.sel === wantSel && p.changesPayment === !!def.changesPayment && p.field === def.field,
      `${name}: proposed as ${p.kind}${p.changesPayment ? ', changes the payment' : ''}, ${p.sel ? 'ticked' : 'not ticked'}`, JSON.stringify({ kind: p.kind, sel: p.sel, rows: p.rows }));
    if (o.value !== undefined) F.setValue(p, o.value);
    if (p.rows.some(r => r.error)) return ok(false, `${name}: the value can be used`, JSON.stringify(p.rows.map(r => [r.val, r.error])));
    for (const q of res.proposals) q.sel = q === p;
    const out = F.apply(o.xml, res.proposals);
    const r2 = await validate(out.text, v, c, o.over, o.now);
    const k1 = keysOf(r1), k2 = keysOf(r2);
    const allowed = new Set([...k1, ...r1.suppressed.map(keyOf), ...(o.hidden || [])]);
    const added = [...k2].filter(k => !allowed.has(k));
    const still = r2.groups.filter(g => keyOf(g) === o.key);
    ok(out.skipped.length === 0 && out.applied.length === 1 && !still.length && !added.length,
      `${name}: applied, gone when validated again, no new finding`,
      JSON.stringify({ skipped: out.skipped, still: still.map(g => g.items.map(i => i.message)), added, rows: p.rows.map(r => [r.op, r.path, r.old, r.val]) }));
    if (o.check) { const [cond, detail] = o.check(p, out, r2, r1); ok(cond, `${name}: ${o.what}`, detail); }
    return { r1, p, out, r2, res };
  }
  /* a finding that stays manual: no proposal, a reason that is not an exception */
  async function manual(label, o) {
    const v = o.v || '03', c = o.country || 'AT';
    const name = `${o.key} (.${v}) ${label}`;
    const r1 = await validate(o.xml, v, c, o.over, o.now);
    if (r1.stop || !keysOf(r1).has(o.key)) return ok(false, `${name}: the test file has the finding`, r1.stop ? 'stopped' : [...keysOf(r1)].join(', '));
    const res = F.propose(r1, o.xml, opts(c, o.over, o.now));
    const m = res.manual.find(x => keyOf(x) === o.key);
    const p = res.proposals.find(x => keyOf(x) === o.key);
    ok(!p && m && m.reason && !/could not be prepared/.test(m.reason) && (!o.reason || o.reason.test(m.reason)),
      `${name}: stays open, with the reason "${m ? m.reason : ''}"`, JSON.stringify({ p: p && p.rows, m }));
  }

  // test files: 6 transactions in 2 blocks (block 1: E2E-000001, -3, -5; block 2: -2, -4, -6)
  const a03 = gen.generate({ version: '03', transactions: 6, blocks: 2 });
  const a09 = gen.generate({ version: '09', transactions: 6, blocks: 2, uetr: true, lei: true });
  const base = v => (v === '09' ? a09 : a03);
  const BIC = v => (v === '09' ? 'BICFI' : 'BIC');
  const both = async (label, make) => { for (const v of ['03', '09']) await trip(label, { v, ...make(v, base(v)) }); };
  // a fixed time of the check: Friday 25 December 2026 (TARGET closing day), 10:00 local time
  const XMAS = new Date(2026, 11, 25, 10, 0, 0);
  const TUE = new Date(2026, 11, 22, 10, 0, 0);
  const localIso = d => TP.functions.localIso(d).slice(0, 19);
  const execDate = (x, v, d) => edit(x, [v === '09' ? /<ReqdExctnDt><Dt>[^<]*<\/Dt>/ : /<ReqdExctnDt>[^<]*</, v === '09' ? `<ReqdExctnDt><Dt>${d}</Dt>` : `<ReqdExctnDt>${d}<`]);
  const rowNext = p => p.rows.map(r => r.val).join(' | ');

  head('M3 fix actions: helpers');
  {
    const s = U.sum(['0.1', '0.2'].map(U.dec));
    ok(U.fmt(s) === '0.3' && U.fmt(U.sum(['999999999999999.99', '0.01'].map(U.dec))) === '1000000000000000.00' && U.fmt(U.sum(['5', '0.00001', '+.5'].map(U.dec))) === '5.50001',
      'exact decimal sums: 0.1 + 0.2 = 0.3, no floating point; the most decimals are kept');
    ok(U.target(`${P}/PmtInf[1]/Dbtr[1]/Nm[1]`, 'Cdtr/Nm') === `${P}/PmtInf[1]/Dbtr[1]/Nm[1]` && U.target(`${P}/PmtInf[1]/CdtTrfTxInf[2]`, 'Cdtr/Nm') === `${P}/PmtInf[1]/CdtTrfTxInf[2]/Cdtr[1]/Nm[1]`,
      'the element of a finding: its own element, or the one below it');
    ok(U.fieldOf(`${P}/PmtInf[1]/CdtTrfTxInf[2]/Cdtr[1]/PstlAdr[1]/Ctry[1]`) === 'Cdtr/PstlAdr/Ctry' && U.limitOf(`${P}/PmtInf[1]/CdtTrfTxInf[2]/Cdtr[1]/Nm[1]`, { Nm: 70, 'Cdtr/Nm': 35 }) === 35
      && U.limitOf(`${P}/PmtInf[1]/Dbtr[1]/Nm[1]`, { Nm: 70, 'Cdtr/Nm': 35 }) === 70 && U.limitOf(`${P}/PmtInf[1]/Dbtr[1]/Nm[1]`, { Nm: 70, 'Dbtr/Nm': null }) === 0,
      'field names and limits by path, as the rules read them (the most specific path wins, null = no limit)');
    ok(U.cut('Müller GmbH und Co', 7) === 'Müller' && U.cut('a😀b', 2, 'utf16') === 'a' && U.cut('a😀b', 2) === 'a😀', 'texts are cut by characters, without a space at the end and without splitting a character');
    ok(U.isoDate('25.11.2026') === '2026-11-25' && U.isoDate('2026/11/5') === '2026-11-05' && U.isoDate('20261125') === '2026-11-25' && U.isoDate('11/25/2026') === null && U.isoDate('30.02.2026') === null
      && U.isoDateTime('2026-11-25 9:05') === '2026-11-25T09:05:00' && U.isoDateTime('25.11.2026T10:00:00+01:00') === '2026-11-25T10:00:00+01:00',
      'dates: only forms with one clear meaning are converted');
    ok(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(U.uuid4()), 'a new UETR is a UUID version 4');
    ok(F.checks.bicLive('DEMODEF0') !== '' && F.checks.bicLive('DEMODEFF') === '' && F.checks.lei(gen.lei('5299009DEMO0000001')) === '' && F.checks.lei('5299009DEMO000000100') !== ''
      && F.checks.rf('RF18 5390 0754 7034') === '' && F.checks.rf('RF19539007547034') !== '', 'checks of typed values: production BIC, LEI, RF reference');
  }

  head('M3 fix actions: schema values (2.6–2.11)');
  {
    const long = ('Lindenhof Metall und Maschinenbau Gesellschaft mit beschraenkter Haftung, Werk Nord, Abteilung Einkauf und Logistik, Halle ' + '7'.repeat(40)).slice(0, 141);
    await trip('creditor name longer than the schema allows', { v: '09', xml: edit(a09, ['<Cdtr><Nm>Lindenhof Metall GmbH</Nm>', `<Cdtr><Nm>${long}</Nm>`]),
      key: '2.6', check: p => [p.rows[0].val === long.slice(0, 140).trimEnd(), rowNext(p)], what: 'the first 140 characters are kept' });
    await trip('address line longer than the schema allows', { xml: edit(a03, ['<Ctry>DE</Ctry></PstlAdr></Cdtr>', `<Ctry>DE</Ctry><AdrLine>${'Hof '.repeat(17)}Tor</AdrLine></PstlAdr></Cdtr>`]),
      key: '2.6', check: p => [p.rows[0].val.length <= 70 && p.rows[0].element === 'Cdtr/PstlAdr/AdrLine', JSON.stringify(p.rows[0])], what: 'cut to 70, the element named' });
    await manual('a MsgId longer than 35 is not cut', { xml: edit(a03, [/<MsgId>[^<]*<\/MsgId>/, `<MsgId>${'M'.repeat(36)}</MsgId>`]), key: '2.6', reason: /id, a code or a reference/ });
    await manual('an empty creditor name is not filled in', { xml: edit(a03, ['<Cdtr><Nm>Lindenhof Metall GmbH</Nm>', '<Cdtr><Nm></Nm>']), key: '2.6', reason: /empty/ });

    await both('country code in small letters', (v, x) => ({ xml: edit(x, ['<Ctry>DE</Ctry></PstlAdr></Cdtr>', '<Ctry>de</Ctry></PstlAdr></Cdtr>']), key: '2.7', check: p => [rowNext(p) === 'DE', rowNext(p)], what: 'de → DE' }));
    await both('currency attribute in small letters', (v, x) => ({ xml: edit(x, ['Ccy="EUR"', 'Ccy="eur"']), key: '2.7', check: p => [p.rows[0].op === 'attr' && p.rows[0].attr === 'Ccy' && rowNext(p) === 'EUR', JSON.stringify(p.rows[0])], what: 'the attribute Ccy is changed' }));
    await both('BIC in small letters', (v, x) => ({ xml: edit(x, [`<CdtrAgt><FinInstnId><${BIC(v)}>DEMODEFF`, `<CdtrAgt><FinInstnId><${BIC(v)}>demodeff`]), key: '2.7' }));
    await trip('IBAN with spaces and small letters', { xml: edit(a03, ['<IBAN>DE86999999990000001000</IBAN>', '<IBAN>de86 9999 9999 0000 0010 00</IBAN>']), key: '2.7', check: p => [rowNext(p) === 'DE86999999990000001000', rowNext(p)], what: 'written without spaces in capitals' });
    await trip('NbOfTxs that is not a number', { xml: edit(a03, ['<NbOfTxs>6</NbOfTxs>', '<NbOfTxs>6x</NbOfTxs>']), key: '2.7', check: p => [rowNext(p) === '6', rowNext(p)], what: 'counted again' });
    await trip('UETR in capitals', { v: '09', xml: a09.replace(/<UETR>([^<]*)<\/UETR>/, (m, u) => `<UETR>${u.toUpperCase()}</UETR>`), key: '2.7' });
    await trip('LEI in small letters', { v: '09', xml: a09.replace(/<LEI>5299009DEMO/, '<LEI>5299009demo'), key: '2.7' });
    await manual('a country code that is not one', { xml: edit(a03, ['<Ctry>DE</Ctry></PstlAdr></Cdtr>', '<Ctry>xx</Ctry></PstlAdr></Cdtr>']), key: '2.7', reason: /not an ISO country code/ });
    await manual('a BIC with a dash', { xml: edit(a03, ['<CdtrAgt><FinInstnId><BIC>DEMODEFF', '<CdtrAgt><FinInstnId><BIC>DEMO-DEF']), key: '2.7', reason: /cannot be corrected safely/ });

    await trip('charge bearer in small letters', { xml: edit(a03, ['<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>slev</ChrgBr>']), key: '2.8', check: p => [rowNext(p) === 'SLEV', rowNext(p)], what: 'slev → SLEV' });
    await trip('payment method with a space', { v: '09', xml: edit(a09, ['<PmtMtd>TRF</PmtMtd>', '<PmtMtd>trf </PmtMtd>']), key: '2.8' });
    await manual('a code that is not in the list', { xml: edit(a03, ['<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>XXXX</ChrgBr>']), key: '2.8', reason: /not one of/ });

    await trip('control sum with a comma', { xml: edit(a03, [/(<GrpHdr>[\s\S]*?<CtrlSum>)[^<]*/, '$11,5']), key: '2.9', check: (p, out, r2) => [rowNext(p) === r2.facts.totals[0].replace(/^EUR /, '').replace(/,/g, ''), rowNext(p) + ' ' + r2.facts.totals], what: 'the sum of the amounts' });
    await manual('a negative amount is never changed', { xml: edit(a03, [/(<InstdAmt Ccy="EUR">)[^<]*/, '$1-5.00']), key: '2.9', reason: /never changed/ });

    await both('execution date written 25.11.2026', (v, x) => {
      const d = /<ReqdExctnDt>(?:<Dt>)?([^<]*)</.exec(x)[1];
      return { xml: execDate(x, v, d.split('-').reverse().join('.')), key: '2.10', check: p => [rowNext(p) === d, rowNext(p)], what: `written ${d}` };
    });
    await trip('creation time with a space instead of T', { xml: a03.replace(/<CreDtTm>([^<]*)T([^<]*)<\/CreDtTm>/, '<CreDtTm>$1 $2</CreDtTm>'), key: '2.10' });
    await manual('a date with slashes, day or month first', { xml: execDate(a03, '03', '11/12/2026'), key: '2.10', reason: /one clear meaning/ });
    await trip('batch booking in capitals', { xml: edit(a03, ['<BtchBookg>false</BtchBookg>', '<BtchBookg>FALSE</BtchBookg>']), key: '2.11' });
    await manual('batch booking "nein"', { xml: edit(a03, ['<BtchBookg>false</BtchBookg>', '<BtchBookg>nein</BtchBookg>']), key: '2.11' });
  }

  head('M3 fix actions: ISO business rules (stage 4)');
  {
    await trip('message id of spaces only', { xml: edit(a03, [/<MsgId>[^<]*<\/MsgId>/, '<MsgId>   </MsgId>']), key: '4.1', value: 'MSG-20261124-0002',
      check: p => [p.kind === 'entry' && p.rows[0].next === null, JSON.stringify(p.rows[0])], what: 'an empty field to type in' });
    for (const v of ['03', '09']) {
      const x = gen.generate({ version: v, transactions: 4, blocks: 2, now: XMAS });
      await trip('creation time in the future', { v, now: XMAS, xml: edit(x, [/<CreDtTm>[^<]*<\/CreDtTm>/, `<CreDtTm>${localIso(new Date(XMAS.getTime() + 3 * 3600000))}</CreDtTm>`]), key: '4.2-future',
        check: p => [rowNext(p) === localIso(XMAS), rowNext(p)], what: 'the time of the check, without an offset like the file' });
    }
    await trip('creation time in the future, with an offset', { now: XMAS, xml: edit(gen.generate({ version: '03', transactions: 2, now: XMAS }), [/<CreDtTm>[^<]*<\/CreDtTm>/, `<CreDtTm>${TP.functions.localIso(new Date(XMAS.getTime() + 3 * 3600000))}</CreDtTm>`]),
      key: '4.2-future', check: p => [rowNext(p) === TP.functions.localIso(XMAS), rowNext(p)], what: 'written with the offset' });

    const nb = gen.generate({ version: '03', transactions: 6, blocks: 2, defects: ['nboftxs'] });
    await trip('NbOfTxs of the group header', { xml: nb, key: '4.3', check: p => [p.rows[0].old === '7' && rowNext(p) === '6', JSON.stringify(p.rows[0])], what: '7 → 6' });
    await trip('CtrlSum of the group header', { v: '09', xml: gen.generate({ version: '09', transactions: 6, blocks: 2, defects: ['ctrlsum'] }), key: '4.4' });
    // amounts that floating point adds wrongly
    const cents = edit(a03, [/(<CdtTrfTxInf>\s*<PmtId><InstrId>INS-000001[\s\S]*?<InstdAmt Ccy="EUR">)[^<]*/, '$10.10'], [/(<CdtTrfTxInf>\s*<PmtId><InstrId>INS-000003[\s\S]*?<InstdAmt Ccy="EUR">)[^<]*/, '$10.20']);
    const sumOf = x => { const a = [...x.matchAll(/<InstdAmt Ccy="EUR">([^<]*)</g)].map(m => m[1]); return U.fmt(U.sum(a.map(U.dec))); };
    await trip('CtrlSum of the group header, exact', { xml: cents, key: '4.4', pick: p => p.rows[0].where === 'File', check: p => [rowNext(p) === sumOf(cents), rowNext(p) + ' ' + sumOf(cents)], what: 'the exact sum' });
    await trip('CtrlSum of a block, exact', { xml: cents, key: '4.8', check: p => [p.rows.length === 1 && /^\d+\.\d\d$/.test(rowNext(p)) && p.rows[0].where === 'Block 1', JSON.stringify(p.rows)], what: 'block 1 only' });
    await trip('NbOfTxs of a block', { v: '09', xml: edit(a09, [/(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<NbOfTxs>)3/, '$14']), key: '4.7', check: p => [rowNext(p) === '3' && p.rows[0].where === 'Block 2', JSON.stringify(p.rows)], what: 'block 2: 3' });

    await trip('initiating party name of spaces', { xml: edit(a03, ['<InitgPty><Nm>Beispiel Handels GmbH</Nm>', '<InitgPty><Nm>   </Nm>']), key: '4.5', value: 'Beispiel Handels GmbH',
      check: p => [p.kind === 'sample' && p.rows[0].next === 'Sample Initiating Party', JSON.stringify(p.rows[0])], what: 'a sample value, replaced by the user' });
    await trip('initiating party without a name', { v: '09', xml: edit(a09, ['<InitgPty><Nm>Beispiel Handels GmbH</Nm></InitgPty>', '<InitgPty><PstlAdr><TwnNm>Wien</TwnNm><Ctry>AT</Ctry></PstlAdr></InitgPty>']), key: '4.5', value: 'Beispiel Handels GmbH',
      check: (p, out) => [p.rows[0].next === 'Sample Initiating Party' && out.text.includes('<InitgPty><Nm>Beispiel Handels GmbH</Nm><PstlAdr>'), ''], what: 'the name is inserted before the address' });
    await trip('payment information id of spaces', { xml: edit(a03, ['<PmtInfId>PMT-02</PmtInfId>', '<PmtInfId>  </PmtInfId>']), key: '4.6',
      check: p => [/^MSG-\d{8}-0001-2$/.test(rowNext(p)), rowNext(p)], what: 'MsgId and block number' });

    for (const v of ['03', '09']) {
      const x = gen.generate({ version: v, transactions: 4, blocks: 2, now: XMAS });
      await trip('execution date in the past, today is a TARGET closing day', { v, now: XMAS, xml: execDate(x, v, '2026-12-18'), key: '4.10',
        check: p => [rowNext(p) === '2026-12-28', rowNext(p)], what: 'Monday 28 December (25: Christmas, 26–27: weekend)' });
    }
    const inst = gen.generate({ version: '03', transactions: 2, type: 'SEPA_INST', now: XMAS });
    await trip('execution date of SEPA Instant payments in the past', { now: XMAS, xml: execDate(inst, '03', '2026-12-18'), key: '4.10', check: p => [rowNext(p) === '2026-12-25', rowNext(p)], what: 'today' });
    await trip('execution date with a time (.09)', { v: '09', xml: a09.replace(/<ReqdExctnDt><Dt>([^<]*)<\/Dt>/, '<ReqdExctnDt><DtTm>$1T10:00:00</DtTm>'), key: '4.12',
      check: (p, out) => [p.rows.length === 2 && /<ReqdExctnDt><Dt>\d{4}-\d\d-\d\d<\/Dt><\/ReqdExctnDt>/.test(out.text), JSON.stringify(p.rows)], what: 'DtTm replaced by Dt' });
    const lines = a09.replace(/<ReqdExctnDt><Dt>([^<]*)<\/Dt><\/ReqdExctnDt>/, '<ReqdExctnDt>\n        <DtTm>$1T10:00:00</DtTm>\n      </ReqdExctnDt>');
    await trip('execution date with a time, on lines of its own', { v: '09', xml: lines, key: '4.12',
      check: (p, out) => [/<ReqdExctnDt>\n {8}<Dt>\d{4}-\d\d-\d\d<\/Dt>\n {6}<\/ReqdExctnDt>/.test(out.text), out.text.slice(out.text.indexOf('<ReqdExctnDt>'), out.text.indexOf('</ReqdExctnDt>') + 20)], what: 'the layout of the file is kept' });

    const txTp = '<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>';
    await both('PmtTpInf of a transaction the same as its block', (v, x) => ({ xml: edit(x, [/(E2E-000001<\/EndToEndId>.*?<\/PmtId>)/, `$1\n        ${txTp.replace('<Cd>', '\n          <Cd>')}`]), key: '4.13',
      check: (p, out) => [out.text === x, 'the file is as before'], what: 'the copy is removed with its lines' }));
    await manual('PmtTpInf of the transaction differs', { xml: edit(a03, [/(E2E-000001<\/EndToEndId><\/PmtId>)/, '$1<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><CtgyPurp><Cd>SUPP</Cd></CtgyPurp></PmtTpInf>']), key: '4.13', reason: /differs/ });
    await both('ChrgBr of a transaction the same as its block', (v, x) => ({ xml: edit(x, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/Amt>)/, '$1<ChrgBr>SLEV</ChrgBr>']), key: '4.14' }));
    await manual('ChrgBr of the transaction differs', { xml: edit(a03, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/Amt>)/, '$1<ChrgBr>SHAR</ChrgBr>']), key: '4.14', reason: /differs/ });

    await trip('debtor without a name', { xml: edit(a03, ['<Dbtr><Nm>Beispiel Handels GmbH</Nm>', '<Dbtr>']), key: '4.15', value: 'Beispiel Handels GmbH' });
    // with the sample value itself, the debtor is not the initiating party any more: two information hints (10.6, 10.10)
    await trip('debtor without a name, sample kept', { xml: edit(a03, ['<Dbtr><Nm>Beispiel Handels GmbH</Nm>', '<Dbtr>']), key: '4.15', hidden: ['10.6-ultimate', '10.10'] });
    await both('debtor agent without BIC', (v, x) => ({ xml: edit(x, [`<DbtrAgt><FinInstnId><${BIC(v)}>DEMOATWW</${BIC(v)}></FinInstnId>`, '<DbtrAgt><FinInstnId><Nm>Demo Bank AG</Nm></FinInstnId>']), key: '4.17', value: 'demoatww',
      check: (p, out) => [out.text.includes(`<DbtrAgt><FinInstnId><${BIC(v)}>DEMOATWW</${BIC(v)}><Nm>Demo Bank AG</Nm>`), ''], what: `${BIC(v)} typed, in capitals, before Nm` }));
    const chrgs = (iban) => edit(a03, ['<ChrgBr>SLEV</ChrgBr>', `<ChrgBr>SLEV</ChrgBr>${iban ? `<ChrgsAcct><Id><IBAN>${iban}</IBAN></Id></ChrgsAcct>` : ''}<ChrgsAcctAgt><FinInstnId><BIC>DEMOATWW</BIC></FinInstnId></ChrgsAcctAgt>`]);
    const goodAt = gen.iban('AT', '9999900012349999');
    await trip('charges account IBAN with wrong check digits', { xml: chrgs(goodAt.slice(0, 2) + (goodAt.slice(2, 4) === '11' ? '12' : '11') + goodAt.slice(4)), key: '4.18-iban', value: goodAt });
    await trip('charges account agent without a charges account', { xml: chrgs(null), key: '4.18-account' });

    const ult = (x, inner) => edit(x, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/Amt>)/, `$1<UltmtDbtr>${inner}</UltmtDbtr>`]);
    await trip('ultimate debtor with a name of spaces', { xml: ult(a03, '<Nm>   </Nm>'), key: '4.19' });
    await manual('ultimate debtor written <UltmtDbtr/>', { xml: edit(a03, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/Amt>)/, '$1<UltmtDbtr/>']), key: '4.19', reason: /empty element/ });
    await trip('end-to-end id of spaces', { v: '09', xml: edit(a09, ['<EndToEndId>E2E-000003</EndToEndId>', '<EndToEndId>    </EndToEndId>']), key: '4.20', hidden: ['X.1'], // X.1: the information hint for NOTPROVIDED
      check: p => [p.kind === 'sample' && rowNext(p) === 'NOTPROVIDED', rowNext(p)], what: 'NOTPROVIDED, as ISO allows' });

    const xb = gen.generate({ version: '03', transactions: 4, blocks: 1, type: 'CROSS_BORDER', country: 'UA' });
    const clr = (sys, mmb) => edit(xb, ['<CdtrAgt><FinInstnId><BIC>DEMOUS33</BIC>', `<CdtrAgt><FinInstnId><BIC>DEMOUS33</BIC><ClrSysMmbId><ClrSysId><Cd>${sys}</Cd></ClrSysId><MmbId>${mmb}</MmbId></ClrSysMmbId>`]);
    await trip('clearing system code in small letters', { country: 'UA', xml: clr('usaba', '026009593'), key: '4.27-code', check: p => [rowNext(p) === 'USABA', rowNext(p)], what: 'usaba → USABA' });
    await trip('clearing member id with dashes', { country: 'UA', xml: clr('USABA', '026-009-593'), key: '4.27-member', check: p => [rowNext(p) === '026009593', rowNext(p)], what: 'without dashes' });
    await manual('clearing member id with too few digits', { country: 'UA', xml: clr('USABA', '02600959'), key: '4.27-member', reason: /format/ });

    await both('creditor without a name', (v, x) => ({ xml: edit(x, ['<Cdtr><Nm>Lindenhof Metall GmbH</Nm>', '<Cdtr>']), key: '4.28' }));
    await manual('transaction without a creditor', { xml: edit(a03, [/<Cdtr><Nm>Lindenhof Metall GmbH<\/Nm>.*?<\/Cdtr>/, '']), key: '4.28', reason: /Cdtr is missing as well/ });
    await trip('creditor country XX', { xml: edit(a03, ['<Ctry>DE</Ctry></PstlAdr></Cdtr>', '<Ctry>XX</Ctry></PstlAdr></Cdtr>']), key: '4.29', value: 'de', check: p => [p.rows[0].val === 'DE', p.rows[0].val], what: 'typed in small letters, written in capitals' });
    await both('address without a town', (v, x) => ({ xml: edit(x, ['<TwnNm>Duesseldorf</TwnNm>', '']), key: '4.30-missing',
      check: (p, out) => [out.text.includes('<PstCd>40210</PstCd><TwnNm>Sample Town</TwnNm><Ctry>DE</Ctry>'), ''], what: 'Sample Town after PstCd' }));
    await manual('address without a town and a country', { xml: edit(a03, ['<TwnNm>Duesseldorf</TwnNm><Ctry>DE</Ctry>', '']), key: '4.30-missing', reason: /no Ctry/ });
    await trip('ultimate creditor with a name of spaces', { xml: edit(a03, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/CdtrAcct>)/, '$1<UltmtCdtr><Nm> </Nm></UltmtCdtr>']), key: '4.32' });
    await trip('instruction for the creditor agent not supported', { xml: edit(a03, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/CdtrAcct>)/, '$1<InstrForCdtrAgt><Cd>HOLD</Cd><InstrInf>Call first</InstrInf></InstrForCdtrAgt>']),
      over: { guideline: { instructionCodes: ['CHQB'] } }, key: '4.33', check: (p, out) => [!/InstrForCdtrAgt/.test(out.text) && p.rows[0].old === 'HOLD Call first', p.rows[0].old], what: 'the instruction is removed' });

    const purp = cd => edit(a03, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/CdtrAcct>)/, `$1<Purp><Cd>${cd}</Cd></Purp>`]);
    await trip('purpose code in small letters', { xml: purp('sala'), key: '4.34', check: p => [rowNext(p) === 'SALA', rowNext(p)], what: 'sala → SALA' });
    await manual('purpose code not in the list', { xml: purp('ZZZZ'), key: '4.34', reason: /not a code of the ISO list/ });
    await trip('category purpose in small letters', { v: '09', xml: edit(a09, ['<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>', '<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><CtgyPurp><Cd>supp</Cd></CtgyPurp></PmtTpInf>']), key: '4.35' });
    await trip('service level in small letters', { xml: edit(a03, ['<SvcLvl><Cd>SEPA</Cd></SvcLvl>', '<SvcLvl><Cd>sepa</Cd></SvcLvl>']), key: '4.36' });
    await trip('local instrument in small letters', { now: XMAS, xml: edit(inst, ['<Cd>INST</Cd>', '<Cd>inst</Cd>']), key: '4.37-code' });

    const two = v => gen.generate({ version: v, transactions: 8, blocks: 1, defects: ['two-ustrd'] });
    for (const v of ['03', '09']) await trip('two remittance lines', { v, xml: two(v), key: '4.38-count', check: (p, out) => [out.text.includes('<RmtInf><Ustrd>Invoice 1 Invoice 2</Ustrd></RmtInf>') && p.rows.length === 2, JSON.stringify(p.rows)], what: 'joined into one' });
    await manual('two remittance lines too long for one', { xml: edit(two('03'), ['<Ustrd>Invoice 1</Ustrd><Ustrd>Invoice 2</Ustrd>', `<Ustrd>${'A'.repeat(100)}</Ustrd><Ustrd>${'B'.repeat(100)}</Ustrd>`]), key: '4.38-count', reason: /more than the 140/ });
    await trip('RF reference with wrong check digits', { xml: edit(a03, ['<RmtInf><Ustrd>Invoice 4000</Ustrd></RmtInf>', '<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>RF19539007547034</Ref></CdtrRefInf></Strd></RmtInf>']),
      key: '4.39', value: 'rf18 5390 0754 7034', check: p => [p.rows[0].val === 'RF18539007547034', p.rows[0].val], what: 'typed with spaces, written without' });
    const rgl = ctry => edit(a03, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/CdtrAcct>)/, `$1<RgltryRptg><Dtls><Ctry>${ctry}</Ctry><Cd>101</Cd></Dtls></RgltryRptg>`]);
    await trip('regulatory reporting not supported', { xml: rgl('DE'), over: { guideline: { regulatoryReporting: false } }, key: '4.40-allowed' });
    await trip('regulatory reporting country XX', { xml: rgl('XX'), key: '4.40-country', value: 'DE' });
  }

  head('M3 fix actions: characters and formats (stage 5)');
  {
    const nm = (x, name) => edit(x, ['<Cdtr><Nm>Lindenhof Metall GmbH</Nm>', `<Cdtr><Nm>${name}</Nm>`]);
    await trip('& and umlauts in a SEPA name', { xml: nm(a03, 'Müller &amp; Söhne GmbH'), key: '5.1', check: (p, out, r2, r1) => [rowNext(p) === 'Muller + Sohne GmbH', rowNext(p)], what: '"Muller + Sohne GmbH"' });
    await trip('€ in the message id (country set)', { xml: gen.generate({ version: '03', transactions: 2, defects: ['msgid-chars'] }), key: '5.1', check: p => [/^MSGEUR\d{8}-0001$/.test(rowNext(p)), rowNext(p)], what: '€ → EUR' });
    await both('accents in a SEPA name', (v, x) => ({ xml: nm(x, 'Café Zürich GmbH'), key: '5.2', check: p => [rowNext(p) === 'Cafe Zurich GmbH', rowNext(p)], what: 'Cafe Zurich GmbH' }));
    await trip('a tab inside a remittance text', { xml: edit(a03, ['<Ustrd>Invoice 4000</Ustrd>', '<Ustrd>Invoice\t\t4000</Ustrd>']), key: '5.3', check: p => [rowNext(p) === 'Invoice 4000', JSON.stringify(rowNext(p))], what: 'one space' });
    await trip('a line break as a character reference', { v: '09', xml: edit(a09, ['<Ustrd>Invoice 4000</Ustrd>', '<Ustrd>Invoice&#10;4000</Ustrd>']), key: '5.3' });
    await both('a space at the end', (v, x) => ({ xml: edit(x, ['<Ustrd>Invoice 4002</Ustrd>', '<Ustrd>Invoice 4002 </Ustrd>']), key: '5.4-spaces' }));
    // an element with 5.2 and 5.4: one change fixes both
    const r = await trip('a space at the end of a name with an umlaut', { xml: nm(a03, ' Zürich Bau'), key: '5.4-spaces', check: (p, out, r2) => [rowNext(p) === 'Zurich Bau' && !r2.groups.some(g => keyOf(g) === '5.2'), rowNext(p)], what: 'trimmed and transliterated in one change, 5.2 gone too' });
    if (r && r.res) { const m = r.res.manual.find(x => keyOf(x) === '5.2'); ok(m && /together with/.test(m.reason), '5.2 on the same element: no second change, the reason names the change that fixes it', JSON.stringify(m)); }
    await trip('InstrId of spaces', { xml: edit(a03, ['<InstrId>INS-000001</InstrId>', '<InstrId>   </InstrId>']), key: '5.4-blank', check: (p, out) => [out.text.includes('<PmtId><EndToEndId>E2E-000001</EndToEndId>'), ''], what: 'InstrId left out' });
    await manual('town of spaces', { xml: edit(a03, ['<TwnNm>Duesseldorf</TwnNm>', '<TwnNm>   </TwnNm>']), key: '5.4-blank', reason: /cannot be left out/ });
    await trip('EndToEndId with slashes', { xml: edit(a03, ['<EndToEndId>E2E-000001</EndToEndId>', '<EndToEndId>/E2E//000001/</EndToEndId>']), key: '5.5', check: p => [rowNext(p) === 'E2E/000001', rowNext(p)], what: 'E2E/000001' });
    await manual('EndToEndId that would be the same as another', { xml: edit(a03, ['<EndToEndId>E2E-000001</EndToEndId>', '<EndToEndId>E2E-000002/</EndToEndId>']), key: '5.5', reason: /used already/ });

    const dbtrIban = /<DbtrAcct><Id><IBAN>([^<]*)</.exec(a03)[1];
    const de = x => [...x.matchAll(/<CdtrAcct><Id><IBAN>(DE[^<]*)</g)].map(m => m[1]);
    const [de1, de2] = de(a03);
    const wrong = i => i.slice(0, 2) + (i.slice(2, 4) === '11' ? '12' : '11') + i.slice(4);
    await trip('debtor IBAN with wrong check digits', { xml: edit(a03, [`<IBAN>${dbtrIban}</IBAN>`, `<IBAN>${wrong(dbtrIban)}</IBAN>`]), key: '5.6-dbtr', value: dbtrIban });
    await trip('the same wrong creditor IBAN twice', { v: '09', xml: edit(a09, [`<IBAN>${de1}</IBAN>`, `<IBAN>${wrong(de1)}</IBAN>`], [`<IBAN>${de2}</IBAN>`, `<IBAN>${wrong(de1)}</IBAN>`]),
      key: '5.6-cdtr', value: de1, check: p => [p.rows.length === 2, JSON.stringify(p.rows)], what: 'one value for both places' });
    await trip('IBAN of the creditor agent\'s account with wrong check digits', { xml: edit(a03, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/CdtrAgt>)/, `$1<CdtrAgtAcct><Id><IBAN>${wrong(de2)}</IBAN></Id></CdtrAgtAcct>`]), key: '5.6-other', value: de2 });
    await manual('two different wrong creditor IBANs', { xml: edit(a03, [`<IBAN>${de1}</IBAN>`, `<IBAN>${wrong(de1)}</IBAN>`], [`<IBAN>${de2}</IBAN>`, `<IBAN>${wrong(de2)}</IBAN>`]), key: '5.6-cdtr', reason: /different/ });
    await both('BIC with an unknown country', (v, x) => ({ xml: edit(x, [`<${BIC(v)}>DEMODEFF</${BIC(v)}>`, `<${BIC(v)}>DEMOQQ22</${BIC(v)}>`]), key: '5.7', value: 'DEMODEFF' }));
    await trip('test BIC', { xml: edit(a03, ['<BIC>DEMODEFF</BIC>', '<BIC>DEMODEF0</BIC>']), key: '5.8', value: 'DEMODEFF' });
    await trip('debtor country XX', { xml: edit(a03, ['<Ctry>AT</Ctry></PstlAdr></Dbtr>', '<Ctry>XX</Ctry></PstlAdr></Dbtr>']), key: '5.10', value: 'AT' });
    const lei = /<LEI>([^<]*)</.exec(a09)[1];
    await trip('LEI with wrong check digits', { v: '09', xml: edit(a09, [`<LEI>${lei}</LEI>`, `<LEI>${lei.slice(0, 18)}${lei.slice(18) === '99' ? '98' : '99'}</LEI>`]), key: '5.11', value: lei });
    await trip('organisation id scheme in small letters', { xml: edit(a03, ['<Ctry>AT</Ctry></PstlAdr></Dbtr>', '<Ctry>AT</Ctry></PstlAdr><Id><OrgId><Othr><Id>ATU12345678</Id><SchmeNm><Cd>txid</Cd></SchmeNm></Othr></OrgId></Id></Dbtr>']), key: '5.12-org' });
    await trip('private id scheme in small letters', { v: '09', xml: edit(a09, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/CdtrAcct>)/, '$1<UltmtCdtr><Nm>Max Muster</Nm><Id><PrvtId><Othr><Id>123456</Id><SchmeNm><Cd>nidn</Cd></SchmeNm></Othr></PrvtId></Id></UltmtCdtr>']), key: '5.12-prvt' });
  }

  head('M3 fix actions: CMIplus guideline (stage 6)');
  {
    await trip('purpose code CMIplus does not accept', { xml: edit(a03, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/CdtrAcct>)/, '$1<Purp><Cd>SUPP</Cd></Purp>']), over: { guideline: { forbidden: { transaction: ['Purp'] } } }, key: '6.2-forbidden' });
    const ultBlk = edit(a09, ['</DbtrAgt>', '</DbtrAgt><UltmtDbtr><Nm>Other Party</Nm><PstlAdr><TwnNm>Graz</TwnNm><Ctry>AT</Ctry></PstlAdr></UltmtDbtr>']);
    await trip('ultimate debtor CMIplus ignores', { v: '09', xml: ultBlk, over: { guideline: { ignored: { block: ['UltmtDbtr'] } } }, key: '6.2-ignored',
      check: (p, out) => [!/UltmtDbtr/.test(out.text) && p.rows[0].old === 'Other Party Graz AT', p.rows[0].old], what: 'the element with its content' });
    await trip('address of the ultimate debtor CMIplus ignores', { v: '09', xml: ultBlk, over: { guideline: { ignored: { block: ['UltmtDbtr/PstlAdr'] } } }, key: '6.2-ignored',
      check: (p, out) => [out.text.includes('<UltmtDbtr><Nm>Other Party</Nm></UltmtDbtr>'), ''], what: 'a path below the block: only that element' });
    await manual('ignored element that is the only one of its parent', { v: '09', xml: edit(a09, ['</DbtrAgt>', '</DbtrAgt><UltmtDbtr><Nm>Other Party</Nm></UltmtDbtr>']), over: { guideline: { ignored: { block: ['UltmtDbtr/Nm'] } } }, key: '6.2-ignored', reason: /left empty/ });
    await both('name longer than the guideline allows', (v, x) => ({ xml: edit(x, ['<Cdtr><Nm>Lindenhof Metall GmbH</Nm>', `<Cdtr><Nm>Lindenhof Metall GmbH ${'Werk '.repeat(11)}Nord</Nm>`]), key: '6.4', check: p => [[...rowNext(p)].length <= 70, rowNext(p)], what: 'at most 70' }));
    await trip('batch booking not supported', { xml: edit(a03, ['<BtchBookg>false</BtchBookg>', '<BtchBookg>true</BtchBookg>']), over: { guideline: { batchBooking: { allowed: false } } }, key: '6.8-allowed' });
    const cz = gen.generate({ version: '03', transactions: 4, blocks: 1, type: 'DOMESTIC', country: 'CZ' });
    await trip('batch booking with two currencies', { country: 'CZ', xml: edit(cz, ['<BtchBookg>false</BtchBookg>', '<BtchBookg>true</BtchBookg>'], ['Ccy="CZK"', 'Ccy="USD"']), key: '6.8-currency' });
    const ultTx = (x, el) => edit(x, [/(E2E-000001<\/EndToEndId>[\s\S]*?<\/CdtrAcct>)/, `$1<${el}><Nm>Other Party</Nm></${el}>`]);
    await trip('ultimate creditor not supported', { xml: ultTx(a03, 'UltmtCdtr'), over: { guideline: { ultimateParties: false } }, key: '6.12-cdtr' });
    await trip('ultimate debtor of a block not supported', { xml: edit(a03, ['</DbtrAgt>', '</DbtrAgt><UltmtDbtr><Nm>Other Party</Nm></UltmtDbtr>']), over: { guideline: { ultimateParties: false } }, key: '6.12-dbtr' });
  }

  head('M3 fix actions: payment types (stage 7)');
  {
    await both('SEPA with charge bearer SHAR on the block', (v, x) => ({ xml: edit(x, ['<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SHAR</ChrgBr>']), key: '7.4', check: p => [p.rows.length === 1 && p.rows[0].where === 'Block 1' && rowNext(p) === 'SLEV', JSON.stringify(p.rows)], what: 'one change on the block for its 3 transactions' }));
    const dom = gen.generate({ version: '03', transactions: 4, blocks: 1, type: 'DOMESTIC', country: 'AT' });
    await trip('EUR within SEPA without service level, SHAR', { xml: edit(dom, ['<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SHAR</ChrgBr>']), key: '7.4-implicit' });
    // a block with SEPA and cross-border payments: the block's charge bearer is not changed for one of them
    const mixed = edit(dom, ['<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SHAR</ChrgBr>'], [/(E2E-000001<\/EndToEndId><\/PmtId>\s*<Amt><InstdAmt Ccy=")EUR/, '$1USD'],
      [/(E2E-000001[\s\S]*?<BIC>)[^<]*/, '$1DEMOUS33'], [/(E2E-000001[\s\S]*?<Ctry>)AT/, '$1US'], [/(E2E-000001[\s\S]*?<CdtrAcct><Id>)<IBAN>[^<]*<\/IBAN>/, '$1<Othr><Id>700000001</Id></Othr>']);
    await manual('charge bearer of a block with SEPA and cross-border payments', { xml: mixed, key: '7.4-implicit', reason: /Cross-border/ });
    const noMax = { guideline: { maxLength: { Nm: null } } };
    await trip('SEPA creditor name longer than 70', { xml: edit(a03, ['<Cdtr><Nm>Lindenhof Metall GmbH</Nm>', `<Cdtr><Nm>Lindenhof Metall GmbH ${'Werk '.repeat(11)}Nord</Nm>`]), over: noMax, key: '7.6-name',
      check: p => [p.rows[0].element === 'Cdtr/Nm' && [...rowNext(p)].length <= 70, JSON.stringify(p.rows[0])], what: 'Cdtr/Nm below the transaction' });
    await trip('SEPA debtor name longer than 70', { v: '09', xml: edit(a09, ['<Dbtr><Nm>Beispiel Handels GmbH</Nm>', `<Dbtr><Nm>Beispiel Handels GmbH ${'Filiale '.repeat(7)}Ost</Nm>`]), over: noMax, key: '7.6-name' });
    await trip('SEPA with two remittance lines', { xml: gen.generate({ version: '03', transactions: 8, defects: ['two-ustrd'] }), over: { guideline: { remittance: { maxUstrd: null } } }, key: '7.6-rmt' });
    const instFuture = execDate(gen.generate({ version: '09', transactions: 2, type: 'SEPA_INST', now: XMAS }), '09', '2026-12-28');
    await trip('SEPA Instant dated in the future', { v: '09', now: XMAS, xml: instFuture, key: '7.11', check: p => [rowNext(p) === '2026-12-25', rowNext(p)], what: 'today' });
    const ua03 = gen.generate({ version: '03', transactions: 4, blocks: 2, type: 'CROSS_BORDER', country: 'UA' });
    await trip('cross-border with SLEV, DEBT chosen', { country: 'UA', xml: ua03.replace(/<ChrgBr>SHAR<\/ChrgBr>/g, '<ChrgBr>SLEV</ChrgBr>'), key: '7.19', value: 'DEBT',
      check: p => [p.rows.length === 2 && p.rows.every(r => r.val === 'DEBT' && r.tx === null), JSON.stringify(p.rows)], what: 'one row per block' });
    const czEea = edit(gen.generate({ version: '03', transactions: 3, blocks: 1, type: 'SEPA', country: 'CZ' }), ['<Cd>SEPA</Cd>', '<Cd>URGP</Cd>'], ['<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>DEBT</ChrgBr>']);
    await trip('cross-border between EEA banks with DEBT', { country: 'CZ', xml: czEea, key: '7.20' });
    const longNm = 'Lindenhof Metall und Maschinenbau GmbH';
    await trip('cross-border creditor name longer than kept', { country: 'UA', xml: edit(ua03, ['<Cdtr><Nm>Lindenhof Metall GmbH</Nm>', `<Cdtr><Nm>${longNm}</Nm>`]), key: '7.25',
      check: p => [rowNext(p) === longNm.slice(0, 35).trimEnd() && p.rows[0].element === 'Cdtr/Nm', JSON.stringify(p.rows)], what: 'the first 35 characters' });
    await trip('cross-border debtor name longer than kept', { v: '09', country: 'UA', xml: edit(gen.generate({ version: '09', transactions: 2, type: 'CROSS_BORDER', country: 'UA' }), ['<Dbtr><Nm>Beispiel Handels GmbH</Nm>', '<Dbtr><Nm>Beispiel Handels und Vertriebs GmbH Kyiv</Nm>']),
      key: '7.25', check: p => [p.rows.length === 1 && p.rows[0].element === 'Dbtr/Nm', JSON.stringify(p.rows)], what: 'the block\'s own text' });
  }

  head('M3 fix actions: consistency (stage 9) and hints (stage 10)');
  {
    await trip('PmtInfId used twice', { xml: gen.generate({ version: '03', transactions: 4, blocks: 2, defects: ['dup-pmtinf'] }), key: '9.1',
      check: p => [p.rows.length === 1 && rowNext(p) === 'PMT-01-2' && p.rows[0].where === 'Block 2', JSON.stringify(p.rows)], what: 'the second block gets PMT-01-2' });
    await trip('InstrId used twice', { v: '09', xml: edit(a09, ['<InstrId>INS-000002</InstrId>', '<InstrId>INS-000001</InstrId>']), key: '9.2' });
    await trip('EndToEndId used twice', { xml: gen.generate({ version: '03', transactions: 6, blocks: 2, defects: ['dup-e2e'] }), key: '9.3', check: p => [rowNext(p) === 'E2E-000001-2', rowNext(p)], what: 'E2E-000001-2' });
    const id35 = 'E'.repeat(35);
    await trip('EndToEndId of 35 characters used twice', { xml: edit(a03, ['<EndToEndId>E2E-000001</EndToEndId>', `<EndToEndId>${id35}</EndToEndId>`], ['<EndToEndId>E2E-000003</EndToEndId>', `<EndToEndId>${id35}</EndToEndId>`]), key: '9.3',
      check: p => [rowNext(p) === 'E'.repeat(33) + '-2', rowNext(p)], what: 'cut to stay within 35' });
    const uetr = /<UETR>([^<]*)</.exec(a09)[1];
    await trip('UETR used twice', { v: '09', xml: edit(a09, [/(E2E-000003<\/EndToEndId><UETR>)[^<]*/, `$1${uetr}`]), key: '9.4',
      check: p => [p.rows.length === 1 && rowNext(p) !== uetr, rowNext(p)], what: 'a new UUID for the second' });
    const acct = /<DbtrAcct><Id><IBAN>([^<]*)</.exec(a03)[1];
    await trip('same debtor account with another name', { xml: edit(a03, [/(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<Dbtr><Nm>)Beispiel Handels GmbH/, '$1Beispiel Handels AG'], [/(<PmtInfId>PMT-02<\/PmtInfId>[\s\S]*?<DbtrAcct><Id><IBAN>)[^<]*/, `$1${acct}`]), key: '9.7',
      check: p => [rowNext(p) === 'Beispiel Handels GmbH', rowNext(p)], what: 'the name of block 1' });

    for (const v of ['03', '09']) {
      const x = gen.generate({ version: v, transactions: 4, blocks: 2, now: TUE });
      await trip('execution date on Christmas Day', { v, now: TUE, xml: execDate(x, v, '2026-12-25'), key: '10.1', check: p => [rowNext(p) === '2026-12-28', rowNext(p)], what: 'Monday 28 December' });
    }
    await trip('text CMIplus would shorten', { xml: a03, over: { hints: { truncateLength: { 'RmtInf/Ustrd': 10 } } }, key: '10.3', pick: p => p.rows[0].tx != null,
      check: p => [p.rows.length === 6 && p.rows.every(r => r.val === 'Invoice 40'), JSON.stringify(p.rows.slice(0, 2))], what: 'every transaction, cut to 10' });
  }

  head('M3 fix actions: no change possible, never an exception');
  {
    // a finding whose element is not in the file (another version of the text) or has children
    const r = await validate(a03, '03');
    const fake = (key, xpath, level) => {
      const [rule, ...part] = key.split('-');
      return { ...r, groups: [{ id: 'g1', rule, part: part.join('-') || null, severity: 'E', title: key, level, items: [{ xpath, level, where: 'Block 1, transaction 1', block: 1, tx: 1, message: 'x', expected: 'at most 35 characters' }] }] };
    };
    const missing = [], children = [];
    for (const [key, def] of Object.entries(fixes.fixes)) {
      if (!def.action) continue;
      for (const [xpath, list] of [[`${P}/PmtInf[1]/CdtTrfTxInf[9]/Cdtr[1]/Nm[1]`, missing], [`${P}/PmtInf[1]/CdtTrfTxInf[1]`, children]]) {
        let out;
        try { out = F.propose(fake(key, xpath, 'tx'), a03, opts('AT')); } catch (e) { list.push(`${key}: ${e.message}`); continue; }
        const m = out.manual[0];
        if (out.proposals.length && list === missing) list.push(`${key}: proposed ${JSON.stringify(out.proposals[0].rows)}`);
        else if (!out.proposals.length && (!m || !m.reason || /could not be prepared/.test(m.reason))) list.push(`${key}: ${m && m.reason}`);
      }
    }
    ok(!missing.length, 'every fix: a finding on an element that is not in the file stays manual, with a reason', missing.join('\n'));
    ok(!children.length, 'every fix: a finding on an element with children gives no exception', children.join('\n'));
    const ns = await validate(a03.replace(/<CtrlSum>[^<]*<\/CtrlSum>/, '<CtrlSum>1.00</CtrlSum>'), '03');
    const cut = F.propose(ns, a03.replace(/<CtrlSum>[^<]*<\/CtrlSum>\s*/, ''), opts('AT'));
    ok(!cut.proposals.some(p => p.rule === '4.4') && /no CtrlSum/.test((cut.manual.find(m => m.rule === '4.4') || {}).reason || ''), '4.4 on a text without the element: manual, "The file has no CtrlSum here."', JSON.stringify(cut.manual));
  }

  head('M3 fix actions: config/fixes.json');
  {
    const ruleKeys = new Set();
    for (const f of fs.readdirSync(path.join(ROOT, 'rules/stages')).filter(f => f.endsWith('.sch'))) for (const m of fs.readFileSync(path.join(ROOT, 'rules/stages', f), 'utf8').matchAll(/id="R([0-9X][^"]*)"/g)) ruleKeys.add(m[1]);
    for (const id of Object.keys(t.catalogue.rules)) if (/^([2-9]|10)\./.test(id) && !/^(6\.7|7\.7|10\.4|10\.5)$/.test(id) && (id.startsWith('2.') || ![...ruleKeys].some(k => k.split('-')[0] === id))) ruleKeys.add(id);
    const missingKeys = [...ruleKeys].filter(k => !F.defOf(fixes, { rule: k.split('-')[0], part: k.split('-').slice(1).join('-') || null }));
    ok(!missingKeys.length, `every check and part of stages 2–10 has an entry (${ruleKeys.size})`, missingKeys.join(', '));
    const bad = Object.entries(fixes.fixes).filter(([k, d]) => (d.action ? !TP.fix.actions[d.action] || !d.field || d.manual : !d.manual || d.manual.length > 160) || (d.note && d.note.length > 220));
    ok(!bad.length, 'every entry: a known action with a field, or a short manual text', bad.map(b => b[0]).join(', '));
    const kinds = Object.values(fixes.fixes).filter(d => d.action);
    ok(kinds.every(d => !(d.changesPayment && kindOf(d) !== 'calculated')) && kinds.every(d => !['sample', 'entry', 'choice'].includes(kindOf(d)) || d.check || d.options), 'changesPayment only on calculated fixes; samples, entries and choices have a check or options');
    const untested = Object.keys(fixes.fixes).filter(k => fixes.fixes[k].action && !tripped.has(k));
    ok(!untested.length, 'every fix of config/fixes.json has a round trip above', untested.join(', '));
  }

  head('M3 fix actions: speed');
  {
    // 10,000 cross-border transactions with findings of many kinds: 7.19 (SLEV), 5.4-spaces, 7.25 (long names), 9.3, 4.3, 4.4, 4.7, 4.8
    let x = gen.generate({ version: '03', transactions: 10000, blocks: 4, type: 'CROSS_BORDER', country: 'UA' });
    x = x.replace(/<ChrgBr>SHAR<\/ChrgBr>/g, '<ChrgBr>SLEV</ChrgBr>').replace(/<Ustrd>Invoice (\d+)<\/Ustrd>/g, '<Ustrd>Invoice $1 </Ustrd>')
      .replace(/<Cdtr><Nm>([^<]*)<\/Nm>/g, '<Cdtr><Nm>$1 International Trading</Nm>').replace(/<EndToEndId>E2E-(\d{5})[13579]<\/EndToEndId>/g, '<EndToEndId>E2E-$10</EndToEndId>')
      .replace(/<NbOfTxs>10000<\/NbOfTxs>/, '<NbOfTxs>9999</NbOfTxs>').replace(/(<GrpHdr>[\s\S]*?<CtrlSum>)[^<]*/, '$11.00').replace(/(<PmtInf>[\s\S]*?<CtrlSum>)[^<]*/, '$12.00');
    const r = await validate(x, '03', 'UA');
    const n = r.groups.reduce((s, g) => s + g.items.length, 0);
    const t0 = Date.now();
    const out = F.propose(r, x, opts('UA'));
    const ms = Date.now() - t0;
    const rows = out.proposals.reduce((s, p) => s + p.rows.length, 0);
    ok(n > 30000 && rows > 25000 && ms < 2000, `speed: changes for ${n.toLocaleString('en')} findings proposed in ${ms} ms (${rows.toLocaleString('en')} rows, ${out.proposals.length} proposals)`, out.proposals.map(p => `${keyOf(p)}:${p.rows.length}`).join(' '));
  }
};
