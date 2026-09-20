'use strict';
/* Shared helpers for the YK-Harness bridge HTTP integration suites.
 * Each test file forks its own server on a unique PORT with a fresh
 * temp OLLAMA_DESKTOP_DATA dir (never touches ~/.ollama-desktop).
 */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'yk-test-'));
}

function startServer(port) {
  const dataDir = tempDir('yk-data-');
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), OLLAMA_DESKTOP_DATA: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
  return {
    child,
    dataDir,
    base: `http://127.0.0.1:${port}`,
    port,
    stderr: () => stderr,
  };
}

async function waitForHealth(base, timeoutMs) {
  const timeout = timeoutMs || 20000;
  const t0 = Date.now();
  let lastErr = '';
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) {
        await r.json();
        return;
      }
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = String((e && e.message) || e);
    }
    if (Date.now() - t0 > timeout) throw new Error(`health timeout for ${base}: ${lastErr}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function stopServer(srv) {
  if (!srv || !srv.child || srv.child.killed) return;
  const done = new Promise((resolve) => {
    srv.child.once('exit', () => resolve());
    setTimeout(resolve, 5000);
  });
  try { srv.child.kill(); } catch { /* ignore */ }
  await done;
}

/* Generic HTTP call against the forked server.
 * Returns { status, headers, body, raw, contentType }.
 * body is parsed JSON when possible, otherwise raw text.
 */
async function api(base, method, p, body, extra) {
  const headers = { ...(extra && extra.headers) };
  let rawBody;
  if (body !== undefined && !(extra && extra.raw)) {
    headers['Content-Type'] = 'application/json';
    rawBody = JSON.stringify(body);
  } else if (body !== undefined) {
    rawBody = body;
  }
  const r = await fetch(base + p, {
    method,
    headers,
    body: rawBody,
    signal: extra && extra.signal,
  });
  const text = await r.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return {
    status: r.status,
    headers: r.headers,
    body: parsed,
    raw: text,
    contentType: r.headers.get('content-type') || '',
  };
}

function getJSON(base, p, extra) {
  return api(base, 'GET', p, undefined, extra);
}

function postJSON(base, p, body, extra) {
  return api(base, 'POST', p, body, extra);
}

const DEFAULTS = {
  localEndpoint: 'http://localhost:11434',
  cloudEndpoint: 'https://ollama.com',
  cloudKey: '',
  defaultModel: '',
  defaultReasoning: 'Medium',
  toolPolicy: {},
  hooks: [],
  mcpServers: {},
  customCommands: [],
};

async function resetConfig(base) {
  const r = await postJSON(base, '/api/config', { ...DEFAULTS });
  if (r.status !== 200 || !r.body.ok) throw new Error(`resetConfig failed: ${r.status} ${r.raw}`);
  return r;
}

async function getConfig(base) {
  const r = await getJSON(base, '/api/config');
  if (r.status !== 200) throw new Error(`getConfig failed: ${r.status} ${r.raw}`);
  return r.body;
}

function readDataFile(dataDir, name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
}

function writeDataFile(dataDir, name, value, rawText) {
  fs.writeFileSync(
    path.join(dataDir, name),
    rawText !== undefined ? rawText : JSON.stringify(value, null, 2),
  );
}

/* Build a real git fixture: 2 commits on main, a second branch with
 * 1 commit, a staged rename, a dirty unstaged edit, and an untracked file.
 */
function makeGitRepo() {
  const dir = tempDir('yk-repo-');
  const id = ['-c', 'user.email=yk@test.com', '-c', 'user.name=YK Test'];
  const run = (args) => execFileSync('git', [...id, ...args], { cwd: dir, stdio: 'pipe' });
  run(['init', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello world\nTODO: fix the widget\nline three\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'second file\n');
  run(['add', '.']);
  run(['commit', '-m', 'Initial commit']);
  fs.writeFileSync(
    path.join(dir, 'a.txt'),
    'hello world\nTODO: fix the widget\nline three\nsecond line added\n',
  );
  run(['add', 'a.txt']);
  run(['commit', '-m', 'Update a.txt with more content']);
  run(['checkout', '-b', 'feature']);
  fs.writeFileSync(path.join(dir, 'c.txt'), 'feature work\n');
  run(['add', 'c.txt']);
  run(['commit', '-m', 'Add feature file']);
  run(['checkout', 'main']);
  run(['mv', 'b.txt', 'b-renamed.txt']); // staged rename
  fs.appendFileSync(path.join(dir, 'a.txt'), 'dirty uncommitted change\n'); // dirty
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'untracked content\n'); // untracked
  return dir;
}

function makePlainDir() {
  const dir = tempDir('yk-plain-');
  fs.writeFileSync(path.join(dir, 'note.txt'), 'just a plain dir\n');
  return dir;
}

/* Collect an SSE (text/event-stream) response until the server ends it.
 * Resolves { events, raw, status, contentType }. Rejects (abort) if the
 * stream does not end within timeoutMs — proving the "not hang" assertions.
 */
async function readSSE(url, opts, body) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs || 30000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: o.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...(o.headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: o.signal || ctrl.signal,
    });
    const text = await r.text();
    const events = [];
    for (const chunk of text.split('\n\n')) {
      for (const line of chunk.split('\n')) {
        const m = line.match(/^data:\s*([\s\S]*)$/);
        if (m) {
          try { events.push(JSON.parse(m[1])); } catch { events.push({ _raw: m[1] }); }
        }
      }
    }
    return { events, raw: text, status: r.status, contentType: r.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

/* Write a tiny stdio JSON-RPC fake MCP server; returns its file path.
 * Speaks newline-delimited JSON-RPC: initialize -> {}, tools/list -> [echo],
 * tools/call -> echo-ok text.
 */
function writeFakeMcpServer(dir) {
  const file = path.join(dir || tempDir('yk-mcp-'), 'fake-mcp.js');
  fs.writeFileSync(file, `'use strict';
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    reply(msg.id, { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake', version: '1.0' } });
  } else if (msg.method === 'tools/list') {
    reply(msg.id, { tools: [{ name: 'echo', description: 'Echo tool', inputSchema: { type: 'object' } }] });
  } else if (msg.method === 'tools/call') {
    reply(msg.id, { content: [{ type: 'text', text: 'echo-ok' }] });
  } else if (msg.id !== undefined) {
    reply(msg.id, {});
  }
});
`);
  return file;
}

/* Poll GET /api/mcp until a server reaches a status, or timeout. */
async function waitForMcpStatus(base, name, want, timeoutMs) {
  const timeout = timeoutMs || 25000;
  const t0 = Date.now();
  for (;;) {
    const r = await getJSON(base, '/api/mcp');
    const s = (r.body.servers || []).find((x) => x.name === name);
    if (s && (Array.isArray(want) ? want.includes(s.status) : s.status === want)) return s;
    if (Date.now() - t0 > timeout) {
      throw new Error(`mcp status timeout for ${name}: ${JSON.stringify(r.body)}`);
    }
    await new Promise((r2) => setTimeout(r2, 250));
  }
}

module.exports = {
  SERVER,
  DEFAULTS,
  tempDir,
  startServer,
  stopServer,
  waitForHealth,
  api,
  getJSON,
  postJSON,
  resetConfig,
  getConfig,
  readDataFile,
  writeDataFile,
  makeGitRepo,
  makePlainDir,
  readSSE,
  writeFakeMcpServer,
  waitForMcpStatus,
};
