/*
 * Testing Portal – the changes proposed for a report (M3, fix the errors).
 *
 *   TP.fix.propose(result, text, opts) → { proposals: [Proposal], manual: [{ group, rule, part, title, severity, count, reason }] }
 *   opts = { fixes (config/fixes.json), settings, country, countryConfig, now }
 *   TP.fix.validateProposal(p) sets row.error for samples, choices and entries (empty when fine)
 *   TP.fix.setValue(p, value) sets the value of every row of a sample, choice or entry
 *
 * Shapes: docs/specs/M3.md, section 3.2. Actions (js/fix/actions/*.js) register as
 *   TP.fix.actions[name] = { kind: 'calculated' | 'sample' | 'choice' | 'entry',
 *                            needs?(ctx, group, def) → { paths: [...], children: [...] },
 *                            rows(ctx, group, def) → [Row] | { rows: [Row], reason } }
 * ctx = { result, text, settings, country, countryConfig, F: TP.functions, node(path) → located element or null }
 * node() answers only for the paths an action asked for in needs (one pass over the file for all actions).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};
  TP.fix.actions = TP.fix.actions || {};

  const MANUAL = 'No change can be proposed here: fix it in the system that creates the file.';

  /* the definition for a finding group: "5.6-cdtr" before "5.6" */
  function defOf(fixes, group) {
    const all = (fixes && fixes.fixes) || {};
    return (group.part && all[`${group.rule}-${group.part}`]) || all[group.rule] || null;
  }

  /* a row with the place of a finding item (where, block, transaction, EndToEndId) */
  function row(item, fields) {
    return { where: item.where, block: item.block || null, tx: item.tx || null, e2e: item.e2e || null, line: item.line || null, ...fields };
  }

  /*
   * A path below a finding's element: under('/…/CdtTrfTxInf[3]', 'Cdtr/Nm') → '/…/CdtTrfTxInf[3]/Cdtr[1]/Nm[1]'.
   * If the finding is already on that element (its path ends with Cdtr[n]/Nm[n]), its own path is used.
   */
  function under(path, rel) {
    if (!rel) return path;
    const steps = rel.split('/').filter(Boolean);
    const parts = String(path).split('/');
    const tail = parts.slice(-steps.length).map(p => p.replace(/\[\d+\]$/, ''));
    if (tail.join('/') === steps.map(s => s.replace(/\[\d+\]$/, '')).join('/')) return path;
    return path + steps.map(s => '/' + (/\[\d+\]$/.test(s) ? s : s + '[1]')).join('');
  }
  /*
   * Where an element can be when a value may be given on the transaction or on its block
   * (ChrgBr, PmtTpInf …): the finding's own path first, then each ancestor with rel below it.
   */
  function candidates(path, rel) {
    const out = [under(path, rel)];
    let p = String(path);
    while (/\/[^/]+\/[^/]+$/.test(p)) { p = p.replace(/\/[^/]+$/, ''); out.push(under(p, rel)); }
    return [...new Set(out)];
  }
  /* "Payment block 2" or "Payment block 2, transaction 7" for an element path */
  function whereOfPath(path) {
    const pl = TP.findings && TP.findings.placeOf ? TP.findings.placeOf(path) : null;
    if (pl && TP.findings.whereOf) return TP.findings.whereOf(pl.block || null, pl.tx || null);
    return null;
  }
  const parentOf = path => String(path).replace(/\/[^/]+$/, '');
  const nameOf = path => String(path).split('/').pop().replace(/\[\d+\]$/, '');

  const ID_ELEMENT = /\/(MsgId|PmtInfId|InstrId|EndToEndId)\[\d+\]$/;
  function propose(result, text, opts) {
    opts = opts || {};
    const proposals = [], manual = [];
    if (!result || !result.groups || !text || result.stopped) return { proposals, manual };
    // the functions of the rules read the settings and the country from TP.context
    TP.context = Object.assign({}, TP.context || {}, { country: opts.country, countryConfig: opts.countryConfig || {}, settings: opts.settings || {}, now: opts.now || null });
    if (TP.functions && TP.functions.resetCaches) TP.functions.resetCaches();
    const located = new Map();
    const ctx = { result, text, settings: opts.settings || {}, country: opts.country, countryConfig: opts.countryConfig || {}, F: TP.functions || {}, node: p => located.get(TP.fix.elementPath(p)) || null };

    const work = [];
    for (const group of result.groups) {
      if (group.severity === 'I') continue;
      const base = { group: group.id, rule: group.rule, part: group.part || null, title: group.title, severity: group.severity, count: group.items.length };
      const def = defOf(opts.fixes, group);
      if (!def || def.manual) { manual.push({ ...base, reason: (def && def.manual) || MANUAL }); continue; }
      const action = TP.fix.actions[def.action];
      if (!action) { manual.push({ ...base, reason: MANUAL }); continue; }
      work.push({ group, def, action, base });
    }
    // one pass over the file for what the actions need
    const paths = [], children = [];
    for (const w of work) if (w.action.needs) {
      try { const n = w.action.needs(ctx, w.group, w.def) || {}; paths.push(...(n.paths || [])); children.push(...(n.children || [])); }
      catch (err) { w.error = err; }
    }
    if (paths.length || children.length) for (const [k, v] of TP.fix.locate(text, paths, { children })) located.set(k, v);

    for (const w of work) {
      let out;
      try { out = w.error ? { rows: [], reason: String(w.error.message || w.error) } : w.action.rows(ctx, w.group, w.def); }
      catch (err) { out = { rows: [], reason: `The change could not be prepared (${err.message || err}).` }; }
      let rows = (Array.isArray(out) ? out : (out && out.rows) || []).filter(Boolean);
      // a value with an XML comment inside is never rewritten (the comment would be lost or become text);
      // the other rows of its unit go with it
      const mixed = rows.filter(r => r.op === 'text' && ctx.node(r.path) && ctx.node(r.path).mixed);
      if (mixed.length) {
        const units = new Set(mixed.map(r => r.unit).filter(u => u != null));
        rows = rows.filter(r => !mixed.includes(r) && !(r.unit != null && units.has(r.unit)));
        if (!rows.length) { manual.push({ ...w.base, reason: 'The value contains an XML comment, so it is not changed here: correct it in the system that creates the file.' }); continue; }
      }
      if (!rows.length) { manual.push({ ...w.base, reason: (out && out.reason) || MANUAL }); continue; }
      const kind = w.action.kind || 'calculated';
      // a calculated change of an id (5.2 on an EndToEndId: "Müller-01" → "Muller-01") changes what the
      // creditor and the bank see: proposed, not ticked, like a new id (spec §1, review R16)
      const changesId = kind === 'calculated' && rows.some(r => r.op === 'text' && ID_ELEMENT.test(r.path || ''));
      for (const r of rows) {
        if (r.val === undefined) r.val = r.next == null ? '' : r.next;
        r.error = r.error || '';
      }
      const p = {
        id: w.group.id, group: w.group.id, rule: w.group.rule, part: w.group.part || null, title: w.group.title, severity: w.group.severity,
        field: w.def.field || w.group.title, kind, changesPayment: !!w.def.changesPayment || changesId,
        sel: kind === 'calculated' && !w.def.changesPayment && !changesId,
        options: w.def.options || null, check: w.def.check || null, note: w.def.note || null,
        open: w.group.items.length - rows.length, rows
      };
      // what a typed value is checked against: the schema version, and the character sets of the places
      p.version = result.version || null;
      if (kind !== 'calculated') p.allowed = allowedFor(ctx, rows);
      validateProposal(p);
      proposals.push(p);
    }
    return { proposals, manual };
  }

  // a character allowed at every place of the rows (the 5.1 character set of each payment type), or null
  function allowedFor(ctx, rows) {
    const U = TP.fix.util;
    if (!U || !U.charsetOf || !U.inSet) return null;
    const tests = new Map();
    for (const r of rows.slice(0, 200)) {
      const path = r.op === 'insert' ? r.insert && r.insert.parent : r.path;
      if (!path) continue;
      try { const set = U.charsetOf(ctx, path); if (set && !tests.has(set)) tests.set(set, U.inSet(ctx, set)); } catch (e) { /* no set: not checked */ }
    }
    const fns = [...tests.values()].filter(f => typeof f === 'function');
    return fns.length ? ch => fns.every(f => f(ch)) : null;
  }

  /* samples, choices and entries: one value for all rows, checked with the definition's check */
  function validateProposal(p) {
    if (p.kind === 'calculated') return p;
    const check = (p.check && TP.fix.checks[p.check]) || (p.kind === 'entry' ? TP.fix.checks.any : null);
    for (const r of p.rows) {
      if (p.options && !p.options.includes(r.val)) { r.error = `Choose one of ${p.options.join(', ')}.`; continue; }
      r.error = check ? check(r.val, p) : '';
    }
    return p;
  }
  function setValue(p, value) {
    const v = p.check ? TP.fix.normalise(p.check, value) : value;
    for (const r of p.rows) r.val = v;
    return validateProposal(p);
  }

  Object.assign(TP.fix, { propose, validateProposal, setValue, defOf, row, under, candidates, whereOfPath, parentOf, nameOf, MANUAL });
})(typeof self !== 'undefined' ? self : globalThis);
