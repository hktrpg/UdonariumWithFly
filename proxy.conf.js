const PROXY_ORIGIN = 'https://localhost:4200';

module.exports = {
  '/v1': {
    target: 'http://127.0.0.1:8787',
    secure: false,
    changeOrigin: true,
    logLevel: 'info',
    onProxyReq(proxyReq) {
      proxyReq.setHeader('Origin', PROXY_ORIGIN);
    },
  },
};
