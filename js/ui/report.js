/*
 * Testing Portal – report screen.
 * Status band, facts, module strip, severity chips, search, findings by
 * level (grouped, with all places), payment blocks and transactions.
 * The findings area is redrawn on its own, so filters keep open findings open.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const { ic, esc, plural, SEV, LEVEL, tone, showVal, $, stamp, secs } = TP.ui.h;
  const PAGE = 100;

  function statusCopy(r) {
    const c = r.counts, o = r.occurrences;
    const places = (n, k) => o[k] > n ? ` at ${plural(o[k], 'place')}` : '';
    if (r.stopped === 'identify') return ['Format isn’t supported', 'The file was read, but it isn’t a pain.001 message this tool can check. The other checks couldn’t run.'];
    if (r.stopped) return ['File can’t be read', 'Validation stopped at the first module. The other checks couldn’t run.'];
    if (r.incomplete && r.status !== 'RJCT') return ['Check incomplete', `Some checks could not run, so this ${r.status} is not reliable. Open About › Technical check, then validate the file again.`];
    if (r.status === 'RJCT') return ['File rejected', `CMIplus would reject this file. ${plural(c.E, 'error')}${places(c.E, 'E')} must be fixed.`];
    if (r.status === 'ACWC') return ['Passed with warnings', `CMIplus would accept this file. ${plural(c.W, 'warning')}${places(c.W, 'W')} should be reviewed.`];
    if (c.I) return ['Technical check passed', `The file passes with ${plural(c.I, 'hint')}.`];
    return ['Technical check passed', 'No errors, warnings or hints.'];
  }

  function facts(r) {
    const notRead = r.stopped || r.facts.blocks == null ? 'Not read' : null;
    return [
      ['File', esc(r.fileName)],
      ['Format', esc(r.versionLabel || 'Not identified')],
      ['Country', esc(r.countryName)],
      ['Payment blocks', notRead || r.facts.blocks],
      ['Transactions', notRead || r.facts.transactions.toLocaleString('en-US')],
      ['Totals', notRead || (r.facts.totals.length ? r.facts.totals.map(esc).join('<br>') : '–')],
      ['Payment types', notRead || typesText(r.facts.types).map(esc).join('<br>') || '–'],
      ['Settings', r.settingsSource && r.settingsSource.kind === 'session' ? `<span class="code">${esc(r.settingsSource.name)}</span><br><span class="muted">loaded for this session</span>` : 'Built-in'],
      ['Checked', `${esc(stamp(r.at))}<br><span class="muted">in ${esc(secs(r.timings.total))}</span>`]
    ];
  }

  function render(s) {
    const r = s.result, [h, sub] = statusCopy(r), t = r.incomplete && r.status !== 'RJCT' ? 'mid' : tone(r.status);
    const stop = r.stopped ? r.groups[0] : null;
    return `<section class="wrap">
      <div class="band">
        <div class="bandmain"><span class="stpill big ${t}">${r.status}</span><div><h1 tabindex="-1">${h}</h1><p>${esc(sub)}</p></div></div>
        <div class="bandact">${bandActions(s)}</div>
      </div>
      <dl class="facts">${facts(r).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${runsStrip(s)}
      ${fixInfo(s)}
      ${stop ? `<div class="stopnote">${ic('x', 24)}<div><b>${esc(stop.title)}</b><p>${esc(stop.items[0].message)}${stop.items[0].line ? ` (line ${stop.items[0].line}${stop.items[0].col ? `, column ${stop.items[0].col}` : ''})` : ''}</p><p class="muted">${esc(stop.hint || '')}</p></div></div>` : ''}
      <div class="fhdr" id="findings-h"><h2 class="sec-h">Findings</h2>
        <div class="tools">
          ${r.text ? `<button class="btn sec sm" data-act="xml" data-fid="vx">${ic('code', 18)}View XML</button>` : ''}
          ${r.groups.length ? `<button class="btn sec sm" data-act="dl-csv" data-fid="csv">${ic('table', 18)}Export findings (CSV)</button>` : ''}
          <button class="btn sec sm" data-act="dl-summary" data-fid="sum" title="Status and the number of places per check, without any value from the file">${ic('down', 18)}Summary to share (no payment data)</button>
        </div>
      </div>
      ${r.groups.length ? `<div id="fmods"></div>
        <div class="filters"><span id="fchips" class="chips"></span>
          <label class="search">${ic('search', 18)}<input type="search" id="fq" placeholder="Search EndToEndId, creditor, value or rule" aria-label="Search findings" value="${esc(s.view.q)}"></label>
          <button class="link" data-act="expand" data-fid="exp" id="fexp"></button>
        </div>
        <div id="ftx"></div><div id="flist"></div>`
      : `<div id="fmods"></div><div class="empty">${ic('check', 26)}<p>No findings in this file.</p></div>`}
      ${r.blocks.length ? vBlocks(r) : ''}
      ${notes(r)}
    </section>`;
  }

  /* M3: the buttons of the band per status, as in prototype v2 (service desk) */
  function bandActions(s) {
    const r = s.result, scr = TP.ui.screens || {};
    const cur = TP.session ? TP.session.byN(s.session, s.session.current) : null;
    const btn = (act, kind, icon, label) => `<button class="btn ${kind}" data-act="${act}" data-fid="a-${act}">${ic(icon)}${label}</button>`;
    const email = scr.email ? kind => btn('email', kind, 'mail', 'Create email for the customer') : () => '';
    const fixed = cur && cur.source === 'fix' && cur.text != null ? btn('dl-xml', 'sec', 'down', 'Download corrected file') : '';
    const fixable = !r.stopped && r.text && TP.ui.fix;
    const out = [];
    if (r.stopped) out.push(email('pri'));
    else if (r.status === 'RJCT') { if (fixable) out.push(btn('fix', 'pri', 'wrench', 'Fix the errors')); out.push(fixed, email('sec')); }
    else if (r.status === 'ACWC') { out.push(email('pri')); if (fixable) out.push(btn('fix', 'sec', 'wrench', 'Fix the warnings')); out.push(fixed); }
    else out.push(email('pri'), fixed);
    out.push(btn('dl-report', 'sec', 'down', 'Download report'), btn('again', 'sec', 'up', 'Validate another file'));
    return out.join('');
  }

  /* M3: run 1 → run 2 … (from js/ui/compare.js when it is there) */
  function runsStrip(s) {
    if (TP.ui.compare && TP.ui.compare.runsStrip) return TP.ui.compare.runsStrip(s);
    const S = TP.session, cur = S ? S.byN(s.session, s.session.current) : null;
    if (!cur) return '';
    const ch = S.chain(s.session, cur);
    if (ch.length < 2) return '';
    return `<div class="runs">${ch.map(x => `<span class="runstep"><small>Run ${x.n}</small><span class="st ${tone(x.status)}">${x.status}</span><b>${plural(x.counts.E + x.counts.W + x.counts.I, 'finding')}</b></span>`).join(`<span class="runarrow">${ic('arrow', 18)}</span>`)}</div>`;
  }

  /* M3: sample values still to replace, and the changes applied in this file's runs */
  const TAGLABEL = { calculated: 'Corrected', sample: 'Sample value', entered: 'Entered value', choice: 'Chosen' };
  function fixInfo(s) {
    const S = TP.session, cur = S ? S.byN(s.session, s.session.current) : null;
    if (!cur) return '';
    const changes = S.changesOf(s.session, cur);
    if (!changes.length) return '';
    const rows = changes.flatMap(c => c.rows.map(x => ({ ...x, c })));
    const samples = rows.filter(x => x.c.kind === 'sample');
    const shown = rows.slice(0, 200);
    const skipped = cur.skipped || [];
    return `${samples.length ? `<div class="samples">
        <h2>${ic('warn', 22)}Replace ${plural(samples.length, 'sample value')} before the file is used</h2>
        <p>These values aren’t real payment data. They were added so the file could pass the check; the customer must replace them with real data.</p>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Field</th><th>Where</th><th>Sample value</th></tr></thead><tbody>
        ${samples.slice(0, 50).map(x => `<tr><td>${esc(x.c.field)}</td><td>${esc(x.where)}</td><td class="code">${esc(x.next)}</td></tr>`).join('')}
        </tbody></table></div>${samples.length > 50 ? `<p class="muted">The first 50 of ${samples.length}; the report lists all.</p>` : ''}</div>` : ''}
      <details class="applied"><summary>${ic('chev')}${plural(rows.length, 'change')} made to the file as received</summary>
        <div class="tblwrap"><table class="tbl changes"><thead><tr><th>Rule</th><th>Field</th><th>Where</th><th>Old value</th><th>New value</th><th>Type</th></tr></thead><tbody>
        ${shown.map(x => `<tr><td>${esc(x.c.rule + (x.c.part ? '-' + x.c.part : ''))}</td><td>${esc(x.c.field)}</td><td>${esc(x.where)}</td><td class="code old">${x.old == null ? '<em class="miss">(missing)</em>' : TP.ui.h.wsVal(x.old)}</td><td class="code new">${x.next == null ? '<em class="miss">(removed)</em>' : TP.ui.h.wsVal(x.next)}</td><td>${TAGLABEL[x.c.kind] || ''}</td></tr>`).join('')}
        </tbody></table></div>${rows.length > shown.length ? `<p class="muted">The first ${shown.length} of ${rows.length}; the report lists all.</p>` : ''}
      </details>
      ${skipped.length ? `<p class="skippednote">${plural(skipped.length, 'change')} could not be made: ${esc(skipped.slice(0, 3).map(x => `${x.where}: ${x.reason}`).join(' · '))}${skipped.length > 3 ? ' …' : ''}</p>` : ''}`;
  }

  function notes(r) {
    const planned = r.modules.filter(m => m.planned).map(m => m.name);
    const parts = [];
    if (r.incomplete) parts.push('Some checks could not run; see the finding “Some checks could not run”.');
    if (!r.stopped) parts.push('ACTC is a technical check and doesn’t guarantee execution. Account status, funds, entitlements and sanctions aren’t checked.');
    parts.push(`The rules are a draft (rules as of ${esc(r.app.rulesDate)}); severities and reason codes are proposals until confirmed against CMIplus.`);
    if (planned.length) parts.push(`Not in this version yet: ${esc(planned.join(', '))}. Country rule packs are empty, so every country gets the generic rules.`);
    if (r.xsdTruncated) parts.push('The XSD check stopped after 5,000 errors; fix those first and check again.');
    if (r.suppressed.length) parts.push(`${plural(r.suppressed.length, 'rule finding')} on values that already fail the ISO schema ${r.suppressed.length === 1 ? 'is' : 'are'} not shown separately; the schema finding names ${r.suppressed.length === 1 ? 'it' : 'them'}.`);
    return `<p class="note">${parts.join(' ')}</p>`;
  }

  /* ---------------- findings ---------------- */
  function affects(it, tx) {
    if (!tx) return true;
    if (it.level === 'tx') return it.block === tx.b && it.tx === tx.t;
    if (it.severity === 'I') return false;
    return it.level === 'file' || it.block === tx.b;
  }
  const text = it => [it.e2e, it.creditor, it.where, it.actual, it.message, it.xpath];

  function visibleGroups(s) {
    const v = s.view, q = v.q.trim().toLowerCase();
    return s.result.groups.map(gr => {
      if (v.sev !== 'all' && gr.severity !== v.sev) return null;
      if (v.mod !== 'all' && gr.module !== v.mod) return null;
      let items = gr.items;
      if (v.tx) { items = items.filter(it => affects(it, v.tx)); if (!items.length) return null; }
      if (q) {
        const headHit = [gr.title, `rule ${gr.rule}`, gr.rule, gr.code, gr.message, gr.hint].some(x => x && String(x).toLowerCase().includes(q));
        if (!headHit) { items = items.filter(it => text(it).some(x => x != null && String(x).toLowerCase().includes(q))); if (!items.length) return null; }
      }
      return { gr, items, filtered: items.length < gr.items.length };
    }).filter(Boolean);
  }

  function vModStrip(s) {
    const r = s.result;
    return `<div class="mstrip" role="group" aria-label="Filter by validation module">${r.modules.map(m => {
      const on = s.view.mod === m.id;
      const cls = m.notRun ? 'skip' : m.planned && !m.n ? 'plan' : m.tone;
      const label = m.notRun ? 'Not run' : m.failed ? 'Could not run' : m.n ? plural(m.n, 'finding') : m.planned ? 'No rules yet' : 'No findings';
      return `<button class="mchip ${cls}${on ? ' on' : ''}" data-act="fmod" data-k="${m.id}" data-fid="fm-${m.id}" aria-pressed="${on}" ${m.n ? '' : 'disabled'}><b>${esc(m.name)}</b><span>${label}</span></button>`;
    }).join('')}</div>`;
  }
  function vChips(s) {
    const c = s.result.counts, k = s.view.sev;
    const chip = (key, label, n) => `<button class="fchip ${key}${k === key ? ' on' : ''}" data-act="fsev" data-k="${key}" data-fid="fs-${key}" aria-pressed="${k === key}"><b>${n}</b> ${label}</button>`;
    return chip('all', 'All', c.E + c.W + c.I) + chip('E', c.E === 1 ? 'Error' : 'Errors', c.E) + chip('W', c.W === 1 ? 'Warning' : 'Warnings', c.W) + chip('I', c.I === 1 ? 'Hint' : 'Hints', c.I);
  }
  function vTxFilter(s) {
    const tx = s.view.tx;
    if (!tx) return '';
    const b = s.result.blocks[tx.b - 1], t = b && b.txs[tx.t - 1];
    return `<div class="txf">${ic('info', 18)}<span>Findings that affect <b>${esc(TP.findings.whereOf(tx.b, tx.t))}</b>${t && t.e2e ? ` (${esc(t.e2e)})` : ''}</span><button class="link" data-act="cleartx" data-fid="ctx">Show all findings</button></div>`;
  }

  /* a few lines of the file around the finding; long lines are cut around the column */
  function snippet(lines, line, col) {
    if (!lines || !line || line > lines.length) return '';
    const from = Math.max(1, line - 2), to = Math.min(lines.length, line + 2);
    let out = '';
    for (let i = from; i <= to; i++) {
      let t = lines[i - 1];
      if (t.length > 240) {
        const c = i === line && col ? col : 1;
        const a = Math.max(0, c - 80);
        t = (a ? '…' : '') + t.slice(a, a + 240) + (a + 240 < t.length ? '…' : '');
      }
      if (i === to && t === '' && i === lines.length) break;
      out += `<div class="${i === line ? 'hit' : ''}"><i>${i}</i><code>${esc(t)}</code></div>`;
    }
    return `<div class="src">${out}</div>`;
  }

  function locIdx(s, gr, items) {
    const sel = s.view.locSel[gr.id];
    if (sel != null && items.includes(gr.items[sel])) return sel;
    return gr.items.indexOf(items[0]);
  }

  function vGroup(s, { gr, items, filtered }) {
    const S = SEV[gr.severity], multi = gr.count > 1, open = s.view.open.has(gr.id);
    const idx = locIdx(s, gr, items), it = gr.items[idx];
    const where = multi ? plural(gr.count, 'place') : it.where;
    const small = gr.message || (multi ? gr.hint : it.message) || gr.hint || '';
    const code = gr.code && gr.code !== 'FF01' ? `, ${esc(gr.code)}` : gr.code ? ', FF01' : '';
    let body = '';
    if (open) {
      const rows = [];
      if (it.message && it.message !== small) rows.push(['Finding', esc(it.message), 'full']);
      rows.push([multi ? `Value in ${esc(it.where)}` : 'Actual value', `<span class="code">${showVal(it.actual)}</span>`]);
      if (it.expected || gr.expected) rows.push(['Expected', esc(it.expected || gr.expected)]);
      if (gr.hint) rows.push(['How to fix', esc(gr.hint)]);
      if (gr.check) rows.push(['Check', esc(gr.check)]);
      if (gr.overridden) rows.push(['Settings', `Severity or reason code changed in the settings (checks."${esc(gr.rule + (gr.part ? '-' + gr.part : ''))}").`]);
      if (it.tx && s.result.blocks[it.block - 1]) { const t = s.result.blocks[it.block - 1].txs[it.tx - 1]; if (t && t.typeLabel) rows.push(['Payment type', esc(t.typeLabel)]); }
      rows.push(['XPath', `<span class="code">${esc(it.xpath || '–')}</span>`, 'full']);
      rows.push(['Line and column', it.line ? `Line ${it.line}${it.col ? `, column ${it.col}` : ''}` : '–']);
      if (it.e2e) rows.push(['EndToEndId', `<span class="code">${esc(it.e2e)}</span>`]);
      const shown = Math.min(items.length, s.view.locPage[gr.id] || PAGE);
      body = `<div class="fbody">
        <dl class="kv2">${rows.map(([k, v, cls]) => `<div class="${cls || ''}"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        ${snippet(s.lines, it.line, it.col)}
        ${it.suppresses.length ? `<p class="supp">This element also fails ${it.suppresses.map(x => `rule ${esc(x.rule)} (${esc(x.title)})`).join(', ')}. ${it.suppresses.length === 1 ? 'That finding is' : 'Those findings are'} not shown separately.</p>` : ''}
        ${multi ? `${filtered ? `<p class="hitnote">${plural(items.length, 'place')} of ${gr.count.toLocaleString('en-US')} match the filter.</p>` : ''}
          <div class="locs"><table class="tbl"><thead><tr><th>Where</th><th>EndToEndId</th><th>Creditor</th><th>Line</th><th>Value</th><th><span class="vh">Show</span></th></tr></thead><tbody>
          ${items.slice(0, shown).map(i => { const n = gr.items.indexOf(i), cur = n === idx;
            return `<tr class="${cur ? 'cur' : ''}"><td>${esc(i.where)}</td><td class="code">${i.e2e ? esc(i.e2e) : '–'}</td><td>${i.creditor ? esc(i.creditor) : '–'}</td><td class="num">${i.line || '–'}</td><td class="code">${showVal(i.actual)}</td><td>${cur ? '<span class="shown">Shown above</span>' : `<button class="link" data-act="loc" data-g="${gr.id}" data-i="${n}" data-fid="l-${gr.id}-${n}">Show</button>`}</td></tr>`; }).join('')}
          </tbody></table>
          ${shown < items.length ? `<div class="more"><button class="link" data-act="locmore" data-g="${gr.id}" data-fid="lm-${gr.id}">Show ${Math.min(PAGE, items.length - shown)} more of ${(items.length - shown).toLocaleString('en-US')}</button></div>` : ''}</div>` : ''}
        <div class="factions">
          ${s.result.text && it.line ? `<button class="btn sec sm" data-act="xml" data-g="${gr.id}" data-i="${idx}" data-fid="x-${gr.id}">${ic('code', 18)}Open in XML viewer</button>` : ''}
        </div>
      </div>`;
    }
    return `<li class="find${open ? ' open' : ''}">
      <button class="fhead" data-act="toggle" data-g="${gr.id}" aria-expanded="${open}" data-fid="t-${gr.id}">
        <span class="sev ${gr.severity}" title="${S.w}">${ic(S.ic, 18)}</span>
        <span class="ftxt"><b>${esc(gr.title)}</b><small>${esc(small)}</small></span>
        <span class="fmeta">${multi ? `<span class="count">${where}</span>` : `<span class="wh">${esc(where)}</span>`}<span class="rid">Rule ${esc(gr.rule + (gr.part ? "-" + gr.part : ""))}${code}</span></span>
        ${ic('chev')}
      </button>${body}</li>`;
  }

  function vFindings(s, vis) {
    if (!vis.length) return `<div class="empty plain"><p>No findings match these filters.</p></div>`;
    return ['file', 'block', 'tx'].map(l => {
      const gs = vis.filter(v => v.gr.level === l);
      if (!gs.length) return '';
      return `<h3 class="lvl">${LEVEL[l]}</h3><ul class="finds">${gs.map(v => vGroup(s, v)).join('')}</ul>`;
    }).join('');
  }

  function renderFind(s) {
    const box = $('#fmods');
    if (!box) return;
    const act = document.activeElement, keep = act && act.dataset && act.closest && act.closest('#fmods,#fchips,#ftx,#flist') ? act.dataset.fid : null;
    box.innerHTML = vModStrip(s);
    if (!$('#flist')) return;
    const vis = visibleGroups(s);
    $('#fchips').innerHTML = vChips(s);
    $('#ftx').innerHTML = vTxFilter(s);
    $('#flist').innerHTML = vFindings(s, vis);
    const all = vis.length > 0 && vis.every(v => s.view.open.has(v.gr.id)), x = $('#fexp');
    x.textContent = all ? 'Collapse all' : 'Expand all';
    x.dataset.all = all ? '1' : '';
    x.hidden = !vis.length;
    if (keep) { const el = document.querySelector(`[data-fid="${keep}"]`); if (el) el.focus({ preventScroll: true }); }
  }

  /* ---------------- payment blocks ---------------- */
  function vBlocks(r) {
    return `<h2 class="sec-h">Payment blocks</h2>
    <div class="tblwrap blocks"><table class="tbl"><thead><tr><th>Block</th><th>PmtInfId</th><th>Payment type</th><th>Execution date</th><th class="num">Transactions</th><th class="num">Amount</th><th class="num">Findings</th><th>Status</th></tr></thead><tbody>
    ${r.blocks.map(b => `<tr><td>${b.n}</td><td class="code">${b.id ? esc(b.id) : '–'}</td><td>${esc(b.typeLabel || '–')}${typeLabel(b) !== '–' ? `<br><span class="muted code">${esc(typeLabel(b))}</span>` : ''}</td><td class="nw">${esc(b.date || '–')}</td><td class="num">${b.txs.length.toLocaleString('en-US')}</td><td class="num">${b.sums.map(esc).join('<br>') || '–'}</td><td class="num">${b.findings}</td><td>${pill(b.status)}</td></tr>
      <tr class="sub"><td colspan="8"><details data-block="${b.n}"><summary>${ic('chev', 18)}Show ${plural(b.txs.length, 'transaction')}</summary><div class="txs" id="txs-${b.n}"></div></details></td></tr>`).join('')}
    </tbody></table></div>`;
  }
  // the codes of the block that the payment type was derived from
  const typeLabel = b => [b.svcLvl, b.lclInstrm, b.ctgyPurp].filter(Boolean).join(' · ') || (b.method ? `${b.method}, no service level` : '–');
  // "SEPA credit transfer: 18" lines from facts.types, most frequent first
  const typesText = types => Object.entries(types || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n.toLocaleString('en-US')}`);
  const pill = st => `<span class="st ${tone(st)}">${st}</span>`;

  function vTxRows(s, b, upto) {
    const rows = b.txs.slice(0, upto).map(t => `<tr><td class="num">${t.n}</td><td class="code">${t.e2e ? esc(t.e2e) : '–'}</td><td>${t.creditor ? esc(t.creditor) : '<em class="miss">(no name)</em>'}</td><td class="code">${t.account ? esc(t.account) : '–'}</td><td>${esc(t.typeLabel || '–')}</td><td class="num">${esc(t.ccy || '')} ${t.amount ? esc(TP.report.toUnits(t.amount) != null ? TP.report.fmtAmount(TP.report.toUnits(t.amount), t.ccy) : t.amount) : '–'}</td>
      <td>${t.findings ? `<button class="link" data-act="txf" data-b="${b.n}" data-t="${t.n}" data-fid="tx-${b.n}-${t.n}">${plural(t.findings, 'finding')}</button>` : '<span class="muted">None</span>'}</td><td>${pill(t.status)}</td></tr>`).join('');
    return `<table class="tbl inner"><thead><tr><th class="num">No.</th><th>EndToEndId</th><th>Creditor</th><th>Account</th><th>Payment type</th><th class="num">Amount</th><th>Findings</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
      ${upto < b.txs.length ? `<div class="more"><button class="link" data-act="txmore" data-b="${b.n}" data-fid="txm-${b.n}">Show ${Math.min(500, b.txs.length - upto)} more of ${(b.txs.length - upto).toLocaleString('en-US')}</button></div>` : ''}`;
  }
  function fillTxs(s, n) {
    const b = s.result.blocks[n - 1], box = document.getElementById('txs-' + n);
    if (!b || !box) return;
    const upto = s.view.txPage[n] || 500;
    box.innerHTML = vTxRows(s, b, upto);
  }

  TP.ui.report = { render, renderFind, visibleGroups, fillTxs, statusCopy, typeLabel, typesText };
})(typeof self !== 'undefined' ? self : globalThis);
