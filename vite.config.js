import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import fs from 'fs';
import path from 'path';

// MediaPipe WASM loader patch.
//
// @mediapipe/tasks-vision 0.10.35 ships a WASM loader
// (node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js) that
// doesn't work inside a Web Worker as-is. Two fixes:
//   1. custom_dbg is a hoisted function declaration that throws a ReferenceError
//      under strict mode, so we rewrite it to a var assignment.
//   2. ModuleFactory is never put on globalThis, so worker callers get
//      "ModuleFactory not set". We append that assignment.
//
// Applied in two places: mediapipeDevPlugin() during dev, and the viteStaticCopy
// transform during the production build.
//
// Checked against 0.10.35 (2026-07-15). When you bump tasks-vision, check if
// upstream fixed either issue; if so, drop the matching branch and test dev and
// build+preview with a real camera first.
function patchMediapipeLoader(content) {
  let patched = content.replace(
    /function custom_dbg\(text\)/g,
    'var custom_dbg = function(text)'
  );

  if (!patched.includes('globalThis.ModuleFactory')) {
    patched += "\nif (typeof globalThis !== 'undefined') { globalThis.ModuleFactory = ModuleFactory; }\n";
  }

  return patched;
}

function mediapipeDevPlugin() {
  return {
    name: 'mediapipe-dev-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlWithoutQuery = req.url.split('?')[0];
        if (!urlWithoutQuery.startsWith('/wasm/mediapipe/')) {
          return next();
        }

        const filename = path.basename(urlWithoutQuery);

        // Try node_modules first, then fall back to src/wasm/mediapipe/
        const candidates = [
          path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm', filename),
          path.resolve(__dirname, 'src/wasm/mediapipe', filename),
        ];

        const filePath = candidates.find(p => fs.existsSync(p));
        if (!filePath) {
          return next();
        }

        if (urlWithoutQuery.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
          const stream = fs.createReadStream(filePath);
          stream.pipe(res);
          return;
        }

        if (urlWithoutQuery.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript');
          const content = patchMediapipeLoader(fs.readFileSync(filePath, 'utf-8'));
          res.end(content);
          return;
        }

        // .task model files or other binary assets
        if (urlWithoutQuery.endsWith('.task')) {
          res.setHeader('Content-Type', 'application/octet-stream');
          const stream = fs.createReadStream(filePath);
          stream.pipe(res);
          return;
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
          src: 'node_modules/@mediapipe/tasks-vision/wasm/*.js',
          dest: 'wasm/mediapipe',
          rename: { stripBase: true },
          transform: patchMediapipeLoader,
        },
        {
          src: 'node_modules/@mediapipe/tasks-vision/wasm/*.wasm',
          dest: 'wasm/mediapipe',
          rename: { stripBase: true },
        },
        // Note: the pose/hand/face .task models are bundled automatically via
        // `new URL('../wasm/mediapipe/<model>.task', import.meta.url)` in their
        // workers, so they do not need an explicit copy target here.
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
