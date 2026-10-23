import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { projectRows } from "../../query/projection";
import { readCommerceRelationRows } from "../../query/relations";
import { compileKeyedUpdates } from "../../write/keyed";
import { OrderChangeUpdateData, OrderChangeUpdateId, OrderChangeUpdateIds, OrderChangeUpdateFields,
  compileOrderChangeUpdateContracts } from "./change-update-input";
import type { captureOrderMetadata } from "./schema";

const lookup = Schema.Union([Schema.Struct({ id: OrderChangeUpdateIds }),
  Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: OrderChangeUpdateId })).check(Schema.isMaxLength(4)) })]);
const decodeQuery = commerceDecoder(Schema.Struct({ where: lookup, options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.Literals(OrderChangeUpdateFields)).check(Schema.isLengthBetween(1, OrderChangeUpdateFields.length))),
  populate: Schema.Array(Schema.Never), orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) }) }), "unsupportedProfile");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject,
  update: OrderChangeUpdateData })).check(Schema.isMaxLength(4)), "unsupportedProfile");
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** Genuine internal services own missing IDs, duplicate coalescing and selected
 * DTOs. This repository grants only scalar patches of already observed Changes. */
export function prepareOrderChangeUpdateRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileOrderChangeUpdateContracts(metadata), { table } = contracts;
    const scalar = yield* prepareScalarRepository(table, "OrderChange", scalarIdWhere, contracts.serialize);
    const columns = table.columns.map(column => column.name);
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => contracts.decodeRow(pair.entity).pipe(Result.map(entity => ({ key: entity.id, update: pair.update }))) });
    const query = (input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeQuery(input), plan = yield* scalar.query(envelope);
      return { ...plan, orderFilter: envelope.options.fields === undefined };
    });
    const orderPredicate = (rows: readonly JsonObject[]) => Result.gen(function* () {
      const ids = new Set<string>();
      for (const value of rows) ids.add((yield* contracts.decodeRow(value)).order_id);
      return { kind: "and", children: [{ kind: "in", column: "id", values: [...ids] },
        { kind: "isNull", column: "deleted_at" }] } satisfies JsonObject;
    });
    const filterActiveOrderChanges = (rows: readonly JsonObject[], orders: readonly JsonObject[]) => Result.gen(function* () {
      const active = new Map<string, Result.Result.Success<ReturnType<typeof contracts.decodeOrderRow>>>();
      for (const value of orders) {
        const row = yield* contracts.decodeOrderRow(projectNativeRow(value)), previous = active.get(row.id);
        if (previous !== undefined && !jsonEqual(previous, row)) return yield* Result.fail(commerceError("storedCorruption"));
        active.set(row.id, row);
      }
      const selected: Array<Result.Result.Success<ReturnType<typeof contracts.decodeRow>>> = [];
      for (const value of rows) {
        const row = yield* contracts.decodeRow(value);
        if (active.get(row.order_id)?.deleted_at === null) selected.push(row);
      }
      return selected;
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const originals = new Map<string, Result.Result.Success<ReturnType<typeof contracts.decodeRow>>>();
      const find = Effect.fn("OrderChangeUpdate.find")(function* (ctx: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const envelope = yield* Effect.fromResult(decodeQuery(captured)), plan = yield* Effect.fromResult(query(captured));
        const selected = yield* bound.find(ctx, { where: envelope.where,
          options: { populate: [], fields: columns, orderBy: { id: "ASC" } } }, false);
        if (selected.rows.length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
        const capturedRows: Array<Result.Result.Success<ReturnType<typeof contracts.decodeRow>>> = [];
        for (const value of selected.rows) {
          const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(value)));
          if (row.deleted_at !== null) return yield* ctx.refuse(commerceError("storedCorruption"));
          capturedRows.push(row);
        }
        // Native nonnullable Order filters participate in default entity reads;
        // explicit scalar workflow preimages do not join the owning Order.
        const orders = plan.orderFilter && capturedRows.length ? yield* readCommerceRelationRows(ctx, contracts.order.name,
          yield* Effect.fromResult(orderPredicate(capturedRows))) : [];
        const rows = plan.orderFilter ? yield* Effect.fromResult(filterActiveOrderChanges(capturedRows, orders)) : capturedRows;
        for (const row of rows) originals.set(row.id, row);
        return structuredClone(yield* Effect.fromResult(projectRows(rows, plan.projection.node)));
      });
      const update = Effect.fn("OrderChangeUpdate.update")(function* (ctx: CommerceCommandContext, input: unknown,
        shared: Parameters<DAL.RepositoryService["update"]>[1]) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const pairs = yield* Effect.fromResult(decodePairs(captured)), planned = yield* Effect.fromResult(updates(captured));
        for (const pair of pairs) {
          const before = yield* Effect.fromResult(contracts.decodeRow(pair.entity)), observed = originals.get(before.id);
          if (observed === undefined || !jsonEqual(observed, before)) return yield* ctx.refuse(commerceError("storedCorruption"));
        }
        // The selected native DAL treats an ID-only pair as a no-op. Explicit
        // same-value scalar assignments still write and emit their native event.
        const changes = planned.filter(patch => Object.keys(patch).some(name => name !== "id"));
        const stored = changes.length ? yield* (yield* ctx.table(table.name)).write(ctx.manager, "update", changes) : [];
        const written = new Map<string, JsonObject>();
        for (const value of stored) {
          const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(value)));
          if (written.has(row.id)) return yield* ctx.refuse(commerceError("storedCorruption"));
          written.set(row.id, row);
        }
        if (written.size !== changes.length) return yield* ctx.refuse(commerceError("storedCorruption"));
        if (changes.length) {
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.rows("afterUpdate", "OrderChange", [...written.values()], shared);
        }
        const result: JsonObject[] = [];
        for (const patch of planned) {
          const id = patch.id;
          if (typeof id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
          const row = written.get(id) ?? originals.get(id);
          if (row === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          yield* Effect.fromResult(contracts.decodeRow(row)); result.push(row);
        }
        return structuredClone(result);
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, find(ctx, value))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, update(ctx, value, shared))) };
      return { ...bound, repository, denied };
    };
    return { bind, contracts, query, orderPredicate, filterActiveOrderChanges };
  });
}
