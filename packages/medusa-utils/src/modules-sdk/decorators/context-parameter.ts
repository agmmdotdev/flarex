export function MedusaContext() {
  return function (
    target: object,
    propertyKey: string | symbol,
    parameterIndex: number
  ): void {
    const prototype = target as ServicePrototype
    prototype.MedusaContextIndex_ ??= {}
    prototype.MedusaContextIndex_[propertyKey] = parameterIndex
  }
}

MedusaContext.getIndex = function (
  target: ServicePrototype,
  propertyKey: string | symbol
): number | undefined {
  return target.MedusaContextIndex_?.[propertyKey]
}

export const MedusaContextType = "MedusaContext"

interface ServicePrototype {
  MedusaContextIndex_?: Record<string | symbol, number>
}
