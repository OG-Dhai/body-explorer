import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONFIG } from '../core/config.js';
import eventBus from '../core/eventBus.js';
import { GameEngine, GAME_VOICE_KEYS, selectHitVoiceKey } from './gameEngine.js';

const engines = [];

function createEngine() {
  const engine = new GameEngine();
  engines.push(engine);
  return engine;
}

function startFirstQuestion(engine) {
  engine.start(1);
  vi.advanceTimersByTime(
    CONFIG.detection.visibilityColdStartDelayMs +
    CONFIG.game.timing.levelIntroDurationMs
  );
  expect(engine.currentState).toBe('INSTRUCTION');
  const question = engine.currentQuestion;
  eventBus.emit('audio:ttsComplete');
  expect(engine.currentState).toBe('DETECTING');
  return question;
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GameEngine spoken hit feedback', () => {
  it('maps real reaction-time boundaries to the matching voice key', () => {
    expect(selectHitVoiceKey(2999, 1)).toBe('voice.lightning');
    expect(selectHitVoiceKey(3000, 1)).toBe('voice.great');
    expect(selectHitVoiceKey(5999, 1)).toBe('voice.great');
    expect(selectHitVoiceKey(6000, 1)).toBe('voice.nice');
  });

  it('uses amazing_move for each third-answer streak milestone', () => {
    expect(selectHitVoiceKey(4500, 3)).toBe('voice.amazing_move');
    expect(selectHitVoiceKey(7000, 6)).toBe('voice.amazing_move');
  });

  it('covers every non-hit gameplay outcome voice key', () => {
    expect(Object.values(GAME_VOICE_KEYS)).toEqual([
      'voice.hold_it',
      'voice.timeout',
      'voice.level_complete',
      'voice.level_failed',
      'voice.game_complete',
    ]);
  });
});

describe('GameEngine fact feedback lifecycle', () => {
  it('shows fact feedback without speaking a praise line and advances on matching audio completion', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createEngine();
    const onHit = vi.fn();
    const onVoiceFeedback = vi.fn();
    eventBus.on('game:hit', onHit);
    eventBus.on('game:voiceFeedback', onVoiceFeedback);

    try {
      const question = startFirstQuestion(engine);
      eventBus.emit('detection:success', {});

      expect(engine.currentState).toBe('FEEDBACK');
      expect(onHit).toHaveBeenCalledWith(expect.objectContaining({
        question,
        factKey: question.factKey,
        voiceKey: expect.stringMatching(/^voice\./),
      }));
      expect(onVoiceFeedback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(CONFIG.game.timing.feedbackReadDurationMs);
      expect(engine.currentState).toBe('FEEDBACK');

      eventBus.emit('audio:factComplete', { question });
      expect(engine.currentState).toBe('INSTRUCTION');
    } finally {
      eventBus.off('game:hit', onHit);
      eventBus.off('game:voiceFeedback', onVoiceFeedback);
    }
  });

  it('ignores stale fact completion and advances at the six-second safety boundary', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createEngine();
    const question = startFirstQuestion(engine);
    eventBus.emit('detection:success', {});

    eventBus.emit('audio:factComplete', { question: { ...question } });
    expect(engine.currentState).toBe('FEEDBACK');

    vi.advanceTimersByTime(CONFIG.game.timing.factSafetyTimeoutMs - 1);
    expect(engine.currentState).toBe('FEEDBACK');
    vi.advanceTimersByTime(1);

    expect(engine.currentState).toBe('INSTRUCTION');
    expect(warn).toHaveBeenCalledWith(
      '[GameEngine] Fact narration timed out; advancing safely.'
    );
  });

  it('restarts the full safety window when a locale change replays the fact', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createEngine();
    const question = startFirstQuestion(engine);
    eventBus.emit('detection:success', {});

    vi.advanceTimersByTime(CONFIG.game.timing.factSafetyTimeoutMs - 100);
    eventBus.emit('game:replayFact', { question });

    vi.advanceTimersByTime(CONFIG.game.timing.factSafetyTimeoutMs - 1);
    expect(engine.currentState).toBe('FEEDBACK');
    vi.advanceTimersByTime(1);
    expect(engine.currentState).toBe('INSTRUCTION');
  });

  it('replays an interrupted fact with a fresh safety window after resume', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createEngine();
    const question = startFirstQuestion(engine);
    const onReplay = vi.fn();
    eventBus.on('game:replayFact', onReplay);

    try {
      eventBus.emit('detection:success', {});
      vi.advanceTimersByTime(CONFIG.game.timing.factSafetyTimeoutMs - 100);
      expect(engine.pause()).toBe(true);
      vi.advanceTimersByTime(10_000);
      expect(engine.currentState).toBe('FEEDBACK');

      expect(engine.resume()).toBe(true);
      expect(onReplay).toHaveBeenCalledWith({ question });
      vi.advanceTimersByTime(CONFIG.game.timing.factSafetyTimeoutMs - 1);
      expect(engine.currentState).toBe('FEEDBACK');
      vi.advanceTimersByTime(1);
      expect(engine.currentState).toBe('INSTRUCTION');
    } finally {
      eventBus.off('game:replayFact', onReplay);
    }
  });
});

describe('GameEngine pause/resume/dispose lifecycle', () => {
  it('passes the final target as a protected exclusion for the next level', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const engine = createEngine();
    const generateRound = vi.spyOn(engine._questionBank, 'generateRoundForLevel');

    engine.start(1);
    vi.advanceTimersByTime(2_500);

    for (let answered = 0; answered < CONFIG.game.levels[1].questionsPerRound; answered++) {
      expect(engine.currentState).toBe('INSTRUCTION');
      eventBus.emit('audio:ttsComplete');
      eventBus.emit('detection:success', {});
      expect(engine.currentState).toBe('FEEDBACK');
      eventBus.emit('audio:factComplete', { question: engine.currentQuestion });
    }

    expect(engine.currentState).toBe('LEVEL_END');
    const previousTargetKey = engine.currentQuestion.id;
    expect(engine._lastLevelTargetKey).toBe(previousTargetKey);

    vi.advanceTimersByTime(
      CONFIG.game.timing.levelEndReadDurationMs +
      CONFIG.detection.visibilityColdStartDelayMs
    );

    expect(generateRound).toHaveBeenCalledTimes(2);
    expect(generateRound.mock.calls[1][2]).toEqual([previousTargetKey]);
  });

  it('freezes the tracked cold-start timer and resumes with its exact remainder', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createEngine();
    const onLevelStart = vi.fn();
    eventBus.on('level:start', onLevelStart);

    engine.start(1);
    vi.advanceTimersByTime(200);
    expect(engine.currentState).toBe('LEVEL_INTRO');
    expect(engine.pause()).toBe(true);

    vi.advanceTimersByTime(10_000);
    expect(onLevelStart).not.toHaveBeenCalled();
    expect(engine.currentState).toBe('LEVEL_INTRO');

    expect(engine.resume({ replayInstruction: false })).toBe(true);
    vi.advanceTimersByTime(299);
    expect(onLevelStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLevelStart).toHaveBeenCalledOnce();

    eventBus.off('level:start', onLevelStart);
  });

  it('replays an interrupted instruction without advancing the round', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createEngine();
    const onReplay = vi.fn();
    eventBus.on('game:replayQuestion', onReplay);

    engine.start(1);
    vi.advanceTimersByTime(2_500);
    expect(engine.currentState).toBe('INSTRUCTION');
    const interruptedQuestion = engine.currentQuestion;

    engine.pause();
    eventBus.emit('audio:ttsComplete');
    expect(engine.currentState).toBe('INSTRUCTION');

    engine.resume();
    expect(engine.currentState).toBe('INSTRUCTION');
    expect(engine.currentQuestion).toBe(interruptedQuestion);
    expect(onReplay).toHaveBeenCalledOnce();
    expect(onReplay.mock.calls[0][0].question).toBe(interruptedQuestion);

    eventBus.emit('audio:ttsComplete');
    expect(engine.currentState).toBe('DETECTING');
    eventBus.off('game:replayQuestion', onReplay);
  });

  it('removes named listeners and cancels every timer on idempotent disposal', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createEngine();
    const onLevelStart = vi.fn();
    eventBus.on('level:start', onLevelStart);
    engine.start(1);

    expect(eventBus._listeners.get('detection:success')).toContain(engine._onDetectionSuccess);
    expect(eventBus._listeners.get('audio:ttsComplete')).toContain(engine._onTtsComplete);
    expect(eventBus._listeners.get('audio:factComplete')).toContain(engine._onFactComplete);
    expect(eventBus._listeners.get('game:replayFact')).toContain(engine._onFactReplay);
    expect(eventBus._listeners.get('detection:progress')).toContain(engine._onDetectionProgress);

    engine.dispose();
    engine.dispose();
    vi.advanceTimersByTime(20_000);

    expect(onLevelStart).not.toHaveBeenCalled();
    expect(eventBus._listeners.get('detection:success')).not.toContain(engine._onDetectionSuccess);
    expect(eventBus._listeners.get('audio:ttsComplete')).not.toContain(engine._onTtsComplete);
    expect(eventBus._listeners.get('audio:factComplete')).not.toContain(engine._onFactComplete);
    expect(eventBus._listeners.get('game:replayFact')).not.toContain(engine._onFactReplay);
    expect(eventBus._listeners.get('detection:progress')).not.toContain(engine._onDetectionProgress);
    eventBus.off('level:start', onLevelStart);
  });

  it('ignores landmark updates while paused and avoids a resume delta jump', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    engine._fsm._currentState = 'DETECTING';
    engine._scoring.startQuestion(performance.now());
    const visibilityUpdate = vi.spyOn(engine._visibilityTracker, 'update');
    const holdUpdate = vi.spyOn(engine._holdDetector, 'update');

    engine.pause();
    vi.advanceTimersByTime(8_000);
    engine.update(Array(33).fill({ x: 0, y: 0, z: 0, visibility: 1 }));
    expect(visibilityUpdate).not.toHaveBeenCalled();
    expect(holdUpdate).not.toHaveBeenCalled();

    engine.resume({ replayInstruction: false });
    const resumedAt = engine._lastTime;
    expect(resumedAt).toBe(performance.now());
  });
});
