import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

const port = Number(process.env.PORT) || 5000;

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  base: '/demo-video/',
  publicDir: '../../docs/screenshots',
  server: {
    port,
    host: '0.0.0.0',
    allowedHosts: 'all',
  },
});