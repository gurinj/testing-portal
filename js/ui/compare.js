/*
 * Testing Portal – comparison screen (#compare) and the runs strip of the report (M3).
 *
 * Works on state.session = { runs: [Run], current: <n> } (docs/specs/M3.md section 4),
 * built by the app. Two runs are picked (default: the current run and its
 * parent, else the run before it) and compared with TP.compare.runs: resolved,
 * still open and new findings, grouped by check, with their places. A check
 * shows its first 50 places; "Show all" shows the rest in a scroll box.
 *
 * TP.ui.compare.runsStrip(state) → HTML for the report: run 1 → run 2 … of the
 * current file with status and findings, what was resolved since the run
 * before, and a link to this screen. Empty when the file has only one run.
 *
 * View state: state.compare = { a, b, open: Set, all: Set } (run numbers, open
 * checks, checks showing all places), made here; reset when the session's
 * current run changes. Nothing is stored.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.ui = TP.ui || {};
  const { ic, esc, plural, SEV, LEVEL, tone, stamp } = TP.ui.h;
  const FIRST = 50;

  /* ---------------- runs ---------------- */
  const runsOf = s => (s.session && s.session.runs) || [];
  const runOf = (s, n) => runsOf(s).find(r => r.n === n) || null;
  const currentOf = s => runOf(s, s.session && s.session.current) || runsOf(s)[runsOf(s).length - 1] || null;
  // the run and its parents, oldest first
  function chainOf(s, run) {
    const out = [];
    const seen = new Set();
    for (let r = run; r && !seen.has(r.n); r = r.parent != null ? runOf(s, r.parent) : null) { seen.add(r.n); out.unshift(r); }
    return out;
  }
  const rootOf = (s, run) => chainOf(s, run)[0];
  // the run compared with by default: its parent, else the run before it in the session, else the latest other run
  function defaultFrom(s, run) {
    const list = runsOf(s);
    if (run.parent != null && runOf(s, run.parent)) return runOf(s, run.parent);
    const i = list.indexOf(run);
    if (i > 0) return list[i - 1];
    return list.filter(r => r !== run).pop() || null;
  }
  const findingsOf = r => (r.counts ? (r.counts.E || 0) + (r.counts.W || 0) + (r.counts.I || 0) : 0);
  const pill = r => `<span class="st ${r.incomplete && r.status !== 'RJCT' ? 'mid' : tone(r.status)}">${esc(r.status)}</span>`;
  const changesOf = r => (r.changes || []).reduce((n, c) => n + ((c.rows && c.rows.length) || 0), 0);
  function sourceText(s, r) {
    if (r.source === 'fix') { const n = changesOf(r); return `Corrected copy of run ${r.parent}${n ? ` (${plural(n, 'value')} changed)` : ''}`; }
    return r.parent != null ? `Uploaded, a new version of run ${r.parent}` : 'Uploaded';
  }
  const stopped = r => !!(r.result ? r.result.stopped : r.keys && r.keys.meta && r.keys.meta.stopped);

  // the comparison of two runs, once per pair (runs do not change once made)
  const memo = typeof WeakMap === 'function' ? new WeakMap() : null;
  function compareRuns(a, b) {
    const ka = TP.compare.keysOfRun(a), kb = TP.compare.keysOfRun(b);
    if (!ka || !kb) return null;
    if (!memo) return TP.compare.runs(ka, kb);
    let m = memo.get(ka);
    if (!m) memo.set(ka, m = new WeakMap());
    let c = m.get(kb);
    if (!c) m.set(kb, c = TP.compare.runs(ka, kb));
    return c;
  }

  /* ---------------- view state ---------------- */
  function viewState(s) {
    const cur = currentOf(s);
    let v = s.compare;
    if (!v || v.current !== (cur && cur.n) || !runOf(s, v.a) || !runOf(s, v.b)) {
      const from = cur ? defaultFrom(s, cur) : null;
      v = s.compare = { current: cur && cur.n, a: from ? from.n : null, b: cur ? cur.n : null, open: new Set(), all: new Set() };
    }
    return v;
  }

  /* ---------------- screen ---------------- */
  const LISTS = [
    { k: 'resolved', h: 'Resolved', cls: 'res', what: (a, b) => `Found in run ${a.n}, gone in run ${b.n}.`, none: 'No findings resolved.' },
    { k: 'open', h: 'Still open', cls: 'open', what: (a, b) => `Found in run ${a.n} and in run ${b.n}.`, none: 'No findings still open.' },
    { k: 'new', h: 'New', cls: 'new', what: (a, b) => `Found in run ${b.n}, not in run ${a.n}.`, none: 'No new findings.' }
  ];

  function runOption(r, sel) {
    const t = `Run ${r.n} · ${r.fileName || r.label || ''} · ${r.status}${r.incomplete ? ' (incomplete)' : ''}`;
    return `<option value="${r.n}"${sel ? ' selected' : ''}>${esc(t)}</option>`;
  }

  function runCard(s, r, role) {
    const c = r.counts || { E: 0, W: 0, I: 0 };
    return `<div class="cmp-run">
      <div class="cmp-run-h"><small>${role}</small><b>Run ${r.n}</b>${pill(r)}</div>
      <div class="cmp-file code">${esc(r.fileName || r.label || '–')}</div>
      <div class="muted">${esc(sourceText(s, r))} · checked ${esc(stamp(r.at))}</div>
      <div class="cmp-cnt">${plural(c.E || 0, 'error')} · ${plural(c.W || 0, 'warning')} · ${plural(c.I || 0, 'hint')}${r.incomplete ? ' · <b>incomplete</b>' : ''}</div>
    </div>`;
  }

  function notes(s, a, b, cmp) {
    const out = [];
    const ma = cmp.meta.a, mb = cmp.meta.b;
    if (rootOf(s, a) !== rootOf(s, b)) out.push(`Run ${b.n} is not recorded as a version of run ${a.n}'s file. Findings are still matched by check and place.`);
    if (ma.country && mb.country && ma.country !== mb.country) out.push(`Run ${a.n} was checked for ${esc(countryName(a))}, run ${b.n} for ${esc(countryName(b))}. Some checks depend on the country.`);
    if (ma.version && mb.version && ma.version !== mb.version) out.push(`Run ${a.n} is pain.001.001.${esc(ma.version)}, run ${b.n} pain.001.001.${esc(mb.version)}. Schema findings of the two versions often differ.`);
    for (const [r, m] of [[a, ma], [b, mb]]) {
      if (m.stopped) out.push(`Run ${r.n} stopped at the first module, so most checks did not run there. Their findings are listed under “Not compared”.`);
      else if (m.skipped && m.skipped.length) out.push(`Some checks could not run in run ${r.n}. Their findings are listed under “Not compared”.`);
    }
    if (cmp.meta.byPosition) out.push(`${plural(cmp.meta.byPosition, 'finding')} matched by position, because the PmtInfId or EndToEndId at that place changed or could not be read.`);
    return out.length ? `<div class="cmp-notes">${out.map(t => `<p>${ic('info', 18)}<span>${t}</span></p>`).join('')}</div>` : '';
  }
  const countryName = r => (r.result && r.result.countryName) || r.country || '';

  function tiles(cmp) {
    const t = (k, label, cls) => {
      const n = cmp.counts[k], gs = cmp[k].length;
      return `<button class="cmp-tile ${cls}" data-act="cmp-jump" data-k="${k}" data-fid="cj-${k}"${n ? '' : ' disabled'}><span>${label}</span><b>${n.toLocaleString('en-US')}</b><small>${n ? `${n === 1 ? 'place' : 'places'} in ${plural(gs, 'check')}` : 'none'}</small></button>`;
    };
    return `<div class="cmp-tiles">${t('resolved', 'Resolved', 'res')}${t('open', 'Still open', 'open')}${t('new', 'New', 'new')}</div>`;
  }

  // the other lists of the same check, for the line under the title
  function crossOf(cmp) {
    const m = new Map();
    for (const k of ['resolved', 'open', 'new']) for (const gr of cmp[k]) {
      let e = m.get(gr.ck);
      if (!e) m.set(gr.ck, e = { resolved: 0, open: 0, new: 0 });
      e[k] += gr.count;
    }
    return m;
  }
  function subline(k, gr, cross, a, b) {
    const e = cross.get(gr.ck) || {}, parts = [LEVEL[gr.level] || ''];
    if (k === 'resolved' && e.open) parts.push(`still open at ${plural(e.open, 'place')}`);
    if (k === 'resolved' && e.new) parts.push(`new at ${plural(e.new, 'other place')} in run ${b.n}`);
    if (k === 'open' && e.resolved) parts.push(`resolved at ${plural(e.resolved, 'place')}`);
    if (k === 'open' && e.new) parts.push(`new at ${plural(e.new, 'place')}`);
    if (k === 'open' && gr.was) parts.push(`severity was ${SEV[gr.was].w.toLowerCase()} in run ${a.n}`);
    if (k === 'open' && gr.changed) parts.push(`severity changed at ${plural(gr.changed, 'place')}`);
    if (k === 'new' && e.resolved) parts.push(`resolved at ${plural(e.resolved, 'other place')} of run ${a.n}`);
    if (k === 'new' && e.open) parts.push(`still open at ${plural(e.open, 'place')}`);
    if (k === 'skipped') parts.push(gr.run === 'a' ? `found in run ${a.n}, not checked in run ${b.n}` : `found in run ${b.n}, not checked in run ${a.n}`);
    const t = parts.filter(Boolean).join(' · ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function places(k, gr, v, id, key, a, b) {
    const all = v.all.has(key), shown = all ? gr.items : gr.items.slice(0, FIRST);
    const two = k === 'open';
    const runN = k === 'resolved' || (k === 'skipped' && gr.run === 'a') ? a.n : b.n;
    const head = two ? `<th>Where in run ${b.n}</th><th>EndToEndId</th><th class="num">Line in run ${a.n}</th><th class="num">Line in run ${b.n}</th>`
      : `<th>Where in run ${runN}</th><th>EndToEndId</th><th class="num">Line in run ${runN}</th>`;
    const rows = shown.map(i => {
      const moved = two && i.before && i.before.where !== i.where ? `<br><small class="muted">run ${a.n}: ${esc(i.before.where)}</small>` : '';
      const was = two && i.was ? `<br><small class="muted">was ${esc(SEV[i.was].w.toLowerCase())}</small>` : '';
      return two ? `<tr><td>${esc(i.where)}${moved}${gr.was ? '' : was}</td><td class="code">${i.e2e ? esc(i.e2e) : '–'}</td><td class="num">${i.before ? i.before.line || '–' : i.line || '–'}</td><td class="num">${i.line || '–'}</td></tr>`
        : `<tr><td>${esc(i.where)}</td><td class="code">${i.e2e ? esc(i.e2e) : '–'}</td><td class="num">${i.line || '–'}</td></tr>`;
    }).join('');
    const more = shown.length < gr.items.length
      ? `<div class="more"><button class="link" data-act="cmp-all" data-id="${esc(id)}" data-fid="ca-${esc(id)}">Show all ${gr.items.length.toLocaleString('en-US')} places</button></div>` : '';
    return `<div class="fbody"><div class="locs${all ? ' all' : ''}"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>${more}</div></div>`;
  }

  function group(k, gr, i, v, cross, a, b) {
    const id = `${k}:${i}`, key = `${k}|${gr.run || ''}|${gr.ck}`, open = v.open.has(key), S = SEV[gr.severity] || SEV.E;
    const meta = gr.count > 1 ? `<span class="count">${plural(gr.count, 'place')}</span>` : `<span class="wh">${esc(gr.items[0].where)}</span>`;
    return `<li class="find${open ? ' open' : ''}">
      <button class="fhead" data-act="cmp-toggle" data-id="${esc(id)}" aria-expanded="${open}" data-fid="ct-${esc(id)}">
        <span class="sev ${gr.severity}" title="${S.w}">${ic(S.ic, 18)}</span>
        <span class="ftxt"><b>${esc(gr.title)}</b><small>${esc(subline(k, gr, cross, a, b))}</small></span>
        <span class="fmeta">${meta}<span class="rid">Rule ${esc(gr.rule + (gr.part ? '-' + gr.part : ''))}${gr.code ? `, ${esc(gr.code)}` : ''}</span></span>
        ${ic('chev')}
      </button>${open ? places(k, gr, v, id, key, a, b) : ''}</li>`;
  }

  function lists(s) {
    const v = viewState(s), a = runOf(s, v.a), b = runOf(s, v.b);
    const cmp = compareRuns(a, b);
    if (!cmp) return '';
    const cross = crossOf(cmp);
    const sec = (L) => {
      const gs = cmp[L.k];
      return `<section class="cmp-sec ${L.cls}" id="cmp-${L.k}" aria-labelledby="cmp-h-${L.k}">
        <h2 class="sec-h" id="cmp-h-${L.k}">${L.h} <span class="cmp-n">${cmp.counts[L.k].toLocaleString('en-US')}</span></h2>
        <p class="muted">${esc(L.what(a, b))}${gs.length ? ` ${plural(cmp.counts[L.k], 'place')} in ${plural(gs.length, 'check')}.` : ''}</p>
        ${gs.length ? `<ul class="finds">${gs.map((gr, i) => group(L.k, gr, i, v, cross, a, b)).join('')}</ul>` : `<div class="empty plain"><p>${L.none}</p></div>`}
      </section>`;
    };
    const skipped = cmp.skipped.length ? `<section class="cmp-sec skip" id="cmp-skipped" aria-labelledby="cmp-h-skipped">
        <h2 class="sec-h" id="cmp-h-skipped">Not compared <span class="cmp-n">${cmp.counts.skipped.toLocaleString('en-US')}</span></h2>
        <p class="muted">The check did not run in one of the two runs, so these findings are not counted as resolved or new.</p>
        <ul class="finds">${cmp.skipped.map((gr, i) => group('skipped', gr, i, v, cross, a, b)).join('')}</ul></section>` : '';
    return LISTS.map(sec).join('') + skipped;
  }

  function view(s) {
    const list = runsOf(s);
    const back = `<button class="link back" data-act="back" data-fid="c-back">${ic('back', 18)}Back to report</button>`;
    if (list.length < 2) {
      return `<section class="wrap">${back}<h1 tabindex="-1">Compare runs</h1>
        <p class="lead">Only one run so far. Validate a corrected copy or a new version of the file, then compare the two runs here.</p></section>`;
    }
    const v = viewState(s), a = runOf(s, v.a), b = runOf(s, v.b);
    const pick = `<div class="cmp-pick">
        <div class="cmp-sel"><label for="cmp-a">From</label><select id="cmp-a" class="inp" data-fid="c-a">${list.map(r => runOption(r, r.n === v.a)).join('')}</select></div>
        <button class="btn sec sm" data-act="cmp-swap" data-fid="c-swap" title="Swap the two runs">${ic('arrow', 18)}Swap</button>
        <div class="cmp-sel"><label for="cmp-b">To</label><select id="cmp-b" class="inp" data-fid="c-b">${list.map(r => runOption(r, r.n === v.b)).join('')}</select></div>
      </div>`;
    let body;
    if (a === b) body = `<div class="empty plain"><p>Pick two different runs.</p></div>`;
    else {
      const cmp = compareRuns(a, b);
      if (!cmp) {
        const gone = [a, b].filter(r => !TP.compare.keysOfRun(r)).map(r => `run ${r.n}`).join(' and ');
        body = `<div class="empty plain"><p>The details of ${esc(gone)} were not kept, so ${gone.includes(' and ') ? 'they' : 'it'} can't be compared.</p></div>`;
      } else {
        body = `<div class="cmp-runs">${runCard(s, a, 'From')}<span class="cmp-arrow" aria-hidden="true">${ic('arrow', 26)}</span>${runCard(s, b, 'To')}</div>
          ${notes(s, a, b, cmp)}
          ${tiles(cmp)}
          <div id="cmp-lists">${lists(s)}</div>`;
      }
    }
    return `<section class="wrap cmp">${back}
      <h1 tabindex="-1">Compare runs</h1>
      <p class="lead">Findings are matched by check and place: the PmtInfId and EndToEndId of the payment, else its position. So the comparison also works on a new version of the file in which payments were added or removed.</p>
      ${pick}${body}
      <p class="note">Counted per place: a check that fails at 200 places counts 200 times. A finding whose severity changed counts as still open. Runs are kept until the page is reloaded.</p>
    </section>`;
  }

  function mount(s) {
    for (const [id, k] of [['cmp-a', 'a'], ['cmp-b', 'b']]) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => { const v = viewState(s); v[k] = +el.value; v.open = new Set(); v.all = new Set(); TP.app.render(); });
    }
  }

  // redraw only the lists, keeping the focus (as the report's findings)
  // fallback: the element to focus when the focused one is gone (the "Show all" button)
  function renderLists(s, fallback) {
    const box = document.getElementById('cmp-lists');
    if (!box) return TP.app.render();
    const act = document.activeElement, keep = act && act.dataset ? act.dataset.fid : null;
    box.innerHTML = lists(s);
    const el = (keep && box.querySelector(`[data-fid="${keep}"]`)) || (fallback && box.querySelector(`[data-fid="${fallback}"]`));
    if (el) el.focus({ preventScroll: true });
  }
  function groupAt(s, id) {
    const v = viewState(s), [k, i] = String(id).split(':');
    const cmp = compareRuns(runOf(s, v.a), runOf(s, v.b));
    const gr = cmp && cmp[k] && cmp[k][+i];
    return gr ? { k, gr, key: `${k}|${gr.run || ''}|${gr.ck}` } : null;
  }

  /* ---------------- runs strip (report) ---------------- */
  function runStep(r, cur) {
    const n = findingsOf(r);
    return `<span class="runstep${r === cur ? ' cur' : ''}" title="${esc(`${r.fileName || ''} · ${r.source === 'fix' ? 'corrected copy' : 'uploaded'} · checked ${stamp(r.at)}`)}"><small>Run ${r.n}</small>${pill(r)}<b>${plural(n, 'finding')}</b></span>`;
  }

  function runsStrip(s) {
    const list = runsOf(s), cur = currentOf(s);
    if (!cur || list.length < 2) return '';
    const chain = chainOf(s, cur);
    const arrow = `<span class="runarrow" aria-hidden="true">${ic('arrow', 18)}</span>`;
    if (chain.length < 2) {
      const others = list.length - 1;
      return `<div class="runs one"><span class="runstep cur"><small>Run ${cur.n}</small>${pill(cur)}<b>${plural(findingsOf(cur), 'finding')}</b></span>
        <span class="muted">${plural(others, 'other run')} in this session, of other files</span>
        <button class="link" data-act="cmp-open" data-b="${cur.n}" data-fid="rs-cmp">Compare runs</button></div>`;
    }
    const shown = chain.length > 6 ? [chain[0], null, ...chain.slice(-4)] : chain;
    const steps = shown.map(r => (r ? runStep(r, cur) : '<span class="rungap" aria-label="earlier runs">…</span>')).join(arrow);
    const prev = chain[chain.length - 2];
    const cmp = compareRuns(prev, cur);
    let res, cls = 'none', more = '';
    if (!cmp) res = `Run ${prev.n} can no longer be compared`;
    else if (stopped(cur)) { res = `Run ${cur.n} stopped at the first module; the other checks did not run`; cls = 'mid'; }
    else if (cmp.meta.b.skipped && cmp.meta.b.skipped.length) { res = `Some checks could not run in run ${cur.n}, so not all findings can be compared`; cls = 'mid'; }
    else {
      const c = cmp.checks, p = cmp.counts;
      if (c.resolved) { res = `${plural(c.resolved, 'finding')} resolved since run ${prev.n}`; cls = 'ok'; }
      else if (p.resolved) { res = `${plural(p.resolved, 'place')} resolved since run ${prev.n}`; cls = 'ok'; }
      else res = `No findings resolved since run ${prev.n}`;
      if (c.new) res += ` · <span class="nw-new">${plural(c.new, 'new finding')}</span>`;
      else if (p.new) res += ` · <span class="nw-new">new at ${plural(p.new, 'place')}</span>`;
      const gone = cmp.resolved.filter(gr => !cmp.open.some(o => o.ck === gr.ck) && !cmp.new.some(o => o.ck === gr.ck));
      if (gone.length) {
        more = `<details><summary>${ic('chev', 18)}Show what was resolved</summary><ul class="reslist">${gone.map(gr => {
          const S = SEV[gr.severity] || SEV.E;
          return `<li><span class="sev ${gr.severity} sm" title="${S.w}">${ic(S.ic, 13)}</span><span>${esc(gr.title)}${gr.count > 1 ? ` <span class="muted">(${plural(gr.count, 'place')})</span>` : ''}</span><small>Rule ${esc(gr.rule + (gr.part ? '-' + gr.part : ''))}</small></li>`;
        }).join('')}</ul></details>`;
      }
    }
    return `<div class="runs" role="group" aria-label="Runs of this file">${steps}
      <span class="res ${cls}">${res}</span>
      <button class="link" data-act="cmp-open" data-a="${prev.n}" data-b="${cur.n}" data-fid="rs-cmp">See the comparison</button>
      ${more}</div>`;
  }

  /* ---------------- registration ---------------- */
  TP.ui.screens = TP.ui.screens || {};
  TP.ui.actions = TP.ui.actions || {};
  TP.ui.screens.compare = {
    view, mount, nav: 'start', hash: '#compare',
    title: () => 'Compare runs',
    needs: s => runsOf(s).length >= 2
  };
  Object.assign(TP.ui.actions, {
    // from the report: d.a and d.b (run numbers, optional)
    'cmp-open': (d, s) => {
      const v = viewState(s);
      if (d.b && runOf(s, +d.b)) v.b = +d.b;
      if (d.a && runOf(s, +d.a)) v.a = +d.a;
      else if (v.a === v.b) { const f = defaultFrom(s, runOf(s, v.b)); if (f) v.a = f.n; }
      v.open = new Set(); v.all = new Set();
      TP.app.go('compare');
    },
    'cmp-swap': (d, s) => { const v = viewState(s); [v.a, v.b] = [v.b, v.a]; v.open = new Set(); v.all = new Set(); TP.app.render(); },
    'cmp-toggle': (d, s) => { const x = groupAt(s, d.id); if (!x) return; const o = viewState(s).open; o.has(x.key) ? o.delete(x.key) : o.add(x.key); renderLists(s); },
    'cmp-all': (d, s) => { const x = groupAt(s, d.id); if (!x) return; viewState(s).all.add(x.key); renderLists(s, 'ct-' + d.id); },
    'cmp-jump': d => { const el = document.getElementById('cmp-' + d.k); if (el) el.scrollIntoView({ block: 'start' }); }
  });

  TP.ui.compare = { view, runsStrip, chainOf, compareRuns };
})(typeof self !== 'undefined' ? self : globalThis);
