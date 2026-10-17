import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlateLifecycleGraphReceipt } from "../../repository/lifecycle-graph-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import { decodeServiceZoneDeletionIds, type compileServiceZoneDeletionContracts } from "./service-zone-delete-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileServiceZoneDeletionContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT),
    object: Schema.Literals(["service_zone", "geo_zone", "shipping_option", "shipping_option_rule"]), action: Schema.Literals(["deleted", "restored"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 16))]) }),
}), defaultCommerceResources);

/** Raw-ID lifecycle follows complete history through the checked two-level
 * graph. Native maps/events describe actual affected rows, never raw requests. */
export function serviceZoneDeletionPolicy(contracts: Contracts) {
  const byTable = new Map(contracts.entities.map(entity => [entity.table.name, entity]));
  const capture = Effect.fn("ServiceZoneDelete.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ServiceZoneDelete.validateCall")(function* (call, activity) {
    const operation = call.commandName === "serviceZoneSoftDeleteForWorkflow" ? "softDelete"
      : call.commandName === "serviceZoneRestoreForWorkflow" ? "restore" : undefined;
    if (operation === undefined || call.mode !== "write" || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const rawIds = yield* Effect.fromResult(decodeServiceZoneDeletionIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const result = yield* Effect.fromResult(contracts.decodeOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const evidence = new Map<string, Map<string, JsonObject>>();
    const record = Effect.fn("ServiceZoneDelete.observeRow")(function* (table: string, input: JsonObject, overwrite = false) {
      const entity = byTable.get(table);
      if (entity === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(input))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string" || table === contracts.zone.name && !rawIds.includes(row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const group = evidence.get(table) ?? new Map<string, JsonObject>(), prior = group.get(row.id);
      if (!overwrite && prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(commerceError("receiptMismatch"));
      group.set(row.id, row); evidence.set(table, group);
      if (group.size > entity.maximum) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
    for (const observation of activity.observedRows) yield* record(observation.table, observation.row);
    // Observations may carry the final pending value. First mutation preimages
    // retain each row's actual state before this native lifecycle invocation.
    const preimages = new Set<string>();
    for (const mutation of activity.mutations) {
      if (mutation.before === null || typeof mutation.before.id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
      const identity = mutation.table + ":" + mutation.before.id;
      if (!preimages.has(identity)) { preimages.add(identity); yield* record(mutation.table, mutation.before, true); }
    }
    const physicalRoots: Array<JsonObject & { readonly id: string }> =
      [...evidence.get(contracts.zone.name)?.entries() ?? []].map(([id, row]) => ({ ...row, id }));
    const roots = orderNativeIdRows(physicalRoots.filter(row => operation === "restore" || row.deleted_at === null), {});
    const rootIds = new Set(roots.map(row => row.id)), selected = new Map<string, Set<string>>([[contracts.zone.name, rootIds]]);
    for (const entity of contracts.entities.slice(1)) {
      const parentTable = entity.table === contracts.rule ? contracts.option.name : contracts.zone.name;
      const foreignKey = entity.table === contracts.rule ? "shipping_option_id" : "service_zone_id";
      const parents = selected.get(parentTable), ids = new Set<string>();
      for (const [id, row] of evidence.get(entity.table.name) ?? []) {
        if (typeof row[foreignKey] !== "string" || !parents?.has(row[foreignKey])) return yield* Effect.fail(commerceError("receiptMismatch"));
        ids.add(id);
      }
      selected.set(entity.table.name, ids);
    }
    const expectedReads: JsonObject[] = [];
    if (rawIds.length) expectedReads.push({ table: contracts.zone.name,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: rawIds }),
      total: physicalRoots.length, returned: physicalRoots.length });
    const children = (table: string, column: string, parentId: string) => {
      const rows = [...evidence.get(table)?.entries() ?? []].filter(([, row]) => row[column] === parentId).map(([id, row]) => ({ ...row, id }));
      expectedReads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column, values: [parentId] }),
        total: rows.length, returned: rows.length });
      return orderNativeIdRows(rows, {});
    };
    // Declared soft cascades visit geography before Options, then each Option's
    // Rules. FK-oriented write ordering is an independent shared-owner concern.
    for (const root of roots) {
      children(contracts.geo.name, "service_zone_id", root.id);
      for (const option of children(contracts.option.name, "service_zone_id", root.id))
        children(contracts.rule.name, "shipping_option_id", option.id);
    }
    if (!jsonEqual(activity.relationalReads, expectedReads)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const { ordered } = yield* Effect.fromResult(correlateLifecycleGraphReceipt({ entities: contracts.entities, rootTable: contracts.zone.name,
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
