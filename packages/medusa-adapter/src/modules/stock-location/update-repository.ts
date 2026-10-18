import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { prepareScalarRepository } from "../../repository/scalar";
import { compileKeyedUpdates } from "../../write/keyed";
import { executeRead } from "../../query/read";
import { prepareStockLocationUpdateReadPlan, stockLocationUpdateWhere, stockLocationAddressWhere } from "./update-read-plan";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeId = commerceDecoder(Id, "invalidInput");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })).check(Schema.isMaxLength(4)), "invalidInput");

/** The existing checked Address FK and shared complete-set/population mechanics
 * own reads. The named update profile grants only scalar writes to each model. */
export function prepareStockLocationUpdateRepository(table: SchemaTable, address: SchemaTable) {
  return Result.gen(function* () {
    if (!table.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "address_id" &&
      key.referencedTable === address.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id"))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const locations = yield* prepareScalarRepository(table, "StockLocation", stockLocationUpdateWhere);
    const addresses = yield* prepareScalarRepository(address, "StockLocationAddress", stockLocationAddressWhere);
    // The scalar repository intentionally exposes no relation metadata. This
    // module's checked FK owns Address population and native graph join fields.
    const reads = yield* prepareStockLocationUpdateReadPlan({ ...locations.table, foreignKeys: table.foreignKeys.flatMap(key => key.columns) },
      { ...addresses.table, foreignKeys: address.foreignKeys.flatMap(key => key.columns) });
    const keyedUpdates = (selected: SchemaTable) => compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => decodeId(pair.entity.id).pipe(Result.map(key => ({ key, update: pair.update }))),
      validateData: commerceRowDecoder(selected.columns.map(column => column.name).filter(name => !["id", "created_at", "updated_at", "deleted_at", "address_id"].includes(name)), "unsupportedProfile") });
    const locationUpdates = keyedUpdates(table), addressUpdates = keyedUpdates(address);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const locationBound = locations.bind(root, owner);
      const addressBound = addresses.bind(root, owner, locationBound.events);
      const { bridge, events } = locationBound;
      const find = (selected: SchemaTable) => Effect.fn("StockLocationRepository.findForUpdate")(function* (
        ctx: CommerceCommandContext, input: unknown, withCount: boolean,
      ) {
        const { plan } = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(input => reads.query(selected.name, input))));
        return yield* executeRead({ ...ctx, admitSelection: (_table, rows) => rows.length > 4
          ? Result.fail(commerceError("unsupportedProfile")) : Result.succeed(undefined) }, reads.catalog, plan, withCount);
      });
      const locationFind = find(table), addressFind = find(address);
      const repository = (selected: SchemaTable, bound: typeof locationBound, read: typeof locationFind, updates: typeof locationUpdates, model: string): DAL.RepositoryService => ({
        ...bound.repository,
        create: selected === address ? bound.repository.create : bound.refuse,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, read(ctx, captured, false)).pipe(Effect.map(value => structuredClone(value.rows)))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, read(ctx, captured, true)).pipe(Effect.flatMap(value =>
          value.count === undefined ? ctx.refuse(commerceError("storedCorruption")) : Effect.succeed([structuredClone(value.rows), value.count] satisfies [JsonObject[], number])))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const rows = yield* Effect.fromResult(updates(yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources))));
          const output = new Map<string, JsonObject>(), changed: JsonObject[] = [];
          for (const row of rows) {
            if (Object.keys(row).some(name => name !== "id")) { changed.push(row); continue; }
            const current = yield* read(ctx, { where: { id: row.id }, options: { filters: { softDeletable: { withDeleted: true } } } }, false);
            if (current.rows.length !== 1 || current.rows[0] === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
            output.set(yield* Effect.fromResult(decodeId(row.id)), current.rows[0]);
          }
          if (changed.length > 0) {
            const store = yield* ctx.table(selected.name);
            const updated = yield* store.write(ctx.manager, "update", changed);
            if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
            yield* events.rows("afterUpdate", model, updated.map(row => ({ ...row })), shared);
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
      });
      return { ...locationBound, repository: repository(table, locationBound, locationFind, locationUpdates, "StockLocation"),
        addressRepository: repository(address, addressBound, addressFind, addressUpdates, "StockLocationAddress") };
    };
    return { table: yield* reads.catalog.table(table.name), address: yield* reads.catalog.table(address.name), reads, bind };
  });
}
