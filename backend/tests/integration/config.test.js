'use strict';
/* File A — health + config merge/masking/validation. PORT 48111. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('../helpers.js');

const PORT = 48111;
let srv;
let base;

before(async () => {
  srv = h.startServer(PORT);
  base = srv.base;
  await h.waitForHealth(base);
});

after(async () => {
  await h.stopServer(srv);
});

// ---------- GET /api/health ----------

test('health returns 200', async () => {
  const r = await h.getJSON(base, '/api/health');
  assert.equal(r.status, 200);
});

test('health body ok is boolean true', async () => {
  const r = await h.getJSON(base, '/api/health');
  assert.equal(r.body.ok, true);
});

test('health body has ISO time string', async () => {
  const r = await h.getJSON(base, '/api/health');
  assert.equal(typeof r.body.time, 'string');
  assert.ok(!Number.isNaN(Date.parse(r.body.time)), `not ISO: ${r.body.time}`);
});

test('health time is recent (within 60s)', async () => {
  const r = await h.getJSON(base, '/api/health');
  assert.ok(Math.abs(Date.now() - Date.parse(r.body.time)) < 60000);
});

test('health content-type is JSON', async () => {
  const r = await h.getJSON(base, '/api/health');
  assert.match(r.contentType, /application\/json/);
});

test('health shape has exactly ok+time keys', async () => {
  const r = await h.getJSON(base, '/api/health');
  assert.deepEqual(Object.keys(r.body).sort(), ['ok', 'time']);
});

test('health responds in under 1s', async () => {
  const t0 = Date.now();
  const r = await h.getJSON(base, '/api/health');
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`);
});

test('health is stable across repeated calls', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await h.getJSON(base, '/api/health');
    assert.equal(r.body.ok, true);
  }
});

// ---------- GET /api/config defaults ----------

test('config GET returns 200 JSON', async () => {
  await h.resetConfig(base);
  const r = await h.getJSON(base, '/api/config');
  assert.equal(r.status, 200);
  assert.match(r.contentType, /application\/json/);
});

test('config default localEndpoint', async () => {
  await h.resetConfig(base);
  const c = await h.getConfig(base);
  assert.equal(c.localEndpoint, 'http://localhost:11434');
});

test('config default cloudEndpoint', async () => {
  const c = await h.getConfig(base);
  assert.equal(c.cloudEndpoint, 'https://ollama.com');
});

test('config default cloudKey is empty string', async () => {
  const c = await h.getConfig(base);
  assert.equal(c.cloudKey, '');
});

test('config default defaultModel is empty string', async () => {
  const c = await h.getConfig(base);
  assert.equal(c.defaultModel, '');
});

test('config default defaultReasoning is Medium', async () => {
  const c = await h.getConfig(base);
  assert.equal(c.defaultReasoning, 'Medium');
});

test('config default toolPolicy is empty object', async () => {
  const c = await h.getConfig(base);
  assert.deepEqual(c.toolPolicy, {});
});

test('config default hooks is empty array', async () => {
  const c = await h.getConfig(base);
  assert.deepEqual(c.hooks, []);
});

test('config default mcpServers is empty object', async () => {
  const c = await h.getConfig(base);
  assert.deepEqual(c.mcpServers, {});
});

test('config default customCommands is empty array', async () => {
  const c = await h.getConfig(base);
  assert.deepEqual(c.customCommands, []);
});

test('config GET exposes all 9 known keys', async () => {
  const c = await h.getConfig(base);
  for (const k of ['localEndpoint', 'cloudEndpoint', 'cloudKey', 'defaultModel',
    'defaultReasoning', 'toolPolicy', 'hooks', 'mcpServers', 'customCommands']) {
    assert.ok(k in c, `missing key ${k}`);
  }
});

// ---------- POST merge: endpoints / model / reasoning ----------

test('config POST returns {ok:true}', async () => {
  await h.resetConfig(base);
  const r = await h.postJSON(base, '/api/config', { defaultModel: 'llama3' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('config POST persists defaultModel', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { defaultModel: 'qwen2.5-coder:7b' });
  assert.equal((await h.getConfig(base)).defaultModel, 'qwen2.5-coder:7b');
});

test('config POST persists localEndpoint', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { localEndpoint: 'http://127.0.0.1:11434' });
  assert.equal((await h.getConfig(base)).localEndpoint, 'http://127.0.0.1:11434');
});

test('config POST persists cloudEndpoint', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { cloudEndpoint: 'https://example.com' });
  assert.equal((await h.getConfig(base)).cloudEndpoint, 'https://example.com');
});

test('config POST persists defaultReasoning', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { defaultReasoning: 'High' });
  assert.equal((await h.getConfig(base)).defaultReasoning, 'High');
});

test('config POST merges endpoints/reasoning AND defaultModel (FIXED, was wipe quirk)', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { defaultModel: 'm1', localEndpoint: 'http://127.0.0.1:1234' });
  await h.postJSON(base, '/api/config', { defaultReasoning: 'Low' });
  const c = await h.getConfig(base);
  // defaultModel now merges via ?? like the rest — second POST preserves it
  assert.equal(c.defaultModel, 'm1');
  // endpoints/reasoning merge via `|| cur`
  assert.equal(c.localEndpoint, 'http://127.0.0.1:1234');
  assert.equal(c.defaultReasoning, 'Low');
});

test('config POST empty-string endpoint falls back to current', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { localEndpoint: '' });
  assert.equal((await h.getConfig(base)).localEndpoint, 'http://localhost:11434');
});

test('config POST empty body preserves defaultModel and endpoints (FIXED, was reset quirk)', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { defaultModel: 'keepme', localEndpoint: 'http://127.0.0.1:9999' });
  await h.postJSON(base, '/api/config', {});
  const c = await h.getConfig(base);
  assert.equal(c.defaultModel, 'keepme');
  assert.equal(c.localEndpoint, 'http://127.0.0.1:9999');
});

test('config POST writes valid JSON config file to DATA_DIR', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { defaultModel: 'filecheck' });
  const onDisk = h.readDataFile(srv.dataDir, 'config.json');
  assert.equal(onDisk.defaultModel, 'filecheck');
});

test('config round-trip completes in under 1s', async () => {
  const t0 = Date.now();
  await h.postJSON(base, '/api/config', { defaultModel: 'perf' });
  await h.getConfig(base);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`);
});

// ---------- toolPolicy passthrough ----------

test('toolPolicy object is stored verbatim', async () => {
  await h.resetConfig(base);
  const pol = { file_read: 'deny', bash_exec: 'allow', git_log: 'ask' };
  await h.postJSON(base, '/api/config', { toolPolicy: pol });
  assert.deepEqual((await h.getConfig(base)).toolPolicy, pol);
});

test('toolPolicy omitted keeps prior policy', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { toolPolicy: { grep: 'deny' } });
  await h.postJSON(base, '/api/config', { defaultModel: 'x' });
  assert.deepEqual((await h.getConfig(base)).toolPolicy, { grep: 'deny' });
});

test('toolPolicy non-object is ignored (keeps prior)', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { toolPolicy: { a: 'deny' } });
  await h.postJSON(base, '/api/config', { toolPolicy: 'allow-everything' });
  assert.deepEqual((await h.getConfig(base)).toolPolicy, { a: 'deny' });
});

test('toolPolicy array is rejected (keeps prior — arrays are not policies)', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { toolPolicy: ['file_read'] });
  assert.deepEqual((await h.getConfig(base)).toolPolicy, {});
});

// ---------- hooks validation ----------

test('valid hooks are stored with event+match+command', async () => {
  await h.resetConfig(base);
  const hooks = [
    { event: 'PreToolUse', match: 'bash_exec', command: 'echo hi' },
    { event: 'PostToolUse', match: '*', command: 'echo done' },
    { event: 'Stop', match: '*', command: 'echo stop' },
  ];
  await h.postJSON(base, '/api/config', { hooks });
  assert.deepEqual((await h.getConfig(base)).hooks, hooks);
});

test('hook with unknown event is rejected', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', {
    hooks: [
      { event: 'Nope', match: '*', command: 'echo x' },
      { event: 'PreToolUse', match: '*', command: 'echo ok' },
    ],
  });
  const hooks = (await h.getConfig(base)).hooks;
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].command, 'echo ok');
});

test('hook with blank command is rejected', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', {
    hooks: [
      { event: 'PreToolUse', match: '*', command: '   ' },
      { event: 'Stop', match: '*', command: 'echo ok' },
    ],
  });
  assert.equal((await h.getConfig(base)).hooks.length, 1);
});

test('hook with missing command is rejected', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { hooks: [{ event: 'Stop', match: '*' }] });
  assert.deepEqual((await h.getConfig(base)).hooks, []);
});

test('hook with null entry is skipped', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', {
    hooks: [null, { event: 'Stop', match: '*', command: 'echo ok' }],
  });
  assert.equal((await h.getConfig(base)).hooks.length, 1);
});

test('hooks are capped at 20 entries', async () => {
  await h.resetConfig(base);
  const many = Array.from({ length: 25 }, (_, i) => ({ event: 'Stop', match: '*', command: `echo ${i}` }));
  await h.postJSON(base, '/api/config', { hooks: many });
  const hooks = (await h.getConfig(base)).hooks;
  assert.equal(hooks.length, 20);
  assert.equal(hooks[0].command, 'echo 0');
  assert.equal(hooks[19].command, 'echo 19');
});

test('hook match defaults to star when missing', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { hooks: [{ event: 'Stop', command: 'echo x' }] });
  assert.equal((await h.getConfig(base)).hooks[0].match, '*');
});

test('hook command is truncated to 2000 chars', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { hooks: [{ event: 'Stop', match: '*', command: `echo ${'y'.repeat(3000)}` }] });
  const cmd = (await h.getConfig(base)).hooks[0].command;
  assert.equal(cmd.length, 2000);
});

test('hook match is truncated to 80 chars', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { hooks: [{ event: 'Stop', match: `m${'z'.repeat(200)}`, command: 'echo x' }] });
  assert.equal((await h.getConfig(base)).hooks[0].match.length, 80);
});

test('hooks omitted keeps prior hooks', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { hooks: [{ event: 'Stop', match: '*', command: 'echo k' }] });
  await h.postJSON(base, '/api/config', { defaultModel: 'z' });
  assert.equal((await h.getConfig(base)).hooks.length, 1);
});

test('hooks non-array is ignored (keeps prior)', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { hooks: 'not-an-array' });
  assert.deepEqual((await h.getConfig(base)).hooks, []);
});

// ---------- mcpServers sanitize ----------

test('valid mcpServers entry is stored', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', {
    mcpServers: { myserver: { command: 'node', args: ['s.js'], env: { A: '1' } } },
  });
  assert.deepEqual((await h.getConfig(base)).mcpServers, {
    myserver: { command: 'node', args: ['s.js'], env: { A: '1' } },
  });
});

test('mcpServers entry without command is dropped', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', {
    mcpServers: { bad: { args: [] }, good: { command: 'node' } },
  });
  const m = (await h.getConfig(base)).mcpServers;
  assert.ok(!('bad' in m));
  assert.ok('good' in m);
});

test('mcpServers entry with blank command is dropped', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { mcpServers: { bad: { command: '  ' } } });
  assert.deepEqual((await h.getConfig(base)).mcpServers, {});
});

test('mcpServers entry with invalid name is dropped', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', {
    mcpServers: { 'bad name!': { command: 'node' }, ok_name_1: { command: 'node' } },
  });
  const m = (await h.getConfig(base)).mcpServers;
  assert.ok(!('bad name!' in m));
  assert.ok('ok_name_1' in m);
});

test('mcpServers capped at 10 entries', async () => {
  await h.resetConfig(base);
  const many = {};
  for (let i = 0; i < 12; i++) many[`s${i}`] = { command: 'node' };
  await h.postJSON(base, '/api/config', { mcpServers: many });
  assert.equal(Object.keys((await h.getConfig(base)).mcpServers).length, 10);
});

test('mcpServers args coerced to strings and capped at 20', async () => {
  await h.resetConfig(base);
  const args = Array.from({ length: 25 }, (_, i) => i);
  await h.postJSON(base, '/api/config', { mcpServers: { s: { command: 'node', args } } });
  const got = (await h.getConfig(base)).mcpServers.s.args;
  assert.equal(got.length, 20);
  assert.equal(got[0], '0');
});

test('mcpServers omitted keeps prior servers', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { mcpServers: { k: { command: 'node' } } });
  await h.postJSON(base, '/api/config', { defaultModel: 'q' });
  assert.ok('k' in (await h.getConfig(base)).mcpServers);
});

// ---------- customCommands ----------

test('valid customCommands are stored', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', {
    customCommands: [{ name: 'review', prompt: 'Review this code' }],
  });
  assert.deepEqual((await h.getConfig(base)).customCommands, [
    { name: 'review', prompt: 'Review this code' },
  ]);
});

test('customCommand names are lowercased', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { customCommands: [{ name: 'MyCmd', prompt: 'hi' }] });
  assert.equal((await h.getConfig(base)).customCommands[0].name, 'mycmd');
});

test('customCommand with bad name is rejected', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', {
    customCommands: [
      { name: 'bad name!', prompt: 'x' },
      { name: 'good-name_1', prompt: 'y' },
    ],
  });
  const cc = (await h.getConfig(base)).customCommands;
  assert.equal(cc.length, 1);
  assert.equal(cc[0].name, 'good-name_1');
});

test('customCommand with blank prompt is rejected', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { customCommands: [{ name: 'ok', prompt: '  ' }] });
  assert.deepEqual((await h.getConfig(base)).customCommands, []);
});

test('customCommands capped at 20 entries', async () => {
  await h.resetConfig(base);
  const many = Array.from({ length: 25 }, (_, i) => ({ name: `c${i}`, prompt: 'p' }));
  await h.postJSON(base, '/api/config', { customCommands: many });
  assert.equal((await h.getConfig(base)).customCommands.length, 20);
});

test('customCommand prompt truncated to 2000 chars', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { customCommands: [{ name: 'big', prompt: `p${'x'.repeat(3000)}` }] });
  assert.equal((await h.getConfig(base)).customCommands[0].prompt.length, 2000);
});

test('customCommands omitted keeps prior commands', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { customCommands: [{ name: 'keep', prompt: 'p' }] });
  await h.postJSON(base, '/api/config', { defaultModel: 'w' });
  assert.equal((await h.getConfig(base)).customCommands.length, 1);
});

// ---------- cloudKey masking ----------

test('cloudKey set via POST is masked as *** on GET', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { cloudKey: 'sk-real-secret-123' });
  assert.equal((await h.getConfig(base)).cloudKey, '***');
});

test('cloudKey raw value is stored on disk (masked only in API)', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { cloudKey: 'sk-disk-value' });
  assert.equal(h.readDataFile(srv.dataDir, 'config.json').cloudKey, 'sk-disk-value');
});

test('posting masked *** preserves the stored key', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { cloudKey: 'sk-keep-me' });
  await h.postJSON(base, '/api/config', { cloudKey: '***', defaultModel: 'm' });
  assert.equal(h.readDataFile(srv.dataDir, 'config.json').cloudKey, 'sk-keep-me');
  assert.equal((await h.getConfig(base)).cloudKey, '***');
});

test('posting *** twice in a row keeps preserving the key', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { cloudKey: 'sk-double' });
  await h.postJSON(base, '/api/config', { cloudKey: '***' });
  await h.postJSON(base, '/api/config', { cloudKey: '***' });
  assert.equal(h.readDataFile(srv.dataDir, 'config.json').cloudKey, 'sk-double');
});

test('posting a new key replaces the old one', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { cloudKey: 'sk-old' });
  await h.postJSON(base, '/api/config', { cloudKey: 'sk-new' });
  assert.equal(h.readDataFile(srv.dataDir, 'config.json').cloudKey, 'sk-new');
});

test('omitting cloudKey keeps the stored key', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { cloudKey: 'sk-sticky' });
  await h.postJSON(base, '/api/config', { defaultModel: 'm' });
  assert.equal(h.readDataFile(srv.dataDir, 'config.json').cloudKey, 'sk-sticky');
});

test('clearing cloudKey with empty string works', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { cloudKey: 'sk-temp' });
  await h.postJSON(base, '/api/config', { cloudKey: '' });
  assert.equal(h.readDataFile(srv.dataDir, 'config.json').cloudKey, '');
  assert.equal((await h.getConfig(base)).cloudKey, '');
});

// ---------- malformed + oversized bodies ----------

test('invalid JSON body returns 400 JSON (not HTML)', async () => {
  const r = await h.api(base, 'POST', '/api/config', '{bad json,,', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
  assert.equal(r.body.ok, false);
  assert.equal(typeof r.body.error, 'string');
});

test('invalid JSON error mentions invalid JSON', async () => {
  const r = await h.api(base, 'POST', '/api/config', '[1,2,', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /invalid JSON/i);
});

test('invalid JSON on sessions endpoint also 400 JSON', async () => {
  const r = await h.api(base, 'POST', '/api/sessions', '{"id":', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
  assert.equal(r.body.ok, false);
});

test('invalid JSON on git endpoint also 400 JSON', async () => {
  const r = await h.api(base, 'POST', '/api/git', 'nope{', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
});

test('payload over 25mb returns 413 JSON (not HTML)', async () => {
  const big = `{"blob":"${'x'.repeat(26 * 1024 * 1024)}"}`;
  const r = await h.api(base, 'POST', '/api/config', big, {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 413);
  assert.match(r.contentType, /application\/json/);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /too large|25mb/i);
}, { timeout: 120000 });

test('413 response is parseable JSON with ok:false', async () => {
  const big = `{"blob":"${'y'.repeat(26 * 1024 * 1024)}"}`;
  const r = await h.api(base, 'POST', '/api/sessions', big, {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 413);
  assert.equal(r.body.ok, false);
}, { timeout: 120000 });

// ---------- misc config robustness ----------

test('config POST with unknown fields does not store them', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { evil: 'x', defaultModel: 'm' });
  const c = await h.getConfig(base);
  assert.ok(!('evil' in c));
});

test('DATA_DIR config file stays valid JSON after many POSTs', async () => {
  await h.resetConfig(base);
  for (let i = 0; i < 10; i++) {
    await h.postJSON(base, '/api/config', { defaultModel: `m${i}` });
  }
  const onDisk = h.readDataFile(srv.dataDir, 'config.json');
  assert.equal(onDisk.defaultModel, 'm9');
});

test('config file lives under the temp DATA_DIR, not home', async () => {
  assert.ok(srv.dataDir.includes('yk-data-'));
  assert.ok(fs.existsSync(path.join(srv.dataDir, 'config.json')));
});

test('config POST coerces non-string scalars via String()', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { defaultModel: 42 });
  assert.equal((await h.getConfig(base)).defaultModel, '42');
  await h.resetConfig(base);
});

test('config POST empty defaultReasoning falls back to current', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { defaultReasoning: 'High' });
  await h.postJSON(base, '/api/config', { defaultReasoning: '' });
  assert.equal((await h.getConfig(base)).defaultReasoning, 'High');
  await h.resetConfig(base);
});

test('config POST garbage defaultReasoning keeps current (closed set)', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { defaultReasoning: 'Ultra' });
  assert.equal((await h.getConfig(base)).defaultReasoning, 'Medium');
  await h.postJSON(base, '/api/config', { defaultReasoning: 'high' });
  assert.equal((await h.getConfig(base)).defaultReasoning, 'High');
  await h.resetConfig(base);
});

test('config POST non-http endpoints are rejected (SSRF guard)', async () => {
  await h.resetConfig(base);
  await h.postJSON(base, '/api/config', { localEndpoint: 'ftp://evil/x', cloudEndpoint: 'file:///etc/passwd' });
  const c = await h.getConfig(base);
  assert.equal(c.localEndpoint, 'http://localhost:11434');
  assert.equal(c.cloudEndpoint, 'https://ollama.com');
  await h.postJSON(base, '/api/config', { localEndpoint: 'http://127.0.0.1:11434' });
  assert.equal((await h.getConfig(base)).localEndpoint, 'http://127.0.0.1:11434');
  await h.resetConfig(base);
});
