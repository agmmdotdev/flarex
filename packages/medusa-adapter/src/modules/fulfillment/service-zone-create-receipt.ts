import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { matchesPublicRow, projectNativeRow } from "../../repository/result";
import { correlatePhysicalGraphReceipt } from "../../repository/physical-graph-receipt";
import { moduleEventDecoder } from "../../module/events";
import { decodeServiceZoneCreates, decodeServiceZonePhysicalDeletionIds, type compileServiceZoneCreationContracts } from "./service-zone-create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileServiceZoneCreationContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT), object: Schema.Literals(["service_zone", "geo_zone"]),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 16))]) }),
}), defaultCommerceResources);

/** Full inserted graph evidence and complete historical inverse reads remain
 * distinct from native module events: physical cascades emit root messages only. */
export function serviceZoneCreationPolicy(contracts: Contracts) {
  const byTable = new Map(contracts.entities.map(entity => [entity.table.name, entity]));
  const capture = Effect.fn("ServiceZoneCreate.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT,
      objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ServiceZoneCreate.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    const creating = call.commandName === "serviceZoneCreateForWorkflow";
    if (!creating && call.commandName !== "serviceZonePhysicalDeleteForWorkflow" || call.mode !== "write" ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const orderedEvents: Array<{ object: string; id: string }> = [];
    if (creating) {
      const inputs = yield* Effect.fromResult(decodeServiceZoneCreates(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const results = yield* Effect.fromResult(contracts.decodeRows(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (inputs.length !== results.length || activity.relationalReads.length) return yield* Effect.fail(mismatch());
      const inserted = new Map<string, JsonObject[]>(), identities = new Set<string>();
      let lastTable = -1;
      for (const [ordinal, mutation] of activity.mutations.entries()) {
        const entity = byTable.get(mutation.table), row = mutation.after;
        const position = [contracts.zone.name, contracts.geo.name].indexOf(mutation.table);
        if (entity === undefined || position < 0 || position < lastTable || mutation.ordinal !== ordinal || mutation.operation !== "insert" ||
          mutation.before !== null || row === null || typeof row.id !== "string" || identities.has(mutation.table + ":" + row.id) || mutation.deletedReference !== undefined)
          return yield* Effect.fail(mismatch());
        lastTable = position; identities.add(mutation.table + ":" + row.id);
        const decoded = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(row))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (decoded.deleted_at !== null || decoded.created_at !== decoded.updated_at) return yield* Effect.fail(mismatch());
        const group = inserted.get(mutation.table) ?? []; group.push(row); inserted.set(mutation.table, group);
        if (group.length > entity.maximum) return yield* Effect.fail(mismatch());
      }
      for (const observation of activity.observedRows) {
        const selected = inserted.get(observation.table)?.find(row => row.id === observation.row.id);
        if (selected === undefined || !jsonEqual(projectNativeRow(observation.row), projectNativeRow(selected)))
          return yield* Effect.fail(mismatch());
      }
      const roots = inserted.get(contracts.zone.name) ?? [], children = inserted.get(contracts.geo.name) ?? [];
      if (roots.length !== inputs.length) return yield* Effect.fail(mismatch());
      const matched = new Set<string>();
      for (const [index, input] of inputs.entries()) {
        const row = roots[index], result = results[index];
        if (row === undefined || result === undefined || typeof row.id !== "string") return yield* Effect.fail(mismatch());
        const { geo_zones: requests = [], ...supplied } = input;
        const { geo_zones, shipping_options, ...scalar } = result;
        if (!matchesPublicRow(row, scalar) || !Array.isArray(geo_zones) || !Array.isArray(shipping_options) || shipping_options.length)
          return yield* Effect.fail(mismatch());
        const expected: JsonObject = { ...contracts.defaults.get(contracts.zone.name), ...supplied };
        for (const [field, value] of Object.entries(expected)) if (row[field] === undefined || !jsonEqual(row[field], value))
          return yield* Effect.fail(mismatch());
        orderedEvents.push({ object: contracts.zone.name, id: row.id });
        const members = children.filter(child => child.service_zone_id === row.id);
        if (members.length !== requests.length || members.length !== geo_zones.length) return yield* Effect.fail(mismatch());
        for (const [childIndex, request] of requests.entries()) {
          const child = members[childIndex], returned = geo_zones[childIndex];
          if (child === undefined || typeof child.id !== "string" || returned === null || typeof returned !== "object" || Array.isArray(returned) ||
            !matchesPublicRow(child, returned)) return yield* Effect.fail(mismatch());
          const expected: JsonObject = { ...contracts.defaults.get(contracts.geo.name), ...request, service_zone_id: row.id };
          for (const [field, value] of Object.entries(expected)) if (child[field] === undefined || !jsonEqual(child[field], value))
            return yield* Effect.fail(mismatch());
          matched.add(child.id); orderedEvents.push({ object: contracts.geo.name, id: child.id });
        }
      }
      if (matched.size !== children.length) return yield* Effect.fail(mismatch());
    } else {
      if (call.result !== null) return yield* Effect.fail(mismatch());
      const rawIds = yield* Effect.fromResult(decodeServiceZonePhysicalDeletionIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const rootIds = yield* Effect.fromResult(correlatePhysicalGraphReceipt({ tables: contracts.tables,
        entities: contracts.entities, root: contracts.zone, requestedIds: rawIds, activity, referenceDetachments: contracts.referenceDetachments }));
      for (const id of rootIds) orderedEvents.push({ object: contracts.zone.name, id });
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== (creating ? "created" : "deleted")) return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = orderedEvents[emitted++];
        if (expected === undefined || expected.object !== message.metadata.object || expected.id !== id)
          return yield* Effect.fail(mismatch());
      }
    }
    if (emitted !== orderedEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}
