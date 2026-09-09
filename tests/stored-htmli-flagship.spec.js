// Behavioral tests for the FLAGSHIP challenge: Stored HTML Injection → IPC Token Exfiltration.
//
// Drives the REAL Electron app (via Playwright's `_electron`), so these exercise the actual
// open-analytics IPC path, the actual privileged analytics window, the actual stored-name sink and
// the actual flag-grading handler.
//
// ── WHAT THIS SPEC DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────
// The flagship's solution is withheld until after the conference talks, and a test file is part of
// the shipped repository — an end-to-end solve committed here would publish the answer just as
// surely as a writeup would. So this spec covers the challenge's PRIMITIVES and GUARDRAILS, never
// the chain:
//   * it never performs (or describes) the injection → redirect → privileged-call chain;
//   * it never reads the real session token, so it never submits one either;
//   * no `DVEA{...}` flag literal appears anywhere in this file, and the only flag assertion is a
//     negative one (a wrong submission must reveal nothing).
// The positive grading path is covered at the source level instead — the comparison and the reward
// are asserted by reading the handler, which proves the grading logic is honest without encoding a
// solve. Do not "improve" this spec by automating the solve.
//
// What IS asserted end to end: that a stored display name really reaches a separate privileged
// window, that the sink really parses it as HTML (with inert markup — never a payload), that the
// window is genuinely hardened at the config level so the challenge cannot be won by a
// webPreferences weakness, and that the anti-shortcut properties of the token hold.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.resolve(__dirname, '..');
const ELECTRON_BIN = path.join(
  APP_DIR,
  'node_modules/electron/dist/electron' + (process.platform === 'win32' ? '.exe' : '')
);
const USER_DATA_DIR = path.join(os.tmpdir(), `dvea-test-flagship-${process.pid}`);
const PAGES_DIR = path.join(APP_DIR, 'src/renderer/pages');
const MODULE_URL = pathToFileURL(path.join(PAGES_DIR, 'stored-htmli.html')).href;
const INDEX_URL = pathToFileURL(path.join(PAGES_DIR, 'index.html')).href;

const MAIN_JS = () => fs.readFileSync(path.join(APP_DIR, 'src/main/main.js'), 'utf8');

// Effective webPreferences for a window, read from the main process the same way the Config
// Inspector does (getLastWebPreferences = what Electron actually applied, not what was declared).
const effectivePrefsFor = (app, urlFragment) =>
  app.evaluate(({ webContents }, fragment) => {
    const wc = webContents
      .getAllWebContents()
      .find((c) => c.getType() === 'window' && c.getURL().includes(fragment));
    if (!wc) return null;
    const wp = wc.getLastWebPreferences() || {};
    // NB: Electron 40's getLastWebPreferences() does not report the preload path, so the preload
    // is confirmed behaviorally (below) and at the source level instead.
    return {
      contextIsolation: !!wp.contextIsolation,
      nodeIntegration: !!wp.nodeIntegration,
      sandbox: !!wp.sandbox,
    };
  }, urlFragment);

test.describe('Stored HTML Injection → IPC Token Exfiltration (flagship)', () => {
  let app;
  let page;

  test.beforeAll(async () => {
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      cwd: APP_DIR,
      // Own userData for this instance's single-instance lock (see requestSingleInstanceLock in
      // main.js) so it doesn't collide with other specs or a running DVEA. No --no-sandbox here:
      // one of the assertions below is that the analytics window is genuinely hardened, and that
      // is only meaningful if the OS sandbox is allowed to apply.
      args: [APP_DIR, `--user-data-dir=${USER_DATA_DIR}`],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ELECTRON_NO_ATTACH_CONSOLE: '' },
      timeout: 30_000,
    });

    page =
      app.windows().find((w) => w.url().includes('index.html')) ||
      (await app.waitForEvent('window', {
        predicate: (w) => w.url().includes('index.html'),
        timeout: 15_000,
      }));
    await page.waitForLoadState('domcontentloaded');

    // Plain hub link: navigating the main window keeps its default preload (window.api).
    await page.goto(MODULE_URL);
    await page.waitForSelector('#profileForm');
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch (err) {}
  });

  test('the hub presents it as the flagship', async () => {
    await page.goto(INDEX_URL);
    const link = page.locator('a[href="stored-htmli.html"]');
    await expect(link).toHaveCount(1);
    await expect(link).toContainText('Flagship');
    await page.goto(MODULE_URL);
    await page.waitForSelector('#profileForm');
  });

  test('the landing page states the objective and carries no solution content', async () => {
    await expect(page.locator('h1')).toHaveText('Stored HTML Injection → IPC Token Exfiltration');

    // Concept hints only, collapsed by default — never open, never a payload.
    const hints = page.locator('.panel details');
    await expect(hints).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      expect(await hints.nth(i).evaluate((el) => el.open)).toBe(false);
    }

    // No walkthrough, no fix panel, no payload block, and — critically — no path to an answer.
    await expect(page.locator('.code')).toHaveCount(0);
    await expect(page.locator('a[href*="writeup" i]')).toHaveCount(0);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('walkthrough — ');
    expect(body).not.toContain('solution');
  });

  test('the repository deliberately ships no writeup for this challenge', async () => {
    // Guard for the withholding decision recorded in README/CONTRIBUTING: every other
    // challenge-style lab has a writeup; this one must not, until after the talks.
    const writeups = fs.readdirSync(path.join(APP_DIR, 'writeups'));
    const leak = writeups.filter((f) => /stored|htmli|flagship|token.?exfil/i.test(f));
    expect(leak, `unexpected flagship writeup in writeups/: ${leak.join(', ')}`).toEqual([]);
    // And the other labs still have theirs, so this assertion can't pass by an empty folder.
    expect(writeups.length).toBeGreaterThan(5);
  });

  test('storing a display name opens a separate, privileged analytics window', async () => {
    // A completely benign name: what is under test is the plumbing, not an injection.
    await page.fill('#displayName', 'QA Bot');
    const [analytics] = await Promise.all([
      app.waitForEvent('window', {
        predicate: (w) => w.url().includes('analytics.html'),
        timeout: 15_000,
      }),
      page.click('#profileForm button[type=submit]'),
    ]);
    await analytics.waitForLoadState('domcontentloaded');

    // It is a genuinely separate window, and it shows the name that was stored on the other page.
    expect(analytics.url()).not.toBe(page.url());
    await expect(analytics.locator('#participantName')).toHaveText('QA Bot');
    await analytics.close();
  });

  test('the stored name is parsed as HTML, not rendered as text', async () => {
    // Inert markup only — <b> proves the sink is an HTML sink without being an exploit. That the
    // sink parses HTML is already public (it is in the module's title); HOW to weaponize it is the
    // withheld part and is not exercised here.
    await page.fill('#displayName', 'QA <b>Bot</b>');
    const [analytics] = await Promise.all([
      app.waitForEvent('window', {
        predicate: (w) => w.url().includes('analytics.html'),
        timeout: 15_000,
      }),
      page.click('#profileForm button[type=submit]'),
    ]);
    await analytics.waitForLoadState('domcontentloaded');

    // A real element was created — so the name reached an innerHTML-style sink, not textContent.
    await expect
      .poll(() => analytics.locator('#participantName b').count(), { timeout: 10_000 })
      .toBe(1);
    await expect(analytics.locator('#participantName b')).toHaveText('Bot');

    // The privileged window is hardened at the config level: this challenge is not winnable by
    // finding a webPreferences weakness, which is exactly what makes it the flagship.
    const prefs = await effectivePrefsFor(app, 'analytics.html');
    expect(prefs, 'analytics window not found in the main process').toBeTruthy();
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    // The window's preload really is attached (only preload-analytics.js creates this global).
    // Its existence is already public — it is referenced by the shipped analytics renderer — and
    // this spec deliberately goes no further than confirming it is there.
    expect(await analytics.evaluate(() => typeof window.analyticsAPI)).toBe('object');
    if (!prefs.sandbox) {
      // Effective sandbox=false means this environment could not enforce the OS sandbox — almost
      // always the missing chrome-sandbox setuid fix (see the README troubleshooting note). Worth
      // surfacing, but it is not this module's bug.
      test.info().annotations.push({
        type: 'warning',
        description:
          'Effective sandbox=false — likely the chrome-sandbox setuid fix is missing; see README.',
      });
    }

    // And the window really does enforce a Content-Security-Policy (the Scope panel promises the
    // player it is real, not a red herring).
    const csp = await analytics.evaluate(
      () =>
        document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ||
        null
    );
    expect(csp).toBeTruthy();
    expect(csp).toContain('script-src');

    await analytics.close();
  });

  test('a wrong submission is rejected and reveals nothing', async () => {
    // The only grading assertion made end to end. The positive path is covered by source guards
    // below, on purpose — see the header comment.
    await page.fill('#flagSubmit', `not-the-token-${process.pid}`);
    await page.click('#flagSubmitBtn');

    const result = page.locator('#flagResult');
    await expect(result).toBeVisible();
    await expect(result).toHaveText('Not the token. Keep going.');
    await expect(result).toHaveClass(/status-err/);
    // No flag, and no fragment of one, leaks on the failure path.
    await expect(result).not.toContainText('DVEA{');
    expect(await page.locator('body').innerText()).not.toContain('DVEA{');
  });

  test('an empty submission is not graded at all', async () => {
    await page.fill('#flagSubmit', '   ');
    await page.click('#flagSubmitBtn');
    await expect(page.locator('#flagResult')).toHaveText('Paste the token you captured.');
  });

  test('the session token cannot be recovered by reading the shipped app', async () => {
    // The anti-shortcut property: the token is generated per launch in main-process memory, so
    // grepping the source (or the packaged app.asar built from it) yields nothing to submit.
    // Expressed as a PATTERN so this test never has to hold the real value.
    const src = MAIN_JS();
    expect(src).toMatch(/const STORED_HTMLI_TOKEN = 'sess_live_' \+ crypto\.randomBytes\(/);

    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'fonts') continue;
          walk(full);
        } else if (/\.(js|html|css|json|md|txt)$/i.test(entry.name)) {
          // A literal, pre-baked token value anywhere in the tree would be a grep-able shortcut.
          if (/sess_live_[0-9a-f]{6,}/i.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
        }
      }
    };
    walk(path.join(APP_DIR, 'src'));
    walk(path.join(APP_DIR, 'writeups'));
    expect(offenders, `static token literal found in: ${offenders.join(', ')}`).toEqual([]);
  });

  test('get-token still answers without validating the sender', async () => {
    // Source-level guard on the vulnerability itself. The whole challenge rests on this handler
    // answering whoever asks; if sender validation is ever added to it (rather than as a separate
    // hardened variant), this catches it.
    const handler = MAIN_JS().match(/ipcMain\.handle\('get-token'[\s\S]*?\n\s*\}\);/);
    expect(handler, "the 'get-token' handler was not found in main.js").toBeTruthy();
    expect(handler[0]).toContain('return STORED_HTMLI_TOKEN;');
    expect(handler[0]).not.toMatch(/senderFrame/);
    expect(handler[0]).not.toMatch(/event\.sender\b/);
    expect(handler[0]).not.toMatch(/allow(ed|list)/i);

    // The privileged bridge is still bound to the WINDOW via its preload, which is the trust
    // boundary this challenge is about.
    expect(MAIN_JS()).toContain("preload: path.join(__dirname, 'preload-analytics.js')");
    const preload = fs.readFileSync(path.join(APP_DIR, 'src/main/preload-analytics.js'), 'utf8');
    expect(preload).toContain("getToken: () => ipcRenderer.invoke('get-token')");
  });

  test('grading compares against the live token and is the only source of the flag', async () => {
    // Source-level coverage of the positive path, so the honesty of grading is asserted without
    // this repository containing a solve. Deliberately matched by shape, not by flag value.
    const handler = MAIN_JS().match(/ipcMain\.handle\('submit-stored-htmli-flag'[\s\S]*?\n\s*\}\);/);
    expect(handler, 'the flag-grading handler was not found in main.js').toBeTruthy();
    // An exact, trimmed comparison against the live in-memory token — not a prefix or a substring.
    expect(handler[0]).toContain('submitted.trim() === STORED_HTMLI_TOKEN');
    // The reward is returned only on that match, and only by reference to the constant.
    expect(handler[0]).toMatch(/ok:\s*true,\s*flag:\s*STORED_HTMLI_FLAG/);
    expect(handler[0]).toMatch(/\{\s*ok:\s*false\s*\}/);
    // The renderer never holds the answer: the page only forwards what the user typed.
    const rendererJs = fs.readFileSync(path.join(APP_DIR, 'src/renderer/js/stored-htmli.js'), 'utf8');
    expect(rendererJs).not.toMatch(/DVEA\{/);
    expect(rendererJs).not.toMatch(/sess_live_/);
  });
});
