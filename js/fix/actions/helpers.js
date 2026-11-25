/*
 * Testing Portal – helpers of the fix actions (M3, fix the errors).
 * Used by the files in js/fix/actions/ when they run (never at load time), so the
 * order of the script tags of this folder does not matter.
 *
 *   TP.fix.util.each(ctx, group, def, make, opts)  rows for the elements of a finding group:
 *       the element of each finding (def.element below the finding's element, def.up: or on
 *       an ancestor), one row per element (findings that point at the same element give one
 *       row), make(item, node) → row | null | { reason }; returns { rows, reason }
 *   TP.fix.util.needsOf(group, def, more)          the paths each() needs (for needs())
 *   TP.fix.util.target(path, rel)                  the element rel below path, or path itself
 *                                                  when its name is the last step of rel
 *   TP.fix.util.levelOf(path) / fieldOf(path)      the transaction, block or group header of an
 *                                                  element / its name below it ("Cdtr/Nm")
 *   TP.fix.util.blockOf / txOf(ctx, path)          the block and transaction of the report
 *   TP.fix.util.version(ctx)                       '03' or '09'
 *   TP.fix.util.findingsAt(ctx)                    Map(element path → Set of "rule-part"),
 *                                                  the findings shown (not information)
 *   TP.fix.util.charsetOf(ctx, path)               the character set 5.1/5.2 use for the element
 *   TP.fix.util.inSet(ctx, set) → (ch) → boolean   a character of the set
 *   TP.fix.util.xsdMax(name), limitOf(path, map)   the XSD length of an element name (the
 *                                                  smallest of its types, so a value within it is
 *                                                  valid wherever the name is used); a limit of
 *                                                  a { "Cdtr/Nm": 70 } setting for a path
 *   TP.fix.util.cut(value, max, units)             the first max characters ('code' points, as
 *                                                  string-length in the rules, or 'utf16' units)
 *   TP.fix.util.elementsBelow(ctx, node, test)     the elements inside a located element (one pass
 *                                                  over its text), test(el) with el.name, el.depth,
 *                                                  el.leaf, el.names(): [{ path, name, names, leaf, value }]
 *   TP.fix.util.innerOf(ctx, child)                text and value of a child listed by locate
 *   TP.fix.util.dec / sum / fmt                    exact decimal sums (BigInt), never floating point
 *   TP.fix.util.oneValue(rows)                     entries: one value for all rows is only right
 *                                                  when the rows have the same old value
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};
  const X = () => TP.fix;
  const Fn = () => TP.functions || {};

  const caches = new WeakMap();
  const cacheOf = ctx => { let c = caches.get(ctx); if (!c) caches.set(ctx, c = {}); return c; };

  const step = s => s.replace(/\[\d+\]$/, '');
  const pathOf = item => (item && item.xpath ? X().elementPath(item.xpath) : null);
  const items = group => group.items.filter(it => it.xpath);
  const keyOf = group => (group.part ? `${group.rule}-${group.part}` : group.rule);
  const normSpace = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /* the element a fix changes: rel below the finding's element; the finding's own element when its
     name is the last step of rel (7.6: the finding is on Dbtr/Nm, or on the transaction for Cdtr/Nm) */
  function target(path, rel) {
    if (!rel) return path;
    const steps = rel.split('/').filter(Boolean);
    if (X().nameOf(path) === step(steps[steps.length - 1])) return path;
    return X().under(path, rel);
  }
  /* the places of a value given on the transaction or on its block (def.up): the element below the
     finding's element, then below each ancestor up to the payment block */
  function places(item, def) {
    const p = pathOf(item);
    if (!p) return [];
    const first = target(p, def.element);
    if (!def.up || !def.element) return [first];
    const out = [first];
    let a = p;
    while (/\/PmtInf\[\d+\]\//.test(a)) { a = X().parentOf(a); out.push(X().under(a, def.element)); }
    return [...new Set(out)];
  }
  function needsOf(group, def, more) {
    const paths = [];
    for (const it of items(group)) paths.push(...places(it, def));
    return { paths, children: [], ...(more || {}) };
  }
  /*
   * One row per element. make(item, node) returns a row, null (nothing to change) or { reason }.
   * opts.leaf (default true): only elements without children; opts.node(item) → the element to use.
   */
  function each(ctx, group, def, make, opts) {
    opts = opts || {};
    const rows = [], seen = new Set();
    let reason = '';
    for (const it of items(group)) {
      const n = opts.node ? opts.node(it) : places(it, def).map(p => ctx.node(p)).find(Boolean);
      if (!n) { reason = reason || (opts.missing ? opts.missing(it) : 'The element to change is not in the file.'); continue; }
      if (opts.leaf !== false && !n.leaf) { reason = reason || `${n.name} contains other elements, so it is not changed here.`; continue; }
      if (seen.has(n.path)) continue;
      seen.add(n.path);
      const r = make(it, n);
      if (!r) continue;
      if (r.reason) { reason = reason || r.reason; continue; }
      if (!r.element) r.element = fieldOf(n.path);
      const own = target(pathOf(it), def.element);
      if (n.path !== own && levelOf(n.path) !== levelOf(own)) {
        const w = X().whereOfPath(n.path);
        if (w) Object.assign(r, { where: w, tx: TP.findings.placeOf(n.path).tx, e2e: null });
      }
      rows.push(r);
    }
    return { rows, reason };
  }

  /* the transaction, block or group header an element belongs to */
  function levelOf(path) {
    const m = /^(.*?\/CdtTrfTxInf\[\d+\])/.exec(path) || /^(.*?\/PmtInf\[\d+\])/.exec(path) || /^(.*?\/GrpHdr\[\d+\])/.exec(path);
    return m ? m[1] : null;
  }
  /* "Cdtr/PstlAdr/Ctry": the element's path below its level, as the rules name fields */
  function fieldOf(path) {
    const lv = levelOf(path);
    const rest = lv && path.length > lv.length ? path.slice(lv.length + 1) : X().nameOf(path);
    return rest.split('/').map(step).join('/');
  }
  function blockOf(ctx, path) {
    const pl = TP.findings.placeOf(path);
    return pl.block && ctx.result.blocks ? ctx.result.blocks[pl.block - 1] || null : null;
  }
  function txOf(ctx, path) {
    const pl = TP.findings.placeOf(path), b = blockOf(ctx, path);
    return b && pl.tx ? b.txs[pl.tx - 1] || null : null;
  }
  function version(ctx) {
    const c = cacheOf(ctx);
    if (!c.version) {
      const v = ctx.result && ctx.result.version;
      const m = /pain\.001\.001\.(\d\d)/.exec(String(ctx.text || '').slice(0, 4000)) || /pain\.001\.001\.(\d\d)/.exec(String(ctx.text || ''));
      c.version = v === '09' || v === '03' ? v : m && m[1] === '09' ? '09' : '03';
    }
    return c.version;
  }

  /* findings shown on the report (information is not fixed), per element: Map(path → Set("5.2", "5.4-spaces" …)) */
  function findingsAt(ctx) {
    const c = cacheOf(ctx);
    if (!c.at) {
      c.at = new Map();
      for (const gr of ctx.result.groups || []) {
        if (gr.severity === 'I') continue;
        const k = keyOf(gr);
        for (const it of gr.items) {
          const p = pathOf(it);
          if (!p) continue;
          let s = c.at.get(p);
          if (!s) c.at.set(p, s = new Set());
          s.add(k);
        }
      }
    }
    return c.at;
  }

  /* the character set of an element, as js:tpTextSet in the rules: its transaction's payment type,
     else its block's (the country's set for a mixed block), else the country's set */
  function charsetOf(ctx, path) {
    const F = Fn();
    const b = blockOf(ctx, path), t = txOf(ctx, path);
    if (t) return F.tpCharsetFor(t.type || '');
    if (b) return F.tpCharsetFor(b.type === 'MIXED' ? '' : b.type || '');
    return F.tpCharsetFor('');
  }
  /* a test for one character of a set from settings.charsets (null if the set is not defined) */
  function inSet(ctx, set) {
    const c = cacheOf(ctx);
    c.sets = c.sets || new Map();
    if (!c.sets.has(set)) {
      const cls = ((ctx.settings && ctx.settings.charsets) || {})[set];
      let re = null;
      if (cls != null) try { re = new RegExp(`^[${cls}]$`, 'u'); } catch (e) { re = new RegExp(`^[${cls}]$`); }
      c.sets.set(set, re ? ch => re.test(ch) : null);
    }
    return c.sets.get(set);
  }

  /* XSD length per element name: the smallest maxLength of the types the name has in .03 and .09
     (Nm is Max140Text for parties but Max70Text for accounts: 70) */
  const XSD_MAX = { AddtlInf: 140, AddtlRmtInf: 140, AdmstnZn: 35, AdmstnZone: 35, AdrLine: 70, BldgNb: 16, BldgNm: 35, Cd: 4, CertId: 35, ChanlTp: 4, ChqNb: 35,
    CityOfBirth: 35, Ctgy: 35, CtgyDtls: 35, CtrctId: 35, CtrySubDvsn: 35, DbtrSts: 35, Dept: 70, Desc: 2048, DstrctNm: 35, ElctrncAdr: 2048, EmailAdr: 2048, EmailPurp: 35,
    EndToEndId: 35, Flr: 70, FrmsCd: 35, Id: 34, Inf: 35, InstrForDbtrAgt: 140, InstrId: 35, InstrInf: 140, Issr: 35, JobTitl: 35, MemoFld: 35, MmbId: 35, MsgId: 35, Mtd: 35,
    Nb: 35, Nm: 70, Othr: 35, PlcAndNm: 350, PmtInfId: 35, PrtLctn: 35, Prtry: 35, PrvcOfBirth: 35, PstBx: 16, PstCd: 16, Ref: 35, RefNb: 140, RegnId: 35, RgnlClrZone: 35,
    RmtId: 35, RmtLctnElctrncAdr: 2048, Room: 70, Rsn: 4, Rspnsblty: 35, SchmeNm: 35, Sgntr: 70, StrtNm: 70, SubDept: 70, TaxId: 35, TaxTp: 35, Titl: 35, Tp: 35,
    TwnLctnNm: 35, TwnNm: 35, Ustrd: 140 };
  const xsdMax = name => XSD_MAX[name] || null;
  /* the limit of a { "Nm": 70, "Cdtr/Nm": null } setting for an element path, as js:tpLimit: the longest
     matching end of the path wins; null switches it off; 0 = no limit */
  function limitOf(path, map) {
    if (!map || typeof map !== 'object') return 0;
    const own = String(path).split('/').filter(Boolean).map(step);
    let best = 0, bestLen = 0;
    for (const [k, v] of Object.entries(map)) {
      if (k[0] === '_' || (v !== null && typeof v !== 'number')) continue;
      const suf = k.split('/').filter(Boolean);
      if (suf.length <= bestLen || suf.length > own.length) continue;
      if (suf.every((s, i) => own[own.length - suf.length + i] === s)) { best = v === null ? 0 : v; bestLen = suf.length; }
    }
    return best;
  }
  /* the most a value of this element may have: XSD and guideline.maxLength */
  function maxFor(ctx, path) {
    const a = xsdMax(X().nameOf(path)) || 0;
    const b = limitOf(path, Fn().get ? Fn().get(ctx.settings, 'guideline.maxLength') : null);
    return a && b ? Math.min(a, b) : a || b || 0;
  }
  const len = s => [...String(s)].length;
  /* the first max characters, without spaces at the end; units: 'code' (default) or 'utf16' */
  function cut(value, max, units) {
    const s = String(value);
    let out;
    if (units === 'utf16') { out = s.slice(0, max); if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1); }
    else out = [...s].slice(0, max).join('');
    return out.replace(/[ \t\r\n]+$/, '');
  }

  /*
   * The elements inside a located element, from its own part of the text (the file passed the XSD,
   * so it is well-formed). test(el) → boolean selects elements (el.name, el.depth: 0 for node itself,
   * el.leaf, el.names(): the names below node); skip(name) leaves out a subtree (a block's transactions).
   * → [{ path, name, names, leaf, value (text of a leaf, entities resolved), start, openEnd, closeStart, end }]
   * A small tokenizer instead of a parser: it is called for thousands of transactions (7.25).
   */
  const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const local = n => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n);
  const leafValue = raw => X().unescapeXml(raw.indexOf('<!--') >= 0 ? raw.replace(/<!--[\s\S]*?-->/g, '') : raw);
  // an element met by elementsBelow; its path and names are built only when asked for
  function El(name, parent, k, start, openEnd, root) {
    this.name = name; this.parent = parent; this.k = k; this.start = start; this.openEnd = openEnd; this.root = root;
    this.depth = parent ? parent.depth + 1 : 0; this.counts = null; this.kids = false; this.leaf = true;
  }
  El.prototype.names = function () { const a = []; for (let x = this; x.parent; x = x.parent) a.unshift(x.name); return a; };
  Object.defineProperty(El.prototype, 'path', { get() { return this.parent ? `${this.parent.path}/${this.name}[${this.k}]` : this.root; } });
  function elementsBelow(ctx, node, test, skip) {
    const out = [];
    if (!node) return out;
    const text = ctx.text, end = node.end;
    const stack = [];
    let skipping = 0;
    function close(el, closeStart, closeEnd) {
      el.leaf = !el.kids;
      if (!test(el)) return;
      const value = el.leaf ? (closeStart == null ? '' : leafValue(text.slice(el.openEnd, closeStart))) : null;
      out.push({ path: el.path, name: el.name, names: el.names(), leaf: el.leaf, value, start: el.start, openEnd: el.openEnd, closeStart: closeStart == null ? closeEnd : closeStart, end: closeEnd });
    }
    TOKEN.lastIndex = node.start;
    for (let m; (m = TOKEN.exec(text)) && m.index < end;) {
      if (!m[2]) continue; // comment, CDATA or processing instruction: text, not an element
      const selfClosing = m[4] === '/';
      if (m[1] === '/') {
        if (skipping) { skipping--; continue; }
        const el = stack.pop();
        if (el) close(el, m.index, TOKEN.lastIndex);
        if (!stack.length) break;
        continue;
      }
      if (skipping) { if (!selfClosing) skipping++; continue; }
      const name = local(m[2]);
      const top = stack[stack.length - 1];
      let k = 0;
      if (top) { top.kids = true; const c = top.counts || (top.counts = Object.create(null)); k = c[name] = (c[name] || 0) + 1; }
      if (top && skip && skip(name)) { if (!selfClosing) skipping = 1; continue; }
      const el = new El(name, top || null, k, m.index, TOKEN.lastIndex, node.path);
      if (selfClosing) { close(el, null, TOKEN.lastIndex); if (!stack.length) break; } else stack.push(el);
    }
    return out;
  }

  /* a child listed by locate ({ name, path, start, end }): its text as written and as read, null if it has children */
  function innerOf(ctx, child) {
    const raw = ctx.text.slice(child.start, child.end);
    if (/\/>$/.test(raw) && !/<\//.test(raw)) return { raw: '', value: '' };
    const m = /^<[^>]*>([\s\S]*)<\/[^>]*>$/.exec(raw);
    if (!m || /<(?!!\[CDATA\[)/.test(m[1])) return null;
    return { raw: m[1], value: X().unescapeXml(m[1]) };
  }

  /* exact decimals: "1234.50" → { u: 123450n, s: 2 }; null if not a decimal the XSD accepts */
  function dec(v) {
    const m = /^\s*\+?(\d*)(?:\.(\d*))?\s*$/.exec(v == null ? '' : String(v));
    if (!m || (!m[1] && !m[2])) return null;
    const frac = m[2] || '';
    return { u: BigInt((m[1] || '0') + frac), s: frac.length };
  }
  function sum(list) {
    let s = 0, u = 0n;
    for (const d of list) s = Math.max(s, d.s);
    for (const d of list) u += d.u * 10n ** BigInt(s - d.s);
    return { u, s };
  }
  function fmt(d) {
    const str = d.u.toString().padStart(d.s + 1, '0');
    return d.s ? `${str.slice(0, -d.s)}.${str.slice(-d.s)}` : str;
  }
  const decEqual = (a, b) => { const s = Math.max(a.s, b.s); return a.u * 10n ** BigInt(s - a.s) === b.u * 10n ** BigInt(s - b.s); };

  /* entries: the value typed is used for every row, which is right only if the rows have the same old value */
  function oneValue(out, what) {
    const rows = out.rows || out;
    const olds = new Set(rows.map(r => normSpace(r.old)));
    if (olds.size > 1) return { rows: [], reason: `The ${rows.length} places have different ${what || 'values'}; one value cannot be typed for all of them here. Correct them in the system that creates the file.` };
    return out;
  }

  /* the text of an element in a few words (for elements with children that are removed): a located
     element, an element of elementsBelow, or a child listed by locate (start, end) */
  function textOf(ctx, n, max) {
    if (n.leaf && n.value != null) return n.value;
    const raw = ctx.text.slice(n.openEnd != null ? n.openEnd : n.start, n.closeStart != null ? n.closeStart : n.end);
    const t = normSpace(X().unescapeXml(raw.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')));
    const m = max || 60;
    return t.length > m ? t.slice(0, m - 1) + '…' : t;
  }

  TP.fix.util = Object.assign(TP.fix.util || {}, {
    cacheOf, step, pathOf, items, keyOf, normSpace, target, places, needsOf, each, levelOf, fieldOf, blockOf, txOf, version,
    findingsAt, charsetOf, inSet, xsdMax, limitOf, maxFor, len, cut, elementsBelow, innerOf, dec, sum, fmt, decEqual, oneValue, textOf
  });
})(typeof self !== 'undefined' ? self : globalThis);
