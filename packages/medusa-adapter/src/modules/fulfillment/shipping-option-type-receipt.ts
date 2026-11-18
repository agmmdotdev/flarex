import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlateScalarCreateReceipt } from "../../repository/scalar-create-receipt";
import { matchesPublicRow, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import { decodeShippingOptionTypeCreates, decodeShippingOptionTypePhysicalDeletionIds,
  type compileShippingOptionTypeCreationContracts } from "./shipping-option-type-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileShippingOptionTypeCreationContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT), object: Schema.Literal("shipping_option_type"),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);

/** The full created result, native defaults, ordered row attempts and module
 * messages must agree. The physical inverse authenticates its complete actual
 * historical read; no Type-only success can hide sibling changes or a skipped
 * repository operation. Shared FK enforcement owns referenced-row refusal. */
export function shippingOptionTypeCreationPolicy(contracts: Contracts) {
  const capture = Effect.fn("ShippingOptionType.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT,
      objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingOptionType.validateCall")(function* (call, activity) {
    const creating = call.commandName === "shippingOptionTypeCreateForWorkflow";
    if (!creating && call.commandName !== "shippingOptionTypePhysicalDeleteForWorkflow" || call.mode !== "write" ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const expectedEvents: string[] = [];
    if (creating) {
      const inputs = yield* Effect.fromResult(decodeShippingOptionTypeCreates(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const results = yield* Effect.fromResult(contracts.decodeRows(call.result))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const cohort = yield* Effect.fromResult(correlateScalarCreateReceipt(inputs, results));
      if (cohort.inputs.length !== activity.mutations.length || activity.relationalReads.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const inserted = new Map<string, JsonObject>();
      for (const [ordinal, input] of cohort.inputs.entries()) {
        const mutation = activity.mutations[ordinal], result = cohort.results[ordinal], row = mutation?.after;
        if (mutation === undefined || result === undefined || row === null || row === undefined ||
          mutation.ordinal !== ordinal || mutation.operation !== "insert" || mutation.table !== contracts.table.name ||
          mutation.before !== null || typeof row.id !== "string" || inserted.has(row.id))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const stored = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const { shipping_options, ...scalar } = result;
        if (!matchesPublicRow(row, scalar) || shipping_options.length || stored.deleted_at !== null || stored.created_at !== stored.updated_at)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const expected: JsonObject = { ...contracts.defaults, ...input };
        for (const [field, value] of Object.entries(expected)) if (stored[field] === undefined || !jsonEqual(stored[field], value))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        inserted.set(row.id, row); expectedEvents.push(row.id);
      }
      for (const observation of activity.observedRows) {
        const row = typeof observation.row.id === "string" ? inserted.get(observation.row.id) : undefined;
        if (observation.table !== contracts.table.name || row === undefined ||
          !jsonEqual(projectNativeRow(observation.row), projectNativeRow(row)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    } else {
      if (call.result !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
      const rawIds = yield* Effect.fromResult(decodeShippingOptionTypePhysicalDeletionIds(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const requested = new Set(rawIds), observed = new Map<string, JsonObject>();
      const record = Effect.fn("ShippingOptionType.observePhysicalInverse")(function* (table: string, value: JsonObject) {
        if (table !== contracts.table.name) return yield* Effect.fail(commerceError("receiptMismatch"));
        const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(value)))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const prior = observed.get(row.id);
        if (!requested.has(row.id) || prior !== undefined && !jsonEqual(prior, row))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        observed.set(row.id, row);
      });
      for (const observation of activity.observedRows) yield* record(observation.table, observation.row);
      for (const mutation of activity.mutations) {
        if (mutation.before === null) return yield* Effect.fail(commerceError("receiptMismatch"));
        yield* record(mutation.table, mutation.before);
      }
      if (observed.size > 4) return yield* Effect.fail(commerceError("receiptMismatch"));
      const expectedReads = rawIds.length ? [{ table: contracts.table.name,
        query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: rawIds }),
        total: observed.size, returned: observed.size }] : [];
      if (!jsonEqual(activity.relationalReads, expectedReads)) return yield* Effect.fail(commerceError("receiptMismatch"));
      const pending = new Set(observed.keys());
      for (const [ordinal, mutation] of activity.mutations.entries()) {
        const id = mutation.before?.id;
        if (mutation.ordinal !== ordinal || mutation.operation !== "delete" || mutation.table !== contracts.table.name ||
          mutation.after !== null || typeof id !== "string" || !pending.delete(id))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        expectedEvents.push(id);
      }
      if (pending.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== (creating ? "created" : "deleted")) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        if (expectedEvents[emitted++] !== id) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}
