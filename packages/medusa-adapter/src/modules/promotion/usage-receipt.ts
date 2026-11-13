import { Cause, Effect, Result, Schema } from "effect";
import type { Context, DAL } from "@medusajs/framework/types";
import { Promotion, ApplicationMethod, Campaign, CampaignBudget, CampaignBudgetUsage, PromotionRule, PromotionRuleValue } from "@medusajs/promotion/models";
import { PromotionModuleService } from "@medusajs/promotion/services";
import { ContainerRegistrationKeys, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { tupleKey } from "@medusajs/drizzle/relation-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { commerceMutationEvents } from "../../repository/mutation-events";
import { prepareCommerceInternalService, prepareCommerceModule } from "../../module/persistence";
import { makeCommercePromiseOwner } from "../../module/promise-owner";
import { commerceModuleEventBus, moduleEventDecoder } from "../../module/events";
import { commerceRelationReadQuery, type CommerceRelationRows } from "../../query/relations";
import { commerceDecoder } from "../../value/decoder";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { decodeGraphCount } from "../../local-graph/query";
import { decodePromotionGraphRead } from "./compute-input";
import { promotionReceiptQueryClock } from "./compute-receipt";
import { replayPromotionUsageQueryClock, type PromotionUsageTable } from "./usage-query";
import { decodePromotionUsageInput } from "./usage-input";
import type { preparePromotionUsageRepository } from "./usage-repository";

type Prepared = Result.Result.Success<ReturnType<typeof preparePromotionUsageRepository>>;
const models = [Promotion, ApplicationMethod, Campaign, CampaignBudget, CampaignBudgetUsage, PromotionRule, PromotionRuleValue];
const bindPromotion = prepareCommerceInternalService(Promotion), bindMethod = prepareCommerceInternalService(ApplicationMethod),
  bindCampaign = prepareCommerceInternalService(Campaign), bindBudget = prepareCommerceInternalService(CampaignBudget),
  bindUsage = prepareCommerceInternalService(CampaignBudgetUsage), bindRule = prepareCommerceInternalService(PromotionRule), bindValue = prepareCommerceInternalService(PromotionRuleValue);
const event = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PROMOTION), object: Schema.Literals(["promotion", "campaign_budget", "campaign_budget_usage"]),
    action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);
const capture = Effect.fn("PromotionUsage.captureEvent")(function* (input: unknown) {
  const value = yield* event(input);
  if (value.name !== buildModuleResourceEventName({ prefix: Modules.PROMOTION, objectName: value.metadata.object, action: value.metadata.action }))
    return yield* Effect.fail(commerceError("unadmittedEvent"));
  return value;
});

/** Replay genuine native usage/inverse calls against authenticated SQL read
 * vectors and mutation preimages. No budget formula, query evaluator, database
 * manager or settlement capability is reproduced in this proof. */
export function promotionUsagePolicy(prepared: Prepared) {
  const entities = new Map(prepared.read.entities.map(entity => [entity.table.name, { ...entity,
    identity: commerceDecoder(Schema.Record(Schema.Literals(entity.primary), Schema.String), "receiptMismatch") }]));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PromotionUsage.validateCall")(function* (call, activity) {
    const mismatch = (phase: string) => commerceError("receiptMismatch", { phase });
    const reading = call.commandName === "promotionReadForCheckout";
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length ||
      (reading ? call.mode !== "read" || activity.mutations.length || call.events.length : call.mode !== "write" ||
        call.commandName !== "promotionRegisterUsage" && call.commandName !== "promotionRevertUsage")) return yield* Effect.fail(mismatch("command"));
    const input = reading ? undefined : yield* Effect.fromResult(decodePromotionUsageInput(call.input));
    const graphInput = reading ? yield* Effect.fromResult(decodePromotionGraphRead(call.input)) : undefined;
    if (!reading && call.result !== null) return yield* Effect.fail(mismatch("result"));
    if (input !== undefined && new Set(input.computedActions.flatMap(action => action.code ? [action.code] : [])).size > 4)
      return yield* Effect.fail(mismatch("codes"));
    const state = new Map<string, Map<string, JsonObject>>(), seen = new Set<string>(), usedTables = new Set<string>();
    const put = (table: string, row: JsonObject) => {
      const entity = entities.get(table); if (entity === undefined) return;
      const rows = state.get(table) ?? new Map<string, JsonObject>(); rows.set(tupleKey(row, entity.primary), row); state.set(table, rows);
    };
    const complete = (table: string, row: JsonObject) => entities.get(table)?.complete(projectNativeRow(row)) ?? Result.fail(mismatch("table"));
    for (const observed of activity.observedRows) put(observed.table, yield* Effect.fromResult(complete(observed.table, observed.row)));
    for (const [ordinal, changed] of activity.mutations.entries()) {
      if (changed.ordinal !== ordinal || !prepared.entities.some(entity => entity.name === changed.table) ||
        changed.operation !== "insert" && changed.operation !== "patch" && changed.operation !== "delete") return yield* Effect.fail(mismatch("mutation"));
      if (changed.before !== null) yield* Effect.fromResult(complete(changed.table, changed.before));
      if (changed.after !== null) yield* Effect.fromResult(complete(changed.table, changed.after));
    }
    for (const changed of [...activity.mutations].reverse()) {
      const entity = entities.get(changed.table), row = changed.before ?? changed.after;
      if (entity === undefined || row === null) return yield* Effect.fail(mismatch("mutation-identity"));
      if (changed.before === null) state.get(changed.table)?.delete(tupleKey(row, entity.primary));
      else put(changed.table, yield* Effect.fromResult(complete(changed.table, changed.before)));
    }
    if ([...state.values()].some(rows => rows.size > 4)) return yield* Effect.fail(mismatch("bound"));
    let cursor = 0, mutationCursor = 0;
    const select = Effect.fn("PromotionUsage.selectObserved")(function* (table: string, query: Json) {
      const entity = entities.get(table), observation = activity.relationalReads[cursor++];
      usedTables.add(table);
      if (entity === undefined || observation?.table !== table || !jsonEqual(observation.query, query) || observation.related !== undefined ||
        observation.orderedIdentities === undefined || observation.total !== observation.returned || observation.returned !== observation.orderedIdentities.length)
        return yield* Effect.fail(mismatch("read"));
      const rows = [], keys = new Set<string>();
      for (const identity of observation.orderedIdentities) {
        const key = tupleKey(yield* Effect.fromResult(entity.identity(identity)), entity.primary), row = state.get(table)?.get(key);
        if (row === undefined || keys.has(key)) return yield* Effect.fail(mismatch("read-row"));
        keys.add(key); seen.add(table + ":" + key); rows.push(structuredClone(row));
      }
      yield* Effect.fromResult(prepared.read.admitSelection(table, rows));
      return rows;
    });
    const readRows: CommerceRelationRows = (table, predicate, order = "id", options) => select(table,
      commerceRelationReadQuery(defaultCommerceResources, predicate, order, { includeIdentities: true, ...options }));
    const mutate = Effect.fn("PromotionUsage.checkMutation")(function* (table: PromotionUsageTable, operation: "insert" | "patch" | "delete", fields: JsonObject,
      selected?: JsonObject) {
      const entity = entities.get(table), changed = activity.mutations[mutationCursor++];
      if (entity === undefined || changed?.table !== table || changed.operation !== operation) return yield* Effect.fail(mismatch("write-order"));
      const before = changed.before === null ? null : yield* Effect.fromResult(complete(table, changed.before));
      const after = changed.after === null ? null : yield* Effect.fromResult(complete(table, changed.after));
      const row = before ?? after;
      if (row === null || typeof row.id !== "string") return yield* Effect.fail(mismatch("write-identity"));
      const key = tupleKey(row, entity.primary), current = state.get(table)?.get(key);
      if (operation === "insert") {
        if (before !== null || after === null || current !== undefined || after.deleted_at !== null || after.created_at !== after.updated_at ||
          !row.id.startsWith(String(entity.table.columns.find(column => column.primaryKey)?.options?.prefix) + "_"))
          return yield* Effect.fail(mismatch("insert"));
        for (const [name, value] of Object.entries(after)) if (!["id", "created_at", "updated_at", "deleted_at"].includes(name) && !jsonEqual(value, fields[name] ?? null))
          return yield* Effect.fail(mismatch("insert-field"));
      } else {
        if (before === null || current === undefined || !jsonEqual(current, before) || fields.id !== before.id || selected !== undefined && !jsonEqual(selected, before))
          return yield* Effect.fail(mismatch("before"));
        if (operation === "delete") { if (after !== null) return yield* Effect.fail(mismatch("delete")); }
        else {
          if (after === null) return yield* Effect.fail(mismatch("patch"));
          for (const [name, value] of Object.entries({ ...before, ...fields })) if (name !== "updated_at" && !jsonEqual(after[name] ?? null, value))
            return yield* Effect.fail(mismatch("patch-field"));
        }
      }
      if (after === null) state.get(table)?.delete(key); else put(table, after);
      seen.add(table + ":" + key); return { row: after ?? row, id: row.id };
    });
    const owner = yield* makeCommercePromiseOwner();
    yield* owner.withClose(Effect.gen(function* () {
      const token = Object.freeze({}), shared: Context = { manager: token, transactionManager: token }, emitted: Json[] = [];
      const authenticate = (value: unknown) => Effect.try({ try: () => {
        if (value === null || typeof value !== "object" || Object.getOwnPropertyDescriptor(value, "transactionManager")?.value !== token) throw mismatch("context");
      }, catch: cause => commerceError("receiptMismatch", cause) });
      const refuse = (): never => owner.reject(mismatch("denied"));
      const denied: DAL.RepositoryService = { getFreshManager: refuse, getActiveManager: refuse, transaction: refuse, find: refuse, findAndCount: refuse,
        serialize: refuse, create: refuse, update: refuse, delete: refuse, softDelete: refuse, restore: refuse, upsert: refuse, upsertWithReplace: refuse };
      const events = commerceMutationEvents(owner), issued = new WeakSet<object>();
      const find = (table: PromotionUsageTable, value: unknown, context: Parameters<DAL.RepositoryService["find"]>[1]) => owner.run(Effect.gen(function* () {
        yield* authenticate(context);
        let captured: unknown = yield* prepared.read.captureQuery(value);
        const parsed = yield* Effect.fromResult(prepared.read.query(table, captured));
        if (parsed.active) {
          const observation = activity.relationalReads[cursor];
          if (observation?.table !== "promotion_campaign") return yield* Effect.fail(mismatch("clock"));
          captured = yield* Effect.fromResult(replayPromotionUsageQueryClock(captured, yield* Effect.fromResult(promotionReceiptQueryClock(observation.query))));
        }
        const result = yield* prepared.read.read(readRows, table, captured), rows = yield* prepared.read.internal(result.rows, table);
        if (!Array.isArray(rows)) return yield* Effect.fail(mismatch("entities"));
        issued.add(rows); return { rows, count: result.count, graph: result.parsed.graph };
      }));
      const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(value: unknown, options?: unknown): Promise<Output> => owner.run(Effect.gen(function* () {
        if (options !== undefined || value === null || typeof value !== "object" || !issued.has(value)) return yield* Effect.fail(mismatch("serialize"));
        // SAFETY: proof-issued metadata-complete entities own the native ABI.
        return (yield* Effect.fromResult(captureNativeNumericDto(value))) as Output;
      }));
      const repository = (table: PromotionUsageTable): DAL.RepositoryService => ({ ...denied, serialize,
        find: async (value, context) => (await find(table, value, context)).rows,
        findAndCount: async (value, context) => { const result = await find(table, value, context); if (!result.graph) return refuse(); return [result.rows, result.count]; },
        update: (value, context) => owner.run(Effect.gen(function* () {
          if (context === undefined) return yield* Effect.fail(mismatch("context"));
          yield* authenticate(context); const entity = prepared.entities.find(entity => entity.name === table);
          if (entity === undefined) return yield* Effect.fail(mismatch("model"));
          const rows = []; for (const pair of yield* prepared.captureUpdates(table, value)) rows.push((yield* mutate(table, "patch", pair.patch, pair.before)).row);
          yield* events.rows("afterUpdate", entity.model, rows, context); return yield* prepared.internalRows(rows, table);
        })),
        ...(table === "promotion_campaign_budget_usage" ? {
          create: ((value, context) => owner.run(Effect.gen(function* () {
            if (context === undefined) return yield* Effect.fail(mismatch("context"));
            yield* authenticate(context); const rows = [];
            for (const fields of yield* prepared.captureCreates(value)) rows.push((yield* mutate(table, "insert", fields)).row);
            yield* events.created(rows.map(entity => ({ modelName: "CampaignBudgetUsage", entity })), context);
            return yield* prepared.internalRows(rows, table);
          }))) satisfies DAL.RepositoryService["create"],
          delete: ((value, context) => owner.run(Effect.gen(function* () {
            yield* authenticate(context); const ids = [];
            for (const key of (yield* Effect.fromResult(prepared.deletion(value))).$or) ids.push((yield* mutate(table, "delete", key)).id);
            return ids;
          }))) satisfies DAL.RepositoryService["delete"],
        } : {}),
      });
      const promotions = repository("promotion"), budgets = repository("promotion_campaign_budget"), usages = repository("promotion_campaign_budget_usage");
      const persistence = yield* Effect.fromResult(prepareCommerceModule({ name: "promotion-usage-proof", models }));
      const binding = persistence.bind(owner, { baseRepository: { ...denied, serialize }, repository: model =>
        model === Promotion ? promotions : model === CampaignBudget ? budgets : model === CampaignBudgetUsage ? usages : denied,
        events: { createEventSubscriber: events.createSubscriber, registerEventSubscriber: events.registerSubscriber,
          dispatchMutationEvent: async (...args) => { await owner.run(events.dispatch(...args)); } } });
      const adapter = binding.persistence, eventBus = commerceModuleEventBus({ owner, resources: defaultCommerceResources,
        capture: message => capture(message).pipe(Effect.map(value => { emitted.push(value); })), check: work => work, refuse: async () => refuse() });
      const container = { baseRepository: { ...denied, serialize }, [Modules.EVENT_BUS]: eventBus,
        [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]: adapter, promotionService: bindPromotion(promotions, adapter),
        applicationMethodService: bindMethod(denied, adapter), campaignService: bindCampaign(denied, adapter), campaignBudgetService: bindBudget(budgets, adapter),
        campaignBudgetUsageService: bindUsage(usages, adapter), promotionRuleService: bindRule(denied, adapter), promotionRuleValueService: bindValue(denied, adapter) };
      const native = new PromotionModuleService(container, { scope: "internal" });
      if (input !== undefined) yield* owner.invoke(() => Reflect.apply(call.commandName === "promotionRegisterUsage" ? native.registerUsage : native.revertUsage,
        native, [input.computedActions, input.registrationContext, shared]));
      else if (graphInput !== undefined) {
        const actual = yield* owner.invoke(() => Reflect.apply(native.listAndCountPromotions, native, [graphInput.filters, graphInput.config, shared]))
          .pipe(Effect.flatMap(value => Effect.fromResult(captureNativeNumericDto(value))));
        if (!jsonEqual(actual, yield* Effect.fromResult(decodeGraphCount(call.result)))) return yield* Effect.fail(mismatch("graph-result"));
      }
      if (cursor !== activity.relationalReads.length || mutationCursor !== activity.mutations.length || !jsonEqual(emitted, call.events) ||
        activity.observedRows.some(observed => !usedTables.has(observed.table) && !seen.has(observed.table + ":" + tupleKey(observed.row, entities.get(observed.table)?.primary ?? []))))
        return yield* Effect.fail(mismatch("completion"));
    }));
  }, Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => error.reason === "receiptMismatch"
    ? error : commerceError("receiptMismatch", error)))));
  return { capture, validateLogicalCall };
}
