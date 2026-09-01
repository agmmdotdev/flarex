import type { Event, Subscriber } from "@medusajs/framework/types"

type Listener = Subscriber

export class SimpleEventEmitter {
  readonly #listeners = new Map<string | symbol, Set<Listener>>()

  setMaxListeners(_maxListeners: number): this {
    return this
  }

  listenerCount(event: string | symbol): number {
    return this.#listeners.get(event)?.size ?? 0
  }

  listeners(event: string | symbol): Listener[] {
    return [...(this.#listeners.get(event) ?? [])]
  }

  on(event: string | symbol, listener: Listener): this {
    const listeners = this.#listeners.get(event) ?? new Set<Listener>()
    listeners.add(listener)
    this.#listeners.set(event, listeners)
    return this
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

  removeAllListeners(event?: string | symbol): this {
    if (event) {
      this.#listeners.delete(event)
    } else {
      this.#listeners.clear()
    }
    return this
  }

  emit(event: string | symbol, data: Event): boolean {
    const listeners = this.listeners(event)
    for (const listener of listeners) {
      void listener(data)
    }
    return listeners.length > 0
  }
}
