/*
 * Testing Portal – fixes that set, remove or add whole elements (M3).
 *
 *   sameAsBlock     4.13 PmtTpInf, 4.14 ChrgBr given on the transaction and on its block: the
 *                   transaction's copy is removed when it says the same as the block's (ticked);
 *                   when they differ the finding stays open (a business decision)
 *   setValue        one value for an element (def.value): 7.4 SLEV, 7.20 SHAR, 6.8 BtchBookg false.
 *                   def.up: the element may be on the transaction or on its block. def.notTypes:
 *                   a value on the block counts for every transaction of the block without its
 *                   own; it is not changed if one of them has a payment type in notTypes (a block
 *                   with SEPA and cross-border payments: 3.7)
 *   chargeBearer    7.19: a choice (def.options, def.default) with the same rule for the block
 *   remove          the element of the finding, def.element below it, or its parent (def.element
 *                   ".."): 4.18-account, 4.33, 4.40-allowed, 6.12
 *   removeListed    6.2-forbidden, 6.2-ignored: the elements of guideline.forbidden / .ignored
 *                   (def.list) of the finding's level
 *   insertEntry     4.17: a missing identifier the user types (def.element, def.element09 for
 *                   pain.001.001.09, def.after: the elements before it in the schema)
 *   sameDebtorName  9.7: the debtor name of the first block with the same debtor account
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};
  const A = TP.fix.actions = TP.fix.actions || {};
  const U = () => TP.fix.util;
  const X = () => TP.fix;
  const blockPath = p => (/^(.*?\/PmtInf\[\d+\])/.exec(p) || [])[1] || null;

  /* ---------------------------------------------------------- 4.13, 4.14 */
  // the content of an element without layout, comments and namespace prefixes
  function canonical(ctx, n) {
    if (n.leaf) return n.value.trim();
    return ctx.text.slice(n.openEnd, n.closeStart).replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1').trim();
  }
  const onBlock = (path, name) => { const b = blockPath(path); return b ? `${b}/${name}[1]` : null; };
  A.sameAsBlock = {
    kind: 'calculated',
    needs: (ctx, group, def) => {
      const ps = U().items(group).map(it => U().target(U().pathOf(it), def.element));
      return { paths: [...ps, ...ps.map(p => onBlock(p, def.element)).filter(Boolean)] };
    },
    rows: (ctx, group, def) => U().each(ctx, group, def, (it, n) => {
      const b = ctx.node(onBlock(n.path, def.element));
      if (!b) return null;
      if (canonical(ctx, n) !== canonical(ctx, b)) return { reason: `The ${def.what || def.element} of the transaction differs from that of its block: decide which one applies and give it on one level only, in the system that creates the file.` };
      return X().row(it, { op: 'remove', path: n.path, old: U().textOf(ctx, n), next: null });
    }, { leaf: false })
  };

  /* ---------------------------------------------------------- one value for an element */
  // a value on the block counts for its transactions without their own: do they all allow the new value?
  function blockFits(ctx, n, def) {
    if (!def.notTypes || !/\/PmtInf\[\d+\]\/[^/]+$/.test(n.path)) return '';
    const b = U().blockOf(ctx, n.path);
    const own = { ChrgBr: 'chrgBr' }[n.name];
    const heirs = b ? b.txs.filter(t => !own || !t[own]) : [];
    const bad = heirs.filter(t => def.notTypes.includes(t.type));
    return bad.length ? `The ${n.name} of the block also counts for ${bad.length} ${TP.functions.paymentTypeLabel(bad[0].type)} payment${bad.length > 1 ? 's' : ''} of the block: put the payments of each type into blocks of their own, in the system that creates the file.` : '';
  }
  A.setValue = {
    kind: 'calculated',
    needs: (ctx, group, def) => U().needsOf(group, def),
    rows: (ctx, group, def) => U().each(ctx, group, def, (it, n) => {
      if (n.value.trim() === def.value) return null;
      const why = blockFits(ctx, n, def);
      return why ? { reason: why } : X().row(it, { op: 'text', path: n.path, old: n.value, next: def.value });
    })
  };
  A.chargeBearer = {
    kind: 'choice',
    needs: (ctx, group, def) => U().needsOf(group, def),
    rows: (ctx, group, def) => U().each(ctx, group, def, (it, n) => {
      const why = blockFits(ctx, n, def);
      return why ? { reason: why } : X().row(it, { op: 'text', path: n.path, old: n.value, next: def.default || (def.options || [])[0] || '' });
    })
  };

  /* ---------------------------------------------------------- remove elements */
  const removeTarget = (path, def) => (def.element === '..' ? X().parentOf(path) : U().target(path, def.element));
  // never a whole transaction, block or group header
  const LEVELS = new Set(['Document', 'CstmrCdtTrfInitn', 'GrpHdr', 'PmtInf', 'CdtTrfTxInf']);
  A.remove = {
    kind: 'calculated',
    needs: (ctx, group, def) => ({ paths: U().items(group).map(it => removeTarget(U().pathOf(it), def)) }),
    rows: (ctx, group, def) => U().each(ctx, group, {}, (it, n) => (LEVELS.has(n.name) ? { reason: `A whole ${n.name} is not removed here.` } : X().row(it, { op: 'remove', path: n.path, old: U().textOf(ctx, n), next: null })),
      { leaf: false, node: it => ctx.node(removeTarget(U().pathOf(it), def)), missing: () => 'The element is no longer in the file.' })
  };

  const LEVEL = { file: 'file', block: 'block', tx: 'transaction' };
  A.removeListed = {
    kind: 'calculated',
    needs: (ctx, group) => { const ps = U().items(group).map(U().pathOf); return { paths: ps, children: ps }; },
    rows: (ctx, group, def) => {
      const rows = [], seen = new Set();
      let reason = '';
      for (const it of U().items(group)) {
        const node = ctx.node(U().pathOf(it));
        const list = TP.functions.get(ctx.settings, `guideline.${def.list}.${LEVEL[it.level] || it.level}`);
        if (!node || !node.children || !Array.isArray(list)) continue;
        const found = [];
        for (const p of list) {
          if (typeof p !== 'string' || !p.trim()) continue;
          const steps = p.split('/').filter(Boolean);
          for (const k of node.children.filter(c => c.name === steps[0])) {
            if (steps.length === 1) { found.push({ path: k.path, start: k.start, end: k.end }); continue; }
            // an element below a child of the level (Dbtr/PstlAdr): its parent must keep other elements
            const all = U().elementsBelow(ctx, k, () => true);
            const kids = new Map();
            for (const e of all) { const pp = X().parentOf(e.path); kids.set(pp, (kids.get(pp) || 0) + 1); }
            const hit = all.filter(e => e.names.length === steps.length - 1 && e.names.every((s, i) => s === steps[i + 1]));
            for (const e of hit) {
              const pp = X().parentOf(e.path);
              if (kids.get(pp) <= hit.filter(h => X().parentOf(h.path) === pp).length) { reason = reason || `${X().nameOf(pp)} would be left empty: leave it out or change it in the system that creates the file.`; continue; }
              found.push(e);
            }
          }
        }
        // an element inside another one that goes is not removed on its own
        found.sort((a, b) => a.path.length - b.path.length);
        for (const e of found) {
          if (seen.has(e.path) || [...seen].some(s => e.path.startsWith(s + '/'))) continue;
          seen.add(e.path);
          const old = U().textOf(ctx, e);
          rows.push(X().row(it, { op: 'remove', path: e.path, old, next: null, element: U().fieldOf(e.path) }));
        }
      }
      return { rows, reason: reason || 'The elements named in the setting were not found.' };
    }
  };

  /* ---------------------------------------------------------- a missing identifier, typed by the user */
  const entryTarget = (ctx, path, def) => X().under(path, U().version(ctx) === '09' && def.element09 ? def.element09 : def.element);
  A.insertEntry = {
    kind: 'entry',
    needs: (ctx, group, def) => {
      const ts = U().items(group).map(it => entryTarget(ctx, U().pathOf(it), def));
      return { paths: [...ts, ...ts.map(X().parentOf)], children: ts.map(X().parentOf) };
    },
    rows: (ctx, group, def) => {
      const rows = [], seen = new Set();
      let reason = '';
      for (const it of U().items(group)) {
        const t = entryTarget(ctx, U().pathOf(it), def);
        if (seen.has(t)) continue;
        seen.add(t);
        const n = ctx.node(t);
        if (n && n.leaf) { rows.push(X().row(it, { op: 'text', path: n.path, old: n.value, next: null, val: '' })); continue; }
        if (n) continue;
        const parent = ctx.node(X().parentOf(t));
        if (!parent) { reason = reason || `${X().nameOf(X().parentOf(t))} is missing as well: add it in the system that creates the file.`; continue; }
        if (parent.selfClosing) { reason = reason || `${parent.name} is written as an empty element: add the value in the system that creates the file.`; continue; }
        rows.push(X().row(it, { op: 'insert', path: t, insert: { parent: parent.path, name: X().nameOf(t), after: def.after || [] }, old: null, next: null, val: '', element: U().fieldOf(t) }));
      }
      return U().oneValue({ rows, reason });
    }
  };

  /* ---------------------------------------------------------- 9.7 */
  const prefixOf = p => (/^(.*?)\/PmtInf\[/.exec(p) || [])[1] || '';
  A.sameDebtorName = {
    kind: 'calculated',
    needs: (ctx, group) => {
      const it = U().items(group)[0];
      const P = it ? prefixOf(U().pathOf(it)) : '';
      const paths = [];
      for (let k = 1; k <= ((ctx.result && ctx.result.blocks) || []).length; k++) {
        const b = `${P}/PmtInf[${k}]`;
        paths.push(`${b}/Dbtr[1]/Nm[1]`, `${b}/DbtrAcct[1]/Id[1]/IBAN[1]`, `${b}/DbtrAcct[1]/Id[1]/Othr[1]/Id[1]`);
      }
      return { paths };
    },
    rows: (ctx, group) => {
      const it0 = U().items(group)[0];
      const P = it0 ? prefixOf(U().pathOf(it0)) : '';
      const acct = k => { const n = ctx.node(`${P}/PmtInf[${k}]/DbtrAcct[1]/Id[1]/IBAN[1]`) || ctx.node(`${P}/PmtInf[${k}]/DbtrAcct[1]/Id[1]/Othr[1]/Id[1]`); return n ? n.value.replace(/\s+/g, '').toUpperCase() : ''; };
      const first = new Map();
      for (let k = 1; k <= ctx.result.blocks.length; k++) { const a = acct(k); if (a && !first.has(a)) first.set(a, k); }
      return U().each(ctx, group, { element: 'Dbtr/Nm' }, (it, n) => {
        const k = TP.findings.placeOf(n.path).block, f = first.get(acct(k));
        const name = f && f !== k ? ctx.node(`${P}/PmtInf[${f}]/Dbtr[1]/Nm[1]`) : null;
        if (!name || !name.value.trim()) return null;
        return X().row(it, { op: 'text', path: n.path, old: n.value, next: name.value });
      });
    }
  };
})(typeof self !== 'undefined' ? self : globalThis);
