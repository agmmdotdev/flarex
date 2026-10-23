import { Effect, Option, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { hasChangedFields } from "@medusajs/drizzle/mutation-plan";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows, matchesPublicRow } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { moduleEventDecoder } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { ServiceZoneUpdateReadInput, decodeServiceZoneUpdateInput, decodeServiceZoneUpdateUpserts } from "./service-zone-update-input";
import type { prepareServiceZoneUpdateRepository } from "./service-zone-update-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareServiceZoneUpdateRepository>>;
type Row = JsonObject & { readonly id: string };
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeRead = commerceDecoder(ServiceZoneUpdateReadInput, "receiptMismatch");
const decodeOrderedIdentities = commerceDecoder(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(32)), "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String, metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT),
  object: Schema.Literals(["service_zone", "geo_zone"]), action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 16))]) }),
}), defaultCommerceResources);

/** Correlate actual native projection, selected ownership, full historical
 * replacement and row/event effects. Genuine service code owns business checks. */
export function serviceZoneUpdatePolicy(prepared: Prepared) {
  const { contracts, graph } = prepared;
  const capture = Effect.fn("ServiceZoneUpdate.captureEvent")(function* (input: unknown) {
    const event = yield* decodeEvent(input);
    if (event.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: event.metadata.object, action: event.metadata.action }) ||
      event.metadata.object === "service_zone" && event.metadata.action !== "updated") return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...event, metadata: { ...event.metadata }, data: { ...event.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ServiceZoneUpdate.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
    const initial = new Map<string, Map<string, Row>>([[contracts.zone.name, new Map()], [contracts.geo.name, new Map()]]);
    const decodeRow = (table: string, value: JsonObject) => Result.gen(function* () {
      const decode = table === contracts.zone.name ? contracts.decodeZoneRow : table === contracts.geo.name ? contracts.decodeGeoRow : undefined;
      if (decode === undefined) return yield* Result.fail(mismatch());
      const row = yield* decode(projectNativeRow(value)).pipe(Result.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string") return yield* Result.fail(mismatch());
      const identified: Row = { ...row, id: row.id };
      return identified;
    });
    for (const observation of activity.observedRows) {
      const row = yield* Effect.fromResult(decodeRow(observation.table, observation.row));
      const prior = initial.get(observation.table)?.get(row.id);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
      initial.get(observation.table)?.set(row.id, row);
    }
    const changed = new Map<string, typeof activity.mutations[number]>();
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      if (mutation.ordinal !== ordinal || mutation.operation === "replace" || mutation.before === null && mutation.after === null)
        return yield* Effect.fail(mismatch());
      const value = mutation.after ?? mutation.before;
      if (value === null) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(decodeRow(mutation.table, value)), token = mutation.table + ":" + row.id;
      if (changed.has(token) || mutation.table === contracts.zone.name && mutation.operation !== "patch") return yield* Effect.fail(mismatch());
      changed.set(token, mutation);
      const rows = initial.get(mutation.table);
      if (rows === undefined) return yield* Effect.fail(mismatch());
      if (mutation.operation === "insert") {
        if (mutation.before !== null || mutation.after === null) return yield* Effect.fail(mismatch());
        rows.delete(row.id);
      } else {
        if (mutation.before === null || mutation.operation === "delete" && mutation.after !== null || mutation.operation === "patch" && mutation.after === null)
          return yield* Effect.fail(mismatch());
        const before = yield* Effect.fromResult(decodeRow(mutation.table, mutation.before));
        if (before.id !== row.id) return yield* Effect.fail(mismatch());
        rows.set(row.id, before);
      }
    }
    for (const observation of activity.observedRows) {
      const mutation = changed.get(observation.table + ":" + String(observation.row.id));
      if (mutation !== undefined && (mutation.after === null ||
        !jsonEqual(projectNativeRow(observation.row), projectNativeRow(mutation.after)))) return yield* Effect.fail(mismatch());
    }
    const roots = [...initial.get(contracts.zone.name)?.values() ?? []], geos = [...initial.get(contracts.geo.name)?.values() ?? []];
    if (roots.length > 4 || geos.length > 16 || new Set([...geos.map(row => row.id), ...activity.mutations.filter(row => row.table === contracts.geo.name)
      .flatMap(row => typeof row.after?.id === "string" ? [row.after.id] : [])]).size > 32) return yield* Effect.fail(mismatch());
    const rootIds = new Set(roots.map(row => row.id));
    if (geos.some(row => typeof row.service_zone_id !== "string" || !rootIds.has(row.service_zone_id))) return yield* Effect.fail(mismatch());
    const reads: JsonObject[] = [], selectedGeos = new Set<string>(), selectedRoots = new Set<string>();
    const orderedGeoRead = (predicate: JsonObject, rows: readonly Row[]) => Result.gen(function* () {
      const order = graph.profile.ordering.get(contracts.geo.name);
      if (order === undefined || typeof order === "string") return yield* Result.fail(mismatch());
      const actual = activity.relationalReads[reads.length];
      const identities = yield* decodeOrderedIdentities(actual?.orderedIdentities);
      if (identities.length !== rows.length || new Set(identities.map(row => row.id)).size !== identities.length)
        return yield* Result.fail(mismatch());
      const byId = new Map(rows.map(row => [row.id, row])), ordered: Row[] = [];
      for (const { id } of identities) {
        const row = byId.get(id);
        if (row === undefined) return yield* Result.fail(mismatch());
        ordered.push(row); selectedGeos.add(id);
      }
      reads.push({ table: contracts.geo.name, query: commerceRelationReadQuery(defaultCommerceResources, predicate, order),
        total: rows.length, returned: rows.length, orderedIdentities: identities });
      return ordered;
    });
    const activeRead = (input: unknown) => Result.gen(function* () {
      const plan = yield* captureCommerceInput(input).pipe(Result.flatMap(prepared.query), Result.mapError(cause => commerceError("receiptMismatch", cause)));
      const ids = typeof plan.where.id === "string" ? [plan.where.id] : Array.isArray(plan.where.id) ? plan.where.id
        : Array.isArray(plan.where.$or) ? plan.where.$or.flatMap(value => value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string" ? [value.id] : []) : [];
      // An exact indexed identity/FK candidate can be observed before the
      // native deleted_at residual excludes it from the returned active set.
      for (const row of roots) if (ids.includes(row.id)) selectedRoots.add(row.id);
      const all = orderNativeIdRows(roots.filter(row => row.deleted_at === null && ids.includes(row.id)), plan.where);
      const selected = plan.options.limit === undefined ? all : all.slice(0, plan.options.limit);
      reads.push({ table: contracts.zone.name, query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "and", children: [plan.predicate, { kind: "isNull", column: "deleted_at" }] }), total: all.length, returned: all.length });
      const selectedIds = new Set(selected.map(row => row.id));
      let children = geos.filter(row => row.deleted_at === null && typeof row.service_zone_id === "string" && selectedIds.has(row.service_zone_id));
      if (plan.paths.includes("geo_zones")) {
        if (contracts.relation.join.type !== "hasMany") return yield* Result.fail(mismatch());
        const population = yield* prepareCommerceRelationPopulation(contracts.relation.join.foreignKeys, selected,
          contracts.relation.sourcePrimaryKeys, true, false);
        if (Option.isSome(population)) {
          for (const row of geos) if (typeof row.service_zone_id === "string" && selectedIds.has(row.service_zone_id)) selectedGeos.add(row.id);
          children = yield* orderedGeoRead(population.value.predicate, children);
        }
      }
      return { plan, selected, children };
    });
    if (call.commandName === "serviceZoneListForUpdate") {
      if (call.mode !== "read" || activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeRead(call.input));
      const ids = typeof input.filters.id === "string" ? [input.filters.id] : input.filters.id;
      if (roots.some(row => !ids.includes(row.id))) return yield* Effect.fail(mismatch());
      const config = { ...(input.config?.select === undefined ? {} : { select: [...input.config.select] }),
        ...(input.config?.relations === undefined ? {} : { relations: [...input.config.relations] }) };
      const selected = yield* Effect.fromResult(activeRead(buildQuery(input.filters, config)));
      const state = new Map([[contracts.zone.name, selected.selected], [contracts.geo.name, selected.children]]);
      const assembled = (yield* Effect.fromResult(assembleCommerceRelations(contracts.zone.name, state, selected.plan.paths, graph.catalog.queryRelations)));
      const expected = yield* Effect.fromResult(projectRows(assembled, selected.plan.fields.node).pipe(Result.mapError(cause => commerceError("receiptMismatch", cause))));
      const actual = yield* Effect.fromResult(contracts.decodePreimages(call.result).pipe(Result.mapError(cause => commerceError("receiptMismatch", cause))));
      if (geos.some(row => !selectedGeos.has(row.id)) || !jsonEqual(expected, actual) || !jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "write" || call.commandName !== "serviceZoneUpdateForWorkflow" && call.commandName !== "serviceZoneUpsertForUpdateInverse")
      return yield* Effect.fail(mismatch());
    const updates = yield* Effect.gen(function* () {
      if (call.commandName === "serviceZoneUpdateForWorkflow") {
        const input = yield* Effect.fromResult(decodeServiceZoneUpdateInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const ids = typeof input.selector.id === "string" ? [input.selector.id] : input.selector.id;
        if (roots.some(row => !ids.includes(row.id))) return yield* Effect.fail(mismatch());
        const found = yield* Effect.fromResult(activeRead(buildQuery(input.selector)));
        return found.selected.map(row => ({ id: row.id, ...input.update }));
      }
      return yield* Effect.fromResult(decodeServiceZoneUpdateUpserts(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    });
    const ids = updates.map(row => row.id), requested = new Set(ids);
    if (call.commandName === "serviceZoneUpsertForUpdateInverse" && roots.some(row => !requested.has(row.id))) return yield* Effect.fail(mismatch());
    const hydrated = updates.length ? yield* Effect.fromResult(activeRead(buildQuery({ id: ids }, { relations: ["geo_zones"], take: ids.length }))) : undefined;
    const active = hydrated?.children ?? [], activeDeletes: string[] = [];
    for (const input of updates) if (input.geo_zones !== undefined) {
      const keep = new Set(input.geo_zones.flatMap(row => "id" in row && typeof row.id === "string" ? [row.id] : []));
      for (const geo of active) if (geo.service_zone_id === input.id && !keep.has(geo.id)) activeDeletes.push(geo.id);
    }
    if (activeDeletes.length) reads.push({ table: contracts.geo.name,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: activeDeletes }), total: activeDeletes.length, returned: activeDeletes.length });
    if (updates.length) yield* Effect.fromResult(activeRead(buildQuery({ $or: ids.map(id => ({ id })) })));
    const pending = new Set(changed.keys()), expectedEvents: Array<{ object: string; action: "created" | "updated" | "deleted"; id: string }> = [];
    const remove = (id: string) => {
      const mutation = changed.get(contracts.geo.name + ":" + id);
      return mutation?.operation === "delete" && mutation.before?.id === id && mutation.after === null && pending.delete(contracts.geo.name + ":" + id);
    };
    for (const id of orderNativeIdRows(active.filter(row => activeDeletes.includes(row.id)), {}).map(row => row.id)) {
      if (!remove(id)) return yield* Effect.fail(mismatch());
      expectedEvents.push({ object: contracts.geo.name, action: "deleted", id });
    }
    const output = yield* Effect.fromResult(contracts.decodeRows(call.result).pipe(Result.mapError(cause => commerceError("receiptMismatch", cause))));
    if (output.length !== updates.length) return yield* Effect.fail(mismatch());
    for (const [index, input] of updates.entries()) {
      const before = roots.find(row => row.id === input.id), returned = output[index];
      if (before === undefined || returned?.id !== input.id || before.deleted_at !== null) return yield* Effect.fail(mismatch());
      reads.push({ table: contracts.zone.name, query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "in", column: "id", values: [input.id] }), total: 1, returned: 1 });
      const rootMutation = changed.get(contracts.zone.name + ":" + input.id);
      const rootAfter = rootMutation?.after === null || rootMutation?.after === undefined ? before : yield* Effect.fromResult(decodeRow(contracts.zone.name, rootMutation.after));
      if (input.name === undefined ? rootMutation !== undefined : rootMutation?.operation !== "patch") return yield* Effect.fail(mismatch());
      const { geo_zones: returnedChildren, ...scalar } = returned;
      if (!matchesPublicRow(rootAfter, scalar)) return yield* Effect.fail(mismatch());
      for (const [field, value] of Object.entries(before)) if (field !== "updated_at" &&
        (rootAfter[field] === undefined || !jsonEqual(rootAfter[field], field === "name" && input.name !== undefined ? input.name : value))) return yield* Effect.fail(mismatch());
      if (rootMutation !== undefined) {
        pending.delete(contracts.zone.name + ":" + input.id);
        expectedEvents.push({ object: contracts.zone.name, action: "updated", id: input.id });
      }
      if (input.geo_zones === undefined) {
        if (returnedChildren !== undefined) return yield* Effect.fail(mismatch());
        continue;
      }
      let cohort = geos.filter(row => row.service_zone_id === input.id && !activeDeletes.includes(row.id));
      for (const row of cohort) selectedGeos.add(row.id);
      const cohortPredicate: JsonObject = { kind: "in", column: "service_zone_id", values: [input.id] };
      if (input.geo_zones.length) cohort = yield* Effect.fromResult(orderedGeoRead(cohortPredicate, cohort));
      const kept = new Set<string>(), final = new Map<string, Row>(cohort.map(row => [row.id, row]));
      const created = activity.mutations.filter(row => row.table === contracts.geo.name && row.operation === "insert" && row.after?.service_zone_id === input.id);
      const createdEvents: string[] = [], updatedEvents: string[] = [], deletedEvents: string[] = [];
      let nextCreated = 0;
      for (const request of input.geo_zones) {
        const id = "id" in request && typeof request.id === "string" ? request.id : undefined;
        if (id === undefined) {
          const mutation = created[nextCreated++];
          if (mutation?.after === null || mutation?.after === undefined || typeof mutation.after.id !== "string") return yield* Effect.fail(mismatch());
          const row = yield* Effect.fromResult(decodeRow(contracts.geo.name, mutation.after));
          const defaults = Object.fromEntries(contracts.geo.columns.filter(column => !["id", "created_at", "updated_at", "deleted_at"].includes(column.name))
            .flatMap(column => column.defaultValue !== undefined ? [[column.name, column.defaultValue]] : column.nullable ? [[column.name, null]] : []));
          const wanted: JsonObject = { ...defaults, ...request, service_zone_id: input.id };
          for (const [field, value] of Object.entries(wanted)) if (row[field] === undefined || !jsonEqual(row[field], value)) return yield* Effect.fail(mismatch());
          if (row.deleted_at !== null || row.created_at !== row.updated_at ||
            !pending.delete(contracts.geo.name + ":" + row.id)) return yield* Effect.fail(mismatch());
          yield* Effect.fromResult(orderedGeoRead({ kind: "in", column: "id", values: [row.id] }, []));
          final.set(row.id, row); kept.add(row.id); createdEvents.push(row.id);
        } else {
          const old = active.find(row => row.id === id && row.service_zone_id === input.id);
          if (old === undefined || kept.has(id)) return yield* Effect.fail(mismatch());
          kept.add(id);
          const normalized = { ...structuredClone(old), ...request, service_zone_id: input.id };
          const mutation = changed.get(contracts.geo.name + ":" + id), changes = hasChangedFields(old, normalized, ["id"]);
          if (changes ? mutation?.operation !== "patch" : mutation !== undefined) return yield* Effect.fail(mismatch());
          if (mutation !== undefined) {
            if (mutation.after === null) return yield* Effect.fail(mismatch());
            const row = yield* Effect.fromResult(decodeRow(contracts.geo.name, mutation.after));
            for (const [field, value] of Object.entries(normalized)) if (!["created_at", "updated_at", "deleted_at"].includes(field) &&
              (row[field] === undefined || !jsonEqual(row[field], value))) return yield* Effect.fail(mismatch());
            if (row.created_at !== old.created_at || row.deleted_at !== old.deleted_at || !pending.delete(contracts.geo.name + ":" + id)) return yield* Effect.fail(mismatch());
            final.set(id, row); updatedEvents.push(id);
          }
        }
      }
      if (nextCreated !== created.length) return yield* Effect.fail(mismatch());
      if (input.geo_zones.length) for (const row of cohort) if (!kept.has(row.id)) {
        if (!remove(row.id)) return yield* Effect.fail(mismatch());
        final.delete(row.id); deletedEvents.push(row.id);
      }
      if (!Array.isArray(returnedChildren)) return yield* Effect.fail(mismatch());
      const finalRows = yield* Effect.fromResult(orderedGeoRead(cohortPredicate, [...final.values()]));
      const expectedChildren = finalRows.filter(row => row.deleted_at === null);
      if (!jsonEqual(expectedChildren, returnedChildren)) return yield* Effect.fail(mismatch());
      for (const [action, ids] of [["created", createdEvents], ["updated", updatedEvents], ["deleted", deletedEvents]] as const)
        for (const id of ids) expectedEvents.push({ object: contracts.geo.name, action, id });
    }
    if (pending.size || roots.some(row => !selectedRoots.has(row.id)) || geos.some(row => !selectedGeos.has(row.id)) ||
      !jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(mismatch());
    let emitted = 0;
    for (const value of call.events) {
      const event = yield* capture(value);
      for (const id of Array.isArray(event.data.id) ? event.data.id : [event.data.id]) {
        const expected = expectedEvents[emitted++];
        if (expected?.object !== event.metadata.object || expected.action !== event.metadata.action || expected.id !== id) return yield* Effect.fail(mismatch());
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall, allowStorageInsertionOrder: true as const };
}
