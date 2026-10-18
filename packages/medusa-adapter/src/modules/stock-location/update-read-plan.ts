import { Result, Schema } from "effect";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { makeReadCatalog, type ReadTable } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { compileWhere, type ScalarFilter, type WherePolicy } from "../../query/predicate";
import { QueryEnvelope, QueryLimit, QueryOffset } from "../../query/decoder";
import type { ReadPlan } from "../../query/read";
import type { CommerceRelations } from "../../query/relations";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const strings = commerceDecoder(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(4))]), "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(256))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(1))),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }) })),
}), "unsupportedProfile");
const scalarProjection: ProjectionPolicy = { keys: "selected", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
const decodeSelectors = commerceDecoder(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)), "unsupportedProfile");
const where = (fields: readonly string[]): WherePolicy => ({ decode: decodeWhere,
  fields: new Map<string, ScalarFilter>(fields.map(column => [column, { column, decode: strings }])),
  selectors: { mode: "membership", key: "id", decode: decodeSelectors } });
export const stockLocationUpdateWhere = where(["id", "name"]);
export const stockLocationAddressWhere = where(["id"]);

/** One module-owned read plan for execution and receipt correlation. The FK is
 * checked by repository preparation before these detached catalogs are used. */
export function prepareStockLocationUpdateReadPlan(table: ReadTable, address: ReadTable) {
  return Result.gen(function* () {
    const relation = { name: "address", targetTable: address.name, sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
      join: { type: "belongsTo" as const, foreignKeys: ["address_id"] } };
    const relations: CommerceRelations = new Map([[table.name, new Map([["address", relation]])]]);
    const catalog = yield* makeReadCatalog([table, address], relations);
    const projection: ProjectionPolicy = { ...scalarProjection, keys: "retainWhenNested", joinKeys: "retainWhenNested", nullToOne: true,
      allowedPaths: ["address"], selectableRelations: ["address"], nested: new Map([["address", { ...scalarProjection, keys: "retain" }]]) };
    const query = (selected: string, input: unknown) => Result.gen(function* () {
      if (selected !== table.name && selected !== address.name) return yield* Result.fail(commerceError("unsupportedProfile"));
      const envelope = yield* decodeEnvelope(input);
      const where = yield* decodeWhere(envelope.where ?? {});
      const options = yield* decodeOptions(envelope.options ?? {});
      const paths = options.populate ?? [];
      const fieldProjection = yield* compileProjection(catalog, selected, options.fields, paths,
        selected === table.name ? projection : { ...scalarProjection, allowedPaths: [] });
      const predicate = yield* compileWhere(where, selected === table.name ? stockLocationUpdateWhere : stockLocationAddressWhere);
      const withDeleted = options.filters?.softDeletable.withDeleted ?? false;
      const reverse = options.orderBy?.id === "DESC";
      // The admitted finite selector has only id/name membership and the native
      // keyed repository's id-only $or. Core authenticates candidate acquisition;
      // name and deleted_at can remain residuals over an identity read or a
      // complete range. Do not interpret its index planner in the module.
      const members: { readonly column: string; readonly values: readonly string[] }[] = [];
      for (const [column, value] of Object.entries(where)) {
        if (column === "$or") members.push({ column: "id", values: (yield* decodeSelectors(value)).map(row => row.id) });
        else { const decoded = yield* strings(value); members.push({ column, values: typeof decoded === "string" ? [decoded] : decoded }); }
      }
      const matches = (row: JsonObject) => members.every(member => typeof row[member.column] === "string" && member.values.includes(String(row[member.column])));
      const identities = members.filter(member => member.column === "id");
      const matchesCandidate = (row: JsonObject) => !members.some(member => member.values.length === 0) &&
        identities.every(member => typeof row.id === "string" && member.values.includes(row.id));
      const window = { kind: "catalog" as const, order: "id", select: (rows: readonly JsonObject[]) => {
        const ordered = preservePrimaryKeyOrFilterOrder(reverse ? [...rows].reverse() : [...rows], where, ["id"], [["id", reverse ? "DESC" : "ASC"]]);
        const offset = options.offset ?? 0;
        return { rows: ordered.slice(offset, options.limit === undefined ? undefined : offset + options.limit), count: rows.length };
      } };
      const plan: ReadPlan & { readonly window: typeof window } = {
        table: selected, projection: fieldProjection, paths, relationFilters: [], ordering: new Map(), withDeleted,
        query: { fields: fieldProjection.storageFields, order: { column: "id", direction: reverse ? "desc" : "asc" },
          predicate: { kind: "and", children: [predicate, ...(withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }])] } }, window,
      };
      return { plan, matches, matchesCandidate };
    });
    return { catalog, relations, relation, query };
  });
}
