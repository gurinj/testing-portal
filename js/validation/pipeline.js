/*
 * Testing Portal – the validation pipeline (main thread).
 *
 *   stage 0  intake           main thread   stops on failure
 *   stage 1  identify         main thread   stops on failure
 *   stage 0  well-formed  ┐
 *   stage 2  XSD          ├── XSD worker    } both workers run at the same time
 *   stages 3–10 rules     ┘   rules worker  }
 *
 * The order of the stages is this file. Each stage file returns
 * { stop, findings } and knows nothing about the others.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const SCHEMAS = { '03': 'schemas/pain.001.001.03.xsd', '09': 'schemas/pain.001.001.09.xsd' };

  const REFERENCE = ['countries', 'currencies', 'iban-registry', 'external-codes', 'payment-areas', 'clearing-systems'];
  const REF_KEY = { 'iban-registry': 'iban', 'external-codes': 'codes', 'payment-areas': 'areas', 'clearing-systems': 'clearing' };
  const engines = { xsd: null, rules: null, info: {}, config: null, manifest: null, catalogue: null, countries: {}, settings: null, reference: {}, error: null };

  async function init(onStep = () => {}) {
    const t0 = performance.now();
    engines.config = await TP.assets.json('config/app.json');
    engines.manifest = await TP.assets.json('rules/manifest.json');
    engines.catalogue = await TP.assets.json('config/catalogue.json');
    // M3: the fixes of the fix screen; a missing or broken file only means no fixes are proposed
    try { engines.fixes = await TP.assets.json('config/fixes.json'); } catch (err) { engines.fixes = { fixes: {} }; }
    engines.builtInSettings = await TP.assets.json('config/settings.json');
    engines.settings = engines.builtInSettings;
    engines.settingsSource = { kind: 'built-in' };
    for (const r of REFERENCE) engines.reference[REF_KEY[r] || r] = await TP.assets.json(`config/reference/${r}.json`);
    TP.reference = engines.reference;
    for (const c of engines.config.countries || []) {
      try { engines.countries[c] = await TP.assets.json(`config/countries/${c}.json`); }
      catch (err) { engines.countries[c] = { code: c, name: c, versions: ['03', '09'], error: String(err.message || err) }; }
    }

    onStep('xsd', 'loading');
    const xsdStart = performance.now();
    engines.xsd = new TP.WorkerClient('xsd');
    const schemas = {};
    for (const [v, p] of Object.entries(SCHEMAS)) schemas[v] = await TP.assets.text(p);
    const xsdReady = engines.xsd.init({ schemas })
      .then(info => { engines.info.xsd = { ...info, loadMs: performance.now() - xsdStart }; onStep('xsd', 'ready'); })
      .catch(err => { engines.info.xsd = { error: String(err.message || err) }; onStep('xsd', 'failed'); throw err; });

    onStep('rules', 'loading');
    const rulesStart = performance.now();
    engines.rules = new TP.WorkerClient('rules');
    const ruleSets = [];
    for (const s of engines.manifest.ruleSets) ruleSets.push({ ...s, sef: await TP.assets.json(s.file) });
    const rulesReady = engines.rules.init({ ruleSets, reference: engines.reference })
      .then(info => { engines.info.rules = { ...info, loadMs: performance.now() - rulesStart }; onStep('rules', 'ready'); })
      .catch(err => { engines.info.rules = { error: String(err.message || err) }; onStep('rules', 'failed'); throw err; });

    const results = await Promise.allSettled([xsdReady, rulesReady]);
    engines.info.totalMs = performance.now() - t0;
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) engines.error = failed.map(r => String(r.reason && r.reason.message || r.reason)).join('; ');
    return engines.info;
  }

  function sortFindings(list) {
    const lvl = { file: 0, block: 1, tx: 2 };
    return list.slice().sort((a, b) =>
      (a.line || 0) - (b.line || 0) || a.stage - b.stage || lvl[a.level] - lvl[b.level]);
  }

  /*
   * bytes: ArrayBuffer or Uint8Array of the uploaded file.
   * onStep(module, state, info) reports progress per module of the catalogue:
   * intake, xsd, iso, guideline, types, consistency; state is running, ok,
   * findings, failed, skipped or planned.
   */
  async function validate({ bytes, fileName, country, pin }, onStep = () => {}) {
    const t0 = performance.now();
    const cfg = engines.config || {};
    const timings = {};
    const countryConfig = engines.countries[country] || null;
    // built-in settings, then the country's, then a settings file loaded for this session (it wins: review 2026-11-19)
    // pin { settings, settingsSource }: a fix is checked again with the settings of the run it corrects (M3 spec 3.4)
    const settings = pin && pin.settings ? pin.settings : TP.functions.merge(TP.functions.settingsFor(engines.builtInSettings || {}, countryConfig), engines.sessionSettings || {});
    const settingsSource = pin && pin.settings ? pin.settingsSource || engines.settingsSource : engines.settingsSource;
    const RULE_MODULES = ['iso', 'guideline', 'types', 'consistency'];
    const finish = (findings, extra = {}) => {
      const all = sortFindings(findings);
      const report = TP.report.build({ findings: all, summary: extra.summary, catalogue: engines.catalogue, settings, stopped: extra.stopped, failedModules: extra.failedModules || [], plannedModules: planned, incomplete: !!extra.rulesError });
      return {
        ...report, raw: all, fileName, country, countryName: countryConfig ? countryConfig.name : country, fileSize: bytes.byteLength,
        timings: { ...timings, total: performance.now() - t0 }, at: new Date().toISOString(),
        settings, settingsSource,
        app: { version: cfg.version, rulesDate: cfg.rulesDate, rulesStatus: cfg.rulesStatus }, ...extra
      };
    };
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let planned = [];
    // rule modules without any rule file for this version and country yet
    const plannedFor = version => {
      const stages = new Set(engines.manifest.ruleSets.filter(rs => rs.versions.includes(version) && (rs.countries === '*' || rs.countries.includes(country))).map(rs => rs.stage));
      return engines.catalogue.modules.filter(m => RULE_MODULES.includes(m.id) && !m.stages.some(st => stages.has(st))).map(m => m.id);
    };

    onStep('intake', 'running');
    let t = performance.now();
    const s0 = TP.stages.intake.run({ bytes: u8, maxBytes: (cfg.maxFileMB || 20) * 1048576 });
    if (s0.stop) { onStep('intake', 'failed'); return finish(s0.findings, { stopped: 'intake' }); }
    const s1 = TP.stages.identify.run({ text: s0.text, country, countryConfig });
    timings.intake = performance.now() - t;
    if (s1.stop) { onStep('intake', 'failed'); return finish(s1.findings, { stopped: 'identify', version: null }); }
    const base = { version: s1.version, versionLabel: s1.label, text: s0.text };
    planned = plannedFor(s1.version);

    onStep('xsd', 'running');
    for (const m of RULE_MODULES) onStep(m, 'running');
    const xsdP = TP.stages.xsd.run(engines.xsd, { text: s0.text, version: s1.version })
      .then(r => { timings.xsd = r.ms; return r; });
    const rulesP = TP.stages.rules.run(engines.rules, { text: s0.text, version: s1.version, country, context: { country, countryConfig, settings } })
      .then(r => { timings.rules = r.ms; timings.ruleSets = r.timings; return r; })
      .catch(err => ({ stop: false, findings: [], error: String(err.message || err) }));
    const x = await xsdP;
    if (x.stop) {
      onStep('intake', 'failed'); onStep('xsd', 'skipped');
      for (const m of RULE_MODULES) onStep(m, 'skipped');
      await rulesP.catch(() => null);
      return finish(x.findings, { ...base, stopped: 'well-formed' });
    }
    onStep('intake', 'ok');
    const xsdGroups = TP.report.build({ findings: x.findings, catalogue: engines.catalogue, settings }).groups;
    onStep('xsd', xsdGroups.length ? 'findings' : 'ok', { n: xsdGroups.length, counts: { E: xsdGroups.length, W: 0, I: 0 } });
    const r = await rulesP;
    const rulesError = r.error || r.parseError || null;
    const findings = [...x.findings, ...r.findings];
    if (rulesError) {
      findings.push({ source: 'rules', rule: '4.engine', stage: 4, severity: 'W', code: null, level: 'file', message: `The rule checks (stages 3–10) could not run: ${rulesError}`, xpath: null, line: null, col: null });
    }
    const out = finish(findings, { ...base, summary: r.summary, rulesRan: r.ran || [], rulesError, xsdTruncated: !!x.truncated, failedModules: rulesError ? RULE_MODULES : [] });
    for (const m of out.modules) if (RULE_MODULES.includes(m.id)) onStep(m.id, m.failed ? 'failed' : m.n ? 'findings' : m.planned ? 'planned' : 'ok', { n: m.n, counts: m.counts });
    return out;
  }

  /*
   * Settings for this browser session only (About page): a file with the
   * structure of config/settings.json, merged over the built-in settings (so it
   * may hold only the values that differ), used until the page is reloaded or
   * the built-in settings are chosen again. Nothing is stored.
   * Returns { ok, problems: [...] }; ok false leaves the settings unchanged.
   */
  const KNOWN = ['checks', 'limits', 'paymentTypes', 'charsets', 'guideline', 'crossBorder', 'hints'];
  function checkSettings(obj) {
    const problems = [], notes = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { problems: ['The file does not contain a settings object ({ … }).'], notes };
    const keys = Object.keys(obj).filter(k => k[0] !== '_');
    const unknown = keys.filter(k => !KNOWN.includes(k));
    if (!keys.some(k => KNOWN.includes(k))) problems.push(`None of the known sections (${KNOWN.join(', ')}) is in the file.`);
    if (unknown.length) notes.push(`Not used: ${unknown.join(', ')}.`);
    for (const [k, v] of Object.entries((obj.limits) || {})) {
      if (k[0] === '_' || v == null) continue;
      if (/Age|Tolerance|Ahead/.test(k) && !TP.functions.parseDuration(v)) problems.push(`limits.${k}: "${v}" is not an ISO 8601 duration (for example P1M, P30D, PT1H).`);
      if (/Amount$/.test(k) && !/^\d+(\.\d+)?$/.test(String(v))) problems.push(`limits.${k}: "${v}" is not an amount (for example "999999999.99").`);
      if (/^max(Blocks|Transactions)/.test(k) && !(Number.isInteger(v) && v > 0)) problems.push(`limits.${k}: ${JSON.stringify(v)} is not a whole number above 0.`);
    }
    for (const [k, v] of Object.entries(obj.checks || {})) {
      if (k[0] === '_') continue;
      if (!/^(\d+|X)\.\d+(-[a-z]+)?$/.test(k)) problems.push(`checks."${k}": not a check id (for example 4.2 or 4.2-age).`);
      else if (/^[01]\./.test(k)) problems.push(`checks."${k}": checks of stages 0 and 1 stop the run and cannot be changed.`);
      if (!v || typeof v !== 'object') { problems.push(`checks."${k}": must be an object such as { "severity": "W" }.`); continue; }
      if (v.severity != null && !['E', 'W', 'I'].includes(v.severity)) problems.push(`checks."${k}".severity: "${v.severity}" is not E, W or I.`);
      if (v.enabled != null && typeof v.enabled !== 'boolean') problems.push(`checks."${k}".enabled: must be true or false.`);
    }
    // the values the rules read as numbers or true/false (a string there would be ignored without a word)
    const g = obj.guideline || {};
    const num = v => v === null || (typeof v === 'number' && v >= 0);
    for (const sec of ['maxLength', 'maxOccurs']) for (const [k, v] of Object.entries(g[sec] || {})) if (k[0] !== '_' && !num(v)) problems.push(`guideline.${sec}."${k}": ${JSON.stringify(v)} must be a number or null.`);
    for (const [k, v] of Object.entries(g)) if (k[0] !== '_' && ['multipleDebtorAccounts', 'multipleDebtorAgents', 'executionDateTime', 'equivalentAmount', 'regulatoryReporting', 'onePaymentTypePerBlock', 'oneCountryPerFile', 'unstructuredAddress', 'scheduledInstant'].includes(k) && typeof v !== 'boolean' && v !== null) problems.push(`guideline.${k}: ${JSON.stringify(v)} must be true or false.`);
    for (const [k, v] of Object.entries((obj.hints || {}).recommend || {})) if (k[0] !== '_' && typeof v !== 'boolean') problems.push(`hints.recommend.${k}: ${JSON.stringify(v)} must be true or false.`);
    for (const [k, v] of Object.entries((obj.hints || {}).truncateLength || {})) if (k[0] !== '_' && !num(v)) problems.push(`hints.truncateLength."${k}": ${JSON.stringify(v)} must be a number or null.`);
    return { problems, notes };
  }
  function useSettings(obj, name) {
    const r = checkSettings(obj);
    if (r.problems.length) return { ok: false, ...r };
    engines.sessionSettings = obj;
    engines.settings = TP.functions.merge(engines.builtInSettings, obj);
    engines.settingsSource = { kind: 'session', name: name || 'settings file', at: new Date().toISOString() };
    return { ok: true, ...r };
  }
  function builtInSettings() {
    engines.settings = engines.builtInSettings;
    engines.sessionSettings = null;
    engines.settingsSource = { kind: 'built-in' };
  }

  TP.validation = { init, validate, engines, checkSettings, useSettings, builtInSettings };
})(typeof self !== 'undefined' ? self : globalThis);
