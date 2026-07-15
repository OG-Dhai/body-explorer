import { describe, it, expect, vi } from 'vitest';
import { ScoringSystem } from './scoringSystem.js';
import { CONFIG } from '../core/config.js';

describe('ScoringSystem', () => {
  it('initializes with zeros', () => {
    const scoring = new ScoringSystem();
    const stats = scoring.getStats();
    expect(stats.score).toBe(0);
    expect(stats.streak).toBe(0);
  });

  it('records a hit and applies streak and time bonus', () => {
    const scoring = new ScoringSystem();
    
    // Mock performance.now to control reaction time
    vi.stubGlobal('performance', { now: vi.fn() });
    
    performance.now.mockReturnValue(1000);
    scoring.startQuestion();
    
    // Simulate answering in 2 seconds (reaction time = 2000ms)
    performance.now.mockReturnValue(3000);
    const points = scoring.recordHit();
    
    expect(points).toBeGreaterThan(CONFIG.game.baseScore);
    const stats = scoring.getStats();
    expect(stats.streak).toBe(1);
    expect(stats.bestStreak).toBe(1);
    expect(stats.score).toBe(points);
    expect(stats.avgTime).toBe(2000);
    expect(stats.lastReactionTime).toBe(2000);
    
    vi.unstubAllGlobals();
  });

  it('records a miss and resets streak', () => {
    const scoring = new ScoringSystem();
    scoring.recordHit();
    expect(scoring.getStats().streak).toBe(1);
    
    scoring.recordMiss();
    const stats = scoring.getStats();
    expect(stats.streak).toBe(0);
    expect(stats.levelMissed).toBe(1);
  });

  it('excludes pause duration from reaction time and handles repeated calls safely', () => {
    const scoring = new ScoringSystem();
    scoring.startQuestion(1_000);

    expect(scoring.pauseQuestion(3_000)).toBe(true);
    expect(scoring.pauseQuestion(4_000)).toBe(false);
    expect(scoring.resumeQuestion(13_000)).toBe(true);
    expect(scoring.resumeQuestion(14_000)).toBe(false);

    scoring.recordHit(15_000);
    const stats = scoring.getStats();
    expect(stats.lastReactionTime).toBe(4_000);
    expect(stats.avgTime).toBe(4_000);
  });

  it('resets level correctly', () => {
    const scoring = new ScoringSystem();
    scoring.recordHit();
    scoring.resetLevel();
    const stats = scoring.getStats();
    expect(stats.levelScore).toBe(0);
    expect(stats.levelAnswered).toBe(0);
    // Note: total score and questionsAnswered should NOT be reset
    expect(stats.score).toBeGreaterThan(0);
    expect(stats.answered).toBe(1);
  });
});
