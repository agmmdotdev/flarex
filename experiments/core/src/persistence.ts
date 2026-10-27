import { randomUUID } from "node:crypto";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import type { Definition } from "./definition.ts";
import { CoreError, databaseFailure } from "./errors.ts";
import { PhysicalFailure, type Session } from "./session.ts";
import { authorityQuery, createReadGuards, selectionQuery, verifySelection } from "./read-guards.ts";
import * as tables from "./schema.ts";

export type Database = PgDatabase<PgQueryResultHKT, typeof tables>;
export interface Command {
  readonly id: string; readonly token: string; readonly request: string;
  readonly profile: "framework" | "application" | "mixed";
  readonly snapshot: number; readonly status: "active" | "committed"; readonly result: Schema.Json;
}
export interface Snapshot { readonly sequence: number; readonly creationTime: number }
export interface SqlMetrics { operations: number }
type Admission = { readonly scope: string; readonly definition: Definition; readonly selection: readonly Definition[]; readonly owner: boolean;
  readonly fence: number; readonly expires: Date };
const isSelection = Schema.is(Schema.Array(Schema.Struct({ table: Schema.String, version: Schema.String })).check(Schema.isLengthBetween(1, 16)));
const matchesSelection = (value: unknown, selection: readonly Definition[]) => isSelection(value) && value.length === selection.length &&
  value.every((entry, index) => entry.table === selection[index]?.table && entry.version === selection[index]?.version);

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
  const guards = createReadGuards();
  const operation = <A>(work: (transaction: Database) => Promise<A>) => Effect.tryPromise({
    try: () => { metrics.operations++; return session.run(work); },
    catch: (cause: unknown) => cause instanceof CoreError ? cause : cause instanceof PhysicalFailure
      ? new CoreError({ reason: "storage", phase: cause.phase, cause }) : databaseFailure(cause),
  }).pipe(Effect.uninterruptible);
  const gate = async (transaction: Database, scope: string) => {
    const [authority] = await authorityQuery(transaction, scope);
    if (authority === undefined) throw new CoreError({ reason: "denied" });
    return authority;
  };
  const selectedSet = async (transaction: Database, selection: readonly Pick<Definition, "table" | "version">[]) => {
    verifySelection(selection);
    const rows = await selectionQuery(transaction, selection);
    if (rows.length !== selection.length) throw new CoreError({ reason: "denied" });
  };
  const selected = (transaction: Database, definition: Definition) => selectedSet(transaction, [definition]);
  const readAuthority = async (transaction: Database, scope: string, selection: readonly Definition[]) => {
    const [row] = await guards.authority(transaction, scope, selection);
    if (row === undefined || row.observed_selection.count !== selection.length) throw new CoreError({ reason: "denied" });
    return row.observed_authority;
  };
  const checkTime = async (transaction: Database, expires: Date) => {
    const [time] = await transaction.select({ expired: sql<boolean>`clock_timestamp() >= ${expires}` })
      .from(tables.installation).where(eq(tables.installation.singleton, true));
    if (time?.expired !== false) throw new CoreError({ reason: "expired" });
  };
  const validateCommand = (command: Command, admitted: Admission, authority: { fence: number; retainedFrom: number }, stored: typeof tables.commands.$inferSelect | null | undefined) => {
    if (stored === undefined || stored === null || stored.token !== command.token || stored.scope !== admitted.scope || stored.request !== command.request ||
      stored.snapshot !== command.snapshot || stored.profile !== command.profile || !matchesSelection(stored.definitions, admitted.selection) ||
      stored.fence !== admitted.fence || admitted.fence !== authority.fence || stored.expires.getTime() > admitted.expires.getTime()) throw new CoreError({ reason: "denied" });
    if (stored.status !== "active") throw new CoreError({ reason: "closed" });
    if (stored.snapshot < authority.retainedFrom) throw new CoreError({ reason: "expired" });
    return { stored, admitted };
  };
  const load = async (transaction: Database, command: Command) => {
    const admitted = admissions.get(command);
    if (admitted === undefined) throw new CoreError({ reason: "denied" });
    const [row] = await guards.accepting(transaction, admitted.scope, admitted.selection, command.id);
    if (row === undefined || row.observed_selection.count !== admitted.selection.length) throw new CoreError({ reason: "denied" });
    return validateCommand(command, admitted, row.observed_authority, row.observed_command);
  };
  const observeCommand = async (transaction: Database, command: Command) => {
    const admitted = admissions.get(command);
    if (admitted === undefined) throw new CoreError({ reason: "denied" });
    const [row] = await guards.command(transaction, admitted.scope, admitted.selection, command.id);
    if (row === undefined || row.observed_selection.count !== admitted.selection.length) throw new CoreError({ reason: "denied" });
    const loaded = validateCommand(command, admitted, row.observed_authority, row.observed_command);
    if (row.observed_deadline?.expired !== false) throw new CoreError({ reason: "expired" });
    return loaded;
  };
  const reserve = Effect.fn("ExperimentPersistence.reserve")((profile: "framework" | "application" | "mixed", scope: string, request: string,
    digest: string, definitions: readonly Definition[], token: string) => operation(async transaction => {
    const selection = Object.freeze([...definitions].toSorted((left, right) => left.table < right.table ? -1 : left.table > right.table ? 1 : 0));
    const definition = selection[0];
    if (definition === undefined) throw new CoreError({ reason: "unsupported" });
    const authority = await readAuthority(transaction, scope, selection);
    const identities = selection.map(item => ({ table: item.table, version: item.version }));
    const [inserted] = await transaction.insert(tables.commands).values({ id: randomUUID(), scope, request, digest,
      definitions: identities, token, fence: authority.fence, snapshot: authority.seq,
      expires: sql`clock_timestamp() + interval '30 seconds'`, status: "active", profile })
      .onConflictDoNothing({ target: [tables.commands.scope, tables.commands.request] }).returning({ ...getTableColumns(tables.commands), creationTime: databaseTime });
    const stored = inserted ?? (await transaction.select({ ...getTableColumns(tables.commands), creationTime: databaseTime }).from(tables.commands)
      .where(and(eq(tables.commands.scope, scope), eq(tables.commands.request, request))))[0];
    if (stored === undefined || stored.digest !== digest || !matchesSelection(stored.definitions, selection) || stored.profile !== profile) throw new CoreError({ reason: "identity" });
    if (inserted === undefined && stored.status !== "committed") throw new CoreError({ reason: "busy" });
    const command: Command = Object.freeze({ id: stored.id, snapshot: stored.snapshot,
      status: inserted === undefined ? "committed" : "active", result: stored.result ?? null, token, request, profile });
    const admission = { scope, definition, selection, owner: true, fence: stored.fence, expires: stored.expires }; admissions.set(command, admission);
    if ((profile === "application" || profile === "mixed") && command.status === "active") bindSnapshot(command, admission, stored.fence, stored.expires, stored.creationTime);
    return command;
  }));
  const openCommand = (profile: "framework" | "application", scope: string, request: string, digest: string, definition: Definition, token: string) =>
    reserve(profile, scope, request, digest, [definition], token);
  const openGroup = (profile: "framework" | "mixed", scope: string, request: string, digest: string, definitions: readonly Definition[], token: string) =>
    reserve(profile, scope, request, digest, definitions, token);
  /** Trusted table capability issuance, not a new reservation or child command.
   * Native callbacks never receive these objects or the accepting owner. */
  const participant = Effect.fn("ExperimentPersistence.participant")(function* (parent: Command, definition: Definition) {
    const admission = admissions.get(parent);
    if (admission === undefined || !admission.owner || parent.status !== "active" || !admission.selection.includes(definition)) return yield* Effect.fail(new CoreError({ reason: "denied" }));
    const command = Object.freeze({ ...parent });
    const selectedAdmission = { ...admission, definition, owner: false }; admissions.set(command, selectedAdmission);
    const snapshot = commandSnapshots.get(parent);
    if (snapshot !== undefined) {
      const prior = snapshots.get(snapshot);
      if (prior === undefined) return yield* Effect.fail(new CoreError({ reason: "closed" }));
      bindSnapshot(command, selectedAdmission, prior.fence, prior.expires, snapshot.creationTime);
    }
    return command;
  });
  const abort = Effect.fn("ExperimentPersistence.abort")((command: Command) => operation(async transaction => {
    if (admissions.get(command)?.owner !== true) throw new CoreError({ reason: "denied" });
    await transaction.update(tables.commands).set({ status: "aborted" }).where(and(eq(tables.commands.id, command.id),
      eq(tables.commands.token, command.token), eq(tables.commands.status, "active")));
  }));
  const resolve = Effect.fn("ExperimentPersistence.resolve")((scope: string, request: string, digest: string) => operation(async transaction => {
    await gate(transaction, scope);
    const [stored] = await transaction.select().from(tables.commands).where(and(eq(tables.commands.scope, scope), eq(tables.commands.request, request)));
    if (stored === undefined || stored.status !== "committed") throw new CoreError({ reason: "busy" });
    if (stored.digest !== digest) throw new CoreError({ reason: "identity" });
    if (!isSelection(stored.definitions)) throw new CoreError({ reason: "storage" });
    await selectedSet(transaction, stored.definitions);
    return stored.result ?? null;
  }));
  const openSnapshot = Effect.fn("ExperimentPersistence.openSnapshot")((scope: string, definition: Definition) => operation(async transaction => {
    const authority = await gate(transaction, scope); await selected(transaction, definition);
    const [time] = await transaction.select({ expires: sql<Date>`clock_timestamp() + interval '30 seconds'`.mapWith(tables.commands.expires), creationTime: databaseTime })
      .from(tables.installation).where(eq(tables.installation.singleton, true));
    if (time === undefined) throw new CoreError({ reason: "storage" });
    const snapshot = Object.freeze({ sequence: authority.seq, creationTime: time.creationTime });
    snapshots.set(snapshot, { scope, definition, selection: [definition], owner: true, fence: authority.fence, expires: time.expires }); return snapshot;
  }));
  const loadSnapshot = async (transaction: Database, snapshot: Snapshot) => {
    const admitted = snapshots.get(snapshot); if (admitted === undefined) throw new CoreError({ reason: "closed" });
    const [row] = await guards.snapshot(transaction, admitted.scope, admitted.selection, admitted.expires);
    if (row === undefined || row.count !== admitted.selection.length) throw new CoreError({ reason: "denied" });
    if (row.fence !== admitted.fence) throw new CoreError({ reason: "denied" });
    if (snapshot.sequence < row.retainedFrom || row.expired !== false) throw new CoreError({ reason: "expired" });
    return admitted;
  };
  const commandSnapshot = Effect.fn("ExperimentPersistence.commandSnapshot")((command: Command) => Effect.gen(function* () {
    const snapshot = commandSnapshots.get(command);
    if (snapshot === undefined || !snapshots.has(snapshot)) return yield* Effect.fail(new CoreError({ reason: "closed" }));
    return snapshot;
  }));
  const restart = Effect.fn("ExperimentPersistence.restart")((previous: Command) => operation(async transaction => {
    const admitted = admissions.get(previous); if (admitted === undefined || !admitted.owner || admitted.selection.length !== 1) throw new CoreError({ reason: "denied" });
    const authority = await gate(transaction, admitted.scope); await selected(transaction, admitted.definition);
    const [stored] = await transaction.select().from(tables.commands).where(eq(tables.commands.id, previous.id)).for("update");
    if (stored === undefined || stored.token !== previous.token || stored.status !== "aborted" || stored.profile !== "application" ||
      stored.fence !== authority.fence || stored.fence !== admitted.fence || !matchesSelection(stored.definitions, admitted.selection)) throw new CoreError({ reason: "closed" });
    await checkTime(transaction, stored.expires);
    const token = randomUUID();
    const [restarted] = await transaction.update(tables.commands).set({ token, snapshot: authority.seq, status: "active" }).where(eq(tables.commands.id, previous.id)).returning({ creationTime: databaseTime });
    if (restarted === undefined) throw new CoreError({ reason: "storage" });
    const priorSnapshot = commandSnapshots.get(previous); if (priorSnapshot !== undefined) snapshots.delete(priorSnapshot);
    const command: Command = Object.freeze({ ...previous, token, snapshot: authority.seq }); admissions.set(command, admitted);
    bindSnapshot(command, admitted, stored.fence, stored.expires, restarted.creationTime); return command;
  }));
  const definition = Effect.fn("ExperimentPersistence.definition")(function* (command: Command) {
    const admitted = admissions.get(command); if (admitted === undefined) return yield* Effect.fail(new CoreError({ reason: "denied" }));
    return admitted.definition;
  });
  return { metrics, operation, gate, selected, selectedSet, checkTime, load, observeCommand, readAuthority, openCommand, openGroup, participant, definition, abort, resolve,
    openSnapshot, loadSnapshot, commandSnapshot, restart, closeSnapshot: (snapshot: Snapshot) => Effect.sync(() => { snapshots.delete(snapshot); }) };
}
export type Persistence = ReturnType<typeof createPersistence>;
