type ContextProperties = Record<
  string,
  unknown | ((this: unknown, ...args: unknown[]) => unknown)
>

type ServiceMethod = (this: unknown, ...args: unknown[]) => unknown

interface ServicePrototype {
  MedusaContextIndex_?: Record<string | symbol, number>
}

export function InjectIntoContext(properties: ContextProperties): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    const contextIndex = (target as ServicePrototype).MedusaContextIndex_?.[
      propertyKey
    ]
    if (contextIndex === undefined) {
      throw new Error(
        `To apply @InjectIntoContext you have to flag a parameter using @MedusaContext`
      )
    }

    const original = descriptor.value as ServiceMethod
    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      for (const key of Object.keys(properties)) {
        const context = ensureContext(args, contextIndex)
        context[key] =
          context[key] ??
          (typeof properties[key] === "function"
            ? properties[key].apply(this, args)
            : properties[key])
      }

      return await original.apply(this, args)
    }
  }
}

function ensureContext(
  args: unknown[],
  contextIndex: number
): Record<string, unknown> {
  const context = args[contextIndex]
  if (isRecord(context)) {
    return context
  }

  const newContext: Record<string, unknown> = {}
  args[contextIndex] = newContext
  return newContext
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}
