import { Effect, Result } from "effect";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { encodeNativeExactNumeric } from "../../value/exact-numeric";
import { decodeOrderFinanceChange, decodeOrderFinanceActions } from "./finance-input";
import { orderFinanceEventCapture } from "./finance-events";
import { prepareOrderFinanceReceiptState } from "./finance-receipt-state";
import type { prepareOrderFinanceRepository } from "./finance-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderFinanceRepository>>;
const mismatch = (phase: string) => commerceError("receiptMismatch", { phase });
const changeSelection = { select: ["id", "order_id", "return_id", "claim_id", "exchange_id", "version", "status"], relations: [], order: {} };

/** Authenticate the successful native Change/Action creation branches. DML
 * owns defaults; the shared logical owner owns generated serial allocation.
 * Neither native confirmation nor its inverse is admitted by this policy. */
export const validateOrderFinanceChangeCreation = (prepared: Prepared): LogicalCallReceiptValidation =>
  Effect.fn("OrderFinance.validateChangeCreation")(function* (call, activity) {
    const change = call.commandName === "orderPaymentFinanceChangeCreate";
    if (!change && call.commandName !== "orderPaymentFinanceActionsCreate" || call.mode !== "write" ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch("creation-activity"));
    const state = yield* prepareOrderFinanceReceiptState(prepared, activity,
      ["order", "order_change", "order_change_action"], [change ? "order_change" : "order_change_action"]);
    const fields: JsonObject[] = [];
    if (change) {
      const input = yield* Effect.fromResult(decodeOrderFinanceChange(call.input));
      const existing = yield* state.select("order_change", { order_id: [input.order_id], status: ["pending", "requested"] });
      if (existing.roots.length) return yield* Effect.fail(mismatch("active-change"));
      const parents = yield* state.select("order", { id: [input.order_id] }, { select: ["id", "version"] });
      const parent = parents.roots[0];
      if (parents.roots.length !== 1 || parent?.id !== input.order_id || typeof parent.version !== "number")
        return yield* Effect.fail(mismatch("change-parent"));
      fields.push({ ...input, version: parent.version + 1 });
    } else {
      const input = yield* Effect.fromResult(decodeOrderFinanceActions(call.input));
      const ids = [...new Set(input.map(row => row.order_change_id))];
      const changes = yield* state.select("order_change", { id: ids }, changeSelection);
      if (changes.roots.length !== ids.length || changes.roots.some(row => row.status !== "pending" && row.status !== "requested"))
        return yield* Effect.fail(mismatch("action-change"));
      for (const requested of input) {
        const parent = changes.roots.find(row => row.id === requested.order_change_id);
        if (parent === undefined || typeof parent.order_id !== "string" || typeof parent.version !== "number")
          return yield* Effect.fail(mismatch("action-parent"));
        const numeric = yield* encodeNativeExactNumeric(requested.amount);
        fields.push({ ...requested, order_id: parent.order_id, version: parent.version, amount: numeric.value, raw_amount: numeric.raw });
      }
    }
    const table = change ? "order_change" : "order_change_action";
    const contract = yield* Effect.fromResult(prepared.contracts.entity(table));
    const created: JsonObject[] = [], ids: string[] = [];
    if (fields.length !== activity.mutations.length) return yield* Effect.fail(mismatch("creation-count"));
    for (const [ordinal, requested] of fields.entries()) {
      const mutation = activity.mutations[ordinal];
      if (mutation?.table !== table || mutation.operation !== "insert" || mutation.before !== null || mutation.after === null)
        return yield* Effect.fail(mismatch("creation-insert"));
      const after = yield* Effect.fromResult(state.decodeRow(table, mutation.after));
      if (state.has(table, after.id) || after.deleted_at !== null || after.created_at !== after.updated_at)
        return yield* Effect.fail(mismatch("creation-identity"));
      for (const column of contract.table.columns) {
        if (["id", "created_at", "updated_at", "deleted_at"].includes(column.name) || column.type === "serial") continue;
        const expected = requested[column.name] ?? column.defaultValue ?? (column.nullable ? null : undefined);
        const actual = after[column.name];
        if (expected === undefined || actual === undefined || !jsonEqual(actual, expected))
          return yield* Effect.fail(mismatch("creation-field:" + column.name));
      }
      state.put(table, after); created.push({ ...after }); ids.push(after.id);
    }
    fillEmptyToManyRelations(created, contract.creationRelations);
    const output = yield* prepared.contracts.present(change ? created[0]! : created, table);
    if (!jsonEqual(call.result, output) || !jsonEqual(activity.relationalReads, state.reads))
      return yield* Effect.fail(mismatch("creation-result"));
    const capture = orderFinanceEventCapture(prepared), emitted: string[] = [];
    for (const message of call.events) {
      const event = yield* capture(message);
      if (event.metadata.object !== table || event.metadata.action !== "created")
        return yield* Effect.fail(mismatch("creation-event"));
      emitted.push(...Array.isArray(event.data.id) ? event.data.id : [event.data.id]);
    }
    if (!jsonEqual(emitted, ids)) return yield* Effect.fail(mismatch("creation-event-order"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
