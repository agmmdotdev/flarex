export function prepareDateTimeValue(
  entityName: string,
  fieldName: string,
  value: unknown
): Date | null {
  if (value === null) {
    return null
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Cannot set invalid date for ${entityName}.${fieldName}.`)
    }

    return value
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date
    }
  }

  throw new Error(
    `Cannot set value ${String(value)} for ${entityName}.${fieldName}.`
  )
}
