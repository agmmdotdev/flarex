/**
 * Derives the serialized selector name for the current Flarex partition
 * routing contract.
 *
 * This is protocol metadata, not a generic casing helper. The `_id` spelling
 * and empty-suffix fallback are compatibility-significant Flarex conventions.
 */
export function selectorNameForPartitionField(field: string): string {
  if (field === "_id") return "byId";
  const suffix = field
    .split(/[^A-Za-z0-9]+/)
    .filter(part => part.length > 0)
    .map(part => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
  return suffix.length === 0 ? "byPartition" : `by${suffix}`;
}
