import { describe, it, expect, beforeEach, vi } from 'vitest';
import { badgeSystem, BADGE_DETAILS } from './badgeSystem.js';
import eventBus from '../core/eventBus.js';
import { i18n } from '../core/i18n.js';

describe('BadgeSystem', () => {
  beforeEach(() => {
    badgeSystem.clearAllBadges();
    badgeSystem.resetSession();
    vi.restoreAllMocks();
  });

  it('should start with all badges locked', () => {
    const badges = badgeSystem.getBadges();
    expect(Object.keys(badges).length).toBe(0);
    Object.keys(BADGE_DETAILS).forEach(id => {
      expect(badgeSystem.isUnlocked(id)).toBe(false);
    });
  });

  it('should unlock first_step and perfect_explorer when level completes successfully with zero misses', () => {
    const unlockListener = vi.fn();
    eventBus.on('badge:unlocked', unlockListener);

    eventBus.emit('level:complete', {
      level: 1,
      passed: true,
      stats: { levelMissed: 0 },
      levelParams: { name: 'easy' }
    });

    expect(badgeSystem.isUnlocked('first_step')).toBe(true);
    expect(badgeSystem.isUnlocked('perfect_explorer')).toBe(true);
    expect(unlockListener).toHaveBeenCalledTimes(2);

    eventBus.off('badge:unlocked', unlockListener);
  });

  it('should unlock first_step but NOT perfect_explorer when level completes with misses', () => {
    eventBus.emit('level:complete', {
      level: 1,
      passed: true,
      stats: { levelMissed: 1 },
      levelParams: { name: 'easy' }
    });

    expect(badgeSystem.isUnlocked('first_step')).toBe(true);
    expect(badgeSystem.isUnlocked('perfect_explorer')).toBe(false);
  });

  it('should track speed_star lightning fast hits streak', () => {
    // 4 fast hits (< 3000ms)
    for (let i = 0; i < 4; i++) {
      eventBus.emit('game:hit', { reactionTime: 2500 });
      expect(badgeSystem.isUnlocked('speed_star')).toBe(false);
    }

    // 5th fast hit unlocks
    eventBus.emit('game:hit', { reactionTime: 2800 });
    expect(badgeSystem.isUnlocked('speed_star')).toBe(true);
  });

  it('should reset lightning streak on a slow hit or miss', () => {
    // 3 fast hits
    for (let i = 0; i < 3; i++) {
      eventBus.emit('game:hit', { reactionTime: 2000 });
    }

    // Slow hit (>= 3000ms) resets streak
    eventBus.emit('game:hit', { reactionTime: 3500 });

    // 2 more fast hits (total streak since reset is 2, so still locked)
    eventBus.emit('game:hit', { reactionTime: 1000 });
    eventBus.emit('game:hit', { reactionTime: 1500 });
    expect(badgeSystem.isUnlocked('speed_star')).toBe(false);

    // Miss resets streak
    eventBus.emit('game:hit', { reactionTime: 1000 }); // Fast hit 1
    eventBus.emit('game:miss'); // Miss!
    
    // Fast hit 2, 3, 4, 5
    for (let i = 0; i < 4; i++) {
      eventBus.emit('game:hit', { reactionTime: 2000 });
    }
    expect(badgeSystem.isUnlocked('speed_star')).toBe(false);

    // Fast hit 6 (actually 5th fast hit after miss) unlocks
    eventBus.emit('game:hit', { reactionTime: 2000 });
    expect(badgeSystem.isUnlocked('speed_star')).toBe(true);
  });

  it('should unlock word_traveler when correctly answering in 3 different languages', () => {
    const getLocaleSpy = vi.spyOn(i18n, 'getLocale');

    // 1st language
    getLocaleSpy.mockReturnValue('en');
    eventBus.emit('game:hit', { reactionTime: 4000 });
    expect(badgeSystem.isUnlocked('word_traveler')).toBe(false);

    // 2nd language
    getLocaleSpy.mockReturnValue('de');
    eventBus.emit('game:hit', { reactionTime: 4000 });
    expect(badgeSystem.isUnlocked('word_traveler')).toBe(false);

    // 3rd language
    getLocaleSpy.mockReturnValue('fr');
    eventBus.emit('game:hit', { reactionTime: 4000 });
    expect(badgeSystem.isUnlocked('word_traveler')).toBe(true);
  });

  it('should unlock comeback_kid when completing a level that was previously failed in the session', () => {
    // Fail level 2
    eventBus.emit('level:complete', {
      level: 2,
      passed: false,
      stats: { levelMissed: 5 },
      levelParams: { name: 'medium' }
    });
    expect(badgeSystem.isUnlocked('comeback_kid')).toBe(false);

    // Complete level 2
    eventBus.emit('level:complete', {
      level: 2,
      passed: true,
      stats: { levelMissed: 1 },
      levelParams: { name: 'medium' }
    });
    expect(badgeSystem.isUnlocked('comeback_kid')).toBe(true);
  });

  it('should unlock grand_explorer when completing all three difficulties', () => {
    // Complete easy
    eventBus.emit('level:complete', {
      level: 1,
      passed: true,
      stats: { levelMissed: 0 },
      levelParams: { name: 'easy' }
    });
    expect(badgeSystem.isUnlocked('grand_explorer')).toBe(false);

    // Complete medium
    eventBus.emit('level:complete', {
      level: 2,
      passed: true,
      stats: { levelMissed: 0 },
      levelParams: { name: 'medium' }
    });
    expect(badgeSystem.isUnlocked('grand_explorer')).toBe(false);

    // Complete hard
    eventBus.emit('level:complete', {
      level: 3,
      passed: true,
      stats: { levelMissed: 0 },
      levelParams: { name: 'hard' }
    });
    expect(badgeSystem.isUnlocked('grand_explorer')).toBe(true);
  });
});
