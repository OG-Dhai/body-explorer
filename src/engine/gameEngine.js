import { CONFIG } from '../core/config.js';
import { StateMachine } from '../core/stateMachine.js';
import eventBus from '../core/eventBus.js';
import { evaluateHit } from './hitValidator.js';
import { HoldDetector } from './holdDetector.js';
import { QuestionBank } from './questionBank.js';
import { ScoringSystem } from './scoringSystem.js';
import { VisibilityTracker } from './visibilityTracker.js';

const AMAZING_MOVE_STREAK_INTERVAL = 3;
export const GAME_VOICE_KEYS = Object.freeze({
  hold: 'voice.hold_it',
  timeout: 'voice.timeout',
  levelComplete: 'voice.level_complete',
  levelFailed: 'voice.level_failed',
  gameComplete: 'voice.game_complete',
});

export function selectHitVoiceKey(reactionTime, streak = 0) {
  if (streak > 0 && streak % AMAZING_MOVE_STREAK_INTERVAL === 0) {
    return 'voice.amazing_move';
  }
  if (reactionTime < 3000) return 'voice.lightning';
  if (reactionTime < 6000) return 'voice.great';
  return 'voice.nice';
}

export class GameEngine {
  constructor({ environmentThresholdMultiplier = 1.0 } = {}) {
    this._questionBank = new QuestionBank();
    this._scoring = new ScoringSystem();
    this._holdDetector = new HoldDetector();
    this._visibilityTracker = new VisibilityTracker();
    
    this._currentDistance = null;
    this._dynamicThreshold = CONFIG.detection.hit.baseRadius; // normalized; recalculated every frame
    this._hitRadius = CONFIG.detection.hit.baseRadius;
    this._contactRadius = CONFIG.detection.hit.contactRadius;
    this._lastTime = performance.now();
    this._startingLevel = 1;
    this._currentLevel = this._startingLevel;
    this._maxLevel = 3;
    this._timers = {
      state: { id: null, callback: null, deadline: 0, remainingMs: 0 },
      question: { id: null, callback: null, deadline: 0, remainingMs: 0 },
    };
    this._paused = false;
    this._disposed = false;
    this._instructionReadyPending = false;
    this._hitRadiusScale = 1.0; // per-level scale on the hit radius (set in LEVEL_INTRO)
    this._wrongPartMs = 0;
    this._lastWrongPartId = null;
    this._environmentThresholdMultiplier = this._sanitizeThresholdMultiplier(environmentThresholdMultiplier);
    this._lastLevelPassed = false;
    this._lastLevelTargetKey = null;
    this._holdVoicePrompted = false;

    this._fsm = new StateMachine({
      id: 'game-engine',
      states: ['IDLE', 'LEVEL_INTRO', 'INSTRUCTION', 'DETECTING', 'TIMEOUT', 'FEEDBACK', 'LEVEL_END', 'COMPLETE'],
      initialState: 'IDLE',
      transitions: {
        IDLE:        { START: 'LEVEL_INTRO' },
        LEVEL_INTRO: { BEGIN: 'INSTRUCTION' },
        INSTRUCTION: { READY: 'DETECTING', FINISH: 'LEVEL_END' },
        DETECTING:   { HIT: 'FEEDBACK', TIMEOUT: 'TIMEOUT' },
        TIMEOUT:     { NEXT: 'INSTRUCTION', FINISH: 'LEVEL_END' },
        FEEDBACK:    { NEXT: 'INSTRUCTION', FINISH: 'LEVEL_END' },
        LEVEL_END:   { NEXT_LEVEL: 'LEVEL_INTRO', GAME_OVER: 'COMPLETE' },
        COMPLETE:    { RESTART: 'IDLE' }
      },
      onEnter: {
        IDLE: () => {
          this._clearAllTimers();
          this._paused = false;
          this._instructionReadyPending = false;
          this._scoring.reset();
          this._currentLevel = this._startingLevel;
          this._lastLevelPassed = false;
          this._lastLevelTargetKey = null;
          eventBus.emit('game:stateChange', { state: 'idle' });
        },
        LEVEL_INTRO: () => {
          const levelParams = CONFIG.game.levels[this._currentLevel];
          this._holdDetector.setHoldDuration(levelParams.holdDuration);
          this._hitRadiusScale = levelParams.hitRadiusScale;

          const generateRound = () => {
            if (!this._fsm.is('LEVEL_INTRO')) return;

            const excludeKeys = [];
            for (const [key, data] of Object.entries(CONFIG.targetMap)) {
              const avgVis = this._visibilityTracker.getAverageVisibility(
                data.indices,
                CONFIG.detection.visibilityAverageWindowFrames
              );
              if (avgVis < CONFIG.detection.visibilityExclusionThreshold) {
                excludeKeys.push(key);
                console.warn(`[GameEngine] Excluded target due to low visibility: ${key} (${avgVis.toFixed(2)})`);
              }
            }

            const boundaryExcludeKeys = this._lastLevelTargetKey
              ? [this._lastLevelTargetKey]
              : [];
            this._questionBank.generateRoundForLevel(
              this._currentLevel,
              excludeKeys,
              boundaryExcludeKeys
            );
            this._scoring.resetLevel();

            eventBus.emit('level:start', { level: this._currentLevel, params: levelParams });

            this._scheduleTimer('state', () => {
              if (this._fsm.is('LEVEL_INTRO')) {
                this._fsm.transition('BEGIN');
              }
            }, CONFIG.game.timing.levelIntroDurationMs);
          };

          if (this._visibilityTracker.history.length < CONFIG.detection.visibilityColdStartFrames) {
            console.warn('[GameEngine] Cold start: delaying round generation 500ms to accumulate visibility history.');
            this._scheduleTimer('state', generateRound, CONFIG.detection.visibilityColdStartDelayMs);
          } else {
            generateRound();
          }
        },
        INSTRUCTION: () => {
          const question = this._questionBank.next();
          if (!question) {
            this._fsm.transition('FINISH');
            return;
          }
          
          this._holdDetector.reset();
          this._holdVoicePrompted = false;
          this._wrongPartMs = 0;
          this._lastWrongPartId = null;

          eventBus.emit('game:newQuestion', {
            question,
            progress: this._questionBank.getProgress(),
            stats: this._scoring.getStats()
          });

          // We move to DETECTING once 'audio:ttsComplete' fires. This timer is
          // the fallback: if TTS fails or hangs, start anyway after ~5s.
          this._scheduleInstructionSafetyTimer();
        },
        DETECTING: () => {
          // Reaction time begins only after narration has finished.
          this._lastTime = performance.now();
          this._scoring.startQuestion(this._lastTime);
          eventBus.emit('game:stateChange', { state: 'playing' });

          const timeoutMs = CONFIG.game.levels[this._currentLevel].questionTimeout;
          this._scheduleTimer('question', () => {
            if (this._fsm.is('DETECTING')) {
              this._fsm.transition('TIMEOUT');
            }
          }, timeoutMs);
        },
        TIMEOUT: () => {
          this._clearTimer('question');
          this._scoring.recordMiss();

          eventBus.emit('game:miss', {
            stats: this._scoring.getStats()
          });
          eventBus.emit('game:voiceFeedback', { key: GAME_VOICE_KEYS.timeout });

          this._scheduleTimer('state', () => {
            if (this._questionBank.isComplete()) {
              this._fsm.transition('FINISH');
            } else {
              this._fsm.transition('NEXT');
            }
          }, CONFIG.game.timing.feedbackReadDurationMs);
        },
        FEEDBACK: () => {
          this._clearTimer('question');
          const points = this._scoring.recordHit();
          const stats = this._scoring.getStats();
          const reactionTime = stats.lastReactionTime;
          const voiceKey = selectHitVoiceKey(reactionTime, stats.streak);
          const question = this._questionBank.getCurrentQuestion();

          // Fact narration normally advances the round. This timer is the
          // bounded fallback for muted, unavailable, or interrupted playback.
          this._scheduleFactSafetyTimer();

          eventBus.emit('game:hit', {
            points,
            stats,
            reactionTime,
            voiceKey,
            question,
            factKey: question?.factKey,
          });
        },
        LEVEL_END: () => {
          this._lastLevelTargetKey = this._questionBank.getCurrentQuestion()?.id || null;
          const stats = this._scoring.getStats();
          const levelParams = CONFIG.game.levels[this._currentLevel];
          const passThreshold = Math.ceil(levelParams.questionsPerRound * CONFIG.game.passThreshold);

          let passed = stats.levelAnswered >= passThreshold;

          // Check combo requirement
          if (passed && levelParams.comboRequirement > 0) {
             if (stats.levelBestStreak < levelParams.comboRequirement) {
               passed = false;
             }
          }
          this._lastLevelPassed = passed;

          eventBus.emit('level:complete', {
            level: this._currentLevel,
            passed,
            stats,
            levelParams
          });
          eventBus.emit('game:voiceFeedback', {
            key: passed ? GAME_VOICE_KEYS.levelComplete : GAME_VOICE_KEYS.levelFailed,
          });

          this._scheduleTimer('state', () => {
            if (!this._fsm.is('LEVEL_END')) return;
            if (passed && this._currentLevel < this._maxLevel) {
              this._currentLevel++;
              eventBus.emit('level:unlocked', { level: this._currentLevel });
              this._fsm.transition('NEXT_LEVEL');
            } else {
              this._fsm.transition('GAME_OVER');
            }
          }, CONFIG.game.timing.levelEndReadDurationMs);
        },
        COMPLETE: () => {
          const allLevelsPassed = this._currentLevel === this._maxLevel && this._lastLevelPassed;
          eventBus.emit('game:complete', {
            stats: this._scoring.getStats(),
            levelsCompleted: this._currentLevel,
            allLevelsPassed,
          });
          if (allLevelsPassed) {
            eventBus.emit('game:voiceFeedback', { key: GAME_VOICE_KEYS.gameComplete });
          }
        }
      }
    });

    // Named references allow dispose() to detach this engine cleanly.
    this._onDetectionSuccess = (payload) => {
      if (!this._disposed && !this._paused && this._fsm.is('DETECTING')) {
        this._fsm.transition('HIT', payload);
      }
    };

    this._onTtsComplete = () => {
      if (this._disposed || !this._fsm.is('INSTRUCTION')) return;
      this._clearTimer('state');
      if (this._paused) {
        this._instructionReadyPending = true;
      } else {
        this._fsm.transition('READY');
      }
    };

    this._onFactComplete = ({ question } = {}) => {
      if (this._disposed || this._paused || !this._fsm.is('FEEDBACK')) return;
      if (!question || question !== this._questionBank.getCurrentQuestion()) return;
      this._advanceAfterFeedback();
    };

    this._onFactReplay = ({ question } = {}) => {
      if (this._disposed || this._paused || !this._fsm.is('FEEDBACK')) return;
      if (!question || question !== this._questionBank.getCurrentQuestion()) return;
      this._scheduleFactSafetyTimer();
    };

    this._onDetectionProgress = ({ progress } = {}) => {
      if (!this._disposed && !this._paused && this._fsm.is('DETECTING')
        && progress > 0 && !this._holdVoicePrompted) {
        this._holdVoicePrompted = true;
        eventBus.emit('game:voiceFeedback', { key: GAME_VOICE_KEYS.hold });
      }
    };

    eventBus.on('detection:success', this._onDetectionSuccess);
    eventBus.on('audio:ttsComplete', this._onTtsComplete);
    eventBus.on('audio:factComplete', this._onFactComplete);
    eventBus.on('game:replayFact', this._onFactReplay);
    eventBus.on('detection:progress', this._onDetectionProgress);
  }

  get currentDistance() {
    return this._currentDistance;
  }

  get dynamicThreshold() {
    return this._dynamicThreshold;
  }

  get environmentThresholdMultiplier() {
    return this._environmentThresholdMultiplier;
  }

  get currentLevel() {
    return this._currentLevel;
  }

  get currentState() {
    return this._fsm.getState();
  }

  get currentQuestion() {
    return this._questionBank.getCurrentQuestion();
  }

  get isPaused() {
    return this._paused;
  }

  get isDisposed() {
    return this._disposed;
  }

  _scheduleTimer(name, callback, delayMs) {
    const timer = this._timers[name];
    if (!timer) throw new Error(`[GameEngine] Unknown timer slot: ${name}`);

    this._clearTimer(name);
    timer.callback = callback;
    timer.remainingMs = Math.max(0, Number(delayMs) || 0);
    this._armTimer(name);
  }

  _armTimer(name) {
    const timer = this._timers[name];
    if (this._paused || this._disposed || !timer.callback || timer.id !== null) return;

    timer.deadline = performance.now() + timer.remainingMs;
    timer.id = setTimeout(() => {
      timer.id = null;
      timer.deadline = 0;
      timer.remainingMs = 0;
      const callback = timer.callback;
      timer.callback = null;

      if (!callback || this._disposed) return;
      if (this._paused) {
        timer.callback = callback;
        return;
      }
      callback();
    }, timer.remainingMs);
  }

  _pauseTimer(name, now = performance.now()) {
    const timer = this._timers[name];
    if (timer.id === null) return;
    clearTimeout(timer.id);
    timer.id = null;
    timer.remainingMs = Math.max(0, timer.deadline - now);
    timer.deadline = 0;
  }

  _clearTimer(name) {
    const timer = this._timers[name];
    if (!timer) return;
    if (timer.id !== null) clearTimeout(timer.id);
    timer.id = null;
    timer.callback = null;
    timer.deadline = 0;
    timer.remainingMs = 0;
  }

  _clearAllTimers() {
    this._clearTimer('state');
    this._clearTimer('question');
  }

  _getRemainingMs(name, now = performance.now()) {
    const timer = this._timers[name];
    if (!timer) return 0;
    return timer.id !== null
      ? Math.max(0, timer.deadline - now)
      : Math.max(0, timer.remainingMs);
  }

  _scheduleInstructionSafetyTimer() {
    this._scheduleTimer('state', () => {
      if (this._fsm.is('INSTRUCTION')) {
        console.warn('[GameEngine] Safety fallback: TTS timed out, forcing DETECTING transition');
        this._fsm.transition('READY');
      }
    }, CONFIG.game.timing.instructionSafetyTimeoutMs);
  }

  _scheduleFactSafetyTimer() {
    this._scheduleTimer('state', () => {
      if (!this._fsm.is('FEEDBACK')) return;
      console.warn('[GameEngine] Fact narration timed out; advancing safely.');
      this._advanceAfterFeedback();
    }, CONFIG.game.timing.factSafetyTimeoutMs);
  }

  _advanceAfterFeedback() {
    if (!this._fsm.is('FEEDBACK')) return;
    this._clearTimer('state');
    if (this._questionBank.isComplete()) {
      this._fsm.transition('FINISH');
    } else {
      this._fsm.transition('NEXT');
    }
  }

  pause() {
    if (this._disposed || this._paused || this._fsm.is('IDLE') || this._fsm.is('COMPLETE')) {
      return false;
    }

    const now = performance.now();
    this._paused = true;
    this._pauseTimer('state', now);
    this._pauseTimer('question', now);
    if (this._fsm.is('DETECTING')) this._scoring.pauseQuestion(now);

    eventBus.emit('game:pauseChange', {
      paused: true,
      state: this._fsm.getState(),
      questionRemainingMs: this._getRemainingMs('question', now),
    });
    return true;
  }

  resume({ replayInstruction = true } = {}) {
    if (this._disposed || !this._paused) return false;

    const now = performance.now();
    this._paused = false;
    this._lastTime = now;

    if (this._fsm.is('DETECTING')) {
      this._scoring.resumeQuestion(now);
    }

    if (this._fsm.is('INSTRUCTION') && replayInstruction) {
      this._instructionReadyPending = false;
      this._clearTimer('state');
      this._scheduleInstructionSafetyTimer();
      eventBus.emit('game:replayQuestion', {
        question: this._questionBank.getCurrentQuestion(),
        progress: this._questionBank.getProgress(),
        stats: this._scoring.getStats(),
      });
    } else if (this._fsm.is('INSTRUCTION') && this._instructionReadyPending) {
      this._instructionReadyPending = false;
      this._clearTimer('state');
      this._fsm.transition('READY');
    } else if (this._fsm.is('FEEDBACK')) {
      eventBus.emit('game:replayFact', {
        question: this._questionBank.getCurrentQuestion(),
      });
    } else {
      this._armTimer('state');
      this._armTimer('question');
    }

    eventBus.emit('game:pauseChange', {
      paused: false,
      state: this._fsm.getState(),
      questionRemainingMs: this._getRemainingMs('question', now),
    });
    return true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._paused = false;
    this._instructionReadyPending = false;
    this._clearAllTimers();
    this._holdDetector.reset();

    eventBus.off('detection:success', this._onDetectionSuccess);
    eventBus.off('audio:ttsComplete', this._onTtsComplete);
    eventBus.off('audio:factComplete', this._onFactComplete);
    eventBus.off('game:replayFact', this._onFactReplay);
    eventBus.off('detection:progress', this._onDetectionProgress);
  }

  _sanitizeThresholdMultiplier(multiplier) {
    const numericMultiplier = Number(multiplier);
    return Number.isFinite(numericMultiplier) && numericMultiplier > 0 ? numericMultiplier : 1.0;
  }

  setEnvironmentThresholdMultiplier(multiplier) {
    this._environmentThresholdMultiplier = this._sanitizeThresholdMultiplier(multiplier);
  }

  _sanitizeStartingLevel(level) {
    const numericLevel = Number(level);
    return Number.isInteger(numericLevel) && CONFIG.game.levels[numericLevel]
      ? numericLevel
      : 1;
  }

  start(startingLevel = this._startingLevel) {
    if (this._disposed) return false;
    if (this._fsm.is('COMPLETE')) {
      this._fsm.transition('RESTART');
    }

    if (!this._fsm.is('IDLE')) return false;

    this._startingLevel = this._sanitizeStartingLevel(startingLevel);
    this._currentLevel = this._startingLevel;
    this._fsm.transition('START');
    return true;
  }

  debugClearTimers() {
    this._clearAllTimers();
  }

  debugForceLevelEnd() {
    if (this._disposed) return;
    this._clearAllTimers();
    this._fsm._currentState = 'LEVEL_END';

    if (this._fsm._onEnter && typeof this._fsm._onEnter['LEVEL_END'] === 'function') {
      this._fsm._onEnter['LEVEL_END'].call(this);
    } else {
      console.error('[Debug] FAILED to find onEnter callback for LEVEL_END. Is the FSM defined correctly?');
    }
  }

  /**
   * @param {{ pose: Array|null, hands: Array, face: Array|null }} frame
   *   Per-frame recognition snapshot: pose image landmarks (targets + visibility),
   *   detected hands (fingertips), and face landmarks when a face target is active.
   */
  update(frame) {
    if (this._paused || this._disposed) return;
    this._visibilityTracker.update(frame?.pose ?? null);

    if (!this._fsm.is('DETECTING')) {
      return;
    }

    // Body-normalized hit radius, scaled by level difficulty and (a little) by
    // low light. Both radii are fractions of shoulder width.
    const hitCfg = CONFIG.detection.hit;
    const radiusScale = this._hitRadiusScale
      * (this._environmentThresholdMultiplier > 1.0 ? hitCfg.lowLightRadiusScale : 1.0);
    this._hitRadius = hitCfg.baseRadius * radiusScale;
    this._contactRadius = hitCfg.contactRadius * radiusScale;
    this._dynamicThreshold = this._hitRadius;

    const now = performance.now();
    const dt = now - this._lastTime;
    this._lastTime = now;

    const question = this._questionBank.getCurrentQuestion();
    if (!question) return;

    const result = evaluateHit(frame ?? {}, question, CONFIG.targetMap, hitCfg);
    this._currentDistance = result.score;

    // Gently correct a hand that is clearly parked on the wrong part.
    this._updateWrongPartFeedback(result, question, dt);

    // Only feed proximity to the hold timer when the asked part is genuinely the
    // nearest part and a real hand is doing the touching; otherwise the hold
    // decays. The contact radius then blocks a hover that never actually lands.
    const eligible = result.handVisible && result.isAskedNearest && result.score !== null;
    const feedDistance = eligible ? result.score : null;
    this._holdDetector.update(feedDistance, dt, this._hitRadius, this._contactRadius);
  }

  /**
   * Emit a one-shot `detection:wrongPart` when the hand has sat on a clearly
   * different part long enough. Non-punishing: no score or state change here.
   */
  _updateWrongPartFeedback(result, question, dt) {
    const cfg = CONFIG.detection.hit;
    const onWrongPart = !result.isAskedNearest
      && result.nearestScore !== null
      && result.nearestScore < this._hitRadius;

    if (!onWrongPart) {
      this._wrongPartMs = 0;
      this._lastWrongPartId = null;
      return;
    }

    this._wrongPartMs += dt;
    if (this._wrongPartMs >= cfg.wrongPartHoldMs
      && this._lastWrongPartId !== result.nearestPartId) {
      this._lastWrongPartId = result.nearestPartId;
      eventBus.emit('detection:wrongPart', {
        askedId: question.id,
        touchedId: result.nearestPartId,
      });
    }
  }
}
