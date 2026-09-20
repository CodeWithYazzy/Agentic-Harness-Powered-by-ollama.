'use strict';
// Shared E2E harness: forked test backend + in-test mock Ollama + playwright helpers.
// NEVER touches prod: backend on :47921 with fresh temp DATA_DIR; mock on 127.0.0.1 random port.
const { fork } = require('child_process');
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const BACKEND_PORT = 47921;
const BASE = `http://127.0.0.1:${BACKEND_PORT}`;
// location-independent: derived from this file's dir (backend/tests/e2e)
const BACKEND_DIR = path.join(__dirname, '..', '..');
const SERVER_JS = path.join(BACKEND_DIR, 'server.js');
const FRONTEND_DIST = path.join(BACKEND_DIR, '..', 'frontend', 'dist');
const CHROME = process.env.E2E_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PWCORE = path.join(BACKEND_DIR, '..', 'frontend', 'node_modules', 'playwright-core');
const SHOTS = path.join(BACKEND_DIR, 'tests', 'e2e', 'shots');

function pw() { return require(PWCORE); }

function mkTemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------- mock Ollama ----------
const MOCK_MODELS = [
  {
    name: 'e2e-model-a:latest', model: 'e2e-model-a:latest',
    size: 4200000000, digest: 'sha256:aaaa', modified_at: '2026-01-01T00:00:00Z',
    details: { parameter_size: '7B', quantization_level: 'Q4_0', family: 'e2e', capabilities: ['thinking', 'completion'] },
  },
  {
    name: 'e2e-model-b:latest', model: 'e2e-model-b:latest',
    size: 1500000000, digest: 'sha256:bbbb', modified_at: '2026-01-02T00:00:00Z',
    details: { parameter_size: '3B', quantization_level: 'Q4_0', family: 'e2e', capabilities: ['completion'] },
  },
];

function toolSection(prompt) {
  const m = String(prompt || '').match(/<tool-results>([\s\S]*?)<\/tool-results>/);
  return m ? m[1].slice(0, 1500) : '';
}

function realFilesFrom(sec) {
  const out = [];
  for (const ln of sec.split('\n')) {
    const t = ln.trim().replace(/^TOOL\s+\S+\s*(\(ok\)|\(failed\))?:\s*/i, '');
    if (/^[A-Za-z0-9_\-./]{1,120}\.[A-Za-z0-9]{1,5}$/.test(t) && !t.includes(' ') && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 12);
}

function slowAnswer() {
  const parts = [];
  for (let i = 1; i <= 70; i++) parts.push(`slow token number ${i} of the background run continues steadily`);
  return parts.join('. ') + '. Background slow run finished.';
}

// Non-streaming decision pass: script tool calls so the backend tool loop runs for real.
// Intent is matched ONLY against the user transcript (the system prompt itself
// describes every tool, so matching the full combined text misfires).
function mockDecision(system, prompt) {
  const bits = (String(prompt || '').match(/User:\s*([^\n]{1,300})/g) || []).join(' ').toLowerCase();
  const extra = String(prompt || '').toLowerCase();
  if (/<tool-results>/.test(extra)) return 'I have the tool results in context. I will now compose the final answer.';
  const strictRetry = /must contain ONLY tool call blocks/.test(String(system || '') + '\n' + String(prompt || ''));
  const wantAsk = /ask_user|clarify/.test(bits);
  const wantWrite = /file_write|create file/.test(bits);
  const wantRead = /read package\.json/.test(bits);
  const wantGlob = /glob|list files/.test(bits);
  if (wantAsk || (strictRetry && /clarify|ask/.test(bits))) {
    return 'I need clarification first.\n```tool\n{"name":"ask_user","input":{"questions":[{"question":"Which file should I read first?","options":[{"label":"Option Alpha","description":"Read the first file"},{"label":"Option Beta","description":"Read the second file"}]}]}}\n```';
  }
  if (wantWrite) return 'Creating the requested file.\n```tool\n{"name":"file_write","input":{"path":"hello.txt","content":"hello world from e2e"}}\n```';
  if (wantRead) return 'Reading the requested file.\n```tool\n{"name":"file_read","input":{"path":"package.json"}}\n```';
  // NOTE: '**/*' is avoided on purpose — backend globToRegExp miscompiles it
  // (the '?' substitution eats the '(.*/)?' quantifier, forcing a subdir level;
  // reported as a prod bug). '*' + '*/*' honestly covers top level + one down.
  if (wantGlob) return 'Listing files with glob.\n```tool\n{"name":"glob","input":{"pattern":"*"}}\n```\n```tool\n{"name":"glob","input":{"pattern":"*/*"}}\n```';
  if (strictRetry) return 'Listing files with glob.\n```tool\n{"name":"glob","input":{"pattern":"*"}}\n```\n```tool\n{"name":"glob","input":{"pattern":"*/*"}}\n```';
  return 'Hello! This is a scripted mock reply with no tool calls.';
}

// Streaming final-answer pass: echo real tool context so answers contain real repo data.
function mockAnswer(system, prompt) {
  const combined = `${system || ''}\n${prompt || ''}`;
  if (/DURABLE project facts/i.test(combined)) return 'none';
  if (/finished chat transcript|filled template/i.test(combined)) {
    return 'Goals: verify e2e behavior end to end\nDecisions: none\nFiles: none\nState: active session under test\nTodos: none';
  }
  if (/SLOWMARK/.test(combined)) return slowAnswer();
  const sec = toolSection(prompt || '');
  if (/TOOL glob/i.test(combined) && sec) {
    const files = realFilesFrom(sec);
    const list = files.length ? files.join(', ') : sec.slice(0, 300);
    return `Found ${files.length || 'several'} files via glob tool. The listing shows ${list}. Listing is complete and no further lookup is needed. Tell me which file to open next.`;
  }
  if (/TOOL file_read/i.test(combined) && sec) {
    return `Read package.json successfully through the file_read tool. The excerpt from context confirms the content. Tool round trip is done and the content was verified. Ask for any other file next.`;
  }
  if (/TOOL file_write/i.test(combined)) {
    const denied = /denied/i.test(sec);
    if (denied) return 'The file write was denied by policy. No file was created on disk. The denial was recorded and the run stopped cleanly.';
    return 'Created hello.txt successfully through the file_write tool. The write was confirmed on disk. The task is finished with no further steps.';
  }
  if (/user answers/i.test(combined)) return 'Thanks for answering the clarifying question. I will continue with your chosen option now. The run completes after this final note.';
  if (/Explain the relevant code in/i.test(combined)) {
    const idx = combined.indexOf('Code:');
    const excerpt = (idx >= 0 ? combined.slice(idx + 5, idx + 800) : combined.slice(0, 400)).replace(/\s+/g, ' ').trim();
    return `Explained package.json for the request. Real excerpt from disk: ${excerpt.slice(0, 500)} The explanation above quotes actual file content. Request handling is complete.`;
  }
  if (/Summarize these \d+ git commits/i.test(combined)) return 'Summarized the git commits from the repository history. Each hash kept its subject line. Summary is complete for review.';
  if (/Explain commit/i.test(combined)) return 'Explained the commit from the git show output. Author intent and files are covered above. Commit review is complete.';
  const lastUser = (String(prompt || '').match(/User:\s*([^\n]{1,160})/) || [])[1] || 'your request';
  return `Mock answer for ${lastUser}. The scripted backend replied promptly. No real model was used for this response.`;
}

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const send = (code, obj) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        if (url.pathname === '/api/tags' && (req.method === 'GET' || req.method === 'POST')) {
          return send(200, { models: MOCK_MODELS });
        }
        if (url.pathname === '/api/show' && req.method === 'POST') {
          let name = '';
          try { name = JSON.parse(body || '{}').name || ''; } catch { /* ignore */ }
          const m = MOCK_MODELS.find((x) => x.name === name) || MOCK_MODELS[0];
          return send(200, { details: m.details, capabilities: m.details.capabilities });
        }
        if (url.pathname === '/api/ps') return send(200, { models: [] });
        if (url.pathname === '/api/generate' && req.method === 'POST') {
          let b = {};
          try { b = JSON.parse(body || '{}'); } catch { return send(400, { error: 'bad json' }); }
          if (typeof b.model === 'string' && b.model.includes('need-auth')) return send(401, { error: 'unauthorized: invalid key' });
          if (typeof b.model === 'string' && b.model.includes('need-limit')) return send(429, { error: 'quota exceeded: upgrade plan' });
          if (b.stream === false) {
            return send(200, { response: mockDecision(b.system, b.prompt), done: true });
          }
          // streaming NDJSON with slight delays; slow when SLOWMARK present.
          // NOTE: never gate on req.destroyed — modern clients auto-destroy the
          // *request* stream right after 'end' while the response stays writable.
          const answer = mockAnswer(b.system, b.prompt);
          const slow = /SLOWMARK/.test(`${b.system || ''}\n${b.prompt || ''}`);
          const words = answer.split(/(\s+)/).filter((w) => w.length);
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          let i = 0;
          let clientGone = false;
          res.on('close', () => { clientGone = true; });
          const step = () => {
            if (clientGone || res.writableEnded || res.destroyed) return;
            if (i < words.length) {
              res.write(JSON.stringify({ response: words[i] }) + '\n');
              i++;
              setTimeout(step, slow ? 400 : 12);
            } else {
              res.write(JSON.stringify({ done: true, eval_count: 42 }) + '\n');
              res.end();
            }
          };
          step();
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'mock: unknown route' }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

// ---------- backend ----------
function api(base, method, p, body) {
  return fetch(`${base}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => r.json());
}
const getConfig = (base) => api(base, 'GET', '/api/config');
const setConfig = (base, obj) => api(base, 'POST', '/api/config', obj);

async function resetState(base, dataDir, mockUrl) {
  await setConfig(base, {
    localEndpoint: mockUrl, cloudEndpoint: mockUrl, cloudKey: '', defaultModel: '',
    defaultReasoning: 'Medium', toolPolicy: {}, hooks: [], mcpServers: {}, customCommands: [],
  });
  await fsp.writeFile(path.join(dataDir, 'sessions.json'), JSON.stringify({ sessions: [] }));
  await fsp.writeFile(path.join(dataDir, 'memory.json'), JSON.stringify({}));
}

function startBackend(dataDir) {
  return new Promise((resolve, reject) => {
    const child = fork(SERVER_JS, [], {
      env: { ...process.env, PORT: String(BACKEND_PORT), OLLAMA_DESKTOP_DATA: dataDir },
      stdio: 'pipe',
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', () => {});
    const t0 = Date.now();
    const tick = async () => {
      try {
        const r = await fetch(`${BASE}/api/health`).then((x) => x.json());
        if (r && r.ok) return resolve({ child, base: BASE });
      } catch { /* not up yet */ }
      if (Date.now() - t0 > 25000) {
        try { child.kill(); } catch { /* ignore */ }
        return reject(new Error('test backend did not start; out=' + out.slice(0, 500)));
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

// ---------- repo seed ----------
function seedRepo() {
  const dir = mkTemp('yk-e2e-repo-');
  const pkg = JSON.stringify({ name: 'e2e-probe', version: '1.0.0', marker: 'PKG_MARKER_42', scripts: { test: 'node test.js' } }, null, 2);
  fs.writeFileSync(path.join(dir, 'package.json'), pkg);
  fs.writeFileSync(path.join(dir, 'README.md'), '# e2e probe repo\nSeed content for tests.\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'export const probe = 42;\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=e2e@x', '-c', 'user.name=e2e', 'add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=e2e@x', '-c', 'user.name=e2e', 'commit', '-m', 'seed commit'], { cwd: dir });
  return { dir, name: path.basename(dir), files: ['package.json', 'README.md', 'src/app.js'] };
}

// ---------- browser ----------
async function launchBrowser() {
  return pw().chromium.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

async function newFixture(browser, base, opts = {}) {
  const errors = { pageerrors: [], failed: [], consoleErrors: [] };
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.pageerrors.push(String(e && e.message || e)));
  page.on('requestfailed', (r) => errors.failed.push(`${r.url()} :: ${r.failure()?.errorText || ''}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.consoleErrors.push(m.text().slice(0, 300)); });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#root', { timeout: 15000 });
  return { ctx, page, errors };
}

async function waitBody(page, text, timeout = 45000) {
  if (text instanceof RegExp) {
    await page.waitForFunction(
      ({ source, flags }) => new RegExp(source, flags).test(document.body.innerText),
      { source: text.source, flags: text.flags },
      { timeout },
    );
    return;
  }
  await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout });
}

async function openNewSession(page) {
  await page.getByRole('button', { name: '+ New' }).first().click({ timeout: 15000 });
  await page.getByLabel('Message composer').waitFor({ timeout: 15000 });
}

async function setBuildMode(page, on) {
  const btn = page.getByRole('button', { name: on ? 'Build' : 'Chat', exact: true });
  const pressed = await btn.getAttribute('aria-pressed');
  if (((pressed === 'true') !== on)) await btn.click();
  await page.waitForFunction((v) => {
    const els = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === v);
    return els.length && els[0].getAttribute('aria-pressed') === 'true';
  }, on ? 'Build' : 'Chat', { timeout: 10000 });
}

async function sendComposer(page, text) {
  const box = page.getByLabel('Message composer');
  await box.click({ timeout: 15000 });
  await box.fill(text);
  await page.getByRole('button', { name: 'Send message' }).click({ timeout: 15000 });
}

async function openPickerDialog(page) {
  // Robust half of openRepoViaUI: opens the dialog without submitting.
  const openBtn = page.getByRole('button', { name: /Open directory/ }).first();
  try {
    await openBtn.click({ timeout: 4000 });
  } catch {
    const repoName = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('od.repo') || 'null')?.name || ''; }
      catch { return ''; }
    });
    if (!repoName) throw new Error('repo picker unreachable: no Open-directory button and no repo pill');
    await page.getByTitle(repoName).first().click({ timeout: 15000 });
  }
  const dlg = page.getByRole('dialog', { name: 'Open directory' });
  await dlg.waitFor({ timeout: 15000 });
  return dlg;
}

async function openRepoViaUI(page, dir) {
  const dlg = await openPickerDialog(page);
  await dlg.getByPlaceholder('/path/to/directory').fill(dir);
  await dlg.getByPlaceholder('/path/to/directory').press('Enter');
  await page.waitForFunction((d) => document.body.innerText.includes(d), path.basename(dir), { timeout: 20000 });
}

async function ensureShotDir() { await fsp.mkdir(SHOTS, { recursive: true }); }

function luminance(rgb) {
  const m = rgb.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const [r, g, b] = m[1].split(',').slice(0, 3).map((v) => parseFloat(v) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

async function setupFile() {
  const dataDir = mkTemp('yk-e2e-data-');
  const mock = await startMock();
  const be = await startBackend(dataDir);
  await setConfig(be.base, {
    localEndpoint: mock.url, cloudEndpoint: mock.url, cloudKey: '', defaultModel: '',
    defaultReasoning: 'Medium', toolPolicy: {}, hooks: [], mcpServers: {}, customCommands: [],
  });
  const repo = seedRepo();
  const browser = await launchBrowser();
  await ensureShotDir();
  return { dataDir, mock, be, base: be.base, repo, browser, fixture: null };
}

async function teardownFile(env) {
  try { await env.fixture?.ctx.close(); } catch { /* ignore */ }
  try { await env.browser.close(); } catch { /* ignore */ }
  try { env.be.child.kill(); } catch { /* ignore */ }
  try { env.mock.server.close(); } catch { /* ignore */ }
}

function sideBtn(page, name) {
  // sidebar-scoped session button (window title div shares the title attr)
  return page.locator('aside').getByRole('button', { name, exact: true });
}

module.exports = {
  BACKEND_PORT, BASE, SHOTS, FRONTEND_DIST,
  startMock, startBackend, api, getConfig, setConfig, resetState,
  seedRepo, mkTemp, launchBrowser, newFixture, waitBody,
  openNewSession, setBuildMode, sendComposer, openRepoViaUI, openPickerDialog, sideBtn,
  ensureShotDir, contrast, setupFile, teardownFile,
};
