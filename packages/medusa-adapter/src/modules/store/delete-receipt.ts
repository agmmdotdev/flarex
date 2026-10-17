import { Effect, Result, Schema } from "effect";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { moduleEventDecoder } from "../../module/events";
import type { compileStoreDeletionContracts } from "./delete-input";
import { decodeStoreDeletionIds } from "./delete-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileStoreDeletionContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.STORE),
    object: Schema.Literals(["store", "store_currency", "store_locale"]),
    action: Schema.Literals([CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(8))]) }),
}), defaultCommerceResources);

/** Complete Store lifecycle receipts authenticate raw requested membership,
 * historical cascade closure, every native scalar field, result maps and events.
 * Restore includes active no-op roots and all of their historical children. */
export function storeDeletionPolicy(contracts: Contracts) {
  const capture = Effect.fn("StoreEvents.captureLifecycle")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.STORE,
      objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const byTable = new Map(contracts.entities.map(entity => [entity.table.name, entity]));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("StoreEvents.validateLifecycleCall")(function* (call, activity) {
    const operation = call.commandName === "storeSoftDeleteForWorkflow" ? "softDelete"
      : call.commandName === "storeRestoreForWorkflow" ? "restore" : undefined;
    if (operation === undefined || call.mode !== "write" || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const requested = new Set(yield* Effect.fromResult(decodeStoreDeletionIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))));
    const result = yield* Effect.fromResult(contracts.decodeOutput(call.result))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const evidence = new Map<string, Map<string, JsonObject>>();
    const record = Effect.fn("StoreEvents.observeLifecycleRow")(function* (table: string, value: JsonObject) {
      const entity = byTable.get(table);
      if (entity === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(value)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string" || entity.table === contracts.store && !requested.has(row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const rows = evidence.get(table) ?? new Map<string, JsonObject>();
      rows.set(row.id, row); evidence.set(table, rows);
    });
    for (const observation of activity.observedRows) yield* record(observation.table, observation.row);
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
    const selected = new Set([...(evidence.get(contracts.store.name)?.values() ?? [])]
      .filter(row => operation === "restore" || row.deleted_at === null).map(row => row.id));
    const pending = new Map<string, Set<string>>();
    for (const entity of contracts.entities) {
      const ids = new Set<string>();
      for (const [id, row] of evidence.get(entity.table.name) ?? []) {
        if (entity.table === contracts.store ? selected.has(id) : typeof row.store_id === "string" && selected.has(row.store_id)) ids.add(id);
        else if (entity.table !== contracts.store) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
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
          entity.table === contracts.store && transition.beforeDeletedAt !== null : transition.afterDeletedAt !== null))
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
    if ([...pending.values()].some(ids => ids.size !== 0) || matched.size !== activity.mutations.length || activity.lifecycle.length > 20)
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
