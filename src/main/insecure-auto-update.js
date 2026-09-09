const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { createServers, HMAC_SECRET } = require('../labs/insecure-auto-update/server');
const crypto = require('crypto');

let serverInstance = null;

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacHex(data) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('hex');
}

async function startServer() {
  if (serverInstance) return serverInstance.ports;
  serverInstance = createServers();
  const ports = await serverInstance.start();
  return ports;
}

async function stopServer() {
  if (!serverInstance) return;
  await serverInstance.stop();
  serverInstance = null;
}

const POISONED_SENTINEL = '/tmp/dvea-backdoor.txt';
const CLEAN_SENTINEL = '/tmp/dvea-update-clean.txt';

function clearSentinels() {
  try {
    if (fs.existsSync(POISONED_SENTINEL)) fs.unlinkSync(POISONED_SENTINEL);
  } catch (err) {}
  try {
    if (fs.existsSync(CLEAN_SENTINEL)) fs.unlinkSync(CLEAN_SENTINEL);
  } catch (err) {}
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const opts = { rejectUnauthorized: false };
      const req = lib.get(u, opts, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });
      req.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

// ── Challenge flag layer (booth-safe) ────────────────────────────────────────
// The vulnerability below (check-for-update fetching a manifest over HTTP with no integrity
// check and eval'ing the payload in the main process) is unchanged and honest — the feed URL and
// mode are whatever the renderer supplies. This layer ONLY awards flags, by inspecting the real
// update result and the on-disk sentinels the DVEA-controlled payloads leave behind, so the demo
// stays safe to run repeatedly while the vuln stays real.
const AUTOUPDATE_FLAGS = {
  1: 'DVEA{update_over_plaintext_http}',
  2: 'DVEA{unsigned_payload_executed}',
  3: 'DVEA{hardened_rejected_forgery}',
};
const autoUpdateSolved = { 1: false, 2: false, 3: false };

function resetAutoUpdateChallenge() {
  autoUpdateSolved[1] = autoUpdateSolved[2] = autoUpdateSolved[3] = false;
}

function autoUpdateFlagsForSolved() {
  const out = {};
  for (const n of [1, 2, 3]) if (autoUpdateSolved[n]) out[n] = AUTOUPDATE_FLAGS[n];
  return out;
}

function readBackdoorNote() {
  try {
    return fs.readFileSync(POISONED_SENTINEL, 'utf8');
  } catch (err) {
    return null;
  }
}

// Decide which flags this update run earned, from the real result + on-disk evidence. Never gates
// the update — that already happened (or was rejected by the app's own hardened checks) above.
function evaluateAutoUpdateTasks({ mode, feedProtocol, success, reason }) {
  // Task 1 — the updater accepted and applied an update over plaintext HTTP: no transport
  // security, which is the entire MITM precondition.
  if (!autoUpdateSolved[1] && mode === 'vulnerable' && success && feedProtocol === 'http:') {
    autoUpdateSolved[1] = true;
  }

  // Task 2 — an unsigned / forged-signature payload actually executed in the main process,
  // dropping the backdoor sentinel. Missing integrity verification → silent RCE.
  if (!autoUpdateSolved[2] && fs.existsSync(POISONED_SENTINEL)) {
    autoUpdateSolved[2] = true;
  }

  // Task 3 (Contained) — hardened mode REJECTED the forged/unsafe update. Any hardened rejection
  // counts: a poisoned HTTPS feed is rejected on integrity grounds ("signature verification
  // failed" — the deeper lesson), a poisoned HTTP feed is rejected for transport ("feed must be
  // HTTPS"). Both prove the fix refuses the update; the writeup covers the distinction. Accepting
  // either also keeps the flag reliable if the local HTTPS server is flaky under resource
  // pressure. Distinct outcome from an exploit: rendered as "Contained", not "Solved".
  if (
    !autoUpdateSolved[3] &&
    mode === 'hardened' &&
    !success &&
    /^HARDENED:/.test(reason || '')
  ) {
    autoUpdateSolved[3] = true;
  }

  return {
    solved: { ...autoUpdateSolved },
    flags: autoUpdateFlagsForSolved(),
    progress: [1, 2, 3].filter((n) => autoUpdateSolved[n]).length,
    backdoorNote: readBackdoorNote(),
  };
}

ipcMain.handle('start-auto-update-server', async () => {
  // Starting the feed server begins a fresh challenge run.
  resetAutoUpdateChallenge();
  const ports = await startServer();
  const host = 'localhost';
  const httpPort = ports.httpPort;
  const httpsPort = ports.httpsPort;

  // Recon only: WHERE the feed server serves from. The manifest/payload SOURCE is deliberately
  // not returned — the challenge is to understand the trust failure, not to be handed the payload.
  return {
    httpPort,
    httpsPort,
    httpRoot: `http://${host}:${httpPort}/`,
    httpCleanManifest: `http://${host}:${httpPort}/clean/manifest.json`,
    httpPoisonedManifest: `http://${host}:${httpPort}/poisoned/manifest.json`,
    httpsRoot: httpsPort ? `https://${host}:${httpsPort}/` : null,
    httpsCleanManifest: httpsPort ? `https://${host}:${httpsPort}/clean/manifest.json` : null,
    httpsPoisonedManifest: httpsPort ? `https://${host}:${httpsPort}/poisoned/manifest.json` : null,
    walletPath: '/tmp/dvea-wallet.dat',
    flags: autoUpdateFlagsForSolved(),
  };
});

ipcMain.handle('stop-auto-update-server', async () => {
  await stopServer();
  return true;
});

// Run the (vulnerable) update check and return its raw result object. Kept as its own function so
// the handler can layer flag bookkeeping on top without touching the vulnerable logic.
async function performUpdateCheck({ feed, mode }) {
  // Clear any existing sentinels so the result reflects only this run.
  try {
    clearSentinels();
  } catch (err) {}

  const manifestRes = await fetchUrl(feed);
  if (manifestRes.statusCode !== 200) throw new Error('Manifest fetch failed: ' + manifestRes.statusCode);
  const manifest = JSON.parse(manifestRes.body);

  // Hardened mode: require HTTPS transport before doing anything else.
  if (mode === 'hardened') {
    const u = new URL(feed);
    if (u.protocol !== 'https:') {
      return { success: false, reason: 'HARDENED: feed must be HTTPS' };
    }
  }

  // Download payload.
  const payloadRes = await fetchUrl(manifest.url);
  if (payloadRes.statusCode !== 200) throw new Error('Payload fetch failed: ' + payloadRes.statusCode);
  const payload = payloadRes.body;

  if (mode === 'hardened') {
    // Verify hash.
    const actualHash = sha256hex(payload);
    if (String(actualHash) !== String(manifest.hash)) {
      return { success: false, reason: 'HARDENED: payload hash mismatch' };
    }
    // Verify signature.
    const expectedSig = hmacHex(payload);
    if (String(expectedSig) !== String(manifest.signature)) {
      return { success: false, reason: 'HARDENED: signature verification failed' };
    }
  }

  // VULNERABLE: execute the payload with no verification (simulates an insecure updater applying
  // downloaded update code directly in the main process).
  try {
    eval(payload);
    return { success: true, applied: true };
  } catch (err) {
    return { success: false, reason: 'Execution failed: ' + err.message };
  }
}

ipcMain.handle('check-for-update', async (event, { feed, mode }) => {
  let feedProtocol = null;
  try {
    feedProtocol = new URL(feed).protocol;
  } catch (err) {}

  let result;
  try {
    result = await performUpdateCheck({ feed, mode });
  } catch (err) {
    result = { success: false, reason: err.message };
  }

  // Flag bookkeeping only — inspects the real result + on-disk sentinels. Wrapped so it can never
  // turn a genuine update result into an error.
  try {
    const tasks = evaluateAutoUpdateTasks({
      mode,
      feedProtocol,
      success: result.success,
      reason: result.reason,
    });
    return { ...result, feedProtocol, ...tasks };
  } catch (err) {
    return { ...result, feedProtocol };
  }
});

ipcMain.handle('reset-auto-update', async () => {
  try {
    try {
      await stopServer();
    } catch (err) {}
    try {
      clearSentinels();
    } catch (err) {}
    resetAutoUpdateChallenge();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Bridge to preload: expose server control for clean shutdown from main.
module.exports = {
  startServer,
  stopServer,
};
