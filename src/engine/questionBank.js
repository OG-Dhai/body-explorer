import { CONFIG } from '../core/config.js';

export class QuestionBank {
  constructor() {
    this._questions = [];
    this._currentIndex = 0;
  }

  generateRoundForLevel(level, excludeKeys = [], protectedExcludeKeys = []) {
    this._questions = [];
    this._currentIndex = 0;
    
    const difficultyMap = { 1: 'easy', 2: 'normal', 3: 'advanced' };
    const difficulty = difficultyMap[level] || 'easy';
    const questionsPerRound = CONFIG.game.levels[level]?.questionsPerRound || 4;
    
    // Ordered tiers for fallback
    const allTiers = ['advanced', 'normal', 'easy'];
    const currentTierIdx = allTiers.indexOf(difficulty);
    const fallbackTiers = allTiers.slice(currentTierIdx + 1);
    const protectedExclusions = new Set(protectedExcludeKeys);

    let targets = Object.entries(CONFIG.targetMap)
      .filter(([key, data]) => data.difficulty === difficulty
        && !excludeKeys.includes(key)
        && !protectedExclusions.has(key))
      .map(([key]) => key);

    // Fallback 1: Borrow from easier tiers if we are short on targets
    if (targets.length < questionsPerRound) {
      console.warn(
        `[QuestionBank] Tier fallback triggered for ${difficulty}: ` +
        `${targets.length}/${questionsPerRound} visible targets. ` +
        `Borrowing from easier tiers: ${fallbackTiers.join(', ') || 'none'}.`
      );
      for (const tier of fallbackTiers) {
        const fallbackTargets = Object.entries(CONFIG.targetMap)
          .filter(([key, data]) => data.difficulty === tier
            && !excludeKeys.includes(key)
            && !protectedExclusions.has(key))
          .map(([key]) => key);

        for (const key of fallbackTargets) {
          if (!targets.includes(key)) {
            targets.push(key);
          }
          if (targets.length >= questionsPerRound) break;
        }
        if (targets.length >= questionsPerRound) break;
      }
    }

    // Fallback 2: Absolute last resort - re-add excluded targets
    if (targets.length < questionsPerRound) {
      console.error(`[QuestionBank] CRITICAL: Not enough visible targets available. Re-adding excluded targets. Check camera framing!`);
      const allowedTiers = [difficulty, ...fallbackTiers];

      for (const tier of allowedTiers) {
        const excludedTargets = Object.entries(CONFIG.targetMap)
          .filter(([key, data]) => data.difficulty === tier
            && excludeKeys.includes(key)
            && !protectedExclusions.has(key))
          .map(([key]) => key);

        for (const key of excludedTargets) {
          if (!targets.includes(key)) {
            targets.push(key);
          }
          if (targets.length >= questionsPerRound) break;
        }
        if (targets.length >= questionsPerRound) break;
      }
    }

    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }

    const limit = Math.min(questionsPerRound, targets.length);
    for (let i = 0; i < limit; i++) {
      const targetKey = targets[i];
      const targetData = CONFIG.targetMap[targetKey];
      
      this._questions.push({
        id: targetKey,
        indices: targetData.indices,
        instKey: `inst.${targetKey}`,
        eduKey: `edu.${targetKey}`,
        factKey: `fact.${targetKey}`
      });
    }
  }

  next() {
    if (this.isComplete()) return null;
    const question = this._questions[this._currentIndex];
    this._currentIndex++;
    return question;
  }

  getCurrentQuestion() {
    if (this._currentIndex === 0 || this._currentIndex > this._questions.length) return null;
    return this._questions[this._currentIndex - 1];
  }

  getProgress() {
    return {
      current: this._currentIndex,
      total: this._questions.length
    };
  }

  isComplete() {
    return this._currentIndex >= this._questions.length;
  }
}
