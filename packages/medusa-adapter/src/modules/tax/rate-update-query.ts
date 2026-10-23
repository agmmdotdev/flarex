import { Result, Schema } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { QueryEnvelope } from "../../query/decoder";
import type { ScalarFilter, WherePolicy } from "../../query/predicate";
import { projectRows } from "../../query/projection";
import { projectNativeRow } from "../../repository/result";
import { jsonEqual } from "flarex-protocol/json";
import type { ReadPlan } from "../../query/read";
import type { prepareScalarRepository } from "../../repository/scalar";
import { TaxId } from "./query";
import { TaxRateUpdateSelector, TaxRateUpdateIds, TaxRateUpdateData, type compileTaxRateUpdateContracts } from "./rate-update-input";

const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const Lookup = Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: TaxId })).check(Schema.isMaxLength(8)) });
const decodeLookup = commerceDecoder(Lookup.fields.$or, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.Union([TaxRateUpdateSelector, Lookup]), "unsupportedProfile");
const Text = Schema.String.check(Schema.isMaxLength(256));
const decodeText = commerceDecoder(Schema.Union([Text, Schema.Array(Text).check(Schema.isMaxLength(8))]), "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({ fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(256))),
  populate: Schema.optionalKey(Schema.Array(Schema.Never)), orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) }), "unsupportedProfile");
export const taxRateUpdateWhere: WherePolicy = { decode: decodeWhere,
  fields: new Map<string, ScalarFilter>([ ["id", { column: "id", decode: commerceDecoder(Schema.Union([TaxId, TaxRateUpdateIds]), "unsupportedProfile") }],
    ["tax_region_id", { column: "tax_region_id", decode: decodeText }], ["code", { column: "code", decode: decodeText }] ]),
  selectors: { mode: "membership", key: "id", decode: decodeLookup } };
type Scalar = Result.Result.Success<ReturnType<typeof prepareScalarRepository>>;
export type TaxRateUpdateReadPlan = ReadPlan & { readonly regionReference: boolean; readonly regionFilter: boolean };
type Contracts = Result.Result.Success<ReturnType<typeof compileTaxRateUpdateContracts>>;
const narrowFields = new Set(["id", ...Object.keys(TaxRateUpdateData.fields)]);

/** Only the named native Tax preimage translation admits its known transient
 * actor and whole metadata column. Shared scalar projection stays strict. */
export function prepareTaxRateUpdateQuery(scalar: Scalar, contracts: Contracts) {
  type RateRow = Result.Result.Success<ReturnType<typeof contracts.decodeRateRow>> & { readonly tax_region_id: string };
  const query = (input: unknown) => Result.gen(function* () {
    const envelope = yield* decodeEnvelope(input), where = yield* decodeWhere(envelope.where ?? {}),
      options = yield* decodeOptions(envelope.options ?? {});
    const regionReference = options.fields === undefined || options.fields.length === 0;
    const regionFilter = options.fields === undefined || options.fields.length === 0;
    if (options.fields?.some(field => !narrowFields.has(field) && !field.startsWith("metadata.")))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const fields = options.fields === undefined ? undefined : options.fields.length === 0 ? ["id", "tax_region_id"]
      : [...new Set(["id", ...options.fields.flatMap(field => field === "updated_by" ? []
        : field.startsWith("metadata.") ? ["metadata"] : [field])])];
    const plan = yield* scalar.query({ where, options: { ...options, ...(fields === undefined ? {} : { fields }) } });
    return { ...plan, regionReference, regionFilter };
  });
  const decodeRates = (input: readonly JsonObject[]) => Result.gen(function* () {
    const rows: RateRow[] = [];
    for (const value of input) {
      const row = yield* contracts.decodeRateRow(projectNativeRow(value)), regionId = row.tax_region_id;
      if (row.deleted_at !== null || typeof regionId !== "string")
        return yield* Result.fail(commerceError("storedCorruption"));
      rows.push({ ...row, tax_region_id: regionId });
    }
    return rows;
  });
  // MikroORM's default filtered nonnullable to-one joins select an active
  // Region only for full/empty native projections. This is read translation,
  // not the FK's physical existence rule or a new Region lifecycle policy.
  const regionPredicate = (input: readonly JsonObject[]) => Result.gen(function* () {
    const rows = yield* decodeRates(input);
    return { kind: "and", children: [
      { kind: "in", column: "id", values: [...new Set(rows.map(row => row.tax_region_id))] },
      { kind: "isNull", column: "deleted_at" },
    ] } satisfies JsonObject;
  });
  const filterActiveRegionRates = (input: readonly JsonObject[], regionRows: readonly JsonObject[]) => Result.gen(function* () {
    const rows = yield* decodeRates(input), regions = new Map<string, JsonObject>();
    // A valid deleted or unrelated raw support row is not selected, but every
    // body and any contradictory same-ID value must be checked first.
    for (const value of regionRows) {
      const row = yield* contracts.decodeRegionRow(projectNativeRow(value)), previous = regions.get(row.id);
      if (previous !== undefined && !jsonEqual(previous, row)) return yield* Result.fail(commerceError("storedCorruption"));
      regions.set(row.id, row);
    }
    return rows.filter(row => regions.get(row.tax_region_id)?.deleted_at === null);
  });
  const project = (rows: readonly JsonObject[], plan: TaxRateUpdateReadPlan) => Result.gen(function* () {
    const projected = yield* projectRows(rows, plan.projection.node);
    if (!plan.regionReference) return projected;
    const output: JsonObject[] = [];
    for (const row of projected) {
      if (typeof row.tax_region_id !== "string") return yield* Result.fail(commerceError("storedCorruption"));
      output.push({ ...row, tax_region: { id: row.tax_region_id } });
    }
    return output;
  });
  return { query, projectRows: project, regionPredicate, filterActiveRegionRates };
}
