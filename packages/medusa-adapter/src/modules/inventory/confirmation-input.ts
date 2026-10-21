import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ScalarId } from "../../repository/scalar-id-read";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { captureNativeNumericComparisonResult } from "../../value/exact-numeric";
import { captureCommerceInput } from "../../value/input";
import { captureWorkflowArray } from "../../workflow/configuration";
import { compileInventoryItemContracts } from "./item-contracts";
import { compileInventoryLevelContracts } from "./level-contracts";

export const InventoryConfirmationLocations = Schema.Array(ScalarId).check(Schema.isMaxLength(4));
const Input = Schema.Struct({ inventory_item_id: ScalarId, location_ids: InventoryConfirmationLocations, quantity: Schema.String });
const Arguments = Schema.Tuple([ScalarId, InventoryConfirmationLocations, Schema.String]);
const decodeInput = commerceDecoder(Input, "invalidInput");
export const decodeInventoryConfirmationArguments = commerceDecoder(Arguments, "invalidInput");
export const decodeInventoryConfirmationOutput = commerceDecoder(Schema.Boolean, "storedCorruption");
export const decodeInventoryConfirmation = (input: unknown) => decodeInput(input).pipe(Result.flatMap(value =>
  captureNativeNumericComparisonResult(value.quantity).pipe(Result.map(quantity => ({ ...value, quantity })))));

/** Native workflow arithmetic may provide a genuine MathBN object. The existing
 * composed-resource boundary alone converts it before JSON command capture.
 * Descriptor capture leaves accessor arguments inert and admits no context. */
export function normalizeInventoryConfirmationArguments(input: unknown) {
  return Result.gen(function* () {
    if (!Array.isArray(input)) return yield* Result.fail(commerceError("invalidInput"));
    const args = yield* captureWorkflowArray(input);
    if (args.length !== 3) return yield* Result.fail(commerceError("invalidInput"));
    const quantity = yield* captureNativeNumericComparisonResult(args[2]);
    return yield* captureCommerceInput([args[0], args[1], quantity]).pipe(Result.flatMap(decodeInventoryConfirmationArguments));
  });
}

export function compileInventoryConfirmationContracts(tables: readonly SchemaTable[]) {
  return Result.gen(function* () {
    const item = tables.find(table => table.name === "inventory_item"), level = tables.find(table => table.name === "inventory_level");
    if (item === undefined || level === undefined || [item, level].some(table => {
      const primary = table.columns.filter(column => column.primaryKey);
      return primary.length !== 1 || primary[0]?.name !== "id" || primary[0].type !== "id";
    })) return yield* Result.fail(commerceError("unsupportedProfile"));
    return { item, level, itemContracts: yield* compileInventoryItemContracts(item), levelContracts: yield* compileInventoryLevelContracts(level) };
  });
}
export type InventoryConfirmationContracts = Result.Result.Success<ReturnType<typeof compileInventoryConfirmationContracts>>;
