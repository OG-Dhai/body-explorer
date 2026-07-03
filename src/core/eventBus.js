class EventBus {
  constructor() {
    this._listeners = new Map();
    this._onceWrappers = new WeakMap();
  }

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return this;
  }

  off(event, callback) {
    const set = this._listeners.get(event);
    if (!set) return this;
    set.delete(callback);
    const wrapped = this._onceWrappers.get(callback);
    if (wrapped) {
      set.delete(wrapped);
      this._onceWrappers.delete(callback);
    }
    return this;
  }

  emit(event, data) {
    const set = this._listeners.get(event);
    if (!set) return this;
    for (const fn of set) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[EventBus] Error in "${event}" listener:`, err);
      }
    }
    return this;
  }

  once(event, callback) {
    const wrapped = (data) => {
      this.off(event, wrapped);
      callback(data);
    };
    this._onceWrappers.set(callback, wrapped);
    return this.on(event, wrapped);
  }

  removeAll(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
    return this;
  }
}

// Export singleton
export default new EventBus();
