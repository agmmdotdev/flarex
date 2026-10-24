import { Result, Schema, type Effect } from "effect";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import type { captureTaxMetadata } from "./schema";
import { TaxId } from "./query";
import { compileTaxCreationRows } from "./rate-create-input";

type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];
const decodeStoredId = commerceDecoder(TaxId, "storedCorruption");
const rootsMaximum = 4;
const RuleArray = Schema.Array(Schema.Json).check(Schema.isMaxLength(2));
const decodeRules = commerceDecoder(RuleArray, "invalidInput");
const EmptyRelations = Schema.Struct({ children: Schema.Array(Schema.Never), tax_rates: Schema.Array(Schema.Never) });
const decodeRelations = commerceDecoder(EmptyRelations, "storedCorruption");
const PhysicalIds = Schema.Array(TaxId).pipe(Schema.mutable).check(Schema.isMaxLength(rootsMaximum));
const PhysicalSelection = Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: TaxId })).check(Schema.isMaxLength(rootsMaximum)) });

/** This creation root selects JSON scalar values, not eager business validation.
 * Native country/province normalization, parent lookup, nested Rule mapping and
 * dependency-ordered complete-row acceptance retain their first-failure order.
 * Names come from all four checked DML models; only default_tax_rate and rules
 * extend scalar input. Country strings have no added ISO/trim/length grammar. */
export function compileTaxRegionCreationContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const rows = yield* compileTaxCreationRows(metadata);
    const region = rows.tables.find(table => table.name === "tax_region"), provider = rows.tables.find(table => table.name === "tax_provider");
    if (region === undefined || provider === undefined ||
      region.columns.find(column => column.name === "country_code")?.type !== "text" ||
      !region.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "parent_id" &&
        key.referencedTable === region.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id" && key.onDelete === "cascade") ||
      !region.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "provider_id" &&
        key.referencedTable === provider.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id") ||
      !region.relationships.some(relation => relation.name === "children" && relation.type === "hasMany" && relation.targetTable === region.name && relation.cascadeDelete) ||
      !region.relationships.some(relation => relation.name === "tax_rates" && relation.type === "hasMany" && relation.targetTable === rows.rate.name && relation.cascadeDelete))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const keyed = (decode: Result.Result.Success<ReturnType<typeof compileCompleteRow>>) => (input: unknown) => Result.gen(function* () {
      const row = yield* decode(input), id = yield* decodeStoredId(row.id);
      const output: JsonObject & Readonly<{ id: string }> = { ...row, id };
      return output;
    });
    const decodeRegionRow = keyed(yield* compileCompleteRow(region)), decodeProviderRow = keyed(yield* compileCompleteRow(provider));
    const names = (table: typeof region) => table.columns.map(column => column.name);
    const decodeRate = commerceRowDecoder([...names(rows.rate), "rules"], "invalidInput");
    const decodeRule = commerceRowDecoder(names(rows.rule), "invalidInput");
    const decodeNativeExtras = (root: Readonly<Record<string, Json | undefined>>) => Result.gen(function* () {
      const value = root.default_tax_rate;
      if (value === undefined || value === null) return;
      const rate = yield* decodeRate(value);
      if (Array.isArray(rate.rules)) {
        const rules = yield* decodeRules(rate.rules);
        for (const rule of rules) if (isJsonObject(rule)) yield* decodeRule(rule);
      }
    });
    const decodeRegionInput = commerceRowDecoder([...names(region), "default_tax_rate"], "invalidInput");
    const RegionInput = Schema.JsonObject
      .check(Schema.makeFilter(root => Result.isSuccess(decodeRegionInput(root).pipe(Result.flatMap(decodeNativeExtras))) || "Expected bounded native Tax Region creation fields"));
    const Input = Schema.Array(RegionInput).pipe(Schema.mutable).check(Schema.isMaxLength(rootsMaximum));
    const decodeInput = commerceDecoder(Input, "invalidInput");
    const decodePresentation = commerceRowDecoder([...names(region), "children", "tax_rates"], "storedCorruption");
    const nullableRelations = region.relationships.filter(relation => relation.type === "belongsTo" && relation.nullable);
    if (nullableRelations.some(relation => relation.foreignKeyNames?.length !== 1))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const omittedReferences = nullableRelations.flatMap(relation => relation.foreignKeyNames ?? []);
    if (omittedReferences.length !== 2 || !omittedReferences.includes("parent_id") || !omittedReferences.includes("provider_id") ||
      omittedReferences.some(name => region.columns.find(column => column.name === name)?.nullable !== true))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodePresentedRegion = (input: unknown) => Result.gen(function* () {
      const row = yield* decodePresentation(input);
      yield* decodeRelations({ children: row.children, tax_rates: row.tax_rates });
      const { children: _children, tax_rates: _taxRates, ...scalar } = row;
      const complete = { ...scalar };
      for (const name of omittedReferences) if (!(name in scalar)) complete[name] = null;
      const stored = yield* decodeRegionRow(complete);
      const output: JsonObject & Readonly<{ id: string }> = { ...row, id: stored.id };
      return output;
    });
    // The workflow host consumes this schema directly, including on replay.
    // Its full-row check shares the same DML-backed presentation decoder.
    const RegionOutput = Schema.StructWithRest(Schema.Struct({ id: TaxId }), [Schema.Record(Schema.String, Schema.Json)])
      .check(Schema.makeFilter(value => Result.isSuccess(decodePresentedRegion(value)) || "Expected complete native Tax Region creation output"));
    const Output = Schema.Array(RegionOutput).pipe(Schema.mutable).check(Schema.isMaxLength(rootsMaximum));
    const decodeOutput = commerceDecoder(Output, "storedCorruption");
    const regionDefaults: Record<string, Json> = {};
    for (const column of region.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
      if (column.defaultValue !== undefined) regionDefaults[column.name] = column.defaultValue;
      else if (column.nullable) regionDefaults[column.name] = null;
    }
    const entities = [
      { table: region, model: "TaxRegion", maximum: 8, decodeRow: decodeRegionRow },
      { table: rows.rate, model: "TaxRate", maximum: 8, decodeRow: rows.decodeRateRow },
      { table: rows.rule, model: "TaxRateRule", maximum: 16, decodeRow: rows.decodeRuleRow },
    ];
    return { ...rows, region, provider, entities, decodeRegionRow, decodeProviderRow, regionDefaults,
      Input, Output, PhysicalIds, PhysicalSelection, decodeInput, decodeOutput,
      decodePhysicalIds: commerceDecoder(PhysicalIds, "invalidInput"),
      decodePhysicalSelection: commerceDecoder(PhysicalSelection, "unsupportedProfile") };
  });
}