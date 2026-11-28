/*
 * Testing Portal – Catalogue (#catalogue): the validation catalogue as a page of
 * the app (0.4.1-m3, docs/specs/M3-catalogue.md).
 *
 * Content: config/catalogue-doc.json, the conversion of the catalogue document
 * (tools/update-catalogue.js), loaded when the page is first opened. The whole
 * document is shown in its order; the check tables get filters (status in the
 * app, severity, search) and a strip to jump to a stage.
 * Live: checks that the settings in use switch off or change (settings.checks,
 * including a settings file loaded on About for this session) are marked on
 * their row, and a check switched off there counts as Off.
 *
 * Links inside the page are buttons that scroll (data-act="cat-go"): the address
 * after # is the app's screen, so sections have no #anchors of their own.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const { ic, esc, dateLabel } = TP.ui.h;

  const FILE = 'config/catalogue-doc.json';
  let doc = null, loading = null, loadError = null;
  // filters, kept while the app is open
  const filt = { st: 'all', sev: new Set(), q: '' };

  const STATUS = [['yes', 'Runs'], ['off', 'Off'], ['silent', 'Cannot fire'], ['covered', 'Covered'], ['notbuilt', 'Not built']];
  const TAG = { yes: 'Runs', off: 'Off', silent: 'Cannot fire', covered: 'Covered by', notbuilt: 'Not built' };
  const PREFIX = { yes: /^Yes\b[,;:]?\s*/, off: /^Off\b:?\s*/, silent: /^Built, but cannot fire:?\s*/, covered: /^Covered by\s*/, notbuilt: /^Not built:?\s*/ };
  // severity words as the document's legend (E = Error, W = Warning, I = Info)
  const SEV = { E: 'Error', W: 'Warning', I: 'Info' };
  const SEV_SETTING = { E: 'an error', W: 'a warning', I: 'information' };
  const ENGINE = { JavaScript: 'js', 'XML parser (libxml2)': 'xsd', 'XSD (libxml2)': 'xsd', Schematron: 'sch', 'Schematron + JS': 'schjs' };

  /* ---------------- data ---------------- */
  function load() {
    if (doc || loading) return loading || Promise.resolve(doc);
    loading = TP.assets.json(FILE)
      .then(d => { doc = d; loadError = null; return d; })
      .catch(err => { loadError = String(err && err.message || err); throw err; })
      .finally(() => { loading = null; });
    return loading;
  }
  function setData(d) { doc = d; loadError = null; }

  const settingsInUse = () => ((TP.validation && TP.validation.engines) || {}).settings || {};
  const sourceInUse = () => ((TP.validation && TP.validation.engines) || {}).settingsSource || { kind: 'built-in' };

  /* changes the settings in use make to a check: [{ part, off, severity, code }] */
  function settingsFor(id, st) {
    const out = [];
    for (const [k, v] of Object.entries((st && st.checks) || {})) {
      if (k[0] === '_' || !v || typeof v !== 'object') continue;
      const m = /^((?:\d+|X)\.(?:\d+|x))(?:-([a-z]+))?$/.exec(k);
      if (!m || m[1] !== id) continue;
      const c = { part: m[2] || null, off: v.enabled === false, severity: v.severity || null, code: v.code };
      if (c.off || c.severity || c.code !== undefined) out.push(c);
    }
    return out.sort((a, b) => (a.part || '').localeCompare(b.part || ''));
  }
  /* the row's status with the settings in use: a check switched off as a whole is Off */
  function statusOf(row, changes) {
    if (row.status === 'yes' || row.status === 'silent') {
      if (changes.some(c => !c.part && c.off)) return 'off';
    }
    return row.status;
  }

  /* every check row with its status and severities, in document order */
  function rows(d, st) {
    const out = [];
    for (const s of (d || doc).sections) for (const b of s.blocks) if (b.checks) {
      for (const r of b.checks.rows) {
        const changes = settingsFor(r.id, st);
        out.push({ ...r, changes, live: statusOf(r, changes), sevs: sevCell(r.sev).sevs, section: s.id });
      }
    }
    return out;
  }

  /* ---------------- text ---------------- */
  // the document's inline Markdown: [text](https://…), `code`, **bold**
  function inline(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, (m, t, u) => `<a class="link" href="${u}" target="_blank" rel="noopener">${t}</a>`)
      .replace(/`([^`]+)`/g, '<span class="code">$1</span>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }
  const plain = s => String(s).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*]/g, '');

  /* "E", "E/W", "E (age W)", "E (W without service level)" */
  function sevCell(sev) {
    const m = /^([EWI])(?:\/([EWI]))?(?: \((?:(.*?) ([EWI])|([EWI]) (.*?))\))?$/.exec(sev || '');
    if (!m) return { html: `<span>${esc(sev)}</span>`, sevs: new Set() };
    const [, a, b, note1, s1, s2, note2] = m;
    const dot = s => `<span class="sev ${s}" title="${SEV[s]}">${s}</span>`;
    const sevs = new Set([a]);
    let html = dot(a);
    if (b) { html += dot(b); sevs.add(b); }
    const ps = s1 || s2, pn = s1 ? note1 : note2;
    if (ps) { sevs.add(ps); html += `<span class="sevpart">${dot(ps)}<span>${esc(pn)}</span></span>`; }
    return { html, sevs };
  }

  function appCell(r) {
    const rest = (r.app || '').replace(PREFIX[r.status], '');
    const restText = rest && r.status !== 'covered' ? rest[0].toUpperCase() + rest.slice(1) : rest;
    const live = r.live !== r.status ? `<span class="atag ${r.live}">${TAG[r.live]}</span>` : '';
    const notes = r.changes.map(c => {
      const what = [];
      if (c.off) what.push('switched off');
      if (c.severity) what.push(`reported as ${SEV_SETTING[c.severity] || c.severity}`);
      if (c.code !== undefined) what.push(`reason code ${c.code || 'none'}`);
      return `${c.part ? `part <b>${esc(c.part)}</b> ` : ''}${what.join(', ')}`;
    });
    return `${live}<span class="atag ${r.status}${live ? ' was' : ''}">${TAG[r.status]}</span>${restText ? ` <span class="arest">${inline(restText)}</span>` : ''}`
      + (notes.length ? `<span class="setnote">${ic('info', 16)}<span>Settings in use: ${notes.join('; ')}</span></span>` : '');
  }

  function builtCell(b) {
    if (!b || b === '–') return '<span class="muted">–</span>';
    const i = b.indexOf(': '), engine = i < 0 ? b : b.slice(0, i), detail = i < 0 ? '' : b.slice(i + 2);
    return `<span class="btag ${ENGINE[engine] || 'sch'}">${esc(engine)}</span>${detail ? `<span class="brest">${esc(detail)}</span>` : ''}`;
  }

  /* ---------------- blocks ---------------- */
  function checkTable(b, byId) {
    const withCode = b.checks.rows.some(r => r.code != null);
    const label = b.checks.label || 'Check';
    const th = ['ID', label, 'Sev', ...(withCode ? ['Code'] : []), 'In the app', 'Built in'].map(h => `<th>${esc(h)}</th>`).join('');
    const trs = b.checks.rows.map(r0 => {
      const r = byId.get(r0.id);
      const q = [r.id, plain(r.check), r.sev, r.code || '', plain(r.app), r.built].join(' ').toLowerCase();
      return `<tr data-st="${r.live}" data-sev="${[...r.sevs].sort().join(' ')}" data-q="${esc(q)}">`
        + `<td class="id" data-l="ID">${esc(r.id)}</td>`
        + `<td class="chk" data-l="${esc(label)}">${inline(r.check)}</td>`
        + `<td class="sv" data-l="Sev">${sevCell(r.sev).html}</td>`
        + (withCode ? `<td class="cd" data-l="Code">${r.code && r.code !== '–' ? `<span class="code">${esc(r.code)}</span>` : '<span class="muted">–</span>'}</td>` : '')
        + `<td class="app" data-l="In the app">${appCell(r)}</td>`
        + `<td class="bi" data-l="Built in">${builtCell(r.built)}</td></tr>`;
    }).join('\n');
    return `<div class="tblwrap"><table class="tbl stack cattbl"><thead><tr>${th}</tr></thead><tbody>\n${trs}\n</tbody></table></div>`;
  }

  function plainTable(t) {
    const th = t.head.map(h => `<th>${esc(h)}</th>`).join('');
    const trs = t.rows.map(r => `<tr>${r.map((c, j) => `<td data-l="${esc(t.head[j])}">${inline(c)}</td>`).join('')}</tr>`).join('\n');
    return `<div class="tblwrap"><table class="tbl stack"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
  }

  function block(b, byId) {
    if (b.p != null) return `<p>${inline(b.p)}</p>`;
    if (b.h3 != null) return `<h3 class="lvl">${esc(b.h3)}</h3>`;
    if (b.ul) return `<ul class="catul">${b.ul.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`;
    if (b.ol) return `<ol class="catol">${b.ol.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`;
    if (b.tasks) {
      return `<ul class="cattasks">${b.tasks.map(t => `<li class="${t.done ? 'done' : ''}"><span class="box">${t.done ? ic('check', 16) : ''}</span>`
        + `<span><span class="vh">${t.done ? 'Done: ' : 'Open: '}</span>${inline(t.text)}</span></li>`).join('')}</ul>`;
    }
    if (b.table) return plainTable(b.table);
    if (b.checks) return checkTable(b, byId);
    return '';
  }

  function section(s, byId) {
    const head = s.stage != null
      ? `<h2 class="sec-h stage-h" tabindex="-1"><span class="n">${s.stage}</span><span>${esc(s.title)}${s.note ? ` <span class="muted">(${esc(s.note)})</span>` : ''}</span></h2>`
      : `<h2 class="sec-h" tabindex="-1">${esc(s.title)}</h2>`;
    return `<section class="catsec${s.stage != null ? ' stage' : ''}" id="cat-${esc(s.id)}">${head}\n${s.blocks.map(b => block(b, byId)).join('\n')}</section>`;
  }

  /* ---------------- page ---------------- */
  function counts(all) {
    const c = { all: all.length, E: 0, W: 0, I: 0 };
    for (const [k] of STATUS) c[k] = 0;
    for (const r of all) { c[r.live]++; for (const s of r.sevs) c[s]++; }
    return c;
  }

  function stageStrip(d, all) {
    return d.sections.filter(s => s.stage != null).map(s => {
      const rs = all.filter(r => r.section === s.id), idle = rs.filter(r => r.live !== 'yes').length;
      const cls = !rs.length ? 'skip' : idle ? 'mid' : 'ok';
      const what = !rs.length ? 'No checks yet' : idle ? `${rs.length} checks, ${idle} not running` : `${rs.length} checks, all run`;
      return `<button class="mchip ${cls}" data-act="cat-go" data-id="${esc(s.id)}"><b>${s.stage} · ${esc(s.title)}</b><span>${what}</span></button>`;
    }).join('');
  }

  function filterBar(c) {
    const st = STATUS.map(([k, w]) => `<button class="fchip st-${k}" data-act="cat-st" data-v="${k}" aria-pressed="false"><b>${c[k]}</b> ${w}</button>`).join('');
    const sv = ['E', 'W', 'I'].map(k => `<button class="fchip ${k}" data-act="cat-sev" data-v="${k}" aria-pressed="false"><b>${c[k]}</b> ${SEV[k]}</button>`).join('');
    return `<div class="catbar" id="catbar">
      <div class="filters">
        <div class="chips" role="group" aria-label="In the app"><button class="fchip all" data-act="cat-st" data-v="all" aria-pressed="true"><b>${c.all}</b> All</button>${st}</div>
        <label class="search">${ic('search', 18)}<input type="search" id="cq" placeholder="Search ID, text or code" aria-label="Search checks" data-fid="cq"></label>
      </div>
      <div class="filters">
        <div class="chips" role="group" aria-label="Severity">${sv}</div>
        <span class="muted" id="cshown" aria-live="polite">${c.all} of ${c.all} checks</span>
        <button class="link" data-act="cat-reset" id="creset" hidden>Show all</button>
      </div>
      <p class="catnone" id="cnone" hidden>No checks match these filters.</p>
    </div>`;
  }

  function render() {
    if (!doc) {
      return `<section class="wrap"><h1 tabindex="-1">Validation catalogue</h1>
        ${loadError ? `<p class="boot bad">The catalogue could not be loaded: ${esc(loadError)}</p>` : '<p class="boot">Loading the catalogue…</p>'}</section>`;
    }
    const st = settingsInUse(), src = sourceInUse();
    const all = rows(doc, st), byId = new Map(all.map(r => [r.id, r])), c = counts(all);
    const first = doc.sections.findIndex(s => s.stage != null);
    const last = doc.sections.length - 1 - [...doc.sections].reverse().findIndex(s => s.stage != null);
    const others = doc.sections.filter(s => s.stage == null);
    const appOnly = all.filter(r => /added in the app/i.test(r.app)).length;
    const parts = doc.sections.map((s, i) => (i === first ? `<div class="checkarea" id="cat-checks"><h2 class="sec-h">Checks by stage</h2>
      <nav class="mstrip catstrip" aria-label="Stages">${stageStrip(doc, all)}</nav>${filterBar(c)}` : '')
      + section(s, byId) + (i === last ? '</div>' : ''));
    return `<section class="wrap catalogue">
      <h1 tabindex="-1">Validation catalogue</h1>
      <p class="lead">${inline(doc.lead)}</p>
      <dl class="catfacts">
        <div><dt>Document</dt><dd>${esc(doc.title)}</dd></div>
        <div><dt>As of</dt><dd>${esc(dateLabel(doc.date))}</dd></div>
        <div><dt>Checks</dt><dd>${c.all - appOnly}${appOnly ? ` + ${appOnly} app-only` : ''}</dd></div>
        <div><dt>Run</dt><dd>${c.yes}</dd></div>
        <div><dt>Off</dt><dd>${c.off}</dd></div>
        <div><dt>Not built</dt><dd>${c.notbuilt}</dd></div>
      </dl>
      <p class="catsrc">${ic('info', 18)}<span>This page shows the catalogue document of ${esc(doc.owner)}, which is the original. The status of each check is as the document describes it; the settings in use
        (${src.kind === 'session' ? `<b>${esc(src.name)}</b>, loaded for this session` : 'the built-in settings'}) add their changes to the rows. Settings per country are not shown here. <a class="link" href="#about">About › Settings</a></span></p>
      <nav class="catlinks" aria-label="Sections">${others.map(s => `<button class="link" data-act="cat-go" data-id="${esc(s.id)}">${esc(s.title)}</button>`).join('')}</nav>
      ${parts.join('\n')}
    </section>`;
  }

  /* ---------------- filters (in the page, no re-render) ---------------- */
  function apply() {
    const $ = s => document.getElementById(s);
    const trs = [...document.querySelectorAll('.cattbl tbody tr')];
    if (!trs.length) return;
    let n = 0;
    for (const r of trs) {
      const okRow = (filt.st === 'all' || r.dataset.st === filt.st)
        && (!filt.sev.size || r.dataset.sev.split(' ').some(s => filt.sev.has(s)))
        && (!filt.q || r.dataset.q.includes(filt.q));
      r.hidden = !okRow; if (okRow) n++;
    }
    const filtering = filt.st !== 'all' || filt.sev.size > 0 || !!filt.q;
    for (const t of document.querySelectorAll('.cattbl')) {
      const wrap = t.closest('.tblwrap'), any = [...t.tBodies[0].rows].some(r => !r.hidden);
      wrap.hidden = !any;
      const h3 = wrap.previousElementSibling;
      if (h3 && h3.classList.contains('lvl')) h3.hidden = !any;
    }
    for (const sec of document.querySelectorAll('.checkarea .catsec')) {
      sec.hidden = filtering && ![...sec.querySelectorAll('.cattbl tbody tr')].some(r => !r.hidden);
    }
    for (const c of document.querySelectorAll('.catbar .fchip')) {
      const on = c.dataset.act === 'cat-st' ? c.dataset.v === filt.st : filt.sev.has(c.dataset.v);
      c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on));
    }
    $('cnone').hidden = n > 0;
    $('cshown').textContent = `${n} of ${trs.length} checks`;
    $('creset').hidden = !filtering;
  }

  let qTimer = null;
  function mount() {
    if (!doc) {
      load().then(() => { if (TP.app && TP.app.state.screen === 'catalogue') TP.app.render(); }, () => { if (TP.app && TP.app.state.screen === 'catalogue') TP.app.render(); });
      return;
    }
    // opened before the settings were read: show their changes once they are
    if (!settingsInUse().checks && TP.app && TP.app.enginesReady) {
      TP.app.enginesReady.finally(() => { if (TP.app.state.screen === 'catalogue' && settingsInUse().checks) TP.app.render(); });
    }
    const q = document.getElementById('cq');
    if (q) {
      q.value = filt.q;
      q.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { filt.q = q.value.trim().toLowerCase(); apply(); }, 60); });
    }
    apply();
  }

  function go(id) {
    const sec = document.getElementById(`cat-${id}`);
    if (!sec) return;
    if (sec.hidden) { filt.st = 'all'; filt.sev.clear(); filt.q = ''; const q = document.getElementById('cq'); if (q) q.value = ''; apply(); }
    sec.scrollIntoView({ block: 'start' });
    const h = sec.querySelector('h2');
    if (h) h.focus({ preventScroll: true });
  }

  TP.ui.actions = TP.ui.actions || {};
  Object.assign(TP.ui.actions, {
    'cat-st': d => { filt.st = d.v; apply(); },
    'cat-sev': d => { filt.sev.has(d.v) ? filt.sev.delete(d.v) : filt.sev.add(d.v); apply(); },
    'cat-reset': () => { filt.st = 'all'; filt.sev.clear(); filt.q = ''; const q = document.getElementById('cq'); if (q) q.value = ''; apply(); },
    'cat-go': d => go(d.id)
  });

  TP.ui.screens = TP.ui.screens || {};
  TP.ui.screens.catalogue = { view: render, mount, nav: 'catalogue', title: () => 'Catalogue', hash: '#catalogue' };
  TP.ui.catalogue = { render, load, setData, rows, settingsFor, inline, FILE, filters: filt };
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = TP.ui.catalogue;
})(typeof self !== 'undefined' ? self : globalThis);
