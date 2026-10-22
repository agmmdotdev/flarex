import { Result, Schema, type Effect } from "effect";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import type { captureTaxMetadata } from "./schema";
import { TaxId } from "./query";

const Managed = { id: Schema.optionalKey(TaxId), created_at: Schema.optionalKey(Schema.String),
  updated_at: Schema.optionalKey(Schema.String), deleted_at: Schema.optionalKey(Schema.NullOr(Schema.String)) };
export const TaxRateRuleCreate = Schema.Struct({ ...Managed, reference: Schema.String, reference_id: Schema.String,
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)), created_by: Schema.optionalKey(Schema.NullOr(Schema.String)) });
export const TaxRateCreate = Schema.Struct({ ...Managed, tax_region_id: TaxId, name: Schema.String, code: Schema.String,
  rate: Schema.optionalKey(Schema.NullOr(Schema.Number.check(Schema.isFinite()))),
  is_default: Schema.optionalKey(Schema.Boolean), is_combinable: Schema.optionalKey(Schema.Boolean),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)), created_by: Schema.optionalKey(Schema.NullOr(Schema.String)),
  rules: Schema.optionalKey(Schema.Array(TaxRateRuleCreate).pipe(Schema.mutable).check(Schema.isMaxLength(2))) });
export const TaxRateCreatesInput = Schema.Array(TaxRateCreate).pipe(Schema.mutable).check(Schema.isMaxLength(4),
  Schema.makeFilter(rows => new Set(rows.map(row => row.tax_region_id)).size <= 2 || "Expected at most two Tax Regions"));
const TaxRateOutput = Schema.Struct({ id: TaxId, tax_region_id: TaxId, name: Schema.String, code: Schema.String,
  rate: Schema.NullOr(Schema.Number.check(Schema.isFinite())), is_default: Schema.Boolean, is_combinable: Schema.Boolean,
  metadata: Schema.NullOr(Schema.JsonObject), created_by: Schema.NullOr(Schema.String),
  created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String), rules: Schema.Array(Schema.Never) });
export const TaxRateCreatesOutput = Schema.Array(TaxRateOutput).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeStoredTaxId = commerceDecoder(TaxId, "storedCorruption");
const decodeStoredTaxRateOutputs = commerceDecoder(TaxRateCreatesOutput, "storedCorruption");
export const TaxRatePhysicalDeletionIds = Schema.Array(TaxId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeTaxRateCreates = commerceDecoder(TaxRateCreatesInput, "invalidInput");
export const decodeTaxRatePhysicalDeletionIds = commerceDecoder(TaxRatePhysicalDeletionIds, "invalidInput");
export const decodeTaxRatePhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: TaxId })).check(Schema.isMaxLength(4)),
}), "unsupportedProfile");
type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];

/** Shared checked scalar/default contracts for native Tax creation profiles.
 * Selecting a row contract grants no repository or workflow capabilities. */
export function compileTaxCreationRows(metadata: Metadata) {
  return Result.gen(function* () {
    const rate = metadata.tables.find(table => table.name === "tax_rate"), rule = metadata.tables.find(table => table.name === "tax_rate_rule");
    if (metadata.tables.length !== 4 || rate === undefined || rule === undefined ||
      rate.columns.find(column => column.name === "rate")?.type !== "float" ||
      !rule.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "tax_rate_id" &&
        key.referencedTable === rate.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id" && key.onDelete === "cascade"))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const keyed = (decode: Result.Result.Success<ReturnType<typeof compileCompleteRow>>) => (input: unknown) => Result.gen(function* () {
      const row = yield* decode(input), id = yield* decodeStoredTaxId(row.id);
      const captured: JsonObject & Readonly<{ id: string }> = { ...row, id };
      return captured;
    });
    const decodeRateRow = keyed(yield* compileCompleteRow(rate)), decodeRuleRow = keyed(yield* compileCompleteRow(rule));
    const defaults = (table: typeof rate) => {
      const output: Record<string, Json> = {};
      for (const column of table.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
        if (column.defaultValue !== undefined) output[column.name] = column.defaultValue;
        else if (column.nullable) output[column.name] = null;
      }
      return output;
    };
    return { rate, rule, tables: metadata.tables, decodeRateRow, decodeRuleRow,
      rateDefaults: defaults(rate), ruleDefaults: defaults(rule) };
  });
}

/** Four genuine DML models remain installed; this profile grants writes only
 * to Rate and Rule and derives complete scalar/default contracts from them. */
export function compileTaxRateCreationContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const rows = yield* compileTaxCreationRows(metadata), { rate, rule, decodeRateRow, decodeRuleRow } = rows;
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeStoredTaxRateOutputs(input), ids = new Set<string>();
      for (const row of rows) {
        const { rules, ...scalar } = row;
        yield* decodeRateRow(scalar);
        if (rules.length || ids.has(row.id)) return yield* Result.fail(commerceError("storedCorruption"));
        ids.add(row.id);
      }
      return rows;
    });
    const descriptors = new Map(rate.relationships.map(relationship => [relationship.name, { relationship }]));
    const initializeRows = (rows: readonly JsonObject[]) => Result.gen(function* () {
      const output: JsonObject[] = [];
      for (const value of rows) output.push({ ...yield* decodeRateRow(value) });
      fillEmptyToManyRelations(output, descriptors);
      return yield* decodeOutput(output);
    });
    const entities = [{ table: rate, model: "TaxRate", maximum: 4, decodeRow: decodeRateRow },
      { table: rule, model: "TaxRateRule", maximum: 8, decodeRow: decodeRuleRow }];
    return { ...rows, entities, Input: TaxRateCreatesInput, Output: TaxRateCreatesOutput,
      decodeInput: decodeTaxRateCreates, decodeOutput, initializeRows };
  });
}
