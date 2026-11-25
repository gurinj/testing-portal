#!/usr/bin/env node
/*
 * Testing Portal – tests. Run by tools/build.js after the rules are compiled.
 * Uses the same validation code as the browser: stages 0–2, the XSD worker
 * functions, rules-core, the findings helpers and the report builder.
 *
 *   node tests/run-tests.js            all tests
 *   node tests/run-tests.js --quiet    only failures and the total
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'dist/site');
const NM = path.join(ROOT, 'tools/vendor/node_modules');
const QUIET = process.argv.includes('--quiet');

globalThis.TPSaxes = require(path.join(NM, 'saxes'));
const SaxonJS = require(path.join(NM, 'saxon-js'));
// the function files the rules can call: the list of the rules worker (one list for the page, the tests and the tools)
const WORKER_FUNCTIONS = (fs.readFileSync(path.join(ROOT, 'js/validation/rules-worker.js'), 'utf8').match(/'functions\/[^']+\.js'/g) || []).map(x => x.slice(1, -1));
for (const f of [...WORKER_FUNCTIONS, 'findings/place.js', 'findings/from-svrl.js', 'findings/scan.js', 'findings/status.js',
  'findings/report.js', 'rules-core.js', 'stages/stage0-intake.js', 'stages/stage1-identify.js', 'stages/stage2-xsd.js']) require(path.join(ROOT, 'js/validation', f));
const TP = globalThis.TP;
const gen = require(path.join(ROOT, 'js/dev/test-file-generator.js'));
const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/catalogue.json'), 'utf8'));
const readJson = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const REF_KEY = { 'iban-registry': 'iban', 'external-codes': 'codes', 'payment-areas': 'areas', 'clearing-systems': 'clearing' };
TP.reference = {};
for (const r of ['countries', 'currencies', 'iban-registry', 'external-codes', 'payment-areas', 'clearing-systems']) TP.reference[REF_KEY[r] || r] = readJson(`config/reference/${r}.json`);
const generalSettings = readJson('config/settings.json');
const countryFile = c => { try { return readJson(`config/countries/${c}.json`); } catch (e) { return {}; } };
// the context the page passes to the rules worker; over: settings changed for one test; now: fixed time
// over._country: changes to the country file for one test (merged over it, like a country file over the settings)
const contextFor = (c, over, now) => {
  const countryConfig = over && over._country ? TP.functions.merge(countryFile(c), over._country) : countryFile(c);
  const settings = TP.functions.merge(TP.functions.settingsFor(generalSettings, countryConfig), over || {});
  return { country: c, countryConfig, settings, now: now || null };
};

let failures = 0, passes = 0, section = '';
const ok = (cond, label, detail) => {
  if (cond) { passes++; if (!QUIET) console.log('  ok   ' + label); }
  else { failures++; console.log(`  FAIL ${QUIET ? section + ': ' : ''}${label}${detail ? '\n       ' + String(detail).slice(0, 1500) : ''}`); }
};
const head = s => { section = s; if (!QUIET) console.log(s); };

(async () => {
  const xsdMod = await import(path.join(ROOT, 'js/validation/xsd-worker.mjs'));
  const lx = await import(path.join(ROOT, 'lib/libxml2/libxml2-wasm.esm.js'));
  xsdMod.compileSchemas(lx, {
    '03': fs.readFileSync(path.join(ROOT, 'schemas/pain.001.001.03.xsd'), 'utf8'),
    '09': fs.readFileSync(path.join(ROOT, 'schemas/pain.001.001.09.xsd'), 'utf8')
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(SITE, 'rules/manifest.json'), 'utf8'));
  const ruleSets = manifest.ruleSets.map(s => ({ ...s, sef: JSON.parse(fs.readFileSync(path.join(SITE, s.file), 'utf8')) }));
  const rules = (xml, v, c = 'AT', over, now) => TP.rulesCore.runRuleSets(SaxonJS, ruleSets, xml, v, c, contextFor(c, over, now));
  const xsdClient = { request: async ({ xml, version }) => ({ ms: 0, ...xsdMod.checkXml(lx, xml, version) }) };
  const xsd = (xml, v) => TP.stages.xsd.run(xsdClient, { text: xml, version: v });
  const tally = list => { const a = {}; for (const f of list) a[f.rule] = (a[f.rule] || 0) + 1; return JSON.stringify(Object.fromEntries(Object.entries(a).sort())); };
  const sorted = o => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
  const bytes = s => new TextEncoder().encode(s);
  const intake = (b, maxBytes) => TP.stages.intake.run({ bytes: b, maxBytes });
  const identify = (text, countryConfig) => TP.stages.identify.run({ text, country: 'AT', countryConfig });
  const firstRule = r => (r.findings[0] || {}).rule;
  // full run as the page does it, without workers
  async function validate(xml, v, country = 'AT', over, now) {
    const [x, r] = await Promise.all([xsd(xml, v), rules(xml, v, country, over, now)]);
    if (x.stop) return { stop: true, findings: x.findings };
    return TP.report.build({ findings: [...x.findings, ...r.findings], summary: r.summary, catalogue, settings: contextFor(country, over).settings });
  }

  const clean03 = gen.generate({ version: '03', transactions: 20, blocks: 2 });
  let cleanTotal = null;
  const clean09 = gen.generate({ version: '09', transactions: 20, blocks: 2 });

  cleanTotal = (await validate(clean03, '03')).facts.totals[0];
  head('build');
  const stageFiles = fs.readdirSync(path.join(ROOT, 'rules/stages')).filter(f => f.endsWith('.sch') && /<sch:pattern\b/.test(fs.readFileSync(path.join(ROOT, 'rules/stages', f), 'utf8')));
  ok(manifest.ruleSets.length === 2 * stageFiles.length && manifest.ruleSets.every(s => s.versions.length === 1), 'every stage rule file is compiled once for .03 and once for .09', manifest.ruleSets.map(s => s.id).join(', '));
  ok(!manifest.ruleSets.some(s => /countries\//.test(s.id)), 'the empty country rule files are not compiled');
  const catIds = new Set(Object.keys(catalogue.rules));
  const ruleIds = new Set(manifest.ruleSets.flatMap(s => s.rules));
  ok([...ruleIds].every(id => catIds.has(id)), 'every rule id in the rule files is in config/catalogue.json', [...ruleIds].filter(id => !catIds.has(id)).join(', '));
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.json'), 'utf8'));
  ok(app.countries.length === 11 && app.countries.every(c => fs.existsSync(path.join(ROOT, `config/countries/${c}.json`)) && fs.existsSync(path.join(ROOT, `rules/countries/${c}.sch`))), 'all 11 countries have a config file and a (still empty) rule file');

  head('stage 0, file intake');
  ok(firstRule(intake(new Uint8Array(0))) === '0.1', '0.1 empty file');
  ok(firstRule(intake(bytes(clean03), 1000)) === '0.2', '0.2 file larger than the limit');
  ok(firstRule(intake(Uint8Array.from([0x50, 0x4B, 0x03, 0x04, 1, 2, 3]))) === '0.3', '0.3 ZIP archive');
  ok(firstRule(intake(bytes('%PDF-1.7 ...'))) === '0.3', '0.3 PDF');
  ok(firstRule(intake(bytes('MsgId;Amount\nA;1\n'))) === '0.3', '0.3 text that is not XML');
  ok(firstRule(intake(Uint8Array.from([0x3c, 0x61, 0xe4, 0x3e, 0x3c, 0x2f, 0x61, 0x3e]))) === '0.5', '0.5 invalid UTF-8 (Windows-1252 ä)');
  ok(firstRule(intake(Uint8Array.from([0xFF, 0xFE, 0x3c, 0x00, 0x61, 0x00]))) === '0.5', '0.5 UTF-16');
  ok(firstRule(intake(bytes('<?xml version="1.0" encoding="ISO-8859-1"?><a/>'))) === '0.5', '0.5 declared encoding is not UTF-8');
  ok(firstRule(intake(bytes('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x/>'))) === '0.8', '0.8 DOCTYPE and ENTITY');
  ok(!intake(bytes('<?xml version="1.0"?><!-- <!DOCTYPE x> --><Document><![CDATA[<!ENTITY a>]]></Document>')).stop, 'DOCTYPE inside a comment or CDATA is not 0.8');
  ok(firstRule(intake(bytes('<!DOCTYPE html><html><body/></html>'))) === '0.3', '0.3 an HTML page');
  ok(firstRule(intake(bytes('\uFEFF \n'))) === '0.1', '0.1 only a byte-order mark and spaces');
  ok(firstRule(intake(Uint8Array.from([0x20, 0, 0x3c, 0, 0x61, 0, 0x3e, 0]))) === '0.5', '0.5 UTF-16 without a byte-order mark');
  ok(/UTF-32/.test(intake(Uint8Array.from([0xFF, 0xFE, 0, 0, 0x3c, 0, 0, 0])).findings[0].message), '0.5 names UTF-32');
  ok(!intake(bytes('﻿' + clean03)).stop, 'a UTF-8 byte-order mark is accepted');
  const nwf = await xsd(clean03.replace('<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>Novak & Partner</Nm>'), '03');
  ok(nwf.stop && nwf.findings[0].rule === '0.7' && nwf.findings[0].line > 0, '0.7 unescaped & stops the run, with its line', JSON.stringify(nwf.findings[0]));
  ok(nwf.findings[0].message === 'An & is not written as &amp;.', '0.7 the parser message is put into plain words', nwf.findings[0].message);
  const crlf = await xsd(clean03.replace(/\n/g, '\r\n').replace('<Ctry>DE</Ctry>', '<Ctry>de</Ctry>'), '03');
  const lf = await xsd(clean03.replace('<Ctry>DE</Ctry>', '<Ctry>de</Ctry>'), '03');
  ok(crlf.findings[0].line === lf.findings[0].line, 'line numbers are the same with CRLF line endings');
  const extra = await xsd(clean03 + '<Document/>\n', '03');
  ok(extra.stop && extra.findings[0].rule === '0.9', '0.9 content after the root element', JSON.stringify(extra.findings[0]));

  head('stage 1, message identification');
  ok(identify(clean03).version === '03' && identify(clean09).version === '09', 'pain.001.001.03 and .09 are identified');
  ok(firstRule(identify(clean03.replace(/<Document /, '<Doc ').replace(/<\/Document>/, '</Doc>'))) === '1.1', '1.1 root element is not Document');
  ok(firstRule(identify(clean03.replace(/pain\.001\.001\.03/g, 'pain.008.001.02'))) === '1.2', '1.2 pain.008 direct debit');
  ok(/direct debit/.test(identify(clean03.replace(/pain\.001\.001\.03/g, 'pain.008.001.02')).findings[0].message), '1.2 names the direct debit');
  ok(firstRule(identify(clean03.replace(/pain\.001\.001\.03/g, 'pain.001.001.10'))) === '1.2', '1.2 unsupported version pain.001.001.10');
  ok(firstRule(identify(clean03.replace(/ xmlns="[^"]+"/, ''))) === '1.2', '1.2 no namespace');
  ok(firstRule(identify(clean03.replace(/CstmrCdtTrfInitn>/g, 'CstmrPmtStsRpt>'))) === '1.3', '1.3 message element is not CstmrCdtTrfInitn');
  ok(firstRule(identify(clean09, { name: 'Testland', versions: ['03'] })) === '1.4', '1.4 version not accepted for the country');
  ok(identify(clean03.replace('<Document ', '<Document a="x>y" ')).version === '03', 'a > in an attribute of Document does not hide the namespace');
  const prefixed = clean03.replace(/<(\/?)([A-Za-z])/g, '<$1p:$2').replace(' xmlns="', ' xmlns:p="').replace('<?p:xml', '<?xml');
  ok(identify(prefixed).version === '03', 'a file with a namespace prefix is identified');

  head('stage 2, XSD schema');
  ok((await xsd(clean03, '03')).findings.length === 0 && (await xsd(clean09, '09')).findings.length === 0, 'clean .03 and .09 files pass the XSD');
  const x2 = async (v, edit, label, rule) => {
    const base = v === '09' ? clean09 : clean03;
    const xml = typeof edit === 'function' ? edit(base) : base.replace(edit[0], edit[1]);
    if (xml === base) return ok(false, label, 'the edit did not change the file');
    const r = await xsd(xml, v);
    ok(r.findings.length >= 1 && r.findings[0].rule === rule && r.findings[0].line > 0 && r.findings[0].xpath, `${rule} ${label}`, JSON.stringify(r.findings.map(f => [f.rule, f.message, f.xpath])));
    return r;
  };
  await x2('03', [/(<NbOfTxs>\d+<\/NbOfTxs>)(\s*)(<CtrlSum>[^<]*<\/CtrlSum>)/, '$3$2$1'], 'element in the wrong order', '2.1');
  await x2('03', ['<EndToEndId>E2E-000004</EndToEndId>', ''], 'mandatory element missing', '2.2');
  await x2('03', [/(<MsgId>[^<]*<\/MsgId>)/, '$1<MsgId>X</MsgId>'], 'element repeated', '2.3');
  await x2('03', ['<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SLEV</ChrgBr><Foo>1</Foo>'], 'unknown element', '2.4');
  await x2('03', [/<CdtrAcct><Id><IBAN>[^<]*<\/IBAN><\/Id>/, '<CdtrAcct><Id></Id>'], 'choice with no option', '2.5');
  await x2('03', ['<InitgPty><Nm>Beispiel Handels GmbH</Nm>', '<InitgPty><Nm></Nm>'], 'empty text', '2.6');
  await x2('03', [/<MsgId>[^<]*<\/MsgId>/, `<MsgId>${'M'.repeat(36)}</MsgId>`], 'text too long', '2.6');
  await x2('03', ['<Ctry>DE</Ctry>', '<Ctry>de</Ctry>'], 'pattern (country code)', '2.7');
  await x2('03', ['<PmtMtd>TRF</PmtMtd>', '<PmtMtd>XXX</PmtMtd>'], 'enumeration', '2.8');
  await x2('03', [/(<InstdAmt Ccy="EUR">)[^<]*/, '$1-5.00'], 'negative amount', '2.9');
  await x2('03', [/(<InstdAmt Ccy="EUR">)[^<]*/, '$112.123456'], 'too many decimals', '2.9');
  await x2('03', ['Ccy="EUR">', '>'], 'currency attribute missing', '2.9');
  await x2('03', [/<ReqdExctnDt>[^<]*<\/ReqdExctnDt>/, '<ReqdExctnDt>18.11.2026</ReqdExctnDt>'], 'date not in ISO format', '2.10');
  await x2('09', [/<ReqdExctnDt><Dt>[^<]*<\/Dt>/, '<ReqdExctnDt><Dt>2026-13-01</Dt>'], 'date not in ISO format (.09)', '2.10');
  await x2('03', ['<BtchBookg>false</BtchBookg>', '<BtchBookg>nein</BtchBookg>'], 'boolean', '2.11');
  // all errors at once: libxml2 stops checking an element after a structural error, the worker checks again
  const many = clean03.replace('<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SLEV</ChrgBr><Foo>1</Foo>').replace('<Ctry>DE</Ctry>', '<Ctry>de</Ctry>').replace('Ccy="EUR">', '>')
    .replace('<NbOfTxs>20</NbOfTxs>', '<CtrlSum>1</CtrlSum><NbOfTxs>20</NbOfTxs>').replace('<InitgPty><Nm>Beispiel Handels GmbH</Nm>', '<InitgPty><Nm></Nm>');
  const mr = await xsd(many, '03');
  ok(tally(mr.findings) === sorted({ '2.1': 1, '2.4': 1, '2.6': 1, '2.7': 1, '2.9': 1 }), 'errors after a structural error in the same element are still found', tally(mr.findings));
  const two = await xsd(clean03.replace('<Amt>', '<Foo/><Foo/><Amt>'), '03');
  ok(two.findings.length === 2 && two.findings[1].xpath.endsWith('/Foo[2]'), 'two unknown elements in a row: both found, positions kept', JSON.stringify(two.findings.map(f => f.xpath)));
  ok(mr.findings.every(f => f.code && catalogue.rules[f.rule]), 'every XSD finding has a reason code and a catalogue entry');

  head('stage 2, harder cases (independent review)');
  const xr = async (edit, v = '03') => { const base = v === '09' ? clean09 : clean03; const xml = edit(base); return { xml, changed: xml !== base, r: await xsd(xml, v) }; };
  const rulesOf = r => r.findings.map(f => f.rule).sort().join(',');
  let c1 = await xr(b => b.replace('<Amt><InstdAmt', '<Ammt><InstdAmt').replace(/(<\/InstdAmt>)<\/Amt>/, '$1</Ammt>'));
  ok(c1.changed && rulesOf(c1.r) === '2.2,2.4', 'misspelled Amt: unknown Ammt and missing Amt, no wrong order errors', JSON.stringify(c1.r.findings.map(f => [f.rule, f.message])));
  c1 = await xr(b => b.replace(/<Dbtr>.*?<\/Dbtr>/s, '').replace('<Ctry>DE</Ctry>', '<Ctry>de</Ctry>'));
  ok(c1.changed && rulesOf(c1.r) === '2.2,2.7', 'missing Dbtr: one 2.2, and the bad Ctry in transaction 1 is still found', JSON.stringify(c1.r.findings.map(f => [f.rule, f.message, f.xpath])));
  c1 = await xr(b => b.replace(/(<CreDtTm>[^<]*<\/CreDtTm>)(\s*)(<NbOfTxs>[^<]*<\/NbOfTxs>)/, '$3$2$1').replace('<InitgPty><Nm>Beispiel Handels GmbH</Nm>', '<InitgPty><Nm></Nm>'));
  ok(c1.changed && rulesOf(c1.r) === '2.1,2.6', 'two elements swapped plus an empty name: both found', JSON.stringify(c1.r.findings.map(f => [f.rule, f.message])));
  c1 = await xr(b => b.replace(/(<CdtrAcct><Id><IBAN>[^<]*<\/IBAN>)/, '$1<Othr><Id>123</Id></Othr>'));
  ok(c1.changed && rulesOf(c1.r) === '2.5', 'two options of a choice: 2.5', JSON.stringify(c1.r.findings.map(f => [f.rule, f.message])));
  c1 = await xr(b => b.replace('<Amt><InstdAmt', '<Amt xmlns=""><InstdAmt'));
  ok(c1.changed && c1.r.findings[0].rule === '2.4' && /namespace/.test(c1.r.findings[0].message), 'element in the wrong namespace: 2.4 with a namespace message', JSON.stringify(c1.r.findings.map(f => [f.rule, f.message])));
  const bigLines = gen.generate({ version: '03', transactions: 9000, blocks: 2 });
  const lastCtry = bigLines.lastIndexOf('<Ctry>DE</Ctry>');
  c1 = await xr(() => bigLines.slice(0, lastCtry) + '<Ctry>de</Ctry>' + bigLines.slice(lastCtry + 15));
  const expLine = bigLines.slice(0, lastCtry).split('\n').length;
  ok(expLine > 65535 && c1.r.findings[0].line === expLine, `line numbers above 65,535 are right (line ${expLine})`, JSON.stringify(c1.r.findings[0]));
  c1 = await xr(b => b.replace(/>\s+</g, '><').replace('<Ctry>DE</Ctry>', '<Ctry>de</Ctry>'));
  ok(c1.r.findings[0].line === 1 && c1.r.findings[0].col > 100, 'a file on one line: XSD findings get a column', JSON.stringify(c1.r.findings[0]));
  let manyCtry = gen.generate({ version: '03', transactions: 2000, blocks: 2 }).replace(/<Ctry>(DE|AT|NL)<\/Ctry>(<\/PstlAdr><\/Cdtr>)/g, '<Ctry>de</Ctry>$2');
  let tq = Date.now();
  const mc = await xsd(manyCtry, '03');
  ok(mc.findings.length === 2000 && Date.now() - tq < 5000, `2,000 XSD errors in ${((Date.now() - tq) / 1000).toFixed(1)} s`);
  const twoFiles = clean03 + clean03;
  const tf = await xsd(twoFiles, '03');
  ok(tf.stop && tf.findings[0].rule === '0.9', 'two files one after the other: 0.9', JSON.stringify(tf.findings[0]));

  head('rules, stages 4–10');
  const c03 = await rules(clean03, '03'), c09 = await rules(clean09, '09');
  // 10.8 (information) tells every .03 file that .09 is accepted too (M2)
  ok(tally(c03.findings) === sorted({ '10.8': 1 }) && c09.findings.length === 0, 'clean .03 and .09 files have no rule findings, except the hint 10.8 on .03', tally(c03.findings) + ' ' + tally(c09.findings));
  ok(c03.ran.every(id => id.endsWith('@03')) && c09.ran.every(id => id.endsWith('@09')) && c09.ran.length === stageFiles.length, 'only the variant for the file version runs');
  const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/expected/defects.json'), 'utf8'));
  {
    const tc = /const EXPECTED_DEFECTS = (\{[^}]*\});/.exec(fs.readFileSync(path.join(ROOT, 'js/ui/technical-check.js'), 'utf8'));
    const inPage = tc ? JSON.parse(tc[1].replace(/'/g, '"')) : null;
    ok(inPage && sorted(inPage) === sorted(expected.rules), 'the technical check in the page expects the same defect findings as tests/expected/defects.json', tc && tc[1]);
  }
  const d03 = await rules(gen.generate({ version: '03', transactions: 12, blocks: 2, defects: gen.DEFECTS }), '03');
  const d09 = await rules(gen.generate({ version: '09', transactions: 12, blocks: 2, defects: gen.DEFECTS }), '09');
  ok(tally(d03.findings) === sorted(expected.rules), 'defects file .03 gives the expected findings per rule', 'got ' + tally(d03.findings) + ' expected ' + sorted(expected.rules));
  const not108 = list => list.filter(f => f.rule !== '10.8'); // 10.8: .03 files only
  ok(tally(d09.findings) === tally(not108(d03.findings)), 'the .09 defects file gives the same findings as .03 (but 10.8)', 'got ' + tally(d09.findings));
  ok(JSON.stringify(not108(d03.findings).map(f => [f.rule, f.block, f.tx])) === JSON.stringify(d09.findings.map(f => [f.rule, f.block, f.tx])), 'and in the same blocks and transactions');
  ok(d03.findings.every(f => f.line > 0 && ['E', 'W', 'I'].includes(f.severity) && f.message), 'every rule finding has a line, a severity and a message');
  ok(d03.summary && d03.summary.blocks.length === 2 && d03.summary.blocks[0].txs.length === 6 && d03.summary.blocks[0].txs[0].e2e === 'E2E-000001', 'the summary lists blocks and transactions with their EndToEndId');
  const ibanOk = gen.iban('DE', '999999990000001000');
  ok(TP.functions.ibanValid(ibanOk) && !TP.functions.ibanValid(ibanOk.slice(0, 2) + '00' + ibanOk.slice(4)), 'IBAN function accepts a valid and rejects a wrong check digit');
  const badDate = clean03.replace(/<ReqdExctnDt>[^<]*<\/ReqdExctnDt>/, '<ReqdExctnDt>18.11.2026</ReqdExctnDt>').replace(/(<NbOfTxs>)20/, '$1x');
  const bd = await rules(badDate, '03');
  ok(!bd.findings.some(f => /engine/.test(f.rule)), 'rules do not fail on values that already fail the XSD', tally(bd.findings));

  head('unusual layouts');
  const lay = gen.generate({ version: '03', transactions: 6, blocks: 2, defects: ['dup-e2e', 'bad-iban'] }).replace('<Ctry>DE</Ctry>', '<Ctry>de</Ctry>').replace('<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SLEV</ChrgBr><Foo/>');
  const sig = rep => rep.groups.map(g => `${g.rule}x${g.count}:${g.items[0].xpath}`).join(' ');
  const layN = await validate(lay, '03');
  const layP = await validate(lay.replace(/<(\/?)([A-Za-z])/g, '<$1p:$2').replace(' xmlns="', ' xmlns:p="').replace('<?p:xml', '<?xml'), '03');
  const layM = await validate(lay.replace(/>\s+</g, '><'), '03');
  ok(sig(layP) === sig(layN) && layN.groups.length === 5, 'a file with a namespace prefix gives the same findings and paths', sig(layN) + ' / ' + sig(layP));
  ok(sig(layM) === sig(layN) && layM.groups.every(g => g.items.every(i => i.line === 1)), 'a file on one line gives the same findings, all on line 1', sig(layM));
  ok(layM.groups.filter(g => g.source === 'rules').every(g => g.items.every(i => i.col > 1)), 'and the rule findings have their column on that line');

  head('rules, harder cases (independent review)');
  const rr = async (edit, v = '03') => { const base = v === '09' ? clean09 : clean03; const xml = edit(base); return validate(xml, v); };
  const groupsOf = rep => rep.groups.map(g => g.rule).filter(r => r !== '10.8').sort().join(','); // 10.8: every .03 file (M2)
  const noEngine = rep => !rep.groups.some(g => /engine/.test(g.rule));
  let h1 = await rr(b => b.replace(/(<CreDtTm>[^<]*<\/CreDtTm>)/, '$1$1'));
  ok(noEngine(h1) && groupsOf(h1) === '2.3', 'a repeated CreDtTm: 2.3 only, the stage-4 rules still run', groupsOf(h1));
  h1 = await rr(b => b.replace(/(<PmtInfId>[^<]*<\/PmtInfId>)/, '$1$1').replace(/(<EndToEndId>[^<]*<\/EndToEndId>)/, '$1$1').replace(/(<Cdtr><Nm>[^<]*<\/Nm>)/, '$1<Nm>X</Nm>'));
  ok(noEngine(h1) && !/9\.|4\./.test(groupsOf(h1)), 'repeated PmtInfId, EndToEndId and Cdtr/Nm: no rule stage fails', groupsOf(h1));
  for (const [label, edit, want] of [
    ['PmtMtd XXX', b => b.replace('<PmtMtd>TRF</PmtMtd>', '<PmtMtd>XXX</PmtMtd>'), '2.8'],
    ['PmtMtd CHK', b => b.replace('<PmtMtd>TRF</PmtMtd>', '<PmtMtd>CHK</PmtMtd>'), '4.9'],
    ['ChrgBr XXXX', b => b.replace('<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>XXXX</ChrgBr>'), '2.8'],
    ['ChrgBr SHAR on SEPA', b => b.replace('<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SHAR</ChrgBr>'), '7.4'],
    ['ReqdExctnDt with extra characters', b => b.replace(/<ReqdExctnDt>[^<]*<\/ReqdExctnDt>/, '<ReqdExctnDt>2020-01-01x</ReqdExctnDt>'), '2.10'],
    ['empty creditor name', b => b.replace(/<Cdtr><Nm>[^<]*<\/Nm>/, '<Cdtr><Nm></Nm>'), '2.6'],
    ['creditor name of spaces', b => b.replace(/<Cdtr><Nm>[^<]*<\/Nm>/, '<Cdtr><Nm>   </Nm>'), '4.28'],
    ['currency eur', b => b.replace('Ccy="EUR"', 'Ccy="eur"'), '2.7']
  ]) { const rep = await rr(edit); ok(groupsOf(rep) === want, `${label}: only ${want}`, groupsOf(rep)); }
  h1 = await rr(b => b.replace(/<SvcLvl><Cd>SEPA<\/Cd><\/SvcLvl>/, '<SvcLvl><Prtry>X</Prtry></SvcLvl><SvcLvl><Cd>SEPA</Cd></SvcLvl>').replace(/Ccy="EUR"/, 'Ccy="USD"'), '09');
  ok(groupsOf(h1).includes('7.1'), '.09 with two service levels, the second SEPA: 7.1 still checked', groupsOf(h1));
  h1 = await rr(b => b.replace(/<Amt><InstdAmt Ccy="EUR">([^<]*)<\/InstdAmt><\/Amt>/, '<Amt><EqvtAmt><Amt Ccy="EUR">$1</Amt><CcyOfTrf>EUR</CcyOfTrf></EqvtAmt></Amt>'));
  ok(groupsOf(h1) === '' && h1.facts.totals[0] === cleanTotal, 'EqvtAmt counts in the control sums and the totals', groupsOf(h1) + ' ' + h1.facts.totals);
  h1 = await rr(b => b.replace(/<InstdAmt Ccy="EUR">[^<]*</, '<InstdAmt Ccy="LYD">1.123<'));
  ok(!groupsOf(h1).includes('4.22'), 'LYD 1.123: no decimal finding (LYD has 3)', groupsOf(h1));
  h1 = await rr(b => b.replace(/<InstdAmt Ccy="EUR">[^<]*</, '<InstdAmt Ccy="XOF">100.50<'));
  const g422 = h1.groups.find(g => g.rule === '4.22');
  ok(g422 && /100\.50 XOF/.test(g422.items[0].message), 'XOF 100.50: 4.22, message "100.50 XOF"', g422 && g422.items[0].message);
  ok(['+5.00', '.50', '5.', '0007.5'].every(v => TP.report.toUnits(v) !== null) && TP.report.toUnits('1,5') === null, 'totals accept every amount the XSD accepts');
  const inc = TP.report.build({ findings: [{ source: 'rules', rule: '4.engine', stage: 4, severity: 'W', level: 'file', message: 'x' }], summary: null, catalogue, incomplete: true });
  ok(inc.incomplete && inc.facts.blocks === null, 'a check that could not run makes the report incomplete');

  head('report: suppression, grouping, status');
  const badIban = clean03.replace(/(<CdtrAcct><Id><IBAN>)[^<]*/, '$1DE89 3704 0044! ');
  const rep1 = await validate(badIban, '03');
  const g27 = rep1.groups.find(g => g.rule === '2.7');
  ok(g27 && !rep1.groups.some(g => g.rule === '5.6') && rep1.suppressed.length === 1 && g27.items[0].suppresses[0].rule === '5.4', 'a rule finding on an element that failed the XSD is suppressed and counted', JSON.stringify(rep1.groups.map(g => [g.rule, g.count])));
  let hundred = gen.generate({ version: '03', transactions: 100, blocks: 1 });
  hundred = hundred.replace(/Ccy="EUR"/g, 'Ccy="USD"').replace(/<Ctry>(DE|AT|NL)<\/Ctry>(<\/PstlAdr><\/Cdtr>)/g, '<Ctry>de</Ctry>$2');
  const rep2 = await validate(hundred, '03');
  const g71 = rep2.groups.find(g => g.rule === '7.1');
  const g27b = rep2.groups.find(g => g.rule === '2.7');
  ok(g71 && g71.count === 100 && rep2.groups.filter(g => g.rule === '7.1').length === 1, '100 failures of one rule show as one finding with 100 places', g71 && g71.count);
  ok(g27b && g27b.count === 100 && rep2.groups.filter(g => g.rule === '2.7').length === 1, '100 XSD errors of one kind show as one finding with 100 places', JSON.stringify(rep2.groups.map(g => [g.rule, g.count, g.message])));
  ok(g71.items.every(i => i.e2e && i.where.startsWith('Block 1, transaction') && i.line > 0), 'every place has its EndToEndId, where and line');
  const rep3 = await validate(gen.generate({ version: '03', transactions: 12, blocks: 2, defects: gen.DEFECTS }), '03');
  ok(rep3.status === 'RJCT', 'defects file: status RJCT');
  const b1 = rep3.blocks[0], b2 = rep3.blocks[1];
  ok(b1.status === 'RJCT' && b2.status === 'RJCT', 'blocks with errors are RJCT');
  const t = (b, n) => rep3.blocks[b - 1].txs[n - 1];
  ok(rep3.groups.some(g => g.level === 'file') && rep3.blocks.every(b => b.txs.every(x => x.status === 'RJCT')), 'an error in the group header rejects every transaction');
  const onlyTx = await validate(clean03.replace('<Ctry>DE</Ctry>', '<Ctry>de</Ctry>'), '03');
  ok(onlyTx.status === 'RJCT' && onlyTx.blocks[0].status === 'RJCT' && onlyTx.blocks[1].status === 'ACTC' && onlyTx.blocks[0].txs[0].status === 'RJCT' && onlyTx.blocks[0].txs[1].status === 'ACTC', 'one transaction error: that transaction and its block RJCT, the others ACTC',
    JSON.stringify(onlyTx.blocks.map(b => [b.status, b.txs.map(x => x.status).join(',')])));
  const warnOnly = await validate(clean03.replace('<EndToEndId>E2E-000003</EndToEndId>', '<EndToEndId>E2E-000001</EndToEndId>'), '03');
  ok(warnOnly.status === 'ACWC' && warnOnly.counts.W === 1 && warnOnly.occurrences.W === 2, 'duplicate EndToEndId only: ACWC, one warning at two places', JSON.stringify([warnOnly.status, warnOnly.counts, warnOnly.occurrences]));
  const cleanRep = await validate(clean09, '09');
  ok(cleanRep.status === 'ACTC' && cleanRep.groups.length === 0 && cleanRep.facts.transactions === 20 && cleanRep.facts.totals.length === 1, 'clean file: ACTC, no findings, 20 transactions, one total', JSON.stringify(cleanRep.facts));
  ok(TP.report.fmtAmount(TP.report.toUnits('1234567.5'), 'EUR') === '1,234,567.50' && TP.report.toUnits('1.123456') === null, 'amounts are added exactly and formatted');
  ok(rep3.modules.length === 6 && rep3.modules.find(m => m.id === 'iso').counts.E > 0, 'findings are counted per module');

  head('foundation: settings, payment types (M2)');
  {
    const day = 86400000;
    const isoLocal = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    const at = d => clean03.replace(/<CreDtTm>[^<]*<\/CreDtTm>/, `<CreDtTm>${isoLocal(d)}</CreDtTm>`);
    const old = await validate(at(new Date(Date.now() - 40 * day)), '03');
    const g = old.groups.find(x => x.rule === '4.2');
    ok(g && g.part === 'age' && g.severity === 'W' && old.status === 'ACWC', 'a file 40 days old: 4.2 age, a warning (settings checks."4.2-age")', g && JSON.stringify([g.part, g.severity, g.title]));
    ok(g && g.title === 'The file is older than allowed', 'the age part has its own title in the catalogue', g && g.title);
    const young = await validate(at(new Date(Date.now() - 20 * day)), '03');
    ok(!young.groups.some(x => x.rule === '4.2'), 'a file 20 days old: no finding (P1M)');
    const strict = await validate(at(new Date(Date.now() - 20 * day)), '03', 'AT', { limits: { creationDateMaxAge: 'P14D' } });
    ok(strict.groups.some(x => x.rule === '4.2' && x.part === 'age'), 'creationDateMaxAge P14D: a file 20 days old is reported');
    const off = await validate(at(new Date(Date.now() - 400 * day)), '03', 'AT', { limits: { creationDateMaxAge: null } });
    ok(!off.groups.some(x => x.rule === '4.2'), 'creationDateMaxAge null: the age is not checked');
    const future = await validate(at(new Date(Date.now() + 2 * 3600000)), '03');
    ok(future.groups.some(x => x.rule === '4.2' && x.part === 'future' && x.severity === 'E'), 'a creation time 2 hours ahead: 4.2 future, an error');
    const fixedNow = await validate(at(new Date(Date.now() - 40 * day)), '03', 'AT', null, new Date(Date.now() - 30 * day));
    ok(!fixedNow.groups.some(x => x.rule === '4.2'), 'the time of the check can be fixed (TP.context.now)');
    const disabled = await validate(at(new Date(Date.now() - 40 * day)), '03', 'AT', { checks: { '4.2-age': { enabled: false } } });
    ok(!disabled.groups.some(x => x.rule === '4.2') && disabled.disabled['4.2-age'] === 1, 'checks."4.2-age".enabled false: the finding is dropped and counted', JSON.stringify(disabled.disabled));
    const recoded = await validate(clean03.replace('<EndToEndId>E2E-000003</EndToEndId>', '<EndToEndId>E2E-000001</EndToEndId>'), '03', 'AT', { checks: { '9.3': { severity: 'E', code: 'AM05' } } });
    const g93 = recoded.groups.find(x => x.rule === '9.3');
    ok(g93 && g93.severity === 'E' && g93.code === 'AM05' && recoded.status === 'RJCT', 'checks."9.3": severity and reason code changed by the settings', g93 && JSON.stringify([g93.severity, g93.code]));
    const horizon = await validate(clean03, '03', 'AT', { limits: { executionDateMaxAhead: 'PT1H' } });
    ok(horizon.groups.some(x => x.rule === '4.11'), 'executionDateMaxAhead from the settings (4.11)');
    const merged = TP.functions.settingsFor({ a: { b: 1, c: [1, 2] }, d: 1 }, { settings: { a: { c: [3] } } });
    ok(JSON.stringify(merged) === '{"a":{"b":1,"c":[3]},"d":1}', 'country settings: objects merged, lists replaced', JSON.stringify(merged));
    const typesOf = async (type, country, v = '09') => { const r = await rules(gen.generate({ version: v, transactions: 3, type, country }), v, country); return [...new Set(r.summary.blocks.flatMap(b => b.txs.map(x => x.type)))].join('|'); };
    for (const [type, country, want] of [['SEPA', 'AT', 'SEPA'], ['SEPA_INST', 'SK', 'SEPA_INST'], ['DOMESTIC', 'CZ', 'DOMESTIC'], ['DOMESTIC', 'AT', 'SEPA'], ['DOMESTIC_URGENT', 'AT', 'DOMESTIC_URGENT'],
      ['DOMESTIC_URGENT', 'HU', 'DOMESTIC_URGENT'], ['BUDGET', 'RO', 'BUDGET'], ['INTRA_BANK', 'RS', 'INTRA_BANK'], ['CROSS_BORDER', 'UA', 'CROSS_BORDER']]) {
      const got = await typesOf(type, country);
      ok(got === want, `payment type: generated ${type} for ${country} is ${want}`, got);
    }
    const rt = await validate(gen.generate({ version: '03', transactions: 4, type: 'CROSS_BORDER', country: 'CZ' }), '03', 'CZ');
    ok(rt.blocks[0].type === 'CROSS_BORDER' && rt.blocks[0].txs.every(x => x.typeLabel === 'Cross-border (SWIFT)') && rt.facts.types['Cross-border (SWIFT)'] === 4, 'the report has the payment type per transaction, per block and in total', JSON.stringify(rt.facts.types));
  }

  head('functions for the rules (M2)');
  {
    const F = TP.functions;
    TP.context = contextFor('AT');
    ok(F.tpIbanProblem('AT611904300234573201') === '' && F.tpIbanProblem('DE89370400440532013000') === '', 'IBAN: valid IBANs of the registry have no problem');
    ok(/19 characters/.test(F.tpIbanProblem('AT61190430023457320')) && /check digits/i.test(F.tpIbanProblem('AT621904300234573201')) && /country|registry/i.test(F.tpIbanProblem('US611904300234573201')),
      'IBAN: wrong length, wrong check digits and a country without IBAN are told apart', [F.tpIbanProblem('AT61190430023457320'), F.tpIbanProblem('AT621904300234573201'), F.tpIbanProblem('US611904300234573201')].join(' | '));
    ok(F.tpIbanUsed('DE') && !F.tpIbanUsed('US'), 'IBAN registry: DE uses IBANs, US does not');
    ok(F.tpBicCountryValid('DEUTDEFF') && !F.tpBicCountryValid('DEUTQQFF'), 'BIC: country code characters 5–6 checked');
    ok(F.tpLeiValid(gen.lei('5299009DEMO0000001')) && !F.tpLeiValid('5299009DEMO000000100'), 'LEI: ISO 17442 check digits');
    ok(F.tpRfValid('RF18539007547034') && !F.tpRfValid('RF19539007547034'), 'creditor reference RF: ISO 11649 check digits');
    ok(F.tpClearingProblem('USABA', '026009593') === '' && F.tpClearingProblem('USABA', '12345') !== '' && F.tpClearingProblem('XXXXX', '1') === '', 'clearing member id: USABA 9 digits; unknown systems not checked');
    ok(F.tpBadChars('Müller & Co', 'sepa') !== '' && F.tpBadChars('Mueller Co', 'sepa') === '', 'character set: SEPA set');
    ok(/ü→u/.test(F.tpTranslitChars('Müller', 'sepa')), 'character set: transliteration shown', F.tpTranslitChars('Müller', 'sepa'));
    ok(F.tpNonBusinessDay('2026-12-25', true) && F.tpNonBusinessDay('2026-11-21', false) && !F.tpNonBusinessDay('2026-11-18', true) && F.tpNonBusinessDay('2026-04-03', true), 'dates: TARGET holidays (Good Friday, Christmas) and weekends');
    ok(F.tpCcyDecimals('JPY') === 0 && F.tpCcyDecimals('KWD') === 3 && F.tpCcyDecimals('EUR') === 2, 'currency decimals from the ISO 4217 list');
    ok(F.tpIn('currencies', 'EUR') && !F.tpIn('currencies', 'XXX1') && F.tpIn('sepa', 'CH') && !F.tpIn('eea', 'CH'), 'reference lists: currencies, SEPA and EEA countries');
    TP.context.now = new Date(2026, 0, 31, 12, 0, 0);
    TP.context.settings = { limits: { m: 'P1M', d: 'P30D' } };
    ok(F.tpShiftToday('limits.m', 1) === '2026-02-28' && F.tpShiftToday('limits.d', -1) === '2026-01-01' && F.tpShiftNow('limits.none', 1) === '', 'durations: calendar months, days; no setting gives an empty string', [F.tpShiftToday('limits.m', 1), F.tpShiftToday('limits.d', -1)].join(' '));
  }

  // rule tests of M2, one file per stage (tests/stages/*.test.js); M3 features (tests/features/*.test.js)
  for (const dir of ['stages', 'features']) {
    const D = path.join(__dirname, dir);
    if (fs.existsSync(D)) for (const f of fs.readdirSync(D).filter(f => f.endsWith('.test.js')).sort()) {
      await require(path.join(D, f))({ ok, head, gen, rules, xsd, validate, tally, sorted, contextFor, catalogue, TP, clean03, clean09, ROOT });
    }
  }

  head('speed');
  const big = gen.generate({ version: '03', transactions: 10000, blocks: 4, defects: gen.DEFECTS });
  let t0 = Date.now();
  const bigRep = await validate(big, '03');
  const ms = Date.now() - t0;
  ok(bigRep.facts.transactions === 10000 && ms < 30000, `10,000 transactions validated and reported in ${(ms / 1000).toFixed(1)} s (Node, one thread)`);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
