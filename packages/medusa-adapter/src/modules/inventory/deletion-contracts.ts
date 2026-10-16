import { Effect, Result } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { compileCompleteRow } from "../../value/complete-row";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { projectNativeRow } from "../../repository/result";

/** One checked three-model storage contract serves computed reads and both
 * generated lifecycle operations, including exact quantity companions. */
export function compileInventoryDeletionContracts(tables: readonly SchemaTable[]) {
  return Result.gen(function* () {
    const entries: { table: SchemaTable; decode: Result.Result.Success<ReturnType<typeof compileCompleteRow>>; numeric: SchemaTable["columns"] }[] = [];
    for (const name of ["inventory_item", "inventory_level", "reservation_item"]) {
      const table = tables.find(table => table.name === name);
      if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      entries.push({ table, decode: yield* compileCompleteRow(table), numeric: table.columns.filter(column => column.type === "bigNumber") });
    }
    const decodeRow = Effect.fn("InventoryDeletion.decodeRow")(function* (table: string, input: JsonObject) {
      const entry = entries.find(entry => entry.table.name === table);
      if (entry === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
      const row = yield* Effect.fromResult(entry.decode(projectNativeRow(input)));
      yield* projectExactNumericColumns(row, entry.numeric, "exact");
      return row;
    });
    return { decodeRow };
  });
}
