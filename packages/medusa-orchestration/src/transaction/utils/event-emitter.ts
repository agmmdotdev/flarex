type Listener = {
  bivarianceHack(...args: unknown[]): void
}["bivarianceHack"]

export class EventEmitter {
  #listeners = new Map<string | symbol, Set<Listener>>()

  on(event: string | symbol, listener: Listener): this {
    const listeners = this.#listeners.get(event) ?? new Set<Listener>()
    listeners.add(listener)
    this.#listeners.set(event, listeners)
    return this
  }

  once(event: string | symbol, listener: Listener): this {
    const onceListener: Listener = (...args) => {
      this.off(event, onceListener)
      listener(...args)
    }

    return this.on(event, onceListener)
  }

  off(event: string | symbol, listener: Listener): this {
    const listeners = this.#listeners.get(event)
    listeners?.delete(listener)

    if (listeners?.size === 0) {
      this.#listeners.delete(event)
    }

    return this
  }

  removeListener(event: string | symbol, listener: Listener): this {
    return this.off(event, listener)
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const listeners = this.#listeners.get(event)

    if (!listeners?.size) {
      return false
    }

    for (const listener of Array.from(listeners)) {
      listener(...args)
    }

    return true
  }
}
