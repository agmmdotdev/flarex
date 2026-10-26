import { Effect, Result } from "effect";
import { Order } from "@medusajs/order/models";
import { applyChangesToOrder, formatOrder } from "@medusajs/order/utils";
import { includeOrderTotals } from "@medusajs/order/utils/totals-selection";
import { includeOrderPreviewDetails } from "@medusajs/order/utils/preview-details";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { captureCommerceInput } from "../../value/input";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { decodeOrderFinanceConfirm } from "./finance-input";
import { orderFinanceEventCapture } from "./finance-events";
import { selectOrderFinanceReceiptRows, type OrderFinanceRows } from "./finance-read-receipt";
import { prepareOrderFinanceReceiptState, sameOrderFinanceFamilyTranscript } from "./finance-receipt-state";
import type { prepareOrderFinanceRepository } from "./finance-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderFinanceRepository>>;
type State = Effect.Success<ReturnType<typeof prepareOrderFinanceReceiptState>>;
const mismatch = (phase: string, cause?: unknown) => commerceError("receiptMismatch", { phase, cause });
const changeFields = ["id", "order_id", "return_id", "claim_id", "exchange_id", "version", "status", "actions"];
const changeSelection = { select: changeFields, relations: ["actions"], order: { actions: { ordering: "ASC" } } };

/** Pre-present checked scalar families once at the Effect boundary. Native
 * preview callbacks then use the same pure selection/projection owner over
 * those values. The callbacks record only the native call's requested reads;
 * they acquire no storage capability and start no nested Effect runtime. */
const presentReceiptState = Effect.fn("OrderFinance.presentReceiptState")(function* (prepared: Prepared, state: State) {
  const presented = new Map<string, Array<JsonObject & { readonly id: string }>>();
  for (const [table, rows] of state.rows()) {
    const values = yield* prepared.contracts.present([...rows], table), group: Array<JsonObject & { readonly id: string }> = [];
    if (!Array.isArray(values)) return yield* Effect.fail(mismatch("presentation-array"));
    for (const value of values) {
      if (!isJsonObject(value) || typeof value.id !== "string") return yield* Effect.fail(mismatch("presentation-identity"));
      group.push({ ...value, id: value.id });
    }
    presented.set(table, group);
  }
  return presented satisfies OrderFinanceRows;
});

/** Authenticate the selected CREDIT_LINE_ADD native confirmation transcript.
 * Native Order owns arithmetic, version creation and preview enrichment; this
 * receipt binds their results to authenticated reads, mutations and events.
 * It supplies no identity/default/clock and performs no persistence operation. */
export const validateOrderFinanceChangeApplication = (prepared: Prepared): LogicalCallReceiptValidation =>
  Effect.fn("OrderFinance.validateChangeApplication")(function* (call, activity) {
    if (call.commandName !== "orderPaymentFinanceChangesConfirm" || call.mode !== "write" || activity.lifecycle.length ||
      activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch("confirmation-activity"));
    const tables = prepared.contracts.entities.map(entity => entity.table.name);
    const writable = ["order_change", "order", "order_change_action", "order_item", "order_summary", "order_shipping", "order_credit_line", "order_line_item_adjustment"];
    const state = yield* prepareOrderFinanceReceiptState(prepared, activity, tables, writable);
    const input = yield* Effect.fromResult(decodeOrderFinanceConfirm(call.input));
    const changes = yield* state.select("order_change", { id: input.map(row => row.id) }, changeSelection);
    if (changes.roots.length !== input.length || changes.roots.some(row => row.status !== "pending" && row.status !== "requested"))
      return yield* Effect.fail(mismatch("active-change"));
    const actions: JsonObject[] = [];
    for (const change of changes.rows) {
      if (!Array.isArray(change.actions)) return yield* Effect.fail(mismatch("change-actions"));
      for (const action of change.actions) {
        if (!isJsonObject(action) || action.action !== "CREDIT_LINE_ADD" || typeof action.applied !== "boolean" ||
          typeof action.id !== "string" || typeof action.order_id !== "string") return yield* Effect.fail(mismatch("credit-action"));
        if (!action.applied) actions.push(action);
      }
    }
    if (new Set(actions.map(action => action.order_id)).size > 1) return yield* Effect.fail(mismatch("single-order"));
    const expectedEvents: Array<{ object: string; action: string; id: string }> = [];
    const consumed = new Set<number>();
    let confirmationBarrier = -1;
    const nextMutation = (table: string) => {
      const mutation = activity.mutations.find(row => row.table === table && !consumed.has(row.ordinal));
      if (mutation === undefined || mutation.ordinal <= confirmationBarrier) return undefined;
      consumed.add(mutation.ordinal); return mutation;
    };
    const patch = Effect.fn("OrderFinance.confirmationPatch")(function* (table: string, before: JsonObject, fields: JsonObject) {
      const mutation = nextMutation(table);
      if (mutation?.table !== table || mutation.operation !== "patch" || mutation.before === null || mutation.after === null ||
        !jsonEqual(projectNativeRow(mutation.before), before)) return yield* Effect.fail(mismatch("patch-preimage:" + table));
      const after = yield* Effect.fromResult(state.decodeRow(table, mutation.after));
      const updatedAt = after.updated_at;
      if (typeof updatedAt !== "string" || !jsonEqual(after, { ...before, ...fields, updated_at: updatedAt }))
        return yield* Effect.fail(mismatch("patch-fields:" + table));
      state.put(table, after); expectedEvents.push({ object: table, action: "updated", id: after.id });
      return after;
    });
    const selectedChanges = yield* state.select("order_change", { $or: input.map(row => ({ id: row.id })) });
    for (const before of selectedChanges.roots) {
      const submitted = input.find(row => row.id === before.id), mutation = activity.mutations.find(row => row.table === "order_change" && !consumed.has(row.ordinal));
      const instant = mutation?.after?.confirmed_at;
      if (submitted === undefined || typeof instant !== "string" || !Number.isFinite(Date.parse(instant)) ||
        new Date(instant).toISOString() !== instant) return yield* Effect.fail(mismatch("confirmed-time"));
      yield* patch("order_change", before, { ...submitted, confirmed_at: instant, status: "confirmed" });
    }
    // Every confirmed Change precedes all resulting version mutations.
    confirmationBarrier = Math.max(-1, ...consumed);
    const bundles: Record<"items" | "shipping_methods" | "credit_lines", JsonObject[]> = { items: [], shipping_methods: [], credit_lines: [] };
    if (actions.length) {
      const config = { select: ["id", "version", "items.detail", "shipping_methods.detail", "summary", "total"],
        relations: ["transactions", "credit_lines", "shipping_methods"] };
      const includeTotals = includeOrderTotals(config);
      const orders = yield* state.select("order", { id: [...new Set(actions.map(action => action.order_id!))] }, config);
      const presented = yield* prepared.contracts.present(orders.rows, "order");
      const nativeOrders: unknown = yield* Effect.try({ try: () => formatOrder(presented, { entity: Order, includeTotals }),
        catch: cause => mismatch("native-format", cause) });
      if (!Array.isArray(nativeOrders)) return yield* Effect.fail(mismatch("native-orders"));
      const nativeActions = yield* prepared.contracts.present(actions, "order_change_action");
      if (!Array.isArray(nativeActions)) return yield* Effect.fail(mismatch("native-actions"));
      const byOrder: Record<string, JsonObject[]> = {};
      for (const action of nativeActions) {
        if (!isJsonObject(action) || typeof action.order_id !== "string") return yield* Effect.fail(mismatch("native-action-identity"));
        (byOrder[action.order_id] ??= []).push(action);
      }
      const nativeState = yield* presentReceiptState(prepared, state);
      const preview = (table: string, filters: unknown, previewConfig: unknown) => Result.getOrThrow(Result.gen(function* () {
        const where = yield* captureCommerceInput(filters), options = yield* captureCommerceInput(previewConfig);
        if (!isJsonObject(where) || !isJsonObject(options)) return yield* Result.fail(mismatch("preview-options"));
        yield* state.selectResult(table, where, options);
        const selected = yield* selectOrderFinanceReceiptRows(prepared, nativeState, table, where, options);
        const rows: Array<JsonObject & { readonly id: string }> = [];
        for (const row of selected.rows) {
          if (typeof row.id !== "string") return yield* Result.fail(mismatch("preview-identity"));
          rows.push({ ...row, id: row.id });
        }
        return rows;
      }));
      const computed = yield* Effect.tryPromise({ try: () => applyChangesToOrder(nativeOrders, byOrder, {
        addActionReferenceToObject: true,
        includeTaxLinesAndAdjustmentsToPreview: (order, items, shipping, adjustments) => includeOrderPreviewDetails({
          listOrderLineItems: (filters, options) => preview("order_line_item", filters, options),
          listOrderShippingMethods: (filters, options) => preview("order_shipping_method", filters, options),
        }, order, items, shipping, adjustments),
      }), catch: cause => mismatch("native-application", cause) });
      const orderPatches: Array<{ id: string; fields: JsonObject }> = [];
      for (const value of computed.orderToUpdate) {
        const pair = yield* Effect.fromResult(captureCommerceInput(value));
        if (!isJsonObject(pair)) return yield* Effect.fail(mismatch("order-patch"));
        const selector = pair.selector, data = pair.data;
        if (selector === undefined || !isJsonObject(selector) || typeof selector.id !== "string" || data === undefined || !isJsonObject(data))
          return yield* Effect.fail(mismatch("order-patch"));
        orderPatches.push({ id: selector.id, fields: data });
      }
      if (orderPatches.length) {
        for (const expected of orderPatches) {
          const selected = yield* state.select("order", { id: expected.id });
          for (const before of selected.roots) yield* patch("order", before, expected.fields);
        }
      }
      for (const action of actions) {
        const selectedActions = yield* state.select("order_change_action", { id: action.id! });
        for (const before of selectedActions.roots) yield* patch("order_change_action", before, { applied: true });
      }
      for (const [table, values, resultName] of [
        ["order_item", computed.itemsToUpsert, "items"], ["order_summary", computed.summariesToUpsert, undefined],
        ["order_shipping", computed.shippingMethodsToUpsert, "shipping_methods"], ["order_credit_line", computed.creditLinesToUpsert, "credit_lines"],
      ] as const) {
        const contract = yield* Effect.fromResult(prepared.contracts.entity(table));
        for (const value of values) {
          const fields = yield* prepared.contracts.normalize(value, table, undefined, true);
          const existing = typeof fields.id === "string" ? yield* state.select(table, { id: [fields.id] }) : undefined;
          const before = existing?.roots[0], mutation = nextMutation(table);
          if (mutation?.table !== table || mutation.after === null || mutation.operation !== (before === undefined ? "insert" : "patch") ||
            (before === undefined ? mutation.before !== null : mutation.before === null || !jsonEqual(projectNativeRow(mutation.before), before)))
            return yield* Effect.fail(mismatch("upsert-preimage:" + table));
          const after = yield* Effect.fromResult(state.decodeRow(table, mutation.after));
          if (fields.id !== undefined ? after.id !== fields.id : state.has(table, after.id)) return yield* Effect.fail(mismatch("upsert-identity"));
          for (const column of contract.table.columns) {
            if (column.name === "id") continue;
            const expected = Object.hasOwn(fields, column.name) ? fields[column.name] : before?.[column.name] ?? column.defaultValue ??
              (column.name === "created_at" || column.name === "updated_at" ? after[column.name] : column.nullable ? null : undefined);
            if (column.name === "updated_at" && !Object.hasOwn(fields, column.name)) continue;
            const actual = after[column.name];
            if (expected === undefined || actual === undefined || !jsonEqual(actual, expected))
              return yield* Effect.fail(mismatch("upsert-field:" + table + "." + column.name));
          }
          state.put(table, after); expectedEvents.push({ object: table, action: before === undefined ? "created" : "updated", id: after.id });
          if (resultName !== undefined) bundles[resultName].push(after);
        }
      }
      const adjustmentContract = yield* Effect.fromResult(prepared.contracts.entity("order_line_item_adjustment"));
      for (const value of computed.lineItemAdjustmentsToCreate) {
        const fields = yield* prepared.contracts.normalize(value, "order_line_item_adjustment");
        const mutation = nextMutation("order_line_item_adjustment");
        if (mutation?.table !== "order_line_item_adjustment" || mutation.operation !== "insert" || mutation.before !== null || mutation.after === null)
          return yield* Effect.fail(mismatch("adjustment-insert"));
        const after = yield* Effect.fromResult(state.decodeRow("order_line_item_adjustment", mutation.after));
        if (state.has("order_line_item_adjustment", after.id) || after.deleted_at !== null || after.created_at !== after.updated_at)
          return yield* Effect.fail(mismatch("adjustment-identity"));
        for (const column of adjustmentContract.table.columns) {
          if (["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) continue;
          const expected = fields[column.name] ?? column.defaultValue ?? (column.nullable ? null : undefined);
          const actual = after[column.name];
          if (expected === undefined || actual === undefined || !jsonEqual(actual, expected))
            return yield* Effect.fail(mismatch("adjustment-field:" + column.name));
        }
        state.put("order_line_item_adjustment", after);
        expectedEvents.push({ object: "order_line_item_adjustment", action: "created", id: after.id });
      }
    }
    const result = { items: yield* prepared.contracts.present(bundles.items, "order_item"),
      shipping_methods: yield* prepared.contracts.present(bundles.shipping_methods, "order_shipping"),
      credit_lines: yield* prepared.contracts.present(bundles.credit_lines, "order_credit_line") };
    const normalized = yield* Effect.fromResult(captureNativeNumericDto(result));
    if (consumed.size !== activity.mutations.length || !sameOrderFinanceFamilyTranscript(activity.relationalReads, state.reads, "table") || !jsonEqual(call.result, normalized))
      return yield* Effect.fail(mismatch("confirmation-result"));
    const capture = orderFinanceEventCapture(prepared), emitted = [];
    for (const message of call.events) {
      const event = yield* capture(message);
      for (const id of Array.isArray(event.data.id) ? event.data.id : [event.data.id]) emitted.push({ object: event.metadata.object, action: event.metadata.action, id });
    }
    if (!sameOrderFinanceFamilyTranscript(emitted, expectedEvents, "object")) return yield* Effect.fail(mismatch("confirmation-events"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
