// Pure native predicate-value normalization from the pinned Drizzle repository.
// Source authentication covers the function body; SQL and managers stay out.
export function coerceFilterValue(field: string, value: unknown): unknown {
  if (value === undefined) {
    return ""
  }

  if (
    typeof value === "string" &&
    (field.endsWith("_at") || field.endsWith("_date"))
  ) {
    return new Date(value)
  }

  return value
}
