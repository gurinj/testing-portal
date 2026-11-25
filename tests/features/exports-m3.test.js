/*
 * M3 exports (docs/specs/M3.md, section 7): the printable report, the CSV and the
 * summary know the runs of a file in the session.
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async t => {
  const { ok, head, gen, validate, contextFor, TP, ROOT } = t;
  for (const f of ['locate.js', 'edit.js', 'checks.js', 'propose.js', 'session.js']) require(path.join(ROOT, 'js/fix', f));
  for (const f of fs.readdirSync(path.join(ROOT, 'js/fix/actions')).filter(f => f.endsWith('.js')).sort()) require(path.join(ROOT, 'js/fix/actions', f));
  for (const f of ['common.js', 'report.js', 'exports.js']) require(path.join(ROOT, 'js/ui', f));
  const fixes = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/fixes.json'), 'utf8'));
  const F = TP.fix, S = TP.session, X = TP.ui.exports;
  const APP = { version: 'test', rulesDate: '2026-11-24', rulesStatus: 'draft' };

  head('M3 exports: runs, original result, sample values and changes');
  {
    const base = gen.generate({ version: '09', transactions: 3, blocks: 1, type: 'CROSS_BORDER', country: 'UA' });
    const x = base.replace('<ChrgBr>SHAR</ChrgBr>', '<ChrgBr>SLEV</ChrgBr>').replace(/<Cdtr><Nm>[^<]*<\/Nm>/, '<Cdtr>');
    const ctx = contextFor('UA');
    const r1 = await validate(x, '09', 'UA');
    r1.fileName = 'salaries.xml'; r1.app = r1.app || APP;
    const s = S.create();
    // one run only: the exports look as before
    S.add(s, r1, { source: 'upload', text: x });
    const one = X.reportHtml(r1, s);
    ok(!one.includes('Runs of this file') && one.includes('<h2>Findings</h2>'), 'report: a single run has no runs section');
    ok(X.summary(r1, s).runs === undefined && X.summary(r1).runs === undefined, 'summary: a single run has no run counts');
    const c1 = X.csv(r1, s).split('\r\n');
    ok(c1[0].startsWith('﻿"Run";"Severity"') && c1[1].startsWith('"1";'), 'CSV: the first column is the run number', c1[0].slice(0, 40));

    const { proposals } = F.propose(r1, x, { fixes, settings: ctx.settings, country: 'UA', countryConfig: ctx.countryConfig });
    proposals.forEach(p => { p.sel = true; });
    const out = F.apply(x, proposals);
    const r2 = await validate(out.text, '09', 'UA');
    r2.fileName = 'salaries_corrected.xml'; r2.app = r2.app || APP;
    S.add(s, r2, { source: 'fix', parent: 1, changes: out.applied, skipped: out.skipped, text: out.text });

    const html = X.reportHtml(r2, s);
    ok(html.includes('Runs of this file') && html.includes('Corrected in the portal') && html.includes('Original result (run 1)') && html.includes('Remaining findings (run 2)'), 'report: runs, the original result and the remaining findings');
    ok(html.includes('sample value') && html.includes('Sample Creditor Name'), 'report: the sample values to replace');
    ok(html.includes('made to the file as received') && html.includes('SLEV') && html.includes('SHAR'), 'report: the changes with old and new value');
    ok(r1.groups.every(g => html.includes(g.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')) || html.includes(g.title)), 'report: the original findings are listed');
    const c2 = X.csv(r2, s).split('\r\n');
    ok(c2.length < 3 || c2[1].startsWith('"2";'), 'CSV: run 2 rows carry run number 2');
    const sm = X.summary(r2, s), js = JSON.stringify(sm);
    ok(sm.run === 2 && sm.runs.length === 2 && sm.runs[0].status === r1.status && sm.runs[1].source === 'fix' && sm.runs[1].changes === out.applied.reduce((a, g) => a + g.rows.length, 0), 'summary: run number, status, counts and number of changes per run', js);
    ok(!/salaries|Sample Creditor|SLEV/.test(js), 'summary: still no file name and no values');
  }
};
