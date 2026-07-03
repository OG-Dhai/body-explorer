export class StateMachine {
  constructor({ id = 'fsm', states, initialState, transitions, onEnter = {}, onExit = {} }) {
    this._id = id;
    this._states = new Set(states);
    this._transitions = transitions;
    this._currentState = initialState;
    this._onEnter = onEnter;
    this._onExit = onExit;
    this._history = [];

    if (!this._states.has(initialState)) {
      throw new Error(`[StateMachine:${id}] Invalid initial state: "${initialState}"`);
    }
    
    if (this._onEnter[initialState]) {
      this._onEnter[initialState](null);
    }
  }

  transition(action, payload = null) {
    const table = this._transitions[this._currentState];
    if (!table || !(action in table)) {
      if (this._id !== 'hold-detector') {
        console.warn(`[StateMachine:${this._id}] No transition "${action}" from "${this._currentState}"`);
      }
      return false;
    }

    const nextState = table[action];
    if (!this._states.has(nextState)) {
      throw new Error(`[StateMachine:${this._id}] Invalid target state: "${nextState}"`);
    }

    const prevState = this._currentState;
    
    if (this._onExit[prevState]) {
      this._onExit[prevState](payload);
    }
    
    this._history.push(prevState);
    this._currentState = nextState;
    
    if (this._onEnter[nextState]) {
      this._onEnter[nextState](payload);
    }
    
    return true;
  }

  getState() {
    return this._currentState;
  }

  is(state) {
    return this._currentState === state;
  }

  getHistory() {
    return [...this._history];
  }

  getId() {
    return this._id;
  }
}
