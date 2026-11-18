import { Effect, Result } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { decodeOrderFinanceDelete } from "./finance-input";
import { orderFinanceEventCapture } from "./finance-events";
import { prepareOrderFinanceReceiptState } from "./finance-receipt-state";
import type { prepareOrderFinanceRepository } from "./finance-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderFinanceRepository>>;
const mismatch = (phase: string) => commerceError("receiptMismatch", { phase });

/** Native Change creation compensators delete Actions before their parent.
 * Internal service deletion performs no preliminary DAL read. Authenticate its
 * actual complete preimages and returned event identities without inventing one.
 * Cascades and reference replacement are outside this finite leaf operation. */
export const validateOrderFinanceChangeDeletion = (prepared: Prepared): LogicalCallReceiptValidation =>
  Effect.fn("OrderFinance.validateChangeDeletion")(function* (call, activity) {
    const table = call.commandName === "orderPaymentFinanceChangesDelete" ? "order_change"
      : call.commandName === "orderPaymentFinanceActionsDelete" ? "order_change_action" : undefined;
    if (table === undefined || call.mode !== "write" || call.result !== null || activity.lifecycle.length ||
      activity.setNull.length || activity.referenceReplacements.length || activity.relationalReads.length)
      return yield* Effect.fail(mismatch("delete-activity"));
    const input = yield* Effect.fromResult(decodeOrderFinanceDelete(call.input));
    const requested = typeof input === "string" ? [input] : input;
    const state = yield* prepareOrderFinanceReceiptState(prepared, activity, [table], [table]);
    const ids: string[] = [];
    for (const mutation of activity.mutations) {
      if (mutation.table !== table || mutation.operation !== "delete" || mutation.before === null || mutation.after !== null)
        return yield* Effect.fail(mismatch("delete-mutation"));
      const before = yield* Effect.fromResult(state.decodeRow(table, mutation.before));
      const selected = state.rows().get(table)?.find(row => row.id === before.id);
      if (!requested.includes(before.id) || ids.includes(before.id) || selected === undefined ||
        !jsonEqual(projectNativeRow(mutation.before), selected)) return yield* Effect.fail(mismatch("delete-preimage"));
      state.remove(table, before.id); ids.push(before.id);
    }
    const capture = orderFinanceEventCapture(prepared), emitted: string[] = [];
    for (const message of call.events) {
      const event = yield* capture(message);
      if (event.metadata.object !== table || event.metadata.action !== "deleted")
        return yield* Effect.fail(mismatch("delete-event"));
      emitted.push(...Array.isArray(event.data.id) ? event.data.id : [event.data.id]);
    }
    if (!jsonEqual(emitted, ids)) return yield* Effect.fail(mismatch("delete-events"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
