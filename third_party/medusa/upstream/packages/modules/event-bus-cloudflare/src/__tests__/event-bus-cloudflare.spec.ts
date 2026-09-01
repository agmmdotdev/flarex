import CloudflareEventBusService from "../services/event-bus-cloudflare"
import type {
  CloudflareEventBusQueuedMessage,
  CloudflareQueueProducer,
} from "../types"
import { isCloudflareEventBusQueuedMessage } from "../types"

class RecordingQueue
  implements CloudflareQueueProducer<CloudflareEventBusQueuedMessage>
{
  readonly sent: CloudflareEventBusQueuedMessage[] = []

  async send(message: CloudflareEventBusQueuedMessage): Promise<void> {
    this.sent.push(message)
  }
}

describe("CloudflareEventBusService", () => {
  it("enqueues events and dispatches local subscribers", async () => {
    const queue = new RecordingQueue()
    const logger = createTestLogger()
    const service = new CloudflareEventBusService(
      { logger },
      { queue },
      { scope: "internal", worker_mode: "worker" }
    )
    const subscriber = jest.fn()

    service.subscribe("product.updated", subscriber, {
      subscriberId: "cache-invalidator",
    })

    await service.emit({
      name: "product.updated",
      data: { id: "prod_123" },
    })

    expect(queue.sent).toEqual([
      {
        name: "product.updated",
        data: { id: "prod_123" },
        metadata: undefined,
        options: {},
      },
    ])
    expect(subscriber).toHaveBeenCalledWith({
      name: "product.updated",
      data: { id: "prod_123" },
      metadata: undefined,
    })
  })

  it("holds grouped events until release", async () => {
    const queue = new RecordingQueue()
    const service = new CloudflareEventBusService(
      { logger: createTestLogger() },
      { queue, dispatchLocalSubscribers: false },
      { scope: "internal", worker_mode: "worker" }
    )
    service.subscribe("order.placed", jest.fn(), {
      subscriberId: "order-subscriber",
    })

    await service.emit({
      name: "order.placed",
      data: { id: "order_123" },
      metadata: { eventGroupId: "group_1" },
    })

    expect(queue.sent).toEqual([])

    await service.releaseGroupedEvents("group_1")

    expect(queue.sent).toEqual([
      {
        name: "order.placed",
        data: { id: "order_123" },
        metadata: { eventGroupId: "group_1" },
        options: {},
      },
    ])
  })

  it("clears selected grouped events before release", async () => {
    const queue = new RecordingQueue()
    const service = new CloudflareEventBusService(
      { logger: createTestLogger() },
      { queue, dispatchLocalSubscribers: false },
      { scope: "internal", worker_mode: "worker" }
    )

    service.subscribe("order.placed", jest.fn(), {
      subscriberId: "order-placed-subscriber",
    })
    service.subscribe("order.canceled", jest.fn(), {
      subscriberId: "order-canceled-subscriber",
    })

    await service.emit([
      {
        name: "order.placed",
        data: { id: "order_123" },
        metadata: { eventGroupId: "group_1" },
      },
      {
        name: "order.canceled",
        data: { id: "order_123" },
        metadata: { eventGroupId: "group_1" },
      },
    ])

    await service.clearGroupedEvents("group_1", {
      eventNames: ["order.placed"],
    })
    await service.releaseGroupedEvents("group_1")

    expect(queue.sent).toEqual([
      {
        name: "order.canceled",
        data: { id: "order_123" },
        metadata: { eventGroupId: "group_1" },
        options: {},
      },
    ])
  })

  it("skips queueing events without registered subscribers", async () => {
    const queue = new RecordingQueue()
    const service = new CloudflareEventBusService(
      { logger: createTestLogger() },
      { queue, dispatchLocalSubscribers: false },
      { scope: "internal", worker_mode: "worker" }
    )

    await service.emit({
      name: "product.updated",
      data: { id: "prod_123" },
    })

    expect(queue.sent).toEqual([])
  })

  it("queues events when a wildcard subscriber is registered", async () => {
    const queue = new RecordingQueue()
    const service = new CloudflareEventBusService(
      { logger: createTestLogger() },
      { queue, dispatchLocalSubscribers: false },
      { scope: "internal", worker_mode: "worker" }
    )

    service.subscribe("*", jest.fn(), {
      subscriberId: "wildcard-subscriber",
    })

    await service.emit({
      name: "product.updated",
      data: { id: "prod_123" },
    })

    expect(queue.sent).toEqual([
      {
        name: "product.updated",
        data: { id: "prod_123" },
        metadata: undefined,
        options: {},
      },
    ])
  })

  it("unsubscribes concrete local subscribers without subscriber ids", async () => {
    const queue = new RecordingQueue()
    const service = new CloudflareEventBusService(
      { logger: createTestLogger() },
      { queue },
      { scope: "internal", worker_mode: "worker" }
    )
    const subscriber = jest.fn()
    const wildcardSubscriber = jest.fn()

    service.subscribe("product.unsubscribed", subscriber)
    service.subscribe("*", wildcardSubscriber, {
      subscriberId: "unsubscribe-wildcard-subscriber",
    })

    await service.emit({
      name: "product.unsubscribed",
      data: { id: "prod_123" },
    })

    service.unsubscribe("product.unsubscribed", subscriber)

    await service.emit({
      name: "product.unsubscribed",
      data: { id: "prod_456" },
    })

    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(wildcardSubscriber).toHaveBeenCalledTimes(2)
    expect(queue.sent).toEqual([
      {
        name: "product.unsubscribed",
        data: { id: "prod_123" },
        metadata: undefined,
        options: {},
      },
      {
        name: "product.unsubscribed",
        data: { id: "prod_456" },
        metadata: undefined,
        options: {},
      },
    ])
  })

  it("unsubscribes wildcard local subscribers by subscriber id", async () => {
    const queue = new RecordingQueue()
    const service = new CloudflareEventBusService(
      { logger: createTestLogger() },
      { queue },
      { scope: "internal", worker_mode: "worker" }
    )
    const wildcardSubscriber = jest.fn()

    service.subscribe("*", wildcardSubscriber, {
      subscriberId: "unsubscribe-wildcard-by-id",
    })

    await service.emit({
      name: "product.wildcard-unsubscribed",
      data: { id: "prod_123" },
    })

    service.unsubscribe("*", wildcardSubscriber, {
      subscriberId: "unsubscribe-wildcard-by-id",
    })

    await service.emit({
      name: "product.wildcard-unsubscribed",
      data: { id: "prod_456" },
    })

    expect(wildcardSubscriber).toHaveBeenCalledTimes(1)
    expect(queue.sent).toEqual([
      {
        name: "product.wildcard-unsubscribed",
        data: { id: "prod_123" },
        metadata: undefined,
        options: {},
      },
    ])
  })

  it("dispatches queued events to registered subscribers without re-enqueueing", async () => {
    const queue = new RecordingQueue()
    const service = new CloudflareEventBusService(
      { logger: createTestLogger() },
      { queue, dispatchLocalSubscribers: false },
      { scope: "internal", worker_mode: "worker" }
    )
    const subscriber = jest.fn()
    const wildcardSubscriber = jest.fn()

    service.subscribe("product.updated", subscriber, {
      subscriberId: "product-subscriber",
    })
    service.subscribe("*", wildcardSubscriber, {
      subscriberId: "wildcard-subscriber",
    })

    await service.dispatchQueuedEvent({
      name: "product.updated",
      data: { id: "prod_123" },
      metadata: { source: "queue" },
      options: {},
    })

    const expectedEvent = {
      name: "product.updated",
      data: { id: "prod_123" },
      metadata: { source: "queue" },
    }

    expect(subscriber).toHaveBeenCalledWith(expectedEvent)
    expect(wildcardSubscriber).toHaveBeenCalledWith(expectedEvent)
    expect(queue.sent).toEqual([])
  })

  it("dispatches queued events only to subscribers still registered after unsubscribe", async () => {
    const queue = new RecordingQueue()
    const service = new CloudflareEventBusService(
      { logger: createTestLogger() },
      { queue, dispatchLocalSubscribers: false },
      { scope: "internal", worker_mode: "worker" }
    )
    const removedSubscriber = jest.fn()
    const activeSubscriber = jest.fn()

    service.subscribe("product.updated", removedSubscriber)
    service.subscribe("product.updated", activeSubscriber, {
      subscriberId: "active-product-subscriber",
    })
    service.unsubscribe("product.updated", removedSubscriber)

    await service.dispatchQueuedEvent({
      name: "product.updated",
      data: { id: "prod_123" },
    })

    expect(removedSubscriber).not.toHaveBeenCalled()
    expect(activeSubscriber).toHaveBeenCalledWith({
      name: "product.updated",
      data: { id: "prod_123" },
      metadata: undefined,
    })
    expect(queue.sent).toEqual([])
  })

  it("does not dispatch queued events to unsubscribed wildcard subscribers", async () => {
    const queue = new RecordingQueue()
    const service = new CloudflareEventBusService(
      { logger: createTestLogger() },
      { queue, dispatchLocalSubscribers: false },
      { scope: "internal", worker_mode: "worker" }
    )
    const wildcardSubscriber = jest.fn()

    service.subscribe("*", wildcardSubscriber, {
      subscriberId: "queued-wildcard-subscriber",
    })
    service.unsubscribe("*", wildcardSubscriber, {
      subscriberId: "queued-wildcard-subscriber",
    })

    await service.dispatchQueuedEvent({
      name: "product.updated",
      data: { id: "prod_123" },
    })

    expect(wildcardSubscriber).not.toHaveBeenCalled()
    expect(queue.sent).toEqual([])
  })

  it("treats queued events without subscribers as a no-op", async () => {
    const queue = new RecordingQueue()
    const logger = createTestLogger()
    const service = new CloudflareEventBusService(
      { logger },
      { queue, dispatchLocalSubscribers: false },
      { scope: "internal", worker_mode: "worker" }
    )

    await service.dispatchQueuedEvent({
      name: "product.updated",
      data: { id: "prod_123" },
    })

    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(queue.sent).toEqual([])
  })

  it("rejects queued dispatch when a subscriber fails", async () => {
    const queue = new RecordingQueue()
    const service = new CloudflareEventBusService(
      { logger: createTestLogger() },
      { queue, dispatchLocalSubscribers: false },
      { scope: "internal", worker_mode: "worker" }
    )

    service.subscribe(
      "product.updated",
      async () => {
        throw new Error("subscriber failed")
      },
      {
        subscriberId: "failing-subscriber",
      }
    )

    await expect(
      service.dispatchQueuedEvent({
        name: "product.updated",
        data: { id: "prod_123" },
      })
    ).rejects.toThrow(
      "Failed to dispatch queued event product.updated to 1 subscribers"
    )
  })

  it("narrows queued messages at unknown boundaries", () => {
    expect(
      isCloudflareEventBusQueuedMessage({
        name: "product.updated",
        metadata: { source: "queue" },
        options: { attempts: 1 },
      })
    ).toBe(true)
    expect(isCloudflareEventBusQueuedMessage({ name: 123 })).toBe(false)
    expect(
      isCloudflareEventBusQueuedMessage({
        name: "product.updated",
        metadata: ["not-record"],
      })
    ).toBe(false)
  })
})

function createTestLogger() {
  return {
    info: jest.fn(),
    error: jest.fn(),
  }
}
