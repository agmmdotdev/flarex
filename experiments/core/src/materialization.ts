import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Schema } from "effect";
import { numericField, uniqueKeys, type Definition, type Document } from "./definition.ts";
import type { Database } from "./persistence.ts";
import * as tables from "./schema.ts";

export interface Change { readonly id: string; readonly before: number | null; readonly body: Document | null }
export interface EventIntent { readonly event: string; readonly document: string; readonly body: Schema.Json }
export interface TableChanges { readonly definition: Definition; readonly changes: readonly Change[]; readonly events: readonly EventIntent[] }

/** Pure lowering outside the physical transaction/scope lock. Selected metadata
 * is revalidated by the accepting profile before this plan can publish. */
export function planMaterialization(candidates: readonly TableChanges[]) {
  const rows = candidates.flatMap(({ definition, changes }) => changes.map(change => ({ table: definition.table, ...change,
    body: change.body === null ? null : structuredClone(change.body) })));
  const live = rows.flatMap(row => row.body === null ? [] : [{ table: row.table, id: row.id, body: row.body }]);
  const existing = candidates.flatMap(({ definition, changes }) => {
    const ids = changes.filter(change => change.before !== null).map(change => change.id);
    return ids.length === 0 ? [] : [{ table: definition.table, ids }];
  });
  const claims = candidates.flatMap(({ definition, changes }) => changes.flatMap(change => change.body === null ? [] :
    uniqueKeys(definition, change.body).map(key => ({ table: definition.table, ...key, owner: change.id }))));
  const indexes = candidates.flatMap(({ definition, changes }) => changes.flatMap(change => {
    const body = change.body;
    return body === null ? [] : definition.indexes.map(index => ({ table: definition.table, index: index.name, id: change.id,
      key: numericField(body, index.field), creationTime: numericField(body, "systemCreationTime") }));
  }));
  const intents = candidates.flatMap(({ definition, changes, events }) => [...changes.map(change => ({ document: change.id, body: change.body,
    event: change.body === null ? "deleted" : change.before === null ? "created" : "updated" })), ...events]
    .map(intent => ({ table: definition.table, ...structuredClone(intent) })));
  return { rows, live, existing, claims, indexes, intents };
}
export type MaterializationPlan = ReturnType<typeof planMaterialization>;

/** Only an accepting profile calls this under the common scope-clock lock.
 * Batch each physical family across tables, then publish one clock/outcome. */
export async function materialize(transaction: Database, scope: string, command: string,
  seq: number, plan: MaterializationPlan, result: Schema.Json) {
  if (plan.existing.length !== 0) {
    await transaction.delete(tables.uniqueClaims).where(and(eq(tables.uniqueClaims.scope, scope),
      or(...plan.existing.map(item => and(eq(tables.uniqueClaims.table, item.table), inArray(tables.uniqueClaims.owner, item.ids))))));
    await transaction.update(tables.indexVersions).set({ untilSeq: seq }).where(and(eq(tables.indexVersions.scope, scope), isNull(tables.indexVersions.untilSeq),
      or(...plan.existing.map(item => and(eq(tables.indexVersions.table, item.table), inArray(tables.indexVersions.id, item.ids))))));
    await transaction.delete(tables.documents).where(and(eq(tables.documents.scope, scope),
      or(...plan.existing.map(item => and(eq(tables.documents.table, item.table), inArray(tables.documents.id, item.ids))))));
  }
  if (plan.rows.length !== 0) await transaction.insert(tables.history).values(plan.rows.map(row => ({ scope, table: row.table, id: row.id, commitSeq: seq, body: row.body })));
  if (plan.live.length !== 0) await transaction.insert(tables.documents).values(plan.live.map(row => ({ scope, ...row, commitSeq: seq })));
  if (plan.claims.length !== 0) await transaction.insert(tables.uniqueClaims).values(plan.claims.map(claim => ({ scope, ...claim, commitSeq: seq })));
  if (plan.indexes.length !== 0) await transaction.insert(tables.indexVersions).values(plan.indexes.map(entry => ({ scope, ...entry, fromSeq: seq })));
  if (plan.intents.length !== 0) await transaction.insert(tables.eventIntents).values(plan.intents.map((intent, ordinal) => ({ command, ordinal, ...intent })));
  await transaction.update(tables.clocks).set({ seq }).where(eq(tables.clocks.scope, scope));
  await transaction.update(tables.commands).set({ status: "committed", result, commitSeq: seq }).where(eq(tables.commands.id, command));
}
