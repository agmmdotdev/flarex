export function isDate(value: unknown): boolean {
  if (
    !(value instanceof Date) &&
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return false
  }

  return !Number.isNaN(new Date(value).valueOf())
}
