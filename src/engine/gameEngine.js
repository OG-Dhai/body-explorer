import { CONFIG } from '../core/config.js';
import { StateMachine } from '../core/stateMachine.js';
import eventBus from '../core/eventBus.js';
import { computeDistance, computeDynamicThreshold } from '../math/spatialMath.js';
import { HoldDetector } from './holdDetector.js';
import { QuestionBank } from './questionBank.js';
import { ScoringSystem } from './scoringSystem.js';

const HAND_JOINTS = [15, 16, 19, 20]; // Wrists and index fingers

export class GameEngine {
  constructor() {
    this._questionBank = new QuestionBank();
    this._scoring = new ScoringSystem();
    this._holdDetector = new HoldDetector();
    
    this._currentDistance = null;
    this._dynamicThreshold = 0.30; // Will be recalculated every frame
    this._lastTime = performance.now();

    this._fsm = new StateMachine({
      id: 'game-engine',
      states: ['IDLE', 'INSTRUCTION', 'DETECTING', 'FEEDBACK', 'COMPLETE'],
      initialState: 'IDLE',
      transitions: {
        IDLE:        { START: 'INSTRUCTION' },
        INSTRUCTION: { READY: 'DETECTING' },
        DETECTING:   { HIT: 'FEEDBACK' }, // Removed TIMEOUT
        FEEDBACK:    { NEXT: 'INSTRUCTION', FINISH: 'COMPLETE' },
        COMPLETE:    { RESTART: 'IDLE' }
      },
      onEnter: {
        IDLE: () => {
          this._scoring.reset();
          eventBus.emit('game:stateChange', { state: 'idle' });
        },
        INSTRUCTION: () => {
          const question = this._questionBank.next();
          if (!question) {
            this._fsm.transition('FINISH');
            return;
          }
          
          this._scoring.startQuestion();
          this._holdDetector.reset();
          
          eventBus.emit('game:newQuestion', {
            question,
            progress: this._questionBank.getProgress(),
            stats: this._scoring.getStats()
          });

          // Wait a short delay before allowing detection
          setTimeout(() => {
            if (this._fsm.is('INSTRUCTION')) {
              this._fsm.transition('READY');
            }
          }, CONFIG.game.instructionDelay);
        },
        DETECTING: () => {
          eventBus.emit('game:stateChange', { state: 'playing' });
        },
        FEEDBACK: (payload) => {
          // payload contains holdTime from HoldDetector
          const points = this._scoring.recordHit();
          
          eventBus.emit('game:hit', {
            points,
            stats: this._scoring.getStats(),
            reactionTime: payload.holdTime
          });

          // Wait for feedback duration then next
          setTimeout(() => {
            if (this._questionBank.isComplete()) {
              this._fsm.transition('FINISH');
            } else {
              this._fsm.transition('NEXT');
            }
          }, 2000); // 2 second feedback delay
        },
        COMPLETE: () => {
          eventBus.emit('game:complete', {
            stats: this._scoring.getStats()
          });
        }
      }
    });

    // Listen to hold detector
    eventBus.on('detection:success', (payload) => {
      if (this._fsm.is('DETECTING')) {
        this._fsm.transition('HIT', payload);
      }
    });
  }

  start() {
    if (this._fsm.is('IDLE') || this._fsm.is('COMPLETE')) {
      if (this._fsm.is('COMPLETE')) {
        this._fsm.transition('RESTART');
      }
      this._questionBank.generateRound();
      this._fsm.transition('START');
    }
  }

  /** @param {Array} worldLandmarks */
  update(worldLandmarks) {
    if (!this._fsm.is('DETECTING')) {
      return;
    }
    
    if (!worldLandmarks || worldLandmarks.length < 33) {
      this._holdDetector.update(null, 16, this._dynamicThreshold);
      return;
    }

    const now = performance.now();
    const dt = now - this._lastTime;
    this._lastTime = now;

    // Compute body-size-adaptive threshold from real-time shoulder width
    this._dynamicThreshold = computeDynamicThreshold(worldLandmarks);

    const question = this._questionBank.getCurrentQuestion();
    if (!question) return;

    const targetJoints = question.indices;
    let minDistance = Infinity;

    for (const handId of HAND_JOINTS) {
      const handLm = worldLandmarks[handId];
      if (!handLm) continue;

      for (const targetId of targetJoints) {
        const targetLm = worldLandmarks[targetId];
        if (!targetLm) continue;

        const dist = computeDistance(handLm, targetLm);
        if (dist < minDistance) {
          minDistance = dist;
        }
      }
    }

    this._currentDistance = minDistance === Infinity ? null : minDistance;
    this._holdDetector.update(this._currentDistance, dt, this._dynamicThreshold);
  }
}
