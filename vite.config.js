import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@mediapipe/tasks-vision/wasm/*',
          dest: 'wasm/mediapipe',
        },
      ],
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (used by WASM threads)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
