/*
 * Testing Portal – the validation engine in Node, without workers, for the
 * bank test mode (tests/run-bank.js). Runs the same code as the page:
 * stages 0 and 1, the XSD check, the compiled rules of dist/site and the report.
 *
 *   const engine = await require('./lib/engine.js').load();
 *   const report = await engine.validateFile(bytes, 'AT_file.xml', 'AT');
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const SITE = path.join(ROOT, 'dist/site');
const NM = path.join(ROOT, 'tools/vendor/node_modules');
const REFERENCE = ['countries', 'currencies', 'iban-registry', 'external-codes', 'payment-areas', 'clearing-systems'];
const REF_KEY = { 'iban-registry': 'iban', 'external-codes': 'codes', 'payment-areas': 'areas', 'clearing-systems': 'clearing' };
const FILES = ['functions/settings.js', 'functions/iban.js', 'functions/location.js', 'functions/payment-type.js', 'functions/charset.js', 'functions/dates.js', 'functions/guideline.js',
  'findings/place.js', 'findings/from-svrl.js', 'findings/scan.js', 'findings/status.js', 'findings/report.js', 'rules-core.js',
  'stages/stage0-intake.js', 'stages/stage1-identify.js', 'stages/stage2-xsd.js'];

const readJson = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

async function load() {
  if (!fs.existsSync(path.join(SITE, 'rules/manifest.json'))) throw new Error('dist/site is missing: run node tools/build.js first.');
  globalThis.TPSaxes = require(path.join(NM, 'saxes'));
  const SaxonJS = require(path.join(NM, 'saxon-js'));
  // the rules worker loads more function files than the list above when helpers add them
  const workerList = (fs.readFileSync(path.join(ROOT, 'js/validation/rules-worker.js'), 'utf8').match(/'functions\/[^']+\.js'/g) || []).map(s => s.slice(1, -1));
  for (const f of [...new Set([...workerList, ...FILES])]) require(path.join(ROOT, 'js/validation', f));
  const TP = globalThis.TP;
  TP.reference = {};
  for (const r of REFERENCE) TP.reference[REF_KEY[r] || r] = readJson(`config/reference/${r}.json`);
  const app = readJson('config/app.json');
  const catalogue = readJson('config/catalogue.json');
  const general = readJson('config/settings.json');
  const countryFile = c => { try { return readJson(`config/countries/${c}.json`); } catch (e) { return null; } };

  const xsdMod = await import(path.join(ROOT, 'js/validation/xsd-worker.mjs'));
  const lx = await import(path.join(ROOT, 'lib/libxml2/libxml2-wasm.esm.js'));
  xsdMod.compileSchemas(lx, {
    '03': fs.readFileSync(path.join(ROOT, 'schemas/pain.001.001.03.xsd'), 'utf8'),
    '09': fs.readFileSync(path.join(ROOT, 'schemas/pain.001.001.09.xsd'), 'utf8')
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(SITE, 'rules/manifest.json'), 'utf8'));
  const ruleSets = manifest.ruleSets.map(s => ({ ...s, sef: JSON.parse(fs.readFileSync(path.join(SITE, s.file), 'utf8')) }));
  const xsdClient = { request: async ({ xml, version }) => ({ ms: 0, ...xsdMod.checkXml(lx, xml, version) }) };

  /* the steps of js/validation/pipeline.js validate(), one after the other */
  async function validateFile(bytes, fileName, country, over) {
    const countryConfig = countryFile(country);
    const settings = TP.functions.merge(TP.functions.settingsFor(general, countryConfig), over || {});
    const build = (findings, extra = {}) => ({
      ...TP.report.build({ findings, summary: extra.summary, catalogue, settings, stopped: extra.stopped, incomplete: !!extra.rulesError }),
      fileName, country, version: extra.version || null, app: { version: app.version, rulesDate: app.rulesDate }
    });
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const s0 = TP.stages.intake.run({ bytes: u8, maxBytes: (app.maxFileMB || 20) * 1048576 });
    if (s0.stop) return build(s0.findings, { stopped: 'intake' });
    const s1 = TP.stages.identify.run({ text: s0.text, country, countryConfig });
    if (s1.stop) return build(s1.findings, { stopped: 'identify' });
    const x = await TP.stages.xsd.run(xsdClient, { text: s0.text, version: s1.version });
    if (x.stop) return build(x.findings, { stopped: 'well-formed', version: s1.version });
    const r = await TP.rulesCore.runRuleSets(SaxonJS, ruleSets, s0.text, s1.version, country, { country, countryConfig, settings });
    const findings = [...x.findings, ...r.findings];
    const rulesError = r.parseError || null;
    if (rulesError) findings.push({ source: 'rules', rule: '4.engine', stage: 4, severity: 'W', level: 'file', message: `The rule checks could not run: ${rulesError}` });
    return build(findings, { summary: r.summary, version: s1.version, rulesError });
  }

  return { TP, app, catalogue, validateFile, countries: app.countries || [] };
}

/* what may be shared: check id (with part) → number of places, and the status; no values of the file */
function countsOf(report) {
  const out = {};
  for (const g of report.groups) {
    const k = g.rule + (g.part ? '-' + g.part : '');
    out[k] = (out[k] || 0) + g.count;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })));
}

module.exports = { load, countsOf, ROOT };
