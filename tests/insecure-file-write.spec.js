// Behavioral tests for the Insecure File Write (IPC Abuse) lab.
//
// Drives the REAL Electron app (via Playwright's `_electron`) rather than importing internal
// functions, so these exercise the actual unvalidated save-file IPC handler end to end. Every
// task is verified by reading the affected file from the TEST's OWN Node process, independent of
// the app — the same rigor the XSS Challenge 2/3 tests use — so a passing test means bytes really
// landed on disk, not that the UI said so.
//
// The vulnerability is honest (the handler writes any path); the flags gate on DVEA-controlled
// targets under the OS temp dir, so this is safe to run repeatedly.
//
// Note: the lab page navigates the existing main window (it's a plain hub link), and windows the
// app builds through the Window subclass are invisible to BrowserWindow.getAllWindows() — neither
// matters here since this module drives a single page via its file URL.
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
const USER_DATA_DIR = path.join(os.tmpdir(), `dvea-test-filewrite-${process.pid}`);
const SAVEFILE_URL = pathToFileURL(path.join(APP_DIR, 'src/renderer/pages/savefile.html')).href;

// The DVEA-controlled targets, reconstructed exactly as main.js derives them, so the test can
// verify disk state directly. (main.js: FILEWRITE_DIR = os.tmpdir()/dvea-file-write, etc.)
const FILEWRITE_DIR = path.join(os.tmpdir(), 'dvea-file-write');
const MARKER_PATH = path.join(FILEWRITE_DIR, 'dvea-owned-note.txt');
const CONFIG_PATH = path.join(FILEWRITE_DIR, 'dvea-app-config.json');
const MARKER_ORIGINAL_MARK = 'DVEA planted this file and owns it';
const CONFIG_ORIGINAL_BANNER = 'DVEA — Insecure File Write';

// A Task 1 target OUTSIDE FILEWRITE_DIR entirely — a genuinely arbitrary location.
const EXTERNAL_TARGET = path.join(os.tmpdir(), `dvea-fw-external-${process.pid}.txt`);

async function save(page, filePath, content) {
  await page.fill('#filepath', filePath);
  await page.fill('#filecontent', content);
  await page.click('#savefile-form button[type=submit]');
}

test.describe('Insecure File Write (IPC Abuse)', () => {
  let app;
  let page;

  test.beforeAll(async () => {
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      cwd: APP_DIR,
      // Own userData so this instance gets its own single-instance lock (see
      // requestSingleInstanceLock in main.js) and doesn't collide with other specs or a running
      // DVEA. --no-sandbox keeps it runnable without the chrome-sandbox setuid fix.
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

    // The page is a plain hub link; navigating the main window keeps its default preload
    // (window.api). Wait for filewrite-init to finish planting + populate recon.
    await page.goto(SAVEFILE_URL);
    await page.waitForSelector('#save-dir');
    await page.waitForFunction(() => {
      const el = document.getElementById('save-dir');
      return el && el.textContent && el.textContent !== '…' && !el.textContent.startsWith('(failed');
    }, null, { timeout: 10_000 });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    try {
      fs.rmSync(FILEWRITE_DIR, { recursive: true, force: true });
    } catch (err) {}
    try {
      fs.rmSync(EXTERNAL_TARGET, { force: true });
    } catch (err) {}
  });

  test('init planted the DVEA-owned targets on the real filesystem', async () => {
    // Verified from the test's own process, so later overwrites are provably replacements of a
    // file that genuinely existed first — not creates.
    expect(fs.existsSync(MARKER_PATH), 'marker file was not planted').toBe(true);
    expect(fs.readFileSync(MARKER_PATH, 'utf8')).toContain(MARKER_ORIGINAL_MARK);

    expect(fs.existsSync(CONFIG_PATH), 'config file was not planted').toBe(true);
    expect(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).banner).toBe(CONFIG_ORIGINAL_BANNER);

    // The recon panel discloses the real paths (the app tells you where its own files are).
    await expect(page.locator('#marker-path')).toHaveText(MARKER_PATH);
    await expect(page.locator('#config-path')).toHaveText(CONFIG_PATH);
    // The banner is sourced from the config file, not hard-coded.
    await expect(page.locator('#app-banner')).toHaveText(CONFIG_ORIGINAL_BANNER);

    await expect(page.locator('#flag-progress')).toHaveText('(0 / 3 flags captured)');
  });

  test('Task 1: writes a file outside the app area entirely — no path restriction', async () => {
    const content = `arbitrary-write-${process.pid}`;
    await save(page, EXTERNAL_TARGET, content);

    // Independently verify the write landed, from the test's own Node process.
    await expect
      .poll(() => (fs.existsSync(EXTERNAL_TARGET) ? fs.readFileSync(EXTERNAL_TARGET, 'utf8') : null), {
        timeout: 10_000,
      })
      .toBe(content);

    await expect(page.locator('#task-1-status')).toHaveText('Solved');
    await expect(page.locator('#task-1-status')).toHaveClass(/\bpass\b/);
    await expect(page.locator('#task-1 .task-flag')).toContainText('DVEA{arbitrary_path_write}');
  });

  test('Task 2: overwrites an existing DVEA-owned file — replace, not create', async () => {
    // Confirm the planted original is really there right before we clobber it.
    expect(fs.readFileSync(MARKER_PATH, 'utf8')).toContain(MARKER_ORIGINAL_MARK);

    const clobbered = `clobbered-by-test-${process.pid}`;
    await save(page, MARKER_PATH, clobbered);

    await expect
      .poll(() => fs.readFileSync(MARKER_PATH, 'utf8'), { timeout: 10_000 })
      .toBe(clobbered);
    // And it is genuinely a replacement — the original content is gone.
    expect(fs.readFileSync(MARKER_PATH, 'utf8')).not.toContain(MARKER_ORIGINAL_MARK);

    await expect(page.locator('#task-2-status')).toHaveText('Solved');
    await expect(page.locator('#task-2-status')).toHaveClass(/\bpass\b/);
    await expect(page.locator('#task-2 .task-flag')).toContainText('DVEA{overwrite_existing_file}');
  });

  test('Task 3: overwrites the config the app reads — app behavior actually changes', async () => {
    const newBanner = `owned-by-test-${process.pid}`;
    await save(page, CONFIG_PATH, JSON.stringify({ banner: newBanner }));

    // The config file on disk now parses to our banner...
    await expect
      .poll(() => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).banner, { timeout: 10_000 })
      .toBe(newBanner);
    // ...and the app's own displayed behavior reflects it — the banner is re-read from that file.
    await expect(page.locator('#app-banner')).toHaveText(newBanner);

    await expect(page.locator('#task-3-status')).toHaveText('Solved');
    await expect(page.locator('#task-3-status')).toHaveClass(/\bpass\b/);
    await expect(page.locator('#task-3 .task-flag')).toContainText('DVEA{write_to_rce}');
  });

  test('progress reaches 3 / 3 once all tasks are complete', async () => {
    await expect(page.locator('#flag-progress')).toHaveText('(3 / 3 flags captured)');
  });

  test('the save-file handler still performs a genuinely unvalidated write', async () => {
    // Source-level guard: the whole lab depends on the write being honest. If validation is ever
    // added to the handler itself (rather than a separate hardened variant), this catches it.
    const src = fs.readFileSync(path.join(APP_DIR, 'src/main/main.js'), 'utf8');
    const handler = src.match(/ipcMain\.handle\('save-file'[\s\S]*?\n\}\);/);
    expect(handler, "the 'save-file' handler was not found in main.js").toBeTruthy();
    // The unvalidated write, verbatim.
    expect(handler[0]).toContain('await fs.promises.writeFile(data.path, data.content);');
    // And no path confinement snuck in ahead of it.
    expect(handler[0]).not.toContain('path.relative');
  });
});
