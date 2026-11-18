import { Effect, Schema } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "./runtime-metadata";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { QueryEnvelope } from "../../query/decoder";
import { executeRead } from "../../query/read";
import { compileProjection } from "../../query/projection";
import { scalarProjection } from "./read-profile";
const ids = Schema.Array(Schema.String).check(Schema.isMaxLength(256));
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({ populate: Schema.optionalKey(Schema.Tuple([])), orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) }), "unsupportedProfile");
const decodeSelector = commerceDecoder(Schema.Union([
  Schema.Struct({ id: Schema.Struct({ $in: ids }) }),
  Schema.Struct({ collection_id: Schema.String, id: Schema.Struct({ $nin: ids }) }),
]), "unsupportedProfile");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject,
  update: Schema.Struct({ collection_id: Schema.NullOr(Schema.String) }),
})).check(Schema.isMaxLength(256)), "unsupportedProfile");

/** Only the Collection mutation composition exposes these private DAL calls.
 * Medusa owns association/dissociation. Select requested IDs or one Collection
 * through declared indexes before applying the native exclusion semantics. */
export const findCollectionMembershipProducts = Effect.fn("ProductAdapter.findCollectionMembers")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table" | "resources">, metadata: ProductRuntimeMetadata, input: unknown,
  workflow = false,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const envelope = yield* Effect.fromResult(decodeEnvelope(captured));
  const selector = yield* Effect.fromResult(decodeSelector(envelope.where));
  yield* Effect.fromResult(decodeOptions(envelope.options ?? {}));
  const excluded = "collection_id" in selector;
  const selected = new Set(excluded ? selector.id.$nin : selector.id.$in);
  if (workflow && selected.size > 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
  if (!excluded && selected.size === 0) return [];
  const table = metadata.product.table.name;
  const projection = yield* Effect.fromResult(compileProjection(metadata.readCatalog, table, undefined, [], scalarProjection));
  const rows = (yield* executeRead(ctx, metadata.readCatalog, {
    table, projection, paths: [], relationFilters: [], ordering: new Map(), withDeleted: false,
    query: { predicate: { kind: "and", children: [
      { kind: "isNull", column: "deleted_at" },
      { kind: "in", column: excluded ? "collection_id" : "id",
        values: excluded ? [selector.collection_id] : [...selected] },
    ] } },
    window: { kind: "catalog", order: "id", select: rows => {
      if (workflow) return { rows, count: rows.length };
      const members = rows.filter(row => typeof row.id === "string" && (excluded ? !selected.has(row.id) : selected.has(row.id)));
      return { rows: members, count: members.length };
    } },
  }, false)).rows;
  // The exclusion is native selector semantics. Bound the complete prior set
  // first, including desired members which the exclusion would otherwise hide.
  if (workflow && rows.length > 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
  return workflow ? rows.filter(row => typeof row.id === "string" && (excluded ? !selected.has(row.id) : selected.has(row.id))) : rows;
});

export const updateCollectionMembershipProducts = Effect.fn("ProductAdapter.updateCollectionMembers")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table">, metadata: ProductRuntimeMetadata, input: unknown,
  workflow = false,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const pairs = yield* Effect.fromResult(decodePairs(captured));
  if (workflow && pairs.length > 32) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const ids = new Set<string>();
  const updates: JsonObject[] = [];
  for (const pair of pairs) {
    const id = pair.entity.id;
    if (typeof id !== "string" || !workflow && ids.has(id)) return yield* Effect.fail(commerceError("invalidInput"));
    ids.add(id);
    updates.push({ id, collection_id: pair.update.collection_id });
  }
  if (workflow && ids.size > 20) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const store = yield* ctx.table(metadata.product.table.name);
  if (workflow) {
    const rows: JsonObject[] = [];
    // Native internal service gathers every selector before this DAL call;
    // pinned Drizzle applies the resulting pairs in order, including repeated
    // entities. Core batches require unique keys, so each native pair is one
    // write against the same pending working set. No selection is recomputed.
    for (const update of updates) rows.push(...(yield* store.write(ctx.manager, "update", [update])));
    return rows;
  }
  return yield* store.write(ctx.manager, "update", updates);
});
