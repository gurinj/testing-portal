/*
 * Testing Portal – generic fix actions (M3), used by config/fixes.json.
 * The other files in this folder hold the actions for particular checks.
 *
 *   choice        one of def.options (default def.default) as the new text of the element
 *   entry         no value proposed: the user types one (checked with def.check)
 *   sample        a marked sample value (def.sample) as the new text of an existing element
 *   insertSample  a marked sample value in a missing element (def.element, relative to the finding,
 *                 inserted after the elements in def.after); an existing empty element gets the value;
 *                 def.requires: elements the parent must have (else the place stays open)
 *   trim          the text without spaces and line breaks at the start and end
 *
 * def.element: the element to change, relative to the finding's element ("Cdtr/Nm"); without it,
 * the finding's own element. def.up: true when the element may also be on an ancestor (ChrgBr on
 * the transaction or on its block); places that point at the same element give one row.
 * A finding without an element path gets no row.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};
  const A = TP.fix.actions = TP.fix.actions || {};

  const target = (item, def) => (item.xpath ? TP.fix.under(TP.fix.elementPath(item.xpath), def.element) : null);
  const items = group => group.items.filter(it => it.xpath);
  // def.up: the element may be on the transaction or on its block (ChrgBr): look in the ancestors too
  const places = (item, def) => (def.up && def.element ? TP.fix.candidates(TP.fix.elementPath(item.xpath), def.element) : [target(item, def)]);
  const needsTargets = (ctx, group, def) => ({ paths: items(group).flatMap(it => places(it, def)) });
  /*
   * The element to change for each item; items that point at the same element (7.19 on every
   * transaction of a block whose ChrgBr is on the block) give one row, placed where the element is.
   */
  function each(ctx, group, def, make) {
    const out = [], seen = new Set();
    for (const it of items(group)) {
      const n = places(it, def).map(p => ctx.node(p)).find(Boolean);
      if (!n || !n.leaf || seen.has(n.path)) continue;
      seen.add(n.path);
      const r = make(it, n);
      if (!r) continue;
      if (n.path !== target(it, def)) { const w = TP.fix.whereOfPath(n.path); if (w) Object.assign(r, { where: w, tx: null, e2e: null }); }
      out.push(r);
    }
    return out;
  }

  A.choice = {
    kind: 'choice',
    needs: needsTargets,
    rows: (ctx, group, def) => each(ctx, group, def, (it, n) => TP.fix.row(it, { op: 'text', path: n.path, old: n.value, next: def.default || (def.options || [])[0] || '' }))
  };

  // the value typed is used for every row: right only when the rows have the same old value
  // (the same wrong IBAN in three transactions); different values stay open (f1, M3)
  A.entry = {
    kind: 'entry',
    needs: needsTargets,
    rows: (ctx, group, def) => {
      const rows = each(ctx, group, def, (it, n) => TP.fix.row(it, { op: 'text', path: n.path, old: n.value, next: null, val: '' }));
      return TP.fix.util && TP.fix.util.oneValue ? TP.fix.util.oneValue({ rows, reason: '' }) : rows;
    }
  };

  A.sample = {
    kind: 'sample',
    needs: needsTargets,
    rows: (ctx, group, def) => each(ctx, group, def, (it, n) => TP.fix.row(it, { op: 'text', path: n.path, old: n.value, next: def.sample }))
  };

  A.insertSample = {
    kind: 'sample',
    needs: (ctx, group, def) => {
      const ts = items(group).map(it => target(it, def));
      return { paths: ts, children: ts.map(TP.fix.parentOf) };
    },
    rows: (ctx, group, def) => {
      const out = [];
      let reason = '';
      for (const it of items(group)) {
        const t = target(it, def), n = ctx.node(t);
        if (n && n.leaf) { out.push(TP.fix.row(it, { op: 'text', path: n.path, old: n.value, next: def.sample })); continue; }
        if (n) continue;
        const parent = ctx.node(TP.fix.parentOf(t));
        if (!parent) { reason = `The element ${TP.fix.nameOf(TP.fix.parentOf(t))} is missing as well: add it in the system that creates the file.`; continue; }
        // an empty element written as <Cdtr/> cannot take a child here (edit.js); def.requires: elements the
        // parent must have, else the finding would stay (4.30-missing: a town only where the country is given)
        if (parent.selfClosing) { reason = `${parent.name} is written as an empty element: add the value in the system that creates the file.`; continue; }
        const kids = new Set((parent.children || []).map(k => k.name));
        const lacking = (def.requires || []).filter(r => !kids.has(r));
        if (lacking.length) { reason = reason || `${parent.name} has no ${lacking.join(' and no ')} either: add ${lacking.length > 1 ? 'them' : 'it'} in the system that creates the file.`; continue; }
        out.push(TP.fix.row(it, { op: 'insert', path: t, insert: { parent: parent.path, name: TP.fix.nameOf(t), after: def.after || [] }, old: null, next: def.sample }));
      }
      return { rows: out, reason };
    }
  };

  A.trim = {
    kind: 'calculated',
    needs: needsTargets,
    rows: (ctx, group, def) => each(ctx, group, def, (it, n) => {
      const next = n.value.replace(/^\s+|\s+$/g, '');
      return next && next !== n.value ? TP.fix.row(it, { op: 'text', path: n.path, old: n.value, next }) : null;
    })
  };
})(typeof self !== 'undefined' ? self : globalThis);
