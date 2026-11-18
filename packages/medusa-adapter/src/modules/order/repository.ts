import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { projectRows } from "../../query/projection";
import { compileKeyedUpdates } from "../../write/keyed";
import { OrderArchiveId, OrderArchiveIds, compileOrderStatusContracts, type OrderStatusProfile } from "./input";
import type { captureOrderMetadata } from "./schema";

const lookup = Schema.Union([Schema.Struct({ id: OrderArchiveIds }),
  Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: OrderArchiveId })).check(Schema.isMaxLength(4)) })]);
const decodeQuery = commerceDecoder(Schema.Struct({ where: lookup, options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Tuple([Schema.Literal("id"), Schema.Literal("status")])),
  populate: Schema.Array(Schema.Never), orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })),
}) }), "unsupportedProfile");
const pairDecoder = <Status extends Schema.ConstraintDecoder<string>>(status: Status) => commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject,
  update: Schema.Struct({ id: OrderArchiveId, status }),
})).check(Schema.isMaxLength(4)), "unsupportedProfile");
const archivePairs = pairDecoder(Schema.Literals(["archived", "completed", "canceled", "draft"]));
const completionPairs = pairDecoder(Schema.Literals(["completed", "pending", "draft", "archived", "requires_action"]));
type StatusPair = Result.Result.Success<ReturnType<typeof archivePairs>>[number]
  | Result.Result.Success<ReturnType<typeof completionPairs>>[number];
type StatusPairs = readonly StatusPair[];
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** Translate the native Order internal service's root lookups and status pairs.
 * Native selection, guards and missing-ID errors remain in that service. Shared
 * storage owns timestamps, constraints, scope confinement and settlement. */
export function prepareOrderArchiveRepository(metadata: Metadata) {
  return prepareOrderStatusRepository(metadata, "archive");
}

export function prepareOrderCompletionRepository(metadata: Metadata) {
  return prepareOrderStatusRepository(metadata, "complete");
}

function prepareOrderStatusRepository(metadata: Metadata, profile: OrderStatusProfile) {
  return Result.gen(function* () {
    const decodePairs: (input: unknown) => Result.Result<StatusPairs, CommerceTransactionError> =
      profile === "archive" ? archivePairs : completionPairs;
    const contracts = yield* compileOrderStatusContracts(metadata), { table } = contracts;
    const scalar = yield* prepareScalarRepository(table, "Order", scalarIdWhere, contracts.serialize);
    const columns = table.columns.map(column => column.name);
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => contracts.decodeRow(pair.entity).pipe(Result.map(entity => ({ key: entity.id, update: pair.update }))) });
    const query = (input: unknown) => decodeQuery(input).pipe(Result.flatMap(envelope => scalar.query(envelope)));
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const originals = new Map<string, Result.Result.Success<ReturnType<typeof contracts.decodeRow>>>();
      const find = Effect.fn("OrderStatus.find")(function* (ctx: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const envelope = yield* Effect.fromResult(decodeQuery(captured)), plan = yield* Effect.fromResult(query(captured));
        const selected = yield* bound.find(ctx, { where: envelope.where,
          options: { populate: [], fields: columns, orderBy: { id: "ASC" } } }, false);
        if (selected.rows.length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
        const rows: JsonObject[] = [];
        for (const value of selected.rows) {
          const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(value)));
          if (row.deleted_at !== null) return yield* ctx.refuse(commerceError("storedCorruption"));
          originals.set(row.id, row); rows.push(row);
        }
        return structuredClone(yield* Effect.fromResult(projectRows(rows, plan.projection.node)));
      });
      const update = Effect.fn("OrderStatus.update")(function* (ctx: CommerceCommandContext, input: unknown,
        shared: Parameters<DAL.RepositoryService["update"]>[1]) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const pairs = yield* Effect.fromResult(decodePairs(captured)), planned = yield* Effect.fromResult(updates(captured));
        const changes: JsonObject[] = [];
        for (const pair of pairs) {
          const before = yield* Effect.fromResult(contracts.decodeRow(pair.entity)), observed = originals.get(before.id);
          if (observed === undefined || !jsonEqual(observed, before)) return yield* ctx.refuse(commerceError("storedCorruption"));
          changes.push(pair.update);
        }
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
          yield* events.rows("afterUpdate", "Order", [...written.values()], shared);
        }
        const result: JsonObject[] = [];
        for (const patch of planned) {
          const id = patch.id;
          if (typeof id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
          const row = written.get(id) ?? originals.get(id);
          if (row === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          result.push(row);
        }
        return [...structuredClone(yield* Effect.fromResult(contracts.decodeStoredRows(result)))];
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, find(ctx, value))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, update(ctx, value, shared))),
      };
      return { ...bound, repository, denied };
    };
    return { bind, contracts, query };
  });
}
