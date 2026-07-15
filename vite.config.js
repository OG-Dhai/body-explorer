import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import fs from 'fs';
import path from 'path';

/**
 * TECHNICAL DEBT — MediaPipe WASM loader patch
 *
 * @mediapipe/tasks-vision@0.10.35 ships a WASM loader file
 * (node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js) with
 * two defects that prevent it from working inside a Web Worker context:
 *
 *   1. `function custom_dbg(text)` is declared as a hoisted function statement
 *      inside a scope where strict-mode / bundler transforms cause a
 *      ReferenceError ("custom_dbg is not defined").  We rewrite it to
 *      `var custom_dbg = function(text)` to ensure the binding is available.
 *
 *   2. `ModuleFactory` (the Emscripten entry point) is never exported to
 *      `globalThis`, so callers in a Worker that expect
 *      `globalThis.ModuleFactory` get "ModuleFactory not set".  We append
 *      the missing assignment at the end of the file.
 *
 * This patch is applied in TWO places:
 *   - mediapipeDevPlugin()   → transforms the file on-the-fly during dev serve
 *   - viteStaticCopy targets → transforms the file during production build copy
 *
 * Verified against: @mediapipe/tasks-vision 0.10.35 (2026-07-15).
 *
 * ⚠  When upgrading @mediapipe/tasks-vision, re-check whether upstream has
 *    fixed either issue.  If so, REMOVE the corresponding rewrite branch and
 *    test both `npm run dev` and `npm run build && npm run preview` with a
 *    real camera before releasing.
 */
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
        {
          src: 'src/wasm/mediapipe/pose_landmarker_lite.task',
          dest: 'wasm/mediapipe',
          rename: { stripBase: true },
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
