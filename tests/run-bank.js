#!/usr/bin/env node
/*
 * Testing Portal – the bank's test files (local test mode, docs/specs/M2.md section 6).
 *
 * Put the files into tests/files/bank/ (that folder is never committed or zipped).
 * The country comes from the start of the file name: AT_salaries.xml → AT.
 * A file without a country prefix uses --country (default AT).
 *
 *   node tests/run-bank.js --record      validate every file and write what was found
 *                                        to tests/expected/bank/<file>.json
 *   node tests/run-bank.js               validate again and compare with what was recorded
 *   node tests/run-bank.js --country CZ  country for files without a prefix
 *   node tests/run-bank.js --strict      exit code 1 if anything differs (default: report only)
 *
 * The expected files hold the status and, per check id, the number of places:
 * no names, accounts, amounts or other values of the payment files, so they can
 * be shared to discuss a result. Run node tools/build.js first (it builds dist/site).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load, countsOf, ROOT } = require('./lib/engine.js');

const BANK = path.join(ROOT, 'tests/files/bank');
const EXPECTED = path.join(ROOT, 'tests/expected/bank');
const args = process.argv.slice(2);
const RECORD = args.includes('--record');
const STRICT = args.includes('--strict');
const QUIET = args.includes('--quiet');
const ci = args.indexOf('--country');
const DEFAULT_COUNTRY = ci >= 0 && args[ci + 1] ? args[ci + 1].toUpperCase() : 'AT';

(async () => {
  fs.mkdirSync(BANK, { recursive: true });
  const files = fs.existsSync(BANK) ? fs.readdirSync(BANK).filter(f => !f.startsWith('.') && fs.statSync(path.join(BANK, f)).isFile()).sort() : [];
  if (!files.length) {
    if (!QUIET) console.log(`No files in ${path.relative(ROOT, BANK)}/. Put the bank's test files there (AT_name.xml, CZ_name.xml, …).`);
    return;
  }
  const engine = await load();
  fs.mkdirSync(EXPECTED, { recursive: true });
  let differ = 0, recorded = 0, same = 0, missing = 0;
  for (const f of files) {
    const m = /^([A-Za-z]{2})[_\-. ]/.exec(f);
    const country = m && engine.countries.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : DEFAULT_COUNTRY;
    const t0 = Date.now();
    const report = await engine.validateFile(fs.readFileSync(path.join(BANK, f)), f, country);
    const ms = Date.now() - t0;
    const result = {
      country, version: report.version ? `pain.001.001.${report.version}` : null, status: report.status,
      transactions: report.facts.transactions, findings: countsOf(report),
      recorded: new Date().toISOString().slice(0, 10), app: engine.app.version
    };
    const expFile = path.join(EXPECTED, f.replace(/\.[^.]*$/, '') + '.json');
    const line = `${f} (${country}, ${result.version || 'not identified'}): ${result.status}, ${Object.keys(result.findings).length} checks, ${(ms / 1000).toFixed(1)} s`;
    if (RECORD) {
      fs.writeFileSync(expFile, JSON.stringify(result, null, 2) + '\n');
      recorded++;
      console.log(`recorded  ${line}`);
      continue;
    }
    if (!fs.existsSync(expFile)) { missing++; console.log(`new       ${line} (not recorded yet: run with --record)`); continue; }
    const exp = JSON.parse(fs.readFileSync(expFile, 'utf8'));
    const diffs = [];
    if (exp.status !== result.status) diffs.push(`status ${exp.status} → ${result.status}`);
    if (exp.version !== result.version) diffs.push(`version ${exp.version} → ${result.version}`);
    const ids = [...new Set([...Object.keys(exp.findings || {}), ...Object.keys(result.findings)])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const id of ids) {
      const a = (exp.findings || {})[id] || 0, b = result.findings[id] || 0;
      if (a !== b) diffs.push(a === 0 ? `${id} new (${b})` : b === 0 ? `${id} gone (was ${a})` : `${id} ${a} → ${b}`);
    }
    if (diffs.length) { differ++; console.log(`DIFFERENT ${line}\n          ${diffs.join('\n          ')}`); }
    else { same++; if (!QUIET) console.log(`same      ${line}`); }
  }
  if (RECORD) console.log(`\n${recorded} recorded in ${path.relative(ROOT, EXPECTED)}/`);
  else console.log(`\nbank files: ${same} as recorded, ${differ} different, ${missing} not recorded`);
  process.exit(STRICT && (differ || missing) ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
