import { Effect, Result, Schema } from "effect";
import { OrderStatus } from "@medusajs/framework/utils/portable";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import type { captureOrderMetadata } from "./schema";

export const OrderArchiveId = Schema.String.check(Schema.isLengthBetween(1, 256));
export const OrderArchiveIds = Schema.Array(OrderArchiveId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const OrderArchiveInput = Schema.Struct({ orderIds: OrderArchiveIds });
export const OrderArchiveStatuses = Schema.Array(Schema.Struct({ id: OrderArchiveId,
  status: Schema.Literals([OrderStatus.COMPLETED, OrderStatus.CANCELED, OrderStatus.DRAFT]),
})).pipe(Schema.mutable).check(Schema.isMaxLength(4), Schema.makeFilter(rows =>
  new Set(rows.map(row => row.id)).size === rows.length || "Expected distinct retained Orders"));
export const OrderArchiveRead = Schema.Struct({ filters: Schema.Struct({ id: OrderArchiveIds }),
  config: Schema.Struct({ select: Schema.Tuple([Schema.Literal("id"), Schema.Literal("status")]) }) });
export const OrderArchiveRows = Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4));
const OrderStatusPreimages = Schema.Array(Schema.Struct({ id: OrderArchiveId,
  status: Schema.Literals(Object.values(OrderStatus)) })).check(Schema.isMaxLength(4));
const decodeObjects = commerceDecoder(OrderArchiveRows, "storedCorruption");
const decodeReference = commerceDecoder(Schema.NullOr(Schema.Struct({ id: OrderArchiveId })), "storedCorruption");
export const decodeOrderArchiveIds = commerceDecoder(OrderArchiveIds, "invalidInput");
export const decodeOrderArchiveStatuses = commerceDecoder(OrderArchiveStatuses, "invalidInput");
export const decodeOrderArchiveRead = commerceDecoder(OrderArchiveRead, "invalidInput");

type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** Native DML owns the complete stored scalar shape, including preserved serial
 * values. This profile grants no creation, serial assignment or relation write. */
export function compileOrderArchiveContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const table = metadata.tables.find(table => table.name === "order");
    if (table === undefined || table.columns.find(column => column.name === "display_id")?.type !== "serial")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const name of ["shipping_address", "billing_address"]) {
      const relation = table.relationships.find(relation => relation.name === name);
      if (relation?.type !== "hasOneWithFK" || relation.targetTable !== "order_address" ||
        relation.foreignKeyNames?.length !== 1 || relation.foreignKeyNames[0] !== name + "_id")
        return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    const complete = yield* compileCompleteRow(table);
    const identify = commerceDecoder(Schema.StructWithRest(Schema.Struct({ id: OrderArchiveId,
      status: Schema.Literals(Object.values(OrderStatus)) }), [Schema.Record(Schema.String, Schema.Json)]), "storedCorruption");
    const decodeRow = (input: unknown) => complete(input).pipe(Result.flatMap(identify));
    const decodeStoredRows = (input: unknown) => decodeObjects(input).pipe(
      Result.flatMap(rows => Result.gen(function* () { for (const row of rows) yield* decodeRow(row); return rows; })));
    const decodePreimages = commerceDecoder(OrderStatusPreimages, "storedCorruption");
    /** Native owning to-one references retain non-null scalar keys, including
     * historical Address IDs; null keys are omitted while relation slots remain.
     * No population or Address read belongs to this default archive projection. */
    const present = (input: unknown) => decodeRow(input).pipe(Result.flatMap(row => Result.gen(function* () {
      const result: Record<string, Json> = { ...row };
      for (const name of ["shipping_address", "billing_address"]) {
        const key = name + "_id", id = row[key];
        if (id !== null && typeof id !== "string") return yield* Result.fail(commerceError("storedCorruption"));
        if (id === null) delete result[key];
        result[name] = id === null ? null : { id };
      }
      return result;
    })));
    const decodeOutputRow = (input: JsonObject) => Result.gen(function* () {
      const scalar = { ...input };
      for (const name of ["shipping_address", "billing_address"]) {
        const reference = yield* decodeReference(scalar[name]), key = name + "_id";
        if (reference === null ? scalar[key] !== undefined : scalar[key] !== reference.id)
          return yield* Result.fail(commerceError("storedCorruption"));
        scalar[key] = reference?.id ?? null; delete scalar[name];
      }
      yield* decodeRow(scalar);
      return input;
    });
    const decodeRows = (input: unknown) => decodeObjects(input).pipe(Result.flatMap(rows => Result.gen(function* () {
      for (const row of rows) yield* decodeOutputRow(row);
      return rows;
    })));
    const serialize = Effect.fn("OrderArchive.serialize")(function* (input: Json) {
      const rows = Array.isArray(input) ? input : [input], output: JsonObject[] = [];
      for (const row of rows) {
        if (!isJsonObject(row)) return yield* Effect.fail(commerceError("storedCorruption"));
        if (Object.keys(row).length === 2 && row.id !== undefined && row.status !== undefined) {
          yield* Effect.fromResult(decodePreimages([row])); output.push(row);
        } else output.push(yield* Effect.fromResult("shipping_address" in row || "billing_address" in row
          ? decodeOutputRow(row) : present(row)));
      }
      return Array.isArray(input) ? output : output[0]!;
    });
    const Output = OrderArchiveRows.check(Schema.makeFilter(rows => Result.isSuccess(decodeRows(rows)) || "Expected complete native Order DTOs"));
    return { table, decodeRow, decodeStoredRows, decodeRows, decodePreimages, present, serialize, Output };
  });
}
