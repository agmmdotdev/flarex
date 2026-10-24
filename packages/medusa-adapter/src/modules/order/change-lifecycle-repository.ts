import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
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
import { OrderChangeId, type compileOrderChangeContracts } from "./change-contracts";

const ids = Schema.Array(OrderChangeId).check(Schema.isLengthBetween(1, 1));
const lookup = Schema.Union([Schema.Struct({ id: Schema.Union([OrderChangeId, ids]) }),
  Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: OrderChangeId })).check(Schema.isLengthBetween(1, 1)) })]);
const decodeMode = commerceDecoder(Schema.Struct({ metadata: Schema.Literal("replace") }), "unsupportedProfile");
const decodeForeignPairs = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
const decodeObject = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
type ChangeContracts = Pick<Result.Result.Success<ReturnType<typeof compileOrderChangeContracts>>,
  "table" | "order" | "decodeRow" | "orderPredicate" | "filterActiveOrderChanges"> & {
  readonly serialize: (input: Json) => Effect.Effect<Json, CommerceTransactionError>;
};
type ChangePair<Patch extends JsonObject & { readonly id: string }> = {
  readonly entity: JsonObject;
  readonly update: Patch;
};

/** One existing Change, one ordinary native update, and no creation methods.
 * The caller supplies its checked patch and date domain. Native services retain
 * eligibility, metadata preparation and subscribed module-event semantics. */
export function prepareOrderChangeLifecycleRepository<
  Contracts extends ChangeContracts,
  Patch extends JsonObject & { readonly id: string },
>(contracts: Contracts, profile: {
  readonly fields: readonly string[];
  readonly businessDate: string;
  readonly decodePairs: (input: unknown) => Result.Result<readonly ChangePair<Patch>[], CommerceTransactionError>;
  readonly acceptsPatch: (update: Patch, replace: boolean) => boolean;
}) {
  const fields = profile.fields;
  const decodeQuery = commerceDecoder(Schema.Struct({ where: lookup, options: Schema.Struct({
    fields: Schema.optionalKey(Schema.Array(Schema.Literals(fields)).check(Schema.isLengthBetween(1, fields.length))),
    populate: Schema.Array(Schema.Never), orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literal("ASC")) })) }) }), "unsupportedProfile");
  return Result.gen(function* () {
    const { table } = contracts;
    const scalar = yield* prepareScalarRepository(table, "OrderChange", scalarIdWhere, contracts.serialize);
    const columns = table.columns.map(column => column.name);
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: profile.decodePairs,
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
      const find = Effect.fn("OrderChangeLifecycle.find")(function* (ctx: CommerceCommandContext, input: unknown) {
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
      const captureUpdate = Effect.fn("OrderChangeLifecycle.captureUpdate")(function* (ctx: CommerceCommandContext, input: unknown,
        options: unknown) {
        const replace = options !== undefined;
        if (replace) yield* Effect.fromResult(captureCommerceInput(options, ctx.resources).pipe(Result.flatMap(decodeMode)));
        const normalized: JsonObject[] = [];
        for (const value of yield* Effect.fromResult(decodeForeignPairs(input))) {
          const pair = yield* captureNativeRecord(value), update = yield* captureNativeDateRecord(pair.update, [profile.businessDate]);
          normalized.push(yield* Effect.fromResult(captureCommerceInput({ ...pair, update }, ctx.resources).pipe(
            Result.flatMap(decodeObject))));
        }
        return { normalized, replace };
      });
      const update = Effect.fn("OrderChangeLifecycle.update")(function* (ctx: CommerceCommandContext, normalized: unknown,
        shared: Parameters<DAL.RepositoryService["update"]>[1], replace: boolean) {
        const captured = yield* Effect.fromResult(captureCommerceInput(normalized, ctx.resources));
        const pairs = yield* Effect.fromResult(profile.decodePairs(captured)), planned = yield* Effect.fromResult(updates(captured));
        for (const pair of pairs) {
          if (!profile.acceptsPatch(pair.update, replace))
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
