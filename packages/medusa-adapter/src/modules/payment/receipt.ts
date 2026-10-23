import { Effect, Option, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { projectRows } from "../../query/projection";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { encodeExactNumeric } from "../../value/exact-numeric";
import { moduleEventDecoder } from "../../module/events";
import { PaymentId, decodePaymentRead, decodePaymentCreate, decodePaymentDelete, decodePaymentCollectionCreate } from "./input";
import type { preparePaymentSessionRepository } from "./repository";

type Prepared = Result.Result.Success<ReturnType<typeof preparePaymentSessionRepository>>;
const event = moduleEventDecoder(Schema.Struct({ name: Schema.String, metadata: Schema.Struct({ source: Schema.Literal(Modules.PAYMENT),
  object: Schema.Literals(["payment_session", "payment_collection"]), action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([PaymentId, Schema.Array(PaymentId).check(Schema.isLengthBetween(1, 1))]) }) }), defaultCommerceResources);

/** Receipts bind native command results and events to complete observed rows,
 * exact query cohorts and the two selected mutation lifecycles. */
export function paymentSessionPolicy({ contracts, query, relations }: Prepared) {
  const capture = Effect.fn("Payment.captureEvent")(function* (input: unknown) {
    const message = yield* event(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PAYMENT, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("Payment.validateSessionCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const collectionRead = call.commandName === "paymentCollectionCountForSessions";
    if (collectionRead || call.commandName === "paymentSessionListForWorkflow") {
      if (call.mode !== "read" || call.events.length || activity.mutations.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodePaymentRead(call.input));
      const root = collectionRead ? contracts.collection : contracts.session;
      const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters ?? {}, input.config ?? {})).pipe(Result.flatMap(value => query(root, value))));
      const rows = new Map<string, JsonObject[]>();
      for (const observation of activity.observedRows) {
        if (observation.table !== contracts.collection.name && observation.table !== contracts.session.name) return yield* Effect.fail(mismatch());
        const row = yield* Effect.fromResult((observation.table === contracts.collection.name ? contracts.decodeCollection : contracts.decodeSession)(projectNativeRow(observation.row)));
        if (row.deleted_at !== null) return yield* Effect.fail(mismatch());
        const selected = rows.get(observation.table) ?? [];
        if (selected.some(previous => previous.id === row.id)) return yield* Effect.fail(mismatch());
        selected.push(row); rows.set(observation.table, selected);
      }
      for (const values of rows.values()) values.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const roots = rows.get(root.name) ?? [], requested = input.filters?.id;
      if (roots.length > 4 || roots.some(row => requested !== undefined && !(Array.isArray(requested) ? requested.includes(String(row.id)) : row.id === requested)))
        return yield* Effect.fail(mismatch());
      const expectedReads = [{ table: root.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: roots.length, returned: roots.length }];
      for (const path of plan.paths) {
        const relation = relations.get(root.name)?.get(path);
        if (relation === undefined) return yield* Effect.fail(mismatch());
        const target = rows.get(relation.targetTable) ?? [];
        const columns = relation.join.type === "belongsTo" ? relation.targetPrimaryKeys : relation.join.type === "hasMany" ? relation.join.foreignKeys : [];
        const parents = relation.join.type === "belongsTo" ? relation.join.foreignKeys : relation.sourcePrimaryKeys;
        const population = yield* Effect.fromResult(prepareCommerceRelationPopulation(columns, roots, parents, true, false));
        if (Option.isSome(population)) expectedReads.push({ table: relation.targetTable,
          query: commerceRelationReadQuery(defaultCommerceResources, population.value.predicate), total: target.length, returned: target.length });
      }
      if (!jsonEqual(activity.relationalReads, expectedReads)) return yield* Effect.fail(mismatch());
      const projected = yield* Effect.fromResult(projectRows((yield* Effect.fromResult(assembleCommerceRelations(root.name, rows, plan.paths, relations))), plan.projection.node));
      const output = yield* contracts.present(projected);
      if (!jsonEqual(call.result, collectionRead ? [output, roots.length] : output)) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "write") return yield* Effect.fail(mismatch());
    const collectionCreate = call.commandName === "paymentCollectionCreateForWorkflow";
    const sessionCreate = call.commandName === "paymentSessionCreateForWorkflow";
    const deleting = call.commandName === "paymentSessionDeleteForWorkflow";
    if (!collectionCreate && !sessionCreate && !deleting) return yield* Effect.fail(mismatch());
    const expectedEvents: Array<{ id: string; object: "payment_collection" | "payment_session"; action: "created" | "updated" | "deleted" }> = [];
    if (deleting) {
      const id = yield* Effect.fromResult(decodePaymentDelete(call.input)), mutation = activity.mutations[0];
      if (call.result !== null || activity.mutations.length !== 1 || mutation?.operation !== "delete" || mutation.table !== contracts.session.name ||
        mutation.before === null || mutation.after !== null || mutation.before.id !== id || mutation.ordinal !== 0 || activity.relationalReads.length !== 1)
        return yield* Effect.fail(mismatch());
      for (const row of activity.observedRows) if (row.table !== contracts.session.name || row.row.id !== id) return yield* Effect.fail(mismatch());
      expectedEvents.push({ id, object: "payment_session", action: "deleted" });
    } else {
      const input = yield* Effect.fromResult(collectionCreate ? decodePaymentCollectionCreate(call.input) : decodePaymentCreate(call.input));
      const table = collectionCreate ? contracts.collection : contracts.session, mutation = activity.mutations[0], stored = mutation?.after;
      if (stored === undefined || stored === null || mutation?.operation !== "insert" || mutation.table !== table.name || mutation.before !== null || mutation.ordinal !== 0 ||
        activity.mutations.length !== (collectionCreate ? 1 : 2)) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult((collectionCreate ? contracts.decodeCollection : contracts.decodeSession)(projectNativeRow(stored)));
      const encoded = yield* encodeExactNumeric(input.amount);
      for (const [name, value] of Object.entries({ ...input, amount: encoded.value, raw_amount: encoded.raw }))
        if (!jsonEqual(row[name] ?? null, yield* Effect.fromResult(captureCommerceInput(value)))) return yield* Effect.fail(mismatch());
      if (row.deleted_at !== null || row.created_at !== row.updated_at) return yield* Effect.fail(mismatch());
      let result: JsonObject = row;
      expectedEvents.push({ id: row.id, object: collectionCreate ? "payment_collection" : "payment_session", action: "created" });
      if (sessionCreate) {
        const updated = activity.mutations[1];
        if (updated?.operation !== "patch" || updated.table !== table.name || updated.before === null || updated.after === null || updated.ordinal !== 1 ||
          !jsonEqual(projectNativeRow(updated.before), row)) return yield* Effect.fail(mismatch());
        result = yield* Effect.fromResult(contracts.decodeSession(projectNativeRow(updated.after)));
        for (const [name, value] of Object.entries(row)) if (!["updated_at", "data", "status"].includes(name) && !jsonEqual(value, result[name] ?? null))
          return yield* Effect.fail(mismatch());
        const sessionInput = yield* Effect.fromResult(decodePaymentCreate(call.input));
        if (result.status !== "pending" || !jsonEqual(result.data ?? null, sessionInput.data)) return yield* Effect.fail(mismatch());
        expectedEvents.push({ id: row.id, object: "payment_session", action: "updated" });
      } else result = { ...result, payment_providers: [], payment_sessions: [], payments: [] };
      if (!jsonEqual(call.result, yield* contracts.present(result))) return yield* Effect.fail(mismatch());
      for (const observation of activity.observedRows) if (observation.table !== table.name || observation.row.id !== row.id)
        return yield* Effect.fail(mismatch());
    }
    const actualEvents = [];
    for (const value of call.events) {
      const message = yield* capture(value);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) actualEvents.push({ id, object: message.metadata.object, action: message.metadata.action });
    }
    if (!jsonEqual(actualEvents, expectedEvents)) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}
