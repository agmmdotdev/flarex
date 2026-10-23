import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { prepareUpdateMetadata } from "@medusajs/utils/modules-sdk/prepare-update-metadata";
import { assignNativeJsonObject } from "@medusajs/utils/dal/json-assignment";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { moduleEventDecoder } from "../../module/events";
import { commerceRelationReadQuery } from "../../query/relations";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { TaxId } from "./query";
import { TaxRateUpdateMetadata, decodeTaxRateUpdateInput, decodeTaxRateUpdateRead, decodeTaxRateUpdateUpserts } from "./rate-update-input";
import { taxRuleReplacementPolicy } from "./rule-replacement-receipt";
import type { prepareTaxRateUpdateRepository } from "./rate-update-repository";
import type { prepareTaxRuleReplacementRepository } from "./rule-replacement-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareTaxRateUpdateRepository>>;
type Rules = Result.Result.Success<ReturnType<typeof prepareTaxRuleReplacementRepository>>;
type Row = Result.Result.Success<ReturnType<Prepared["contracts"]["decodeRateRow"]>>;
type RegionRow = Result.Result.Success<ReturnType<Prepared["contracts"]["decodeRegionRow"]>>;
const decodeMetadata = commerceDecoder(TaxRateUpdateMetadata, "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.TAX), object: Schema.Literals(["tax_rate", "tax_rate_rule"]),
    action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([TaxId, Schema.Array(TaxId).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);

/** Authenticate Rate projections, native mutable metadata preparation and
 * immediate DTOs separately from canonical storage. Rule callbacks retain
 * their existing complete read/create/history/physical-inverse policies. */
export function taxRateUpdatePolicy(prepared: Prepared, rules: Rules) {
  const rulePolicy = taxRuleReplacementPolicy(rules), { contracts } = prepared;
  const capture = Effect.fn("TaxRateUpdate.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.TAX, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("TaxRateUpdate.validateCall")(function* (call, activity) {
    if (["taxRuleListForReplacement", "taxRuleCreateForWorkflow", "taxRulePhysicalDeleteForWorkflow", "taxRuleSoftDeleteForWorkflow", "taxRuleRestoreForWorkflow"].includes(call.commandName))
      return yield* rulePolicy.validateLogicalCall(call, activity);
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const initial = new Map<string, Row>(), observations: Row[] = [], regions = new Map<string, RegionRow>();
    for (const observation of activity.observedRows) {
      if (observation.table === contracts.rate.name) {
        const row = yield* Effect.fromResult(contracts.decodeRateRow(projectNativeRow(observation.row)));
        observations.push(row); if (!initial.has(row.id)) initial.set(row.id, row);
      } else if (observation.table === contracts.region.name) {
        const row = yield* Effect.fromResult(contracts.decodeRegionRow(projectNativeRow(observation.row))), previous = regions.get(row.id);
        if (previous !== undefined && !jsonEqual(previous, row)) return yield* Effect.fail(mismatch());
        regions.set(row.id, row);
      } else return yield* Effect.fail(mismatch());
    }
    const mutations: Array<{ readonly before: Row; readonly after: Row; readonly realNormalization?: JsonObject }> = [];
    const changedIds = new Set<string>();
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      if (mutation.ordinal !== ordinal || mutation.table !== contracts.rate.name || mutation.operation !== "patch" ||
        mutation.before === null || mutation.after === null) return yield* Effect.fail(mismatch());
      const before = yield* Effect.fromResult(contracts.decodeRateRow(projectNativeRow(mutation.before)));
      const after = yield* Effect.fromResult(contracts.decodeRateRow(projectNativeRow(mutation.after)));
      if (before.id !== after.id || before.deleted_at !== null || after.deleted_at !== null || changedIds.has(after.id))
        return yield* Effect.fail(mismatch());
      changedIds.add(after.id); initial.set(before.id, before);
      mutations.push({ before, after, ...(mutation.realNormalization === undefined ? {} : { realNormalization: mutation.realNormalization }) });
    }
    if (observations.some(row => {
      const before = initial.get(row.id);
      return (before === undefined || !jsonEqual(row, before)) && !mutations.some(mutation => jsonEqual(row, mutation.after));
    }))
      return yield* Effect.fail(mismatch());
    const select = (filters: JsonObject) => orderNativeIdRows([...initial.values()].filter(row => row.deleted_at === null &&
      Object.entries(filters).every(([name, value]) => {
        const actual = row[name];
        return actual !== undefined && (Array.isArray(value) ? value.includes(actual) : jsonEqual(actual, value));
      })), {});
    const admission = (rows: readonly Row[]) => rows.length <= 4 && new Set(rows.map(row => row.tax_region_id)).size <= 2;
    const read = (filters: JsonObject, config: { readonly select?: readonly string[]; readonly relations?: readonly string[] } = {}) =>
      captureCommerceInput(buildQuery(filters, { order: { id: "ASC" },
        ...(config.select === undefined ? {} : { select: [...config.select] }),
        ...(config.relations === undefined ? {} : { relations: [...config.relations] }),
      })).pipe(Result.flatMap(prepared.query));
    const readReceipt = (plan: Result.Result.Success<ReturnType<typeof read>>, count: number) => ({ table: contracts.rate.name,
      query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: count, returned: count });
    const authenticateRead = Effect.fn("TaxRateUpdate.authenticateRead")(function* (
      filters: JsonObject, config: { readonly select?: readonly string[]; readonly relations?: readonly string[] } = {},
    ) {
      const rawRows = select(filters), plan = yield* Effect.fromResult(read(filters, config));
      const rows = plan.regionFilter && rawRows.length
        ? yield* Effect.fromResult(prepared.filterActiveRegionRates(rawRows, [...regions.values()])) : rawRows;
      const reads = [readReceipt(plan, rawRows.length)];
      if (plan.regionFilter && rawRows.length) {
        const predicate = yield* Effect.fromResult(prepared.regionPredicate(rawRows));
        const count = new Set(rows.map(row => row.tax_region_id)).size;
        reads.push({ table: contracts.region.name, query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: count, returned: count });
      }
      if (!admission(rows) || !jsonEqual(activity.relationalReads, reads)) return yield* Effect.fail(mismatch());
      return { rows, plan };
    });
    if (call.commandName === "taxRateListForUpdate") {
      if (call.mode !== "read" || mutations.length || call.events.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeTaxRateUpdateRead(call.input));
      const { rows, plan } = yield* authenticateRead(input.filters, input.config);
      const expected = yield* Effect.fromResult(prepared.projectRows(rows, plan));
      const actual = yield* Effect.fromResult(contracts.decodePreimages(call.result));
      if (!jsonEqual(actual, expected)) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "write") return yield* Effect.fail(mismatch());
    const expected: JsonObject[] = [], expectedIds: string[] = [];
    let ordinal = 0;
    const apply = Effect.fn("TaxRateUpdate.authenticatePatch")(function* (before: Row, data: JsonObject) {
      if (!Object.entries(data).some(([name, value]) => {
        const previous = before[name]; return previous === undefined || !jsonEqual(previous, value);
      })) return before;
      const mutation = mutations[ordinal++];
      if (mutation === undefined || !jsonEqual(mutation.before, before) || typeof mutation.after.updated_at !== "string")
        return yield* Effect.fail(mismatch());
      const normalization = mutation.realNormalization;
      const assignment = { ...before, ...data };
      if (normalization !== undefined && (Object.keys(normalization).length !== 1 || normalization.rate === undefined ||
        assignment.rate === undefined || !jsonEqual(normalization.rate, assignment.rate))) return yield* Effect.fail(mismatch());
      // The shared SQL owner authenticates REAL normalization. Here its original
      // complete merged value, including an unchanged Rate, is correlated with
      // this exact native assignment rather than only its sparse patch.
      const presented = { ...mutation.after, ...normalization };
      if (!jsonEqual(presented, { ...assignment, updated_at: mutation.after.updated_at })) return yield* Effect.fail(mismatch());
      expectedIds.push(before.id); return mutation.after;
    });
    if (call.commandName === "taxRateUpdateForWorkflow") {
      const input = yield* Effect.fromResult(decodeTaxRateUpdateInput(call.input));
      const { rows } = yield* authenticateRead(input.selector);
      const update = structuredClone(input.update);
      const pairs = rows.map(row => ({ entity: structuredClone(row), update }));
      // This is the same extracted native preparation invoked by the genuine
      // internal service, including its shared update-object mutation.
      prepareUpdateMetadata(pairs);
      for (const [index, pair] of pairs.entries()) {
        const before = rows[index]; if (before === undefined) return yield* Effect.fail(mismatch());
        const { updated_by, ...data } = pair.update;
        if (data.metadata !== undefined) {
          const current = yield* Effect.fromResult(decodeMetadata(pair.entity.metadata));
          const supplied = yield* Effect.fromResult(decodeMetadata(data.metadata));
          data.metadata = yield* Effect.fromResult(decodeMetadata(assignNativeJsonObject(current, supplied)));
        }
        const after = yield* apply(before, data), presented = data.rate === undefined ? after : { ...after, rate: data.rate };
        expected.push(yield* Effect.fromResult(contracts.present(presented, updated_by)));
      }
      const actual = yield* Effect.fromResult(contracts.decodeRows(call.result));
      if (!jsonEqual(actual, expected)) return yield* Effect.fail(mismatch());
    } else if (call.commandName === "taxRateUpsertForUpdateInverse") {
      const inputs = yield* Effect.fromResult(decodeTaxRateUpdateUpserts(call.input));
      const filters = { id: inputs.map(row => row.id) }, rows = inputs.length ? (yield* authenticateRead(filters)).rows : [];
      if (rows.length !== inputs.length || !inputs.length && activity.relationalReads.length) return yield* Effect.fail(mismatch());
      const byId = new Map(rows.map(row => [row.id, row]));
      const preimages = yield* Effect.fromResult(contracts.decodePreimages(inputs));
      for (const input of preimages) {
        const before = byId.get(input.id); if (before === undefined) return yield* Effect.fail(mismatch());
        const { id: _id, tax_region, ...data } = input;
        const after = yield* apply(before, data), presented = data.rate === undefined ? after : { ...after, rate: data.rate };
        expected.push(yield* Effect.fromResult(contracts.present(presented, undefined, tax_region !== undefined)));
      }
      const actual = yield* Effect.fromResult(contracts.decodeUpsertRows(call.result));
      if (!jsonEqual(actual, expected)) return yield* Effect.fail(mismatch());
    } else return yield* Effect.fail(mismatch());
    if (ordinal !== mutations.length) return yield* Effect.fail(mismatch());
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.object !== "tax_rate" || message.metadata.action !== "updated") return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (expectedIds[emitted++] !== id) return yield* Effect.fail(mismatch());
    }
    if (emitted !== expectedIds.length) return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall, allowStorageInsertionOrder: true as const };
}
