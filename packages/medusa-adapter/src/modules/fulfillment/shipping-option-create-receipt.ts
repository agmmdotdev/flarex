import { Effect, Option, Result, Schema } from "effect";
import { validateAndNormalizeRules } from "@medusajs/fulfillment/rule-validation";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlatePhysicalGraphReceipt } from "../../repository/physical-graph-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { moduleEventDecoder } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { decodeGraphCount } from "../../local-graph/query";
import { decodeShippingOptionCreates, decodeShippingOptionPhysicalIds, ShippingOptionId } from "./shipping-option-create-input";
import { decodeShippingOptionReadInput, decodeShippingProviderReadInput } from "./shipping-option-create-query";
import type { prepareShippingOptionCreationRepository } from "./shipping-option-create-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareShippingOptionCreationRepository>>;
type Row = JsonObject & { readonly id: string };
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "receiptMismatch");
const decodeProviderRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "receiptMismatch");
const decodeBooleans = commerceDecoder(Schema.Array(Schema.Boolean).check(Schema.isMaxLength(4)), "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String, metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT),
  object: Schema.Literals(["shipping_option", "shipping_option_type", "shipping_option_rule"]), action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([ShippingOptionId, Schema.Array(ShippingOptionId).check(Schema.isLengthBetween(1, 16))]) }),
}), defaultCommerceResources);

/** Correlate finite native module calls with complete actual row/read/event
 * evidence. Shared graph/lifecycle owners remain the sole storage executors. */
export function shippingOptionCreationPolicy(prepared: Prepared) {
  const { contracts } = prepared, byTable = new Map([...contracts.entities, ...contracts.physicalEntities].map(entity => [entity.table.name, entity]));
  const capture = Effect.fn("ShippingOptionCreate.captureEvent")(function* (input: unknown) {
    const event = yield* decodeEvent(input);
    if (event.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: event.metadata.object, action: event.metadata.action }) ||
      event.metadata.action === "deleted" && event.metadata.object !== "shipping_option") return yield* Effect.fail(commerceError("unadmittedEvent"));
    return event;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingOptionCreate.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
    const observed = new Map<string, Map<string, Row>>();
    for (const observation of activity.observedRows) {
      const entity = byTable.get(observation.table);
      if (entity === undefined) return yield* Effect.fail(mismatch());
      const decoded = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(observation.row))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof decoded.id !== "string") return yield* Effect.fail(mismatch());
      const row: Row = { ...decoded, id: decoded.id }, group = observed.get(observation.table) ?? new Map<string, Row>(), prior = group.get(row.id);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
      group.set(row.id, row); observed.set(observation.table, group);
      if (group.size > entity.maximum) return yield* Effect.fail(mismatch());
    }
    const readModels = new Map([
      ["shippingOptionListForCreate", { table: contracts.option, count: false }], ["shippingOptionCountForCreate", { table: contracts.option, count: true }],
      ["shippingOptionServiceZoneListForCreate", { table: contracts.zone, count: false }], ["shippingOptionServiceZoneCountForCreate", { table: contracts.zone, count: true }],
      ["shippingOptionFulfillmentSetListForCreate", { table: contracts.set, count: false }], ["shippingOptionFulfillmentSetCountForCreate", { table: contracts.set, count: true }],
      ["shippingOptionProviderListForCreate", { table: contracts.provider, count: false }], ["shippingOptionProviderCountForCreate", { table: contracts.provider, count: true }],
    ]);
    const read = readModels.get(call.commandName);
    if (read !== undefined) {
      if (call.mode !== "read" || activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch());
      const provider = read.table === contracts.provider;
      const input = yield* Effect.fromResult((provider ? decodeShippingProviderReadInput : decodeShippingOptionReadInput)(call.input));
      const { select, relations, ...config } = input.config ?? {};
      const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, { ...config,
        ...(select === undefined ? {} : { select: [...select] }), ...(relations === undefined ? {} : { relations: [...relations] }),
      })).pipe(Result.flatMap(value => prepared.reads.query(read.table.name, value)), Result.mapError(cause => commerceError("receiptMismatch", cause))));
      const filter = input.filters?.id, requested = filter === undefined ? undefined : new Set(typeof filter === "string" ? [filter] : filter), roots = [...observed.get(read.table.name)?.values() ?? []];
      if (roots.some(row => requested !== undefined && !requested.has(row.id))) return yield* Effect.fail(mismatch());
      const active = orderNativeIdRows(roots.filter(row => row.deleted_at === null), {});
      if (plan.window.kind !== "catalog") return yield* Effect.fail(mismatch());
      const selected = plan.window.select(active), reads: JsonObject[] = [{ table: read.table.name,
        query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: active.length, returned: active.length }];
      const rows = new Map<string, readonly JsonObject[]>([[read.table.name, selected.rows]]);
      if (plan.paths.length) {
        const relation = contracts.setRelation;
        const population = yield* Effect.fromResult(prepareCommerceRelationPopulation(relation.targetPrimaryKeys, selected.rows, relation.join.foreignKeys, true, false));
        const targets = [...observed.get(contracts.set.name)?.values() ?? []];
        if (Option.isSome(population)) {
          if (targets.some(row => !population.value.values.includes(row.id))) return yield* Effect.fail(mismatch());
          const members = orderNativeIdRows(targets.filter(row => row.deleted_at === null), {});
          reads.push({ table: contracts.set.name, query: commerceRelationReadQuery(defaultCommerceResources, population.value.predicate), total: members.length, returned: members.length });
          rows.set(contracts.set.name, members);
        } else if (targets.length) return yield* Effect.fail(mismatch());
      }
      const allowedTables = new Set([read.table.name, ...(plan.paths.length ? [contracts.set.name] : [])]);
      if ([...observed.keys()].some(table => !allowedTables.has(table)) || !jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(mismatch());
      const expected = yield* Effect.fromResult(projectRows((yield* Effect.fromResult(assembleCommerceRelations(read.table.name, rows, plan.paths, contracts.relations))), plan.projection.node));
      if (read.count) {
        const [actual, count] = yield* Effect.fromResult(decodeGraphCount(call.result));
        if (count !== active.length || !jsonEqual(actual, expected)) return yield* Effect.fail(mismatch());
      } else if (!jsonEqual(yield* Effect.fromResult((provider ? decodeProviderRows : decodeRows)(call.result)), expected)) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.commandName === "shippingOptionValidateCalculationForCreate") {
      if (call.mode !== "read" || activity.mutations.length || activity.relationalReads.length || activity.observedRows.length || call.events.length)
        return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeShippingOptionCreates(call.input)), result = yield* Effect.fromResult(decodeBooleans(call.result));
      // Only the genuine Manual implementation is constructed by this profile.
      if (input.length !== result.length || input.some(row => row.price_type !== "calculated" || row.provider_id !== "manual_manual") || result.some(Boolean))
        return yield* Effect.fail(mismatch());
      return;
    }
    const expectedEvents: Array<{ object: string; id: string }> = [];
    if (call.mode !== "write") return yield* Effect.fail(mismatch());
    if (call.commandName === "shippingOptionPhysicalDeleteForWorkflow") {
      if (call.result !== null) return yield* Effect.fail(mismatch());
      const ids = yield* Effect.fromResult(decodeShippingOptionPhysicalIds(call.input));
      const removed = yield* Effect.fromResult(correlatePhysicalGraphReceipt({ tables: contracts.tables, entities: contracts.physicalEntities,
        root: contracts.option, requestedIds: ids, activity, referenceDetachments: contracts.referenceDetachments }));
      for (const id of removed) expectedEvents.push({ object: contracts.option.name, id });
    } else if (call.commandName === "shippingOptionCreateForWorkflow") {
      const input = structuredClone(yield* Effect.fromResult(decodeShippingOptionCreates(call.input)));
      // Reuse native normalization for successful Rule input correlation.
      yield* Effect.try({ try: () => validateAndNormalizeRules<Record<string, unknown>>(input.flatMap(row => row.rules ?? [])), catch: cause => commerceError("receiptMismatch", cause) });
      const output = yield* Effect.fromResult(contracts.decodeRows(call.result));
      if (input.length !== output.length) return yield* Effect.fail(mismatch());
      const inserted = new Map<string, Row[]>();
      let tablePosition = -1;
      for (const [ordinal, mutation] of activity.mutations.entries()) {
        const position = [contracts.type.name, contracts.option.name, contracts.rule.name].indexOf(mutation.table), entity = byTable.get(mutation.table);
        if (position < 0 || position < tablePosition || entity === undefined || mutation.ordinal !== ordinal || mutation.operation !== "insert" || mutation.before !== null || mutation.after === null || mutation.deletedReference !== undefined)
          return yield* Effect.fail(mismatch());
        tablePosition = position;
        const value = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(mutation.after)));
        if (typeof value.id !== "string" || value.deleted_at !== null || value.created_at !== value.updated_at) return yield* Effect.fail(mismatch());
        const row: Row = { ...value, id: value.id }, group = inserted.get(mutation.table) ?? [];
        if (group.some(prior => prior.id === row.id)) return yield* Effect.fail(mismatch());
        group.push(row); inserted.set(mutation.table, group);
        const observation = observed.get(mutation.table)?.get(row.id);
        if (observation === undefined || !jsonEqual(observation, row)) return yield* Effect.fail(mismatch());
      }
      const options = inserted.get(contracts.option.name) ?? [], types = inserted.get(contracts.type.name) ?? [], rules = inserted.get(contracts.rule.name) ?? [], matchedTypes = new Set<string>(), matchedRules = new Set<string>();
      if (options.length !== input.length) return yield* Effect.fail(mismatch());
      const expectedFields = (table: typeof contracts.option, supplied: JsonObject, row: Row) => {
        const defaults: Record<string, Json> = {};
        for (const column of table.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
          if (column.defaultValue !== undefined) defaults[column.name] = column.defaultValue;
          else if (column.nullable) defaults[column.name] = null;
        }
        return Object.entries({ ...defaults, ...supplied }).every(([field, value]) => row[field] !== undefined && jsonEqual(row[field], value));
      };
      const references: string[] = [];
      for (const [index, request] of input.entries()) {
        const row = options[index];
        if (row === undefined) return yield* Effect.fail(mismatch());
        const { type: requestedType, rules: requestedRules = [], ...remaining } = request;
        const scalar = Object.fromEntries(Object.entries(remaining).filter(([field]) => !["type_id", "prices"].includes(field)));
        const typeId = row.shipping_option_type_id;
        if (typeof typeId !== "string" || !expectedFields(contracts.option, { ...scalar, shipping_option_type_id: typeId }, row)) return yield* Effect.fail(mismatch());
        if (requestedType !== undefined && typeof requestedType === "object") {
          const target = types.find(type => type.id === row.shipping_option_type_id);
          if (target === undefined || matchedTypes.has(target.id) || !expectedFields(contracts.type, requestedType, target)) return yield* Effect.fail(mismatch());
          matchedTypes.add(target.id); expectedEvents.push({ object: contracts.type.name, id: target.id });
        } else {
          const reference = typeof requestedType === "string" ? requestedType : undefined;
          if (reference === undefined || row.shipping_option_type_id !== reference) return yield* Effect.fail(mismatch());
          references.push(reference);
        }
        expectedEvents.push({ object: contracts.option.name, id: row.id });
        const children = rules.filter(rule => rule.shipping_option_id === row.id);
        if (children.length !== requestedRules.length) return yield* Effect.fail(mismatch());
        for (const [childIndex, child] of children.entries()) {
          const supplied = requestedRules[childIndex];
          if (supplied === undefined || !expectedFields(contracts.rule, { ...supplied, shipping_option_id: row.id }, child)) return yield* Effect.fail(mismatch());
          matchedRules.add(child.id); expectedEvents.push({ object: contracts.rule.name, id: child.id });
        }
      }
      if (matchedTypes.size !== types.length || matchedRules.size !== rules.length || [...observed.keys()].some(table => ![contracts.type.name, contracts.option.name, contracts.rule.name].includes(table)))
        return yield* Effect.fail(mismatch());
      const external = [...observed.get(contracts.type.name)?.values() ?? []].filter(row => !matchedTypes.has(row.id));
      if (external.some(row => !references.includes(row.id))) return yield* Effect.fail(mismatch());
      const reads = references.length ? [{ table: contracts.type.name, query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "and", children: [{ kind: "in", column: "id", values: [...new Set(references)] }, { kind: "isNull", column: "deleted_at" }] }),
        total: external.filter(row => row.deleted_at === null).length, returned: external.filter(row => row.deleted_at === null).length }] : [];
      const expected = yield* Effect.fromResult(contracts.initializeRows(new Map([[contracts.option.name, options], [contracts.rule.name, rules],
        [contracts.type.name, [...types, ...external.filter(row => row.deleted_at === null)]]]), true));
      if (!jsonEqual(reads, activity.relationalReads) || !jsonEqual(expected, output)) return yield* Effect.fail(mismatch());
    } else return yield* Effect.fail(mismatch());
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== (call.commandName === "shippingOptionCreateForWorkflow" ? "created" : "deleted")) return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = expectedEvents[emitted++];
        if (expected === undefined || expected.id !== id || expected.object !== message.metadata.object) return yield* Effect.fail(mismatch());
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall };
}
