/*
 * Testing Portal – where elements are in the file text (M3, fix the errors).
 * One streaming pass (saxes) over the text; runs in the page and in the Node tests.
 *
 *   TP.fix.locate(text, paths, { children }) → Map(path → Node)
 *
 * paths: element paths as in the findings, "/Document[1]/CstmrCdtTrfInitn[1]/PmtInf[2]/CdtTrfTxInf[7]"
 *        (a trailing "/@Ccy" is ignored). Only these elements are recorded, so a 20 MB file
 *        needs little memory.
 * children: a Set of paths whose child elements are also listed (for inserting a new element).
 *
 * Node = { path, name, start, openEnd, closeStart, end, selfClosing, leaf, raw, value, attrs,
 *          lineStart, indent, children?: [{ name, path, start, end, indent }] }
 *   start … end           the whole element, from "<" to the end of its end tag (or of "/>")
 *   openEnd               just after the ">" of the start tag
 *   closeStart            the "<" of the end tag (= openEnd - … for a self-closing element: = end)
 *   raw / value           the text content as written (with entities) and as read (entities resolved),
 *                         for leaf elements only (no child elements)
 *   attrs                 { name: { value, start, end } } positions of the attribute values (inside the quotes)
 *   indent                the spaces or tabs before the element when it starts its own line, else null
 * Positions are indexes into the JavaScript string (UTF-16 code units).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};

  const elementPath = p => String(p).replace(/\/(@[^/]*|text\(\)(\[\d+\])?)$/, '');
  const local = n => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n);

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  // the text of an element: entities and CDATA resolved, comments and processing instructions left out
  function unescapeXml(raw) {
    if (raw.indexOf('&') < 0 && raw.indexOf('<') < 0) return raw;
    let out = '';
    const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;
    let last = 0, m;
    while ((m = re.exec(raw))) {
      out += raw.slice(last, m.index);
      if (m[1] != null) out += m[1];
      else if (m[2] == null) { /* comment or processing instruction */ }
      else if (m[2][0] === '#') out += String.fromCodePoint(m[2][1] === 'x' ? parseInt(m[2].slice(2), 16) : parseInt(m[2].slice(1), 10));
      else out += ENT[m[2]] != null ? ENT[m[2]] : m[0];
      last = re.lastIndex;
    }
    return out + raw.slice(last);
  }

  // attribute values of a start tag "<Amt Ccy="EUR" x='1'>" with their positions in the text
  function attrsOf(text, start, openEnd) {
    const tag = text.slice(start, openEnd);
    const out = {};
    const re = /([A-Za-z_:][-A-Za-z0-9_.:]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    const nameEnd = /^<[^\s/>]+/.exec(tag);
    re.lastIndex = nameEnd ? nameEnd[0].length : 1;
    while ((m = re.exec(tag))) {
      const v = m[3] != null ? m[3] : m[4];
      const vs = start + m.index + m[0].length - 1 - v.length;
      out[local(m[1])] = { value: unescapeXml(v), raw: v, start: vs, end: vs + v.length, quote: m[2][0] };
    }
    return out;
  }

  function lineInfo(text, start) {
    const ls = text.lastIndexOf('\n', start - 1) + 1;
    const before = text.slice(ls, start);
    return { lineStart: ls, indent: /^[ \t]*$/.test(before) ? before : null };
  }

  function locate(text, paths, opts) {
    const wanted = new Set();
    for (const p of paths || []) if (p) wanted.add(elementPath(p));
    const withKids = new Set([...((opts && opts.children) || [])].map(elementPath));
    for (const p of withKids) wanted.add(p);
    const found = new Map();
    if (!wanted.size) return found;

    const Saxes = (g.TPSaxes && g.TPSaxes.SaxesParser) || g.TPSaxes;
    const parser = new Saxes({ xmlns: false, position: true });
    const stack = [{ path: '', counts: Object.create(null), node: null, hasChild: false }];
    let left = wanted.size;
    parser.on('opentag', tag => {
      const top = stack[stack.length - 1];
      top.hasChild = true;
      const name = local(tag.name);
      const n = (top.counts[name] = (top.counts[name] || 0) + 1);
      const path = `${top.path}/${name}[${n}]`;
      const openEnd = parser.position;
      const want = wanted.has(path);
      const kid = top.node && top.node.children;
      let node = null;
      if (want || kid) {
        const start = text.lastIndexOf('<', openEnd - 1);
        const li = lineInfo(text, start);
        if (kid) kid.push({ name, path, start, end: null, indent: li.indent });
        if (want) {
          node = { path, name, start, openEnd, closeStart: null, end: null, selfClosing: !!tag.isSelfClosing, leaf: true, raw: null, value: null,
            attrs: attrsOf(text, start, openEnd), lineStart: li.lineStart, indent: li.indent };
          if (withKids.has(path)) node.children = [];
        }
      }
      stack.push({ path, counts: Object.create(null), node, hasChild: false, kidOf: kid ? kid[kid.length - 1] : null });
    });
    parser.on('closetag', () => {
      const el = stack.pop();
      const end = parser.position;
      if (el.kidOf) el.kidOf.end = end;
      const node = el.node;
      if (!node) return;
      node.end = end;
      if (node.selfClosing) { node.closeStart = end; node.raw = ''; node.value = ''; }
      else {
        node.closeStart = text.lastIndexOf('</', end - 1);
        node.leaf = !el.hasChild;
        if (node.leaf) {
          node.raw = text.slice(node.openEnd, node.closeStart);
          node.value = unescapeXml(node.raw);
          // a comment or processing instruction inside the value: its text is not changed (it would be lost or become visible)
          if (/<!--|<\?/.test(node.raw.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''))) node.mixed = true;
        }
      }
      found.set(node.path, node);
      left--;
    });
    try { parser.write(text).close(); }
    catch (err) { /* a file that is not well-formed: keep what was found before the error */ }
    void left;
    return found;
  }

  /* text and attribute values as XML */
  const escText = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = v => escText(v).replace(/"/g, '&quot;');

  Object.assign(TP.fix, { locate, unescapeXml, escText, escAttr, elementPath });
})(typeof self !== 'undefined' ? self : globalThis);
