import {
  Event,
  EventBusTypes,
  InternalModuleDeclaration,
  Message,
  Subscriber,
} from "@medusajs/framework/types"
import { AbstractEventBusModuleService } from "@medusajs/framework/utils"
import { SimpleEventEmitter } from "./simple-event-emitter"
import type {
  CloudflareEventBusModuleOptions,
  CloudflareEventBusQueuedMessage,
} from "../types"

type InjectedDependencies = {
  logger?: WorkerEventBusLogger
}

type StagingQueueType = Map<string, CloudflareEventBusQueuedMessage[]>

interface WorkerEventBusLogger {
  info(message: string): void
  error(message: unknown): void
}

const eventEmitter = new SimpleEventEmitter()
eventEmitter.setMaxListeners(Infinity)

export default class CloudflareEventBusService extends AbstractEventBusModuleService {
  protected readonly logger_: WorkerEventBusLogger
  protected readonly eventEmitter_: SimpleEventEmitter
  protected readonly groupedEventsMap_: StagingQueueType
  protected readonly options_: CloudflareEventBusModuleOptions
  protected readonly subscriberWrappers_: Map<
    string | symbol,
    Map<Subscriber, Subscriber>
  >

  constructor(
    { logger }: InjectedDependencies,
    moduleOptions: CloudflareEventBusModuleOptions,
    moduleDeclaration: InternalModuleDeclaration
  ) {
    super({ logger }, moduleOptions, moduleDeclaration)

    if (!moduleOptions?.queue) {
      throw new Error("Cloudflare Event Bus requires a Queue binding")
    }

    this.logger_ = logger ?? console
    this.eventEmitter_ = eventEmitter
    this.groupedEventsMap_ = new Map()
    this.subscriberWrappers_ = new Map()
    this.options_ = {
      ...moduleOptions,
      dispatchLocalSubscribers: moduleOptions.dispatchLocalSubscribers ?? true,
    }
  }

  async emit<T = unknown>(
    eventsData: Message<T> | Message<T>[],
    options: Record<string, unknown> = {}
  ): Promise<void> {
    const normalizedEventsData = Array.isArray(eventsData)
      ? eventsData
      : [eventsData]

    for (const eventData of normalizedEventsData) {
      await this.groupOrQueueEvent({
        name: eventData.name,
        data: eventData.data,
        metadata: eventData.metadata,
        options: {
          ...options,
          ...eventData.options,
        },
      })
    }
  }

  private async groupOrQueueEvent<T = unknown>(
    eventData: CloudflareEventBusQueuedMessage<T>
  ) {
    const eventGroupId = eventData.metadata?.eventGroupId

    if (typeof eventGroupId === "string" && eventGroupId.length) {
      await this.groupEvent(eventGroupId, eventData)
      return
    }

    await this.queueEvent(eventData)
  }

  private async queueEvent<T = unknown>(
    eventData: CloudflareEventBusQueuedMessage<T>,
    context?: { isGrouped?: boolean; eventGroupId?: string }
  ) {
    await this.callInterceptors(eventData as Message<T>, context)

    if (!this.hasSubscribers(eventData.name)) {
      return
    }

    await this.options_.queue.send(eventData)

    if (this.options_.dispatchLocalSubscribers) {
      await this.dispatchLocalSubscribers(eventData)
    }
  }

  private async groupEvent<T = unknown>(
    eventGroupId: string,
    eventData: CloudflareEventBusQueuedMessage<T>
  ) {
    const groupedEvents = this.groupedEventsMap_.get(eventGroupId) || []

    groupedEvents.push(eventData)

    this.groupedEventsMap_.set(eventGroupId, groupedEvents)
  }

  async releaseGroupedEvents(eventGroupId: string) {
    const groupedEvents = this.groupedEventsMap_.get(eventGroupId) || []

    for (const event of groupedEvents) {
      await this.queueEvent(event, { isGrouped: true, eventGroupId })
    }

    await this.clearGroupedEvents(eventGroupId)
  }

  async dispatchQueuedEvent<T = unknown>(
    eventData: CloudflareEventBusQueuedMessage<T>
  ): Promise<void> {
    await this.callInterceptors(eventData as Message<T>, {
      isGrouped: Boolean(eventData.metadata?.eventGroupId),
      eventGroupId:
        typeof eventData.metadata?.eventGroupId === "string"
          ? eventData.metadata.eventGroupId
          : undefined,
    })
    await this.dispatchRegisteredSubscribers(eventData)
  }

  async clearGroupedEvents(
    eventGroupId: string,
    { eventNames }: { eventNames?: string[] } = {}
  ) {
    if (eventNames?.length) {
      const groupedEvents = this.groupedEventsMap_.get(eventGroupId) || []
      const eventsToKeep = groupedEvents.filter(
        (event) => !eventNames.includes(event.name)
      )
      this.groupedEventsMap_.set(eventGroupId, eventsToKeep)
    } else {
      this.groupedEventsMap_.delete(eventGroupId)
    }
  }

  subscribe(
    event: string | symbol,
    subscriber: Subscriber,
    context?: EventBusTypes.SubscriberContext
  ): this {
    super.subscribe(event, subscriber, context)

    const subscriberId =
      context?.subscriberId ?? getSubscriberId(subscriber)

    const wrappedSubscriber = async (data: Event) => {
      try {
        await subscriber(data)
      } catch (err) {
        this.logger_.error(
          `An error occurred while processing ${event.toString()}:`
        )
        this.logger_.error(err)
      }
    }

    if (subscriberId) {
      setSubscriberId(wrappedSubscriber, subscriberId)
    }

    this.eventEmitter_.on(event, wrappedSubscriber)
    this.getSubscriberWrappers(event).set(subscriber, wrappedSubscriber)

    return this
  }

  unsubscribe(
    event: string | symbol,
    subscriber: Subscriber,
    context?: EventBusTypes.SubscriberContext
  ): this {
    super.unsubscribe(event, subscriber, context)

    const subscriberId =
      context?.subscriberId ?? getSubscriberId(subscriber)

    if (subscriberId) {
      const listeners = this.eventEmitter_.listeners(event)
      const wrappedSubscriber = listeners.find(
        (listener) => getSubscriberId(listener) === subscriberId
      )

      if (wrappedSubscriber) {
        this.eventEmitter_.off(event, wrappedSubscriber)
      }
    } else {
      const wrappedSubscriber = this.getSubscriberWrappers(event).get(subscriber)
      if (wrappedSubscriber) {
        this.eventEmitter_.off(event, wrappedSubscriber)
      }
    }

    this.getSubscriberWrappers(event).delete(subscriber)

    return this
  }

  private async dispatchLocalSubscribers<T = unknown>(
    eventData: CloudflareEventBusQueuedMessage<T>
  ) {
    const { options: _options, ...eventBody } = eventData
    const eventListenersCount = this.eventEmitter_.listenerCount(eventData.name)
    const hasStarSubscriber = this.eventEmitter_.listenerCount("*") > 0

    const options = eventData.options as { delay?: number } | undefined
    await delay(options?.delay)

    if (eventListenersCount) {
      this.eventEmitter_.emit(eventData.name, eventBody as Event<T>)
    }

    if (hasStarSubscriber) {
      this.eventEmitter_.emit("*", eventBody as Event<T>)
    }

    const totalSubscribers = eventListenersCount + (hasStarSubscriber ? 1 : 0)
    if (totalSubscribers && !eventData.options?.internal) {
      this.logger_.info(
        `Processing ${eventData.name} which has ${totalSubscribers} subscribers`
      )
    }
  }

  private async dispatchRegisteredSubscribers<T = unknown>(
    eventData: CloudflareEventBusQueuedMessage<T>
  ): Promise<void> {
    const eventSubscribers =
      this.eventToSubscribersMap.get(eventData.name) ?? []
    const wildcardSubscribers = this.eventToSubscribersMap.get("*") ?? []
    const subscribers = eventSubscribers.concat(wildcardSubscribers)

    if (!subscribers.length) {
      return
    }

    const event = toEvent(eventData)
    const results = await Promise.allSettled(
      subscribers.map(({ subscriber }) => subscriber(event))
    )
    const failures = results.filter(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected"
    )

    if (!eventData.options?.internal) {
      this.logger_.info(
        `Processing queued ${eventData.name} which has ${subscribers.length} subscribers`
      )
    }

    if (failures.length) {
      throw new Error(
        `Failed to dispatch queued event ${eventData.name} to ${failures.length} subscribers`
      )
    }
  }

  private hasSubscribers(eventName: string): boolean {
    const eventSubscribers = this.eventToSubscribersMap.get(eventName) ?? []
    const wildcardSubscribers = this.eventToSubscribersMap.get("*") ?? []

    return Boolean(eventSubscribers.length || wildcardSubscribers.length)
  }

  private getSubscriberWrappers(
    event: string | symbol
  ): Map<Subscriber, Subscriber> {
    const wrappers = this.subscriberWrappers_.get(event)
    if (wrappers) {
      return wrappers
    }

    const newWrappers = new Map<Subscriber, Subscriber>()
    this.subscriberWrappers_.set(event, newWrappers)

    return newWrappers
  }
}

function delay(ms?: number): Promise<void> {
  return ms
    ? new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms))
    : Promise.resolve()
}

interface SubscriberWithId {
  subscriberId?: string
}

function getSubscriberId(subscriber: Subscriber): string | undefined {
  return (subscriber as Subscriber & SubscriberWithId).subscriberId
}

function setSubscriberId(subscriber: Subscriber, id: string): void {
  ;(subscriber as Subscriber & SubscriberWithId).subscriberId = id
}

function toEvent<T = unknown>(
  eventData: CloudflareEventBusQueuedMessage<T>
): Event<T> {
  const { options: _options, ...event } = eventData
  return event as Event<T>
}
