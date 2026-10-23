import { Effect, Option, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { hasChangedFields } from "@medusajs/drizzle/mutation-plan";
import { mergeMetadata } from "@medusajs/utils/common/merge-metadata";
import { commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { moduleEventDecoder } from "../../module/events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { FulfillmentCreationId } from "./fulfillment-create-input";
import { commerceDecoder } from "../../value/decoder";
import { decodeFulfillmentShipmentCommand, decodeFulfillmentShipmentRead, decodeFulfillmentDeliveryList,
  fulfillmentUpdateMutableFields, fulfillmentUpdateChangedFields } from "./fulfillment-shipment-input";
import { assignFulfillmentJson, decodeFulfillmentAssignmentPrior } from "./fulfillment-create-value-profile";
import type { prepareFulfillmentCreationRepository } from "./fulfillment-create-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareFulfillmentCreationRepository>>;
type Row = JsonObject & { readonly id: string };
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT), object: Schema.Literals(["fulfillment", "fulfillment_label"]),
    action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([FulfillmentCreationId, Schema.Array(FulfillmentCreationId).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);
const mismatch = (phase: string, cause?: unknown) => commerceError("receiptMismatch", { phase, cause });
const decodeOrderedIds = commerceDecoder(Schema.Array(Schema.Struct({ id: FulfillmentCreationId })).check(Schema.isMaxLength(256)), "receiptMismatch");
const decodeManagedUpdateTime = commerceDecoder(Schema.DateFromString, "receiptMismatch");
export const captureFulfillmentShipmentEvent = Effect.fn("FulfillmentShipment.captureEvent")(function* (input: unknown) {
  const event = yield* decodeEvent(input);
  if (event.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: event.metadata.object, action: event.metadata.action }) ||
    event.metadata.object === "fulfillment" && event.metadata.action !== "updated") return yield* Effect.fail(commerceError("unadmittedEvent"));
  return event;
});

/** Validate the actual native request, projected preimages and mutation/read
 * causality. Replacement is not timestamp-preserving snapshot restoration. */
export function fulfillmentShipmentPolicy(prepared: Prepared) {
  const { contracts, shipment } = prepared;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("FulfillmentShipment.validateCall")(function* (call, activity) {
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch("activity"));
    const entities = new Map(contracts.entities.map(entity => [entity.table.name, entity])),
      state = new Map<string, Map<string, Row>>(contracts.entities.map(entity => [entity.table.name, new Map()])),
      versions = new Map<string, Row[]>(), seen = new Set<string>();
    const token = (table: string, id: string) => table + ":" + id;
    const remember = (table: string, row: Row) => {
      const key = token(table, row.id), rows = versions.get(key) ?? [];
      if (!rows.some(value => jsonEqual(value, row))) rows.push(row);
      versions.set(key, rows); seen.add(key);
    };
    const decodeRow = (table: string, input: JsonObject) => Result.gen(function* () {
      const entity = entities.get(table);
      if (entity === undefined) return yield* Result.fail(mismatch("table"));
      const row = yield* entity.decodeRow(projectNativeRow(input));
      if (typeof row.id !== "string") return yield* Result.fail(mismatch("identity"));
      const value: Row = { ...row, id: row.id };
      return value;
    });
    for (const observation of activity.observedRows) {
      const row = yield* Effect.fromResult(decodeRow(observation.table, observation.row));
      state.get(observation.table)!.set(row.id, row);
    }
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      if (ordinal !== mutation.ordinal || mutation.deletedReference !== undefined || ![contracts.fulfillment.table.name, contracts.label.table.name].includes(mutation.table) ||
        mutation.operation === "replace" || mutation.before === null && mutation.after === null)
        return yield* Effect.fail(mismatch("mutation"));
      if (mutation.before !== null) yield* Effect.fromResult(decodeRow(mutation.table, mutation.before));
      if (mutation.after !== null) yield* Effect.fromResult(decodeRow(mutation.table, mutation.after));
    }
    for (const mutation of [...activity.mutations].reverse()) {
      const row = mutation.before ?? mutation.after;
      if (row === null || typeof row.id !== "string") return yield* Effect.fail(mismatch("mutation-identity"));
      if (mutation.before === null) state.get(mutation.table)!.delete(row.id);
      else state.get(mutation.table)!.set(row.id, yield* Effect.fromResult(decodeRow(mutation.table, mutation.before)));
    }
    const group = (table: string) => [...state.get(table)?.values() ?? []], reads: JsonObject[] = [];
    const readRows = (table: string, predicate: JsonObject, candidates: readonly Row[], active: boolean) => Result.gen(function* () {
      for (const row of candidates) remember(table, row);
      let rows = orderNativeIdRows(candidates.filter(row => !active || row.deleted_at === null), {});
      const order = shipment.reads.ordering.get(table);
      if (order !== undefined && typeof order !== "string") {
        const identities = yield* decodeOrderedIds(activity.relationalReads[reads.length]?.orderedIdentities), indexed = new Map(rows.map(row => [row.id, row]));
        if (identities.length !== rows.length || new Set(identities.map(row => row.id)).size !== identities.length)
          return yield* Result.fail(mismatch("read-order"));
        rows = [];
        for (const { id } of identities) {
          const row = indexed.get(id);
          if (row === undefined) return yield* Result.fail(mismatch("read-order-member"));
          rows.push(row);
        }
        reads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources, predicate, order), total: rows.length, returned: rows.length, orderedIdentities: identities });
      } else reads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: rows.length, returned: rows.length });
      return rows;
    });
    const select = (id: string, filters: JsonObject, config: JsonObject = {}, required = true) => Result.gen(function* () {
      const plan = yield* shipment.reads.query(buildQuery(filters, config));
      const roots = yield* readRows(contracts.fulfillment.table.name, plan.query.predicate, group(contracts.fulfillment.table.name).filter(row => row.id === id), true);
      if (roots.length > 1 || required && roots.length !== 1) return yield* Result.fail(mismatch("selected-root"));
      const rows = new Map<string, readonly JsonObject[]>([[contracts.fulfillment.table.name, roots]]);
      for (const path of plan.paths) {
        const relation = contracts.queryRelations.get(contracts.fulfillment.table.name)?.get(path);
        if (relation === undefined || relation.join.type === "manyToMany") return yield* Result.fail(mismatch("relation"));
        const toOne = relation.join.type === "belongsTo", columns = toOne ? relation.targetPrimaryKeys : relation.join.foreignKeys,
          parentColumns = toOne ? relation.join.foreignKeys : relation.sourcePrimaryKeys;
        const population = yield* prepareCommerceRelationPopulation(columns, roots, parentColumns, true, false);
        if (Option.isNone(population)) continue;
        const { column, values, predicate } = population.value;
        const selected = yield* readRows(relation.targetTable, predicate, group(relation.targetTable).filter(row => typeof row[column] === "string" && values.includes(row[column])), true);
        rows.set(relation.targetTable, selected);
      }
      const assembled = (yield* assembleCommerceRelations(contracts.fulfillment.table.name, rows, plan.paths, contracts.queryRelations));
      return { plan, rows: yield* plan.project(assembled), hydration: yield* shipment.reads.hydration(assembled) };
    });
    if (call.commandName === "fulfillmentListForDelivery") {
      if (call.mode !== "read" || activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch("list-mode"));
      const input = yield* Effect.fromResult(decodeFulfillmentDeliveryList(call.input)), id = input.filters.id[0];
      if (id === undefined) return yield* Effect.fail(mismatch("list-id"));
      const selected = yield* Effect.fromResult(select(id, input.filters, input.config, false));
      if (!jsonEqual(call.result, yield* shipment.values.serialize([...selected.rows]))) return yield* Effect.fail(mismatch("list-result"));
    } else if (call.commandName === "fulfillmentRetrieveForWorkflow") {
      if (call.mode !== "read" || activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch("read-mode"));
      const input = yield* Effect.fromResult(decodeFulfillmentShipmentRead(call.input)), selected = yield* Effect.fromResult(select(input.id, { id: input.id }, input.config)),
        row = selected.rows[0];
      if (row === undefined || !jsonEqual(call.result, yield* shipment.values.serialize(row))) return yield* Effect.fail(mismatch("read-result"));
    } else if (call.commandName === "fulfillmentUpdateForShipment" && call.mode === "write") {
      const input = yield* Effect.fromResult(decodeFulfillmentShipmentCommand(call.input)), id = input.id,
        first = yield* Effect.fromResult(select(id, { id }, { relations: ["items", "labels"] })),
        selected = yield* Effect.fromResult(select(id, { $or: [{ id }] })), before = selected.rows[0];
      if (before === undefined || first.rows.length !== 1) return yield* Effect.fail(mismatch("update-root"));
      const hydration = first.hydration.find(value => value.id === id);
      if (hydration === undefined) return yield* Effect.fail(mismatch("update-hydration"));
      const initial = state.get(contracts.fulfillment.table.name)?.get(id);
      if (initial === undefined || initial.deleted_at !== null) return yield* Effect.fail(mismatch("update-initial"));
      const cache = new Map<string, Map<string, Row>>(), loaded = new Set<string>();
      const load = (table: string, column: string, values: readonly string[], refresh = false) => Result.gen(function* () {
        const known = cache.get(table) ?? new Map<string, Row>(), membership = new Set(values);
        if (!values.length) return [];
        if (!refresh && column === "id" && values.every(id => known.has(id))) return [...known.values()].filter(row => membership.has(row.id));
        const key = JSON.stringify([table, column, [...membership].sort()]);
        if (refresh || !loaded.has(key)) {
          const rows = yield* readRows(table, { kind: "in", column, values: [...membership] }, group(table).filter(row => typeof row[column] === "string" && membership.has(row[column])), false);
          if (refresh) for (const [id, row] of known) if (typeof row[column] === "string" && membership.has(row[column])) known.delete(id);
          for (const row of rows) known.set(row.id, row);
          loaded.add(key); cache.set(table, known);
        }
        return [...known.values()].filter(row => typeof row[column] === "string" && membership.has(row[column]));
      });
      yield* Effect.fromResult(load(contracts.fulfillment.table.name, "id", [id]));
      const pending = new Set(activity.mutations.map(mutation => mutation.ordinal));
      const changes: Array<{ table: string; id: string; operation: "insert" | "patch" | "delete"; expected: JsonObject; preserveTimestamps: boolean }> = [];
      const request = yield* Effect.fromResult(fulfillmentUpdateMutableFields(before, input.update));
      if (request.metadata !== undefined) yield* Effect.fromResult(decodeFulfillmentAssignmentPrior(initial.metadata ?? null));
      const labels = request.labels, oldLabels = labels == null ? [] : yield* Effect.fromResult(load(contracts.label.table.name, "fulfillment_id", [id])), retained = new Set<string>(), labelOrder: string[] = [];
      const normalized: JsonObject = { ...Object.fromEntries(Object.entries(request).filter(([name]) => name !== "labels")),
        ...(request.data === undefined ? {} : { data: yield* Effect.fromResult(assignFulfillmentJson(initial.data, request.data)) }),
        ...(request.metadata !== undefined && isJsonObject(request.metadata) && Object.keys(request.metadata).length
          ? { metadata: mergeMetadata(initial.metadata !== undefined && isJsonObject(initial.metadata) ? initial.metadata : {}, request.metadata) }
          : request.metadata !== undefined && request.metadata !== null
            ? { metadata: yield* Effect.fromResult(assignFulfillmentJson(initial.metadata, request.metadata)) } : {}) };
      const mutable = fulfillmentUpdateChangedFields(initial, normalized);
      const created: string[] = [], updated: string[] = [], deleted: string[] = [], repeatedReferences = new Set<string>();
      for (const request of labels ?? []) {
        let childId = request.id;
        if (childId === undefined) {
          const mutation = activity.mutations.find(change => change.operation === "insert" && change.table === contracts.label.table.name &&
            change.after?.fulfillment_id === id && typeof change.after.id === "string" && !retained.has(change.after.id));
          if (typeof mutation?.after?.id !== "string") return yield* Effect.fail(mismatch("new-label"));
          childId = mutation.after.id;
        }
        if (retained.has(childId)) {
          if (!repeatedReferences.has(childId) || Object.keys(request).length !== 1 || request.id !== childId)
            return yield* Effect.fail(mismatch("duplicate-label"));
          continue;
        }
        retained.add(childId); labelOrder.push(childId);
        const previous = (yield* Effect.fromResult(load(contracts.label.table.name, "id", [childId])))[0];
        if (previous?.deleted_at != null || previous !== undefined && previous.fulfillment_id !== id || request.fulfillment_id !== undefined && request.fulfillment_id !== id)
          return yield* Effect.fail(mismatch("label-owner"));
        if (previous !== undefined && Object.keys(request).length === 1 && request.id === childId) repeatedReferences.add(childId);
        const reconstituting = previous === undefined && ["created_at", "updated_at", "deleted_at"].some(name => Object.hasOwn(request, name));
        // Native [] preimages populate complete Label DTOs. The core alone
        // proves this exact row was deleted in the same outer root; this
        // receipt authenticates the complete supplied DTO and both stamps.
        const retainedRow = reconstituting ? yield* Effect.fromResult(contracts.label.decodeRow(request)) : undefined;
        if (retainedRow !== undefined && (retainedRow.id !== childId || retainedRow.fulfillment_id !== id || retainedRow.deleted_at !== null))
          return yield* Effect.fail(mismatch("retained-label-owner"));
        let managedUpdateChanged = false;
        if (!reconstituting && previous !== undefined && request.updated_at !== undefined) {
          const suppliedTime = yield* Effect.fromResult(decodeManagedUpdateTime(request.updated_at)),
            storedTime = yield* Effect.fromResult(decodeManagedUpdateTime(previous.updated_at));
          managedUpdateChanged = suppliedTime.getTime() !== storedTime.getTime();
        }
        if (!reconstituting) for (const name of ["created_at", "deleted_at"] as const) if (request[name] !== undefined && (previous === undefined || request[name] !== previous[name]))
          return yield* Effect.fail(mismatch("label-managed"));
        const supplied = Object.fromEntries(Object.entries(request).filter(([name]) => !["created_at", "updated_at", "deleted_at"].includes(name))),
          wanted = retainedRow ?? { ...contracts.defaults.get(contracts.label.table.name), ...previous, ...supplied, id: childId, fulfillment_id: id };
        yield* Effect.fromResult(load(contracts.fulfillment.table.name, "id", [id]));
        if (previous === undefined || managedUpdateChanged || hasChangedFields(previous, wanted, ["id"])) {
          changes.push({ table: contracts.label.table.name, id: childId, operation: previous ? "patch" : "insert", expected: wanted, preserveTimestamps: reconstituting });
          (previous ? updated : created).push(childId);
        }
      }
      for (const previous of oldLabels) if (previous.deleted_at === null && !retained.has(previous.id)) {
        changes.push({ table: contracts.label.table.name, id: previous.id, operation: "delete", expected: previous, preserveTimestamps: false }); deleted.push(previous.id);
      }
      const rootUpdated = Object.keys(mutable).length > 0 || hydration.dirtyReferences.length > 0;
      if (rootUpdated)
        changes.push({ table: contracts.fulfillment.table.name, id, operation: "patch", expected: { ...initial, ...mutable }, preserveTimestamps: false });
      // Shared graph batching deletes children, inserts replacements, then
      // writes the root and changed children in dependency order.
      const ordered = changes.filter(change => change.operation === "delete").concat(changes.filter(change => change.operation === "insert"),
        changes.filter(change => change.operation === "patch" && change.table === contracts.fulfillment.table.name),
        changes.filter(change => change.operation === "patch" && change.table === contracts.label.table.name));
      for (const [ordinal, wanted] of ordered.entries()) {
        const mutation = activity.mutations[ordinal], previous = state.get(wanted.table)?.get(wanted.id);
        if (mutation === undefined || mutation.ordinal !== ordinal || mutation.table !== wanted.table || mutation.operation !== wanted.operation ||
          (mutation.after?.id ?? mutation.before?.id) !== wanted.id || (wanted.operation === "insert" ? mutation.before !== null || previous !== undefined
            : mutation.before === null || previous === undefined || !jsonEqual(projectNativeRow(mutation.before), previous)))
          return yield* Effect.fail(mismatch("change", { ordinal, wanted }));
        pending.delete(ordinal);
        if (previous !== undefined) remember(wanted.table, previous);
        if (wanted.operation === "delete") {
          if (mutation.after !== null) return yield* Effect.fail(mismatch("delete"));
          state.get(wanted.table)!.delete(wanted.id); cache.get(wanted.table)?.delete(wanted.id);
        } else {
          if (mutation.after === null) return yield* Effect.fail(mismatch("write"));
          const row = yield* Effect.fromResult(decodeRow(wanted.table, mutation.after));
          if (row.deleted_at !== null || wanted.operation === "insert" && !wanted.preserveTimestamps && row.created_at !== row.updated_at)
            return yield* Effect.fail(mismatch("stamp"));
          for (const [name, value] of Object.entries(wanted.expected)) if (name !== "updated_at" || wanted.preserveTimestamps) {
            const actual = row[name];
            if (actual === undefined || !jsonEqual(value, actual)) return yield* Effect.fail(mismatch("write-value", { name }));
          }
          state.get(wanted.table)!.set(wanted.id, row);
          const known = cache.get(wanted.table) ?? new Map<string, Row>(); known.set(wanted.id, row); cache.set(wanted.table, known);
          remember(wanted.table, row);
        }
      }
      if (pending.size) return yield* Effect.fail(mismatch("extra-change"));
      const root = state.get(contracts.fulfillment.table.name)?.get(id);
      if (root === undefined) return yield* Effect.fail(mismatch("final-root"));
      const items = (yield* Effect.fromResult(load(contracts.item.table.name, "fulfillment_id", [id], true))).filter(row => row.deleted_at === null),
        finalLabels = (yield* Effect.fromResult(load(contracts.label.table.name, "fulfillment_id", [id], true))).filter(row => row.deleted_at === null),
        byId = new Map(finalLabels.map(row => [row.id, row]));
      const output = contracts.initializeRead({ ...root, items, labels: labels == null ? finalLabels : labelOrder.map(id => byId.get(id)!) }, before, "assigned");
      if (!jsonEqual(call.result, yield* contracts.serialize(output))) return yield* Effect.fail(mismatch("update-result"));
      const expectedEvents = [...created.map(id => ({ object: "fulfillment_label", action: "created", id })),
        ...(rootUpdated ? [{ object: "fulfillment", action: "updated", id }] : []),
        ...updated.map(id => ({ object: "fulfillment_label", action: "updated", id })), ...deleted.map(id => ({ object: "fulfillment_label", action: "deleted", id }))];
      let index = 0;
      for (const message of call.events) {
        const event = yield* captureFulfillmentShipmentEvent(message);
        for (const id of typeof event.data.id === "string" ? [event.data.id] : event.data.id) {
          const expected = expectedEvents[index++];
          if (!expected || expected.id !== id || expected.object !== event.metadata.object || expected.action !== event.metadata.action)
            return yield* Effect.fail(mismatch("event"));
        }
      }
      if (index !== expectedEvents.length) return yield* Effect.fail(mismatch("event-count"));
    } else return yield* Effect.fail(mismatch("command"));
    for (const observation of activity.observedRows) if (!versions.get(token(observation.table, String(observation.row.id)))?.some(row => jsonEqual(row, projectNativeRow(observation.row))))
      return yield* Effect.fail(mismatch("observation"));
    if (!jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(mismatch("reads", { expected: reads, actual: activity.relationalReads }));
    if ([...state].some(([table, rows]) => [...rows.keys()].some(id => !seen.has(token(table, id))))) return yield* Effect.fail(mismatch("unread"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : mismatch("contract", cause)));
  return { capture: captureFulfillmentShipmentEvent, validateLogicalCall };
}
