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

function clearSentinels() {
  const poisoned = '/tmp/dvea-backdoor.txt';
  const clean = '/tmp/dvea-update-clean.txt';
  try {
    if (fs.existsSync(poisoned)) fs.unlinkSync(poisoned);
  } catch (err) {}
  try {
    if (fs.existsSync(clean)) fs.unlinkSync(clean);
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

ipcMain.handle('start-auto-update-server', async () => {
  const ports = await startServer();
  const host = 'localhost';
  const httpPort = ports.httpPort;
  const httpsPort = ports.httpsPort;
  const urls = {
    httpPoisonedManifest: `http://${host}:${httpPort}/poisoned/manifest.json`,
    httpCleanManifest: `http://${host}:${httpPort}/clean/manifest.json`,
    httpPoisonedPayload: `http://${host}:${httpPort}/poisoned/payload.js`,
    httpCleanPayload: `http://${host}:${httpPort}/clean/payload.js`,
    httpRoot: `http://${host}:${httpPort}/`,
    httpsPoisonedManifest: httpsPort ? `https://${host}:${httpsPort}/poisoned/manifest.json` : null,
    httpsCleanManifest: httpsPort ? `https://${host}:${httpsPort}/clean/manifest.json` : null,
    httpsRoot: httpsPort ? `https://${host}:${httpsPort}/` : null,
  };

  // Try to fetch manifest and payload bodies so the renderer can display attacker artifacts.
  async function tryFetchText(u) {
    try {
      const res = await fetchUrl(u);
      if (res && res.statusCode === 200) return res.body;
    } catch (err) {}
    return null;
  }

  const httpPoisonedManifestText = await tryFetchText(urls.httpPoisonedManifest);
  const httpPoisonedPayloadText = await tryFetchText(urls.httpPoisonedPayload);
  const httpCleanManifestText = await tryFetchText(urls.httpCleanManifest);
  const httpCleanPayloadText = await tryFetchText(urls.httpCleanPayload);

  const httpsPoisonedManifestText = urls.httpsPoisonedManifest ? await tryFetchText(urls.httpsPoisonedManifest) : null;
  const httpsPoisonedPayloadText = urls.httpsPoisonedManifest ? await tryFetchText(urls.httpsPoisonedManifest.replace('/manifest.json','/payload.js')) : null;
  const httpsCleanManifestText = urls.httpsCleanManifest ? await tryFetchText(urls.httpsCleanManifest) : null;
  const httpsCleanPayloadText = urls.httpsCleanManifest ? await tryFetchText(urls.httpsCleanManifest.replace('/manifest.json','/payload.js')) : null;

  return Object.assign({ httpPort, httpsPort,
    httpPoisonedManifest: urls.httpPoisonedManifest,
    httpCleanManifest: urls.httpCleanManifest,
    httpPoisonedPayload: urls.httpPoisonedPayload,
    httpCleanPayload: urls.httpCleanPayload,
    httpRoot: urls.httpRoot,
    httpsPoisonedManifest: urls.httpsPoisonedManifest,
    httpsCleanManifest: urls.httpsCleanManifest,
    httpsRoot: urls.httpsRoot,
    httpPoisonedManifestText,
    httpPoisonedPayloadText,
    httpCleanManifestText,
    httpCleanPayloadText,
    httpsPoisonedManifestText,
    httpsPoisonedPayloadText,
    httpsCleanManifestText,
    httpsCleanPayloadText,
  });
});

ipcMain.handle('stop-auto-update-server', async () => {
  await stopServer();
  return true;
});

ipcMain.handle('check-for-update', async (event, { feed, mode }) => {
  // mode: 'vulnerable' or 'hardened'
  try {
    // Clear any existing sentinels so the result reflects only this run
    try { clearSentinels(); } catch (err) {}

    const manifestRes = await fetchUrl(feed);
    if (manifestRes.statusCode !== 200) throw new Error('Manifest fetch failed: ' + manifestRes.statusCode);
    const manifest = JSON.parse(manifestRes.body);

    // Hardened mode: require HTTPS and verify signature/hash
    if (mode === 'hardened') {
      const u = new URL(feed);
      if (u.protocol !== 'https:') {
        return { success: false, reason: 'HARDENED: feed must be HTTPS' };
      }
    }

    // Download payload
    const payloadRes = await fetchUrl(manifest.url);
    if (payloadRes.statusCode !== 200) throw new Error('Payload fetch failed: ' + payloadRes.statusCode);
    const payload = payloadRes.body;

    if (mode === 'hardened') {
      // verify hash
      const actualHash = sha256hex(payload);
      if (String(actualHash) !== String(manifest.hash)) {
        return { success: false, reason: 'HARDENED: payload hash mismatch' };
      }
      // verify signature
      const expectedSig = hmacHex(payload);
      if (String(expectedSig) !== String(manifest.signature)) {
        return { success: false, reason: 'HARDENED: signature verification failed' };
      }
    }

    // VULNERABLE: execute payload with no verification
    try {
      // Execute payload in main process context (simulates insecure updater applying code)
      eval(payload);
      return { success: true, applied: true };
    } catch (err) {
      return { success: false, reason: 'Execution failed: ' + err.message };
    }
  } catch (err) {
    return { success: false, reason: err.message };
  }
});

ipcMain.handle('check-sentinel', async () => {
  const poisoned = '/tmp/dvea-backdoor.txt';
  const clean = '/tmp/dvea-update-clean.txt';
  try {
    const p = fs.existsSync(poisoned);
    const c = fs.existsSync(clean);
    return p || c;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('reset-auto-update', async () => {
  try {
    // stop server if running and clear sentinels
    try { await stopServer(); } catch (err) {}
    try { clearSentinels(); } catch (err) {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Bridge to preload: expose keys
module.exports = {};
