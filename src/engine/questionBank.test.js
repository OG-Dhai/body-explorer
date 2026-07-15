import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIG } from '../core/config.js';
import { QuestionBank } from './questionBank.js';

const LEVELS = [
  { level: 1, difficulty: 'easy', count: 4 },
  { level: 2, difficulty: 'normal', count: 6 },
  { level: 3, difficulty: 'advanced', count: 7 },
];

function keysForTier(difficulty) {
  return Object.entries(CONFIG.targetMap)
    .filter(([, target]) => target.difficulty === difficulty)
    .map(([key]) => key);
}

function readRound(bank) {
  const questions = [];
  while (!bank.isComplete()) questions.push(bank.next());
  return questions;
}

function generateRound(level, excludeKeys = [], protectedExcludeKeys = []) {
  const bank = new QuestionBank();
  bank.generateRoundForLevel(level, excludeKeys, protectedExcludeKeys);
  return readRound(bank);
}

function difficultiesFor(questions) {
  return questions.map(({ id }) => CONFIG.targetMap[id].difficulty);
}

describe('QuestionBank tier isolation and fallbacks', () => {
  beforeEach(() => {
    // Keep Fisher-Yates deterministic without changing the candidate order.
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses only the configured tier when no targets are excluded', () => {
    for (const { level, difficulty, count } of LEVELS) {
      const questions = generateRound(level);
      const ids = questions.map(({ id }) => id);

      expect(questions).toHaveLength(count);
      expect(new Set(ids)).toHaveLength(count);
      expect(difficultiesFor(questions)).toEqual(Array(count).fill(difficulty));
      for (const question of questions) {
        expect(question.factKey).toBe(`fact.${question.id}`);
      }
    }
  });

  it('borrows Normal before Easy when a Hard round lacks visible targets', () => {
    const advancedKeys = keysForTier('advanced');
    const normalKeys = keysForTier('normal');
    const excludeKeys = [
      ...advancedKeys.slice(0, 5),
      ...normalKeys.slice(0, 7),
    ];

    const questions = generateRound(3, excludeKeys);

    expect(difficultiesFor(questions)).toEqual([
      'advanced', 'advanced', 'advanced', 'advanced', 'advanced',
      'normal',
      'easy',
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Tier fallback triggered for advanced')
    );
  });

  it('never re-adds a Hard target while repairing a heavily excluded Medium round', () => {
    const questions = generateRound(2, Object.keys(CONFIG.targetMap));

    expect(questions).toHaveLength(CONFIG.game.levels[2].questionsPerRound);
    expect(difficultiesFor(questions)).toEqual(Array(6).fill('normal'));
    expect(questions.some(({ id }) => CONFIG.targetMap[id].difficulty === 'advanced')).toBe(false);
  });

  it('keeps the previous level target out of the next round', () => {
    const previousTargetKey = keysForTier('easy')[0];
    const mediumRound = generateRound(
      2,
      keysForTier('normal'),
      [previousTargetKey]
    );
    const mediumIds = mediumRound.map(({ id }) => id);

    expect(mediumRound).toHaveLength(CONFIG.game.levels[2].questionsPerRound);
    expect(mediumIds[0]).not.toBe(previousTargetKey);
    expect(mediumIds).not.toContain(previousTargetKey);
  });
});
