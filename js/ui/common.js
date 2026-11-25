/*
 * Testing Portal – small helpers shared by the screens: icons, escaping,
 * wording for severities, levels and statuses.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};

  const IC = {
    file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
    up: '<path d="M12 16V5"/><path d="m7 10 5-5 5 5"/><path d="M4 20h16"/>',
    down: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
    x: '<path d="m7 7 10 10M17 7 7 17"/>',
    check: '<path d="m5 13 4.5 4.5L19 7.5"/>',
    warn: '<path d="M12 4 2.8 20h18.4z"/><path d="M12 10v4.5M12 17.5v.2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.2"/>',
    chev: '<path d="m7 10 5 5 5-5"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    arrow: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    table: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M9 10v9"/>',
    wrench: '<path d="M15 6.5a4.5 4.5 0 0 0-5.9 5.7L3.5 17.8l2.7 2.7 5.6-5.6A4.5 4.5 0 0 0 17.5 9l-2.8 2.8-2.5-2.5z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6.5L20.5 7"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4V4h11v1"/>',
    compare: '<path d="M7 4v16M17 4v16"/><path d="m4 8 3-4 3 4M14 16l3 4 3-4"/>'
  };
  const ic = (n, s = 20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w, ws) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? w : ws || w + 's'}`;
  const SEV = { E: { w: 'Error', ws: 'Errors', ic: 'x' }, W: { w: 'Warning', ws: 'Warnings', ic: 'warn' }, I: { w: 'Hint', ws: 'Hints', ic: 'info' } };
  const LEVEL = { file: 'File', block: 'Payment block', tx: 'Transaction' };
  const tone = st => st === 'ACTC' ? 'good' : st === 'ACWC' ? 'mid' : 'bad';
  const secs = ms => ms == null ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
  const mb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  const showVal = v => v == null ? '–' : v === '' ? '<em class="miss">(empty)</em>' : esc(v);
  // spaces at the start or end of a value made visible (a trimmed value otherwise looks the same)
  const WS = /^[ \t\u00A0]+|[ \t\u00A0]+$/g;
  const wsVal = v => esc(v).replace(WS, m => `<span class="ws" title="${m.length} space${m.length > 1 ? 's' : ''}">${'·'.repeat(m.length)}</span>`);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const pad = n => String(n).padStart(2, '0');
  const stamp = iso => { const d = iso ? new Date(iso) : new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dateLabel = iso => { const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

  let toastTimer = null;
  function toast(text, bad) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.className = 'toast' + (bad ? ' bad' : '');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  TP.ui = TP.ui || {};
  TP.ui.h = { ic, esc, plural, SEV, LEVEL, tone, secs, mb, showVal, wsVal, $, $$, stamp, dateLabel, toast };
})(typeof self !== 'undefined' ? self : globalThis);
