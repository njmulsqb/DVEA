// Guards for the OS-level half of deep linking: the part that has to be true BEFORE a
// dvea:// link ever reaches the app.
//
// These are static assertions on config and source, deliberately. The behavioral deep-link specs
// deliver the URL in argv, which is what the OS ultimately does — but that means they assume
// something already handed the URL to the process. Every one of them passes even when the OS
// has no idea DVEA speaks dvea://, which is exactly the blind spot that let a broken scheme
// registration ship: the browser fell back to a web search and nothing in the suite noticed.
//
// Actually installing a .deb and querying xdg-mime is not something a test suite can reasonably
// do (it needs root, mutates the developer's desktop database, and only applies on Linux). So
// these assert the two inputs that determine whether registration can work at all.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const APP_DIR = path.resolve(__dirname, '..');
const MAIN_JS_PATH = path.join(APP_DIR, 'src/main/main.js');

test.describe('deep link OS registration', () => {
  test('the packaged .desktop file declares the dvea:// scheme', () => {
    // maker-deb only emits a MimeType line when config.mimeType is set (see
    // electron-installer-debian/resources/desktop.ejs). Without it the installed .desktop
    // declares no scheme, nothing in the desktop database claims x-scheme-handler/dvea, and a
    // browser treats a typed dvea:// URL as a search query instead of handing it to the OS.
    const forgeConfig = require(path.join(APP_DIR, 'forge.config.js'));
    const deb = (forgeConfig.makers || []).find((m) => m && m.name === '@electron-forge/maker-deb');

    expect(deb, 'the maker-deb entry is missing from forge.config.js').toBeTruthy();
    expect(deb.config, 'maker-deb has no config block, so no mimeType can be declared').toBeTruthy();
    expect(
      deb.config.mimeType,
      'maker-deb config.mimeType is unset — the installed .desktop will have no MimeType line ' +
        'and dvea:// will not be registered with the OS'
    ).toContain('x-scheme-handler/dvea');
  });

  test('main sets CHROME_DESKTOP before claiming the scheme on Linux', () => {
    // On Linux setAsDefaultProtocolClient shells out to
    // `xdg-mime default <desktop-file> x-scheme-handler/dvea`, and Electron reads that
    // <desktop-file> from the CHROME_DESKTOP environment variable. It is NOT derived from
    // app.getName(); app.setDesktopName() was removed in Electron 40. With CHROME_DESKTOP unset
    // the argument is empty and the call fails with "xdg-mime: application argument missing",
    // so DVEA never becomes the default handler.
    const src = fs.readFileSync(MAIN_JS_PATH, 'utf8');

    const chromeDesktopIdx = src.indexOf('CHROME_DESKTOP');
    const claimIdx = src.indexOf('setAsDefaultProtocolClient');

    expect(chromeDesktopIdx, 'main.js never sets CHROME_DESKTOP').toBeGreaterThan(-1);
    expect(claimIdx, 'main.js never calls setAsDefaultProtocolClient').toBeGreaterThan(-1);
    expect(
      chromeDesktopIdx,
      'CHROME_DESKTOP must be set BEFORE setAsDefaultProtocolClient, or the xdg-mime call runs ' +
        'with an empty desktop-file argument and fails'
    ).toBeLessThan(claimIdx);
    expect(src).toMatch(/CHROME_DESKTOP\s*=\s*['"]dvea\.desktop['"]/);
  });

  test('the app takes the single-instance lock', () => {
    // Deep links to an ALREADY-RUNNING app depend entirely on this. Without the lock the OS
    // starts a second independent process instead of signalling the first, 'second-instance'
    // never fires, and the link is silently dropped while the user gets a duplicate window.
    // Asserted here rather than only behaviorally because the behavioral test needs two real
    // processes, and this failure mode is easy to reintroduce by moving the app.on('ready') call.
    const src = fs.readFileSync(MAIN_JS_PATH, 'utf8');

    expect(src, 'main.js never calls app.requestSingleInstanceLock()').toContain(
      'requestSingleInstanceLock()'
    );
    // 'ready' must be registered only on the branch that WON the lock, otherwise the redundant
    // instance still boots a full app before quitting.
    expect(src).toMatch(/if\s*\(\s*!app\.requestSingleInstanceLock\(\)\s*\)\s*\{[\s\S]*?app\.quit\(\)/);
    expect(src).toMatch(/else\s*\{[\s\S]*?app\.on\('ready',\s*main\)/);
  });

  test('a cold-start deep link is read out of process.argv', () => {
    // 'open-url' is macOS-only and 'second-instance' by definition only fires for an instance
    // that was already running, so on Linux/Windows a cold-start link is ONLY reachable by
    // reading our own argv. This is a cheap guard on the wiring that the behavioral cold-start
    // tests exercise, kept here so the reason is documented next to the other two halves.
    const src = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    expect(src).toContain('findDeepLinkArg(process.argv)');
  });
});
