import { Result, Schema, type Effect } from "effect";
import { supportsNativeJsonObjectAssignment } from "@medusajs/utils/dal/json-assignment";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { NativePreimageConfig } from "../../workflow/preimage";
import { TaxId } from "./query";
import { compileTaxCreationRows, TaxRateCreate, TaxRateRuleCreate } from "./rate-create-input";
import type { captureTaxMetadata } from "./schema";

export const TaxRateUpdateIds = Schema.Array(TaxId).pipe(Schema.mutable).check(Schema.isMaxLength(8));
const Code = Schema.String.check(Schema.isMaxLength(256));
export const TaxRateUpdateSelector = Schema.Union([
  Schema.Struct({ id: Schema.Union([TaxId, TaxRateUpdateIds]) }),
  Schema.Struct({ tax_region_id: Schema.Union([TaxId, Schema.Array(TaxId).pipe(Schema.mutable).check(Schema.isMaxLength(2))]),
    code: Schema.Union([Code, Schema.Array(Code).pipe(Schema.mutable).check(Schema.isMaxLength(8))]) }),
]);
export const TaxRateUpdateMetadata = Schema.NullOr(Schema.JsonObject).check(Schema.makeFilter(value =>
  supportsNativeJsonObjectAssignment(value) || "Unsupported native JSON assignment domain"));
export const TaxRateUpdateData = Schema.Struct({ name: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.NullOr(Schema.String)), rate: Schema.optionalKey(Schema.NullOr(Schema.Number.check(Schema.isFinite()))),
  is_default: Schema.optionalKey(Schema.Boolean), is_combinable: Schema.optionalKey(Schema.Boolean),
  metadata: Schema.optionalKey(TaxRateUpdateMetadata), updated_by: Schema.optionalKey(Schema.String) });
export const TaxRateUpdateInput = Schema.Struct({ selector: TaxRateUpdateSelector, update: TaxRateUpdateData });
export const TaxRateUpdateWorkflowInput = Schema.Struct({ selector: TaxRateUpdateSelector,
  update: Schema.Struct({ ...TaxRateUpdateData.fields, rules: Schema.optionalKey(Schema.Array(
    Schema.Struct({ ...TaxRateRuleCreate.fields, metadata: Schema.optionalKey(Schema.Json) }),
  ).pipe(Schema.mutable).check(Schema.isMaxLength(2))) }) });
export const TaxRateUpdateReadInput = Schema.Struct({ filters: TaxRateUpdateSelector, config: NativePreimageConfig });
const Reference = Schema.Struct({ id: TaxId });
const UpsertReference = Schema.Struct({ id: TaxId, children: Schema.optionalKey(Schema.Array(Schema.Never)) });
/** Only genuine retained scalar projections or the empty-select Region
 * reference are admitted. This is not a standalone complete-create surface. */
export const TaxRateUpdateUpserts = Schema.Array(Schema.Union([
  Schema.Struct({ id: TaxId, name: TaxRateUpdateData.fields.name, code: TaxRateUpdateData.fields.code,
    rate: TaxRateUpdateData.fields.rate, is_default: TaxRateUpdateData.fields.is_default,
    is_combinable: TaxRateUpdateData.fields.is_combinable, metadata: TaxRateUpdateData.fields.metadata }),
  Schema.Struct({ id: TaxId, tax_region_id: TaxId, tax_region: Reference }),
])).pipe(Schema.mutable).check(Schema.isMaxLength(4), Schema.makeFilter(rows =>
  new Set(rows.map(row => row.id)).size === rows.length || "Expected unique retained Rate identities"));
const decodeInputShape = commerceDecoder(TaxRateUpdateInput, "invalidInput");
const decodeReadShape = commerceDecoder(TaxRateUpdateReadInput, "invalidInput");
const decodeUpsertShape = commerceDecoder(TaxRateUpdateUpserts, "invalidInput");
export const decodeTaxRateUpdateInput = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeInputShape));
export const decodeTaxRateUpdateRead = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeReadShape));
export const decodeTaxRateUpdateUpserts = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeUpsertShape));
const decodeObjects = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeObject = commerceDecoder(Schema.JsonObject, "storedCorruption");
const decodeReference = commerceDecoder(Reference, "storedCorruption");
const decodeUpsertReference = commerceDecoder(UpsertReference, "storedCorruption");
const decodeActor = commerceDecoder(Schema.String, "storedCorruption");
const decodeId = commerceDecoder(TaxId, "storedCorruption");
// The original absent-row inverse fails the first missing required DML field,
// code, before any insert/unique check. Retain the existing creation decoder's
// actual field contracts, with that native required-field order.
const { code: requiredCode, ...creationFields } = TaxRateCreate.fields;
const decodeCreation = commerceDecoder(Schema.Struct({ code: requiredCode, ...creationFields }), "invalidInput");
type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];

/** Storage rows remain DML scalars. Immediate entity references and transient
 * actor fields have their own checked presentation, without creation's rules. */
export function compileTaxRateUpdateContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const rows = yield* compileTaxCreationRows(metadata), { rate, decodeRateRow } = rows;
    const region = rows.tables.find(table => table.name === "tax_region");
    if (region === undefined || !rate.relationships.some(relation => relation.name === "tax_region" && relation.type === "belongsTo" &&
      relation.targetTable === region.name) || !rate.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "tax_region_id" &&
      key.referencedTable === region.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id") ||
      rate.columns.find(column => column.name === "tax_region_id")?.nullable !== false)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeRegion = yield* compileCompleteRow(region);
    const decodeRegionRow = (input: unknown) => Result.gen(function* () {
      const row = yield* decodeRegion(input), id = yield* decodeId(row.id);
      return { ...row, id };
    });
    const projection = yield* compileRowProjection(rate);
    const decodePreimages = (input: unknown) => Result.gen(function* () {
      const output: Array<JsonObject & { readonly id: string }> = [], identities = new Set<string>();
      for (const value of yield* decodeObjects(input)) {
        const { tax_region, ...scalar } = value;
        const row = yield* projection(scalar), id = yield* decodeId(row.id);
        if (identities.has(id) || row.deleted_at !== undefined && row.deleted_at !== null)
          return yield* Result.fail(commerceError("storedCorruption"));
        identities.add(id);
        if (tax_region !== undefined) {
          const region = yield* decodeReference(tax_region);
          if (region.id !== row.tax_region_id) return yield* Result.fail(commerceError("storedCorruption"));
          output.push({ ...row, id, tax_region: region });
        } else output.push({ ...row, id });
      }
      return output;
    });
    const decode = (input: unknown, inverse: boolean) => Result.gen(function* () {
      const output: Array<JsonObject & { readonly id: string }> = [], identities = new Set<string>();
      for (const value of yield* decodeObjects(input)) {
        const { tax_region, updated_by, ...scalar } = value;
        const row = yield* decodeRateRow(scalar), region = yield* (inverse ? decodeUpsertReference : decodeReference)(tax_region);
        if (region.id !== row.tax_region_id || row.deleted_at !== null || identities.has(row.id) || inverse && updated_by !== undefined)
          return yield* Result.fail(commerceError("storedCorruption"));
        identities.add(row.id);
        output.push({ ...row, tax_region: region, ...(updated_by === undefined ? {} : { updated_by: yield* decodeActor(updated_by) }) });
      }
      return output;
    });
    const decodeRows = (input: unknown) => decode(input, false), decodeUpsertRows = (input: unknown) => decode(input, true);
    const present = (input: unknown, actor?: string, regionChildren = false) => Result.gen(function* () {
      const row = yield* decodeRateRow(input), region = yield* decodeId(row.tax_region_id);
      return { ...row, tax_region: { id: region, ...(regionChildren ? { children: [] } : {}) },
        ...(actor === undefined ? {} : { updated_by: actor }) };
    });
    const decodeEntity = (input: unknown) => Result.gen(function* () {
      const value = yield* decodeObject(input), { tax_region, ...scalar } = value;
      const row = yield* decodeRateRow(scalar), region = yield* decodeReference(tax_region);
      if (region.id !== row.tax_region_id) return yield* Result.fail(commerceError("storedCorruption"));
      return row;
    });
    const Output = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(values =>
      Result.isSuccess(decodeRows(values)) || "Expected complete native Tax Rate update DTOs"));
    return { ...rows, table: rate, region, decodeRegionRow, decodeEntity, decodePreimages, decodeRows, decodeUpsertRows, decodeCreation, present, Output };
  });
}
