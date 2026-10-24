import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlateLifecycleGraphReceipt } from "../../repository/lifecycle-graph-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import { TaxId } from "./query";
import { decodeTaxRateDeletionIds, type compileTaxRateDeletionContracts } from "./rate-delete-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileTaxRateDeletionContracts>>;
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.TAX), object: Schema.Literals(["tax_rate", "tax_rate_rule"]),
    action: Schema.Literals(["deleted", "updated"]) }),
  data: Schema.Struct({ id: Schema.Union([TaxId, Schema.Array(TaxId).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);

/** Authenticate the distinct active-forward and historical-inverse selections,
 * complete current Rule closure and approved Rate/parent-Rule ID ordering.
 * Shared graph correlation owns managed transitions and unchanged restores. */
export function taxRateDeletionPolicy(contracts: Contracts) {
  const byTable = new Map(contracts.entities.map(entity => [entity.table.name, entity]));
  const capture = Effect.fn("TaxRateDeletion.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.TAX, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("TaxRateDeletion.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    const operation = call.commandName === "taxRateSoftDeleteForWorkflow" ? "softDelete"
      : call.commandName === "taxRateRestoreForWorkflow" ? "restore" : undefined;
    if (operation === undefined || call.mode !== "write" || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const ids = yield* Effect.fromResult(decodeTaxRateDeletionIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const result = yield* Effect.fromResult(contracts.decodeOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const evidence = new Map<string, Map<string, JsonObject>>(), observed = new Map<string, JsonObject>();
    const key = (table: string, id: string) => JSON.stringify([table, id]);
    const record = Effect.fn("TaxRateDeletion.observeRow")(function* (table: string, value: JsonObject, overwrite = false) {
      const entity = byTable.get(table), support = table === contracts.region.name;
      const decodeRow = support ? contracts.decodeRegionRow : entity?.decodeRow, maximum = support ? 2 : entity?.maximum;
      if (decodeRow === undefined || maximum === undefined) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(decodeRow(projectNativeRow(value)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string" || table === contracts.rate.name && !ids.includes(row.id))
        return yield* Effect.fail(mismatch());
      const group = evidence.get(table) ?? new Map<string, JsonObject>(), prior = group.get(row.id);
      if (!overwrite && prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
      group.set(row.id, row); evidence.set(table, group);
      if (group.size > maximum) return yield* Effect.fail(mismatch());
      return row;
    });
    for (const observation of activity.observedRows) {
      const row = yield* record(observation.table, observation.row);
      observed.set(key(observation.table, String(row.id)), row);
    }
    // Complete current observations remain authoritative. Restore each first
    // preimage separately so event classification sees real historical state.
    const preimages = new Set<string>(), finalMutations = new Map<string, typeof activity.mutations[number]>();
    for (const mutation of activity.mutations) {
      if (!byTable.has(mutation.table) || mutation.before === null || typeof mutation.before.id !== "string")
        return yield* Effect.fail(mismatch());
      const identity = key(mutation.table, mutation.before.id);
      if (!preimages.has(identity)) { preimages.add(identity); yield* record(mutation.table, mutation.before, true); }
      finalMutations.set(identity, mutation);
    }
    for (const [identity, mutation] of finalMutations) {
      const entity = byTable.get(mutation.table), actual = observed.get(identity);
      if (entity === undefined || actual === undefined || mutation.after === null) return yield* Effect.fail(mismatch());
      const after = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(mutation.after)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (!jsonEqual(actual, after)) return yield* Effect.fail(mismatch());
    }
    for (const transition of activity.lifecycle) if (transition.attemptOrdinal === null && transition.rowAtOperation !== null) {
      const row = yield* record(transition.table, transition.rowAtOperation);
      const actual = observed.get(key(transition.table, String(row.id)));
      if (actual !== undefined && !jsonEqual(actual, row)) return yield* Effect.fail(mismatch());
    }
    const candidateRows: Array<JsonObject & Readonly<{ id: string }>> =
      [...evidence.get(contracts.rate.name)?.entries() ?? []].map(([id, row]) => ({ ...row, id }));
    // Indexed point dependencies observe complete candidates before applying
    // deleted_at. Keep every body/identity authenticated, then reconstruct the
    // actual query result from its command prestate, as for Tax update reads.
    for (const row of candidateRows) if (typeof row.tax_region_id !== "string") return yield* Effect.fail(mismatch());
    const candidates = orderNativeIdRows(candidateRows.filter(row => operation === "restore" || row.deleted_at === null), {});
    const regionIds = new Set<string>();
    for (const row of candidates) {
      if (typeof row.tax_region_id !== "string") return yield* Effect.fail(mismatch());
      regionIds.add(row.tax_region_id);
    }
    if (regionIds.size > 2) return yield* Effect.fail(mismatch());
    const regions = evidence.get(contracts.region.name) ?? new Map<string, JsonObject>();
    for (const id of regions.keys()) if (!regionIds.has(id)) return yield* Effect.fail(mismatch());
    const visibleRegionIds = new Set([...regions].filter(([, row]) => operation === "restore" || row.deleted_at === null).map(([id]) => id));
    const roots = candidates.filter(row => typeof row.tax_region_id === "string" && visibleRegionIds.has(row.tax_region_id));
    const rootIds = new Set(roots.map(row => row.id)), selected = new Map<string, Set<string>>([[contracts.rate.name, rootIds]]);
    const ordered = new Map<string, string[]>([[contracts.rate.name, roots.map(row => row.id)]]), reads: JsonObject[] = [];
    const ratePredicate: JsonObject = { kind: "in", column: "id", values: ids };
    if (ids.length) reads.push({ table: contracts.rate.name,
      query: commerceRelationReadQuery(defaultCommerceResources, operation === "restore" ? ratePredicate
        : { kind: "and", children: [ratePredicate, { kind: "isNull", column: "deleted_at" }] }), total: candidates.length, returned: candidates.length });
    const regionPredicate: JsonObject = { kind: "in", column: "id", values: [...regionIds] };
    if (candidates.length) reads.push({ table: contracts.region.name,
      query: commerceRelationReadQuery(defaultCommerceResources, operation === "restore" ? regionPredicate
        : { kind: "and", children: [regionPredicate, { kind: "isNull", column: "deleted_at" }] }), total: visibleRegionIds.size, returned: visibleRegionIds.size });
    const childIds: string[] = [];
    for (const root of roots) {
      const children = orderNativeIdRows([...evidence.get(contracts.rule.name)?.entries() ?? []]
        .filter(([, row]) => row.tax_rate_id === root.id).map(([id, row]) => ({ ...row, id })), {});
      reads.push({ table: contracts.rule.name,
        query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "tax_rate_id", values: [root.id] }),
        total: children.length, returned: children.length });
      childIds.push(...children.map(row => row.id));
    }
    const children = new Set(childIds);
    if ([...evidence.get(contracts.rule.name)?.keys() ?? []].some(id => !children.has(id))) return yield* Effect.fail(mismatch());
    selected.set(contracts.rule.name, children); ordered.set(contracts.rule.name, childIds);
    if (!jsonEqual(activity.relationalReads, reads)) return yield* Effect.fail(mismatch());
    const expectedLifecycle = contracts.entities.flatMap(entity => (ordered.get(entity.table.name) ?? []).map(id => ({ table: entity.table.name, id })));
    const actualLifecycle: Array<{ table: string; id: string }> = [];
    for (const transition of activity.lifecycle) {
      const id = transition.key.id;
      if (typeof id !== "string") return yield* Effect.fail(mismatch());
      actualLifecycle.push({ table: transition.table, id });
    }
    if (!jsonEqual(actualLifecycle, expectedLifecycle)) return yield* Effect.fail(mismatch());
    yield* Effect.fromResult(correlateLifecycleGraphReceipt({ entities: contracts.entities, rootTable: contracts.rate.name,
      operation, selectedRootIds: rootIds, activity, evidence, selected, result }));
    if (operation === "restore") {
      if (call.events.length) return yield* Effect.fail(mismatch());
      return;
    }
    const expected = expectedLifecycle.map(item => ({ ...item,
      action: evidence.get(item.table)?.get(item.id)?.deleted_at === null ? "deleted" : "updated" }));
    if (call.events.length !== expected.length) return yield* Effect.fail(mismatch());
    for (const [index, event] of call.events.entries()) {
      const message = yield* capture(event), item = expected[index];
      if (typeof message.data.id !== "string" || item === undefined || item.table !== message.metadata.object ||
        item.id !== message.data.id || item.action !== message.metadata.action) return yield* Effect.fail(mismatch());
    }
  });
  return { capture, validateLogicalCall };
}
