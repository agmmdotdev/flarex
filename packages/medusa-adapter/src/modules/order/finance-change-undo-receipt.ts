import { Effect, Result } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlateLifecycleGraphReceipt } from "../../repository/lifecycle-graph-receipt";
import { projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { decodeOrderFinanceUndo } from "./finance-input";
import { orderFinanceEventCapture } from "./finance-events";
import { prepareOrderFinanceReceiptState, sameOrderFinanceFamilyTranscript } from "./finance-receipt-state";
import type { prepareOrderFinanceRepository } from "./finance-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderFinanceRepository>>;
const mismatch = (phase: string) => commerceError("receiptMismatch", { phase });
const versioned = ["order_summary", "order_item", "order_shipping", "order_credit_line"];

/** Native undo restores the prior version pointer and soft-deletes only the
 * current version's rows. Reuse the shared managed-transition validator; never
 * turn this inverse into physical deletion or regenerate the prior version. */
export const validateOrderFinanceChangeUndo = (prepared: Prepared): LogicalCallReceiptValidation =>
  Effect.fn("OrderFinance.validateChangeUndo")(function* (call, activity) {
    if (call.commandName !== "orderPaymentFinanceChangesUndo" || call.mode !== "write" || call.result !== null ||
      activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch("undo-activity"));
    const tables = ["order", "order_change", "order_change_action", ...versioned];
    if (activity.lifecycle.some(transition => !versioned.includes(transition.table))) return yield* Effect.fail(mismatch("undo-lifecycle-family"));
    const state = yield* prepareOrderFinanceReceiptState(prepared, activity, tables, tables);
    const input = yield* Effect.fromResult(decodeOrderFinanceUndo(call.input));
    const selected = yield* state.select("order", { id: input.order_id }, { select: ["id", "version"] });
    const order = selected.roots[0];
    if (selected.roots.length !== 1 || order === undefined || typeof order.version !== "number" || order.version < 2)
      return yield* Effect.fail(mismatch("undo-order-version"));
    const consumed = new Set<number>(), expectedEvents: Array<{ object: string; action: string; id: string }> = [];
    const patch = Effect.fn("OrderFinance.undoPatch")(function* (table: string, before: JsonObject, fields: JsonObject) {
      const mutation = activity.mutations.find(row => row.table === table && !consumed.has(row.ordinal));
      if (mutation === undefined || mutation.operation !== "patch" || mutation.before === null || mutation.after === null ||
        !jsonEqual(projectNativeRow(mutation.before), before)) return yield* Effect.fail(mismatch("undo-patch-preimage"));
      const after = yield* Effect.fromResult(state.decodeRow(table, mutation.after));
      const updatedAt = after.updated_at;
      if (typeof updatedAt !== "string" || !jsonEqual(after, { ...before, ...fields, updated_at: updatedAt }))
        return yield* Effect.fail(mismatch("undo-patch-fields"));
      state.put(table, after); consumed.add(mutation.ordinal);
      expectedEvents.push({ object: table, action: "updated", id: after.id });
    });
    const selector = { order_id: order.id, version: order.version }, projection = { select: ["id", "version"] };
    const changes = yield* state.select("order_change", selector, projection);
    const targets = yield* state.select("order_change", { $or: changes.roots.map(row => ({ id: row.id })) });
    for (const before of targets.roots) yield* patch("order_change", before,
      { status: input.previous?.status ?? "pending", confirmed_at: null });
    const actions = yield* state.select("order_change_action", selector, projection);
    const actionTargets = yield* state.select("order_change_action", { $or: actions.roots.map(row => ({ id: row.id })) });
    for (const before of actionTargets.roots) yield* patch("order_change_action", before, { applied: false });
    for (const table of versioned) {
      const selected = yield* state.select(table, selector, projection);
      const contract = yield* Effect.fromResult(prepared.contracts.entity(table));
      // These version wrappers have no native lifecycle descendants. A future
      // DML cascade needs its own complete membership/read proof before admission.
      if (contract.table.relationships.some(relation => relation.cascadeDelete)) return yield* Effect.fail(mismatch("undo-cascade"));
      const ids = selected.roots.map(row => row.id);
      if (ids.length) state.reads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "in", column: "id", values: ids }), total: ids.length, returned: ids.length });
      const mutations = activity.mutations.filter(mutation => mutation.table === table);
      const ordinals = new Map(mutations.map((mutation, index) => [mutation.ordinal, index]));
      const lifecycle = [];
      for (const transition of activity.lifecycle.filter(transition => transition.table === table)) {
        const ordinal = transition.attemptOrdinal === null ? undefined : ordinals.get(transition.attemptOrdinal);
        if (ordinal === undefined) return yield* Effect.fail(mismatch("undo-lifecycle-attempt"));
        lifecycle.push({ ...transition, attemptOrdinal: ordinal });
      }
      const evidence = new Map([[table, new Map(selected.roots.map(row => [row.id, row]))]]);
      // The native undo ignores the DAL's lifecycle tuple. This expected map
      // represents the already selected identities for the shared transition
      // validator; it is never substituted for a native/public call result.
      const correlated = yield* Effect.fromResult(correlateLifecycleGraphReceipt({
        entities: [{ table: contract.table, maximum: 4, linkableKey: contract.model, decodeRow: contract.complete }],
        rootTable: table, operation: "softDelete", evidence,
        selectedRootIds: new Set(ids), selected: new Map([[table, new Set(ids)]]),
        result: ids.length ? { [contract.model]: ids } : {},
        activity: { ...activity, mutations: mutations.map((mutation, ordinal) => ({ ...mutation, ordinal })), lifecycle },
      }));
      for (const mutation of mutations) {
        if (mutation.after === null || consumed.has(mutation.ordinal)) return yield* Effect.fail(mismatch("undo-lifecycle-mutation"));
        state.put(table, yield* Effect.fromResult(state.decodeRow(table, mutation.after))); consumed.add(mutation.ordinal);
      }
      for (const event of correlated.events) expectedEvents.push({ ...event, action: "deleted" });
    }
    const orders = yield* state.select("order", { id: order.id });
    if (orders.roots.length !== 1) return yield* Effect.fail(mismatch("undo-pointer-target"));
    yield* patch("order", orders.roots[0]!, { version: order.version - 1 });
    if (consumed.size !== activity.mutations.length || !sameOrderFinanceFamilyTranscript(activity.relationalReads, state.reads, "table"))
      return yield* Effect.fail(mismatch("undo-complete-transcript"));
    const capture = orderFinanceEventCapture(prepared), emitted = [];
    for (const message of call.events) {
      const event = yield* capture(message);
      for (const id of Array.isArray(event.data.id) ? event.data.id : [event.data.id]) emitted.push({ object: event.metadata.object, action: event.metadata.action, id });
    }
    if (!sameOrderFinanceFamilyTranscript(emitted, expectedEvents, "object")) return yield* Effect.fail(mismatch("undo-events"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
