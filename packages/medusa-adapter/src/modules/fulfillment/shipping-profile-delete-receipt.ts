import { Effect, Option, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import type { compileShippingProfileDeletionContracts } from "./shipping-profile-delete-input";
import { ShippingProfileDeletionIds, decodeShippingProfileDeletionIds } from "./shipping-profile-delete-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileShippingProfileDeletionContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeValidationWhere = commerceDecoder(Schema.Struct({ id: ShippingProfileDeletionIds }), "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT),
    object: Schema.Literal("shipping_profile"),
    action: Schema.Literals([CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(4))]) }),
}), defaultCommerceResources);

/** Root lifecycle receipts retain the genuine validation's complete Option
 * observations. Successful soft deletion must have no active Option on an
 * active selected root; restore deliberately skips that native business guard.
 * All Option and parent writes remain outside this profile. */
export function shippingProfileDeletionPolicy(contracts: Contracts) {
  const capture = Effect.fn("ShippingProfileEvents.captureLifecycle")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT,
      objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const byTable = new Map(contracts.entities.map(entity => [entity.table.name, entity]));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingProfileEvents.validateLifecycleCall")(function* (call, activity) {
    const operation = call.commandName === "shippingProfileSoftDeleteForWorkflow" ? "softDelete"
      : call.commandName === "shippingProfileRestoreForWorkflow" ? "restore" : undefined;
    if (operation === undefined || call.mode !== "write" || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const rawIds = yield* Effect.fromResult(decodeShippingProfileDeletionIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const requested = new Set(rawIds);
    const result = yield* Effect.fromResult(contracts.decodeOutput(call.result))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const evidence = new Map<string, Map<string, JsonObject>>();
    const record = Effect.fn("ShippingProfileEvents.observeLifecycleRow")(function* (table: string, value: JsonObject) {
      const entity = byTable.get(table);
      if (entity === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(value)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string" || entity.table === contracts.profile && !requested.has(row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const rows = evidence.get(table) ?? new Map<string, JsonObject>();
      rows.set(row.id, row); evidence.set(table, rows);
    });
    const optionRows = new Map<string, Result.Result.Success<ReturnType<Contracts["decodeOptionRow"]>>>();
    for (const observation of activity.observedRows) {
      if (observation.table === contracts.option.name) {
        if (operation !== "softDelete") return yield* Effect.fail(commerceError("receiptMismatch"));
        const row = yield* Effect.fromResult(contracts.decodeOptionRow(projectNativeRow(observation.row)))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        optionRows.set(row.id, row);
      } else yield* record(observation.table, observation.row);
    }
    for (const transition of activity.lifecycle) if (transition.rowAtOperation !== null)
      yield* record(transition.table, transition.rowAtOperation);
    // Core observations may contain final pending values. The first command
    // preimage for each table/ID restores its actual initial lifecycle state.
    const preimages = new Set<string>();
    for (const mutation of activity.mutations) {
      if (mutation.before === null || typeof mutation.before.id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
      const identity = JSON.stringify([mutation.table, mutation.before.id]);
      if (!preimages.has(identity)) {
        preimages.add(identity); yield* record(mutation.table, mutation.before);
      }
    }
    if ((evidence.get(contracts.profile.name)?.size ?? 0) > 4)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const historical: Array<JsonObject & { readonly id: string }> =
      [...(evidence.get(contracts.profile.name)?.entries() ?? [])].map(([id, row]) => ({ ...row, id }));
    const expectedReads: Array<Parameters<LogicalCallReceiptValidation>[1]["relationalReads"][number]> = [];
    if (operation === "softDelete") {
      const where = yield* Effect.fromResult(decodeValidationWhere(buildQuery({ id: rawIds }).where));
      expectedReads.push({ table: contracts.profile.name, query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "in", column: "id", values: where.id }), total: historical.length, returned: historical.length });
      if (contracts.relation.join.type !== "hasMany") return yield* Effect.fail(commerceError("receiptMismatch"));
      const parents = orderNativeIdRows(historical.filter(row => row.deleted_at === null), where);
      const selection = yield* Effect.fromResult(prepareCommerceRelationPopulation(contracts.relation.join.foreignKeys,
        parents, contracts.relation.sourcePrimaryKeys, true, false))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (Option.isSome(selection)) expectedReads.push({ table: contracts.option.name,
        query: commerceRelationReadQuery(defaultCommerceResources, selection.value.predicate), total: 0, returned: 0 });
    }
    // The native lifecycle performs its own historical root read for nonempty
    // raw IDs. Restore intentionally has no preceding business-validation read.
    if (rawIds.length !== 0) expectedReads.push({ table: contracts.profile.name,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: rawIds }),
      total: historical.length, returned: historical.length });
    if (!jsonEqual(activity.relationalReads, expectedReads)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const selected = new Set([...(evidence.get(contracts.profile.name)?.values() ?? [])]
      .filter(row => operation === "restore" || row.deleted_at === null).map(row => row.id));
    if ([...optionRows.values()].filter(row => row.deleted_at === null).length > 8)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const row of optionRows.values()) if (typeof row.shipping_profile_id !== "string" ||
      !selected.has(row.shipping_profile_id) || row.deleted_at === null)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const pending = new Map<string, Set<string>>();
    for (const entity of contracts.entities) {
      const ids = new Set<string>();
      for (const id of evidence.get(entity.table.name)?.keys() ?? []) if (selected.has(id)) ids.add(id);
      if (ids.size > entity.maximum) return yield* Effect.fail(commerceError("receiptMismatch"));
      pending.set(entity.table.name, ids);
    }
    const ordered = new Map<string, string[]>(), expectedEvents: Array<Readonly<{ object: string; id: string }>> = [];
    const matched = new Set<number>();
    for (const transition of activity.lifecycle) {
      const entity = byTable.get(transition.table), id = transition.key.id;
      const before = typeof id === "string" ? evidence.get(transition.table)?.get(id) : undefined;
      if (entity === undefined || transition.operation !== operation || Object.keys(transition.key).length !== 1 ||
        typeof id !== "string" || before === undefined || !pending.get(transition.table)?.delete(id) ||
        before.deleted_at !== transition.beforeDeletedAt ||
        (operation === "softDelete" ? typeof transition.afterDeletedAt !== "string" ||
          entity.table === contracts.profile && transition.beforeDeletedAt !== null : transition.afterDeletedAt !== null))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const ids = ordered.get(transition.table) ?? [];
      ids.push(id); ordered.set(transition.table, ids);
      expectedEvents.push({ object: entity.table.name, id });
      if (transition.attemptOrdinal === null) {
        if (operation !== "restore" || transition.beforeDeletedAt !== null || transition.rowAtOperation === null ||
          !jsonEqual(projectNativeRow(transition.rowAtOperation), before))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      } else {
        const ordinal = transition.attemptOrdinal, mutation = activity.mutations[ordinal];
        if (matched.has(ordinal) || mutation === undefined || mutation.ordinal !== ordinal || mutation.table !== transition.table ||
          mutation.operation !== "patch" || mutation.before?.id !== id || mutation.after?.id !== id ||
          mutation.before.deleted_at !== transition.beforeDeletedAt || mutation.after.deleted_at !== transition.afterDeletedAt ||
          operation === "restore" && transition.beforeDeletedAt === null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const after = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(mutation.after)))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        for (const [field, value] of Object.entries(before)) if (field !== "deleted_at" && field !== "updated_at" &&
          (after[field] === undefined || !jsonEqual(value, after[field]))) return yield* Effect.fail(commerceError("receiptMismatch"));
        matched.add(ordinal);
      }
    }
    if ([...pending.values()].some(ids => ids.size !== 0) || matched.size !== activity.mutations.length || activity.lifecycle.length > 4)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const map: Record<string, readonly string[] | undefined> = result;
    let expectedKeys = 0;
    for (const entity of contracts.entities) {
      const ids = ordered.get(entity.table.name) ?? [], actual = map[entity.linkableKey];
      if (ids.length !== 0) expectedKeys++;
      if (ids.length === 0 ? actual !== undefined : actual === undefined || actual.length !== ids.length || actual.some((id, index) => id !== ids[index]))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (Object.keys(result).length !== expectedKeys) return yield* Effect.fail(commerceError("receiptMismatch"));
    const action = operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED;
    let emitted = 0;
    for (const input of call.events) {
      const message = yield* capture(input);
      if (message.metadata.action !== action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = expectedEvents[emitted++];
        if (expected === undefined || expected.object !== message.metadata.object || expected.id !== id)
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}
