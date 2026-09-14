

export function buildExpectedEventMessageShape(options: {
  eventName: string
  action: string
  object: string
  eventGroupId?: string
  data: unknown
  options?: Record<string, unknown>
}) {
  return {
    name: options.eventName,
    metadata: {
      action: options.action,
      eventGroupId: options.eventGroupId,
      source: "fulfillment",
      object: options.object,
    },
    data: options.data,
    options: options.options,
  }
}
