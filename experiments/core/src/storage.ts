import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { Definition, Document } from "./definition.ts";
import { CoreError } from "./errors.ts";
import type { Persistence, Command } from "./persistence.ts";
import * as tables from "./schema.ts";
import { createEqualityStorage } from "./equality-storage.ts";

export interface UniqueObservation { readonly field: string; readonly key: string; readonly owner: string | null }

/** Framework data observations. Commands publish through group-storage; this
 * owner has no reservation, accepting, recovery or abort capabilities. */
export function createStorage(persistence: Persistence) {
  const { operation, load, checkTime } = persistence;
  return {
    metrics: persistence.metrics,
    ...createEqualityStorage(persistence),
    observeUnique: Effect.fn("ExperimentStorage.observeUnique")((command: Command, keys: readonly { field: string; key: string }[]) => operation(async transaction => {
      const { stored, admitted } = await load(transaction, command, "share");
      await checkTime(transaction, stored.expires);
      if (keys.length > 256 || Buffer.byteLength(JSON.stringify(keys)) > 262_144) throw new CoreError({ reason: "limit" });
      if (keys.some(key => !admitted.definition.fields.some(field => field.unique && field.name === key.field))) throw new CoreError({ reason: "invalid" });
      const found = keys.length === 0 ? [] : await transaction.select().from(tables.uniqueClaims).where(and(
        eq(tables.uniqueClaims.scope, stored.scope), eq(tables.uniqueClaims.table, admitted.definition.table), lte(tables.uniqueClaims.commitSeq, stored.snapshot),
        or(...keys.map(key => and(eq(tables.uniqueClaims.field, key.field), eq(tables.uniqueClaims.key, key.key)))),
      ));
      const owners = new Map(found.map(row => [JSON.stringify({ field: row.field, key: row.key }), row.owner]));
      return keys.map(key => ({ ...key, owner: owners.get(JSON.stringify(key)) ?? null }));
    })),
    observeRows: Effect.fn("ExperimentStorage.observeRows")((command: Command, ids: readonly string[], remainingBytes: number) => operation(async transaction => {
      const { stored, admitted } = await load(transaction, command, "share"); await checkTime(transaction, stored.expires);
      if (ids.length > 256 || remainingBytes < 0) throw new CoreError({ reason: "limit" });
      if (ids.length === 0) return [];
      const bytes = sql<number>`octet_length(${tables.documents.body}::text)`.mapWith(Number);
      const consumed = sql<number>`sum(${bytes}) over(order by ${tables.documents.id})`.mapWith(Number);
      const rows = await transaction.select({ id: tables.documents.id, revision: tables.documents.commitSeq, bytes,
        body: sql<Document | null>`case when ${consumed} <= ${remainingBytes} then ${tables.documents.body} else null end` })
        .from(tables.documents).where(and(eq(tables.documents.scope, stored.scope), eq(tables.documents.table, admitted.definition.table), inArray(tables.documents.id, [...ids])));
      // This direct framework profile refuses a predecessor lost since opening
      // instead of attaching Application historical/predicate OCC machinery.
      if (rows.some(row => row.revision > stored.snapshot)) throw new CoreError({ reason: "conflict" });
      const missing = ids.filter(id => !rows.some(row => row.id === id));
      if (missing.length !== 0 && (await transaction.select({ id: tables.history.id }).from(tables.history).where(and(
        eq(tables.history.scope, stored.scope), eq(tables.history.table, admitted.definition.table), inArray(tables.history.id, missing), gt(tables.history.commitSeq, stored.snapshot))).limit(1)).length !== 0) throw new CoreError({ reason: "conflict" });
      if (rows.reduce((total, row) => total + row.bytes, 0) > remainingBytes) throw new CoreError({ reason: "limit" });
      return rows;
    })),
    read: Effect.fn("ExperimentStorage.read")((scope: string, definition: Definition, id: string) => operation(async transaction => {
      await persistence.gate(transaction, scope); await persistence.selected(transaction, definition);
      const [row] = await transaction.select({ body: tables.documents.body }).from(tables.documents)
        .where(and(eq(tables.documents.scope, scope), eq(tables.documents.table, definition.table), eq(tables.documents.id, id)));
      return row?.body ?? null;
    })),
  };
}
export type Storage = ReturnType<typeof createStorage>;
