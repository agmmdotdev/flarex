import { and, eq, exists, inArray, or, sql } from "drizzle-orm";
import type { Database } from "./persistence.ts";
import type { TableChanges } from "./materialization.ts";
import * as tables from "./schema.ts";

/** Final CAS and never-used identity evidence. Execute after the scope clock:
 * no business writer can change either family between these bounded probes.
 * This expression transfers no documents or predecessor arrays to the client. */
export function writeConflict(transaction: Database, scope: string, candidates: readonly TableChanges[]) {
  const changed = candidates.flatMap(({ definition, changes }) => changes.map(change => ({ table: definition.table, ...change })));
  if (changed.length === 0) return;
  const expected = transaction.$with("expected_predecessors").as(transaction.select({
    table: sql<string>`expected."table"`.as("expected_table"), id: sql<string>`expected."id"`.as("expected_id"),
    revision: sql<number | null>`expected."revision"`.as("expected_revision"),
  }).from(sql`(values ${sql.join(changed.map(change => sql`(${change.table}::text, ${change.id}::text, ${change.before}::bigint)`), sql`, `)}) as expected("table", "id", "revision")`));
  const mismatch = transaction.with(expected).select({ present: sql`1` }).from(expected).leftJoin(tables.documents,
    and(eq(tables.documents.scope, scope), eq(tables.documents.table, expected.table), eq(tables.documents.id, expected.id)))
    .where(sql`${tables.documents.commitSeq} is distinct from ${expected.revision}`);
  const inserted = candidates.flatMap(({ definition, changes }) => {
    const ids = changes.filter(change => change.before === null).map(change => change.id);
    return ids.length === 0 ? [] : [and(eq(tables.history.table, definition.table), inArray(tables.history.id, ids))];
  });
  const reused = inserted.length === 0 ? sql`false` : exists(transaction.select({ present: sql`1` }).from(tables.history)
    .where(and(eq(tables.history.scope, scope), or(...inserted))));
  return sql<"conflict" | null>`case when ${exists(mismatch)} or ${reused} then 'conflict'::text else null::text end`;
}
