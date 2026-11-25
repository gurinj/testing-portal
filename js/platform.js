/*
 * Testing Portal – platform layer.
 * Everything that differs between the three ways the app runs is kept here:
 *   site     – the separate files served by a web server (GitHub Pages, python http.server)
 *   artifact – the separate files published as a Claude artifact (claude.ai frame)
 *   offline  – the single HTML file built by tools/build.js, opened from disk
 * Other files never check the mode themselves; they call TP.platform / TP.assets.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};

  /* ---------- assets: schemas, compiled rules, config ---------- */
  const embedded = () => (g.TP_EMBEDDED || null);
  const assets = {
    isEmbedded() { return !!embedded(); },
    has(path) { const e = embedded(); return e ? path in e.files : true; },
    async text(path) {
      const e = embedded();
      if (e) {
        const f = e.files[path];
        if (!f) throw new Error('Embedded file missing: ' + path);
        return f.enc === 'base64' ? new TextDecoder().decode(b64ToBytes(f.data)) : f.data;
      }
      const r = await fetch(path, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`Cannot load ${path} (HTTP ${r.status})`);
      return r.text();
    },
    async json(path) { return JSON.parse(await assets.text(path)); }
  };
  function b64ToBytes(s) {
    const bin = atob(s);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }

  /* ---------- mode ---------- */
  function mode() {
    if (embedded()) return 'offline';
    if (g.claude && typeof g.claude.use === 'function') return 'artifact';
    return 'site';
  }
  const MODE_LABEL = { offline: 'Offline file', artifact: 'Claude artifact', site: 'Web server' };

  /* ---------- workers ---------- */
  /*
   * name: 'rules' (classic worker) or 'xsd' (module worker).
   * In the offline file the build has embedded the full worker source;
   * it runs from a blob: URL. Otherwise the worker file is loaded by path.
   */
  function createWorker(name) {
    const e = embedded();
    const spec = { rules: { path: 'js/validation/rules-worker.js', type: 'classic' },
                   xsd: { path: 'js/validation/xsd-worker.mjs', type: 'module' } }[name];
    if (!spec) throw new Error('Unknown worker: ' + name);
    if (e) {
      const src = e.workers[name];
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      /* the offline file bundles every worker as a classic script */
      return new Worker(url, { name });
    }
    return new Worker(spec.path, { type: spec.type, name });
  }

  /* ---------- downloads ---------- */
  /*
   * In the Claude artifact, files go through the artifact's download feature,
   * which shows the viewer a confirmation. It accepts only some file types
   * (for example csv, txt, json, html, zip – not xml).
   * Elsewhere a normal browser download is used.
   */
  let artifactDownloads;
  async function downloadsApi() {
    if (mode() !== 'artifact') return null;
    if (artifactDownloads === undefined) {
      try { artifactDownloads = await g.claude.use('downloads'); } catch (err) { artifactDownloads = null; }
    }
    return artifactDownloads;
  }
  const ARTIFACT_EXT = ['txt', 'json', 'md', 'csv', 'html', 'zip', 'pdf', 'xlsx', 'svg'];
  async function canDownload(ext) {
    if (mode() !== 'artifact') return true;
    const api = await downloadsApi();
    return !!api && ARTIFACT_EXT.includes(String(ext).toLowerCase());
  }
  async function download(filename, data, mime) {
    if (mode() === 'artifact') {
      const api = await downloadsApi();
      if (!api) throw Object.assign(new Error('Downloads are not available here.'), { code: 'unavailable' });
      try { return await api.save({ filename, data }); }
      catch (err) { throw Object.assign(new Error(err && err.message || 'Download failed'), { code: err && err.code || 'unavailable' }); }
    }
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return { status: 'saved' };
  }

  /* ---------- clipboard and print ---------- */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (err) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (e) { return false; }
    }
  }
  const canPrint = () => mode() !== 'artifact';

  TP.assets = assets;
  TP.platform = { mode, modeLabel: () => MODE_LABEL[mode()], createWorker, download, canDownload, copyText, canPrint };
})(typeof self !== 'undefined' ? self : globalThis);
