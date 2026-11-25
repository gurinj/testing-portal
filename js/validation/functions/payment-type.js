/*
 * Testing Portal – the payment type of a transaction (catalogue stage 3).
 * Rules in docs/specs/M2.md, section 2. One function for the rules
 * (js:tpPaymentType(tx), from the document) and for the report (fields
 * collected by findings/scan.js).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const F = () => TP.functions;

  const TYPES = {
    SEPA_INST: 'SEPA Instant',
    SEPA: 'SEPA credit transfer',
    BUDGET: 'Budget or tax payment',
    INTRA_BANK: 'Intra-bank transfer',
    DOMESTIC_URGENT: 'Domestic urgent',
    DOMESTIC: 'Domestic standard',
    CROSS_BORDER: 'Cross-border (SWIFT)'
  };
  const label = id => TYPES[id] || 'Not determined';

  const bicCountry = b => (b && b.length >= 6 ? b.slice(4, 6).toUpperCase() : null);
  const ibanCountry = i => (i && /^[A-Za-z]{2}/.test(i) ? i.slice(0, 2).toUpperCase() : null);

  /*
   * f: { svc: [codes], lcl, ctgy, prty, ccy, cdtrIban, cdtrBic, cdtrAddrCtry, dbtrBic }
   * Returns the type id, or '' if it cannot be determined.
   */
  /* the country file's budgetIbanPattern, compiled once; a wrong pattern is ignored here (tests/run-tests.js checks the country files) */
  const patterns = new Map();
  function budgetPattern(cfg) {
    const src = cfg.budgetIbanPattern;
    if (typeof src !== 'string' || !src) return null;
    if (!patterns.has(src)) { let re = null; try { re = new RegExp(src); } catch (e) { re = null; } patterns.set(src, re); }
    return patterns.get(src);
  }

  function classify(f) {
    const ctx = TP.context, s = ctx.settings || {}, pt = s.paymentTypes || {};
    const c = (ctx.country || '').toUpperCase();
    const cfg = ctx.countryConfig || {};
    const local = cfg.currency || null;
    const svc = (f.svc || []).map(x => String(x).trim().toUpperCase());
    const lcl = (f.lcl || '').trim().toUpperCase();
    const ctgy = (f.ctgy || '').trim().toUpperCase();
    const ccy = (f.ccy || '').trim().toUpperCase();
    const cdtrCtry = ibanCountry(f.cdtrIban) || bicCountry(f.cdtrBic) || (f.cdtrAddrCtry || '').trim().toUpperCase() || null;
    const sepa = F().list('sepa');
    const inList = (k, v) => Array.isArray(pt[k]) && pt[k].includes(v);

    if (lcl && inList('instantLocalInstrument', lcl)) return 'SEPA_INST';
    if (svc.includes('SEPA')) return 'SEPA';
    const here = !cdtrCtry || cdtrCtry === c;
    const budgetRe = budgetPattern(cfg);
    if (here && ((ctgy && inList('budgetCategoryPurpose', ctgy)) || (budgetRe && f.cdtrIban && budgetRe.test(f.cdtrIban.toUpperCase())))) return 'BUDGET';
    if (cdtrCtry === c && f.cdtrBic) {
      const b8 = f.cdtrBic.slice(0, 8).toUpperCase();
      const own = Array.isArray(cfg.bankBics) ? cfg.bankBics : [];
      if ((f.dbtrBic && f.dbtrBic.slice(0, 8).toUpperCase() === b8) || own.some(x => String(x).slice(0, 8).toUpperCase() === b8)) return 'INTRA_BANK';
    }
    // implicit SEPA: EUR between SEPA countries with no service level at all and not urgent (priority HIGH).
    // A payment with another service level (URGP, G001, NURG, …) was meant to go another way (review 2026-11-19).
    const urgent = svc.some(x => inList('urgentServiceLevel', x)) || String(f.prty || '').toUpperCase() === 'HIGH';
    if (!urgent && !svc.length && ccy === 'EUR' && sepa.has(c) && cdtrCtry && sepa.has(cdtrCtry)) return 'SEPA';
    if (cdtrCtry === c || (!cdtrCtry && local && ccy === local)) return urgent ? 'DOMESTIC_URGENT' : 'DOMESTIC';
    if (cdtrCtry) return 'CROSS_BORDER';
    return '';
  }

  /* ---- from the document (SaxonJS nodes, DOM-like) ---- */
  const kids = (n, name) => { const out = []; if (!n) return out; for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === name) out.push(c); return out; };
  // the first child of that name: stops there (a block has thousands of CdtTrfTxInf children)
  const kid = (n, name) => { if (!n) return null; for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === name) return c; return null; };
  const path = (n, ...names) => { let x = n; for (const nm of names) { x = kid(x, nm); if (!x) return null; } return x; };
  const text = n => (n ? String(n.textContent).trim() : '');
  const bic = fin => text(kid(fin, 'BIC') || kid(fin, 'BICFI'));

  /* the block's own fields, read once per block: looking them up for every
     transaction walked all children of the block each time (17 s for one
     block of 10,000 transactions) */
  let blockCache = new WeakMap();
  function blockFieldsOf(blk) {
    let b = blockCache.get(blk);
    if (!b) {
      const p = kid(blk, 'PmtTpInf');
      const svc = [];
      for (const sl of kids(p, 'SvcLvl')) { const cd = kid(sl, 'Cd'); if (cd) svc.push(text(cd)); }
      b = { p, svc, dbtrBic: bic(path(blk, 'DbtrAgt', 'FinInstnId')) };
      blockCache.set(blk, b);
    }
    return b;
  }

  function fieldsOf(tx) {
    const blk = blockFieldsOf(tx.parentNode);
    const own = kid(tx, 'PmtTpInf');
    const svc = blk.svc.slice();
    for (const sl of kids(own, 'SvcLvl')) { const cd = kid(sl, 'Cd'); if (cd) svc.push(text(cd)); }
    const pick = (...names) => text(path(own, ...names)) || text(path(blk.p, ...names));
    const amt = kid(tx, 'Amt');
    const instd = kid(amt, 'InstdAmt');
    const ccy = instd ? (instd.getAttribute('Ccy') || '') : text(path(amt, 'EqvtAmt', 'CcyOfTrf'));
    return {
      svc, lcl: pick('LclInstrm', 'Cd'), ctgy: pick('CtgyPurp', 'Cd'), prty: pick('InstrPrty'), ccy,
      cdtrIban: text(path(tx, 'CdtrAcct', 'Id', 'IBAN')),
      cdtrBic: bic(path(tx, 'CdtrAgt', 'FinInstnId')),
      cdtrAddrCtry: text(path(tx, 'Cdtr', 'PstlAdr', 'Ctry')),
      dbtrBic: blk.dbtrBic
    };
  }

  let cache = new WeakMap();
  function tpPaymentType(tx) {
    if (!tx || tx.nodeType !== 1) return '';
    let t = cache.get(tx);
    if (t === undefined) { t = classify(fieldsOf(tx)); cache.set(tx, t); }
    return t;
  }
  /* the type of a block: the type of its transactions if they share one, else 'MIXED' ('' if none) */
  /*
   * The type of a block from the types of its transactions. Intra-bank and budget
   * payments travel with the other payments of a block (an AT supplier file with one
   * creditor at the debtor's own bank is not a mixed block), so they count only when
   * the block has nothing else. '' (not determined, 3.5) does not count either.
   */
  const RIDERS = new Set(['INTRA_BANK', 'BUDGET']);
  function blockTypeOf(list) {
    const all = new Set(list.filter(Boolean));
    const main = [...all].filter(t => !RIDERS.has(t));
    if (main.length === 1) return main[0];
    if (main.length > 1) return 'MIXED';
    return all.size === 1 ? [...all][0] : all.size ? 'MIXED' : '';
  }
  function tpBlockType(blk) { return blockTypeOf(kids(blk, 'CdtTrfTxInf').map(tpPaymentType)); }
  const resetPaymentTypes = () => { cache = new WeakMap(); blockCache = new WeakMap(); };

  Object.assign(g, { tpPaymentType, tpBlockType, tpPaymentTypeLabel: label });
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, { classify, paymentType: tpPaymentType, blockType: tpBlockType, blockTypeOf, RIDERS, paymentTypeLabel: label, resetPaymentTypes, PAYMENT_TYPES: TYPES, dom: { kids, kid, path, text, bic } });
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = { classify, label, TYPES };
})(typeof self !== 'undefined' ? self : globalThis);
