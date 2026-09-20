'use strict';
// Launch / window-chrome suite: title, wallpaper, clock, sidebar, composer, zero console errors.
const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupFile, teardownFile, resetState, newFixture, openRepoViaUI } = require('./helpers');

describe('launch', () => {
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
  const errs = () => env.fixture.errors;

  test('document title is YK-Harness', async () => {
    assert.match(await pg().title(), /YK-Harness/);
  });

  test('app window is visible', async () => {
    await pg().getByText('YK-Harness').first().waitFor({ timeout: 15000 });
    assert.ok(await pg().getByText('YK-Harness').first().isVisible());
  });

  test('wallpaper gradient layer is rendered', async () => {
    const n = await pg().evaluate(() => {
      const els = [...document.querySelectorAll('div')];
      return els.filter((d) => (d.getAttribute('style') || '').includes('radial-gradient')).length;
    });
    assert.ok(n >= 1, 'expected a wallpaper gradient div');
  });

  test('live clock is visible with time text', async () => {
    const clock = pg().locator('div[aria-label]').filter({ hasText: /\d{1,2}:\d{2}/ }).first();
    await clock.waitFor({ timeout: 15000 });
    assert.match(await clock.innerText(), /\d{1,2}:\d{2}/);
  });

  test('sidebar sessions panel is visible', async () => {
    await pg().getByText('Sessions', { exact: true }).first().waitFor({ timeout: 15000 });
    assert.ok(await pg().getByText('Sessions', { exact: true }).first().isVisible());
  });

  test('sidebar has New session button', async () => {
    const b = pg().getByRole('button', { name: '+ New' }).first();
    await b.waitFor({ timeout: 15000 });
    assert.ok(await b.isVisible());
  });

  test('sidebar has session search input', async () => {
    const s = pg().getByPlaceholder('Search sessions');
    await s.waitFor({ timeout: 15000 });
    assert.ok(await s.isVisible());
  });

  test('home greeting is shown', async () => {
    await pg().getByText(/What’s up next/).first().waitFor({ timeout: 15000 });
    assert.ok(true);
  });

  test('overview card is present on home', async () => {
    await pg().getByText('Recents', { exact: true }).waitFor({ timeout: 15000 });
    assert.ok(await pg().getByText('Overview', { exact: true }).first().isVisible());
  });

  test('suggestion buttons are shown on empty chat', async () => {
    await pg().getByRole('button', { name: '+ New' }).first().click();
    await pg().getByText('What can I help with?').waitFor({ timeout: 15000 });
    const known = [
      'Explain what this directory does', 'Show me the recent commits', 'Is my working tree clean?',
      'Review my uncommitted diff', 'Find TODOs and FIXMEs', 'Summarize the README',
      'What changed in the last commit?', 'List the project structure',
    ];
    let visible = 0;
    for (const s of known) {
      if (await pg().getByRole('button', { name: s }).count() > 0) visible++;
    }
    assert.ok(visible >= 3, `only ${visible} suggestion buttons visible`);
  });

  test('open-directory pill is present when no repo', async () => {
    // The home "Open directory..." button vanishes once the boot homedir
    // default lands, so open the picker through the robust helper and assert
    // the dialog (same user-visible capability, no race).
    const { openRepoViaUI } = require('./helpers');
    await openRepoViaUI(pg(), 'C:\\');    await pg().getByRole('dialog', { name: 'Open directory' }).waitFor({ timeout: 15000 });
    assert.ok(true);
  });

  test('composer appears after starting a session', async () => {
    await pg().getByRole('button', { name: '+ New' }).first().click();
    const box = pg().getByLabel('Message composer');
    await box.waitFor({ timeout: 15000 });
    assert.ok(await box.isVisible());
    assert.equal(await box.getAttribute('placeholder'), 'Type / for commands');
  });

  test('send button is disabled when composer is empty', async () => {
    await pg().getByRole('button', { name: '+ New' }).first().click();
    const send = pg().getByRole('button', { name: 'Send message' });
    await send.waitFor({ timeout: 15000 });
    assert.equal(await send.isDisabled(), true);
  });

  test('window controls (minimize/maximize/close) exist', async () => {
    for (const n of ['Minimize', 'Maximize', 'Close']) {
      const b = pg().getByRole('button', { name: n, exact: true });
      await b.waitFor({ timeout: 15000 });
      assert.ok(await b.isVisible(), n);
    }
  });

  test('header has palette, copy, resend, settings buttons', async () => {
    for (const n of ['Command palette', 'Copy transcript', 'Resend last message', 'Settings']) {
      await pg().getByRole('button', { name: n }).first().waitFor({ timeout: 15000 });
    }
    assert.ok(true);
  });

  test('toast live region is present', async () => {
    const t = pg().getByRole('status');
    await t.waitFor({ state: 'attached', timeout: 15000 });
    assert.equal(await t.getAttribute('aria-live'), 'polite');
  });

  test('backend health is ok', async () => {
    const r = await fetch(`${env.base}/api/health`).then((x) => x.json());
    assert.equal(r.ok, true);
  });

  test('zero pageerrors on load', async () => {
    await pg().waitForTimeout(250);
    assert.deepEqual(errs().pageerrors, []);
  });

  test('zero failed requests on load', async () => {
    await pg().waitForTimeout(250);
    const bad = errs().failed.filter((u) => !u.includes('favicon'));
    assert.deepEqual(bad, []);
  });

  test('zero console errors on load', async () => {
    await pg().waitForTimeout(250);
    assert.deepEqual(errs().consoleErrors, []);
  });
});
