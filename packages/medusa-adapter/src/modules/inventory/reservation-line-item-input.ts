import { Effect, Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { ScalarId } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import { ExactNumericRaw, projectExactNumericColumns } from "../../value/exact-numeric";
import { compileInventoryLevelContracts } from "./level-contracts";

export const ReservationLineItemIds = Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeReservationLineItemIds = commerceDecoder(ReservationLineItemIds, "invalidInput");
const Quantity = Schema.Number.check(Schema.isFinite());
const StoredReservation = Schema.Struct({ id: ScalarId, line_item_id: Schema.NullOr(Schema.String), allow_backorder: Schema.Boolean,
  inventory_item_id: ScalarId, location_id: ScalarId, quantity: Schema.Union([Schema.String, Quantity]), raw_quantity: ExactNumericRaw,
  external_id: Schema.NullOr(Schema.String), description: Schema.NullOr(Schema.String), created_by: Schema.NullOr(Schema.String),
  metadata: Schema.Json, created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) });

/** Complete checked DML and exact quantities authenticate both lifecycle roots
 * and native arithmetic preimages. Native service DTO serialization is separate. */
export function compileReservationLineItemContracts(tables: readonly SchemaTable[]) {
  return Result.gen(function* () {
    const reservation = tables.find(table => table.name === "reservation_item"), level = tables.find(table => table.name === "inventory_level");
    if (reservation === undefined || level === undefined || reservation.columns.length !== Object.keys(StoredReservation.fields).length ||
      reservation.columns.some(column => !Object.hasOwn(StoredReservation.fields, column.name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const numeric = reservation.columns.filter(column => column.type === "bigNumber");
    if (numeric.length !== 1 || numeric[0]?.name !== "quantity") return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeCompleteRow = yield* compileCompleteRow(reservation), shape = commerceDecoder(StoredReservation, "storedCorruption");
    const decodeStoredRow = Effect.fn("ReservationLineItem.decodeStoredRow")(function* (input: unknown) {
      const row = yield* Effect.fromResult(decodeCompleteRow(input).pipe(Result.flatMap(shape)));
      yield* projectExactNumericColumns(row, numeric, "exact");
      return row;
    });
    const levelContracts = yield* compileInventoryLevelContracts(level);
    return { numeric, decodeCompleteRow, decodeStoredRow, levelContracts };
  });
}
