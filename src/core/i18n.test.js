import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from './config.js';
import eventBus from './eventBus.js';
import { DICTIONARY, i18n } from './i18n.js';

const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'ru'];

afterEach(() => {
  i18n.setLocale('en');
});

describe('i18n locale lifecycle', () => {
  it('keeps all five locale dictionaries complete', () => {
    expect(Object.keys(DICTIONARY)).toEqual(SUPPORTED_LOCALES);
    const englishKeys = Object.keys(DICTIONARY.en).sort();

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(DICTIONARY[locale]).sort()).toEqual(englishKeys);
    }
  });

  it('keeps every translation non-empty with matching placeholders', () => {
    const placeholderPattern = /\{\d+\}/g;

    for (const [key, englishText] of Object.entries(DICTIONARY.en)) {
      const expectedPlaceholders = [...englishText.matchAll(placeholderPattern)]
        .map(([placeholder]) => placeholder)
        .sort();

      for (const locale of SUPPORTED_LOCALES) {
        const translatedText = DICTIONARY[locale][key];
        expect(translatedText.trim(), `${locale}:${key}`).not.toBe('');
        expect(
          [...translatedText.matchAll(placeholderPattern)]
            .map(([placeholder]) => placeholder)
            .sort(),
          `${locale}:${key}`
        ).toEqual(expectedPlaceholders);
      }
    }
  });

  it('defines one fact key for every target in every locale', () => {
    const expectedFactKeys = Object.keys(CONFIG.targetMap)
      .map((targetKey) => `fact.${targetKey}`)
      .sort();

    expect(expectedFactKeys).toHaveLength(23);
    for (const locale of SUPPORTED_LOCALES) {
      const factKeys = Object.keys(DICTIONARY[locale])
        .filter((key) => key.startsWith('fact.'))
        .sort();
      expect(factKeys, `${locale} fact keys`).toEqual(expectedFactKeys);
    }
  });

  it('updates getLocale and emits one i18n:change event for each locale', () => {
    const events = [];
    const handleLocaleChange = payload => events.push(payload);
    eventBus.on('i18n:change', handleLocaleChange);

    try {
      for (const locale of SUPPORTED_LOCALES) {
        i18n.setLocale(locale);
        expect(i18n.getLocale()).toBe(locale);
      }

      expect(events).toEqual(SUPPORTED_LOCALES.map(lang => ({ lang })));
    } finally {
      eventBus.off('i18n:change', handleLocaleChange);
    }
  });

  it('ignores unsupported locales without changing state or emitting', () => {
    i18n.setLocale('en');
    const listener = vi.fn();
    eventBus.on('i18n:change', listener);

    try {
      i18n.setLocale('unsupported');
      expect(i18n.getLocale()).toBe('en');
      expect(listener).not.toHaveBeenCalled();
    } finally {
      eventBus.off('i18n:change', listener);
    }
  });
});
