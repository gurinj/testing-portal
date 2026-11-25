/*
 * Testing Portal – Fix the errors (M3), from prototype v2's "Proposed changes".
 * A table of the proposed changes with tick boxes, inputs for samples, choices and
 * entries, before and after of the XML, the findings without a change, and
 * "Apply and validate again". Values are updated in place, so typing keeps the focus.
 *
 * state.fix = { proposals, manual, xml (show before and after), preview (Map), from (run number) }
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const { ic, esc, plural, SEV, $, $$, toast } = TP.ui.h;
  const ROWS = 100; // places listed per change

  const TAGS = { calculated: ['Corrected', 'corr'], sample: ['Sample value', 'smp'], entered: ['Entered value', 'ent'], choice: ['Chosen', 'cho'], todo: ['To enter', 'todo'] };
  const tagOf = p => (p.kind === 'entry' && p.rows[0].val === '' ? 'todo' : TP.fix.tagOf(p));
  const ruleId = p => p.rule + (p.part ? '-' + p.part : '');
  const val = v => (v == null ? '<em class="miss">(missing)</em>' : v === '' ? '<em class="miss">(empty)</em>' : TP.ui.h.wsVal(v));

  /* the proposals for the current result (when the screen opens) */
  // the proposals for the current run (also when Back or Forward lands on #fix after the state was reset)
  function prepare(state) {
    const r = state.result, e = TP.validation.engines;
    if (!r || !r.text || r.stopped) return false;
    const cc = (e.countries || {})[r.country] || {};
    const res = TP.fix.propose(r, r.text, { fixes: e.fixes, settings: r.settings, country: r.country, countryConfig: cc });
    state.fix = { proposals: res.proposals, manual: res.manual, xml: false, preview: null, from: state.session.current };
    return true;
  }
  function open(state) {
    if (prepare(state)) TP.app.go('fix');
  }

  function vEdit(p) {
    const r = p.rows[0];
    const label = `New value for ${esc(p.field)}`;
    if (p.options) return `<select class="inp" data-fix-edit="${p.id}" data-fid="v-${p.id}" aria-label="${label}" aria-describedby="e-${p.id}">${p.options.map(o => `<option${o === r.val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    return `<input class="inp" data-fix-edit="${p.id}" data-fid="v-${p.id}" value="${esc(r.val)}" aria-label="${label}" aria-describedby="e-${p.id}" placeholder="${p.kind === 'entry' ? 'Type the value' : ''}" spellcheck="false" autocomplete="off">`;
  }

  // the element a row changes, when the field label is general (5.x text checks, shortening)
  const elOf = x => (x.element ? `<small class="code muted">${esc(x.element)}</small>` : '');
  function vRows(p) {
    const rows = p.rows.slice(0, ROWS);
    return `<table class="tbl inner"><thead><tr><th>Where</th><th>EndToEndId</th><th>Current value</th><th>New value</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${esc(x.where)}${elOf(x)}</td><td class="code">${x.e2e ? esc(x.e2e) : '–'}</td><td class="code old">${val(x.old)}</td><td class="code new">${p.kind === 'calculated' ? val(x.next) : '<span class="muted">as above</span>'}</td></tr>`).join('')}
    </tbody></table>${p.rows.length > ROWS ? `<p class="muted">The first ${ROWS} of ${plural(p.rows.length, 'place')}.</p>` : ''}`;
  }

  function vSrc(lines, cls) {
    return `<div class="src ${cls}">${lines.map(l => `<div class="${l.hit ? 'hit' : ''}"><i>${l.n == null ? '+' : l.n}</i><code>${esc(l.text)}</code></div>`).join('')}</div>`;
  }
  function vBA(p, pv) {
    const x = pv && pv.get(p.id);
    if (!x) return '';
    if (x.reason) return `<p class="nochg">${esc(x.reason)}</p>`;
    const many = p.rows.length > 1 ? `, ${esc(p.rows[0].where)} (1 of ${p.rows.length})` : '';
    return `<div><h4>Before${many}</h4>${vSrc(x.before, 'before')}</div>
      <div><h4>After</h4>${p.sel ? vSrc(x.after, 'after') : '<p class="nochg">Not selected. This stays as it is.</p>'}</div>`;
  }

  function vChange(p, s) {
    const r = p.rows[0], multi = p.rows.length > 1, S = SEV[p.severity] || SEV.E;
    const editable = p.kind !== 'calculated';
    return `<tr id="row-${p.id}" class="${p.sel ? '' : 'off'}">
        <td><input type="checkbox" data-fix-sel="${p.id}" data-fid="s-${p.id}" aria-label="Apply the change for: ${esc(p.title)}" ${p.sel ? 'checked' : ''}></td>
        <td><span class="rule"><span class="sev ${p.severity} sm" title="${S.w}">${ic(S.ic, 13)}</span>${esc(ruleId(p))}</span></td>
        <td class="fld" data-l="Field">${esc(p.field)}${p.changesPayment ? '<small>Changes the payment</small>' : ''}${p.note ? `<small class="muted">${esc(p.note)}</small>` : ''}</td>
        <td class="nw" data-l="Where">${multi ? `<b>${plural(p.rows.length, 'place')}</b>` : esc(r.where) + elOf(r)}</td>
        <td class="code old" data-l="Current value">${val(r.old)}</td>
        <td class="code new" data-l="New value">${editable ? `${vEdit(p)}<div class="ierr" id="e-${p.id}" aria-live="polite"></div>` : val(r.next)}</td>
        <td data-l="Type"><span class="ctag" id="g-${p.id}"></span></td>
      </tr>
      ${multi ? `<tr class="sub"><td colspan="7"><details><summary>${ic('chev', 18)}Show all ${plural(p.rows.length, 'place')}</summary>${vRows(p)}</details></td></tr>` : ''}
      ${s.fix.xml ? `<tr class="sub"><td colspan="7"><div class="ba" id="ba-${p.id}">${vBA(p, s.fix.preview)}</div></td></tr>` : ''}`;
  }

  function vManual(list) {
    if (!list.length) return '';
    return `<details class="manual"><summary>${ic('chev')}${plural(list.length, 'finding')} without a proposed change</summary>
      <ul>${list.map(m => { const S = SEV[m.severity] || SEV.E; return `<li><span class="sev ${m.severity} sm">${ic(S.ic, 13)}</span><div><b>${esc(m.title)}</b> <span class="muted">Rule ${esc(m.rule + (m.part ? '-' + m.part : ''))}${m.count > 1 ? `, ${plural(m.count, 'place')}` : ''}</span><small>${esc(m.reason)}</small></div></li>`; }).join('')}</ul>
    </details>`;
  }

  function render(s) {
    const f = s.fix, ch = f.proposals;
    const errs = s.result.counts.E;
    const head = errs ? 'Fix the errors' : 'Fix the warnings';
    if (!ch.length) {
      return `<section class="wrap">
        <button class="link back" data-act="back" data-fid="back">${ic('back', 18)}Back to report</button>
        <h1 tabindex="-1">${head}</h1>
        <div class="empty plain fixnone">${ic('info', 26)}<p>No change can be proposed for the findings of this file. Each finding says what to fix in the system that creates the file.</p></div>
        ${vManual(f.manual)}
      </section>`;
    }
    return `<section class="wrap withbar">
      <button class="link back" data-act="back" data-fid="back">${ic('back', 18)}Back to report</button>
      <h1 tabindex="-1">${head}</h1>
      <p class="lead" id="fixlead"></p>
      <div class="fixtools">
        <button class="link" data-act="fix-all" data-v="1" data-fid="sa">Select all</button>
        <button class="link" data-act="fix-all" data-v="" data-fid="sn">Select none</button>
        <label class="tog"><input type="checkbox" data-fix-xml="1" data-fid="fx" ${f.xml ? 'checked' : ''}>Show XML before and after</label>
      </div>
      <div class="tblwrap"><table class="tbl changes fix"><thead><tr><th><span class="vh">Apply</span></th><th>Rule</th><th>Field</th><th>Where</th><th>Current value</th><th>New value</th><th>Type</th></tr></thead><tbody>
        ${ch.map(p => vChange(p, s)).join('')}
      </tbody></table></div>
      ${vManual(f.manual)}
      <p class="note">Only the values in this table change; every other part of the file stays as the customer sent it. Sample values stand in for data that isn’t in the file: the customer must replace them. Changes marked “Changes the payment” need the customer’s agreement.</p>
      <div class="stickybar"><span class="muted" id="fixnote"></span><button class="btn sec" data-act="back" data-fid="cancel">Cancel</button><button class="btn pri" data-act="fix-apply" data-fid="apply" id="fixapply"></button></div>
    </section>`;
  }

  /* counts, tags, messages and the apply button, updated in place */
  function sync(s) {
    const f = s.fix;
    if (s.screen !== 'fix' || !f || !f.proposals.length) return;
    const ch = f.proposals, sel = ch.filter(p => p.sel);
    const n = ch.reduce((a, p) => a + p.rows.length, 0), k = sel.reduce((a, p) => a + p.rows.length, 0);
    const by = t => sel.filter(p => tagOf(p) === t).reduce((a, p) => a + p.rows.length, 0);
    const parts = [];
    if (by('calculated')) parts.push(`${by('calculated').toLocaleString('en-US')} calculated from the file`);
    if (by('sample')) parts.push(`${by('sample').toLocaleString('en-US')} ${by('sample') === 1 ? 'is a sample value' : 'are sample values'}`);
    if (by('choice')) parts.push(`${by('choice').toLocaleString('en-US')} chosen here`);
    if (by('entered') + by('todo')) parts.push(`${(by('entered') + by('todo')).toLocaleString('en-US')} entered here`);
    const mix = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || '';
    $('#fixlead').textContent = k ? `${plural(k, 'change')} of ${n.toLocaleString('en-US')} selected, for ${sel.length} of ${plural(ch.length, 'finding')}. ${mix}.` : `No changes selected. Tick the changes to make, or use Select all.`;
    let bad = false;
    for (const p of ch) {
      const G = TAGS[tagOf(p)], tag = $(`#g-${p.id}`);
      if (tag) { tag.className = `ctag ${G[1]}`; tag.textContent = G[0]; }
      const row = $(`#row-${p.id}`); if (row) row.classList.toggle('off', !p.sel);
      if (p.kind !== 'calculated') {
        const err = p.sel ? p.rows[0].error : '';
        const e = $(`#e-${p.id}`), inp = document.querySelector(`[data-fix-edit="${p.id}"]`);
        if (e) e.textContent = err;
        if (inp) { inp.classList.toggle('bad', !!err); inp.disabled = !p.sel; inp.setAttribute('aria-invalid', err ? 'true' : 'false'); }
        if (err) bad = true;
      }
    }
    const open = s.result.groups.filter(gr => gr.severity !== 'I').length - sel.length;
    $('#fixnote').textContent = bad ? 'Correct the marked values to continue.' : open > 0 ? `${plural(open, 'finding')} will stay open.` : 'Nothing changes until you apply.';
    const b = $('#fixapply');
    b.disabled = !k || bad;
    b.innerHTML = `Apply ${plural(k, 'change')} and validate again ${ic('arrow')}`;
    // the end of the page stays above the sticky bar (its height changes with the window and the wording)
    const bar = $('.stickybar'), wrap = $('.withbar');
    if (bar && wrap) wrap.style.paddingBottom = `${bar.offsetHeight + 32}px`;
  }

  function mount(s) {
    if (s.fix && s.fix.xml && !s.fix.preview) { s.fix.preview = TP.fix.preview(s.result.text, s.fix.proposals); TP.app.render(); return; }
    sync(s);
  }

  const find = (s, id) => s.fix && s.fix.proposals.find(p => p.id === id);
  function refreshBA(s, p) {
    if (!s.fix.xml) return;
    s.fix.preview.set(p.id, TP.fix.preview(s.result.text, [p]).get(p.id));
    const el = $(`#ba-${p.id}`); if (el) el.innerHTML = vBA(p, s.fix.preview);
  }

  // inputs and tick boxes of the fix screen
  if (typeof document !== 'undefined') {
    document.addEventListener('input', e => {
      const s = TP.app && TP.app.state, id = e.target.dataset && e.target.dataset.fixEdit;
      if (!s || s.screen !== 'fix' || !id) return;
      const p = find(s, id); if (!p) return;
      TP.fix.setValue(p, e.target.value);
      sync(s);
    });
    // a sample value is replaced as a whole: select it when the field is entered
    document.addEventListener('focusin', e => { if (e.target.dataset && e.target.dataset.fixEdit && e.target.select) e.target.select(); });
    document.addEventListener('change', e => {
      const s = TP.app && TP.app.state, d = e.target.dataset || {};
      if (!s || s.screen !== 'fix') return;
      if (d.fixSel) { const p = find(s, d.fixSel); if (p) { p.sel = e.target.checked; sync(s); refreshBA(s, p); } }
      else if (d.fixEdit) { const p = find(s, d.fixEdit); if (p) { TP.fix.setValue(p, e.target.value); sync(s); refreshBA(s, p); } }
      else if (d.fixXml) { s.fix.xml = e.target.checked; s.fix.preview = null; TP.app.render(); }
    });
  }

  TP.ui.screens = TP.ui.screens || {};
  TP.ui.screens.fix = { view: render, mount, nav: 'start', hash: '#fix', title: s => `Fix: ${s.result.fileName}`, needs: s => !!(s.result && s.fix),
    // Back or Forward to #fix after a new run: the proposals of the current run, if it has any
    restore: s => { if (prepare(s) && !s.fix.proposals.length) s.fix = null; } };
  TP.ui.actions = TP.ui.actions || {};
  Object.assign(TP.ui.actions, {
    fix: (d, s) => open(s),
    'fix-all': (d, s) => { for (const p of s.fix.proposals) p.sel = !!d.v; TP.app.render(); },
    'fix-apply': async (d, s) => {
      const out = TP.fix.apply(s.result.text, s.fix.proposals);
      if (!out.applied.length) { toast('No change could be applied.', true); return; }
      await TP.app.revalidate({ text: out.text, changes: out.applied, skipped: out.skipped });
    }
  });
  TP.ui.fix = { open, render, sync, tagOf, TAGS };
})(typeof self !== 'undefined' ? self : globalThis);
