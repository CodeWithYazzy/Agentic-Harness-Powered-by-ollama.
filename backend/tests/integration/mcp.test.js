'use strict';
/* MCP stdio lifecycle: configure fake server -> start -> tools surface ->
 * model-invoked call returns echo-ok -> stop. No git needed.
 * Run: node --test tests/integration/mcp.test.js (PORT 48171)
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers.js');

const PORT = 48171;
let srv;
let base;

before(async () => {
  srv = h.startServer(PORT);
  base = srv.base;
  await h.waitForHealth(base);
  await h.resetConfig(base);
});

after(async () => {
  await h.stopServer(srv);
});

test('fake MCP server starts and reports running with echo tool', async () => {
  const file = h.writeFakeMcpServer();
  const cfg = await h.postJSON(base, '/api/config', {
    mcpServers: { fakesrv: { command: process.execPath, args: [file], env: {} } },
  });
  assert.equal(cfg.body.ok, true);
  const started = await h.postJSON(base, '/api/mcp/start', { name: 'fakesrv' });
  assert.equal(started.body.status, 'running');
  assert.deepEqual(started.body.tools, ['echo']);
  const s = await h.waitForMcpStatus(base, 'fakesrv', 'running');
  assert.deepEqual(s.tools, ['echo']);
});

test('MCP tools surface in /api/tools as build-only', async () => {
  const r = await h.getJSON(base, '/api/tools');
  assert.equal(r.status, 200);
  const mcp = r.body.tools.find((t) => t.name === 'mcp__fakesrv__echo');
  assert.ok(mcp, 'mcp tool listed');
  assert.deepEqual(mcp.modes, ['build']);
});

test('unknown MCP server start is 400, stop removes the entry', async () => {
  const bad = await h.postJSON(base, '/api/mcp/start', { name: 'no-such-server' });
  assert.equal(bad.status, 400);
  const stop = await h.postJSON(base, '/api/mcp/stop', { name: 'fakesrv' });
  assert.equal(stop.body.ok, true);
  const list = await h.getJSON(base, '/api/mcp');
  assert.ok(!list.body.servers.some((x) => x.name === 'fakesrv'));
});
