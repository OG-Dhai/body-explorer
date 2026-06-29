import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const DEST = resolve(__dirname, '..', 'public', 'wasm', 'mediapipe');

if (!existsSync(SRC)) {
  console.warn('[copy-wasm] @mediapipe/tasks-vision not found — skipping copy.');
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });
console.log('[copy-wasm] MediaPipe WASM files copied to public/wasm/mediapipe/');
