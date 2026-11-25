/*
 * Testing Portal – apply the chosen changes to the file text (M3, fix the errors).
 *
 *   TP.fix.apply(text, proposals) → { text, applied: [AppliedGroup], skipped: [{ rule, part, where, reason }] }
 *
 * Only the changed values are touched: every other character of the file stays as it was.
 * Edits are sorted by position and the new text is built in one pass (10,000 changes in a
 * 10,000-transaction file take well under a second).
 * Proposal and row shapes: docs/specs/M3.md, section 3.2. Row operations:
 *   text    replace the text of a leaf element                       { op: 'text', path, val }
 *   attr    replace (or add) an attribute value                       { op: 'attr', path, attr: 'Ccy', val }
 *   insert  insert a new element (or a small tree) into a parent      { op: 'insert', insert: { parent, name, after: [...], children? }, val }
 *   remove  remove an element, with its line when it stands alone     { op: 'remove', path }
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};

  /* "<Nm>value</Nm>" or "<PstlAdr><TwnNm>…</TwnNm><Ctry>…</Ctry></PstlAdr>" (children: [{ name, val, children }]) */
  // prefix: the namespace prefix of the parent ("ns" in <ns:Cdtr>), so the new element is in the same namespace
  function elementXml(name, val, children, prefix) {
    const q = prefix ? `${prefix}:${name}` : name;
    if (children && children.length) return `<${q}>${children.map(c => elementXml(c.name, c.val, c.children, prefix)).join('')}</${q}>`;
    return `<${q}>${TP.fix.escText(val == null ? '' : val)}</${q}>`;
  }

  // the line break of the file ("\r\n" or "\n"), or '' for a file on one line
  const eolOf = text => (text.indexOf('\r\n') >= 0 ? '\r\n' : text.indexOf('\n') >= 0 ? '\n' : '');

  function editFor(row, nodes, text, eol) {
    const F = TP.fix;
    if (row.op === 'text') {
      const n = nodes.get(F.elementPath(row.path));
      if (!n) return { reason: 'The element is no longer in the file.' };
      if (!n.leaf) return { reason: 'The element contains other elements, so its text is not changed.' };
      if (n.mixed) return { reason: 'The value contains an XML comment, so it is not changed here: correct it in the system that creates the file.' };
      if (n.selfClosing) {
        const open = text.slice(n.start, n.end).replace(/\s*\/>$/, '>');
        return { start: n.start, end: n.end, text: `${open}${F.escText(row.val)}</${text.slice(n.start + 1).match(/^[^\s/>]+/)[0]}>` };
      }
      return { start: n.openEnd, end: n.closeStart, text: F.escText(row.val) };
    }
    if (row.op === 'attr') {
      const n = nodes.get(F.elementPath(row.path));
      if (!n) return { reason: 'The element is no longer in the file.' };
      const a = n.attrs[row.attr];
      if (a) return { start: a.start, end: a.end, text: a.quote === "'" ? F.escAttr(row.val).replace(/'/g, '&apos;') : F.escAttr(row.val) };
      const at = n.selfClosing ? text.lastIndexOf('/', n.openEnd - 1) : n.openEnd - 1;
      return { start: at, end: at, text: ` ${row.attr}="${F.escAttr(row.val)}"` };
    }
    if (row.op === 'remove') {
      const n = nodes.get(F.elementPath(row.path));
      if (!n) return { reason: 'The element is no longer in the file.' };
      let start = n.start, end = n.end;
      // alone on its line: remove the line, not only the element
      const after = /^[ \t]*(\r?\n|$)/.exec(text.slice(end, end + 200));
      if (n.indent != null && after && n.lineStart > 0) {
        start = n.lineStart - (text[n.lineStart - 2] === '\r' ? 2 : 1);
        end += after[0].length - after[1].length;
      }
      return { start, end, text: '' };
    }
    if (row.op === 'insert') {
      const ins = row.insert || {};
      const p = nodes.get(F.elementPath(ins.parent));
      if (!p) return { reason: 'The element it belongs to is no longer in the file.' };
      if (p.selfClosing) return { reason: `${p.name} is written as an empty element (<${p.name}/>); add the value in the system that creates the file.` };
      const kids = p.children || [];
      const before = new Set(ins.after || []);
      let prev = null;
      for (const k of kids) if (before.has(k.name)) prev = k;
      const prefix = (/^<([^\s/>:]+):/.exec(text.slice(p.start, p.openEnd)) || [])[1] || null;
      const xml = elementXml(ins.name, row.val, ins.children, prefix);
      // indentation: as the other children, else the parent's plus one step
      const step = (p.indent || '').includes('\t') ? '\t' : '  ';
      // children written on the parent's line (<Cdtr><Nm>…</Nm><PstlAdr>…): the new one goes on that line too
      const kidIndent = (kids.find(k => k.indent != null) || {}).indent;
      const inline = kids.length > 0 && kidIndent == null;
      const indent = inline ? null : kidIndent != null ? kidIndent : p.indent != null ? p.indent + step : null;
      const nl = eol && indent != null ? eol + indent : '';
      if (prev) return { start: prev.end, end: prev.end, text: nl + xml };
      if (!kids.length) {
        // empty parent "<Cdtr></Cdtr>" or "<Cdtr>\n  </Cdtr>": put the child on its own line, the end tag back at the parent's indentation
        const inside = text.slice(p.openEnd, p.closeStart);
        if (/^\s*$/.test(inside)) return { start: p.openEnd, end: p.closeStart, text: nl ? nl + xml + eol + p.indent : xml };
      }
      return { start: p.openEnd, end: p.openEnd, text: nl + xml };
    }
    return { reason: `Unknown change ${row.op}.` };
  }

  function apply(text, proposals) {
    const F = TP.fix;
    const sel = (proposals || []).filter(p => p.sel);
    const rows = [];
    for (const p of sel) for (const r of p.rows) if (!r.error) rows.push({ p, r });
    // one pass for every element the changes touch
    const paths = [], parents = [];
    for (const { r } of rows) {
      if (r.op === 'insert') parents.push(r.insert && r.insert.parent);
      else paths.push(r.path);
    }
    const nodes = F.locate(text, paths, { children: parents.filter(Boolean) });
    const eol = eolOf(text);
    const all = [], skipped = [];
    // rows of one unit (row.unit, e.g. join two remittance lines: change one, remove the other) are made all or none
    const unitOf = (p, r) => (r.unit != null ? `${p.id}|${r.unit}` : null);
    const badUnits = new Set();
    rows.forEach(({ p, r }, seq) => {
      const e = editFor(r, nodes, text, eol);
      if (e.reason) { skipped.push({ rule: p.rule, part: p.part, where: r.where, reason: e.reason }); if (unitOf(p, r)) badUnits.add(unitOf(p, r)); }
      else all.push({ ...e, seq, p, r, unit: unitOf(p, r) });
    });
    all.sort((a, b) => a.start - b.start || a.seq - b.seq);
    // overlapping edits: the first in document order wins; two edits that both only add text at the same place
    // (two inserts into one parent, two values for one empty element) overlap too. Repeat while a unit loses a row.
    let kept;
    const dropped = new Set();
    for (let round = 0; round < 10; round++) {
      kept = [];
      let reach = -1, lastZero = -1;
      const lost = [];
      for (const e of all) {
        if (dropped.has(e)) continue;
        if (e.unit && badUnits.has(e.unit)) { dropped.add(e); skipped.push({ rule: e.p.rule, part: e.p.part, where: e.r.where, reason: 'Belongs to a change that could not be made in full.' }); continue; }
        if (e.start < reach || (e.start === e.end && e.start === lastZero)) { lost.push(e); continue; }
        kept.push(e);
        reach = Math.max(reach, e.end);
        if (e.start === e.end) lastZero = e.start;
      }
      const newBad = lost.filter(e => e.unit && !badUnits.has(e.unit));
      for (const e of lost) {
        dropped.add(e);
        skipped.push({ rule: e.p.rule, part: e.p.part, where: e.r.where, reason: 'Another change in this file changes the same text.' });
        if (e.unit) badUnits.add(e.unit);
      }
      // a kept row of a unit that lost another row: undo it and decide again
      if (!newBad.length && !kept.some(e => e.unit && badUnits.has(e.unit))) break;
    }
    // one pass from the start of the file: the unchanged text between the edits, and the edits
    const parts = [];
    let at = 0;
    for (const e of kept) { parts.push(text.slice(at, e.start), e.text); at = e.end; }
    parts.push(text.slice(at));
    const out = parts.join('');
    // what was applied, per proposal
    const byP = new Map();
    for (const e of kept) {
      let a = byP.get(e.p);
      if (!a) byP.set(e.p, a = { rule: e.p.rule, part: e.p.part || null, title: e.p.title, field: e.p.field, kind: tagOf(e.p), rows: [] });
      a.rows.push({ where: e.r.where, block: e.r.block || null, tx: e.r.tx || null, e2e: e.r.e2e || null, old: e.r.old == null ? null : e.r.old, next: e.r.op === 'remove' ? null : e.r.val });
    }
    const applied = sel.map(p => byP.get(p)).filter(Boolean);
    return { text: out, applied, skipped };
  }

  /*
   * Before and after of the first row of each proposal, for the fix screen:
   *   TP.fix.preview(text, proposals) → Map(proposal.id → { before: [Line], after: [Line] } | { reason })
   *   Line = { n (line number, null for new lines), text, hit }
   * One pass over the file for all proposals; a few lines around each change.
   */
  function preview(text, proposals) {
    const F = TP.fix;
    const firsts = (proposals || []).map(p => ({ p, r: p.rows[0] })).filter(x => x.r);
    const paths = [], parents = [];
    for (const { r } of firsts) { if (r.op === 'insert') parents.push(r.insert && r.insert.parent); else paths.push(r.path); }
    const nodes = F.locate(text, paths, { children: parents.filter(Boolean) });
    const eol = eolOf(text);
    const out = new Map();
    const lineNo = pos => { let n = 1, i = -1; while ((i = text.indexOf('\n', i + 1)) >= 0 && i < pos) n++; return n; };
    for (const { p, r } of firsts) {
      const e = editFor({ ...r, val: r.val === '' && p.kind === 'entry' ? '…' : r.val }, nodes, text, eol);
      if (e.reason) { out.set(p.id, { reason: e.reason }); continue; }
      // the whole lines around the change, and one more line before and after
      let from = text.lastIndexOf('\n', e.start - 1) + 1;
      from = text.lastIndexOf('\n', Math.max(0, from - 2)) + 1;
      let to = text.indexOf('\n', e.end); to = to < 0 ? text.length : to;
      const to2 = text.indexOf('\n', to + 1); to = to2 < 0 ? text.length : to2;
      const first = lineNo(from);
      const cut = (str, a, b) => str.slice(a, b).replace(/\r/g, '').split('\n');
      const beforeLines = cut(text, from, to);
      const afterText = text.slice(from, e.start) + e.text + text.slice(e.end, to);
      const afterLines = afterText.replace(/\r/g, '').split('\n');
      // the lines that differ: same lines at the start and at the end are not marked
      let pre = 0, suf = 0;
      while (pre < beforeLines.length && pre < afterLines.length && beforeLines[pre] === afterLines[pre]) pre++;
      while (suf < beforeLines.length - pre && suf < afterLines.length - pre && beforeLines[beforeLines.length - 1 - suf] === afterLines[afterLines.length - 1 - suf]) suf++;
      const bMid = beforeLines.length - pre - suf;
      // a change far into a long line: show every line from shortly before the change ("…" in front)
      const b0 = beforeLines[pre] || '', a0 = afterLines[pre] || '';
      let col = 0;
      while (col < b0.length && col < a0.length && b0[col] === a0[col]) col++;
      if (bMid === 0) col = 0; // a new line: start at its start
      const cutAt = col > 60 ? col - 40 : 0;
      const crop = t => (cutAt && t.length > cutAt ? '…' + t.slice(cutAt) : t);
      if (cutAt) { for (let i = 0; i < beforeLines.length; i++) beforeLines[i] = crop(beforeLines[i]); for (let i = 0; i < afterLines.length; i++) afterLines[i] = crop(afterLines[i]); }
      out.set(p.id, {
        before: beforeLines.map((t, i) => ({ n: first + i, text: t, hit: i >= pre && i < pre + bMid })),
        after: afterLines.map((t, i) => {
          if (i < pre) return { n: first + i, text: t, hit: false };
          if (i >= afterLines.length - suf) return { n: first + beforeLines.length - (afterLines.length - i), text: t, hit: false };
          return { n: i - pre < bMid ? first + i : null, text: t, hit: true };
        })
      });
    }
    return out;
  }

  /* the tag of a proposal on the fix screen and in the report: corrected, sample, chosen, entered */
  function tagOf(p) {
    if (p.kind === 'calculated') return 'calculated';
    const r = p.rows[0];
    if (p.kind === 'sample') return r && r.val !== r.next ? 'entered' : 'sample';
    if (p.kind === 'choice') return 'choice';
    return 'entered';
  }

  Object.assign(TP.fix, { apply, preview, elementXml, tagOf, eolOf });
})(typeof self !== 'undefined' ? self : globalThis);
