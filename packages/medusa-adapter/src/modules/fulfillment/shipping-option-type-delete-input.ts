import { Result, Schema, type Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import { compileShippingOptionTypeCreationContracts } from "./shipping-option-type-input";
import type { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
/** Raw IDs also belong to native hook, event and inverse inputs. */
export const ShippingOptionTypeDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeShippingOptionTypeDeletionIds = commerceDecoder(ShippingOptionTypeDeletionIds, "invalidInput");
export const decodeShippingOptionTypeDeletionArguments = commerceDecoder(Schema.Tuple([ShippingOptionTypeDeletionIds]), "invalidInput");
export const decodeShippingOptionTypeDeletionOutput = commerceDecoder(Schema.Struct({
  shipping_option_type_id: Schema.optionalKey(ShippingOptionTypeDeletionIds),
}), "storedCorruption");
/** The root asks only this existence page. Its count remains the actual total. */
export const ShippingOptionTypeDeletionReadInput = Schema.Struct({
  filters: Schema.Struct({ shipping_option_type_id: ShippingOptionTypeDeletionIds }),
  config: Schema.Struct({ select: Schema.Tuple([Schema.Literal("id")]), relations: Schema.Tuple([]),
    order: Schema.Struct({ id: Schema.Literal("ASC") }), skip: Schema.Literal(0), take: Schema.Literal(1) }),
});
export const decodeShippingOptionTypeDeletionRead = commerceDecoder(ShippingOptionTypeDeletionReadInput, "invalidInput");
const decodeTupleShape = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  Schema.Struct({ ShippingOptionType: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMinLength(1), Schema.isMaxLength(4))) }),
]), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"];

/** Reuse the installed Type DML and inverse-FK checks without granting creation
 * or cascading Option lifecycle. Each repository validates its own model. */
export function compileShippingOptionTypeDeletionContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const { table, decodeRow } = yield* compileShippingOptionTypeCreationContracts(metadata);
    const option = metadata.tables.find(table => table.name === "shipping_option");
    if (option === undefined || !option.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "shipping_option_type_id" &&
      key.referencedTable === table.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id"))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const completeOption = yield* compileCompleteRow(option);
    const decodeOptionRow = (input: unknown) => Result.gen(function* () {
      const row = yield* completeOption(input);
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256)
        return yield* Result.fail(commerceError("storedCorruption"));
      const identified: JsonObject & { readonly id: string } = { ...row, id: row.id };
      return identified;
    });
    const entities = [{ table, model: "ShippingOptionType", linkableKey: "shipping_option_type_id", maximum: 4, decodeRow }];
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const tuple = yield* decodeTupleShape(input);
      if (!jsonEqual(tuple[0], tuple[1].ShippingOptionType ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      for (const row of tuple[0]) yield* decodeRow(row);
      const cascades: Record<string, object[]> = {};
      if (tuple[1].ShippingOptionType !== undefined) cascades.ShippingOptionType = tuple[1].ShippingOptionType.map(row => ({ ...row }));
      return [tuple[0].map(row => ({ ...row })), cascades] satisfies [object[], Record<string, unknown[]>];
    });
    return { table, option, entities, decodeRow, decodeOptionRow, decodeLifecycleResult, decodeOutput: decodeShippingOptionTypeDeletionOutput };
  });
}
