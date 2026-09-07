export function isObject(obj: unknown): obj is object {
  return typeof obj === "object" && obj !== null && obj.constructor.name === "Object"
}
