import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import fs from 'fs';
import path from 'path';

function mediapipeDevPlugin() {
  return {
    name: 'mediapipe-dev-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlWithoutQuery = req.url.split('?')[0];
        if (urlWithoutQuery.startsWith('/wasm/mediapipe/') && urlWithoutQuery.endsWith('.js')) {
          const filename = path.basename(urlWithoutQuery);
          const filePath = path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm', filename);
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/javascript');
            let content = fs.readFileSync(filePath, 'utf-8');
            // Fix strict-mode block-scoped function issue in Emscripten code
            content = content.replace(/function custom_dbg\(text\)/g, "var custom_dbg = function(text)");
            // Expose ModuleFactory to global scope
            if (!content.includes('globalThis.ModuleFactory')) {
              content += "\nif (typeof globalThis !== 'undefined') { globalThis.ModuleFactory = ModuleFactory; }\n";
            }
            res.end(content);
            return;
          }
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [
    mediapipeDevPlugin(),
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
    format: 'iife',
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
