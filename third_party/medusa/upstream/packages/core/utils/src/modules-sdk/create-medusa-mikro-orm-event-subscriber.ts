import {
  Context,
  ModulePersistenceEventSubscriber,
  ModulePersistenceMutationEventArgs,
  ModulePersistenceMutationService,
} from "@medusajs/types"
import {
  EntityManager,
  EventArgs,
  EventSubscriber,
  EventType,
} from "@mikro-orm/core"

export type MedusaMikroOrmEventSubscriber = {
  new (context: Context): EventSubscriber
}

/**
 * Build a new mikro orm event subscriber for the given models
 * @param models
 * @returns
 */
export function createMedusaMikroOrmEventSubscriber(
  keys: string[],
  service: ModulePersistenceMutationService
): MedusaMikroOrmEventSubscriber {
  const klass = class MikroOrmEventSubscriber implements EventSubscriber {
    #context: Context
    #service: ModulePersistenceMutationService = service

    constructor(context: Context) {
      this.#context = context
    }

    async afterCreate<T extends object>(args: EventArgs<T>): Promise<void> {
      this.#service.interceptEntityMutationEvents(
        "afterCreate",
        args,
        this.#context
      )
    }

    async afterUpdate<T extends object>(args: EventArgs<T>): Promise<void> {
      this.#service.interceptEntityMutationEvents(
        "afterUpdate",
        args,
        this.#context
      )
    }

    async afterUpsert<T extends object>(args: EventArgs<T>): Promise<void> {
      this.#service.interceptEntityMutationEvents(
        "afterUpsert",
        args,
        this.#context
      )
    }

    async afterDelete<T extends object>(args: EventArgs<T>): Promise<void> {
      this.#service.interceptEntityMutationEvents(
        "afterDelete",
        args,
        this.#context
      )
    }
  }

  Object.defineProperty(klass, "name", {
    value: keys.join(","),
    writable: false,
  })

  return klass
}

export function registerMedusaMikroOrmEventSubscriber(
  context: Context,
  subscriber: ModulePersistenceEventSubscriber
): void {
  const manager = (context.transactionManager ??
    context.manager) as EntityManager
  const subscriberInstance = new subscriber(context)
  const hasListeners = (
    manager.getEventManager() as unknown as {
      subscribers: EventSubscriber[]
    }
  ).subscribers.some(
    (listener) =>
      listener.constructor.name === subscriberInstance.constructor.name
  )
  if (!hasListeners) {
    manager
      .getEventManager()
      .registerSubscriber(subscriberInstance as EventSubscriber)
  }
}

export async function dispatchMedusaMikroOrmMutationEvent(
  event: "afterCreate" | "afterUpdate" | "afterUpsert" | "afterDelete",
  args: ModulePersistenceMutationEventArgs,
  context: Context
): Promise<void> {
  const manager = (context.transactionManager ??
    context.manager) as EntityManager
  const dispatchEvent = manager
    .getEventManager()
    .dispatchEvent.bind(manager.getEventManager()) as unknown as (
    event: EventType,
    args: ModulePersistenceMutationEventArgs
  ) => Promise<void>
  await dispatchEvent(event as EventType, args)
}
