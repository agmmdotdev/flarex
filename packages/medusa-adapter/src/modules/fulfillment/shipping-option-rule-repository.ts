import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileKeyedUpdates } from "../../write/keyed";
import { projectRows } from "../../query/projection";
import { QueryEnvelope } from "../../query/decoder";
import type { WherePolicy } from "../../query/predicate";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { compileShippingOptionRuleContracts, ShippingOptionRuleIds, ShippingOptionRuleSelector, ShippingOptionRuleUpdate } from "./shipping-option-rule-input";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Or = Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)) });
const decodeSelection = commerceDecoder(Or, "unsupportedProfile");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }))
  .check(Schema.isMaxLength(4)), "unsupportedProfile");
const decodeData = commerceDecoder(Schema.Struct({ attribute: ShippingOptionRuleUpdate.fields.attribute,
  operator: ShippingOptionRuleUpdate.fields.operator, value: ShippingOptionRuleUpdate.fields.value,
  shipping_option_id: ShippingOptionRuleUpdate.fields.shipping_option_id }), "unsupportedProfile");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const where: WherePolicy = { decode: commerceDecoder(Schema.Union([ShippingOptionRuleSelector, Or]), "unsupportedProfile"),
  fields: new Map([["id", { column: "id", decode: commerceDecoder(Schema.Union([Id, ShippingOptionRuleIds]), "unsupportedProfile") }]]),
  selectors: { mode: "membership", key: "id", decode: commerceDecoder(Or.fields.$or, "unsupportedProfile") } };

/** A single Rule repository borrows shared scalar reads/inserts, keyed updates
 * and physical lifecycle deletion. Required Option FKs remain core-owned. */
export function prepareShippingOptionRuleRepository(metadata: Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"]) {
  return Result.gen(function* () {
    const contracts = yield* compileShippingOptionRuleContracts(metadata), { table } = contracts;
    const scalar = yield* prepareScalarRepository(table, "ShippingOptionRule", where,
      Effect.fn("ShippingOptionRule.serialize")(function* (value: Json) {
        if (Array.isArray(value)) return yield* Effect.fromResult(contracts.decodeSerializedRows(value));
        const rows = yield* Effect.fromResult(contracts.decodeSerializedRows([value]));
        if (rows[0] === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
        return rows[0];
      }));
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => Result.gen(function* () {
        const row = yield* contracts.decodeRow(projectNativeRow(pair.entity));
        return { key: row.id, update: pair.update };
      }), validateData: decodeData });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = Effect.fn("ShippingOptionRule.find")(function* (ctx: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const envelope = yield* Effect.fromResult(decodeEnvelope(captured));
        const plan = yield* Effect.fromResult(scalar.query(captured));
        if (plan.withDeleted || plan.paths.length || plan.query.skip !== 0 || plan.query.take !== undefined || plan.query.order.direction !== "asc")
          return yield* ctx.refuse(commerceError("unsupportedProfile"));
        const options = yield* Effect.fromResult(decodeOptions(envelope.options ?? {}));
        const found = yield* bound.find(ctx, { where: envelope.where, options: { ...options, fields: table.columns.map(column => column.name) } }, false);
        const rows = yield* Effect.fromResult(contracts.decodeRows(found.rows));
        return yield* Effect.fromResult(projectRows(orderNativeIdRows(rows, envelope.where), plan.projection.node));
      });
      const update = Effect.fn("ShippingOptionRule.update")(function* (ctx: CommerceCommandContext, input: unknown,
        shared: Parameters<DAL.RepositoryService["update"]>[1]) {
        const entries = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodePairs)));
        const planned = yield* Effect.fromResult(updates(entries));
        const stored = planned.length === 0 ? [] : yield* (yield* ctx.table(table.name)).write(ctx.manager, "update", planned);
        const output = yield* Effect.fromResult(contracts.decodeRows(stored.map(projectNativeRow)));
        if (planned.length) {
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.rows("afterUpdate", "ShippingOptionRule", output.map(row => ({ ...row })), shared);
        }
        return structuredClone(output);
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, bound.createRows(ctx, value, shared))),
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, find(ctx, value)).pipe(Effect.map(rows => structuredClone(rows)))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, update(ctx, value, shared))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(decodeSelection)));
          const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: [{ table, model: "ShippingOptionRule" }] }, "delete");
          const ids = selected.$or.map(row => row.id);
          // Native SQLite DELETE RETURNING announces physical insertion order,
          // independently of requested-ID/preimage projection order. Reuse the
          // existing authenticated order capability and lifecycle's cached store.
          const roots = ids.length === 0 ? [] : yield* (yield* lifecycle.getStore(table)).find(ctx.manager, {
            take: ctx.resources.queryRows, order: { kind: "storageInsertion", direction: "asc" },
            predicate: { kind: "in", column: "id", values: ids },
          });
          const plan = yield* lifecycle.plan(table, roots);
          if (plan.rows(table).length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of plan.rows(table)) yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)));
          const result = yield* plan.apply();
          const deleted: string[] = [];
          for (const row of result.roots) deleted.push((yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)))).id);
          return deleted;
        }))),
      };
      return { ...bound, repository, denied };
    };
    return { bind, contracts, table: scalar.table, query: scalar.query, paths: [] };
  });
}
