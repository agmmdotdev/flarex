import { Effect, type Result } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "./call-receipt";
import { projectNativeRow } from "./result";

interface ScalarLifecycleReceipt {
  readonly table: string;
  readonly softDeleteCommand: string;
  readonly restoreCommand: string;
  readonly maximumRoots: number;
  readonly decodeIds: (input: Json) => Result.Result<readonly string[], CommerceTransactionError>;
  readonly decodeRow: (input: unknown) => Result.Result<JsonObject, CommerceTransactionError>;
  readonly decodeResult: (input: Json) => Result.Result<Readonly<{ empty: boolean; ids: readonly string[] }>, CommerceTransactionError>;
}

/** Shared native scalar lifecycle correlation. Modules still own exact metadata,
 * command admission, linkable-key maps and event schemas. No storage is opened. */
export function scalarLifecycleReceipt(configuration: ScalarLifecycleReceipt): (
  call: Parameters<LogicalCallReceiptValidation>[0], activity: Parameters<LogicalCallReceiptValidation>[1],
) => Effect.Effect<Readonly<{ operation: "softDelete" | "restore"; ids: readonly string[] }>, CommerceTransactionError> {
  return Effect.fn("CommerceReceipt.validateScalarLifecycle")(function* (
    call: Parameters<LogicalCallReceiptValidation>[0], activity: Parameters<LogicalCallReceiptValidation>[1],
  ) {
    const operation = call.commandName === configuration.softDeleteCommand ? "softDelete"
      : call.commandName === configuration.restoreCommand ? "restore" : undefined;
    if (operation === undefined || call.mode !== "write" || activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const ids = yield* Effect.fromResult(configuration.decodeIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const result = yield* Effect.fromResult(configuration.decodeResult(call.result))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const requested = new Set(ids), observed = new Map<string, JsonObject>();
    const record = Effect.fn("CommerceReceipt.observeScalarLifecycleRow")(function* (table: string, value: JsonObject) {
      const row = yield* Effect.fromResult(configuration.decodeRow(projectNativeRow(value)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (table !== configuration.table || typeof row.id !== "string" || !requested.has(row.id))
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
      if (transition.table !== configuration.table || transition.operation !== operation || Object.keys(transition.key).length !== 1 ||
        typeof id !== "string" || before === undefined || !pending.delete(id) || before.deleted_at !== transition.beforeDeletedAt ||
        (operation === "softDelete" ? transition.beforeDeletedAt !== null || typeof transition.afterDeletedAt !== "string" : transition.afterDeletedAt !== null))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      ordered.push(id);
      if (transition.attemptOrdinal === null) {
        if (operation !== "restore" || transition.beforeDeletedAt !== null || transition.rowAtOperation?.id !== id || transition.rowAtOperation.deleted_at !== null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
      } else {
        const ordinal = transition.attemptOrdinal, mutation = activity.mutations[ordinal];
        if (matched.has(ordinal) || mutation === undefined || mutation.ordinal !== ordinal || mutation.table !== configuration.table || mutation.operation !== "patch" ||
          mutation.before?.id !== id || mutation.after?.id !== id || mutation.before.deleted_at !== transition.beforeDeletedAt || mutation.after.deleted_at !== transition.afterDeletedAt ||
          operation === "restore" && transition.beforeDeletedAt === null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const after = yield* Effect.fromResult(configuration.decodeRow(projectNativeRow(mutation.after)))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        for (const [field, value] of Object.entries(before)) if (field !== "deleted_at" && field !== "updated_at" &&
          (after[field] === undefined || !jsonEqual(value, after[field]))) return yield* Effect.fail(commerceError("receiptMismatch"));
        matched.add(ordinal);
      }
    }
    if (pending.size !== 0 || matched.size !== activity.mutations.length || ordered.length > configuration.maximumRoots ||
      (ordered.length === 0 ? !result.empty : result.ids.length !== ordered.length || result.ids.some((id, index) => id !== ordered[index])))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    return { operation, ids: ordered };
  });
}
