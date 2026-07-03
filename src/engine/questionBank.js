import { CONFIG } from '../core/config.js';

export class QuestionBank {
  constructor() {
    this._questions = [];
    this._currentIndex = 0;
  }

  generateRound() {
    this._questions = [];
    this._currentIndex = 0;
    
    // Get all targets
    const targets = Object.keys(CONFIG.targetMap);
    
    // Shuffle targets
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }

    // Take the first N questions
    const limit = Math.min(CONFIG.game.questionsPerRound, targets.length);
    for (let i = 0; i < limit; i++) {
      const targetKey = targets[i];
      const targetData = CONFIG.targetMap[targetKey];
      
      this._questions.push({
        id: targetKey,
        indices: targetData.indices,
        instKey: `inst.${targetKey}`,
        eduKey: `edu.${targetKey}`
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
