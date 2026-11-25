/*
 * Testing Portal – browser stand-ins for the few Node.js features that the
 * SaxonJS 2 Node build (SaxonJS2N.js) refers to. SaxonJS2N.js itself is
 * loaded unchanged right after this file; it registers itself in
 * module.exports, which this file then exposes as self.SaxonJS.
 *
 * The Testing Portal never asks SaxonJS to read files or URLs: it always
 * passes the XML text and the compiled rules directly. The stand-ins for
 * fs, http and streams therefore only need to exist, not to work.
 */
(function (g) {
  'use strict';
  const unsupported = name => function () { throw new Error(name + ' is not available in the browser'); };

  /* Minimal Buffer: enough for base64 and UTF-8 conversions. */
  class MiniBuffer {
    constructor(bytes) { this.bytes = bytes; this.length = bytes.length; }
    static from(value, encoding) {
      if (value instanceof MiniBuffer) return new MiniBuffer(value.bytes.slice());
      if (value instanceof ArrayBuffer) return new MiniBuffer(new Uint8Array(value));
      if (ArrayBuffer.isView(value)) return new MiniBuffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      if (Array.isArray(value)) return new MiniBuffer(Uint8Array.from(value));
      const s = String(value);
      if (encoding === 'base64') {
        const bin = atob(s);
        const b = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
        return new MiniBuffer(b);
      }
      if (encoding === 'hex') {
        const b = new Uint8Array(s.length / 2);
        for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16);
        return new MiniBuffer(b);
      }
      if (encoding === 'latin1' || encoding === 'binary') {
        const b = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
        return new MiniBuffer(b);
      }
      return new MiniBuffer(new TextEncoder().encode(s));
    }
    static isEncoding(e) { return ['utf8', 'utf-8', 'base64', 'hex', 'latin1', 'binary'].includes(String(e).toLowerCase()); }
    static isBuffer(x) { return x instanceof MiniBuffer; }
    toString(encoding) {
      if (encoding === 'base64') {
        let bin = '';
        for (let i = 0; i < this.bytes.length; i++) bin += String.fromCharCode(this.bytes[i]);
        return btoa(bin);
      }
      if (encoding === 'hex') return Array.from(this.bytes, b => b.toString(16).padStart(2, '0')).join('');
      if (encoding === 'latin1' || encoding === 'binary') return String.fromCharCode.apply(null, this.bytes);
      return new TextDecoder().decode(this.bytes);
    }
  }

  const shims = {
    fs: { readFileSync: unsupported('fs.readFileSync'), writeFileSync: unsupported('fs.writeFileSync'),
      readFile: unsupported('fs.readFile'), writeFile: unsupported('fs.writeFile'), existsSync: () => false,
      promises: { readFile: unsupported('fs.promises.readFile'), writeFile: unsupported('fs.promises.writeFile') } },
    path: {
      sep: '/',
      join: (...p) => p.join('/').replace(/\/+/g, '/'),
      resolve: (...p) => p.join('/').replace(/\/+/g, '/'),
      dirname: p => String(p).replace(/\/[^/]*$/, '') || '/',
      basename: p => String(p).replace(/^.*\//, ''),
      extname: p => (String(p).match(/\.[^./]*$/) || [''])[0],
      isAbsolute: p => String(p).startsWith('/')
    },
    stream: { Stream: class Stream {}, Readable: class Readable {}, Writable: class Writable {}, Transform: class Transform {} },
    url: {
      URL: g.URL,
      pathToFileURL: p => new URL('file://' + p),
      fileURLToPath: u => String(u).replace(/^file:\/\//, ''),
      parse: u => new URL(u)
    },
    util: {
      TextDecoder: g.TextDecoder, TextEncoder: g.TextEncoder,
      promisify: f => (...a) => new Promise((ok, ko) => f(...a, (e, r) => (e ? ko(e) : ok(r)))),
      inspect: x => String(x),
      format: (...a) => a.join(' ')
    },
    axios: { get: unsupported('axios.get'), post: unsupported('axios.post'), create: () => shims.axios }
  };

  g.global = g.global || g;
  g.process = g.process || { platform: 'browser', env: {}, argv: [], stdout: { write: s => console.log(s) }, stderr: { write: s => console.error(s) } };
  g.Buffer = g.Buffer || MiniBuffer;
  g.require = name => {
    const key = String(name).replace(/^node:/, '');
    if (key in shims) return shims[key];
    throw new Error('Module not available in the browser: ' + name);
  };
  g.module = { exports: {} };
  g.exports = g.module.exports;

  /* Called after SaxonJS2N.js has loaded. */
  g.TPAdoptSaxonJS = function () {
    const sx = g.module.exports;
    if (!sx || typeof sx.transform !== 'function') throw new Error('SaxonJS did not load');
    g.SaxonJS = sx;
    return sx;
  };
})(typeof self !== 'undefined' ? self : globalThis);
