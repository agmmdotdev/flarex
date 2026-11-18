import { Effect, Result } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { selectOrderFinanceReceiptRows, type OrderFinanceRows } from "./finance-read-receipt";
import type { prepareOrderFinanceRepository } from "./finance-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderFinanceRepository>>;
type Row = JsonObject & { readonly id: string };
const mismatch = (phase: string) => commerceError("receiptMismatch", { phase });

/** Reconstruct the native call's preimage from authenticated observations and
 * mutation bodies. This ledger executes no storage reads or business writes;
 * each financial method still authenticates its exact causal transcript. */
export const prepareOrderFinanceReceiptState = Effect.fn("OrderFinance.receiptState")(function* (
  prepared: Prepared,
  activity: Parameters<LogicalCallReceiptValidation>[1],
  observedTables: readonly string[],
  mutationTables: readonly string[],
) {
  const state = new Map<string, Map<string, Row>>(), observations: Array<{ table: string; row: Row }> = [];
  const bodies = new Map<string, Row[]>();
  const put = (table: string, row: Row) => {
    const group = state.get(table) ?? new Map<string, Row>(); group.set(row.id, row); state.set(table, group);
  };
  const remove = (table: string, id: string) => { state.get(table)?.delete(id); };
  const decodeRow = (table: string, input: Json) => Result.gen(function* () {
    if (!observedTables.includes(table) || !isJsonObject(input)) return yield* Result.fail(mismatch("table"));
    const entity = yield* prepared.contracts.entity(table), row = yield* entity.complete(projectNativeRow(input));
    if (typeof row.id !== "string") return yield* Result.fail(mismatch("identity"));
    const retained: Row = { ...row, id: row.id };
    return retained;
  });
  for (const observation of activity.observedRows) {
    const row = yield* Effect.fromResult(decodeRow(observation.table, observation.row));
    observations.push({ table: observation.table, row }); put(observation.table, row);
  }
  for (const [ordinal, mutation] of activity.mutations.entries()) {
    if (mutation.ordinal !== ordinal || mutation.realNormalization !== undefined || !mutationTables.includes(mutation.table))
      return yield* Effect.fail(mismatch("mutation"));
    for (const value of [mutation.before, mutation.after]) if (value !== null) {
      const row = yield* Effect.fromResult(decodeRow(mutation.table, value)), key = mutation.table + ":" + row.id;
      const known = bodies.get(key) ?? []; known.push(row); bodies.set(key, known);
    }
  }
  for (const { table, row } of observations) {
    const known = bodies.get(table + ":" + row.id);
    if (known !== undefined && !known.some(value => jsonEqual(value, row))) return yield* Effect.fail(mismatch("observation"));
    if (known === undefined && observations.some(value => value.table === table && value.row.id === row.id && !jsonEqual(value.row, row)))
      return yield* Effect.fail(mismatch("inconsistent-observation"));
  }
  for (const mutation of [...activity.mutations].reverse()) {
    if (mutation.before !== null) put(mutation.table, yield* Effect.fromResult(decodeRow(mutation.table, mutation.before)));
    else if (mutation.after !== null && typeof mutation.after.id === "string") remove(mutation.table, mutation.after.id);
  }
  const rows = (): OrderFinanceRows => new Map([...state].map(([table, group]) => [table, [...group.values()]]));
  const reads: JsonObject[] = [];
  const selectResult = (table: string, filters: JsonObject, config: JsonObject = {}) =>
    selectOrderFinanceReceiptRows(prepared, rows(), table, filters, config).pipe(Result.map(selected => {
      reads.push(...selected.reads); return selected;
    }));
  const select = Effect.fn("OrderFinance.selectWriteReceipt")((table: string, filters: JsonObject, config: JsonObject = {}) =>
    Effect.fromResult(selectResult(table, filters, config)));
  return { put, remove, has: (table: string, id: string) => state.get(table)?.has(id) === true, decodeRow, rows, reads, select, selectResult };
});

/** Native Promise.all admits interleaving between independent model families.
 * Retain every entry and its order within a family; no sorting or set deduplication
 * may erase repeated reads, changed counts, extra events or reversed identities. */
export function sameOrderFinanceFamilyTranscript(actual: readonly Json[], expected: readonly Json[], familyField: "table" | "object"): boolean {
  const group = (rows: readonly Json[]) => {
    const families = new Map<string, Json[]>();
    for (const row of rows) {
      if (!isJsonObject(row) || typeof row[familyField] !== "string") return undefined;
      const family = row[familyField], entries = families.get(family) ?? [];
      entries.push(row); families.set(family, entries);
    }
    return families;
  };
  const left = group(actual), right = group(expected);
  return left !== undefined && right !== undefined && left.size === right.size && [...left].every(([family, rows]) => {
    const other = right.get(family); return other !== undefined && jsonEqual(rows, other);
  });
}
