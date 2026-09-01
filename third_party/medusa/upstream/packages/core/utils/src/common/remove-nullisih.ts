import { isDefined } from "./is-defined"

export function removeNullish<T = unknown>(
  obj: Record<string, T>
): Record<string, T> {
  const resultObject: Record<string, T> = {}

  for (const [currentKey, currentValue] of Object.entries(obj)) {
    if (!isDefined(currentValue) || currentValue === null) {
      continue
    }

    resultObject[currentKey] = currentValue
  }

  return resultObject
}
