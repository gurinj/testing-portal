/*
 * Testing Portal – Email screen (#email, M3): the email for the customer.
 * To (empty, editable), subject and text (editable, from TP.email.build),
 * the attachments as download buttons, Copy (main way), Open in email app
 * (mailto: link) and Reset to the generated text.
 *
 * Nothing is stored or sent: the draft lives in state.email until the page is
 * reloaded. The texts come from config/templates/email.en.json, loaded the
 * first time the screen is shown.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.ui = TP.ui || {};
  const { esc, ic, toast, $ } = TP.ui.h;
  const TEMPLATE = 'config/templates/email.en.json';

  // icons in the style of common.js (24 × 24, stroke)
  const SVG = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'
  };
  const icon = (n, s = 20) => SVG[n] ? `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[n]}</svg>` : ic(n, s);

  const CASE_LABEL = {
    unreadable: 'File could not be read', unsupported: 'Format not supported', rejected: 'File rejected',
    fixed: 'Corrected copy for reference', warnings: 'Passed with warnings', passed: 'Passed'
  };

  /* ---------------- template ---------------- */
  const tpl = { status: 'idle', error: null, promise: null };
  function loadTemplate() {
    if (TP.email.template) { tpl.status = 'ready'; return Promise.resolve(); }
    if (!tpl.promise) {
      tpl.status = 'loading';
      tpl.promise = TP.assets.json(TEMPLATE)
        .then(t => { TP.email.template = t; tpl.status = 'ready'; })
        .catch(err => { tpl.status = 'failed'; tpl.error = String(err && err.message || err); tpl.promise = null; });
    }
    return tpl.promise;
  }

  /* ---------------- the run and its draft ---------------- */
  // the session of the app; before the session runs exist (or in a test) one run made from state.result
  function sessionOf(s) {
    if (s.session && Array.isArray(s.session.runs) && s.session.runs.length) return s.session;
    const r = s.result;
    if (!r) return null;
    return { runs: [{ n: 1, fileName: r.fileName, at: r.at, country: r.country, version: r.version, status: r.status, counts: r.counts, incomplete: r.incomplete, source: 'upload', parent: null, changes: [], text: r.text, result: r }], current: 1 };
  }
  function currentRun(s) {
    const session = sessionOf(s);
    const run = session && TP.email.currentRun(session);
    return run && run.result ? { session, run } : null;
  }
  const keyOf = run => `${run.n}|${run.fileName}|${run.at || (run.result && run.result.at) || ''}`;

  // the draft of the current run; a new run gets a new text (the address is kept within the same chain)
  function draft(s) {
    const cur = currentRun(s);
    if (!cur || !TP.email.template) return null;
    const key = keyOf(cur.run);
    if (s.email && s.email.key === key) return s.email;
    const countryConfig = TP.validation && TP.validation.engines && TP.validation.engines.countries ? TP.validation.engines.countries[cur.run.country || cur.run.result.country] : null;
    let gen;
    try { gen = TP.email.build(cur.session, cur.run, { template: TP.email.template, countryConfig }); }
    catch (err) { return { key, error: String(err && err.message || err) }; }
    const root = keyOf(TP.email.chainOf(cur.session, cur.run).original);
    const keepTo = s.email && s.email.root === root ? s.email.to : '';
    s.email = { key, root, run: cur.run, gen, to: keepTo, subject: gen.subject, body: gen.body, undo: null, manual: null };
    return s.email;
  }

  /* ---------------- view ---------------- */
  function render(s) {
    const head = `<a class="back" href="#report" data-act="back" data-fid="em-back">${ic('back', 18)}Back to the report</a>
      <h1 tabindex="-1" data-fid="em-h1">Email for the customer</h1>
      <p class="lead">Check the text and add the customer’s address. Then copy it into your email program, or open it there. Nothing is sent from this page.</p>`;
    if (!TP.email.template && tpl.status === 'failed') {
      return `<section class="wrap email">${head}<div class="emnote bad" role="alert">${ic('x', 22)}<div><b>The email texts could not be loaded.</b><p>${esc(TEMPLATE)}: ${esc(tpl.error)}</p><p class="muted">If the file was edited, check its quotes, commas and brackets (see its _about notes).</p></div></div></section>`;
    }
    const d = TP.email.template ? draft(s) : null;
    if (!d) return `<section class="wrap email">${head}<p class="boot">Loading the email texts…</p></section>`;
    if (d.error) return `<section class="wrap email">${head}<div class="emnote bad" role="alert">${ic('x', 22)}<div><b>The email could not be written.</b><p>${esc(d.error)}</p></div></div></section>`;
    const gen = d.gen, run = d.run, r = run.result;
    const notes = [];
    if (gen.incomplete) notes.push(`<div class="emnote" role="note">${ic('warn', 22)}<div><b>Some checks could not run.</b><p>The result is not reliable. Before you send this email, open About › Technical check and validate the file again.</p></div></div>`);
    if (gen.problems.length) notes.push(`<div class="emnote" role="note">${ic('warn', 22)}<div><b>The email texts (${esc(TEMPLATE)}) have ${gen.problems.length === 1 ? 'a problem' : `${gen.problems.length} problems`}.</b><ul>${gen.problems.slice(0, 8).map(p => `<li>${esc(p)}</li>`).join('')}${gen.problems.length > 8 ? `<li>… and ${gen.problems.length - 8} more</li>` : ''}</ul></div></div>`);
    const edited = d.subject !== gen.subject || d.body !== gen.body;
    const files = gen.attachments.map(a => a.kind === 'report'
      ? `<li>${ic('file', 22)}<div><b>${esc(a.name)}</b><span>Printable report of run ${esc(run.n)}</span></div><button class="btn sec sm" data-act="email-dl" data-kind="report" data-fid="em-dl-report">${ic('down', 18)}Download</button></li>`
      : `<li>${ic('file', 22)}<div><b>${esc(a.name)}</b><span>Corrected copy, for reference only</span></div><button class="btn sec sm" data-act="email-dl" data-kind="xml" data-fid="em-dl-xml">${ic('down', 18)}Download</button></li>`).join('');
    return `<section class="wrap email">${head}
      <p class="embase">${esc(CASE_LABEL[gen.case] || gen.case)} · written from run ${esc(run.n)}, <span class="code">${esc(run.fileName || r.fileName)}</span>, ${esc(r.status)}${r.incomplete ? ' (incomplete)' : ''}</p>
      ${notes.join('')}
      <div class="emgrid">
        <div class="panel emform">
          <label class="emlab" for="em-to">To</label>
          <input id="em-to" class="inp" type="email" multiple autocomplete="off" spellcheck="false" placeholder="name@company.com" value="${esc(d.to)}" data-fid="em-to" aria-describedby="em-to-help">
          <p class="help" id="em-to-help">The tool doesn’t know the customer’s address. Several addresses: separate them with commas.</p>
          <div class="emrow"><label class="emlab" for="em-subject">Subject</label><button class="link" data-act="email-copy" data-what="subject" data-fid="em-cs">Copy subject</button></div>
          <input id="em-subject" class="inp" type="text" value="${esc(d.subject)}" data-fid="em-subject">
          <div class="emrow"><label class="emlab" for="em-body">Text</label><button class="link" data-act="email-copy" data-what="body" data-fid="em-cb">Copy text</button></div>
          <textarea id="em-body" class="inp embody" rows="24" spellcheck="true" data-fid="em-body">${esc(d.body)}</textarea>
          <p class="emreset" id="em-reset">${resetLine(d, edited)}</p>
        </div>
        <aside class="emside">
          <div class="panel">
            <h2>Send</h2>
            <button class="btn pri" data-act="email-copy" data-what="all" data-fid="em-copy">${icon('copy')}Copy subject and text</button>
            <a class="btn sec" id="em-mailto" href="${esc(TP.email.mailto(d.to, d.subject, d.body))}" data-fid="em-mailto">${icon('mail')}Open in email app</a>
            <p class="help">Opens a new email with the subject and text. Add the attachments by hand.</p>
            <p class="emwarn" id="em-long" ${linkTooLong(d) ? '' : 'hidden'}>${longText(d)}</p>
            <div class="emmanual" id="em-manual" ${d.manual ? '' : 'hidden'}>${manualBox(d.manual)}</div>
          </div>
          <div class="panel">
            <h2>Attachments</h2>
            <ul class="emfiles">${files}</ul>
            <p class="help">Download ${gen.attachments.length === 1 ? 'it' : 'them'}, then attach ${gen.attachments.length === 1 ? 'it' : 'them'} to the email.</p>
          </div>
        </aside>
      </div>
      <p class="note">The generated text contains no amounts, names or account numbers from the file: only the file name, counts, check titles, places (block and transaction numbers, EndToEndIds) and sample values. Edit it as you like before you send it; your changes are kept until the page is reloaded.</p>
    </section>`;
  }

  const resetLine = (d, edited) => edited
    ? `You changed the text. <button class="link" data-act="email-reset" data-fid="em-reset-b">Reset to the generated text</button>`
    : d.undo ? `Back to the generated text. <button class="link" data-act="email-undo" data-fid="em-undo">Undo</button>` : '<span class="muted">Generated text, not changed.</span>';
  const linkLength = d => TP.email.mailto(d.to, d.subject, d.body).length;
  const linkTooLong = d => linkLength(d) > TP.email.MAILTO_LIMIT;
  const longText = d => `${ic('warn', 18)}<span>The text is long (${linkLength(d).toLocaleString('en-US')} characters in the link). Some email programs cut long texts. Copy is safer.</span>`;
  const manualBox = text => text == null ? '' : `<p><b>Copying is not allowed here.</b> The text below is selected: press Ctrl+C (⌘C on a Mac) to copy it.</p>
    <textarea class="inp" id="em-manual-text" readonly rows="8" aria-label="Text to copy">${esc(text)}</textarea>
    <button class="link" data-act="email-manual-close" data-fid="em-manual-close">Close</button>`;

  /* ---------------- mount: keep the draft and the link up to date while typing ---------------- */
  function mount(s) {
    if (!TP.email.template && tpl.status !== 'failed') { loadTemplate().then(() => { if (s.screen === 'email') TP.app.render(); }); return; }
    const d = s.email;
    if (!d || d.error) return;
    const fields = { 'em-to': 'to', 'em-subject': 'subject', 'em-body': 'body' };
    for (const [id, k] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { d[k] = el.value; if (k !== 'to') d.undo = null; if (k === 'body') fit(el); refresh(d); });
    }
    const body = document.getElementById('em-body');
    if (body) fit(body);
  }
  // the text box grows with the text, so the whole email is seen without scrolling inside it
  function fit(el) {
    const y = window.scrollY;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 4}px`;
    window.scrollTo(window.scrollX, y);
  }
  function refresh(d) {
    const a = $('#em-mailto'); if (a) a.setAttribute('href', TP.email.mailto(d.to, d.subject, d.body));
    const w = $('#em-long'); if (w) { const long = linkTooLong(d); w.hidden = !long; if (long) w.innerHTML = longText(d); }
    const rs = $('#em-reset'), edited = d.subject !== d.gen.subject || d.body !== d.gen.body;
    if (rs && rs.dataset.edited !== String(edited)) { rs.dataset.edited = String(edited); rs.innerHTML = resetLine(d, edited); }
  }

  /* ---------------- actions ---------------- */
  const SUBJECT_LABEL = 'Subject';
  async function copy(d, what, s) {
    const text = what === 'subject' ? d.subject : what === 'body' ? d.body : `${SUBJECT_LABEL}: ${d.subject}\n\n${d.body}`;
    const ok = await TP.platform.copyText(text);
    if (ok) {
      d.manual = null;
      const box = $('#em-manual'); if (box) { box.hidden = true; box.innerHTML = ''; }
      toast(what === 'subject' ? 'Subject copied.' : what === 'body' ? 'Text copied.' : 'Subject and text copied. Paste them into your email.');
    } else {
      // copying is not allowed (some browsers, frames): show the text selected for Ctrl+C
      d.manual = text;
      const box = $('#em-manual');
      if (!box) return;
      box.innerHTML = manualBox(text);
      box.hidden = false;
      const t = $('#em-manual-text');
      if (t) { t.focus(); t.select(); }
    }
  }
  TP.ui.actions = TP.ui.actions || {};
  Object.assign(TP.ui.actions, {
    email: () => TP.app.go('email'),
    'email-copy': (ds, s) => { if (s.email && s.email.gen) copy(s.email, ds.what, s); },
    'email-reset': (ds, s) => {
      const d = s.email; if (!d || !d.gen) return;
      d.undo = { subject: d.subject, body: d.body };
      d.subject = d.gen.subject; d.body = d.gen.body;
      TP.app.render();
      toast('Back to the generated text.');
    },
    'email-undo': (ds, s) => {
      const d = s.email; if (!d || !d.undo) return;
      d.subject = d.undo.subject; d.body = d.undo.body; d.undo = null;
      TP.app.render();
    },
    'email-manual-close': (ds, s) => {
      if (s.email) s.email.manual = null;
      const box = $('#em-manual'); if (box) { box.hidden = true; box.innerHTML = ''; }
      const b = document.querySelector('[data-fid="em-copy"]'); if (b) b.focus();
    },
    'email-dl': (ds, s) => {
      const d = s.email; if (!d || !d.run) return;
      // the same printable report as the report screen's button (with the runs of the session, M3 section 7)
      if (ds.kind === 'report') TP.ui.exports.downloadReport(d.run.result, s.session);
      else if (TP.fix && typeof TP.fix.downloadCorrected === 'function') TP.fix.downloadCorrected(s);
      else toast('The corrected file cannot be downloaded here.', true);
    }
  });

  TP.ui.screens = TP.ui.screens || {};
  TP.ui.screens.email = {
    view: render, mount, nav: 'start', hash: '#email',
    title: s => { const c = currentRun(s); return `Email: ${c ? c.run.fileName || c.run.result.fileName : ''}`; },
    needs: s => !!currentRun(s)
  };
  TP.ui.email = { render, mount, sessionOf, loadTemplate, icon, CASE_LABEL };
  // in the page, load the texts early so the screen opens without "Loading…" (not in Node: no TP.assets there)
  if (typeof document !== 'undefined' && TP.assets && typeof TP.assets.json === 'function') loadTemplate();
})(typeof self !== 'undefined' ? self : globalThis);
