module.exports = {
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
