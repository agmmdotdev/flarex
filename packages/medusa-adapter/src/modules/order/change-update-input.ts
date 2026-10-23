import { Effect, Result, Schema } from "effect";
import { OrderChangeStatus } from "@medusajs/framework/utils/portable";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { compileOrderStatusContracts } from "./input";
import type { captureOrderMetadata } from "./schema";

export const OrderChangeUpdateId = Schema.String.check(Schema.isLengthBetween(1, 256));
export const OrderChangeUpdateIds = Schema.Array(OrderChangeUpdateId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
/** Finite scalar assignments only. Dates, metadata and relationships require
 * their own native compensation proof before joining this profile. */
export const OrderChangeUpdateData = Schema.Struct({ id: OrderChangeUpdateId,
  status: Schema.optionalKey(Schema.NullOr(Schema.Literals(Object.values(OrderChangeStatus)))),
  description: Text, internal_note: Text, requested_by: Text, confirmed_by: Text,
  declined_by: Text, declined_reason: Text, canceled_by: Text,
  carry_over_promotions: Schema.optionalKey(Schema.NullOr(Schema.Boolean)) });
export const OrderChangeUpdateInput = Schema.Array(OrderChangeUpdateData).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const OrderChangeUpdateFields = Object.freeze(Object.keys(OrderChangeUpdateData.fields));
export const OrderChangeUpdateRead = Schema.Struct({ filters: Schema.Struct({ id: OrderChangeUpdateIds }),
  config: Schema.Struct({ select: Schema.Array(Schema.Literals(OrderChangeUpdateFields)).pipe(Schema.mutable)
    .check(Schema.isLengthBetween(1, OrderChangeUpdateFields.length)), relations: Schema.Array(Schema.Never).pipe(Schema.mutable) }) });
const Objects = Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4));
const decodeObjects = commerceDecoder(Objects, "storedCorruption");
const decodeReference = commerceDecoder(Schema.Struct({ id: OrderChangeUpdateId }), "storedCorruption");
const decodePreimageShape = commerceDecoder(OrderChangeUpdateData, "storedCorruption");
export const decodeOrderChangeUpdateInput = commerceDecoder(OrderChangeUpdateInput, "invalidInput");
export const decodeOrderChangeUpdateRead = commerceDecoder(OrderChangeUpdateRead, "invalidInput");

type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** Checked native DML owns every unchanged date, JSON column and Order key.
 * Full mutation DTOs and selected scalar preimages have distinct contracts. */
export function compileOrderChangeUpdateContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const table = metadata.tables.find(table => table.name === "order_change");
    const relation = table?.relationships.find(relation => relation.name === "order");
    if (table === undefined || relation?.type !== "belongsTo" || relation.targetTable !== "order" ||
      relation.foreignKeyNames?.length !== 1 || relation.foreignKeyNames[0] !== "order_id" ||
      !table.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "order_id" &&
        key.referencedTable === "order" && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id"))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const orderContracts = yield* compileOrderStatusContracts(metadata);
    const complete = yield* compileCompleteRow(table), projection = yield* compileRowProjection(table);
    const identify = commerceDecoder(Schema.StructWithRest(Schema.Struct({ id: OrderChangeUpdateId, order_id: OrderChangeUpdateId }),
      [Schema.Record(Schema.String, Schema.Json)]), "storedCorruption");
    const decodeRow = (input: unknown) => complete(input).pipe(Result.flatMap(identify));
    const decodePreimages = (input: unknown) => Result.gen(function* () {
      const rows: Array<typeof OrderChangeUpdateData.Type> = [], seen = new Set<string>();
      for (const value of yield* decodeObjects(input)) {
        const row = yield* decodePreimageShape(value);
        yield* projection(row);
        if (seen.has(row.id)) return yield* Result.fail(commerceError("storedCorruption"));
        seen.add(row.id); rows.push(row);
      }
      return rows;
    });
    const present = (input: unknown) => decodeRow(input).pipe(Result.map(row => ({ ...row, order: { id: row.order_id } })));
    const decodeOutputRow = (input: JsonObject) => Result.gen(function* () {
      const { order, ...scalar } = input, row = yield* decodeRow(scalar), reference = yield* decodeReference(order);
      if (reference.id !== row.order_id) return yield* Result.fail(commerceError("storedCorruption"));
      return { ...row, order: reference };
    });
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const rows: Array<Result.Result.Success<ReturnType<typeof decodeOutputRow>>> = [], seen = new Set<string>();
      for (const value of yield* decodeObjects(input)) {
        const row = yield* decodeOutputRow(value);
        if (seen.has(row.id)) return yield* Result.fail(commerceError("storedCorruption"));
        seen.add(row.id); rows.push(row);
      }
      return rows;
    });
    const serialize = Effect.fn("OrderChangeUpdate.serialize")(function* (input: Json) {
      const rows = Array.isArray(input) ? input : [input], output: JsonObject[] = [];
      for (const row of rows) {
        if (!isJsonObject(row)) return yield* Effect.fail(commerceError("storedCorruption"));
        if (Object.hasOwn(row, "order")) output.push(yield* Effect.fromResult(decodeOutputRow(row)));
        else if (Object.hasOwn(row, "order_id")) output.push(yield* Effect.fromResult(present(row)));
        else output.push(...yield* Effect.fromResult(decodePreimages([row])));
      }
      return Array.isArray(input) ? output : output[0]!;
    });
    const Output = Objects.check(Schema.makeFilter(rows => Result.isSuccess(decodeRows(rows)) || "Expected complete native Order Change DTOs"));
    return { table, order: orderContracts.table, decodeOrderRow: orderContracts.decodeRow,
      decodeRow, decodePreimages, decodeRows, present, serialize, Output };
  });
}
