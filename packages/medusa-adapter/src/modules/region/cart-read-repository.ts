import { Effect, Result, Schema } from "effect";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { makeReadCatalog } from "../../query/catalog";
import { executeRead, type ReadPlan } from "../../query/read";
import { QueryEnvelope, QueryLimit, QueryOffset } from "../../query/decoder";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileRegionCartReadContracts, RegionCartFilters, RegionCartId, regionCartCountryLimit } from "./cart-read-input";
import { regionReadLimit } from "./input";
import type { captureRegionMetadata } from "./schema";

const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile"), decodeFilters = commerceDecoder(RegionCartFilters, "unsupportedProfile");
const where: WherePolicy = { decode: decodeFilters, fields: new Map([["id", { column: "id", decode: commerceDecoder(Schema.Union([Schema.Null, RegionCartId,
  Schema.Array(RegionCartId).check(Schema.isMaxLength(regionReadLimit))]), "unsupportedProfile") }]]) };
const decodeOptions = commerceDecoder(Schema.Struct({ fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 64))),
  populate: Schema.optionalKey(Schema.Array(Schema.Literal("countries")).check(Schema.isMaxLength(1))),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(false) }) })),
}), "unsupportedProfile");

export function prepareRegionCartReadRepository(metadata: Effect.Success<ReturnType<typeof captureRegionMetadata>>["frame"]) {
  return Result.gen(function* () {
    const contracts = yield* compileRegionCartReadContracts(metadata), scalar = yield* prepareScalarRepository(contracts.table, "Region", where);
    const catalog = yield* makeReadCatalog([contracts.table, contracts.country].map(table => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: table.columns.filter(column => column.primaryKey).map(column => column.name),
      foreignKeys: table.foreignKeys.flatMap(key => key.columns), companions: {} })), contracts.relations);
    const leaf: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", allowWildcard: true, selectableRelations: [], nested: new Map() };
    const query = (input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input), filters = yield* decodeFilters(envelope.where ?? {}), options = yield* decodeOptions(envelope.options ?? {}), paths = options.populate ?? [];
      const projection = yield* compileProjection(catalog, contracts.table.name, options.fields, paths, { ...leaf, allowedPaths: ["countries"],
        selectableRelations: ["countries"], nested: new Map([["countries", leaf]]) });
      const direction = options.orderBy?.id === "DESC" ? "desc" : "asc", skip = options.offset ?? 0;
      const plan: ReadPlan = { table: contracts.table.name, projection, paths, withDeleted: false, relationFilters: [], ordering: new Map(),
        query: { skip, order: { column: "id", direction }, predicate: { kind: "and", children: [yield* compileWhere(filters, where), { kind: "isNull", column: "deleted_at" }] } },
        window: { kind: "catalog", order: "id", select: rows => ({ rows: preservePrimaryKeyOrFilterOrder(
          (direction === "asc" ? rows : [...rows].reverse()).slice(skip, options.limit === undefined ? undefined : skip + options.limit),
          filters, ["id"], [["id", direction === "asc" ? "ASC" : "DESC"]]), count: rows.length }) },
      };
      return { ...plan, window: plan.window, filters };
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge } = bound, denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = Effect.fn("RegionCartRead.find")(function* (ctx: CommerceCommandContext, input: unknown, count: boolean) {
        const plan = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(query)));
        return yield* executeRead({ manager: ctx.manager, table: ctx.table, resources: ctx.resources,
          admitSelection: (table, rows) => Result.gen(function* () {
            if (table !== contracts.table.name && table !== contracts.country.name) return yield* Result.fail(commerceError("unsupportedProfile"));
            if (rows.length > (table === contracts.table.name ? regionReadLimit : regionCartCountryLimit)) return yield* Result.fail(commerceError("limitExceeded"));
            for (const row of rows) yield* (table === contracts.table.name ? contracts.decodeRow : contracts.decodeCountry)(projectNativeRow(row));
          }) }, catalog, plan, count);
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, captured, false)).pipe(Effect.map(value => structuredClone(value.rows)))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const result = yield* find(ctx, captured, true);
          if (result.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [structuredClone(result.rows), result.count] satisfies [JsonObject[], number];
        }))),
      };
      return { ...bound, repository, denied };
    };
    return { bind, contracts, catalog, table: yield* catalog.table(contracts.table.name), query };
  });
}
