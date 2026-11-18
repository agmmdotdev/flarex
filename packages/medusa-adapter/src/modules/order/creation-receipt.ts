import { Effect, Result } from "effect";
import { Order } from "@medusajs/order/models";
import { calculateOrderChange, formatOrder } from "@medusajs/order/utils";
import { createRawPropertiesFromBigNumber, decorateCartTotals } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlatePhysicalGraphReceipt } from "../../repository/physical-graph-receipt";
import { projectNativeRow } from "../../repository/result";
import { captureNativeRecord } from "../../value/native-record";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { decodeCheckoutOrderCreates, decodeCheckoutOrderDeletes } from "./creation-input";
import { captureOrderCreationFields } from "./creation-values";
import { orderFinanceEventCapture } from "./finance-events";
import { prepareOrderFinanceReceiptState } from "./finance-receipt-state";
import { captureOrderFinanceTotals } from "./finance-summary";
import type { prepareOrderCheckoutRepository } from "./finance-repository";
import type { ColumnDefault } from "../../schema/model";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderCheckoutRepository>>;
const mismatch = (phase: string, cause?: unknown) => commerceError("receiptMismatch", { phase, cause });
const creationTables = ["order_address", "order", "order_summary", "order_line_item", "order_item"];
const lineTables = ["order_line_item", "order_line_item_tax_line", "order_line_item_adjustment"];
const resultRelations = ["shipping_address", "billing_address", "summary", "items", "credit_lines", "items.tax_lines", "items.adjustments",
  "shipping_methods", "shipping_methods.tax_lines", "shipping_methods.adjustments", "transactions"];
function literalDefault(value: ColumnDefault | undefined) {
  switch (value?.kind) {
    case "exactNumericLiteral": case "booleanLiteral": case "textLiteral": case "integerLiteral": case "doublePrecisionLiteral": return value.value;
    case "exactNumericRawLiteral": return { value: value.value, precision: value.precision };
    case "emptyJsonArray": return [];
    case "emptyJsonObject": return {};
    default: return undefined;
  }
}

/** Native Order retains arithmetic and formatting; this ledger binds their
 * results to the existing storage owner's complete call-local observations.
 * It performs no writes, reads, identity allocation or second invocation. */
export const validateCheckoutOrderCreation = (prepared: Prepared): LogicalCallReceiptValidation =>
  Effect.fn("OrderCreation.validateCall")(function* (call, activity) {
    if (call.mode !== "write" || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch("activity"));
    const capture = orderFinanceEventCapture(prepared), expectedEvents: Array<{ object: string; action: string; id: string }> = [];
    if (call.commandName === "orderCreateForCheckout") {
      const input = yield* Effect.fromResult(decodeCheckoutOrderCreates(call.input));
      const state = yield* prepareOrderFinanceReceiptState(prepared, activity, creationTables, creationTables);
      let ordinal = 0;
      const insert = Effect.fn("OrderCreation.correlateInsert")(function* (table: string, input: unknown) {
        const mutation = activity.mutations[ordinal++];
        if (mutation?.table !== table || mutation.operation !== "insert" || mutation.before !== null || mutation.after === null)
          return yield* Effect.fail(mismatch("insert:" + table));
        const row = yield* Effect.fromResult(state.decodeRow(table, mutation.after)), entity = yield* Effect.fromResult(prepared.contracts.entity(table));
        const supplied = yield* captureNativeRecord(input);
        const fields = yield* prepared.contracts.normalize(supplied, table);
        if (state.has(table, row.id) || row.deleted_at !== (fields.deleted_at ?? null) ||
          ["created_at", "updated_at"].some(name => fields[name] !== undefined && (row[name] === undefined || !jsonEqual(row[name], fields[name]))) ||
          fields.created_at === undefined && fields.updated_at === undefined && row.created_at !== row.updated_at)
          return yield* Effect.fail(mismatch("insert-identity"));
        for (const column of entity.table.columns) {
          if (["id", "created_at", "updated_at", "deleted_at"].includes(column.name) || column.type === "serial") continue;
          // Omitted defaults belong to the actual relational lowering/storage
          // owner. Supplied native quantities use the existing exact encoder.
          const expected = fields[column.name] === undefined
            ? literalDefault(prepared.defaults.get(table)?.get(column.name)) ?? (column.nullable ? null : undefined) : fields[column.name];
          const actual = row[column.name];
          if (expected === undefined || actual === undefined || !jsonEqual(actual, expected))
            return yield* Effect.fail(mismatch("insert-field:" + table + "." + column.name));
        }
        state.put(table, row); expectedEvents.push({ object: table, action: "created", id: row.id });
        return row;
      });
      const addressKeys = new Map<typeof input[number], Record<string, string>>();
      // Native Order creates all billing/shipping copies before any Order.
      for (const requested of input) {
        const keys: Record<string, string> = {};
        for (const name of ["billing_address", "shipping_address"] as const) if (requested[name]) {
          const address = yield* insert("order_address", requested[name]); keys[name + "_id"] = address.id;
        }
        addressKeys.set(requested, keys);
      }
      const ids: string[] = [], items: Array<{ readonly order: string; readonly input: typeof input[number]["items"] }> = [];
      for (const requested of input) {
        const { items: lineItems, shipping_address: _shipping, billing_address: _billing, shipping_methods: _methods,
          credit_lines: _credits, promo_codes: _promos, ...scalars } = requested;
        // The native method uses these genuine pure owners on the same finite
        // input. Its public VirtualOrder annotation requires fields not needed
        // by the native creation branch; Reflect preserves that actual boundary.
        const calculated: unknown = yield* Effect.try({ try: () => {
          const decorated: unknown = Reflect.apply(decorateCartTotals, undefined, [structuredClone(requested)]);
          const result: unknown = Reflect.apply(calculateOrderChange, undefined, [{ order: decorated, actions: [], transactions: [] }]);
          createRawPropertiesFromBigNumber(result); return result;
        }, catch: cause => mismatch("native-totals", cause) });
        const totals = yield* captureOrderFinanceTotals((yield* captureNativeRecord(calculated)).summary);
        const root = yield* insert("order", { ...scalars, ...addressKeys.get(requested) }); ids.push(root.id);
        yield* insert("order_summary", { order_id: root.id, totals });
        items.push({ order: root.id, input: lineItems });
      }
      const wrappers: Array<{ order_id: string; item_id: string; quantity: unknown }> = [];
      for (const group of items) for (const requested of group.input ?? []) {
        const fields = yield* captureOrderCreationFields(requested, "order_line_item");
        const row = yield* insert("order_line_item", fields);
        wrappers.push({ order_id: group.order, item_id: row.id, quantity: requested.quantity });
      }
      for (const wrapper of wrappers) yield* insert("order_item", { ...wrapper, version: 1 });
      if (ordinal !== activity.mutations.length) return yield* Effect.fail(mismatch("creation-mutation-count"));
      for (const observation of activity.observedRows) if (!activity.mutations.some(mutation =>
        mutation.table === observation.table && mutation.after !== null && jsonEqual(projectNativeRow(mutation.after), projectNativeRow(observation.row)))) {
        // The trusted serial owner observes the complete existing Order cohort
        // for display_id allocation, including soft-deleted support rows. These
        // complete unchanged preimages are not additional native DAL reads.
        // Its existing range/dependency/settlement proof owns allocation; this
        // receipt must not implement another max-plus-one calculation.
        if (observation.table !== "order" || typeof observation.row.id !== "string" || !state.has("order", observation.row.id) ||
          activity.mutations.some(mutation => mutation.table === "order" && mutation.after?.id === observation.row.id))
          return yield* Effect.fail(mismatch("creation-observation:" + observation.table));
      }
      const selected = yield* state.select("order", { id: ids }, { relations: resultRelations });
      const presented = yield* prepared.contracts.present(selected.rows, "order");
      const native = yield* Effect.try({ try: () => formatOrder(presented, { entity: Order, includeTotals: false }),
        catch: cause => mismatch("native-result", cause) });
      const output = yield* Effect.fromResult(captureNativeNumericDto(native));
      if (!jsonEqual(call.result, output) || !jsonEqual(activity.relationalReads, state.reads))
        return yield* Effect.fail(mismatch("creation-result"));
    } else if (call.commandName === "orderDeleteForCheckout") {
      if (call.result !== null) return yield* Effect.fail(mismatch("delete-result"));
      const ids = yield* Effect.fromResult(decodeCheckoutOrderDeletes(call.input));
      const tables = prepared.contracts.entities.map(entity => entity.table.name);
      const state = yield* prepareOrderFinanceReceiptState(prepared, activity, tables, tables);
      const orders = yield* state.select("order", { id: ids }, { select: ["id", "shipping_address_id", "billing_address_id"] });
      const changes = yield* state.select("order_change", { order_id: ids }, { select: ["id"] });
      const items = yield* state.select("order_item", { order_id: ids }, { select: ["id", "item_id"] });
      const shipping = yield* state.select("order_shipping", { order_id: ids }, { select: ["shipping_method_id"] });
      const preimage = state.rows();
      // Native cleanup gathers standalone IDs from active wrappers; physical
      // cascades also reach historical wrappers. Authenticate the complete
      // preimage so that hidden relations cannot leave standalone rows behind.
      const ownedRows = (table: string) => (preimage.get(table) ?? []).filter(row => typeof row.order_id === "string" && ids.includes(row.order_id));
      const addressIds: string[] = [];
      for (const order of orders.roots) for (const key of ["shipping_address_id", "billing_address_id"]) {
        const id = order[key];
        if (id !== null && typeof id !== "string") return yield* Effect.fail(mismatch("delete-address-identity"));
        if (typeof id === "string") addressIds.push(id);
      }
      if (changes.roots.length || shipping.roots.length ||
        ownedRows("order_change").length || ownedRows("order_shipping").length ||
        !jsonEqual(activity.relationalReads.slice(0, state.reads.length), state.reads)) return yield* Effect.fail(mismatch("delete-preimage"));
      const remainingReads = activity.relationalReads.slice(state.reads.length), entities = prepared.contracts.entities.map(entity => ({
        table: entity.table, maximum: 4, decodeRow: entity.complete,
      }));
      // Native deletion awaits Addresses, then the complete Order cascade,
      // then standalone Line Items. Preserve every causal barrier.
      const phase = (table: string) => table === "order_address" ? 0 : lineTables.includes(table) ? 2 : 1;
      let mutationPhase = 0, readPhase = 0;
      for (const mutation of activity.mutations) {
        const next = phase(mutation.table);
        if (next < mutationPhase) return yield* Effect.fail(mismatch("delete-mutation-order"));
        mutationPhase = next;
      }
      for (const read of remainingReads) {
        if (typeof read.table !== "string") return yield* Effect.fail(mismatch("delete-read-table"));
        const next = phase(read.table);
        if (next < readPhase) return yield* Effect.fail(mismatch("delete-read-order"));
        readPhase = next;
      }
      const graph = (root: string, requestedIds: readonly string[], selectedPhase: number) => Result.gen(function* () {
        const entity = yield* prepared.contracts.entity(root);
        return yield* correlatePhysicalGraphReceipt({ root: entity.table, tables: prepared.tables, entities,
          requestedIds, activity: { ...activity,
            observedRows: activity.observedRows.filter(row => phase(row.table) === selectedPhase),
            relationalReads: remainingReads.filter(row => typeof row.table === "string" && phase(row.table) === selectedPhase),
            mutations: activity.mutations.filter(row => phase(row.table) === selectedPhase).map((row, ordinal) => ({ ...row, ordinal })),
          } });
      });
      const deletedAddresses = yield* Effect.fromResult(graph("order_address", addressIds, 0));
      const roots = yield* Effect.fromResult(graph("order", ids, 1));
      const itemIds: string[] = [];
      for (const row of items.roots) {
        if (typeof row.item_id !== "string") return yield* Effect.fail(mismatch("delete-item"));
        itemIds.push(row.item_id);
      }
      if (ownedRows("order_item").some(row => typeof row.item_id !== "string" || !itemIds.includes(row.item_id)))
        return yield* Effect.fail(mismatch("delete-hidden-item"));
      const deletedItems = yield* Effect.fromResult(graph("order_line_item", itemIds, 2));
      expectedEvents.push(...deletedAddresses.map(id => ({ object: "order_address", action: "deleted", id })),
        ...roots.map(id => ({ object: "order", action: "deleted", id })),
        ...deletedItems.map(id => ({ object: "order_line_item", action: "deleted", id })));
    } else return yield* Effect.fail(mismatch("command"));
    const emitted: typeof expectedEvents = [];
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        emitted.push({ object: message.metadata.object, action: message.metadata.action, id });
    }
    if (!jsonEqual(emitted, expectedEvents)) return yield* Effect.fail(mismatch("events"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : mismatch("boundary", cause)));
