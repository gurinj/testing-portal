/*
 * Testing Portal – character sets (5.1–5.4) and transliteration (5.2).
 * The sets are regular expression character classes in config/settings.json
 * (charsets). A character outside the set that has a plain Latin form
 * (é → e, ß → ss) is "transliterated" (5.2, warning); any other is not
 * allowed (5.1, error).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const EXTRA = { 'ß': 'ss', 'ẞ': 'SS', 'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe', 'Ø': 'O', 'ø': 'o', 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'Ð': 'D', 'ð': 'd', 'Þ': 'TH', 'þ': 'th', 'ı': 'i', 'Ħ': 'H', 'ħ': 'h',
    '‘': "'", '’': "'", '‚': "'", '“': "'", '”': "'", '„': "'", '–': '-', '—': '-', ' ': ' ', '´': "'", '`': "'" };

  const res = new Map();
  function setRe(name) {
    let r = res.get(name);
    if (r) return r;
    const cls = (TP.context.settings.charsets || {})[name];
    if (cls == null) return null;
    r = { all: new RegExp(`^[${cls}]*$`), one: new RegExp(`^[${cls}]$`) };
    res.set(name, r);
    return r;
  }
  function translit(ch) {
    if (EXTRA[ch] != null) return EXTRA[ch];
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return base !== ch && /^[\x20-\x7E]+$/.test(base) ? base : null;
  }
  // split a value into allowed, transliterable and not allowed characters
  function sort(value, name) {
    const r = setRe(name);
    const v = String(value == null ? '' : value);
    if (!r || r.all.test(v)) return null;
    const bad = new Set(), tr = new Set();
    for (const ch of v) {
      if (r.one.test(ch)) continue;
      const t = translit(ch);
      if (t != null && [...t].every(c => r.one.test(c))) tr.add(ch); else bad.add(ch);
    }
    return { bad: [...bad], tr: [...tr] };
  }
  // characters that cannot be seen in a message (controls, no-break and zero-width spaces, combining marks) as U+XXXX
  const INVISIBLE = /^[\p{Cc}\p{Cf}\p{Z}\p{M}]$/u;
  const show = ch => (ch !== ' ' && INVISIBLE.test(ch) ? `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : ch);

  /* the set for a value: SEPA payments use sepa, cross-border swiftX, others the country's set */
  function charsetFor(type) {
    if (type === 'SEPA' || type === 'SEPA_INST') return 'sepa';
    if (type === 'CROSS_BORDER') return 'swiftX';
    return (TP.context.countryConfig && TP.context.countryConfig.characterSet) || 'basic-latin';
  }
  const fns = {
    tpCharsetFor: charsetFor,
    // '' if fine, else the characters that are not allowed (5.1)
    tpBadChars: (v, name) => { const s = sort(v, name); return s && s.bad.length ? s.bad.map(show).join(' ') : ''; },
    // '' if none, else the characters that would be transliterated (5.2)
    tpTranslitChars: (v, name) => { const s = sort(v, name); return s && s.tr.length ? s.tr.map(c => `${show(c)}→${translit(c) === ' ' ? 'space' : translit(c)}`).join(' ') : ''; },
    tpHasControl: v => /[\x00-\x1F\x7F]/.test(String(v || ''))
  };
  Object.assign(g, fns);
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, fns, { translit, resetCharsets: () => res.clear() });
})(typeof self !== 'undefined' ? self : globalThis);
