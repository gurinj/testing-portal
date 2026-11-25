/*
 * Testing Portal – run screen: one card per validation module, updated with
 * the real progress of the pipeline (TP.validation.validate onStep).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const { esc, plural, SEV, $, tone } = TP.ui.h;

  function render(s) {
    const mods = TP.validation.engines.catalogue.modules;
    return `<section class="wrap">
      <h1 tabindex="-1">Validating ${esc(s.file.name)}</h1>
      <p class="lead">Country: ${esc((TP.validation.engines.countries[s.country] || {}).name || s.country)}${s.file.detected && s.file.detected.ok ? ` · ${esc(s.file.detected.label)}` : ''}</p>
      <div class="track" aria-hidden="true"><div class="line"></div><div class="fill" id="fill"></div><div class="token" id="token"></div><div class="gate" id="gate"></div></div>
      <ol class="mods">
        ${mods.map(m => `<li class="mod wait" id="mod-${m.id}"><b>${esc(m.name)}</b><span>${esc(m.label)}</span><div class="ms">Waiting</div></li>`).join('')}
      </ol>
      <div class="runreport" aria-live="polite">
        <div><h2>Findings report</h2><p class="muted" id="runMsg">Every check adds its findings to one report.</p></div>
        <div class="tally">
          <span class="fchip E"><b id="tE">0</b> <span id="lE">Errors</span></span>
          <span class="fchip W"><b id="tW">0</b> <span id="lW">Warnings</span></span>
          <span class="fchip I"><b id="tI">0</b> <span id="lI">Hints</span></span>
        </div>
        <span class="stpill idle" id="runStatus">Status</span>
      </div>
    </section>`;
  }

  const LABEL = { running: 'Checking', ok: 'No findings', skipped: 'Not run', planned: 'No rules yet', failed: 'Stopped the run' };
  const done = new Set();
  function reset() { done.clear(); }

  function step(module, state, info) {
    const card = document.getElementById('mod-' + module);
    if (!card) return;
    card.className = 'mod';
    let text = LABEL[state] || state;
    if (state === 'running') card.classList.add('busy');
    else if (state === 'ok') card.classList.add('ok');
    else if (state === 'findings') {
      const c = (info && info.counts) || null;
      card.classList.add(c ? (c.E ? 'bad' : c.W ? 'mid' : 'inf') : 'bad');
      text = plural(info && info.n || 0, 'finding');
    } else if (state === 'failed') { card.classList.add(module === 'intake' ? 'bad' : 'mid'); if (module !== 'intake') text = 'Could not run'; }
    else if (state === 'skipped') card.classList.add('skip');
    else if (state === 'planned') card.classList.add('plan');
    card.querySelector('.ms').textContent = text;
    if (module === 'intake' && state !== 'running') { const gate = $('#gate'); if (gate) gate.classList.add(state === 'failed' ? 'closed' : 'open'); }
    if (state !== 'running') done.add(module);
    const mods = TP.validation.engines.catalogue.modules;
    const pos = Math.min(mods.length, done.size);
    const p = Math.max(.5, pos === mods.length ? mods.length - .5 : pos + .5) / mods.length * 100;
    const fill = $('#fill'), token = $('#token');
    if (fill) fill.style.width = p + '%';
    if (token) token.style.left = p + '%';
  }

  function finish(result) {
    const c = result.counts;
    for (const k of ['E', 'W', 'I']) {
      const t = $('#t' + k), l = $('#l' + k);
      if (t) t.textContent = c[k];
      if (l) l.textContent = c[k] === 1 ? SEV[k].w : SEV[k].ws;
    }
    const p = $('#runStatus');
    if (p) { p.textContent = result.status; p.className = `stpill ${tone(result.status)}`; }
    const m = $('#runMsg');
    if (m) m.textContent = result.stopped ? 'Stopped at the first module, the other checks can’t run.' : 'All findings collected in one report.';
  }

  TP.ui.run = { render, step, finish, reset };
})(typeof self !== 'undefined' ? self : globalThis);
