import { Context, EventBusTypes } from "@medusajs/types"
import { buildModuleResourceEventName } from "../event-bus/utils"

/** Native event payload shape: one message per action batch, with row order intact. */
export function moduleEventData(data: readonly { id: string }[]): { id: string | string[] } | undefined {
  const first = data[0]
  if (first === undefined) return undefined
  return { id: data.length === 1 ? first.id : data.map(item => item.id) }
}

// TODO should that move closer to the event bus? and maybe be rename to modulemoduleEventBuilderFactory

/**
 *
 * Factory function to create event builders for different entities
 *
 * @example
 * const createdFulfillment = moduleEventBuilderFactory({
 *   source: Modules.FULFILLMENT,
 *   action: CommonEvents.CREATED,
 *   object: "fulfillment",
 *   eventsEnum: FulfillmentEvents,
 * })
 *
 * createdFulfillment({
 *   data,
 *   sharedContext,
 * })
 *
 * @param action
 * @param object
 * @param eventsEnum
 * @param service
 */
export function moduleEventBuilderFactory({
  action,
  object,
  eventName,
  source,
}: {
  action: string
  object: string
  eventName?: string
  source: string
}) {
  return function ({
    data,
    sharedContext,
  }: {
    data: { id: string } | { id: string }[]
    sharedContext: Context
  }) {
    data = Array.isArray(data) ? data : [data]

    const eventData = moduleEventData(data)
    if (eventData === undefined) {
      return
    }

    const aggregator = sharedContext.messageAggregator!
    const messages: EventBusTypes.RawMessageFormat[] = []

    if (!eventName) {
      eventName = buildModuleResourceEventName({
        prefix: source,
        objectName: object,
        action,
      })
    }

    messages.push({
      source,
      action,
      context: sharedContext,
      data: eventData,
      eventName: eventName!,
      object,
    })

    aggregator.saveRawMessageData(messages)
  }
}
