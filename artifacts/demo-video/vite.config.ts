import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

const port = Number(process.env.PORT) || 5000;

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  base: '/demo/',
  publicDir: '../../docs/screenshots',
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    host: '0.0.0.0',
    allowedHosts: 'all',
  },
});
