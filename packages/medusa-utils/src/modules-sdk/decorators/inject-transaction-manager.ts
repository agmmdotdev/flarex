import type { Context } from "@medusajs/types"
import { isObject } from "../../common/is-object"
import { MedusaContextType } from "./context-parameter"

type ServiceMethod = (this: ServiceInstance, ...args: unknown[]) => unknown

interface ServicePrototype {
  MedusaContextIndex_?: Record<string | symbol, number>
}

interface TransactionOptions {
  manager?: unknown
  transaction?: unknown
  isolationLevel?: Context["isolationLevel"]
  enableNestedTransactions?: boolean
}

interface TransactionalResource {
  transaction<TResult>(
    task: (transactionManager: unknown) => Promise<TResult>,
    options?: TransactionOptions
  ): Promise<TResult>
}

type ServiceInstance = Record<string, unknown>

export function InjectTransactionManager(
  managerProperty = "baseRepository_"
): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    const contextIndex = getContextIndex(target, propertyKey)
    const originalMethod = descriptor.value as ServiceMethod

    descriptor.value = async function (
      this: ServiceInstance,
      ...args: unknown[]
    ) {
      const originalContext = readContext(args[contextIndex])
      if (originalContext.transactionManager) {
        return await originalMethod.apply(this, args)
      }

      const resource = getTransactionalResource(this, managerProperty)
      return await resource.transaction(
        async (transactionManager) => {
          const copiedContext = copyContextWithoutTransaction(originalContext)
          copiedContext.transactionManager = transactionManager
          copiedContext.__type = MedusaContextType
          args[contextIndex] = copiedContext

          return await originalMethod.apply(this, args)
        },
        {
          manager: originalContext.manager,
          transaction: originalContext.transactionManager,
          isolationLevel: originalContext.isolationLevel,
          enableNestedTransactions:
            originalContext.enableNestedTransactions ?? false,
        }
      )
    }
  }
}

function getContextIndex(target: object, propertyKey: string | symbol): number {
  const contextIndex = (target as ServicePrototype).MedusaContextIndex_?.[
    propertyKey
  ]
  if (contextIndex === undefined) {
    throw new Error(
      `An error occured applying decorator '@InjectTransactionManager' to method ${String(
        propertyKey
      )}: Missing parameter with flag @MedusaContext`
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
      `Could not find a transactional resource at ${managerProperty}`
    )
  }

  return resource
}

function isTransactionalResource(value: unknown): value is TransactionalResource {
  return (
    value !== null &&
    typeof value === "object" &&
    "transaction" in value &&
    typeof value.transaction === "function"
  )
}
