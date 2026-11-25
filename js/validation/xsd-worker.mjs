/*
 * Testing Portal – XSD worker (module Web Worker).
 * Checks well-formedness (stage 0) and the official ISO schema (stage 2)
 * with libxml2 compiled to WebAssembly. Every error is reported with its
 * line, the element path, the actual value and the catalogue check (2.1–2.11).
 *
 * In the offline file, tools/build.js replaces the import line below with
 * the libxml2 bundle itself and runs this file as a classic worker.
 *
 * Messages in:  { type: 'init', schemas: { '03': xsdText, '09': xsdText } }
 *               { type: 'validate', id, xml, version }
 * Messages out: { type: 'loaded' } { type: 'ready', info }  { type: 'result', id, ... }  { type: 'error', id, error }
 */
import * as TPLX from '../../lib/libxml2/libxml2-wasm.esm.js';

const validators = {};
const schemaInfo = {};
const MAX_ERRORS = 5000;

/* Element names and the options of every xs:choice, read from the schema text once. */
function analyseSchema(text) {
  const attr = (tag, a) => (new RegExp(`\\b${a}="([^"]+)"`).exec(tag) || [])[1];
  const known = new Set([...text.matchAll(/<xs:element\b[^>]*>/g)].map(m => attr(m[0], 'name')).filter(Boolean));
  const choices = [], choiceSets = [];
  for (const m of text.matchAll(/<xs:choice\b[^>]*>([\s\S]*?)<\/xs:choice>/g)) {
    const names = [...m[1].matchAll(/<xs:element\b[^>]*>/g)].map(e => attr(e[0], 'name')).filter(Boolean);
    if (names.length) { choices.push(names.slice().sort().join(',')); choiceSets.push(new Set(names)); }
  }
  return { known, choices: new Set(choices), choiceSets };
}

export function compileSchemas(lx, schemas) {
  for (const [v, text] of Object.entries(schemas)) {
    const doc = lx.XmlDocument.fromString(text);
    validators[v] = lx.XsdValidator.fromDoc(doc);
    schemaInfo[v] = analyseSchema(text);
  }
  return Object.keys(validators);
}

const clean = m => String(m || '').replace(/\{urn:iso:std:iso:20022:tech:xsd:[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
const list = s => String(s || '').replace(/[{}()']/g, '').split(',').map(x => x.trim()).filter(Boolean);

/* libxml2 message -> catalogue check, readable message, actual and expected value */
export function classify(raw, ctx) {
  const m = clean(raw);
  const el = (/^Element '([^']+)'/.exec(m) || [])[1] || ctx.name || 'element';
  const attr = (/attribute '([^']+)'/.exec(m) || [])[1] || null;
  const value = (/The value '([^']*)'/.exec(m) || /^Element '[^']+'(?:, attribute '[^']+')?: '([^']*)' is not a valid value/.exec(m) || [])[1];
  let f;
  if (/Missing child element\(s\)/.test(m)) {
    const exp = list((/Expected is(?: one of)? \(([^)]*)\)/.exec(m) || [])[1]);
    const choice = !!(ctx.info && exp.length > 1 && ctx.info.choices.has(exp.slice().sort().join(',')));
    f = { rule: choice ? '2.5' : '2.2', message: `${el}: ${choice ? 'one of the options is' : 'a mandatory element is'} missing. Expected: ${exp.join(', ')}.`, expected: exp.join(', '), expectedList: exp };
  } else if (/This element is not expected/.test(m)) {
    const exp = list((/Expected is(?: one of)? \(([^)]*)\)/.exec(m) || [])[1]);
    const following = ctx.following || [];
    const known = !ctx.info || ctx.info.known.has(el);
    const sameChoice = ctx.prevName && ctx.info && ctx.info.choiceSets.some(c => c.has(el) && c.has(ctx.prevName));
    if (exp.includes(el)) {
      f = { rule: '2.4', message: `${el} is not in the namespace of the message. Check the xmlns of this element and its parents.` };
    } else if (!known) {
      f = { rule: '2.4', message: `${el} is not an element of this message.${exp.length ? ` Expected here: ${exp.join(', ')}.` : ''}`, expected: exp.join(', ') || null };
    } else if (ctx.prevName === el) {
      f = { rule: '2.3', message: `${el} occurs more often than allowed.${exp.length ? ` Expected here: ${exp.join(', ')}.` : ''}`, expected: exp.join(', ') || null };
    } else if (sameChoice) {
      f = { rule: '2.5', message: `${ctx.prevName} and ${el} are options of one choice: only one of them is allowed.`, expected: `${ctx.prevName} or ${el}` };
    } else if (exp.length && !exp.some(x => following.includes(x))) {
      f = { rule: '2.2', message: `A mandatory element is missing before ${el}. Expected: ${exp.join(', ')}.`, expected: exp.join(', '), missingBefore: true };
    } else {
      f = { rule: '2.1', message: `${el} is not allowed at this position.${exp.length ? ` Expected here: ${exp.join(', ')}.` : ''}`, expected: exp.join(', ') || null };
    }
    f.notExpected = true;
    f.expectedList = exp;
  } else if (/The attribute '[^']+' is not allowed/.test(m)) {
    f = { rule: '2.4', message: `${el}: the attribute ${attr} is not allowed.` };
  } else if (/The attribute '([^']+)' is required but missing/.test(m)) {
    const a = /The attribute '([^']+)' is required/.exec(m)[1];
    f = a === 'Ccy' ? { rule: '2.9', message: `${el}: the currency attribute Ccy is missing.`, expected: 'Ccy="EUR" or another currency code' }
                    : { rule: '2.2', message: `${el}: the attribute ${a} is missing.` };
  } else if (/\[facet '(maxLength|minLength|length)'\]/.test(m)) {
    const len = (/has a length of '(\d+)'/.exec(m) || [])[1];
    const max = (/maximum length of '(\d+)'/.exec(m) || [])[1];
    const min = (/minimum length of '(\d+)'/.exec(m) || [])[1];
    f = max ? { rule: '2.6', message: `${el}: the text has ${len} characters; at most ${max} are allowed.`, expected: `at most ${max} characters` }
        : min === '1' || len === '0' ? { rule: '2.6', message: `${el} is empty.`, expected: 'a value' }
        : { rule: '2.6', message: `${el}: the text has ${len} characters; at least ${min} are needed.`, expected: `at least ${min} characters` };
  } else if (/\[facet 'pattern'\]/.test(m)) {
    f = { rule: '2.7', message: `${el}: the value '${value}' does not have the required format.`, expected: patternLabel(el) };
  } else if (/\[facet 'enumeration'\]/.test(m)) {
    const set = list((/set \{([^}]*)\}/.exec(m) || [])[1]);
    f = { rule: '2.8', message: `${el}: the value '${value}' is not one of ${set.join(', ')}.`, expected: set.join(', ') };
  } else if (/\[facet '(totalDigits|fractionDigits|minInclusive|maxInclusive|minExclusive|maxExclusive)'\]/.test(m)) {
    const facet = /\[facet '([^']+)'\]/.exec(m)[1];
    const why = { totalDigits: 'has too many digits', fractionDigits: 'has too many decimal places', minInclusive: 'is too small', minExclusive: 'is too small', maxInclusive: 'is too large', maxExclusive: 'is too large' }[facet];
    f = { rule: '2.9', message: `${el}: the amount '${value}' ${why}.`, expected: 'at most 18 digits and 5 decimals, not negative' };
  } else if (/is not a valid value of the atomic type '([^']+)'/.test(m)) {
    const type = /atomic type '([^']+)'/.exec(m)[1];
    if (/date|time|year/i.test(type)) {
      const dt = /datetime/i.test(type);
      f = { rule: '2.10', message: `${el}: '${value}' is not a valid ${dt ? 'ISO date and time' : 'ISO date'}.`, expected: dt ? 'YYYY-MM-DDThh:mm:ss' : 'YYYY-MM-DD' };
    } else if (/indicator|boolean/i.test(type)) {
      f = { rule: '2.11', message: `${el}: '${value}' is not true or false.`, expected: 'true or false' };
    } else if (/amount|decimal|number|rate|quantity/i.test(type)) {
      f = { rule: '2.9', message: `${el}: '${value}' is not a valid amount or number.`, expected: 'a number with a dot as decimal separator' };
    } else {
      f = { rule: '2.x', message: `${el}: '${value}' is not a valid value (${type}).` };
    }
  } else {
    f = { rule: '2.x', message: m };
  }
  const { notExpected, expectedList, missingBefore, ...pub } = f;
  return { ...pub, element: el, attribute: attr, actual: value != null ? value : null, raw: m, notExpected: !!notExpected, expectedList: expectedList || null, missingBefore: !!missingBefore };
}
function patternLabel(el) {
  return { IBAN: '2 letters, 2 check digits, up to 30 letters or digits', BIC: '8 or 11 characters: bank, country, location, branch',
    BICFI: '8 or 11 characters: bank, country, location, branch', Ctry: 'ISO country code, 2 capital letters', CtryOfRes: 'ISO country code, 2 capital letters',
    Ccy: 'ISO currency code, 3 capital letters', UETR: 'UUID, e.g. 8a562c67-ca16-48ba-b074-65581be6f001', LEI: '20 letters or digits' }[el] || 'the format of the ISO schema';
}

/* ------------------------------------------------------------------ where */

// One step of a libxml2 node path: "*[3]" (default namespace, 3rd element child),
// "p:PmtInf[2]" (prefix, 2nd PmtInf) or "Document".
const STEP = /^(?:([\w.-]+):)?([\w.-]+|\*)(?:\[(\d+)\])?$/;

// element children of a node, listed once per pass: name, position among
// siblings of the same name, index among all element children
function childrenOf(node, key, cache) {
  let c = cache.get(key);
  if (!c) {
    const count = new Map();
    const list = node.find('*').map((el, idx) => {
      const name = el.name;
      const pos = (count.get(name) || 0) + 1;
      count.set(name, pos);
      return { el, name, pos, idx };
    });
    const byName = new Map();
    for (const x of list) { if (!byName.has(x.name)) byName.set(x.name, []); byName.get(x.name).push(x); }
    c = { list, byName };
    cache.set(key, c);
  }
  return c;
}

/*
 * libxml2 node path -> the element, its path with names and positions
 * ("/Document[1]/CstmrCdtTrfInitn[1]/PmtInf[1]/PmtMtd[1]"), its value if it
 * is a leaf, the names before and after it. Each parent's children are
 * listed once per pass, so many errors in a large file stay fast.
 */
function describe(doc, ixpath, cache) {
  if (!ixpath) return null;
  try {
    const steps = ixpath.split('/').filter(Boolean).map(st => STEP.exec(st));
    if (!steps.length || steps.some(m => !m)) return null;
    let node = doc.root;
    if (!node) return null;
    let named = `/${node.name}[1]`, parentKey = null, self = null, prefix = steps[0][1] || null;
    for (let i = 1; i < steps.length; i++) {
      const [, pfx, name, pos] = steps[i];
      const ch = childrenOf(node, named, cache);
      const x = name === '*' ? ch.list[(+pos || 1) - 1] : (ch.byName.get(name) || [])[(+pos || 1) - 1];
      if (!x) return null;
      parentKey = named;
      self = x;
      prefix = pfx || null;
      node = x.el;
      named += `/${x.name}[${x.pos}]`;
    }
    const kids = childrenOf(node, named, cache).list;
    let value = null;
    if (!kids.length) { const c = node.content.trim(); value = c.length > 300 ? c.slice(0, 300) + '…' : c; }
    const siblings = parentKey ? cache.get(parentKey).list : [];
    return {
      path: named, value, el: node, name: node.name, prefix, parentKey,
      prevName: self && self.idx > 0 ? siblings[self.idx - 1].name : null,
      following: self ? siblings.slice(self.idx + 1).map(x => x.name) : [],
      idx: self ? self.idx : 0
    };
  } catch (err) {
    return null;
  }
}

/*
 * Line and column of element paths, from the text of the file. libxml2 gives
 * only a line, and on a file without line breaks every error would be on
 * line 1. One pass over the file, only when there are errors.
 */
export function locate(xml, paths) {
  const out = new Map();
  if (!paths.size) return out;
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const stack = [{ path: '', counts: new Map() }];
  let line = 1, lineStart = 0, at = 0, found = 0, m;
  while ((m = re.exec(xml)) && found < paths.size) {
    if (!m[2]) continue;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const top = stack[stack.length - 1];
    const n = (top.counts.get(m[2]) || 0) + 1;
    top.counts.set(m[2], n);
    const path = `${top.path}/${m[2]}[${n}]`;
    if (paths.has(path)) {
      for (let i = xml.indexOf('\n', at); i !== -1 && i < m.index; i = xml.indexOf('\n', i + 1)) { line++; lineStart = i + 1; }
      at = m.index;
      out.set(path, { line, col: m.index - lineStart + 1 });
      found++;
    }
    if (!m[4]) stack.push({ path, counts: new Map() });
  }
  return out;
}

/* ------------------------------------------------------------------ passes */

/*
 * libxml2 stops checking the rest of an element once one of its children is
 * out of place, repeated, unknown or missing. To still find all errors at
 * once, the document is changed and checked again, up to MAX_PASSES times:
 *  - a child that does not belong there is removed;
 *  - for a missing mandatory element (and for one that was removed earlier
 *    but is needed later, e.g. two elements swapped) an empty placeholder is
 *    put in its place.
 * Line numbers do not change. Element positions are mapped back to the
 * original file; errors inside placeholders, and errors caused only by a
 * removal, are not reported.
 */
const MAX_PASSES = 8;

const parsePath = p => (p || '').split('/').filter(Boolean).map(s => { const m = /^(.+)\[(\d+)\]$/.exec(s); return m ? { name: m[1], pos: +m[2] } : { name: s, pos: 1 }; });
const joinPath = steps => steps.map(s => `/${s.name}[${s.pos}]`).join('');
const parentOf = p => p.slice(0, p.lastIndexOf('/'));

// map a path of pass n back to the original file; null if it is (inside) a placeholder
function toOriginal(path, batches) {
  if (!path) return path;
  const steps = parsePath(path);
  for (let b = batches.length - 1; b >= 0; b--) {
    for (let d = 0; d < steps.length; d++) {
      const parent = joinPath(steps.slice(0, d));
      const here = batches[b].filter(r => r.parent === parent && r.name === steps[d].name);
      for (const k of here.filter(r => r.type === 'insert').map(r => r.pos).sort((x, y) => y - x)) {
        if (steps[d].pos === k) return null;
        if (steps[d].pos > k) steps[d].pos--;
      }
      for (const k of here.filter(r => r.type === 'remove').map(r => r.pos).sort((x, y) => x - y)) if (steps[d].pos >= k) steps[d].pos++;
    }
  }
  return joinPath(steps);
}

const BIG_LINES = 4194304; // ParseOption.XML_PARSE_BIG_LINES: line numbers above 65,535

export function checkXml(lx, xml, version) {
  let doc;
  try {
    doc = lx.XmlDocument.fromString(xml, { option: (lx.ParseOption && lx.ParseOption.XML_PARSE_BIG_LINES) || BIG_LINES });
  } catch (err) {
    const details = (err && err.details) || [{ message: err && err.message, line: null, col: null }];
    return {
      wellFormed: false,
      errors: details.slice(0, 50).map(d => {
        const m = clean(d.message);
        const extra = /Extra content at the end of the document|XML declaration allowed only at the start/i.test(m);
        return { rule: extra ? '0.9' : '0.7', message: m, raw: m, line: d.line || null, col: d.col || null };
      })
    };
  }
  const v = validators[version];
  if (!v) { doc.dispose(); throw new Error('No schema loaded for version ' + version); }
  const info = schemaInfo[version];
  const errors = [];
  const seen = new Set();
  const batches = [];          // changes per pass, in the coordinates of that pass
  const removed = [];          // { parent, name } in original paths
  let truncated = false, passes = 0;
  try {
    for (let pass = 0; pass < MAX_PASSES && !truncated; pass++) {
      passes++;
      let details = null;
      try { v.validate(doc); } catch (err) { details = (err && err.details) || [{ message: err && err.message }]; }
      if (!details || !details.length) break;
      const cache = new Map();
      const changes = [];
      const report = (c, path, at, d, where) => {
        const key = `${c.rule}|${path}|${c.raw}`;
        if (seen.has(key)) return;
        seen.add(key);
        errors.push({ ...c, actual: c.actual != null ? c.actual : where.value, line: d.line || null, col: d.col || null, xpath: path, at: at || path });
      };
      for (const d of details) {
        if (errors.length >= MAX_ERRORS) { truncated = true; break; }
        const where = describe(doc, d.xpath, cache) || {};
        const path = toOriginal(where.path, batches);
        if (where.path && path === null) continue; // inside a placeholder
        const c = classify(d.message, { info, prevName: where.prevName, name: where.name, following: where.following || [] });
        const container = path ? parentOf(path) : null;
        if (c.notExpected && where.el && path) {
          const exp = c.expectedList;
          const wasRemoved = removed.find(r => r.parent === container && exp.includes(r.name));
          if (wasRemoved) {
            // needed here, but removed earlier as out of place: put a placeholder back, report nothing new
            changes.push({ type: 'insert', where, name: wasRemoved.name });
            continue;
          }
          if (c.missingBefore) {
            report(c, container, path, d, {});
            changes.push({ type: 'insert', where, name: exp[exp.length - 1] });
            continue;
          }
          report(c, path, path, d, where);
          changes.push({ type: 'remove', where, original: path });
          continue;
        }
        if (c.notExpected && !path) { report(c, null, null, d, where); continue; }
        if (pass > 0 && path && c.expectedList && c.expectedList.length && /missing/.test(c.message) && !c.attribute
            && removed.some(r => r.parent === path && c.expectedList.includes(r.name))) continue; // caused by a removal
        report(c, path || null, path, d, where);
      }
      if (!changes.length || pass === MAX_PASSES - 1) break;
      // apply: never inside an element that is removed in the same pass
      const removing = changes.filter(x => x.type === 'remove').map(x => x.where.path);
      const inside = p => removing.some(r => p.startsWith(r + '/'));
      const batch = [];
      for (const ch of changes) {
        if (inside(ch.where.path)) continue;
        const steps = parsePath(ch.where.path);
        const last = steps.pop();
        const parent = joinPath(steps);
        if (ch.type === 'remove') {
          if (batch.some(r => r.type === 'remove' && r.parent === parent && r.name === last.name && r.pos === last.pos)) continue;
          batch.push({ type: 'remove', parent, name: last.name, pos: last.pos, el: ch.where.el, original: ch.original });
        } else {
          if (batch.some(r => r.type === 'insert' && r.parent === parent && r.before === ch.where.path)) continue;
          // position of the placeholder among the siblings of its name, counted before the change
          const sibs = (cache.get(ch.where.parentKey) || { byName: new Map() }).byName.get(ch.name) || [];
          const before = sibs.filter(x => x.idx < ch.where.idx).length;
          batch.push({ type: 'insert', parent, name: ch.name, pos: before + 1, el: ch.where.el, prefix: ch.where.prefix, before: ch.where.path });
        }
      }
      if (!batch.length) break;
      for (const r of batch) {
        if (r.type === 'remove') { removed.push({ parent: parentOf(r.original), name: r.name }); r.el.remove(); }
        else r.el.prependElement(r.name, r.prefix || undefined);
      }
      batches.push(batch.map(({ type, parent, name, pos }) => ({ type, parent, name, pos })));
    }
  } finally {
    doc.dispose();
  }
  // line and column from the text of the file
  const pos = locate(xml, new Set(errors.map(e => e.at).filter(Boolean)));
  for (const e of errors) {
    const p = e.at && pos.get(e.at);
    if (p) { e.line = p.line; e.col = p.col; }
    delete e.at; delete e.notExpected; delete e.expectedList; delete e.missingBefore;
  }
  return { wellFormed: true, errors, truncated, passes };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = e => {
    const msg = e.data || {};
    try {
      if (msg.type === 'init') {
        const t = performance.now();
        const versions = compileSchemas(TPLX, msg.schemas || {});
        self.postMessage({ type: 'ready', info: { engine: 'libxml2 (WebAssembly)', versions, ms: performance.now() - t } });
      } else if (msg.type === 'validate') {
        const t = performance.now();
        const r = checkXml(TPLX, msg.xml, msg.version);
        self.postMessage({ type: 'result', id: msg.id, ms: performance.now() - t, ...r });
      }
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, error: String(err && (err.stack || err.message) || err) });
    }
  };
  /* The libxml2 module finishes loading asynchronously. Messages sent before
     this point would be lost, so the page waits for 'loaded' before 'init'. */
  self.postMessage({ type: 'loaded' });
}
