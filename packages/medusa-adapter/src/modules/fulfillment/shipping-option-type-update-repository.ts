import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { deniedCommerceRepository } from "../../repository/denied";
import { prepareScalarRepository } from "../../repository/scalar";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileKeyedUpdates } from "../../write/keyed";
import { projectRows } from "../../query/projection";
import type { WherePolicy } from "../../query/predicate";
import { QueryEnvelope } from "../../query/decoder";
import type { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { compileShippingOptionTypeUpdateContracts, ShippingOptionTypeUpdateData, ShippingOptionTypeUpdateSelector, decodeShippingOptionTypeUpdateUpserts } from "./shipping-option-type-update-input";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeId = commerceDecoder(Id, "invalidInput");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }))
  .check(Schema.isMaxLength(4)), "unsupportedProfile");
const decodeData = commerceDecoder(Schema.Struct({ label: ShippingOptionTypeUpdateData.fields.label,
  description: ShippingOptionTypeUpdateData.fields.description, code: ShippingOptionTypeUpdateData.fields.code }), "unsupportedProfile");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const where: WherePolicy = {
  decode: commerceDecoder(Schema.Union([ShippingOptionTypeUpdateSelector,
    Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)) })]), "unsupportedProfile"),
  fields: new Map([["id", { column: "id", decode: commerceDecoder(Schema.Union([Id,
    Schema.Array(Id).check(Schema.isMaxLength(4))]), "unsupportedProfile") }]]),
  selectors: { mode: "membership", key: "id", decode: commerceDecoder(Schema.Array(Schema.Struct({ id: Id }))
    .check(Schema.isMaxLength(4)), "unsupportedProfile") },
};

/** This separate update admission retains shared scalar read, serialization,
 * keyed planning and event owners, without lifecycle/sibling authority. */
export function prepareShippingOptionTypeUpdateRepository(metadata: Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"]) {
  return Result.gen(function* () {
    const contracts = yield* compileShippingOptionTypeUpdateContracts(metadata), { table } = contracts;
    const scalar = yield* prepareScalarRepository(table, "ShippingOptionType", where,
      Effect.fn("ShippingOptionTypeUpdate.serialize")(function* (value: Json) {
        if (Array.isArray(value)) return yield* Effect.fromResult(contracts.decodeSerializedRows(value));
        const rows = yield* Effect.fromResult(contracts.decodeSerializedRows([value]));
        const row = rows[0];
        if (row === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
        return row;
      }));
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => Result.gen(function* () {
        const before = yield* contracts.decodeRow(projectNativeRow(pair.entity));
        const key = yield* decodeId(before.id);
        return { key, update: pair.update };
      }), validateData: decodeData });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = Effect.fn("ShippingOptionTypeUpdate.find")(function* (ctx: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const envelope = yield* Effect.fromResult(decodeEnvelope(captured));
        const plan = yield* Effect.fromResult(scalar.query(captured));
        if (plan.withDeleted || plan.paths.length || plan.query.skip !== 0 || plan.query.take !== undefined || plan.query.order.direction !== "asc")
          return yield* ctx.refuse(commerceError("unsupportedProfile"));
        const options = yield* Effect.fromResult(decodeOptions(envelope.options ?? {}));
        // The named boundary validates the full native DML row before applying
        // a requested workflow preimage projection. No projected row is treated
        // as a complete current entity for a subsequent native update.
        const found = yield* bound.find(ctx, { where: envelope.where, options: { ...options,
          fields: table.columns.map(column => column.name) } }, false);
        const rows = yield* Effect.fromResult(contracts.decodeRows(found.rows));
        return yield* Effect.fromResult(projectRows(orderNativeIdRows(rows, envelope.where), plan.projection.node));
      });
      const upsertRows = Effect.fn("ShippingOptionTypeUpdate.upsert")(function* (
        ctx: CommerceCommandContext, captured: unknown, shared: Parameters<DAL.RepositoryService["upsert"]>[1],
      ) {
          const entries = yield* Effect.fromResult(decodeShippingOptionTypeUpdateUpserts(captured));
          const store = yield* ctx.table(table.name), output: JsonObject[] = [];
          for (const entry of entries) {
            // Native DAL reads physical rows, including tombstones, before each
            // individual upsert. Repeated IDs therefore see the prior entry.
            const found = yield* store.find(ctx.manager, { take: ctx.resources.queryRows,
              order: { column: "id", direction: "asc" }, predicate: { kind: "in", column: "id", values: [entry.id] } });
            if (found.length > 1) return yield* ctx.refuse(commerceError("storedCorruption"));
            const previous = found[0] === undefined ? undefined : yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(found[0])));
            const written = yield* store.write(ctx.manager, "upsertPreservingDeletion", [entry]);
            const rows = yield* Effect.fromResult(contracts.decodeUpsertRows(written.map(projectNativeRow)));
            if (rows.length !== 1) return yield* ctx.refuse(commerceError("storedCorruption"));
            if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
            yield* events.rows(previous === undefined ? "afterCreate" : "afterUpdate", "ShippingOptionType",
              rows.map(row => ({ ...row })), shared,
              previous === undefined ? undefined : row => ({ entity: { ...row, deleted_at: row.deleted_at },
                originalEntity: { ...previous, deleted_at: previous.deleted_at } }));
            output.push(...rows);
          }
          return structuredClone(output);
      });
      const updateRows = Effect.fn("ShippingOptionTypeUpdate.update")(function* (
        ctx: CommerceCommandContext, captured: unknown, shared: Parameters<DAL.RepositoryService["update"]>[1],
      ) {
          const entries = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources).pipe(Result.flatMap(decodePairs)));
          const planned = yield* Effect.fromResult(updates(entries));
          const changed = planned.filter(row => Object.keys(row).some(field => field !== "id"));
          const stored = changed.length === 0 ? [] : yield* (yield* ctx.table(table.name)).write(ctx.manager, "update", changed);
          const output = yield* Effect.fromResult(contracts.decodeRows(stored.map(projectNativeRow)));
          if (changed.length) {
            if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
            yield* events.rows("afterUpdate", "ShippingOptionType", output.map(row => ({ ...row })), shared);
          }
          const byId = new Map(output.map(row => [row.id, row]));
          const complete: JsonObject[] = [];
          for (const [index, pair] of entries.entries()) {
            const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(pair.entity)));
            const plan = planned[index];
            if (plan === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
            if (Object.keys(plan).length === 1) complete.push(row);
            else {
              const after = byId.get(row.id);
              if (after === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
              complete.push(after);
            }
          }
          return structuredClone(complete);
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) =>
          bridge.checked(ctx, find(ctx, captured)).pipe(Effect.map(rows => structuredClone(rows)))),
        upsert: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, upsertRows(ctx, captured, shared))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, updateRows(ctx, captured, shared))),
      };
      return { ...bound, repository, denied };
    };
    return { bind, table: scalar.table, paths: [], query: scalar.query, contracts };
  });
}
