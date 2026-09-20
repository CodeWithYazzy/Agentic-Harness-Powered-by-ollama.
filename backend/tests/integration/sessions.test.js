'use strict';
/* File D — sessions persistence. PORT 48141. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers.js');

const PORT = 48141;
let srv;
let base;
let seq = 0;

function sid(tag) {
  seq += 1;
  return `sess-${tag}-${seq}-${Date.now()}`;
}

before(async () => {
  srv = h.startServer(PORT);
  base = srv.base;
  await h.waitForHealth(base);
});

after(async () => {
  await h.stopServer(srv);
});

// ---------- GET shape ----------

test('sessions GET returns 200 with sessions array', async () => {
  const r = await h.getJSON(base, '/api/sessions');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.sessions));
});

test('sessions GET starts empty on fresh DATA_DIR', async () => {
  const fresh = h.startServer(48149);
  try {
    await h.waitForHealth(fresh.base);
    const r = await h.getJSON(fresh.base, '/api/sessions');
    assert.deepEqual(r.body, { sessions: [] });
  } finally {
    await h.stopServer(fresh);
  }
});

test('sessions GET content-type is JSON', async () => {
  const r = await h.getJSON(base, '/api/sessions');
  assert.match(r.contentType, /application\/json/);
});

// ---------- POST validation ----------

test('sessions POST missing id returns 400', async () => {
  const r = await h.postJSON(base, '/api/sessions', { title: 'no id' });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /id required/i);
});

test('sessions POST empty body returns 400', async () => {
  const r = await h.postJSON(base, '/api/sessions', {});
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('sessions POST non-string id returns 400', async () => {
  const r = await h.postJSON(base, '/api/sessions', { id: 42 });
  assert.equal(r.status, 400);
});

test('sessions POST null body returns 400', async () => {
  const r = await h.postJSON(base, '/api/sessions', null);
  assert.equal(r.status, 400);
});

test('sessions POST array body returns 400', async () => {
  const r = await h.postJSON(base, '/api/sessions', [{ id: 'x' }]);
  assert.equal(r.status, 400);
});

// ---------- round-trip ----------

test('sessions POST then GET round-trips the session', async () => {
  const id = sid('roundtrip');
  const s = { id, title: 'hello', messages: [{ role: 'user', content: 'hi' }] };
  const w = await h.postJSON(base, '/api/sessions', s);
  assert.equal(w.status, 200);
  assert.equal(w.body.ok, true);
  const g = await h.getJSON(base, '/api/sessions');
  const found = g.body.sessions.find((x) => x.id === id);
  assert.deepEqual(found, s);
});

test('sessions POST stores full message history verbatim', async () => {
  const id = sid('history');
  const messages = [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' },
    { role: 'user', content: 'three' },
  ];
  await h.postJSON(base, '/api/sessions', { id, messages });
  const g = await h.getJSON(base, '/api/sessions');
  assert.deepEqual(g.body.sessions.find((x) => x.id === id).messages, messages);
});

test('sessions POST stores extra fields verbatim', async () => {
  const id = sid('extra');
  await h.postJSON(base, '/api/sessions', { id, repo: '/tmp/x', model: 'm', custom: { n: 1 } });
  const g = await h.getJSON(base, '/api/sessions');
  const found = g.body.sessions.find((x) => x.id === id);
  assert.equal(found.repo, '/tmp/x');
  assert.equal(found.model, 'm');
  assert.deepEqual(found.custom, { n: 1 });
});

test('new sessions are prepended (unshift order)', async () => {
  const a = sid('order-a');
  const b = sid('order-b');
  await h.postJSON(base, '/api/sessions', { id: a });
  await h.postJSON(base, '/api/sessions', { id: b });
  const g = await h.getJSON(base, '/api/sessions');
  const ia = g.body.sessions.findIndex((x) => x.id === a);
  const ib = g.body.sessions.findIndex((x) => x.id === b);
  assert.ok(ib < ia, 'newer session should come first');
});

test('sessions POST persists to sessions.json on disk', async () => {
  const id = sid('disk');
  await h.postJSON(base, '/api/sessions', { id, title: 'diskcheck' });
  const onDisk = h.readDataFile(srv.dataDir, 'sessions.json');
  assert.ok(onDisk.sessions.some((x) => x.id === id));
});

// ---------- update in place ----------

test('sessions POST with existing id updates in place', async () => {
  const id = sid('update');
  await h.postJSON(base, '/api/sessions', { id, title: 'v1' });
  await h.postJSON(base, '/api/sessions', { id, title: 'v2', extra: true });
  const g = await h.getJSON(base, '/api/sessions');
  const matches = g.body.sessions.filter((x) => x.id === id);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, 'v2');
  assert.equal(matches[0].extra, true);
});

test('update keeps total session count stable', async () => {
  const before = (await h.getJSON(base, '/api/sessions')).body.sessions.length;
  const id = sid('stable');
  await h.postJSON(base, '/api/sessions', { id, n: 1 });
  await h.postJSON(base, '/api/sessions', { id, n: 2 });
  await h.postJSON(base, '/api/sessions', { id, n: 3 });
  const after = (await h.getJSON(base, '/api/sessions')).body.sessions.length;
  assert.equal(after, before + 1);
});

test('update replaces the whole object (old keys vanish)', async () => {
  const id = sid('replace');
  await h.postJSON(base, '/api/sessions', { id, oldKey: 'gone', title: 't' });
  await h.postJSON(base, '/api/sessions', { id, title: 't2' });
  const g = await h.getJSON(base, '/api/sessions');
  const found = g.body.sessions.find((x) => x.id === id);
  assert.ok(!('oldKey' in found));
});

// ---------- DELETE ----------

test('sessions DELETE removes the session', async () => {
  const id = sid('del');
  await h.postJSON(base, '/api/sessions', { id });
  const d = await h.api(base, 'DELETE', `/api/sessions/${id}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.ok, true);
  const g = await h.getJSON(base, '/api/sessions');
  assert.ok(!g.body.sessions.some((x) => x.id === id));
});

test('sessions DELETE persists removal to disk', async () => {
  const id = sid('deldisk');
  await h.postJSON(base, '/api/sessions', { id });
  await h.api(base, 'DELETE', `/api/sessions/${id}`);
  assert.ok(!h.readDataFile(srv.dataDir, 'sessions.json').sessions.some((x) => x.id === id));
});

test('sessions DELETE unknown id still returns ok:true', async () => {
  const d = await h.api(base, 'DELETE', '/api/sessions/does-not-exist-123');
  assert.equal(d.status, 200);
  assert.equal(d.body.ok, true);
});

test('sessions DELETE keeps other sessions intact', async () => {
  const keep = sid('keep');
  const drop = sid('drop');
  await h.postJSON(base, '/api/sessions', { id: keep });
  await h.postJSON(base, '/api/sessions', { id: drop });
  await h.api(base, 'DELETE', `/api/sessions/${drop}`);
  const g = await h.getJSON(base, '/api/sessions');
  assert.ok(g.body.sessions.some((x) => x.id === keep));
});

test('sessions DELETE twice is idempotent', async () => {
  const id = sid('twice');
  await h.postJSON(base, '/api/sessions', { id });
  await h.api(base, 'DELETE', `/api/sessions/${id}`);
  const d2 = await h.api(base, 'DELETE', `/api/sessions/${id}`);
  assert.equal(d2.body.ok, true);
});

// ---------- corrupt store ----------

test('corrupt sessions store (non-array) makes POST return 500 corrupt', async () => {
  const id = sid('corrupt-victim');
  await h.postJSON(base, '/api/sessions', { id });
  h.writeDataFile(srv.dataDir, 'sessions.json', { sessions: 'CORRUPT-NOT-AN-ARRAY' });
  const r = await h.postJSON(base, '/api/sessions', { id: sid('after-corrupt') });
  assert.equal(r.status, 500);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /corrupt/i);
  // restore for later tests
  h.writeDataFile(srv.dataDir, 'sessions.json', { sessions: [] });
});

test('corrupt store makes DELETE return 500 corrupt', async () => {
  h.writeDataFile(srv.dataDir, 'sessions.json', { sessions: 42 });
  const r = await h.api(base, 'DELETE', '/api/sessions/whatever');
  assert.equal(r.status, 500);
  assert.match(r.body.error, /corrupt/i);
  h.writeDataFile(srv.dataDir, 'sessions.json', { sessions: [] });
});

test('non-JSON garbage file is tolerated via fallback (documents readJson behavior)', async () => {
  // readJson() falls back to {sessions:[]} on parse failure, so raw
  // garbage does NOT trigger the 500 path — only valid JSON with a
  // non-array sessions value does (see previous tests).
  h.writeDataFile(srv.dataDir, 'sessions.json', null, 'garbage{{{not json');
  const g = await h.getJSON(base, '/api/sessions');
  assert.equal(g.status, 200);
  assert.deepEqual(g.body, { sessions: [] });
  h.writeDataFile(srv.dataDir, 'sessions.json', { sessions: [] });
});

test('missing sessions value treated as corrupt on POST', async () => {
  h.writeDataFile(srv.dataDir, 'sessions.json', { nope: [] });
  const r = await h.postJSON(base, '/api/sessions', { id: sid('x') });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /corrupt/i);
  h.writeDataFile(srv.dataDir, 'sessions.json', { sessions: [] });
});

// ---------- atomic write ----------

test('file is always valid JSON after 20 rapid sequential POSTs', async () => {
  h.writeDataFile(srv.dataDir, 'sessions.json', { sessions: [] });
  const ids = [];
  for (let i = 0; i < 20; i++) {
    const id = sid(`atomic-${i}`);
    ids.push(id);
    const r = await h.postJSON(base, '/api/sessions', { id, n: i });
    assert.equal(r.body.ok, true);
    // file must parse after every single write (tmp+rename => never half-written)
    const onDisk = h.readDataFile(srv.dataDir, 'sessions.json');
    assert.ok(Array.isArray(onDisk.sessions));
  }
  const g = await h.getJSON(base, '/api/sessions');
  for (const id of ids) assert.ok(g.body.sessions.some((x) => x.id === id), `lost ${id}`);
});

test('no temp files litter DATA_DIR after writes', async () => {
  const fs = require('node:fs');
  const leftovers = fs.readdirSync(srv.dataDir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

// ---------- concurrency ----------

test('10 parallel session POSTs all return ok and file stays valid', async () => {
  // FIXED (was CONTENTION NOTE): writers used to share one tmp path
  // (`sessions.json.<pid>.tmp`), so concurrent renames hit ENOENT → 500.
  // Tmp names are now unique per call: zero failures expected, and the
  // file must always be valid JSON (never half-written).
  h.writeDataFile(srv.dataDir, 'sessions.json', { sessions: [] });
  const ids = Array.from({ length: 10 }, (_, i) => sid(`par-${i}`));
  let non200 = 0;
  async function postWithRetry(id) {
    let last;
    for (let attempt = 0; attempt < 8; attempt++) {
      last = await h.postJSON(base, '/api/sessions', { id });
      if (last.status === 200) return last;
      non200++;
      assert.equal(last.body.error, 'could not save session');
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
    return last;
  }
  const results = await Promise.all(ids.map(postWithRetry));
  for (const r of results) {
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  }
  // unique tmp names: no write should ever have failed
  assert.equal(non200, 0);
  const onDisk = h.readDataFile(srv.dataDir, 'sessions.json');
  assert.ok(Array.isArray(onDisk.sessions));
  assert.ok(onDisk.sessions.length >= 1);
});

test('parallel POST + GET race never yields invalid JSON', async () => {
  // FIXED (was HEAVY-CONTENTION NOTE): unique tmp names removed the 500s.
  // Every response must be 200 and the file must always parse.
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(h.postJSON(base, '/api/sessions', { id: sid(`race-${i}`) }));
    jobs.push(h.getJSON(base, '/api/sessions'));
  }
  const results = await Promise.all(jobs);
  for (const r of results) {
    assert.equal(r.status, 200);
  }
  const onDisk = h.readDataFile(srv.dataDir, 'sessions.json');
  assert.ok(Array.isArray(onDisk.sessions));
});

// ---------- misc ----------

test('unicode session content round-trips intact', async () => {
  const id = sid('unicode');
  const title = 'héllo wörld — mid · test';
  await h.postJSON(base, '/api/sessions', { id, title });
  const g = await h.getJSON(base, '/api/sessions');
  assert.equal(g.body.sessions.find((x) => x.id === id).title, title);
});

test('large session (1000 messages) stores and retrieves', async () => {
  const id = sid('large');
  const messages = Array.from({ length: 1000 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  const w = await h.postJSON(base, '/api/sessions', { id, messages });
  assert.equal(w.body.ok, true);
  const g = await h.getJSON(base, '/api/sessions');
  assert.equal(g.body.sessions.find((x) => x.id === id).messages.length, 1000);
});

test('session POST responds in under 1s', async () => {
  const t0 = Date.now();
  const r = await h.postJSON(base, '/api/sessions', { id: sid('perf') });
  assert.equal(r.body.ok, true);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`);
});

test('invalid JSON body on sessions returns 400 JSON', async () => {
  const r = await h.api(base, 'POST', '/api/sessions', '{"id":', {
    headers: { 'Content-Type': 'application/json' },
    raw: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.contentType, /application\/json/);
});

test('sessions.json is created in DATA_DIR on boot', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  assert.ok(fs.existsSync(path.join(srv.dataDir, 'sessions.json')));
});

test('update keeps the session at its original position (in-place replace)', async () => {
  h.writeDataFile(srv.dataDir, 'sessions.json', { sessions: [] });
  const a = sid('pos-a');
  const b = sid('pos-b');
  await h.postJSON(base, '/api/sessions', { id: a });
  await h.postJSON(base, '/api/sessions', { id: b });
  await h.postJSON(base, '/api/sessions', { id: a, title: 'updated' });
  const g = await h.getJSON(base, '/api/sessions');
  const order = g.body.sessions.map((x) => x.id);
  assert.deepEqual(order.slice(0, 2), [b, a]);
  assert.equal(g.body.sessions.find((x) => x.id === a).title, 'updated');
});

test('session id with spaces round-trips and deletes via URL encoding', async () => {
  const id = `sp ace ${sid('sp')}`;
  await h.postJSON(base, '/api/sessions', { id, title: 'spaces' });
  const d = await h.api(base, 'DELETE', `/api/sessions/${encodeURIComponent(id)}`);
  assert.equal(d.body.ok, true);
  const g = await h.getJSON(base, '/api/sessions');
  assert.ok(!g.body.sessions.some((x) => x.id === id));
});

test('session id with slash does not match the DELETE route (documents :id segment)', async () => {
  const r = await h.api(base, 'DELETE', '/api/sessions/a/b');
  assert.equal(r.status, 404);
});

test('sessions GET body has exactly the sessions key', async () => {
  const r = await h.getJSON(base, '/api/sessions');
  assert.deepEqual(Object.keys(r.body), ['sessions']);
});

test('session with 1001 messages is rejected (H8 cap)', async () => {
  const messages = Array.from({ length: 1001 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const r = await h.postJSON(base, '/api/sessions', { id: sid('toomany'), messages });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /1000/);
});

test('session with malformed messages is rejected (H8 shape)', async () => {
  const bad = await h.postJSON(base, '/api/sessions', { id: sid('badmsg'), messages: [{ role: 'user' }] });
  assert.equal(bad.status, 400);
  const bad2 = await h.postJSON(base, '/api/sessions', { id: sid('badmsg2'), messages: 'nope' });
  assert.equal(bad2.status, 400);
});

test('session with blank/oversize id is rejected (H8 shape)', async () => {
  assert.equal((await h.postJSON(base, '/api/sessions', { id: '' })).status, 400);
  assert.equal((await h.postJSON(base, '/api/sessions', { id: 'x'.repeat(201) })).status, 400);
});
