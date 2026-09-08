/** Storage-independent helpers extracted from packages/database/drizzle/src/medusa.ts
 * at 48d5cc675e4e8bc821e22c20c88a751acc66fb5f. SQL and manager ownership remain
 * with the caller. Readonly parameter types do not change the pinned algorithms.
 */
export function hasChangedFields(
  current: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
  ignoredKeys: readonly string[] = []
): boolean {
  const ignored = new Set([...ignoredKeys, "created_at", "updated_at", "deleted_at"])
  return Object.entries(next).some(([key, value]) => {
    if (ignored.has(key)) return false
    return normalizeComparableValue(current[key]) !== normalizeComparableValue(value)
  })
}

function normalizeComparableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  return value
}

export function relationshipNotFoundMessage(field: string, value: string): string {
  return `You tried to set relationship ${field}: ${value}, but such entity does not exist`
}
