/** Convex database/bootstrap_model/index.rs at db914cf06; Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0. */
import { Result } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CorePersistenceError } from "./contracts";
import { isCoreIndexEnabled, isCoreIndexStaged, withCoreIndexStaged, type CoreIndexRecord } from "./indexState";
import type { CoreRegistry } from "./registry";
import type { CoreSchemaDefinition } from "./schemaTypes";
import type { CoreTableNamespace } from "./namespace";

export interface CoreNewIndex { readonly tableId: Uint8Array; readonly name: string; readonly fields: readonly string[]; readonly staged: boolean }
export interface CoreIndexPlan {
  readonly added: readonly CoreNewIndex[];
  readonly identical: readonly CoreIndexRecord[];
  readonly dropped: readonly CoreIndexRecord[];
  readonly enabled: readonly CoreIndexRecord[];
  readonly disabled: readonly CoreIndexRecord[];
}
export interface CoreIndexChanges { readonly removed: readonly Uint8Array[]; readonly added: readonly CoreIndexRecord[] }
const sameFields = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((field, i) => field === right[i]);

/** Compute again at activation: old enabled indexes remain readable throughout preparation. */
export function planCoreIndexes(registry: CoreRegistry, namespace: CoreTableNamespace, schema: CoreSchemaDefinition): CoreIndexPlan {
  const added: CoreNewIndex[] = [], identical: CoreIndexRecord[] = [], dropped: CoreIndexRecord[] = [];
  const enabled: CoreIndexRecord[] = [], disabled: CoreIndexRecord[] = [];
  const desired = new Set<string>();
  for (const table of schema.tables) {
    const mapping = registry.table(table.tableName, namespace);
    if (mapping === undefined) throw new Error("Index planning requires installed table mappings");
    for (const [declarations, staged] of [[table.indexes, false], [table.stagedDbIndexes, true]] as const) {
      for (const declaration of declarations) {
        const item = { tableId: mapping.definition.tabletId, name: declaration.indexDescriptor, fields: declaration.fields, staged };
        desired.add(JSON.stringify([encodeBytesToLowercaseHex(item.tableId), item.name]));
        const current = registry.indexes.byName(item.tableId, item.name);
        // Exact enabled match wins over a different pending replacement.
        if (current.enabled !== undefined && sameFields(current.enabled.fields, item.fields)
          && isCoreIndexStaged(current.enabled) === staged) {
          identical.push(current.enabled);
          if (current.pending !== undefined) dropped.push(current.pending);
          continue;
        }
        const selected = current.pending ?? current.enabled;
        if (selected === undefined) { added.push(item); continue; }
        if (!sameFields(selected.fields, item.fields)) {
          if (current.enabled !== undefined) dropped.push(current.enabled);
          if (current.pending !== undefined) dropped.push(current.pending);
          added.push(item); continue;
        }
        if (isCoreIndexStaged(selected) === staged) {
          identical.push(selected);
          if (current.enabled !== undefined && current.pending !== undefined) dropped.push(current.enabled);
        } else {
          (staged ? disabled : enabled).push(withCoreIndexStaged(selected, staged));
        }
      }
    }
  }
  for (const table of registry.tables.values()) {
    if (table.definition.namespace?.id !== namespace?.id || table.definition.name.startsWith("_")) continue;
    for (const index of registry.indexesForTablet(table.definition.tabletId)) {
      if (index.name === "by_id" || index.name === "by_creation_time") continue;
      if (!desired.has(JSON.stringify([encodeBytesToLowercaseHex(index.tableId), index.name]))) dropped.push(index);
    }
  }
  return { added, identical, dropped, enabled, disabled };
}

export function prepareCoreIndexChanges(plan: CoreIndexPlan, allocated: readonly CoreIndexRecord[]): CoreIndexChanges {
  if (allocated.length !== plan.added.length || allocated.some((index, i) => {
    const desired = plan.added[i];
    return desired === undefined || index.name !== desired.name || !sameFields(index.fields, desired.fields)
      || encodeBytesToLowercaseHex(index.tableId) !== encodeBytesToLowercaseHex(desired.tableId)
      || isCoreIndexStaged(index) !== desired.staged || index.state.type !== "Backfilling";
  })) throw new Error("Allocated indexes do not match the prepared source diff");
  return { removed: plan.dropped.filter(index => !isCoreIndexEnabled(index)).map(index => index.ref.id),
    added: [...allocated, ...plan.enabled, ...plan.disabled] };
}

export function finishCoreIndexChanges(plan: CoreIndexPlan): Result.Result<CoreIndexChanges, CorePersistenceError> {
  if (plan.added.length !== 0) return Result.fail(new CorePersistenceError({ reason: "corruptData", cause: "Unprepared indexes at activation" }));
  const enable = [...plan.identical.filter(index => !isCoreIndexStaged(index) && !isCoreIndexEnabled(index)), ...plan.enabled];
  if (enable.some(index => index.state.type === "Backfilling")) return Result.fail(new CorePersistenceError({
    reason: "unavailable", cause: "Index backfill has not completed" }));
  return Result.succeed({ removed: plan.dropped.map(index => index.ref.id), added: [
    ...enable.map(index => ({ ...index, state: { type: "Enabled" as const } })),
    ...plan.disabled.map(index => ({ ...index, state: { type: "Backfilled2" as const, staged: true } })),
  ] });
}
