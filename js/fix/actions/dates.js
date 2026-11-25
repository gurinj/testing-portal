/*
 * Testing Portal – fixes for dates (M3). All change what the payment does: proposed, not ticked.
 *
 *   executionDate  def.mode:
 *                    past         4.10  today, or the next business day if today is not one
 *                                       (SEPA Instant: today; they are executed the day they are sent)
 *                    nonBusiness  10.1  the next business day after the date
 *                    today        7.11  today (SEPA Instant payments dated in the future)
 *                  Business days as in 10.1: no weekend, no holiday of the country file, and no
 *                  TARGET closing day when the block has EUR payments that are not instant
 *                  (TP.functions.tpNonBusinessDay). The date is ReqdExctnDt (.03) or
 *                  ReqdExctnDt/Dt (.09); for ReqdExctnDt/DtTm the date part is changed, the time kept.
 *   creationNow    4.2-future  CreDtTm: the time of the check, written as the file writes it
 *                  (with Z, with an offset, or local time without one)
 *   dateOnly       4.12  ReqdExctnDt/DtTm (.09) becomes ReqdExctnDt/Dt with its date: two rows per
 *                  place, the new Dt and the DtTm removed
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};
  const A = TP.fix.actions = TP.fix.actions || {};
  const U = () => TP.fix.util;
  const X = () => TP.fix;
  const Fn = () => TP.functions;

  const pad = n => String(n).padStart(2, '0');
  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  /* what the payment types of a block mean for its execution date */
  function calendarOf(b) {
    const txs = b ? b.txs : [];
    const notInstant = txs.filter(t => t.type !== 'SEPA_INST');
    return {
      instant: txs.some(t => t.type === 'SEPA_INST'),
      onlyInstant: txs.length > 0 && !notInstant.length,
      target: notInstant.some(t => String(t.ccyOfTrf || t.ccy || '').trim() === 'EUR')
    };
  }
  /* the first business day from date on (date itself included) */
  function businessDayFrom(date, target) {
    let d = date;
    for (let i = 0; i < 60 && Fn().tpNonBusinessDay(d, target); i++) d = addDays(d, 1);
    return d;
  }

  const rdOf = path => U().target(path, 'ReqdExctnDt');
  const datePaths = rd => [rd, `${rd}/Dt[1]`, `${rd}/DtTm[1]`];
  /* the element that holds the date: ReqdExctnDt (.03), its Dt or DtTm (.09) */
  function dateNode(ctx, rd) {
    const n = ctx.node(rd);
    if (!n) return null;
    return n.leaf ? n : ctx.node(`${rd}/Dt[1]`) || ctx.node(`${rd}/DtTm[1]`);
  }

  A.executionDate = {
    kind: 'calculated',
    needs: (ctx, group) => ({ paths: U().items(group).flatMap(it => datePaths(rdOf(U().pathOf(it)))) }),
    rows: (ctx, group, def) => U().each(ctx, group, def, (it, n) => {
      const old = n.value.trim();
      const date = old.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { reason: 'The execution date is not a date.' };
      const cal = calendarOf(U().blockOf(ctx, n.path));
      const today = Fn().tpToday();
      let next;
      if (def.mode === 'today') next = today;
      else if (def.mode === 'nonBusiness') {
        if (cal.instant) return { reason: 'The block also has SEPA Instant payments, which are executed on the day they are sent: put them into a block of their own.' };
        next = businessDayFrom(addDays(date, 1), cal.target);
      } else next = cal.instant ? today : businessDayFrom(today, cal.target);
      if (next === date) return null;
      const value = n.name === 'DtTm' ? next + old.slice(10) : next;
      return X().row(it, { op: 'text', path: n.path, old: n.value, next: value });
    }, { node: it => dateNode(ctx, rdOf(U().pathOf(it))) })
  };

  A.creationNow = {
    kind: 'calculated',
    needs: (ctx, group) => U().needsOf(group, { element: 'CreDtTm' }),
    rows: (ctx, group) => U().each(ctx, group, { element: 'CreDtTm' }, (it, n) => {
      const now = TP.context && TP.context.now ? new Date(TP.context.now) : new Date();
      const old = n.value.trim();
      const local = Fn().localIso(now);
      const next = /Z$/i.test(old) ? now.toISOString().slice(0, 19) + 'Z' : /[+-]\d{2}:\d{2}$/.test(old) ? local : local.slice(0, 19);
      return X().row(it, { op: 'text', path: n.path, old: n.value, next });
    })
  };

  A.dateOnly = {
    kind: 'calculated',
    needs: (ctx, group) => { const ps = U().items(group).map(U().pathOf); return { paths: ps, children: ps.map(X().parentOf) }; },
    rows: (ctx, group) => {
      const rows = [], seen = new Set();
      let reason = '';
      for (const it of U().items(group)) {
        const n = ctx.node(U().pathOf(it));
        if (!n || n.name !== 'DtTm' || seen.has(n.path)) continue;
        seen.add(n.path);
        const date = n.value.trim().slice(0, 10);
        const rd = X().parentOf(n.path), parent = ctx.node(rd);
        if (X().checks.date(date)) { reason = reason || 'The date part of the date and time is not a date.'; continue; }
        if (!parent || (parent.children || []).some(k => k.name === 'Dt')) { reason = reason || 'ReqdExctnDt has a date (Dt) already.'; continue; }
        // the new Dt first, then the DtTm removed: both changes start at the same place of the file
        rows.push(X().row(it, { op: 'insert', path: `${rd}/Dt[1]`, insert: { parent: rd, name: 'Dt', after: [] }, old: n.value, next: date, element: 'ReqdExctnDt/Dt', unit: rd }));
        rows.push(X().row(it, { op: 'remove', path: n.path, old: n.value, next: null, element: 'ReqdExctnDt/DtTm', unit: rd }));
      }
      return { rows, reason };
    }
  };

  TP.fix.util = Object.assign(TP.fix.util || {}, { addDays, businessDayFrom, calendarOf });
})(typeof self !== 'undefined' ? self : globalThis);
