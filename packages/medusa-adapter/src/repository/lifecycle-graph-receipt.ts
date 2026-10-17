import { Result } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "./call-receipt";
import { projectNativeRow } from "./result";

interface LifecycleReceiptEntity {
  readonly table: { readonly name: string };
  readonly maximum: number;
  readonly linkableKey: string;
  readonly decodeRow: (input: unknown) => Result.Result<JsonObject, CommerceTransactionError>;
}

/** Correlate already selected graph identities with managed transitions,
 * complete row changes and native map output. Module owners authenticate graph
 * membership, complete reads, operation admission and native event families. */
export function correlateLifecycleGraphReceipt(input: {
  readonly entities: readonly LifecycleReceiptEntity[];
  readonly rootTable: string;
  readonly operation: "softDelete" | "restore";
  readonly activeRestoreUpdates?: true;
  readonly activity: Parameters<LogicalCallReceiptValidation>[1];
  readonly evidence: ReadonlyMap<string, ReadonlyMap<string, JsonObject>>;
  readonly selected: ReadonlyMap<string, ReadonlySet<string>>;
  readonly result: Readonly<Record<string, readonly string[] | undefined>>;
}) {
  return Result.gen(function* () {
    const { entities, rootTable, operation, activity, evidence, selected, result } = input;
    const mismatch = () => commerceError("receiptMismatch");
    const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
    const pending = new Map<string, Set<string>>();
    for (const entity of entities) {
      const ids = new Set(selected.get(entity.table.name) ?? []);
      if (ids.size > entity.maximum) return yield* Result.fail(mismatch());
      pending.set(entity.table.name, ids);
    }
    const ordered = new Map<string, string[]>(), expectedEvents: Array<{ object: string; id: string }> = [];
    const matched = new Set<number>();
    for (const transition of activity.lifecycle) {
      const entity = byTable.get(transition.table), id = transition.key.id;
      const before = typeof id === "string" ? evidence.get(transition.table)?.get(id) : undefined;
      if (entity === undefined || transition.operation !== operation || Object.keys(transition.key).length !== 1 ||
        typeof id !== "string" || before === undefined || !pending.get(transition.table)?.delete(id) ||
        before.deleted_at !== transition.beforeDeletedAt ||
        (operation === "softDelete" ? typeof transition.afterDeletedAt !== "string" ||
          transition.table === rootTable && transition.beforeDeletedAt !== null : transition.afterDeletedAt !== null))
        return yield* Result.fail(mismatch());
      const ids = ordered.get(transition.table) ?? [];
      ids.push(id); ordered.set(transition.table, ids);
      expectedEvents.push({ object: transition.table, id });
      if (transition.attemptOrdinal === null) {
        if (input.activeRestoreUpdates === true || operation !== "restore" || transition.beforeDeletedAt !== null || transition.rowAtOperation === null ||
          !jsonEqual(projectNativeRow(transition.rowAtOperation), before)) return yield* Result.fail(mismatch());
      } else {
        const ordinal = transition.attemptOrdinal, mutation = activity.mutations[ordinal];
        if (matched.has(ordinal) || mutation === undefined || mutation.ordinal !== ordinal || mutation.table !== transition.table ||
          mutation.operation !== "patch" || mutation.before?.id !== id || mutation.after?.id !== id ||
          mutation.before.deleted_at !== transition.beforeDeletedAt || mutation.after.deleted_at !== transition.afterDeletedAt ||
          operation === "restore" && transition.beforeDeletedAt === null && input.activeRestoreUpdates !== true)
          return yield* Result.fail(mismatch());
        const after = yield* entity.decodeRow(projectNativeRow(mutation.after)).pipe(Result.mapError(cause => commerceError("receiptMismatch", cause)));
        for (const [field, value] of Object.entries(before)) if (field !== "deleted_at" && field !== "updated_at" &&
          (after[field] === undefined || !jsonEqual(value, after[field]))) return yield* Result.fail(mismatch());
        matched.add(ordinal);
      }
    }
    if ([...pending.values()].some(ids => ids.size !== 0) || matched.size !== activity.mutations.length)
      return yield* Result.fail(mismatch());
    let expectedKeys = 0;
    for (const entity of entities) {
      const ids = ordered.get(entity.table.name) ?? [], actual = result[entity.linkableKey];
      if (ids.length !== 0) expectedKeys++;
      if (ids.length === 0 ? actual !== undefined : actual === undefined || actual.length !== ids.length || actual.some((id, index) => id !== ids[index]))
        return yield* Result.fail(mismatch());
    }
    if (Object.keys(result).length !== expectedKeys) return yield* Result.fail(mismatch());
    return { ordered, events: expectedEvents };
  });
}
