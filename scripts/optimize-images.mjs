/**
 * Icon/badge image optimizer.
 *
 * The source icons ship as 1024x1024 illustrations but are only ever displayed
 * at ~30-72px. This script downscales them to a small, retina-friendly size and
 * re-encodes them, cutting each file from ~250-340KB to a few KB. It rewrites
 * the files in place, so keep a copy of the originals if you need the full-res
 * art later.
 *
 * Usage:  npm run optimize:images
 * Requires the `sharp` devDependency.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

// Directories whose *.png files should be optimized.
const TARGET_DIRS = ['public/icons', 'public/badges'];

// Largest on-screen size is the ~72px badge container; 160px keeps it crisp at
// 2x/3x device pixel ratios while staying tiny on disk.
const MAX_SIZE = 160;
const JPEG_QUALITY = 82;

async function optimizeDir(dir) {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.png'));

  for (const name of files) {
    const path = join(dir, name);
    // Read into a buffer first so we can safely overwrite the same path.
    const input = await readFile(path);
    const before = input.length;

    // fit:'inside' preserves aspect ratio; withoutEnlargement avoids upscaling
    // anything that is already small. mozjpeg gives the best size for these
    // photographic-style illustrations (they have no transparency to preserve).
    const output = await sharp(input)
      .resize(MAX_SIZE, MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    await writeFile(path, output);
    const pct = Math.round((1 - output.length / before) * 100);
    console.log(
      `${path}: ${(before / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(1)}KB (-${pct}%)`
    );
  }
}

for (const dir of TARGET_DIRS) {
  await optimizeDir(dir);
}
console.log('Image optimization complete.');
