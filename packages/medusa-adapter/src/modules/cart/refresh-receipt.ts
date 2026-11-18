import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { buildModelsNameToLinkableKeysMap } from "@medusajs/utils/modules-sdk/build-models-name-to-linkable-keys-map";
import { cartStaticResources } from "@medusajs/cart/static-manifest";
import { Modules, buildModuleResourceEventName, mapObjectTo } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { scalarLifecycleReceipt } from "../../repository/scalar-lifecycle-receipt";
import { correlateScalarCreateWrites } from "../../repository/scalar-create-receipt";
import { projectNativeRow } from "../../repository/result";
import { captureGraph } from "../../write/create";
import { commerceRelationReadQuery, type CommerceRelationRows } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { moduleEventDecoder } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { captureExactNumericRow } from "../../value/exact-numeric";
import { decodeCartItemAdjustments, decodeCartItemTaxRead, decodeCartShippingTaxRead,
  decodeCartSetItemTaxInput, decodeCartSetShippingTaxInput, decodeCartRefreshIds, decodeCartEmptyShippingAdjustments } from "./refresh-input";
import type { prepareCartCreationRefreshRepository } from "./refresh-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareCartCreationRefreshRepository>>;
const mismatch = (phase?: string) => commerceError("receiptMismatch", phase === undefined ? undefined : { phase });
const decodeReceiptIds = commerceDecoder(Schema.Array(Schema.String), "receiptMismatch");
const decodeLifecycleResult = commerceDecoder(Schema.Struct({ ids: Schema.Array(Schema.String) }), "receiptMismatch");
const event = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.CART),
    object: Schema.Literals(["line_item_tax_line", "shipping_method_tax_line", "line_item_adjustment"]),
    action: Schema.Literals(["created", "deleted", "restored"]) }),
  data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 4))]) }) }), defaultCommerceResources);
export const captureCartCreationRefreshEvent = Effect.fn("CartCreation.captureRefreshEvent")(function* (input: unknown) {
  const message = yield* event(input);
  if (message.name !== buildModuleResourceEventName({ prefix: Modules.CART, objectName: message.metadata.object, action: message.metadata.action }))
    return yield* Effect.fail(commerceError("unadmittedEvent"));
  return message;
});

/** The core's ordered selection identities authenticate each exact query.
 * DML graph creation and the shared scalar lifecycle owner correlate writes;
 * this receipt performs no SQL, transaction or independent Tax calculation. */
export function cartCreationRefreshPolicy(prepared: Prepared) {
  const { refresh } = prepared;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("CartCreation.validateRefreshCall")(function* (call, activity) {
    if (activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
    if (["cartAddEmptyShippingAdjustmentsForCreation", "cartSoftDeleteEmptyShippingAdjustmentsForCreation", "cartRestoreEmptyShippingAdjustmentsForCreation"].includes(call.commandName)) {
      yield* Effect.fromResult(decodeCartEmptyShippingAdjustments(call.input));
      if (call.mode !== "write" || call.events.length || activity.mutations.length || activity.lifecycle.length || activity.relationalReads.length || activity.observedRows.length ||
        !jsonEqual(call.result, call.commandName === "cartAddEmptyShippingAdjustmentsForCreation" ? [] : {})) return yield* Effect.fail(mismatch());
      return;
    }
    type Row = JsonObject & { readonly id: string };
    const state = new Map<string, Map<string, Row>>(), used = new Set<string>(), parentItems = new Set<string>();
    const put = (table: string, row: Row) => { const rows = state.get(table) ?? new Map<string, Row>(); rows.set(row.id, row); state.set(table, rows); };
    const complete = (table: string, input: unknown): Result.Result<Row, CommerceTransactionError> => Result.gen(function* () {
      const entity = prepared.byName.get(table);
      if (entity === undefined) return yield* Result.fail(mismatch());
      const row = yield* entity.complete(input);
      if (typeof row.id !== "string") return yield* Result.fail(mismatch());
      return { ...row, id: row.id };
    });
    for (const observed of activity.observedRows) {
      const row = yield* Effect.fromResult(complete(observed.table, projectNativeRow(observed.row))), prior = state.get(observed.table)?.get(row.id);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
      put(observed.table, row);
    }
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      if (mutation.ordinal !== ordinal || mutation.after === null || mutation.operation !== "insert" && mutation.operation !== "patch")
        return yield* Effect.fail(mismatch());
      yield* Effect.fromResult(complete(mutation.table, projectNativeRow(mutation.after)));
      used.add(mutation.table + ":" + mutation.after.id);
    }
    for (const mutation of [...activity.mutations].reverse()) {
      if (mutation.after === null || typeof mutation.after.id !== "string") return yield* Effect.fail(mismatch());
      if (mutation.before === null) state.get(mutation.table)?.delete(mutation.after.id);
      else put(mutation.table, yield* Effect.fromResult(complete(mutation.table, projectNativeRow(mutation.before))));
    }
    const reads = new Set(activity.relationalReads.map((_, index) => index));
    const readRows: CommerceRelationRows = Effect.fn("CartCreation.selectObservedRefreshRows")(function* (table, predicate, order = "id", options) {
      const query = commerceRelationReadQuery(defaultCommerceResources, predicate, order, { includeIdentities: true, ...options });
      const index = [...reads].find(index => {
        const current = activity.relationalReads[index];
        return current?.table === table && jsonEqual(current.query, query);
      }), observation = index === undefined ? undefined : activity.relationalReads[index];
      if (index === undefined || observation === undefined || observation.related !== undefined || observation.orderedIdentities === undefined ||
        observation.total !== observation.returned || observation.returned !== observation.orderedIdentities.length)
        return yield* Effect.fail(mismatch());
      reads.delete(index);
      const selected: JsonObject[] = [], ids = new Set<string>();
      for (const identity of observation.orderedIdentities) {
        if (Object.keys(identity).length !== 1 || typeof identity.id !== "string" || ids.has(identity.id)) return yield* Effect.fail(mismatch());
        const row = state.get(table)?.get(identity.id);
        if (row === undefined) return yield* Effect.fail(mismatch());
        ids.add(identity.id); selected.push(structuredClone(row)); used.add(table + ":" + identity.id);
        if (table === "cart_line_item") parentItems.add(identity.id);
      }
      yield* Effect.fromResult(refresh.admitSelection(table, selected));
      return selected;
    });
    const expectedEvents: Array<{ object: string; action: string; id: string }> = [];
    const leafResult = Effect.fn("CartCreation.validateLeafResult")(function* (entity: typeof refresh.tax, filters: JsonObject) {
      const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(filters, {})).pipe(Result.flatMap(entity.scalar.query)));
      const selected = yield* readRows(entity.table.name, plan.query.predicate);
      return yield* prepared.present(yield* Effect.fromResult(projectRows(selected, plan.projection.node)), entity.table.name);
    });
    const creates = Effect.fn("CartCreation.validateRefreshCreates")(function* (entity: typeof refresh.tax, inputs: readonly JsonObject[]) {
      const mutations = activity.mutations.filter(mutation => mutation.operation === "insert"), written = [];
      for (const mutation of mutations) {
        if (mutation.table !== entity.table.name || mutation.before !== null || mutation.after === null) return yield* Effect.fail(mismatch());
        written.push(yield* Effect.fromResult(complete(mutation.table, projectNativeRow(mutation.after))));
      }
      const plan = yield* Effect.fromResult(correlateScalarCreateWrites(inputs, written));
      const target = prepared.entities.find(candidate => candidate.table.name === entity.table.name);
      if (target === undefined) return yield* Effect.fail(mismatch());
      const captured = yield* captureGraph({ catalog: prepared.creationCatalog, root: { entity: target.graph, steps: [], omitRelations: [] },
        rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }) },
        plan.inputs, defaultCommerceResources);
      const expected = captured.rows.get(entity.table.name) ?? [];
      if (expected.length !== written.length) return yield* Effect.fail(mismatch());
      for (const [index, row] of written.entries()) {
        const input = expected[index];
        if (input === undefined || row.deleted_at !== null || row.created_at !== row.updated_at) return yield* Effect.fail(mismatch());
        for (const column of entity.table.columns) if (!["created_at", "updated_at", "deleted_at"].includes(column.name) &&
          !jsonEqual(row[column.name] ?? null, input[column.name] ?? column.defaultValue ?? null)) return yield* Effect.fail(mismatch());
        expectedEvents.push({ object: entity.table.name.replace(/^cart_/, ""), action: "created", id: row.id });
      }
      const positional = plan.positions.map(position => plan.results[position]!);
      return yield* prepared.present(positional, entity.table.name);
    });
    const lifecycle = Effect.fn("CartCreation.validateRefreshLifecycle")(function* (entity: typeof refresh.tax,
      requested: readonly string[], operation: "softDelete" | "restore") {
      const patches = activity.mutations.filter(mutation => mutation.operation === "patch"), ordinals = new Map(patches.map((mutation, ordinal) => [mutation.ordinal, ordinal]));
      const transitions = [];
      for (const transition of activity.lifecycle) {
        const attemptOrdinal = transition.attemptOrdinal === null ? null : ordinals.get(transition.attemptOrdinal);
        if (attemptOrdinal === undefined) return yield* Effect.fail(mismatch());
        transitions.push({ ...transition, attemptOrdinal });
      }
      const ids = activity.lifecycle.map(transition => transition.key.id);
      const ordered = yield* Effect.fromResult(decodeReceiptIds(ids));
      const validate = scalarLifecycleReceipt({ table: entity.table.name, maximumRoots: 4,
        softDeleteCommand: "cartRefreshSoftDeleteProof", restoreCommand: "cartRefreshRestoreProof",
        decodeIds: decodeReceiptIds, decodeRow: entity.complete,
        decodeResult: value => decodeLifecycleResult(value)
          .pipe(Result.map(value => ({ empty: value.ids.length === 0, ids: value.ids }))) });
      yield* validate({ ...call, commandName: operation === "softDelete" ? "cartRefreshSoftDeleteProof" : "cartRefreshRestoreProof", mode: "write", input: [...requested], result: { ids: ordered }, events: [] },
        { ...activity, mutations: patches.map((mutation, ordinal) => ({ ...mutation, ordinal })), lifecycle: transitions,
          observedRows: activity.observedRows.filter(observation => observation.table === entity.table.name &&
            typeof observation.row.id === "string" && requested.includes(observation.row.id)) });
      const after = [];
      for (const transition of activity.lifecycle) {
        const mutation = transition.attemptOrdinal === null ? undefined : activity.mutations[transition.attemptOrdinal];
        const row = mutation?.after ?? transition.rowAtOperation;
        if (row === null || row === undefined || typeof row.id !== "string") return yield* Effect.fail(mismatch());
        after.push(yield* Effect.fromResult(complete(entity.table.name, projectNativeRow(row))));
        if (operation === "softDelete") expectedEvents.push({ object: entity.table.name.replace(/^cart_/, ""), action: "deleted", id: row.id });
      }
      return after;
    });
    let expected: unknown;
    if (call.commandName === "cartListItemTaxForCreation" || call.commandName === "cartListShippingTaxForCreation") {
      if (call.mode !== "read" || activity.mutations.length || activity.lifecycle.length) return yield* Effect.fail(mismatch());
      const shipping = call.commandName === "cartListShippingTaxForCreation";
      const input = shipping ? yield* Effect.fromResult(decodeCartShippingTaxRead(call.input)) : yield* Effect.fromResult(decodeCartItemTaxRead(call.input));
      expected = yield* leafResult(shipping ? refresh.shippingTax : refresh.tax, input);
    } else if (call.commandName === "cartSetItemTaxForCreation" || call.commandName === "cartSetShippingTaxForCreation") {
      if (call.mode !== "write") return yield* Effect.fail(mismatch());
      const shipping = call.commandName === "cartSetShippingTaxForCreation";
      const input = yield* Effect.fromResult(shipping ? decodeCartSetShippingTaxInput(call.input) : decodeCartSetItemTaxInput(call.input));
      const inserted: JsonObject[] = [];
      for (const line of input.tax_lines) inserted.push(yield* captureExactNumericRow(line, refresh.tax.numbers, false, "nativeRaw"));
      if (shipping && activity.mutations.some(mutation => mutation.operation === "insert")) return yield* Effect.fail(mismatch());
      expected = shipping ? [] : yield* creates(refresh.tax, inserted);
      const generated = activity.mutations.filter(mutation => mutation.operation === "insert").map(mutation => mutation.after?.id);
      const generatedIds = yield* Effect.fromResult(decodeReceiptIds(generated));
      if (generatedIds.length) {
        const existing = yield* readRows(refresh.tax.table.name, { kind: "and", children: [{ kind: "in", column: "id", values: generatedIds }, { kind: "isNull", column: "deleted_at" }] });
        if (existing.length) return yield* Effect.fail(mismatch());
      }
      const removed = yield* refresh.selectTaxRemoval(readRows, shipping ? { shipping_method: { cart_id: input.cart_id } } :
        { item: { cart_id: input.cart_id }, ...(generatedIds.length ? { id: { $nin: generatedIds } } : {}) }, shipping);
      const removedIds = []; for (const row of removed) { if (typeof row.id !== "string") return yield* Effect.fail(mismatch()); removedIds.push(row.id); }
      yield* lifecycle(shipping ? refresh.shippingTax : refresh.tax, removedIds, "softDelete");
    } else if (call.commandName === "cartAddItemAdjustmentsForCreation") {
      if (call.mode !== "write" || activity.lifecycle.length || activity.mutations.some(mutation => mutation.operation !== "insert")) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeCartItemAdjustments(call.input)), normalized = [];
      for (const row of input) normalized.push(yield* captureExactNumericRow(row, refresh.adjustment.numbers, false, "nativeRaw"));
      expected = yield* creates(refresh.adjustment, normalized);
    } else if (call.commandName === "cartSoftDeleteItemAdjustmentsForCreation" || call.commandName === "cartRestoreItemAdjustmentsForCreation") {
      if (call.mode !== "write" || activity.mutations.some(mutation => mutation.operation !== "patch")) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeCartRefreshIds(call.input)), operation = call.commandName === "cartSoftDeleteItemAdjustmentsForCreation" ? "softDelete" : "restore";
      if (input.length) yield* refresh.selectAdjustmentLifecycle(readRows, input, operation);
      const rows = yield* lifecycle(refresh.adjustment, input, operation), joiner = cartStaticResources.joinerConfig;
      if (joiner === undefined) return yield* Effect.fail(mismatch());
      expected = mapObjectTo(rows.length ? { [refresh.adjustment.model]: rows } : {}, buildModelsNameToLinkableKeysMap(joiner.linkableKeys ?? {}));
    } else return yield* Effect.fail(mismatch());
    if (reads.size) return yield* Effect.fail(mismatch("unconsumedReads"));
    for (const observation of activity.observedRows) if (!used.has(observation.table + ":" + observation.row.id)) {
      const row = typeof observation.row.id === "string" ? state.get(observation.table)?.get(observation.row.id) : undefined;
      // The complete indexed parent cohort can include a pending Tax row
      // deleted by an earlier native callback in this same root. The exact
      // active query and core match vector exclude it from returned rows;
      // retain its authenticated parent membership rather than dropping it.
      if (call.commandName !== "cartSetItemTaxForCreation" || observation.table !== refresh.tax.table.name ||
        typeof row?.deleted_at !== "string" || typeof row.item_id !== "string" || !parentItems.has(row.item_id))
        return yield* Effect.fail(mismatch("unaccountedObservations"));
    }
    if (!jsonEqual(yield* Effect.fromResult(captureNativeNumericDto(expected)), call.result)) return yield* Effect.fail(mismatch("result"));
    const pendingEvents = new Set(expectedEvents.map(event => JSON.stringify([event.object, event.action, event.id])));
    if (pendingEvents.size !== expectedEvents.length) return yield* Effect.fail(mismatch());
    for (const event of call.events) {
      const message = yield* captureCartCreationRefreshEvent(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!pendingEvents.delete(JSON.stringify([message.metadata.object, message.metadata.action, id]))) return yield* Effect.fail(mismatch());
    }
    if (pendingEvents.size) return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: captureCartCreationRefreshEvent, validateLogicalCall };
}
