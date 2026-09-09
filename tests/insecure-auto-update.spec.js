// Behavioral tests for the Insecure Auto-Update (cf. CVE-2024-39698) lab.
//
// Drives the REAL Electron app (via Playwright's `_electron`): starts the bundled feed server,
// runs the actual vulnerable `check-for-update` handler end to end, and verifies each task by
// reading the `/tmp` sentinels from the TEST's OWN Node process — so a passing test means a
// payload really executed in the main process (or was really rejected), not that the UI said so.
//
// The vulnerability is honest (the updater fetches any feed URL and eval()s the payload in
// VULNERABLE mode); the flags gate on DVEA-controlled sentinels, so this is safe to run repeatedly.
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
const USER_DATA_DIR = path.join(os.tmpdir(), `dvea-test-autoupdate-${process.pid}`);
const PAGE_URL = pathToFileURL(path.join(APP_DIR, 'src/renderer/pages/insecure-auto-update.html')).href;

// The sentinels the DVEA-controlled payloads leave, and the planted decoy — reconstructed exactly
// as the module hardcodes them, so the test can inspect real disk state.
const CLEAN_SENTINEL = '/tmp/dvea-update-clean.txt';
const POISONED_SENTINEL = '/tmp/dvea-backdoor.txt';
const WALLET = '/tmp/dvea-wallet.dat';

async function runCheck(page, feedUrl, mode) {
  await page.fill('#feed-url', feedUrl);
  await page.selectOption('#mode', mode);
  await page.click('#check-update');
}

test.describe('Insecure Auto-Update (cf. CVE-2024-39698)', () => {
  let app;
  let page;
  let endpoints;

  test.beforeAll(async () => {
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      cwd: APP_DIR,
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

    // The lab is a plain hub link; navigating the main window keeps its default preload
    // (window.api).
    await page.goto(PAGE_URL);
    await page.waitForSelector('#start-server');

    // Start the feed server and read the endpoint URLs it discloses in the recon panel.
    await page.click('#start-server');
    await page.waitForFunction(() => {
      const el = document.getElementById('recon-http-poisoned');
      return el && el.textContent && el.textContent !== '—';
    }, null, { timeout: 15_000 });

    endpoints = {
      httpClean: await page.locator('#recon-http-clean').textContent(),
      httpPoisoned: await page.locator('#recon-http-poisoned').textContent(),
      httpsPoisoned: await page.locator('#recon-https-poisoned').textContent(),
    };
    expect(endpoints.httpClean).toMatch(/^http:\/\/localhost:\d+\/clean\/manifest\.json$/);
    expect(endpoints.httpPoisoned).toMatch(/^http:\/\/localhost:\d+\/poisoned\/manifest\.json$/);
    // HTTPS is captured but NOT required: Task 3 is earned over HTTP; the HTTPS signature path is a
    // separate, gracefully-skipped test. (The bundled cert/key make HTTPS available in a healthy
    // environment, but it can fail to start under resource pressure / a bad TLS stack, and the
    // module must not hinge on it.)
    const httpsAvailable = /^https:\/\/localhost:\d+\/poisoned\/manifest\.json$/.test(endpoints.httpsPoisoned);
    endpoints.httpsAvailable = httpsAvailable;
  });

  test.afterAll(async () => {
    // Stop the server + clear sentinels via the app, then remove the planted files ourselves.
    try {
      await page.click('#reset-server');
    } catch (err) {}
    await app?.close().catch(() => {});
    for (const f of [CLEAN_SENTINEL, POISONED_SENTINEL, WALLET]) {
      try {
        fs.rmSync(f, { force: true });
      } catch (err) {}
    }
  });

  test('starting the server plants the decoy wallet on the host', async () => {
    expect(fs.existsSync(WALLET), 'decoy wallet was not planted').toBe(true);
    await expect(page.locator('#flag-progress')).toHaveText('(0 / 3 flags captured)');
  });

  test('Task 1: applies an update over plaintext HTTP', async () => {
    await runCheck(page, endpoints.httpClean, 'vulnerable');

    // The clean payload writes its sentinel — verified from the test's own process.
    await expect.poll(() => fs.existsSync(CLEAN_SENTINEL), { timeout: 10_000 }).toBe(true);

    await expect(page.locator('#task-1-status')).toHaveText('Solved');
    await expect(page.locator('#task-1-status')).toHaveClass(/\bpass\b/);
    await expect(page.locator('#task-1 .task-flag')).toContainText('DVEA{update_over_plaintext_http}');
  });

  test('Task 2: executes an unsigned payload → RCE with host exfiltration', async () => {
    await runCheck(page, endpoints.httpPoisoned, 'vulnerable');

    // The poisoned payload really ran in the main process: it dropped the backdoor sentinel and
    // read the planted wallet into it. Verified independently from disk.
    await expect.poll(() => fs.existsSync(POISONED_SENTINEL), { timeout: 10_000 }).toBe(true);
    const note = fs.readFileSync(POISONED_SENTINEL, 'utf8');
    expect(note).toContain('BACKDOOR INSTALLED');
    expect(note).toContain('exfiltrated:'); // proves it read the host wallet, not just wrote a file

    // The attacker view reflects the same note.
    await expect(page.locator('#backdoor-note')).toContainText('BACKDOOR INSTALLED');

    await expect(page.locator('#task-2-status')).toHaveText('Solved');
    await expect(page.locator('#task-2-status')).toHaveClass(/\bpass\b/);
    await expect(page.locator('#task-2 .task-flag')).toContainText('DVEA{unsigned_payload_executed}');
  });

  test('Task 3: HARDENED mode rejects the forged update (Contained)', async () => {
    // Reliable path: the poisoned feed over HTTP in hardened mode is rejected for transport before
    // any payload is fetched or executed. No HTTPS dependency.
    await runCheck(page, endpoints.httpPoisoned, 'hardened');

    // Nothing should execute: the hardened check clears sentinels then rejects before eval, so no
    // fresh backdoor is written by this run.
    await expect.poll(() => fs.existsSync(POISONED_SENTINEL), { timeout: 10_000 }).toBe(false);

    // Distinct from an exploit success: a blocked forgery renders as "Contained ✓", not "Solved".
    await expect(page.locator('#task-3-status')).toHaveText('Contained ✓');
    await expect(page.locator('#task-3-status')).toHaveClass(/\bcontained\b/);
    await expect(page.locator('#task-3-status')).not.toHaveText('Solved');
    await expect(page.locator('#task-3 .task-flag')).toContainText('DVEA{hardened_rejected_forgery}');
  });

  test('the integrity check specifically catches the forged HTTPS feed (when HTTPS is available)', async () => {
    // Richer coverage: over HTTPS the forgery is caught by the SIGNATURE check, not merely
    // transport. Skipped rather than failed if the local HTTPS server didn't come up, so the
    // module's core verification isn't held hostage to the TLS stack / environment.
    test.skip(!endpoints.httpsAvailable, 'HTTPS feed server unavailable in this environment');

    const res = await page.evaluate(
      ({ feed, mode }) => window.api.checkForUpdate({ feed, mode }),
      { feed: endpoints.httpsPoisoned, mode: 'hardened' }
    );
    expect(res.success).toBe(false);
    expect(res.reason).toMatch(/signature/i); // reached the signature check and it rejected the forgery
    // Still no execution.
    expect(fs.existsSync(POISONED_SENTINEL)).toBe(false);
  });

  test('progress reaches 3 / 3 once all tasks are complete', async () => {
    await expect(page.locator('#flag-progress')).toHaveText('(3 / 3 flags captured)');
  });

  test('the check-for-update handler still eval()s the payload unverified in vulnerable mode', async () => {
    // Source-level guard: the whole lab depends on the write being an honest unverified execution.
    // If verification is ever forced on the vulnerable path (rather than kept behind hardened
    // mode), this catches it.
    const src = fs.readFileSync(path.join(APP_DIR, 'src/main/insecure-auto-update.js'), 'utf8');
    const fn = src.match(/async function performUpdateCheck\([\s\S]*?\n\}/);
    expect(fn, 'performUpdateCheck() not found').toBeTruthy();
    expect(fn[0]).toContain('eval(payload);');
    // The hash/signature checks must remain gated behind hardened mode, not unconditional.
    expect(fn[0]).toMatch(/if \(mode === 'hardened'\)/);
  });
});
