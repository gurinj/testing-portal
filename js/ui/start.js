/*
 * Testing Portal – start screen: choose the file and the country.
 * The format is detected as soon as the file is chosen (stages 0 and 1 on
 * the file), so a wrong file is seen before the validation starts.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const { ic, esc, mb } = TP.ui.h;

  function detectLine(f) {
    if (!f || !f.detected) return '';
    const d = f.detected;
    return `<p class="detect${d.ok ? '' : ' bad'}">${ic(d.ok ? 'check' : 'warn', 18)}<span>${d.ok ? `Detected format: <b>${esc(d.label)}</b>` : esc(d.message)}</span></p>`;
  }

  function render(s) {
    const f = s.file, cfg = TP.validation.engines.config || {}, countries = TP.validation.engines.countries || {};
    const ready = f && s.country && s.engines === 'ready';
    const codes = cfg.countries || Object.keys(countries);
    return `<section class="wrap">
      <h1 tabindex="-1">Validate a payment file</h1>
      <p class="lead">Check a customer’s pain.001 file before it goes to CMIplus. You get all findings at once.</p>
      <div class="startgrid">
        <div class="panel">
          <h2><span class="n">1</span>Payment file</h2>
          <input type="file" id="file-in" accept=".xml,text/xml,application/xml" hidden>
          ${f ? `<div class="chosen" id="drop">${ic('file', 26)}<div><b>${esc(f.name)}</b><span>${mb(f.size)}</span></div><button class="link" data-act="pick" data-fid="pick">Change file</button></div>${detectLine(f)}`
            : `<button class="drop" id="drop" data-act="pick" data-fid="pick">${ic('up', 30)}<b>Choose or drop an XML file</b><span>pain.001, ISO 2009 (.03) or ISO 2019 (.09), up to ${esc(cfg.maxFileMB || 20)} MB</span></button>`}
        </div>
        <div class="panel">
          <h2><span class="n">2</span>Country the payments are sent to</h2>
          <p class="help">The bank in this country executes the file.</p>
          <div class="ctrys" role="radiogroup" aria-label="Country">
            ${codes.map(c => { const k = countries[c] || { name: c }; const sel = s.country === c;
              return `<button class="ctry${sel ? ' sel' : ''}" role="radio" aria-checked="${sel}" data-act="country" data-c="${c}" data-fid="c-${c}"><b>${c}</b><span>${esc(k.name)}</span><em>Generic rules only</em></button>`; }).join('')}
          </div>
        </div>
      </div>
      <div class="startact">
        <button class="btn pri big" data-act="validate" data-fid="go" ${ready ? '' : 'disabled'}>Validate file ${ic('arrow')}</button>
        <span class="muted" id="start-hint">${s.engines === 'failed' ? '' : s.engines !== 'ready' ? 'Starting the validation engines…' : ready ? '' : 'Choose a file and a country to start.'}</span>
      </div>
      ${s.engines === 'failed' ? `<p class="boot bad">${ic('warn', 18)}The validation engines could not start in this browser: ${esc(s.engineError || '')}. Open About › Technical check for details.</p>` : ''}
      <p class="privacy">${ic('lock', 18)}<span>The file stays in this browser. Nothing is uploaded or sent anywhere. The country rule packs are still empty: every country gets the generic ISO rules for now.</span></p>
    </section>`;
  }

  /* reads the chosen file and detects its format with stages 0 and 1 */
  async function readFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const cfg = TP.validation.engines.config || {};
    const s0 = TP.stages.intake.run({ bytes, maxBytes: (cfg.maxFileMB || 20) * 1048576 });
    let detected;
    if (s0.stop) detected = { ok: false, message: s0.findings[0].message };
    else {
      const s1 = TP.stages.identify.run({ text: s0.text.slice(0, 65536), country: null, countryConfig: null });
      detected = s1.stop ? { ok: false, message: s1.findings[0].message } : { ok: true, version: s1.version, label: s1.label };
    }
    return { name: file.name, size: file.size, bytes, detected };
  }

  TP.ui.start = { render, readFile };
})(typeof self !== 'undefined' ? self : globalThis);
