import { Schema } from "effect";
import type { GraphReadDefinition } from "../local-graph/model";

export const NativePreimageConfig = Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(256))),
  relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(8))),
});

/** Pinned Drizzle's explicit-field preimage reads retain primary keys and
 * ignore DTO-only fields. Keep this compatibility at named workflow methods;
 * ordinary Product/Pricing reads retain strict projection admission. */
export function nativePreimageSelection(config: typeof NativePreimageConfig.Type, read: GraphReadDefinition,
  dtoOnlyRelations: readonly string[] = [],
) {
  // Only a named module view identifies its transient DTO paths. Unknown or
  // declared-but-unadmitted relationships still reach the strict DAL owner.
  const normalized = dtoOnlyRelations.length === 0 || config.relations === undefined ? config
    : { ...config, relations: config.relations.filter(relation => !dtoOnlyRelations.includes(relation)) };
  if (normalized.select === undefined) return normalized;
  const selected = new Set(read.table.primaryKeys);
  for (const field of normalized.select) {
    if (read.table.columns.includes(field)) selected.add(field);
    else {
      const path = read.paths.find(path => field.startsWith(path.path + ".") && path.table.columns.includes(field.slice(path.path.length + 1)));
      if (path !== undefined) selected.add(field);
    }
  }
  for (const relation of normalized.relations ?? []) {
    const path = read.paths.find(path => path.path === relation);
    if (path !== undefined && ![...selected].some(field => field.startsWith(relation + ".")))
      for (const key of path.table.primaryKeys) selected.add(relation + "." + key);
  }
  return { ...normalized, select: [...selected] };
}
