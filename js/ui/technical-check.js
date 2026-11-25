/*
 * Testing Portal – technical check (About › Technical check, #check).
 * Shows whether the engines run in this browser, runs the built-in checks
 * and the speed test, and gives a text summary to send back.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const secs = ms => ms == null ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
  const pill = (cls, text) => `<span class="st ${cls}">${esc(text)}</span>`;
  const tone = st => st === 'ACTC' ? 'good' : st === 'ACWC' ? 'mid' : 'bad';
  const enc = s => new TextEncoder().encode(s);

  /* Same as tests/expected/defects.json (a Node test compares them). 10.8 (information) is on .03 files only. */
  const EXPECTED_DEFECTS = { '4.3': 1, '4.4': 1, '5.1': 1, '9.1': 2, '9.3': 2, '4.10': 1, '5.6': 1, '4.28': 1, '7.1': 1, '4.38': 1, '10.8': 1 };
  const EXPECTED_09 = Object.fromEntries(Object.entries(EXPECTED_DEFECTS).filter(([k]) => k !== '10.8'));
  const total = o => Object.values(o).reduce((a, b) => a + b, 0);

  const report = { engines: null, checks: [], speed: [], own: null, errors: [] };

  function browserName() {
    const ua = navigator.userAgent;
    const m = /Edg\/([\d.]+)/.exec(ua) || /Chrome\/([\d.]+)/.exec(ua) || /Firefox\/([\d.]+)/.exec(ua) || /Version\/([\d.]+).*Safari/.exec(ua);
    const name = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Other';
    return `${name} ${m ? m[1].split('.')[0] : ''}`.trim();
  }

  /* ---------------- 1. engines ---------------- */
  async function startEngines() {
    $('eng-mode').textContent = TP.platform.modeLabel();
    $('eng-browser').textContent = browserName();
    TP.platform.canDownload('txt').then(ok => { if (!alive()) return; $('eng-dl').innerHTML = ok ? pill('good', 'Available') : pill('bad', 'Not available'); report.downloads = ok; });
    $('eng-status').className = 'st busy'; $('eng-status').textContent = 'Starting';
    const info = await TP.app.enginesReady.catch(err => ({ error: String(err.message || err) }));
    if (!alive()) return false;
    const e = TP.validation.engines;
    const show = (id, i, label) => {
      $(id).innerHTML = i && !i.error ? `${pill('good', 'Ready')}<small>${esc(label(i))}</small>` : `${pill('bad', 'Failed')}<small>${esc(i ? i.error : 'not started')}</small>`;
    };
    show('eng-xsd', e.info.xsd, i => `started in ${secs(i.loadMs)}`);
    show('eng-rules', e.info.rules, i => `${i.product || 'SaxonJS'} ${i.version || ''}, ${i.ruleSets ? i.ruleSets.length : 0} rule files, started in ${secs(i.loadMs)}`);
    const okAll = e.info.xsd && !e.info.xsd.error && e.info.rules && !e.info.rules.error;
    $('eng-workers').innerHTML = okAll ? pill('good', 'Ready') : pill('bad', 'Failed');
    $('eng-status').className = 'st ' + (okAll ? 'good' : 'bad');
    $('eng-status').textContent = okAll ? 'All engines ready' : 'Problem';
    report.engines = { ok: !!okAll, xsd: e.info.xsd, rules: e.info.rules, totalMs: e.info.totalMs, error: e.error || (info && info.error) || null };
    renderOut();
    return okAll;
  }

  /* ---------------- 2. built-in checks ---------------- */
  const ruleTally = r => { const got = {}; for (const f of r.raw) if (f.source === 'rules') got[f.rule] = (got[f.rule] || 0) + 1; return got; };
  const diffTally = (got, exp) => [...new Set([...Object.keys(got), ...Object.keys(exp)])].filter(k => got[k] !== exp[k]);
  const CHECKS = [
    { label: 'A clean pain.001.001.03 file passes', run: async () => {
      const r = await validateText(TP.testFiles.generate({ version: '03', transactions: 20, blocks: 2 }));
      const info = r.groups.filter(g => g.severity === 'I').map(g => g.rule).join(', ');
      return { ok: r.status === 'ACTC' && r.groups.every(g => g.severity === 'I' && g.rule === '10.8'), detail: `${r.status}, ${r.groups.length} findings${info ? ` (hint ${info})` : ''}, ${secs(r.timings.total)}` };
    } },
    { label: 'A clean pain.001.001.09 file passes', run: async () => {
      const r = await validateText(TP.testFiles.generate({ version: '09', transactions: 20, blocks: 2 }));
      return { ok: r.status === 'ACTC' && r.groups.length === 0, detail: `${r.status}, ${r.groups.length} findings, ${secs(r.timings.total)}` };
    } },
    { label: `Ten known problems give the ${total(EXPECTED_DEFECTS)} expected rule findings (.03)`, run: async () => {
      const r = await validateText(TP.testFiles.generate({ version: '03', transactions: 12, blocks: 2, defects: TP.testFiles.DEFECTS }));
      const diff = diffTally(ruleTally(r), EXPECTED_DEFECTS), got = ruleTally(r);
      const lines = r.raw.filter(f => f.source === 'rules').every(f => f.line > 0);
      return { ok: !diff.length && lines && r.status === 'RJCT', detail: diff.length ? `different: ${diff.map(k => `${k} got ${got[k] || 0}, expected ${EXPECTED_DEFECTS[k] || 0}`).join('; ')}` : `${r.raw.length} findings in ${r.groups.length} groups, all with line numbers, ${secs(r.timings.total)}` };
    } },
    { label: 'The same problems give the same findings in a .09 file', run: async () => {
      const r = await validateText(TP.testFiles.generate({ version: '09', transactions: 12, blocks: 2, defects: TP.testFiles.DEFECTS }));
      const diff = diffTally(ruleTally(r), EXPECTED_09);
      return { ok: !diff.length, detail: diff.length ? `different: ${diff.join(', ')}` : `${r.raw.length} findings, ${secs(r.timings.total)}` };
    } },
    { label: 'Two XSD errors are both reported, and the rules still run', run: async () => {
      const xml = TP.testFiles.generate({ version: '03', transactions: 12, blocks: 2, defects: ['ctrlsum'] })
        .replace('<PmtMtd>TRF</PmtMtd>', '<PmtMtd>XXX</PmtMtd>').replace('<EndToEndId>E2E-000004</EndToEndId>', '');
      const r = await validateText(xml);
      const xsd = r.raw.filter(f => f.source === 'xsd'), rules = r.raw.filter(f => f.source === 'rules');
      return { ok: xsd.length === 2 && xsd.every(f => f.line > 0) && xsd.map(f => f.rule).sort().join() === '2.2,2.8' && rules.some(f => f.rule === '4.4'), detail: `XSD ${xsd.map(f => `${f.rule} line ${f.line}`).join(', ')}; ${rules.length} rule findings` };
    } },
    { label: '100 failures of one rule show as one finding with 100 places', run: async () => {
      const xml = TP.testFiles.generate({ version: '03', transactions: 100, blocks: 1 }).replace(/Ccy="EUR"/g, 'Ccy="USD"');
      const r = await validateText(xml);
      const gr = r.groups.find(x => x.rule === '7.1');
      return { ok: !!gr && gr.count === 100 && r.groups.filter(x => x.rule === '7.1').length === 1, detail: gr ? `rule 7.1: ${gr.count} places in one finding` : 'rule 7.1 not found' };
    } },
    { label: 'A fix round corrects three findings and changes nothing else in the file', run: async () => {
      // a clean UA cross-border file with three known problems; fixing them must give back the clean file exactly
      const base = TP.testFiles.generate({ version: '09', transactions: 4, blocks: 1, type: 'CROSS_BORDER', country: 'UA' });
      const name = (/<Cdtr><Nm>([^<]*)<\/Nm>/.exec(base) || [])[1];
      const xml = base.replace('<ChrgBr>SHAR</ChrgBr>', '<ChrgBr>SLEV</ChrgBr>').replace(/<Cdtr><Nm>[^<]*<\/Nm>/, '<Cdtr>').replace(/(<RmtInf><Ustrd>)([^<]*)(<\/Ustrd>)/, '$1$2 $3');
      const r = await validateText(xml, 'UA');
      const e = TP.validation.engines;
      const { proposals } = TP.fix.propose(r, r.text, { fixes: e.fixes, settings: r.settings, country: 'UA', countryConfig: (e.countries || {}).UA || {} });
      const want = ['4.28', '5.4-spaces', '7.19'], key = p => p.rule + (p.part ? '-' + p.part : '');
      const mine = proposals.filter(p => want.includes(key(p)));
      mine.forEach(p => { p.sel = true; });
      const nm = mine.find(p => p.rule === '4.28');
      if (nm && name) TP.fix.setValue(nm, name);
      const out = TP.fix.apply(r.text, mine);
      const r2 = await validateText(out.text, 'UA');
      const left = r2.groups.map(key).filter(k => want.includes(k));
      return { ok: mine.length === 3 && !out.skipped.length && out.text === base && !left.length && r2.status === 'ACTC',
        detail: `${mine.length} of 3 proposed, ${out.applied.length} applied, ${out.text === base ? 'file the same as the clean file' : 'file differs from the clean file'}; validated again: ${r2.status}${left.length ? `, still ${left.join(', ')}` : ''}` };
    } },
    { label: 'A file that is not well-formed stops at stage 0, with the line', run: async () => {
      const xml = TP.testFiles.generate({ version: '03', transactions: 12 }).replace('<Nm>Lindenhof Metall GmbH</Nm>', '<Nm>Novak & Partner</Nm>');
      const r = await validateText(xml);
      const f = r.raw[0] || {};
      return { ok: r.stopped === 'well-formed' && f.rule === '0.7' && f.line > 0, detail: `stopped at: ${r.stopped || 'not stopped'}, line ${f.line || '–'}` };
    } },
    { label: 'A pain.008 direct debit file stops at stage 1', run: async () => {
      const xml = TP.testFiles.generate({ version: '03', transactions: 3 }).replace(/pain\.001\.001\.03/g, 'pain.008.001.02');
      const r = await validateText(xml);
      return { ok: r.stopped === 'identify' && r.raw[0].rule === '1.2', detail: `stopped at: ${r.stopped || 'not stopped'}` };
    } },
    { label: 'A file with a DOCTYPE stops at stage 0 (XML security)', run: async () => {
      const xml = '<?xml version="1.0"?>\n<!DOCTYPE Document [<!ENTITY x "y">]>\n' + TP.testFiles.generate({ version: '03', transactions: 1 }).replace(/^<\?xml[^>]*\?>\n/, '');
      const r = await validateText(xml);
      return { ok: r.stopped === 'intake' && r.raw[0].rule === '0.8', detail: `stopped at: ${r.stopped || 'not stopped'}` };
    } }
  ];

  function validateText(xml, country = 'AT') {
    return TP.validation.validate({ bytes: enc(xml), fileName: 'test.xml', country });
  }

  async function runChecks() {
    if (!alive()) return;
    const list = $('chk-list');
    list.innerHTML = CHECKS.map((c, i) => `<li id="chk-${i}"><span class="res wait">…</span><span>${esc(c.label)}<small>Waiting</small></span><span></span></li>`).join('');
    $('chk-status').className = 'st busy'; $('chk-status').textContent = 'Running';
    report.checks = [];
    let passed = 0;
    for (let i = 0; i < CHECKS.length; i++) {
      let r;
      try { r = await CHECKS[i].run(); } catch (err) { r = { ok: false, detail: 'error: ' + (err.message || err) }; }
      if (!alive()) return;
      if (r.ok) passed++;
      report.checks.push({ label: CHECKS[i].label, ok: r.ok, detail: r.detail });
      $(`chk-${i}`).innerHTML = `<span class="res ${r.ok ? 'ok' : 'no'}">${r.ok ? '✓' : '✗'}</span><span>${esc(CHECKS[i].label)}<small>${esc(r.detail)}</small></span><span></span>`;
      renderOut();
    }
    $('chk-status').className = 'st ' + (passed === CHECKS.length ? 'good' : 'bad');
    $('chk-status').textContent = `${passed} of ${CHECKS.length} passed`;
  }

  /* ---------------- 3. speed ---------------- */
  const SIZES = [1000, 5000, 10000];
  async function runSpeed() {
    if (!alive()) return;
    $('speed-again').disabled = true;
    $('speed-status').className = 'st busy'; $('speed-status').textContent = 'Running';
    const target = (TP.validation.engines.config || {}).speedTarget || { transactions: 5000, seconds: 30 };
    $('speed-rows').innerHTML = SIZES.map(n => `<tr id="sp-${n}"><td>${n.toLocaleString('en-US')}</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td><div class="bar"><i></i></div></td><td>–</td></tr>`).join('');
    report.speed = [];
    let okTarget = null;
    for (const n of SIZES) {
      const row = $(`sp-${n}`);
      row.querySelector('.bar i').style.width = '15%';
      const xml = TP.testFiles.generate({ version: '03', transactions: n, blocks: 3 });
      const mb = (xml.length / 1048576).toFixed(1) + ' MB';
      row.children[1].textContent = mb;
      row.querySelector('.bar i').style.width = '45%';
      let r;
      try { r = await validateText(xml); } catch (err) { r = { error: String(err.message || err), timings: {} }; }
      if (!alive()) return;
      row.querySelector('.bar i').style.width = '100%';
      const t = r.timings || {};
      row.children[2].textContent = secs(t.xsd);
      row.children[3].textContent = secs(t.rules);
      row.children[4].textContent = secs(t.total);
      let res = '–';
      if (n === target.transactions && t.total != null) {
        okTarget = t.total < target.seconds * 1000;
        res = okTarget ? `✓ under ${target.seconds} s` : `✗ over ${target.seconds} s`;
        row.children[6].className = okTarget ? 'ok' : 'no';
      }
      row.children[6].textContent = r.error ? 'error: ' + r.error : res;
      report.speed.push({ transactions: n, size: mb, xsdMs: t.xsd, rulesMs: t.rules, totalMs: t.total, findings: r.raw ? r.raw.length : null, error: r.error || null });
      renderOut();
    }
    $('speed-status').className = 'st ' + (okTarget ? 'good' : 'bad');
    $('speed-status').textContent = okTarget ? 'Target met' : okTarget === false ? 'Target missed' : 'Done';
    $('speed-again').disabled = false;
  }

  /* ---------------- 4. results text ---------------- */
  function renderOut() {
    const e = report.engines;
    const L = [];
    L.push(`Testing Portal – technical check (${(TP.validation.engines.config || {}).version || ''})`);
    L.push(`Date: ${new Date().toISOString()}`);
    L.push(`Runs as: ${TP.platform.modeLabel()} · Browser: ${browserName()} · Downloads: ${report.downloads == null ? '?' : report.downloads ? 'yes' : 'no'}`);
    L.push(`User agent: ${navigator.userAgent}`);
    L.push('');
    L.push('Engines');
    if (e) {
      L.push(`  XSD check:   ${e.xsd && !e.xsd.error ? 'ready in ' + secs(e.xsd.loadMs) : 'FAILED ' + (e.xsd ? e.xsd.error : '')}`);
      L.push(`  Rule engine: ${e.rules && !e.rules.error ? `ready in ${secs(e.rules.loadMs)} (${e.rules.product} ${e.rules.version})` : 'FAILED ' + (e.rules ? e.rules.error : '')}`);
    } else L.push('  starting…');
    L.push('');
    L.push('Built-in checks');
    for (const c of report.checks) L.push(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.label} – ${c.detail}`);
    L.push('');
    L.push('Speed (transactions: XSD / rules / total)');
    for (const s of report.speed) L.push(`  ${s.transactions}: ${secs(s.xsdMs)} / ${secs(s.rulesMs)} / ${secs(s.totalMs)}${s.error ? ' ERROR ' + s.error : ''}`);
    if (alive()) $('out').value = L.join('\n');
  }

  function setupOut() {
    const msg = (t, bad) => { if (!alive()) return; $('out-msg').textContent = t; $('out-msg').className = 'tmsg' + (bad ? ' bad' : ''); setTimeout(() => { if (alive()) $('out-msg').textContent = ''; }, 4000); };
    $('out-copy').addEventListener('click', async () => msg(await TP.platform.copyText($('out').value) ? 'Copied.' : 'Copy did not work. Select the text and copy it.', false));
    $('out-dl').addEventListener('click', async () => {
      try { await TP.platform.download('testing-portal-check-results.txt', $('out').value, 'text/plain;charset=utf-8'); msg('Saved.'); }
      catch (err) { msg(err.code === 'declined' ? 'Download cancelled.' : `Download not possible here (${err.code || err.message}).`, true); }
    });
    $('speed-again').addEventListener('click', runSpeed);
  }

  function render() {
    return `<section class="wrap tc">
      <a class="link back" href="#about" data-fid="back">${'<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>'}About</a>
      <h1 tabindex="-1">Technical check</h1>
      <p class="lead">Checks that the validation engines work in this browser and how fast they are. Made-up files only; nothing is sent anywhere.</p>
      <div class="tc-grid">
        <section class="panel" aria-labelledby="h-eng">
          <h2 id="h-eng"><span class="n">1</span>Engines <span class="st idle" id="eng-status">Starting</span></h2>
          <dl class="kv">
            <div><dt>XSD check<small>libxml2, WebAssembly</small></dt><dd id="eng-xsd"><span class="st busy">Loading</span></dd></div>
            <div><dt>Rule engine<small>SaxonJS, compiled Schematron rules</small></dt><dd id="eng-rules"><span class="st busy">Loading</span></dd></div>
            <div><dt>Background workers<small>Validation runs without freezing the page</small></dt><dd id="eng-workers"><span class="st busy">Loading</span></dd></div>
            <div><dt>Runs as</dt><dd id="eng-mode">…</dd></div>
            <div><dt>Downloads</dt><dd id="eng-dl">…</dd></div>
            <div><dt>Browser</dt><dd id="eng-browser">…</dd></div>
          </dl>
        </section>
        <section class="panel" aria-labelledby="h-chk">
          <h2 id="h-chk"><span class="n">2</span>Built-in check <span class="st idle" id="chk-status">Waiting</span></h2>
          <p class="help">Made-up files with known problems go through the whole validation. Each line compares the result with what is expected.</p>
          <ul class="checks" id="chk-list"></ul>
        </section>
        <section class="panel wide" aria-labelledby="h-speed">
          <h2 id="h-speed"><span class="n">3</span>Speed <span class="st idle" id="speed-status">Waiting</span></h2>
          <p class="help">Made-up pain.001.001.03 files in three blocks. The XSD check and the rules run at the same time. Target: 5,000 transactions in under 30 seconds.</p>
          <div class="tblwrap"><table class="tbl speed">
            <thead><tr><th>Transactions</th><th class="num">File size</th><th class="num">XSD check</th><th class="num">Rules</th><th class="num">Total</th><th>Progress</th><th>Target</th></tr></thead>
            <tbody id="speed-rows"></tbody>
          </table></div>
          <div class="acts"><button class="btn sec sm" id="speed-again" disabled>Run the speed test again</button></div>
        </section>
        <section class="panel wide" aria-labelledby="h-out">
          <h2 id="h-out"><span class="n">4</span>Results to send</h2>
          <p class="help">A plain-text summary of this page. Copy it and paste it into the chat, so the results of your browser can be compared with the build.</p>
          <textarea class="out" id="out" readonly aria-label="Results as text"></textarea>
          <div class="acts">
            <button class="btn pri sm" id="out-copy">Copy results</button>
            <button class="btn sec sm" id="out-dl">Download results (.txt)</button>
            <span class="tmsg" id="out-msg" role="status"></span>
          </div>
        </section>
      </div>
    </section>`;
  }

  let run = 0, mine = 0;
  const alive = () => mine === run && !!document.getElementById('chk-list');

  async function mount() {
    mine = ++run;
    report.checks = []; report.speed = [];
    setupOut();
    renderOut();
    const ok = await startEngines();
    if (!ok) { if (alive()) { report.errors.push('engines'); renderOut(); } return; }
    await runChecks();
    await runSpeed();
  }

  TP.ui = TP.ui || {};
  TP.ui.technicalCheck = { render, mount };
})(typeof self !== 'undefined' ? self : globalThis);
