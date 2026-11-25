/*
 * Testing Portal – element lists from the settings (stage 6, 7.25, 10.3).
 * A path in the settings is a list of element names separated by "/",
 * matched against the end of an element's own path: "Nm" matches every Nm,
 * "Cdtr/Nm" only the creditor's name, "RmtInf/Ustrd" the remittance text.
 * Lists per level ("file", "block", "transaction") are paths below the
 * group header, the payment block or the transaction.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const get = p => TP.functions.get(TP.context.settings, p);
  const LEVEL_NODE = { file: 'GrpHdr', block: 'PmtInf', transaction: 'CdtTrfTxInf' };

  function names(el) { const out = []; for (let x = el; x && x.nodeType === 1; x = x.parentNode) out.unshift(x.localName); return out; }
  function endsWith(arr, suffix) { if (suffix.length > arr.length) return false; for (let i = 1; i <= suffix.length; i++) if (arr[arr.length - i] !== suffix[suffix.length - i]) return false; return true; }

  // limit for an element from a { "path": number } setting; 0 = none. The most specific (longest) path wins;
  // a path set to null switches the limit off for its elements ({ "Nm": 70, "Cdtr/Nm": null }).
  function limitFor(el, settingPath) {
    const map = get(settingPath);
    if (!map || typeof map !== 'object') return 0;
    const own = names(el);
    let best = 0, bestLen = 0;
    for (const [k, v] of Object.entries(map)) {
      if (k[0] === '_' || (v !== null && typeof v !== 'number')) continue;
      const suf = k.split('/').filter(Boolean);
      if (suf.length > bestLen && endsWith(own, suf)) { best = v === null ? 0 : v; bestLen = suf.length; }
    }
    return best;
  }

  // elements found below a node along a path ("Dbtr/PstlAdr/Ctry")
  function find(node, path) {
    let cur = [node];
    for (const nm of path.split('/').filter(Boolean)) {
      const next = [];
      for (const n of cur) for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === nm) next.push(c);
      cur = next;
      if (!cur.length) break;
    }
    return cur;
  }
  function levelList(kind, level) {
    const l = get(`guideline.${kind}.${level}`);
    return Array.isArray(l) ? l.filter(p => typeof p === 'string' && p.trim()) : [];
  }
  const fns = {
    tpLimit: (el, settingPath) => limitFor(el, settingPath),
    // 6.1: the paths of the list that are missing below node, joined with ", "
    tpMissing: (node, level) => levelList('mandatory', level).filter(p => !find(node, p).length).join(', '),
    // 6.2: the paths of the forbidden or ignored list that are present below node
    tpPresent: (node, level, kind) => levelList(kind, level).filter(p => find(node, p).length).join(', '),
    // 6.3: "Ustrd 3 times (at most 1)" for each child name over its limit, for a parent element.
    // Per child name the most specific (longest) path wins, as for the lengths; null = no limit.
    tpOccurs: el => {
      const map = get('guideline.maxOccurs');
      if (!map || typeof map !== 'object') return '';
      const own = names(el), best = new Map(), out = [];
      for (const [k, max] of Object.entries(map)) {
        if (k[0] === '_' || (max !== null && typeof max !== 'number')) continue;
        const parts = k.split('/').filter(Boolean);
        const child = parts.pop();
        if (!child || !endsWith(own, parts)) continue;
        const b = best.get(child);
        if (!b || parts.length > b.len) best.set(child, { len: parts.length, max });
      }
      for (const [child, { max }] of best) {
        if (max === null) continue;
        let n = 0;
        for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === child) n++;
        if (n > max) out.push(`${child} ${n} times (at most ${max})`);
      }
      return out.join(', ');
    },
    tpLevelNode: level => LEVEL_NODE[level] || '',
    /*
     * Stage 7 leaves a problem to the guideline check that reports the same thing
     * (merge 2026-11-18): true if 6.4 limits this element to at most n characters,
     * or 4.38 allows at most one Ustrd or one Strd, and that check is not switched off.
     */
    tpLengthCovered: (el, n) => !!el && checkOn('6.4') && (l => l > 0 && l <= Number(n))(limitFor(el, 'guideline.maxLength')),
    tpRemittanceCovered: () => {
      const r = get('guideline.remittance');
      // numbers as 4.38 reads them (a number or a numeric string)
      const max = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
      const u = r ? max(r.maxUstrd) : null, st = r ? max(r.maxStrd) : null;
      return !!r && String(r.combined) === 'false' && u !== null && u <= 1 && st !== null && st <= 1
        && checkOn('4.38') && checkOn('4.38-count') && checkOn('4.38-combined');
    },
    // false only if settings.checks switches this check off (by id or id-part)
    tpCheckOn: id => checkOn(String(id))
  };
  function checkOn(id) { const c = (get('checks') || {})[id]; return !(c && c.enabled === false); }
  Object.assign(g, fns);
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, fns, { limitFor, find });
})(typeof self !== 'undefined' ? self : globalThis);
