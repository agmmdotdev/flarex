import { MedusaError } from "@medusajs/utils/common/errors"
type FetchQueryObject = { [key: string]: FetchQueryValue }
type FetchQueryValue = string | FetchQueryValue[] | FetchQueryObject
const invalidQuery = (message: string) => new MedusaError(MedusaError.Types.INVALID_DATA, message)
export function parseFetchQuery(
  searchParams: URLSearchParams
): Record<string, FetchQueryValue> {
  const query: FetchQueryObject = Object.create(null)

  let count = 0
  for (const [rawKey, value] of searchParams.entries()) {
    if (++count > 128) throw invalidQuery("Too many query parameters")
    assignFetchQueryValue(query, parseFetchQueryKey(rawKey), value)
  }

  return query
}

function parseFetchQueryKey(rawKey: string): string[] {
  const parts: string[] = []
  const matcher = /([^[\]]+)|\[([^\]]*)\]/g

  for (const match of rawKey.matchAll(matcher)) {
    const plainKey = match[1]
    if (plainKey) {
      parts.push(...plainKey.split(".").filter(Boolean))
      continue
    }

    parts.push(match[2] ?? "")
  }

  const path = parts.length > 0 ? parts : [rawKey]
  if (path.length > 8 || path.some((key) => ["__proto__", "prototype", "constructor"].includes(key) || (/^\d+$/.test(key) && Number(key) > 127))) throw invalidQuery("Unsupported query key")
  return path
}

function assignFetchQueryValue(
  target: FetchQueryObject,
  path: string[],
  value: string
): void {
  if (path.length === 0) {
    return
  }

  assignFetchQueryObjectValue(target, path, value)
}

function assignFetchQueryObjectValue(
  target: FetchQueryObject,
  path: string[],
  value: string
): void {
  const [key, ...rest] = path
  if (!key) {
    return
  }

  if (rest.length === 0) {
    target[key] = mergeFetchQueryScalar(target[key], value)
    return
  }

  if (isFetchQueryArrayKey(rest[0])) {
    const next = Array.isArray(target[key]) ? target[key] : []
    target[key] = next
    assignFetchQueryArrayValue(next, rest, value)
    return
  }

  const next = isFetchQueryObject(target[key]) ? target[key] : Object.create(null)
  target[key] = next
  assignFetchQueryObjectValue(next, rest, value)
}

function assignFetchQueryArrayValue(
  target: FetchQueryValue[],
  path: string[],
  value: string
): void {
  const [key, ...rest] = path
  const index = key === "" ? target.length : Number.parseInt(key, 10)
  if (!Number.isInteger(index) || index < 0) {
    return
  }

  if (rest.length === 0) {
    target[index] = mergeFetchQueryScalar(target[index], value)
    return
  }

  if (isFetchQueryArrayKey(rest[0])) {
    const next = Array.isArray(target[index]) ? target[index] : []
    target[index] = next
    assignFetchQueryArrayValue(next, rest, value)
    return
  }

  const next = isFetchQueryObject(target[index]) ? target[index] : Object.create(null)
  target[index] = next
  assignFetchQueryObjectValue(next, rest, value)
}

function mergeFetchQueryScalar(
  existing: FetchQueryValue | undefined,
  value: string
): FetchQueryValue {
  if (existing === undefined) {
    return value
  }

  return Array.isArray(existing) ? [...existing, value] : [existing, value]
}

function isFetchQueryArrayKey(key: string | undefined): boolean {
  return key === "" || (key !== undefined && /^\d+$/.test(key))
}

function isFetchQueryObject(
  value: FetchQueryValue | undefined
): value is FetchQueryObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

