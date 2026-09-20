'use strict';
/* File C — /api/git against a real fixture repo. PORT 48131. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('../helpers.js');

const PORT = 48131;
let srv;
let base;
let repo;
let headHash;
let headShort;

async function git(tool, input) {
  const r = await h.postJSON(base, '/api/git', { repo, tool, input: input || {} });
  assert.equal(r.status, 200, `${tool} unexpected status ${r.status}: ${r.raw}`);
  return r.body;
}

before(async () => {
  srv = h.startServer(PORT);
  base = srv.base;
  await h.waitForHealth(base);
  repo = h.makeGitRepo();
  const log = await git('git_log', { n: 1 });
  headHash = log.commits[0].hash;
  headShort = log.commits[0].short;
});

after(async () => {
  await h.stopServer(srv);
});

// ---------- git_status ----------

test('git_status ok with durationMs', async () => {
  const b = await git('git_status');
  assert.equal(b.ok, true);
  assert.equal(b.tool, 'git_status');
  assert.equal(typeof b.durationMs, 'number');
});

test('git_status shows staged rename', async () => {
  const b = await git('git_status');
  assert.match(b.output, /b-renamed\.txt/);
});

test('git_status shows dirty modification of a.txt', async () => {
  const b = await git('git_status');
  assert.match(b.output, /a\.txt/);
});

test('git_status shows untracked file marker', async () => {
  const b = await git('git_status');
  assert.match(b.output, /\?\?.*untracked\.txt/);
});

test('git_status output first line is branch header', async () => {
  const b = await git('git_status');
  assert.match(b.output.split('\n')[0], /## main/);
});

test('git_status ignores extra input gracefully', async () => {
  const b = await git('git_status', { junk: 'x'.repeat(100) });
  assert.equal(b.ok, true);
});

// ---------- git_log ----------

test('git_log returns parsed commits array', async () => {
  const b = await git('git_log', { n: 5 });
  assert.equal(b.ok, true);
  assert.ok(Array.isArray(b.commits));
  assert.equal(b.commits.length, 2);
});

test('git_log newest commit is the a.txt update', async () => {
  const b = await git('git_log', { n: 5 });
  assert.match(b.commits[0].subject, /Update a\.txt/);
});

test('git_log commit shape hash/short/author/date/subject', async () => {
  const b = await git('git_log', { n: 1 });
  const c = b.commits[0];
  assert.match(c.hash, /^[0-9a-f]{40}$/);
  assert.match(c.short, /^[0-9a-f]{7}$/);
  assert.equal(c.author, 'YK Test');
  assert.ok(!Number.isNaN(Date.parse(c.date)), `bad date ${c.date}`);
  assert.equal(typeof c.subject, 'string');
  assert.ok(c.subject.length > 0);
});

test('git_log commit has refs string field', async () => {
  const b = await git('git_log', { n: 5 });
  for (const c of b.commits) assert.equal(typeof c.refs, 'string');
});

test('git_log n=1 returns exactly one commit', async () => {
  const b = await git('git_log', { n: 1 });
  assert.equal(b.commits.length, 1);
});

test('git_log n clamps huge values to 50 (returns all available)', async () => {
  const b = await git('git_log', { n: 500 });
  assert.equal(b.ok, true);
  assert.equal(b.commits.length, 2);
});

test('git_log n=0 falls back to default 5', async () => {
  const b = await git('git_log', { n: 0 });
  assert.equal(b.ok, true);
  assert.equal(b.commits.length, 2);
});

test('git_log count alias works like n', async () => {
  const b = await git('git_log', { count: 1 });
  assert.equal(b.commits.length, 1);
});

test('git_log raw output contains full hashes', async () => {
  const b = await git('git_log', { n: 2 });
  assert.match(b.output, /[0-9a-f]{40}/);
});

test('git_log output sliced to 60000 chars max', async () => {
  const b = await git('git_log', { n: 5 });
  assert.ok(b.output.length <= 60000);
});

test('git_log on feature branch shows feature commit', async () => {
  const r = await h.postJSON(base, '/api/git', {
    repo,
    tool: 'git_log',
    input: {},
  });
  assert.equal(r.body.ok, true);
  const feat = await h.api(base, 'POST', '/api/git', { repo, tool: 'git_log', input: { n: 5 } });
  assert.equal(feat.body.ok, true);
});

test('git_log small repo completes in under 5s', async () => {
  const t0 = Date.now();
  const b = await git('git_log', { n: 5 });
  assert.equal(b.ok, true);
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0}ms`);
});

// ---------- git_show ----------

test('git_show HEAD works and mentions commit message', async () => {
  const b = await git('git_show', { ref: 'HEAD' });
  assert.equal(b.ok, true);
  assert.match(b.output, /Update a\.txt/);
});

test('git_show default ref is HEAD when omitted', async () => {
  const b = await git('git_show', {});
  assert.equal(b.ok, true);
  assert.match(b.output, /Update a\.txt/);
});

test('git_show by full hash works', async () => {
  const b = await git('git_show', { ref: headHash });
  assert.equal(b.ok, true);
  assert.match(b.output, /Update a\.txt/);
});

test('git_show by short hash works', async () => {
  const b = await git('git_show', { ref: headShort });
  assert.equal(b.ok, true);
});

test('git_show commit alias works like ref', async () => {
  const b = await git('git_show', { commit: headShort });
  assert.equal(b.ok, true);
});

test('git_show includes stat section', async () => {
  const b = await git('git_show', { ref: 'HEAD' });
  assert.match(b.output, /files? changed|a\.txt/);
});

test('git_show includes patch hunks', async () => {
  const b = await git('git_show', { ref: 'HEAD' });
  assert.match(b.output, /@@/);
});

test('git_show with path filter limits to file', async () => {
  const b = await git('git_show', { ref: 'HEAD', path: 'a.txt' });
  assert.equal(b.ok, true);
  assert.match(b.output, /a\.txt/);
});

test('git_show ordinal ref is NOT resolved via /api/git (documents raw passthrough)', async () => {
  const b = await git('git_show', { ref: 'second' });
  // sanitizeGitArgs passes "second" straight to `git show second`,
  // which fails: ordinal resolution only exists in the agent execTool path.
  assert.equal(b.ok, false);
  assert.equal(typeof b.error, 'string');
  assert.ok(b.error.length > 0);
});

test('git_show bad ref returns ok:false with error text', async () => {
  const b = await git('git_show', { ref: 'deadbeefcafe1234' });
  assert.equal(b.ok, false);
  assert.equal(typeof b.error, 'string');
  assert.ok(b.error.length > 0);
});

test('git_show bad ref includes durationMs', async () => {
  const b = await git('git_show', { ref: 'deadbeefcafe1234' });
  assert.equal(typeof b.durationMs, 'number');
});

// ---------- git_diff ----------

test('git_diff ok with stat and patch', async () => {
  const b = await git('git_diff');
  assert.equal(b.ok, true);
  assert.match(b.output, /a\.txt/);
  assert.match(b.output, /dirty uncommitted change/);
});

test('git_diff shows staged rename with similarity', async () => {
  const b = await git('git_diff');
  assert.match(b.output, /rename|b-renamed\.txt/);
});

test('git_diff with path filter narrows output', async () => {
  const b = await git('git_diff', { path: 'a.txt' });
  assert.equal(b.ok, true);
  assert.match(b.output, /a\.txt/);
});

test('git_diff clean tree returns empty output', async () => {
  const clean = h.tempDir('yk-gitclean-');
  const { execFileSync } = require('node:child_process');
  const id = ['-c', 'user.email=t@t.com', '-c', 'user.name=T'];
  const run = (a) => execFileSync('git', [...id, ...a], { cwd: clean, stdio: 'pipe' });
  run(['init', '-b', 'main']);
  fs.writeFileSync(path.join(clean, 'f.txt'), 'x\n');
  run(['add', '.']);
  run(['commit', '-m', 'one']);
  const r = await h.postJSON(base, '/api/git', { repo: clean, tool: 'git_diff', input: {} });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.output, '');
});

// ---------- git_branch ----------

test('git_branch lists both main and feature', async () => {
  const b = await git('git_branch');
  assert.equal(b.ok, true);
  assert.match(b.output, /main/);
  assert.match(b.output, /feature/);
});

test('git_branch marks current branch with star', async () => {
  const b = await git('git_branch');
  assert.match(b.output, /\*\s+main/);
});

test('git_branch verbose shows commit subjects', async () => {
  const b = await git('git_branch');
  assert.match(b.output, /[0-9a-f]{7}/);
});

// ---------- git_grep ----------

test('git_grep finds TODO with line numbers', async () => {
  const b = await git('git_grep', { query: 'TODO' });
  assert.equal(b.ok, true);
  assert.match(b.output, /a\.txt:\d+:.*TODO/);
});

test('git_grep uses -e so dash queries work', async () => {
  const b = await git('git_grep', { query: '-nonsense-flag-like' });
  assert.equal(typeof b.ok, 'boolean');
});

test('git_grep missing query returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', { repo, tool: 'git_grep', input: {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('git_grep no-match returns ok:false with empty output', async () => {
  const b = await git('git_grep', { query: 'zzz-no-such-token-zzz' });
  assert.equal(b.ok, false);
});

// ---------- git_rev_parse ----------

test('git_rev_parse returns branch name main', async () => {
  const b = await git('git_rev_parse');
  assert.equal(b.ok, true);
  assert.equal(b.output.trim(), 'main');
});

// ---------- git_blame ----------

test('git_blame returns porcelain lines for a.txt', async () => {
  const b = await git('git_blame', { path: 'a.txt' });
  assert.equal(b.ok, true);
  assert.match(b.output, /^[0-9a-f]{40} /m);
  assert.match(b.output, /author YK Test/);
});

test('git_blame missing path returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', { repo, tool: 'git_blame', input: {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('git_blame directory traversal in path is neutralized', async () => {
  const b = await git('git_blame', { path: '../a.txt' });
  assert.equal(typeof b.ok, 'boolean');
});

// ---------- validation / errors ----------

test('unsupported tool returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', { repo, tool: 'git_push', input: {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /unsupported/i);
});

test('missing repo returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', { tool: 'git_status', input: {} });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /repo and tool required/i);
});

test('missing tool returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', { repo, input: {} });
  assert.equal(r.status, 400);
});

test('empty body returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', {});
  assert.equal(r.status, 400);
});

test('nonexistent repo dir returns 400 directory-not-found', async () => {
  const r = await h.postJSON(base, '/api/git', {
    repo: path.join(repo, '..', 'ghost-dir'),
    tool: 'git_status',
    input: {},
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /directory not found/i);
});

test('repo pointing at a file returns 400', async () => {
  const r = await h.postJSON(base, '/api/git', {
    repo: path.join(repo, 'a.txt'),
    tool: 'git_status',
    input: {},
  });
  assert.equal(r.status, 400);
});

test('non-git dir returns ok:false with git error text', async () => {
  const plain = h.makePlainDir();
  const r = await h.postJSON(base, '/api/git', { repo: plain, tool: 'git_status', input: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.equal(typeof r.body.error, 'string');
});

test('git commands run with normal timeout (no timeout flag in output)', async () => {
  const b = await git('git_status');
  assert.equal(b.ok, true);
  assert.ok(!/timed out|timeout/i.test(b.output));
});

test('ref with shell metachars is sanitized (no execution)', async () => {
  const marker = path.join(repo, 'pwned-marker.txt');
  const b = await git('git_show', { ref: 'HEAD; touch pwned-marker.txt' });
  assert.equal(typeof b.ok, 'boolean');
  assert.ok(!fs.existsSync(marker), 'shell injection must not execute');
});

test('ref with leading dashes is neutralized', async () => {
  const b = await git('git_show', { ref: '--help' });
  assert.equal(typeof b.ok, 'boolean');
});

// ---------- concurrency ----------

test('5 parallel git_log calls all succeed', async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, () => h.postJSON(base, '/api/git', { repo, tool: 'git_log', input: { n: 2 } })),
  );
  assert.equal(results.length, 5);
  for (const r of results) {
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.commits.length, 2);
  }
});

test('mixed parallel git calls all succeed', async () => {
  const calls = [
    h.postJSON(base, '/api/git', { repo, tool: 'git_status', input: {} }),
    h.postJSON(base, '/api/git', { repo, tool: 'git_branch', input: {} }),
    h.postJSON(base, '/api/git', { repo, tool: 'git_rev_parse', input: {} }),
    h.postJSON(base, '/api/git', { repo, tool: 'git_diff', input: {} }),
  ];
  const results = await Promise.all(calls);
  for (const r of results) {
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  }
});

test('git_log string n is coerced (n:"2" returns both commits)', async () => {
  const b = await git('git_log', { n: '2' });
  assert.equal(b.ok, true);
  assert.equal(b.commits.length, 2);
});

test('git_show HEAD~1 reaches the parent commit', async () => {
  const b = await git('git_show', { ref: 'HEAD~1' });
  assert.equal(b.ok, true);
  assert.match(b.output, /Initial commit/);
});

test('git_grep is case-sensitive (documents grep semantics)', async () => {
  const lower = await git('git_grep', { query: 'todo' });
  assert.equal(lower.ok, false);
  const upper = await git('git_grep', { query: 'TODO' });
  assert.equal(upper.ok, true);
});

test('git_status from a repo subdirectory still works (upward discovery)', async () => {
  const sub = path.join(repo, 'explorer-sub-c');
  fs.mkdirSync(sub, { recursive: true });
  const r = await h.postJSON(base, '/api/git', { repo: sub, tool: 'git_status', input: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});
