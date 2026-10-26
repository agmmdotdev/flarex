import { randomUUID } from "node:crypto";
import { and, eq, lte, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { uniqueKeys, type Definition, type Document } from "./definition.ts";
import { CoreError, databaseFailure } from "./errors.ts";
import * as tables from "./schema.ts";
import { PhysicalFailure, type Session } from "./session.ts";

export type Database = PgDatabase<PgQueryResultHKT, typeof tables>;
type Transaction = Database;
export interface Command {
  readonly id: string; readonly token: string; readonly request: string;
  readonly snapshot: number; readonly status: "active" | "committed"; readonly result: Schema.Json;
}
export interface UniqueObservation { readonly field: string; readonly key: string; readonly owner: string | null }
export interface SqlMetrics { operations: number }

const checkTime = async (transaction: Transaction, expires: Date) => {
  const [time] = await transaction.select({ expired: sql<boolean>`clock_timestamp() >= ${expires}` })
    .from(tables.installation).where(eq(tables.installation.singleton, true));
  if (time?.expired !== false) throw new CoreError({ reason: "expired" });
};

/** Trusted persistence owns short Drizzle transactions. No handle reaches Payload.
 * Drizzle's foreign Promise callback retains typed refusals through CoreError. */
export function createStorage(session: Session, metrics: SqlMetrics = { operations: 0 }) {
  const admissions = new WeakMap<Command, { scope: string; definition: Definition }>();
  const authorityRow = alias(tables.authorities, "authority_gate");
  const installationRow = alias(tables.installation, "installation_gate");
  const grantRow = alias(tables.grants, "grant_gate");
  const definitionRow = alias(tables.definitions, "definition_gate");
  const operation = <A>(work: (transaction: Transaction) => Promise<A>) => Effect.tryPromise({
    try: () => { metrics.operations++; return session.run(work); },
    catch: (cause: unknown) => cause instanceof CoreError ? cause : cause instanceof PhysicalFailure
      ? new CoreError({ reason: "storage", phase: cause.phase, cause }) : databaseFailure(cause),
  }).pipe(Effect.uninterruptible);
  const gate = async (transaction: Transaction, scope: string) => {
    const [authority] = await transaction.select({ fence: authorityRow.fence, seq: tables.clocks.seq })
      .from(authorityRow)
      .innerJoin(tables.clocks, eq(tables.clocks.scope, authorityRow.scope))
      .innerJoin(grantRow, and(eq(grantRow.scope, authorityRow.scope), eq(grantRow.principal, sql`current_user`)))
      .innerJoin(installationRow, eq(installationRow.singleton, true))
      .where(and(eq(authorityRow.scope, scope), eq(authorityRow.enabled, true), eq(installationRow.active, true)))
      .for("share", { of: [authorityRow, installationRow, grantRow] });
    if (authority === undefined) throw new CoreError({ reason: "denied" });
    return authority;
  };
  const load = async (transaction: Transaction, command: Command, lock: "share" | "update") => {
    const admitted = admissions.get(command);
    if (admitted === undefined) throw new CoreError({ reason: "denied" });
    const authority = await gate(transaction, admitted.scope);
    const [selected] = await transaction.select({ version: definitionRow.version }).from(definitionRow)
      .where(and(eq(definitionRow.table, admitted.definition.table), eq(definitionRow.version, admitted.definition.version))).for("share");
    if (selected === undefined) throw new CoreError({ reason: "denied" });
    const [stored] = await transaction.select().from(tables.commands).where(eq(tables.commands.id, command.id)).for(lock);
    if (stored === undefined || stored.token !== command.token || stored.fence !== authority.fence) throw new CoreError({ reason: "denied" });
    if (stored.status !== "active") throw new CoreError({ reason: "closed" });
    return { stored, admitted };
  };
  return {
    metrics,
    open: Effect.fn("ExperimentStorage.open")((scope: string, request: string, digest: string, definition: Definition, token: string) => operation(async transaction => {
      const authority = await gate(transaction, scope);
      const [selected] = await transaction.select({ version: definitionRow.version }).from(definitionRow)
        .where(and(eq(definitionRow.table, definition.table), eq(definitionRow.version, definition.version))).for("share");
      if (selected === undefined) throw new CoreError({ reason: "denied" });
      const [inserted] = await transaction.insert(tables.commands).values({ id: randomUUID(), scope, request, digest,
        table: definition.table, version: definition.version, token, fence: authority.fence, snapshot: authority.seq,
        expires: sql`clock_timestamp() + interval '30 seconds'`, status: "active" })
        .onConflictDoNothing({ target: [tables.commands.scope, tables.commands.request] }).returning();
      const stored = inserted ?? (await transaction.select().from(tables.commands)
        .where(and(eq(tables.commands.scope, scope), eq(tables.commands.request, request))))[0];
      if (stored === undefined || stored.digest !== digest || stored.table !== definition.table || stored.version !== definition.version) throw new CoreError({ reason: "identity" });
      if (inserted === undefined && stored.status !== "committed") throw new CoreError({ reason: "busy" });
      const command: Command = Object.freeze({ id: stored.id, snapshot: stored.snapshot,
        status: inserted === undefined ? "committed" : "active", result: stored.result ?? null, token, request });
      admissions.set(command, { scope, definition });
      return command;
    })),
    observeUnique: Effect.fn("ExperimentStorage.observeUnique")((command: Command, keys: readonly { field: string; key: string }[]) => operation(async transaction => {
      const { stored, admitted } = await load(transaction, command, "share");
      await checkTime(transaction, stored.expires);
      if (keys.length > 256 || Buffer.byteLength(JSON.stringify(keys)) > 262_144) throw new CoreError({ reason: "limit" });
      if (keys.some(key => !admitted.definition.fields.some(field => field.unique && field.name === key.field))) throw new CoreError({ reason: "invalid" });
      const found = keys.length === 0 ? [] : await transaction.select().from(tables.uniqueClaims).where(and(
        eq(tables.uniqueClaims.scope, stored.scope), eq(tables.uniqueClaims.table, stored.table),
        lte(tables.uniqueClaims.commitSeq, stored.snapshot),
        or(...keys.map(key => and(eq(tables.uniqueClaims.field, key.field), eq(tables.uniqueClaims.key, key.key)))),
      ));
      const owners = new Map(found.map(row => [JSON.stringify({ field: row.field, key: row.key }), row.owner]));
      return keys.map(key => ({ ...key, owner: owners.get(JSON.stringify(key)) ?? null }));
    })),
    settle: Effect.fn("ExperimentStorage.settle")((command: Command, rows: readonly Document[], dependencies: readonly UniqueObservation[], result: Schema.Json) => operation(async transaction => {
      const { stored, admitted } = await load(transaction, command, "update");
      const [clock] = await transaction.select().from(tables.clocks).where(eq(tables.clocks.scope, stored.scope)).for("update");
      await checkTime(transaction, stored.expires);
      if (clock === undefined || rows.length < 1 || rows.length > 256 || Buffer.byteLength(JSON.stringify(rows)) > 262_144 ||
        Buffer.byteLength(JSON.stringify(result)) > 262_144) throw new CoreError({ reason: "limit" });
      const seq = clock.seq + 1;
      if (!Number.isSafeInteger(seq)) throw new CoreError({ reason: "limit" });
      const claims = rows.flatMap(row => uniqueKeys(admitted.definition, row).map(key => ({
        scope: stored.scope, table: stored.table, field: key.field, key: key.key, owner: row.id, commitSeq: seq,
      })));
      const observed = new Map(dependencies.map(item => [JSON.stringify({ field: item.field, key: item.key }), item.owner]));
      for (const claim of claims) if (observed.get(JSON.stringify({ field: claim.field, key: claim.key })) !== null) throw new CoreError({ reason: "invalid" });
      await transaction.insert(tables.documents).values(rows.map(body => ({ scope: stored.scope, table: stored.table, id: body.id, body, commitSeq: seq })));
      if (claims.length !== 0) await transaction.insert(tables.uniqueClaims).values(claims);
      await transaction.insert(tables.history).values(rows.map(body => ({ scope: stored.scope, table: stored.table, id: body.id, body, commitSeq: seq })));
      await transaction.insert(tables.eventIntents).values(rows.map((body, ordinal) => ({ command: command.id, ordinal, table: stored.table, document: body.id, body, event: "created" })));
      await transaction.update(tables.clocks).set({ seq }).where(eq(tables.clocks.scope, stored.scope));
      await transaction.update(tables.commands).set({ status: "committed", result, commitSeq: seq }).where(eq(tables.commands.id, command.id));
      return result;
    })),
    resolve: Effect.fn("ExperimentStorage.resolve")((scope: string, request: string, digest: string) => operation(async transaction => {
      await gate(transaction, scope);
      const [stored] = await transaction.select().from(tables.commands).where(and(eq(tables.commands.scope, scope), eq(tables.commands.request, request)));
      if (stored === undefined || stored.status !== "committed") throw new CoreError({ reason: "busy" });
      if (stored.digest !== digest) throw new CoreError({ reason: "identity" });
      return stored.result ?? null;
    })),
    abort: Effect.fn("ExperimentStorage.abort")((command: Command) => operation(async transaction => {
      if (!admissions.has(command)) throw new CoreError({ reason: "denied" });
      await transaction.update(tables.commands).set({ status: "aborted" }).where(and(eq(tables.commands.id, command.id),
        eq(tables.commands.token, command.token), eq(tables.commands.status, "active")));
    })),
    read: Effect.fn("ExperimentStorage.read")((scope: string, definition: Definition, id: string) => operation(async transaction => {
      await gate(transaction, scope);
      const [selected] = await transaction.select({ version: definitionRow.version }).from(definitionRow)
        .where(and(eq(definitionRow.table, definition.table), eq(definitionRow.version, definition.version))).for("share");
      if (selected === undefined) throw new CoreError({ reason: "denied" });
      const [row] = await transaction.select({ body: tables.documents.body }).from(tables.documents)
        .where(and(eq(tables.documents.scope, scope), eq(tables.documents.table, definition.table), eq(tables.documents.id, id)));
      return row?.body ?? null;
    })),
  };
}
export type Storage = ReturnType<typeof createStorage>;
