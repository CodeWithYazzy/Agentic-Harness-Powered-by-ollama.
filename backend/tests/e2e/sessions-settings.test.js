'use strict';
// Sessions + settings + palette + shortcuts + responsive suite.
const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  setupFile, teardownFile, resetState, newFixture, waitBody,
  openNewSession, sendComposer, getConfig, setConfig, api, sideBtn,
} = require('./helpers');

describe('sessions-settings', () => {
  let env;
  before(async () => { env = await setupFile(); }, { timeout: 120000 });
  after(async () => { await teardownFile(env); });
  beforeEach(async () => {
    await resetState(env.base, env.dataDir, env.mock.url);
    try { await env.fixture?.ctx.close(); } catch { /* ignore */ }
    env.fixture = await newFixture(env.browser, env.base);
  }, { timeout: 60000 });
  afterEach(async () => { try { await env.fixture?.ctx.close(); } catch { /* ignore */ } env.fixture = null; });

  const pg = () => env.fixture.page;

  async function seedSessions(list) {
    const now = Date.now();
    const sessions = list.map((s, i) => ({
      id: s.id, title: s.title, repository: '', branch: 'main', worktree: '',
      provider: 'local', model: 'e2e-model-a:latest', reasoningLevel: 'Medium',
      messages: (s.messages || []).map((m, j) => ({
        id: `m-${i}-${j}`, role: m.role, content: m.content, createdAt: now - (100 - j) * 1000,
      })),
      toolCalls: [], contextMemory: {}, createdAt: now - 100000, updatedAt: now - i * 1000,
    }));
    await fs.promises.writeFile(path.join(env.dataDir, 'sessions.json'), JSON.stringify({ sessions }));
  }

  // ---- sessions ----
  test('sessions: sidebar new button creates a chat session', async () => {
    await openNewSession(pg());
    assert.ok(await pg().getByLabel('Message composer').isVisible());
  });

  test('sessions: rename via sidebar commits on Enter', async () => {
    await openNewSession(pg());
    await pg().getByRole('button', { name: 'Rename session' }).first().click({ timeout: 15000 });
    const input = pg().getByRole('textbox', { name: 'Rename session' });
    await input.waitFor({ timeout: 10000 });
    await input.fill('Renamed E2E Session');
    await input.press('Enter');
    await sideBtn(pg(), 'Renamed E2E Session').waitFor({ timeout: 15000 });
    assert.ok(true);
  });

  test('sessions: duplicate creates a titled copy', async () => {
    await openNewSession(pg());
    await pg().getByRole('button', { name: 'Rename session' }).first().click({ timeout: 15000 });
    await pg().getByRole('textbox', { name: 'Rename session' }).fill('Dupe Source');
    await pg().getByRole('textbox', { name: 'Rename session' }).press('Enter');
    await sideBtn(pg(), 'Dupe Source').waitFor({ timeout: 15000 });
    await pg().getByRole('button', { name: 'Duplicate session' }).first().click({ timeout: 15000 });
    await sideBtn(pg(), 'Dupe Source (copy)').waitFor({ timeout: 15000 });
    assert.ok(true);
  });

  test('sessions: delete plus undo restores the session', async () => {
    await openNewSession(pg());
    await pg().getByRole('button', { name: 'Rename session' }).first().click({ timeout: 15000 });
    await pg().getByRole('textbox', { name: 'Rename session' }).fill('Undo Me');
    await pg().getByRole('textbox', { name: 'Rename session' }).press('Enter');
    await sideBtn(pg(), 'Undo Me').waitFor({ timeout: 15000 });
    await pg().getByRole('button', { name: 'Delete session' }).first().click({ timeout: 15000 });
    await pg().getByText('Session deleted').waitFor({ timeout: 15000 });
    await pg().getByRole('button', { name: 'Undo' }).click({ timeout: 15000 });
    await sideBtn(pg(), 'Undo Me').waitFor({ timeout: 15000 });
    assert.ok(true);
  });

  test('sessions: delete without undo removes the session', async () => {
    await openNewSession(pg());
    await pg().getByRole('button', { name: 'Rename session' }).first().click({ timeout: 15000 });
    await pg().getByRole('textbox', { name: 'Rename session' }).fill('Gone Session');
    await pg().getByRole('textbox', { name: 'Rename session' }).press('Enter');
    await sideBtn(pg(), 'Gone Session').waitFor({ timeout: 15000 });
    await pg().getByRole('button', { name: 'Delete session' }).first().click({ timeout: 15000 });
    await pg().waitForFunction(() => !document.body.innerText.includes('Gone Session'), null, { timeout: 15000 });
    assert.ok(true);
  });

  test('sessions: reload persists session and messages', async () => {
    await openNewSession(pg());
    await sendComposer(pg(), '/cost');
    await waitBody(pg(), 'Session usage', 30000);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    await waitBody(pg(), 'Session usage', 30000);
    await waitBody(pg(), '/cost', 30000);
  });

  test('sessions: search filters the sidebar list', async () => {
    await seedSessions([
      { id: 's-alpha', title: 'Alpha Session One', messages: [{ role: 'user', content: 'hi alpha' }] },
      { id: 's-beta', title: 'Beta Session Two', messages: [{ role: 'user', content: 'hi beta' }] },
    ]);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    // open one session so the unfiltered Recents panel is out of the picture
    await sideBtn(pg(), 'Beta Session Two').click({ timeout: 20000 });
    await pg().getByLabel('Message composer').waitFor({ timeout: 20000 });
    await pg().getByPlaceholder('Search sessions').fill('Beta');
    // assert against the sidebar only
    await pg().waitForFunction(() => {
      const a = document.querySelector('aside');
      return a && !a.innerText.includes('Alpha Session One') && a.innerText.includes('Beta Session Two');
    }, null, { timeout: 15000 });
    assert.ok(true);
  });

  test('sessions: compact trims messages and shows a summary', async () => {
    const messages = [];
    for (let i = 1; i <= 10; i++) messages.push({ role: i % 2 ? 'user' : 'assistant', content: `compact marker MSG_${String(i).padStart(2, '0')} discussion point` });
    await seedSessions([{ id: 's-compact', title: 'Compact Me', messages }]);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    await sideBtn(pg(), 'Compact Me').click({ timeout: 20000 });
    await pg().getByLabel('Message composer').waitFor({ timeout: 20000 });
    await sendComposer(pg(), '/compact');
    await waitBody(pg(), 'Session summary (compacted', 60000);
    const body = await pg().evaluate(() => document.body.innerText);
    assert.ok(!body.includes('MSG_01'), 'oldest messages should be trimmed');
  }, { timeout: 120000 });

  test('sessions: /cost reports usage stats', async () => {
    await openNewSession(pg());
    await sendComposer(pg(), '/cost');
    await waitBody(pg(), 'Session usage', 30000);
    const body = await pg().evaluate(() => document.body.innerText);
    assert.match(body, /Messages: \d+/);
  });

  test('sessions: /doctor reports bridge and model status', async () => {
    await openNewSession(pg());
    await sendComposer(pg(), '/doctor');
    await waitBody(pg(), 'Doctor report', 30000);
    const body = await pg().evaluate(() => document.body.innerText);
    assert.ok(body.includes('Bridge: ok'));
  });

  // ---- settings ----
  test('settings: modal opens with endpoint rows', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    await pg().getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 15000 });
    const txt = await pg().getByRole('dialog', { name: 'Settings' }).innerText();
    assert.ok(txt.includes('Local endpoint') && txt.includes('Cloud endpoint'));
  });

  test('settings: changing cloud endpoint and saving persists', async () => {
    await setConfig(env.base, { cloudEndpoint: 'http://127.0.0.1:9' });
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    const dlg = pg().getByRole('dialog', { name: 'Settings' });
    await dlg.waitFor({ timeout: 15000 });
    const input = dlg.locator('xpath=.//span[text()="Cloud endpoint"]/following-sibling::input');
    await input.fill(env.mock.url);
    await dlg.getByRole('button', { name: 'Save' }).click({ timeout: 15000 });
    await waitBody(pg(), 'Settings saved', 20000);
    const cfg = await getConfig(env.base);
    assert.equal(cfg.cloudEndpoint, env.mock.url);
  });

  test('settings: tool policy select persists', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    const dlg = pg().getByRole('dialog', { name: 'Settings' });
    await dlg.waitFor({ timeout: 15000 });
    await dlg.getByLabel('file_write permission').selectOption('deny');
    await dlg.getByRole('button', { name: 'Save' }).click({ timeout: 15000 });
    await waitBody(pg(), 'Settings saved', 20000);
    const cfg = await getConfig(env.base);
    assert.equal(cfg.toolPolicy.file_write, 'deny');
  });

  test('settings: saved policy is reflected when reopened', async () => {
    await setConfig(env.base, { toolPolicy: { grep: 'deny' } });
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    const dlg = pg().getByRole('dialog', { name: 'Settings' });
    await dlg.waitFor({ timeout: 15000 });
    assert.equal(await dlg.getByLabel('grep permission').inputValue(), 'deny');
  });

  test('settings: hook add and delete persist', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    const dlg = pg().getByRole('dialog', { name: 'Settings' });
    await dlg.waitFor({ timeout: 15000 });
    await dlg.getByLabel('Hook command').fill('echo hook-probe-123');
    await dlg.locator('xpath=.//input[@aria-label="Hook command"]/..//button').click({ timeout: 15000 });
    await dlg.getByRole('button', { name: 'Save' }).click({ timeout: 15000 });
    await waitBody(pg(), 'Settings saved', 20000);
    let cfg = await getConfig(env.base);
    assert.ok((cfg.hooks || []).some((h) => h.command === 'echo hook-probe-123'));
    // reopen and delete
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    const dlg2 = pg().getByRole('dialog', { name: 'Settings' });
    await dlg2.waitFor({ timeout: 15000 });
    await dlg2.getByRole('button', { name: 'Delete hook' }).first().click({ timeout: 15000 });
    await dlg2.getByRole('button', { name: 'Save' }).click({ timeout: 15000 });
    await waitBody(pg(), 'Settings saved', 20000);
    cfg = await getConfig(env.base);
    assert.deepEqual(cfg.hooks || [], []);
  });

  test('settings: custom command appears in slash menu', async () => {
    const cmdName = 'e2ecmd';
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    const dlg = pg().getByRole('dialog', { name: 'Settings' });
    await dlg.waitFor({ timeout: 15000 });
    await dlg.getByLabel('Command name').fill(cmdName);
    await dlg.getByLabel('Command prompt').fill('probe custom command prompt');
    await dlg.locator('xpath=.//input[@aria-label="Command name"]/..//button').click({ timeout: 15000 });
    await dlg.getByRole('button', { name: 'Save' }).click({ timeout: 15000 });
    await waitBody(pg(), 'Settings saved', 20000);
    await openNewSession(pg());
    const box = pg().getByLabel('Message composer');
    await box.click();
    await box.fill('/' + cmdName);
    await pg().waitForFunction((c) => document.body.innerText.includes('/' + c), cmdName, { timeout: 15000 });
    assert.ok(true);
  });

  test('settings: test-connection button reports local status', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    const dlg = pg().getByRole('dialog', { name: 'Settings' });
    await dlg.waitFor({ timeout: 15000 });
    await dlg.getByRole('button', { name: 'Test connection' }).click({ timeout: 15000 });
    await pg().waitForFunction(() => /Connected|Unavailable/.test(document.body.innerText), null, { timeout: 30000 });
    assert.ok((await pg().evaluate(() => document.body.innerText)).includes('Connected'));
  });

  // ---- palette ----
  test('palette: Ctrl+K opens the command palette', async () => {
    await pg().keyboard.press('Control+k');
    await pg().getByRole('dialog', { name: 'Command palette' }).waitFor({ timeout: 15000 });
    assert.ok(true);
  });

  test('palette: typing filters actions', async () => {
    await pg().keyboard.press('Control+k');
    const dlg = pg().getByRole('dialog', { name: 'Command palette' });
    await dlg.waitFor({ timeout: 15000 });
    await dlg.getByLabel('Search sessions, directories, models, actions').fill('settings');
    await pg().waitForFunction(() => document.body.innerText.includes('Open settings'), null, { timeout: 15000 });
    assert.ok(!(await pg().evaluate(() => document.body.innerText)).includes('Create PR'));
  });

  test('palette: Enter runs top action and creates a session', async () => {
    await pg().keyboard.press('Control+k');
    const dlg = pg().getByRole('dialog', { name: 'Command palette' });
    await dlg.waitFor({ timeout: 15000 });
    await dlg.getByLabel('Search sessions, directories, models, actions').fill('new sess');
    await pg().waitForTimeout(200);
    await dlg.getByLabel('Search sessions, directories, models, actions').press('Enter');
    await pg().getByLabel('Message composer').waitFor({ timeout: 20000 });
    assert.ok(true);
  });

  // ---- shortcuts ----
  test('shortcuts: Ctrl+Enter sends the composer text', async () => {
    await openNewSession(pg());
    const box = pg().getByLabel('Message composer');
    await box.click();
    await box.fill('ctrl enter probe 4455');
    await box.press('Control+Enter');
    await waitBody(pg(), 'ctrl enter probe 4455', 30000);
  });

  test('shortcuts: Escape closes the palette', async () => {
    await pg().keyboard.press('Control+k');
    await pg().getByRole('dialog', { name: 'Command palette' }).waitFor({ timeout: 15000 });
    await pg().keyboard.press('Escape');
    await pg().waitForFunction(() => !document.body.innerText.includes('Search sessions, directories, models, actions'), null, { timeout: 15000 });
    assert.ok(true);
  });

  test('shortcuts: Escape closes the repo picker', async () => {
    // open the picker robustly (home button is transient after boot default),
    // then Escape must dismiss the dialog
    const repoName = await pg().evaluate(() => {
      try { return JSON.parse(localStorage.getItem('od.repo') || 'null')?.name || ''; }
      catch { return ''; }
    });
    if (repoName) await pg().getByTitle(repoName).first().click({ timeout: 15000 });
    else await pg().getByRole('button', { name: /Open directory/ }).first().click({ timeout: 15000 });
    await pg().getByRole('dialog', { name: 'Open directory' }).waitFor({ timeout: 15000 });
    await pg().keyboard.press('Escape');
    await pg().waitForFunction(() => !document.body.innerText.includes('Files and git stay confined'), null, { timeout: 15000 });
    assert.ok(true);
  });

  test('shortcuts: Enter sends from composer without modifiers', async () => {
    await openNewSession(pg());
    const box = pg().getByLabel('Message composer');
    await box.click();
    await box.fill('/cost');
    await box.press('Enter');
    await waitBody(pg(), 'Session usage', 30000);
  });

  // ---- responsive ----
  for (const vp of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    test(`responsive: home has no horizontal overflow at ${vp.width}x${vp.height}`, async () => {
      await pg().setViewportSize(vp);
      await pg().reload({ waitUntil: 'domcontentloaded' });
      await pg().getByText(/What’s up next/).waitFor({ timeout: 20000 });
      const r = await pg().evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(r.sw <= r.iw + 1, `scrollWidth ${r.sw} > innerWidth ${r.iw}`);
    });

    test(`responsive: chat has no horizontal overflow at ${vp.width}x${vp.height}`, async () => {
      await pg().setViewportSize(vp);
      await pg().reload({ waitUntil: 'domcontentloaded' });
      await openNewSession(pg());
      const r = await pg().evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(r.sw <= r.iw + 1, `scrollWidth ${r.sw} > innerWidth ${r.iw}`);
      assert.ok(await pg().getByLabel('Message composer').isVisible());
    });
  }

  test('responsive: model popover stays within the viewport', async () => {
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.trim().length > 1;
    }, null, { timeout: 25000 });
    await pg().getByRole('button', { name: /e2e-model|Select model/ }).first().click({ timeout: 15000 });
    const box = await pg().getByRole('listbox').boundingBox({ timeout: 15000 });
    const vp = pg().viewportSize();
    assert.ok(box.x >= -1 && box.x + box.width <= vp.width + 1, JSON.stringify({ box, vp }));
  });

  test('api: sessions endpoint round-trips a session', async () => {
    await seedSessions([{ id: 's-rt', title: 'Round Trip', messages: [] }]);
    const j = await api(env.base, 'GET', '/api/sessions');
    assert.ok((j.sessions || []).some((s) => s.id === 's-rt'));
  });
});
