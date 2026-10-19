import { Effect, Option, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import { captureCommerceInput } from "../../value/input";
import { FulfillmentCreationId, decodeFulfillmentCreate, decodeFulfillmentCancellationId } from "./fulfillment-create-input";
import { captureFulfillmentItemQuantity, selectedManualDataAssignment } from "./fulfillment-create-value-profile";
import type { prepareFulfillmentCreationRepository } from "./fulfillment-create-repository";
import { fulfillmentShipmentPolicy } from "./fulfillment-shipment-receipt";

type Prepared = Result.Result.Success<ReturnType<typeof prepareFulfillmentCreationRepository>>;
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT),
    object: Schema.Literals(["fulfillment_address", "fulfillment", "fulfillment_label", "fulfillment_item"]), action: Schema.Literals(["created", "updated"]) }),
  data: Schema.Struct({ id: Schema.Union([FulfillmentCreationId, Schema.Array(FulfillmentCreationId).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);

/** Creation returns its first detached graph, while Manual may subsequently
 * patch the stored root. Authenticate both causal states, reads and events. */
export function fulfillmentCreationPolicy(prepared: Prepared) {
  const { contracts } = prepared, byTable = new Map(contracts.entities.map(entity => [entity.table.name, entity])), shipment = fulfillmentShipmentPolicy(prepared);
  const capture = Effect.fn("FulfillmentCreation.captureEvent")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input));
    const metadata = isJsonObject(value) ? value.metadata : undefined;
    if (metadata !== undefined && isJsonObject(metadata) && metadata.object === "fulfillment_label") return yield* shipment.capture(value);
    const event = yield* decodeEvent(input);
    if (event.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: event.metadata.object, action: event.metadata.action }) ||
      event.metadata.action === "updated" && event.metadata.object !== "fulfillment") return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...event, metadata: { ...event.metadata }, data: { ...event.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("FulfillmentCreation.validateCall")(function* (call, activity) {
    if (call.commandName === "fulfillmentRetrieveForWorkflow" || call.commandName === "fulfillmentUpdateForShipment" || call.commandName === "fulfillmentListForDelivery")
      return yield* shipment.validateLogicalCall(call, activity);
    const mismatch = (phase: string, cause?: unknown) => commerceError("receiptMismatch", { phase, cause });
    const creating = call.commandName === "fulfillmentCreateForWorkflow";
    if (!creating && call.commandName !== "fulfillmentCancelForWorkflow" || call.mode !== "write" || activity.lifecycle.length ||
      activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch("command"));
    const versions = new Map<string, JsonObject[]>(), inserted = new Map<string, JsonObject[]>(), orderedEvents: Array<{ object: string; action: "created" | "updated"; id: string }> = [];
    const remember = (table: string, row: JsonObject) => {
      const token = table + ":" + String(row.id), prior = versions.get(token) ?? [];
      if (!prior.some(value => jsonEqual(value, row))) prior.push(row);
      versions.set(token, prior);
    };
    let rootBefore: JsonObject | undefined, rootAfter: JsonObject | undefined, patchCount = 0, lastTable = -1;
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      const entity = byTable.get(mutation.table), after = mutation.after;
      if (!entity || mutation.ordinal !== ordinal || after === null || typeof after.id !== "string" || mutation.deletedReference !== undefined)
        return yield* Effect.fail(mismatch("mutation"));
      const row = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(after))).pipe(Effect.mapError(cause => mismatch("row", cause)));
      if (row.deleted_at !== null) return yield* Effect.fail(mismatch("active"));
      if (mutation.operation === "insert") {
        const position = [contracts.address.table.name, contracts.fulfillment.table.name, contracts.label.table.name, contracts.item.table.name].indexOf(mutation.table);
        if (!creating || patchCount || mutation.before !== null || position < lastTable || position < 0 || row.created_at !== row.updated_at ||
          versions.has(mutation.table + ":" + row.id)) return yield* Effect.fail(mismatch("insert"));
        lastTable = position;
        const rows = inserted.get(mutation.table) ?? []; rows.push(row); inserted.set(mutation.table, rows);
        if (rows.length > entity.maximum) return yield* Effect.fail(mismatch("cohort"));
        orderedEvents.push({ object: mutation.table, action: "created", id: after.id });
        if (entity === contracts.fulfillment) rootBefore = rootAfter = row;
      } else if (mutation.operation === "patch" && entity === contracts.fulfillment && mutation.before !== null && ++patchCount === 1) {
        const before = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(mutation.before)));
        if (rootAfter !== undefined && !jsonEqual(rootAfter, before) || before.id !== row.id) return yield* Effect.fail(mismatch("patch-preimage"));
        rootBefore ??= before; rootAfter = row; remember(mutation.table, before);
        orderedEvents.push({ object: mutation.table, action: "updated", id: after.id });
      } else return yield* Effect.fail(mismatch("operation"));
      remember(mutation.table, row);
    }
    if (rootBefore === undefined) {
      for (const observation of activity.observedRows) {
        if (observation.table !== contracts.fulfillment.table.name) continue;
        const row = yield* Effect.fromResult(contracts.fulfillment.decodeRow(projectNativeRow(observation.row)));
        if (rootBefore !== undefined && !jsonEqual(rootBefore, row)) return yield* Effect.fail(mismatch("observation-state"));
        rootBefore = rootAfter = row; remember(observation.table, row);
      }
    }
    if (rootBefore === undefined || rootAfter === undefined || typeof rootBefore.id !== "string") return yield* Effect.fail(mismatch("root"));
    const referenceRows = new Map<string, Map<string, JsonObject>>();
    for (const observation of activity.observedRows) {
      const entity = contracts.referenceFields.find(field => field.entity.table.name === observation.table)?.entity;
      if (entity === undefined) continue;
      const row = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(observation.row)));
      if (typeof row.id !== "string") return yield* Effect.fail(mismatch("reference-id"));
      const group = referenceRows.get(observation.table) ?? new Map<string, JsonObject>(), prior = group.get(row.id);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch("reference-version"));
      group.set(row.id, row); referenceRows.set(observation.table, group);
      if (group.size > entity.maximum) return yield* Effect.fail(mismatch("reference-cohort"));
    }
    const rootId = rootBefore.id, initialRoot = rootBefore, reads: JsonObject[] = [];
    const read = (filters: JsonObject) => Result.gen(function* () {
      const plan = yield* prepared.query(yield* captureCommerceInput(buildQuery(filters, {})));
      reads.push({ table: contracts.fulfillment.table.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 });
      const populated: Record<string, Json> = {};
      for (const field of contracts.referenceFields) {
        const selection = yield* prepareCommerceRelationPopulation(["id"], [initialRoot], [field.column], true, false);
        if (Option.isNone(selection)) { populated[field.name] = null; continue; }
        const candidates = [...referenceRows.get(field.entity.table.name)?.values() ?? []];
        // Core records an indexed ID candidate before evaluating deleted_at.
        // Authenticate every candidate's FK identity, then project active rows.
        if (candidates.some(row => typeof row.id !== "string" || !selection.value.values.includes(row.id)))
          return yield* Result.fail(mismatch("reference-selection"));
        for (const row of candidates) remember(field.entity.table.name, row);
        const visible = candidates.filter(row => row.deleted_at === null);
        reads.push({ table: field.entity.table.name, query: commerceRelationReadQuery(defaultCommerceResources, selection.value.predicate), total: visible.length, returned: visible.length });
        populated[field.name] = visible[0] ?? null;
      }
      return contracts.initializeRead(initialRoot, populated);
    });
    let expected: JsonObject;
    if (creating) {
      const input = yield* Effect.fromResult(decodeFulfillmentCreate(call.input));
      if ((inserted.get(contracts.fulfillment.table.name) ?? []).length !== 1) return yield* Effect.fail(mismatch("one-root"));
      const { items, labels, delivery_address, location: _location, order: _order, ...scalars } = input;
      const scalarExpected = { ...contracts.defaults.get(contracts.fulfillment.table.name), ...scalars };
      for (const [field, value] of Object.entries(scalarExpected)) if (field !== "delivery_address_id" && (rootBefore[field] === undefined || !jsonEqual(rootBefore[field], value)))
        return yield* Effect.fail(mismatch("request-scalar", { field }));
      const addresses = inserted.get(contracts.address.table.name) ?? [];
      if (addresses.length !== (delivery_address == null ? 0 : 1) || (addresses[0]?.id ?? null) !== rootBefore.delivery_address_id)
        return yield* Effect.fail(mismatch("address-owner"));
      if (delivery_address != null) for (const [field, value] of Object.entries({ ...contracts.defaults.get(contracts.address.table.name), ...delivery_address }))
        if (addresses[0]?.[field] === undefined || !jsonEqual(addresses[0][field]!, value)) return yield* Effect.fail(mismatch("address-request", { field }));
      for (const [requests, entity] of [[labels ?? [], contracts.label], [items ?? [], contracts.item]] as const) {
        const children = inserted.get(entity.table.name) ?? [];
        if (children.length !== requests.length) return yield* Effect.fail(mismatch("children"));
        for (const [index, request] of requests.entries()) {
          const row = children[index];
          if (!row || row.fulfillment_id !== rootId) return yield* Effect.fail(mismatch("child-owner"));
          const normalized = entity === contracts.item ? yield* captureFulfillmentItemQuantity(request) : request;
          for (const [field, value] of Object.entries({ ...contracts.defaults.get(entity.table.name), ...normalized, fulfillment_id: rootId }))
            if (row[field] === undefined || !jsonEqual(row[field], value)) return yield* Effect.fail(mismatch("child-request", { field }));
        }
      }
      const assigned = selectedManualDataAssignment(rootBefore), changed = !jsonEqual(rootBefore.data ?? null, assigned);
      if (patchCount !== (changed ? 1 : 0)) return yield* Effect.fail(mismatch("provider-dirty-state"));
      for (const [field, value] of Object.entries(rootBefore)) if (field !== "updated_at" &&
        (rootAfter[field] === undefined || !jsonEqual(rootAfter[field], field === "data" ? assigned : value))) return yield* Effect.fail(mismatch("provider-update", { field }));
      yield* Effect.fromResult(read({ $or: [{ id: rootId }] }));
      expected = contracts.initializeCreation(rootBefore, inserted, input);
    } else {
      const id = yield* Effect.fromResult(decodeFulfillmentCancellationId(call.input));
      if (id !== rootId || rootBefore.shipped_at !== null || rootBefore.delivered_at !== null) return yield* Effect.fail(mismatch("cancel-eligibility"));
      const changed = rootBefore.canceled_at === null;
      if (patchCount !== (changed ? 1 : 0)) return yield* Effect.fail(mismatch("cancel-dirty-state"));
      if (changed && (typeof rootAfter.canceled_at !== "string" || !Number.isFinite(Date.parse(rootAfter.canceled_at)))) return yield* Effect.fail(mismatch("cancel-date"));
      for (const [field, value] of Object.entries(rootBefore)) if (!["canceled_at", "updated_at"].includes(field) &&
        (rootAfter[field] === undefined || !jsonEqual(rootAfter[field], value))) return yield* Effect.fail(mismatch("cancel-update", { field }));
      const selected = yield* Effect.fromResult(read({ id }));
      if (changed) yield* Effect.fromResult(read({ $or: [{ id }] }));
      expected = contracts.initializeRead(rootAfter, selected, changed ? "assigned" : "retrieved");
    }
    for (const observation of activity.observedRows) if (!versions.get(observation.table + ":" + String(observation.row.id))?.some(value => jsonEqual(value, projectNativeRow(observation.row))))
      return yield* Effect.fail(mismatch("observation"));
    if (!jsonEqual(activity.relationalReads, reads)) return yield* Effect.fail(mismatch("reads", { expected: reads, actual: activity.relationalReads }));
    if (!jsonEqual(call.result, yield* contracts.serialize(expected))) return yield* Effect.fail(mismatch("result"));
    let position = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of typeof message.data.id === "string" ? [message.data.id] : message.data.id) {
        const expected = orderedEvents[position++];
        if (!expected || expected.id !== id || expected.object !== message.metadata.object || expected.action !== message.metadata.action) return yield* Effect.fail(mismatch("event"));
      }
    }
    if (position !== orderedEvents.length) return yield* Effect.fail(mismatch("event-count"));
  });
  return { capture, validateLogicalCall };
}
