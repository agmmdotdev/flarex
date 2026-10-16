import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { prepareScalarRepository } from "../../repository/scalar";
import { compileKeyedUpdates } from "../../write/keyed";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { compileWhere, type ScalarFilter, type WherePolicy } from "../../query/predicate";
import { executeRead } from "../../query/read";
import { QueryEnvelope, QueryLimit, QueryOffset } from "../../query/decoder";
import type { CommerceRelations } from "../../query/relations";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeId = commerceDecoder(Id, "invalidInput");
const strings = commerceDecoder(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(4))]), "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })).check(Schema.isMaxLength(4)), "invalidInput");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(256))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(1))),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }) })),
}), "unsupportedProfile");
const scalarProjection: ProjectionPolicy = { keys: "selected", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };

/** The existing checked Address FK and shared complete-set/population mechanics
 * own reads. The named update profile grants only scalar writes to each model. */
export function prepareStockLocationUpdateRepository(table: SchemaTable, address: SchemaTable) {
  return Result.gen(function* () {
    if (!table.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "address_id" &&
      key.referencedTable === address.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id"))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const where = (fields: readonly string[]): WherePolicy => ({ decode: decodeWhere,
      fields: new Map<string, ScalarFilter>(fields.map(column => [column, { column, decode: strings }])),
      selectors: { mode: "membership", key: "id", decode: commerceDecoder(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)), "unsupportedProfile") } });
    const locationWhere = where(["id", "name"]), addressWhere = where(["id"]);
    const locations = yield* prepareScalarRepository(table, "StockLocation", locationWhere);
    const addresses = yield* prepareScalarRepository(address, "StockLocationAddress", addressWhere);
    const relations: CommerceRelations = new Map([[table.name, new Map([["address", {
      name: "address", targetTable: address.name, sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
      join: { type: "belongsTo", foreignKeys: ["address_id"] },
    }]])]]);
    const catalog = yield* makeReadCatalog([locations.table, addresses.table], relations);
    const projection: ProjectionPolicy = { ...scalarProjection, keys: "retainWhenNested", joinKeys: "retainWhenNested", nullToOne: true,
      allowedPaths: ["address"], selectableRelations: ["address"], nested: new Map([["address", { ...scalarProjection, keys: "retain" }]]) };
    const keyedUpdates = (selected: SchemaTable) => compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => decodeId(pair.entity.id).pipe(Result.map(key => ({ key, update: pair.update }))),
      validateData: commerceRowDecoder(selected.columns.map(column => column.name).filter(name => !["id", "created_at", "updated_at", "deleted_at", "address_id"].includes(name)), "unsupportedProfile") });
    const locationUpdates = keyedUpdates(table), addressUpdates = keyedUpdates(address);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const locationBound = locations.bind(root, owner);
      const addressBound = addresses.bind(root, owner, locationBound.events);
      const { bridge, events } = locationBound;
      const find = (selected: SchemaTable, policy: WherePolicy) => Effect.fn("StockLocationRepository.findForUpdate")(function* (
        ctx: CommerceCommandContext, input: unknown, withCount: boolean,
      ) {
        const envelope = yield* Effect.fromResult(decodeEnvelope(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
        const where = yield* Effect.fromResult(decodeWhere(envelope.where ?? {}));
        const options = yield* Effect.fromResult(decodeOptions(envelope.options ?? {}));
        const paths = options.populate ?? [];
        const fieldProjection = yield* Effect.fromResult(compileProjection(catalog, selected.name, options.fields, paths,
          selected === table ? projection : { ...scalarProjection, allowedPaths: [] }));
        const predicate = yield* Effect.fromResult(compileWhere(where, policy));
        const withDeleted = options.filters?.softDeletable.withDeleted ?? false;
        const reverse = options.orderBy?.id === "DESC";
        const result = yield* executeRead({ ...ctx, admitSelection: (_table, rows) => rows.length > 4
          ? Result.fail(commerceError("unsupportedProfile")) : Result.succeed(undefined) }, catalog, {
          table: selected.name, projection: fieldProjection, paths, relationFilters: [], ordering: new Map(), withDeleted,
          query: { fields: fieldProjection.storageFields, order: { column: "id", direction: reverse ? "desc" : "asc" },
            predicate: { kind: "and", children: [predicate, ...(withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }])] } },
          window: { kind: "catalog", order: "id", select: rows => {
            const ordered = preservePrimaryKeyOrFilterOrder(reverse ? [...rows].reverse() : [...rows], where, ["id"], [["id", reverse ? "DESC" : "ASC"]]);
            const offset = options.offset ?? 0;
            return { rows: ordered.slice(offset, options.limit === undefined ? undefined : offset + options.limit), count: rows.length };
          } },
        }, withCount);
        return result;
      });
      const locationFind = find(table, locationWhere), addressFind = find(address, addressWhere);
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
    return { table: locations.table, address: addresses.table, bind };
  });
}
