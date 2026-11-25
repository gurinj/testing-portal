/*
 * Testing Portal – fixes for the number of transactions and the control sums (M3).
 *
 *   nbOfTxs   4.3, 4.7   NbOfTxs of the group header (all transactions of the file) or of a block
 *   ctrlSum   4.4, 4.8   CtrlSum of the group header or of a block: the sum of the amounts
 *                        (InstdAmt or EqvtAmt/Amt, whatever the currency, as the rules add them)
 *
 * The values come from the report (result.blocks: every transaction with its amount as written),
 * added exactly with BigInt, never with floating point. The sum has as many decimals as the amount
 * with the most decimals. Also used by the XSD fixes (2.7 NbOfTxs, 2.9 CtrlSum):
 * TP.fix.util.countFor(ctx, path), TP.fix.util.sumFor(ctx, path).
 * Calculated, ticked: the values follow from the file and do not change what the payments do.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};
  const A = TP.fix.actions = TP.fix.actions || {};
  const U = () => TP.fix.util;

  /* the blocks an element counts: its own block, or every block for the group header */
  function scopeOf(ctx, path) {
    const blocks = (ctx.result && ctx.result.blocks) || [];
    const pl = TP.findings.placeOf(path);
    if (pl.block) return blocks[pl.block - 1] ? [blocks[pl.block - 1]] : null;
    return /\/GrpHdr\[\d+\]\//.test(path) ? blocks : null;
  }
  function countFor(ctx, path) {
    const s = scopeOf(ctx, path);
    return s && s.length ? String(s.reduce((n, b) => n + b.txs.length, 0)) : null;
  }
  /* { value } or { reason } */
  function sumFor(ctx, path) {
    const s = scopeOf(ctx, path);
    if (!s || !s.length) return { reason: 'The transactions of this control sum are not known.' };
    const list = [];
    for (const b of s) for (const t of b.txs) {
      const d = U().dec(t.amount);
      if (!d) return { reason: `The amount of ${TP.findings.whereOf(b.n, t.n).toLowerCase()} is missing or not a number, so the control sum cannot be worked out. Correct the amount first.` };
      list.push(d);
    }
    if (!list.length) return { reason: 'The block has no transactions to add up.' };
    const total = U().sum(list);
    const value = U().fmt(total);
    // DecimalNumber: at most 18 digits
    if (value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').length > 18) return { reason: 'The sum has more than 18 digits, more than the schema allows.' };
    return { value, total };
  }

  A.nbOfTxs = {
    kind: 'calculated',
    needs: (ctx, group, def) => U().needsOf(group, { element: def.element || 'NbOfTxs' }),
    rows: (ctx, group, def) => U().each(ctx, group, { element: def.element || 'NbOfTxs' }, (it, n) => {
      const next = countFor(ctx, n.path);
      if (next == null) return { reason: 'The transactions cannot be counted here.' };
      return next === n.value.trim() ? null : TP.fix.row(it, { op: 'text', path: n.path, old: n.value, next });
    }, { missing: () => 'The file has no NbOfTxs here.' })
  };

  A.ctrlSum = {
    kind: 'calculated',
    needs: (ctx, group, def) => U().needsOf(group, { element: def.element || 'CtrlSum' }),
    rows: (ctx, group, def) => U().each(ctx, group, { element: def.element || 'CtrlSum' }, (it, n) => {
      const s = sumFor(ctx, n.path);
      if (s.reason) return s;
      const old = U().dec(n.value);
      if (old && U().decEqual(old, s.total)) return null;
      return TP.fix.row(it, { op: 'text', path: n.path, old: n.value, next: s.value });
    }, { missing: () => 'The file has no CtrlSum here.' })
  };

  TP.fix.util = Object.assign(TP.fix.util || {}, { countFor, sumFor });
})(typeof self !== 'undefined' ? self : globalThis);
