// Behavioral tests for the openExternal Abuse lab (cf. CVE-2020-25019).
//
// Drives the REAL Electron app (via Playwright's `_electron`) rather than importing internal
// functions, so these exercise the actual unvalidated `open-external` IPC handler end to end.
//
// One thing makes this module different from every other spec in this suite: the vulnerable code
// path's whole point is that it hands URLs to the OPERATING SYSTEM's registered protocol handlers.
// Actually letting it run would launch a browser, a mail client, or whatever else the host has
// registered — on a developer's machine or in CI. So `shell.openExternal` is replaced in the MAIN
// PROCESS with a recorder before anything is clicked (see installOpenExternalRecorder). Everything
// up to that final OS call is the real code: the real preload bridge, the real IPC channel, the
// real handler, and the real argument it would have handed over unmodified. The recorder asserts
// it actually took effect before any test runs, so a failed patch fails the suite instead of
// silently spawning applications.
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
const USER_DATA_DIR = path.join(os.tmpdir(), `dvea-test-openexternal-${process.pid}`);
const PAGES_DIR = path.join(APP_DIR, 'src/renderer/pages');
const MODULE_URL = pathToFileURL(path.join(PAGES_DIR, 'openexternal.html')).href;
const INDEX_URL = pathToFileURL(path.join(PAGES_DIR, 'index.html')).href;

// Replace shell.openExternal in the main process with a recorder. main.js destructures
// `const { shell } = require('electron')` but calls `shell.openExternal(url)` — a property lookup
// at call time on that same object — so assigning the property here is what the handler will
// actually invoke.
async function installOpenExternalRecorder(app) {
  const patched = await app.evaluate(({ shell }) => {
    globalThis.__dveaOpenExternalCalls = [];
    const stub = (url) => {
      globalThis.__dveaOpenExternalCalls.push(url);
      return Promise.resolve();
    };
    stub.__dveaStub = true;
    shell.openExternal = stub;
    return shell.openExternal.__dveaStub === true;
  });
  // Fail loudly rather than proceeding to click buttons that would launch real applications.
  if (!patched) throw new Error('could not replace shell.openExternal — refusing to run');
}

const recordedCalls = (app) => app.evaluate(() => globalThis.__dveaOpenExternalCalls || []);

async function attempt(page, url) {
  await page.fill('#url', url);
  await page.click('#openexternal-form button[type=submit]');
}

test.describe('openExternal Abuse (cf. CVE-2020-25019)', () => {
  let app;
  let page;

  test.beforeAll(async () => {
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      cwd: APP_DIR,
      // Own userData so this instance gets its own single-instance lock (see
      // requestSingleInstanceLock in main.js) and doesn't collide with other specs or a running
      // DVEA. --no-sandbox keeps it runnable without the chrome-sandbox setuid fix; this module is
      // about a main-process shell call, not renderer isolation, so it changes nothing under test.
      args: [APP_DIR, '--no-sandbox', `--user-data-dir=${USER_DATA_DIR}`],
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

    await installOpenExternalRecorder(app);

    // Plain hub link: navigating the main window keeps its default preload (window.api).
    await page.goto(MODULE_URL);
    await page.waitForSelector('#openexternal-form');
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch (err) {}
  });

  test('the hub links to this module', async () => {
    await page.goto(INDEX_URL);
    await expect(page.locator('a[href="openexternal.html"]')).toHaveCount(1);
    await page.goto(MODULE_URL);
    await page.waitForSelector('#openexternal-form');
  });

  test('an ordinary web link reaches the OS handoff verbatim', async () => {
    // Baseline: establishes that the recorder observes what the handler really passes on. The lab
    // itself says a plain https: link proves nothing — the following tests are the actual point.
    const url = 'https://example.com/harmless';
    await attempt(page, url);

    await expect.poll(() => recordedCalls(app), { timeout: 10_000 }).toContain(url);
    await expect(page.locator('#result-log')).toContainText('scheme: https:');
  });

  test('a custom app scheme is handed over with no allowlist and no scheme check', async () => {
    // The real danger the module teaches: schemes belonging to OTHER installed apps, invoked with
    // attacker-chosen arguments. Deliberately a scheme nothing on the host has registered, so the
    // assertion is about DVEA handing it over — not about anything launching.
    const url = 'dvea-not-a-real-scheme://target/path?arg=attacker-controlled&x=1';
    await attempt(page, url);

    await expect.poll(() => recordedCalls(app), { timeout: 10_000 }).toContain(url);

    // Handed over byte-for-byte: no normalization, no stripping, no rejection.
    const calls = await recordedCalls(app);
    expect(calls[calls.length - 1]).toBe(url);
    await expect(page.locator('#result-log')).toContainText('scheme: dvea-not-a-real-scheme:');
  });

  test('a file: URL escapes the "web links only" assumption entirely', async () => {
    const url = pathToFileURL(path.join(PAGES_DIR, 'secret.txt')).href;
    await attempt(page, url);

    await expect.poll(() => recordedCalls(app), { timeout: 10_000 }).toContain(url);
    await expect(page.locator('#result-log')).toContainText('scheme: file:');
  });

  test('a mailto: URL is treated identically to a web link — no discrimination by scheme', async () => {
    const url = 'mailto:victim@example.com?subject=phish&body=click-here';
    await attempt(page, url);

    await expect.poll(() => recordedCalls(app), { timeout: 10_000 }).toContain(url);
    await expect(page.locator('#result-log')).toContainText('scheme: mailto:');
  });

  test('input that is not even a URL is still passed to shell.openExternal unmodified', async () => {
    // The page claims this explicitly ("shell.openExternal() was still called with it,
    // unmodified"). Verify the claim against what main actually received, rather than trusting
    // the UI text.
    const notAUrl = `definitely not a url ${process.pid}`;
    await attempt(page, notAUrl);

    await expect.poll(() => recordedCalls(app), { timeout: 10_000 }).toContain(notAUrl);
    await expect(page.locator('#result-log')).toContainText('did not parse as a URL');
  });

  test('every attempt reached the main process — nothing was filtered on the way', async () => {
    const calls = await recordedCalls(app);
    // Five attempts above, all distinct schemes/shapes, all delivered.
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(calls.some((u) => u.startsWith('https:'))).toBe(true);
    expect(calls.some((u) => u.startsWith('dvea-not-a-real-scheme:'))).toBe(true);
    expect(calls.some((u) => u.startsWith('file:'))).toBe(true);
    expect(calls.some((u) => u.startsWith('mailto:'))).toBe(true);
  });

  test('the open-external handler still performs a genuinely unvalidated handoff', async () => {
    // Source-level guard: the whole lab depends on the handoff being honest. If validation or an
    // allowlist is ever added to the handler itself (rather than as a separate hardened variant),
    // this catches it.
    const src = fs.readFileSync(path.join(APP_DIR, 'src/main/main.js'), 'utf8');
    const handler = src.match(/ipcMain\.handle\('open-external'[\s\S]*?\n\s*\}\);/);
    expect(handler, "the 'open-external' handler was not found in main.js").toBeTruthy();

    // The unvalidated handoff, verbatim.
    expect(handler[0]).toContain('shell.openExternal(url);');
    // And no scheme/host gating snuck in ahead of it.
    expect(handler[0]).not.toMatch(/allow(ed|list)/i);
    expect(handler[0]).not.toMatch(/protocol\s*[=!]==/);
    expect(handler[0]).not.toMatch(/startsWith\(\s*['"]https/);
  });
});
