import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { isNonArrayRecord } from "@flarex/utils/records";
import { sql } from "drizzle-orm";
import { Result } from "effect";
import { Client, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "../src/postgresLocatedReadCommitted";
import {
  TaskRepairSchedulerConfirmedRollbackV1Error,
  createTaskRepairSchedulerCheckpointV1,
} from "../src/taskRepairSchedulerCheckpointV1";
import {
  applyTaskRepairPostgresDeadlinePolicyV1,
  createTaskRepairPostgresDeadlinePolicyV1,
} from "../src/taskRepairPostgresDeadlinePolicyV1";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  isLocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const OWNER = "7b000000-0000-4000-8000-000000000001";
const locator = Object.freeze({
  kind: "shared_database",
  databaseKey: "task-repair-deadline-postgres",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;
const policy = Result.getOrThrow(
  createTaskRepairPostgresDeadlinePolicyV1({
    connectionTimeoutMilliseconds: 250,
    lockTimeoutMilliseconds: 150,
    statementTimeoutMilliseconds: 500,
    transactionTimeoutMilliseconds: 1_000,
    settlementReserveMilliseconds: 1_500,
  }),
);

describe("DTE05-E2C2 PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL 18 URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE05-E2C2.",
    ).not.toBeNull();
  });
});

describePostgres("real Postgres DTE05-E2C2 Task repair deadlines", () => {
  it("installs all deadlines before scheduler work and settles a blocked lock as a confirmed rollback", async () => {
    await withDeadlinePersistence(async (persistence, blockerOptions) => {
      await expectDeadlineSettings(persistence);
      const beforePid = await backendPid(persistence);
      const blocker = new Client(blockerOptions);
      await blocker.connect();
      try {
        await blocker.query("begin");
        await blocker.query(
          "select 1 from fx_system_durable_task_repair_scheduler_v1 " +
            "for update",
        );
        const checkpoint = checkpointRepository(persistence);
        const startedAt = Date.now();
        let failure: unknown;
        try {
          await runEffect(checkpoint.acquireEffect());
        } catch (cause) {
          failure = cause;
        }
        expect(Date.now() - startedAt).toBeLessThan(2_000);
        expect(failure).toBeInstanceOf(
          TaskRepairSchedulerConfirmedRollbackV1Error,
        );
        if (failure instanceof TaskRepairSchedulerConfirmedRollbackV1Error) {
          expect(postgresCode(failure.cause)).toBe("55P03");
        }
      } finally {
        await blocker.query("rollback").catch(() => undefined);
        await blocker.end();
      }
      expect(await backendPid(persistence)).toBe(beforePid);
      await expect(
        runEffect(checkpointRepository(persistence).acquireEffect()),
      ).resolves.toMatchObject({ kind: "acquired" });
    });
  }, 60_000);

  it("cancels a long statement, settles rollback, and safely reuses the connection", async () => {
    await withDeadlinePersistence(async (persistence) => {
      const target = locatedTarget(persistence);
      const beforePid = await backendPid(persistence);
      const startedAt = Date.now();
      let failure: unknown;
      try {
        await target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
          await tx.execute(sql`select pg_sleep(2)`);
        });
      } catch (cause) {
        failure = cause;
      }
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(failure).toBeInstanceOf(
        LocatedReadCommittedTransactionFailureV1,
      );
      if (failure instanceof LocatedReadCommittedTransactionFailureV1) {
        expect(failure.issue.kind).toBe("callbackRolledBack");
        if (failure.issue.kind === "callbackRolledBack") {
          expect(postgresCode(failure.issue.callbackCause)).toBe("57014");
        }
      }
      expect(await backendPid(persistence)).toBe(beforePid);
    });
  }, 60_000);

  it("waits for whole-transaction termination, supplies a discard reason, and replaces the connection", async () => {
    await withDeadlinePersistence(async (persistence) => {
      let terminatedPid: number | undefined;
      let observedDiscard: Error | undefined;
      let releaseCompleted = false;
      const run = createPostgresLocatedReadCommittedTransactionRunnerV1(
        persistence.pool,
        {
          afterAcquire: async (client) => {
            terminatedPid = await clientBackendPid(client);
          },
          release: (client, discardError) => {
            observedDiscard = discardError;
            client.release(discardError);
            releaseCompleted = true;
          },
        },
      );

      const startedAt = Date.now();
      let failure: unknown;
      try {
        await run(async (tx) => {
          await delay(1_250);
          await tx.execute(sql`select 1`);
        });
      } catch (cause) {
        failure = cause;
      }

      expect(Date.now() - startedAt).toBeLessThan(3_000);
      expect(releaseCompleted).toBe(true);
      expect(observedDiscard).toBeInstanceOf(Error);
      expect(failure).toBeInstanceOf(
        LocatedReadCommittedTransactionFailureV1,
      );
      if (failure instanceof LocatedReadCommittedTransactionFailureV1) {
        expect(failure.issue.kind).toBe("callbackCleanupFailed");
        if (failure.issue.kind === "callbackCleanupFailed") {
          expect(postgresCode(failure.issue.transactionCause)).toBe("25P04");
        }
      }
      expect(terminatedPid).toEqual(expect.any(Number));
      expect(await backendPid(persistence)).not.toBe(terminatedPid);
      await expect(persistence.query("select 1 as healthy")).resolves
        .toMatchObject({ rows: [{ healthy: 1 }] });
    });
  }, 60_000);

  it("bounds saturated-pool acquisition and recovers after capacity returns", async () => {
    await withDeadlinePersistence(async (persistence) => {
      const held = await persistence.pool.connect();
      try {
        const run = createPostgresLocatedReadCommittedTransactionRunnerV1(
          persistence.pool,
        );
        const startedAt = Date.now();
        let failure: unknown;
        try {
          await run(async () => "forbidden");
        } catch (cause) {
          failure = cause;
        }
        expect(Date.now() - startedAt).toBeLessThan(2_000);
        expect(failure).toBeInstanceOf(
          LocatedReadCommittedTransactionFailureV1,
        );
        if (failure instanceof LocatedReadCommittedTransactionFailureV1) {
          expect(failure.issue).toMatchObject({
            kind: "infrastructureFailure",
            phase: "acquire",
          });
        }
      } finally {
        held.release();
      }
      await expect(persistence.query("select 1 as healthy")).resolves
        .toMatchObject({ rows: [{ healthy: 1 }] });
    });
  }, 60_000);
});

function checkpointRepository(
  persistence: PostgresFlarexPersistence,
) {
  return createTaskRepairSchedulerCheckpointV1(locatedTarget(persistence), {
    claimDurationMilliseconds: 60_000,
    randomUuid: () => OWNER,
  });
}

function locatedTarget(persistence: PostgresFlarexPersistence) {
  const target = createPostgresLocatedPointMutationSessionActivationTargetV1(
    persistence,
    locator,
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located READ COMMITTED Postgres target.");
  }
  return target;
}

async function expectDeadlineSettings(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const version = await persistence.query<{ server_version: string }>(
    "show server_version",
  );
  expect(version.rows[0]?.server_version).toMatch(/^18\./);
  const settings = await persistence.query<{
    lock_ms: number;
    statement_ms: number;
    transaction_ms: number;
  }>(`
    select
      round(extract(epoch from current_setting('lock_timeout')::interval)
        * 1000)::int as lock_ms,
      round(extract(epoch from current_setting('statement_timeout')::interval)
        * 1000)::int as statement_ms,
      round(extract(epoch from current_setting('transaction_timeout')::interval)
        * 1000)::int as transaction_ms
  `);
  expect(settings.rows[0]).toEqual({
    lock_ms: 150,
    statement_ms: 500,
    transaction_ms: 1_000,
  });
}

async function backendPid(
  persistence: PostgresFlarexPersistence,
): Promise<number> {
  const result = await persistence.query<{ pid: number }>(
    "select pg_backend_pid()::int as pid",
  );
  const pid = result.rows[0]?.pid;
  if (typeof pid !== "number") throw new Error("Postgres PID is missing.");
  return pid;
}

async function clientBackendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ pid: number }>(
    "select pg_backend_pid()::int as pid",
  );
  const pid = result.rows[0]?.pid;
  if (typeof pid !== "number") throw new Error("Postgres PID is missing.");
  return pid;
}

function postgresCode(cause: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = cause;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (!isNonArrayRecord(current)) return undefined;
    const code = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

async function withDeadlinePersistence(
  operation: (
    persistence: PostgresFlarexPersistence,
    blockerOptions: Readonly<{
      connectionString: string;
      options: string | undefined;
    }>,
  ) => Promise<void>,
): Promise<void> {
  const fixture = await makeTaskRepairMigrationFixture();
  try {
    await withTemporaryPostgresSchema(async (databaseOptions) => {
      const poolConfig = Result.getOrThrow(
        applyTaskRepairPostgresDeadlinePolicyV1({
          ...databaseOptions.poolConfig,
          connectionString: databaseOptions.connectionString,
          max: 1,
        }, policy),
      );
      const persistence = await createPostgresPersistence({
        migrationsSchema: databaseOptions.migrationsSchema,
        poolConfig,
        migrationsFolder: fixture.migrationsFolder,
      });
      try {
        await persistence.migrate();
        await operation(persistence, Object.freeze({
          connectionString: databaseOptions.connectionString,
          options: databaseOptions.poolConfig.options,
        }));
      } finally {
        await persistence.close();
      }
    });
  } finally {
    await fixture.cleanup();
  }
}

async function makeTaskRepairMigrationFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-dte05-e2c2-pg-"));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = resolve(packageRoot, "drizzle");
  const journalPath = resolve(migrationsFolder, "meta/_journal.json");
  await cp(source, migrationsFolder, { recursive: true });
  const parsed: unknown = JSON.parse(await readFile(journalPath, "utf8"));
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Drizzle journal must contain an entries array.");
  }
  const entries = parsed.entries.filter((entry) =>
    isNonArrayRecord(entry) && entry.idx === 48
  );
  if (entries.length !== 1) {
    throw new Error("Expected exactly one DTE05-E2A migration entry.");
  }
  await writeFile(journalPath, JSON.stringify({
    ...parsed,
    entries,
  }, null, 2), "utf8");
  return Object.freeze({
    migrationsFolder,
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
}
