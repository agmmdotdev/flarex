import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Schema } from "effect";
import { numericField, uniqueKeys, type Definition, type Document } from "./definition.ts";
import type { Database } from "./persistence.ts";
import * as tables from "./schema.ts";

export interface Change { readonly id: string; readonly before: number | null; readonly body: Document | null }
export interface EventIntent { readonly event: string; readonly document: string; readonly body: Schema.Json }

/** Only an accepting profile calls this under the common scope-clock lock.
 * Historical index membership and row revisions publish in the same commit. */
export async function materialize(transaction: Database, scope: string, definition: Definition, command: string,
  seq: number, changes: readonly Change[], result: Schema.Json, events: readonly EventIntent[] = []) {
  const existing = changes.filter(change => change.before !== null).map(change => change.id);
  if (existing.length !== 0) {
    await transaction.delete(tables.uniqueClaims).where(and(eq(tables.uniqueClaims.scope, scope), eq(tables.uniqueClaims.table, definition.table), inArray(tables.uniqueClaims.owner, existing)));
    await transaction.update(tables.indexVersions).set({ untilSeq: seq }).where(and(eq(tables.indexVersions.scope, scope),
      eq(tables.indexVersions.table, definition.table), inArray(tables.indexVersions.id, existing), isNull(tables.indexVersions.untilSeq)));
    await transaction.delete(tables.documents).where(and(eq(tables.documents.scope, scope), eq(tables.documents.table, definition.table), inArray(tables.documents.id, existing)));
  }
  if (changes.length !== 0) {
    await transaction.insert(tables.history).values(changes.map(change => ({ scope, table: definition.table, id: change.id, commitSeq: seq, body: change.body })));
    const live = changes.flatMap(change => change.body === null ? [] : [change.body]);
    if (live.length !== 0) await transaction.insert(tables.documents).values(live.map(body => ({ scope, table: definition.table, id: body.id, body, commitSeq: seq })));
    const claims = live.flatMap(body => uniqueKeys(definition, body).map(key => ({ scope, table: definition.table, field: key.field, key: key.key, owner: body.id, commitSeq: seq })));
    if (claims.length !== 0) await transaction.insert(tables.uniqueClaims).values(claims);
    const entries = live.flatMap(body => definition.indexes.map(index => ({ scope, table: definition.table, index: index.name,
      id: body.id, key: numericField(body, index.field), creationTime: numericField(body, "systemCreationTime"), fromSeq: seq })));
    if (entries.length !== 0) await transaction.insert(tables.indexVersions).values(entries);
    const intents = [...changes.map(change => ({ document: change.id, body: change.body, event: change.body === null ? "deleted" : change.before === null ? "created" : "updated" })), ...events];
    await transaction.insert(tables.eventIntents).values(intents.map((intent, ordinal) => ({ command, ordinal, table: definition.table, ...intent })));
  }
  await transaction.update(tables.clocks).set({ seq }).where(eq(tables.clocks.scope, scope));
  await transaction.update(tables.commands).set({ status: "committed", result, commitSeq: seq }).where(eq(tables.commands.id, command));
}
