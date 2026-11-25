/*
 * Testing Portal – fixes for values in the wrong form (M3).
 * Only a value with one obvious right form is changed; anything else stays open with a reason.
 *
 *   xsdPattern     2.7   IBAN without spaces in capitals; BIC, country, currency (also the Ccy
 *                        attribute), LEI in capitals; UETR in small letters; each only if the result
 *                        has the form of the schema (country and currency: an ISO code).
 *                        NbOfTxs: the number of transactions (as 4.3, 4.7)
 *   xsdCode        2.8   a code of the schema's list written in small letters or with spaces (slev → SLEV)
 *   xsdDate        2.10  25.11.2026, 2026.11.25, 2026/11/25, 20261125, 2026-11-5 → 2026-11-25
 *                        (day first only with dots, the form used in the bank's countries);
 *                        a date and time with a space instead of T or without seconds; a date
 *                        given with a time where only a date is allowed loses the time
 *   xsdBoolean     2.11  TRUE / False → true / false
 *   xsdAmount      2.9   CtrlSum is worked out again from the amounts (as 4.4, 4.8); other amounts
 *                        are never changed
 *   isoCode        4.27-code, 4.34–4.37, 5.12: a code of the ISO list (def.list) written in small
 *                        letters or with spaces (sepa → SEPA); unknown codes stay open
 *   clearingMember 4.27-member: the member id without spaces, dots, dashes or slashes, if it then
 *                        has the format of its clearing system
 * All calculated and ticked: the value means the same as before.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};
  const A = TP.fix.actions = TP.fix.actions || {};
  const U = () => TP.fix.util;
  const X = () => TP.fix;
  const Fn = () => TP.functions;
  const up = v => String(v).trim().toUpperCase();
  const pad = n => String(n).padStart(2, '0');

  /* the value of an XSD finding: the attribute's (Ccy) or the element's */
  const valueOf = (it, n) => (it.attribute ? (n.attrs[it.attribute] ? n.attrs[it.attribute].value : null) : n.value);
  function xsdRow(it, n, next) {
    const old = valueOf(it, n);
    if (old == null || next === old) return null;
    return it.attribute ? X().row(it, { op: 'attr', path: n.path, attr: it.attribute, old, next, element: `${U().fieldOf(n.path)}/@${it.attribute}` })
      : X().row(it, { op: 'text', path: n.path, old, next });
  }
  const needsOwn = (ctx, group) => U().needsOf(group, {});

  /* ---------------------------------------------------------- 2.7 patterns */
  const BIC03 = /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/, BIC09 = /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
  const PATTERNS = {
    IBAN: { fix: v => String(v).replace(/\s+/g, '').toUpperCase(), re: /^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$/ },
    BIC: { fix: up, re: BIC03 }, BICOrBEI: { fix: up, re: BIC03 }, BICFI: { fix: up, re: BIC09 }, AnyBIC: { fix: up, re: BIC09 },
    Ctry: { fix: up, re: /^[A-Z]{2}$/, list: 'countries' }, CtryOfBirth: { fix: up, re: /^[A-Z]{2}$/, list: 'countries' }, CtryOfRes: { fix: up, re: /^[A-Z]{2}$/, list: 'countries' },
    Ccy: { fix: up, re: /^[A-Z]{3}$/, list: 'currencies' }, CcyOfTrf: { fix: up, re: /^[A-Z]{3}$/, list: 'currencies' }, UnitCcy: { fix: up, re: /^[A-Z]{3}$/, list: 'currencies' },
    UETR: { fix: v => String(v).trim().toLowerCase(), re: /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/ },
    LEI: { fix: up, re: /^[A-Z0-9]{18}[0-9]{2}$/ }
  };
  const WHAT = { countries: 'country code', currencies: 'currency code' };
  A.xsdPattern = {
    kind: 'calculated',
    needs: needsOwn,
    rows: (ctx, group) => U().each(ctx, group, {}, (it, n) => {
      if (!it.attribute && n.name === 'NbOfTxs') {
        const c = U().countFor(ctx, n.path);
        return c == null ? { reason: 'The transactions cannot be counted here.' } : xsdRow(it, n, c);
      }
      const name = it.attribute || n.name;
      const p = PATTERNS[name];
      const old = valueOf(it, n);
      if (!p || old == null) return { reason: `${name} cannot be corrected here: correct it in the system that creates the file.` };
      const next = p.fix(old);
      if (!p.re.test(next)) return { reason: `"${old}" cannot be corrected safely: correct ${name} in the system that creates the file.` };
      if (p.list && !Fn().tpIn(p.list, next)) return { reason: `${next} is not an ISO ${WHAT[p.list]}: correct ${name} in the system that creates the file.` };
      return xsdRow(it, n, next);
    }, { leaf: false })
  };

  /* ---------------------------------------------------------- 2.8 codes of the schema */
  A.xsdCode = {
    kind: 'calculated',
    needs: needsOwn,
    rows: (ctx, group) => U().each(ctx, group, {}, (it, n) => {
      const allowed = String(it.expected || '').split(/,\s*/).filter(Boolean);
      const old = valueOf(it, n);
      const next = old == null ? '' : up(old);
      if (!allowed.includes(next)) return { reason: `"${old}" is not one of ${allowed.join(', ')}: choose the right code in the system that creates the file.` };
      return xsdRow(it, n, next);
    }, { leaf: false })
  };

  /* ---------------------------------------------------------- 2.10 dates */
  function realDate(y, m, d) {
    const t = new Date(Date.UTC(+y, +m - 1, +d));
    return t.getUTCFullYear() === +y && t.getUTCMonth() === +m - 1 && t.getUTCDate() === +d ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  /* "25.11.2026" → "2026-11-25"; null if there is no one obvious date */
  function isoDate(v) {
    const s = String(v).trim();
    let m;
    if ((m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s))) return realDate(m[1], m[2], m[3]);
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return realDate(m[1], m[2], m[3]);
    if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) return realDate(m[3], m[2], m[1]);
    return null;
  }
  /* "2026-11-25 10:30" → "2026-11-25T10:30:00"; a time zone and fractions of a second are kept */
  function isoDateTime(v) {
    const m = /^(.+?)(?:T|\s+)(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(String(v).trim());
    if (!m) return null;
    const date = isoDate(m[1]);
    if (!date || +m[2] > 23 || +m[3] > 59 || (m[4] && +m[4] > 59)) return null;
    return `${date}T${pad(m[2])}:${m[3]}:${m[4] || '00'}${m[5] || ''}${m[6] || ''}`;
  }
  A.xsdDate = {
    kind: 'calculated',
    needs: needsOwn,
    rows: (ctx, group) => U().each(ctx, group, {}, (it, n) => {
      const withTime = /T|hh/.test(String(it.expected || '')) || n.name === 'CreDtTm' || n.name === 'DtTm';
      let next;
      if (withTime) next = isoDateTime(n.value);
      else { next = isoDate(n.value); if (!next) { const dt = isoDateTime(n.value); next = dt ? dt.slice(0, 10) : null; } }
      if (!next) return { reason: withTime ? `"${n.value}" is not a date and time with one clear meaning: write it as YYYY-MM-DDThh:mm:ss in the system that creates the file.` : `"${n.value}" is not a date with one clear meaning: write it as YYYY-MM-DD in the system that creates the file.` };
      return xsdRow(it, n, next);
    })
  };

  /* ---------------------------------------------------------- 2.11 true or false */
  A.xsdBoolean = {
    kind: 'calculated',
    needs: needsOwn,
    rows: (ctx, group) => U().each(ctx, group, {}, (it, n) => {
      const next = String(n.value).trim().toLowerCase();
      if (next !== 'true' && next !== 'false') return { reason: `"${n.value}" is not clearly true or false: correct it in the system that creates the file.` };
      return xsdRow(it, n, next);
    })
  };

  /* ---------------------------------------------------------- 2.9 amounts: only the control sum */
  A.xsdAmount = {
    kind: 'calculated',
    needs: needsOwn,
    rows: (ctx, group) => U().each(ctx, group, {}, (it, n) => {
      if (it.attribute || n.name !== 'CtrlSum') return { reason: 'Amounts are never changed here: correct the amount in the system that creates the file.' };
      const s = U().sumFor(ctx, n.path);
      return s.reason ? s : xsdRow(it, n, s.value);
    }, { leaf: false })
  };

  /* ---------------------------------------------------------- ISO external codes in small letters */
  A.isoCode = {
    kind: 'calculated',
    needs: needsOwn,
    rows: (ctx, group, def) => U().each(ctx, group, {}, (it, n) => {
      const next = up(n.value);
      if (!def.list || !Fn().tpIn(def.list, next)) return { reason: `"${n.value.trim()}" is not a code of the ISO list: choose the right code in the system that creates the file.` };
      return next === n.value ? null : X().row(it, { op: 'text', path: n.path, old: n.value, next });
    })
  };

  /* ---------------------------------------------------------- 4.27-member */
  const sysPath = mmb => `${X().parentOf(mmb)}/ClrSysId[1]/Cd[1]`;
  A.clearingMember = {
    kind: 'calculated',
    needs: (ctx, group) => { const ps = U().items(group).map(U().pathOf); return { paths: [...ps, ...ps.map(sysPath)] }; },
    rows: (ctx, group) => U().each(ctx, group, {}, (it, n) => {
      const sys = ctx.node(sysPath(n.path));
      const code = sys ? up(sys.value) : '';
      const next = String(n.value).replace(/[\s./-]+/g, '').toUpperCase();
      if (!code || !next || Fn().tpClearingProblem(code, next) !== '') return { reason: `The member id "${n.value.trim()}" does not have the format of ${code || 'its clearing system'}: correct it in the system that creates the file.` };
      return next === n.value ? null : X().row(it, { op: 'text', path: n.path, old: n.value, next });
    })
  };

  TP.fix.util = Object.assign(TP.fix.util || {}, { isoDate, isoDateTime });
})(typeof self !== 'undefined' ? self : globalThis);
