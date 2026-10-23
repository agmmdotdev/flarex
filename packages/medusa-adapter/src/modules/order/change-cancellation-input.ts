import { Effect, Result, Schema } from "effect";
import { OrderChangeStatus } from "@medusajs/framework/utils/portable";
import { supportsNativeJsonObjectAssignment } from "@medusajs/utils/dal/json-assignment";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { OrderChangeId, compileOrderChangeContracts } from "./change-contracts";
import type { captureOrderMetadata } from "./schema";

export const OrderChangeCancellationMetadata = Schema.NullOr(Schema.JsonObject).check(Schema.makeFilter(value =>
  supportsNativeJsonObjectAssignment(value) || "Unsupported native JSON assignment domain"));
const MetadataValue = OrderChangeCancellationMetadata;
export const OrderChangeCancellationInput = Schema.Struct({ id: OrderChangeId,
  canceled_by: Schema.optionalKey(Schema.String), metadata: Schema.optionalKey(MetadataValue) });
export const OrderChangeCancellationPreimage = Schema.Struct({ id: OrderChangeId,
  status: Schema.Literals([OrderChangeStatus.PENDING, OrderChangeStatus.REQUESTED]),
  canceled_at: Schema.NullOr(Schema.String), canceled_by: Schema.NullOr(Schema.String),
  metadata: Schema.optionalKey(MetadataValue) });
const Selection = Schema.Struct({ ...OrderChangeCancellationPreimage.fields,
  status: Schema.NullOr(Schema.Literals(Object.values(OrderChangeStatus))) });
export const OrderChangeCancellationFields = Object.freeze(Object.keys(OrderChangeCancellationPreimage.fields));
export const OrderChangeCancellationRead = Schema.Struct({ id: OrderChangeId, config: Schema.Struct({
  select: Schema.Array(Schema.Literals(OrderChangeCancellationFields)).pipe(Schema.mutable).check(Schema.isLengthBetween(4, 5),
    Schema.makeFilter(fields => ["id", "status", "canceled_at", "canceled_by"].every(field => fields.includes(field)) &&
      new Set(fields).size === fields.length || "Expected cancellation preimage fields")),
  relations: Schema.Array(Schema.Never).pipe(Schema.mutable),
}) });
export const decodeOrderChangeCancellationInput = commerceDecoder(OrderChangeCancellationInput, "invalidInput");
export const decodeOrderChangeCancellationRead = commerceDecoder(OrderChangeCancellationRead, "invalidInput");
export const decodeOrderChangeCancellationPreimage = commerceDecoder(OrderChangeCancellationPreimage, "invalidInput");
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

export function compileOrderChangeCancellationContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const common = yield* compileOrderChangeContracts(metadata);
    const decodeMetadata = commerceDecoder(MetadataValue, "storedCorruption");
    const decodeRow = (input: unknown) => common.decodeRow(input).pipe(Result.flatMap(row => decodeMetadata(row.metadata).pipe(Result.map(() => row))));
    const present = (input: unknown) => decodeRow(input).pipe(Result.flatMap(common.present));
    const decodeOutputRow = (input: JsonObject) => common.decodeOutputRow(input).pipe(
      Result.flatMap(row => decodeMetadata(row.metadata).pipe(Result.map(() => row))));
    const shape = commerceDecoder(OrderChangeCancellationPreimage, "storedCorruption");
    const decodePreimage = (input: unknown) => shape(input).pipe(Result.flatMap(value => common.projection(value).pipe(Result.map(() => value))));
    const selected = commerceDecoder(Selection, "storedCorruption");
    const decodeSelected = (input: unknown) => selected(input).pipe(Result.flatMap(value => common.projection(value).pipe(Result.map(() => value))));
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
    const serialize = Effect.fn("OrderChangeCancellation.serialize")(function* (input: Json) {
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
      return Array.isArray(input) ? output : output[0]!;
    });
    return { ...common, decodeRow, present, decodeOutputRow, Preimage: OrderChangeCancellationPreimage,
      decodePreimage, decodeSelected, decodeRows, decodeOutput, serialize };
  });
}
