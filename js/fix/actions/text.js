/*
 * Testing Portal – fixes for text values (M3).
 *
 *   cleanText       5.1, 5.2, 5.3, 5.4-spaces (def.fix: chars | translit | controls | trim)
 *                   translit: a character outside the set the rule used (the payment type's set,
 *                   js/validation/functions/charset.js) gets its plain Latin form (é → e, ß → ss),
 *                   as CMIplus would do it (TP.functions.translit);
 *                   chars: in addition, a character without a plain form is replaced: & → +,
 *                   _ → -, @ → (at), € → EUR, " → ', \ and | → /, brackets → ( ), ; → ,; any other
 *                   by a space (never by a character the set does not allow);
 *                   controls: tabs, line breaks and other control characters inside a value
 *                   become one space; trim: spaces and line breaks at the start and end go.
 *                   An element with several of these findings is changed by one proposal only,
 *                   which fixes all of them: the first of 5.1, 5.3, 5.4-spaces, 5.2 the element
 *                   has (5.1 changes the text, so the others wait for it). So all four checks
 *                   must use this action in config/fixes.json.
 *   removeBlank     5.4-blank: an optional element whose value is only spaces is left out, if its
 *                   parent keeps other elements
 *   shorten         2.6, 6.4, 7.6-name, 7.25, 10.3: a text cut to the length allowed. def.limit:
 *                   a number (7.6: 70), 'xsd' (2.6, the length in the finding), 'guideline'
 *                   (6.4, guideline.maxLength), 'crossBorder' (7.25, crossBorder.truncateLength,
 *                   the texts inside the transaction or block), 'hints' (10.3, hints.truncateLength).
 *                   Only names and free texts are cut, never ids, codes or references.
 *   joinRemittance  4.38-count, 7.6-rmt: several unstructured remittance lines (Ustrd) become one,
 *                   separated by a space, if they fit into 140 characters
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};
  const A = TP.fix.actions = TP.fix.actions || {};
  const U = () => TP.fix.util;
  const X = () => TP.fix;

  /* ---------------------------------------------------------- characters, controls, spaces */
  const ORDER = ['5.1', '5.3', '5.4-spaces', '5.2'];
  const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
  const CONTROL_RUN = /[ \u0000-\u001F\u007F-\u009F]*[\u0000-\u001F\u007F-\u009F][ \u0000-\u001F\u007F-\u009F]*/g;
  const EDGE = /^[ \t\r\n]+|[ \t\r\n]+$/g;
  const REPLACE = { '&': '+', _: '-', '@': '(at)', '€': 'EUR', '"': "'", '\\': '/', '|': '/', '[': '(', ']': ')', '{': '(', '}': ')', '<': '(', '>': ')', ';': ',' };

  /* the value with the problems in has fixed: { chars, translit, controls, trim }; ok(ch): in the set */
  function cleaned(value, has, ok) {
    let v = String(value);
    let replaced = false;
    if (has.controls) { v = v.replace(CONTROL_RUN, ' '); replaced = true; }
    if ((has.translit || has.chars) && ok) {
      let out = '';
      for (const ch of v) {
        if (ok(ch) || CONTROL.test(ch)) { out += ch; continue; }
        const t = TP.functions.translit(ch);
        if (t != null && [...t].every(ok)) { out += t; continue; }
        if (!has.chars) { out += ch; continue; }
        const r = REPLACE[ch];
        out += r && [...r].every(ok) ? r : ok(' ') ? ' ' : '';
        replaced = true;
      }
      v = out;
    }
    if (replaced) v = v.replace(/ {2,}/g, ' ');
    if (has.trim || replaced) v = v.replace(EDGE, '');
    return v;
  }

  A.cleanText = {
    kind: 'calculated',
    needs: (ctx, group) => U().needsOf(group, {}),
    rows: (ctx, group, def) => {
      const me = U().keyOf(group);
      const at = U().findingsAt(ctx);
      return U().each(ctx, group, {}, (it, n) => {
        const keys = at.get(n.path) || new Set([me]);
        // one proposal per element: the first of ORDER the element has
        const owner = ORDER.find(k => keys.has(k)) || me;
        if (owner !== me) {
          const og = (ctx.result.groups || []).find(gr => U().keyOf(gr) === owner);
          return { reason: `Changed together with "${og ? og.title : owner}", which changes the same text.` };
        }
        const has = { chars: keys.has('5.1'), translit: keys.has('5.1') || keys.has('5.2'), controls: keys.has('5.3'), trim: keys.has('5.4-spaces') };
        has[{ chars: 'chars', translit: 'translit', controls: 'controls', trim: 'trim' }[def.fix] || 'trim'] = true;
        const set = U().charsetOf(ctx, n.path);
        const ok = set ? U().inSet(ctx, set) : null;
        if ((has.chars || has.translit) && !ok && !has.controls && !has.trim) return { reason: 'The character set of this value is not configured.' };
        const next = cleaned(n.value, has, ok);
        if (next === n.value) return null;
        if (!next.trim()) return { reason: `Without the characters that are not allowed nothing is left of ${n.name}: correct it in the system that creates the file.` };
        const max = U().maxFor(ctx, n.path);
        if (max && U().len(next) > max) return { reason: `${n.name} would be longer than the ${max} characters allowed after the change: correct it in the system that creates the file.` };
        return X().row(it, { op: 'text', path: n.path, old: n.value, next });
      });
    }
  };

  /* ---------------------------------------------------------- values that are only spaces (5.4-blank) */
  // optional elements that can be left out when their parent keeps other elements
  const OPTIONAL = new Set(['InstrId', 'Ustrd', 'AdrLine', 'StrtNm', 'BldgNb', 'BldgNm', 'Flr', 'PstBx', 'Room', 'PstCd', 'TwnLctnNm', 'DstrctNm', 'CtrySubDvsn',
    'Dept', 'SubDept', 'AddtlRmtInf', 'InstrInf', 'Nm', 'Ref', 'CtrctId', 'EmailAdr']);
  A.removeBlank = {
    kind: 'calculated',
    needs: (ctx, group) => {
      const ps = U().items(group).map(U().pathOf);
      return { paths: ps, children: ps.map(X().parentOf) };
    },
    rows: (ctx, group) => U().each(ctx, group, {}, (it, n) => {
      if (n.value.trim()) return null;
      if (!OPTIONAL.has(n.name)) return { reason: `${n.name} cannot be left out: fill in the value in the system that creates the file.` };
      const parent = ctx.node(X().parentOf(n.path));
      if (!parent || !parent.children || parent.children.length < 2) return { reason: `${n.name} is the only element of ${X().nameOf(X().parentOf(n.path))}: fill in the value in the system that creates the file.` };
      return X().row(it, { op: 'remove', path: n.path, old: n.value, next: null });
    })
  };

  /* ---------------------------------------------------------- texts that are too long */
  // names and free texts; ids, codes and references are never cut (that would change what they identify)
  const FREE_TEXT = new Set(['Nm', 'AdrLine', 'StrtNm', 'BldgNm', 'TwnNm', 'TwnLctnNm', 'DstrctNm', 'CtrySubDvsn', 'Dept', 'SubDept', 'Flr', 'Room', 'Ustrd', 'AddtlRmtInf', 'InstrInf']);
  const setting = (ctx, p) => (TP.functions.get ? TP.functions.get(ctx.settings, p) : null);
  const namesOf = map => new Set(Object.keys(map && typeof map === 'object' ? map : {}).filter(k => k[0] !== '_' && typeof map[k] === 'number').map(k => k.split('/').filter(Boolean).pop()));

  function shortRow(it, path, value, max, units) {
    const next = U().cut(units === 'normalized' ? String(value).replace(/^[ \t\r\n]+/, '') : value, max, units === 'utf16' ? 'utf16' : 'code');
    if (!next) return null;
    return X().row(it, { op: 'text', path, old: value, next, element: U().fieldOf(path) });
  }

  A.shorten = {
    kind: 'calculated',
    needs: (ctx, group, def) => U().needsOf(group, { element: typeof def.limit === 'number' || def.limit === 'guideline' || def.limit === 'xsd' ? def.element : null }),
    rows: (ctx, group, def) => {
      const lim = def.limit;
      // the texts inside a transaction, block or group header (7.25, 10.3)
      if (lim === 'crossBorder' || lim === 'hints') {
        const map = setting(ctx, lim === 'hints' ? 'hints.truncateLength' : 'crossBorder.truncateLength');
        const names = namesOf(map);
        const rows = [], seen = new Set(), limits = new Map();
        // the limit depends on the element names of the path only
        const limitOfPath = p => { const k = p.replace(/\[\d+\]/g, ''); let v = limits.get(k); if (v === undefined) limits.set(k, v = U().limitOf(p, map)); return v; };
        for (const it of U().items(group)) {
          const node = ctx.node(U().pathOf(it));
          if (!node) continue;
          // a block's own texts, not those of its transactions (they are checked on their own)
          const skip = node.name === 'CdtTrfTxInf' ? null : name => name === 'CdtTrfTxInf';
          for (const e of U().elementsBelow(ctx, node, el => el.depth > 0 && el.leaf && names.has(el.name), skip)) {
            if (!e.leaf || seen.has(e.path)) continue;
            const max = limitOfPath(e.path);
            const tooLong = lim === 'hints' ? e.value.length > max : U().len(U().normSpace(e.value)) > max;
            if (!(max > 0) || !tooLong) continue;
            seen.add(e.path);
            const r = shortRow(it, e.path, e.value, max, lim === 'hints' ? 'utf16' : 'normalized');
            if (r) rows.push(r);
          }
        }
        return { rows, reason: 'No text to shorten was found.' };
      }
      return U().each(ctx, group, def, (it, n) => {
        let max = 0;
        if (typeof lim === 'number') max = lim;
        else if (lim === 'guideline') max = U().limitOf(n.path, setting(ctx, 'guideline.maxLength'));
        else if (lim === 'xsd') {
          const m = /at most (\d+)/.exec(`${it.expected || ''} ${it.message || ''}`);
          if (!m) return { reason: `${n.name} is empty or too short: give the value in the system that creates the file.` };
          max = +m[1];
        }
        if (!(max > 0)) return null;
        if (!FREE_TEXT.has(n.name)) return { reason: `${n.name} is an id, a code or a reference: it is not shortened here. Correct it in the system that creates the file.` };
        if (U().len(n.value) <= max) return null;
        return shortRow(it, n.path, n.value, max);
      });
    }
  };

  /* ---------------------------------------------------------- remittance lines (4.38-count, 7.6-rmt) */
  A.joinRemittance = {
    kind: 'calculated',
    needs: (ctx, group) => {
      const ps = U().items(group).map(it => U().target(U().pathOf(it), 'RmtInf'));
      return { paths: ps, children: ps };
    },
    rows: (ctx, group, def) => {
      const rem = setting(ctx, 'guideline.remittance') || {};
      const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
      const maxStrd = def.sepa ? 0 : num(rem.maxStrd);
      const rows = [];
      let reason = '';
      for (const it of U().items(group)) {
        const rmt = ctx.node(U().target(U().pathOf(it), 'RmtInf'));
        if (!rmt || !rmt.children) continue;
        const ustrd = rmt.children.filter(k => k.name === 'Ustrd'), strd = rmt.children.filter(k => k.name === 'Strd');
        if (maxStrd !== null && strd.length > maxStrd) { reason = reason || (def.sepa ? 'The remittance information has structured parts (Strd): send one structured reference or one text, in the system that creates the file.' : 'There are too many structured parts (Strd): combine them in the system that creates the file.'); continue; }
        if (ustrd.length < 2) continue;
        const vals = ustrd.map(k => U().innerOf(ctx, k));
        if (vals.some(v => !v)) { reason = reason || 'A remittance line contains other elements.'; continue; }
        const joined = vals.map(v => v.value.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
        const max = U().maxFor(ctx, ustrd[0].path) || 140;
        if (!joined || U().len(joined) > max) { reason = reason || `The remittance lines together have ${U().len(joined)} characters, more than the ${max} allowed in one: shorten them in the system that creates the file.`; continue; }
        // one unit: the joined line and the removed lines are made together or not at all (edit.js)
        rows.push(X().row(it, { op: 'text', path: ustrd[0].path, old: vals[0].value, next: joined, element: 'RmtInf/Ustrd', unit: rmt.path }));
        ustrd.slice(1).forEach((k, i) => rows.push(X().row(it, { op: 'remove', path: k.path, old: vals[i + 1].value, next: null, element: 'RmtInf/Ustrd', unit: rmt.path })));
      }
      return { rows, reason };
    }
  };

  TP.fix.util = Object.assign(TP.fix.util || {}, { cleaned });
})(typeof self !== 'undefined' ? self : globalThis);
