import { CONFIG } from '../core/config.js';

export class ScoringSystem {
  constructor() {
    this.reset();
  }

  reset() {
    this._score = 0;
    this._streak = 0;
    this._bestStreak = 0;
    this._questionsAnswered = 0;
    this._totalReactionTime = 0;
    this._startTime = 0;
  }

  startQuestion() {
    this._startTime = performance.now();
  }

  recordHit() {
    const reactionTime = performance.now() - this._startTime;
    this._questionsAnswered++;
    this._totalReactionTime += reactionTime;
    
    this._streak++;
    if (this._streak > this._bestStreak) {
      this._bestStreak = this._streak;
    }

    // Fast reaction time bonus (e.g. less than 5 seconds is good)
    let timeBonus = 0;
    if (reactionTime < 5000) {
      timeBonus = (5000 - reactionTime) / 5000 * CONFIG.game.baseScore * CONFIG.game.timeBonusFactor;
    }

    const streakBonus = this._streak * CONFIG.game.baseScore * 0.1;
    
    const points = Math.floor(CONFIG.game.baseScore + timeBonus + streakBonus);
    this._score += points;

    return points;
  }

  getStats() {
    return {
      score: this._score,
      streak: this._streak,
      bestStreak: this._bestStreak,
      avgTime: this._questionsAnswered > 0 ? (this._totalReactionTime / this._questionsAnswered) : 0,
      answered: this._questionsAnswered
    };
  }
}
