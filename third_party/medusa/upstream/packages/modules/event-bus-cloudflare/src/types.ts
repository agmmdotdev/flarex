import type { EventBusTypes } from "@medusajs/framework/types"

export interface CloudflareQueueProducer<MessageBody = unknown> {
  send(message: MessageBody): Promise<void>
}

export interface CloudflareEventBusQueuedMessage<T = unknown> {
  name: string
  data?: T
  metadata?: Record<string, unknown>
  options?: Record<string, unknown>
}

export interface CloudflareEventBusModuleOptions {
  queue: CloudflareQueueProducer<CloudflareEventBusQueuedMessage>
  dispatchLocalSubscribers?: boolean
}

export interface CloudflareEventBusSubscriberEntry {
  event: string | symbol
  subscriber: EventBusTypes.Subscriber
}

export function isCloudflareEventBusQueuedMessage(
  value: unknown
): value is CloudflareEventBusQueuedMessage {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.data === undefined || value.data !== null) &&
    (value.metadata === undefined || isRecord(value.metadata)) &&
    (value.options === undefined || isRecord(value.options))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
