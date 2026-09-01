import { createSqliteIndexWorkerEventBus } from "../sqlite-index-worker-event-bus"
import type { Subscriber } from "@medusajs/framework/types"

type SubscriberMessage = Parameters<Subscriber>[0]

describe("SQLite Index Worker event bus", () => {
  it("emits subscribed messages without forwarding event-bus options", async () => {
    const eventBus = createSqliteIndexWorkerEventBus()
    const receivedMessages: SubscriberMessage[] = []

    eventBus.subscribe("product.created", async (message) => {
      receivedMessages.push(message)
    })

    await eventBus.emit({
      data: {
        id: "prod_1",
      },
      name: "product.created",
      options: {
        eventGroupId: "group_1",
      },
    })

    expect(receivedMessages).toEqual([
      {
        data: {
          id: "prod_1",
        },
        name: "product.created",
      },
    ])
  })

  it("stops emitting to unsubscribed subscribers", async () => {
    const eventBus = createSqliteIndexWorkerEventBus()
    const receivedMessages: SubscriberMessage[] = []
    const subscriber: Subscriber = async (message) => {
      receivedMessages.push(message)
    }

    eventBus.subscribe("product.created", subscriber)
    eventBus.unsubscribe("product.created", subscriber)

    await eventBus.emit({
      data: {
        id: "prod_1",
      },
      name: "product.created",
    })

    expect(receivedMessages).toEqual([])
  })
})
