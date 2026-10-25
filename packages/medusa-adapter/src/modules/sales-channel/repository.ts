import { Effect, Result, Schema } from "effect";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { ScalarFilter, WherePolicy } from "../../query/predicate";
import { compileKeyedUpdates } from "../../write/keyed";
import { prepareScalarRepository } from "../../repository/scalar";
import type { captureSalesChannelMetadata } from "./schema";
import { QueryEnvelope } from "../../query/decoder";
import { medusaLifecycle } from "../../repository/lifecycle";
import { compileSalesChannelDeletionContracts, decodeSalesChannelDeletionIds } from "./delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureSalesChannelMetadata>>["frame"];
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeId = commerceDecoder(Id, "invalidInput");
const decodeIds = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }), [Schema.Record(Schema.String, Schema.Json)])), "storedCorruption");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })).check(Schema.isMaxLength(256)), "invalidInput");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
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
    const lifecycleContracts = yield* compileSalesChannelDeletionContracts(table);
    const decodeUpdate = commerceRowDecoder(table.columns.map(column => column.name)
      .filter(name => !["id", "created_at", "updated_at", "deleted_at"].includes(name)), "unsupportedProfile");
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => decodeId(pair.entity.id).pipe(Result.map(key => ({ key, update: pair.update }))), validateData: decodeUpdate });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner, profile: "standard" | "updateWorkflow" | "deleteWorkflow" = "standard") => {
      const bound = base.bind(root, owner);
      const { bridge, events } = bound;
      const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          if (profile !== "deleteWorkflow") return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const ids = yield* Effect.fromResult(decodeSalesChannelDeletionIds(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
          const owner = medusaLifecycle(ctx, { tables: [table], entities: [{ table, model: "SalesChannel" }] }, operation);
          const roots = yield* owner.roots(table, ids);
          for (const row of roots) yield* Effect.fromResult(lifecycleContracts.decodeRow(row));
          const result = yield* (yield* owner.plan(table, roots)).apply();
          for (const row of result.roots) yield* Effect.fromResult(lifecycleContracts.decodeRow(row));
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          // Pinned restore uses the conventional aggregator without registering
          // an internal subscriber, including selected already-active rows.
          yield* events.cascades(result.cascades, shared, row => ({ entity: row,
            originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
          return [result.roots, result.cascades] satisfies [object[], Record<string, unknown[]>];
        })));
      const find = Effect.fn("SalesChannelRepository.findForProfile")(function* (ctx: CommerceCommandContext, input: unknown, withCount: boolean) {
        const result = yield* bound.find(ctx, input, withCount);
        if (profile !== "updateWorkflow") return result;
        // The native selector service lists the complete match set before any
        // keyed updates. A fifth row refuses the whole root, never a page tail.
        if (result.rows.length > 4 || result.count !== undefined && result.count > 4)
          return yield* ctx.refuse(commerceError("unsupportedProfile"));
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const envelope = yield* Effect.fromResult(decodeEnvelope(captured));
        const where = yield* Effect.fromResult(decodeWhere(envelope.where ?? {}));
        return { ...result, rows: preservePrimaryKeyOrFilterOrder(result.rows, where, ["id"], [["id", "ASC"]]) };
      });
      const repository: DAL.RepositoryService = {
        ...bound.repository,
        softDelete: lifecycle("softDelete"), restore: lifecycle("restore"),
        find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, find(ctx, input, false)).pipe(Effect.map(value => structuredClone(value.rows)))),
        findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, find(ctx, input, true)).pipe(Effect.flatMap(value =>
          value.count === undefined ? ctx.refuse(commerceError("storedCorruption")) : Effect.succeed(
            [structuredClone(value.rows), value.count] satisfies [JsonObject[], number])))),
        update: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
          const rows = yield* Effect.fromResult(updates(captured));
          if (profile === "updateWorkflow" && rows.length > 4) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const output = new Map<string, JsonObject>();
          const changed: JsonObject[] = [];
          for (const row of rows) {
            const id = yield* Effect.fromResult(decodeId(row.id));
            if (Object.keys(row).some(name => name !== "id")) { changed.push(row); continue; }
            // Pinned Drizzle reads the existing entity but skips root UPDATE
            // and afterUpdate dispatch when scalar update data is empty.
            const existing = yield* find(ctx, { where: { id }, options: {
              filters: { softDeletable: { withDeleted: true } },
            } }, false);
            const current = existing.rows[0];
            if (existing.rows.length !== 1 || current === undefined)
              return yield* ctx.refuse(commerceError("invalidInput"));
            output.set(id, current);
          }
          if (changed.length > 0) {
            const store = yield* ctx.table(table.name);
            const updated = yield* store.write(ctx.manager, "update", changed);
            if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
            yield* events.rows("afterUpdate", "SalesChannel", updated.map(row => ({ ...row })), shared);
            for (const row of updated) output.set(yield* Effect.fromResult(decodeId(row.id)), row);
          }
          const result: JsonObject[] = [];
          for (const row of rows) {
            const current = output.get(yield* Effect.fromResult(decodeId(row.id)));
            if (current === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
            result.push(current);
          }
          return result;
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
    return { table: base.table, query: base.query, bind };
  });
}
