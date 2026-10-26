import { and, eq, inArray, lte, or } from "drizzle-orm";
import { Effect, type Schema } from "effect";
import { uniqueKeys, type Definition, type Document } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { materialize } from "./materialization.ts";
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
    settle: Effect.fn("ExperimentStorage.settle")((command: Command, rows: readonly Document[], dependencies: readonly UniqueObservation[], result: Schema.Json) => operation(async transaction => {
      const { stored, admitted } = await load(transaction, command, "update");
      const [clock] = await transaction.select().from(tables.clocks).where(eq(tables.clocks.scope, stored.scope)).for("update");
      await checkTime(transaction, stored.expires);
      if (stored.profile !== "framework") throw new CoreError({ reason: "unsupported" });
      if (clock === undefined || rows.length < 1 || rows.length > 256 || Buffer.byteLength(JSON.stringify(rows)) > 262_144 || Buffer.byteLength(JSON.stringify(result)) > 262_144) throw new CoreError({ reason: "limit" });
      const seq = clock.seq + 1; if (!Number.isSafeInteger(seq)) throw new CoreError({ reason: "limit" });
      const observed = new Map(dependencies.map(item => [JSON.stringify({ field: item.field, key: item.key }), item.owner]));
      for (const row of rows) for (const key of uniqueKeys(admitted.definition, row)) {
        if (observed.get(JSON.stringify(key)) !== null) throw new CoreError({ reason: "invalid" });
      }
      const present = await transaction.select({ id: tables.documents.id }).from(tables.documents).where(and(
        eq(tables.documents.scope, stored.scope), eq(tables.documents.table, stored.table), inArray(tables.documents.id, rows.map(row => row.id)))).limit(1);
      if (present.length !== 0) throw new CoreError({ reason: "conflict" });
      await materialize(transaction, stored.scope, admitted.definition, command.id, seq, rows.map(body => ({ id: body.id, before: null, body })), result);
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
