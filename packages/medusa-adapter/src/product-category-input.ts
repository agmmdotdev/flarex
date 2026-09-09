import { Effect, Schema } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import { commerceDecoder } from "./commerce-decoder";
import { readCommerceRelationRows } from "./commerce-relations";
const decodeRank = commerceDecoder(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), "invalidInput");

/** The pinned mpath algorithms require unambiguous IDs and an acyclic parent
 * relation. Reserve the source service's root-rank sentinel as well.
 * Authenticate proposed moves against this command's scoped catalog. */
export const validateCategoryCommand = Effect.fn("ProductCategory.validateCommand")(function* (
  ctx: CommerceCommandContext, metadata: ProductRuntimeMetadata, input: Json,
) {
  const entries = Array.isArray(input) ? input : [input];
  if (entries.length > 256) return yield* ctx.refuse(commerceError("limitExceeded"));
  const rows = yield* readCommerceRelationRows(ctx, metadata.category.table.name, { kind: "isNull", column: "deleted_at" });
  const parents = new Map<string, string | null>();
  for (const row of rows) {
    if (typeof row.id !== "string" || (row.parent_category_id !== null && typeof row.parent_category_id !== "string")) return yield* ctx.refuse(commerceError("storedCorruption"));
    parents.set(row.id, row.parent_category_id);
  }
  for (const entry of entries) {
    if (!isJsonObject(entry)) return yield* ctx.refuse(commerceError("invalidInput"));
    const id = entry.id, parent = entry.parent_category_id;
    if (id !== undefined && (typeof id !== "string" || id.length === 0 || (id.includes(".") || id === "__root__"))) return yield* ctx.refuse(commerceError("invalidInput"));
    if (parent !== undefined && parent !== null && (typeof parent !== "string" || parent.length === 0 || (parent.includes(".") || parent === "__root__"))) return yield* ctx.refuse(commerceError("invalidInput"));
    if (entry.rank !== undefined) yield* Effect.fromResult(decodeRank(entry.rank)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (typeof id !== "string" || parent === undefined) continue;
    if (parent !== null && typeof parent !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
    parents.set(id, parent);
    const visited = new Set<string>();
    let cursor: string | null | undefined = id;
    while (cursor !== null && cursor !== undefined) {
      if (visited.has(cursor)) return yield* ctx.refuse(commerceError("invalidInput"));
      visited.add(cursor);
      cursor = parents.get(cursor);
    }
  }
});
