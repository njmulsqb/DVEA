// Behavioral tests for Deep Link Hijacking → Untrusted Navigation.
//
// Drives the REAL Electron app (via Playwright's `_electron`) rather than importing internal
// functions, so these exercise the actual main-process navigation helper, the actual IPC handler
// and the actual credential-forwarding path. Everything runs from source — no packaged build and
// no OS scheme registration required, so this is runnable in CI and on a fresh clone.
//
// Both entry points are covered on purpose: a REAL dvea://navigate?url=... deep link (delivered
// in argv exactly as the OS delivers it) and the in-app simulator button. They must stay
// equivalent — CLAUDE.md records that both funnel through the one shared
// openUntrustedNavigationWindow() helper, and drifting back to two similar-but-different
// implementations is an inconsistency that has already had to be fixed once.
//
// Three things about this app make naive assertions silently wrong; each is relied on below:
//   1. BrowserWindow.getAllWindows() omits windows built through the `Window` subclass
//      (src/main/windows/Window.js) — including the main window. Enumerate webContents instead.
//   2. Route pages NAVIGATE the existing main window, so Playwright's 'window' creation event
//      never fires for them. Poll instead of waiting on that event.
//   3. The simulator lives inside a <details> that is collapsed by default.
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
const MAIN_JS_PATH = path.join(APP_DIR, 'src/main/main.js');
const PAGES_DIR = path.join(APP_DIR, 'src/renderer/pages');
const ROUTE_PAGE = 'deep-link-untrusted-navigation.html';
const ROUTE_URL = pathToFileURL(path.join(PAGES_DIR, ROUTE_PAGE)).href;

// A bundled page is an offline-safe stand-in for "attacker-controlled content": what's under test
// is that main loads whatever URL it is handed without validation, not that the network is up.
// fake-login.html is also the lab's own suggested target for the credential-harvest step.
const FAKE_LOGIN_URL = pathToFileURL(path.join(PAGES_DIR, 'fake-login.html')).href;

// Every launch needs its own userData: the single-instance lock in main.js is keyed on it, so
// without this a second instance — another spec running in parallel, or a DVEA the developer
// already has open — is refused and quits instead of starting.
let uddCounter = 0;
const nextUserDataDir = () =>
  path.join(os.tmpdir(), `dvea-test-dl-nav-${process.pid}-${++uddCounter}`);

function launchApp(extraArgs = []) {
  return electron.launch({
    executablePath: ELECTRON_BIN,
    cwd: APP_DIR,
    // --no-sandbox keeps this runnable where chrome-sandbox hasn't had the setuid fix applied
    // (see the Linux note in README/CLAUDE.md). It affects nothing under test here: this module
    // is about main-process navigation, not renderer isolation.
    args: [APP_DIR, '--no-sandbox', `--user-data-dir=${nextUserDataDir()}`, ...extraArgs],
    // Some shells/CI runners export these for unrelated tooling; if set, Electron runs as plain
    // Node instead of launching the app, so force them off for this launch only.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ELECTRON_NO_ATTACH_CONSOLE: '' },
    timeout: 30_000,
  });
}

// Window state read from the main process, derived from webContents rather than
// BrowserWindow.getAllWindows() — see note 1 at the top of this file.
const windowStates = (app) =>
  app.evaluate(({ BrowserWindow, webContents }) =>
    webContents
      .getAllWebContents()
      .filter((wc) => wc.getType() === 'window')
      .map((wc) => {
        const win = BrowserWindow.fromWebContents(wc);
        return { url: wc.getURL(), visible: !!(win && win.isVisible()) };
      })
  );

const hasVisible = async (app, fragment) =>
  (await windowStates(app)).some((w) => w.url.includes(fragment) && w.visible);

// Expand the collapsed <details> the way a user does, rather than reaching past the UI.
async function openSimulator(page) {
  await page.waitForSelector('#simulate', { state: 'attached' });
  await page.evaluate(() => {
    const details = document.getElementById('simulate')?.closest('details');
    if (details) details.open = true;
  });
  await page.waitForSelector('#simulate', { state: 'visible' });
}

test.describe('Deep Link → Untrusted Navigation', () => {
  test.describe('a real dvea:// deep link', () => {
    test('COLD START: the OS launches the app with the link in argv', async () => {
      // Regression guard. handleDeepLink() was once reachable only from app.on('open-url')
      // (macOS-only) and app.on('second-instance') (needs the single-instance lock, which was
      // never requested). On Linux/Windows nothing read process.argv, so a cold-start deep link
      // opened the app and silently did nothing.
      const app = await launchApp([`dvea://navigate?url=${FAKE_LOGIN_URL}`]);
      try {
        await expect
          .poll(() => hasVisible(app, 'fake-login.html'), {
            message: 'a cold-start dvea://navigate deep link opened no visible window',
            timeout: 20_000,
          })
          .toBe(true);

        // Asserted in the same launch rather than its own, to keep the number of concurrently
        // running Electron processes down. Two properties give the lab its impact: a
        // BrowserWindow has no address bar by construction, so the victim gets no origin signal,
        // and the window is handed the same privileged preload the trusted app pages use.
        //
        // Checked by probing the page rather than reading getLastWebPreferences().preload —
        // Electron does not report the preload path through that API — and probing is the
        // stronger assertion regardless: it proves the bridge is genuinely reachable from
        // attacker-controlled content, which is what makes the credential harvest below work.
        const attackerPage = app.windows().find((w) => w.url().includes('fake-login.html'));
        expect(attackerPage, 'the attacker page was never exposed to Playwright').toBeTruthy();
        await attackerPage.waitForSelector('#login');
        const bridge = await attackerPage.evaluate(() => ({
          api: typeof window.api,
          sendCapturedCredentials: typeof window.api?.sendCapturedCredentials,
        }));
        expect(bridge).toEqual({ api: 'object', sendCapturedCredentials: 'function' });
      } finally {
        await app.close().catch(() => {});
      }
    });

    test('there is no allowlist — an arbitrary origin is accepted verbatim', async () => {
      // A data: URL keeps this about the ABSENCE of validation rather than network reachability.
      // If this fails, an allowlist was introduced and the lab is no longer exploitable.
      const app = await launchApp(['dvea://navigate?url=data:text/html,<h1>attacker</h1>']);
      try {
        await expect
          .poll(async () => (await windowStates(app)).some((w) => w.url.startsWith('data:text/html')), {
            message: 'a data: URL was rejected — has an allowlist been added?',
            timeout: 20_000,
          })
          .toBe(true);
      } finally {
        await app.close().catch(() => {});
      }
    });

  });

  test.describe('the in-app simulator', () => {
    let app;
    let mainWindow;

    test.beforeAll(async () => {
      app = await launchApp();
      mainWindow =
        app.windows().find((w) => w.url().includes('index.html')) ||
        (await app.waitForEvent('window', {
          predicate: (w) => w.url().includes('index.html'),
          timeout: 15_000,
        }));
      await mainWindow.waitForLoadState('domcontentloaded');
    });

    test.afterAll(async () => {
      await app?.close().catch(() => {});
    });

    // Close anything a test spawned so counts start from a known state.
    test.afterEach(async () => {
      await app.evaluate(({ BrowserWindow, webContents }, keep) => {
        for (const wc of webContents.getAllWebContents()) {
          if (wc.getType() !== 'window') continue;
          if (keep.some((f) => wc.getURL().includes(f))) continue;
          BrowserWindow.fromWebContents(wc)?.destroy();
        }
      }, ['index.html', 'panel.html', ROUTE_PAGE]);
    });

    async function gotoRoute(from = 'index') {
      await mainWindow.goto(`${ROUTE_URL}?from=${from}`);
      await openSimulator(mainWindow);
    }

    test('the hub links to this route', async () => {
      await mainWindow.goto(pathToFileURL(path.join(PAGES_DIR, 'index.html')).href);
      await mainWindow.click(`a[href="${ROUTE_PAGE}?from=index"]`);
      await mainWindow.waitForSelector('#simulate', { state: 'attached' });
      expect(mainWindow.url()).toContain(ROUTE_PAGE);
    });

    test('a fully-qualified URL opens a visible window and reports success', async () => {
      await gotoRoute();
      await mainWindow.fill('#target', FAKE_LOGIN_URL);
      await mainWindow.click('#simulate');

      await expect
        .poll(() => hasVisible(app, 'fake-login.html'), {
          message: 'Simulate Deep Link opened no visible window',
          timeout: 15_000,
        })
        .toBe(true);
      await expect(mainWindow.locator('#simulate-status')).toContainText('Opened a new app window');
    });

    test('a bare hostname is not a silent no-op', async () => {
      // Regression guard. The window is created hidden and revealed on ready-to-show, which only
      // fires once a document COMMITS. 'example.com' is not a valid absolute URL, so nothing
      // committed, the window was never shown, and the click appeared to do nothing while
      // leaking a hidden BrowserWindow every time.
      await gotoRoute();
      const before = (await windowStates(app)).filter((w) => w.visible).length;
      await mainWindow.fill('#target', 'example.com');
      await mainWindow.click('#simulate');

      await expect
        .poll(async () => (await windowStates(app)).filter((w) => w.visible).length, {
          message: 'a scheme-less target produced no visible window',
          timeout: 15_000,
        })
        .toBeGreaterThan(before);
      await expect(mainWindow.locator('#simulate-status')).toContainText('https://example.com');
    });

    test('a pasted dvea:// link is unwrapped rather than dropped', async () => {
      // The "Try It" panel above the simulator teaches this exact link format, so pasting one in
      // is the natural thing to do. loadURL() cannot resolve dvea:// — that scheme is registered
      // with the OS, not with Chromium — so it has to be unwrapped first.
      await gotoRoute();
      await mainWindow.fill('#target', `dvea://navigate?url=${FAKE_LOGIN_URL}`);
      await mainWindow.click('#simulate');

      await expect
        .poll(() => hasVisible(app, 'fake-login.html'), {
          message: 'a pasted dvea:// link did not open the window it names',
          timeout: 15_000,
        })
        .toBe(true);
    });

    test('a target that cannot load still shows a window explaining why', async () => {
      await gotoRoute();
      await mainWindow.fill('#target', 'not a url at all');
      await mainWindow.click('#simulate');

      await expect
        .poll(
          async () => (await windowStates(app)).some((w) => w.url.startsWith('data:text/html') && w.visible),
          {
            message: 'an unloadable target produced no visible diagnostic window',
            timeout: 15_000,
          }
        )
        .toBe(true);
    });

    test('an empty target reports an error and spawns nothing', async () => {
      await gotoRoute();
      const before = (await windowStates(app)).length;
      await mainWindow.fill('#target', '');
      await mainWindow.click('#simulate');

      await expect(mainWindow.locator('#simulate-status')).toContainText('Enter a target URL');
      await mainWindow.waitForTimeout(1_000);
      expect((await windowStates(app)).length).toBe(before);
    });

    test('credentials submitted on the phished page reach the attacker view', async () => {
      // Full chain: attacker window loads the fake login → victim submits → renderer sends
      // 'captured-credentials' → main forwards it to the lab page → attacker view renders it.
      await gotoRoute();
      await expect(mainWindow.locator('#captured-log')).toHaveText('No captured credentials yet.');

      const [loginWindow] = await Promise.all([
        app.waitForEvent('window', {
          predicate: (w) => w.url().includes('fake-login.html'),
          timeout: 15_000,
        }),
        mainWindow.fill('#target', FAKE_LOGIN_URL).then(() => mainWindow.click('#simulate')),
      ]);

      await loginWindow.waitForSelector('#login');
      await loginWindow.fill('input[name=username]', 'victim@example.com');
      await loginWindow.fill('input[name=password]', 'hunter2');
      await loginWindow.click('#login button[type=submit]');

      await expect(mainWindow.locator('#captured-log')).toContainText('victim@example.com');
      await expect(mainWindow.locator('#captured-log')).toContainText('hunter2');
    });

    test('the back link honors ?from=', async () => {
      // This route is reachable from the hub and from the parent overview, and must point back
      // at whichever one the user actually came from.
      await gotoRoute('index');
      await expect(mainWindow.locator('#back-link')).toHaveText('← All Vulnerabilities');
      await expect(mainWindow.locator('#back-link')).toHaveAttribute('href', 'index.html');

      await gotoRoute('parent');
      await expect(mainWindow.locator('#back-link')).toHaveText('← Deep Link Hijacking');
      await expect(mainWindow.locator('#back-link')).toHaveAttribute('href', 'deep-link-hijacking.html');

      // Absent ?from= must fall back to the parent, not leave a dead '#' link.
      await mainWindow.goto(ROUTE_URL);
      await openSimulator(mainWindow);
      await expect(mainWindow.locator('#back-link')).toHaveAttribute('href', 'deep-link-hijacking.html');
    });
  });

  test('the real handler and the simulator share one implementation', async () => {
    // Source-level guard on the invariant in CLAUDE.md. The behavioral tests above can both pass
    // with two parallel implementations that merely agree today; this is what catches them
    // drifting apart.
    const src = fs.readFileSync(MAIN_JS_PATH, 'utf8');

    const handler = src.match(/async function handleDeepLink\([\s\S]*?\n  \}/);
    expect(handler, 'handleDeepLink() not found in main.js').toBeTruthy();
    expect(handler[0]).toContain('openUntrustedNavigationWindow(');

    const simulator = src.match(/ipcMain\.handle\('simulate-deeplink-window'[\s\S]*?\n  \}\);/);
    expect(simulator, "the 'simulate-deeplink-window' handler was not found in main.js").toBeTruthy();
    expect(simulator[0]).toContain('openUntrustedNavigationWindow(');
  });
});
