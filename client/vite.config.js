import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import devAgentBridge from './vite-plugin-dev-agent-bridge.js';

const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:4000';
const devPortText = String(process.env.VITE_DEV_PORT || '5174').trim();
const devPort = /^\d+$/.test(devPortText) ? Number.parseInt(devPortText, 10) : Number.NaN;

if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) {
  throw new Error(`VITE_DEV_PORT must be a number from 1 to 65535; received ${process.env.VITE_DEV_PORT || '(empty)'}.`);
}

export default defineConfig({
  plugins: [react(), devAgentBridge()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('react')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: devPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        ws: true,
        timeout: 120_000,      // 2 min — covers long-running AI provider calls
        proxyTimeout: 120_000, // http-proxy upstream timeout
      },
      '/uploads': {
        target: proxyTarget,
        changeOrigin: true,
      },
      '/prototypes': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
});
