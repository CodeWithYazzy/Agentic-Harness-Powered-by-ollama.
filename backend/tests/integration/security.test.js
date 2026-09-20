'use strict';
/* File F — CORS, confinement, injection hardening, error envelope,
 * static serving, perf budgets. PORT 48161. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('../helpers.js');

const PORT = 48161;
let srv;
let base;
let repo;
let outsideFile;

before(async () => {
  srv = h.startServer(PORT);
  base = srv.base;
  await h.waitForHealth(base);
  await h.resetConfig(base);
  repo = h.makeGitRepo();
  const od = h.tempDir('yk-sec-out-');
  outsideFile = path.join(od, 'outside-secret.txt');
  fs.writeFileSync(outsideFile, 'outside secret\n');
});

after(async () => {
  await h.stopServer(srv);
});

// ---------- CORS ----------

test('CORS evil origin gets NO allow-origin header', async () => {
  const r = await h.getJSON(base, '/api/health', { headers: { Origin: 'https://evil.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('CORS evil http origin gets NO allow-origin header', async () => {
  const r = await h.getJSON(base, '/api/health', { headers: { Origin: 'http://evil.com' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('CORS subdomain lookalike gets NO header', async () => {
  const r = await h.getJSON(base, '/api/health', { headers: { Origin: 'http://localhost.evil.com' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('CORS localhost dev origin gets header echo', async () => {
  const r = await h.getJSON(base, '/api/health', { headers: { Origin: 'http://127.0.0.1:47912' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://127.0.0.1:47912');
});

test('CORS localhost any port gets header echo', async () => {
  const r = await h.getJSON(base, '/api/health', { headers: { Origin: 'http://localhost:3000' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:3000');
});

test('CORS 127.0.0.1 self origin gets header echo', async () => {
  const r = await h.getJSON(base, '/api/health', { headers: { Origin: `http://127.0.0.1:${PORT}` } });
  assert.equal(r.headers.get('access-control-allow-origin'), `http://127.0.0.1:${PORT}`);
});

test('CORS preflight from evil origin has no allow-origin', async () => {
  const r = await h.api(base, 'OPTIONS', '/api/sessions', undefined, {
    headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('CORS preflight from allowed origin is granted', async () => {
  const r = await h.api(base, 'OPTIONS', '/api/sessions', undefined, {
    headers: { Origin: 'http://localhost:47912', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:47912');
});

test('CORS evil origin on POST still served but without header (browser blocks, server neutral)', async () => {
  const r = await h.postJSON(base, '/api/sessions', { id: 'cors-probe-1' }, { headers: { Origin: 'https://evil.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  await h.api(base, 'DELETE', '/api/sessions/cors-probe-1');
});

// ---------- files confinement ----------

test('files read deep traversal returns 403', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: '../../../../../../secret' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /escapes/i);
});

test('files read absolute outside path returns 403', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: outsideFile });
  assert.equal(r.status, 403);
  assert.equal(r.body.ok, false);
});

test('files read absolute outside path never leaks content', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: outsideFile });
  assert.ok(!r.raw.includes('outside secret'));
});

test('files read symlink escaping repo returns 403 (real junction)', async () => {
  const link = path.join(repo, 'sec-evil-dir');
  for (const rm of [() => fs.unlinkSync(link), () => fs.rmdirSync(link)]) {
    try { rm(); } catch { /* ignore */ }
  }
  fs.symlinkSync(path.dirname(outsideFile), link, 'junction');
  const r = await h.postJSON(base, '/api/files/read', { repo, file: 'sec-evil-dir/outside-secret.txt' });
  assert.equal(r.status, 403);
});

test('files read junction to directory outside is confined', async () => {
  const od = path.dirname(outsideFile);
  const link = path.join(repo, 'sec-dir-link');
  for (const rm of [() => fs.unlinkSync(link), () => fs.rmdirSync(link)]) {
    try { rm(); } catch { /* ignore */ }
  }
  fs.symlinkSync(od, link, 'junction');
  const r = await h.postJSON(base, '/api/files/read', { repo, file: 'sec-dir-link' });
  // Either 403 (escaped) or dir listing of link — must never show outside file content as file
  assert.ok([200, 403, 404].includes(r.status));
  if (r.status === 200 && r.body.type === 'file') assert.ok(!r.body.content.includes('outside secret'));
});

test('files read dotted segments inside repo still work', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: './a.txt' });
  assert.equal(r.status, 200);
  assert.match(r.body.content, /hello world/);
});

test('files read subdir-dotdot staying inside repo resolves (no mangling)', async () => {
  // confine() normalizes dot segments and checks containment instead of
  // stripping ".." substrings, so 'explorer-sub/../a.txt' resolves to
  // '<repo>/a.txt' like a filesystem would. Escapes still 403 (see above).
  const r = await h.postJSON(base, '/api/files/read', { repo, file: 'explorer-sub/../a.txt' });
  assert.equal(r.status, 200);
  assert.match(r.body.content, /hello world/);
});

test('files read sibling-prefix directory is confined (no startsWith bypass)', async () => {
  // repo=/tmp/yk-repo-XXX vs sibling /tmp/yk-repo-XXX-evil must not pass.
  const r = await h.postJSON(base, '/api/files/read', { repo, file: '../' + repo.split(/[\\/]/).pop() + '-evil/a.txt' });
  assert.ok([403, 404].includes(r.status));
  assert.equal(r.body.ok, false);
});

// ---------- git hardening ----------

test('git unsupported tool name returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', { repo, tool: 'git_push', input: {} });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /unsupported/i);
});

test('git empty tool returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', { repo, tool: '', input: {} });
  assert.equal(r.status, 400);
});

test('git unknown tool casing returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', { repo, tool: 'GIT_STATUS', input: {} });
  assert.equal(r.status, 400);
});

test('git missing repo returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', { tool: 'git_log', input: {} });
  assert.equal(r.status, 400);
});

test('git missing tool returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', { repo, input: {} });
  assert.equal(r.status, 400);
});

test('git bad ref returns ok:false with error text', async () => {
  const r = await h.postJSON(base, '/api/git', { repo, tool: 'git_show', input: { ref: 'no-such-ref-xyz' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.ok(r.body.error.length > 0);
});

test('git shell metachars in ref cannot execute commands', async () => {
  const marker = path.join(repo, 'sec-pwned.txt');
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
  await h.postJSON(base, '/api/git', { repo, tool: 'git_show', input: { ref: 'HEAD`touch sec-pwned.txt`' } });
  await h.postJSON(base, '/api/git', { repo, tool: 'git_log', input: { n: '5; touch sec-pwned.txt' } });
  assert.ok(!fs.existsSync(marker));
});

test('git command substitution in query cannot execute', async () => {
  const marker = path.join(repo, 'sec-pwned2.txt');
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
  await h.postJSON(base, '/api/git', { repo, tool: 'git_grep', input: { query: '$(touch sec-pwned2.txt)' } });
  assert.ok(!fs.existsSync(marker));
});

test('git works with normal timeout on small repo', async () => {
  const t0 = Date.now();
  const r = await h.postJSON(base, '/api/git', { repo, tool: 'git_status', input: {} });
  assert.equal(r.body.ok, true);
  assert.ok(Date.now() - t0 < 30000);
  assert.equal(typeof r.body.durationMs, 'number');
});

// ---------- JSON error envelope ----------

test('malformed JSON on config returns 400 JSON envelope', async () => {
  const r = await h.api(base, 'POST', '/api/config', '{"a":', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
  assert.equal(r.body.ok, false);
});

test('malformed JSON on repo/info returns 400 JSON envelope', async () => {
  const r = await h.api(base, 'POST', '/api/repo/info', '[broken', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
});

test('malformed JSON on files/read returns 400 JSON envelope', async () => {
  const r = await h.api(base, 'POST', '/api/files/read', '{broken', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
});

test('malformed JSON on agent/approve returns 400 JSON envelope', async () => {
  const r = await h.api(base, 'POST', '/api/agent/approve', '{broken', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
});

test('oversized payload returns 413 JSON envelope', async () => {
  const big = `{"blob":"${'q'.repeat(26 * 1024 * 1024)}"}`;
  const r = await h.api(base, 'POST', '/api/config', big, {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 413);
  assert.match(r.contentType, /application\/json/);
  assert.equal(r.body.ok, false);
}, { timeout: 120000 });

test('error envelope never returns HTML for body errors', async () => {
  const r = await h.api(base, 'POST', '/api/config', '{xx', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.ok(!/text\/html/.test(r.contentType));
});

// ---------- unknown routes + static ----------

test('unknown /api GET falls through to 404 (not 200)', async () => {
  const r = await h.getJSON(base, '/api/no-such-endpoint-xyz');
  assert.equal(r.status, 404);
});

test('unknown /api POST returns 404', async () => {
  const r = await h.postJSON(base, '/api/no-such-endpoint-xyz', {});
  assert.equal(r.status, 404);
});

test('SPA fallback serves frontend HTML for unknown page', async () => {
  const r = await h.api(base, 'GET', '/some-frontend-route-xyz');
  assert.equal(r.status, 200);
  assert.match(r.contentType, /text\/html/);
});

test('frontend root serves HTML', async () => {
  const r = await h.api(base, 'GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.contentType, /text\/html/);
});

// ---------- validation across endpoints ----------

test('repo/info without repo returns 400', async () => {
  const r = await h.postJSON(base, '/api/repo/info', {});
  assert.equal(r.status, 400);
});

test('repo/open without repo returns 400', async () => {
  const r = await h.postJSON(base, '/api/repo/open', {});
  assert.equal(r.status, 400);
});

test('files/search without query returns 400', async () => {
  const r = await h.postJSON(base, '/api/files/search', { repo });
  assert.equal(r.status, 400);
});

test('sessions POST without id returns 400', async () => {
  const r = await h.postJSON(base, '/api/sessions', { title: 'x' });
  assert.equal(r.status, 400);
});

test('memory clear without repo returns 400', async () => {
  const r = await h.postJSON(base, '/api/memory/clear', {});
  assert.equal(r.status, 400);
});

test('mcp start without name returns 400', async () => {
  const r = await h.postJSON(base, '/api/mcp/start', {});
  assert.equal(r.status, 400);
});

test('agent/compact without model returns 400', async () => {
  const r = await h.postJSON(base, '/api/agent/compact', { messages: [{ role: 'user', content: 'x' }] });
  assert.equal(r.status, 400);
});

test('agent/runs without model returns 400', async () => {
  const r = await h.postJSON(base, '/api/agent/runs', {});
  assert.equal(r.status, 400);
});

test('agent/run without model returns 400 JSON', async () => {
  const r = await h.postJSON(base, '/api/agent/run', {});
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
});

// ---------- perf budgets ----------

test('perf: health under 1s', async () => {
  const t0 = Date.now();
  assert.equal((await h.getJSON(base, '/api/health')).status, 200);
  assert.ok(Date.now() - t0 < 1000);
});

test('perf: config round-trip under 1s', async () => {
  const t0 = Date.now();
  await h.postJSON(base, '/api/config', { defaultModel: 'perf-f' });
  await h.getJSON(base, '/api/config');
  assert.ok(Date.now() - t0 < 1000);
});

test('perf: git_log small repo under 5s', async () => {
  const t0 = Date.now();
  const r = await h.postJSON(base, '/api/git', { repo, tool: 'git_log', input: { n: 5 } });
  assert.equal(r.body.ok, true);
  assert.ok(Date.now() - t0 < 5000);
});

test('perf: fs ls under 2s', async () => {
  const t0 = Date.now();
  const r = await h.postJSON(base, '/api/fs/ls', { path: repo });
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t0 < 2000);
});

test('perf: repo/info under 5s', async () => {
  const t0 = Date.now();
  const r = await h.postJSON(base, '/api/repo/info', { repo });
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t0 < 5000);
});

test('health stays 200 with evil origin (open endpoint, just no CORS grant)', async () => {
  const r = await h.getJSON(base, '/api/health', { headers: { Origin: 'https://evil.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('approve deny-shaped unknown id also 404', async () => {
  const r = await h.postJSON(base, '/api/agent/approve', { id: 'ghost-deny', allow: false });
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
});

test('files read empty file string returns 400', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: '' });
  assert.equal(r.status, 400);
});

test('repo open numeric repo returns 400', async () => {
  const r = await h.postJSON(base, '/api/repo/open', { repo: 42 });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});
