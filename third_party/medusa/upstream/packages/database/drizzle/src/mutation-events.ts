import type {
  Context,
  ModulePersistenceEventSubscriber,
  ModulePersistenceMutationEventArgs,
  ModulePersistenceMutationService,
  PerformedActions,
} from "@medusajs/types"

export type DrizzleMutationEvent =
  | "afterCreate"
  | "afterUpdate"
  | "afterUpsert"
  | "afterDelete"

export type CreatedEntityMutation = {
  modelName: string
  entity: Record<string, unknown>
}

const DRIZZLE_EVENT_SUBSCRIBER_CONTEXT_KEY =
  "__medusa_drizzle_event_subscriber__"
const DRIZZLE_SUPPRESS_MUTATION_EVENTS_CONTEXT_KEY =
  "__medusa_drizzle_suppress_mutation_events__"
const DRIZZLE_DISPATCHED_MUTATION_KEYS_CONTEXT_KEY =
  "__medusa_drizzle_dispatched_mutation_keys__"

type DrizzleMutationEventContext = Context & {
  [DRIZZLE_EVENT_SUBSCRIBER_CONTEXT_KEY]?: ModulePersistenceEventSubscriber
  [DRIZZLE_SUPPRESS_MUTATION_EVENTS_CONTEXT_KEY]?: boolean
  [DRIZZLE_DISPATCHED_MUTATION_KEYS_CONTEXT_KEY]?: Map<string, number>
}

export function emptyPerformedActions(): PerformedActions {
  return { created: {}, updated: {}, deleted: {} }
}

export function addPerformedAction(
  actions: PerformedActions,
  action: keyof PerformedActions,
  modelName: string,
  entity: Record<string, unknown>,
  primaryKeys: string[]
): void {
  actions[action][modelName] ??= []
  // Medusa's legacy action type requires `id`; preserve the actual primary-key shape here.
  actions[action][modelName].push(
    Object.fromEntries(primaryKeys.map((key) => [key, entity[key]])) as {
      id: string
    }
  )
}

export function registerDrizzleEventSubscriber(
  context: Context,
  subscriber: ModulePersistenceEventSubscriber
): void {
  eventContext(context)[DRIZZLE_EVENT_SUBSCRIBER_CONTEXT_KEY] = subscriber
}

export function suppressMutationEventDispatch(context: Context): Context {
  if (
    !eventContext(context)[DRIZZLE_EVENT_SUBSCRIBER_CONTEXT_KEY] &&
    !eventAggregator(context)
  ) {
    return context
  }

  return {
    ...context,
    [DRIZZLE_SUPPRESS_MUTATION_EVENTS_CONTEXT_KEY]: true,
  } as DrizzleMutationEventContext
}

export async function dispatchPerformedActions(
  performedActions: PerformedActions,
  context: Context
): Promise<void> {
  await Promise.all([
    dispatchPerformedActionRows("afterCreate", performedActions.created, context),
    dispatchPerformedActionRows("afterUpdate", performedActions.updated, context),
    dispatchPerformedActionRows("afterDelete", performedActions.deleted, context),
  ])
}

export async function dispatchCreatedMutations(
  mutations: CreatedEntityMutation[],
  context: Context
): Promise<void> {
  await Promise.all(
    mutations.map(({ modelName, entity }) =>
      dispatchDrizzleMutationEvent(
        "afterCreate",
        {
          entity,
          meta: {
            className: modelName,
          },
        },
        context
      )
    )
  )
}

export async function dispatchDrizzleMutationRows(
  event: DrizzleMutationEvent,
  modelName: string,
  rows: Record<string, unknown>[],
  context: Context,
  changeSet?: (
    row: Record<string, unknown>
  ) => ModulePersistenceMutationEventArgs["changeSet"]
): Promise<void> {
  await Promise.all(
    rows.map((row) =>
      dispatchDrizzleMutationEvent(
        event,
        {
          entity: row,
          meta: {
            className: modelName,
          },
          ...(changeSet ? { changeSet: changeSet(row) } : {}),
        },
        context
      )
    )
  )
}

export async function dispatchCascadedUpdateMutations(
  rowsByModel: Record<string, Record<string, unknown>[]>,
  context: Context,
  changeSet: (
    row: Record<string, unknown>
  ) => ModulePersistenceMutationEventArgs["changeSet"]
): Promise<void> {
  await Promise.all(
    Object.entries(rowsByModel).flatMap(([modelName, rows]) =>
      rows.map((row) =>
        dispatchDrizzleMutationEvent(
          "afterUpdate",
          {
            entity: row,
            meta: {
              className: modelName,
            },
            changeSet: changeSet(row),
          },
          context
        )
      )
    )
  )
}

export async function dispatchDrizzleMutationEvent(
  event: DrizzleMutationEvent,
  args: ModulePersistenceMutationEventArgs,
  context: Context,
  subscriber?: ModulePersistenceEventSubscriber
): Promise<void> {
  if (consumeDispatchedMutationKey(context, event, args)) {
    return
  }

  const contextSubscriber =
    eventContext(context)[DRIZZLE_EVENT_SUBSCRIBER_CONTEXT_KEY]
  const Subscriber = subscriber ?? contextSubscriber
  if (eventContext(context)[DRIZZLE_SUPPRESS_MUTATION_EVENTS_CONTEXT_KEY]) {
    return
  }
  if (!Subscriber) {
    aggregateConventionalMutationEvent(event, args, context)
    return
  }

  await new Subscriber(context)[event]?.(args)
}

export function createDrizzleEventSubscriber(
  keys: string[],
  service: ModulePersistenceMutationService
): ModulePersistenceEventSubscriber {
  const Subscriber = class {
    constructor(private readonly context: Context) {}

    afterCreate(
      args: Parameters<
        ModulePersistenceMutationService["interceptEntityMutationEvents"]
      >[1]
    ) {
      service.interceptEntityMutationEvents("afterCreate", args, this.context)
    }

    afterUpdate(
      args: Parameters<
        ModulePersistenceMutationService["interceptEntityMutationEvents"]
      >[1]
    ) {
      service.interceptEntityMutationEvents("afterUpdate", args, this.context)
    }

    afterUpsert(
      args: Parameters<
        ModulePersistenceMutationService["interceptEntityMutationEvents"]
      >[1]
    ) {
      service.interceptEntityMutationEvents("afterUpsert", args, this.context)
    }

    afterDelete(
      args: Parameters<
        ModulePersistenceMutationService["interceptEntityMutationEvents"]
      >[1]
    ) {
      service.interceptEntityMutationEvents("afterDelete", args, this.context)
    }
  }

  Object.defineProperty(Subscriber, "name", {
    value: keys.join(","),
    writable: false,
  })

  return Subscriber
}

async function dispatchPerformedActionRows(
  event: "afterCreate" | "afterUpdate" | "afterDelete",
  rowsByModel: Record<string, { id: string }[]>,
  context: Context
): Promise<void> {
  await Promise.all(
    Object.entries(rowsByModel).flatMap(([modelName, rows]) =>
      rows.map(async (row) => {
        await dispatchDrizzleMutationEvent(
          event,
          {
            entity: row,
            meta: {
              className: modelName,
            },
          },
          context
        )
        if (eventContext(context)[DRIZZLE_EVENT_SUBSCRIBER_CONTEXT_KEY]) {
          recordDispatchedMutationKey(context, event, modelName, row.id)
        }
      })
    )
  )
}

function eventContext(context: Context): DrizzleMutationEventContext {
  return context as DrizzleMutationEventContext
}

function recordDispatchedMutationKey(
  context: Context,
  event: "afterCreate" | "afterUpdate" | "afterDelete",
  modelName: string,
  entityId: string
): void {
  const keys = dispatchedMutationKeys(context)
  const key = mutationDispatchKey(event, modelName, entityId)
  keys.set(key, (keys.get(key) ?? 0) + 1)
}

function consumeDispatchedMutationKey(
  context: Context,
  event: DrizzleMutationEvent,
  args: ModulePersistenceMutationEventArgs
): boolean {
  const entityId = args.entity.id
  if (entityId === undefined) {
    return false
  }

  const key = mutationDispatchKey(event, args.meta.className, String(entityId))
  const keys = eventContext(context)[
    DRIZZLE_DISPATCHED_MUTATION_KEYS_CONTEXT_KEY
  ]
  const count = keys?.get(key) ?? 0
  if (!keys || count <= 0) {
    return false
  }

  if (count === 1) {
    keys.delete(key)
  } else {
    keys.set(key, count - 1)
  }

  return true
}

function dispatchedMutationKeys(context: Context): Map<string, number> {
  const drizzleContext = eventContext(context)
  drizzleContext[DRIZZLE_DISPATCHED_MUTATION_KEYS_CONTEXT_KEY] ??= new Map()
  return drizzleContext[DRIZZLE_DISPATCHED_MUTATION_KEYS_CONTEXT_KEY]
}

function mutationDispatchKey(
  event: DrizzleMutationEvent,
  modelName: string,
  entityId: string
): string {
  return `${event}:${modelName}:${entityId}`
}

function aggregateConventionalMutationEvent(
  event: DrizzleMutationEvent,
  args: ModulePersistenceMutationEventArgs,
  context: Context
): void {
  const aggregator = eventAggregator(context)
  const entityId = args.entity.id
  if (!aggregator || entityId === undefined) {
    return
  }

  const action = mutationEventAction(event, args)
  const object = toSnakeCase(args.meta.className)
  const source = conventionalEventSource(object)
  aggregator.saveRawMessageData([
    {
      source,
      action,
      context,
      data: {
        id: String(entityId),
      },
      eventName: `${source}.${object.replace(/_/g, "-")}.${action}`,
      object,
    },
  ])
}

function mutationEventAction(
  event: DrizzleMutationEvent,
  args: ModulePersistenceMutationEventArgs
): string {
  if (event === "afterCreate") {
    return "created"
  }
  if (event === "afterDelete") {
    return "deleted"
  }

  const currentDeletedAt = args.changeSet?.entity.deleted_at
  const previousDeletedAt = args.changeSet?.originalEntity?.deleted_at
  if (currentDeletedAt && !previousDeletedAt) {
    return "deleted"
  }
  if (previousDeletedAt && !currentDeletedAt) {
    return "restored"
  }

  return "updated"
}

function conventionalEventSource(object: string): string {
  if (object === "invite") {
    return "user"
  }

  if (object === "reservation_item") {
    return "inventory"
  }

  if (
    [
      "fulfillment",
      "fulfillment_address",
      "fulfillment_item",
      "fulfillment_label",
      "fulfillment_provider",
      "fulfillment_set",
      "geo_zone",
      "service_zone",
      "shipping_option",
      "shipping_option_rule",
      "shipping_option_type",
      "shipping_profile",
    ].includes(object)
  ) {
    return "fulfillment"
  }

  if (
    [
      "price",
      "price_list",
      "price_list_rule",
      "price_preference",
      "price_rule",
      "price_set",
    ].includes(object)
  ) {
    return "pricing"
  }

  const parts = object.split("_")
  if (parts[0] === "sales" && parts[1] === "channel") {
    return "sales_channel"
  }

  return parts[0] ?? object
}

function eventAggregator(
  context: Context
):
  | {
      saveRawMessageData(
        messages: Array<{
          source: string
          action: string
          context: Context
          data: { id: string }
          eventName: string
          object: string
        }>
      ): void
    }
  | undefined {
  const aggregator = (context as { messageAggregator?: unknown })
    .messageAggregator
  if (
    aggregator &&
    typeof aggregator === "object" &&
    "saveRawMessageData" in aggregator
  ) {
    const saveRawMessageData = aggregator.saveRawMessageData
    if (typeof saveRawMessageData === "function") {
      return {
        saveRawMessageData: (messages) => {
          saveRawMessageData.call(aggregator, messages)
        },
      }
    }
  }

  return undefined
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s.-]+/g, "_")
    .toLowerCase()
}
