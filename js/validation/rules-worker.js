/*
 * Testing Portal – rules worker (classic Web Worker).
 * Runs SaxonJS and the compiled Schematron rules in the background.
 *
 * In the offline file, tools/build.js puts the scripts listed below in front
 * of this file and sets TP_WORKER_BUNDLED, so nothing is loaded by path.
 *
 * Messages in:  { type: 'init', ruleSets, reference }  { type: 'validate', id, xml, version, country, context }
 * Messages out: { type: 'ready', info }     { type: 'result', id, ... }  { type: 'error', id, error }
 */
/* scripts:start */
var TP_RULES_WORKER_SCRIPTS = [
  'saxon-node-shim.js',
  '../../lib/saxon/SaxonJS2N.js',
  '../../lib/saxes/saxes.bundle.js',
  'functions/settings.js',
  'functions/iban.js',
  'functions/location.js',
  'functions/payment-type.js',
  'functions/charset.js',
  'functions/dates.js',
  'functions/guideline.js',
  'functions/stage3.js',
  'functions/stage4.js',
  'functions/stage5.js',
  'functions/stage6.js',
  'functions/stage9.js',
  'functions/stage10.js',
  'findings/from-svrl.js',
  'findings/place.js',
  'findings/scan.js',
  'rules-core.js'
];
/* scripts:end */
if (typeof TP_WORKER_BUNDLED === 'undefined') importScripts.apply(self, TP_RULES_WORKER_SCRIPTS);

(function () {
  'use strict';
  const SaxonJS = self.TPAdoptSaxonJS();
  let ruleSets = [];

  self.onmessage = async e => {
    const msg = e.data || {};
    try {
      if (msg.type === 'init') {
        ruleSets = msg.ruleSets || [];
        self.TP.reference = msg.reference || {};
        const info = SaxonJS.getProcessorInfo ? SaxonJS.getProcessorInfo() : {};
        self.postMessage({ type: 'ready', info: { product: info.productName, version: info.productVersion, ruleSets: ruleSets.map(s => s.id) } });
      } else if (msg.type === 'validate') {
        const t = performance.now();
        const r = await self.TP.rulesCore.runRuleSets(SaxonJS, ruleSets, msg.xml, msg.version, msg.country, msg.context);
        self.postMessage({ type: 'result', id: msg.id, ms: performance.now() - t, ...r });
      }
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, error: String(err && (err.stack || err.message) || err) });
    }
  };
  self.postMessage({ type: 'loaded' });
})();
