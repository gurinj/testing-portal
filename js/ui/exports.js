/*
 * Testing Portal – exports of a report:
 *  - findings as CSV: one row per place, semicolon-separated, UTF-8 with
 *    byte-order mark (opens correctly in Excel), formula injection guarded;
 *  - the printable report: one self-contained HTML file with a Print button.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const { esc, plural, SEV, LEVEL, tone, stamp } = TP.ui.h;

  const baseName = r => String(r.fileName || 'payment-file').replace(/\.[^.]+$/, '');

  /* M3: the run of a result in the session and its chain (first run of the file → this one) */
  function runCtx(r, session) {
    const S = TP.session;
    if (!S || !session || !session.runs) return { run: null, chain: [], changes: [], skipped: [] };
    const run = session.runs.find(x => x.result === r) || S.byN(session, session.current);
    if (!run) return { run: null, chain: [], changes: [], skipped: [] };
    return { run, chain: S.chain(session, run), segment: S.segment(session, run), changes: S.changesOf(session, run), skipped: run.skipped || [] };
  }
  const KIND = { calculated: 'Corrected', sample: 'Sample value', entered: 'Entered value', choice: 'Chosen' };
  const SOURCE = { upload: 'Uploaded', fix: 'Corrected in the portal' };

  function csv(r, session) {
    const runN = (runCtx(r, session).run || {}).n || 1;
    const q = v => {
      let x = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; // a cell must never start a formula in Excel
      return `"${x.replace(/"/g, '""')}"`;
    };
    const head = ['Run', 'Severity', 'Rule', 'Reason code', 'Finding', 'Message', 'Level', 'Where', 'Block', 'Transaction', 'EndToEndId', 'Creditor', 'Payment type',
      'Actual value', 'Expected', 'How to fix', 'XPath', 'Line', 'Column', 'Also fails (not shown separately)'];
    const rows = [];
    const typeOf = it => { const b = it.block ? r.blocks[it.block - 1] : null; if (!b) return ''; const t = it.tx ? b.txs[it.tx - 1] : null; return (t ? t.typeLabel : b.typeLabel) || ''; };
    for (const gr of r.groups) for (const it of gr.items) {
      rows.push([runN, SEV[gr.severity].w, gr.rule + (gr.part ? '-' + gr.part : ''), gr.code || '', gr.title, it.message, LEVEL[it.level], it.where, it.block || '', it.tx || '', it.e2e || '', it.creditor || '', typeOf(it),
        it.actual == null ? '' : it.actual, it.expected || gr.expected || '', gr.hint || '', it.xpath || '', it.line || '', it.col || '',
        it.suppresses.map(x => `${x.rule} ${x.title}`).join(', ')]);
    }
    return '﻿' + [head, ...rows].map(x => x.map(q).join(';')).join('\r\n') + '\r\n';
  }

  // @font-face rules with embedded fonts (offline file); on a site the fonts are files and are not copied
  function embeddedFonts() {
    let out = '';
    if (typeof document === 'undefined') return out;
    for (const sh of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sh.cssRules; } catch (e) { continue; }
      for (const r of Array.from(rules || [])) if (r.type === 5 && /url\("?data:/.test(r.cssText)) out += r.cssText + '\n';
    }
    return out;
  }

  const MAX_PLACES = 1000;
  function reportHtml(r, session) {
    const rc = runCtx(r, session), multi = rc.chain.length > 1;
    const [h, sub] = TP.ui.report.statusCopy(r);
    const fmt = r.versionLabel || 'Not identified';
    const facts = [['File', r.fileName], ['Format', fmt], ['Country', r.countryName], ['Payment blocks', r.stopped || r.facts.blocks == null ? 'Not read' : r.facts.blocks],
      ['Transactions', r.stopped || r.facts.blocks == null ? 'Not read' : r.facts.transactions], ['Totals', r.stopped || r.facts.blocks == null ? 'Not read' : r.facts.totals.join(', ') || '–'],
      ['Payment types', r.stopped || r.facts.blocks == null ? 'Not read' : TP.ui.report.typesText(r.facts.types).join(', ') || '–'],
      ['Settings', r.settingsSource && r.settingsSource.kind === 'session' ? `${r.settingsSource.name} (loaded for this session)` : 'Built-in'],
      ['Checked', stamp(r.at)], ['Tool', `Testing Portal ${r.app.version}, rules as of ${r.app.rulesDate} (${r.app.rulesStatus})`]];
    const one = gr => {
      const it = gr.items[0], multi = gr.count > 1;
      const places = multi ? gr.items.slice(0, MAX_PLACES).map(i => `${esc(i.where)}${i.e2e ? ` (${esc(i.e2e)})` : ''}, line ${i.line || '–'}${i.actual != null && i.actual !== '' ? `: <span class="c">${esc(i.actual)}</span>` : ''}`).join('<br>') + (gr.count > MAX_PLACES ? `<br>… and ${(gr.count - MAX_PLACES).toLocaleString('en-US')} more, see the CSV export` : '') : '';
      return `<div class="f ${gr.severity}"><div class="fh"><span class="pill">${SEV[gr.severity].w}</span><b>${esc(gr.title)}</b><span class="rid">Rule ${esc(gr.rule + (gr.part ? "-" + gr.part : ""))}${gr.code ? `, ${esc(gr.code)}` : ''}</span></div>
      <table><tr><th>Where</th><td>${multi ? plural(gr.count, 'place') : esc(it.where)}</td></tr>
      <tr><th>Finding</th><td>${esc(gr.message || it.message)}</td></tr>
      ${it.actual != null ? `<tr><th>${multi ? 'First value' : 'Actual value'}</th><td class="c">${it.actual === '' ? '(empty)' : esc(it.actual)}</td></tr>` : ''}
      ${it.expected || gr.expected ? `<tr><th>Expected</th><td>${esc(it.expected || gr.expected)}</td></tr>` : ''}
      ${gr.hint ? `<tr><th>How to fix</th><td>${esc(gr.hint)}</td></tr>` : ''}
      <tr><th>Position</th><td class="c">${esc(it.xpath || '–')}${it.line ? `, line ${it.line}${it.col ? `, column ${it.col}` : ''}` : ''}</td></tr>
      ${multi ? `<tr><th>All places</th><td>${places}</td></tr>` : ''}</table></div>`;
    };
    const runsHtml = multi ? `<h2>Runs of this file</h2><table class="list"><tr><th>Run</th><th>File</th><th>Source</th><th>Status</th><th>Errors</th><th>Warnings</th><th>Hints</th><th>Checked</th></tr>${rc.chain.map(x => `<tr><td>${x.n}</td><td>${esc(x.fileName)}</td><td>${SOURCE[x.source] || esc(x.source)}</td><td>${x.status}${x.incomplete ? ' (incomplete)' : ''}</td><td>${x.counts.E}</td><td>${x.counts.W}</td><td>${x.counts.I}</td><td>${esc(stamp(x.at))}</td></tr>`).join('')}</table>` : '';
    // the file as the customer sent it, when this run is a corrected copy (a new version of the customer is its own original)
    const first = rc.segment && rc.segment.length > 1 ? rc.segment[0] : null;
    const firstHtml = first ? `<h2>Original result (run ${first.n})</h2><p>${esc(first.fileName)}: status <span class="st ${tone(first.status)}">${first.status}</span>, ${plural(first.counts.E, 'error')}, ${plural(first.counts.W, 'warning')} and ${plural(first.counts.I, 'hint')}.</p>${first.result && first.result.groups.length ? `<table class="list"><tr><th>Severity</th><th>Rule</th><th>Finding</th><th>Places</th></tr>${first.result.groups.map(gr => `<tr><td>${SEV[gr.severity].w}</td><td>${esc(gr.rule + (gr.part ? '-' + gr.part : ''))}</td><td>${esc(gr.title)}</td><td>${gr.count}</td></tr>`).join('')}</table>` : first.result ? '' : '<p class="tag">The findings of this run are no longer kept in this session (only the last 3 runs are kept).</p>'}` : '';
    const rows = rc.changes.flatMap(c => c.rows.map(x => ({ ...x, c })));
    const samples = rows.filter(x => x.c.kind === 'sample');
    const cap = (list, f) => list.slice(0, MAX_PLACES).map(f).join('') + (list.length > MAX_PLACES ? `<tr><td colspan="6">… and ${(list.length - MAX_PLACES).toLocaleString('en-US')} more</td></tr>` : '');
    const samplesHtml = samples.length ? `<h2>Replace ${plural(samples.length, 'sample value')} before the file is used</h2><p>These values aren’t real payment data. They were added so the file could pass the check; the customer must replace them with real data.</p><table class="list"><tr><th>Field</th><th>Where</th><th>Sample value</th></tr>${cap(samples, x => `<tr><td>${esc(x.c.field)}</td><td>${esc(x.where)}</td><td class="c">${esc(x.next)}</td></tr>`)}</table>` : '';
    const changesHtml = rows.length ? `<h2>${plural(rows.length, 'change')} made to the file as received</h2><table class="list"><tr><th>Rule</th><th>Field</th><th>Where</th><th>Old value</th><th>New value</th><th>Type</th></tr>${cap(rows, x => `<tr><td>${esc(x.c.rule + (x.c.part ? '-' + x.c.part : ''))}</td><td>${esc(x.c.field)}</td><td>${esc(x.where)}</td><td class="c">${x.old == null ? '<em>(missing)</em>' : TP.ui.h.wsVal(x.old)}</td><td class="c">${x.next == null ? '<em>(removed)</em>' : TP.ui.h.wsVal(x.next)}</td><td>${KIND[x.c.kind] || ''}</td></tr>`)}</table>${rc.skipped.length ? `<p class="tag">${plural(rc.skipped.length, 'change')} could not be made: ${esc(rc.skipped.slice(0, 10).map(x => `${x.where}: ${x.reason}`).join(' · '))}${rc.skipped.length > 10 ? ' …' : ''}</p>` : ''}` : '';
    const byLevel = ['file', 'block', 'tx'].map(l => { const gs = r.groups.filter(x => x.level === l); return gs.length ? `<h3>${LEVEL[l]}</h3>${gs.map(one).join('')}` : ''; }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validation report: ${esc(r.fileName)}</title><style>${embeddedFonts()}
  :root{--y:#FEE600;--ink:#1E1E1C;--g5:#6F685F;--g2:#ECE8E1;--g1:#F6F4F0;--red:#D2463C;--green:#2F8A65;--amber:#A86E00}
  *{box-sizing:border-box}body{margin:0 auto;max-width:900px;padding:32px 24px 60px;font:14.5px/1.45 "Amalia","Amalia Pro","RBI Amalia","Figtree",system-ui,"Segoe UI",Arial,sans-serif;color:var(--ink)}
  .top{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:3px solid var(--y);padding-bottom:12px}
  .top b{font-size:15px}.tag{font-size:12.5px;color:var(--g5)}button{font:inherit;font-weight:700;background:var(--y);border:0;border-radius:18px;padding:7px 18px;cursor:pointer}
  h1{font-size:30px;margin:22px 0 2px;letter-spacing:-.01em}h2{font-size:19px;margin:26px 0 10px}h3{font-size:15px;margin:18px 0 6px;color:var(--g5)}
  .st{display:inline-block;font-weight:800;color:#fff;padding:3px 14px;border-radius:14px;background:var(--red)}.st.good{background:var(--green)}.st.mid{background:var(--amber)}
  table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:4px 8px 4px 0;border-bottom:1px solid var(--g2)}th{font-weight:650;color:var(--g5);width:150px}
  .list th{width:auto}.c{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;word-break:break-word}
  .f{border:1px solid var(--g2);border-radius:10px;padding:10px 14px;margin:0 0 10px;break-inside:avoid}.fh{display:flex;gap:10px;align-items:baseline;margin-bottom:6px;flex-wrap:wrap}.rid{margin-left:auto;color:var(--g5);font-size:12.5px}
  .pill{font-size:12px;font-weight:750;padding:1px 9px;border-radius:9px;background:var(--g1)}.E .pill{background:#FBE4E1;color:#9E2C24}.W .pill{background:#FDF0D5;color:#7C5000}
  .note{color:var(--g5);font-size:12.5px;margin-top:24px}.ws{background:#FDF0D5;color:#7C5000;border-radius:3px}
  @media print{button{display:none}body{padding:0;max-width:none}}</style></head><body>
  <div class="top"><b>Testing Portal: validation report</b><span class="tag">Temporary tool · draft rules</span><button onclick="window.print()">Print</button></div>
  <h1>${esc(h)}</h1><p>${esc(sub)} Status: <span class="st ${r.incomplete && r.status !== 'RJCT' ? 'mid' : tone(r.status)}">${r.status}${r.incomplete ? ' (incomplete)' : ''}</span></p>
  <table>${facts.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>
  ${runsHtml}${firstHtml}${samplesHtml}${changesHtml}
  <h2>${multi ? `Remaining findings (run ${rc.run.n})` : 'Findings'}</h2>${r.groups.length ? `<p>${plural(r.counts.E, 'error')}, ${plural(r.counts.W, 'warning')} and ${plural(r.counts.I, 'hint')}.</p>${byLevel}` : '<p>No findings.</p>'}
  ${r.blocks.length ? `<h2>Payment blocks</h2><table class="list"><tr><th>Block</th><th>PmtInfId</th><th>Payment type</th><th>Execution date</th><th>Transactions</th><th>Amount</th><th>Status</th></tr>${r.blocks.map(b => `<tr><td>${b.n}</td><td class="c">${esc(b.id || '–')}</td><td>${esc(b.typeLabel || '–')} <span class="c">${esc(TP.ui.report.typeLabel(b))}</span></td><td>${esc(b.date || '–')}</td><td>${b.txs.length}</td><td>${b.sums.map(esc).join(', ')}</td><td>${b.status}</td></tr>`).join('')}</table>` : ''}
  <p class="note">${r.stopped ? '' : 'ACTC is a technical check and doesn’t guarantee execution. Account status, funds, entitlements and sanctions aren’t checked. '}The rules are a draft; severities and reason codes are proposals until confirmed against CMIplus. Country rule packs are not included yet.</p>
  </body></html>`;
  }

  async function save(name, data, mime) {
    try { await TP.platform.download(name, data, mime); TP.ui.h.toast(`Saved ${name}`); }
    catch (err) { TP.ui.h.toast(err && err.code === 'declined' ? 'Download cancelled.' : `Download not possible here (${(err && (err.code || err.message)) || err}).`, true); }
  }
  /*
   * What may be shared outside the bank to discuss a result: the status, the
   * version and per check id the number of places, severity and title. No
   * file name, names, accounts, amounts or messages (messages quote values).
   * Same shape as tests/expected/bank/<file>.json (tests/run-bank.js).
   */
  function summary(r, session) {
    const rc = runCtx(r, session);
    const findings = {}, checks = {};
    for (const g of r.groups) {
      const k = g.rule + (g.part ? '-' + g.part : '');
      findings[k] = (findings[k] || 0) + g.count;
      checks[k] = { severity: g.severity, code: g.code || null, title: g.title, level: g.level, settings: g.overridden || undefined };
    }
    const order = o => Object.fromEntries(Object.entries(o).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })));
    return {
      country: r.country, version: r.version ? `pain.001.001.${r.version}` : null, status: r.status, incomplete: r.incomplete || undefined,
      transactions: r.facts.transactions, blocks: r.facts.blocks, paymentTypes: r.facts.types,
      findings: order(findings), checks: order(checks),
      settings: r.settingsSource && r.settingsSource.kind === 'session' ? 'session file' : 'built-in',
      checked: String(r.at || '').slice(0, 10), app: r.app && r.app.version, rules: r.app && r.app.rulesDate,
      // M3: run number and counts per run of this file (no values)
      run: rc.chain.length > 1 ? rc.run.n : undefined,
      runs: rc.chain.length > 1 ? rc.chain.map(x => ({ n: x.n, source: x.source, status: x.status, counts: x.counts, changes: (x.changes || []).reduce((a, c) => a + c.rows.length, 0) })) : undefined
    };
  }
  const downloadSummary = (r, session) => save(`${baseName(r)}_summary.json`, JSON.stringify(summary(r, session), null, 2) + '\n', 'application/json;charset=utf-8');
  const downloadCsv = (r, session) => save(`${baseName(r)}_findings.csv`, csv(r, session), 'text/csv;charset=utf-8');
  const downloadReport = (r, session) => save(`${baseName(r)}_report.html`, reportHtml(r, session), 'text/html;charset=utf-8');

  TP.ui.exports = { csv, reportHtml, summary, downloadCsv, downloadReport, downloadSummary };
})(typeof self !== 'undefined' ? self : globalThis);
