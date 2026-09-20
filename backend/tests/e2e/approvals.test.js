'use strict';
// Approvals + ask_user suite: real file_write gating through the agent loop.
const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  setupFile, teardownFile, resetState, newFixture, waitBody,
  openNewSession, setBuildMode, sendComposer, openRepoViaUI, getConfig, setConfig,
} = require('./helpers');

describe('approvals', () => {
  let env;
  before(async () => { env = await setupFile(); }, { timeout: 120000 });
  after(async () => { await teardownFile(env); });
  beforeEach(async () => {
    await resetState(env.base, env.dataDir, env.mock.url);
    await setConfig(env.base, { toolPolicy: { file_write: 'ask' } });
    try { await env.fixture?.ctx.close(); } catch { /* ignore */ }
    env.fixture = await newFixture(env.browser, env.base);
  }, { timeout: 60000 });
  afterEach(async () => { try { await env.fixture?.ctx.close(); } catch { /* ignore */ } env.fixture = null; });

  const pg = () => env.fixture.page;
  const hello = () => path.join(env.repo.dir, 'hello.txt');

  async function ready() {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
        .find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.includes('e2e-model');
    }, null, { timeout: 25000 });
    await setBuildMode(pg(), true);
    try { fs.unlinkSync(hello()); } catch { /* ignore */ }
  }

  async function waitCard() {
    await pg().getByText('needs approval').waitFor({ timeout: 60000 });
  }

  test('approval card appears with tool name and JSON input', async () => {
    await ready();
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    await waitCard();
    const card = pg().getByText('needs approval').locator('..');
    void card;
    const body = await pg().evaluate(() => document.body.innerText);
    assert.ok(body.includes('file_write'), 'card should name the tool');
    assert.ok(body.includes('hello.txt'), 'card should show JSON input with path');
    // cleanup: deny so no run is left hanging
    await pg().getByRole('button', { name: 'Deny' }).click();
    await waitBody(pg(), /denied/i, 60000);
  }, { timeout: 150000 });

  test('allow once creates the file on disk', async () => {
    await ready();
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    await waitCard();
    await pg().getByRole('button', { name: 'Allow once' }).click();
    // poll the real filesystem
    let found = false;
    for (let i = 0; i < 40; i++) {
      if (fs.existsSync(hello())) { found = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(found, 'hello.txt was not created after Allow once');
    const content = fs.readFileSync(hello(), 'utf8');
    assert.ok(content.includes('hello world from e2e'));
  }, { timeout: 150000 });

  test('allow once reports the write in chat', async () => {
    await ready();
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    await waitCard();
    await pg().getByRole('button', { name: 'Allow once' }).click();
    await waitBody(pg(), /wrote hello\.txt/, 60000);
  }, { timeout: 150000 });

  test('approval card disappears after allow', async () => {
    await ready();
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    await waitCard();
    await pg().getByRole('button', { name: 'Allow once' }).click();
    await waitBody(pg(), /wrote hello\.txt|Created hello/, 60000);
    assert.equal(await pg().getByText('needs approval').count(), 0);
  }, { timeout: 150000 });

  test('deny leaves no file and chat shows denied', async () => {
    await ready();
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    await waitCard();
    await pg().getByRole('button', { name: 'Deny' }).click();
    await waitBody(pg(), /denied/i, 60000);
    assert.ok(!fs.existsSync(hello()), 'file must not exist after Deny');
  }, { timeout: 150000 });

  test('always allow persists file_write policy in config', async () => {
    await ready();
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    await waitCard();
    await pg().getByRole('button', { name: /Always allow/ }).click();
    await waitBody(pg(), /wrote hello\.txt|Created hello/, 60000);
    const cfg = await getConfig(env.base);
    assert.equal(cfg.toolPolicy && cfg.toolPolicy.file_write, 'allow');
  }, { timeout: 150000 });

  test('always allow skips the card on the next run', async () => {
    await ready();
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    await waitCard();
    await pg().getByRole('button', { name: /Always allow/ }).click();
    await waitBody(pg(), /wrote hello\.txt|Created hello/, 60000);
    try { fs.unlinkSync(hello()); } catch { /* ignore */ }
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    // the first run's 'wrote' text is already on screen: poll the filesystem
    // for the second write instead of matching stale chat text
    let back = false;
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(hello())) { back = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(back, 'second run did not recreate the file');
    assert.equal(await pg().getByText('needs approval').count(), 0);
  }, { timeout: 180000 });

  test('deny policy set via API blocks without a card', async () => {
    await setConfig(env.base, { toolPolicy: { file_write: 'deny' } });
    await ready();
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    await waitBody(pg(), /denied/i, 60000);
    assert.equal(await pg().getByText('needs approval').count(), 0);
    assert.ok(!fs.existsSync(hello()));
  }, { timeout: 150000 });

  test('ask_user card renders the scripted question and options', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
        .find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.includes('e2e-model');
    }, null, { timeout: 25000 });
    await sendComposer(pg(), 'please use the ask_user tool to ask me a clarifying question about which file to read');
    await pg().getByText('Agent asks you', { exact: true }).waitFor({ timeout: 60000 });
    await pg().getByRole('button', { name: /Option Alpha/ }).waitFor({ timeout: 15000 });
    assert.ok(await pg().getByRole('button', { name: /Option Beta/ }).isVisible());
  }, { timeout: 150000 });

  test('ask_user answer button is disabled until an option is picked', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
        .find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.includes('e2e-model');
    }, null, { timeout: 25000 });
    await sendComposer(pg(), 'please use the ask_user tool to ask me a clarifying question about which file to read');
    await pg().getByText('Agent asks you', { exact: true }).waitFor({ timeout: 60000 });
    const ans = pg().getByRole('button', { name: 'Answer', exact: true });
    assert.equal(await ans.isDisabled(), true);
    await pg().getByRole('button', { name: /Option Alpha/ }).click();
    assert.equal(await ans.isDisabled(), false);
    await ans.click();
    await waitBody(pg(), /Thanks for answering|chosen option/, 60000);
  }, { timeout: 150000 });

  test('ask_user run completes after answering', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
        .find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.includes('e2e-model');
    }, null, { timeout: 25000 });
    await sendComposer(pg(), 'please use the ask_user tool to ask me a clarifying question about which file to read');
    await pg().getByText('Agent asks you', { exact: true }).waitFor({ timeout: 60000 });
    await pg().getByRole('button', { name: /Option Beta/ }).click();
    await pg().getByRole('button', { name: 'Answer', exact: true }).click();
    await waitBody(pg(), /Thanks for answering|chosen option/, 60000);
    assert.equal(await pg().getByText('Agent asks you', { exact: true }).count(), 0);
  }, { timeout: 150000 });

  test('build mode toggle is required-arm for write tools (chat shows mode card)', async () => {
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
        .find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.includes('e2e-model');
    }, null, { timeout: 25000 });
    await setBuildMode(pg(), false);
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    await pg().getByText('This looks like a build task').waitFor({ timeout: 30000 });
    assert.ok(!fs.existsSync(hello()), 'chat mode must not create files directly');
  }, { timeout: 120000 });
});
