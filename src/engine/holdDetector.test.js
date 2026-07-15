import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HoldDetector } from './holdDetector.js';
import eventBus from '../core/eventBus.js';
import { CONFIG } from '../core/config.js';

describe('HoldDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new HoldDetector();
    vi.spyOn(eventBus, 'emit').mockImplementation(() => {});
  });

  it('starts idle', () => {
    expect(detector._fsm.getState()).toBe('idle');
  });

  it('transitions to tracking when distance < threshold', () => {
    const threshold = CONFIG.detection.proximityThreshold;
    detector.update(threshold - 0.1, 16);
    expect(detector._fsm.getState()).toBe('tracking');
  });

  it('transitions to confirmed when hold duration is reached', () => {
    const threshold = CONFIG.detection.proximityThreshold;
    detector.update(threshold - 0.1, 16);
    expect(detector._fsm.getState()).toBe('tracking');
    
    // Simulate time passing beyond hold duration
    detector.update(threshold - 0.1, CONFIG.detection.holdDuration + 100);
    expect(detector._fsm.getState()).toBe('confirmed');
    expect(eventBus.emit).toHaveBeenCalledWith('detection:success', expect.any(Object));
  });

  it('decays when losing confidence', () => {
    const threshold = CONFIG.detection.proximityThreshold;
    detector.update(threshold - 0.1, 16); // tracking
    detector.update(threshold + 0.1, 16); // lose confidence -> decaying
    expect(detector._fsm.getState()).toBe('decaying');
  });

  it('resets correctly', () => {
    const threshold = CONFIG.detection.proximityThreshold;
    detector.update(threshold - 0.1, 16);
    expect(detector._fsm.getState()).toBe('tracking');
    
    detector.reset();
    expect(detector._fsm.getState()).toBe('idle');
    expect(eventBus.emit).toHaveBeenCalledWith('detection:progress', { progress: 0 });
  });
});
