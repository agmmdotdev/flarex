import { Effect, Schema } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import { captureCommerceInput } from "./commerce-input";
import { commerceDecoder } from "./commerce-decoder";
import { QueryEnvelope } from "./query-decoder";
import { readCommerceRelationRows } from "./commerce-relations";
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
 * Medusa owns association/dissociation; filtering consumes a complete bounded
 * scoped catalog, so exclusion cannot silently leave a later page attached. */
export const findCollectionMembershipProducts = Effect.fn("ProductAdapter.findCollectionMembers")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table" | "resources">, metadata: ProductRuntimeMetadata, input: unknown,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const envelope = yield* Effect.fromResult(decodeEnvelope(captured));
  const selector = yield* Effect.fromResult(decodeSelector(envelope.where));
  yield* Effect.fromResult(decodeOptions(envelope.options ?? {}));
  const excluded = "collection_id" in selector;
  const selected = new Set(excluded ? selector.id.$nin : selector.id.$in);
  const rows = yield* readCommerceRelationRows(ctx, metadata.product.table.name, {
    kind: "and", children: [
      { kind: "isNull", column: "deleted_at" },
      ...(excluded ? [{ kind: "in", column: "collection_id", values: [selector.collection_id] }] : []),
    ],
  });
  return rows.filter(row => typeof row.id === "string" && (excluded ? !selected.has(row.id) : selected.has(row.id)));
});

export const updateCollectionMembershipProducts = Effect.fn("ProductAdapter.updateCollectionMembers")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table">, metadata: ProductRuntimeMetadata, input: unknown,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const pairs = yield* Effect.fromResult(decodePairs(captured));
  const ids = new Set<string>();
  const updates: JsonObject[] = [];
  for (const pair of pairs) {
    const id = pair.entity.id;
    if (typeof id !== "string" || ids.has(id)) return yield* Effect.fail(commerceError("invalidInput"));
    ids.add(id);
    updates.push({ id, collection_id: pair.update.collection_id });
  }
  const store = yield* ctx.table(metadata.product.table.name);
  return yield* store.write(ctx.manager, "update", updates);
});
