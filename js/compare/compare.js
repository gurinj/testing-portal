/*
 * Testing Portal – run comparison (M3).
 * Plain functions, no DOM: used on the page and in the Node tests.
 *
 * Two runs of the session are compared finding by finding. A finding is
 * matched by its check and its place, never by its line or element number,
 * so the comparison also works on a new version of the file in which
 * transactions were inserted or removed (the paths shift, the ids stay).
 *
 *   keysOf(result)  → Map<key, { group, item, place, pos, tail }> with a property meta
 *   runs(a, b)      → { resolved, open, new, skipped: [Group], counts, checks, meta }
 *                     a, b: two report results, or two key maps from keysOf
 *   keysOfRun(run)  → run.keys (kept when the result is dropped) or the keys of run.result
 *                     (once per result); null if the run has neither
 * meta = { fileName, status, stopped, incomplete, country, version, msgId,
 *          skipped: [module ids that did not run], ids: Set of place ids, findings }
 *
 * Key = check + place (+ the element below the place) (+ a running number):
 *   check      rule id and part: "4.4", "5.6-cdtr"
 *   place      file level         file
 *              block level        B:<PmtInfId>               no PmtInfId: B#<block>
 *              transaction level  T:<PmtInfId>/<EndToEndId>  no PmtInfId: T#<block>/…,
 *                                                            no EndToEndId: …/#<transaction>
 *              ids repeated in the file get a running number: the second
 *              block with PmtInfId PMT-01 is B:PMT-01#2, the second
 *              transaction with EndToEndId E1 in it T:PMT-01#2/E1, …
 *   element    the path below the place: "CdtrAcct[1]/Id[1]/IBAN[1]", so two
 *              findings of one check in one transaction stay apart
 *   XSD        also the element name and the message pattern (values and
 *              numbers replaced), so a different schema problem is a new finding
 *   |#n        running number if a key still repeats (in the order of the file)
 *   Example:   "5.6-cdtr|T:PMT-02/E2E-000004|CdtrAcct[1]/Id[1]/IBAN[1]"
 * Ids are written with %, /, | and # escaped (%25, %2F, %7C, %23).
 *
 * Matching:
 *  1. by key;
 *  2. what is left on both sides is matched by position (block and
 *     transaction number) where the id at that position was changed: an id
 *     that is not in the other run at all, on both sides (a fix that gives a
 *     transaction a new EndToEndId or a block a new PmtInfId). Inserted,
 *     removed or reordered transactions keep their ids, so this never pairs them.
 *  3. A finding of run a that is not in run b is resolved, unless its check
 *     did not run in run b (the run stopped at the first module, or the rule
 *     checks failed): then it is "skipped" (not compared). The same for a
 *     finding of run b whose check did not run in run a.
 * A finding whose severity changed counts as still open (item.was = old severity;
 * group.was when all its places changed alike, else group.changed = how many).
 *
 * Group = { ck, rule, part, title, severity, level, code, source, count, was?, changed?, run?,
 *           items: [{ where, e2e, line, block, tx, before?: { where, line }, was? }] }
 *   ck: the check across runs (rule, part, level; XSD: also element and message
 *   pattern). One group per check and list; a check resolved at some places
 *   and still open at others is in both lists. Resolved items are places of
 *   run a, all others of run b (open items: before = the place in run a).
 *   skipped groups: run = 'a' or 'b', the run the findings are from.
 * counts: places per list; checks: { resolved: in a only, open: in both, new: in b only,
 *   skipped }, counted like the report's findings (one per check).
 *
 * The maps hold small copies of the groups and items, so the key map of a
 * run can be kept after its result is dropped (only the last 3 results are kept).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const LEVELS = { file: 0, block: 1, tx: 2 };
  const SEV_RANK = { E: 0, W: 1, I: 2 };

  const ruleNum = r => String(r).split('.').map(p => (/^\d+$/.test(p) ? +p : 999));
  const byRule = (a, b) => { const x = ruleNum(a), y = ruleNum(b); return x[0] - y[0] || (x[1] || 0) - (y[1] || 0); };
  // the same pattern as the report's groups (findings/report.js)
  const template = m => (TP.report && TP.report.template ? TP.report.template(m) : String(m || '').replace(/'[^']*'/g, '…').replace(/\b\d+(\.\d+)?\b/g, 'n'));
  const idv = s => String(s).replace(/[%/|#]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const checkId = gr => gr.rule + (gr.part ? '-' + gr.part : '');
  // "/Document[1]/CstmrCdtTrfInitn[1]/PmtInf[2]/CdtTrfTxInf[7]/Amt[1]/InstdAmt[1]" → "Amt[1]/InstdAmt[1]"
  const PREFIX = /^\/Document\[\d+\](?:\/CstmrCdtTrfInitn\[\d+\](?:\/PmtInf\[\d+\](?:\/CdtTrfTxInf\[\d+\])?)?)?\/?/;
  const below = xpath => (xpath ? String(xpath).replace(PREFIX, '') : '');

  /* place ids of every block and transaction: by id (with running numbers) and by position */
  function placesOf(result) {
    const byPos = new Map(), ids = new Set();
    const seenB = new Map();
    for (const b of result.blocks || []) {
      let bref;
      if (b.id != null && b.id !== '') { const k = idv(b.id); const n = (seenB.get(k) || 0) + 1; seenB.set(k, n); bref = ':' + k + (n > 1 ? '#' + n : ''); }
      else bref = '#' + b.n;
      byPos.set('B#' + b.n, 'B' + bref);
      ids.add('B' + bref);
      const seenT = new Map();
      for (const t of b.txs || []) {
        let tref;
        if (t.e2e != null && t.e2e !== '') { const k = idv(t.e2e); const n = (seenT.get(k) || 0) + 1; seenT.set(k, n); tref = k + (n > 1 ? '#' + n : ''); }
        else tref = '#' + t.n;
        const p = 'T' + bref + '/' + tref;
        byPos.set(`T#${b.n}/#${t.n}`, p);
        ids.add(p);
      }
    }
    return { byPos, ids };
  }

  // modules whose checks did not run (stopped at the first module, rule checks failed)
  const skippedOf = result => (result.modules || []).filter(m => m.notRun || m.failed).map(m => m.id);

  function keysOf(result) {
    const { byPos, ids } = placesOf(result);
    const pairs = [];
    for (const gr of result.groups || []) {
      const xsd = gr.source === 'xsd';
      const slim = {
        cid: checkId(gr),
        ck: xsd ? `${checkId(gr)}|${gr.level}|${gr.items[0] && gr.items[0].element || ''}|${template(gr.items[0] && gr.items[0].message)}` : `${checkId(gr)}|${gr.level}`,
        id: gr.id, rule: gr.rule, part: gr.part || null, title: gr.title, severity: gr.severity, level: gr.level,
        code: gr.code || null, source: gr.source, module: gr.module || null
      };
      gr.items.forEach((it, i) => pairs.push({ gr: slim, it, i }));
    }
    // document order, so running numbers follow the file
    pairs.sort((x, y) => (x.it.line || 0) - (y.it.line || 0) || (x.it.col || 0) - (y.it.col || 0) || (x.it.n || 0) - (y.it.n || 0));

    const keys = new Map(), seen = new Map();
    for (const { gr, it, i } of pairs) {
      const lvl = it.level || gr.level;
      const pos = lvl === 'tx' && it.block && it.tx ? `T#${it.block}/#${it.tx}` : lvl !== 'file' && it.block ? 'B#' + it.block : 'file';
      const place = pos === 'file' ? 'file' : byPos.get(pos) || pos;
      const sub = below(it.xpath);
      const tail = (sub ? '|' + sub : '') + (gr.source === 'xsd' ? `|${it.element || ''}|${template(it.message)}` : '');
      const base = `${gr.cid}|${place}${tail}`;
      const n = (seen.get(base) || 0) + 1; seen.set(base, n);
      let key = n > 1 ? `${base}|#${n}` : base;
      while (keys.has(key)) key += '|#'; // never expected; a finding must not be lost
      // pos and tail: the key by position, made in runs() only for what is left after matching by key
      keys.set(key, {
        group: gr, place, pos, tail,
        item: { where: it.where, e2e: it.e2e || null, line: it.line || null, block: it.block || null, tx: it.tx || null, i }
      });
    }
    keys.meta = {
      fileName: result.fileName || null, status: result.status, stopped: result.stopped || null, incomplete: !!result.incomplete,
      country: result.country || null, version: result.version || null, msgId: result.facts && result.facts.grp ? result.facts.grp.msgId || null : null,
      skipped: skippedOf(result), ids, findings: (result.groups || []).length
    };
    return keys;
  }

  // keysOf once per result
  const cache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function keysOfResult(result) {
    if (!cache) return keysOf(result);
    let k = cache.get(result);
    if (!k) { k = keysOf(result); cache.set(result, k); }
    return k;
  }
  const toKeys = x => (x instanceof Map ? x : keysOfResult(x));
  /* the key map of a run of state.session: run.keys (kept when the result is dropped) or from run.result; null if neither */
  const keysOfRun = run => (run && run.keys instanceof Map ? run.keys : run && run.result ? keysOfResult(run.result) : null);

  function runs(a, b) {
    const A = toKeys(a), B = toKeys(b);
    const ma = A.meta || { skipped: [], ids: new Set() }, mb = B.meta || { skipped: [], ids: new Set() };
    const skipA = new Set(ma.skipped || []), skipB = new Set(mb.skipped || []);
    const open = [], restA = [], restB = [];
    for (const [k, va] of A) { const vb = B.get(k); if (vb) open.push([va, vb]); else restA.push(va); }
    for (const [k, vb] of B) if (!A.has(k)) restB.push(vb);

    // 2. a changed id: match by position what is left on both sides, in the order of the file
    let byPosition = 0;
    if (restA.length && restB.length) {
      const idsA = ma.ids || new Set(), idsB = mb.ids || new Set();
      const pk = v => `${v.group.cid}|${v.pos}${v.tail}`;
      const renamedB = new Map();
      for (const vb of restB) {
        if (vb.place === 'file' || idsA.has(vb.place)) continue;
        const k = pk(vb), q = renamedB.get(k);
        if (q) q.push(vb); else renamedB.set(k, [vb]);
      }
      if (renamedB.size) {
        const used = new Set();
        for (let i = 0; i < restA.length; i++) {
          const va = restA[i];
          if (va.place === 'file' || idsB.has(va.place)) continue;
          const q = renamedB.get(pk(va));
          if (!q || !q.length) continue;
          const vb = q.shift();
          open.push([va, vb]); used.add(vb); restA[i] = null; byPosition++;
        }
        if (used.size) for (let i = 0; i < restB.length; i++) if (used.has(restB[i])) restB[i] = null;
      }
    }

    const lists = { resolved: new Map(), open: new Map(), new: new Map(), skipped: new Map() };
    const add = (list, gr, item, extra) => {
      const m = lists[list];
      const k = extra && extra.run ? extra.run + '|' + gr.ck : gr.ck;
      let out = m.get(k);
      if (!out) {
        out = { ck: gr.ck, rule: gr.rule, part: gr.part, title: gr.title, severity: gr.severity, level: gr.level, code: gr.code, source: gr.source, count: 0, items: [] };
        if (extra && extra.run) out.run = extra.run;
        m.set(k, out);
      }
      out.items.push(item);
      out.count++;
      return out;
    };
    const copy = it => ({ where: it.where, e2e: it.e2e, line: it.line, block: it.block, tx: it.tx });
    for (const [va, vb] of open) {
      const it = copy(vb.item);
      if (va.item.where !== vb.item.where || va.item.line !== vb.item.line) it.before = { where: va.item.where, line: va.item.line };
      if (va.group.severity !== vb.group.severity) it.was = va.group.severity;
      add('open', vb.group, it);
    }
    for (const va of restA) if (va) {
      if (va.group.module && skipB.has(va.group.module)) add('skipped', va.group, copy(va.item), { run: 'a' });
      else add('resolved', va.group, copy(va.item));
    }
    for (const vb of restB) if (vb) {
      if (vb.group.module && skipA.has(vb.group.module)) add('skipped', vb.group, copy(vb.item), { run: 'b' });
      else add('new', vb.group, copy(vb.item));
    }

    const byLine = (x, y) => (x.line || 0) - (y.line || 0) || (x.block || 0) - (y.block || 0) || (x.tx || 0) - (y.tx || 0);
    const order = (x, y) => LEVELS[x.level] - LEVELS[y.level] || SEV_RANK[x.severity] - SEV_RANK[y.severity] || byRule(x.rule, y.rule) || (x.part || '').localeCompare(y.part || '') || (x.items[0].line || 0) - (y.items[0].line || 0);
    const done = m => {
      const list = [...m.values()];
      for (const gr of list) {
        gr.items.sort(byLine);
        const was = new Set(gr.items.map(i => i.was || ''));
        if (was.size === 1 && !was.has('')) gr.was = gr.items[0].was;
        else if (gr.items.some(i => i.was)) gr.changed = gr.items.filter(i => i.was).length;
      }
      return list.sort(order);
    };
    const out = { resolved: done(lists.resolved), open: done(lists.open), new: done(lists.new), skipped: done(lists.skipped) };
    const sum = list => list.reduce((n, gr) => n + gr.count, 0);
    out.counts = { resolved: sum(out.resolved), open: sum(out.open), new: sum(out.new), skipped: sum(out.skipped) };
    // per check, like the report's findings: resolved = only in run a, new = only in run b
    const cksOf = list => new Set(list.map(gr => gr.ck));
    const ckOpen = cksOf(out.open), ckRes = cksOf(out.resolved), ckNew = cksOf(out.new);
    out.checks = {
      resolved: [...ckRes].filter(ck => !ckOpen.has(ck) && !ckNew.has(ck)).length,
      open: [...new Set([...ckOpen, ...[...ckRes].filter(ck => ckNew.has(ck))])].length,
      new: [...ckNew].filter(ck => !ckOpen.has(ck) && !ckRes.has(ck)).length,
      skipped: cksOf(out.skipped).size
    };
    out.meta = { a: ma, b: mb, byPosition };
    return out;
  }

  TP.compare = { keysOf, keysOfRun, runs };
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = TP.compare;
})(typeof self !== 'undefined' ? self : globalThis);
