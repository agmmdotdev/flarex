import { MessageAggregator } from "../../event-bus/message-aggregator"
import { InjectIntoContext } from "./inject-into-context"
import type { Message, MessageAggregatorFormat } from "@medusajs/types"

type ServiceMethod = (this: ServiceInstance, ...args: unknown[]) => unknown

interface ServicePrototype {
  MedusaContextIndex_?: Record<string | symbol, number>
  emitEvents_?: (
    groupedEvents: Record<string, Message[]>
  ) => Promise<void> | void
  constructor: {
    name: string
  }
}

interface ServiceInstance {
  __container__?: {
    logger?: {
      warn(message: string): void
    }
  }
}

/**
 * @internal this decorator is not meant to be used except by the internal team for now
 *
 * @param options
 * @constructor
 */
export function EmitEvents(
  options: MessageAggregatorFormat = {}
) {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    const servicePrototype = target as ServicePrototype
    InjectIntoContext({
      messageAggregator: () => new MessageAggregator(),
    })(target, propertyKey, descriptor)

    const original = descriptor.value as ServiceMethod

    descriptor.value = async function (
      this: ServiceInstance,
      ...args: unknown[]
    ) {
      const result = await original.apply(this, args)

      if (!servicePrototype.emitEvents_) {
        const logger = this.__container__?.logger ?? console
        logger.warn(
          `No emitEvents_ method found on ${servicePrototype.constructor.name}. No events emitted. To be able to use the @EmitEvents() you need to have the emitEvents_ method implemented in the class.`
        )
      }

      const argIndex = servicePrototype.MedusaContextIndex_?.[propertyKey]
      const aggregator =
        typeof argIndex === "number" && isContextWithAggregator(args[argIndex])
          ? args[argIndex].messageAggregator
          : undefined

      if (aggregator && aggregator.count() > 0) {
        await servicePrototype.emitEvents_?.apply(this, [
          aggregator.getMessages(options),
        ])
        aggregator.clearMessages()
      }

      return result
    }
  }
}

function isContextWithAggregator(
  value: unknown
): value is { messageAggregator: MessageAggregator } {
  return (
    value !== null &&
    typeof value === "object" &&
    "messageAggregator" in value &&
    value.messageAggregator instanceof MessageAggregator
  )
}
