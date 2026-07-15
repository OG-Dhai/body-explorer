import eventBus from '../core/eventBus.js';
import { i18n } from '../core/i18n.js';

const STORAGE_KEY = 'body_explorer_badges';

export const BADGE_DETAILS = {
  first_step: {
    id: 'first_step',
    nameKey: 'badge.first_step.name',
    descKey: 'badge.first_step.desc',
    icon: 'icon-footprint',
    repeatable: false
  },
  perfect_explorer: {
    id: 'perfect_explorer',
    nameKey: 'badge.perfect_explorer.name',
    descKey: 'badge.perfect_explorer.desc',
    icon: 'icon-trophy-star',
    repeatable: true
  },
  speed_star: {
    id: 'speed_star',
    nameKey: 'badge.speed_star.name',
    descKey: 'badge.speed_star.desc',
    icon: 'icon-speed-star',
    repeatable: true
  },
  grand_explorer: {
    id: 'grand_explorer',
    nameKey: 'badge.grand_explorer.name',
    descKey: 'badge.grand_explorer.desc',
    icon: 'icon-compass',
    repeatable: false
  },
  word_traveler: {
    id: 'word_traveler',
    nameKey: 'badge.word_traveler.name',
    descKey: 'badge.word_traveler.desc',
    icon: 'icon-chat-languages',
    repeatable: false
  },
  comeback_kid: {
    id: 'comeback_kid',
    nameKey: 'badge.comeback_kid.name',
    descKey: 'badge.comeback_kid.desc',
    icon: 'icon-resilience-shield',
    repeatable: true
  }
};

class BadgeSystem {
  constructor() {
    this._badges = this._loadState();
    
    this._sessionState = {
      lightningStreak: 0,
      completedDifficulties: new Set(),
      correctLanguages: new Set(),
      failedLevels: new Set()
    };
    
    this._onGameHit = this._onGameHit.bind(this);
    this._onGameMiss = this._onGameMiss.bind(this);
    this._onLevelComplete = this._onLevelComplete.bind(this);
    
    this._bindEvents();
  }

  _bindEvents() {
    eventBus.on('game:hit', this._onGameHit);
    eventBus.on('game:miss', this._onGameMiss);
    eventBus.on('level:complete', this._onLevelComplete);
  }

  _loadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      console.error('[BadgeSystem] Failed to load badges state:', e);
      return {};
    }
  }

  _saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._badges));
    } catch (e) {
      console.error('[BadgeSystem] Failed to save badges state:', e);
    }
  }

  getBadges() {
    return this._badges;
  }

  isUnlocked(badgeId) {
    return !!this._badges[badgeId]?.unlocked;
  }

  unlockBadge(badgeId) {
    const config = BADGE_DETAILS[badgeId];
    if (!config) return;

    const existing = this._badges[badgeId];
    if (existing && !config.repeatable) return; // Non-repeatable already unlocked

    if (!existing) {
      this._badges[badgeId] = {
        unlocked: true,
        count: 1,
        unlockedAt: Date.now()
      };
    } else {
      this._badges[badgeId].count = (this._badges[badgeId].count || 1) + 1;
      this._badges[badgeId].unlockedAt = Date.now();
    }

    this._saveState();
    
    eventBus.emit('badge:unlocked', {
      id: badgeId,
      badge: BADGE_DETAILS[badgeId],
      state: this._badges[badgeId]
    });
  }

  _onGameHit({ reactionTime }) {
    // 1. Track Speed Star (5 lightning hits in a row)
    // A lightning hit is < 3000ms
    if (reactionTime < 3000) {
      this._sessionState.lightningStreak++;
      if (this._sessionState.lightningStreak >= 5) {
        this.unlockBadge('speed_star');
        this._sessionState.lightningStreak = 0;
      }
    } else {
      this._sessionState.lightningStreak = 0;
    }

    // 2. Track Word Traveler (correct answer in 3+ languages)
    const locale = i18n.getLocale();
    if (locale) {
      this._sessionState.correctLanguages.add(locale);
      if (this._sessionState.correctLanguages.size >= 3) {
        this.unlockBadge('word_traveler');
      }
    }
  }

  _onGameMiss() {
    this._sessionState.lightningStreak = 0;
  }

  _onLevelComplete({ level, passed, stats, levelParams }) {
    if (!passed) {
      // Track failed levels for Comeback Kid
      this._sessionState.failedLevels.add(level);
      return;
    }

    // 1. First Step Badge
    this.unlockBadge('first_step');

    // 2. Perfect Explorer Badge (level completed with 0 missed questions)
    if (stats.levelMissed === 0) {
      this.unlockBadge('perfect_explorer');
    }

    // 3. Comeback Kid Badge (failed before, now completed successfully)
    if (this._sessionState.failedLevels.has(level)) {
      this.unlockBadge('comeback_kid');
      this._sessionState.failedLevels.delete(level);
    }

    // 4. Grand Explorer Badge (complete all 3 difficulties in one session)
    if (levelParams && levelParams.name) {
      this._sessionState.completedDifficulties.add(levelParams.name.toLowerCase());
      if (
        this._sessionState.completedDifficulties.has('easy') &&
        this._sessionState.completedDifficulties.has('medium') &&
        this._sessionState.completedDifficulties.has('hard')
      ) {
        this.unlockBadge('grand_explorer');
      }
    }
  }

  resetSession() {
    this._sessionState.lightningStreak = 0;
    this._sessionState.completedDifficulties.clear();
    this._sessionState.correctLanguages.clear();
    this._sessionState.failedLevels.clear();
  }

  clearAllBadges() {
    this._badges = {};
    this._saveState();
    eventBus.emit('badge:stateChange', { badges: this._badges });
  }
}

export const badgeSystem = new BadgeSystem();
