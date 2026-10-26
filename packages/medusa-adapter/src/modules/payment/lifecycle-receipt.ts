import { Effect, Option, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { toPopulateTree, type PopulateTree } from "@medusajs/drizzle/relation-query";
import { paymentCollectionUpdate, validatePaymentCapture, validatePaymentRefund } from "@medusajs/payment/utils/accounting";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { moduleEventDecoder } from "../../module/events";
import { captureCommerceInput } from "../../value/input";
import { captureNativeDateRecord } from "../../value/native-record";
import { captureExactNumericRow, encodeExactNumeric } from "../../value/exact-numeric";
import { commerceDecoder } from "../../value/decoder";
import { PaymentId, decodePaymentRead, decodePaymentDelete } from "./input";
import { decodePaymentAuthorization, decodePaymentCapture, decodePaymentRefund, decodePaymentRetrieve } from "./lifecycle-input";
import type { preparePaymentSessionRepository } from "./repository";

type Prepared = Result.Result.Success<ReturnType<typeof preparePaymentSessionRepository>>;
type Row = JsonObject & { readonly id: string };
const mismatch = (phase: string, cause?: unknown) => commerceError("receiptMismatch", { phase, cause });
const event = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PAYMENT), object: Schema.Literals(["payment_session", "payment_collection", "payment", "capture", "refund"]),
    action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([PaymentId, Schema.Array(PaymentId).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);
const instant = commerceDecoder(Schema.DateFromString, "receiptMismatch");
const decodeCaptureDecision = commerceDecoder(Schema.Struct({ isFullyCaptured: Schema.Boolean }), "receiptMismatch");
export const capturePaymentLifecycleEvent = Effect.fn("PaymentLifecycle.captureEvent")(function* (input: unknown) {
  const value = yield* event(input);
  if (value.name !== buildModuleResourceEventName({ prefix: Modules.PAYMENT, objectName: value.metadata.object, action: value.metadata.action }))
    return yield* Effect.fail(commerceError("unadmittedEvent"));
  return value;
});

/** Replay only the finite native call's row/read causality. Native accounting
 * helpers own decisions and amounts; this policy acquires no storage manager. */
export function paymentLifecyclePolicy(prepared: Prepared) {
  const { contracts, query, relations } = prepared;
  const decodeRow = (table: string, value: unknown) => {
    const decode = table === contracts.collection.name ? contracts.decodeCollection : table === contracts.session.name ? contracts.decodeSession :
      table === contracts.payment.name ? contracts.decodePayment : table === contracts.capture.name ? contracts.decodeCapture :
        table === contracts.refund.name ? contracts.decodeRefund : table === contracts.reason.name ? contracts.decodeReason : undefined;
    return decode === undefined ? Result.fail(mismatch("table")) : decode(value);
  };
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PaymentLifecycle.validateCall")(function* (call, activity) {
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch("activity"));
    const state = new Map<string, Map<string, Row>>(), seen = new Set<string>();
    const group = (table: string) => [...state.get(table)?.values() ?? []];
    const put = (table: string, row: Row) => { const rows = state.get(table) ?? new Map<string, Row>(); rows.set(row.id, row); state.set(table, rows); };
    for (const observation of activity.observedRows) {
      const row = yield* Effect.fromResult(decodeRow(observation.table, projectNativeRow(observation.row)));
      if (state.get(observation.table)?.has(row.id)) return yield* Effect.fail(mismatch("duplicate-observation"));
      put(observation.table, row);
    }
    for (const [ordinal, change] of activity.mutations.entries()) {
      if (change.ordinal !== ordinal || change.operation !== "insert" && change.operation !== "patch") return yield* Effect.fail(mismatch("mutation"));
      if (change.before !== null) yield* Effect.fromResult(decodeRow(change.table, projectNativeRow(change.before)));
      if (change.after === null) return yield* Effect.fail(mismatch("missing-after"));
      yield* Effect.fromResult(decodeRow(change.table, projectNativeRow(change.after)));
    }
    for (const change of [...activity.mutations].reverse()) {
      if (change.after === null || typeof change.after.id !== "string") return yield* Effect.fail(mismatch("identity"));
      if (change.before === null) state.get(change.table)?.delete(change.after.id);
      else put(change.table, yield* Effect.fromResult(decodeRow(change.table, projectNativeRow(change.before))));
    }
    if ([...state.values()].some(rows => rows.size > 4)) return yield* Effect.fail(mismatch("bound"));
    const reads: JsonObject[] = [];
    const record = (table: string, predicate: Json, rows: readonly Row[]) => {
      for (const row of rows) seen.add(table + ":" + row.id);
      reads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: rows.length, returned: rows.length });
    };
    const populate = (source: string, parents: readonly Row[], tree: PopulateTree, selected: Map<string, readonly JsonObject[]>): Result.Result<void, ReturnType<typeof commerceError>> => Result.gen(function* () {
      for (const [name, nested] of tree) {
        const relation = relations.get(source)?.get(name);
        if (relation === undefined || relation.join.type === "manyToMany") return yield* Result.fail(mismatch("relation"));
        const owning = relation.join.type === "belongsTo";
        const population = yield* prepareCommerceRelationPopulation(owning ? relation.targetPrimaryKeys : relation.join.foreignKeys,
          parents, owning ? relation.join.foreignKeys : relation.sourcePrimaryKeys, true, false);
        let children: Row[] = [];
        if (Option.isSome(population)) {
          const { column, values, predicate } = population.value;
          children = orderNativeIdRows(group(relation.targetTable).filter(row => row.deleted_at === null && typeof row[column] === "string" && values.includes(row[column])), {});
          record(relation.targetTable, predicate, children);
        }
        selected.set(relation.targetTable, children);
        yield* populate(relation.targetTable, children, nested, selected);
      }
    });
    const select = (table: Prepared["contracts"]["collection"], filters: JsonObject, config: JsonObject = {}) => Result.gen(function* () {
      const plan = yield* captureCommerceInput(buildQuery(filters, config)).pipe(Result.flatMap(value => query(table, value)));
      const ids = typeof filters.id === "string" ? [filters.id] : Array.isArray(filters.id) ? filters.id :
        Array.isArray(filters.$or) ? filters.$or.filter(isJsonObject).map(value => value.id) : undefined;
      const collectionIds = filters.payment_collection_id === undefined ? undefined :
        typeof filters.payment_collection_id === "string" ? [filters.payment_collection_id] : filters.payment_collection_id;
      const roots = orderNativeIdRows(group(table.name).filter(row => row.deleted_at === null && (ids === undefined || ids.includes(row.id)) &&
        (collectionIds === undefined || Array.isArray(collectionIds) && collectionIds.includes(row.payment_collection_id))), {});
      record(table.name, plan.query.predicate, roots);
      const selected = new Map<string, readonly JsonObject[]>([[table.name, roots]]);
      yield* populate(table.name, roots, toPopulateTree(plan.paths), selected);
      const assembled = yield* assembleCommerceRelations(table.name, selected, plan.paths, relations);
      return { roots, rows: yield* projectRows(assembled, plan.projection.node) };
    });
    const selectedOne = (table: Prepared["contracts"]["collection"], id: string, config: JsonObject = {}) => Result.gen(function* () {
      const selected = yield* select(table, { id }, config), row = selected.rows[0];
      if (selected.rows.length !== 1 || row === undefined) return yield* Result.fail(mismatch("missing-root"));
      return row;
    });
    let mutationPosition = 0;
    const expectedEvents: Array<{ object: string; action: string; id: string }> = [];
    const applyPatch = (table: string, id: string, fields: JsonObject) => Result.gen(function* () {
      const mutation = activity.mutations[mutationPosition++], before = state.get(table)?.get(id);
      if (mutation?.table !== table || mutation.operation !== "patch" || before === undefined || mutation.before === null || mutation.after === null ||
        !jsonEqual(projectNativeRow(mutation.before), before)) return yield* Result.fail(mismatch("patch-before"));
      const after = yield* decodeRow(table, projectNativeRow(mutation.after));
      for (const [name, value] of Object.entries({ ...before, ...fields })) if (name !== "updated_at" && !jsonEqual(after[name] ?? null, value))
        return yield* Result.fail(mismatch("patch-field", { table, name }));
      put(table, after); seen.add(table + ":" + id); expectedEvents.push({ object: table, action: "updated", id }); return after;
    });
    const insert = (table: string, fields: JsonObject) => Result.gen(function* () {
      const mutation = activity.mutations[mutationPosition++];
      if (mutation?.table !== table || mutation.operation !== "insert" || mutation.before !== null || mutation.after === null)
        return yield* Result.fail(mismatch("insert"));
      const after = yield* decodeRow(table, projectNativeRow(mutation.after));
      if (state.get(table)?.has(after.id) || after.deleted_at !== null || after.created_at !== after.updated_at) return yield* Result.fail(mismatch("insert-identity"));
      for (const [name, value] of Object.entries(after)) if (!["id", "created_at", "updated_at", "deleted_at"].includes(name) && !jsonEqual(value, fields[name] ?? null))
        return yield* Result.fail(mismatch("insert-field", { table, name }));
      put(table, after); seen.add(table + ":" + after.id); expectedEvents.push({ object: table, action: "created", id: after.id }); return after;
    });
    const businessDate = (field: string) => Result.gen(function* () {
      const value = activity.mutations[mutationPosition]?.after?.[field], date = yield* instant(value);
      if (typeof value !== "string" || date.toISOString() !== value) return yield* Result.fail(mismatch("business-date"));
      return value;
    });
    const updatePreimage = (table: Prepared["contracts"]["collection"], id: string) => select(table, { $or: [{ id }] });
    const collectionConfig = { select: ["amount", "raw_amount", "status", "currency_code"], relations: ["payment_sessions.amount", "payment_sessions.raw_amount",
      "payment_sessions.status", "payments.captures.amount", "payments.captures.raw_amount", "payments.refunds.amount", "payments.refunds.raw_amount"] };
    const updateCollection = Effect.fn("PaymentLifecycle.validateCollectionUpdate")(function* (id: string) {
      const collection = yield* Effect.fromResult(selectedOne(contracts.collection, id, collectionConfig));
      yield* Effect.fromResult(updatePreimage(contracts.collection, id));
      const actual = activity.mutations[mutationPosition]?.after?.completed_at;
      const completed = typeof actual === "string" ? yield* Effect.fromResult(instant(actual)) : new Date(0);
      const update: unknown = yield* Effect.try({ try: () => Reflect.apply(paymentCollectionUpdate, undefined, [collection, () => completed]), catch: cause => mismatch("collection-accounting", cause) });
      const fields = yield* captureExactNumericRow(yield* captureNativeDateRecord(update, ["completed_at"]), contracts.collectionNumbers);
      yield* Effect.fromResult(applyPatch(contracts.collection.name, id, fields));
    });
    let expected: Json;
    if (call.mode === "read") {
      if (activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch("read-mutations"));
      if (call.commandName === "paymentRetrieveForWorkflow" || call.commandName === "paymentSessionRetrieveForAuthorization") {
        const input = yield* Effect.fromResult(decodePaymentRetrieve(call.input)), table = call.commandName === "paymentRetrieveForWorkflow" ? contracts.payment : contracts.session;
        expected = yield* contracts.present(yield* Effect.fromResult(selectedOne(table, input.id, input.config)), table.name);
      } else {
        const table = call.commandName === "paymentCountForLifecycle" ? contracts.payment : call.commandName === "paymentSessionCountForLifecycle" ? contracts.session :
          call.commandName === "paymentCollectionCountForLifecycle" ? contracts.collection : call.commandName === "refundReasonCountForLifecycle" ? contracts.reason : undefined;
        if (table === undefined) return yield* Effect.fail(mismatch("read-command"));
        const input = yield* Effect.fromResult(decodePaymentRead(call.input)), selected = yield* Effect.fromResult(select(table, input.filters ?? {}, input.config));
        expected = [yield* contracts.present(selected.rows, table.name), selected.roots.length];
      }
    } else if (call.commandName === "paymentSessionAuthorizeForWorkflow") {
      const input = yield* Effect.fromResult(decodePaymentAuthorization(call.input));
      const session = yield* Effect.fromResult(selectedOne(contracts.session, input.id, { select: ["id", "data", "provider_id", "amount", "raw_amount", "currency_code", "authorized_at", "payment_collection_id"], relations: ["payment", "payment_collection"] }));
      if (session.payment !== undefined && isJsonObject(session.payment) && session.authorized_at) expected = yield* contracts.presentPayment(session.payment);
      else {
        yield* Effect.fromResult(updatePreimage(contracts.session, input.id));
        const fields = { data: {}, status: "authorized", ...(session.authorized_at === null ? { authorized_at: yield* Effect.fromResult(businessDate("authorized_at")) } : {}) };
        yield* Effect.fromResult(applyPatch(contracts.session.name, input.id, fields));
        const amount = yield* encodeExactNumeric(session.amount);
        const payment = yield* Effect.fromResult(insert(contracts.payment.name, { amount: amount.value, raw_amount: yield* Effect.fromResult(captureCommerceInput(amount.raw)), currency_code: session.currency_code!,
          provider_id: "pp_system_default", data: {}, payment_session_id: input.id, payment_collection_id: session.payment_collection_id! }));
        const selected = new Map<string, readonly JsonObject[]>([[contracts.payment.name, [payment]]]);
        yield* Effect.fromResult(populate(contracts.payment.name, [payment], toPopulateTree(["payment_session"]), selected));
        const assembled = yield* Effect.fromResult(assembleCommerceRelations(contracts.payment.name, selected, ["payment_session"], relations)), output = assembled[0];
        if (output === undefined || typeof payment.payment_collection_id !== "string") return yield* Effect.fail(mismatch("authorized-payment"));
        yield* updateCollection(payment.payment_collection_id);
        expected = yield* contracts.presentPayment({ ...output, captures: [], refunds: [] });
      }
    } else if (call.commandName === "paymentCaptureForWorkflow") {
      const input = yield* Effect.fromResult(decodePaymentCapture(call.input));
      const payment = yield* Effect.fromResult(selectedOne(contracts.payment, input.payment_id, { select: ["id", "data", "provider_id", "payment_collection_id", "amount", "raw_amount", "currency_code", "captured_at", "canceled_at"], relations: ["captures.raw_amount"] }));
      const data = structuredClone(input);
      const decision: unknown = yield* Effect.try({ try: () => Reflect.apply(validatePaymentCapture, undefined, [data, payment]), catch: cause => mismatch("capture-accounting", cause) });
      const full = yield* Effect.fromResult(decodeCaptureDecision(decision));
      if (!payment.captured_at) {
        const amount = yield* encodeExactNumeric(data.amount);
        yield* Effect.fromResult(insert(contracts.capture.name, { amount: amount.value, raw_amount: yield* Effect.fromResult(captureCommerceInput(amount.raw)), payment_id: input.payment_id }));
        yield* Effect.fromResult(updatePreimage(contracts.payment, input.payment_id));
        yield* Effect.fromResult(applyPatch(contracts.payment.name, input.payment_id, { data: {}, ...(full.isFullyCaptured ? { captured_at: yield* Effect.fromResult(businessDate("captured_at")) } : {}) }));
      }
      if (typeof payment.payment_collection_id !== "string") return yield* Effect.fail(mismatch("capture-collection"));
      yield* updateCollection(payment.payment_collection_id);
      expected = yield* contracts.presentPayment(yield* Effect.fromResult(selectedOne(contracts.payment, input.payment_id, { relations: ["captures"] })));
    } else if (call.commandName === "paymentRefundForWorkflow") {
      const input = yield* Effect.fromResult(decodePaymentRefund(call.input));
      const payment = yield* Effect.fromResult(selectedOne(contracts.payment, input.payment_id, { select: ["id", "data", "provider_id", "payment_collection_id", "amount", "raw_amount"], relations: ["captures.raw_amount", "refunds.raw_amount"] }));
      const data = structuredClone(input);
      yield* Effect.try({ try: () => Reflect.apply(validatePaymentRefund, undefined, [payment, data]), catch: cause => mismatch("refund-accounting", cause) });
      const amount = yield* encodeExactNumeric(data.amount);
      yield* Effect.fromResult(insert(contracts.refund.name, { amount: amount.value, raw_amount: yield* Effect.fromResult(captureCommerceInput(amount.raw)), payment_id: input.payment_id,
        created_by: data.created_by ?? null, note: data.note ?? null, refund_reason_id: data.refund_reason_id ?? null }));
      yield* Effect.fromResult(updatePreimage(contracts.payment, input.payment_id));
      yield* Effect.fromResult(applyPatch(contracts.payment.name, input.payment_id, { data: {} }));
      if (typeof payment.payment_collection_id !== "string") return yield* Effect.fail(mismatch("refund-collection"));
      yield* updateCollection(payment.payment_collection_id);
      expected = yield* contracts.presentPayment(yield* Effect.fromResult(selectedOne(contracts.payment, input.payment_id, { relations: ["refunds"] })));
    } else if (call.commandName === "paymentCancelForWorkflow") {
      const id = yield* Effect.fromResult(decodePaymentDelete(call.input));
      yield* Effect.fromResult(selectedOne(contracts.payment, id, { select: ["id", "data", "provider_id"] }));
      yield* Effect.fromResult(updatePreimage(contracts.payment, id));
      yield* Effect.fromResult(applyPatch(contracts.payment.name, id, { canceled_at: yield* Effect.fromResult(businessDate("canceled_at")) }));
      expected = yield* contracts.presentPayment(yield* Effect.fromResult(selectedOne(contracts.payment, id)));
    } else return yield* Effect.fail(mismatch("write-command"));
    if (mutationPosition !== activity.mutations.length || !jsonEqual(reads, activity.relationalReads) || !jsonEqual(expected, call.result))
      return yield* Effect.fail(mismatch("result-or-activity", { expectedReads: reads, actualReads: activity.relationalReads }));
    const actualEvents = [];
    for (const message of call.events) {
      const value = yield* capturePaymentLifecycleEvent(message);
      for (const id of typeof value.data.id === "string" ? [value.data.id] : value.data.id)
        actualEvents.push({ object: value.metadata.object, action: value.metadata.action, id });
    }
    if (!jsonEqual(expectedEvents, actualEvents)) return yield* Effect.fail(mismatch("events"));
    for (const observation of activity.observedRows) if (!seen.has(observation.table + ":" + String(observation.row.id)))
      return yield* Effect.fail(mismatch("unread-row"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : mismatch("contract", cause)));
  return { capture: capturePaymentLifecycleEvent, validateLogicalCall };
}
