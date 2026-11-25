/*
 * Testing Portal – the app: state, screens and events.
 *
 * Screens (address after #):  start (none) · run · report (#report)
 *                              · XML viewer (#xml) · About (#about) · technical check (#check)
 * Each screen is a file in js/ui/ with render(state) and, if needed, mount(state).
 * All clicks go through one listener and the data-act attribute of the element.
 */
(function (g) {
  'use strict';
  const TP = g.TP;
  const { $, toast, dateLabel, esc } = TP.ui.h;

  const freshView = () => ({ sev: 'all', mod: 'all', tx: null, q: '', open: new Set(), locSel: {}, locPage: {}, txPage: {}, xv: { g: null, i: 0 } });
  // session: the runs of this browser session (M3, js/fix/session.js); fix: the open fix screen
  const state = { screen: 'start', file: null, country: null, engines: 'starting', engineError: null, result: null, lines: null, view: freshView(), busy: false,
    session: TP.session ? TP.session.create() : { runs: [], current: null }, fix: null };
  try { const c = localStorage.getItem('tp.country'); if (c) state.country = c; } catch (e) { /* storage not available */ }

  const SCREENS = {
    start: { view: s => TP.ui.start.render(s), nav: 'start' },
    run: { view: s => TP.ui.run.render(s), nav: 'start' },
    report: { view: s => TP.ui.report.render(s), mount: s => TP.ui.report.renderFind(s), nav: 'start', title: s => `Report: ${s.result.fileName}` },
    xml: { view: s => TP.ui.xml.render(s), mount: s => TP.ui.xml.mount(s), nav: 'start', title: s => `XML: ${s.result.fileName}` },
    about: { view: s => TP.ui.about.render(s), mount: () => TP.ui.about.mount(), nav: 'about', title: () => 'About' },
    check: { view: () => TP.ui.technicalCheck.render(), mount: () => TP.ui.technicalCheck.mount(), nav: 'about', title: () => 'Technical check' }
  };
  /*
   * Screens added by other files (M3: fix, compare, email): TP.ui.screens.<name> =
   * { view(state), mount?(state), nav, title?(state), hash: '#name', needs?(state) → true when it can be shown }.
   * Their buttons: TP.ui.actions[<data-act>] = (dataset, state) => …
   */
  TP.ui.screens = TP.ui.screens || {};
  TP.ui.actions = TP.ui.actions || {};
  const screenOf = name => SCREENS[name] || TP.ui.screens[name];

  function render(screenChanged) {
    const sc = screenOf(state.screen);
    const fid = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fid : null;
    $('#app').innerHTML = sc.view(state);
    document.title = `Testing Portal${sc.title ? ' – ' + sc.title(state) : ''}`;
    for (const a of document.querySelectorAll('#apphead nav a')) {
      if (a.dataset.nav === sc.nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    if (sc.mount) sc.mount(state);
    if (screenChanged) { window.scrollTo(0, 0); const h = $('#app h1'); if (h) h.focus({ preventScroll: true }); }
    else if (fid) { const el = document.querySelector(`[data-fid="${fid}"]`); if (el) el.focus({ preventScroll: true }); }
  }

  /* ---------------- navigation ---------------- */
  const HASH = { start: '', report: '#report', xml: '#xml', about: '#about', check: '#check' };
  function go(screen) {
    state.screen = screen;
    const h = HASH[screen] != null ? HASH[screen] : (TP.ui.screens[screen] || {}).hash;
    if (h != null && location.hash !== h) {
      if (h === '') history.pushState(null, '', location.pathname + location.search);
      else location.hash = h; // fires hashchange, which renders
      if (h !== '') return;
    }
    render(true);
  }
  function fromHash() {
    if (state.busy) return;
    const h = location.hash.replace(/^#\/?/, '');
    if (h === 'about') state.screen = 'about';
    else if (h === 'check') state.screen = 'check';
    else if (h === 'report' && state.result) state.screen = 'report';
    else if (h === 'xml' && state.result && state.lines) state.screen = 'xml';
    else if (h === 'report' || h === 'xml') { state.screen = state.result ? 'report' : 'start'; history.replaceState(null, '', state.result ? '#report' : location.pathname + location.search); }
    else {
      const extra = Object.entries(TP.ui.screens).find(([, sc]) => sc.hash === '#' + h);
      // a screen whose state is gone (Back to #fix after a new run): it may rebuild it from the current run
      if (extra && extra[1].needs && !extra[1].needs(state) && extra[1].restore) { try { extra[1].restore(state); } catch (e) { /* falls back below */ } }
      if (extra && (!extra[1].needs || extra[1].needs(state))) state.screen = extra[0];
      else {
        // nothing to show at this address: the report of the current run, else the start, with the address to match
        state.screen = state.result ? 'report' : 'start';
        if (h) history.replaceState(null, '', state.screen === 'report' ? '#report' : location.pathname + location.search);
      }
    }
    render(true);
  }
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('popstate', fromHash);

  /* ---------------- file and validation ---------------- */
  async function chooseFile(file) {
    if (!file || state.busy) return;
    try {
      state.file = await TP.ui.start.readFile(file);
    } catch (err) {
      toast(`The file could not be read: ${err.message || err}`, true);
      return;
    }
    if (state.screen !== 'start') go('start'); else render();
  }

  const hasBom = b => b && b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;

  /*
   * One run of the pipeline, shown on the run screen, then the report. meta: what the
   * session records with the run ({ source: 'upload' | 'fix', parent, changes, skipped, bom }).
   */
  async function runPipeline(bytes, fileName, country, meta) {
    if (state.engines !== 'ready' || state.busy) return;
    state.busy = true;
    state.screen = 'run';
    render(true);
    TP.ui.run.reset();
    let r;
    try {
      r = await TP.validation.validate({ bytes, fileName, country, pin: meta.pin || null }, TP.ui.run.step);
    } catch (err) {
      state.busy = false;
      toast(`The validation failed: ${err.message || err}`, true);
      state.screen = meta.source === 'fix' && state.result ? 'report' : 'start';
      render(true);
      return;
    }
    TP.ui.run.finish(r);
    if (TP.session) {
      const parent = meta.parent != null ? meta.parent : (TP.session.parentFor(state.session, r, fileName) || {}).n;
      TP.session.add(state.session, r, { ...meta, parent: parent != null ? parent : null, text: r.text });
    }
    state.result = r;
    state.fix = null;
    state.lines = r.text ? r.text.split('\n').map(l => (l.endsWith('\r') ? l.slice(0, -1) : l)) : null;
    state.view = freshView();
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => { state.busy = false; go('report'); }, calm ? 200 : 900);
  }

  async function validate() {
    if (!state.file || !state.country) return;
    return runPipeline(state.file.bytes, state.file.name, state.country, { source: 'upload', bom: hasBom(state.file.bytes) });
  }

  /* the corrected text of the fix screen, validated as the next run of the same file */
  async function revalidate({ text, changes, skipped }) {
    const S = TP.session, cur = S.byN(state.session, state.session.current);
    if (!cur) return;
    const name = S.correctedName(state.session, { ...cur, source: 'fix', parent: cur.n, n: -1 });
    const bytes = new TextEncoder().encode(text);
    // the same settings as the run that was fixed, even if a settings file was loaded since (spec 3.4)
    const pin = cur.result ? { settings: cur.result.settings, settingsSource: cur.result.settingsSource } : null;
    return runPipeline(bytes, name, cur.country, { source: 'fix', parent: cur.n, changes, skipped, bom: cur.bom, pin });
  }

  /* the file of the current run (after a fix: the corrected file) */
  async function downloadCorrected() {
    const S = TP.session, cur = S.byN(state.session, state.session.current);
    if (!cur || cur.text == null) { toast('The corrected file is no longer available: validate it again.', true); return; }
    if (!(await TP.platform.canDownload('xml'))) { toast('XML files cannot be downloaded in this view: open the offline file to get the corrected file.', true); return; }
    try { await TP.platform.download(cur.fileName, S.corrected(cur), 'application/xml'); toast(`Saved ${cur.fileName}`); }
    catch (err) { toast(`Could not save: ${err.message || err}`, true); }
  }
  if (TP.fix) TP.fix.downloadCorrected = () => downloadCorrected();

  /* ---------------- events ---------------- */
  const ACTIONS = {
    pick: () => { const i = $('#file-in'); if (i) i.click(); },
    country: d => { state.country = d.c; try { localStorage.setItem('tp.country', d.c); } catch (e) { /* ignore */ } render(); },
    validate: () => validate(),
    again: () => { state.file = null; go('start'); },
    'dl-report': () => TP.ui.exports.downloadReport(state.result, state.session),
    'dl-csv': () => TP.ui.exports.downloadCsv(state.result, state.session),
    'dl-summary': () => TP.ui.exports.downloadSummary(state.result, state.session),
    'dl-xml': () => downloadCorrected(),
    toggle: d => { const o = state.view.open; o.has(d.g) ? o.delete(d.g) : o.add(d.g); TP.ui.report.renderFind(state); },
    expand: d => { const vis = TP.ui.report.visibleGroups(state); for (const v of vis) d.all ? state.view.open.delete(v.gr.id) : state.view.open.add(v.gr.id); TP.ui.report.renderFind(state); },
    loc: d => { state.view.locSel[d.g] = +d.i; TP.ui.report.renderFind(state); const t = document.querySelector(`[data-fid="t-${d.g}"]`); if (t) t.focus({ preventScroll: true }); },
    locmore: d => { state.view.locPage[d.g] = (state.view.locPage[d.g] || 100) + 100; TP.ui.report.renderFind(state); },
    fsev: d => { state.view.sev = d.k; TP.ui.report.renderFind(state); },
    fmod: d => { state.view.mod = state.view.mod === d.k ? 'all' : d.k; TP.ui.report.renderFind(state); },
    txf: d => {
      Object.assign(state.view, { tx: { b: +d.b, t: +d.t }, sev: 'all', mod: 'all', q: '', locSel: {} });
      const q = $('#fq'); if (q) q.value = '';
      TP.ui.report.renderFind(state);
      const h = $('#findings-h'); if (h) h.scrollIntoView({ block: 'start' });
      const c = $('[data-act=cleartx]'); if (c) c.focus({ preventScroll: true });
    },
    cleartx: () => { state.view.tx = null; TP.ui.report.renderFind(state); },
    txmore: d => { state.view.txPage[d.b] = (state.view.txPage[d.b] || 500) + 500; TP.ui.report.fillTxs(state, +d.b); },
    xml: d => { if (d.g) state.view.xv = { g: d.g, i: +d.i || 0 }; go('xml'); },
    xv: d => { state.view.xv = { g: d.g, i: +d.i }; TP.ui.xml.go(state); },
    back: () => go('report'),
    'settings-pick': () => { const i = $('#settings-in'); if (i) i.click(); },
    'settings-dl': () => TP.ui.about.downloadSettings(),
    'settings-reset': () => { TP.validation.builtInSettings(); TP.ui.about.rerender('Back to the built-in settings.'); TP.ui.h.toast('Built-in settings in use'); }
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const fn = ACTIONS[b.dataset.act] || TP.ui.actions[b.dataset.act];
    if (fn) { e.preventDefault(); fn(b.dataset, state); }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'file-in' && e.target.files[0]) { chooseFile(e.target.files[0]); e.target.value = ''; }
    if (e.target.id === 'settings-in' && e.target.files[0]) { TP.ui.about.loadSettingsFile(e.target.files[0]); e.target.value = ''; }
  });
  let qTimer = null;
  document.addEventListener('input', e => {
    if (e.target.id !== 'fq') return;
    state.view.q = e.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => TP.ui.report.renderFind(state), state.result && state.result.items.length > 2000 ? 250 : 80);
  });
  // the transactions of a block are put in the page only when it is opened
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (d.tagName === 'DETAILS' && d.dataset.block && d.open && !d.dataset.filled) { d.dataset.filled = '1'; TP.ui.report.fillTxs(state, +d.dataset.block); }
  }, true);
  // dropping a file anywhere on the start screen chooses it; elsewhere the browser must not open it
  let dragDepth = 0;
  document.addEventListener('dragenter', e => { if (state.screen === 'start') { dragDepth++; document.body.classList.add('dragging'); } e.preventDefault(); });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && (state.screen === 'start' || state.screen === 'report')) chooseFile(f);
  });

  /* ---------------- start ---------------- */
  function header() {
    const cfg = TP.validation.engines.config || {};
    const line = $('#toolline');
    if (line && cfg.version) line.textContent = `Temporary tool · version ${cfg.version} · rules as of ${dateLabel(cfg.rulesDate)} · ${cfg.rulesStatus === 'draft' ? 'draft rules' : esc(cfg.rulesStatus)}`;
  }

  let configShown = false;
  const onInitStep = () => { if (configShown) return; configShown = true; header(); if (state.screen === 'start') render(); };
  const enginesReady = TP.validation.init(onInitStep).then(info => {
    if (TP.validation.engines.error) throw new Error(TP.validation.engines.error);
    state.engines = 'ready';
    return info;
  }).catch(err => {
    state.engines = 'failed';
    state.engineError = String(err.message || err);
    throw err;
  }).finally(() => {
    header();
    if (state.country && !(TP.validation.engines.countries || {})[state.country]) state.country = null;
    if (state.screen === 'start') render();
  });
  enginesReady.catch(() => { /* shown on the start screen */ });

  TP.app = { state, enginesReady, go, render, revalidate, downloadCorrected };
  const boot = () => fromHash();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof self !== 'undefined' ? self : globalThis);
