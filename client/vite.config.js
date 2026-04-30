import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import devAgentBridge from './vite-plugin-dev-agent-bridge.js';

const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), devAgentBridge()],
  server: {
    port: 5174,
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
