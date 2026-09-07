import type { Context } from "@medusajs/types"
import { isObject } from "../../common/is-object"
import { MedusaContextType } from "./context-parameter"

type ServiceMethod = (this: ServiceInstance, ...args: unknown[]) => unknown

interface ServicePrototype {
  MedusaContextIndex_?: Record<string | symbol, number>
}

interface TransactionalResource {
  getFreshManager(context: Context): unknown
}

type ServiceInstance = Record<string, unknown>

export function InjectManager(
  managerProperty = "baseRepository_"
): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    const contextIndex = getContextIndex(target, propertyKey)
    const originalMethod = descriptor.value as ServiceMethod

    descriptor.value = function (this: ServiceInstance, ...args: unknown[]) {
      const originalContext = readContext(args[contextIndex])
      const copiedContext = copyContextWithoutTransaction(originalContext)
      const resource = getTransactionalResource(this, managerProperty)

      copiedContext.manager ??= resource.getFreshManager(originalContext)
      if (originalContext.transactionManager) {
        copiedContext.transactionManager = originalContext.transactionManager
      }
      copiedContext.__type = MedusaContextType
      args[contextIndex] = copiedContext

      return originalMethod.apply(this, args)
    }
  }
}

function getContextIndex(target: object, propertyKey: string | symbol): number {
  const contextIndex = (target as ServicePrototype).MedusaContextIndex_?.[
    propertyKey
  ]
  if (contextIndex === undefined) {
    throw new Error(
      `To apply @InjectManager you have to flag a parameter using @MedusaContext`
    )
  }

  return contextIndex
}

function readContext(value: unknown): Context {
  return isObject(value) ? (value as Context) : {}
}

function copyContextWithoutTransaction(context: Context): Context {
  const copiedContext: Context = {}
  for (const key of Object.keys(context)) {
    if (key === "transactionManager") {
      continue
    }

    Object.defineProperty(copiedContext, key, {
      enumerable: true,
      get() {
        return Reflect.get(context, key)
      },
      set(value: unknown) {
        Reflect.set(context, key, value)
      },
    })
  }

  return copiedContext
}

function getTransactionalResource(
  instance: ServiceInstance,
  managerProperty: string
): TransactionalResource {
  const resource = instance[managerProperty]
  if (!isTransactionalResource(resource)) {
    throw new Error(
      `Could not find a manager in the context. Ensure that ${managerProperty} is set on your service that points to a repository.`
    )
  }

  return resource
}

function isTransactionalResource(value: unknown): value is TransactionalResource {
  return (
    value !== null &&
    typeof value === "object" &&
    "getFreshManager" in value &&
    typeof value.getFreshManager === "function"
  )
}
