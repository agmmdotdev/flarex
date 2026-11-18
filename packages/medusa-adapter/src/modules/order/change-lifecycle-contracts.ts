import { Effect, Result, Schema } from "effect";
import { supportsNativeJsonObjectAssignment } from "@medusajs/utils/dal/json-assignment";
import { commerceError, isJsonObject, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileOrderChangeContracts } from "./change-contracts";
import type { captureOrderMetadata } from "./schema";

/** Existing Change lifecycle assignments use the native JSON domain. Each
 * profile separately owns input presence, merge and exact inverse authority. */
export const OrderChangeLifecycleMetadata = Schema.NullOr(Schema.JsonObject).check(Schema.makeFilter(value =>
  supportsNativeJsonObjectAssignment(value) || "Unsupported native JSON assignment domain"));
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** DML rows and DTO serialization are common to existing-Change lifecycles.
 * The profile's decoder owns the selected fields/status domain; DML still
 * validates its projection. No mutation or compensation fields are inferred. */
export function compileOrderChangeLifecycleContracts<Selected extends JsonObject>(metadata: Metadata,
  decodeSelection: (input: unknown) => Result.Result<Selected, CommerceTransactionError>) {
  return Result.gen(function* () {
    const common = yield* compileOrderChangeContracts(metadata);
    const decodeMetadata = commerceDecoder(OrderChangeLifecycleMetadata, "storedCorruption");
    const decodeRow = (input: unknown) => common.decodeRow(input).pipe(Result.flatMap(row => decodeMetadata(row.metadata).pipe(Result.map(() => row))));
    const present = (input: unknown) => decodeRow(input).pipe(Result.flatMap(common.present));
    const decodeOutputRow = (input: JsonObject) => common.decodeOutputRow(input).pipe(
      Result.flatMap(row => decodeMetadata(row.metadata).pipe(Result.map(() => row))));
    const decodeSelected = (input: unknown) => decodeSelection(input).pipe(Result.flatMap(value => common.projection(value).pipe(Result.map(() => value))));
    const objects = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(1)), "storedCorruption");
    const object = commerceDecoder(Schema.JsonObject, "storedCorruption");
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const output: Array<Result.Result.Success<ReturnType<typeof decodeOutputRow>>> = [];
      for (const value of yield* objects(input)) output.push(yield* decodeOutputRow(value));
      return output;
    });
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      return yield* decodeOutputRow(yield* object(input));
    });
    const serialize = Effect.fn("OrderChangeLifecycle.serialize")(function* (input: Json) {
      const rows = Array.isArray(input) ? input : [input], output: JsonObject[] = [];
      if (rows.length > 1) return yield* Effect.fail(commerceError("limitExceeded"));
      for (const row of rows) {
        if (!isJsonObject(row)) return yield* Effect.fail(commerceError("storedCorruption"));
        if (Object.hasOwn(row, "order")) output.push(yield* Effect.fromResult(decodeOutputRow(row)));
        else if (Object.hasOwn(row, "order_id")) {
          // The genuine guard selects identity columns without producing a
          // complete native DTO; its DML projection remains separately checked.
          if (Object.keys(row).length === common.table.columns.length) output.push(yield* Effect.fromResult(present(row)));
          else output.push(yield* Effect.fromResult(common.projection(row).pipe(
            Result.flatMap(captureCommerceInput), Result.flatMap(object))));
        } else output.push(yield* Effect.fromResult(decodeSelected(row)));
      }
      if (Array.isArray(input)) return output;
      const row = output[0];
      if (row === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
      return row;
    });
    return { ...common, decodeRow, present, decodeOutputRow, decodeSelected, decodeRows, decodeOutput, serialize };
  });
}
