const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.use(cors());

app.use('/api', createProxyMiddleware({
  target: 'https://api.openaq.org',
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
  on: {
    proxyReq: (proxyReq) => {
      proxyReq.setHeader('X-API-Key', 'fbe1fb46d589fb2f4c1ab59f430045fa91ef7cf0bee64245b5347b8ca6b814ca');
    }
  }
}));

app.listen(3000, () => console.log('Proxy corriendo en http://localhost:3000'));