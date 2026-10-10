import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { Result } from "effect";
import { type PoolClient } from "pg";
import { type PostgresFlarexPersistence } from "../../../../src/database/postgres";
import { type AppRowTransaction } from "../../../../src/storage/documents/appRows";
import { rowsFromDriverExecuteResult } from "../../../../src/database/driverExecuteResult";
import { rollbackAndReleasePostgresClient } from "../../../support/postgresHelpers";
import { type ActivationContext } from "./postgresFixture";

export interface HeldScopeClock {
  readonly client: PoolClient;
  readonly blockerPid: number;
}

export async function holdScopeClock(
  persistence: PostgresFlarexPersistence,
  scopeId: ActivationContext["scopeId"],
): Promise<HeldScopeClock> {
  const client = await persistence.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `select 1 from fx_system_scope_clock where scope_id = $1 for update`,
      [scopeId],
    );
    const pid = await client.query<{ pid: number }>(
      "select pg_backend_pid()::int as pid",
    );
    const blockerPid = pid.rows[0]?.pid;
    if (blockerPid === undefined) {
      throw new Error("Scope-clock lock returned no backend PID.");
    }
    return Object.freeze({ client, blockerPid });
  } catch (cause) {
    await rollbackAndReleasePostgresClient(client);
    throw cause;
  }
}

export async function waitForBlockedScopeClock(
  persistence: PostgresFlarexPersistence,
  held: HeldScopeClock,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `select count(*)::int as blocked
       from pg_stat_activity
       where $1::int = any(pg_blocking_pids(pid))
         and datname = current_database()
         and wait_event_type = 'Lock'`,
      [held.blockerPid],
    );
    if ((result.rows[0]?.blocked ?? 0) >= 1) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for a blocked scope-clock lock.");
}

export async function waitForBlockedAttemptTail(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(`select count(*)::int as blocked
      from pg_stat_activity where datname = current_database()
        and wait_event_type = 'Lock' and $1::int = any(pg_blocking_pids(pid))
        -- The function name follows 2kB of native projections and is truncated
        -- by the default activity buffer. This leading projection is stable.
        and query like 'select attempt_tail.disposition,%'`, [blockerPid]);
    if ((result.rows[0]?.blocked ?? 0) > 0) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for the running-attempt tail claim lock");
}

export interface BlockedPostgresWriter {
  readonly pid: number;
  readonly blockers: readonly number[];
}

export async function waitForBlockedSharedScopeClockWriter(
  persistence: PostgresFlarexPersistence,
  candidateBlockerPids: readonly number[],
  expectedWriterPid?: number,
): Promise<BlockedPostgresWriter> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{
      pid: number;
      blockers: number[];
    }>(
      `select pid::int as pid, pg_blocking_pids(pid)::int[] as blockers
       from pg_stat_activity
       where datname = current_database()
         and wait_event_type = 'Lock'
         and cardinality(pg_blocking_pids(pid)) > 0
         and query like '%fx_system_scope_clock%'
         and ($1::int is null or pid = $1::int)
         and exists (
           select 1
           from unnest($2::int[]) candidate(blocker_pid)
           where candidate.blocker_pid = any(pg_blocking_pids(pid))
         )`,
      [expectedWriterPid ?? null, candidateBlockerPids],
    );
    if (result.rows.length === 1) {
      const row = result.rows[0];
      if (
        row !== undefined &&
        Number.isInteger(row.pid) &&
        row.pid > 0 &&
        Array.isArray(row.blockers) &&
        row.blockers.every((pid) => Number.isInteger(pid) && pid > 0)
      ) {
        return Object.freeze({
          pid: row.pid,
          blockers: Object.freeze([...row.blockers]),
        });
      }
      throw new Error("Postgres returned invalid blocked-writer evidence.");
    }
    await delay(25);
  }
  throw new Error("Timed out waiting for the shared scope-clock writer.");
}

export async function transactionBackendPid(
  tx: AppRowTransaction,
): Promise<number> {
  const result = await tx.execute<{ pid: number }>(
    sql`select pg_backend_pid()::int as pid`,
  );
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw new Error("Postgres returned an invalid backend PID row set.");
  });
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null) {
    throw new Error("Postgres did not return a backend PID.");
  }
  const pid = Reflect.get(row, "pid");
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error("Postgres returned an invalid backend PID.");
  }
  return pid;
}

export async function waitForTransactionEntryOrFailure<Result>(
  entry: Promise<Result>,
  operation: Promise<unknown>,
  label: string,
): Promise<Result> {
  return Promise.race([
    entry,
    operation.then(
      () => Promise.reject(new Error(`${label} settled before admission.`)),
      (cause) => Promise.reject(cause),
    ),
    delay(5_000).then(() => Promise.reject(
      new Error(`Timed out waiting for ${label} admission.`),
    )),
  ]);
}

export function installClientQueryFault(
  client: PoolClient,
  fault: (
    statement: string,
    forward: () => unknown,
  ) => unknown,
): void {
  const originalQuery = client.query;
  const installed = Reflect.set(
    client,
    "query",
    (...args: ReadonlyArray<unknown>): unknown => fault(
      postgresStatementText(args[0]),
      () => Reflect.apply(originalQuery, client, args),
    ),
  );
  if (!installed) throw new Error("Failed to install a client query fault.");
}

export function postgresStatementText(statement: unknown): string {
  if (typeof statement === "string") return statement.trim().toLowerCase();
  if (
    typeof statement === "object" &&
    statement !== null &&
    "text" in statement &&
    typeof statement.text === "string"
  ) {
    return statement.text.trim().toLowerCase();
  }
  return "";
}

export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (resolvePromise === undefined) {
        throw new Error("Deferred resolver is unavailable.");
      }
      resolvePromise(value);
    },
  };
}
