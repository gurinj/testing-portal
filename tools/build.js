#!/usr/bin/env node
/*
 * Testing Portal – build script.
 *
 *   node tools/build.js              compile rules, copy files, run tests, build the offline file
 *   node tools/build.js --no-tests   the same without the tests
 *
 * Needs only Node.js. All tools come from tools/vendor/, nothing is downloaded.
 *
 * Output:
 *   dist/site/                 the separate files (GitHub Pages later, or python -m http.server)
 *   dist/testing-portal.html   the same app as one file, for offline use
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'tools/vendor');
const NM = path.join(VENDOR, 'node_modules');
const XSLT3 = path.join(NM, 'xslt3/xslt3.js');
const SCHXSLT = path.join(VENDOR, 'schxslt-1.9.5/2.0/pipeline-for-svrl.xsl');
const TMP = path.join(ROOT, 'build-tmp');
const DIST = path.join(ROOT, 'dist');
const SITE = path.join(DIST, 'site');
const args = new Set(process.argv.slice(2));

const log = (...a) => console.log('[build]', ...a);
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const read = p => fs.readFileSync(p, 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
function copyDir(src, dst, filter = () => true) {
  if (!fs.existsSync(src)) return;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (!filter(s, e)) continue;
    if (e.isDirectory()) copyDir(s, d, filter);
    else { fs.mkdirSync(dst, { recursive: true }); fs.copyFileSync(s, d); }
  }
}
function xslt3(argv) {
  return execFileSync(process.execPath, [XSLT3, ...argv], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

/* ---------------------------------------------------------------- rules */

function ruleSources() {
  const dirs = ['rules/stages', 'rules/countries'];
  const out = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter(f => f.endsWith('.sch')).sort()) out.push(path.join(abs, f));
  }
  return out;
}

function ruleMeta(file, text) {
  const pi = /<\?testing-portal\s+([^?]*)\?>/.exec(text);
  const attrs = {};
  if (pi) for (const m of pi[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  const id = rel(file).replace(/^rules\//, '').replace(/\.sch$/, '');
  const versions = attrs.versions ? attrs.versions.split(/\s+/) : ['03', '09'];
  const countries = !attrs.countries || attrs.countries === '*' ? '*' : attrs.countries.split(/\s+/);
  const stage = attrs.stage ? +attrs.stage : null;
  return { id, stage, versions, countries };
}

/* The compiled rules visit every node. When no rule context targets an
   attribute or a text node, visiting only elements gives the same result
   and is faster. */
function elementOnlyTraversal(xsl, schText) {
  const contexts = [...schText.matchAll(/<sch:rule\b[^>]*\bcontext="([^"]*)"/g)].map(m => m[1]);
  const safe = contexts.every(c => !/@|text\(\)|node\(\)|comment\(\)|processing-instruction/.test(c));
  if (!safe) return { xsl, changed: false };
  const out = xsl
    .replace(/<xsl:apply-templates mode="#current" select="@\*"\/>/g, '')
    .replace(/<xsl:apply-templates mode="#current" select="node\(\)"\/>/g, '<xsl:apply-templates mode="#current" select="*"/>');
  return { xsl: out, changed: out !== xsl };
}

/*
 * SchXslt builds the location of every finding with xsl:number for each
 * ancestor: slow when thousands of transactions fail the same rule (each
 * location counts all earlier siblings again). The compiled rules call the
 * JavaScript function tpLocation instead (js/validation/functions/location.js),
 * which counts the children of a parent only once.
 */
function fastLocation(xsl) {
  const start = xsl.indexOf('<xsl:function name="schxslt:location"');
  const end = xsl.indexOf('</xsl:function>', start);
  if (start < 0 || end < 0) throw new Error('schxslt:location not found; SchXslt changed?');
  const fn = `<xsl:function xmlns:js="http://saxonica.com/ns/globalJS" name="schxslt:location" as="xs:string">
      <xsl:param name="node" as="node()"/>
      <xsl:sequence select="if ($node instance of attribute()) then concat(js:tpLocation($node/..), '/@', local-name($node)) else js:tpLocation($node)"/>
   `;
  return xsl.slice(0, start) + fn + xsl.slice(end);
}

/*
 * SchXslt writes an svrl:fired-rule element for every node a rule visits
 * (10,000 transactions: 10,000 elements per rule, 0.5 MB of SVRL per rule file),
 * then regroups all of them by pattern. The app reads only the failed asserts
 * and successful reports, so the compiled rules leave the fired rules out and
 * copy the results in one step. Same findings, about 40 % faster (M2, measured
 * on 10,000 transactions).
 */
function slimReport(xsl) {
  let out = xsl
    .replace(/<svrl:fired-rule\b[^>]*>\s*<xsl:attribute name="context">[^<]*<\/xsl:attribute>\s*<\/svrl:fired-rule>/g, '')
    .replace(/<xsl:comment\b[^>]*>WARNING: Rule for context[^<]*<\/xsl:comment>\s*<svrl:suppressed-rule\b[^>]*>\s*<xsl:attribute name="context">[^<]*<\/xsl:attribute>\s*<\/svrl:suppressed-rule>/g, '');
  const regroup = /<xsl:for-each select="\$report\/schxslt:document">\s*<xsl:for-each select="schxslt:pattern">\s*<xsl:sequence select="node\(\)"\/>\s*<xsl:sequence select="\.\.\/schxslt:rule\[@pattern = current\(\)\/@id\]\/node\(\)"\/>\s*<\/xsl:for-each>\s*<\/xsl:for-each>/;
  if (!regroup.test(out)) throw new Error('SchXslt report grouping not found; SchXslt changed?');
  out = out.replace(regroup, '<xsl:sequence select="$report/schxslt:document/schxslt:rule/node()"/>');
  return out;
}

function compileRules() {
  fs.mkdirSync(TMP, { recursive: true });
  const pipelineSef = path.join(TMP, 'schxslt-pipeline.sef.json');
  if (!fs.existsSync(pipelineSef) || fs.statSync(pipelineSef).mtimeMs < fs.statSync(SCHXSLT).mtimeMs) {
    log('compiling SchXslt');
    xslt3([`-xsl:${SCHXSLT}`, `-export:${pipelineSef}`, '-nogo', '-relocate:on']);
  }
  const manifest = { built: new Date().toISOString(), ruleSets: [] };
  // Rule files are written for pain.001.001.03. For every other version
  // listed in the file, the namespace is replaced and the file compiled again,
  // so one rule file covers .03 and .09.
  const NS03 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';
  for (const file of ruleSources()) {
    const text = read(file);
    const meta = ruleMeta(file, text);
    if (!/<sch:pattern\b/.test(text)) { log(`skipped ${rel(file)} (no rules yet)`); continue; }
    const rules = [...text.matchAll(/<sch:(?:assert|report)\b[^>]*\bid="([^"]+)"/g)].map(m => m[1].replace(/^R/, '').split('-')[0]);
    rules.splice(0, rules.length, ...new Set(rules)); // R4.2-future and R4.2-age are both check 4.2
    for (const v of meta.versions) {
      const base = `${meta.id.replace(/[\/\\]/g, '--')}@${v}`;
      const src = path.join(TMP, `${base}.sch`);
      write(src, text.split(NS03).join(`urn:iso:std:iso:20022:tech:xsd:pain.001.001.${v}`));
      const xslPath = path.join(TMP, `${base}.xsl`);
      xslt3([`-xsl:${SCHXSLT}`, `-s:${src}`, `-o:${xslPath}`]);
      const t = elementOnlyTraversal(read(xslPath), text);
      write(xslPath, slimReport(fastLocation(t.xsl)));
      const sefRel = `rules/compiled/${base}.sef.json`;
      xslt3([`-xsl:${xslPath}`, `-export:${path.join(SITE, sefRel)}`, '-nogo', '-relocate:on']);
      manifest.ruleSets.push({ id: `${meta.id}@${v}`, source: rel(file), stage: meta.stage, versions: [v], countries: meta.countries, file: sefRel, rules, elementOnly: t.changed });
    }
    log(`compiled ${rel(file)} for ${meta.versions.map(v => '.' + v).join(' and ')}: ${rules.length} rules`);
  }
  write(path.join(SITE, 'rules/manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

/* ---------------------------------------------------------------- site */

function copySite() {
  write(path.join(SITE, 'index.html'), read(path.join(ROOT, 'index.html')));
  for (const d of ['css', 'fonts', 'js', 'lib', 'schemas', 'config']) copyDir(path.join(ROOT, d), path.join(SITE, d));
  log('copied site files');
}

/* ---------------------------------------------------------------- offline file */

function bundleRulesWorker() {
  const dir = path.join(SITE, 'js/validation');
  const src = read(path.join(dir, 'rules-worker.js'));
  const block = /\/\* scripts:start \*\/([\s\S]*?)\/\* scripts:end \*\//.exec(src);
  const list = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const parts = ['var TP_WORKER_BUNDLED = true;'];
  for (const p of list) parts.push(`/* ---- ${p} ---- */\n` + read(path.join(dir, p)));
  parts.push('/* ---- rules-worker.js ---- */\n' + src);
  return parts.join('\n;\n');
}

/* The XSD worker runs as a classic worker in the offline file: browsers do
   not start a module worker from a blob: URL on a page opened from disk.
   The libxml2 bundle is therefore wrapped in an async function (it uses a
   top-level await), import.meta.url is replaced and the export lists removed. */
function bundleXsdWorker() {
  let lib = read(path.join(SITE, 'lib/libxml2/libxml2-wasm.esm.js'));
  const m = /export\s*\{([^}]*)\};?\s*$/.exec(lib);
  if (!m) throw new Error('libxml2 bundle: export list not found');
  const members = m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [local, , exported] = s.split(/\s+/);
    return `${exported || local}: ${local}`;
  });
  lib = lib.slice(0, m.index) + `const TPLX = { ${members.join(', ')} };\n`;
  lib = lib.replace(/import\.meta\.url/g, 'self.location.href');
  if (/\bimport\.meta\b/.test(lib)) throw new Error('libxml2 bundle: unexpected import.meta');
  const worker = read(path.join(SITE, 'js/validation/xsd-worker.mjs'))
    .replace(/^import \* as TPLX from [^\n]+\n/m, '')
    .replace(/^export function /gm, 'function ');
  return '(async () => {\n' + lib + '\n' + worker + '\n})().catch(err => self.postMessage({ type: \'error\', error: \'XSD worker: \' + String(err && (err.stack || err.message) || err) }));\n';
}

function embeddedFiles(manifest) {
  const files = {};
  const add = p => { files[p] = { enc: 'text', data: read(path.join(SITE, p)) }; };
  add('config/app.json');
  add('config/catalogue.json');
  add('config/fixes.json');
  add('config/settings.json');
  add('rules/manifest.json');
  for (const s of manifest.ruleSets) add(s.file);
  for (const f of fs.readdirSync(path.join(SITE, 'schemas'))) add(`schemas/${f}`);
  for (const d of ['config/countries', 'config/reference', 'config/templates']) {
    const abs = path.join(SITE, d);
    if (fs.existsSync(abs)) for (const f of fs.readdirSync(abs)) if (f.endsWith('.json')) add(`${d}/${f}`);
  }
  return files;
}

function inlineCss(cssPath) {
  const dir = path.dirname(cssPath);
  return read(cssPath).replace(/url\(["']?([^"')]+\.woff2)["']?\)/g, (all, u) => {
    const f = path.resolve(dir, u);
    return `url("data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}")`;
  });
}

/* The offline file embeds third-party code, so it carries their notices. */
function thirdPartyNotices() {
  const files = ['lib/saxon/LICENSE.txt', 'lib/libxml2/LICENSE', 'lib/libxml2/LICENSE.libxml2', 'lib/saxes/LICENSE.txt', 'lib/saxes/LICENSE.xmlchars', 'fonts/OFL-Figtree.txt'];
  const text = files.map(f => `===== ${f} =====\n${read(path.join(SITE, f))}`).join('\n\n');
  if (/<\/script/i.test(text)) throw new Error('notice text contains </script');
  return `<script type="text/plain" id="third-party-notices">\nThird-party software in this file. SaxonJS is used unchanged under the Saxonica licence below.\n\n${text}\n</script>`;
}

function buildOffline(manifest) {
  let html = read(path.join(SITE, 'index.html'));
  const safeJson = o => JSON.stringify(o).replace(/</g, '\\u003c');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (all, href) =>
    `<style>/* ${href} */\n${inlineCss(path.join(SITE, href))}</style>`);
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (all, src) => {
    const code = read(path.join(SITE, src));
    if (/<\/script/i.test(code)) throw new Error(`${src} contains </script`);
    return `<script>/* ${src} */\n${code}</script>`;
  });
  const embedded = { files: embeddedFiles(manifest), workers: { rules: bundleRulesWorker(), xsd: bundleXsdWorker() } };
  const tag = `<script>window.TP_EMBEDDED = ${safeJson(embedded)};</script>\n` + thirdPartyNotices();
  html = html.replace(/<script>/, () => tag + '\n<script>'); // function form: the bundle contains $-patterns
  const out = path.join(DIST, 'testing-portal.html');
  write(out, html);
  log(`offline file: ${rel(out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
}

/* ---------------------------------------------------------------- main */

function main() {
  const t0 = Date.now();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(SITE, { recursive: true });
  copySite();
  const manifest = compileRules();
  if (!args.has('--no-tests')) {
    log('running tests');
    execFileSync(process.execPath, [path.join(ROOT, 'tests/run-tests.js')], { cwd: ROOT, stdio: 'inherit' });
    // the bank's test files, if there are any on this PC: lists what changed since they were recorded (does not stop the build)
    const bank = path.join(ROOT, 'tests/files/bank');
    if (fs.existsSync(bank) && fs.readdirSync(bank).some(f => !f.startsWith('.'))) {
      log("bank's test files");
      execFileSync(process.execPath, [path.join(ROOT, 'tests/run-bank.js'), '--quiet'], { cwd: ROOT, stdio: 'inherit' });
    }
  }
  buildOffline(manifest);
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

try { main(); } catch (err) { console.error('[build] FAILED:', err.message); process.exit(1); }
