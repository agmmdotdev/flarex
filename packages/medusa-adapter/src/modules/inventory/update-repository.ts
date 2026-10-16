import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { ScalarId, scalarIdWhere } from "../../repository/scalar-id-read";
import { compileKeyedUpdates } from "../../write/keyed";
import { QueryEnvelope } from "../../query/decoder";
import { InventoryItemUpdate } from "./update-input";

const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const decodeId = commerceDecoder(ScalarId, "invalidInput");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })).check(Schema.isMaxLength(4)), "invalidInput");
const decodePatch = commerceDecoder(InventoryItemUpdate, "unsupportedProfile");

/** The native internal service owns deduplication, metadata merge and missing
 * errors. This extension persists its unique keyed pairs and skips empty data. */
export function prepareInventoryItemUpdateRepository(table: SchemaTable) {
  return Result.gen(function* () {
    const base = yield* prepareScalarRepository(table, "InventoryItem", scalarIdWhere);
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => decodeId(pair.entity.id).pipe(Result.flatMap(key => decodePatch({ ...pair.update, id: key })
        .pipe(Result.map(() => ({ key, update: pair.update }))))),
    });
    const bind = (...args: Parameters<typeof base.bind>) => {
      const bound = base.bind(...args), { bridge, events } = bound;
      const find = Effect.fn("InventoryItemRepository.findForUpdate")(function* (ctx: Parameters<typeof bound.find>[0], input: unknown, count: boolean) {
        const selected = yield* bound.find(ctx, input, count);
        if (selected.rows.length > 4 || selected.count !== undefined && selected.count > 4)
          return yield* ctx.refuse(commerceError("unsupportedProfile"));
        const envelope = yield* Effect.fromResult(decodeEnvelope(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
        const where = yield* Effect.fromResult(decodeWhere(envelope.where ?? {}));
        return { ...selected, rows: preservePrimaryKeyOrFilterOrder(selected.rows, where, ["id"], [["id", "ASC"]]) };
      });
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, captured, false)).pipe(Effect.map(value => structuredClone(value.rows)))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const rows = yield* Effect.fromResult(updates(yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources))));
          const changed: JsonObject[] = [], output = new Map<string, JsonObject>();
          for (const row of rows) {
            if (Object.keys(row).some(field => field !== "id")) { changed.push(row); continue; }
            const current = yield* find(ctx, { where: { id: row.id }, options: { filters: { softDeletable: { withDeleted: true } } } }, false);
            if (current.rows.length !== 1 || current.rows[0] === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
            output.set(yield* Effect.fromResult(decodeId(row.id)), current.rows[0]);
          }
          if (changed.length > 0) {
            const store = yield* ctx.table(table.name), updated = yield* store.write(ctx.manager, "update", changed);
            if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
            yield* events.rows("afterUpdate", "InventoryItem", updated.map(row => ({ ...row })), shared);
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
      };
      return { ...bound, repository, denied };
    };
    return { bind };
  });
}
