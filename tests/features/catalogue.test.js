/*
 * Testing Portal – tests of the Catalogue screen (0.4.1-m3, docs/specs/M3-catalogue.md):
 * the data file is the conversion of the catalogue document, its checks are the
 * checks of config/catalogue.json with the same severities and codes, "Built in"
 * matches the code, and the screen (js/ui/catalogue.js), the menu and the About
 * page show what they should.
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async t => {
  const { ok, head, catalogue, TP, ROOT } = t;
  const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const conv = require(path.join(ROOT, 'tools/update-catalogue.js'));
  const doc = JSON.parse(read(conv.OUT));
  const settings = JSON.parse(read('config/settings.json'));
  const rows = conv.checkRows(doc);
  const byId = new Map(rows.map(r => [r.id, r]));

  head('catalogue: data');
  ok(read(conv.OUT) === conv.text(conv.convert(read(conv.SOURCE))), `${conv.OUT} is the conversion of ${conv.SOURCE} (run node tools/update-catalogue.js after a new export)`);
  ok(doc.title && /^\d{4}-\d{2}-\d{2}$/.test(doc.date) && doc.owner && doc.lead, 'title, date, owner and lead of the document', `${doc.title} · ${doc.date} · ${doc.owner}`);
  const ids = ['flow', ...Array.from({ length: 11 }, (_, i) => `stage-${i}`), 'decisions', 'report', 'scope', 'open', 'sources'];
  ok(JSON.stringify(doc.sections.map(s => s.id)) === JSON.stringify(ids), 'the whole document: flow, stages 0–10, decisions, report, out of scope, open points, sources', doc.sections.map(s => s.id).join(' '));
  const dup = rows.map(r => r.id).filter((id, i, a) => a.indexOf(id) !== i);
  ok(!dup.length, 'every check once', dup.join(', '));
  const app = new Set([...Object.keys(catalogue.rules), ...Object.keys(catalogue.notImplemented || {})]);
  const missing = [...app].filter(id => !byId.has(id)), extra = rows.filter(r => !app.has(r.id)).map(r => r.id);
  ok(!missing.length && !extra.length, `the checks of the document are the checks of config/catalogue.json (${rows.length})`, `missing in the document: ${missing.join(', ')} · not in catalogue.json: ${extra.join(', ')}`);

  // status and Built in follow catalogue.json: not built, covered by
  const badStatus = rows.filter(r => {
    const notBuilt = r.id in (catalogue.notImplemented || {}), covered = !!(catalogue.rules[r.id] || {}).coveredBy;
    return (r.status === 'notbuilt') !== notBuilt || (r.status === 'covered') !== covered || ((r.built === '–') !== (notBuilt || covered));
  }).map(r => `${r.id} ${r.status} ${r.built}`);
  ok(!badStatus.length, '"Not built" and "Covered by" as in catalogue.json, and only those have no Built in', badStatus.join('; '));

  // severity and code: the document says what the app reports with the built-in settings
  const sevOf = (id, part) => {
    const r = catalogue.rules[id], s = (settings.checks || {})[part ? `${id}-${part}` : id] || {};
    return s.severity || (part ? ((r.parts || {})[part] || {}).sev : null) || (part ? null : r.sev);
  };
  const sevBad = [];
  for (const r of rows) {
    const c = catalogue.rules[r.id];
    if (!c) continue;
    const m = /^([EWI])(?:\/([EWI]))?(?: \((?:.*? ([EWI])|([EWI]) .*?)\))?$/.exec(r.sev);
    if (!m) { sevBad.push(`${r.id}: "${r.sev}"`); continue; }
    if (m[1] !== sevOf(r.id)) sevBad.push(`${r.id}: ${m[1]} in the document, ${sevOf(r.id)} in the app`);
    const second = m[2] || m[3] || m[4];
    if (second && !Object.keys(c.parts || {}).some(p => sevOf(r.id, p) === second)) sevBad.push(`${r.id}: no part reported as ${second}`);
    const code = r.code == null || r.code === '–' ? null : r.code;
    if (r.code !== null && code !== (c.code || null)) sevBad.push(`${r.id}: code ${code} in the document, ${c.code} in the app`);
  }
  ok(!sevBad.length, 'severities, parts and reason codes of the document are the ones the app reports with the built-in settings', sevBad.join('; '));

  // Built in matches where the check is in the code
  const sch = fs.readdirSync(path.join(ROOT, 'rules/stages')).filter(f => f.endsWith('.sch')).map(f => read(`rules/stages/${f}`));
  const intake = read('js/validation/stages/stage0-intake.js') + read('js/validation/stages/stage1-identify.js');
  const xsdw = read('js/validation/xsd-worker.mjs');
  const inSch = id => sch.find(s => new RegExp(`<sch:(assert|report) id="R${id.replace('.', '\\.')}(-[a-z]+)?"`).test(s));
  const where = {
    JavaScript: id => intake.includes(`('${id}'`),
    'XML parser (libxml2)': id => xsdw.includes(`'${id}'`) && !inSch(id),
    'XSD (libxml2)': id => xsdw.includes(`rule: '${id}'`),
    Schematron: id => !!inSch(id),
    'Schematron + JS': id => !!inSch(id) && /js:tp(?!Setting|In\b|Country|Today|Now|Shift|Allowed|CheckOn|SelectedCountry|Limit|PaymentTypeLabel|CharsetLabel|CcyDecimals)[A-Z]\w*\(/.test(inSch(id))
  };
  const builtBad = rows.filter(r => r.built !== '–').filter(r => {
    const engine = r.built.split(': ')[0];
    return !where[engine] || !where[engine](r.id) || (r.built.endsWith('payment type') && !/js:tp(PaymentType|BlockType)\(/.test(inSch(r.id)));
  }).map(r => `${r.id} ${r.built}`);
  ok(!builtBad.length, '"Built in" matches the code: stage files, XSD worker, Schematron rule files and their JavaScript functions', builtBad.join('; '));

  head('catalogue: screen');
  require(path.join(ROOT, 'js/ui/common.js'));
  const C = require(path.join(ROOT, 'js/ui/catalogue.js'));
  const saved = TP.validation;
  try {
    TP.validation = { engines: { settings, settingsSource: { kind: 'built-in' } } };
    C.setData(doc);
    const html = C.render();
    const trs = html.match(/<tr data-st="[a-z]+" data-sev="[EWI ]*" data-q="/g) || [];
    ok(trs.length === 147, `147 check rows (${trs.length})`);
    ok(ids.every(id => html.includes(`id="cat-${id}"`)), 'every section of the document is on the screen');
    ok(!/href="#(?!about"|catalogue")/.test(html.replace(/href="https:[^"]+"/g, '')), 'no #anchors inside the page (the address after # is the screen)');
    const count = st => (html.match(new RegExp(`<tr data-st="${st}"`, 'g')) || []).length;
    ok(count('yes') === 120 && count('off') === 15 && count('covered') === 4 && count('notbuilt') === 7 && count('silent') === 1, 'status as in the document with the built-in settings: 120 run, 15 off, 4 covered, 7 not built, 1 cannot fire',
      ['yes', 'off', 'covered', 'notbuilt', 'silent'].map(s => `${s} ${count(s)}`).join(', '));
    const rowOf = (h, id) => (new RegExp(`<tr [^>]*><td class="id" data-l="ID">${id.replace('.', '\\.')}</td>[^]*?</tr>`).exec(h) || [''])[0];
    ok(/Settings in use: part <b>lines<\/b> switched off/.test(rowOf(html, '4.30')) && /Settings in use: part <b>age<\/b> reported as a warning/.test(rowOf(html, '4.2'))
      && /Settings in use: reported as a warning/.test(rowOf(html, '7.13')), 'the built-in settings show on 4.2 (age), 4.30 (lines) and 7.13');
    ok(/btag schjs">Schematron \+ JS<\/span><span class="brest">payment type/.test(rowOf(html, '7.1')) && /btag js">JavaScript/.test(rowOf(html, '0.1')) && /btag xsd">XSD \(libxml2\)/.test(rowOf(html, '2.x')),
      'Built in: tag and what the JavaScript does');
    ok(/<a class="link" href="https:\/\/trade\.ec\.europa\.eu\/[^"]+" target="_blank" rel="noopener">euro adoption on 1 January 2026<\/a>/.test(rowOf(html, '7.23')), 'links of the document open in a new tab');

    // a settings file loaded for the session: 5.1 switched off, 9.3 an error
    TP.validation.engines.settings = { ...settings, checks: { ...settings.checks, '5.1': { enabled: false }, '9.3': { severity: 'E' } } };
    TP.validation.engines.settingsSource = { kind: 'session', name: 'strict.json' };
    const h2 = C.render();
    ok(/^<tr data-st="off"/.test(rowOf(h2, '5.1')) && /atag off">Off<\/span><span class="atag yes was">Runs/.test(rowOf(h2, '5.1')) && /Settings in use: switched off/.test(rowOf(h2, '5.1')),
      'a check switched off by the settings in use counts as Off, with the document status crossed out');
    ok(/Settings in use: reported as an error/.test(rowOf(h2, '9.3')) && h2.includes('<b>strict.json</b>, loaded for this session'), 'a changed severity and the name of the loaded settings file are shown');
    ok(/<dt>Off<\/dt><dd>16<\/dd>/.test(h2) && /<dt>Run<\/dt><dd>119<\/dd>/.test(h2), 'the counts follow the settings in use');

    ok(C.inline('[x](javascript:alert(1)) <b>') === '[x](javascript:alert(1)) &lt;b&gt;' && C.inline('`a` **b**') === '<span class="code">a</span> <b>b</b>', 'only https links become links; text is escaped');

    C.setData(null);
    ok(/Loading the catalogue/.test(C.render()), 'before the data file is read the screen says it is loading');
  } finally {
    TP.validation = saved;
    C.setData(null);
  }

  head('catalogue: menu and About');
  const index = read('index.html');
  const nav = (/<nav aria-label="Main">([^]*?)<\/nav>/.exec(index) || [])[1] || '';
  ok(JSON.stringify((nav.match(/>([A-Za-z]+)<\/a>/g) || []).map(s => s.slice(1, -4))) === '["Validate","Catalogue","About"]', 'menu: Validate · Catalogue · About', nav);
  ok(index.indexOf('js/ui/catalogue.js') > 0 && index.indexOf('js/ui/catalogue.js') < index.indexOf('js/app.js') && index.includes('css/catalogue.css'), 'the screen and its styles are loaded before the app starts');
  ok(/add\('config\/catalogue-doc\.json'\)/.test(read('tools/build.js')), 'the offline file embeds the catalogue data');
  require(path.join(ROOT, 'js/ui/about.js'));
  const platform = TP.platform;
  TP.platform = { modeLabel: () => 'Test' };
  const savedV = TP.validation;
  TP.validation = { engines: { config: { version: 'x', countries: [] }, manifest: { ruleSets: [] }, catalogue, settings, settingsSource: { kind: 'built-in' }, countries: {} } };
  try {
    const about = TP.ui.about.render({});
    ok(about.includes('href="#catalogue"') && !/Not possible yet|stagetbl|Checks in this version/.test(about), 'About links to the Catalogue page instead of listing the checks');
    ok(/<h2>Settings<\/h2>/.test(about) && /<h2>Limits<\/h2>/.test(about) && /<h2>This version<\/h2>/.test(about), 'About keeps This version, Limits and Settings');
  } finally { TP.validation = savedV; TP.platform = platform; }
  const appJson = JSON.parse(read('config/app.json'));
  ok(appJson.version === '0.4.1-m3' && /^## 0\.4\.1-m3 /m.test(read('docs/CHANGELOG.md')), 'version 0.4.1-m3 in config/app.json and the changelog');
};
