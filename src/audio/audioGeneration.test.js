import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { AUDIO_KEYS, PIPER_MODELS } from '../../generate_edu_audio.js';

describe('Piper audio generation inventory', () => {
  it('targets one approved native Piper model per locale', () => {
    expect(Object.keys(PIPER_MODELS)).toEqual(['en', 'de', 'fr', 'es', 'ru']);
    expect(PIPER_MODELS.en.voice).toBe('en_US-lessac-medium');
    expect(PIPER_MODELS.de.voice).toBe('de_DE-thorsten-medium');
    expect(PIPER_MODELS.fr.voice).toBe('fr_FR-siwis-medium');
    expect(PIPER_MODELS.es.voice).toBe('es_ES-sharvard-medium');
    expect(PIPER_MODELS.es.speaker).toBe(0);
    expect(PIPER_MODELS.ru.voice).toBe('ru_RU-denis-medium');
  });

  it('contains exactly 23 questions, 23 facts, and 9 spoken feedback phrases', () => {
    expect(AUDIO_KEYS.filter((key) => key.startsWith('edu.'))).toHaveLength(23);
    expect(AUDIO_KEYS.filter((key) => key.startsWith('fact.'))).toHaveLength(23);
    expect(AUDIO_KEYS.filter((key) => key.startsWith('voice.'))).toHaveLength(9);
    expect(AUDIO_KEYS).toHaveLength(55);
  });

  it('ships the exact localized audio inventory for every supported locale', () => {
    const audioRoot = fileURLToPath(new URL('../../public/audio/', import.meta.url));
    const eduFiles = AUDIO_KEYS
      .filter((key) => key.startsWith('edu.'))
      .map((key) => `${key.slice('edu.'.length)}.mp3`)
      .sort();
    const voiceFiles = AUDIO_KEYS
      .filter((key) => key.startsWith('voice.'))
      .map((key) => `${key.slice('voice.'.length)}.mp3`)
      .sort();
    const factFiles = AUDIO_KEYS
      .filter((key) => key.startsWith('fact.'))
      .map((key) => `${key.slice('fact.'.length)}.mp3`)
      .sort();

    for (const locale of ['en', 'de', 'fr', 'es', 'ru']) {
      const eduDir = join(audioRoot, locale, 'edu');
      expect(readdirSync(eduDir).sort(), `${locale} educational clips`).toEqual(eduFiles);
      for (const file of eduFiles) {
        expect(statSync(join(eduDir, file)).size, `${locale}/edu/${file}`).toBeGreaterThan(1_000);
      }

      const factDir = join(audioRoot, locale, 'fact');
      expect(readdirSync(factDir).sort(), `${locale} fact clips`).toEqual(factFiles);
      for (const file of factFiles) {
        expect(statSync(join(factDir, file)).size, `${locale}/fact/${file}`).toBeGreaterThan(1_000);
      }

      const voiceDir = join(audioRoot, locale, 'voice');
      if (['fr', 'es', 'ru'].includes(locale)) {
        expect(readdirSync(voiceDir).sort(), `${locale} feedback clips`).toEqual(voiceFiles);
        for (const file of voiceFiles) {
          expect(statSync(join(voiceDir, file)).size, `${locale}/voice/${file}`).toBeGreaterThan(1_000);
        }
      } else {
        expect(existsSync(voiceDir), `${locale} uses non-verbal feedback`).toBe(false);
      }
    }
  });
});
