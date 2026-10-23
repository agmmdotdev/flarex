import { Result, Schema, type Effect } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileRowProjection } from "../../value/complete-row";
import { NativePreimageConfig } from "../../workflow/preimage";
import { compileFulfillmentGraphContracts } from "./fulfillment-graph-contracts";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const fields = { attribute: Schema.optionalKey(Schema.String), operator: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.Json), shipping_option_id: Schema.optionalKey(Id) };
/** Structural admission deliberately leaves the genuine Fulfillment validator
 * in charge of full-field truthiness, operators and boolean normalization. */
export const ShippingOptionRuleCreate = Schema.Struct({ id: Schema.optionalKey(Id), ...fields });
export const ShippingOptionRuleUpdate = Schema.Struct({ id: Id, ...fields });
export const ShippingOptionRuleCreates = Schema.Array(ShippingOptionRuleCreate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingOptionRuleUpdates = Schema.Array(ShippingOptionRuleUpdate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingOptionRuleIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingOptionRuleBatchInput = Schema.Struct({
  create: Schema.optionalKey(Schema.NullOr(ShippingOptionRuleCreates)),
  update: Schema.optionalKey(Schema.NullOr(ShippingOptionRuleUpdates)),
  delete: Schema.optionalKey(Schema.NullOr(ShippingOptionRuleIds)),
});
export const ShippingOptionRuleSelector = Schema.Struct({ id: Schema.Union([Id, ShippingOptionRuleIds]) });
export const ShippingOptionRuleReadInput = Schema.Struct({ filters: ShippingOptionRuleSelector, config: Schema.optionalKey(NativePreimageConfig) });
export const decodeShippingOptionRuleCreates = commerceDecoder(ShippingOptionRuleCreates, "invalidInput");
export const decodeShippingOptionRuleUpdates = commerceDecoder(ShippingOptionRuleUpdates, "invalidInput");
export const decodeShippingOptionRuleIds = commerceDecoder(ShippingOptionRuleIds, "invalidInput");
const decodeRowsShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");

export function compileShippingOptionRuleContracts(metadata: Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"], maximum = 4) {
  return Result.gen(function* () {
    const graph = yield* compileFulfillmentGraphContracts(metadata), table = graph.rule;
    if (table.foreignKeys.length !== 1 || table.cascades.delete.length || table.cascades.detach.length ||
      table.columns.find(column => column.name === "shipping_option_id")?.nullable !== false ||
      table.columns.find(column => column.name === "id")?.options?.prefix !== "sorul" ||
      Object.keys(ShippingOptionRuleCreate.fields).some(name => !table.columns.some(column => column.name === name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = graph.entities.find(entity => entity.table === table)?.decodeRow;
    if (complete === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const projection = yield* compileRowProjection(table);
    const identified = (input: unknown, full: boolean) => Result.gen(function* () {
      const row = yield* (full ? complete(input) : projection(input));
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256)
        return yield* Result.fail(commerceError("storedCorruption"));
      const identified: JsonObject & { readonly id: string } = { ...row, id: row.id };
      return identified;
    });
    const decodeRow = (input: unknown) => identified(input, true);
    const decodeSelectedRows = maximum === 4 ? decodeRowsShape : commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(maximum)), "storedCorruption");
    const decode = (input: unknown, full: boolean, active: boolean, aliases = false) => Result.gen(function* () {
      const rows = yield* decodeSelectedRows(input), seen = new Set<string>();
      const result: Array<JsonObject & { readonly id: string }> = [];
      for (const value of rows) {
        const row = yield* identified(value, full);
        if (!aliases && seen.has(row.id) || active && row.deleted_at !== undefined && row.deleted_at !== null)
          return yield* Result.fail(commerceError("storedCorruption"));
        seen.add(row.id); result.push(row);
      }
      return result;
    });
    const decodeRows = (input: unknown) => decode(input, true, true);
    const decodeCreatedRows = (input: unknown) => decode(input, true, true, true);
    const decodePreimages = (input: unknown) => decode(input, false, true);
    const decodeSerializedRows = (input: unknown) => decode(input, false, false);
    const decodeCreatedSerializedRows = (input: unknown) => decode(input, false, false, true);
    const Rows = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeRows(rows)) || "Expected complete native ShippingOptionRule rows"));
    const CreatedRows = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeCreatedRows(rows)) || "Expected complete native ShippingOptionRule creation rows"));
    // The SDK owns raw void callback reference representation. This decoder
    // admits only that authenticated native shape, without replacing it.
    const EmptyReference = Schema.Struct({ __type: Schema.Literal("Symbol(WorkflowWorkflowData)") });
    const Output = Schema.Struct({ created: CreatedRows, deleted: Schema.Union([ShippingOptionRuleIds, EmptyReference]),
      updated: Schema.Union([Rows, EmptyReference]) });
    return { table, decodeRow, decodeRows, decodeCreatedRows, decodePreimages, decodeSerializedRows, decodeCreatedSerializedRows, Rows, CreatedRows, Output };
  });
}
