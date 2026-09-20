'use strict';
// Chat + tools + models + directory + mode-card + background suite.
const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  setupFile, teardownFile, resetState, newFixture, waitBody,
  openNewSession, setBuildMode, sendComposer, openRepoViaUI, getConfig, setConfig,
} = require('./helpers');

describe('chat-tools', () => {
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

  async function waitModelReady() {
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
        .find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.includes('e2e-model');
    }, null, { timeout: 25000 });
  }

  // ---- directory ----
  test('directory: repo picker opens and submits temp repo path', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    assert.ok(true);
  });

  test('directory: pills show dir name and branch after open', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    // branch renders in the chat header pill, not on home: open a session first
    await openNewSession(pg());
    await pg().getByText(env.repo.name).first().waitFor({ timeout: 15000 });
    const body = await pg().evaluate(() => document.body.innerText);
    assert.ok(body.includes(env.repo.name));
    assert.match(body, /main|master/);
  });

  test('directory: memory section absent-or-present is rendered honestly', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await waitModelReady();
    await sendComposer(pg(), 'list files via glob');
    await waitBody(pg(), /Found \d+ files via glob/, 60000);
    // repo pills live on the home route, not in chat: go back via Overview,
    // then reopen the picker through the directory-name pill
    await pg().getByRole('button', { name: 'Overview' }).first().click({ timeout: 15000 });
    await pg().getByTitle(env.repo.name).click({ timeout: 15000 });
    await pg().getByRole('dialog', { name: 'Open directory' }).waitFor({ timeout: 15000 });
    const txt = await pg().getByRole('dialog', { name: 'Open directory' }).innerText();
    assert.ok(/Current:|Project memory/.test(txt));
  });

  // ---- models ----
  test('models: selector lists mock local models', async () => {
    await openNewSession(pg());
    await waitModelReady();
    const toggle = pg().getByRole('button', { name: /e2e-model|Select model/ }).first();
    await toggle.click({ timeout: 15000 });
    await pg().getByRole('listbox').waitFor({ timeout: 15000 });
    const opts = pg().getByRole('option');
    assert.ok(await opts.count() >= 2);
    await waitBody(pg(), 'e2e-model-a');
  });

  test('models: selecting a model switches the footer label', async () => {
    await openNewSession(pg());
    await waitModelReady();
    const toggle = pg().getByRole('button', { name: /e2e-model|Select model/ }).first();
    await toggle.click({ timeout: 15000 });
    const listbox = pg().getByRole('listbox');
    await listbox.waitFor({ timeout: 15000 });
    // same mock names appear under Local and API-cloud groups: pick the Local one
    const localGroup = listbox.locator('xpath=.//div[normalize-space(text())="Local"]/..');
    await localGroup.getByRole('option', { name: /e2e-model-b/ }).click();
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
        .find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.includes('e2e-model-b');
    }, null, { timeout: 15000 });
    assert.ok(true);
  });

  test('models: arrow keys move highlight in model list', async () => {
    await openNewSession(pg());
    await waitModelReady();
    await pg().getByRole('button', { name: /e2e-model|Select model/ }).first().click();
    const search = pg().getByPlaceholder('Search models');
    await search.waitFor({ timeout: 15000 });
    const first = await pg().locator('[data-mhi="1"]').innerText();
    await search.press('ArrowDown');
    const second = await pg().locator('[data-mhi="1"]').innerText();
    assert.notEqual(first, second);
  });

  test('models: dead cloud endpoint hides cloud group, local stays', async () => {
    await setConfig(env.base, { cloudEndpoint: 'http://127.0.0.1:9' });
    await pg().reload({ waitUntil: 'domcontentloaded' });
    await openNewSession(pg());
    await waitModelReady();
    await pg().getByRole('button', { name: /e2e-model|Select model/ }).first().click();
    await pg().getByRole('listbox').waitFor({ timeout: 15000 });
    const txt = await pg().getByRole('listbox').innerText();
    assert.ok(txt.includes('Local'));
    // only the two local mock models: no cloud options at all
    // (the footer help text mentions cloud tiers, so count options, not text)
    assert.equal(await pg().getByRole('option').count(), 2);
    await setConfig(env.base, { cloudEndpoint: env.mock.url });
  });

  test('models: dead local endpoint shows offline banner and note', async () => {
    try {
      await setConfig(env.base, { localEndpoint: 'http://127.0.0.1:9', cloudEndpoint: 'http://127.0.0.1:9' });
      await pg().reload({ waitUntil: 'domcontentloaded' });
      await pg().getByText(/Ollama unavailable/).first().waitFor({ timeout: 25000 });
      assert.ok(true);
      await openNewSession(pg());
      await pg().getByRole('button', { name: /e2e-model|Select model/ }).first().click();
      await waitBody(pg(), 'Offline');
    } finally {
      await setConfig(env.base, { localEndpoint: env.mock.url, cloudEndpoint: env.mock.url });
    }
  });

  // ---- chat + tools ----
  test('chat: stop button appears while a glob run streams', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await waitModelReady();
    await sendComposer(pg(), 'list files via glob');
    const stop = pg().getByRole('button', { name: 'Stop generation' });
    await stop.waitFor({ timeout: 25000 });
    assert.ok(await stop.isVisible());
    await waitBody(pg(), /Found \d+ files via glob/, 60000);
  });

  test('chat: glob run final answer contains real temp filenames', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await waitModelReady();
    await sendComposer(pg(), 'list files via glob');
    await waitBody(pg(), /Found \d+ files via glob/, 60000);
    const body = await pg().evaluate(() => document.body.innerText);
    assert.ok(body.includes('package.json'), 'expected real filename in chat');
    assert.ok(body.includes('README.md') || body.includes('src/app.js'));
  });

  test('chat: follow-up read of package.json shows seeded marker', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await waitModelReady();
    await sendComposer(pg(), 'read package.json');
    await waitBody(pg(), 'PKG_MARKER_42', 60000);
    assert.ok(true);
  });

  test('chat: assistant answer has no repeated sentences', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await waitModelReady();
    await sendComposer(pg(), 'list files via glob');
    await waitBody(pg(), /Found \d+ files via glob/, 60000);
    await pg().waitForTimeout(1500);
    const body = await pg().evaluate(() => document.body.innerText);
    const sents = body.split(/[.!?\n]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 25);
    const seen = new Set();
    const dups = sents.filter((s) => (seen.has(s) ? true : (seen.add(s), false)));
    assert.deepEqual(dups, [], 'repeated sentences: ' + dups.slice(0, 2).join(' | '));
  });

  test('chat: completion stamps thinking time on the answer', async () => {
    await openNewSession(pg());
    await waitModelReady();
    await sendComposer(pg(), 'hello, simple greeting probe');
    await waitBody(pg(), 'Mock answer', 60000);
    await waitBody(pg(), /thought for \d+s/, 30000);
  });

  test('chat: user bubble shows the sent text', async () => {
    await openNewSession(pg());
    await waitModelReady();
    await sendComposer(pg(), 'unique bubble probe 7788');
    await waitBody(pg(), 'unique bubble probe 7788', 30000);
    assert.ok(true);
  });

  // ---- mode card ----
  test('mode card: build-looking chat request shows ModeSwitchCard', async () => {
    await openNewSession(pg());
    await waitModelReady();
    await setBuildMode(pg(), false);
    await sendComposer(pg(), 'create a full game with levels and score');
    await pg().getByText('This looks like a build task').waitFor({ timeout: 30000 });
    assert.ok(true);
  });

  test('mode card: approve flips footer to Build and run starts', async () => {
    await openNewSession(pg());
    await waitModelReady();
    await setBuildMode(pg(), false);
    await sendComposer(pg(), 'create a full game with levels and score');
    await pg().getByText('This looks like a build task').waitFor({ timeout: 30000 });
    await pg().getByRole('button', { name: 'Go to Build mode' }).click();
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Build');
      return b && b.getAttribute('aria-pressed') === 'true';
    }, null, { timeout: 15000 });
    const mode = await pg().evaluate(() => localStorage.getItem('od.buildMode'));
    assert.equal(mode, 'build');
    await waitBody(pg(), 'Mock answer', 60000);
  });

  test('mode card: build mode persists across reload', async () => {
    await openNewSession(pg());
    await setBuildMode(pg(), true);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    await pg().getByRole('button', { name: '+ New' }).first().click({ timeout: 20000 });
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Build');
      return b && b.getAttribute('aria-pressed') === 'true';
    }, null, { timeout: 15000 });
    assert.ok(true);
  });

  // ---- background ----
  // bg run rows share titles with session buttons, so rows are scoped by the
  // View-answer action which only background rows have.
  function bgRow(marker) {
    return pg().locator('div.group')
      .filter({ has: pg().locator(`button[title*="${marker}"]`) })
      .filter({ has: pg().getByRole('button', { name: 'View answer' }) })
      .first();
  }

  test('background: toggle arms, run lands in sidebar and completes', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await waitModelReady();
    const bg = pg().getByRole('button', { name: 'Run in background' });
    await bg.click();
    assert.equal(await bg.getAttribute('aria-pressed'), 'true');
    await sendComposer(pg(), 'bg-alpha list files via glob');
    await waitBody(pg(), 'Running in background', 30000);
    await bgRow('bg-alpha').waitFor({ timeout: 30000 });
    // poll backend until the run is done
    let done = false;
    for (let i = 0; i < 40; i++) {
      const j = await fetch(`${env.base}/api/agent/runs`).then((r) => r.json());
      if ((j.runs || []).some((r) => r.status === 'done' && r.label.includes('bg-alpha'))) { done = true; break; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    assert.ok(done, 'background run did not finish in time');
  }, { timeout: 120000 });

  test('background: view opens answer modal with real text', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await waitModelReady();
    await pg().getByRole('button', { name: 'Run in background' }).click();
    await sendComposer(pg(), 'bg-beta list files via glob');
    let runId = null;
    for (let i = 0; i < 40; i++) {
      const j = await fetch(`${env.base}/api/agent/runs`).then((r) => r.json());
      const hit = (j.runs || []).find((r) => r.label.includes('bg-beta') && r.status === 'done');
      if (hit) { runId = hit.id; break; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    assert.ok(runId, 'no finished run found');
    await bgRow('bg-beta').getByRole('button', { name: 'View answer' }).click({ timeout: 20000 });
    const dlg = pg().getByRole('dialog').first();
    await dlg.waitFor({ timeout: 15000 });
    const txt = await dlg.innerText();
    assert.ok(txt.length > 20, 'answer modal should contain text');
  }, { timeout: 120000 });

  test('background: stop halts a slow scripted run', async () => {
    await openNewSession(pg());
    await waitModelReady();
    await pg().getByRole('button', { name: 'Run in background' }).click();
    await sendComposer(pg(), 'bg-gamma SLOWMARK please take your time');
    let runId = null;
    for (let i = 0; i < 20; i++) {
      const j = await fetch(`${env.base}/api/agent/runs`).then((r) => r.json());
      const hit = (j.runs || []).find((r) => r.label.includes('bg-gamma'));
      if (hit) { runId = hit.id; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(runId, 'slow run never registered');
    const row = bgRow('bg-gamma');
    await row.waitFor({ timeout: 30000 });
    const stopBtn = row.getByRole('button', { name: 'Stop run' });
    await stopBtn.click({ timeout: 30000 });
    let stopped = false;
    for (let i = 0; i < 20; i++) {
      const j = await fetch(`${env.base}/api/agent/runs/${runId}`).then((r) => r.json());
      if (j.run && j.run.status === 'stopped') { stopped = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(stopped, 'run was not stopped');
  }, { timeout: 120000 });

  test('config: mock wiring is intact (local endpoint points at mock)', async () => {
    const cfg = await getConfig(env.base);
    assert.equal(cfg.localEndpoint, env.mock.url);
  });
});
