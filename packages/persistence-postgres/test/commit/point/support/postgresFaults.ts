import { setTimeout as delay } from "node:timers/promises";
import { getTableName, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Schema } from "effect";
import type { PoolClient } from "pg";
import { expect } from "vitest";
import { PointCommitSqlErrorV1 } from "../../../../src/commit/point/errors";
import { type PostgresFlarexPersistence } from "../../../../src/database/postgres";
import {
  fxAppRowRevisions,
  fxAppIndexEntryRevisions,
  fxAppIndexEntryCurrent,
  fxAppUniqueKeys,
} from "../../../../src/database/schema";
import { LocatedReadCommittedTransactionFailureV1 } from "../../../../src/execution/readCommittedTransactionFailure";

/** A scoped native trigger witnesses actual DML; it never executes a commit. */
export async function withMaterializationDmlTrigger(
  persistence: PostgresFlarexPersistence,
  suffix: string,
  target: typeof fxAppRowRevisions | typeof fxAppIndexEntryRevisions | typeof fxAppIndexEntryCurrent | typeof fxAppUniqueKeys,
  timing: "before insert" | "before insert or delete" | "before insert or update or delete" | "after insert or delete",
  body: string,
  run: () => Promise<void>,
) {
  const schema = Schema.decodeUnknownSync(Schema.Struct({ namespace: Schema.String }))(
    (await persistence.query("select current_schema() as namespace")).rows[0]);
  const qualified = (name: string) => new PgDialect().sqlToQuery(sql`${sql.identifier(schema.namespace)}.${sql.identifier(name)}`).sql;
  const table = qualified(getTableName(target));
  const functionName = qualified(`fx_test_${suffix}_function`);
  const triggerName = `fx_test_${suffix}_trigger`;
  await persistence.query(`create function ${functionName}() returns trigger language plpgsql as $$
    begin ${body}
      if TG_OP='DELETE' then return OLD; end if; return NEW;
    end $$`);
  try {
    await persistence.query(`create trigger "${triggerName}" ${timing} on ${table} for each row execute function ${functionName}()`);
    try { await run(); }
    finally { await persistence.query(`drop trigger "${triggerName}" on ${table}`); }
  } finally { await persistence.query(`drop function ${functionName}()`); }
}

export async function withMaterializationDmlCounter(
  persistence: PostgresFlarexPersistence, scopeUuid: string, suffix: string,
  run: (count: () => Promise<number>) => Promise<void>,
  beforeWrite: (schemaName: string) => string = () => "",
  timing: "before insert" | "after insert or delete" = "after insert or delete",
  target: typeof fxAppUniqueKeys | typeof fxAppIndexEntryRevisions = fxAppUniqueKeys,
) {
  const schema = Schema.decodeUnknownSync(Schema.Struct({ namespace: Schema.String }))(
    (await persistence.query("select current_schema() as namespace")).rows[0]);
  const sequence = new PgDialect().sqlToQuery(sql`${sql.identifier(schema.namespace)}.${sql.identifier(`fx_test_${suffix}_sequence`)}`).sql;
  await persistence.query(`create sequence ${sequence} minvalue 1 maxvalue 1024 no cycle`);
  try {
    await withMaterializationDmlTrigger(persistence, suffix, target, timing,
      `if (TG_OP='DELETE' and OLD."${target.scopeUuid.name}"='${scopeUuid}'::uuid) or
        (TG_OP<>'DELETE' and NEW."${target.scopeUuid.name}"='${scopeUuid}'::uuid) then
        ${beforeWrite(schema.namespace)} perform nextval('${sequence}'::regclass); end if;`, async () => run(async () => {
        const row = (await persistence.query(`select (case when is_called then last_value else 0 end)::int as writes from ${sequence}`)).rows[0];
        return Schema.decodeUnknownSync(Schema.Struct({ writes: Schema.Int }))(row).writes;
      }));
  } finally { await persistence.query(`drop sequence ${sequence}`); }
}

interface CommitTriggerV1 {
  readonly triggerName: string;
  readonly functionName: string;
}

export async function installCommitSqlStateTrigger(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  sqlState: "40001" | "40P01",
  suffix: string,
): Promise<CommitTriggerV1> {
  const functionName = `fx_test_${suffix}_function`;
  const triggerName = `fx_test_${suffix}_trigger`;
  await persistence.query(
    `
      create function ${functionName}()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.scope_uuid = '${scopeUuid}'::uuid then
          raise exception 'forced ${sqlState} from PostgreSQL'
            using errcode = '${sqlState}';
        end if;
        return new;
      end
      $$
    `,
  );
  await persistence.query(
    `
      create trigger ${triggerName}
      before insert on fx_system_commit
      for each row execute function ${functionName}()
    `,
  );
  return Object.freeze({ triggerName, functionName });
}

export async function installCommitDeadlockTrigger(
  persistence: PostgresFlarexPersistence,
  firstScopeUuid: string,
  secondScopeUuid: string,
): Promise<CommitTriggerV1> {
  const functionName = "fx_test_cd0_deadlock_function";
  const triggerName = "fx_test_cd0_deadlock_trigger";
  await persistence.query(
    `
      create function ${functionName}()
      returns trigger
      language plpgsql
      as $$
      declare
        peer_key integer;
        wait_count integer := 0;
      begin
        if new.scope_uuid = '${firstScopeUuid}'::uuid then
          perform pg_advisory_xact_lock(80731, 1);
          peer_key := 2;
        elsif new.scope_uuid = '${secondScopeUuid}'::uuid then
          perform pg_advisory_xact_lock(80731, 2);
          peer_key := 1;
        else
          return new;
        end if;

        while not exists (
          select 1
          from pg_locks
          where locktype = 'advisory'
            and classid = 80731
            and objid = peer_key
            and granted
            and pid <> pg_backend_pid()
        ) loop
          wait_count := wait_count + 1;
          if wait_count > 500 then
            raise exception 'timed out preparing the CD0 deadlock';
          end if;
          perform pg_sleep(0.01);
        end loop;

        perform pg_advisory_xact_lock(80731, peer_key);
        return new;
      end
      $$
    `,
  );
  await persistence.query(
    `
      create trigger ${triggerName}
      before insert on fx_system_commit
      for each row execute function ${functionName}()
    `,
  );
  return Object.freeze({ triggerName, functionName });
}

export async function dropCommitTrigger(
  persistence: PostgresFlarexPersistence,
  trigger: CommitTriggerV1,
): Promise<void> {
  await persistence.query(
    `drop trigger ${trigger.triggerName} on fx_system_commit`,
  );
  await persistence.query(`drop function ${trigger.functionName}()`);
}

export function installClientQueryFault(
  client: PoolClient,
  fault: (statement: string, forward: () => unknown) => unknown,
): void {
  const originalQuery = client.query;
  const installed = Reflect.set(
    client,
    "query",
    (...args: ReadonlyArray<unknown>): unknown =>
      fault(postgresStatementText(args[0]), () =>
        Reflect.apply(originalQuery, client, args),
      ),
  );
  if (!installed) throw new Error("Failed to install the client query fault.");
}

function postgresStatementText(statement: unknown): string {
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

export function expectLocatedCleanupFailure(
  failure: unknown,
  expected: Readonly<{
    readonly callbackCause?: unknown;
    readonly transactionCause?: unknown;
    readonly releaseCause?: unknown;
  }>,
): void {
  if (!(failure instanceof PointCommitSqlErrorV1)) {
    throw new Error("Expected an ordinary point-commit SQL failure.");
  }
  const located = failure.cause;
  if (!(located instanceof LocatedReadCommittedTransactionFailureV1)) {
    throw new Error("Expected located transaction cleanup evidence.");
  }
  expect(located.issue).toMatchObject({
    kind: "callbackCleanupFailed",
    ...expected,
  });
}

export async function expectDifferentPoolClient(
  persistence: PostgresFlarexPersistence,
  discardedPid: number | undefined,
): Promise<void> {
  if (discardedPid === undefined) {
    throw new Error("The faulted PostgreSQL backend PID was not captured.");
  }
  const client = await persistence.pool.connect();
  try {
    expect(await postgresBackendPid(client)).not.toBe(discardedPid);
  } finally {
    client.release();
  }
}

export async function postgresBackendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ pid: number }>(
    "select pg_backend_pid()::int as pid",
  );
  const pid = result.rows[0]?.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid)) {
    throw new Error("PostgreSQL did not return a backend PID.");
  }
  return pid;
}

export async function waitForBlockedPointCommit(
  persistence: PostgresFlarexPersistence,
  expectedBlocked: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `
        select count(*)::int as blocked
        from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and cardinality(pg_blocking_pids(pid)) > 0
          and (query ilike '%fx_system_scope_clock%' or query ilike '%fx_system_scope_execution_authority%')
      `,
    );
    if ((result.rows[0]?.blocked ?? 0) >= expectedBlocked) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} blocked O06 transaction(s).`,
  );
}

export function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => resolver?.(),
  });
}

export async function withTimeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  label: string,
): Promise<Value> {
  return Promise.race([
    promise,
    delay(milliseconds).then(() => {
      throw new Error(`${label} did not complete within ${milliseconds} ms.`);
    }),
  ]);
}
