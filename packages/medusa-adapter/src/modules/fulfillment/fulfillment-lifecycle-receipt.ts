import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlateLifecycleGraphReceipt } from "../../repository/lifecycle-graph-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import type { compileFulfillmentLifecycleGraph } from "./fulfillment-graph-contracts";

type LifecycleGraph = Result.Result.Success<ReturnType<typeof compileFulfillmentLifecycleGraph>>;
type DecodeIds = (input: unknown) => Result.Result<readonly string[], CommerceTransactionError>;
type DecodeOutput = (input: unknown) => Result.Result<Readonly<Record<string, readonly string[] | undefined>>, CommerceTransactionError>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));

/** Raw-ID lifecycle follows complete history through the checked Fulfillment
 * graph. Native maps/events describe actual affected rows, never raw requests. */
export function fulfillmentLifecyclePolicy(contracts: LifecycleGraph & { readonly decodeOutput: DecodeOutput }, commands: {
  readonly softDelete: string; readonly restore: string; readonly decodeIds: DecodeIds;
}) {
  const byTable = new Map(contracts.entities.map(entity => [entity.table.name, entity]));
  const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT),
      object: Schema.Literals(contracts.entities.map(entity => entity.table.name)), action: Schema.Literals(["deleted", "restored"]) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 16))]) }),
  }), defaultCommerceResources);
  const capture = Effect.fn("FulfillmentLifecycle.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("FulfillmentLifecycle.validateCall")(function* (call, activity) {
    const operation = call.commandName === commands.softDelete ? "softDelete"
      : call.commandName === commands.restore ? "restore" : undefined;
    if (operation === undefined || call.mode !== "write" || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const rawIds = yield* Effect.fromResult(commands.decodeIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const result = yield* Effect.fromResult(contracts.decodeOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const evidence = new Map<string, Map<string, JsonObject>>();
    const observed = new Map<string, JsonObject>();
    const record = Effect.fn("FulfillmentLifecycle.observeRow")(function* (table: string, input: JsonObject, overwrite = false) {
      const entity = byTable.get(table);
      if (entity === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(input))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string" || table === contracts.root.name && !rawIds.includes(row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const group = evidence.get(table) ?? new Map<string, JsonObject>(), prior = group.get(row.id);
      if (!overwrite && prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(commerceError("receiptMismatch"));
      group.set(row.id, row); evidence.set(table, group);
      if (group.size > entity.maximum) return yield* Effect.fail(commerceError("receiptMismatch"));
      return row;
    });
    for (const observation of activity.observedRows) {
      const row = yield* record(observation.table, observation.row);
      observed.set(observation.table + ":" + String(row.id), row);
    }
    // Observations may carry the final pending value. First mutation preimages
    // retain each row's actual state before this native lifecycle invocation.
    const preimages = new Set<string>();
    const finalMutations = new Map<string, typeof activity.mutations[number]>();
    for (const mutation of activity.mutations) {
      if (mutation.before === null || typeof mutation.before.id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
      const identity = mutation.table + ":" + mutation.before.id;
      if (!preimages.has(identity)) { preimages.add(identity); yield* record(mutation.table, mutation.before, true); }
      finalMutations.set(identity, mutation);
    }
    // Core activity exposes current visible rows, including identities written
    // since the call cursor. Planning preimages cannot replace that evidence.
    // Track the last mutation so repeated writes still authenticate the final row.
    for (const [identity, mutation] of finalMutations) {
      const entity = byTable.get(mutation.table), actual = observed.get(identity);
      if (entity === undefined || actual === undefined || mutation.after === null)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const after = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(mutation.after)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (!jsonEqual(actual, after)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    const physicalRoots: Array<JsonObject & { readonly id: string }> =
      [...evidence.get(contracts.root.name)?.entries() ?? []].map(([id, row]) => ({ ...row, id }));
    const roots = orderNativeIdRows(physicalRoots.filter(row => operation === "restore" || row.deleted_at === null), {});
    const rootIds = new Set(roots.map(row => row.id)), selected = new Map<string, Set<string>>([[contracts.root.name, rootIds]]);
    for (const entity of contracts.entities.slice(1)) {
      const parentTable = entity.table === contracts.zone ? contracts.set.name : entity.table === contracts.rule ? contracts.option.name : contracts.zone.name;
      const foreignKey = entity.table === contracts.zone ? "fulfillment_set_id" : entity.table === contracts.rule ? "shipping_option_id" : "service_zone_id";
      const parents = selected.get(parentTable), ids = new Set<string>();
      for (const [id, row] of evidence.get(entity.table.name) ?? []) {
        if (typeof row[foreignKey] !== "string" || !parents?.has(row[foreignKey])) return yield* Effect.fail(commerceError("receiptMismatch"));
        ids.add(id);
      }
      selected.set(entity.table.name, ids);
    }
    const expectedReads: JsonObject[] = [];
    if (rawIds.length) expectedReads.push({ table: contracts.root.name,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: rawIds }),
      total: physicalRoots.length, returned: physicalRoots.length });
    const children = (table: string, column: string, parentId: string) => {
      const rows = [...evidence.get(table)?.entries() ?? []].filter(([, row]) => row[column] === parentId).map(([id, row]) => ({ ...row, id }));
      expectedReads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column, values: [parentId] }),
        total: rows.length, returned: rows.length });
      return orderNativeIdRows(rows, {});
    };
    // These checked Fulfillment edges follow the declared cascade traversal;
    // FK-oriented write ordering remains an independent shared-owner concern.
    const zoneChildren = (zoneId: string) => {
      children(contracts.geo.name, "service_zone_id", zoneId);
      for (const option of children(contracts.option.name, "service_zone_id", zoneId))
        children(contracts.rule.name, "shipping_option_id", option.id);
    };
    for (const root of roots) {
      if (contracts.root === contracts.set) for (const zone of children(contracts.zone.name, "fulfillment_set_id", root.id)) zoneChildren(zone.id);
      else if (contracts.root === contracts.option) children(contracts.rule.name, "shipping_option_id", root.id);
      else zoneChildren(root.id);
    }
    if (!jsonEqual(activity.relationalReads, expectedReads)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const { ordered } = yield* Effect.fromResult(correlateLifecycleGraphReceipt({ entities: contracts.entities, rootTable: contracts.root.name,
      operation, activeRestoreUpdates: true, activity, evidence, selected, result }));
    const expectedEvents = contracts.entities.flatMap(entity => (ordered.get(entity.table.name) ?? []).map(id => ({ object: entity.table.name, id })));
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== (operation === "softDelete" ? "deleted" : "restored")) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = expectedEvents[emitted++];
        if (expected === undefined || expected.object !== message.metadata.object || expected.id !== id) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall, allowActiveRestoreUpdate: true as const };
}
