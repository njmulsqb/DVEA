const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

// Simple bundled feed server that exposes both HTTP and HTTPS endpoints.
// Provides a clean manifest (valid HMAC) and a poisoned manifest (invalid signature).

const HMAC_SECRET = 'DVEA_TRUSTED_KEY';

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacHex(data) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('hex');
}

function makePayloads() {
  const clean = "(function(){require('fs').writeFileSync('/tmp/dvea-update-clean.txt', 'clean update applied at '+new Date().toISOString());})();";
  const poisoned = "(function(){try{const fs=require('fs');const ts=new Date().toISOString();let note='BACKDOOR INSTALLED '+ts;try{const wallet=fs.readFileSync('/tmp/dvea-wallet.dat','utf8');note+=' | exfiltrated:firstline:'+wallet.split('\\n')[0].slice(0,200);}catch(e){}fs.writeFileSync('/tmp/dvea-backdoor.txt',note);}catch(e){} })();";
  return { clean, poisoned };
}

function createServers() {
  const payloads = makePayloads();

  // Create a decoy wallet file to demonstrate exfiltration simulation.
  try {
    const walletPath = '/tmp/dvea-wallet.dat';
    if (!fs.existsSync(walletPath)) {
      fs.writeFileSync(walletPath, 'DECOY WALLET DATA - demo only\nowner: dvea-demo');
    }
  } catch (err) {}

  let httpPort = null;
  let httpsPort = null;

  const certPath = __dirname + '/cert.pem';
  const keyPath = __dirname + '/key.pem';
  let cert = null;
  let key = null;
  try {
    cert = fs.readFileSync(certPath);
    key = fs.readFileSync(keyPath);
  } catch (err) {
    // If certs are missing, HTTPS will not be available.
    cert = null;
    key = null;
  }

  function handler(req, res, protocol) {
    const url = req.url;
    if (url === '/' ) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('DVEA auto-update feed');
      return;
    }
    if (url.startsWith('/poisoned/manifest.json')) {
      const payload = payloads.poisoned;
      const hash = sha256hex(payload);
      const signature = 'INVALID_SIGNATURE';
      const fullUrl = `${protocol}://${req.headers.host}/poisoned/payload.js`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '9.9.9', url: fullUrl, hash, signature }));
      return;
    }
    if (url.startsWith('/clean/manifest.json')) {
      const payload = payloads.clean;
      const hash = sha256hex(payload);
      const signature = hmacHex(payload);
      const fullUrl = `${protocol}://${req.headers.host}/clean/payload.js`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '1.0.1', url: fullUrl, hash, signature }));
      return;
    }
    if (url.startsWith('/clean/payload.js')) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(payloads.clean);
      return;
    }
    if (url.startsWith('/poisoned/payload.js')) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(payloads.poisoned);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  const httpServer = http.createServer((req, res) => handler(req, res, 'http'));
  let httpsServer = null;
  if (cert && key) {
    try {
      httpsServer = https.createServer({ cert, key }, (req, res) => handler(req, res, 'https'));
    } catch (err) {
      // If the cert/key are invalid or OpenSSL fails, don't crash — disable HTTPS for demo.
      httpsServer = null;
    }
  }

  function start() {
    return new Promise((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', () => {
        httpPort = httpServer.address().port;
        if (httpsServer) {
          httpsServer.listen(0, '127.0.0.1', () => {
            httpsPort = httpsServer.address().port;
            resolve({ httpPort, httpsPort });
          });
        } else {
          resolve({ httpPort, httpsPort: null });
        }
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      httpServer.close(() => {
        if (httpsServer) {
          httpsServer.close(() => resolve());
        } else resolve();
      });
    });
  }

  return { start, stop };
}

module.exports = { createServers, HMAC_SECRET };
