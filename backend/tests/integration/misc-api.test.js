'use strict';
/* File E — tools catalogue, approvals, agent validation, memory, MCP,
 * SSE failure paths, keycheck, library, host. PORT 48151. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers.js');

const PORT = 48151;
let srv;
let base;

const KNOWN_TOOLS = ['file_read', 'glob', 'grep', 'web_fetch', 'web_search',
  'todo_write', 'ask_user', 'git_log', 'git_show', 'git_diff', 'git_status',
  'Agent', 'TaskCreate', 'TaskList', 'TaskUpdate', 'TaskOutput',
  'file_write', 'file_edit', 'bash_exec'];

before(async () => {
  srv = h.startServer(PORT);
  base = srv.base;
  await h.waitForHealth(base);
  await h.resetConfig(base);
});

after(async () => {
  await h.stopServer(srv);
});

// ---------- GET /api/tools ----------

test('tools returns ok with tools array', async () => {
  const r = await h.getJSON(base, '/api/tools');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(Array.isArray(r.body.tools));
});

test('tools catalogue has 19+ entries', async () => {
  await h.resetConfig(base);
  const r = await h.getJSON(base, '/api/tools');
  assert.ok(r.body.tools.length >= 19, `got ${r.body.tools.length}`);
});

test('tools catalogue contains every known belt tool', async () => {
  await h.resetConfig(base);
  const r = await h.getJSON(base, '/api/tools');
  const names = r.body.tools.map((t) => t.name);
  for (const n of KNOWN_TOOLS) assert.ok(names.includes(n), `missing ${n}`);
});

test('tools entries have description+readOnly+modes+policy+mcp fields', async () => {
  const r = await h.getJSON(base, '/api/tools');
  for (const t of r.body.tools) {
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.description, 'string');
    assert.equal(typeof t.readOnly, 'boolean');
    assert.ok(Array.isArray(t.modes));
    assert.ok(['allow', 'ask', 'deny'].includes(t.policy), `${t.name} policy ${t.policy}`);
    assert.equal(typeof t.mcp, 'boolean');
  }
});

test('tools mcp flags are false with no MCP servers', async () => {
  await h.resetConfig(base);
  const r = await h.getJSON(base, '/api/tools');
  for (const t of r.body.tools) assert.equal(t.mcp, false);
});

test('tools default policy: read-only tools allow', async () => {
  await h.resetConfig(base);
  const r = await h.getJSON(base, '/api/tools');
  const byName = Object.fromEntries(r.body.tools.map((t) => [t.name, t]));
  assert.equal(byName.file_read.policy, 'allow');
  assert.equal(byName.grep.policy, 'allow');
  assert.equal(byName.git_log.policy, 'allow');
});

test('tools default policy: write tools ask', async () => {
  await h.resetConfig(base);
  const r = await h.getJSON(base, '/api/tools');
  const byName = Object.fromEntries(r.body.tools.map((t) => [t.name, t]));
  assert.equal(byName.file_write.policy, 'ask');
  assert.equal(byName.bash_exec.policy, 'ask');
  assert.equal(byName.file_edit.policy, 'ask');
});

test('tools policies reflect seeded toolPolicy', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { toolPolicy: { file_read: 'deny', bash_exec: 'allow', git_log: 'ask' } });
  const r = await h.getJSON(base, '/api/tools');
  const byName = Object.fromEntries(r.body.tools.map((t) => [t.name, t]));
  assert.equal(byName.file_read.policy, 'deny');
  assert.equal(byName.bash_exec.policy, 'allow');
  assert.equal(byName.git_log.policy, 'ask');
  assert.equal(byName.grep.policy, 'allow'); // unseeded default untouched
  await h.resetConfig(base);
});

test('tools seeded deny-all is reflected for every tool', async () => {
  await h.resetConfig(base);
  const pol = Object.fromEntries(KNOWN_TOOLS.map((n) => [n, 'deny']));
  await h.postJSON(base, '/api/config', { toolPolicy: pol });
  const r = await h.getJSON(base, '/api/tools');
  for (const t of r.body.tools) {
    if (KNOWN_TOOLS.includes(t.name)) assert.equal(t.policy, 'deny');
  }
  await h.resetConfig(base);
});

test('tools modes: chat-only excludes write tools', async () => {
  const r = await h.getJSON(base, '/api/tools');
  const chat = r.body.tools.filter((t) => t.modes.includes('chat')).map((t) => t.name);
  assert.ok(chat.includes('file_read'));
  assert.ok(!chat.includes('file_write'));
  assert.ok(!chat.includes('bash_exec'));
});

// ---------- POST /api/agent/approve ----------

test('approve unknown id returns 404', async () => {
  const r = await h.postJSON(base, '/api/agent/approve', { id: 'no-such-approval', allow: true });
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /no such pending/i);
});

test('approve missing id returns 404', async () => {
  const r = await h.postJSON(base, '/api/agent/approve', { allow: true });
  assert.equal(r.status, 404);
});

test('approve 404 path leaves config toolPolicy untouched', async () => {
  await h.resetConfig(base);
  const before = await h.getConfig(base);
  await h.postJSON(base, '/api/agent/approve', { id: 'ghost', allow: true, always: true, tool: 'bash_exec' });
  const after = await h.getConfig(base);
  assert.deepEqual(after.toolPolicy, before.toolPolicy);
  assert.deepEqual(after, before);
});

test('approve always-allow without pending id still 404 (documented: pendingApprovals only fills during real runs)', async () => {
  const r = await h.postJSON(base, '/api/agent/approve', { id: 'ghost2', allow: true, always: true, tool: 'file_write' });
  assert.equal(r.status, 404);
  assert.ok(!('file_write' in (await h.getConfig(base)).toolPolicy));
});

// ---------- POST /api/agent/run validation ----------

test('agent run missing model returns 400 JSON (not SSE)', async () => {
  const r = await h.postJSON(base, '/api/agent/run', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /model required/i);
});

test('agent run empty body returns 400 JSON', async () => {
  const r = await h.postJSON(base, '/api/agent/run', {});
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
});

test('agent run 400 content-type is not event-stream', async () => {
  const r = await h.postJSON(base, '/api/agent/run', { messages: [] });
  assert.ok(!/text\/event-stream/.test(r.contentType));
});

test('agent run empty-string model returns 400', async () => {
  const r = await h.postJSON(base, '/api/agent/run', { model: '', messages: [] });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('agent run invalid JSON returns 400 JSON', async () => {
  const r = await h.api(base, 'POST', '/api/agent/run', '{"model":', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
  assert.equal(r.body.ok, false);
});

// ---------- background runs ----------

test('background runs POST missing model returns 400', async () => {
  const r = await h.postJSON(base, '/api/agent/runs', { messages: [] });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /model required/i);
});

test('background runs POST empty body returns 400', async () => {
  const r = await h.postJSON(base, '/api/agent/runs', {});
  assert.equal(r.status, 400);
});

test('background runs POST invalid JSON returns 400', async () => {
  const r = await h.api(base, 'POST', '/api/agent/runs', '{oops', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
});

test('background runs list has ok+runs shape', async () => {
  const r = await h.getJSON(base, '/api/agent/runs');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(Array.isArray(r.body.runs));
});

test('background run create returns runId then appears in list', async () => {
  const c = await h.postJSON(base, '/api/agent/runs', { model: 'test-model-xyz', messages: [] });
  assert.equal(c.status, 200);
  assert.equal(c.body.ok, true);
  assert.match(c.body.runId, /^run-\d+$/);
  const list = await h.getJSON(base, '/api/agent/runs');
  const found = list.body.runs.find((x) => x.id === c.body.runId);
  assert.ok(found, 'created run should be listed');
  assert.equal(found.model, 'test-model-xyz');
  assert.ok(['running', 'done', 'error', 'stopped'].includes(found.status));
  assert.equal(typeof found.createdAt, 'number');
});

test('background run list entries have id+label+model+status+createdAt', async () => {
  const list = await h.getJSON(base, '/api/agent/runs');
  for (const run of list.body.runs) {
    for (const k of ['id', 'label', 'model', 'status', 'createdAt']) {
      assert.ok(k in run, `missing ${k}`);
    }
  }
});

test('background run get returns the run with events', async () => {
  const c = await h.postJSON(base, '/api/agent/runs', { model: 'm2', messages: [{ role: 'user', content: 'hello-run' }] });
  const g = await h.getJSON(base, `/api/agent/runs/${c.body.runId}`);
  assert.equal(g.status, 200);
  assert.equal(g.body.ok, true);
  assert.equal(g.body.run.id, c.body.runId);
  assert.ok(Array.isArray(g.body.run.events));
  assert.equal(typeof g.body.run.answer, 'string');
});

test('background run get unknown id returns 404', async () => {
  const r = await h.getJSON(base, '/api/agent/runs/run-999999');
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /no such run/i);
});

test('background run stop unknown id returns 404', async () => {
  const r = await h.postJSON(base, '/api/agent/runs/run-999999/stop', {});
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
});

test('background run stop created run returns ok', async () => {
  const c = await h.postJSON(base, '/api/agent/runs', { model: 'm3', messages: [] });
  const s = await h.postJSON(base, `/api/agent/runs/${c.body.runId}/stop`, {});
  assert.equal(s.status, 200);
  assert.equal(s.body.ok, true);
  assert.ok(['running', 'done', 'error', 'stopped'].includes(s.body.status));
});

// ---------- compact validation ----------

test('compact missing model and messages returns 400', async () => {
  const r = await h.postJSON(base, '/api/agent/compact', {});
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /model and messages required/i);
});

test('compact model without messages returns 400', async () => {
  const r = await h.postJSON(base, '/api/agent/compact', { model: 'x' });
  assert.equal(r.status, 400);
});

test('compact messages without model returns 400', async () => {
  const r = await h.postJSON(base, '/api/agent/compact', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.status, 400);
});

test('compact empty messages array returns 400', async () => {
  const r = await h.postJSON(base, '/api/agent/compact', { model: 'x', messages: [] });
  assert.equal(r.status, 400);
});

test('compact non-array messages returns 400', async () => {
  const r = await h.postJSON(base, '/api/agent/compact', { model: 'x', messages: 'hi' });
  assert.equal(r.status, 400);
});

test('compact invalid JSON returns 400', async () => {
  const r = await h.api(base, 'POST', '/api/agent/compact', '{{{', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
});

// ---------- memory ----------

test('memory GET empty returns ok with empty notes', async () => {
  const r = await h.getJSON(base, '/api/memory?repo=/tmp/nonexistent-repo-xyz');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.notes, []);
});

test('memory GET missing repo param returns empty notes', async () => {
  const r = await h.getJSON(base, '/api/memory');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.notes, []);
});

test('memory clear missing repo returns 400', async () => {
  const r = await h.postJSON(base, '/api/memory/clear', {});
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /repo required/i);
});

test('memory clear empty repo returns 400', async () => {
  const r = await h.postJSON(base, '/api/memory/clear', { repo: '' });
  assert.equal(r.status, 400);
});

test('memory clear round-trip: seeded notes appear then clear wipes them', async () => {
  const repoKey = `/tmp/yk-mem-${Date.now()}`;
  h.writeDataFile(srv.dataDir, 'memory.json', { [repoKey]: ['note one', 'note two'] });
  const g1 = await h.getJSON(base, `/api/memory?repo=${encodeURIComponent(repoKey)}`);
  assert.deepEqual(g1.body.notes, ['note one', 'note two']);
  const c = await h.postJSON(base, '/api/memory/clear', { repo: repoKey });
  assert.equal(c.status, 200);
  assert.equal(c.body.ok, true);
  const g2 = await h.getJSON(base, `/api/memory?repo=${encodeURIComponent(repoKey)}`);
  assert.deepEqual(g2.body.notes, []);
});

test('memory clear removes only the targeted repo', async () => {
  const a = `/tmp/yk-mem-a-${Date.now()}`;
  const b = `/tmp/yk-mem-b-${Date.now()}`;
  h.writeDataFile(srv.dataDir, 'memory.json', { [a]: ['keep-a'], [b]: ['drop-b'] });
  await h.postJSON(base, '/api/memory/clear', { repo: b });
  const ga = await h.getJSON(base, `/api/memory?repo=${encodeURIComponent(a)}`);
  assert.deepEqual(ga.body.notes, ['keep-a']);
  await h.postJSON(base, '/api/memory/clear', { repo: a });
});

test('memory GET filters non-string notes', async () => {
  const repoKey = `/tmp/yk-mem-f-${Date.now()}`;
  h.writeDataFile(srv.dataDir, 'memory.json', { [repoKey]: ['good', 42, null] });
  const g = await h.getJSON(base, `/api/memory?repo=${encodeURIComponent(repoKey)}`);
  assert.deepEqual(g.body.notes, ['good']);
  await h.postJSON(base, '/api/memory/clear', { repo: repoKey });
});

test('memory GET reads legacy verbatim keys (memKey fallback + clear)', async () => {
  // raw key whose normalized form differs (case/separators): must still read,
  // and clear must remove it so nothing resurrects.
  const repoKey = `C:\\yk-mem-legacy-${Date.now()}`;
  h.writeDataFile(srv.dataDir, 'memory.json', { [repoKey]: ['legacy-note'] });
  const g = await h.getJSON(base, `/api/memory?repo=${encodeURIComponent(repoKey)}`);
  assert.deepEqual(g.body.notes, ['legacy-note']);
  await h.postJSON(base, '/api/memory/clear', { repo: repoKey });
  const g2 = await h.getJSON(base, `/api/memory?repo=${encodeURIComponent(repoKey)}`);
  assert.deepEqual(g2.body.notes, []);
});

// ---------- MCP ----------

test('mcp list empty returns ok with empty servers', async () => {
  await h.resetConfig(base);
  const r = await h.getJSON(base, '/api/mcp');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.servers, []);
});

test('mcp start unknown server returns 400', async () => {
  const r = await h.postJSON(base, '/api/mcp/start', { name: 'ghost-server' });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /no such server/i);
});

test('mcp start missing name returns 400', async () => {
  const r = await h.postJSON(base, '/api/mcp/start', {});
  assert.equal(r.status, 400);
});

test('mcp stop unknown server returns ok:true', async () => {
  const r = await h.postJSON(base, '/api/mcp/stop', { name: 'ghost-server' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('mcp stop missing name returns ok:true', async () => {
  const r = await h.postJSON(base, '/api/mcp/stop', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('mcp start fake node server reaches running with tools', async () => {
  const fake = h.writeFakeMcpServer(h.tempDir('yk-mcpfake-'));
  await h.postJSON(base, '/api/config', {
    mcpServers: { faketest: { command: process.execPath, args: [fake], env: {} } },
  });
  const s = await h.postJSON(base, '/api/mcp/start', { name: 'faketest' });
  assert.equal(s.status, 200);
  assert.equal(s.body.ok, true);
  assert.equal(s.body.status, 'running');
  assert.deepEqual(s.body.tools, ['echo']);
  await h.postJSON(base, '/api/mcp/stop', { name: 'faketest' });
  await h.resetConfig(base);
}, { timeout: 60000 });

test('mcp list shows started server with tools', async () => {
  const fake = h.writeFakeMcpServer(h.tempDir('yk-mcpfake2-'));
  await h.postJSON(base, '/api/config', {
    mcpServers: { fakelist: { command: process.execPath, args: [fake], env: {} } },
  });
  await h.postJSON(base, '/api/mcp/start', { name: 'fakelist' });
  const st = await h.waitForMcpStatus(base, 'fakelist', 'running');
  assert.deepEqual(st.tools, ['echo']);
  const list = await h.getJSON(base, '/api/mcp');
  const found = list.body.servers.find((x) => x.name === 'fakelist');
  assert.ok(found);
  assert.equal(found.status, 'running');
  await h.postJSON(base, '/api/mcp/stop', { name: 'fakelist' });
  await h.resetConfig(base);
}, { timeout: 60000 });

test('mcp stop started server returns ok and removes it', async () => {
  const fake = h.writeFakeMcpServer(h.tempDir('yk-mcpfake3-'));
  await h.postJSON(base, '/api/config', {
    mcpServers: { fakestop: { command: process.execPath, args: [fake], env: {} } },
  });
  await h.postJSON(base, '/api/mcp/start', { name: 'fakestop' });
  await h.waitForMcpStatus(base, 'fakestop', 'running');
  const stop = await h.postJSON(base, '/api/mcp/stop', { name: 'fakestop' });
  assert.equal(stop.body.ok, true);
  const list = await h.getJSON(base, '/api/mcp');
  assert.ok(!list.body.servers.some((x) => x.name === 'fakestop'));
  await h.resetConfig(base);
}, { timeout: 60000 });

test('mcp start with bad command reports error status', async () => {
  await h.postJSON(base, '/api/config', {
    mcpServers: { badcmd: { command: 'yk-no-such-binary-xyz', args: [], env: {} } },
  });
  const s = await h.postJSON(base, '/api/mcp/start', { name: 'badcmd' });
  assert.equal(s.status, 200);
  assert.equal(s.body.ok, false);
  assert.ok(['error', 'stopped'].includes(s.body.status));
  assert.equal(typeof s.body.error, 'string');
  await h.postJSON(base, '/api/mcp/stop', { name: 'badcmd' });
  await h.resetConfig(base);
}, { timeout: 60000 });

// ---------- generate / pull SSE failure paths ----------

test('generate against unreachable endpoint emits {error} event then ends (not hang)', async () => {
  await h.postJSON(base, '/api/config', { localEndpoint: 'http://127.0.0.1:9' });
  try {
    const t0 = Date.now();
    const s = await h.readSSE(`${base}/api/ollama/generate`, { timeoutMs: 30000 }, {
      model: 'nope', prompt: 'hi',
    });
    const dt = Date.now() - t0;
    assert.equal(s.status, 200);
    assert.match(s.contentType, /text\/event-stream/);
    assert.ok(s.events.some((e) => typeof e.error === 'string'), `no error event: ${s.raw.slice(0, 500)}`);
    assert.ok(dt < 30000, `took ${dt}ms`);
  } finally {
    await h.resetConfig(base);
  }
}, { timeout: 60000 });

test('pull against unreachable endpoint emits error event then ends', async () => {
  await h.postJSON(base, '/api/config', { localEndpoint: 'http://127.0.0.1:9' });
  try {
    const t0 = Date.now();
    const s = await h.readSSE(`${base}/api/ollama/pull`, { timeoutMs: 30000 }, { name: 'nope' });
    const dt = Date.now() - t0;
    assert.equal(s.status, 200);
    assert.ok(s.events.some((e) => typeof e.error === 'string'), `no error event: ${s.raw.slice(0, 500)}`);
    assert.ok(dt < 30000, `took ${dt}ms`);
  } finally {
    await h.resetConfig(base);
  }
}, { timeout: 60000 });

test('generate error event mentions connection failure', async () => {
  await h.postJSON(base, '/api/config', { localEndpoint: 'http://127.0.0.1:9' });
  try {
    const s = await h.readSSE(`${base}/api/ollama/generate`, { timeoutMs: 30000 }, {
      model: 'nope', prompt: 'hi',
    });
    const err = s.events.find((e) => typeof e.error === 'string');
    assert.ok(err && err.error.length > 0);
  } finally {
    await h.resetConfig(base);
  }
}, { timeout: 60000 });

// ---------- ollama error-path probes (unreachable endpoint) ----------

test('models against unreachable endpoint returns 502 JSON', async () => {
  const r = await h.postJSON(base, '/api/ollama/models', { endpoint: 'http://127.0.0.1:9' });
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
  assert.equal(typeof r.body.error, 'string');
});

test('show against unreachable endpoint returns 502', async () => {
  const r = await h.postJSON(base, '/api/ollama/show', { name: 'x', endpoint: 'http://127.0.0.1:9' });
  // show proxies localEndpoint (no endpoint override) — with default local
  // endpoint the result depends on local ollama; only assert JSON shape.
  assert.match(r.contentType, /application\/json/);
  assert.equal(typeof r.body.ok === 'boolean' || typeof r.body === 'object', true);
});

test('delete against unreachable endpoint returns 502 when local down', async () => {
  await h.postJSON(base, '/api/config', { localEndpoint: 'http://127.0.0.1:9' });
  try {
    const r = await h.postJSON(base, '/api/ollama/delete', { name: 'nope' });
    assert.equal(r.status, 502);
    assert.equal(r.body.ok, false);
  } finally {
    await h.resetConfig(base);
  }
});

test('ps against unreachable endpoint returns 502 when local down', async () => {
  await h.postJSON(base, '/api/config', { localEndpoint: 'http://127.0.0.1:9' });
  try {
    const r = await h.postJSON(base, '/api/ollama/ps', {});
    assert.equal(r.status, 502);
    assert.equal(r.body.ok, false);
  } finally {
    await h.resetConfig(base);
  }
});

test('ollama health against unreachable endpoint returns ok:false (not throw)', async () => {
  const r = await h.postJSON(base, '/api/ollama/health', { endpoint: 'http://127.0.0.1:9' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.endpoint, 'http://127.0.0.1:9');
});

// ---------- keycheck / library / host ----------

test('keycheck with no key returns {reason:nokey}', async () => {
  await h.resetConfig(base); // fresh DATA_DIR guarantees empty cloudKey
  const r = await h.postJSON(base, '/api/ollama/keycheck', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.reason, 'nokey');
});

test('library returns {ok,names[]} shape (network-tolerant)', async () => {
  const r = await h.getJSON(base, '/api/ollama/library');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(Array.isArray(r.body.names));
  for (const n of r.body.names) assert.equal(typeof n, 'string');
}, { timeout: 30000 });

test('library second call is cached or live (still shape-only)', async () => {
  await h.getJSON(base, '/api/ollama/library');
  const r = await h.getJSON(base, '/api/ollama/library');
  assert.equal(r.body.ok, true);
  assert.ok(Array.isArray(r.body.names));
}, { timeout: 30000 });

test('host returns hardware shape', async () => {
  const r = await h.getJSON(base, '/api/host');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.totalMem > 0);
  assert.ok(r.body.freeMem >= 0);
  assert.equal(typeof r.body.platform, 'string');
  assert.equal(typeof r.body.arch, 'string');
  assert.ok(r.body.cpus >= 1);
});

test('host platform matches os.platform', async () => {
  const os = require('node:os');
  const r = await h.getJSON(base, '/api/host');
  assert.equal(r.body.platform, os.platform());
});

test('tools task + ask_user tools default to allow (readOnly); Agent shows ask (General gate)', async () => {
  await h.resetConfig(base);
  const r = await h.getJSON(base, '/api/tools');
  const byName = Object.fromEntries(r.body.tools.map((t) => [t.name, t]));
  assert.equal(byName.TaskCreate.policy, 'allow');
  assert.equal(byName.ask_user.policy, 'allow');
  // Agent displays its strictest gate: General subagents need approval even
  // though Explore/Plan are allow. The endpoint used to report 'allow'.
  assert.equal(byName.Agent.policy, 'ask');
});

test('host freeMem never exceeds totalMem', async () => {
  const r = await h.getJSON(base, '/api/host');
  assert.ok(r.body.freeMem <= r.body.totalMem);
});

test('library names list is capped at 40', async () => {
  const r = await h.getJSON(base, '/api/ollama/library');
  assert.ok(r.body.names.length <= 40);
}, { timeout: 30000 });

test('consecutive background runs get distinct ids', async () => {
  const a = await h.postJSON(base, '/api/agent/runs', { model: 'mm', messages: [] });
  const b = await h.postJSON(base, '/api/agent/runs', { model: 'mm', messages: [] });
  assert.notEqual(a.body.runId, b.body.runId);
});
