import { Effect, Result, Schema } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { DAL } from "@medusajs/framework/types";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { compileCompleteRow } from "../../value/complete-row";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, projectRows, type ProjectionPolicy } from "../../query/projection";
import { compileWhere, type Predicate, type WherePolicy, type ScalarFilter } from "../../query/predicate";
import { bindCommerceRelationRows, populateCommerceRelations, type CommerceRelation, type CommerceRelationRows } from "../../query/relations";
import { resolveCommerceRelationFilter } from "../../query/relation-filter";
import { QueryLimit } from "../../query/decoder";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Ids = Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(4))]);
const Text = Schema.String.check(Schema.isMaxLength(256));
const Address = Schema.Struct({ country_code: Schema.optionalKey(Schema.NullOr(Text)), province_code: Schema.optionalKey(Schema.NullOr(Text)),
  city: Schema.optionalKey(Schema.NullOr(Text)), postal_expression: Schema.optionalKey(Schema.NullOr(Text)) });
const Context = Schema.Record(Schema.String, Schema.Union([Text, Schema.Boolean, Schema.Finite, Schema.Array(Text)]))
  .check(Schema.makeFilter(value => Object.keys(value).length <= 16));
export const CartShippingReadInput = Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Ids),
  fulfillment_set_id: Schema.optionalKey(Ids), fulfillment_set_type: Schema.optionalKey(Text),
  address: Schema.optionalKey(Address), context: Schema.optionalKey(Context) })),
  config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(256))),
    relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(16))),
    take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(Schema.Literal(0)),
    order: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) })) });
export const decodeCartShippingReadInput = commerceDecoder(CartShippingReadInput, "invalidInput");
const Geo = Schema.Struct({ type: Text, ...Address.fields });
const GeoWhere = Schema.Struct({ $or: Schema.Array(Geo).check(Schema.isLengthBetween(1, 4)) });
const SetWhere = Schema.Struct({ id: Schema.optionalKey(Ids), type: Schema.optionalKey(Text) });
const Where = Schema.Struct({ id: Schema.optionalKey(Ids), service_zone: Schema.optionalKey(Schema.Struct({
  fulfillment_set: Schema.optionalKey(SetWhere), geo_zones: Schema.optionalKey(GeoWhere) })) });
const decodeQuery = commerceDecoder(Schema.Struct({ where: Where, options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(256))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(16))),
  limit: Schema.optionalKey(Schema.NullOr(QueryLimit)), offset: Schema.optionalKey(Schema.Literal(0)),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })),
}) }), "unsupportedProfile");
const logical = { nodes: 32, depth: 4, operands: 32,
  decodeBranches: commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "unsupportedProfile"),
  unwrapMembership: (value: unknown) => value };
const wherePolicy = (names: readonly string[]): WherePolicy => ({ decode: commerceDecoder(Schema.JsonObject, "unsupportedProfile"), logical,
  fields: new Map<string, ScalarFilter>(names.map(column => [column, { column,
    decode: commerceDecoder(column === "id" ? Ids : Schema.NullOr(Text), "unsupportedProfile") }])) });
const setWherePolicy = wherePolicy(["id", "type"]);
const geoWherePolicy = wherePolicy(["type", "country_code", "province_code", "city", "postal_expression"]);
const active = (predicate: Predicate): Predicate => ({ kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" }] });
type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];
const models = new Map([["shipping_option", "ShippingOption"], ["shipping_option_type", "ShippingOptionType"], ["shipping_option_rule", "ShippingOptionRule"],
  ["shipping_profile", "ShippingProfile"], ["fulfillment_provider", "FulfillmentProvider"], ["service_zone", "ServiceZone"], ["fulfillment_set", "FulfillmentSet"], ["geo_zone", "GeoZone"]]);
const paths = new Map<string, readonly string[]>([["shipping_option", ["type", "rules", "shipping_profile", "provider", "service_zone", "service_zone.fulfillment_set", "service_zone.geo_zones"]],
  ["service_zone", ["fulfillment_set", "geo_zones"]]]);

/** Native Fulfillment owns context normalization and rule eligibility. This
 * named DAL profile supplies only its checked complete local read closure. */
export function prepareCartShippingRead(metadata: Metadata) {
  return Result.gen(function* () {
    const entities = [];
    for (const table of metadata.tables) {
      const model = models.get(table.name);
      if (model === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      entities.push({ table, model, maximum: table.name === "geo_zone" || table.name === "shipping_option_rule" ? 16 : 4,
        complete: yield* compileCompleteRow(table) });
    }
    if (entities.length !== 8) return yield* Result.fail(commerceError("unsupportedProfile"));
    const byName = new Map(entities.map(entity => [entity.table.name, entity])), relations = new Map<string, Map<string, CommerceRelation>>();
    for (const entity of entities) {
      const members = new Map<string, CommerceRelation>();
      for (const relationship of entity.table.relationships) {
        if (!byName.has(relationship.targetTable)) continue;
        if (relationship.type === "hasMany") {
          const described = describeToManyRelation(entity.table, relationship.name, metadata.tables);
          if (described === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
          members.set(relationship.name, described);
        } else if (relationship.type === "belongsTo") {
          const column = relationship.foreignKeyNames?.[0];
          if (relationship.foreignKeyNames?.length !== 1 || column === undefined || !entity.table.foreignKeys.some(key =>
            key.columns.length === 1 && key.columns[0] === column && key.referencedTable === relationship.targetTable &&
            key.referencedColumns.length === 1 && key.referencedColumns[0] === "id")) return yield* Result.fail(commerceError("unsupportedProfile"));
          members.set(relationship.name, { name: relationship.name, targetTable: relationship.targetTable, sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
            join: { type: "belongsTo", foreignKeys: [column] } });
        }
      }
      relations.set(entity.table.name, members);
    }
    const catalog = yield* makeReadCatalog(entities.map(({ table }) => ({ name: table.name, columns: table.columns.map(column => column.name),
      primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns), nullableColumns: table.columns.filter(column => column.nullable).map(column => column.name), companions: {} })), relations);
    const leaf: ProjectionPolicy = { keys: "selected", storageKeys: "last", joinKeys: "storage", allowWildcard: true,
      allowBareRelations: true, selectableRelations: [], nested: new Map() };
    const policy = (table: string, allowed: readonly string[]): ProjectionPolicy => {
      const names = [...new Set(allowed.map(path => path.split(".")[0]!))];
      return { ...leaf, allowedPaths: allowed, selectableRelations: names, nested: new Map(names.map(name => [name,
        policy(relations.get(table)?.get(name)?.targetTable ?? "", allowed.filter(path => path.startsWith(name + ".")).map(path => path.slice(name.length + 1)))])) };
    };
    const admission = (table: string, selected: readonly JsonObject[]) => Result.gen(function* () {
      const entity = byName.get(table);
      if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (selected.length > entity.maximum) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of selected) yield* entity.complete(projectNativeRow(row));
    });
    const query = (table: string, input: unknown) => Result.gen(function* () {
      const value = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeQuery)), allowed = paths.get(table) ?? [];
      if (!byName.has(table) || table !== "shipping_option" && value.where.service_zone !== undefined)
        return yield* Result.fail(commerceError("unsupportedProfile"));
      const projection = yield* compileProjection(catalog, table, value.options.fields, value.options.populate ?? [], policy(table, allowed));
      return { value, projection, predicate: yield* compileWhere({ ...(value.where.id === undefined ? {} : { id: value.where.id }) }, scalarIdWhere) };
    });
    const read = Effect.fn("Fulfillment.cartShippingRead")(function* (rows: CommerceRelationRows, table: string, input: unknown) {
      const plan = yield* Effect.fromResult(query(table, input)), predicates: Predicate[] = [plan.predicate];
      const zone = plan.value.where.service_zone;
      if (zone?.fulfillment_set !== undefined) predicates.push(yield* resolveCommerceRelationFilter(rows, table, "service_zone.fulfillment_set",
        active(yield* Effect.fromResult(compileWhere(zone.fulfillment_set, setWherePolicy))), catalog.relations));
      if (zone?.geo_zones !== undefined) predicates.push(yield* resolveCommerceRelationFilter(rows, table, "service_zone.geo_zones",
        active(yield* Effect.fromResult(compileWhere(zone.geo_zones, geoWherePolicy))), catalog.relations));
      const roots = yield* rows(table, active({ kind: "and", children: predicates }), "id", { includeIdentities: true });
      // Native context filtering follows this DAL read. A truncated cohort
      // cannot be presented as a complete native list/count afterward.
      if (plan.value.options.limit !== null && plan.value.options.limit !== undefined && roots.length > plan.value.options.limit)
        return yield* Effect.fail(commerceError("unsupportedProfile"));
      const populated = yield* populateCommerceRelations(rows, table, roots, plan.value.options.populate ?? [], catalog.relations, new Map());
      return { rows: yield* Effect.fromResult(projectRows(populated, plan.projection.node)), count: roots.length };
    });
    const option = byName.get("shipping_option");
    if (option === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const scalar = yield* prepareScalarRepository(option.table, option.model, scalarIdWhere);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(ctx, owner), { bridge } = bound, denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository = (table: string): DAL.RepositoryService => ({ ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (current, captured) => bridge.checked(current,
          read(bindCommerceRelationRows({ ...current, admitSelection: admission }, { includeIdentities: true }), table, captured))
          .pipe(Effect.map(result => structuredClone(result.rows)))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (current, captured) => bridge.checked(current,
          read(bindCommerceRelationRows({ ...current, admitSelection: admission }, { includeIdentities: true }), table, captured))
          .pipe(Effect.map(result => [structuredClone(result.rows), result.count] satisfies [JsonObject[], number]))),
      });
      return { ...bound, repository, denied };
    };
    return { entities, byName, catalog, relations, query, read, admission, bind };
  });
}
