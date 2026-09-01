import { ModulePersistenceEventSubscriber } from "@medusajs/types"

type InternalService = {
  setEventSubscriber(subscriber: ModulePersistenceEventSubscriber): void
}

export const MedusaInternalServiceSymbol = Symbol.for(
  "MedusaInternalServiceSymbol"
)

export function isMedusaInternalService(
  value: object
): value is InternalService {
  return (
    MedusaInternalServiceSymbol in value ||
    ("prototype" in value &&
      typeof value.prototype === "object" &&
      value.prototype !== null &&
      MedusaInternalServiceSymbol in value.prototype)
  )
}
