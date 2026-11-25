/*
 * Testing Portal – functions for the rules of stages 3 and 7 (country
 * context and payment types). Called from the rules with
 * xmlns:js="http://saxonica.com/ns/globalJS":
 *
 *   js:tpSelectedCountry()                       the country chosen for the check, upper case ('' if none)
 *   js:tpCountryListed('paymentTypes')           true if the country file has a list at this key
 *   js:tpCountryAllows('paymentTypes', $type)    true if the country file has no list at this key
 *                                                (null or missing = everything allowed) or the list contains the value
 *   js:tpLimitNames('crossBorder.truncateLength') the element names that end the paths of a { "path": length }
 *                                                setting (Nm, AdrLine), and
 *   js:tpMinLimit('crossBorder.truncateLength')  its smallest length (0 if none): 7.25 calls js:tpLimit
 *                                                only for these elements when they are longer, for speed
 *
 * Why not js:tpCountry(): a JavaScript list reaches XPath as a sequence, so
 * an empty list and null both look like an empty sequence there. These
 * functions keep "null = no restriction" apart from "[] = nothing allowed",
 * as js:tpAllowed does for the settings.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const valueAt = key => {
    const v = TP.functions.get(TP.context.countryConfig || {}, key);
    return v === undefined ? null : v;
  };
  const fns = {
    tpSelectedCountry: () => String(TP.context.country || '').trim().toUpperCase(),
    tpCountryListed: key => Array.isArray(valueAt(key)),
    tpCountryAllows: (key, value) => {
      const l = valueAt(key);
      return !Array.isArray(l) || l.map(x => String(x).trim().toUpperCase()).includes(String(value == null ? '' : value).trim().toUpperCase());
    },
    tpMinLimit: path => {
      const map = TP.functions.get(TP.context.settings, path);
      if (!map || typeof map !== 'object' || Array.isArray(map)) return 0;
      const n = Object.entries(map).filter(([k, v]) => k[0] !== '_' && typeof v === 'number' && v > 0).map(([, v]) => v);
      return n.length ? Math.min(...n) : 0;
    },
    tpLimitNames: path => {
      const map = TP.functions.get(TP.context.settings, path);
      if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
      return [...new Set(Object.entries(map).filter(([k, v]) => k[0] !== '_' && typeof v === 'number' && v > 0).map(([k]) => k.split('/').filter(Boolean).pop()).filter(Boolean))];
    }
  };
  Object.assign(g, fns);
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, fns);
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = fns;
})(typeof self !== 'undefined' ? self : globalThis);
