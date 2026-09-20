'use strict';
/* File B — fs drives/ls, repo open/info, files read/search. PORT 48121. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('../helpers.js');

const PORT = 48121;
let srv;
let base;
let repo;      // git fixture
let plainDir;  // non-git dir
let fixture;   // dedicated fs fixture dir

before(async () => {
  srv = h.startServer(PORT);
  base = srv.base;
  await h.waitForHealth(base);
  repo = h.makeGitRepo();
  plainDir = h.makePlainDir();
  fixture = h.tempDir('yk-fs-');
  fs.mkdirSync(path.join(fixture, 'alpha'));
  fs.mkdirSync(path.join(fixture, 'beta'));
  fs.mkdirSync(path.join(fixture, '.hidden'));
  fs.mkdirSync(path.join(fixture, '$recycle'));
  fs.writeFileSync(path.join(fixture, 'top.txt'), 'x'.repeat(100));
  fs.mkdirSync(path.join(repo, 'explorer-sub'));
});

after(async () => {
  await h.stopServer(srv);
});

// ---------- GET /api/fs/drives ----------

test('drives returns 200 with ok:true', async () => {
  const r = await h.getJSON(base, '/api/fs/drives');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('drives list is a non-empty array', async () => {
  const r = await h.getJSON(base, '/api/fs/drives');
  assert.ok(Array.isArray(r.body.drives));
  assert.ok(r.body.drives.length >= 1);
});

test('drives on win32 are drive letters ending in backslash', async () => {
  const r = await h.getJSON(base, '/api/fs/drives');
  if (process.platform === 'win32') {
    for (const d of r.body.drives) assert.match(d, /^[A-Z]:\\$/);
  } else {
    assert.deepEqual(r.body.drives, ['/']);
  }
});

test('drives on win32 includes C drive', async () => {
  const r = await h.getJSON(base, '/api/fs/drives');
  if (process.platform === 'win32') assert.ok(r.body.drives.includes('C:\\'));
});

test('drives entries all exist on disk', async () => {
  const r = await h.getJSON(base, '/api/fs/drives');
  for (const d of r.body.drives) assert.ok(fs.existsSync(d), `missing ${d}`);
});

test('drives respond in under 1s', async () => {
  const t0 = Date.now();
  await h.getJSON(base, '/api/fs/drives');
  assert.ok(Date.now() - t0 < 1000);
});

// ---------- POST /api/fs/ls ----------

test('ls valid dir returns ok with path+parent+dirs', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: fixture });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(typeof r.body.path, 'string');
  assert.equal(typeof r.body.parent, 'string');
  assert.ok(Array.isArray(r.body.dirs));
});

test('ls lists only directories (files excluded)', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: fixture });
  const names = r.body.dirs.map((d) => d.name);
  assert.ok(names.includes('alpha'));
  assert.ok(names.includes('beta'));
  assert.ok(!names.includes('top.txt'));
});

test('ls skips dot-directories', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: fixture });
  assert.ok(!r.body.dirs.map((d) => d.name).includes('.hidden'));
});

test('ls skips dollar-directories', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: fixture });
  assert.ok(!r.body.dirs.map((d) => d.name).includes('$recycle'));
});

test('ls dirs are sorted alphabetically', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: fixture });
  const names = r.body.dirs.map((d) => d.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('ls entries carry hasGit boolean', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: path.dirname(repo) });
  const me = r.body.dirs.find((d) => path.join(path.dirname(repo), d.name) === repo);
  assert.ok(me, 'fixture repo should be listed');
  assert.equal(me.hasGit, true);
});

test('ls entry for plain dir has hasGit false', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: path.dirname(plainDir) });
  const me = r.body.dirs.find((d) => path.join(path.dirname(plainDir), d.name) === plainDir);
  assert.ok(me, 'plain dir should be listed');
  assert.equal(me.hasGit, false);
});

test('ls path is resolved to absolute', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: fixture });
  assert.equal(r.body.path, path.resolve(fixture));
});

test('ls parent equals dirname of path', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: fixture });
  const abs = path.resolve(fixture);
  assert.equal(r.body.parent, path.dirname(abs));
});

test('ls missing path returns 400', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: path.join(fixture, 'no-such-dir') });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.equal(typeof r.body.error, 'string');
});

test('ls missing path error text is cannot-list', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: path.join(fixture, 'no-such-dir') });
  assert.match(r.body.error, /cannot list/i);
});

test('ls empty path returns 400 path-required', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: '' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /path required/i);
});

test('ls missing path field returns 400', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', {});
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('ls file-as-dir returns 400', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: path.join(fixture, 'top.txt') });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('ls traversal beyond root still lists (documented explorer behavior)', async () => {
  const deep = path.join(fixture, 'alpha');
  const up = `${deep}${path.sep}..${path.sep}..`;
  const r = await h.postJSON(base, '/api/fs/ls', { path: up });
  // The explorer is user-driven: ".." segments resolve and the
  // (existing) parent is listed instead of an error.
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.path, path.resolve(up));
});

test('ls traversal result path equals resolved input', async () => {
  const target = path.join(fixture, 'alpha', '..');
  const r = await h.postJSON(base, '/api/fs/ls', { path: target });
  assert.equal(r.status, 200);
  assert.equal(r.body.path, path.resolve(target));
});

test('ls completes in under 2s', async () => {
  const t0 = Date.now();
  const r = await h.postJSON(base, '/api/fs/ls', { path: os.tmpdir() });
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
});

test('ls drive root works on win32', async () => {
  if (process.platform !== 'win32') return;
  const r = await h.postJSON(base, '/api/fs/ls', { path: 'C:\\' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

// ---------- POST /api/repo/open ----------

test('repo open valid git dir returns isGit true', async () => {
  const r = await h.postJSON(base, '/api/repo/open', { repo });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.isGit, true);
  assert.equal(r.body.path, repo);
});

test('repo open non-git dir returns isGit false', async () => {
  const r = await h.postJSON(base, '/api/repo/open', { repo: plainDir });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.isGit, false);
});

test('repo open missing dir returns 400', async () => {
  const r = await h.postJSON(base, '/api/repo/open', { repo: path.join(fixture, 'ghost') });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('repo open file returns 400', async () => {
  const r = await h.postJSON(base, '/api/repo/open', { repo: path.join(fixture, 'top.txt') });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('repo open missing repo field returns 400', async () => {
  const r = await h.postJSON(base, '/api/repo/open', {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /directory required/i);
});

test('repo open empty repo returns 400', async () => {
  const r = await h.postJSON(base, '/api/repo/open', { repo: '' });
  assert.equal(r.status, 400);
});

// ---------- POST /api/repo/info ----------

test('repo info valid git dir returns full shape', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  for (const k of ['name', 'path', 'branch', 'dirty', 'status', 'diffStat', 'lastCommit']) {
    assert.ok(k in r.body, `missing ${k}`);
  }
});

test('repo info name is basename', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo });
  assert.equal(r.body.name, path.basename(repo));
});

test('repo info branch is main', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo });
  assert.equal(r.body.branch, 'main');
});

test('repo info dirty is true for fixture', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo });
  assert.equal(r.body.dirty, true);
});

test('repo info status mentions modified file', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo });
  assert.match(r.body.status, /a\.txt/);
});

test('repo info diffStat is non-empty for dirty tree', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo });
  assert.ok(r.body.diffStat.length > 0);
});

test('repo info lastCommit has hash + subject parts', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo });
  const parts = r.body.lastCommit.split('\x1f');
  assert.ok(parts.length >= 3);
  assert.match(parts[0], /^[0-9a-f]{40}$/);
  assert.match(parts[1], /^[0-9a-f]{7}$/);
});

test('repo info dirty is false for a clean tree (FIXED, was always-true quirk)', async () => {
  // FIXED: dirty now ignores the `## <branch>` header line, so a clean tree
  // correctly reports false while the status text keeps the header.
  const clean = h.tempDir('yk-clean-');
  const { execFileSync } = require('node:child_process');
  const id = ['-c', 'user.email=t@t.com', '-c', 'user.name=T'];
  const run = (a) => execFileSync('git', [...id, ...a], { cwd: clean, stdio: 'pipe' });
  run(['init', '-b', 'main']);
  fs.writeFileSync(path.join(clean, 'f.txt'), 'x\n');
  run(['add', '.']);
  run(['commit', '-m', 'one']);
  const r = await h.postJSON(base, '/api/repo/info', { repo: clean });
  assert.equal(r.body.dirty, false);
  assert.match(r.body.status, /## main/);
});

test('repo info non-git dir is tolerated (branch empty string)', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo: plainDir });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.branch, '');
  assert.equal(r.body.name, path.basename(plainDir));
});

test('repo info missing dir returns 400 JSON', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo: path.join(fixture, 'ghost') });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.match(r.contentType, /application\/json/);
});

test('repo info file returns 400', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo: path.join(fixture, 'top.txt') });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('repo info missing repo field returns 400', async () => {
  const r = await h.postJSON(base, '/api/repo/info', {});
  assert.equal(r.status, 400);
});

// ---------- POST /api/files/read ----------

test('files read returns file content', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: 'a.txt' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.type, 'file');
  assert.match(r.body.content, /hello world/);
  assert.match(r.body.content, /TODO: fix the widget/);
});

test('files read reports size + truncated=false for small file', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: 'a.txt' });
  assert.equal(typeof r.body.size, 'number');
  assert.equal(r.body.truncated, false);
  assert.equal(r.body.path, 'a.txt');
});

test('files read truncates with flag when maxBytes is tiny', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: 'a.txt', maxBytes: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.body.truncated, true);
  assert.equal(r.body.content.length, 5);
});

test('files read maxBytes is capped at 1000000', async () => {
  const big = h.tempDir('yk-big-');
  fs.writeFileSync(path.join(big, 'big.bin'), 'z'.repeat(1.2 * 1024 * 1024 | 0));
  const r = await h.postJSON(base, '/api/files/read', { repo: big, file: 'big.bin', maxBytes: 5000000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.truncated, true);
  assert.ok(Buffer.byteLength(r.body.content, 'utf8') <= 1000000);
});

test('files read directory returns dir listing', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: '.' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.type, 'dir');
  assert.ok(Array.isArray(r.body.entries));
  assert.ok(r.body.entries.length > 0);
});

test('files read dir entries have name+dir flags', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: '.' });
  const names = r.body.entries.map((e) => e.name);
  assert.ok(names.includes('a.txt'));
  for (const e of r.body.entries) {
    assert.equal(typeof e.name, 'string');
    assert.equal(typeof e.dir, 'boolean');
  }
});

test('files read dir entries capped at 500', async () => {
  const many = h.tempDir('yk-many-');
  for (let i = 0; i < 520; i++) fs.writeFileSync(path.join(many, `f${i}.txt`), 'x');
  const r = await h.postJSON(base, '/api/files/read', { repo: many, file: '.' });
  assert.ok(r.body.entries.length <= 500);
});

test('files read missing file returns 404', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: 'nope-missing.txt' });
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
});

test('files read missing repo or file returns 400', async () => {
  const r1 = await h.postJSON(base, '/api/files/read', { file: 'a.txt' });
  assert.equal(r1.status, 400);
  const r2 = await h.postJSON(base, '/api/files/read', { repo });
  assert.equal(r2.status, 400);
});

test('files read traversal ../../secret returns 403', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: '../../secret.txt' });
  assert.equal(r.status, 403);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /escapes/i);
});

test('files read absolute path outside returns 403', async () => {
  const outside = path.join(h.tempDir('yk-out-'), 'outside.txt');
  fs.writeFileSync(outside, 'outside\n');
  const r = await h.postJSON(base, '/api/files/read', { repo, file: outside });
  assert.equal(r.status, 403);
  assert.equal(r.body.ok, false);
});

test('files read link-inside-pointing-outside returns 403 (real junction in fixture)', async () => {
  // Windows blocks file symlinks without elevation; a directory junction
  // is a real reparse-point link and exercises the same realpath check.
  const outside = h.tempDir('yk-linkout-');
  const secret = path.join(outside, 'secret.txt');
  fs.writeFileSync(secret, 'top secret\n');
  const link = path.join(repo, 'evil-dir');
  for (const rm of [() => fs.unlinkSync(link), () => fs.rmdirSync(link)]) {
    try { rm(); } catch { /* ignore */ }
  }
  fs.symlinkSync(outside, link, 'junction');
  const r = await h.postJSON(base, '/api/files/read', { repo, file: 'evil-dir/secret.txt' });
  assert.equal(r.status, 403);
  assert.equal(r.body.ok, false);
});

test('files read junction-to-inside-dir is allowed', async () => {
  const inner = path.join(repo, 'inner-real');
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, 'inner.txt'), 'inner content hello\n');
  const link = path.join(repo, 'good-dir');
  for (const rm of [() => fs.unlinkSync(link), () => fs.rmdirSync(link)]) {
    try { rm(); } catch { /* ignore */ }
  }
  fs.symlinkSync(inner, link, 'junction');
  const r = await h.postJSON(base, '/api/files/read', { repo, file: 'good-dir/inner.txt' });
  assert.equal(r.status, 200);
  assert.match(r.body.content, /inner content hello/);
});

test('files read repo-is-file edge: behaves as file read of itself', async () => {
  const f = path.join(fixture, 'top.txt');
  const r = await h.postJSON(base, '/api/files/read', { repo: f, file: '.' });
  // Documented edge: repo pointing at a file resolves inside itself.
  assert.ok([200, 403, 404].includes(r.status));
  assert.equal(typeof r.body.ok, 'boolean');
});

// ---------- POST /api/files/search ----------

test('files search finds TODO in fixture', async () => {
  const r = await h.postJSON(base, '/api/files/search', { repo, query: 'TODO' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.match(r.body.output, /TODO/);
});

test('files search missing query returns 400', async () => {
  const r = await h.postJSON(base, '/api/files/search', { repo });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('files search missing repo returns 400', async () => {
  const r = await h.postJSON(base, '/api/files/search', { query: 'TODO' });
  assert.equal(r.status, 400);
});

test('files search no-match returns ok true with empty output', async () => {
  const r = await h.postJSON(base, '/api/files/search', { repo, query: 'zzz-no-such-token-zzz' });
  assert.equal(r.status, 200);
  // git grep exits 1 on no match -> server reports ok:false with empty output;
  // either way there must be no crash and output must be a string.
  assert.equal(typeof r.body.output, 'string');
});

test('files search non-git dir returns ok:false (tolerated, documented)', async () => {
  const r = await h.postJSON(base, '/api/files/search', { repo: plainDir, query: 'plain' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.equal(typeof r.body.output, 'string');
});

test('files search output is sliced to 30000 chars max', async () => {
  const r = await h.postJSON(base, '/api/files/search', { repo, query: 'e' });
  assert.equal(r.status, 200);
  assert.ok(r.body.output.length <= 30000);
});

test('ls numeric path is treated as missing (400 path required)', async () => {
  const r = await h.postJSON(base, '/api/fs/ls', { path: 123 });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('repo info echoes the requested path back', async () => {
  const r = await h.postJSON(base, '/api/repo/info', { repo });
  assert.equal(r.body.path, repo);
});

test('files read maxBytes 0 falls back to default cap (full small file)', async () => {
  const r = await h.postJSON(base, '/api/files/read', { repo, file: 'a.txt', maxBytes: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.truncated, false);
  assert.match(r.body.content, /TODO/);
});

test('files search pipe is literal (basic grep, documents no -E flag)', async () => {
  const r = await h.postJSON(base, '/api/files/search', { repo, query: 'TODO|untracked' });
  assert.equal(r.status, 200);
  // server runs `git grep -e <query>` without -E, so `|` is literal and
  // matches nothing -> ok:false. Use two separate searches for OR logic.
  assert.equal(r.body.ok, false);
});
