import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { Effect, type Schema } from "effect";
import { uniqueKeys, type Definition, type Document } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { materialize, type Change, type EventIntent } from "./materialization.ts";
import type { Persistence, Command } from "./persistence.ts";
import * as tables from "./schema.ts";

export interface UniqueObservation { readonly field: string; readonly key: string; readonly owner: string | null }

/** Framework-command profile; it does not acquire Application OCC/retry policy. */
export function createStorage(persistence: Persistence) {
  const { operation, load, checkTime } = persistence;
  return {
    metrics: persistence.metrics,
    open: (scope: string, request: string, digest: string, definition: Definition, token: string) =>
      persistence.openCommand("framework", scope, request, digest, definition, token),
    observeUnique: Effect.fn("ExperimentStorage.observeUnique")((command: Command, keys: readonly { field: string; key: string }[]) => operation(async transaction => {
      const { stored, admitted } = await load(transaction, command, "share");
      await checkTime(transaction, stored.expires);
      if (keys.length > 256 || Buffer.byteLength(JSON.stringify(keys)) > 262_144) throw new CoreError({ reason: "limit" });
      if (keys.some(key => !admitted.definition.fields.some(field => field.unique && field.name === key.field))) throw new CoreError({ reason: "invalid" });
      const found = keys.length === 0 ? [] : await transaction.select().from(tables.uniqueClaims).where(and(
        eq(tables.uniqueClaims.scope, stored.scope), eq(tables.uniqueClaims.table, stored.table), lte(tables.uniqueClaims.commitSeq, stored.snapshot),
        or(...keys.map(key => and(eq(tables.uniqueClaims.field, key.field), eq(tables.uniqueClaims.key, key.key)))),
      ));
      const owners = new Map(found.map(row => [JSON.stringify({ field: row.field, key: row.key }), row.owner]));
      return keys.map(key => ({ ...key, owner: owners.get(JSON.stringify(key)) ?? null }));
    })),
    observeRows: Effect.fn("ExperimentStorage.observeRows")((command: Command, ids: readonly string[], remainingBytes: number) => operation(async transaction => {
      const { stored } = await load(transaction, command, "share"); await checkTime(transaction, stored.expires);
      if (ids.length > 256 || remainingBytes < 0) throw new CoreError({ reason: "limit" });
      if (ids.length === 0) return [];
      const bytes = sql<number>`octet_length(${tables.documents.body}::text)`.mapWith(Number);
      const consumed = sql<number>`sum(${bytes}) over(order by ${tables.documents.id})`.mapWith(Number);
      const rows = await transaction.select({ id: tables.documents.id, revision: tables.documents.commitSeq, bytes,
        body: sql<Document | null>`case when ${consumed} <= ${remainingBytes} then ${tables.documents.body} else null end` })
        .from(tables.documents).where(and(eq(tables.documents.scope, stored.scope), eq(tables.documents.table, stored.table), inArray(tables.documents.id, [...ids])));
      // This direct framework profile refuses a predecessor lost since opening
      // instead of attaching Application historical/predicate OCC machinery.
      if (rows.some(row => row.revision > stored.snapshot)) throw new CoreError({ reason: "conflict" });
      const missing = ids.filter(id => !rows.some(row => row.id === id));
      if (missing.length !== 0 && (await transaction.select({ id: tables.history.id }).from(tables.history).where(and(
        eq(tables.history.scope, stored.scope), eq(tables.history.table, stored.table), inArray(tables.history.id, missing), gt(tables.history.commitSeq, stored.snapshot))).limit(1)).length !== 0) throw new CoreError({ reason: "conflict" });
      if (rows.reduce((total, row) => total + row.bytes, 0) > remainingBytes) throw new CoreError({ reason: "limit" });
      return rows;
    })),
    settle: Effect.fn("ExperimentStorage.settle")((command: Command, changes: readonly Change[], dependencies: readonly UniqueObservation[], result: Schema.Json, events: readonly EventIntent[]) => operation(async transaction => {
      const { stored, admitted } = await load(transaction, command, "update");
      const [clock] = await transaction.select().from(tables.clocks).where(eq(tables.clocks.scope, stored.scope)).for("update");
      await checkTime(transaction, stored.expires);
      if (stored.profile !== "framework") throw new CoreError({ reason: "unsupported" });
      if (clock === undefined || changes.length > 256 || events.length > 256 || Buffer.byteLength(JSON.stringify(changes)) > 262_144 || Buffer.byteLength(JSON.stringify(events)) > 262_144 || Buffer.byteLength(JSON.stringify(result)) > 262_144) throw new CoreError({ reason: "limit" });
      const seq = clock.seq + 1; if (!Number.isSafeInteger(seq)) throw new CoreError({ reason: "limit" });
      const observed = new Map(dependencies.map(item => [JSON.stringify({ field: item.field, key: item.key }), item.owner]));
      for (const change of changes) if (change.body !== null) for (const key of uniqueKeys(admitted.definition, change.body)) {
        if (!observed.has(JSON.stringify(key))) throw new CoreError({ reason: "invalid" });
      }
      if (events.some(event => !changes.some(change => change.id === event.document))) throw new CoreError({ reason: "invalid" });
      if (changes.length !== 0) {
        const present = await transaction.select({ id: tables.documents.id, revision: tables.documents.commitSeq }).from(tables.documents).where(and(
          eq(tables.documents.scope, stored.scope), eq(tables.documents.table, stored.table), inArray(tables.documents.id, changes.map(change => change.id))));
        const current = new Map(present.map(row => [row.id, row.revision]));
        if (changes.some(change => (current.get(change.id) ?? null) !== change.before)) throw new CoreError({ reason: "conflict" });
        const inserted = changes.filter(change => change.before === null).map(change => change.id);
        if (inserted.length !== 0 && (await transaction.select({ id: tables.history.id }).from(tables.history).where(and(eq(tables.history.scope, stored.scope),
          eq(tables.history.table, stored.table), inArray(tables.history.id, inserted))).limit(1)).length !== 0) throw new CoreError({ reason: "conflict" });
      }
      await materialize(transaction, stored.scope, admitted.definition, command.id, seq, changes, result, events);
      return result;
    })),
    resolve: persistence.resolve,
    abort: persistence.abort,
    read: Effect.fn("ExperimentStorage.read")((scope: string, definition: Definition, id: string) => operation(async transaction => {
      await persistence.gate(transaction, scope); await persistence.selected(transaction, definition);
      const [row] = await transaction.select({ body: tables.documents.body }).from(tables.documents)
        .where(and(eq(tables.documents.scope, scope), eq(tables.documents.table, definition.table), eq(tables.documents.id, id)));
      return row?.body ?? null;
    })),
  };
}
export type Storage = ReturnType<typeof createStorage>;
