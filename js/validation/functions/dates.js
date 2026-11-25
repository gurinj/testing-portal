/*
 * Testing Portal – business days (10.1): weekends, TARGET closing days for
 * EUR and the holidays of the selected country (config/countries/<CC>.json).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  // Easter Sunday (Gregorian, anonymous algorithm)
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), gg = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - gg + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(y, month - 1, day));
  }
  const iso = d => d.toISOString().slice(0, 10);
  const targetCache = new Map();
  function target(y) {
    let t = targetCache.get(y);
    if (!t) {
      const e = easter(y);
      const add = n => iso(new Date(e.getTime() + n * 86400000));
      t = new Map([[`${y}-01-01`, 'New Year’s Day'], [add(-2), 'Good Friday'], [add(1), 'Easter Monday'], [`${y}-05-01`, 'Labour Day'], [`${y}-12-25`, 'Christmas Day'], [`${y}-12-26`, 'Boxing Day']]);
      targetCache.set(y, t);
    }
    return t;
  }
  /* '' if a business day, else why not; useTarget for EUR payments that are not instant */
  function nonBusiness(date, useTarget) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').slice(0, 10));
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const wd = d.getUTCDay();
    if (wd === 6) return 'a Saturday';
    if (wd === 0) return 'a Sunday';
    if (useTarget === true || useTarget === 'true') { const t = target(+m[1]).get(m[0]); if (t) return `a TARGET closing day (${t})`; }
    const hol = (TP.context.countryConfig && TP.context.countryConfig.holidays) || [];
    for (const h of hol) {
      const day = typeof h === 'string' ? h : h && h.date;
      if (day === m[0] || (day && day.length === 5 && day === m[0].slice(5))) return `a holiday in ${TP.context.country}${h && h.name ? ` (${h.name})` : ''}`;
    }
    return '';
  }
  g.tpNonBusinessDay = nonBusiness;
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, { easter, target, nonBusinessDay: nonBusiness, tpNonBusinessDay: nonBusiness });
})(typeof self !== 'undefined' ? self : globalThis);
