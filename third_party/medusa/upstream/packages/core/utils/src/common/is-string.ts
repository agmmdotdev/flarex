export function isString(val: unknown): val is string {
  return val != null && typeof val === "string"
}
