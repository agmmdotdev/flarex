import { Effect, Option, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlateScalarCreateReceipt } from "../../repository/scalar-create-receipt";
import { matchesPublicRow, orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import { ShippingProfilePhysicalDeletionIds, decodeShippingProfileCreates, decodeShippingProfilePhysicalDeletionIds,
  type compileShippingProfileCreationContracts } from "./shipping-profile-create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileShippingProfileCreationContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeValidationWhere = commerceDecoder(Schema.Struct({ id: ShippingProfilePhysicalDeletionIds }), "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT), object: Schema.Literal("shipping_profile"),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);

/** The full created result, native defaults, ordered row attempts and module
 * messages must agree. The physical inverse authenticates its genuine validation read,
 * complete historical roots and timestamp-preserving terminal detach intents.
 * Actual native validation owns active Option refusal. */
export function shippingProfileCreationPolicy(contracts: Contracts) {
  const capture = Effect.fn("ShippingProfile.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT,
      objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingProfile.validateCall")(function* (call, activity) {
    const creating = call.commandName === "shippingProfileCreateForWorkflow";
    if (!creating && call.commandName !== "shippingProfilePhysicalDeleteForWorkflow" || call.mode !== "write" ||
      activity.lifecycle.length || creating && activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const expectedEvents: string[] = [];
    if (creating) {
      const inputs = yield* Effect.fromResult(decodeShippingProfileCreates(call.input))
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
          mutation.ordinal !== ordinal || mutation.operation !== "insert" || mutation.table !== contracts.profile.name ||
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
      const observed = new Set<string>();
      for (const observation of activity.observedRows) {
        const row = typeof observation.row.id === "string" ? inserted.get(observation.row.id) : undefined;
        if (observation.table !== contracts.profile.name || row === undefined ||
          !jsonEqual(projectNativeRow(observation.row), projectNativeRow(row)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        observed.add(String(row.id));
      }
      if (observed.size !== inserted.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    } else {
      if (call.result !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
      const rawIds = yield* Effect.fromResult(decodeShippingProfilePhysicalDeletionIds(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const requested = new Set(rawIds), observed = new Map<string, JsonObject & { readonly id: string }>();
      const options = new Map<string, JsonObject & { readonly id: string }>();
      const record = Effect.fn("ShippingProfile.observePhysicalInverse")(function* (table: string, value: JsonObject) {
        const decode = table === contracts.profile.name ? contracts.decodeProfileRow
          : table === contracts.option.name ? contracts.decodeOptionRow : undefined;
        if (decode === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
        const row = yield* Effect.fromResult(decode(projectNativeRow(value)))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const group = table === contracts.profile.name ? observed : options, prior = group.get(row.id);
        if (table === contracts.profile.name && !requested.has(row.id) || prior !== undefined && !jsonEqual(prior, row))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        group.set(row.id, row);
      });
      for (const observation of activity.observedRows) {
        // Deleted Profiles have no final visible row. Their actual delete
        // preimage is separate from a read-only surviving Option observation.
        if (observation.table === contracts.profile.name) return yield* Effect.fail(commerceError("receiptMismatch"));
        yield* record(observation.table, observation.row);
      }
      for (const mutation of activity.mutations) {
        if (mutation.before === null) return yield* Effect.fail(commerceError("receiptMismatch"));
        yield* record(mutation.table, mutation.before);
      }
      if (observed.size > 4 || options.size > 8) return yield* Effect.fail(commerceError("receiptMismatch"));
      const where = yield* Effect.fromResult(decodeValidationWhere(buildQuery({ id: rawIds }).where));
      const active = orderNativeIdRows([...observed.values()].filter(row => row.deleted_at === null), where);
      // Native deletion validates only active Profiles and active Options, then
      // the physical DAL reads the complete historical root selection.
      const expectedReads = [{ table: contracts.profile.name,
        query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in" as const, column: "id", values: where.id }),
        total: observed.size, returned: observed.size }];
      const selection = yield* Effect.fromResult(prepareCommerceRelationPopulation(["shipping_profile_id"], active, ["id"], true, false))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (Option.isSome(selection)) expectedReads.push({ table: contracts.option.name,
        query: commerceRelationReadQuery(defaultCommerceResources, selection.value.predicate), total: 0, returned: 0 });
      if (rawIds.length) expectedReads.push({ table: contracts.profile.name,
        query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: rawIds }),
        total: observed.size, returned: observed.size });
      if (!jsonEqual(activity.relationalReads, expectedReads)) return yield* Effect.fail(commerceError("receiptMismatch"));
      // The genuine active guard cannot succeed with any active attached Option.
      // Historical/other target guard candidates are not invented as mutations;
      // terminal set-null intents authenticate the full history detachment.
      for (const row of options.values()) if (typeof row.shipping_profile_id !== "string" ||
        !active.some(profile => profile.id === row.shipping_profile_id) || row.deleted_at === null)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const pending = new Set(observed.keys());
      for (const [ordinal, mutation] of activity.mutations.entries()) {
        const id = mutation.before?.id;
        if (mutation.ordinal !== ordinal || mutation.operation !== "delete" || mutation.table !== contracts.profile.name ||
          mutation.after !== null || typeof id !== "string" || !pending.delete(id))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        expectedEvents.push(id);
      }
      if (pending.size || activity.setNull.length !== expectedEvents.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const [index, intent] of activity.setNull.entries()) if (intent.sourceTable !== contracts.option.name ||
        intent.sourceColumn !== "shipping_profile_id" || intent.targetTable !== contracts.profile.name || intent.targetColumn !== "id" ||
        intent.targetKey !== expectedEvents[index] || intent.managedUpdate !== "preserve")
        return yield* Effect.fail(commerceError("receiptMismatch"));
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
