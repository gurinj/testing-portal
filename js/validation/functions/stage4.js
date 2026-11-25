/*
 * Testing Portal – functions of stage 4 (generic ISO business rules).
 *
 *   js:tpAddressRepeats(PstlAdr)   4.30: the structured elements (StrtNm, PstCd,
 *                                  TwnNm) whose value an AdrLine repeats, e.g.
 *                                  "PstCd 1010, TwnNm Wien"; '' if none.
 *
 * Words are compared, not characters: TwnNm "Wien" is not repeated in
 * "Wiener Strasse 5", but in "1010 Wien". Case and punctuation are ignored.
 * Values with fewer than 3 letters or digits are not compared. JavaScript,
 * because the same comparison in XPath took about 150 µs per address in
 * SaxonJS (measured in M2 on 10,000 hybrid addresses).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const COMPARED = ['StrtNm', 'PstCd', 'TwnNm'];
  const words = s => String(s).toUpperCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  function addressRepeats(adr) {
    if (!adr || adr.nodeType !== 1) return '';
    const lines = [], values = {};
    for (let c = adr.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'AdrLine') lines.push(` ${words(c.textContent).join(' ')} `);
      else if (COMPARED.includes(c.localName) && !(c.localName in values)) values[c.localName] = c.textContent;
    }
    if (!lines.length) return '';
    const out = [];
    for (const name of COMPARED) {
      if (!(name in values)) continue;
      const w = words(values[name]);
      if (w.join('').length < 3) continue;
      const needle = ` ${w.join(' ')} `;
      if (lines.some(l => l.includes(needle))) out.push(`${name} ${String(values[name]).replace(/\s+/g, ' ').trim()}`);
    }
    return out.join(', ');
  }

  const fns = { tpAddressRepeats: addressRepeats };
  Object.assign(g, fns);
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, fns);
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = fns;
})(typeof self !== 'undefined' ? self : globalThis);
