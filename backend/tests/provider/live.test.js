'use strict';
/* LIVE provider + agent-runtime suite (REAL Ollama daemon, forked backend).
 * Fails loudly when the daemon at http://localhost:11434 is unreachable —
 * no silent skips. Backend: forked server.js on PORT 48231 with a fresh temp
 * DATA_DIR (production :47911 untouched). Never writes to the real daemon.
 * Run: node --test tests/provider/live.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { forkBackend, postJSON, sseRun } = require('./mock-ollama');

const DAEMON = 'http://localhost:11434';
const LIVE_PORT = 48231;
const SERVER_PATH = path.join(__dirname, '..', '..', 'server.js');
const LIVE_TIMEOUT = 240000;

let backend;
let BASE;
let REPO;

before(async () => {
  let tags;
  try {
    const r = await fetch(`${DAEMON}/api/tags`);
    if (!r.ok) throw new Error(`daemon tags status ${r.status}`);
    tags = await r.json();
  } catch (e) {
    throw new Error(`LIVE suite needs the real Ollama daemon at ${DAEMON} — unreachable: ${e.message}`);
  }
  assert.ok(Array.isArray(tags.models) && tags.models.length >= 1, 'daemon must host at least one model');
  REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-live-repo-'));
  fs.writeFileSync(path.join(REPO, 'app.json'), JSON.stringify({ name: 'demo', version: '1.2.3', note: 'the needle is here too' }));
  fs.writeFileSync(path.join(REPO, 'note.txt'), 'the needle is hidden here\nsecond line\n');
  fs.mkdirSync(path.join(REPO, 'sub'));
  fs.writeFileSync(path.join(REPO, 'sub', 'nested.json'), JSON.stringify({ nested: true }));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-live-data-'));
  backend = await forkBackend({ port: LIVE_PORT, dataDir, serverPath: SERVER_PATH });
  BASE = backend.base;
});

after(async () => { if (backend) backend.kill(); });

const tokensOf = (events) => events.filter((e) => e.type === 'token').map((e) => String(e.token)).join('');
const live = (body, opts) => sseRun(BASE, '/api/agent/run', body, { timeoutMs: LIVE_TIMEOUT, ...(opts || {}) });
const msg = (content) => [{ role: 'user', content }];

test('live: daemon tags lists at least one model', async () => {
  const j = await (await fetch(`${DAEMON}/api/tags`)).json();
  assert.ok(j.models.length >= 1);
});

test('live: backend local models endpoint is ok', async () => {
  const r = await postJSON(BASE, '/api/ollama/models', { scope: 'local' });
  assert.equal(r.json.ok, true);
  assert.ok(r.json.models.length >= 1);
});

test('live: show qwen2.5-coder:7b capabilities lack thinking', async () => {
  const r = await postJSON(BASE, '/api/ollama/show', { name: 'qwen2.5-coder:7b', scope: 'local' });
  const caps = r.json.capabilities || (r.json.details || {}).capabilities || [];
  assert.ok(!caps.includes('thinking'), `expected no thinking, got ${JSON.stringify(caps)}`);
});

test('live: think:true on a non-thinking model errors (documents the guard reason)', async () => {
  const r = await fetch(`${DAEMON}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen2.5-coder:7b', prompt: 'hi', stream: false, think: true }),
  });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /does not support thinking/);
});

test('live: agent/run local qwen globs a real directory', async () => {
  // Small local models occasionally answer in prose twice (defeating the
  // server's strict retry). Resample once: a server break would fail every
  // sample, a GPU flake passes on retry. Assertions are identical either way.
  let events = null;
  let done = null;
  for (let attempt = 0; attempt < 2 && !done; attempt++) {
    const r = await live({
      model: 'qwen2.5-coder:7b', scope: 'local', mode: 'chat', repo: REPO,
      messages: msg('glob for all json files in this directory'),
    });
    events = r.events;
    done = events.find((e) => e.type === 'tool' && e.tool === 'glob' && e.status === 'complete');
  }
  assert.ok(done, `no glob complete; events=${JSON.stringify(events.map((e) => e.type + ':' + (e.tool || e.phase || '')))}`);
  assert.match(done.output, /app\.json|nested\.json/);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('live: agent/run file_read serves real file content', async () => {
  const { events } = await live({
    model: 'qwen2.5-coder:7b', scope: 'local', mode: 'chat', repo: REPO,
    messages: msg('read the file app.json and tell me its version'),
  });
  assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'read_file' && e.status === 'complete'));
  assert.match(tokensOf(events), /1\.2\.3/);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('live: multi-intent read+grep runs BOTH tools', async () => {
  const { events } = await live({
    model: 'qwen2.5-coder:7b', scope: 'local', mode: 'chat', repo: REPO,
    messages: msg('read app.json and grep for needle'),
  });
  assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'file_read' && e.status === 'complete'));
  const grep = events.find((e) => e.type === 'tool' && e.tool === 'grep' && e.status === 'complete');
  assert.ok(grep, `no grep complete; events=${JSON.stringify(events.map((e) => e.type + ':' + (e.tool || e.phase || '')))}`);
  assert.match(grep.output, /needle/);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('live: casual hi has NO deciding phase and streams', async () => {
  const { events } = await live({ model: 'qwen3.5:4b', scope: 'local', messages: msg('hi') });
  assert.ok(!events.some((e) => e.type === 'status' && e.phase === 'deciding'));
  assert.ok(tokensOf(events).length > 0);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('live: free-cloud gpt-oss:20b streams tokens via the signin path', async () => {
  const { events } = await live({ model: 'gpt-oss:20b', scope: 'cloud', messages: msg('say hi in five words') });
  assert.ok(!events.some((e) => e.type === 'auth'), 'free signin path must not raise auth');
  assert.ok(tokensOf(events).length > 0, `no tokens; events=${JSON.stringify(events).slice(0, 400)}`);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('live: cloud model list has 20 models', async () => {
  const r = await postJSON(BASE, '/api/ollama/models', { scope: 'cloud' });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.models.length, 20);
});

test('live: keycheck without a key reports nokey', async () => {
  const r = await postJSON(BASE, '/api/ollama/keycheck', {});
  assert.equal(r.json.ok, false);
  assert.equal(r.json.reason, 'nokey');
});

test('live: show qwen3.5:4b advertises thinking', async () => {
  const r = await postJSON(BASE, '/api/ollama/show', { name: 'qwen3.5:4b', scope: 'local' });
  const caps = r.json.capabilities || (r.json.details || {}).capabilities || [];
  assert.ok(caps.includes('thinking'), `expected thinking, got ${JSON.stringify(caps)}`);
});

test('live: reasoning High on a thinking model streams', async () => {
  const { events } = await live({ model: 'qwen3.5:4b', scope: 'local', reasoning: 'High', messages: msg('hi') });
  assert.ok(tokensOf(events).length > 0);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('live: 25-message history still completes', async () => {
  const messages = [];
  for (let i = 0; i < 24; i++) messages.push({ role: i % 2 ? 'assistant' : 'user', content: `filler ${i}` });
  messages.push({ role: 'user', content: 'hello again friend' });
  const { events } = await live({ model: 'qwen3.5:4b', scope: 'local', messages });
  assert.ok(tokensOf(events).length > 0);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('live: tools list exposes the agent belt', async () => {
  const r = await (await fetch(`${BASE}/api/tools`)).json();
  assert.equal(r.ok, true);
  const names = r.tools.map((t) => t.name);
  assert.ok(names.includes('Agent'));
  assert.ok(names.includes('glob'));
  assert.ok(names.includes('file_read'));
});
