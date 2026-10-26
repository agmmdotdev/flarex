import { randomUUID } from "node:crypto";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { alias, type PgDatabase, type PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import type { Definition } from "./definition.ts";
import { CoreError, databaseFailure } from "./errors.ts";
import { PhysicalFailure, type Session } from "./session.ts";
import * as tables from "./schema.ts";

export type Database = PgDatabase<PgQueryResultHKT, typeof tables>;
export interface Command {
  readonly id: string; readonly token: string; readonly request: string;
  readonly snapshot: number; readonly status: "active" | "committed"; readonly result: Schema.Json;
}
export interface Snapshot { readonly sequence: number; readonly creationTime: number }
export interface SqlMetrics { operations: number }
type Admission = { readonly scope: string; readonly definition: Definition };

/** Trusted database lifetime/authority primitives shared by distinct profiles.
 * This value never crosses the Application/Payload callback boundary. */
export function createPersistence(session: Session, metrics: SqlMetrics = { operations: 0 }) {
  const admissions = new WeakMap<Command, Admission>();
  const snapshots = new WeakMap<Snapshot, Admission & { fence: number; expires: Date }>();
  const commandSnapshots = new WeakMap<Command, Snapshot>();
  const databaseTime = sql<number>`extract(epoch from clock_timestamp())::double precision * 1000`.mapWith(Number);
  const bindSnapshot = (command: Command, admission: Admission, fence: number, expires: Date, creationTime: number) => {
    const snapshot = Object.freeze({ sequence: command.snapshot, creationTime }); snapshots.set(snapshot, { ...admission, fence, expires });
    commandSnapshots.set(command, snapshot);
  };
  const authorityRow = alias(tables.authorities, "authority_gate");
  const installationRow = alias(tables.installation, "installation_gate");
  const grantRow = alias(tables.grants, "grant_gate");
  const definitionRow = alias(tables.definitions, "definition_gate");
  const operation = <A>(work: (transaction: Database) => Promise<A>) => Effect.tryPromise({
    try: () => { metrics.operations++; return session.run(work); },
    catch: (cause: unknown) => cause instanceof CoreError ? cause : cause instanceof PhysicalFailure
      ? new CoreError({ reason: "storage", phase: cause.phase, cause }) : databaseFailure(cause),
  }).pipe(Effect.uninterruptible);
  const gate = async (transaction: Database, scope: string) => {
    const [authority] = await transaction.select({ fence: authorityRow.fence, seq: tables.clocks.seq, retainedFrom: authorityRow.retainedFrom })
      .from(authorityRow).innerJoin(tables.clocks, eq(tables.clocks.scope, authorityRow.scope))
      .innerJoin(grantRow, and(eq(grantRow.scope, authorityRow.scope), eq(grantRow.principal, sql`current_user`)))
      .innerJoin(installationRow, eq(installationRow.singleton, true))
      .where(and(eq(authorityRow.scope, scope), eq(authorityRow.enabled, true), eq(installationRow.active, true)))
      .for("share", { of: [authorityRow, installationRow, grantRow] });
    if (authority === undefined) throw new CoreError({ reason: "denied" });
    return authority;
  };
  const selected = async (transaction: Database, definition: Definition) => {
    const [row] = await transaction.select({ version: definitionRow.version }).from(definitionRow)
      .where(and(eq(definitionRow.table, definition.table), eq(definitionRow.version, definition.version))).for("share");
    if (row === undefined) throw new CoreError({ reason: "denied" });
  };
  const checkTime = async (transaction: Database, expires: Date) => {
    const [time] = await transaction.select({ expired: sql<boolean>`clock_timestamp() >= ${expires}` })
      .from(tables.installation).where(eq(tables.installation.singleton, true));
    if (time?.expired !== false) throw new CoreError({ reason: "expired" });
  };
  const load = async (transaction: Database, command: Command, lock: "share" | "update") => {
    const admitted = admissions.get(command);
    if (admitted === undefined) throw new CoreError({ reason: "denied" });
    const authority = await gate(transaction, admitted.scope);
    await selected(transaction, admitted.definition);
    const [stored] = await transaction.select().from(tables.commands).where(eq(tables.commands.id, command.id)).for(lock);
    if (stored === undefined || stored.token !== command.token || stored.fence !== authority.fence) throw new CoreError({ reason: "denied" });
    if (stored.status !== "active") throw new CoreError({ reason: "closed" });
    if (stored.snapshot < authority.retainedFrom) throw new CoreError({ reason: "expired" });
    return { stored, admitted };
  };
  const openCommand = Effect.fn("ExperimentPersistence.openCommand")((profile: "framework" | "application", scope: string, request: string,
    digest: string, definition: Definition, token: string) => operation(async transaction => {
    const authority = await gate(transaction, scope); await selected(transaction, definition);
    const [inserted] = await transaction.insert(tables.commands).values({ id: randomUUID(), scope, request, digest,
      table: definition.table, version: definition.version, token, fence: authority.fence, snapshot: authority.seq,
      expires: sql`clock_timestamp() + interval '30 seconds'`, status: "active", profile })
      .onConflictDoNothing({ target: [tables.commands.scope, tables.commands.request] }).returning({ ...getTableColumns(tables.commands), creationTime: databaseTime });
    const stored = inserted ?? (await transaction.select({ ...getTableColumns(tables.commands), creationTime: databaseTime }).from(tables.commands)
      .where(and(eq(tables.commands.scope, scope), eq(tables.commands.request, request))))[0];
    if (stored === undefined || stored.digest !== digest || stored.table !== definition.table || stored.version !== definition.version || stored.profile !== profile) throw new CoreError({ reason: "identity" });
    if (inserted === undefined && stored.status !== "committed") throw new CoreError({ reason: "busy" });
    const command: Command = Object.freeze({ id: stored.id, snapshot: stored.snapshot,
      status: inserted === undefined ? "committed" : "active", result: stored.result ?? null, token, request });
    const admission = { scope, definition }; admissions.set(command, admission);
    if (profile === "application" && command.status === "active") bindSnapshot(command, admission, stored.fence, stored.expires, stored.creationTime);
    return command;
  }));
  const abort = Effect.fn("ExperimentPersistence.abort")((command: Command) => operation(async transaction => {
    if (!admissions.has(command)) throw new CoreError({ reason: "denied" });
    await transaction.update(tables.commands).set({ status: "aborted" }).where(and(eq(tables.commands.id, command.id),
      eq(tables.commands.token, command.token), eq(tables.commands.status, "active")));
  }));
  const resolve = Effect.fn("ExperimentPersistence.resolve")((scope: string, request: string, digest: string) => operation(async transaction => {
    await gate(transaction, scope);
    const [stored] = await transaction.select().from(tables.commands).where(and(eq(tables.commands.scope, scope), eq(tables.commands.request, request)));
    if (stored === undefined || stored.status !== "committed") throw new CoreError({ reason: "busy" });
    if (stored.digest !== digest) throw new CoreError({ reason: "identity" });
    return stored.result ?? null;
  }));
  const openSnapshot = Effect.fn("ExperimentPersistence.openSnapshot")((scope: string, definition: Definition) => operation(async transaction => {
    const authority = await gate(transaction, scope); await selected(transaction, definition);
    const [time] = await transaction.select({ expires: sql<Date>`clock_timestamp() + interval '30 seconds'`.mapWith(tables.commands.expires), creationTime: databaseTime })
      .from(tables.installation).where(eq(tables.installation.singleton, true));
    if (time === undefined) throw new CoreError({ reason: "storage" });
    const snapshot = Object.freeze({ sequence: authority.seq, creationTime: time.creationTime });
    snapshots.set(snapshot, { scope, definition, fence: authority.fence, expires: time.expires }); return snapshot;
  }));
  const loadSnapshot = async (transaction: Database, snapshot: Snapshot) => {
    const admitted = snapshots.get(snapshot); if (admitted === undefined) throw new CoreError({ reason: "closed" });
    const authority = await gate(transaction, admitted.scope); await selected(transaction, admitted.definition);
    if (authority.fence !== admitted.fence) throw new CoreError({ reason: "denied" });
    if (snapshot.sequence < authority.retainedFrom) throw new CoreError({ reason: "expired" });
    await checkTime(transaction, admitted.expires); return admitted;
  };
  const commandSnapshot = Effect.fn("ExperimentPersistence.commandSnapshot")((command: Command) => Effect.gen(function* () {
    const snapshot = commandSnapshots.get(command);
    if (snapshot === undefined || !snapshots.has(snapshot)) return yield* Effect.fail(new CoreError({ reason: "closed" }));
    return snapshot;
  }));
  const restart = Effect.fn("ExperimentPersistence.restart")((previous: Command) => operation(async transaction => {
    const admitted = admissions.get(previous); if (admitted === undefined) throw new CoreError({ reason: "denied" });
    const authority = await gate(transaction, admitted.scope); await selected(transaction, admitted.definition);
    const [stored] = await transaction.select().from(tables.commands).where(eq(tables.commands.id, previous.id)).for("update");
    if (stored === undefined || stored.token !== previous.token || stored.status !== "aborted" || stored.profile !== "application" || stored.fence !== authority.fence) throw new CoreError({ reason: "closed" });
    await checkTime(transaction, stored.expires);
    const token = randomUUID();
    const [restarted] = await transaction.update(tables.commands).set({ token, snapshot: authority.seq, status: "active" }).where(eq(tables.commands.id, previous.id)).returning({ creationTime: databaseTime });
    if (restarted === undefined) throw new CoreError({ reason: "storage" });
    const priorSnapshot = commandSnapshots.get(previous); if (priorSnapshot !== undefined) snapshots.delete(priorSnapshot);
    const command: Command = Object.freeze({ ...previous, token, snapshot: authority.seq }); admissions.set(command, admitted);
    bindSnapshot(command, admitted, stored.fence, stored.expires, restarted.creationTime); return command;
  }));
  return { metrics, operation, gate, selected, checkTime, load, openCommand, abort, resolve,
    openSnapshot, loadSnapshot, commandSnapshot, restart, closeSnapshot: (snapshot: Snapshot) => Effect.sync(() => { snapshots.delete(snapshot); }) };
}
export type Persistence = ReturnType<typeof createPersistence>;
