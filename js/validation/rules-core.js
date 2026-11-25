/*
 * Testing Portal – runs the compiled rule files (stages 3–10) on one file.
 * Used by the rules worker in the browser and by the Node tests, so both
 * run exactly the same code. Needs SaxonJS, TP.findings.fromSvrl and
 * TP.findings.scan.
 *
 * ruleSet = { id, stage, versions: ['03'], countries: '*' | ['AT', ...], sef }
 * Result  = { findings, summary, timings: { parse, sets: { id: ms }, scan }, ran, parseError }
 *
 * A rule file that fails on a file (a dynamic error) does not stop the
 * others: it becomes one warning that names the stage.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};

  function stageOf(rule, fallback) {
    const m = /^(\d+)\./.exec(rule || '');
    return m ? +m[1] : fallback;
  }

  /* context: { countryConfig, settings (merged for the country), now } – see functions/settings.js */
  async function runRuleSets(SaxonJS, ruleSets, xml, version, country, context) {
    TP.context = { country, countryConfig: {}, settings: {}, now: null, ...(context || {}) };
    TP.context.country = country;
    const F = TP.functions || {};
    // every cache of the function files (resetLocations, resetPaymentTypes, resetStage5, …) starts empty for a new file
    for (const k of Object.keys(F)) if (/^reset[A-Z]/.test(k) && typeof F[k] === 'function') F[k]();
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const timings = { parse: 0, sets: {}, scan: 0 };
    const applicable = ruleSets.filter(s =>
      (!s.versions || s.versions.includes(version)) &&
      (!s.countries || s.countries === '*' || s.countries.includes(country)));

    let t = now();
    let doc = null;
    try { doc = await SaxonJS.getResource({ text: xml, type: 'xml' }); }
    catch (err) { return { findings: [], summary: null, timings, ran: [], parseError: String(err && err.message || err) }; }
    timings.parse = now() - t;

    const raw = [];
    const ran = [];
    for (const set of applicable) {
      t = now();
      try {
        const r = SaxonJS.transform({ stylesheetInternal: set.sef, sourceNode: doc, destination: 'serialized' }, 'sync');
        for (const f of TP.findings.fromSvrl(r.principalResult)) { f.set = set.id; f.stage = stageOf(f.rule, set.stage); raw.push(f); }
        ran.push(set.id);
      } catch (err) {
        raw.push({ rule: `${set.stage}.engine`, stage: set.stage, severity: 'W', code: null, set: set.id, xpath: '',
          message: `Some checks of stage ${set.stage} could not run on this file: ${String(err && err.message || err).slice(0, 300)}` });
      }
      timings.sets[set.id] = now() - t;
    }

    t = now();
    const { positions, summary } = TP.findings.scan(xml, raw.map(f => f.xpath).filter(Boolean));
    // a country file with a wrong value must not stop every check (review 2026-11-19)
    if (F.classify) try { typesOf(summary, F); } catch (err) { summary.typeError = String(err && err.message || err); }
    timings.scan = now() - t;

    const findings = raw.map(f => {
      const p = f.xpath ? positions.get(f.xpath) : null;
      // "#57" (element number) becomes the element path; an attribute keeps its "/@name"
      const xpath = f.xpath && f.xpath[0] === '#' ? (p ? p.path + (/\/@[^/]+$/.exec(f.xpath) || [''])[0] : null) : f.xpath || null;
      const place = TP.findings.placeOf(xpath);
      return {
        source: 'rules', rule: f.rule, part: f.part || null, stage: f.stage, severity: f.severity, code: f.code,
        level: TP.findings.levelOf(xpath), message: f.message, xpath,
        line: p ? p.line : null, col: p ? p.col : null, actual: p ? p.value : null,
        block: place.block, tx: place.tx, set: f.set
      };
    });
    return { findings, summary, timings, ran };
  }

  /* payment type of every transaction and block, for the report (same function as the rules) */
  function typesOf(summary, F) {
    for (const b of summary.blocks) {
      const types = [];
      for (const t of b.txs) {
        t.type = F.classify({
          svc: [...(b.svcCodes || []), ...(t.svcCodes || [])], lcl: t.lclCd || b.lclCd, ctgy: t.ctgyPurp || b.ctgyPurp, prty: t.prty || b.prty,
          ccy: t.ccyOfTrf || t.ccy, cdtrIban: t.iban, cdtrBic: t.creditorBic, cdtrAddrCtry: t.creditorCountry, dbtrBic: b.debtorBic
        });
        t.typeLabel = F.paymentTypeLabel(t.type);
        types.push(t.type);
      }
      b.type = F.blockTypeOf(types);
      b.typeLabel = b.type === 'MIXED' ? 'Mixed' : F.paymentTypeLabel(b.type);
    }
  }

  TP.rulesCore = { runRuleSets };
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = { runRuleSets };
})(typeof self !== 'undefined' ? self : globalThis);
