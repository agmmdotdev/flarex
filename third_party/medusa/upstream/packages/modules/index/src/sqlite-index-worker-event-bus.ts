import type {
  EventBusTypes,
  IEventBusModuleService,
  Message,
  Subscriber,
} from "@medusajs/framework/types"

export class SqliteIndexWorkerEventBus implements IEventBusModuleService {
  private readonly subscribers = new Map<string | symbol, Set<Subscriber>>()

  async emit<T>(
    messages: Message<T> | Message<T>[],
    _options?: Record<string, unknown>
  ): Promise<void> {
    for (const message of Array.isArray(messages) ? messages : [messages]) {
      const subscribers = this.subscribers.get(message.name)

      for (const subscriber of subscribers ?? []) {
        const { options: _messageOptions, ...payload } = message
        await subscriber(payload)
      }
    }
  }

  subscribe(event: string | symbol, subscriber: Subscriber): this {
    const subscribers = this.subscribers.get(event) ?? new Set<Subscriber>()
    subscribers.add(subscriber)
    this.subscribers.set(event, subscribers)
    return this
  }

  unsubscribe(
    event: string | symbol,
    subscriber: Subscriber,
    _context?: EventBusTypes.SubscriberContext
  ): this {
    this.subscribers.get(event)?.delete(subscriber)
    return this
  }

  async releaseGroupedEvents(_eventGroupId: string): Promise<void> {}

  async clearGroupedEvents(_eventGroupId: string): Promise<void> {}
}

export function createSqliteIndexWorkerEventBus(): SqliteIndexWorkerEventBus {
  return new SqliteIndexWorkerEventBus()
}
