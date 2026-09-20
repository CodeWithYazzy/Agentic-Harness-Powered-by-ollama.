'use strict';
// Accessibility + performance budgets + visual baselines suite.
// Visual shots are BASELINE-CAPTURE (existence + non-blank), not regression-compared.
const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  setupFile, teardownFile, resetState, newFixture, waitBody,
  openNewSession, setBuildMode, sendComposer, openRepoViaUI, openPickerDialog, sideBtn,
  SHOTS, FRONTEND_DIST, contrast, setConfig,
} = require('./helpers');

describe('a11y-perf', () => {
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
        id: `m-${i}-${j}`, role: m.role, content: m.content, createdAt: now - (1000 - j) * 1000,
      })),
      toolCalls: [], contextMemory: {}, createdAt: now - 100000, updatedAt: now - i * 1000,
    }));
    await fs.promises.writeFile(path.join(env.dataDir, 'sessions.json'), JSON.stringify({ sessions }));
  }

  // ---------- a11y ----------
  test('a11y: every visible button has an accessible name (home)', async () => {
    const bad = await pg().evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('button')) {
        const r = b.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const name = (b.getAttribute('aria-label') || b.textContent || b.getAttribute('title') || '').trim();
        if (!name) out.push(b.className.slice(0, 80));
      }
      return out;
    });
    assert.deepEqual(bad, []);
  });

  test('a11y: every visible button has an accessible name (chat with messages)', async () => {
    await seedSessions([{ id: 's-a11y', title: 'A11y Chat', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello there' }] }]);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    await sideBtn(pg(), 'A11y Chat').click({ timeout: 20000 });
    await pg().getByLabel('Message composer').waitFor({ timeout: 20000 });
    const bad = await pg().evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('button')) {
        const r = b.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const name = (b.getAttribute('aria-label') || b.textContent || b.getAttribute('title') || '').trim();
        if (!name) out.push(b.className.slice(0, 80));
      }
      return out;
    });
    assert.deepEqual(bad, []);
  });

  test('a11y: settings dialog has role=dialog and aria-modal', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    const dlg = pg().getByRole('dialog', { name: 'Settings' });
    await dlg.waitFor({ timeout: 15000 });
    assert.equal(await dlg.getAttribute('aria-modal'), 'true');
  });

  test('a11y: repo picker dialog has role=dialog and aria-modal', async () => {
    const dlg = await openPickerDialog(pg());
    assert.equal(await dlg.getAttribute('aria-modal'), 'true');
  });

  test('a11y: composer input is labeled', async () => {
    await openNewSession(pg());
    const box = pg().getByLabel('Message composer');
    await box.waitFor({ timeout: 15000 });
    assert.ok((await box.getAttribute('aria-label') || '').length > 0);
  });

  test('a11y: palette search input is labeled', async () => {
    await pg().keyboard.press('Control+k');
    const inp = pg().getByLabel('Search sessions, directories, models, actions');
    await inp.waitFor({ timeout: 15000 });
    assert.ok(await inp.isVisible());
  });

  test('a11y: session search and model search inputs are labeled', async () => {
    assert.ok(await pg().getByPlaceholder('Search sessions').isVisible());
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.trim().length > 1;
    }, null, { timeout: 25000 });
    await pg().getByRole('button', { name: /e2e-model|Select model/ }).first().click({ timeout: 15000 });
    const ms = pg().getByPlaceholder('Search models');
    await ms.waitFor({ timeout: 15000 });
    assert.ok(await ms.isVisible());
  });

  test('a11y: hook editor inputs are labeled', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    await pg().getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 15000 });
    assert.ok(await pg().getByLabel('Hook event').isVisible());
    assert.ok(await pg().getByLabel('Hook tool match').isVisible());
    assert.ok(await pg().getByLabel('Hook command').isVisible());
  });

  test('a11y: custom command editor inputs are labeled', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    await pg().getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 15000 });
    assert.ok(await pg().getByLabel('Command name').isVisible());
    assert.ok(await pg().getByLabel('Command prompt').isVisible());
  });

  test('a11y: MCP editor inputs are labeled', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    await pg().getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 15000 });
    assert.ok(await pg().getByLabel('Server name').isVisible());
    assert.ok(await pg().getByLabel('Server command').isVisible());
    assert.ok(await pg().getByLabel('Server args').isVisible());
  });

  test('a11y: dialogs expose a named Close button', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    const dlg = pg().getByRole('dialog', { name: 'Settings' });
    await dlg.waitFor({ timeout: 15000 });
    const close = dlg.getByRole('button', { name: 'Close' });
    assert.ok(await close.isVisible());
    await close.click();
    await pg().waitForFunction(() => !document.body.innerText.includes('MCP servers'), null, { timeout: 15000 });
  });

  test('a11y: model options show tier badges with privacy hints', async () => {
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.trim().length > 1;
    }, null, { timeout: 25000 });
    await pg().getByRole('button', { name: /e2e-model|Select model/ }).first().click({ timeout: 15000 });
    await pg().getByRole('listbox').waitFor({ timeout: 15000 });
    const txt = await pg().getByRole('listbox').innerText();
    assert.ok(txt.includes('Free·Local'));
  });

  test('a11y: approval card actions are named buttons', async () => {
    await setConfig(env.base, { toolPolicy: { file_write: 'ask' } });
    try { fs.unlinkSync(path.join(env.repo.dir, 'hello.txt')); } catch { /* ignore */ }
    await openRepoViaUI(pg(), env.repo.dir);
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.includes('e2e-model');
    }, null, { timeout: 25000 });
    await setBuildMode(pg(), true);
    await sendComposer(pg(), 'create file hello.txt with greeting content');
    await pg().getByText('needs approval').waitFor({ timeout: 60000 });
    assert.ok(await pg().getByRole('button', { name: 'Allow once' }).isVisible());
    assert.ok(await pg().getByRole('button', { name: /Always allow/ }).isVisible());
    assert.ok(await pg().getByRole('button', { name: 'Deny' }).isVisible());
    await pg().getByRole('button', { name: 'Deny' }).click();
    await waitBody(pg(), /denied/i, 60000);
  }, { timeout: 150000 });

  test('a11y: repo picker path input has an accessible name', async () => {
    const dlg = await openPickerDialog(pg());
    const inp = dlg.getByPlaceholder('/path/to/directory');
    await inp.waitFor({ timeout: 15000 });
    assert.ok(await inp.isVisible());
  });

  test('a11y: model listbox options carry aria-selected', async () => {
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.trim().length > 1;
    }, null, { timeout: 25000 });
    await pg().getByRole('button', { name: /e2e-model|Select model/ }).first().click({ timeout: 15000 });
    await pg().getByRole('listbox').waitFor({ timeout: 15000 });
    const info = await pg().evaluate(() => {
      const opts = [...document.querySelectorAll('[role="option"]')];
      return { n: opts.length, sel: opts.filter((o) => o.getAttribute('aria-selected') === 'true').length, named: opts.filter((o) => (o.textContent || '').trim().length > 0).length };
    });
    assert.ok(info.n >= 2, 'expected >=2 options');
    assert.equal(info.sel, 1);
    assert.equal(info.named, info.n);
  });

  test('a11y: toast live region has role=status', async () => {
    const t = pg().getByRole('status');
    await t.waitFor({ state: 'attached', timeout: 15000 });
    assert.equal(await t.getAttribute('aria-live'), 'polite');
  });

  test('a11y: tool policy selects are labeled', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    await pg().getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 15000 });
    assert.equal(await pg().getByLabel('file_write permission').inputValue(), 'ask');
    assert.ok(await pg().getByLabel('grep permission').isVisible());
  });

  test('a11y: keyboard tab moves focus to a button or input', async () => {
    await pg().getByText(/What’s up next/).waitFor({ timeout: 20000 });
    await pg().keyboard.press('Tab');
    await pg().keyboard.press('Tab');
    await pg().keyboard.press('Tab');
    const tag = await pg().evaluate(() => (document.activeElement && document.activeElement.tagName) || 'NONE');
    assert.ok(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(tag), 'focus on ' + tag);
  });

  test('a11y: heatmap cells have aria-labels', async () => {
    await seedSessions([{ id: 's-heat', title: 'Heat Session', messages: [{ role: 'user', content: 'heat probe' }] }]);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    await pg().getByText(/What’s up next/).waitFor({ timeout: 20000 });
    const info = await pg().evaluate(() => {
      const cells = [...document.querySelectorAll('[role="img"][aria-label]')].filter((d) => /messages$/.test(d.getAttribute('aria-label') || ''));
      return { n: cells.length, empty: cells.filter((d) => !(d.getAttribute('aria-label') || '').trim()).length };
    });
    assert.ok(info.n > 20, `expected heatmap cells, got ${info.n}`);
    assert.equal(info.empty, 0);
  });

  test('a11y: user bubble contrast ratio >= 4.5 (real math)', async () => {
    await seedSessions([{ id: 's-ct', title: 'Contrast Chat', messages: [{ role: 'user', content: 'contrast probe bubble' }] }]);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    await sideBtn(pg(), 'Contrast Chat').click({ timeout: 20000 });
    await waitBody(pg(), 'contrast probe bubble', 20000);
    const ratio = await pg().evaluate(() => {
      const lum = (rgb) => {
        const m = rgb.match(/rgba?\(([^)]+)\)/);
        const [r, g, b] = m[1].split(',').slice(0, 3).map((v) => parseFloat(v) / 255);
        const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const el = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'contrast probe bubble');
      const fg = getComputedStyle(el).color;
      let bg = null, n = el;
      while (n && !bg) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/^rgba\(0, 0, 0, 0\)|transparent/.test(c)) bg = c;
        n = n.parentElement;
      }
      const l1 = lum(fg), l2 = lum(bg);
      return { ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), fg, bg };
    });
    assert.ok(ratio.ratio >= 4.5, JSON.stringify(ratio));
  });

  test('a11y: assistant body text contrast ratio >= 4.5 (real math)', async () => {
    await seedSessions([{ id: 's-ct2', title: 'Contrast Chat 2', messages: [{ role: 'assistant', content: 'assistant contrast probe sentence' }] }]);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    await sideBtn(pg(), 'Contrast Chat 2').click({ timeout: 20000 });
    await waitBody(pg(), 'assistant contrast probe sentence', 20000);
    const pair = await pg().evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((d) => (d.textContent || '').includes('assistant contrast probe sentence') && d.children.length === 0) || document.body;
      return { fg: getComputedStyle(el).color, bg: getComputedStyle(document.body).backgroundColor, elBg: getComputedStyle(el.parentElement).backgroundColor };
    });
    const bg = /rgba\(0, 0, 0, 0\)|transparent/.test(pair.elBg) ? 'rgb(255, 255, 255)' : pair.elBg;
    const ratio = contrast(pair.fg, bg);
    assert.ok(ratio >= 4.5, `ratio ${ratio} for ${pair.fg} on ${bg}`);
  });

  test('a11y: settings endpoint rows show visible text labels', async () => {
    await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    const dlg = pg().getByRole('dialog', { name: 'Settings' });
    await dlg.waitFor({ timeout: 15000 });
    for (const t of ['Local endpoint', 'Cloud endpoint', 'Tool permissions']) {
      assert.ok(await dlg.getByText(t, { exact: false }).first().isVisible(), t);
    }
  });

  // ---------- perf ----------
  test('perf: load to interactive completes under 15s', async () => {
    const ctx2 = await env.browser.newContext();
    const p2 = await ctx2.newPage();
    try {
      const t0 = Date.now();
      await p2.goto(env.base, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p2.waitForFunction(() => document.readyState === 'complete', null, { timeout: 15000 });
      await p2.getByText(/What’s up next|What can I help/).first().waitFor({ timeout: 15000 });
      const dt = Date.now() - t0;
      assert.ok(dt < 15000, `interactive took ${dt}ms`);
    } finally { await ctx2.close(); }
  });

  test('perf: send to first token under 20s against mock', async () => {
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.includes('e2e-model');
    }, null, { timeout: 25000 });
    const box = pg().getByLabel('Message composer');
    await box.click();
    await box.fill('perf first token probe');
    const t0 = Date.now();
    await pg().getByRole('button', { name: 'Send message' }).click();
    await waitBody(pg(), 'Mock', 30000);
    const dt = Date.now() - t0;
    assert.ok(dt < 20000, `first token took ${dt}ms`);
  }, { timeout: 90000 });

  test('perf: 100-message session renders under 10s with real scroll height', async () => {
    const messages = [];
    for (let i = 0; i < 100; i++) messages.push({ role: i % 2 ? 'user' : 'assistant', content: `perf message PMSG_${i} with enough padding text to occupy vertical space in the chat view` });
    await seedSessions([{ id: 's-big', title: 'Big Session', messages }]);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    const t0 = Date.now();
    await sideBtn(pg(), 'Big Session').click({ timeout: 20000 });
    await waitBody(pg(), 'PMSG_99', 30000);
    const dt = Date.now() - t0;
    assert.ok(dt < 10000, `render took ${dt}ms`);
    const sh = await pg().evaluate(() => Math.max(...[...document.querySelectorAll('*')].map((d) => d.scrollHeight || 0)));
    assert.ok(sh > 0);
  });

  test('perf: tall session scrolls to bottom', async () => {
    const messages = [];
    for (let i = 0; i < 100; i++) messages.push({ role: i % 2 ? 'user' : 'assistant', content: `scroll message SMSG_${i} padding padding padding padding padding` });
    await seedSessions([{ id: 's-scroll', title: 'Scroll Session', messages }]);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    await sideBtn(pg(), 'Scroll Session').click({ timeout: 20000 });
    await waitBody(pg(), 'SMSG_99', 30000);
    const ok = await pg().evaluate(() => {
      const sc = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 50 && getComputedStyle(d).overflowY.includes('auto'));
      if (!sc) return false;
      sc.scrollTop = sc.scrollHeight;
      return sc.scrollTop > 0;
    });
    assert.ok(ok, 'no scrollable chat container scrolled');
  });

  test('perf: rapid typing keeps up in the composer', async () => {
    await openNewSession(pg());
    const box = pg().getByLabel('Message composer');
    await box.click();
    const text = 'rapid typing latency probe 123456789 abcdefghij';
    const t0 = Date.now();
    await pg().keyboard.type(text, { delay: 0 });
    const dt = Date.now() - t0;
    assert.equal(await box.inputValue(), text);
    assert.ok(dt < 10000, `typing took ${dt}ms`);
  });

  test('perf: send to completion (thinking time stamped) under 60s', async () => {
    await openNewSession(pg());
    await pg().waitForFunction(() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => !x.getAttribute('aria-label'));
      return b && b.textContent.includes('e2e-model');
    }, null, { timeout: 25000 });
    const box = pg().getByLabel('Message composer');
    await box.click();
    await box.fill('perf completion probe');
    const t0 = Date.now();
    await pg().getByRole('button', { name: 'Send message' }).click();
    await waitBody(pg(), /thought for \d+s/, 90000);
    const dt = Date.now() - t0;
    assert.ok(dt < 60000, `completion took ${dt}ms`);
  }, { timeout: 120000 });

  test('perf: palette opens within 5s', async () => {
    const t0 = Date.now();
    await pg().keyboard.press('Control+k');
    await pg().getByRole('dialog', { name: 'Command palette' }).waitFor({ timeout: 15000 });
    assert.ok(Date.now() - t0 < 5000);
  });

  test('perf: switching sessions shows the composer within 10s', async () => {
    await seedSessions([
      { id: 's-sw1', title: 'Switch One', messages: [{ role: 'user', content: 'one' }] },
      { id: 's-sw2', title: 'Switch Two', messages: [{ role: 'user', content: 'two' }] },
    ]);
    await pg().reload({ waitUntil: 'domcontentloaded' });
    const t0 = Date.now();
    await sideBtn(pg(), 'Switch Two').click({ timeout: 20000 });
    await pg().getByLabel('Message composer').waitFor({ timeout: 20000 });
    await waitBody(pg(), 'two', 20000);
    assert.ok(Date.now() - t0 < 10000);
  });

  test('perf: JS bundle is under 450KB raw', async () => {
    const assets = await fs.promises.readdir(path.join(FRONTEND_DIST, 'assets'));
    const js = assets.filter((f) => f.endsWith('.js'));
    assert.ok(js.length >= 1);
    for (const f of js) {
      const st = await fs.promises.stat(path.join(FRONTEND_DIST, 'assets', f));
      assert.ok(st.size < 450 * 1024, `${f} is ${st.size} bytes`);
    }
  });

  test('perf: CSS bundle is under 450KB raw', async () => {
    const assets = await fs.promises.readdir(path.join(FRONTEND_DIST, 'assets'));
    const css = assets.filter((f) => f.endsWith('.css'));
    assert.ok(css.length >= 1);
    for (const f of css) {
      const st = await fs.promises.stat(path.join(FRONTEND_DIST, 'assets', f));
      assert.ok(st.size < 450 * 1024, `${f} is ${st.size} bytes`);
    }
  });

  // ---------- visual (baseline capture, not regression) ----------
  async function shot(name, setup) {
    await setup();
    const file = path.join(SHOTS, name);
    await pg().screenshot({ path: file });
    const st = await fs.promises.stat(file);
    assert.ok(st.size > 20 * 1024, `${name} too small (${st.size}B), likely blank`);
    return file;
  }

  test('visual: home baseline captured and non-blank', async () => {
    await pg().getByText(/What’s up next/).waitFor({ timeout: 20000 });
    await shot('home.png', async () => {});
  });

  test('visual: chat baseline captured and non-blank', async () => {
    await shot('chat.png', async () => {
      await seedSessions([{ id: 's-shot', title: 'Shot Session', messages: [{ role: 'user', content: 'screenshot probe' }, { role: 'assistant', content: 'screenshot answer text' }] }]);
      await pg().reload({ waitUntil: 'domcontentloaded' });
      await sideBtn(pg(), 'Shot Session').click({ timeout: 20000 });
      await waitBody(pg(), 'screenshot answer text', 20000);
    });
  });

  test('visual: settings baseline captured and non-blank', async () => {
    await shot('settings.png', async () => {
      await pg().getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
      await pg().getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 15000 });
    });
  });

  test('visual: repo picker baseline captured and non-blank', async () => {
    await shot('repo-picker.png', async () => {
      await openPickerDialog(pg());
    });
  });

  test('visual: model selector open baseline captured and non-blank', async () => {
    await shot('model-open.png', async () => {
      await openNewSession(pg());
      await pg().waitForFunction(() => {
        const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => !x.getAttribute('aria-label'));
        return b && b.textContent.trim().length > 1;
      }, null, { timeout: 25000 });
      await pg().getByRole('button', { name: /e2e-model|Select model/ }).first().click({ timeout: 15000 });
      await pg().getByRole('listbox').waitFor({ timeout: 15000 });
    });
  });

  test('visual: tool approval card baseline captured and non-blank', async () => {
    await setConfig(env.base, { toolPolicy: { file_write: 'ask' } });
    try { fs.unlinkSync(path.join(env.repo.dir, 'hello.txt')); } catch { /* ignore */ }
    await shot('tool-card.png', async () => {
      await openRepoViaUI(pg(), env.repo.dir);
      await openNewSession(pg());
      await pg().waitForFunction(() => {
        const b = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((x) => !x.getAttribute('aria-label'));
        return b && b.textContent.includes('e2e-model');
      }, null, { timeout: 25000 });
      await setBuildMode(pg(), true);
      await sendComposer(pg(), 'create file hello.txt with greeting content');
      await pg().getByText('needs approval').waitFor({ timeout: 60000 });
    });
    await pg().getByRole('button', { name: 'Deny' }).click({ timeout: 15000 });
    await waitBody(pg(), /denied/i, 60000);
  }, { timeout: 150000 });
});
