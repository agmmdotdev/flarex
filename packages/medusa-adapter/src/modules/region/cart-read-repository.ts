import { Effect, Result, Schema } from "effect";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { type ReadPlan } from "../../query/read";
import { QueryEnvelope, QueryLimit, QueryOffset } from "../../query/decoder";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { commerceDecoder } from "../../value/decoder";
import { RegionCartFilters, RegionCartId } from "./cart-read-input";
import { regionReadLimit } from "./input";
import type { captureRegionMetadata } from "./schema";
import { prepareRegionCountryReadRepository } from "./country-read-repository";

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
    const prepared = yield* prepareRegionCountryReadRepository(metadata, where), { contracts, catalog } = prepared;
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
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) =>
      prepared.bind(root, owner, { query, regionLimit: regionReadLimit });
    return { bind, contracts, catalog, table: yield* catalog.table(contracts.table.name), query };
  });
}
