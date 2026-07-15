import { CONFIG } from '../core/config.js';

export class ScoringSystem {
  constructor() {
    this.reset();
  }

  reset() {
    this._score = 0;
    this._levelScore = 0;
    this._streak = 0;
    this._bestStreak = 0;
    this._levelBestStreak = 0;
    this._questionsAnswered = 0;
    this._levelAnswered = 0;
    this._levelMissed = 0;
    this._totalReactionTime = 0;
    this._startTime = 0;
    this._questionActive = false;
    this._questionPausedAt = null;
    this._lastReactionTime = 0;
  }

  resetLevel() {
    this._levelScore = 0;
    this._levelAnswered = 0;
    this._levelMissed = 0;
    this._levelBestStreak = 0;
  }

  startQuestion(now = performance.now()) {
    this._startTime = now;
    this._questionActive = true;
    this._questionPausedAt = null;
  }

  pauseQuestion(now = performance.now()) {
    if (!this._questionActive || this._questionPausedAt !== null) return false;
    this._questionPausedAt = now;
    return true;
  }

  resumeQuestion(now = performance.now()) {
    if (!this._questionActive || this._questionPausedAt === null) return false;
    this._startTime += Math.max(0, now - this._questionPausedAt);
    this._questionPausedAt = null;
    return true;
  }

  recordHit(now = performance.now()) {
    const effectiveNow = this._questionPausedAt ?? now;
    const reactionTime = Math.max(0, effectiveNow - this._startTime);
    this._questionActive = false;
    this._questionPausedAt = null;
    this._lastReactionTime = reactionTime;
    this._questionsAnswered++;
    this._levelAnswered++;
    this._totalReactionTime += reactionTime;
    
    this._streak++;
    if (this._streak > this._bestStreak) {
      this._bestStreak = this._streak;
    }
    if (this._streak > this._levelBestStreak) {
      this._levelBestStreak = this._streak;
    }

    // Fast reaction time bonus (e.g. less than 5 seconds is good)
    let timeBonus = 0;
    if (reactionTime < CONFIG.game.timing.fastReactionWindowMs) {
      timeBonus =
        (CONFIG.game.timing.fastReactionWindowMs - reactionTime) /
        CONFIG.game.timing.fastReactionWindowMs *
        CONFIG.game.baseScore *
        CONFIG.game.timeBonusFactor;
    }

    const streakBonus = this._streak * CONFIG.game.baseScore * CONFIG.game.streakBonusFactor;
    
    const points = Math.floor(CONFIG.game.baseScore + timeBonus + streakBonus);
    this._score += points;
    this._levelScore += points;

    return points;
  }

  recordMiss() {
    this._questionActive = false;
    this._questionPausedAt = null;
    this._streak = 0;
    this._levelMissed++;
  }

  getStats() {
    return {
      score: this._score,
      levelScore: this._levelScore,
      streak: this._streak,
      bestStreak: this._bestStreak,
      levelBestStreak: this._levelBestStreak,
      lastReactionTime: this._lastReactionTime,
      avgTime: this._questionsAnswered > 0 ? (this._totalReactionTime / this._questionsAnswered) : 0,
      answered: this._questionsAnswered,
      levelAnswered: this._levelAnswered,
      levelMissed: this._levelMissed
    };
  }
}
