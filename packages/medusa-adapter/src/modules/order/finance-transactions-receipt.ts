import { Effect, Result, Schema } from "effect";
import { updateOrderPaymentSummaries } from "@medusajs/order/utils/payment-accounting";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { commerceDecoder } from "../../value/decoder";
import { encodeNativeExactNumeric, ExactNumericRaw } from "../../value/exact-numeric";
import { OrderFinanceTransaction, decodeOrderFinanceTransactions, decodeOrderFinanceDelete } from "./finance-input";
import { orderFinanceEventCapture } from "./finance-events";
import { prepareOrderFinanceReceiptState } from "./finance-receipt-state";
import { captureOrderFinanceTotals } from "./finance-summary";
import type { prepareOrderFinanceRepository } from "./finance-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderFinanceRepository>>;
const mismatch = (phase: string, cause?: unknown) => commerceError("receiptMismatch", { phase, cause });
const Amount = OrderFinanceTransaction.fields.amount;
const decodeAccountingSummary = commerceDecoder(Schema.Struct({ order_id: Schema.String,
  totals: Schema.Struct({ paid_total: Amount, refunded_total: Amount, transaction_total: Amount, pending_difference: Amount }) }), "receiptMismatch");
const decodeAccountingTransaction = commerceDecoder(Schema.Struct({ order_id: Schema.String, version: Schema.Number, amount: Amount,
  raw_amount: Schema.optionalKey(ExactNumericRaw) }), "receiptMismatch");

/** Replay selected DAL causality against actual storage observations. The
 * extracted native helper owns accounting; this policy never reads storage,
 * assigns an identity/time/default, or supplies a second transaction lifetime. */
export const validateOrderFinanceTransactions = (prepared: Prepared): LogicalCallReceiptValidation =>
  Effect.fn("OrderFinance.validateTransactions")(function* (call, activity) {
    const removing = call.commandName === "orderPaymentFinanceTransactionsDelete";
    if (!removing && call.commandName !== "orderPaymentFinanceTransactionsAdd" || call.mode !== "write" ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch("activity"));
    const state = yield* prepareOrderFinanceReceiptState(prepared, activity,
      ["order", "order_transaction", "order_summary"], ["order_transaction", "order_summary"]);
    const { select, reads, put, decodeRow } = state;
    let position = 0;
    const expectedEvents: Array<{ object: string; action: string; id: string }> = [];
    let transactions: JsonObject[];
    if (removing) {
      const input = yield* Effect.fromResult(decodeOrderFinanceDelete(call.input)), ids = typeof input === "string" ? [input] : input;
      const selected = yield* select("order_transaction", { id: ids }, { select: ["order_id", "version", "amount"] });
      const presented = yield* prepared.contracts.present(selected.rows, "order_transaction");
      if (!Array.isArray(presented) || presented.some(row => !isJsonObject(row))) return yield* Effect.fail(mismatch("transaction-dto"));
      transactions = [];
      for (const row of presented) if (isJsonObject(row)) transactions.push(row);
      // Native internal deletion writes these identities directly and emits
      // afterDelete manually. Its complete preimages come from mutation
      // evidence; no additional DAL selection belongs to this transcript.
      for (const id of ids) {
        const before = state.rows().get("order_transaction")?.find(row => row.id === id);
        const mutation = activity.mutations[position++];
        if (before === undefined || mutation?.table !== "order_transaction" || mutation.operation !== "delete" || mutation.before === null || mutation.after !== null ||
          !jsonEqual(projectNativeRow(mutation.before), before)) return yield* Effect.fail(mismatch("delete"));
        state.remove("order_transaction", before.id); expectedEvents.push({ object: "order_transaction", action: "deleted", id: before.id });
      }
    } else {
      const input = yield* Effect.fromResult(decodeOrderFinanceTransactions(call.input));
      const selected = yield* select("order", { id: input.map(row => row.order_id) }, { select: ["id", "version"] });
      if (selected.roots.length !== 1) return yield* Effect.fail(mismatch("order"));
      const parent = selected.roots[0]!;
      if (typeof parent.version !== "number") return yield* Effect.fail(mismatch("order-version"));
      transactions = [];
      for (const requested of input) {
        const numeric = yield* encodeNativeExactNumeric(requested.amount), mutation = activity.mutations[position++];
        if (mutation?.table !== "order_transaction" || mutation.operation !== "insert" || mutation.before !== null || mutation.after === null)
          return yield* Effect.fail(mismatch("insert"));
        const after = yield* Effect.fromResult(decodeRow("order_transaction", mutation.after));
        if (state.has("order_transaction", after.id) || after.deleted_at !== null || after.created_at !== after.updated_at)
          return yield* Effect.fail(mismatch("insert-state"));
        const expected: JsonObject = { ...requested, version: parent.version, amount: numeric.value,
          raw_amount: { value: numeric.raw.value, precision: numeric.raw.precision } };
        for (const [name, value] of Object.entries(after)) if (!["id", "created_at", "updated_at", "deleted_at"].includes(name) &&
          !jsonEqual(value, expected[name] ?? null)) return yield* Effect.fail(mismatch("insert-field"));
        put("order_transaction", after); transactions.push(after);
        expectedEvents.push({ object: "order_transaction", action: "created", id: after.id });
      }
    }
    // Native summary selection reads the first transaction's version. A
    // successful financial call therefore requires a nonempty active cohort.
    if (transactions.length === 0) return yield* Effect.fail(mismatch("empty-native-accounting"));
    const accounting = yield* Effect.fromResult(Result.all(transactions.map(row => decodeAccountingTransaction({
      order_id: row.order_id, version: row.version, amount: row.amount,
      ...(row.raw_amount === undefined ? {} : { raw_amount: row.raw_amount }),
    }))));
    const summaries = yield* select("order_summary", { order_id: accounting.map(row => row.order_id), version: accounting[0]!.version });
    const work = yield* Effect.fromResult(Result.all(summaries.rows.map(row => decodeAccountingSummary({
      order_id: row.order_id, totals: row.totals !== undefined && isJsonObject(row.totals) ? {
        paid_total: row.totals.paid_total, refunded_total: row.totals.refunded_total,
        transaction_total: row.totals.transaction_total, pending_difference: row.totals.pending_difference,
      } : null,
    }))));
    yield* Effect.try({ try: () => updateOrderPaymentSummaries(work, accounting, removing), catch: cause => mismatch("native-accounting", cause) });
    const expectedTotals = new Map<string, JsonObject>();
    for (const [index, summary] of summaries.roots.entries()) {
      const changed = work[index];
      if (changed === undefined || summary.totals === undefined || !isJsonObject(summary.totals)) return yield* Effect.fail(mismatch("summary"));
      expectedTotals.set(summary.id, yield* captureOrderFinanceTotals({ ...summary.totals, ...changed.totals }));
    }
    const targets = yield* select("order_summary", { $or: summaries.roots.map(row => ({ id: row.id })) });
    for (const before of targets.roots) {
      const mutation = activity.mutations[position++], totals = expectedTotals.get(before.id);
      if (totals === undefined || mutation?.table !== "order_summary" || mutation.operation !== "patch" || mutation.before === null || mutation.after === null ||
        !jsonEqual(projectNativeRow(mutation.before), before)) return yield* Effect.fail(mismatch("summary-patch"));
      const after = yield* Effect.fromResult(decodeRow("order_summary", mutation.after));
      const { updated_at: _afterTime, ...actual } = after, { updated_at: _beforeTime, ...previous } = before;
      if (!jsonEqual(actual, { ...previous, totals })) return yield* Effect.fail(mismatch("summary-fields"));
      put("order_summary", after); expectedEvents.push({ object: "order_summary", action: "updated", id: after.id });
    }
    const result = removing ? null : yield* prepared.contracts.present(transactions, "order_transaction");
    if (position !== activity.mutations.length || !jsonEqual(call.result, result) || !jsonEqual(activity.relationalReads, reads))
      return yield* Effect.fail(mismatch("result"));
    const capture = orderFinanceEventCapture(prepared), actualEvents = [];
    for (const value of call.events) {
      const event = yield* capture(value);
      for (const id of Array.isArray(event.data.id) ? event.data.id : [event.data.id])
        actualEvents.push({ object: event.metadata.object, action: event.metadata.action, id });
    }
    if (!jsonEqual(actualEvents, expectedEvents)) return yield* Effect.fail(mismatch("events"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
