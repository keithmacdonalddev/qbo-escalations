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
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
