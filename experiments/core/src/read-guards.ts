import { and, asc, eq, exists, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Definition } from "./definition.ts";
import type { Database } from "./persistence.ts";
import { CoreError } from "./errors.ts";
import * as tables from "./schema.ts";

const authorityRow = alias(tables.authorities, "authority_gate");
const installationRow = alias(tables.installation, "installation_gate");
const grantRow = alias(tables.grants, "grant_gate");
const definitionRow = alias(tables.definitions, "definition_gate");
type ScopeParameter = string | ReturnType<typeof sql.placeholder>;

export const authorityQuery = (transaction: Database, scope: ScopeParameter) => transaction
  .select({ fence: authorityRow.fence, seq: tables.clocks.seq, retainedFrom: authorityRow.retainedFrom })
  .from(authorityRow).innerJoin(tables.clocks, eq(tables.clocks.scope, authorityRow.scope))
  .innerJoin(grantRow, and(eq(grantRow.scope, authorityRow.scope), eq(grantRow.principal, sql`current_user`)))
  .innerJoin(installationRow, eq(installationRow.singleton, true))
  .where(and(eq(authorityRow.scope, scope), eq(authorityRow.enabled, true), eq(installationRow.active, true)))
  .for("share", { of: [authorityRow, installationRow, grantRow] });

export const verifySelection = (selection: readonly Pick<Definition, "table" | "version">[]) => {
  if (selection.length === 0 || selection.length > 16 || new Set(selection.map(item => item.table)).size !== selection.length)
    throw new CoreError({ reason: "unsupported" });
};
export const selectionQuery = (transaction: Database, selection: readonly Pick<Definition, "table" | "version">[], predecessor?: SQL) =>
  transaction.select({ version: definitionRow.version }).from(definitionRow)
    .where(and(predecessor, or(...selection.map(definition => and(eq(definitionRow.table, definition.table), eq(definitionRow.version, definition.version))))))
    .orderBy(asc(definitionRow.table)).for("share");

/** The same locking CTE chain as the combined guard. Only immutable SQL and
 * result-mapping plans survive a call; every execute reacquires every lock. */
const readSelection = (transaction: Database, selection: readonly Definition[]) => {
  const authority = transaction.$with("observed_authority").as(authorityQuery(transaction, sql.placeholder("scope")));
  const definitions = transaction.$with("observed_definitions").as(selectionQuery(transaction, selection,
    exists(transaction.select({ present: sql`1` }).from(authority))));
  const proof = transaction.$with("observed_selection").as(transaction.select({ count: sql<number>`count(*)::integer`.as("count") }).from(definitions));
  return { authority, definitions, proof };
};
const prepareAuthority = (transaction: Database, selection: readonly Definition[]) => {
  const { authority, definitions, proof } = readSelection(transaction, selection);
  return transaction.with(authority, definitions, proof).select().from(authority).innerJoin(proof, sql`true`).prepare("");
};
const commandSelection = (transaction: Database, selection: readonly Definition[], lock: "share" | "update") => {
  const { authority, definitions, proof } = readSelection(transaction, selection);
  const stored = transaction.$with("observed_command").as(transaction.select().from(tables.commands)
    .where(and(eq(tables.commands.id, sql.placeholder("command")), exists(transaction.select({ present: sql`1` }).from(proof).where(eq(proof.count, selection.length)))))
    .for(lock));
  return { authority, definitions, proof, stored };
};
const prepareAccept = (transaction: Database, selection: readonly Definition[]) => {
  const { authority, definitions, proof, stored } = commandSelection(transaction, selection, "update");
  return transaction.with(authority, definitions, proof, stored).select().from(authority)
    .innerJoin(proof, sql`true`).leftJoin(stored, sql`true`).prepare("");
};
const prepareCommand = (transaction: Database, selection: readonly Definition[]) => {
  const { authority, definitions, proof, stored } = commandSelection(transaction, selection, "share");
  const deadline = transaction.$with("observed_deadline").as(transaction.select({ expired: sql<boolean>`clock_timestamp() >= ${stored.expires}`.as("expired") }).from(stored));
  return transaction.with(authority, definitions, proof, stored, deadline).select().from(authority)
    .innerJoin(proof, sql`true`).leftJoin(stored, sql`true`).leftJoin(deadline, sql`true`).prepare("");
};
const prepareSnapshot = (transaction: Database, selection: readonly Definition[]) => {
  const { authority, definitions, proof } = readSelection(transaction, selection);
  return transaction.with(authority, definitions, proof).select({ fence: authority.fence, retainedFrom: authority.retainedFrom,
    count: proof.count, expired: sql<boolean>`case when ${proof.count} = ${selection.length} then clock_timestamp() >= ${sql.placeholder("expires")} else true end` })
    .from(authority).innerJoin(proof, sql`true`).prepare("");
};

/** Client-bound, bounded statement plans. Empty names keep PostgreSQL's unnamed
 * protocol: there is no server prepared-statement/Hyperdrive affinity claim.
 * Cache keys contain exactly the selected table/version sequence, never scope,
 * command, expiry, a prior verdict or returned rows. FIFO eviction only recompiles.
 * PGlite transaction facades naturally expire with their transaction. */
export function createReadGuards() {
  const authorities = new WeakMap<Database, Map<string, ReturnType<typeof prepareAuthority>>>();
  const commands = new WeakMap<Database, Map<string, ReturnType<typeof prepareCommand>>>();
  const accepting = new WeakMap<Database, Map<string, ReturnType<typeof prepareAccept>>>();
  const snapshots = new WeakMap<Database, Map<string, ReturnType<typeof prepareSnapshot>>>();
  const cached = <Q>(cache: WeakMap<Database, Map<string, Q>>, database: Database, selection: readonly Definition[], build: () => Q) => {
    verifySelection(selection);
    let plans = cache.get(database);
    if (plans === undefined) { plans = new Map(); cache.set(database, plans); }
    const key = JSON.stringify(selection.map(({ table, version }) => [table, version]));
    const existing = plans.get(key); if (existing !== undefined) return existing;
    const plan = build();
    if (plans.size >= 32) { const first = plans.keys().next().value; if (first !== undefined) plans.delete(first); }
    plans.set(key, plan); return plan;
  };
  return {
    authority: (database: Database, scope: string, selection: readonly Definition[]) =>
      cached(authorities, database, selection, () => prepareAuthority(database, selection)).execute({ scope }),
    command: (database: Database, scope: string, selection: readonly Definition[], command: string) =>
      cached(commands, database, selection, () => prepareCommand(database, selection)).execute({ scope, command }),
    accepting: (database: Database, scope: string, selection: readonly Definition[], command: string) =>
      cached(accepting, database, selection, () => prepareAccept(database, selection)).execute({ scope, command }),
    snapshot: (database: Database, scope: string, selection: readonly Definition[], expires: Date) =>
      cached(snapshots, database, selection, () => prepareSnapshot(database, selection)).execute({ scope, expires }),
  };
}
