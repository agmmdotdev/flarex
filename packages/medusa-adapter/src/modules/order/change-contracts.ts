import { Result, Schema, type Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { projectNativeRow } from "../../repository/result";
import { compileOrderStatusContracts } from "./input";
import type { captureOrderMetadata } from "./schema";

export const OrderChangeId = Schema.String.check(Schema.isLengthBetween(1, 256));
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** Native Change DML owns complete rows and the required Order reference.
 * Command-specific assignments and selected preimages stay with each profile. */
export function compileOrderChangeContracts(metadata: Metadata) {
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
    const identify = commerceDecoder(Schema.StructWithRest(Schema.Struct({ id: OrderChangeId, order_id: OrderChangeId }),
      [Schema.Record(Schema.String, Schema.Json)]), "storedCorruption");
    const reference = commerceDecoder(Schema.Struct({ id: OrderChangeId }), "storedCorruption");
    const decodeRow = (input: unknown) => complete(input).pipe(Result.flatMap(identify));
    const present = (input: unknown) => decodeRow(input).pipe(Result.map(row => ({ ...row, order: { id: row.order_id } })));
    const decodeOutputRow = (input: JsonObject) => Result.gen(function* () {
      const { order, ...scalar } = input, row = yield* decodeRow(scalar), selected = yield* reference(order);
      if (selected.id !== row.order_id) return yield* Result.fail(commerceError("storedCorruption"));
      const output: typeof row & { readonly order: typeof selected } = { ...row, order: selected };
      return output;
    });
    const orderPredicate = (rows: readonly JsonObject[]) => Result.gen(function* () {
      const ids = new Set<string>();
      for (const value of rows) ids.add((yield* decodeRow(value)).order_id);
      return { kind: "and", children: [{ kind: "in", column: "id", values: [...ids] },
        { kind: "isNull", column: "deleted_at" }] } satisfies JsonObject;
    });
    const filterActiveOrderChanges = (rows: readonly JsonObject[], orders: readonly JsonObject[]) => Result.gen(function* () {
      const active = new Map<string, Result.Result.Success<ReturnType<typeof orderContracts.decodeRow>>>();
      for (const value of orders) {
        const row = yield* orderContracts.decodeRow(projectNativeRow(value)), previous = active.get(row.id);
        if (previous !== undefined && !jsonEqual(previous, row)) return yield* Result.fail(commerceError("storedCorruption"));
        active.set(row.id, row);
      }
      const selected: Array<Result.Result.Success<ReturnType<typeof decodeRow>>> = [];
      for (const value of rows) {
        const row = yield* decodeRow(value);
        if (active.get(row.order_id)?.deleted_at === null) selected.push(row);
      }
      return selected;
    });
    return { table, order: orderContracts.table, decodeOrderRow: orderContracts.decodeRow,
      decodeRow, projection, present, decodeOutputRow, orderPredicate, filterActiveOrderChanges };
  });
}
