import { Effect, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { moduleEventDecoder } from "../../module/events";
import { projectNativeRow } from "../../repository/result";
import type { compileSalesChannelDeletionContracts } from "./delete-input";
import { decodeSalesChannelDeletionIds } from "./delete-input";
import type { Result } from "effect";

type Contracts = Result.Result.Success<ReturnType<typeof compileSalesChannelDeletionContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.SALES_CHANNEL), object: Schema.Literal("sales_channel"),
    action: Schema.Literals([CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(4))]) }),
}), defaultCommerceResources);

/** Authenticate lifecycle results and native module messages against the actual
 * complete rows and managed transitions. Active restores are real operations
 * with events even though they create no mutation attempt. */
export function salesChannelDeletionPolicy(contracts: Contracts) {
  const capture = Effect.fn("SalesChannelEvents.captureLifecycle")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("SalesChannelEvents.validateLifecycleCall")(function* (call, activity) {
    const operation = call.commandName === "salesChannelSoftDeleteForWorkflow" ? "softDelete"
      : call.commandName === "salesChannelRestoreForWorkflow" ? "restore" : undefined;
    if (operation === undefined || call.mode !== "write" || activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const ids = yield* Effect.fromResult(decodeSalesChannelDeletionIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const result = yield* Effect.fromResult(contracts.decodeOutput(call.result))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const requested = new Set(ids), observed = new Map<string, JsonObject>();
    const record = Effect.fn("SalesChannelEvents.observeLifecycleRow")(function* (table: string, value: JsonObject) {
      const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(value)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (table !== "sales_channel" || typeof row.id !== "string" || !requested.has(row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      observed.set(row.id, row);
    });
    for (const observation of activity.observedRows) yield* record(observation.table, observation.row);
    for (const transition of activity.lifecycle) if (transition.rowAtOperation !== null)
      yield* record(transition.table, transition.rowAtOperation);
    // Observations contain the final pending view. The first mutation preimage
    // restores each identity's actual state before this command.
    const preimages = new Set<string>();
    for (const mutation of activity.mutations) {
      if (mutation.before === null || typeof mutation.before.id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
      if (!preimages.has(mutation.before.id)) {
        preimages.add(mutation.before.id);
        yield* record(mutation.table, mutation.before);
      }
    }
    const pending = new Set([...observed].filter(([, row]) => operation === "restore" || row.deleted_at === null).map(([id]) => id));
    const matched = new Set<number>(), ordered: string[] = [];
    for (const transition of activity.lifecycle) {
      const id = transition.key.id, before = typeof id === "string" ? observed.get(id) : undefined;
      if (transition.table !== "sales_channel" || transition.operation !== operation || Object.keys(transition.key).length !== 1 ||
        typeof id !== "string" || before === undefined || !pending.delete(id) || before.deleted_at !== transition.beforeDeletedAt ||
        (operation === "softDelete" ? transition.beforeDeletedAt !== null || typeof transition.afterDeletedAt !== "string" : transition.afterDeletedAt !== null))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      ordered.push(id);
      if (transition.attemptOrdinal === null) {
        if (operation !== "restore" || transition.beforeDeletedAt !== null || transition.rowAtOperation?.id !== id || transition.rowAtOperation.deleted_at !== null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
      } else {
        const ordinal = transition.attemptOrdinal, mutation = activity.mutations[ordinal];
        if (matched.has(ordinal) || mutation === undefined || mutation.ordinal !== ordinal || mutation.table !== "sales_channel" || mutation.operation !== "patch" ||
          mutation.before?.id !== id || mutation.after?.id !== id || mutation.before.deleted_at !== transition.beforeDeletedAt || mutation.after.deleted_at !== transition.afterDeletedAt ||
          operation === "restore" && transition.beforeDeletedAt === null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const after = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(mutation.after)))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        for (const [field, value] of Object.entries(before)) if (field !== "deleted_at" && field !== "updated_at" &&
          (after[field] === undefined || !jsonEqual(value, after[field]))) return yield* Effect.fail(commerceError("receiptMismatch"));
        matched.add(ordinal);
      }
    }
    if (pending.size !== 0 || matched.size !== activity.mutations.length || ordered.length > 4 ||
      (ordered.length === 0 ? Object.keys(result).length !== 0 : result.sales_channel_id === undefined ||
        result.sales_channel_id.length !== ordered.length || result.sales_channel_id.some((id, index) => id !== ordered[index])))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const action = operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED;
    let emitted = 0;
    for (const input of call.events) {
      const message = yield* capture(input);
      if (message.metadata.action !== action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (id !== ordered[emitted++]) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (emitted !== ordered.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}
