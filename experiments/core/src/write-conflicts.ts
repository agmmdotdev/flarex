import { and, eq, inArray, or } from "drizzle-orm";
import type { Database } from "./persistence.ts";
import type { TableChanges } from "./materialization.ts";
import { CoreError } from "./errors.ts";
import * as tables from "./schema.ts";

/** Database-local compare-and-swap for final writes. This does not establish
 * Application read/predicate OCC or grant participant settlement authority. */
export async function checkWritePredecessors(transaction: Database, scope: string, candidates: readonly TableChanges[]) {
  const changed = candidates.filter(candidate => candidate.changes.length !== 0);
  if (changed.length === 0) return;
  const present = await transaction.select({ table: tables.documents.table, id: tables.documents.id, revision: tables.documents.commitSeq }).from(tables.documents)
    .where(and(eq(tables.documents.scope, scope), or(...changed.map(({ definition, changes }) =>
      and(eq(tables.documents.table, definition.table), inArray(tables.documents.id, changes.map(change => change.id)))))));
  const current = new Map(present.map(row => [JSON.stringify([row.table, row.id]), row.revision]));
  if (changed.some(({ definition, changes }) => changes.some(change => (current.get(JSON.stringify([definition.table, change.id])) ?? null) !== change.before))) throw new CoreError({ reason: "conflict" });
  const inserted = changed.flatMap(({ definition, changes }) => {
    const ids = changes.filter(change => change.before === null).map(change => change.id);
    return ids.length === 0 ? [] : [and(eq(tables.history.table, definition.table), inArray(tables.history.id, ids))];
  });
  if (inserted.length !== 0 && (await transaction.select({ id: tables.history.id }).from(tables.history)
    .where(and(eq(tables.history.scope, scope), or(...inserted))).limit(1)).length !== 0) throw new CoreError({ reason: "conflict" });
}
