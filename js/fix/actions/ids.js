/*
 * Testing Portal – fixes for references and ids (M3). All change ids the customer's systems use:
 * proposed, not ticked.
 *
 *   uniqueId   9.1 PmtInfId, 9.2 InstrId, 9.3 EndToEndId used more than once: the first keeps its id,
 *              the others get "-2", "-3" … (the id is cut so that it stays within 35 characters;
 *              the suffix is unique in the file; "-" only where the character set allows it)
 *   newUetr    9.4 UETR used more than once: the first keeps it, the others get a new UUID v4
 *   idSlashes  5.5 a reference id without "/" at the start or end and without "//"
 *   blockId    4.6 a PmtInfId of spaces only: the MsgId and the block number ("MSG-0001-2")
 *
 * Ids are compared as the rules compare them: spaces collapsed, case kept (UETR in small letters).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};
  const A = TP.fix.actions = TP.fix.actions || {};
  const U = () => TP.fix.util;
  const X = () => TP.fix;
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /* the ids of one kind in the file (from the report), to keep new ones unique */
  function idsOf(ctx, name) {
    const out = new Set();
    const blocks = (ctx.result && ctx.result.blocks) || [];
    if (name === 'MsgId') { const m = ctx.result.facts && ctx.result.facts.grp && ctx.result.facts.grp.msgId; if (m) out.add(norm(m)); }
    for (const b of blocks) {
      if (name === 'PmtInfId' && b.id) out.add(norm(b.id));
      if (name === 'InstrId' || name === 'EndToEndId') for (const t of b.txs) { const v = name === 'InstrId' ? t.instrId : t.e2e; if (v) out.add(norm(v)); }
    }
    return out;
  }
  /* base + "-k", within 35 characters, not yet in taken (which it joins). next: Map base → the next k to try,
     so 10,000 copies of one id take one step each (review R3: restarting at 2 was quadratic) */
  function unique(base, taken, sep, first, next) {
    const key = `${sep}|${base}`;
    let k = Math.max(first || 2, (next && next.get(key)) || 2);
    let cutLen = -1, head = '';
    for (; k < 1000000; k++) {
      const suffix = `${sep}${k}`;
      if (suffix.length !== cutLen) { cutLen = suffix.length; head = U().cut(base, 35 - cutLen); } // cut once per suffix length
      const c = head + suffix;
      if (!taken.has(c)) { taken.add(c); if (next) next.set(key, k + 1); return c; }
    }
    return null;
  }
  const sepFor = (ctx, path) => { const ok = U().inSet(ctx, U().charsetOf(ctx, path)); return !ok || ok('-') ? '-' : ''; };

  A.uniqueId = {
    kind: 'calculated',
    needs: (ctx, group, def) => U().needsOf(group, def),
    rows: (ctx, group, def) => {
      const name = X().nameOf(def.element);
      const taken = idsOf(ctx, name);
      const seenValue = new Set(), counters = new Map();
      return U().each(ctx, group, def, (it, n) => {
        const v = norm(n.value);
        if (!v) return null;
        // the first element with this id keeps it
        if (!seenValue.has(v)) { seenValue.add(v); return null; }
        const next = unique(v, taken, sepFor(ctx, n.path), 2, counters);
        return next ? X().row(it, { op: 'text', path: n.path, old: n.value, next }) : { reason: 'No unique id could be made.' };
      });
    }
  };

  /* a random UUID version 4 in small letters */
  function uuid4() {
    const c = g.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID().toLowerCase();
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  A.newUetr = {
    kind: 'calculated',
    needs: (ctx, group, def) => U().needsOf(group, { element: def.element || 'PmtId/UETR' }),
    rows: (ctx, group, def) => {
      const seenValue = new Set();
      return U().each(ctx, group, { element: def.element || 'PmtId/UETR' }, (it, n) => {
        const v = norm(n.value).toLowerCase();
        if (!v) return null;
        if (!seenValue.has(v)) { seenValue.add(v); return null; }
        return X().row(it, { op: 'text', path: n.path, old: n.value, next: uuid4() });
      });
    }
  };

  A.idSlashes = {
    kind: 'calculated',
    needs: (ctx, group) => U().needsOf(group, {}),
    rows: (ctx, group) => {
      const taken = new Map();
      return U().each(ctx, group, {}, (it, n) => {
        if (!taken.has(n.name)) taken.set(n.name, idsOf(ctx, n.name));
        const next = norm(n.value).replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
        if (!next) return { reason: `${n.name} has nothing but "/": give it an id in the system that creates the file.` };
        if (next === n.value) return null;
        const ids = taken.get(n.name);
        if (ids.has(next) && next !== norm(n.value)) return { reason: `${n.name} "${next}" is used already in this file: change the id in the system that creates the file.` };
        ids.add(next);
        return X().row(it, { op: 'text', path: n.path, old: n.value, next });
      });
    }
  };

  A.blockId = {
    kind: 'calculated',
    needs: (ctx, group) => U().needsOf(group, { element: 'PmtInfId' }),
    rows: (ctx, group) => {
      const taken = idsOf(ctx, 'PmtInfId');
      const msg = norm(ctx.result.facts && ctx.result.facts.grp && ctx.result.facts.grp.msgId);
      return U().each(ctx, group, { element: 'PmtInfId' }, (it, n) => {
        if (n.value.trim()) return null;
        const b = TP.findings.placeOf(n.path).block || 1;
        const next = unique(msg || 'PMTINF', taken, sepFor(ctx, n.path), b);
        return next ? X().row(it, { op: 'text', path: n.path, old: n.value, next }) : { reason: 'No unique id could be made.' };
      });
    }
  };

  TP.fix.util = Object.assign(TP.fix.util || {}, { uuid4, uniqueIdOf: unique, idsOf });
})(typeof self !== 'undefined' ? self : globalThis);
