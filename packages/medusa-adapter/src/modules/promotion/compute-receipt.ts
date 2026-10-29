import { Effect, Result, Schema } from "effect";
import type { Context, DAL } from "@medusajs/framework/types";
import { Promotion, ApplicationMethod, Campaign, CampaignBudget, CampaignBudgetUsage, PromotionRule, PromotionRuleValue } from "@medusajs/promotion/models";
import { PromotionModuleService } from "@medusajs/promotion/services";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils/portable";
import { tupleKey } from "@medusajs/drizzle/relation-query";
import { isRelationalColumnValue } from "flarex-protocol/internal/relational-schema";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { prepareCommerceInternalService, prepareCommerceModule } from "../../module/persistence";
import { makeCommercePromiseOwner } from "../../module/promise-owner";
import { commerceRelationReadQuery, type CommerceRelationRows } from "../../query/relations";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { decodeGraphCount } from "../../local-graph/query";
import { capturePromotionComputedActions, decodePromotionComputedActions, decodePromotionComputeInput, decodePromotionGraphRead } from "./compute-input";
import { replayPromotionComputeQueryClock } from "./compute-query";
import type { preparePromotionComputeRead } from "./compute-read";

type Prepared = Result.Result.Success<ReturnType<typeof preparePromotionComputeRead>>;
const Instant = Schema.String;
const decodeClockQuery = commerceDecoder(Schema.Struct({ take: Schema.Literal(defaultCommerceResources.queryRows),
  order: Schema.Struct({ column: Schema.Literal("id"), direction: Schema.Literal("asc") }), includeIdentities: Schema.Literal(true),
  predicate: Schema.Struct({ kind: Schema.Literal("and"), children: Schema.Tuple([
    Schema.Struct({ kind: Schema.Literal("isNull"), column: Schema.Literal("deleted_at") }),
    Schema.Struct({ kind: Schema.Literal("or"), children: Schema.Tuple([
      Schema.Struct({ kind: Schema.Literal("isNull"), column: Schema.Literal("starts_at") }),
      Schema.Struct({ kind: Schema.Literal("lessThan"), column: Schema.Literal("starts_at"), value: Instant }),
      Schema.Struct({ kind: Schema.Literal("in"), column: Schema.Literal("starts_at"), values: Schema.Tuple([Instant]) }),
    ]) }),
    Schema.Struct({ kind: Schema.Literal("or"), children: Schema.Tuple([
      Schema.Struct({ kind: Schema.Literal("isNull"), column: Schema.Literal("ends_at") }),
      Schema.Struct({ kind: Schema.Literal("greaterThan"), column: Schema.Literal("ends_at"), value: Instant }),
    ]) }),
  ]) }),
}), "receiptMismatch");
const bindPromotion = prepareCommerceInternalService(Promotion), bindMethod = prepareCommerceInternalService(ApplicationMethod),
  bindCampaign = prepareCommerceInternalService(Campaign), bindBudget = prepareCommerceInternalService(CampaignBudget),
  bindUsage = prepareCommerceInternalService(CampaignBudgetUsage), bindRule = prepareCommerceInternalService(PromotionRule),
  bindValue = prepareCommerceInternalService(PromotionRuleValue);

/** Re-run the genuine calculation against immutable authenticated observations.
 * The proof contains neither persistence nor a manager/settlement capability.
 * PostgreSQL's matched vectors remain authoritative; no predicate is repeated
 * in JavaScript and no cast/error program executes during reconstruction. */
export function promotionComputeReadPolicy(prepared: Prepared) {
  const entities = new Map(prepared.entities.map(entity => [entity.table.name, { ...entity,
    identity: commerceDecoder(Schema.Record(Schema.Literals(entity.primary), Schema.String), "receiptMismatch") }]));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("Promotion.validateComputeCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    const calculation = call.commandName === "promotionComputeActions";
    if (!calculation && call.commandName !== "promotionReadForCart" || call.mode !== "read" || call.events.length || activity.mutations.length ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const input = calculation ? yield* Effect.fromResult(decodePromotionComputeInput(call.input)) : undefined;
    const graphInput = calculation ? undefined : yield* Effect.fromResult(decodePromotionGraphRead(call.input));
    const actual = calculation ? yield* Effect.fromResult(decodePromotionComputedActions(call.result)) : yield* Effect.fromResult(decodeGraphCount(call.result));
    const state = new Map<string, Map<string, JsonObject>>();
    for (const observed of activity.observedRows) {
      const entity = entities.get(observed.table);
      if (entity === undefined) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(entity.complete(projectNativeRow(observed.row))), key = tupleKey(row, entity.primary);
      const rows = state.get(observed.table) ?? new Map(), prior = rows.get(key);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
      rows.set(key, row); state.set(observed.table, rows);
      if (rows.size > defaultCommerceResources.catalogRows) return yield* Effect.fail(mismatch());
    }
    let cursor = 0;
    const used = new Set<string>();
    const select = Effect.fn("Promotion.selectObservedRows")(function* (table: string, query: Json,
      related?: { readonly childTable: string; readonly foreignKeyConstraintId: string }) {
      const entity = entities.get(table), observation = activity.relationalReads[cursor++];
      if (entity === undefined || observation === undefined || observation.table !== table || !jsonEqual(observation.query, query) ||
        !jsonEqual(observation.related ?? null, related ?? null) || observation.orderedIdentities === undefined ||
        observation.total !== observation.returned || observation.returned !== observation.orderedIdentities.length)
        return yield* Effect.fail(mismatch());
      const rows: JsonObject[] = [], keys = new Set<string>();
      for (const identity of observation.orderedIdentities) {
        const decoded = yield* Effect.fromResult(entity.identity(identity)), key = tupleKey(decoded, entity.primary), row = state.get(table)?.get(key);
        if (row === undefined || keys.has(key)) return yield* Effect.fail(mismatch());
        keys.add(key); rows.push(structuredClone(row));
      }
      yield* Effect.fromResult(prepared.admitSelection(table, rows));
      used.add(table);
      return rows;
    });
    const readRows: CommerceRelationRows = (table, predicate, order = "id", options) => select(table,
      commerceRelationReadQuery(defaultCommerceResources, predicate, order, { includeIdentities: true, ...options }));
    const related = Effect.fn("Promotion.selectObservedRelated")(function* (table: string, query: Json) {
      const parent = entities.get(table), child = entities.get("promotion_rule_value");
      if (table !== "promotion_rule" || parent?.primary.length !== 1 || child?.primary.length !== 1)
        return yield* Effect.fail(mismatch());
      const parentColumn = parent.primary[0], childColumn = child.primary[0];
      if (parentColumn === undefined || childColumn === undefined) return yield* Effect.fail(mismatch());
      const parents = yield* select(table, { order: { column: parentColumn, direction: "asc" }, includeIdentities: true });
      yield* select(child.table.name, { order: { column: childColumn, direction: "asc" }, includeIdentities: true });
      const matches = yield* select(table, query, { childTable: child.table.name, foreignKeyConstraintId: prepared.prefilter.foreignKey });
      const cohort = new Set(parents.map(row => tupleKey(row, parent.primary)));
      if (matches.some(row => !cohort.has(tupleKey(row, parent.primary)))) return yield* Effect.fail(mismatch());
      return matches;
    });
    const owner = yield* makeCommercePromiseOwner();
    yield* owner.withClose(Effect.gen(function* () {
      // This token authenticates only proof-local native callback occurrences.
      // It is never asserted to be, or passed as, a persistence manager.
      const token = Object.freeze({}), shared: Context = { manager: token, transactionManager: token };
      const authenticate = (value: unknown) => Effect.try({ try: () => {
        if (value === null || typeof value !== "object" ||
          Object.getOwnPropertyDescriptor(value, "transactionManager")?.value !== token) throw mismatch();
      }, catch: cause => commerceError("receiptMismatch", cause) });
      const prefilter = prepared.prefilter.make((context, value, work) => owner.run(Effect.gen(function* () {
        yield* authenticate(context);
        const captured = yield* Effect.fromResult(captureCommerceInput(value));
        return yield* work({ resources: defaultCommerceResources, rows: (table, predicate, order) => readRows(table, predicate, order), related }, captured);
      })));
      const refuse = (): never => owner.reject(mismatch());
      const denied: DAL.RepositoryService = { getFreshManager: refuse, getActiveManager: refuse, transaction: refuse,
        find: refuse, findAndCount: refuse, serialize: refuse, create: refuse, update: refuse, delete: refuse,
        softDelete: refuse, restore: refuse, upsert: refuse, upsertWithReplace: refuse };
      const issued = new WeakSet<object>();
      const find = (table: "promotion" | "promotion_campaign_budget_usage", value: unknown, context: Parameters<DAL.RepositoryService["find"]>[1]) =>
        owner.run(Effect.gen(function* () {
          yield* authenticate(context);
          let captured: unknown = yield* prepared.captureQuery(value);
          const parsed = yield* Effect.fromResult(prepared.query(table, captured));
          if (parsed.active) {
            const observation = activity.relationalReads[cursor];
            if (observation?.table !== "promotion_campaign") return yield* Effect.fail(mismatch());
            const clock = yield* Effect.fromResult(decodeClockQuery(observation.query)), start = clock.predicate.children[1].children[1].value;
            if (!isRelationalColumnValue("timestamptz", false, start) || start !== clock.predicate.children[1].children[2].values[0] ||
              start !== clock.predicate.children[2].children[1].value) return yield* Effect.fail(mismatch());
            captured = yield* Effect.fromResult(replayPromotionComputeQueryClock(captured, start));
          }
          const result = yield* prepared.read(readRows, table, captured), native = yield* prepared.internal(result.rows, table);
          if (!Array.isArray(native)) return yield* Effect.fail(mismatch());
          issued.add(native);
          return { rows: native, count: result.count, graph: result.parsed.graph };
        }));
      const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(value: unknown, options?: unknown): Promise<Output> => owner.run(Effect.gen(function* () {
        if (options !== undefined || value === null || typeof value !== "object" || !issued.has(value)) return yield* Effect.fail(mismatch());
        // SAFETY: this is the same native DTO ABI over proof-issued entities;
        // all scalar columns and exact numeric companions were checked above.
        return (yield* Effect.fromResult(captureNativeNumericDto(value))) as Output;
      }));
      const promotionRepository: DAL.RepositoryService = { ...denied, serialize, find: async (value, context) => (await find("promotion", value, context)).rows,
        findAndCount: async (value, context) => { const result = await find("promotion", value, context);
          if (!result.graph) return refuse();
          return [result.rows, result.count]; } };
      const usageRepository: DAL.RepositoryService = { ...denied, find: async (value, context) => (await find("promotion_campaign_budget_usage", value, context)).rows };
      const persistence = yield* Effect.fromResult(prepareCommerceModule({ name: "promotion-compute-proof", models: [Promotion,
        ApplicationMethod, Campaign, CampaignBudget, CampaignBudgetUsage, PromotionRule, PromotionRuleValue] }));
      const binding = persistence.bind(owner, { baseRepository: denied, repository: model =>
        model === Promotion ? promotionRepository : model === CampaignBudgetUsage ? usageRepository : denied });
      const adapter = binding.persistence;
      const dependencies = { baseRepository: { ...denied, serialize }, [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]: adapter,
        promotionService: bindPromotion(promotionRepository, adapter), applicationMethodService: bindMethod(denied, adapter),
        campaignService: bindCampaign(denied, adapter), campaignBudgetService: bindBudget(denied, adapter),
        campaignBudgetUsageService: bindUsage(usageRepository, adapter), promotionRuleService: bindRule(denied, adapter),
        promotionRuleValueService: bindValue(denied, adapter) };
      const native = new PromotionModuleService(dependencies, { scope: "internal" }, prefilter);
      const expected = input !== undefined
        ? yield* owner.invoke(() => Reflect.apply(native.computeActions, native, [input.codes, input.context, input.options, shared])).pipe(Effect.flatMap(capturePromotionComputedActions))
        : graphInput !== undefined ? yield* owner.invoke(() => Reflect.apply(native.listAndCountPromotions, native, [graphInput.filters, graphInput.config, shared]))
          .pipe(Effect.flatMap(value => Effect.fromResult(captureNativeNumericDto(value)))) : yield* Effect.fail(mismatch());
      if (cursor !== activity.relationalReads.length || [...state.keys()].some(table => !used.has(table)) || !jsonEqual(expected, actual))
        return yield* Effect.fail(mismatch());
    }));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall };
}
