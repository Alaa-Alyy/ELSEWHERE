import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const cesiumSource = 'node_modules/cesium/Build/Cesium';
// Cesium loads workers/assets at runtime from this URL path (dev and preview alike).
const cesiumBaseUrl = 'cesiumStatic';

// Tests live in ../tests/frontend (repo convention); resolve their bare imports from here.
const nm = (p) => path.resolve(here, 'node_modules', p);

export default defineConfig({
  base: './',
  define: {
    CESIUM_BASE_URL: JSON.stringify(`./${cesiumBaseUrl}`),
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Workers`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Assets`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Widgets`, dest: cesiumBaseUrl },
      ],
    }),
  ],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { allow: ['..'] } },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { chunkSizeWarningLimit: 6000 },
  resolve: {
    alias: [
      { find: /^react$/, replacement: nm('react') },
      { find: /^react\/(.*)$/, replacement: nm('react') + '/$1' },
      { find: /^react-dom$/, replacement: nm('react-dom') },
      { find: /^react-dom\/(.*)$/, replacement: nm('react-dom') + '/$1' },
      { find: /^@testing-library\/(.*)$/, replacement: nm('@testing-library') + '/$1' },
    ],
  },
  test: {
    environment: 'jsdom',
    root: here,
    dir: path.resolve(here, '../tests/frontend'),
    include: ['**/*.test.{js,jsx}'],
    setupFiles: [path.resolve(here, '../tests/frontend/setup.js')],
    server: { deps: { inline: [/tests\/frontend/] } },
  },
});
