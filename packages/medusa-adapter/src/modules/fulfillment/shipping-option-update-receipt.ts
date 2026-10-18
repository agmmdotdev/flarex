import { Effect, Option, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { validateAndNormalizeRules } from "@medusajs/fulfillment/rule-validation";
import { hasChangedFields } from "@medusajs/drizzle/mutation-plan";
import { Modules, buildModuleResourceEventName, arrayDifference, MessageAggregator, moduleEventBuilderFactory } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow, matchesPublicRow } from "../../repository/result";
import { commerceRelationReadQuery, prepareCommerceRelationPopulation, assembleCommerceRelations } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { moduleEventDecoder } from "../../module/events";
import { decodeGraphCount } from "../../local-graph/query";
import { decodeShippingOptionUpdates, decodeShippingOptionUpdateRead } from "./shipping-option-update-input";
import { ShippingOptionId } from "./shipping-option-create-input";
import { ShippingProviderReadFilters } from "./shipping-option-create-query";
import { shippingOptionRulePolicy } from "./shipping-option-rule-receipt";
import type { prepareShippingOptionRuleRepository } from "./shipping-option-rule-repository";
import type { prepareShippingOptionUpdateRepository } from "./shipping-option-update-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareShippingOptionUpdateRepository>>;
type Rules = Result.Result.Success<ReturnType<typeof prepareShippingOptionRuleRepository>>;
type Row = JsonObject & { readonly id: string };
const objects = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "receiptMismatch");
const booleans = commerceDecoder(Schema.Array(Schema.Boolean).check(Schema.isMaxLength(4)), "receiptMismatch");
const orderedIds = commerceDecoder(Schema.Array(Schema.Struct({ id: ShippingOptionId })).check(Schema.isMaxLength(32)), "receiptMismatch");
const providerRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(ShippingProviderReadFilters), config: Schema.optionalKey(Schema.JsonObject) }), "receiptMismatch");
const eventDecoder = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT), object: Schema.Literals(["shipping_option", "shipping_option_type", "shipping_option_rule"]),
    action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([ShippingOptionId, Schema.Array(ShippingOptionId).check(Schema.isLengthBetween(1, 16))]) }),
}), defaultCommerceResources);

/** Authenticate actual native updates, retained projections and ordered child
 * effects. Native normalization and shared graph planning remain executors. */
export function shippingOptionUpdatePolicy(prepared: Prepared, rulePrepared: Rules) {
  const { contracts, graph } = prepared, rulePolicy = shippingOptionRulePolicy(rulePrepared);
  const entities = new Map(contracts.entities.map(entity => [entity.table.name, entity]));
  const capture = Effect.fn("ShippingOptionUpdate.captureEvent")(function* (input: unknown) {
    const event = yield* eventDecoder(input);
    if (event.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: event.metadata.object, action: event.metadata.action }) ||
      event.metadata.object === "shipping_option" && event.metadata.action !== "updated") return yield* Effect.fail(commerceError("unadmittedEvent"));
    return event;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingOptionUpdate.validateCall")(function* (call, activity) {
    if (["shippingOptionRuleCreateForBatch", "shippingOptionRuleListForBatch", "shippingOptionRuleDeleteForBatch"].includes(call.commandName))
      return yield* rulePolicy.validateLogicalCall(call, activity);
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
    const decodeRow = (table: string, input: JsonObject) => Result.gen(function* () {
      const entity = entities.get(table);
      if (entity === undefined) return yield* Result.fail(mismatch());
      const row = yield* entity.decodeRow(projectNativeRow(input));
      if (typeof row.id !== "string") return yield* Result.fail(mismatch());
      const identified: Row = { ...row, id: row.id };
      return identified;
    });
    const state = new Map<string, Map<string, Row>>(contracts.entities.map(entity => [entity.table.name, new Map()]));
    for (const observation of activity.observedRows) {
      const row = yield* Effect.fromResult(decodeRow(observation.table, observation.row));
      const group = state.get(observation.table), prior = group?.get(row.id);
      if (group === undefined || prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
      group.set(row.id, row);
    }
    for (const [ordinal, change] of activity.mutations.entries()) {
      if (ordinal !== change.ordinal || ![contracts.option.name, contracts.type.name, contracts.rule.name].includes(change.table) ||
        change.operation === "replace" || change.before === null && change.after === null) return yield* Effect.fail(mismatch());
      if (change.before !== null) yield* Effect.fromResult(decodeRow(change.table, change.before));
      if (change.after !== null) yield* Effect.fromResult(decodeRow(change.table, change.after));
    }
    // Observations retain the final row; reverse attempts recover the exact
    // before-call state even when several Options share an updated Type.
    for (const change of [...activity.mutations].reverse()) {
      const row = change.before ?? change.after;
      if (row === null || typeof row.id !== "string") return yield* Effect.fail(mismatch());
      if (change.before === null) state.get(change.table)?.delete(row.id);
      else state.get(change.table)?.set(row.id, yield* Effect.fromResult(decodeRow(change.table, change.before)));
    }
    for (const entity of contracts.entities) if ((state.get(entity.table.name)?.size ?? 0) > entity.maximum)
      return yield* Effect.fail(mismatch());
    const reads: JsonObject[] = [], seen = new Set<string>();
    const groupRows = (table: string) => [...state.get(table)?.values() ?? []];
    const readRows = (table: string, predicate: JsonObject, candidates: readonly Row[], intrinsic = false) => Result.gen(function* () {
      let rows = orderNativeIdRows(candidates, {});
      const order = intrinsic ? graph.profile.ordering.get(table) : undefined;
      if (intrinsic) {
        if (order === undefined || typeof order === "string") return yield* Result.fail(mismatch());
        const actual = activity.relationalReads[reads.length];
        const identities = yield* orderedIds(actual?.orderedIdentities);
        const indexed = new Map(rows.map(row => [row.id, row]));
        if (identities.length !== rows.length || new Set(identities.map(row => row.id)).size !== identities.length)
          return yield* Result.fail(mismatch());
        rows = [];
        for (const { id } of identities) {
          const row = indexed.get(id); if (row === undefined) return yield* Result.fail(mismatch());
          rows.push(row);
        }
        reads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources, predicate, order), total: rows.length,
          returned: rows.length, orderedIdentities: identities });
      } else reads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: rows.length, returned: rows.length });
      for (const row of rows) seen.add(table + ":" + row.id);
      return rows;
    });
    const selectPlan = (table: string, input: unknown) => Result.gen(function* () {
      const plan = yield* captureCommerceInput(input).pipe(Result.flatMap(value => prepared.reads.query(table, value)));
      const selectedIds = "id" in plan.selection ? plan.selection.id : undefined;
      const ids = selectedIds === undefined && "$or" in plan.selection ? plan.selection.$or.map(row => row.id)
        : typeof selectedIds === "string" ? [selectedIds] : selectedIds;
      const candidates = groupRows(table).filter(row => ids === undefined || ids.includes(row.id));
      for (const row of candidates) seen.add(table + ":" + row.id);
      const active = candidates.filter(row => row.deleted_at === null);
      const roots = yield* readRows(table, plan.query.predicate, active);
      if (plan.window.kind !== "catalog") return yield* Result.fail(mismatch());
      const selected = plan.window.select(roots), rows = new Map<string, readonly JsonObject[]>([[table, selected.rows]]);
      for (const path of plan.paths) {
        const relation = contracts.relations.get(table)?.get(path);
        if (relation === undefined || relation.join.type === "manyToMany") return yield* Result.fail(mismatch());
        const toOne = relation.join.type === "belongsTo", columns = toOne ? relation.targetPrimaryKeys : relation.join.foreignKeys,
          parentColumns = toOne ? relation.join.foreignKeys : relation.sourcePrimaryKeys;
        const population = yield* prepareCommerceRelationPopulation(columns, selected.rows, parentColumns, true, false);
        if (Option.isNone(population)) continue;
        const childColumn = population.value.column;
        const candidates = groupRows(relation.targetTable).filter(row => typeof row[childColumn] === "string" &&
          population.value.values.includes(row[childColumn]));
        for (const row of candidates) seen.add(relation.targetTable + ":" + row.id);
        const children = candidates.filter(row => row.deleted_at === null);
        rows.set(relation.targetTable, yield* readRows(relation.targetTable, population.value.predicate, children, relation.targetTable === contracts.rule.name));
      }
      return { plan, selected, rows };
    });
    const readModels = new Map([
      ["shippingOptionListForUpdate", { table: contracts.option, count: false }], ["shippingOptionCountForUpdate", { table: contracts.option, count: true }],
      ["shippingOptionServiceZoneListForUpdate", { table: contracts.zone, count: false }], ["shippingOptionServiceZoneCountForUpdate", { table: contracts.zone, count: true }],
      ["shippingOptionFulfillmentSetListForUpdate", { table: contracts.set, count: false }], ["shippingOptionFulfillmentSetCountForUpdate", { table: contracts.set, count: true }],
      ["shippingOptionProviderListForUpdate", { table: contracts.provider, count: false }], ["shippingOptionProviderCountForUpdate", { table: contracts.provider, count: true }],
    ]);
    const read = readModels.get(call.commandName);
    if (read !== undefined) {
      if (call.mode !== "read" || activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult((read.table === contracts.provider ? providerRead : decodeShippingOptionUpdateRead)(call.input));
      const selected = yield* Effect.fromResult(selectPlan(read.table.name, buildQuery(input.filters, input.config)));
      const expected = yield* Effect.fromResult(projectRows(assembleCommerceRelations(read.table.name, selected.rows, selected.plan.paths, contracts.relations), selected.plan.projection.node));
      if (read.count) {
        const [rows, count] = yield* Effect.fromResult(decodeGraphCount(call.result));
        if (count !== selected.selected.count || !jsonEqual(rows, expected)) return yield* Effect.fail(mismatch());
      } else if (!jsonEqual(yield* Effect.fromResult(objects(call.result)), expected)) return yield* Effect.fail(mismatch());
    } else if (call.commandName === "shippingOptionValidateCalculationForUpdate") {
      const input = yield* Effect.fromResult(decodeShippingOptionUpdates(call.input)), result = yield* Effect.fromResult(booleans(call.result));
      if (call.mode !== "read" || activity.mutations.length || activity.observedRows.length || activity.relationalReads.length || call.events.length ||
        result.length !== input.length || input.some(row => row.price_type !== "calculated" || row.provider_id !== "manual_manual") || result.some(Boolean))
        return yield* Effect.fail(mismatch());
    } else if (call.commandName === "shippingOptionUpsertForUpdate" && call.mode === "write") {
      const input = structuredClone(yield* Effect.fromResult(decodeShippingOptionUpdates(call.input))), ids = input.map(row => row.id);
      if (new Set(ids).size !== ids.length) return yield* Effect.fail(mismatch());
      const hydrated = input.length ? yield* Effect.fromResult(selectPlan(contracts.option.name,
        buildQuery({ id: ids }, { relations: ["rules", "type"], take: ids.length }))) : undefined;
      const pending = new Set(activity.mutations.map(change => change.ordinal)), expectedEvents: Array<{ object: string; action: "created" | "updated" | "deleted"; id: string }> = [];
      const consume = (table: string, id: string, operation: "insert" | "patch" | "delete", expected: JsonObject) => Result.gen(function* () {
        const change = activity.mutations.find(change => pending.has(change.ordinal) && change.table === table && (change.after?.id ?? change.before?.id) === id);
        const before = state.get(table)?.get(id);
        if (change === undefined || change.operation !== operation || (operation === "insert" ? change.before !== null || before !== undefined
          : change.before === null || before === undefined || !jsonEqual(projectNativeRow(change.before), before))) return yield* Result.fail(mismatch());
        pending.delete(change.ordinal);
        if (operation === "delete") {
          if (change.after !== null) return yield* Result.fail(mismatch());
          if (before === undefined) return yield* Result.fail(mismatch());
          state.get(table)?.delete(id); return before;
        }
        if (change.after === null) return yield* Result.fail(mismatch());
        const after = yield* decodeRow(table, change.after);
        if (after.deleted_at !== null || operation === "insert" && (expected.created_at === undefined ? after.created_at !== after.updated_at
          : after.created_at !== expected.created_at)) return yield* Result.fail(mismatch());
        for (const [key, value] of Object.entries(expected)) if (key !== "updated_at" && after[key] !== undefined && !jsonEqual(value, after[key]) ||
          key !== "updated_at" && after[key] === undefined) return yield* Result.fail(mismatch());
        state.get(table)?.set(id, after); return after;
      });
      const oldRules: Row[] = [];
      for (const row of hydrated?.rows.get(contracts.rule.name) ?? []) oldRules.push(yield* Effect.fromResult(decodeRow(contracts.rule.name, row)));
      // The genuine service's cumulative updated-ID set differs from DAL
      // collection replacement. In particular, [] is not an eager deletion.
      const updatedRuleIds: string[] = [], deletionIds: string[] = [];
      for (const request of input) if (request.rules !== undefined) {
        const existing = oldRules.filter(row => row.shipping_option_id === request.id).map(row => row.id);
        for (const rule of request.rules) if (rule.id !== undefined && existing.includes(rule.id)) updatedRuleIds.push(rule.id);
        deletionIds.push(...arrayDifference(updatedRuleIds, existing));
      }
      if (deletionIds.length) {
        const removed = oldRules.filter(row => deletionIds.includes(row.id));
        const ordered = yield* Effect.fromResult(readRows(contracts.rule.name, { kind: "in", column: "id", values: deletionIds }, removed, true));
        for (const row of ordered) {
          yield* Effect.fromResult(consume(contracts.rule.name, row.id, "delete", row));
          expectedEvents.push({ object: contracts.rule.name, action: "deleted", id: row.id });
        }
      }
      if (input.length) yield* Effect.fromResult(selectPlan(contracts.option.name, buildQuery({ $or: ids.map(id => ({ id })) })));
      const output = yield* Effect.fromResult(contracts.decodeRows(call.result));
      if (output.length !== input.length) return yield* Effect.fail(mismatch());
      for (const [index, request] of input.entries()) {
        const before = state.get(contracts.option.name)?.get(request.id), returned = output[index];
        if (!before || before.deleted_at !== null || returned?.id !== request.id) return yield* Effect.fail(mismatch());
        for (const field of ["created_at", "updated_at", "deleted_at"] as const) if (request[field] !== undefined && request[field] !== before[field])
          return yield* Effect.fail(mismatch());
        const cache = new Map<string, Map<string, Row>>(), loaded = new Set<string>();
        const load = (table: string, column: string, values: string[], refresh = false) => Result.gen(function* () {
          const known = cache.get(table) ?? new Map<string, Row>(), selected = new Set(values);
          if (!values.length) return [];
          if (!refresh && column === "id" && values.every(id => known.has(id))) return [...known.values()].filter(row => selected.has(row.id));
          const key = JSON.stringify([table, column, [...selected].sort()]);
          if (refresh || !loaded.has(key)) {
            const candidates = groupRows(table).filter(row => typeof row[column] === "string" && selected.has(row[column]));
            const rows = yield* readRows(table, { kind: "in", column, values: [...selected] }, candidates, table === contracts.rule.name);
            if (refresh) for (const [id, row] of known) if (typeof row[column] === "string" && selected.has(row[column])) known.delete(id);
            for (const row of rows) known.set(row.id, row);
            loaded.add(key); cache.set(table, known);
          }
          return [...known.values()].filter(row => typeof row[column] === "string" && selected.has(row[column]));
        });
        yield* Effect.fromResult(load(contracts.option.name, "id", [request.id]));
        const { rules, type, type_id, ...scalar } = request;
        const normalized: Record<string, Json> = { ...scalar };
        if (type_id) normalized.shipping_option_type_id = type_id;
        const childEvents: Array<{ object: string; action: "created" | "updated" | "deleted"; id: string }> = [];
        if (type !== undefined) {
          const id = typeof type === "string" ? type : typeof type.id === "string" ? type.id : returned.shipping_option_type_id;
          if (typeof id !== "string") return yield* Effect.fail(mismatch());
          if (isJsonObject(type)) {
            const previous = (yield* Effect.fromResult(load(contracts.type.name, "id", [id])))[0];
            const defaults = Object.fromEntries(contracts.type.columns.filter(column => !["id", "created_at", "updated_at", "deleted_at"].includes(column.name))
              .flatMap(column => column.defaultValue !== undefined ? [[column.name, column.defaultValue]] : column.nullable ? [[column.name, null]] : []));
            const row = yield* Effect.fromResult(consume(contracts.type.name, id, previous ? "patch" : "insert", { ...defaults, ...previous, ...type, id }));
            const known = cache.get(contracts.type.name) ?? new Map(); known.set(id, row); cache.set(contracts.type.name, known);
            childEvents.push({ object: contracts.type.name, action: previous ? "updated" : "created", id });
          }
          normalized.shipping_option_type_id = id;
        }
        for (const fk of contracts.option.foreignKeys) {
          const column = fk.columns[0], target = fk.referencedTable, value = column === undefined ? undefined : normalized[column];
          if (typeof value === "string") yield* Effect.fromResult(load(target, "id", [value]));
        }
        const mutable = Object.fromEntries(Object.entries(normalized).filter(([key]) => !["created_at", "updated_at", "deleted_at"].includes(key)));
        const rootChanged = Object.keys(mutable).some(key => key !== "id");
        const after = rootChanged ? yield* Effect.fromResult(consume(contracts.option.name, request.id, "patch", { ...before, ...mutable })) : before;
        if (rootChanged) expectedEvents.push({ object: contracts.option.name, action: "updated", id: request.id });
        if (rules !== undefined && rules.length) {
          const previousCohort = yield* Effect.fromResult(load(contracts.rule.name, "shipping_option_id", [request.id]));
          const retained = new Set<string>();
          for (const child of rules) {
            let id = child.id;
            if (id === undefined) {
              const change = activity.mutations.find(change => pending.has(change.ordinal) && change.table === contracts.rule.name &&
                change.operation === "insert" && change.after?.shipping_option_id === request.id);
              if (typeof change?.after?.id !== "string") return yield* Effect.fail(mismatch());
              id = change.after.id;
            }
            retained.add(id);
            const previous = (yield* Effect.fromResult(load(contracts.rule.name, "id", [id])))[0];
            const servicePreimage = oldRules.find(row => row.id === id && row.shipping_option_id === request.id);
            const supplied = child.id === undefined ? child : Object.fromEntries(Object.entries(child).filter(([field]) =>
              !["created_at", "updated_at", "deleted_at"].includes(field)));
            const wanted = { ...structuredClone(servicePreimage ?? previous), ...supplied, id, shipping_option_id: request.id };
            // SAFETY: captured JSON follows the executing validator's wider
            // boolean/number grammar, which its static Rule alias omits.
            yield* Effect.try({ try: () => validateAndNormalizeRules([wanted] as Parameters<typeof validateAndNormalizeRules>[0]),
              catch: cause => commerceError("receiptMismatch", cause) });
            yield* Effect.fromResult(load(contracts.option.name, "id", [request.id]));
            if (previous === undefined || hasChangedFields(previous, wanted, ["id"])) {
              const row = yield* Effect.fromResult(consume(contracts.rule.name, id, previous ? "patch" : "insert", wanted));
              const known = cache.get(contracts.rule.name) ?? new Map(); known.set(id, row); cache.set(contracts.rule.name, known);
              childEvents.push({ object: contracts.rule.name, action: previous ? "updated" : "created", id });
            }
          }
          for (const row of previousCohort) if (!retained.has(row.id)) {
            yield* Effect.fromResult(consume(contracts.rule.name, row.id, "delete", row));
            childEvents.push({ object: contracts.rule.name, action: "deleted", id: row.id });
          }
        }
        const { rules: _returnedRules, type: _returnedType, provider, shipping_profile, ...returnedScalar } = returned;
        if (!matchesPublicRow(after, returnedScalar) || provider !== undefined && (provider !== null || after.provider_id !== null) ||
          shipping_profile !== undefined && (shipping_profile !== null || after.shipping_profile_id !== null)) return yield* Effect.fail(mismatch());
        for (const action of ["created", "updated", "deleted"] as const) for (const table of [contracts.type.name, contracts.rule.name])
          expectedEvents.push(...childEvents.filter(event => event.action === action && event.object === table));
      }
      const paths = [...new Set(input.flatMap(request => [...(request.type === undefined ? [] : ["type"]), ...(request.rules === undefined ? [] : ["rules"])]))];
      const roots = ids.map(id => state.get(contracts.option.name)?.get(id));
      const complete: Row[] = [];
      for (const row of roots) {
        if (row === undefined) return yield* Effect.fail(mismatch());
        complete.push(row);
      }
      const populated = new Map<string, readonly JsonObject[]>([[contracts.option.name, complete]]);
      for (const path of paths) {
        const relation = contracts.relations.get(contracts.option.name)?.get(path);
        if (relation === undefined || relation.join.type === "manyToMany") return yield* Effect.fail(mismatch());
        const toOne = relation.join.type === "belongsTo", columns = toOne ? relation.targetPrimaryKeys : relation.join.foreignKeys,
          parentColumns = toOne ? relation.join.foreignKeys : relation.sourcePrimaryKeys;
        const population = yield* Effect.fromResult(prepareCommerceRelationPopulation(columns, complete, parentColumns, true, false));
        if (Option.isNone(population)) continue;
        const { column, values, predicate } = population.value;
        const candidates = groupRows(relation.targetTable).filter(row => typeof row[column] === "string" && values.includes(row[column]));
        for (const row of candidates) seen.add(relation.targetTable + ":" + row.id);
        populated.set(relation.targetTable, yield* Effect.fromResult(readRows(relation.targetTable, predicate,
          candidates.filter(row => row.deleted_at === null), relation.targetTable === contracts.rule.name)));
      }
      const expected = assembleCommerceRelations(contracts.option.name, populated, paths, contracts.relations);
      for (const [index, returned] of output.entries()) {
        const final = expected[index];
        if (final === undefined) return yield* Effect.fail(mismatch());
        if (paths.includes("type") ? !jsonEqual(returned.type ?? null, final.type ?? null) : returned.type !== undefined)
          return yield* Effect.fail(mismatch());
        if (paths.includes("rules") ? !jsonEqual(returned.rules ?? null, final.rules ?? null) : returned.rules !== undefined)
          return yield* Effect.fail(mismatch());
      }
      if (pending.size) return yield* Effect.fail(mismatch());
      // A native module call can write one shared Type several times. Reuse
      // its aggregator's exact message deduplication without dropping attempts.
      const aggregator = new MessageAggregator();
      for (const event of expectedEvents) moduleEventBuilderFactory({ action: event.action, object: event.object, source: Modules.FULFILLMENT })({
        data: { id: event.id }, sharedContext: { messageAggregator: aggregator },
      });
      const expectedMessages: typeof expectedEvents = [];
      for (const value of aggregator.getMessages().default ?? []) {
        const event = yield* capture(value);
        for (const id of Array.isArray(event.data.id) ? event.data.id : [event.data.id])
          expectedMessages.push({ object: event.metadata.object, action: event.metadata.action, id });
      }
      let ordinal = 0;
      for (const value of call.events) {
        const event = yield* capture(value);
        for (const id of Array.isArray(event.data.id) ? event.data.id : [event.data.id]) {
          const expected = expectedMessages[ordinal++];
          if (!expected || expected.object !== event.metadata.object || expected.action !== event.metadata.action || expected.id !== id)
            return yield* Effect.fail(mismatch());
        }
      }
      if (ordinal !== expectedMessages.length) return yield* Effect.fail(mismatch());
    } else return yield* Effect.fail(mismatch());
    for (const observation of activity.observedRows) {
      const row = state.get(observation.table)?.get(String(observation.row.id));
      if (row === undefined || !jsonEqual(projectNativeRow(observation.row), row)) return yield* Effect.fail(mismatch());
    }
    for (const entity of contracts.entities) if ((state.get(entity.table.name)?.size ?? 0) > entity.maximum)
      return yield* Effect.fail(mismatch());
    if (!jsonEqual(reads, activity.relationalReads) || [...state].some(([table, rows]) => [...rows.keys()].some(id =>
      !seen.has(table + ":" + id) && !activity.mutations.some(change => change.table === table && change.after?.id === id))))
      return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall, allowStorageInsertionOrder: true as const };
}
