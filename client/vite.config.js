import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import devAgentBridge from './vite-plugin-dev-agent-bridge.js';

export default defineConfig({
  plugins: [react(), devAgentBridge()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        timeout: 120_000,      // 2 min — covers long-running AI provider calls
        proxyTimeout: 120_000, // http-proxy upstream timeout
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/prototypes': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
