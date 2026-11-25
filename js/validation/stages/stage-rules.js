/*
 * Testing Portal – stages 3 to 10, the Schematron rules (run in the rules worker).
 * Which rule files run depends on the message version and the chosen country,
 * as listed in rules/manifest.json (written by tools/build.js).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};

  async function run(client, { text, version, country, context }) {
    const r = await client.request({ type: 'validate', xml: text, version, country, context });
    return { stop: false, ms: r.ms, findings: r.findings || [], summary: r.summary || null, timings: r.timings, ran: r.ran || [], parseError: r.parseError || null };
  }

  TP.stages = TP.stages || {};
  TP.stages.rules = { run };
})(typeof self !== 'undefined' ? self : globalThis);
