'use strict';
/* YK-Harness bridge test helper: configurable Ollama double + harness utils.
 *
 * startMockOllama(script) -> mock control object:
 *   script = {
 *     tags: {status, body} | (rec) => {status, body},   // GET|POST /api/tags
 *     show: {status, body} | (recBody, rec) => {...},   // POST /api/show
 *     generate: [ entry, ... ],                          // FIFO queue, one per POST /api/generate
 *   }
 *   generate entry = {
 *     json: {...},            // 200 JSON reply (stream:false style)
 *     ndjson: [obj|string],   // 200 NDJSON lines (stream:true style; strings sent verbatim)
 *     status: n, text: '...',// error reply with raw body (default status 200 when json/ndjson)
 *     delayMs: n,             // wait before responding
 *     hang: true,             // never respond (for timeout/cancel tests)
 *   }
 *   Exhausted generate queue -> loud 500 {error:'mock queue exhausted'} (never silent).
 *   mock.requests = [{method, path, body}] in arrival order.
 *   mock.script is mutable live (tests assign mock.script.generate = [...] per test).
 *   mock.reset() clears requests (keeps server).
 *   mock.close() stops the server.
 *
 * Also exported: forkBackend, waitForBackend, postJSON, sseRun, toolBlock, sleep.
 */
const http = require('http');
const { fork } = require('child_process');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function sendJson(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}

function resolveStaticOrFn(v, ...args) {
  return typeof v === 'function' ? v(...args) : v;
}

function startMockOllama(initialScript = {}) {
  const script = {
    tags: { status: 200, body: { models: [] } },
    show: { status: 200, body: { details: { capabilities: [] } } },
    generate: [],
    ...initialScript,
  };
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null;
      if (raw) { try { body = JSON.parse(raw); } catch { body = { _raw: raw }; } }
      const rec = { method: req.method, path: String(req.url || '').split('?')[0], body, at: Date.now() };
      requests.push(rec);
      if (rec.path === '/api/tags') {
        const t = resolveStaticOrFn(script.tags, rec) || { status: 200, body: { models: [] } };
        return sendJson(res, t.status || 200, t.body !== undefined ? t.body : {});
      }
      if (rec.path === '/api/show') {
        const s = resolveStaticOrFn(script.show, body, rec) || { status: 200, body: {} };
        return sendJson(res, s.status || 200, s.body !== undefined ? s.body : {});
      }
      if (rec.path === '/api/generate') {
        const entry = (script.generate || []).shift();
        if (!entry) return sendJson(res, 500, { error: 'mock queue exhausted' });
        rec.entry = entry;
        if (entry.hang) return; // never respond; client timeout/abort ends it
        const run = () => {
          if (entry.status && entry.status >= 400 && !entry.ndjson && !entry.json) {
            const t = entry.text !== undefined ? String(entry.text) : '';
            res.writeHead(entry.status, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(t) });
            return res.end(t);
          }
          if (entry.ndjson) {
            res.writeHead(entry.status || 200, { 'Content-Type': 'application/x-ndjson' });
            for (const line of entry.ndjson) res.write((typeof line === 'string' ? line : JSON.stringify(line)) + '\n');
            return res.end();
          }
          return sendJson(res, entry.status || 200, entry.json !== undefined ? entry.json : {});
        };
        if (entry.delayMs) setTimeout(run, entry.delayMs);
        else run();
        return;
      }
      if (rec.path === '/page' && req.method === 'GET') {
        const t = '<html><body>Hello Mock Page, needle inside.</body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(t) });
        return res.end(t);
      }
      return sendJson(res, 404, { error: 'mock: unknown path ' + rec.path });
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(48201, '127.0.0.1', () => {
      resolve({
        url: 'http://127.0.0.1:48201',
        script,
        requests,
        reset() { requests.length = 0; },
        generates() { return requests.filter((r) => r.path === '/api/generate'); },
        shows() { return requests.filter((r) => r.path === '/api/show'); },
        close: () => new Promise((r) => server.close(r)),
      });
    });
    server.on('error', reject);
  });
}

async function waitForBackend(base, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`backend did not come up at ${base}`);
    await sleep(100);
  }
}

async function forkBackend({ port, dataDir, serverPath }) {
  const child = fork(serverPath, [], {
    env: { ...process.env, PORT: String(port), OLLAMA_DESKTOP_DATA: dataDir },
    silent: true,
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForBackend(base);
  } catch (e) {
    try { child.kill(); } catch { /* ignore */ }
    throw e;
  }
  return { child, base, kill: () => { try { child.kill(); } catch { /* ignore */ } } };
}

async function postJSON(base, p, body) {
  const r = await fetch(`${base}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: r.status, json, text };
}

/* POST an SSE endpoint, collect `data:` JSON events. onEvent(ev) may be async
 * (e.g. approve a tool_approval mid-run). opts.stopWhen(ev, events) aborts the
 * stream as soon as the wanted event arrives (for endpoints that never end
 * the stream themselves). Supports client abort via onEvent's ctrl. */
async function sseRun(base, p, body, opts = {}) {
  const { onEvent, stopWhen, timeoutMs = 90000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const events = [];
  let raw = '';
  let intentionalAbort = false;
  try {
    const r = await fetch(`${base}${p}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}), signal: ctrl.signal,
    });
    if (!r.ok || !r.body) return { events, httpStatus: r.status, raw };
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      buf += chunk;
      raw += chunk;
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          try {
            const ev = JSON.parse(t.slice(5).trim());
            events.push(ev);
            if (onEvent) await onEvent(ev, ctrl);
            if (stopWhen && stopWhen(ev, events)) { intentionalAbort = true; ctrl.abort(); break; }
          } catch { /* keep */ }
        }
      }
    }
    try { reader.cancel(); } catch { /* ignore */ }
  } catch (e) {
    if (!intentionalAbort) events.push({ type: '_client', error: String(e && e.message || e) });
  } finally {
    clearTimeout(timer);
  }
  return { events, raw };
}

const toolBlock = (name, input) => '```tool\n' + JSON.stringify({ name, input }) + '\n```';

module.exports = { startMockOllama, forkBackend, waitForBackend, postJSON, sseRun, toolBlock, sleep };
