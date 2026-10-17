import { Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { GraphReadDefinition } from "../../local-graph/model";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";

/** Named Store workflow projection only. Pinned Drizzle ignores dotted metadata
 * scalar paths, retains root identity, and populates complete children when no
 * child columns were selected (not an ID-only child projection). Ordinary read
 * projection admission remains strict in its existing owner. */
export function storeUpdatePreimageSelection(config: typeof NativePreimageConfig.Type, read: Pick<GraphReadDefinition, "table" | "paths">) {
  return Result.gen(function* () {
    if (read.table.name !== "store" || read.table.primaryKeys.length !== 1 || read.table.primaryKeys[0] !== "id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const paths = read.paths;
    for (const relation of config.relations ?? []) {
      const path = paths.find(path => path.path === relation);
      if (path === undefined || !["supported_currencies", "supported_locales"].includes(relation) || !path.many ||
        !path.table.columns.includes("id") || !path.table.columns.includes("store_id"))
        return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    if (config.select === undefined) return config;
    const fields: string[] = [];
    for (const field of config.select) {
      if (field.startsWith("metadata.")) continue;
      if (read.table.columns.includes(field)) fields.push(field);
      else {
        const path = paths.find(path => field.startsWith(path.path + ".") && path.table.columns.includes(field.slice(path.path.length + 1)));
        if (path === undefined || !(config.relations ?? []).includes(path.path)) return yield* Result.fail(commerceError("unsupportedProfile"));
        fields.push(field);
      }
    }
    for (const relation of config.relations ?? []) {
      const path = paths.find(path => path.path === relation);
      if (path === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      const nested = fields.some(field => field.startsWith(relation + "."));
      for (const field of nested ? [...path.table.primaryKeys, "store_id"] : path.table.columns) fields.push(relation + "." + field);
    }
    return nativePreimageSelection({ ...config, select: [...new Set(fields)] }, read);
  });
}
