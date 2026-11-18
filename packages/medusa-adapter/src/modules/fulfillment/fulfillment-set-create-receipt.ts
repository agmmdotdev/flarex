import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { matchesPublicRow, projectNativeRow } from "../../repository/result";
import { correlatePhysicalGraphReceipt } from "../../repository/physical-graph-receipt";
import { moduleEventDecoder } from "../../module/events";
import { decodeFulfillmentSetCreates, decodeFulfillmentSetPhysicalDeletionIds,
  type compileFulfillmentSetCreationContracts } from "./fulfillment-set-create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileFulfillmentSetCreationContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT), object: Schema.Literal("fulfillment_set"),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 1))]) }),
}), defaultCommerceResources);

export function fulfillmentSetCreationPolicy(contracts: Contracts) {
  const capture = Effect.fn("FulfillmentSetCreate.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT,
      objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("FulfillmentSetCreate.validateCall")(function* (call, activity) {
    const creating = call.commandName === "fulfillmentSetCreateForWorkflow", mismatch = () => commerceError("receiptMismatch");
    if (!creating && call.commandName !== "fulfillmentSetPhysicalDeleteForWorkflow" || call.mode !== "write" ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const expectedEvents: string[] = [];
    if (creating) {
      const inputs = yield* Effect.fromResult(decodeFulfillmentSetCreates(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const output = yield* Effect.fromResult(contracts.decodeRows(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (inputs.length !== output.length || inputs.length !== activity.mutations.length || activity.relationalReads.length)
        return yield* Effect.fail(mismatch());
      const inserted = new Map<string, JsonObject>();
      for (const [ordinal, input] of inputs.entries()) {
        const mutation = activity.mutations[ordinal], result = output[ordinal], row = mutation?.after;
        if (mutation === undefined || result === undefined || row === null || row === undefined || mutation.ordinal !== ordinal ||
          mutation.table !== contracts.set.name || mutation.operation !== "insert" || mutation.before !== null || typeof row.id !== "string" || inserted.has(row.id) || mutation.deletedReference !== undefined)
          return yield* Effect.fail(mismatch());
        const stored = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const { service_zones, ...scalar } = result;
        if (!matchesPublicRow(row, scalar) || service_zones.length || stored.deleted_at !== null || stored.created_at !== stored.updated_at)
          return yield* Effect.fail(mismatch());
        for (const [field, value] of Object.entries({ ...contracts.defaults, ...input })) if (stored[field] === undefined || !jsonEqual(stored[field], value))
          return yield* Effect.fail(mismatch());
        inserted.set(row.id, row); expectedEvents.push(row.id);
      }
      const observed = new Set<string>();
      for (const item of activity.observedRows) {
        const row = typeof item.row.id === "string" ? inserted.get(item.row.id) : undefined;
        if (item.table !== contracts.set.name || row === undefined || !jsonEqual(projectNativeRow(item.row), projectNativeRow(row)))
          return yield* Effect.fail(mismatch());
        observed.add(String(row.id));
      }
      if (observed.size !== inserted.size) return yield* Effect.fail(mismatch());
    } else {
      if (call.result !== null) return yield* Effect.fail(mismatch());
      const ids = yield* Effect.fromResult(decodeFulfillmentSetPhysicalDeletionIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const rootIds = yield* Effect.fromResult(correlatePhysicalGraphReceipt({ tables: contracts.tables,
        entities: contracts.entities, root: contracts.set, requestedIds: ids, activity, referenceDetachments: contracts.referenceDetachments }));
      expectedEvents.push(...rootIds);
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== (creating ? "created" : "deleted")) return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (expectedEvents[emitted++] !== id) return yield* Effect.fail(mismatch());
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}
