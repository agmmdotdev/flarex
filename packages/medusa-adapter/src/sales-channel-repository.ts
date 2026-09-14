import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder, commerceRowDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import type { ScalarFilter, WherePolicy } from "./query/predicate";
import { compileKeyedUpdates } from "./write/keyed";
import { prepareScalarRepository } from "./scalar-repository";
import type { captureSalesChannelMetadata } from "./sales-channel-schema";

type Metadata = Effect.Success<ReturnType<typeof captureSalesChannelMetadata>>["frame"];
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeId = commerceDecoder(Id, "invalidInput");
const decodeIds = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }), [Schema.Record(Schema.String, Schema.Json)])), "storedCorruption");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })).check(Schema.isMaxLength(256)), "invalidInput");
const decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const strings = commerceDecoder(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))]), "unsupportedProfile");
const wherePolicy: WherePolicy = {
  decode: decodeWhere,
  fields: new Map<string, ScalarFilter>([
    ["id", { column: "id", decode: strings, decodeNotEqual: commerceDecoder(Id, "unsupportedProfile") }], ["name", { column: "name", decode: strings }],
    ["is_disabled", { column: "is_disabled", decode: commerceDecoder(Schema.Boolean, "unsupportedProfile") }],
  ]),
  selectors: { mode: "membership", key: "id", decode: commerceDecoder(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(256)), "unsupportedProfile") },
};


/** Sales Channel explicitly extends scalar reads/creation with update/delete.
 * ShippingProfile does not inherit these module-owned operations. */
export function prepareSalesChannelRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const table = metadata.tables[0];
    if (metadata.tables.length !== 1 || table?.name !== "sales_channel") return yield* Result.fail(commerceError("unsupportedProfile"));
    const base = yield* prepareScalarRepository(table, "SalesChannel", wherePolicy);
    const decodeUpdate = commerceRowDecoder(table.columns.map(column => column.name)
      .filter(name => !["id", "created_at", "updated_at", "deleted_at"].includes(name)), "unsupportedProfile");
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => decodeId(pair.entity.id).pipe(Result.map(key => ({ key, update: pair.update }))), validateData: decodeUpdate });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = base.bind(root, owner);
      const { bridge, events, find } = bound;
      const repository: DAL.RepositoryService = {
        ...bound.repository,
        update: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
          const rows = yield* Effect.fromResult(updates(captured));
          const store = yield* ctx.table(table.name);
          const updated = yield* store.write(ctx.manager, "update", rows);
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.rows("afterUpdate", "SalesChannel", updated.map(row => ({ ...row })), shared);
          return [...updated];
        }))),
        delete: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* find(ctx, { where: input, options: { fields: ["id"], filters: { softDeletable: { withDeleted: true } } } }, false);
          const ids = yield* Effect.fromResult(decodeIds(selected.rows));
          const store = yield* ctx.table(table.name);
          const removed = yield* store.delete(ctx.manager, ids.map(row => ({ id: row.id })));
          return (yield* Effect.fromResult(decodeIds(removed))).map(row => row.id);
        }))),
      };
      return { ...bound, repository };
    };
    return { table: base.table, bind };
  });
}
