import { CONFIG } from '../core/config.js';
import { StateMachine } from '../core/stateMachine.js';
import eventBus from '../core/eventBus.js';
import { clamp } from '../math/spatialMath.js';

export class HoldDetector {
  constructor() {
    this._holdDuration = CONFIG.detection.holdDuration;
    this._decayRate = CONFIG.detection.decayRate;
    this._threshold = CONFIG.detection.proximityThreshold;
    this._elapsed = 0;
    // Closest distance seen during the current track, used for the anti-hover
    // (genuine-contact) gate: a hold only confirms if the hand actually dipped
    // inside the contact radius, not merely lingered in the outer zone.
    this._minSeen = Infinity;
    
    this._fsm = new StateMachine({
      id: 'hold-detector',
      states: ['idle', 'tracking', 'decaying', 'confirmed'],
      initialState: 'idle',
      transitions: {
        idle:      { START_TRACKING: 'tracking' },
        tracking:  { LOSE_CONFIDENCE: 'decaying', CONFIRM: 'confirmed', CANCEL: 'idle' },
        decaying:  { REGAIN: 'tracking', TIMEOUT: 'idle', CANCEL: 'idle' },
        confirmed: { RESET: 'idle' }
      },
      onEnter: {
        idle: () => {
          this._minSeen = Infinity;
          if (this._elapsed > 0) {
            this._elapsed = 0;
            eventBus.emit('detection:progress', { progress: 0 });
          }
        },
        confirmed: () => {
          eventBus.emit('detection:success', { holdTime: this._elapsed });
        }
      }
    });
  }

  /**
   * Update the hold detector based on distance.
   * @param {number|null} distance: proximity to the asked part (body-normalized)
   * @param {number} deltaTime: milliseconds since last update
   * @param {number} [dynamicThreshold]: outer proximity zone; hold accumulates inside it
   * @param {number} [contactRadius]: inner zone the hand must reach at least once
   *   for a genuine touch. Defaults to the outer threshold (no extra gate), which
   *   preserves the original behaviour for callers that pass three arguments.
   */
  update(distance, deltaTime, dynamicThreshold, contactRadius) {
    const threshold = dynamicThreshold ?? this._threshold;
    const contact = contactRadius ?? threshold;

    // Normalize distance against threshold (closer = higher confidence, >= threshold = 0)
    let confidence = 0;
    if (distance !== null && distance < threshold) {
      confidence = 1 - (distance / threshold);
    }
    const above = confidence > 0;

    switch (this._fsm.getState()) {
      case 'idle':
        if (above) {
          this._elapsed = 0;
          this._minSeen = distance;
          this._fsm.transition('START_TRACKING');
        }
        break;

      case 'tracking':
        if (!above) {
          this._fsm.transition('LOSE_CONFIDENCE');
          break;
        }
        this._elapsed += deltaTime;
        if (distance !== null && distance < this._minSeen) this._minSeen = distance;
        eventBus.emit('detection:progress', { progress: this.getProgress() });

        // Confirm only after a genuine contact (closest approach inside the
        // contact radius), so a steady hover never wins.
        if (this._elapsed >= this._holdDuration && this._minSeen <= contact) {
          this._fsm.transition('CONFIRM');
        }
        break;
      
      case 'decaying':
        this._elapsed *= Math.pow(this._decayRate, deltaTime / 16.67);
        eventBus.emit('detection:progress', { progress: this.getProgress() });
        
        if (above) {
          this._fsm.transition('REGAIN');
          break;
        }
        if (this._elapsed < 10) {
          this._fsm.transition('TIMEOUT');
        }
        break;
        
      case 'confirmed':
        break;
    }
  }

  reset() {
    const state = this._fsm.getState();
    if (state === 'confirmed') {
      this._fsm.transition('RESET');
    } else if (state === 'tracking' || state === 'decaying') {
      this._fsm.transition('CANCEL');
    }
    this._elapsed = 0;
    this._minSeen = Infinity;
    eventBus.emit('detection:progress', { progress: 0 });
  }

  setHoldDuration(ms) {
    this._holdDuration = ms;
  }

  getProgress() {
    return clamp(this._elapsed / this._holdDuration, 0, 1);
  }
}
