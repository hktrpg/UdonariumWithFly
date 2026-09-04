const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const MODEL_DIR = path.resolve(__dirname, 'out-tsc', '3dmodel');
const LISTEN_PORT = 47821;
/** Local Range-capable relay → LandsD Open3Dhk ZIP CDN (avoids broken webpack HTTPS proxy). */
const OPEN3DHK_RELAY_PORT = 47822;
/** Prod key from Open3Dhk mapviewer (`Global.apiKeysProd["2022Q4"]`). */
const OPEN3DHK_API_KEY = 'ad5940a63bd344c48b0351ef1c7a905e';
const OPEN3DHK_UPSTREAM_PREFIX = '/api/3d-zip';
/** Official UI uses data11 + key; no-key often works when key= returns 502 (mod_qos). */
const OPEN3DHK_UPSTREAMS = [
  { host: 'download.map.gov.hk', withKey: false, label: 'download' },
  { host: 'data11.map.gov.hk', withKey: false, label: 'data11' },
  { host: 'data11.map.gov.hk', withKey: true, label: 'data11+key' },
  { host: 'download.map.gov.hk', withKey: true, label: 'download+key' },
];

function isSafeBasename(name) {
  return !!name && !name.includes('..') && !name.includes('/') && !name.includes('\\');
}

function isModelPackageName(name) {
  const n = (name || '').toLowerCase();
  return n.endsWith('.zip') || n.endsWith('.glb') || n.endsWith('.gltf');
}

function listModelFiles() {
  try {
    return fs.readdirSync(MODEL_DIR).filter(isModelPackageName).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function handleDev3dmodel(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/' || pathname === '/manifest.json') {
    const body = JSON.stringify({ files: listModelFiles() });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  const name = pathname.replace(/^\//, '');
  if (!isSafeBasename(name) || !isModelPackageName(name)) {
    res.writeHead(400);
    res.end('bad name');
    return;
  }

  const filePath = path.resolve(MODEL_DIR, name);
  const rel = path.relative(MODEL_DIR, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(400);
    res.end('bad path');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  const ext = path.extname(name).toLowerCase();
  const type = ext === '.zip' ? 'application/zip'
    : ext === '.glb' ? 'model/gltf-binary'
    : ext === '.gltf' ? 'model/gltf+json'
    : 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

function startDev3dmodelServer() {
  const g = globalThis;
  if (g.__udonariumDev3dmodelServer) return;
  const server = http.createServer(handleDev3dmodel);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[dev-3dmodel] port ${LISTEN_PORT} in use; reusing existing server`);
      return;
    }
    console.error('[dev-3dmodel]', err);
  });
  server.listen(LISTEN_PORT, '127.0.0.1', () => {
    console.log(`[dev-3dmodel] serving ${MODEL_DIR} → http://127.0.0.1:${LISTEN_PORT}`);
  });
  g.__udonariumDev3dmodelServer = server;
}

/**
 * Same-origin Open3Dhk ZIP relay with HTTP Range.
 * webpack-dev-server's HTTPS proxy to download.map.gov.hk was returning a ~7 KiB
 * mapviewer HTML page instead of the multi‑GB sheet ZIP; Node https works fine.
 */
function isOpen3dhkZipPath(pathname) {
  // /GLTF/11-SW-4B.zip or /GLTF0/11-SW-4B.zip
  return /^\/(GLTF|GLTF0)\/[^/]+\.zip$/i.test(pathname);
}

function isOpen3dhkSheetBasename(name) {
  return /^\d+-[A-Z]{2}-\d+[A-Z]\.zip$/i.test(name);
}

function handleOpen3dhkRelay(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  if (!isOpen3dhkZipPath(pathname)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bad open3dhk path');
    return;
  }
  const sheetFile = pathname.split('/').pop() || '';
  if (!isOpen3dhkSheetBasename(sheetFile)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bad open3dhk sheet id');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('method not allowed');
    return;
  }

  console.log('[open3dhk-relay]', req.method, pathname, {
    range: req.headers.range || null,
  });

  tryOpen3dhkUpstream(req, res, pathname, 0);
}

function abortOpen3dhkClient(res) {
  if (res.writableEnded) return;
  try {
    res.destroy();
  } catch {
    /* ignore */
  }
}

function tryOpen3dhkUpstream(req, res, pathname, index) {
  const upstream = OPEN3DHK_UPSTREAMS[index];
  if (!upstream) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('all open3dhk upstreams failed');
    } else {
      abortOpen3dhkClient(res);
    }
    return;
  }

  // Client already has a body in flight — cannot switch hosts or rewrite headers.
  if (res.headersSent || res.writableEnded) return;

  const query = upstream.withKey ? `?key=${OPEN3DHK_API_KEY}` : '';
  const upstreamPath = `${OPEN3DHK_UPSTREAM_PREFIX}${pathname}${query}`;
  const headers = {
    Host: upstream.host,
    Accept: 'application/zip, application/octet-stream, */*',
    'User-Agent': 'UdonariumWithFly-open3dhk-relay',
    Referer: 'https://3d.map.gov.hk/',
  };
  if (req.headers.range) headers.Range = req.headers.range;

  let committed = false;
  const upReq = https.request(
    {
      hostname: upstream.host,
      path: upstreamPath,
      method: req.method,
      headers,
    },
    (up) => {
      if (res.headersSent || res.writableEnded) {
        up.resume();
        return;
      }

      const status = up.statusCode || 502;
      const retryable = status === 502 || status === 503 || status === 504;
      if (retryable && index + 1 < OPEN3DHK_UPSTREAMS.length) {
        console.warn('[open3dhk-relay] upstream failed, retry', {
          host: upstream.label,
          status,
          next: OPEN3DHK_UPSTREAMS[index + 1].label,
        });
        up.resume();
        const delayMs = 150 * (index + 1);
        setTimeout(() => tryOpen3dhkUpstream(req, res, pathname, index + 1), delayMs);
        return;
      }

      console.log('[open3dhk-relay] ←', {
        host: upstream.label,
        status,
        contentType: up.headers['content-type'] || null,
        contentLength: up.headers['content-length'] || null,
        contentRange: up.headers['content-range'] || null,
        acceptRanges: up.headers['accept-ranges'] || null,
      });
      const outHeaders = {
        'Content-Type': up.headers['content-type'] || 'application/zip',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers':
          'Accept-Ranges, Content-Range, Content-Length, Content-Type',
      };
      if (up.headers['content-length']) outHeaders['Content-Length'] = up.headers['content-length'];
      if (up.headers['content-range']) outHeaders['Content-Range'] = up.headers['content-range'];
      if (up.headers['accept-ranges']) outHeaders['Accept-Ranges'] = up.headers['accept-ranges'];
      else outHeaders['Accept-Ranges'] = 'bytes';

      committed = true;
      try {
        res.writeHead(status, outHeaders);
      } catch (err) {
        console.error('[open3dhk-relay] writeHead failed', upstream.label, err);
        up.resume();
        abortOpen3dhkClient(res);
        return;
      }
      if (req.method === 'HEAD') {
        up.resume();
        res.end();
        return;
      }
      up.on('error', (err) => {
        console.error('[open3dhk-relay] stream', upstream.label, err);
        abortOpen3dhkClient(res);
      });
      res.on('close', () => {
        if (!up.destroyed) up.destroy();
      });
      up.pipe(res);
    },
  );
  upReq.on('error', (err) => {
    console.error('[open3dhk-relay]', upstream.label, err);
    // Mid-stream reset after headers: never retry (would ERR_HTTP_HEADERS_SENT).
    if (committed || res.headersSent) {
      abortOpen3dhkClient(res);
      return;
    }
    if (index + 1 < OPEN3DHK_UPSTREAMS.length) {
      const delayMs = 150 * (index + 1);
      setTimeout(() => tryOpen3dhkUpstream(req, res, pathname, index + 1), delayMs);
      return;
    }
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('upstream error');
    }
  });
  req.on('aborted', () => {
    if (!upReq.destroyed) upReq.destroy();
  });
  upReq.end();
}

function startOpen3dhkRelayServer() {
  const g = globalThis;
  if (g.__udonariumOpen3dhkRelayServer) return;
  const server = http.createServer(handleOpen3dhkRelay);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[open3dhk-relay] port ${OPEN3DHK_RELAY_PORT} in use; reusing existing server`);
      return;
    }
    console.error('[open3dhk-relay]', err);
  });
  server.listen(OPEN3DHK_RELAY_PORT, '127.0.0.1', () => {
    console.log(
      `[open3dhk-relay] http://127.0.0.1:${OPEN3DHK_RELAY_PORT} → data11/download ${OPEN3DHK_UPSTREAM_PREFIX}`,
    );
  });
  g.__udonariumOpen3dhkRelayServer = server;
}

startDev3dmodelServer();
startOpen3dhkRelayServer();

module.exports = {
  '/dev-3dmodel': {
    target: `http://127.0.0.1:${LISTEN_PORT}`,
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/dev-3dmodel': '' },
    logLevel: 'info',
  },
  '/streetscape-open3dhk': {
    target: `http://127.0.0.1:${OPEN3DHK_RELAY_PORT}`,
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/streetscape-open3dhk': '' },
    logLevel: 'info',
  },
  '/v1': {
    target: 'http://127.0.0.1:8787',
    secure: false,
    changeOrigin: true,
    logLevel: 'info',
    onProxyReq(proxyReq, req) {
      // Forward the browser Origin (localhost or 127.0.0.1) so CORS checks match the page.
      const origin = req.headers.origin || `https://${req.headers.host || '127.0.0.1:4200'}`;
      proxyReq.setHeader('Origin', origin);
    },
  },
};
