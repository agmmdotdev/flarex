import {
  cp,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { Result } from "effect";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import {
  MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH,
  type TransactionAuthorizationRevocationEpoch,
} from "flarex-protocol/transaction-session";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import { describe, expect, it } from "vitest";

import {
  resolveCurrentScopeAuthorizationEpochEffect,
  type FlarexPersistence,
} from "../src";
import { runEffect } from "./effectTestRuntime";
import {
  createPostgresLocatedScopeAuthorizationEpochTarget,
  createPostgresPersistence,
} from "../src/postgres";
import {
  advanceScopeAuthorizationRevocationEpochInTransaction,
  lockScopeClockForUpdateInTransaction,
  requireScopeAuthorizationRevocationEpochInTransaction as requireScopeAuthorizationRevocationEpochResultInTransaction,
  ScopeAuthorizationRevocationEpochExhaustedError,
} from "../src/scopeClock";
import type {
  SharedDatabaseScopePhysicalLocator,
} from "../src/scopeMetadataTypes";
import { fxSystemScopeClocks } from "../src/schema";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";
import {
  insertSessionTestScope,
  insertTransactionSessionFixture,
  transactionSessionFixture,
  transactionSessionIdAt,
} from "./sessionAuthorityTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres scope clock locking", () => {
  it("blocks the same scope, permits another scope, and rolls back the probe", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const lockedScopeId = ScopeIdSchema.make("scope_clock_pg_locked");
      const independentScopeId = ScopeIdSchema.make(
        "scope_clock_pg_independent",
      );
      await insertScopeClock(persistence, lockedScopeId, "epoch-locked");
      await insertScopeClock(
        persistence,
        independentScopeId,
        "epoch-independent",
      );
      const before = await persistence.getScopeClock(lockedScopeId);
      if (before === null) {
        throw new Error("Expected the real Postgres scope-clock fixture.");
      }

      const releaseLocker = new Deferred<void>();
      const lockerPidReady = new Deferred<number>();
      const waiterPidReady = new Deferred<number>();
      const lockerTransaction = persistence.drizzle.transaction(async (tx) => {
        try {
          const lockerPid = await backendPid(tx);
          await lockScopeClockForUpdateInTransaction(tx, lockedScopeId);
          await tx
            .update(fxSystemScopeClocks)
            .set({
              storageGeneration:
                FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
              storageGenerationFence:
                StorageGenerationFenceSchema.make(2n),
              lastCommitSeq: CommitSeqSchema.make(1n),
              lastOutboxSeq: OutboxSeqSchema.make(1n),
              epoch: ScopeEpochSchema.make("epoch-tentative"),
              updatedAt: new Date("2026-07-11T00:00:00.000Z"),
            })
            .where(sql`${fxSystemScopeClocks.scopeId} = ${lockedScopeId}`);
          lockerPidReady.resolve(lockerPid);
          await releaseLocker.promise;
          throw new Error("scope-clock-postgres-rollback-probe");
        } catch (error) {
          lockerPidReady.reject(error);
          throw error;
        }
      });
      void lockerTransaction.catch(() => undefined);

      const lockerPid = await lockerPidReady.promise;
      const waiterTransaction = persistence.drizzle.transaction(async (tx) => {
        try {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          await tx.execute(sql`set local statement_timeout = '15s'`);
          const waiterPid = await backendPid(tx);
          waiterPidReady.resolve(waiterPid);
          return await lockScopeClockForUpdateInTransaction(tx, lockedScopeId);
        } catch (error) {
          waiterPidReady.reject(error);
          throw error;
        }
      });
      void waiterTransaction.catch(() => undefined);

      try {
        const waiterPid = await waiterPidReady.promise;
        await waitForBlockedScopeClockRead(
          persistence,
          waiterPid,
          lockerPid,
        );

        await expect(
          persistence.drizzle.transaction((tx) =>
            lockScopeClockForUpdateInTransaction(tx, independentScopeId),
          ),
        ).resolves.toMatchObject({
          scopeId: independentScopeId,
          lastCommitSeq: 0n,
        });

        releaseLocker.resolve(undefined);
        await expect(lockerTransaction).rejects.toThrow(
          "scope-clock-postgres-rollback-probe",
        );
        await expect(waiterTransaction).resolves.toMatchObject({
          scopeId: lockedScopeId,
          storageGeneration: "legacy_v1",
          storageGenerationFence: 1n,
          lastCommitSeq: 0n,
          lastOutboxSeq: 0n,
          epoch: "epoch-locked",
        });
      } finally {
        releaseLocker.resolve(undefined);
        await Promise.allSettled([lockerTransaction, waiterTransaction]);
      }

      await expect(persistence.getScopeClock(lockedScopeId)).resolves.toEqual(
        before,
      );
    });
  });

  it("serializes concurrent same-scope authorization increments without lost updates", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scopeId = ScopeIdSchema.make("scope_authorization_pg_concurrent");
      await insertScopeClock(
        persistence,
        scopeId,
        "epoch-authorization-concurrent",
      );

      const results = await Promise.all([
        persistence.drizzle.transaction((tx) =>
          advanceScopeAuthorizationRevocationEpochInTransaction(tx, scopeId),
        ),
        persistence.drizzle.transaction((tx) =>
          advanceScopeAuthorizationRevocationEpochInTransaction(tx, scopeId),
        ),
      ]);

      expect(results.sort((left, right) => Number(left.current - right.current)))
        .toEqual([
          { previous: 0n, current: 1n },
          { previous: 1n, current: 2n },
        ]);
      await expect(
        persistence.drizzle.transaction((tx) =>
          requireScopeAuthorizationRevocationEpochInTransaction(tx, scopeId),
        ),
      ).resolves.toBe(2n);
    });
  });

  it("admits against the epoch read from the independently located Postgres target", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
        "deployment_epoch_pg",
      );
      const scopeId = ScopeIdSchema.make(
        "scope_50000000-0000-4000-8000-000000000001",
      );
      const physicalLocator = Object.freeze({
        kind: "shared_database",
        databaseKey: "scope-epoch-postgres",
        schemaName: "public",
      }) satisfies SharedDatabaseScopePhysicalLocator;
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: "project_epoch_pg",
      });
      await persistence.insertScopeMetadata({
        scopeId,
        deploymentId,
        physicalLocator,
      });
      await insertScopeClock(
        persistence,
        scopeId,
        "epoch_50000000-0000-4000-8000-000000000002",
      );
      const ports = {
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error("Shared scope resolution must not read receipts.");
          },
        },
        scopeEpochTargets: {
          resolve: async () =>
            createPostgresLocatedScopeAuthorizationEpochTarget(
              persistence,
              physicalLocator,
            ),
        },
      };

      await expect(
        runEffect(
          resolveCurrentScopeAuthorizationEpochEffect(deploymentId, ports),
        ),
      ).resolves.toMatchObject({
        deploymentId,
        scopeId,
        authorizationRevocationEpoch: 0n,
      });
      await persistence.drizzle.transaction((tx) =>
        advanceScopeAuthorizationRevocationEpochInTransaction(tx, scopeId),
      );
      await expect(
        runEffect(
          resolveCurrentScopeAuthorizationEpochEffect(deploymentId, ports),
        ),
      ).resolves.toMatchObject({ authorizationRevocationEpoch: 1n });
    });
  });

  it("allows shared authorization readers while an increment waits", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scopeId = ScopeIdSchema.make("scope_authorization_pg_shared");
      await insertScopeClock(
        persistence,
        scopeId,
        "epoch-authorization-shared",
      );

      const releaseReader = new Deferred<void>();
      const readerPidReady = new Deferred<number>();
      const incrementPidReady = new Deferred<number>();
      const heldReader = persistence.drizzle.transaction(async (tx) => {
        try {
          const readerPid = await backendPid(tx);
          await requireScopeAuthorizationRevocationEpochInTransaction(
            tx,
            scopeId,
          );
          readerPidReady.resolve(readerPid);
          await releaseReader.promise;
        } catch (error) {
          readerPidReady.reject(error);
          throw error;
        }
      });
      void heldReader.catch(() => undefined);

      const readerPid = await readerPidReady.promise;
      await expect(
        persistence.drizzle.transaction((tx) =>
          requireScopeAuthorizationRevocationEpochInTransaction(tx, scopeId),
        ),
      ).resolves.toBe(0n);

      const waitingIncrement = persistence.drizzle.transaction(async (tx) => {
        try {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          await tx.execute(sql`set local statement_timeout = '15s'`);
          const incrementPid = await backendPid(tx);
          incrementPidReady.resolve(incrementPid);
          return await advanceScopeAuthorizationRevocationEpochInTransaction(
            tx,
            scopeId,
          );
        } catch (error) {
          incrementPidReady.reject(error);
          throw error;
        }
      });
      void waitingIncrement.catch(() => undefined);

      try {
        const incrementPid = await incrementPidReady.promise;
        await waitForBlockedScopeClockRead(
          persistence,
          incrementPid,
          readerPid,
        );
        releaseReader.resolve(undefined);
        await expect(heldReader).resolves.toBeUndefined();
        await expect(waitingIncrement).resolves.toEqual({
          previous: 0n,
          current: 1n,
        });
      } finally {
        releaseReader.resolve(undefined);
        await Promise.allSettled([heldReader, waitingIncrement]);
      }
    });
  });

  it("isolates scope authorization locks and advances after a competing rollback", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const lockedScopeId = ScopeIdSchema.make(
        "scope_authorization_pg_locked",
      );
      const independentScopeId = ScopeIdSchema.make(
        "scope_authorization_pg_independent",
      );
      await insertScopeClock(
        persistence,
        lockedScopeId,
        "epoch-authorization-locked",
      );
      await insertScopeClock(
        persistence,
        independentScopeId,
        "epoch-authorization-independent",
      );

      const releaseLocker = new Deferred<void>();
      const lockerPidReady = new Deferred<number>();
      const waiterPidReady = new Deferred<number>();
      const lockerTransaction = persistence.drizzle.transaction(async (tx) => {
        try {
          const lockerPid = await backendPid(tx);
          await advanceScopeAuthorizationRevocationEpochInTransaction(
            tx,
            lockedScopeId,
          );
          lockerPidReady.resolve(lockerPid);
          await releaseLocker.promise;
          throw new Error("authorization-epoch-postgres-rollback-probe");
        } catch (error) {
          lockerPidReady.reject(error);
          throw error;
        }
      });
      void lockerTransaction.catch(() => undefined);

      const lockerPid = await lockerPidReady.promise;
      const waiterTransaction = persistence.drizzle.transaction(async (tx) => {
        try {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          await tx.execute(sql`set local statement_timeout = '15s'`);
          const waiterPid = await backendPid(tx);
          waiterPidReady.resolve(waiterPid);
          return await advanceScopeAuthorizationRevocationEpochInTransaction(
            tx,
            lockedScopeId,
          );
        } catch (error) {
          waiterPidReady.reject(error);
          throw error;
        }
      });
      void waiterTransaction.catch(() => undefined);

      try {
        const waiterPid = await waiterPidReady.promise;
        await waitForBlockedScopeClockRead(
          persistence,
          waiterPid,
          lockerPid,
        );
        await expect(
          persistence.drizzle.transaction((tx) =>
            advanceScopeAuthorizationRevocationEpochInTransaction(
              tx,
              independentScopeId,
            ),
          ),
        ).resolves.toEqual({ previous: 0n, current: 1n });

        releaseLocker.resolve(undefined);
        await expect(lockerTransaction).rejects.toThrow(
          "authorization-epoch-postgres-rollback-probe",
        );
        await expect(waiterTransaction).resolves.toEqual({
          previous: 0n,
          current: 1n,
        });
      } finally {
        releaseLocker.resolve(undefined);
        await Promise.allSettled([lockerTransaction, waiterTransaction]);
      }

      await expect(
        persistence.drizzle.transaction((tx) =>
          requireScopeAuthorizationRevocationEpochInTransaction(
            tx,
            lockedScopeId,
          ),
        ),
      ).resolves.toBe(1n);
      await expect(
        persistence.drizzle.transaction((tx) =>
          requireScopeAuthorizationRevocationEpochInTransaction(
            tx,
            independentScopeId,
          ),
        ),
      ).resolves.toBe(1n);
    });
  });

  it("rejects authorization epoch exhaustion without changing the row", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scopeId = ScopeIdSchema.make("scope_authorization_pg_exhausted");
      await insertScopeClock(
        persistence,
        scopeId,
        "epoch-authorization-exhausted",
      );
      await persistence.query(
        `
          update fx_system_scope_clock
          set authorization_revocation_epoch = $2
          where scope_id = $1
        `,
        [
          scopeId,
          MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH.toString(),
        ],
      );

      await expect(
        persistence.drizzle.transaction((tx) =>
          advanceScopeAuthorizationRevocationEpochInTransaction(tx, scopeId),
        ),
      ).rejects.toBeInstanceOf(
        ScopeAuthorizationRevocationEpochExhaustedError,
      );
      await expect(
        persistence.drizzle.transaction((tx) =>
          requireScopeAuthorizationRevocationEpochInTransaction(tx, scopeId),
        ),
      ).resolves.toBe(MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH);
    });
  });

  it("upgrades, rolls back, recovers, and replays the S07-A migration", async () => {
    const testRoot = await mkdtemp(
      resolve(tmpdir(), "flarex-revocation-epoch-postgres-"),
    );
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0026-journal.json",
    );
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const migrationName = "0027_graceful_silver_fox.sql";
    const copiedMigration = resolve(migrationsFolder, migrationName);

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      await copyFile(
        previousJournal,
        resolve(migrationsFolder, "meta/_journal.json"),
      );
      await withTemporaryPostgresSchema(async (databaseOptions) => {
        const previousPersistence = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder,
        });
        let currentPersistence:
          | Awaited<ReturnType<typeof createPostgresPersistence>>
          | undefined;
        try {
          await previousPersistence.migrate();
          await insertSessionTestScope(previousPersistence);
          const sessionId = transactionSessionIdAt(28);
          await insertTransactionSessionFixture(
            previousPersistence,
            transactionSessionFixture(sessionId, {
              authorizationRevocationEpoch: "23",
            }),
          );
          await expect(
            previousPersistence.query(
              `select authorization_revocation_epoch from fx_system_scope_clock`,
            ),
          ).rejects.toThrow();

          await copyFile(
            currentJournal,
            resolve(migrationsFolder, "meta/_journal.json"),
          );
          const realMigration = await readFile(copiedMigration, "utf8");
          await writeFile(
            copiedMigration,
            `${realMigration}\n--> statement-breakpoint\nselect * from fx_s07a_deliberate_missing_table;\n`,
            "utf8",
          );
          currentPersistence = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder,
          });
          await expect(currentPersistence.migrate()).rejects.toThrow();

          const absent = await currentPersistence.query<{ column_name: string }>(`
            select column_name
            from information_schema.columns
            where table_name = 'fx_system_scope_clock'
              and column_name = 'authorization_revocation_epoch'
              and table_schema = current_schema()
          `);
          expect(absent.rows).toEqual([]);
          const failedReceipts = await currentPersistence.query<{ count: string }>(`
            select count(*)::text as count
            from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations
          `);
          expect(failedReceipts.rows).toEqual([{ count: "27" }]);

          await copyFile(
            resolve(currentMigrationsFolder, migrationName),
            copiedMigration,
          );
          await expect(currentPersistence.migrate()).resolves.toBeUndefined();
          await expect(currentPersistence.migrate()).resolves.toBeUndefined();
          const preserved = await currentPersistence.query<{
            clock_epoch: string;
            session_epoch: string;
          }>(
            `
              select
                clock.authorization_revocation_epoch::text as clock_epoch,
                session.authorization_revocation_epoch::text as session_epoch
              from fx_system_scope_clock as clock
              join fx_system_tx_session as session
                on session.scope_uuid = clock.scope_uuid
              where session.session_id = $1
            `,
            [sessionId],
          );
          expect(preserved.rows).toEqual([
            { clock_epoch: "0", session_epoch: "23" },
          ]);
          const recoveredReceipts = await currentPersistence.query<{ count: string }>(`
            select count(*)::text as count
            from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations
          `);
          expect(recoveredReceipts.rows).toEqual([{ count: "29" }]);
        } finally {
          await Promise.all([
            previousPersistence.close(),
            currentPersistence?.close(),
          ]);
        }
      });
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });
});

async function insertScopeClock(
  persistence: Pick<FlarexPersistence, "query">,
  scopeId: ScopeId,
  epoch: string,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_scope_clock (
        scope_id,
        storage_generation,
        epoch
      ) values ($1, 'legacy_v1', $2)
    `,
    [scopeId, epoch],
  );
}

async function backendPid(
  tx: Parameters<typeof lockScopeClockForUpdateInTransaction>[0],
): Promise<number> {
  const result = await tx.execute<{ pid: number }>(
    sql`select pg_backend_pid()::int as pid`,
  );
  if (typeof result !== "object" || result === null) {
    throw new Error("Postgres returned an invalid backend PID result.");
  }
  const rows = Reflect.get(result, "rows");
  if (!Array.isArray(rows)) {
    throw new Error("Postgres returned an invalid backend PID row set.");
  }
  const firstRow: unknown = rows[0];
  if (typeof firstRow !== "object" || firstRow === null) {
    throw new Error("Postgres did not return a backend PID.");
  }
  const pid = Reflect.get(firstRow, "pid");
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error("Postgres returned an invalid backend PID.");
  }
  return pid;
}

async function waitForBlockedScopeClockRead(
  persistence: Pick<FlarexPersistence, "query">,
  waiterPid: number,
  lockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: boolean }>(
      `
        select exists (
          select 1
          from pg_stat_activity
          where pid = $1
            and wait_event_type = 'Lock'
            and $2 = any(pg_blocking_pids(pid))
        ) as blocked
      `,
      [waiterPid, lockerPid],
    );
    if (result.rows[0]?.blocked === true) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for scope-clock backend ${waiterPid} to block on ${lockerPid}.`,
  );
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function requireScopeAuthorizationRevocationEpochInTransaction(
  db: Parameters<
    typeof requireScopeAuthorizationRevocationEpochResultInTransaction
  >[0],
  scopeId: ScopeId,
): Promise<TransactionAuthorizationRevocationEpoch> {
  return Result.getOrThrow(
    await requireScopeAuthorizationRevocationEpochResultInTransaction(
      db,
      scopeId,
    ),
  );
}

class Deferred<Value> {
  readonly promise: Promise<Value>;
  private resolvePromise: ((value: Value) => void) | null = null;
  private rejectPromise: ((error: unknown) => void) | null = null;

  constructor() {
    this.promise = new Promise<Value>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(value: Value): void {
    const resolve = this.resolvePromise;
    if (resolve === null) return;
    this.resolvePromise = null;
    this.rejectPromise = null;
    resolve(value);
  }

  reject(error: unknown): void {
    const reject = this.rejectPromise;
    if (reject === null) return;
    this.resolvePromise = null;
    this.rejectPromise = null;
    reject(error);
  }
}
