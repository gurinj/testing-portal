/*
 * Testing Portal – the runs of a browser session and the corrected file (M3).
 * Nothing is stored: the session lasts until the page is reloaded.
 *
 *   TP.session.add(session, result, { source, parent, changes, bytes, text }) → Run
 *   TP.session.chain(session, run)      → [Run] from the first run of its file to this one
 *   TP.session.parentFor(session, result, fileName) → the latest run of the same file (country, name, debtor), or null
 *   TP.session.segment(session, run)    → [Run] from the latest upload of the chain to this run
 *   TP.session.changesOf(session, run)  → [AppliedGroup] made in the portal since that upload
 *                                          (a new version from the customer starts again)
 *   TP.session.correctedName(session, run) → "<name of that upload>_corrected.xml", "_corrected2" …
 *   TP.session.corrected(run)           → bytes (Uint8Array) of the run's file, UTF-8, BOM kept
 *
 * Shapes: docs/specs/M3.md, section 4.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const KEEP = 3; // full results and texts kept for the last runs only (memory)

  const create = () => ({ runs: [], current: null });

  // "salaries_v2.xml", "salaries_corrected.xml", "salaries (1).xml" → "salaries"
  const stem = name => String(name || '').replace(/\.[^.]*$/, '').replace(/(_corrected\d*|_v\d+|[ _-]?\(\d+\)|[ _-]copy)$/i, '').toLowerCase();
  const msgIdOf = result => (result && result.facts && result.facts.grp && result.facts.grp.msgId) || null;

  /*
   * A new upload continues a file's chain only when it is plainly a new version of that file: the same
   * country, the same file name without _v2, _corrected … and, where both files say it, the same debtor
   * (a debtor account in common, or the same initiating party). The same MsgId alone is not enough: some
   * systems use one MsgId for every file, and another customer's file name must never show in this
   * customer's report (review R4).
   */
  const norm = v => String(v || '').replace(/\s+/g, ' ').trim().toUpperCase();
  function ownerOf(result) {
    const accounts = [...new Set(((result && result.blocks) || []).map(b => norm(b.debtorAccount).replace(/ /g, '')).filter(Boolean))];
    const party = norm(result && result.facts && result.facts.grp && result.facts.grp.initgPty) || null;
    return { accounts, party };
  }
  function sameOwner(a, b) {
    const known = x => x && (x.accounts.length || x.party);
    if (!known(a) || !known(b)) return true; // a file that could not be read says nothing against it
    if (a.accounts.some(x => b.accounts.includes(x))) return true;
    return !!(a.party && a.party === b.party);
  }
  function parentFor(session, result, fileName) {
    const runs = session.runs, owner = ownerOf(result);
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      if (r.country !== result.country || stem(r.fileName) !== stem(fileName)) continue;
      if (sameOwner(r.owner, owner)) return r;
    }
    return null;
  }

  function add(session, result, meta) {
    meta = meta || {};
    const c = result.counts || {};
    const run = {
      n: session.runs.length + 1, fileName: result.fileName, label: meta.label || result.fileName, at: new Date().toISOString(),
      country: result.country, version: result.version || null, status: result.status, counts: { E: c.E || 0, W: c.W || 0, I: c.I || 0 },
      incomplete: !!result.incomplete, stopped: result.stopped || null, msgId: msgIdOf(result), owner: ownerOf(result),
      source: meta.source || 'upload', parent: meta.parent != null ? meta.parent : null,
      changes: meta.changes || [], skipped: meta.skipped || [], bom: !!meta.bom,
      text: meta.text != null ? meta.text : result.text || null, result, keys: null
    };
    session.runs.push(run);
    session.current = run.n;
    // forget the full results of older runs
    const full = session.runs.filter(r => r.result);
    // forget the full results of older runs; the comparison keeps their key maps (small copies)
    for (const r of full.slice(0, Math.max(0, full.length - KEEP))) {
      if (TP.compare && TP.compare.keysOfRun) { try { r.keys = TP.compare.keysOfRun(r); } catch (e) { r.keys = null; } }
      r.result = null; r.text = null;
    }
    return run;
  }

  const byN = (session, n) => session.runs.find(r => r.n === n) || null;
  function chain(session, run) {
    const out = [];
    for (let r = run; r; r = r.parent != null ? byN(session, r.parent) : null) out.unshift(r);
    return out;
  }
  function segment(session, run) {
    const ch = chain(session, run);
    let i = ch.length - 1;
    while (i > 0 && ch[i].source === 'fix') i--;
    return ch.slice(i);
  }
  function changesOf(session, run) {
    return segment(session, run).flatMap(r => r.changes || []);
  }
  // "salaries_corrected2.xml" → "salaries": a corrected copy that is uploaded again is not named x_corrected_corrected
  const baseOf = name => String(name || 'payment-file.xml').replace(/\.[^.]*$/, '').replace(/_corrected\d*$/i, '') || 'payment-file';
  function correctedName(session, run) {
    const ch = chain(session, run), base = baseOf(segment(session, run)[0].fileName);
    // every fix of this file in the chain counts, so a corrected copy never gets the name of an earlier one
    let k = ch.filter(r => r.source === 'fix' && baseOf(segment(session, r)[0].fileName) === base).length;
    const used = new Set(ch.filter(r => r !== run).map(r => String(r.fileName || '').toLowerCase()));
    const name = i => `${base}_corrected${i > 1 ? i : ''}.xml`;
    while (used.has(name(k).toLowerCase())) k++;
    return name(Math.max(k, 1));
  }
  function corrected(run) {
    const text = (run.bom ? '﻿' : '') + (run.text || '');
    return new TextEncoder().encode(text);
  }

  TP.session = { create, add, chain, segment, changesOf, correctedName, corrected, parentFor, stem, byN };
})(typeof self !== 'undefined' ? self : globalThis);
