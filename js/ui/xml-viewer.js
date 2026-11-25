/*
 * Testing Portal – XML viewer.
 * Shows the file with line numbers and marks the lines with a finding.
 * Only the lines in view are in the page (virtual scrolling), so a file
 * with 150,000 lines scrolls as smoothly as a small one.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const { ic, esc, plural, SEV, $ } = TP.ui.h;
  const ROW = 21, OVERSCAN = 40, MAX_LINE = 2000;
  const RANK = { E: 3, W: 2, I: 1 };

  let marks = null, markFor = null;
  // line -> [{ gr, i }] for the current result, computed once
  function markMap(s) {
    if (markFor === s.result) return marks;
    marks = new Map();
    for (const gr of s.result.groups) gr.items.forEach((it, i) => {
      if (!it.line) return;
      let m = marks.get(it.line);
      if (!m) marks.set(it.line, (m = []));
      if (m.length < 20) m.push({ gr, i });
    });
    markFor = s.result;
    return marks;
  }

  function render(s) {
    const r = s.result, n = s.lines.length - (s.lines[s.lines.length - 1] === '' ? 1 : 0);
    const long = s.lines.some(l => l.length > MAX_LINE);
    return `<section class="wrap">
      <button class="link back" data-act="back" data-fid="back">${ic('back', 18)}Back to report</button>
      <h1 tabindex="-1">XML of the file</h1>
      <p class="lead">${esc(r.fileName)}, ${plural(n, 'line')}. ${r.groups.length ? 'Lines with a finding are marked. Choose a finding to jump to it.' : 'This file has no findings.'}</p>
      ${long ? `<p class="note">Some lines are longer than ${MAX_LINE.toLocaleString('en-US')} characters and are cut here. The file probably has no line breaks; the line and column of each finding are still correct.</p>` : ''}
      <div class="xbar"><label>Go to line <input class="inp" id="xgo" type="number" min="1" max="${n}" inputmode="numeric" aria-label="Go to line"></label></div>
      <div class="xv">
        <div class="xcode" id="xcode" tabindex="0" aria-label="XML source, ${n} lines"><div class="xspace" id="xspace" style="height:${n * ROW + 24}px"><div class="xrows" id="xrows"></div></div></div>
        <div class="xside" id="xvside"></div>
      </div>
    </section>`;
  }

  function lineHtml(s, n, cur) {
    const m = markMap(s).get(n);
    let t = s.lines[n - 1];
    let cut = '';
    if (t.length > MAX_LINE) { cut = `<span class="cut"> … ${(t.length - MAX_LINE).toLocaleString('en-US')} more characters</span>`; t = t.slice(0, MAX_LINE); }
    let cls = '', badge = '';
    if (m) {
      const top = m.reduce((a, x) => RANK[x.gr.severity] > RANK[a.gr.severity] ? x : a);
      cls = ` m ${top.gr.severity}`;
      const rules = [...new Set(m.map(x => x.gr.rule))];
      badge = `<button class="xm" data-act="xv" data-g="${top.gr.id}" data-i="${top.i}" title="${esc([...new Set(m.map(x => x.gr.title))].join(' · '))}">${esc(rules.slice(0, 3).join(', '))}${rules.length > 3 ? '…' : ''}</button>`;
    }
    return `<div class="xl${cls}${cur === n ? ' cur' : ''}" style="top:${(n - 1) * ROW + 12}px;position:absolute;left:0;right:0"><i>${n}</i><span class="mc">${badge}</span><code>${esc(t)}</code>${cut}</div>`;
  }

  function paint(s) {
    const box = $('#xcode'), rows = $('#xrows');
    if (!box || !rows) return;
    const n = s.lines.length;
    const first = Math.max(1, Math.floor((box.scrollTop - 12) / ROW) + 1 - OVERSCAN);
    const last = Math.min(n, Math.ceil((box.scrollTop + box.clientHeight) / ROW) + OVERSCAN);
    const cur = currentLine(s);
    let html = '';
    for (let i = first; i <= last; i++) html += lineHtml(s, i, cur);
    rows.innerHTML = html;
  }
  function currentLine(s) {
    const gr = s.result.groups.find(x => x.id === s.view.xv.g);
    return gr ? gr.items[s.view.xv.i] && gr.items[s.view.xv.i].line : null;
  }

  function vSide(s) {
    const gs = s.result.groups.filter(gr => gr.items.some(it => it.line));
    if (!gs.length) return '<p class="muted pad">No findings with a line in this file.</p>';
    return '<h2>Findings</h2>' + gs.map(gr => {
      const S = SEV[gr.severity], on = s.view.xv.g === gr.id, n = gr.items.length, i = on ? s.view.xv.i : 0;
      return `<div class="xf${on ? ' on' : ''}"><button class="xfb" data-act="xv" data-g="${gr.id}" data-i="${on ? (i + 1) % n : 0}" data-fid="xv-${gr.id}"><span class="sev ${gr.severity} sm">${ic(S.ic, 13)}</span><span><b>${esc(gr.title)}</b><small>${n > 1 ? (on ? `${(i + 1).toLocaleString('en-US')} of ${plural(n, 'place')}, line ${gr.items[i].line}` : plural(n, 'place')) : `Line ${gr.items[0].line}`}</small></span></button>
        ${on && n > 1 ? `<span class="step"><button data-act="xv" data-g="${gr.id}" data-i="${(i - 1 + n) % n}" data-fid="xp-${gr.id}" aria-label="Previous place">${ic('back', 16)}</button><button data-act="xv" data-g="${gr.id}" data-i="${(i + 1) % n}" data-fid="xn-${gr.id}" aria-label="Next place"><span class="flip">${ic('back', 16)}</span></button></span>` : ''}</div>`;
    }).join('');
  }

  function scrollToLine(line) {
    const box = $('#xcode');
    if (!box || !line) return;
    box.scrollTop = Math.max(0, (line - 1) * ROW + 12 - box.clientHeight * 0.4);
    box.scrollLeft = 0;
  }

  function go(s) {
    const side = $('#xvside');
    if (!side) return;
    const act = document.activeElement, keep = act && act.dataset && act.closest && act.closest('#xvside') ? act.dataset.fid : null;
    side.innerHTML = vSide(s);
    if (keep) { const el = document.querySelector(`[data-fid="${keep}"]`) || document.querySelector(`[data-fid="xv-${s.view.xv.g}"]`); if (el) el.focus({ preventScroll: true }); }
    const line = currentLine(s);
    if (line) scrollToLine(line);
    paint(s);
  }

  function mount(s) {
    const box = $('#xcode');
    let raf = 0;
    box.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(s); }); });
    $('#xgo').addEventListener('change', e => { const n = Math.max(1, Math.min(s.lines.length, +e.target.value || 1)); scrollToLine(n); paint(s); });
    go(s);
  }

  TP.ui.xml = { render, mount, go, paint };
})(typeof self !== 'undefined' ? self : globalThis);
