/*
 * M3 – the email for the customer: js/email/build.js, config/templates/email.en.json, js/ui/email.js.
 * Sessions are built by hand from validate() results (docs/specs/M3.md section 4);
 * the changes of a fix round are written as TP.fix.apply returns them (section 3.2; kind calculated, sample, choice or entered).
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async t => {
  const { ok, head, gen, validate, xsd, catalogue, TP, clean03, clean09, ROOT } = t;
  require(path.join(ROOT, 'js/email/build.js'));
  const E = TP.email;
  const TEMPLATE = path.join(ROOT, 'config/templates/email.en.json');
  const raw = fs.readFileSync(TEMPLATE, 'utf8');
  let tpl = null;
  try { tpl = JSON.parse(raw); } catch (err) { /* reported below */ }
  const clone = o => JSON.parse(JSON.stringify(o));

  // a result as TP.validation.validate returns it, and a run of the session
  const meta = (rep, fileName, extra) => ({ ...rep, fileName, country: 'AT', countryName: 'Austria', version: '03', versionLabel: 'pain.001.001.03', at: '2026-11-24T10:00:00.000Z', app: { version: '0.4.0-m3' }, ...extra });
  const runOf = (n, result, extra) => ({ n, fileName: result.fileName, label: `Run ${n}`, at: result.at, country: 'AT', version: result.version, status: result.status, counts: result.counts,
    incomplete: !!result.incomplete, source: 'upload', parent: null, changes: [], text: '', result, ...extra });
  const one = run => ({ runs: [run], current: run.n });
  const build = (session, run, ctx) => E.build(session, run, { template: tpl, ...ctx });
  const lines = body => body.split('\n');
  const listLines = body => lines(body).filter(l => /^- /.test(l));
  const PASSED_NOTE = tpl && tpl.notes.passed, INCOMPLETE_NOTE = tpl && tpl.notes.incomplete;
  const built = []; // every email of these tests, checked for payment data at the end
  const keep = (e, rep) => { built.push({ e, rep }); return e; };

  head('M3 email: template file');
  ok(tpl && typeof tpl === 'object', 'config/templates/email.en.json is valid JSON');
  if (!tpl) return;
  ok(Array.isArray(tpl._about) && tpl._about.join(' ').length > 500, 'the template explains itself in _about');
  const problems = E.checkTemplate(tpl);
  ok(problems.length === 0, 'the template has no problems (checkTemplate)', problems.join(' | '));
  ok(E.CASES.every(c => tpl.cases[c] && tpl.cases[c].subject && tpl.cases[c].text.length), 'every case has a subject and a text: ' + E.CASES.join(', '));
  ok(tpl.greeting === 'Dear Customer,' && JSON.stringify(tpl.signature) === '["Kind regards","Payments Service Desk"]', 'greeting "Dear Customer,", signed "Kind regards / Payments Service Desk"');
  {
    const about = JSON.stringify(tpl._about) + JSON.stringify(Object.values(tpl).map(v => v && v._about));
    const undocumented = E.PLACEHOLDERS.filter(p => !about.includes(`{${p}}`));
    ok(!undocumented.length, 'every placeholder the tool knows is explained in an _about note', undocumented.join(', '));
    ok(/does not guarantee/.test(PASSED_NOTE) && ['Account status', 'funds', 'entitlements', 'sanctions'].every(w => PASSED_NOTE.includes(w)), 'the passed note says the check does not guarantee execution (account, funds, entitlements, sanctions)');
    ok(!/\\"/.test(JSON.stringify(Object.values(tpl.cases))), 'the case texts use no double quotes (nothing to escape when editing)');
  }
  {
    const bad = clone(tpl);
    bad.cases.rejected.text[0] = 'We tested {fiel} for {country}.';
    bad.cases.rejected.subject = 'Test {findings}';
    bad.cases.fixed.text.push('{changes} and {samples}');
    delete bad.cases.warnings;
    bad.counts.errors.n = 'errors';
    delete bad.cases.fixed.copyResult.ACWC;
    bad.lists.max = 0;
    const p = E.checkTemplate(bad).join(' | ');
    ok(/cases\.rejected\.text\[1\]: \{fiel\} is not a placeholder/.test(p), 'checkTemplate: an unknown placeholder, with the paragraph', p);
    ok(/cases\.rejected\.subject: the list \{findings\} cannot be used in the subject/.test(p), 'checkTemplate: a list in the subject');
    ok(/only one list per paragraph/.test(p), 'checkTemplate: two lists in one paragraph');
    ok(/cases\.warnings: missing/.test(p) && /counts\.errors\.n: must be a text with \{n\}/.test(p) && /cases\.fixed\.copyResult\.ACWC: missing/.test(p) && /lists\.max/.test(p), 'checkTemplate: a missing case, a count without {n}, a missing result sentence, lists.max 0');
    ok(E.checkTemplate(null).length === 1 && E.checkTemplate([]).length === 1, 'checkTemplate: not an object');
  }

  head('M3 email: rejected, warnings, passed');
  const defects = meta(await validate(gen.generate({ version: '03', transactions: 12, blocks: 2, defects: gen.DEFECTS }), '03'), 'payments_2026-11.xml');
  const r1 = runOf(1, defects);
  const rej = keep(build(one(r1), r1), defects);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  ok(rej.case === 'rejected' && E.caseOf(one(r1), r1) === 'rejected', 'RJCT without changes: case rejected');
  ok(rej.to === '' && rej.subject === `Test of your payment file payments_2026-11.xml: rejected (${plural(defects.counts.E, 'error')})`, 'To is empty; subject with the file name and the number of errors', rej.subject);
  ok(rej.body.startsWith('Dear Customer,\n\nWe tested your payment file payments_2026-11.xml for Austria.') && rej.body.endsWith('\n\nKind regards\nPayments Service Desk\n'), 'greeting, file and country, signature', rej.body.slice(0, 120));
  ok(rej.body.includes(`we found ${plural(defects.counts.E, 'error')} and ${plural(defects.counts.W, 'warning')}.`), 'the numbers of errors and warnings');
  {
    const L = listLines(rej.body);
    const ew = defects.groups.filter(g => g.severity !== 'I');
    ok(L.length === (ew.length <= 11 ? ew.length : 10), `one line per error and warning (${L.length} of ${ew.length})`, L.join('\n'));
    const firstW = L.findIndex(l => l.startsWith('- EndToEndId is used more than once'));
    ok(firstW === L.length - 1, 'errors first, then warnings', L.join('\n'));
    ok(!L.some(l => l.includes('Older pain.001 version')), 'hints are not listed with the errors');
    const g428 = defects.groups.find(g => g.rule === '4.28'), it = g428.items[0];
    ok(L.includes(`- Creditor name is missing (payment block ${it.block}, transaction ${it.tx}, EndToEndId ${it.e2e})`), 'one transaction: block, transaction and EndToEndId', L.join('\n'));
    ok(L.includes('- Payment block ID is used more than once (2 payment blocks)'), 'two blocks: "2 payment blocks"');
    ok(L.includes('- EndToEndId is used more than once (2 transactions in payment block 1)'), 'two transactions of one block: "2 transactions in payment block 1"');
    ok(L.includes('- Number of transactions doesn’t match (group header)') || L.some(l => /^- Number of transactions .* \(group header\)$/.test(l)), 'a finding in the group header: "(group header)"', L.join('\n'));
  }
  ok(!rej.body.includes(PASSED_NOTE) && !rej.body.includes(INCOMPLETE_NOTE), 'rejected: no passed note, no incomplete note');
  ok(JSON.stringify(rej.attachments) === '[{"kind":"report","name":"payments_2026-11_report.html"}]', 'rejected: the report is the only attachment', JSON.stringify(rej.attachments));
  {
    // more findings than lists.max: 10 lines, then "and N more"; one more than max is shown rather than "and 1 more"
    const fake = n => meta({ ...defects, groups: Array.from({ length: n }, (x, i) => ({ id: 'g' + i, rule: '9.' + i, source: 'rules', severity: 'E', level: 'tx', title: `Check number ${i + 1}`, message: 'm', items: [{ level: 'tx', block: 1, tx: i + 1, e2e: 'E2E-' + (i + 1), message: 'm' }], count: 1 })), counts: { E: n, W: 0, I: 0 }, status: 'RJCT' }, 'many.xml');
    const e14 = build(one(runOf(1, fake(14))), null), e11 = build(one(runOf(1, fake(11))), null);
    const L14 = lines(e14.body), i10 = L14.indexOf('- Check number 10 (payment block 1, transaction 10, EndToEndId E2E-10)');
    ok(listLines(e14.body).length === 10 && L14[i10 + 1] === 'and 4 more, listed in the report', '14 findings: 10 lines, then "and 4 more, listed in the report"', e14.body);
    ok(listLines(e11.body).length === 11 && !/more, listed/.test(e11.body), '11 findings: all 11 lines');
    const e5 = build(one(runOf(1, fake(5))), null, { template: { ...tpl, lists: { ...tpl.lists, max: 2 } } });
    ok(listLines(e5.body).length === 2 && e5.body.includes('- Check number 2 (payment block 1, transaction 2, EndToEndId E2E-2)\nand 3 more, listed in the report'), 'lists.max from the template (2: two lines, then "and 3 more")', e5.body);
  }
  {
    const many = clean03.replace(/<Ctry>(DE|AT|NL)<\/Ctry>(<\/PstlAdr><\/Cdtr>)/g, '<Ctry>de</Ctry>$2');
    const rep = meta(await validate(many, '03'), 'ctry.xml');
    const g = rep.groups.find(x => x.rule === '2.7');
    const e = keep(build(one(runOf(1, rep)), null), rep);
    const blocks = new Set(g.items.map(i => i.block)).size;
    const want = `- ${g.title}, element Ctry (${g.count} transactions${blocks === 1 ? ' in payment block 1' : ''})`;
    ok(listLines(e.body).includes(want), 'a schema finding names its element: ' + want, e.body);
  }
  const warnRep = meta(await validate(clean03.replace('<EndToEndId>E2E-000003</EndToEndId>', '<EndToEndId>E2E-000001</EndToEndId>'), '03'), 'warn.xml');
  const warn = keep(build(one(runOf(1, warnRep)), null), warnRep);
  ok(warn.case === 'warnings' && warn.subject === 'Test of your payment file warn.xml: passed with 1 warning', 'ACWC: case warnings, "passed with 1 warning"', warn.subject);
  ok(warn.body.includes('passes the technical check with 1 warning (ACWC)') && listLines(warn.body).join() === '- EndToEndId is used more than once (2 transactions in payment block 1)', 'warnings: the result and the list of warnings', warn.body);
  ok(warn.body.endsWith(`${PASSED_NOTE}\n\nKind regards\nPayments Service Desk\n`), 'warnings: the text ends with the passed note before the signature');
  const pass09 = meta(await validate(clean09, '09'), 'clean09.xml', { version: '09', versionLabel: 'pain.001.001.09' });
  const pass = keep(build(one(runOf(1, pass09)), null), pass09);
  ok(pass.case === 'passed' && pass.subject === 'Test of your payment file clean09.xml: passed' && pass.body.includes('passes the technical check (ACTC)'), 'ACTC: case passed');
  ok(pass.body.includes(PASSED_NOTE) && !listLines(pass.body).length && !/Hints are/.test(pass.body), 'passed without hints: the passed note, no list, no hint paragraph');
  const pass03 = meta(await validate(clean03, '03'), 'clean03.xml');
  const passH = keep(build(one(runOf(1, pass03)), null), pass03);
  ok(passH.case === 'passed' && /The report also lists 1 hint\. Hints are suggestions and do not affect acceptance:\n- Older pain\.001 version used \(/.test(passH.body), 'passed with a hint: the hint is listed', passH.body);

  head('M3 email: incomplete, unreadable, unsupported');
  {
    const eng = { id: 'gx', key: 'x', rule: '4.engine', stage: 4, source: 'rules', severity: 'W', level: 'file', title: 'Some checks could not run', message: 'The rule checks (stages 3–10) could not run: boom', items: [{ level: 'file', message: 'The rule checks (stages 3–10) could not run: boom' }], count: 1 };
    const inc = { ...pass09, fileName: 'inc.xml', incomplete: true, groups: [...pass09.groups, eng], counts: { E: 0, W: 1, I: 0 }, status: 'ACWC' };
    const e = keep(build(one(runOf(1, inc)), null), inc);
    ok(e.incomplete && e.case === 'passed' && e.body.includes(INCOMPLETE_NOTE), 'incomplete: the extra sentence; "could not run" is not counted as a warning', e.case);
    ok(!/boom|Some checks could not run \(/.test(e.body) && e.body.indexOf(INCOMPLETE_NOTE) < e.body.indexOf(PASSED_NOTE), 'incomplete: the failure is not listed; the note comes before the passed note');
    const incR = { ...defects, fileName: 'incr.xml', incomplete: true, groups: [...defects.groups, eng], counts: { ...defects.counts, W: defects.counts.W + 1 } };
    const er = build(one(runOf(1, incR)), null);
    ok(er.case === 'rejected' && er.body.includes(INCOMPLETE_NOTE) && er.body.includes(`and ${plural(defects.counts.W, 'warning')}.`), 'incomplete and rejected: the note, and the warnings counted without the failure');
  }
  const stopRun = (findings, stopped, fileName, extra) => {
    const rep = meta(TP.report.build({ findings, catalogue, stopped }), fileName, { stopped, version: null, versionLabel: null, ...extra });
    return runOf(1, rep);
  };
  const u16 = stopRun(TP.stages.intake.run({ bytes: Uint8Array.from([0xFF, 0xFE, 0x3c, 0x00, 0x61, 0x00]) }).findings, 'intake', 'utf16.xml');
  const eU = keep(build(one(u16), null), u16.result);
  ok(eU.case === 'unreadable' && eU.subject === 'Test of your payment file utf16.xml: the file could not be read', 'stage 0 stopped: case unreadable', eU.subject);
  ok(eU.body.includes(`Reason: ${catalogue.rules['0.5'].title}. The file is UTF-16 encoded.`) && eU.body.includes(catalogue.rules['0.5'].hint), 'unreadable: the catalogue title, the message and the hint', eU.body);
  ok(!eU.body.includes(PASSED_NOTE) && !/ACTC|RJCT/.test(eU.body) && eU.attachments.length === 1 && eU.attachments[0].name === 'utf16_report.html', 'unreadable: no passed note, no status, the report attached');
  const nwf = await xsd(clean03.replace('<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>Novak & Partner</Nm>'), '03');
  const eW = keep(build(one(stopRun(nwf.findings, 'well-formed', 'amp.xml')), null), null);
  ok(eW.case === 'unreadable' && eW.body.includes(`At line ${nwf.findings[0].line}: An & is not written as &amp;.`), 'not well-formed (0.7): unreadable, with the line', eW.body);
  ok(!eW.body.includes('Novak'), 'not well-formed: no value from the file');
  const dd = stopRun(TP.stages.identify.run({ text: clean03.replace(/pain\.001\.001\.03/g, 'pain.008.001.02'), country: 'AT' }).findings, 'identify', 'dd.xml');
  const eD = keep(build(one(dd), null), null);
  ok(eD.case === 'unsupported' && eD.subject === 'Test of your payment file dd.xml: format not supported' && /direct debit/.test(eD.body), 'stage 1 stopped: case unsupported, with the reason', eD.body);
  ok(eD.body.includes('in the format pain.001.001.03 or pain.001.001.09') && !/At line/.test(eD.body), 'unsupported: the accepted formats; no line (it is only the root element)');
  ok(build(one(dd), null, { countryConfig: { versions: ['09'] } }).body.includes('in the format pain.001.001.09.'), 'unsupported: the formats of the country');

  head('M3 email: after a fix');
  const g428 = defects.groups.find(g => g.rule === '4.28').items[0];
  const CHANGES = [
    { rule: '4.3', part: null, title: 'Number of transactions doesn’t match', field: 'Number of transactions (group header)', kind: 'calculated', rows: [{ where: 'File', block: null, tx: null, e2e: null, old: '13', next: '12' }] },
    { rule: '4.4', part: null, title: 'Control sum doesn’t match the transactions', field: 'Control sum (group header)', kind: 'calculated', rows: [{ where: 'File', block: null, tx: null, e2e: null, old: '391207.69', next: '391207.71' }] },
    { rule: '4.10', part: null, title: 'Execution date is in the past', field: 'Requested execution date', kind: 'calculated', rows: [{ where: 'Block 1', block: 1, tx: null, e2e: null, old: '2020-01-02', next: '2026-11-25' }] },
    { rule: '4.28', part: null, title: 'Creditor name is missing', field: 'Creditor name', kind: 'sample', rows: [{ where: g428.where, block: g428.block, tx: g428.tx, e2e: g428.e2e, old: null, next: 'Sample Creditor Name' }] },
    { rule: '5.6', part: 'cdtr', title: 'Creditor IBAN is not valid', field: 'Creditor IBAN', kind: 'entered', rows: [{ where: 'Block 2, transaction 2', block: 2, tx: 2, e2e: 'E2E-000004', old: 'DE06999999990000001003', next: 'AT611904300234573201' }] }
  ];
  const leftRep = meta(await validate(gen.generate({ version: '03', transactions: 12, blocks: 2, defects: ['dup-pmtinf', 'two-ustrd'] }), '03'), 'payments_2026-11_corrected.xml');
  const f2 = runOf(2, leftRep, { source: 'fix', parent: 1, changes: CHANGES });
  const s12 = { runs: [r1, f2], current: 2 };
  const fx = keep(build(s12, f2), leftRep);
  ok(fx.case === 'fixed' && E.caseOf(s12, f2) === 'fixed', 'changes applied: case fixed');
  ok(fx.subject === `Test of your payment file payments_2026-11.xml: ${plural(defects.counts.E, 'error')} and ${plural(defects.counts.W, 'warning')}, corrected copy for reference`, 'fixed: subject with the name of the file the customer sent and what was found', fx.subject);
  ok(fx.body.includes(`We tested your payment file payments_2026-11.xml for Austria. CMIplus would reject the file as it stands: we found ${plural(defects.counts.E, 'error')} and ${plural(defects.counts.W, 'warning')}.`), 'fixed: what was found in the original');
  ok(fx.body.includes('We also attach a corrected copy of the file, payments_2026-11_corrected.xml.') && fx.body.includes('Please use it as a reference only, not for payments.'), 'fixed: the corrected copy, for reference only');
  ok(fx.body.includes(`It still has ${plural(leftRep.counts.E, 'error')}, so CMIplus would still reject it.`) && !fx.body.includes(PASSED_NOTE), 'fixed, errors left: "still reject", no passed note', fx.body);
  {
    const L = lines(fx.body), at = L.indexOf('In the corrected copy we changed:');
    ok(at > 0 && L.slice(at + 1, at + 5).join('\n') === '- Number of transactions (group header)\n- Control sum (group header)\n- Requested execution date (payment block 1)\n- Creditor IBAN (payment block 2, transaction 2, EndToEndId E2E-000004)', 'fixed: the changes with field and place; sample values not among them', L.slice(at, at + 6).join('\n'));
    const s = L.indexOf('The corrected copy contains 1 sample value where data was missing. Your files must contain real data in these places:');
    ok(s > 0 && L[s + 1] === `- Creditor name, payment block ${g428.block}, transaction ${g428.tx}, EndToEndId ${g428.e2e}: Sample Creditor Name`, 'fixed: the sample value with field, place and value', L.slice(s, s + 2).join('\n'));
    const o = L.indexOf('These findings are not corrected in the copy. Please correct them in your system:');
    const openWant = leftRep.groups.filter(g => g.severity !== 'I').length;
    ok(o > 0 && listLines(L.slice(o + 1).join('\n').split('\n\n')[0]).length === openWant && L[o + 1].startsWith('- Payment block ID is used more than once'), 'fixed: the findings left in the copy', L.slice(o, o + 4).join('\n'));
    ok(/To stop the same findings coming back, please change the system that generates your payment files\. When your system produces a corrected file, please send it to us for the end-to-end test\./.test(fx.body), 'fixed: change the system, then send the file for the end-to-end test');
  }
  ok(JSON.stringify(fx.attachments) === '[{"kind":"report","name":"payments_2026-11_corrected_report.html"},{"kind":"xml","name":"payments_2026-11_corrected.xml"}]', 'fixed: report and corrected file attached', JSON.stringify(fx.attachments));
  const cleanFix = meta(await validate(clean09, '09'), 'payments_2026-11_corrected.xml');
  const f2b = runOf(2, cleanFix, { source: 'fix', parent: 1, changes: CHANGES });
  const fxOk = keep(build({ runs: [r1, f2b], current: 2 }, f2b), cleanFix);
  ok(fxOk.body.includes('payments_2026-11_corrected.xml. It passes the technical check (ACTC). Please use it') && !/not corrected in the copy/.test(fxOk.body), 'fixed, ACTC: "passes", no paragraph of findings left', fxOk.body);
  ok(fxOk.body.endsWith(`${PASSED_NOTE}\n\nKind regards\nPayments Service Desk\n`), 'fixed, ACTC: ends with the passed note');
  {
    const acwc = { ...cleanFix, groups: warnRep.groups, counts: warnRep.counts, status: 'ACWC' };
    const e = build({ runs: [r1, runOf(2, acwc, { source: 'fix', parent: 1, changes: CHANGES })], current: 2 }, null);
    ok(e.body.includes('It passes the technical check with 1 warning (ACWC).') && e.body.includes(PASSED_NOTE), 'fixed, ACWC: "passes with 1 warning", the passed note');
  }
  {
    // two rounds: the changes of both; a sample value changed again in round 2 is no longer a sample value
    const round2 = [{ rule: '4.28', part: null, title: 'Creditor name', field: 'Creditor name', kind: 'entered', rows: [{ where: g428.where, block: g428.block, tx: g428.tx, e2e: g428.e2e, old: 'Sample Creditor Name', next: 'Real Name GmbH' }] },
      { rule: '7.19', part: null, title: 'Charge bearer', field: 'Charge bearer', kind: 'choice', rows: [{ where: 'Block 2', block: 2, tx: null, e2e: null, old: 'CRED', next: 'SHAR' }] }];
    const f3 = runOf(3, { ...cleanFix, fileName: 'payments_2026-11_corrected2.xml' }, { source: 'fix', parent: 2, changes: round2 });
    const s123 = { runs: [r1, f2b, f3], current: 3 };
    const ch = E.chainOf(s123, f3);
    ok(ch.original === r1 && ch.fixes.length === 2 && ch.changes.length === CHANGES.length + 2, 'chainOf: two fix rounds back to the upload');
    const e = keep(build(s123, f3), cleanFix);
    ok(e.case === 'fixed' && e.body.includes('corrected copy of the file, payments_2026-11_corrected2.xml.') && e.body.includes('We tested your payment file payments_2026-11.xml'), 'two rounds: the latest corrected copy, the original file name');
    ok(e.body.includes('- Charge bearer (payment block 2)') && e.body.includes('- Creditor name (payment block') && !/sample value/.test(e.body) && !e.body.includes('Real Name GmbH'), 'two rounds: all changes; the replaced sample value is gone; no entered value', e.body);
    // a later upload in the chain is the customer's own new file: its own case, without the earlier changes
    const up = runOf(4, { ...warnRep, fileName: 'payments_2026-11_v2.xml' }, { parent: 3 });
    const e4 = build({ runs: [r1, f2b, f3, up], current: 4 }, null);
    ok(e4.case === 'warnings' && e4.attachments.length === 1 && e4.subject.includes('payments_2026-11_v2.xml'), 'a new upload after a fix: its own case (warnings), no corrected copy', e4.case);
    // a fix run that applied nothing: the case of its result, and the customer's own file name
    const f0 = runOf(2, { ...defects, fileName: 'payments_2026-11_corrected.xml' }, { source: 'fix', parent: 1, changes: [] });
    const e0 = build({ runs: [r1, f0], current: 2 }, f0);
    ok(e0.case === 'rejected' && e0.subject.startsWith('Test of your payment file payments_2026-11.xml:') && !e0.body.includes('_corrected.xml'), 'a fix run without changes: rejected, about the file the customer sent', e0.subject);
  }
  {
    // "Fix the warnings": the original passed with warnings
    const fw = runOf(2, cleanFix, { source: 'fix', parent: 1, changes: [{ rule: '9.3', part: null, title: 'EndToEndId', field: 'EndToEndId', kind: 'calculated', rows: [{ where: 'Block 1, transaction 2', block: 1, tx: 2, e2e: 'E2E-000001', old: 'E2E-000001', next: 'E2E-000001-2' }] }] });
    const w1 = runOf(1, warnRep);
    const e = build({ runs: [w1, fw], current: 2 }, fw);
    ok(e.case === 'fixed' && e.body.includes('CMIplus would accept the file, but we found 1 warning that should be corrected.') && e.subject.endsWith(': 1 warning, corrected copy for reference'), 'fixed after warnings only: the ACWC sentence', e.body.split('\n\n')[1]);
    // only the counts of the original are kept (older than the last 3 results)
    const e2 = build({ runs: [{ ...w1, result: null }, fw], current: 2 }, fw);
    ok(e2.case === 'fixed' && e2.body.includes('we found 1 warning that should be corrected'), 'the original without its result: its counts are enough');
  }
  {
    // many places: counted; sample values grouped by value
    const rows = (n, b0) => Array.from({ length: n }, (x, i) => ({ where: '', block: b0 + (i % 2), tx: i + 1, e2e: 'E-' + i, old: 'x', next: 'y' }));
    const big = [{ rule: '5.4', part: 'spaces', title: 'Spaces', field: 'Text with spaces at the start or end', kind: 'calculated', rows: rows(200, 1) },
      { rule: '4.28', part: null, title: 'Name', field: 'Creditor name', kind: 'sample', rows: [2, 4, 6].map(tx => ({ where: '', block: 2, tx, e2e: null, old: null, next: 'Sample Creditor Name' })) }];
    const e = build({ runs: [r1, runOf(2, cleanFix, { source: 'fix', parent: 1, changes: big })], current: 2 }, null);
    ok(e.body.includes('- Text with spaces at the start or end (200 transactions)') && e.body.includes('contains 3 sample values') && e.body.includes('- Creditor name, 3 transactions in payment block 2: Sample Creditor Name'), '200 places: "200 transactions"; 3 sample values in one line', e.body);
  }

  head('M3 email: no payment data');
  {
    const sensitive = new Set();
    const add = v => { if (v != null && String(v).trim().length >= 4) sensitive.add(String(v).trim()); };
    for (const { rep } of built) {
      if (!rep || !rep.blocks) continue;
      for (const b of rep.blocks) {
        for (const k of ['id', 'debtor', 'debtorAccount', 'debtorBic', 'ctrlSum']) add(b[k]);
        for (const s of b.sums || []) add(s);
        for (const x of b.txs) { for (const k of ['creditor', 'account', 'iban', 'amount', 'creditorBic', 'instrId']) add(x[k]); add(TP.report.fmtAmount(TP.report.toUnits(x.amount) || 0n, x.ccy)); }
      }
      for (const s of rep.facts.totals || []) add(s);
      if (rep.facts.grp) for (const v of Object.values(rep.facts.grp)) add(v);
    }
    for (const c of CHANGES) for (const r of c.rows) if (c.kind !== 'sample') { add(r.old); add(r.next); }
    add('Beispiel Handels GmbH');
    const leaks = [];
    for (const { e } of built) for (const v of sensitive) if (e.subject.includes(v) || e.body.includes(v)) leaks.push(`${e.case}: ${v}`);
    ok(sensitive.size > 100 && built.length >= 10, `${sensitive.size} values of the files collected, ${built.length} emails`);
    ok(!leaks.length, 'no email contains amounts, names, accounts, BICs, ids or changed values from the file (EndToEndIds and sample values only)', leaks.slice(0, 10).join(' | '));
    const untitled = { ...defects, groups: [{ id: 'g1', rule: '9.99', source: 'rules', severity: 'E', level: 'tx', title: 'Value AT611904300234573201 is wrong', message: 'Value AT611904300234573201 is wrong', items: [{ level: 'tx', block: 1, tx: 1, e2e: 'E-1', message: 'Value AT611904300234573201 is wrong' }], count: 1 }], counts: { E: 1, W: 0, I: 0 }, status: 'RJCT' };
    const e = build(one(runOf(1, untitled)), null);
    ok(e.body.includes('- Finding of check 9.99 (payment block 1, transaction 1, EndToEndId E-1)') && !e.body.includes('AT61'), 'a check without a catalogue title: "Finding of check 9.99", not its message');
  }

  head('M3 email: template edits, mailto');
  {
    const edited = clone(tpl);
    edited.greeting = 'Hello,';
    edited.counts.errors = { '1': 'one problem', n: '{n} problems' };
    edited.signature = ['Best wishes', 'The Testing Team'];
    edited.cases.rejected.text.push('Typo {fiel} stays visible.');
    edited.lists.finding = '* {title} [{where}]';
    const e = E.build(one(r1), r1, { template: edited });
    ok(e.body.startsWith('Hello,\n') && e.body.includes(`we found ${defects.counts.E} problems and`) && e.subject.endsWith(`(${defects.counts.E} problems)`) && e.body.endsWith('Best wishes\nThe Testing Team\n'), 'an edited template changes the email (greeting, count words, signature)');
    ok(lines(e.body).some(l => /^\* .+ \[.+\]$/.test(l)) && e.body.includes('Typo {fiel} stays visible.') && e.problems.some(p => p.includes('{fiel}')), 'list format from the template; an unknown placeholder stays visible and is reported');
    let threw = null; try { E.build(one(r1), r1, { template: null }); } catch (err) { threw = err.message; }
    const saved = E.template; E.template = null;
    try { E.build(one(r1), r1, {}); } catch (err) { threw = err.message; }
    E.template = saved;
    ok(/template is not loaded/.test(threw || ''), 'without a template: a clear error');
    const broken = clone(tpl); delete broken.where;
    threw = null; try { E.build(one(r1), r1, { template: broken }); } catch (err) { threw = err.message; }
    ok(/have problems: where: missing\./.test(threw || ''), 'a template with a missing part: the error names it', threw);
  }
  {
    const m = E.mailto(' anna@firma.at; ben@firma.at ', 'Test: A & B + C', 'Line 1\nLine 2 ä');
    ok(m === 'mailto:anna@firma.at,ben@firma.at?subject=Test%3A%20A%20%26%20B%20%2B%20C&body=Line%201%0D%0ALine%202%20%C3%A4', 'mailto: addresses with commas, subject and body encoded, CRLF line breaks', m);
    ok(E.mailto('', 'S', '') === 'mailto:?subject=S' && E.mailto('x?y@z.at', '', '') === 'mailto:x%3Fy@z.at', 'mailto: empty To; special characters in an address encoded');
    const long = E.mailto('', rej.subject, rej.body);
    ok(E.MAILTO_LIMIT === 2000 && long.length > 1500, `mailto of the rejected email: ${long.length} characters (warning above ${E.MAILTO_LIMIT})`);
  }

  head('M3 email: screen');
  {
    require(path.join(ROOT, 'js/ui/common.js'));
    require(path.join(ROOT, 'js/ui/email.js'));
    const sc = TP.ui.screens.email;
    ok(sc && sc.hash === '#email' && sc.nav === 'start' && typeof sc.view === 'function' && typeof sc.mount === 'function', 'the Email screen registers itself (#email)');
    ok(['email', 'email-copy', 'email-reset', 'email-undo', 'email-dl', 'email-manual-close'].every(a => typeof TP.ui.actions[a] === 'function'), 'its buttons are registered (data-act email, email-copy, email-reset, email-undo, email-dl)');
    ok(sc.needs({}) === false && sc.needs({ result: defects }) === true && sc.needs({ session: s12 }) === true, 'needs a result or a session');
    const saved = E.template; E.template = tpl;
    const odd = meta(defects, 'a<b>&"x".xml');
    const s = { screen: 'email', result: odd, session: null };
    const html = sc.view(s);
    ok(/<input id="em-to"[^>]*value=""/.test(html) && html.includes('id="em-subject"') && /<textarea id="em-body"[^>]*>Dear Customer,/.test(html), 'To empty, subject and text editable');
    ok(!html.includes('a<b>') && html.includes('a&lt;b&gt;&amp;&quot;x&quot;.xml'), 'the file name is escaped in the page');
    ok(html.includes('data-act="email-dl" data-kind="report"') && !html.includes('data-kind="xml"') && html.includes('id="em-mailto" href="mailto:?subject='), 'rejected: report download, no corrected file; the mailto link');
    ok(/Add the attachments by hand/.test(html) && /id="em-long" >/.test(html) === (E.mailto('', s.email.subject, s.email.body).length > E.MAILTO_LIMIT), 'the note on attachments; the long-link warning shown when the link is long');
    const long = s.email.body;
    s.email.body += 'More text. '.repeat(60);
    ok(/id="em-long" >/.test(sc.view(s)) && /Some email programs cut long texts\. Copy is safer\./.test(sc.view(s)), 'a long text: the warning that some email programs cut long texts');
    s.email.body = long;
    // edits within one run, then a fix run of the same chain
    const s1 = { screen: 'email', session: one(r1) };
    sc.view(s1);
    s1.email.body += 'My own sentence.'; s1.email.to = 'anna@firma.at';
    const again = sc.view(s1);
    ok(again.includes('My own sentence.') && again.includes('value="anna@firma.at"') && /Reset to the generated text/.test(again), 'edits are kept while the run stays the same; Reset is offered');
    const s2 = { screen: 'email', session: s12, email: s1.email };
    const h2 = sc.view(s2);
    ok(!h2.includes('My own sentence.') && h2.includes('value="anna@firma.at"') && h2.includes('data-kind="xml"') && /Corrected copy for reference/.test(h2), 'a fix run of the same chain: new text, the address kept, corrected file attached');
    const other = runOf(1, pass09);
    const h3 = sc.view({ screen: 'email', session: one(other), email: s2.email });
    ok(/<input id="em-to"[^>]*value=""/.test(h3), 'another file: the address is cleared');
    const hi = sc.view({ screen: 'email', result: { ...pass09, fileName: 'i.xml', incomplete: true } });
    ok(/Some checks could not run/.test(hi), 'incomplete: a warning on the screen');
    E.template = saved;
  }
};
