import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureNativeDateRecord, captureNativeRecord } from "../../value/native-record";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { projectRows } from "../../query/projection";
import { readCommerceRelationRows } from "../../query/relations";
import { compileKeyedUpdates } from "../../write/keyed";
import { OrderChangeId } from "./change-contracts";
import { compileOrderChangeCancellationContracts, OrderChangeCancellationMetadata } from "./change-cancellation-input";
import type { captureOrderMetadata } from "./schema";

const ids = Schema.Array(OrderChangeId).check(Schema.isLengthBetween(1, 1));
const lookup = Schema.Union([Schema.Struct({ id: Schema.Union([OrderChangeId, ids]) }),
  Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: OrderChangeId })).check(Schema.isLengthBetween(1, 1)) })]);
const fields = ["id", "status", "canceled_at", "canceled_by", "metadata", "order_id", "return_id", "claim_id", "exchange_id", "version"];
const decodeQuery = commerceDecoder(Schema.Struct({ where: lookup, options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.Literals(fields)).check(Schema.isLengthBetween(1, fields.length))),
  populate: Schema.Array(Schema.Never), orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literal("ASC")) })) }) }), "unsupportedProfile");
const patch = Schema.Struct({ id: OrderChangeId, status: Schema.Literals(["pending", "requested", "canceled"]),
  canceled_at: Schema.NullOr(Schema.String), canceled_by: Schema.optionalKey(Schema.NullOr(Schema.String)),
  metadata: Schema.optionalKey(OrderChangeCancellationMetadata) });
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: patch }))
  .check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
const decodeMode = commerceDecoder(Schema.Struct({ metadata: Schema.Literal("replace") }), "unsupportedProfile");
const decodeForeignPairs = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
const decodeObject = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** Bind only existing Changes. Native internal services own guard evaluation,
 * metadata preparation and event subscription; storage owns atomic settlement. */
export function prepareOrderChangeCancellationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileOrderChangeCancellationContracts(metadata), { table } = contracts;
    const scalar = yield* prepareScalarRepository(table, "OrderChange", scalarIdWhere, contracts.serialize);
    const columns = table.columns.map(column => column.name);
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => contracts.decodeRow(pair.entity).pipe(Result.map(entity => ({ key: entity.id, update: pair.update }))) });
    const query = (input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeQuery(input), plan = yield* scalar.query(envelope);
      return { ...plan, orderFilter: envelope.options.fields === undefined };
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      type Row = Result.Result.Success<ReturnType<typeof contracts.decodeRow>>;
      const originals = new Map<string, Row>();
      const find = Effect.fn("OrderChangeCancellation.find")(function* (ctx: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const envelope = yield* Effect.fromResult(decodeQuery(captured)), plan = yield* Effect.fromResult(query(captured));
        const selected = yield* bound.find(ctx, { where: envelope.where,
          options: { populate: [], fields: columns, orderBy: { id: "ASC" } } }, false);
        if (selected.rows.length > 1) return yield* ctx.refuse(commerceError("limitExceeded"));
        const complete: Row[] = [];
        for (const value of selected.rows) {
          const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(value)));
          if (row.deleted_at !== null) return yield* ctx.refuse(commerceError("storedCorruption"));
          complete.push(row);
        }
        const orders = plan.orderFilter && complete.length ? yield* readCommerceRelationRows(ctx, contracts.order.name,
          yield* Effect.fromResult(contracts.orderPredicate(complete))) : [];
        const rows = plan.orderFilter ? yield* Effect.fromResult(contracts.filterActiveOrderChanges(complete, orders)) : complete;
        for (const row of rows) originals.set(row.id, row);
        return structuredClone(yield* Effect.fromResult(projectRows(rows, plan.projection.node)));
      });
      const captureUpdate = Effect.fn("OrderChangeCancellation.captureUpdate")(function* (ctx: CommerceCommandContext, input: unknown,
        options: unknown) {
        const replace = options !== undefined;
        if (replace) yield* Effect.fromResult(captureCommerceInput(options, ctx.resources).pipe(Result.flatMap(decodeMode)));
        const normalized: JsonObject[] = [];
        for (const value of yield* Effect.fromResult(decodeForeignPairs(input))) {
          const pair = yield* captureNativeRecord(value), update = yield* captureNativeDateRecord(pair.update, ["canceled_at"]);
          normalized.push(yield* Effect.fromResult(captureCommerceInput({ ...pair, update }, ctx.resources).pipe(
            Result.flatMap(decodeObject))));
        }
        return { normalized, replace };
      });
      const update = Effect.fn("OrderChangeCancellation.update")(function* (ctx: CommerceCommandContext, normalized: unknown,
        shared: Parameters<DAL.RepositoryService["update"]>[1], replace: boolean) {
        const captured = yield* Effect.fromResult(captureCommerceInput(normalized, ctx.resources));
        const pairs = yield* Effect.fromResult(decodePairs(captured)), planned = yield* Effect.fromResult(updates(captured));
        for (const pair of pairs) {
          if (replace ? pair.update.status === "canceled" || pair.update.canceled_by === undefined :
            pair.update.status !== "canceled" || pair.update.canceled_at === null)
            return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const entity = yield* Effect.fromResult(contracts.decodeRow(pair.entity)), before = originals.get(entity.id);
          if (before === undefined || Object.entries(entity).some(([name, value]) =>
            name !== "metadata" && (before[name] === undefined || !jsonEqual(before[name], value))))
            return yield* ctx.refuse(commerceError("storedCorruption"));
          // The native merge preparation mutates entity.metadata only for a
          // nonempty submitted object. Its final patch is correlated with the
          // original command input by the logical receipt, without re-merging.
          if (replace || pair.update.metadata === undefined || pair.update.metadata === null) {
            if (before.metadata === undefined || entity.metadata === undefined || !jsonEqual(before.metadata, entity.metadata))
              return yield* ctx.refuse(commerceError("storedCorruption"));
          } else if (entity.metadata === undefined || before.metadata === undefined ||
            !jsonEqual(entity.metadata, before.metadata) && !jsonEqual(entity.metadata, pair.update.metadata))
            return yield* ctx.refuse(commerceError("storedCorruption"));
        }
        const stored = yield* (yield* ctx.table(table.name)).write(ctx.manager, "update", planned);
        if (stored.length !== 1 || stored[0] === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
        const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(stored[0]))), requested = pairs[0];
        if (requested === undefined || row.id !== requested.update.id) return yield* ctx.refuse(commerceError("storedCorruption"));
        if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        yield* events.rows("afterUpdate", "OrderChange", [row], shared);
        return structuredClone([row]);
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, find(ctx, value))),
        update: (input, shared, options) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* captureUpdate(ctx, input, options);
          return yield* update(ctx, captured.normalized, shared, captured.replace);
        }))) };
      return { ...bound, repository, denied };
    };
    return { bind, contracts, query, orderPredicate: contracts.orderPredicate, filterActiveOrderChanges: contracts.filterActiveOrderChanges };
  });
}
