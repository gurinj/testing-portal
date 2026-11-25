/*
 * Testing Portal – turns the raw findings of all stages into the report.
 * Plain function, no DOM: used on the page and in the Node tests.
 *
 *  1. adds the catalogue title, check, hint and reason code to every finding;
 *  2. suppresses a rule finding on an element whose value already failed the
 *     XSD (2.6–2.11); the XSD finding lists what was suppressed;
 *  3. groups repeated findings: one group per rule, level and (for the XSD)
 *     element and message, with one item per place;
 *  4. works out the status of the file, of each payment block and of each
 *     transaction (RJCT with an error, ACWC with only warnings, else ACTC);
 *  5. counts per module, for the module strip.
 *
 * Input:  { findings, summary, catalogue, stopped, timings, ... }
 * Output: { status, counts, occurrences, groups, items, suppressed, blocks, modules, facts }
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const LEVELS = { file: 0, block: 1, tx: 2 };
  const SEV_RANK = { E: 0, W: 1, I: 2 };
  const VALUE_CHECKS = new Set(['2.6', '2.7', '2.8', '2.9', '2.10', '2.11']);

  const place = () => TP.findings;
  const ruleNum = r => String(r).split('.').map(p => (/^\d+$/.test(p) ? +p : 999));
  const byRule = (a, b) => { const x = ruleNum(a), y = ruleNum(b); return x[0] - y[0] || (x[1] || 0) - (y[1] || 0); };

  function moduleOf(catalogue, stage) {
    const m = (catalogue.modules || []).find(m => m.stages.includes(stage));
    return m ? m.id : 'consistency';
  }

  // message with the values replaced, so the same error on 100 elements forms one group
  const template = m => String(m || '').replace(/'[^']*'/g, '…').replace(/\b\d+(\.\d+)?\b/g, 'n');

  /* "29115.79" -> 2911579000n at 5 decimals; also "+5.00", ".50", "5.", "007"; null if not a number the XSD accepts */
  function toUnits(v) {
    const m = /^\s*\+?(\d*)(?:\.(\d*))?\s*$/.exec(v == null ? '' : String(v));
    if (!m || (!m[1] && !m[2]) || (m[2] || '').length > 5) return null;
    return BigInt(m[1] || '0') * 100000n + BigInt((m[2] || '').padEnd(5, '0'));
  }
  function fromUnits(u, decimals) {
    const s = (u < 0n ? -u : u).toString().padStart(6, '0');
    let int = s.slice(0, -5), frac = s.slice(-5);
    frac = frac.slice(0, Math.max(decimals, frac.replace(/0+$/, '').length));
    int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (u < 0n ? '-' : '') + int + (frac ? '.' + frac : '');
  }
  const decimalsOf = ccy => (TP.functions && TP.functions.ccyDecimals ? TP.functions.ccyDecimals(ccy) : 2);
  const fmtAmount = (u, ccy) => fromUnits(u, decimalsOf(ccy));

  function build(input) {
    const cat = input.catalogue || { rules: {}, modules: [] };
    const summary = input.summary || { grp: {}, blocks: [] };
    const blocksByN = new Map(summary.blocks.map(b => [b.n, b]));
    const txOf = (b, t) => { const blk = blocksByN.get(b); return blk && t ? blk.txs[t - 1] : null; };

    // 0. settings.checks: switch a check off or change its severity or reason code (stages 2–10)
    const overrides = (input.settings && input.settings.checks) || {};
    const overrideOf = f => {
      if (!(f.stage >= 2 && f.stage <= 10) || /\.engine$/.test(f.rule)) return null;
      const byRule = overrides[f.rule], byPart = f.part ? overrides[`${f.rule}-${f.part}`] : null;
      return byRule || byPart ? { ...(byRule || {}), ...(byPart || {}) } : null;
    };
    const disabled = {};
    const input2 = [];
    for (const f of input.findings || []) {
      const o = overrideOf(f);
      if (o && o.enabled === false) { const k = f.part ? `${f.rule}-${f.part}` : f.rule; disabled[k] = (disabled[k] || 0) + 1; continue; }
      input2.push(o ? { ...f, severity: o.severity || f.severity, code: o.code !== undefined ? o.code : f.code, codeSet: o.code !== undefined, overridden: true } : f);
    }

    // 1. enrich
    const items = input2.map((f, i) => {
      const c0 = cat.rules[f.rule] || cat.rules[String(f.rule).replace(/\.engine$/, '')] || {};
      const c = f.part && c0.parts && c0.parts[f.part] ? { ...c0, ...c0.parts[f.part] } : c0; // a part may have its own title and hint
      const p = f.xpath ? place().placeOf(f.xpath) : { block: f.block || null, tx: f.tx || null };
      const block = f.block || p.block || null, tx = f.tx || p.tx || null;
      const t = txOf(block, tx);
      const level = f.level && f.level !== 'file' ? f.level : tx ? 'tx' : block ? 'block' : 'file';
      return {
        n: i, source: f.source, rule: f.rule, part: f.part || null, overridden: !!f.overridden, stage: f.stage, module: moduleOf(cat, f.stage),
        severity: f.severity || c.sev || 'E', code: f.codeSet ? (f.code || null) : f.code || c.code || null,
        title: /\.engine$/.test(f.rule) ? 'Some checks could not run' : c.title || f.message,
        check: c.check || null, hint: c.hint || null,
        message: f.message, expected: f.expected || null, actual: f.actual != null ? f.actual : null,
        xpath: f.xpath || null, line: f.line || null, col: f.col || null,
        level, block, tx, where: place().whereOf(block, level === 'file' ? null : tx),
        e2e: t ? t.e2e || null : null, creditor: t ? t.creditor || null : null,
        element: f.element || null, attribute: f.attribute || null, set: f.set || null,
        suppressedBy: null, suppresses: []
      };
    });

    // 2. suppress rule findings on elements whose value failed the XSD
    const xsdByPath = new Map();
    for (const it of items) if (it.source === 'xsd' && VALUE_CHECKS.has(it.rule) && it.xpath && !it.attribute) xsdByPath.set(it.xpath, it);
    const suppressed = [];
    for (const it of items) {
      if (it.source !== 'rules' || !it.xpath) continue;
      const x = xsdByPath.get(it.xpath);
      if (!x) continue;
      it.suppressedBy = x.n;
      x.suppresses.push({ rule: it.rule, title: it.title });
      suppressed.push(it);
    }
    const kept = items.filter(it => it.suppressedBy == null);

    // 3. group
    const groups = [];
    const index = new Map();
    for (const it of kept) {
      const key = it.source === 'xsd' ? `${it.rule}|${it.level}|${it.element}|${template(it.message)}` : `${it.rule}|${it.part || ""}|${it.level}|${it.severity}`;
      let gr = index.get(key);
      if (!gr) {
        gr = {
          id: 'g' + (groups.length + 1), key, rule: it.rule, stage: it.stage, module: it.module, source: it.source,
          part: it.part, overridden: it.overridden, severity: it.severity, code: it.code, title: it.title, check: it.check, hint: it.hint, level: it.level,
          message: it.source === 'xsd' ? it.message : null, items: []
        };
        index.set(key, gr);
        groups.push(gr);
      }
      gr.items.push(it);
    }
    for (const gr of groups) {
      gr.count = gr.items.length;
      gr.items.sort((a, b) => (a.line || 0) - (b.line || 0) || (a.col || 0) - (b.col || 0));
      const exp = new Set(gr.items.map(i => i.expected));
      gr.expected = exp.size === 1 ? gr.items[0].expected : null;
      const msgs = new Set(gr.items.map(i => i.message));
      if (msgs.size === 1) gr.message = gr.items[0].message;
      else if (gr.source === 'xsd') gr.message = template(gr.items[0].message).replace(/…/g, '(value)').replace(/\bn\b/g, '(number)');
      gr.suppresses = gr.items.reduce((n, i) => n + i.suppresses.length, 0);
    }
    groups.sort((a, b) => LEVELS[a.level] - LEVELS[b.level] || SEV_RANK[a.severity] - SEV_RANK[b.severity] || byRule(a.rule, b.rule) || (a.items[0].line || 0) - (b.items[0].line || 0));

    // 4. statuses
    const counts = { E: 0, W: 0, I: 0 }, occurrences = { E: 0, W: 0, I: 0 };
    for (const gr of groups) { counts[gr.severity]++; occurrences[gr.severity] += gr.count; }
    const status = counts.E ? 'RJCT' : counts.W ? 'ACWC' : 'ACTC';
    const fileE = kept.some(i => i.level === 'file' && i.severity === 'E');
    const fileW = kept.some(i => i.level === 'file' && i.severity === 'W');
    // findings indexed by block and transaction once (filtering all findings per transaction was
    // quadratic: 10,000 transactions with 28,000 findings took 7.5 s; review 2026-11-19)
    const fileNonI = kept.filter(i => i.level === 'file' && i.severity !== 'I').length;
    const byBlock = new Map();
    for (const i of kept) {
      if (i.block == null) continue;
      let e = byBlock.get(i.block);
      if (!e) byBlock.set(i.block, e = { all: 0, own: [], blockNonI: 0, tx: new Map() });
      e.all++;
      if (i.level === 'block') { e.own.push(i); if (i.severity !== 'I') e.blockNonI++; }
      if (i.tx != null) { let t = e.tx.get(i.tx); if (!t) e.tx.set(i.tx, t = []); t.push(i); }
    }
    const EMPTY = { all: 0, own: [], blockNonI: 0, tx: new Map() };
    const blocks = summary.blocks.map(b => {
      const e = byBlock.get(b.n) || EMPTY;
      const own = e.own;
      const blockE = own.some(i => i.severity === 'E'), blockW = own.some(i => i.severity === 'W');
      const txs = b.txs.map(t => {
        const ofTx = e.tx.get(t.n) || [];
        const mine = ofTx.filter(i => i.level === 'tx');
        const E = mine.some(i => i.severity === 'E'), W = mine.some(i => i.severity === 'W');
        const affecting = fileNonI + e.blockNonI + ofTx.filter(i => i.severity !== 'I' && i.level !== 'block').length + mine.filter(i => i.severity === 'I').length;
        return { ...t, status: fileE || blockE || E ? 'RJCT' : fileW || blockW || W ? 'ACWC' : 'ACTC', own: mine.length, findings: affecting };
      });
      const sums = {};
      for (const t of b.txs) { const u = toUnits(t.amount); if (u != null) { const c = t.ccy || '?'; sums[c] = (sums[c] || 0n) + u; } }
      const anyE = txs.some(t => t.status === 'RJCT'), anyW = txs.some(t => t.status === 'ACWC');
      return {
        ...b, txs, sums: Object.entries(sums).map(([c, u]) => `${c} ${fmtAmount(u, c)}`),
        findings: e.all,
        status: fileE || blockE || anyE ? 'RJCT' : fileW || blockW || anyW ? 'ACWC' : 'ACTC'
      };
    });

    // 5. modules
    const stopIndex = { intake: 1, identify: 1, 'well-formed': 1 }[input.stopped] || null;
    const modules = (cat.modules || []).map((m, i) => {
      const own = groups.filter(gr => gr.module === m.id);
      const c = { E: 0, W: 0, I: 0 };
      for (const gr of own) c[gr.severity]++;
      const notRun = stopIndex != null && i >= stopIndex;
      const failed = (input.failedModules || []).includes(m.id);
      const tone = notRun ? 'skip' : c.E ? 'bad' : c.W ? 'mid' : c.I ? 'inf' : failed ? 'mid' : 'ok';
      return { ...m, counts: c, n: own.length, notRun, failed, tone, planned: !!(input.plannedModules || []).includes(m.id) };
    });

    // facts
    const totals = {};
    for (const b of summary.blocks) for (const t of b.txs) { const u = toUnits(t.amount); if (u != null) { const c = t.ccy || '?'; totals[c] = (totals[c] || 0n) + u; } }
    const read = !!input.summary;
    const facts = {
      blocks: read ? summary.blocks.length : null,
      transactions: read ? summary.blocks.reduce((n, b) => n + b.txs.length, 0) : null,
      totals: Object.entries(totals).map(([c, u]) => `${c} ${fmtAmount(u, c)}`),
      types: typeCounts(summary),
      grp: summary.grp
    };

    // a check that could not run makes the result unreliable, whatever the status
    const incomplete = !!input.incomplete || kept.some(i => /\.engine$/.test(i.rule));
    return { status, incomplete, counts, occurrences, groups, items: kept, suppressed, disabled, blocks, modules, facts };
  }

  // payment types derived in the rules worker (rules-core typesOf): { label: count of transactions }
  function typeCounts(summary) {
    const out = {};
    for (const b of summary.blocks) for (const t of b.txs) if (t.typeLabel) out[t.typeLabel] = (out[t.typeLabel] || 0) + 1;
    return out;
  }

  TP.report = { build, toUnits, fmtAmount, template };
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = TP.report;
})(typeof self !== 'undefined' ? self : globalThis);
