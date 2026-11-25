/*
 * Testing Portal – small helper for talking to a worker with request ids.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};

  class WorkerClient {
    constructor(name) {
      this.name = name;
      this.worker = TP.platform.createWorker(name);
      this.pending = new Map();
      this.seq = 0;
      this.readyInfo = null;
      this.loaded = new Promise(res => { this.loadedResolve = res; });
      this.worker.onmessage = e => this.onMessage(e.data || {});
      this.worker.onerror = e => {
        const err = new Error(`${name} worker: ${e.message || 'failed to start'}`);
        this.failAll(err);
        if (this.readyReject) this.readyReject(err);
      };
    }
    onMessage(msg) {
      if (msg.type === 'loaded') { this.loadedResolve(); return; }
      if (msg.type === 'ready') { this.readyInfo = msg.info; if (this.readyResolve) this.readyResolve(msg.info); return; }
      const p = this.pending.get(msg.id);
      if (!p) { if (msg.type === 'error' && this.readyReject) this.readyReject(new Error(msg.error)); return; }
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.error)); else p.resolve(msg);
    }
    failAll(err) { for (const p of this.pending.values()) p.reject(err); this.pending.clear(); }
    init(payload, timeoutMs = 60000) {
      return new Promise((resolve, reject) => {
        this.readyResolve = resolve; this.readyReject = reject;
        const timer = setTimeout(() => reject(new Error(`${this.name} worker did not start within ${timeoutMs / 1000} s`)), timeoutMs);
        const done = f => v => { clearTimeout(timer); f(v); };
        this.readyResolve = done(resolve); this.readyReject = done(reject);
        this.loaded.then(() => this.worker.postMessage({ type: 'init', ...payload }));
      });
    }
    request(payload) {
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ ...payload, id });
      });
    }
    terminate() { this.worker.terminate(); this.failAll(new Error('terminated')); }
  }

  TP.WorkerClient = WorkerClient;
})(typeof self !== 'undefined' ? self : globalThis);
