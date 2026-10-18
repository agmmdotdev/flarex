import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
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
import { compileShippingOptionRuleContracts, ShippingOptionRuleIds, ShippingOptionRuleSelector, ShippingOptionRuleUpdate, ShippingOptionRuleCreate } from "./shipping-option-rule-input";
import { NativePreimageConfig } from "../../workflow/preimage";
import type { commerceMutationEvents } from "../../repository/mutation-events";
import { insertGraphRows } from "../../write/create";
import type { GraphCatalog } from "../../write/graph-model";
import { generateEntityId } from "@medusajs/framework/utils/portable";

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
export function prepareShippingOptionRuleRepository(metadata: Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"], profile: "batch" | "shipping-option-update" = "batch") {
  return Result.gen(function* () {
    const maximum = profile === "batch" ? 4 : 16;
    const Ids = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(maximum));
    // Four native upsert cohorts accumulate earlier updated Rule identities:
    // the private service delete selector contains 4 + 8 + 12 raw operands.
    const DeleteIds = profile === "batch" ? Ids : Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(24));
    const selector = profile === "batch" ? ShippingOptionRuleSelector : Schema.Struct({ id: Schema.optionalKey(Schema.Union([Id, Ids])),
      shipping_option_id: Schema.optionalKey(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(4))])) });
    const readInput = Schema.Struct({ filters: selector, config: Schema.optionalKey(NativePreimageConfig) });
    const create = profile === "batch" ? ShippingOptionRuleCreate : Schema.Struct({ ...ShippingOptionRuleCreate.fields,
      created_at: Schema.optionalKey(Schema.String), updated_at: Schema.optionalKey(Schema.String), deleted_at: Schema.optionalKey(Schema.NullOr(Schema.String)) });
    const creates = Schema.Array(create).pipe(Schema.mutable).check(Schema.isMaxLength(maximum));
    const updatesInput = Schema.Array(ShippingOptionRuleUpdate).pipe(Schema.mutable).check(Schema.isMaxLength(maximum));
    const inputs = { maximum, profile, creates, ids: DeleteIds, updates: updatesInput, read: readInput, selector,
      decodeCreates: commerceDecoder(creates, "invalidInput"), decodeIds: commerceDecoder(DeleteIds, "invalidInput"),
      decodeUpdates: commerceDecoder(updatesInput, "invalidInput"), decodeRead: commerceDecoder(readInput, "invalidInput") };
    const selectedWhere: WherePolicy = profile === "batch" ? where : { decode: commerceDecoder(selector, "unsupportedProfile"), fields: new Map([
      ["id", { column: "id", decode: commerceDecoder(Schema.Union([Id, Ids]), "unsupportedProfile") }],
      ["shipping_option_id", { column: "shipping_option_id", decode: commerceDecoder(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(4))]), "unsupportedProfile") }],
    ]) };
    const selectedDelete = profile === "batch" ? decodeSelection : commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(24)) }), "unsupportedProfile");
    const contracts = yield* compileShippingOptionRuleContracts(metadata, maximum), { table } = contracts;
    const reconstitutionCatalog: GraphCatalog = { entities: [{ table, model: "ShippingOptionRule", keyColumn: "id", prefix: "sorul" }],
      tables: [table], writablePivots: [], queryRelations: new Map(), decodeRow: () => Result.fail(commerceError("unsupportedProfile")),
      decodeReference: () => Result.fail(commerceError("unsupportedProfile")), decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")) };
    const scalar = yield* prepareScalarRepository(table, "ShippingOptionRule", selectedWhere,
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
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner, sharedEvents?: ReturnType<typeof commerceMutationEvents>) => {
      const bound = scalar.bind(root, owner, sharedEvents), { bridge, events } = bound;
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
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, profile === "batch" ? bound.createRows(ctx, value, shared) : Effect.gen(function* () {
          const supplied = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(inputs.decodeCreates)));
          const rows: JsonObject[] = supplied.map(row => ({ ...row, id: generateEntityId(row.id, "sorul") }));
          const result = yield* insertGraphRows(ctx, reconstitutionCatalog, new Map([[table.name, rows]]), { allowReconstitution: true });
          const output = yield* Effect.fromResult(contracts.decodeRows((result.get(table.name) ?? []).map(projectNativeRow)));
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.created(output.map(entity => ({ modelName: "ShippingOptionRule", entity })), shared);
          return structuredClone(output);
        }))),
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, find(ctx, value)).pipe(Effect.map(rows => structuredClone(rows)))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, update(ctx, value, shared))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(selectedDelete)));
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
          if (plan.rows(table).length > maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of plan.rows(table)) yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)));
          const result = yield* plan.apply();
          const deleted: string[] = [];
          for (const row of result.roots) deleted.push((yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)))).id);
          return deleted;
        }))),
      };
      return { ...bound, repository, denied };
    };
    return { bind, contracts, table: scalar.table, query: scalar.query, paths: [], inputs };
  });
}
