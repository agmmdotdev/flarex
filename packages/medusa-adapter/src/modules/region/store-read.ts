import { Effect, Result, Schema } from "effect";
import { Country, Region } from "@medusajs/region/models";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import type { FilterableRegionProps, FindConfig, RegionDTO } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { type ReadPlan } from "../../query/read";
import { QueryEnvelope, QueryLimit, QueryOffset } from "../../query/decoder";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { commerceDecoder } from "../../value/decoder";
import { captureRegionMetadata } from "./schema";
import { defineRegionReadModule } from "./module";
import { prepareRegionCountryReadRepository } from "./country-read-repository";

const Text = Schema.String.check(Schema.isMaxLength(4096), Schema.isPattern(/^[^\0]*$/));
const Membership = Schema.Union([Text, Schema.Array(Text).check(Schema.isMaxLength(commerceLimits.filterOperands))]);
const decodeMembership = commerceDecoder(Membership, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.Struct({ id: Schema.optionalKey(Schema.Unknown), name: Schema.optionalKey(Schema.Unknown),
  currency_code: Schema.optionalKey(Schema.Unknown), $and: Schema.optionalKey(Schema.Unknown), $or: Schema.optionalKey(Schema.Unknown) }), "unsupportedProfile");
const where: WherePolicy = { decode: decodeWhere,
  fields: new Map(["id", "name", "currency_code"].map(column => [column, { column, decode: decodeMembership }])),
  logical: { decodeBranches: commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(commerceLimits.filterNodes)), "unsupportedProfile"),
    nodes: commerceLimits.filterNodes, depth: commerceLimits.filterDepth, operands: commerceLimits.filterOperands,
    unwrapMembership: value => value, emptyLogical: "ignore" } };
const Direction = Schema.Literals(["ASC", "DESC", "asc", "desc"]);
export const StoreRegionOrder = Schema.Struct({ id: Schema.optionalKey(Direction), name: Schema.optionalKey(Direction),
  currency_code: Schema.optionalKey(Direction),
  created_at: Schema.optionalKey(Direction), updated_at: Schema.optionalKey(Direction),
}).check(Schema.makeFilter(order => {
  const columns = Object.keys(order).filter(column => column !== "id");
  return columns.length <= 1 && (columns.length === 0 || order.id === undefined ||
    order.id === "ASC" && Object.keys(order)[0] !== "id");
}));
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 64))),
  populate: Schema.optionalKey(Schema.Array(Schema.Literal("countries")).check(Schema.isMaxLength(1))),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset), orderBy: Schema.optionalKey(StoreRegionOrder),
  filters: Schema.optionalKey(Schema.Struct({
    softDeletable: Schema.optionalKey(Schema.Struct({ withDeleted: Schema.Literal(false) })),
    freeTextSearch_Region: Schema.optionalKey(Schema.Struct({ value: Text, fromEntity: Schema.Literal("Region") })),
  })),
}), "unsupportedProfile");
const decodeInput = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.JsonObject), config: Schema.optionalKey(Schema.JsonObject) }), "invalidInput");
const decodeDetailInput = commerceDecoder(Schema.Struct({ filters: Schema.Struct({ id: Text }), config: Schema.optionalKey(Schema.JsonObject) }), "invalidInput");

/** Store lists have a separate admission from Cart's eight-Region context.
 * Native service normalization, full-row validation, count and owned Country
 * population all execute under one protected Region read command. */
export function prepareStoreRegionRead(metadata: Effect.Success<ReturnType<typeof captureRegionMetadata>>["frame"]) {
  return Result.gen(function* () {
    const prepared = yield* prepareRegionCountryReadRepository(metadata, where), { contracts, catalog } = prepared;
    const leaf: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", allowWildcard: true, selectableRelations: [], nested: new Map() };
    const query = (input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input), options = yield* decodeOptions(envelope.options ?? {}), paths = options.populate ?? [];
      const projection = yield* compileProjection(catalog, contracts.table.name, options.fields, paths,
        { ...leaf, allowedPaths: ["countries"], selectableRelations: ["countries"], nested: new Map([["countries", leaf]]) });
      const predicate = yield* compileWhere(envelope.where ?? {}, where), order = options.orderBy ?? { id: "ASC" };
      const [column, direction] = Object.entries(order).find(([column]) => column !== "id") ?? ["id", order.id];
      const nativeDirection = direction === "DESC" || direction === "desc" ? "DESC" : "ASC";
      const search = options.filters?.freeTextSearch_Region?.value;
      const plan: ReadPlan = { table: contracts.table.name, projection, paths, withDeleted: false, relationFilters: [], ordering: new Map(),
        query: { skip: options.offset ?? 0, take: options.limit ?? commerceLimits.catalogRows,
          order: { column, direction: direction === "DESC" || direction === "desc" ? "desc" : "asc" },
          predicate: { kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" },
            ...(search ? [{ kind: "or", children: ["name", "currency_code"].map(column => ({ kind: "postgresText", column,
              operator: "ilike", value: `%${search}%` })) }] : [])] } },
        window: { kind: "database", countAt: "beforePopulation" },
      };
      // Pinned native DAL applies filter identity order after its SQL window.
      // Reorder only the populated page; count and selected identities remain
      // those of the database plan, including non-default explicit ordering.
      return { ...plan, orderRows: (rows: JsonObject[]) =>
        preservePrimaryKeyOrFilterOrder(rows, envelope.where ?? {}, ["id"], [[column, nativeDirection]]) };
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) =>
      prepared.bind(root, owner, { query, regionLimit: commerceLimits.catalogRows, boundRoot: true });
    return { query, contracts, bind };
  });
}

export const makeStoreRegionReadCommands = Effect.fn("RegionAdapter.storeReadCommands")(function* () {
  const metadata = yield* captureRegionMetadata();
  const prepared = yield* Effect.fromResult(prepareStoreRegionRead(metadata.frame));
  const module = yield* Effect.fromResult(defineRegionReadModule({ name: "flarex-region-store-read", profile: "region-store-read", bind: (ctx, owner) => {
    const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
      capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
    return { baseRepository: bound.repository, repository: (model: typeof Region | typeof Country) => model === Region ? bound.repository : bound.denied,
      events: bound.mutationEvents, eventBus };
  } }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause))));
  const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("StoreRegion.prepare")(decodeInput);
  const list = commands.read("regionListForStore", commerceCommandPreparation("StoreRegion.prepareDetail")(decodeDetailInput), ({ service, context }, input) =>
    service.listRegions(input.filters as FilterableRegionProps | undefined, input.config as FindConfig<RegionDTO> | undefined, context));
  const count = commands.read("regionCountForStore", prepare, ({ service, context }, input) =>
    service.listAndCountRegions(input.filters as FilterableRegionProps | undefined, input.config as FindConfig<RegionDTO> | undefined, context));
  return { list, count, commands: [list, count], prepared };
});
