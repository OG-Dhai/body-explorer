import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DICTIONARY } from './src/core/i18n.js';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = join(PROJECT_ROOT, 'piper_models');
const AUDIO_ROOT = join(PROJECT_ROOT, 'public', 'audio');

/**
 * Offline Piper voices used for localized educational narration.
 * Model files are downloaded with:
 * python -m piper.download_voices --download-dir piper_models \
 *   en_US-lessac-medium de_DE-thorsten-medium fr_FR-siwis-medium \
 *   es_ES-sharvard-medium ru_RU-denis-medium
 */
export const PIPER_MODELS = Object.freeze({
  en: Object.freeze({
    voice: 'en_US-lessac-medium',
    modelFile: 'en_US-lessac-medium.onnx',
    configFile: 'en_US-lessac-medium.onnx.json',
    modelSha256: '5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f',
  }),
  de: Object.freeze({
    voice: 'de_DE-thorsten-medium',
    modelFile: 'de_DE-thorsten-medium.onnx',
    configFile: 'de_DE-thorsten-medium.onnx.json',
    modelSha256: '7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819',
  }),
  fr: Object.freeze({
    voice: 'fr_FR-siwis-medium',
    modelFile: 'fr_FR-siwis-medium.onnx',
    configFile: 'fr_FR-siwis-medium.onnx.json',
    modelSha256: '641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99',
  }),
  es: Object.freeze({
    voice: 'es_ES-sharvard-medium',
    modelFile: 'es_ES-sharvard-medium.onnx',
    configFile: 'es_ES-sharvard-medium.onnx.json',
    modelSha256: '40febfb1679c69a4505ff311dc136e121e3419a13a290ef264fdf43ddedd0fb1',
    speaker: 0,
  }),
  ru: Object.freeze({
    voice: 'ru_RU-denis-medium',
    modelFile: 'ru_RU-denis-medium.onnx',
    configFile: 'ru_RU-denis-medium.onnx.json',
    modelSha256: '15fab56e11a097858ee115545d0f697fc2a316c41a291a5362349fb870411b0a',
  }),
});

export const AUDIO_KEYS = Object.freeze(
  Object.keys(DICTIONARY.en).filter(
    (key) => key.startsWith('edu.') || key.startsWith('fact.') || key.startsWith('voice.'),
  ),
);

const DEFAULT_LANGUAGES = Object.freeze(Object.keys(PIPER_MODELS));
const VOICE_AUDIO_LANGUAGES = new Set(['fr', 'es', 'ru']);
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FORCE = process.argv.includes('--force');
const CHECK_ONLY = process.argv.includes('--check');

function fail(message) {
  throw new Error(`[AudioGenerator] ${message}`);
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function assertPhraseInventory() {
  const eduKeys = AUDIO_KEYS.filter((key) => key.startsWith('edu.'));
  const factKeys = AUDIO_KEYS.filter((key) => key.startsWith('fact.'));
  const voiceKeys = AUDIO_KEYS.filter((key) => key.startsWith('voice.'));

  if (eduKeys.length !== 23 || factKeys.length !== 23 || voiceKeys.length !== 9) {
    fail(
      `Expected 23 edu, 23 fact, and 9 voice keys; found ` +
      `${eduKeys.length}, ${factKeys.length}, and ${voiceKeys.length}.`
    );
  }

  for (const lang of DEFAULT_LANGUAGES) {
    const missing = AUDIO_KEYS.filter((key) => !DICTIONARY[lang]?.[key]);
    if (missing.length > 0) {
      fail(`${lang} is missing translations: ${missing.join(', ')}`);
    }
  }
}

function audioKeysForLanguage(lang) {
  return AUDIO_KEYS.filter(
    (key) => !key.startsWith('voice.') || VOICE_AUDIO_LANGUAGES.has(lang),
  );
}

function assertModel(lang) {
  const model = PIPER_MODELS[lang];
  const modelPath = join(MODEL_DIR, model.modelFile);
  const configPath = join(MODEL_DIR, model.configFile);

  if (!existsSync(modelPath) || !existsSync(configPath)) {
    fail(`Missing ${model.voice}. Run the documented piper.download_voices command first.`);
  }

  const actualHash = sha256(modelPath);
  if (actualHash !== model.modelSha256) {
    fail(`${model.modelFile} failed SHA-256 validation.`);
  }

  return { ...model, modelPath, configPath };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    ...options,
  });

  if (result.error) {
    fail(`${command} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    fail(`${command} exited with code ${result.status}${details ? `:\n${details}` : ''}`);
  }
}

function outputPathFor(lang, key) {
  const [category, fileName] = key.split('.');
  return join(AUDIO_ROOT, lang, category, `${fileName}.mp3`);
}

function synthesizeLanguage(lang, model) {
  const languageAudioKeys = audioKeysForLanguage(lang);
  const skippedKeys = languageAudioKeys.filter(
    (key) => !FORCE && existsSync(outputPathFor(lang, key)),
  );
  const keysToGenerate = languageAudioKeys.filter((key) => !skippedKeys.includes(key));

  for (const key of skippedKeys) {
    console.log(`  skipped   ${lang}/${key.replace('.', '/')}.mp3`);
  }
  if (keysToGenerate.length === 0) {
    return { generated: 0, skipped: skippedKeys.length };
  }

  const tempDir = join(PROJECT_ROOT, '.piper-tmp', `${lang}-${process.pid}-${Date.now()}`);
  const manifestPath = join(tempDir, 'manifest.json');
  mkdirSync(tempDir, { recursive: true });

  const items = keysToGenerate.map((key, index) => ({
    key,
    text: DICTIONARY[lang][key],
    wavPath: join(tempDir, `${String(index).padStart(2, '0')}.wav`),
    encodedPath: join(tempDir, `${String(index).padStart(2, '0')}.mp3`),
    outputPath: outputPathFor(lang, key),
  }));

  try {
    writeFileSync(manifestPath, JSON.stringify({
      modelPath: model.modelPath,
      configPath: model.configPath,
      speaker: Number.isInteger(model.speaker) ? model.speaker : null,
      items: items.map(({ text, wavPath }) => ({ text, wavPath })),
    }), 'utf8');

    // One Python process loads the model once and synthesizes every WAV for
    // this locale, avoiding a costly model reload for each phrase.
    run(PYTHON_BIN, [
      join(PROJECT_ROOT, 'scripts', 'generate_piper_batch.py'),
      manifestPath,
    ]);

    for (const item of items) {
      mkdirSync(dirname(item.outputPath), { recursive: true });
      // Matches EN/DE: MP3 Xing VBR, 22.05 kHz mono, libmp3lame quality 2.
      run(FFMPEG_BIN, [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', item.wavPath,
        '-codec:a', 'libmp3lame',
        '-qscale:a', '2',
        '-ar', '22050',
        '-ac', '1',
        '-map_metadata', '-1',
        item.encodedPath,
      ]);
      renameSync(item.encodedPath, item.outputPath);
      console.log(`  generated ${lang}/${item.key.replace('.', '/')}.mp3`);
    }

    return { generated: items.length, skipped: skippedKeys.length };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseLanguages() {
  const requested = process.argv.filter((arg) => Object.hasOwn(PIPER_MODELS, arg));
  return requested.length > 0 ? requested : DEFAULT_LANGUAGES;
}

export function main() {
  assertPhraseInventory();
  const languages = parseLanguages();
  const models = Object.fromEntries(languages.map((lang) => [lang, assertModel(lang)]));

  if (CHECK_ONLY) {
    console.log(
      `[AudioGenerator] Ready: ${languages.join(', ')}; ` +
      '23 edu, 23 fact, and 9 localized-feedback phrases.'
    );
    return;
  }

  let generated = 0;
  let skipped = 0;
  for (const lang of languages) {
    console.log(`[AudioGenerator] Synthesizing ${lang} with ${models[lang].voice}...`);
    const result = synthesizeLanguage(lang, models[lang]);
    generated += result.generated;
    skipped += result.skipped;
  }

  console.log(`[AudioGenerator] Complete: ${generated} generated, ${skipped} skipped.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  main();
}
