import { describe, it, expect, vi } from 'vitest';
import { StateMachine } from './stateMachine.js';

describe('StateMachine', () => {
  it('initializes correctly', () => {
    const fsm = new StateMachine({
      id: 'test',
      states: ['idle', 'active'],
      initialState: 'idle',
      transitions: { idle: { START: 'active' }, active: { STOP: 'idle' } }
    });
    expect(fsm.getState()).toBe('idle');
    expect(fsm.is('idle')).toBe(true);
    expect(fsm.getId()).toBe('test');
  });

  it('throws on invalid initial state', () => {
    expect(() => {
      new StateMachine({
        states: ['a'], initialState: 'b', transitions: {}
      });
    }).toThrow();
  });

  it('transitions to valid states', () => {
    const fsm = new StateMachine({
      states: ['idle', 'active'],
      initialState: 'idle',
      transitions: { idle: { START: 'active' } }
    });
    const result = fsm.transition('START');
    expect(result).toBe(true);
    expect(fsm.getState()).toBe('active');
    expect(fsm.getHistory()).toEqual(['idle']);
  });

  it('fails transition on invalid action', () => {
    const fsm = new StateMachine({
      states: ['idle'], initialState: 'idle', transitions: { idle: {} }
    });
    const result = fsm.transition('UNKNOWN');
    expect(result).toBe(false);
    expect(fsm.getState()).toBe('idle');
  });

  it('calls onEnter and onExit callbacks', () => {
    const onEnterIdle = vi.fn();
    const onExitIdle = vi.fn();
    const onEnterActive = vi.fn();
    
    const fsm = new StateMachine({
      states: ['idle', 'active'],
      initialState: 'idle',
      transitions: { idle: { START: 'active' } },
      onEnter: { idle: onEnterIdle, active: onEnterActive },
      onExit: { idle: onExitIdle }
    });

    expect(onEnterIdle).toHaveBeenCalledWith(null);
    fsm.transition('START', { payload: 'data' });
    expect(onExitIdle).toHaveBeenCalledWith({ payload: 'data' });
    expect(onEnterActive).toHaveBeenCalledWith({ payload: 'data' });
  });
});
