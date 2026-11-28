/*
 * Testing Portal – About: version, limits, settings, third-party notices,
 * and the links to the technical check and to the Catalogue screen, which
 * lists every check (js/ui/catalogue.js; before 0.4.1-m3 a table on this page).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const { ic, esc, dateLabel } = TP.ui.h;

  const LIMITS = [
    'A temporary tool: static files that run in the browser. The production Testing Portal (Angular and Java) replaces it.',
    'The rules are a draft from the validation catalogue. Severities and reason codes are proposals until confirmed against CMIplus.',
    'The country rule packs are empty for now. Every country gets the generic ISO rules; accepted versions are .03 and .09 everywhere until confirmed.',
    'No checks against bank systems: no BIC directory (BIC format only), no account, funds, entitlement or sanctions checks.',
    'ACTC means the file passed these technical checks. It does not mean that CMIplus will process it.',
    'No login, no audit trail, no statistics. Nothing is stored or sent; the file stays in this browser.',
    'Files up to 20 MB. A file without line breaks is shown on one line in the XML viewer; lines and columns of the findings are still correct.',
    'After a structural XSD error the file is checked again, so later errors are still found; very many structural errors in one element may hide some until the first are fixed.',
    'Checks that depend on the CMIplus guideline (stage 6 and some limits) use the values in the settings. Their defaults are the examples of the catalogue until the guideline is confirmed.',
    'Fix the errors proposes only what config/fixes.json lists. Structural errors, amounts, IBANs and BICs are never guessed. The corrected file is a reference copy, not for payments; sample values must be replaced with real data.',
    'Runs and email drafts last until the page is reloaded; only the last 3 runs keep their file. The email is not sent from here: copy it into your email program and attach the files by hand.'
  ];

  /* ---------------- settings ---------------- */
  const UNITS = { y: ['year', 'years'], mo: ['month', 'months'], d: ['day', 'days'], h: ['hour', 'hours'], mi: ['minute', 'minutes'], s: ['second', 'seconds'] };
  function duration(v) {
    if (v == null) return 'Not checked';
    const d = TP.functions.parseDuration(v);
    if (!d) return String(v);
    const parts = Object.keys(UNITS).filter(k => d[k]).map(k => `${d[k]} ${UNITS[k][d[k] === 1 ? 0 : 1]}`);
    return `${parts.join(' ') || '0'} (${v})`;
  }
  const amount = v => (v == null ? 'No limit' : String(v));
  const count = v => (v == null ? 'No limit' : Number(v).toLocaleString('en-US'));
  const SEV_WORD = { E: 'error', W: 'warning', I: 'hint' };

  function settingsRows(st) {
    const L = st.limits || {};
    return [
      ['Creation date in the future', `Up to ${duration(L.creationDateFutureTolerance)} ahead`],
      ['Maximum age of a file', duration(L.creationDateMaxAge)],
      ['Execution date at most', `${duration(L.executionDateMaxAhead)} ahead`],
      ['SEPA amount', `${amount(L.sepaMinAmount)} to ${amount(L.sepaMaxAmount)}`],
      ['SEPA Instant maximum', amount(L.instantMaxAmount)],
      ['Blocks per file', count(L.maxBlocksPerFile)],
      ['Transactions per file / per block', `${count(L.maxTransactionsPerFile)} / ${count(L.maxTransactionsPerBlock)}`]
    ];
  }
  function checkChanges(st) {
    return Object.entries(st.checks || {}).filter(([k]) => k[0] !== '_').map(([k, v]) => {
      const what = [];
      if (v.enabled === false) what.push('switched off');
      if (v.severity) what.push(`reported as ${SEV_WORD[v.severity] || v.severity}`);
      if (v.code !== undefined) what.push(`reason code ${v.code || 'none'}`);
      return `${k}: ${what.join(', ') || 'unchanged'}`;
    });
  }
  function countryOverrides(e) {
    return Object.entries(e.countries || {}).filter(([, c]) => c && c.settings && Object.keys(c.settings).some(k => k[0] !== '_')).map(([cc]) => cc);
  }
  function vSettings(e) {
    const st = e.settings || {}, src = e.settingsSource || { kind: 'built-in' };
    const changes = checkChanges(st), over = countryOverrides(e);
    return `<div class="panel wide" id="settings-panel">
      <h2>Settings</h2>
      <p class="muted">Limits, codes and the severity of checks come from the settings (<span class="code">config/settings.json</span>, and per country <span class="code">config/countries/&lt;CC&gt;.json</span>), so they can be changed without changing a rule.</p>
      <p class="setsrc">${src.kind === 'session'
        ? `${ic('info', 18)}<span>In use: <b>${esc(src.name)}</b>, loaded for this session over the built-in settings. Reloading the page goes back to the built-in settings.</span>`
        : `<span>In use: the built-in settings of this version.</span>`}</p>
      <dl class="kv2">${settingsRows(st).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
        <div class="full"><dt>Checks changed by the settings</dt><dd>${changes.length ? changes.map(esc).join('<br>') : 'None'}</dd></div>
        <div class="full"><dt>Countries with their own settings</dt><dd>${over.length ? esc(over.join(', ')) : 'None yet'}</dd></div>
      </dl>
      <div class="factions">
        <button class="btn sec sm" data-act="settings-dl" data-fid="settings-dl">${ic('down', 18)}Download the settings in use</button>
        <button class="btn sec sm" data-act="settings-pick" data-fid="settings-pick">Load a settings file for this session</button>
        ${src.kind === 'session' ? '<button class="btn sec sm" data-act="settings-reset" data-fid="settings-reset">Use the built-in settings</button>' : ''}
        <input type="file" id="settings-in" accept=".json,application/json" hidden>
      </div>
      <p class="muted" id="settings-msg" role="status" aria-live="polite"></p>
      <details class="setjson"><summary>${ic('chev', 18)}Show all settings</summary><pre class="code">${esc(JSON.stringify(st, null, 2))}</pre></details>
    </div>`;
  }

  async function loadSettingsFile(file) {
    const msg = text => { const m = document.getElementById('settings-msg'); if (m) m.textContent = text; };
    let obj;
    try { obj = JSON.parse(await file.text()); }
    catch (err) { msg(`${file.name} is not valid JSON: ${err.message}`); return; }
    const r = TP.validation.useSettings(obj, file.name);
    if (!r.ok) { msg(`${file.name} was not loaded. ${r.problems.join(' ')}`); return; }
    TP.ui.h.toast(`Settings loaded from ${file.name}`);
    rerender(r.notes.length ? `Loaded. ${r.notes.join(' ')}` : 'Loaded. The next validation uses these settings.');
  }
  function rerender(text) {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    panel.outerHTML = vSettings(TP.validation.engines);
    const m = document.getElementById('settings-msg'); if (m && text) m.textContent = text;
  }
  async function downloadSettings() {
    const e = TP.validation.engines;
    const name = e.settingsSource && e.settingsSource.kind === 'session' ? 'settings-session.json' : 'settings.json';
    try { await TP.platform.download(name, JSON.stringify(e.settings, null, 2) + '\n', 'application/json;charset=utf-8'); TP.ui.h.toast(`Saved ${name}`); }
    catch (err) { TP.ui.h.toast(`Could not save: ${err.message || err}`); }
  }

  function render(s) {
    const e = TP.validation.engines, cfg = e.config || {};
    return `<section class="wrap">
      <h1 tabindex="-1">About the Testing Portal</h1>
      <p class="lead">A temporary tool for the service desk: it checks corporate pain.001 files before they go to CMIplus.</p>
      <div class="about">
        <div class="panel">
          <h2>This version</h2>
          <dl class="kv2">
            <div><dt>Version</dt><dd>${esc(cfg.version)}</dd></div>
            <div><dt>Milestone</dt><dd>${esc(cfg.milestone)}</dd></div>
            <div><dt>Rules as of</dt><dd>${esc(dateLabel(cfg.rulesDate))}</dd></div>
            <div><dt>Rule status</dt><dd>${esc(cfg.rulesStatus === 'draft' ? 'Draft, not yet confirmed' : cfg.rulesStatus)}</dd></div>
            <div><dt>Runs as</dt><dd>${esc(TP.platform.modeLabel())}</dd></div>
            <div><dt>Message versions</dt><dd>pain.001.001.03 (ISO 2009), pain.001.001.09 (ISO 2019)</dd></div>
            <div><dt>Rule files</dt><dd>${e.manifest ? e.manifest.ruleSets.length : '–'} compiled (${e.manifest ? new Set(e.manifest.ruleSets.map(x => x.source)).size : '–'} sources, one variant per version)</dd></div>
            <div><dt>Countries</dt><dd>${esc((cfg.countries || []).join(', '))}</dd></div>
          </dl>
          <div class="factions"><a class="btn sec sm" href="#check" data-fid="go-check">${ic('check', 18)}Open the technical check</a></div>
        </div>
        <div class="panel">
          <h2>Limits</h2>
          <ul>${LIMITS.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        </div>
        ${vSettings(e)}
        <div class="panel wide">
          <h2>What is checked</h2>
          <p>Every check of the validation catalogue, what this version does with it and where it is built, is on the Catalogue page.</p>
          <div class="factions"><a class="btn sec sm" href="#catalogue" data-fid="go-catalogue">${ic('table', 18)}Open the catalogue</a></div>
        </div>
        <div class="panel wide">
          <h2>Third-party software</h2>
          <p class="muted">The tool includes SaxonJS (Saxonica, unchanged), libxml2 compiled to WebAssembly (libxml2-wasm), saxes and the Figtree font. Their licences:</p>
          <textarea class="notices" id="notices" readonly aria-label="Third-party licences">Loading…</textarea>
        </div>
      </div>
    </section>`;
  }

  async function mount() {
    const box = document.getElementById('notices');
    if (!box) return;
    const tag = document.getElementById('third-party-notices');
    if (tag) { box.value = tag.textContent.trim(); return; }
    const files = ['lib/saxon/LICENSE.txt', 'lib/libxml2/LICENSE', 'lib/libxml2/LICENSE.libxml2', 'lib/saxes/LICENSE.txt', 'lib/saxes/LICENSE.xmlchars', 'fonts/OFL-Figtree.txt'];
    const parts = [];
    for (const f of files) { try { parts.push(`===== ${f} =====\n${await TP.assets.text(f)}`); } catch (err) { parts.push(`===== ${f} =====\n(not found)`); } }
    box.value = parts.join('\n\n');
  }

  TP.ui.about = { render, mount, loadSettingsFile, downloadSettings, rerender, duration };
})(typeof self !== 'undefined' ? self : globalThis);
