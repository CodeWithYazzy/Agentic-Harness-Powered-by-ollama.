'use strict';
/* Agent-loop runtime suite (self-contained mock Ollama, forked backend).
 * No git binary needed: plain temp repo, file/glob tools only.
 * Backend on :48232, mock Ollama on :48231. Run:
 *   node --test tests/provider/agent-loop.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { fork } = require('node:child_process');

const MOCK_PORT = 48231;
const BACKEND_PORT = 48232;
const SERVER_PATH = path.join(__dirname, '..', '..', 'server.js');

let mock;
let backend;
let BASE;
let DATA_DIR;
let REPO;

function startMock() {
  const script = { show: { status: 200, body: { details: { capabilities: [] } } }, generate: [] };
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = { _raw: raw }; }
      const url = String(req.url || '').split('?')[0];
      requests.push({ method: req.method, path: url, body });
      const send = (st, obj) => {
        const b = JSON.stringify(obj);
        res.writeHead(st, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
        res.end(b);
      };
      if (url === '/api/show') return send(200, script.show.body);
      if (url === '/api/generate') {
        const entry = script.generate.shift();
        if (!entry) return send(500, { error: 'mock queue exhausted' });
        if (entry.hang) return; // never respond: client timeout/abort ends it
        if (entry.json) return send(200, entry.json);
        if (entry.ndjson) {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          for (const line of entry.ndjson) res.write(JSON.stringify(line) + '\n');
          return res.end();
        }
        return send(entry.status || 500, { error: entry.text || 'mock error' });
      }
      return send(404, { error: 'mock: unknown ' + url });
    });
  });
  return new Promise((resolve) => {
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${MOCK_PORT}`,
      script, requests,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

async function waitForBackend(base) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch { /* not up */ }
    if (Date.now() - t0 > 20000) throw new Error('backend did not come up');
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function postJSON(p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// Collect SSE data: events until server ends the stream (30s cap).
async function collectRun(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const events = [];
  try {
    const r = await fetch(`${BASE}/api/agent/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    assert.equal(r.status, 200);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const p of parts) {
        for (const line of p.split('\n')) {
          const m = line.match(/^data:\s*([\s\S]*)$/);
          if (m) { try { events.push(JSON.parse(m[1])); } catch { /* keep */ } }
        }
      }
    }
  } finally { clearTimeout(timer); }
  return events;
}

const fence = (name, input) => '```tool\n' + JSON.stringify({ name, input }) + '\n```';
// After tool results the loop always runs one more decision pass: script a
// prose reply for it, then the final streaming summary.
const PROSE = { json: { response: 'I have what I need and will answer now.' } };
// (Re)script the mock AND drop previous requests (incl. late detached memory
// fetches) so per-test generate/request counts are deterministic.
let memSeen = 0;
function script(entries) {
  mock.requests.length = 0;
  memSeen = 0;
  mock.script.generate = entries.slice();
}
// Every tool-using run schedules one detached memory-extraction fetch AFTER
// the response ends. Drain it before the next test scripts its queue, or it
// arrives late and steals that test's first entry.
const memCount = () => mock.requests.filter((q) => q.path === '/api/generate' && q.body && typeof q.body.system === 'string' && q.body.system.includes('DURABLE project facts')).length;
async function drainMem() {
  const t0 = Date.now();
  while (memCount() <= memSeen && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 120));
  memSeen = memCount();
}
const baseBody = (content, mode) => ({
  repo: REPO, model: 'mock-model', scope: 'local', mode: mode || 'chat',
  messages: [{ role: 'user', content }],
});

before(async () => {
  mock = await startMock();
  DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-loop-data-'));
  REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-loop-repo-'));
  fs.writeFileSync(path.join(REPO, 'note.txt'), 'the needle is hidden here\nsecond line\n');
  backend = fork(SERVER_PATH, [], {
    env: { ...process.env, PORT: String(BACKEND_PORT), OLLAMA_DESKTOP_DATA: DATA_DIR },
    silent: true,
  });
  BASE = `http://127.0.0.1:${BACKEND_PORT}`;
  await waitForBackend(BASE);
  const cfg = await postJSON('/api/config', { localEndpoint: mock.url });
  assert.equal(cfg.json.ok, true);
});

after(async () => {
  try { backend.kill(); } catch { /* ignore */ }
  if (mock) await mock.close();
});

test('tool call executes and summary streams (file_read)', async () => {
  script([
    { json: { response: `Reading it.\n${fence('file_read', { path: 'note.txt' })}` } },
    PROSE,
    { ndjson: [{ response: 'The needle' }, { response: ' is here.' }, { done: true }] },
  ]);
  const events = await collectRun(baseBody('read note.txt and explain'));
  const tools = events.filter((e) => e.type === 'tool');
  assert.ok(tools.some((t) => t.tool === 'file_read' && t.status === 'complete'), JSON.stringify(tools));
  const tokens = events.filter((e) => e.type === 'token').map((e) => e.token).join('');
  assert.match(tokens, /needle/);
  assert.ok(events.some((e) => e.type === 'done'));
  await drainMem();
});

test('prose decision falls back to a plain stream (no tools)', async () => {
  // 'hello there' is not tool-shaped: no decision pass runs, the summary is
  // the only generate call — queue exactly that (an extra decision entry here
  // would only pass via another test's queue stealing).
  script([
    { ndjson: [{ response: 'Hello!' }, { done: true }] },
  ]);
  const events = await collectRun(baseBody('hello there'));
  assert.equal(events.filter((e) => e.type === 'tool').length, 0);
  assert.ok(events.filter((e) => e.type === 'token').length > 0);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('denied write never touches disk (build mode)', async () => {
  await postJSON('/api/config', { toolPolicy: { file_write: 'deny' } });
  try {
    script([
      { json: { response: `Creating.\n${fence('file_write', { path: 'evil.txt', content: 'x' })}` } },
      PROSE,
      { ndjson: [{ response: 'Denied.' }, { done: true }] },
    ]);
    const events = await collectRun(baseBody('create file evil.txt', 'build'));
    const tools = events.filter((e) => e.type === 'tool');
    assert.ok(tools.some((t) => t.tool === 'file_write' && t.status === 'denied')), JSON.stringify(tools);
    assert.ok(!fs.existsSync(path.join(REPO, 'evil.txt')));
  } finally {
    await postJSON('/api/config', { toolPolicy: {} });
  }
  await drainMem();
});

test('malformed call fails fast with no approval card', async () => {
  script([
    { json: { response: `Creating.\n${fence('file_write', {})}` } },
    PROSE,
    { ndjson: [{ response: 'Fixed.' }, { done: true }] },
  ]);
  const events = await collectRun(baseBody('create the thing', 'build'));
  assert.equal(events.filter((e) => e.type === 'tool_approval').length, 0);
  assert.ok(events.some((e) => e.type === 'tool' && e.status === 'error'), JSON.stringify(events));
  await drainMem();
});

test('unknown tool name is dropped, plain stream follows', async () => {
  // loop-running content: the fence is parsed but its unknown name is
  // dropped; the strict retry gets prose, then the plain summary streams.
  script([
    { json: { response: fence('no_such_tool_xyz', {}) } },
    PROSE,
    { ndjson: [{ response: 'Fallback.' }, { done: true }] },
  ]);
  const events = await collectRun(baseBody('read note and grep'));
  assert.equal(events.filter((e) => e.type === 'tool').length, 0);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('directory question lists files deterministically (list_dir fast path)', async () => {
  // list_dir needs no model tool cooperation: the only generate call is the summary.
  script([
    { ndjson: [{ response: 'You have note.txt and app.json.' }, { done: true }] },
  ]);
  const events = await collectRun(baseBody('what is in my current directory'));
  assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'list_dir' && e.status === 'complete'), JSON.stringify(events.map((e) => e.type + ':' + (e.tool || ''))));
  const tokens = events.filter((e) => e.type === 'token').map((e) => e.token).join('');
  assert.match(tokens, /note\.txt/);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('no directory open: file tools are not offered, plain stream follows', async () => {
  // The model asks for file_read but no repo is open: the loop filters it
  // out (no retry — nothing could succeed), then the plain summary streams.
  script([
    { json: { response: `Reading.\n${fence('file_read', { path: 'note.txt' })}` } },
    { ndjson: [{ response: 'Open a directory first.' }, { done: true }] },
  ]);
  const events = await collectRun({ repo: '', model: 'mock-model', scope: 'local', mode: 'chat', messages: [{ role: 'user', content: 'record a todo for me' }] });
  assert.equal(events.filter((e) => e.type === 'tool').length, 0);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('missing model is 400 JSON, not a hang', async () => {
  const r = await postJSON('/api/agent/run', { messages: [] });
  assert.equal(r.status, 400);
  assert.equal(r.json.ok, false);
});

test('batched tool calls all execute in one round', async () => {
  script([
    { json: { response: `Two jobs.\n${fence('file_read', { path: 'note.txt' })}\n${fence('glob', { pattern: '*.txt' })}` } },
    PROSE,
    { ndjson: [{ response: 'Both done.' }, { done: true }] },
  ]);
  const events = await collectRun(baseBody('read note and list text files'));
  const done = events.filter((e) => e.type === 'tool' && e.status === 'complete').map((t) => t.tool).sort();
  assert.deepEqual(done, ['file_read', 'glob']);
  assert.ok(events.some((e) => e.type === 'done'));
  await drainMem();
});

test('failed tool does not kill the run (error recorded, answer still streams)', async () => {
  script([
    { json: { response: `Reading.\n${fence('file_read', { path: 'missing.txt' })}` } },
    PROSE,
    { ndjson: [{ response: 'Not found.' }, { done: true }] },
  ]);
  const events = await collectRun(baseBody('read missing file'));
  assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'file_read' && e.status === 'error'));
  assert.ok(events.some((e) => e.type === 'done'));
  await drainMem();
});

test('model 500 on the decision pass falls back to a plain stream', async () => {
  // multi-intent content forces the tool loop; its decision gets the 500.
  script([
    { status: 500, text: 'boom' },
    { ndjson: [{ response: 'Fallback answer.' }, { done: true }] },
  ]);
  const events = await collectRun(baseBody('read note and grep'));
  assert.equal(events.filter((e) => e.type === 'tool').length, 0);
  assert.ok(events.filter((e) => e.type === 'token').length > 0);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('loop stops after 4 decision rounds (no infinite loop)', async () => {
  const fenceAgain = () => ({ json: { response: `Again.\n${fence('file_read', { path: 'note.txt' })}` } });
  script([fenceAgain(), fenceAgain(), fenceAgain(), fenceAgain(), PROSE,
    { ndjson: [{ response: 'Capped.' }, { done: true }] }]);
  const events = await collectRun(baseBody('read the note'));
  await drainMem(); // replaces the blind 800ms sleep: waits for the owed fetch
  const isMem = (q) => typeof q.body?.system === 'string' && q.body.system.includes('DURABLE project facts');
  const decisions = mock.requests.filter((q) => q.path === '/api/generate' && q.body && q.body.stream === false && !isMem(q));
  assert.equal(decisions.length, 4);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('client abort ends the stream and the bridge survives', async () => {
  script([
    { json: { response: 'No tools here.' } },
    { hang: true },
  ]);
  const ctrl = new AbortController();
  const p = fetch(`${BASE}/api/agent/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(baseBody('hello')), signal: ctrl.signal,
  }).then(async (r) => {
    const reader = r.body.getReader();
    setTimeout(() => ctrl.abort(), 400);
    try {
      for (;;) { const { done } = await reader.read(); if (done) break; }
      return 'ended';
    } catch (e) { return e.name || String(e); }
  });
  const outcome = await p;
  assert.match(String(outcome), /AbortError|ended/);
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  assert.equal(h.ok, true);
  mock.requests.length = 0;
});

test('Agent delegation runs a subagent and returns its findings', async () => {
  script([
    { json: { response: `Delegating.\n${fence('Agent', { agent: 'Explore', task: 'read note.txt' })}` } },
    { json: { response: `Recon.\n${fence('file_read', { path: 'note.txt' })}` } },
    { json: { response: 'Got the file content.' } },
    { json: { response: 'Findings: the needle is hidden here.' } },
    PROSE,
    { ndjson: [{ response: 'Subagent done.' }, { done: true }] },
  ]);
  const events = await collectRun(baseBody('explore the note file'));
  const agentEvts = events.filter((e) => e.type === 'tool' && e.tool === 'Agent');
  const agentEv = agentEvts.find((e) => e.status === 'complete');
  assert.ok(agentEv, 'Agent complete event. got: ' + JSON.stringify(agentEvts).slice(0, 1500));
  assert.match(String(agentEv.output || ''), /needle/);
  assert.ok(events.some((e) => e.type === 'done'));
  await drainMem();
});
