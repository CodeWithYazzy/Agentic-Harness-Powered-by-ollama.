'use strict';
/* PROVIDER + AGENT-RUNTIME suite (mock Ollama double, forked backend).
 * Backend: forked server.js on PORT 48211 with a fresh temp DATA_DIR.
 * Mock Ollama: helper on PORT 48201. No production :47911 touched.
 * Run: node --test tests/provider/mock-provider.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startMockOllama, forkBackend, postJSON, sseRun, toolBlock, sleep } = require('./mock-ollama');
const srv = require('../../server.js');

const BACKEND_PORT = 48211;
const SERVER_PATH = path.join(__dirname, '..', '..', 'server.js');
const ORIG_CLOUD = 'https://ollama.com';
const DEAD_PORT_URL = 'http://127.0.0.1:9';

let mock;
let backend;
let BASE;
let DATA_DIR;
let REPO;
let GITREPO;
let seq = 0;
const uniq = (s) => `mock-${s}-${++seq}`;

before(async () => {
  mock = await startMockOllama();
  DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-mock-data-'));
  REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-mock-repo-'));
  fs.writeFileSync(path.join(REPO, 'app.json'), JSON.stringify({ name: 'demo', version: '1.2.3' }));
  fs.writeFileSync(path.join(REPO, 'note.txt'), 'the needle is hidden here\nsecond line\n');
  fs.writeFileSync(path.join(REPO, 'big.txt'), 'x'.repeat(100000));
  fs.mkdirSync(path.join(REPO, 'sub'));
  fs.writeFileSync(path.join(REPO, 'sub', 'code.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(REPO, 'edit-me.txt'), 'alpha beta gamma\n');
  GITREPO = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-mock-git-'));
  execFileSync('git', ['init'], { cwd: GITREPO });
  fs.writeFileSync(path.join(GITREPO, 'f.txt'), 'hello\n');
  execFileSync('git', ['add', '.'], { cwd: GITREPO });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'first commit'], { cwd: GITREPO });
  backend = await forkBackend({ port: BACKEND_PORT, dataDir: DATA_DIR, serverPath: SERVER_PATH });
  BASE = backend.base;
  const cfg = await postJSON(BASE, '/api/config', { localEndpoint: mock.url });
  assert.equal(cfg.json.ok, true);
});

after(async () => {
  if (backend) backend.kill();
  if (mock) await mock.close();
});

// ---------- helpers ----------
function scriptGen(entries) {
  mock.reset();
  mock.script.tags = { status: 200, body: { models: [] } };
  mock.script.show = { status: 200, body: { details: { capabilities: [] } } };
  mock.script.generate = (entries || []).slice();
}
const PLAIN = (text) => ({ json: { response: text } });
const SUMMARY = (tokens, evalCount) => ({ ndjson: [...tokens.map((t) => ({ response: t })), { done: true, eval_count: evalCount ?? 3 }] });
const showCaps = (caps) => ({ status: 200, body: { details: { capabilities: caps } } });
const gens = () => mock.requests.filter((r) => r.path === '/api/generate');
// The bridge fires a detached memory-extraction completeOnce after every run
// that used tools. It must neither shift decision indexes nor steal the next
// test's queued entry (see drainMemoryFetch below).
const isMemFetch = (r) => typeof r.body?.system === 'string' && r.body.system.includes('DURABLE project facts');
const decisions = () => gens().filter((r) => r.body && r.body.stream === false && !isMemFetch(r));
const summaries = () => gens().filter((r) => r.body && r.body.stream === true);
const memFetches = () => gens().filter(isMemFetch);
// A tool-using run always schedules one detached memory fetch. It lands on the
// (by then exhausted) queue as a loud 500 -> completeOnce null -> harmless.
// Wait for it before the next test scripts its queue, or it steals an entry.
async function drainMemoryFetch(timeoutMs = 10000) {
  const t0 = Date.now();
  for (;;) {
    if (memFetches().length > 0) return true;
    if (Date.now() - t0 > timeoutMs) throw new Error('memory-extraction fetch never landed (poison risk for next test)');
    await new Promise((r) => setTimeout(r, 50));
  }
}
const ranTools = (events) => events.some((e) => e.type === 'tool');
// Agent runs that executed tools schedule one detached memory fetch; drain it
// here so it can never steal the next test's queued mock entry.
async function runAgent(body, opts) {
  const out = await sseRun(BASE, '/api/agent/run', body, opts);
  // extractMemory only fires for repo-backed runs that used tools
  if (body && body.repo && ranTools(out.events)) await drainMemoryFetch();
  return out;
}
const tokensOf = (events) => events.filter((e) => e.type === 'token').map((e) => String(e.token)).join('');
const ptokensOf = (events) => events.filter((e) => typeof e.token === 'string').map((e) => e.token).join('');
const turns = (s) => (String(s || '').match(/^(User|Assistant):/gm) || []).length;
async function setConfig(patch) {
  const r = await postJSON(BASE, '/api/config', patch);
  assert.equal(r.json.ok, true);
  return r;
}
function agentBody(over) {
  return { model: uniq('m'), scope: 'local', mode: 'chat', messages: [{ role: 'user', content: 'hi' }], ...(over || {}) };
}
async function pollBg(id, want, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const r = await fetch(`${BASE}/api/agent/runs/${id}`);
    const j = await r.json();
    if (j.run && j.run.status === want) return j.run;
    if (Date.now() - t0 > timeoutMs) throw new Error(`bg run ${id} never reached ${want} (last=${j.run && j.run.status})`);
    await sleep(150);
  }
}

// ============================================================
// A. pure unit tests (no fork needed, but run here for one command)
// ============================================================
test('resolveRoute: keyless cloud appends :cloud and routes via local', () => {
  const r = srv.resolveRoute('cloud', 'qwen3:8b', { localEndpoint: 'http://L', cloudEndpoint: 'http://C', cloudKey: '' });
  assert.equal(r.base, 'http://L');
  assert.equal(r.model, 'qwen3:8b:cloud');
  assert.equal(r.viaLocal, true);
  assert.equal(r.key, '');
});
test('resolveRoute: keyless cloud leaves existing :cloud suffix alone', () => {
  const r = srv.resolveRoute('cloud', 'qwen3:8b:cloud', { localEndpoint: 'http://L', cloudEndpoint: 'http://C', cloudKey: '' });
  assert.equal(r.model, 'qwen3:8b:cloud');
});
test('resolveRoute: keyless cloud leaves existing -cloud suffix alone', () => {
  const r = srv.resolveRoute('cloud', 'qwen3:8b-cloud', { localEndpoint: 'http://L', cloudEndpoint: 'http://C', cloudKey: '' });
  assert.equal(r.model, 'qwen3:8b-cloud');
});
test('resolveRoute: keyed cloud strips :cloud and routes to ollama.com', () => {
  const r = srv.resolveRoute('cloud', 'gpt-oss:20b:cloud', { localEndpoint: 'http://L', cloudEndpoint: 'http://C', cloudKey: 'K' });
  assert.equal(r.base, 'http://C');
  assert.equal(r.model, 'gpt-oss:20b');
  assert.equal(r.key, 'K');
  assert.equal(r.viaLocal, false);
});
test('resolveRoute: keyed cloud strips -cloud suffix', () => {
  const r = srv.resolveRoute('cloud', 'gpt-oss:20b-cloud', { localEndpoint: 'http://L', cloudEndpoint: 'http://C', cloudKey: 'K' });
  assert.equal(r.model, 'gpt-oss:20b');
});
test('resolveRoute: keyed cloud leaves bare names untouched', () => {
  const r = srv.resolveRoute('cloud', 'gpt-oss:20b', { localEndpoint: 'http://L', cloudEndpoint: 'http://C', cloudKey: 'K' });
  assert.equal(r.model, 'gpt-oss:20b');
  assert.equal(r.base, 'http://C');
});
test('resolveRoute: local scope ignores cloud key entirely', () => {
  const r = srv.resolveRoute('local', 'qwen:7b', { localEndpoint: 'http://L', cloudEndpoint: 'http://C', cloudKey: 'K' });
  assert.equal(r.base, 'http://L');
  assert.equal(r.model, 'qwen:7b');
  assert.equal(r.key, '');
});
test('resolveRoute: undefined scope falls back to local endpoint', () => {
  const r = srv.resolveRoute(undefined, 'qwen:7b', { localEndpoint: 'http://L', cloudEndpoint: 'http://C', cloudKey: '' });
  assert.equal(r.base, 'http://L');
  assert.equal(r.model, 'qwen:7b');
});
test('thinkFor: Low disables thinking', () => assert.equal(srv.thinkFor('Low'), false));
test('thinkFor: Medium uses model default (true)', () => assert.equal(srv.thinkFor('Medium'), true));
test('thinkFor: High requests max thinking', () => assert.equal(srv.thinkFor('High'), 'high'));
test('thinkFor: missing reasoning defaults to true', () => assert.equal(srv.thinkFor(undefined), true));
test('thinkFor: unknown level defaults to true', () => assert.equal(srv.thinkFor('Turbo'), true));
test('parseToolCalls: accepts canonical ```tool block', () => {
  const calls = srv.parseToolCalls('here\n' + toolBlock('glob', { pattern: '*.js' }) + '\nbye');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'glob');
  assert.equal(calls[0].input.pattern, '*.js');
});
test('parseToolCalls: accepts ```json blocks too', () => {
  const calls = srv.parseToolCalls('```json\n{"name":"grep","input":{"pattern":"x"}}\n```');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'grep');
});
test('parseToolCalls: malformed JSON block is ignored', () => {
  assert.deepEqual(srv.parseToolCalls('```json\n{not valid!!!}\n```'), []);
});
test('parseToolCalls: unknown tool names are ignored', () => {
  assert.deepEqual(srv.parseToolCalls(toolBlock('frobnicate', { x: 1 })), []);
});
test('parseToolCalls: caps at 8 calls per pass', () => {
  const text = Array.from({ length: 12 }, (_, i) => toolBlock('glob', { pattern: `p${i}` })).join('\n');
  assert.equal(srv.parseToolCalls(text).length, 8);
});
test('parseToolCalls: tolerates args at top level alongside input', () => {
  const calls = srv.parseToolCalls('```tool\n{"name":"glob","pattern":"*.md"}\n```');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.pattern, '*.md');
});
test('parseToolCalls: non tool/json fences are ignored', () => {
  assert.deepEqual(srv.parseToolCalls('```text\n{"name":"glob","input":{}}\n```'), []);
});
test('policyFor: read-only tool defaults to allow', () => {
  assert.equal(srv.policyFor({ name: 'glob', readOnly: true }, { toolPolicy: {} }, {}), 'allow');
});
test('policyFor: write tool defaults to ask', () => {
  assert.equal(srv.policyFor({ name: 'file_write', readOnly: false }, { toolPolicy: {} }, {}), 'ask');
});
test('policyFor: saved deny is honored', () => {
  assert.equal(srv.policyFor({ name: 'glob', readOnly: true }, { toolPolicy: { glob: 'deny' } }, {}), 'deny');
});
test('policyFor: General subagent is gated to ask even though Agent is read-only', () => {
  assert.equal(srv.policyFor({ name: 'Agent', readOnly: true }, { toolPolicy: {} }, { agent: 'General' }), 'ask');
});
test('toolsPrompt: build lists writers, chat is read-only', () => {
  assert.match(srv.toolsPrompt('build'), /file_write/);
  assert.match(srv.toolsPrompt('chat'), /glob/);
  assert.doesNotMatch(srv.toolsPrompt('chat'), /file_write/);
});
test('globToRegExp: star matches within one level only', () => {
  const rx = srv.globToRegExp('*.json');
  assert.match('a.json', rx);
  assert.doesNotMatch('sub/a.json', rx);
});
test('globToRegExp: doublestar spans directories (FIXED, was BUG-2)', () => {
  // Intended glob semantics: **/*.js matches at any depth, including top level.
  const rx = srv.globToRegExp('**/*.js');
  assert.match('a.js', rx);
  assert.match('sub/a.js', rx);
  assert.match('sub/deep/a.js', rx);
});

// ============================================================
// B. mock helper self-tests
// ============================================================
test('mock: serves scripted tags and records the request', async () => {
  scriptGen([]);
  mock.script.tags = { status: 200, body: { models: [{ name: 'a' }, { name: 'b' }] } };
  const r = await fetch(`${mock.url}/api/tags`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.models.length, 2);
  const last = mock.requests[mock.requests.length - 1];
  assert.equal(last.method, 'GET');
  assert.equal(last.path, '/api/tags');
});
test('mock: show handler can branch per model', async () => {
  scriptGen([]);
  mock.script.show = (b) => (b.model === 'thinker' ? showCaps(['thinking']) : showCaps([]));
  const r1 = await postJSON(mock.url, '/api/show', { model: 'thinker' });
  const r2 = await postJSON(mock.url, '/api/show', { model: 'plain' });
  assert.deepEqual(r1.json.details.capabilities, ['thinking']);
  assert.deepEqual(r2.json.details.capabilities, []);
});
test('mock: generate stream:false entry returns JSON response', async () => {
  scriptGen([PLAIN('hello-json')]);
  const r = await postJSON(mock.url, '/api/generate', { model: 'x', stream: false });
  assert.equal(r.json.response, 'hello-json');
});
test('mock: generate ndjson entry streams one line per chunk', async () => {
  scriptGen([{ ndjson: [{ response: 'a' }, { response: 'b' }, { done: true }] }]);
  const r = await fetch(`${mock.url}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const lines = (await r.text()).trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[0]).response, 'a');
  assert.equal(JSON.parse(lines[2]).done, true);
});
test('mock: error entry passes status and body through', async () => {
  scriptGen([{ status: 429, text: 'slow down' }]);
  const r = await fetch(`${mock.url}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 429);
  assert.equal(await r.text(), 'slow down');
});
test('mock: generate queue is FIFO and exhaustion is loud', async () => {
  scriptGen([PLAIN('first'), PLAIN('second')]);
  const r1 = await postJSON(mock.url, '/api/generate', {});
  const r2 = await postJSON(mock.url, '/api/generate', {});
  const r3 = await postJSON(mock.url, '/api/generate', {});
  assert.equal(r1.json.response, 'first');
  assert.equal(r2.json.response, 'second');
  assert.equal(r3.status, 500);
  assert.match(r3.json.error, /queue exhausted/);
});

// ============================================================
// C. discovery: models / health / show
// ============================================================
test('discovery: models ok returns scripted list with scope', async () => {
  scriptGen([]);
  mock.script.tags = { status: 200, body: { models: [{ name: 't1' }, { name: 't2' }] } };
  const r = await postJSON(BASE, '/api/ollama/models', { scope: 'local', endpoint: mock.url });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.scope, 'local');
  assert.equal(r.json.models.length, 2);
});
test('discovery: models enrichLocal merges show details into tags', async () => {
  scriptGen([]);
  mock.script.tags = { status: 200, body: { models: [{ name: 'rich' }] } };
  mock.script.show = () => ({ status: 200, body: { details: { parameter_size: '7B', quantization_level: 'Q4', family: 'test', capabilities: ['thinking'] } } });
  const r = await postJSON(BASE, '/api/ollama/models', { scope: 'local', endpoint: mock.url });
  assert.equal(r.json.models[0].details.parameter_size, '7B');
  assert.ok(r.json.models[0].details.capabilities.includes('thinking'));
});
test('discovery: empty model list is ok:true with []', async () => {
  scriptGen([]);
  mock.script.tags = { status: 200, body: { models: [] } };
  const r = await postJSON(BASE, '/api/ollama/models', { scope: 'local', endpoint: mock.url });
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.models, []);
});
test('discovery: tags 500 surfaces as backend 500 ok:false', async () => {
  scriptGen([]);
  mock.script.tags = { status: 500, text: 'mock boom' };
  const r = await postJSON(BASE, '/api/ollama/models', { scope: 'local', endpoint: mock.url });
  assert.equal(r.status, 500);
  assert.equal(r.json.ok, false);
});
test('discovery: unreachable endpoint surfaces as 502', async () => {
  scriptGen([]);
  const r = await postJSON(BASE, '/api/ollama/models', { scope: 'local', endpoint: DEAD_PORT_URL });
  assert.equal(r.status, 502);
  assert.equal(r.json.ok, false);
});
test('discovery: health ok reports endpoint and count', async () => {
  scriptGen([]);
  mock.script.tags = { status: 200, body: { models: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } };
  const r = await postJSON(BASE, '/api/ollama/health', { endpoint: mock.url });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.count, 3);
  assert.equal(r.json.endpoint, mock.url);
});
test('discovery: health against dead port is ok:false', async () => {
  const r = await postJSON(BASE, '/api/ollama/health', { endpoint: DEAD_PORT_URL });
  assert.equal(r.json.ok, false);
});
test('discovery: show proxies thinking capability', async () => {
  scriptGen([]);
  mock.script.show = () => showCaps(['completion', 'thinking']);
  const r = await postJSON(BASE, '/api/ollama/show', { name: 'thinker', scope: 'local' });
  assert.ok(r.json.details.capabilities.includes('thinking'));
});
test('discovery: show proxies non-thinking capability', async () => {
  scriptGen([]);
  mock.script.show = () => showCaps(['completion']);
  const r = await postJSON(BASE, '/api/ollama/show', { name: 'plain', scope: 'local' });
  assert.ok(!r.json.details.capabilities.includes('thinking'));
});
test('discovery: show with missing capabilities passes through honestly', async () => {
  scriptGen([]);
  mock.script.show = () => ({ status: 200, body: { details: {} } });
  const r = await postJSON(BASE, '/api/ollama/show', { name: 'odd', scope: 'local' });
  assert.equal((r.json.details || {}).capabilities, undefined);
});

// ============================================================
// D. generate proxy (SSE passthrough + kind classification)
// ============================================================
test('generate proxy: success streams tokens then done with eval_count', async () => {
  scriptGen([{ ndjson: [{ response: 'hel' }, { response: 'lo' }, { done: true, eval_count: 9 }] }]);
  const { events } = await sseRun(BASE, '/api/ollama/generate', { model: uniq('m'), prompt: 'hi', scope: 'local' });
  assert.equal(ptokensOf(events), 'hello');
  const done = events.find((e) => e.done);
  assert.ok(done);
  assert.equal(done.eval_count, 9);
});
test('generate proxy: malformed NDJSON lines are skipped, valid tokens survive', async () => {
  scriptGen([{ ndjson: [{ response: 'a' }, 'THIS IS NOT JSON{{{', { response: 'b' }, { done: true }] }]);
  const { events } = await sseRun(BASE, '/api/ollama/generate', { model: uniq('m'), prompt: 'hi', scope: 'local' });
  assert.equal(ptokensOf(events), 'ab');
  assert.ok(events.some((e) => e.done));
});
test('generate proxy: 401 classifies as auth', async () => {
  scriptGen([{ status: 401, text: 'unauthorized' }]);
  const { events } = await sseRun(BASE, '/api/ollama/generate', { model: uniq('m'), prompt: 'hi', scope: 'local' }, { stopWhen: (ev) => !!ev.error });
  const err = events.find((e) => e.error);
  assert.ok(err);
  assert.equal(err.kind, 'auth');
});
test('generate proxy: 402 classifies as limit', async () => {
  scriptGen([{ status: 402, text: 'payment required' }]);
  const { events } = await sseRun(BASE, '/api/ollama/generate', { model: uniq('m'), prompt: 'hi', scope: 'local' }, { stopWhen: (ev) => !!ev.error });
  assert.equal(events.find((e) => e.error).kind, 'limit');
});
test('generate proxy: 429 classifies as limit', async () => {
  scriptGen([{ status: 429, text: 'too many requests' }]);
  const { events } = await sseRun(BASE, '/api/ollama/generate', { model: uniq('m'), prompt: 'hi', scope: 'local' }, { stopWhen: (ev) => !!ev.error });
  assert.equal(events.find((e) => e.error).kind, 'limit');
});
test('generate proxy: quota text on 500 classifies as limit', async () => {
  scriptGen([{ status: 500, text: 'quota exceeded, upgrade your plan' }]);
  const { events } = await sseRun(BASE, '/api/ollama/generate', { model: uniq('m'), prompt: 'hi', scope: 'local' }, { stopWhen: (ev) => !!ev.error });
  assert.equal(events.find((e) => e.error).kind, 'limit');
});
test('generate proxy: plain 500 is an error event', async () => {
  scriptGen([{ status: 500, text: 'internal error' }]);
  const { events } = await sseRun(BASE, '/api/ollama/generate', { model: uniq('m'), prompt: 'hi', scope: 'local' }, { stopWhen: (ev) => !!ev.error });
  const err = events.find((e) => e.error);
  assert.ok(err);
  assert.equal(err.kind, 'error');
});

// ============================================================
// E. agent-run HTTP error classification (seeded model + scripted generate)
// ============================================================
test('agent/run: 401 from Ollama emits an auth event', async () => {
  scriptGen([{ status: 401, text: 'unauthorized' }]);
  const { events } = await runAgent( agentBody());
  assert.ok(events.some((e) => e.type === 'auth'), 'expected auth event, got ' + JSON.stringify(events));
});
test('agent/run: keyless cloud 402 emits limit with free tier tag', async () => {
  scriptGen([{ status: 402, text: 'no credits left' }]);
  const { events } = await runAgent( agentBody({ scope: 'cloud' }));
  const lim = events.find((e) => e.type === 'limit');
  assert.ok(lim);
  assert.equal(lim.tier, 'free');
  const gen = summaries()[0];
  assert.ok(gen.body.model.endsWith(':cloud'), 'keyless cloud must use :cloud suffix, got ' + gen.body.model);
});
test('agent/run: 429 emits a limit event', async () => {
  scriptGen([{ status: 429, text: 'too many requests' }]);
  const { events } = await runAgent( agentBody());
  assert.ok(events.some((e) => e.type === 'limit'));
});
test('agent/run: quota text on 500 emits a limit event', async () => {
  scriptGen([{ status: 500, text: 'quota exceeded for this billing period' }]);
  const { events } = await runAgent( agentBody());
  assert.ok(events.some((e) => e.type === 'limit'));
});
test('agent/run: plain 500 falls back to an honest unavailable token, never hangs', async () => {
  scriptGen([{ status: 500, text: 'internal error' }]);
  const { events } = await runAgent( agentBody());
  assert.ok(!events.some((e) => e.type === 'auth' || e.type === 'limit'));
  assert.match(tokensOf(events), /unavailable/);
  assert.ok(events.some((e) => e.type === 'done'));
});
test('agent/run: missing model is a 400', async () => {
  const r = await postJSON(BASE, '/api/agent/run', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.status, 400);
});

// ============================================================
// F. think flag follows /api/show capabilities only
// ============================================================
test('think: sent only when show advertises thinking', async () => {
  const m = uniq('thinker');
  scriptGen([SUMMARY(['t-ok'])]);
  mock.script.show = (b) => (b.model === m ? showCaps(['completion', 'thinking']) : showCaps([]));
  const { events } = await runAgent( agentBody({ model: m }));
  assert.ok(events.some((e) => e.type === 'done'));
  assert.equal(summaries()[0].body.think, true);
});
test('think: omitted for models without thinking capability', async () => {
  const m = uniq('plain');
  scriptGen([SUMMARY(['t-ok'])]);
  mock.script.show = (b) => (b.model === m ? showCaps(['completion', 'tools']) : showCaps([]));
  await runAgent( agentBody({ model: m }));
  assert.ok(!('think' in summaries()[0].body));
});
test('think: omitted when capabilities are missing entirely', async () => {
  const m = uniq('odd');
  scriptGen([SUMMARY(['t-ok'])]);
  mock.script.show = () => ({ status: 200, body: { details: {} } });
  await runAgent( agentBody({ model: m }));
  assert.ok(!('think' in summaries()[0].body));
});
test('think: High reasoning forwards think=high to capable models', async () => {
  const m = uniq('thinker');
  scriptGen([SUMMARY(['t-ok'])]);
  mock.script.show = (b) => (b.model === m ? showCaps(['thinking']) : showCaps([]));
  await runAgent( agentBody({ model: m, reasoning: 'High' }));
  assert.equal(summaries()[0].body.think, 'high');
});
test('think: Low reasoning forwards think=false to capable models', async () => {
  const m = uniq('thinker');
  scriptGen([SUMMARY(['t-ok'])]);
  mock.script.show = (b) => (b.model === m ? showCaps(['thinking']) : showCaps([]));
  await runAgent( agentBody({ model: m, reasoning: 'Low' }));
  assert.equal(summaries()[0].body.think, false);
});

// ============================================================
// G. cloud routing through the live backend
// ============================================================
test('route: keyless cloud run appends :cloud on every Ollama call', async () => {
  const m = uniq('freemodel');
  scriptGen([SUMMARY(['free-hi'])]);
  const { events } = await runAgent( agentBody({ model: m, scope: 'cloud' }));
  assert.equal(tokensOf(events), 'free-hi');
  for (const r of [...mock.shows(), ...gens()]) assert.ok(String(r.body.model || r.body.name).endsWith(':cloud'));
});
test('route: keyed cloud run strips :cloud and still reaches the endpoint', async () => {
  const m = uniq('keyed');
  scriptGen([SUMMARY(['keyed-hi'])]);
  await setConfig({ cloudEndpoint: mock.url, cloudKey: 'sk-test-x' });
  try {
    const { events } = await runAgent( agentBody({ model: `${m}:cloud`, scope: 'cloud' }));
    assert.equal(tokensOf(events), 'keyed-hi');
    assert.equal(summaries()[0].body.model, m);
  } finally {
    await setConfig({ cloudEndpoint: ORIG_CLOUD, cloudKey: '' });
  }
});

// ============================================================
// H. agent tool loop end-to-end (scripted decisions vs mock)
// ============================================================
test('loop: single glob call then answer', async () => {
  scriptGen([
    PLAIN('Let me look.\n' + toolBlock('glob', { pattern: '*.json' })),
    PLAIN('nothing more, answering now'),
    SUMMARY(['tok-single']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'please glob the docs' }] }));
  const toolEvs = events.filter((e) => e.type === 'tool' && e.tool === 'glob');
  assert.ok(toolEvs.some((e) => e.status === 'running'));
  const done = toolEvs.find((e) => e.status === 'complete');
  assert.ok(done);
  assert.match(done.output, /app\.json/);
  assert.equal(tokensOf(events), 'tok-single');
  assert.ok(events.some((e) => e.type === 'done'));
});
test('loop: two independent calls batch in one round', async () => {
  scriptGen([
    PLAIN('Batching.\n' + toolBlock('glob', { pattern: '*.json' }) + '\n' + toolBlock('grep', { pattern: 'needle' })),
    PLAIN('answering'),
    SUMMARY(['tok-batch']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'glob things and grep stuff' }] }));
  assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'glob' && e.status === 'complete'));
  const grep = events.find((e) => e.type === 'tool' && e.tool === 'grep' && e.status === 'complete');
  assert.ok(grep);
  assert.match(grep.output, /needle/);
  assert.equal(tokensOf(events), 'tok-batch');
});
test('loop: chained rounds feed results forward (2 decision passes)', async () => {
  scriptGen([
    PLAIN('Round one.\n' + toolBlock('glob', { pattern: '*.json' })),
    PLAIN('Round two.\n' + toolBlock('file_read', { path: 'app.json' })),
    PLAIN('answering now'),
    SUMMARY(['tok-chain']),
  ]);
  const body = agentBody({ repo: REPO, messages: [{ role: 'user', content: 'please list files then read app' }] });
  const { events } = await runAgent( body);
  assert.equal(decisions().length, 3);
  assert.ok(String(decisions()[2].body.prompt).includes('TOOL glob'));
  const fr = events.find((e) => e.type === 'tool' && e.tool === 'file_read' && e.status === 'complete');
  assert.ok(fr);
  assert.match(fr.output, /1\.2\.3/);
  assert.equal(tokensOf(events), 'tok-chain');
});
test('loop: tool failure surfaces as error and the model recovers', async () => {
  scriptGen([
    PLAIN('Try read.\n' + toolBlock('file_read', { path: 'nope-missing.txt' })),
    PLAIN('recovering with a plain answer'),
    SUMMARY(['tok-recover']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'file info for nope-missing.txt' }] }));
  const err = events.find((e) => e.type === 'tool' && e.status === 'error');
  assert.ok(err);
  assert.match(err.output, /cannot read file/);
  assert.equal(tokensOf(events), 'tok-recover');
  assert.ok(events.some((e) => e.type === 'done'));
});
test('loop: deny policy blocks the tool and the model continues', async () => {
  scriptGen([
    PLAIN('Try glob.\n' + toolBlock('glob', { pattern: '*.json' })),
    PLAIN('continuing without tools'),
    SUMMARY(['tok-deny']),
  ]);
  await setConfig({ toolPolicy: { glob: 'deny' } });
  try {
    const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'please glob the docs' }] }));
    assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'glob' && e.status === 'denied'));
    assert.equal(tokensOf(events), 'tok-deny');
    assert.ok(String(decisions()[1].body.prompt).includes('denied by policy'));
  } finally {
    await setConfig({ toolPolicy: {} });
  }
});
test('loop: ask policy pauses for approval, allow executes the tool', async () => {
  scriptGen([
    PLAIN('Need read.\n' + toolBlock('file_read', { path: 'app.json' })),
    PLAIN('got it, answering'),
    SUMMARY(['tok-ask-allow']),
  ]);
  await setConfig({ toolPolicy: { file_read: 'ask' } });
  try {
    const { events } = await runAgent(
      agentBody({ repo: REPO, messages: [{ role: 'user', content: 'file info for app.json' }] }),
      { onEvent: async (ev) => { if (ev.type === 'tool_approval') await postJSON(BASE, '/api/agent/approve', { id: ev.id, allow: true }); } });
    assert.ok(events.some((e) => e.type === 'tool_approval' && e.tool === 'file_read'));
    const done = events.find((e) => e.type === 'tool' && e.tool === 'file_read' && e.status === 'complete');
    assert.ok(done);
    assert.match(done.output, /1\.2\.3/);
    assert.equal(tokensOf(events), 'tok-ask-allow');
  } finally {
    await setConfig({ toolPolicy: {} });
  }
});
test('loop: ask policy deny tells the model it was denied', async () => {
  scriptGen([
    PLAIN('Need read.\n' + toolBlock('file_read', { path: 'app.json' })),
    PLAIN('understood, answering anyway'),
    SUMMARY(['tok-ask-deny']),
  ]);
  await setConfig({ toolPolicy: { file_read: 'ask' } });
  try {
    const { events } = await runAgent(
      agentBody({ repo: REPO, messages: [{ role: 'user', content: 'file info for app.json' }] }),
      { onEvent: async (ev) => { if (ev.type === 'tool_approval') await postJSON(BASE, '/api/agent/approve', { id: ev.id, allow: false }); } });
    assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'file_read' && e.status === 'denied'));
    assert.ok(String(decisions()[1].body.prompt).includes('user denied'));
    assert.equal(tokensOf(events), 'tok-ask-deny');
  } finally {
    await setConfig({ toolPolicy: {} });
  }
});
test('loop: malformed ```json decision is ignored, plain answer streams', async () => {
  scriptGen([PLAIN('```json\n{not valid json!!!}\n```'), SUMMARY(['tok-malformed'])]);
  const { events } = await runAgent( agentBody({ messages: [{ role: 'user', content: 'kindly show the overview' }] }));
  assert.ok(!events.some((e) => e.type === 'tool'));
  assert.equal(tokensOf(events), 'tok-malformed');
  assert.ok(events.some((e) => e.type === 'done'));
});
test('loop: unknown tool name is ignored, plain answer streams', async () => {
  scriptGen([PLAIN(toolBlock('frobnicate', { x: 1 })), SUMMARY(['tok-unknown'])]);
  const { events } = await runAgent( agentBody({ messages: [{ role: 'user', content: 'kindly show the overview' }] }));
  assert.ok(!events.some((e) => e.type === 'tool'));
  assert.equal(tokensOf(events), 'tok-unknown');
});
test('loop: empty decision falls back to a plain streamed answer', async () => {
  scriptGen([PLAIN('Just answering in prose, no tools needed.'), SUMMARY(['tok-empty'])]);
  const { events } = await runAgent( agentBody({ messages: [{ role: 'user', content: 'kindly show the overview' }] }));
  assert.ok(!events.some((e) => e.type === 'tool'));
  assert.equal(tokensOf(events), 'tok-empty');
  assert.ok(events.some((e) => e.type === 'done'));
});
test('loop: always-call script terminates after exactly 4 decision passes', async () => {
  scriptGen([
    PLAIN('r1\n' + toolBlock('glob', { pattern: '*.txt' })),
    PLAIN('r2\n' + toolBlock('glob', { pattern: '*.txt' })),
    PLAIN('r3\n' + toolBlock('glob', { pattern: '*.txt' })),
    PLAIN('r4\n' + toolBlock('glob', { pattern: '*.txt' })),
    SUMMARY(['tok-max']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'please list every file around' }] }));
  assert.equal(decisions().length, 4);
  assert.equal(summaries().length, 1);
  assert.equal(tokensOf(events), 'tok-max');
});
test('loop: ask_user answers approved by the user flow into the transcript', async () => {
  scriptGen([
    PLAIN('Ask first.\n' + toolBlock('ask_user', { questions: [{ question: 'Pick one', options: [{ label: 'opt-a', description: 'first' }] }] })),
    PLAIN('thanks, answering'),
    SUMMARY(['tok-askuser']),
  ]);
  const { events } = await runAgent(
    agentBody({ repo: REPO, messages: [{ role: 'user', content: 'help me decide on a plan please' }] }),
    { onEvent: async (ev) => { if (ev.type === 'ask_user') await postJSON(BASE, '/api/agent/approve', { id: ev.id, allow: true, answers: ['opt-a'] }); } });
  const done = events.find((e) => e.type === 'tool' && e.tool === 'ask_user' && e.status === 'complete');
  assert.ok(done);
  assert.match(done.output, /opt-a/);
  assert.ok(String(summaries()[0].body.prompt).includes('opt-a'));
  assert.equal(tokensOf(events), 'tok-askuser');
});
test('loop: ask_user declined by the user is reported to the model', async () => {
  scriptGen([
    PLAIN('Ask first.\n' + toolBlock('ask_user', { questions: [{ question: 'Pick one', options: [{ label: 'opt-a' }] }] })),
    PLAIN('ok, answering anyway'),
    SUMMARY(['tok-decline']),
  ]);
  const { events } = await runAgent(
    agentBody({ repo: REPO, messages: [{ role: 'user', content: 'help me decide on a plan please' }] }),
    { onEvent: async (ev) => { if (ev.type === 'ask_user') await postJSON(BASE, '/api/agent/approve', { id: ev.id, allow: false }); } });
  assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'ask_user' && e.status === 'error'));
  assert.ok(String(decisions()[1].body.prompt).includes('user declined to answer'));
  assert.equal(tokensOf(events), 'tok-decline');
});
test('loop: Agent Explore subagent succeeds and reports back', async () => {
  scriptGen([
    PLAIN('Delegate.\n' + toolBlock('Agent', { agent: 'Explore', task: 'survey repo' })),
    PLAIN('Sub recon.\n' + toolBlock('glob', { pattern: '*.json' })),
    PLAIN('sub recon done'),
    PLAIN('final: found app.json here'),
    PLAIN('parent answering'),
    SUMMARY(['tok-explore']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'please survey this directory and list findings' }] }));
  const outer = events.filter((e) => e.type === 'tool' && e.tool === 'Agent');
  assert.ok(outer.some((e) => e.status === 'running'));
  const done = outer.find((e) => e.status === 'complete');
  assert.ok(done);
  assert.match(done.output, /found app\.json/);
  const subDecisions = decisions().filter((r) => String(r.body.system || '').includes('Explore subagent'));
  assert.equal(subDecisions.length, 3);
  assert.ok(String(decisions()[decisions().length - 1].body.prompt).includes('found app.json'));
  assert.equal(tokensOf(events), 'tok-explore');
});
test('loop: nested Agent emitted by a subagent is blocked, parent still completes', async () => {
  scriptGen([
    PLAIN('Delegate.\n' + toolBlock('Agent', { agent: 'Explore', task: 'go deep' })),
    PLAIN('Sneaky.\n' + toolBlock('Agent', { agent: 'Explore', task: 'inner' })),
    PLAIN('inner blocked prose'),
    PLAIN('parent answering'),
    SUMMARY(['tok-nested']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'please survey this directory and list findings' }] }));
  const agentRuns = events.filter((e) => e.type === 'tool' && e.tool === 'Agent' && e.status === 'running');
  assert.equal(agentRuns.length, 1);
  const done = events.find((e) => e.type === 'tool' && e.tool === 'Agent' && e.status === 'complete');
  assert.ok(done);
  assert.ok(String(decisions()[decisions().length - 1].body.prompt).includes('inner blocked prose'));
  assert.equal(tokensOf(events), 'tok-nested');
  assert.ok(events.some((e) => e.type === 'done'));
});
test('loop: parallel Agent team merges both subagent outputs', async () => {
  scriptGen([
    PLAIN('Team.\n' + toolBlock('Agent', { parallel: [{ agent: 'Explore', task: 'alpha survey' }, { agent: 'Plan', task: 'beta plan' }] })),
    PLAIN('alpha prose one'),
    PLAIN('alpha prose two'),
    PLAIN('beta prose one'),
    PLAIN('beta prose two'),
    PLAIN('parent answering'),
    SUMMARY(['tok-team']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'please survey this directory and list findings' }] }));
  const done = events.find((e) => e.type === 'tool' && e.tool === 'Agent' && e.status === 'complete');
  assert.ok(done);
  assert.match(done.output, /alpha survey/);
  assert.match(done.output, /beta plan/);
  assert.equal(tokensOf(events), 'tok-team');
});
test('loop: TaskCreate List Update Output chain shares one task store', async () => {
  scriptGen([
    PLAIN('Tasks.\n'
      + toolBlock('TaskCreate', { subject: 'Write tests' }) + '\n'
      + toolBlock('TaskList', {}) + '\n'
      + toolBlock('TaskUpdate', { id: 't1', status: 'doing', note: 'started' }) + '\n'
      + toolBlock('TaskOutput', { id: 't1' })),
    PLAIN('answering'),
    SUMMARY(['tok-tasks']),
  ]);
  const { events } = await runAgent( agentBody({ messages: [{ role: 'user', content: 'please plan and track the work' }] }));
  const outs = events.filter((e) => e.type === 'tool' && e.status === 'complete').map((e) => String(e.output));
  assert.ok(outs.some((o) => o.includes('created t1: Write tests')));
  assert.ok(outs.some((o) => o.includes('t1 [open] Write tests') || o.includes('t1 [doing]')));
  assert.ok(outs.some((o) => o.includes('t1 → doing')));
  const show = outs.find((o) => o.includes('Write tests') && o.includes('started'));
  assert.ok(show, 'TaskOutput must show subject plus notes: ' + JSON.stringify(outs));
  assert.equal(tokensOf(events), 'tok-tasks');
});
test('loop: TaskOutput for unknown id fails honestly', async () => {
  scriptGen([
    PLAIN('Bad task.\n' + toolBlock('TaskOutput', { id: 't99' })),
    PLAIN('answering'),
    SUMMARY(['tok-badtask']),
  ]);
  const { events } = await runAgent( agentBody({ messages: [{ role: 'user', content: 'please show task t99 now' }] }));
  const err = events.find((e) => e.type === 'tool' && e.status === 'error');
  assert.ok(err);
  assert.match(err.output, /no such task/);
  assert.equal(tokensOf(events), 'tok-badtask');
});
test('loop: todo_write records the plan', async () => {
  scriptGen([
    PLAIN('Plan.\n' + toolBlock('todo_write', { todos: [{ content: 'a', status: 'pending' }, { content: 'b', status: 'done' }] })),
    PLAIN('answering'),
    SUMMARY(['tok-todo']),
  ]);
  const { events } = await runAgent( agentBody({ messages: [{ role: 'user', content: 'please plan and track the work' }] }));
  const done = events.find((e) => e.type === 'tool' && e.tool === 'todo_write' && e.status === 'complete');
  assert.ok(done);
  assert.match(done.output, /plan recorded \(2 items\)/);
  assert.equal(tokensOf(events), 'tok-todo');
});
test('loop: aborting SSE mid-run ends the client stream, server stays healthy', async () => {
  scriptGen([
    PLAIN('Look.\n' + toolBlock('glob', { pattern: '*.json' })),
    // aborted run still finishes server-side (delayed, then drained by runAgent)
    { delayMs: 4000, json: { response: 'late, no tools here' } },
    SUMMARY(['tok-cancel-never-seen']),
  ]);
  let sawTool = false;
  const { events } = await runAgent(
    agentBody({ repo: REPO, messages: [{ role: 'user', content: 'please glob the docs' }] }),
    {
      onEvent: async (ev, ctrl) => {
        if (ev.type === 'tool' && ev.status === 'complete') { sawTool = true; ctrl.abort(); }
      },
    });
  assert.ok(sawTool);
  assert.ok(events.some((e) => e.type === '_client'));
  const h = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(h.ok, true);
});
test('loop: three concurrent runs stay isolated with distinct answers', async () => {
  scriptGen([SUMMARY(['tok-A']), SUMMARY(['tok-B']), SUMMARY(['tok-C'])]);
  const bodies = ['alpha zulu one', 'bravo zulu two', 'charlie zulu three'].map((content) =>
    agentBody({ messages: [{ role: 'user', content }] }));
  const results = await Promise.all(bodies.map((b) => sseRun(BASE, '/api/agent/run', b)));
  const answers = results.map((r) => tokensOf(r.events)).sort();
  assert.deepEqual(answers, ['tok-A', 'tok-B', 'tok-C']);
  for (const r of results) assert.equal(r.events.filter((e) => e.type === 'done').length, 1);
});
test('loop: large tool output is truncated on the tool event', async () => {
  scriptGen([
    PLAIN('Read big.\n' + toolBlock('file_read', { path: 'big.txt' })),
    PLAIN('answering'),
    SUMMARY(['tok-big']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'file info for big.txt' }] }));
  const done = events.find((e) => e.type === 'tool' && e.tool === 'file_read' && e.status === 'complete');
  assert.ok(done);
  assert.ok(done.output.length > 1000);
  assert.ok(done.output.length <= 4000, `expected cap 4000, got ${done.output.length}`);
  assert.equal(tokensOf(events), 'tok-big');
});
test('loop: 30-message history is capped to 20 turns in the outbound decision', async () => {
  scriptGen([PLAIN('fine, answering'), SUMMARY(['tok-hist'])]);
  const messages = [];
  for (let i = 0; i < 29; i++) messages.push({ role: i % 2 ? 'assistant' : 'user', content: `filler ${i}` });
  messages.push({ role: 'user', content: 'please list xyz history' });
  const { events } = await runAgent( agentBody({ messages }));
  assert.equal(decisions().length, 1);
  assert.ok(turns(decisions()[0].body.prompt) <= 20, `expected <=20 turns, got ${turns(decisions()[0].body.prompt)}`);
  assert.equal(tokensOf(events), 'tok-hist');
});
test('loop: model switching runs two models back to back', async () => {
  const mA = uniq('A');
  const mB = uniq('B');
  scriptGen([SUMMARY(['tok-switch-A']), SUMMARY(['tok-switch-B'])]);
  const rA = await runAgent( agentBody({ model: mA }));
  const rB = await runAgent( agentBody({ model: mB }));
  assert.equal(tokensOf(rA.events), 'tok-switch-A');
  assert.equal(tokensOf(rB.events), 'tok-switch-B');
  const models = summaries().map((r) => r.body.model).sort();
  assert.deepEqual(models, [mA, mB].sort());
});
test('loop: local run is unaffected when the cloud endpoint is dead', async () => {
  scriptGen([SUMMARY(['tok-local-ok'])]);
  await setConfig({ cloudEndpoint: DEAD_PORT_URL });
  try {
    const { events } = await runAgent( agentBody({ scope: 'local' }));
    assert.equal(tokensOf(events), 'tok-local-ok');
    assert.ok(events.some((e) => e.type === 'done'));
  } finally {
    await setConfig({ cloudEndpoint: ORIG_CLOUD });
  }
});
test('loop: casual hi has no deciding phase and still streams', async () => {
  scriptGen([SUMMARY(['Hello there'])]);
  const { events } = await runAgent( agentBody());
  assert.ok(!events.some((e) => e.type === 'status' && e.phase === 'deciding'));
  assert.ok(events.some((e) => e.type === 'status' && e.phase === 'thinking'));
  assert.equal(tokensOf(events), 'Hello there');
  assert.ok(events.some((e) => e.type === 'done'));
});
test('loop: multi-intent read+grep runs BOTH tools', async () => {
  scriptGen([
    PLAIN('Both.\n' + toolBlock('file_read', { path: 'app.json' }) + '\n' + toolBlock('grep', { pattern: 'needle' })),
    PLAIN('answering'),
    SUMMARY(['tok-multi']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'read app.json and grep for needle' }] }));
  const fr = events.find((e) => e.type === 'tool' && e.tool === 'file_read' && e.status === 'complete');
  const gr = events.find((e) => e.type === 'tool' && e.tool === 'grep' && e.status === 'complete');
  assert.ok(fr);
  assert.match(fr.output, /1\.2\.3/);
  assert.ok(gr);
  assert.match(gr.output, /needle/);
  assert.equal(tokensOf(events), 'tok-multi');
});
test('loop: file_read returns real repo content', async () => {
  scriptGen([
    PLAIN('Reading.\n' + toolBlock('file_read', { path: 'app.json' })),
    PLAIN('answering'),
    SUMMARY(['tok-fr']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'file info for app.json' }] }));
  const done = events.find((e) => e.type === 'tool' && e.tool === 'file_read' && e.status === 'complete');
  assert.ok(done);
  assert.match(done.output, /"version":\s*"1\.2\.3"/);
});
test('loop: glob returns real directory filenames', async () => {
  scriptGen([
    PLAIN('Globbing.\n' + toolBlock('glob', { pattern: '*.json' })),
    PLAIN('answering'),
    SUMMARY(['tok-glob']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'glob files here please' }] }));
  const done = events.find((e) => e.type === 'tool' && e.tool === 'glob' && e.status === 'complete');
  assert.ok(done);
  assert.match(done.output, /app\.json/);
});
test('loop: git_status and git_log run against a real git repo', async () => {
  scriptGen([
    PLAIN('Git.\n' + toolBlock('git_status', {}) + '\n' + toolBlock('git_log', { n: 3 })),
    PLAIN('answering'),
    SUMMARY(['tok-git']),
  ]);
  const { events } = await runAgent( agentBody({ repo: GITREPO, messages: [{ role: 'user', content: 'show git status and recent commits' }] }));
  const st = events.find((e) => e.type === 'tool' && e.tool === 'git_status' && e.status === 'complete');
  assert.ok(st);
  assert.match(st.output, /##/);
  const log = events.find((e) => e.type === 'tool' && e.tool === 'git_log' && e.status === 'complete');
  assert.ok(log);
  assert.match(log.output, /first commit/);
  assert.equal(tokensOf(events), 'tok-git');
});
test('loop: build-mode bash_exec runs and returns output', async () => {
  scriptGen([
    PLAIN('Run.\n' + toolBlock('bash_exec', { command: 'echo hello-yk' })),
    PLAIN('answering'),
    SUMMARY(['tok-bash']),
  ]);
  await setConfig({ toolPolicy: { bash_exec: 'allow' } });
  try {
    const { events } = await runAgent( agentBody({ repo: REPO, mode: 'build', messages: [{ role: 'user', content: 'run the check command now' }] }));
    const done = events.find((e) => e.type === 'tool' && e.tool === 'bash_exec' && e.status === 'complete');
    assert.ok(done);
    assert.match(done.output, /hello-yk/);
    assert.equal(tokensOf(events), 'tok-bash');
  } finally {
    await setConfig({ toolPolicy: {} });
  }
});
test('loop: build-mode file_write lands on disk', async () => {
  scriptGen([
    PLAIN('Write.\n' + toolBlock('file_write', { path: 'hello.txt', content: 'written-by-test' })),
    PLAIN('answering'),
    SUMMARY(['tok-write']),
  ]);
  await setConfig({ toolPolicy: { file_write: 'allow' } });
  try {
    const { events } = await runAgent( agentBody({ repo: REPO, mode: 'build', messages: [{ role: 'user', content: 'create the hello file now' }] }));
    assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'file_write' && e.status === 'complete'));
    assert.equal(fs.readFileSync(path.join(REPO, 'hello.txt'), 'utf8'), 'written-by-test');
    assert.equal(tokensOf(events), 'tok-write');
  } finally {
    await setConfig({ toolPolicy: {} });
  }
});
test('loop: build-mode file_edit applies the exact replacement', async () => {
  scriptGen([
    PLAIN('Edit.\n' + toolBlock('file_edit', { path: 'edit-me.txt', old_string: 'beta', new_string: 'BETA' })),
    PLAIN('answering'),
    SUMMARY(['tok-edit']),
  ]);
  await setConfig({ toolPolicy: { file_edit: 'allow' } });
  try {
    const { events } = await runAgent( agentBody({ repo: REPO, mode: 'build', messages: [{ role: 'user', content: 'please change the word beta' }] }));
    assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'file_edit' && e.status === 'complete'));
    assert.match(fs.readFileSync(path.join(REPO, 'edit-me.txt'), 'utf8'), /alpha BETA gamma/);
    assert.equal(tokensOf(events), 'tok-edit');
  } finally {
    await setConfig({ toolPolicy: {} });
    fs.writeFileSync(path.join(REPO, 'edit-me.txt'), 'alpha beta gamma\n');
  }
});
test('loop: chat mode never offers writers, file_write decision is inert', async () => {
  scriptGen([
    PLAIN('Write it.\n' + toolBlock('file_write', { path: 'notes.txt', content: 'x' })),
    SUMMARY(['tok-chatonly']),
  ]);
  const { events } = await runAgent(
    agentBody({ repo: REPO, mode: 'chat', messages: [{ role: 'user', content: 'please create the notes' }] }));
  assert.ok(!events.some((e) => e.type === 'tool'));
  assert.ok(!fs.existsSync(path.join(REPO, 'notes.txt')));
  assert.equal(tokensOf(events), 'tok-chatonly');
});
test('loop: web_fetch returns real page text through the backend', async () => {
  scriptGen([
    PLAIN('Fetch.\n' + toolBlock('web_fetch', { url: `${mock.url}/page` })),
    PLAIN('answering'),
    SUMMARY(['tok-fetch']),
  ]);
  const { events } = await runAgent( agentBody({ messages: [{ role: 'user', content: 'please fetch that page for me' }] }));
  const done = events.find((e) => e.type === 'tool' && e.tool === 'web_fetch' && e.status === 'complete');
  assert.ok(done);
  assert.match(done.output, /Hello Mock Page/);
  assert.equal(tokensOf(events), 'tok-fetch');
});
test('loop: glob with no matches reports honestly', async () => {
  scriptGen([
    PLAIN('Glob.\n' + toolBlock('glob', { pattern: '*.zzz-nope' })),
    PLAIN('answering'),
    SUMMARY(['tok-nomatch']),
  ]);
  const { events } = await runAgent( agentBody({ repo: REPO, messages: [{ role: 'user', content: 'glob files here please' }] }));
  const done = events.find((e) => e.type === 'tool' && e.tool === 'glob' && e.status === 'complete');
  assert.ok(done);
  assert.match(done.output, /no matches/);
});
test('loop: build decision prompt carries BUILD mode preamble', async () => {
  scriptGen([PLAIN('no tools, answering'), SUMMARY(['tok-buildpre'])]);
  await runAgent( agentBody({ mode: 'build', messages: [{ role: 'user', content: 'please show the overview' }] }));
  assert.equal(decisions().length, 1);
  assert.match(String(decisions()[0].body.system), /BUILD mode/);
});
test('loop: chat decision prompt carries CHAT mode preamble', async () => {
  scriptGen([PLAIN('no tools, answering'), SUMMARY(['tok-chatpre'])]);
  await runAgent( agentBody({ mode: 'chat', messages: [{ role: 'user', content: 'please show the overview' }] }));
  assert.equal(decisions().length, 1);
  assert.match(String(decisions()[0].body.system), /CHAT mode/);
});

// ============================================================
// I. config / tools / keycheck / background runs
// ============================================================
test('config: localEndpoint wiring persists and reads back', async () => {
  const r = await (await fetch(`${BASE}/api/config`)).json();
  assert.equal(r.localEndpoint, mock.url);
});
test('config: cloudKey is masked on read', async () => {
  await setConfig({ cloudKey: 'sk-secret-x' });
  try {
    const r = await (await fetch(`${BASE}/api/config`)).json();
    assert.equal(r.cloudKey, '***');
  } finally {
    await setConfig({ cloudKey: '' });
  }
});
test('tools: list exposes agent belt with policies', async () => {
  const r = await (await fetch(`${BASE}/api/tools`)).json();
  assert.equal(r.ok, true);
  const names = r.tools.map((t) => t.name);
  assert.ok(names.includes('glob'));
  assert.ok(names.includes('Agent'));
  assert.ok(names.includes('file_write'));
  const glob = r.tools.find((t) => t.name === 'glob');
  assert.equal(glob.policy, 'allow');
});
test('keycheck: fresh data dir without a key reports nokey', async () => {
  await setConfig({ cloudKey: '' });
  const r = await postJSON(BASE, '/api/ollama/keycheck', {});
  assert.equal(r.json.ok, false);
  assert.equal(r.json.reason, 'nokey');
});
test('approve: unknown id is a 404', async () => {
  const r = await postJSON(BASE, '/api/agent/approve', { id: 'tool-nope-0', allow: true });
  assert.equal(r.status, 404);
});
test('background: missing model is a 400', async () => {
  const r = await postJSON(BASE, '/api/agent/runs', { messages: [] });
  assert.equal(r.status, 400);
});
test('background: start, poll to done, answer is buffered', async () => {
  scriptGen([SUMMARY(['bg-answer-seeded'])]);
  const started = await postJSON(BASE, '/api/agent/runs', agentBody());
  assert.equal(started.json.ok, true);
  const run = await pollBg(started.json.runId, 'done');
  assert.match(run.answer, /bg-answer-seeded/);
  assert.ok(run.events.some((e) => e.type === 'done'));
});
test('background: list contains the finished run', async () => {
  scriptGen([SUMMARY(['bg-listed'])]);
  const started = await postJSON(BASE, '/api/agent/runs', agentBody());
  await pollBg(started.json.runId, 'done');
  const list = await (await fetch(`${BASE}/api/agent/runs`)).json();
  assert.equal(list.ok, true);
  assert.ok(list.runs.some((r) => r.id === started.json.runId && r.status === 'done'));
});
test('background: stopping a hanging run reports stopped', async () => {
  scriptGen([{ hang: true }]);
  const started = await postJSON(BASE, '/api/agent/runs', agentBody());
  assert.equal(started.json.ok, true);
  await sleep(800);
  const stopped = await postJSON(BASE, '/api/agent/runs/:id/stop'.replace(':id', started.json.runId), {});
  assert.equal(stopped.json.ok, true);
  assert.equal(stopped.json.status, 'stopped');
  const run = await pollBg(started.json.runId, 'stopped', 15000);
  assert.equal(run.status, 'stopped');
});
test('background: unknown run id is a 404', async () => {
  const r = await fetch(`${BASE}/api/agent/runs/run-does-not-exist`);
  assert.equal(r.status, 404);
});
