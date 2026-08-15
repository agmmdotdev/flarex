import { setTimeout as delay } from "node:timers/promises";

import { isNonArrayRecord } from "@flarex/utils/records";
import { sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Fiber, Result } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from
  "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  createPostgresPersistence,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
  readCurrentAppRowInTransactionEffect,
  type AppRowTransaction,
} from "../src/appRows";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
  type PostgresLocatedReadCommittedRunnerOptionsV1,
} from "../src/postgresLocatedReadCommitted";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedTrustedScopeAuthority,
  type TrustedScopeAuthorityResolutionPorts,
} from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { ScopeExecutionAuthorityError } from
  "../src/scopeExecution/Errors";
import { liveScopeExecution } from
  "../src/scopeExecution/ScopeExecution";
import {
  defineScopedReadOperation,
  defineScopedWriteOperation,
} from "../src/scopeExecution/ScopedTransaction";
import {
  createLocatedPointMutationSessionActivationTargetV1,
} from "../src/transactionSessionActivation";
import {
  isLocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
  LOCATED_READ_COMMITTED_RUNNER_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

const locator = Object.freeze({
  kind: "shared_database",
  databaseKey: "scope-execution-postgres",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const settlement = Object.freeze({
  rollbackMessage: "PostgreSQL scoped-execution proof rolled back.",
  cleanupDefect: (failure: LocatedReadCommittedTransactionFailureV1) =>
    failure,
});

const sharedAppRowIdentity = Object.freeze({
  tableId: decodeCatalogTableId(1),
  rowId: decodeAppRowIdHexV1("61000000000000000000000000000001"),
});
const appRowSchemaVersionId = decodeCatalogSchemaVersionId(
  "schema_scope_execution_postgres_v1",
);
const appRowCreationTime = decodeAppCreationTimeV1(1_725_000_000_000.5);

class ScopeExecutionPostgresTestError extends Data.TaggedError(
  "ScopeExecutionPostgresTestError",
)<{
  readonly reason: "rollback" | "query" | "rowMissing";
  readonly cause?: unknown;
}> {}

describePostgres(
  "real PostgreSQL scoped execution",
  { timeout: 180_000 },
  () => {
    it("reuses one backend across scopes without leaking transaction or listener state and isolates concurrent scopes", async () => {
      await withScopedPostgres(2, async fixture => {
        const oneConnectionPool = fixture.poolWithMaximum(1);
        try {
          const acquiredClients: PoolClient[] = [];
          const activeErrorListenerCounts: number[] = [];
          const target = locatedTarget(
            fixture.persistence,
            oneConnectionPool,
            locator,
            {
              afterAcquire: client => {
                acquiredClients.push(client);
                activeErrorListenerCounts.push(client.listenerCount("error"));
              },
            },
          );
          const scopeA = await fixture.provision(
            "deployment_scope_execution_postgres_a",
            target,
            uuidSequence(
              "a1000000-0000-4000-8000-000000000001",
              "a1000000-0000-4000-8000-000000000002",
            ),
          );
          const scopeB = await fixture.provision(
            "deployment_scope_execution_postgres_b",
            target,
            uuidSequence(
              "b1000000-0000-4000-8000-000000000001",
              "b1000000-0000-4000-8000-000000000002",
            ),
          );
          await seedScopedAppRow(
            fixture.persistence,
            scopeA,
            "scope-a-value",
          );
          await seedScopedAppRow(
            fixture.persistence,
            scopeB,
            "scope-b-value",
          );
          const observeSequential = defineScopedReadOperation(
            (tx, context, input: Readonly<{
              identity: typeof sharedAppRowIdentity;
              mutateLocalState: boolean;
            }>) => Effect.gen(function* () {
              const before = yield* postgresTestQueryEffect(
                () => backendObservation(tx),
              );
              const revision = yield* readCurrentAppRowInTransactionEffect(
                tx,
                {
                  scopeId: context.authority.scopeId,
                  ...input.identity,
                },
              );
              if (revision.kind !== "live") {
                return yield* new ScopeExecutionPostgresTestError({
                  reason: "rowMissing",
                });
              }
              const storedScopeId = yield* postgresTestQueryEffect(
                () => storedClockScopeId(
                  tx,
                  context.authority.scopeId,
                ),
              );
              if (input.mutateLocalState) {
                yield* postgresTestQueryEffect(() =>
                  tx.execute(sql`set local statement_timeout = '1750ms'`)
                );
                yield* postgresTestQueryEffect(() =>
                  tx.execute(sql`set local search_path = pg_catalog`)
                );
              }
              const after = yield* postgresTestQueryEffect(
                () => backendObservation(tx),
              );
              return Object.freeze({
                identity: input.identity,
                appValue: revision.document.value,
                scopeId: context.authority.scopeId,
                clockScopeId: context.clock.scopeId,
                storedScopeId,
                before,
                after,
              });
            }),
          );

          const first = await runEffect(liveScopeExecution.runRead(
            scopeA,
            settlement,
            observeSequential,
            Object.freeze({
              identity: sharedAppRowIdentity,
              mutateLocalState: true,
            }),
          ));
          const second = await runEffect(liveScopeExecution.runRead(
            scopeB,
            settlement,
            observeSequential,
            Object.freeze({
              identity: sharedAppRowIdentity,
              mutateLocalState: false,
            }),
          ));

          expect(first.before.pid).toBe(second.before.pid);
          expect(first.after.searchPath).toBe("pg_catalog");
          expect(first.after.statementTimeout).toBe("1750ms");
          expect(second.before.searchPath).toBe(first.before.searchPath);
          expect(second.before.statementTimeout).toBe(
            first.before.statementTimeout,
          );
          expect(second.after).toEqual(second.before);
          expect(first.identity).toBe(second.identity);
          expect(first.appValue).toMatchObject({ tenantValue: "scope-a-value" });
          expect(second.appValue).toMatchObject({ tenantValue: "scope-b-value" });
          expect(first.scopeId).toBe(scopeA.authority.scopeId);
          expect(second.scopeId).toBe(scopeB.authority.scopeId);
          expect(first.clockScopeId).toBe(scopeA.authority.scopeId);
          expect(second.clockScopeId).toBe(scopeB.authority.scopeId);
          expect(first.storedScopeId).toBe(scopeA.authority.scopeId);
          expect(second.storedScopeId).toBe(scopeB.authority.scopeId);
          expect(acquiredClients).toHaveLength(2);
          expect(acquiredClients[0]).toBe(acquiredClients[1]);
          expect(activeErrorListenerCounts[0]).toBe(
            activeErrorListenerCounts[1],
          );

          const reused = await oneConnectionPool.connect();
          try {
            expect(await clientBackendPid(reused)).toBe(first.before.pid);
            expect(reused).toBe(acquiredClients[0]);
            expect(reused.listenerCount("error")).toBe(
              activeErrorListenerCounts[0]! - 1,
            );
          } finally {
            reused.release();
          }
        } finally {
          await oneConnectionPool.end();
        }

        const concurrentTarget = locatedTarget(
          fixture.persistence,
          fixture.pool,
          locator,
        );
        const scopeC = await fixture.provision(
          "deployment_scope_execution_postgres_c",
          concurrentTarget,
          uuidSequence(
            "c1000000-0000-4000-8000-000000000001",
            "c1000000-0000-4000-8000-000000000002",
          ),
        );
        const scopeD = await fixture.provision(
          "deployment_scope_execution_postgres_d",
          concurrentTarget,
          uuidSequence(
            "d1000000-0000-4000-8000-000000000001",
            "d1000000-0000-4000-8000-000000000002",
          ),
        );
        await seedScopedAppRow(
          fixture.persistence,
          scopeC,
          "scope-c-value",
        );
        await seedScopedAppRow(
          fixture.persistence,
          scopeD,
          "scope-d-value",
        );
        const entered = promiseGate();
        const release = promiseGate();
        let enteredCount = 0;
        const observeConcurrent = defineScopedReadOperation(
          (tx, context, identity: typeof sharedAppRowIdentity) =>
            Effect.gen(function* () {
              const observed = yield* postgresTestQueryEffect(
                () => backendObservation(tx),
              );
              const revision = yield* readCurrentAppRowInTransactionEffect(
                tx,
                { scopeId: context.authority.scopeId, ...identity },
              );
              if (revision.kind !== "live") {
                return yield* new ScopeExecutionPostgresTestError({
                  reason: "rowMissing",
                });
              }
              const storedScopeId = yield* postgresTestQueryEffect(
                () => storedClockScopeId(
                  tx,
                  context.authority.scopeId,
                ),
              );
              enteredCount += 1;
              if (enteredCount === 2) entered.open();
              yield* Effect.promise(() => release.promise);
              return Object.freeze({
                pid: observed.pid,
                identity,
                appValue: revision.document.value,
                scopeId: context.authority.scopeId,
                clockScopeId: context.clock.scopeId,
                storedScopeId,
              });
            }),
        );
        const concurrent = [scopeC, scopeD].map(scope =>
          runEffect(liveScopeExecution.runRead(
            scope,
            settlement,
            observeConcurrent,
            sharedAppRowIdentity,
          ))
        );
        const concurrentSettlement = Promise.all(concurrent);
        let concurrentResults:
          | Awaited<typeof concurrentSettlement>
          | undefined;
        try {
          await waitForGateOrSettlement(
            entered.promise,
            concurrentSettlement,
            "concurrent scoped reads",
          );
          release.open();
          concurrentResults = await concurrentSettlement;
        } finally {
          release.open();
          await Promise.allSettled(concurrent);
        }
        if (concurrentResults === undefined) {
          throw new Error("Concurrent scoped reads returned no result.");
        }
        const [left, right] = concurrentResults;

        expect(left.pid).not.toBe(right.pid);
        expect(left.identity).toBe(right.identity);
        expect(left.appValue).toMatchObject({ tenantValue: "scope-c-value" });
        expect(right.appValue).toMatchObject({ tenantValue: "scope-d-value" });
        expect(left.scopeId).toBe(scopeC.authority.scopeId);
        expect(right.scopeId).toBe(scopeD.authority.scopeId);
        expect(left.clockScopeId).toBe(scopeC.authority.scopeId);
        expect(right.clockScopeId).toBe(scopeD.authority.scopeId);
        expect(left.storedScopeId).toBe(scopeC.authority.scopeId);
        expect(right.storedScopeId).toBe(scopeD.authority.scopeId);
      });
    });

    it("fails closed before work and reuses a connection only after rollback, timeout, and interruption settlement", async () => {
      await withScopedPostgres(1, async fixture => {
        const acquisitions: number[] = [];
        const target = locatedTarget(
          fixture.persistence,
          fixture.pool,
          locator,
          {
            afterAcquire: async client => {
              acquisitions.push(await clientBackendPid(client));
            },
          },
        );
        const stable = await fixture.provision(
          "deployment_scope_execution_postgres_settlement",
          target,
          uuidSequence(
            "e1000000-0000-4000-8000-000000000001",
            "e1000000-0000-4000-8000-000000000002",
          ),
        );
        const observe = defineScopedReadOperation(
          (tx, context, _input: void) => postgresTestQueryEffect(
            () => backendObservation(tx),
          ).pipe(Effect.map(observed => Object.freeze({
            pid: observed.pid,
            scopeId: context.authority.scopeId,
          }))),
        );
        const baseline = await runEffect(liveScopeExecution.runRead(
          stable,
          settlement,
          observe,
          undefined,
        ));

        let invoked = 0;
        const forbidden = defineScopedWriteOperation(
          (_tx, _context, _input: void) => Effect.sync(() => invoked += 1),
        );
        const staleCases = [
          {
            deploymentId: "deployment_scope_execution_postgres_generation",
            uuids: uuidSequence(
              "f1000000-0000-4000-8000-000000000001",
              "f1000000-0000-4000-8000-000000000002",
            ),
            mutate: (scopeId: ScopeId) => fixture.persistence.query(
              `update fx_system_scope_clock
                  set storage_generation = 'legacy_v1'
                where scope_id = $1`,
              [scopeId],
            ),
            reason: "unsupportedStorageGeneration",
          },
          {
            deploymentId: "deployment_scope_execution_postgres_fence",
            uuids: uuidSequence(
              "11000000-0000-4000-8000-000000000011",
              "11000000-0000-4000-8000-000000000012",
            ),
            mutate: (scopeId: ScopeId) => fixture.persistence.query(
              `update fx_system_scope_clock
                  set storage_generation_fence = storage_generation_fence + 1
                where scope_id = $1`,
              [scopeId],
            ),
            reason: "storageGenerationFenceChanged",
          },
          {
            deploymentId: "deployment_scope_execution_postgres_epoch",
            uuids: uuidSequence(
              "21000000-0000-4000-8000-000000000011",
              "21000000-0000-4000-8000-000000000012",
            ),
            mutate: (scopeId: ScopeId) => fixture.persistence.query(
              `update fx_system_scope_clock
                  set epoch = '31000000-0000-4000-8000-000000000011'
                where scope_id = $1`,
              [scopeId],
            ),
            reason: "scopeEpochChanged",
          },
        ] as const;
        for (const staleCase of staleCases) {
          const located = await fixture.provision(
            staleCase.deploymentId,
            target,
            staleCase.uuids,
          );
          await staleCase.mutate(located.authority.scopeId);
          const result = await runEffect(Effect.result(
            liveScopeExecution.runWrite(
              located,
              settlement,
              forbidden,
              undefined,
            ),
          ));
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure).toBeInstanceOf(ScopeExecutionAuthorityError);
            expect(result.failure).toMatchObject({ reason: staleCase.reason });
          }
        }
        expect(invoked).toBe(0);

        let foreignAcquisitions = 0;
        const foreignTarget = locatedTarget(
          fixture.persistence,
          fixture.pool,
          Object.freeze({ ...locator, databaseKey: "foreign-database" }),
          {
            afterAcquire: () => {
              foreignAcquisitions += 1;
            },
          },
        );
        const foreign = Object.freeze({
          authority: stable.authority,
          target: foreignTarget,
        });
        const foreignResult = await runEffect(Effect.result(
          liveScopeExecution.runRead(
            foreign,
            settlement,
            observe,
            undefined,
          ),
        ));
        expect(Result.isFailure(foreignResult)).toBe(true);
        if (Result.isFailure(foreignResult)) {
          expect(foreignResult.failure).toMatchObject({
            reason: "targetPlacementMismatch",
          });
        }
        expect(foreignAcquisitions).toBe(0);

        const rollback = defineScopedWriteOperation(
          (tx, _context, _input: void) => Effect.gen(function* () {
            yield* postgresTestQueryEffect(() => tx.execute(sql`
                update fx_system_scope_clock
                   set last_commit_seq = last_commit_seq + 1
                 where scope_id = ${stable.authority.scopeId}
              `));
            return yield* new ScopeExecutionPostgresTestError({
              reason: "rollback",
            });
          }),
        );
        await expect(runEffect(liveScopeExecution.runWrite(
          stable,
          settlement,
          rollback,
          undefined,
        ))).rejects.toMatchObject({ reason: "rollback" });
        expect(await currentCommitSeq(fixture.persistence, stable)).toBe(0n);
        expect((await runEffect(liveScopeExecution.runRead(
          stable,
          settlement,
          observe,
          undefined,
        ))).pid).toBe(baseline.pid);

        const timeout = defineScopedReadOperation(
          (tx, _context, _input: void) => Effect.gen(function* () {
            yield* postgresTestQueryEffect(() =>
              tx.execute(sql`set local statement_timeout = '75ms'`)
            );
            yield* postgresTestQueryEffect(() =>
              tx.execute(sql`select pg_sleep(1)`)
            );
          }),
        );
        let timeoutFailure: unknown;
        try {
          await runEffect(liveScopeExecution.runRead(
            stable,
            settlement,
            timeout,
            undefined,
          ));
        } catch (cause) {
          timeoutFailure = cause;
        }
        expect(timeoutFailure).toBeInstanceOf(
          ScopeExecutionPostgresTestError,
        );
        if (timeoutFailure instanceof ScopeExecutionPostgresTestError) {
          expect(postgresCode(timeoutFailure.cause)).toBe("57014");
        }
        expect((await runEffect(liveScopeExecution.runRead(
          stable,
          settlement,
          observe,
          undefined,
        ))).pid).toBe(baseline.pid);

        const entered = promiseGate();
        const release = promiseGate();
        const interruptible = defineScopedWriteOperation(
          (tx, _context, _input: void) => Effect.gen(function* () {
            yield* postgresTestQueryEffect(() => tx.execute(sql`
                update fx_system_scope_clock
                   set last_commit_seq = last_commit_seq + 1
                 where scope_id = ${stable.authority.scopeId}
              `));
            yield* Effect.sync(() => entered.open());
            yield* Effect.promise(() => release.promise);
          }),
        );
        const fiber = Effect.runFork(liveScopeExecution.runWrite(
          stable,
          settlement,
          interruptible,
          undefined,
        ));
        const completion = runEffect(Fiber.await(fiber));
        let interruptionSettled = false;
        let interruption: Promise<void> | undefined;
        try {
          await waitForGateOrSettlement(
            entered.promise,
            completion,
            "interrupted scoped write",
          );
          interruption = runEffect(Fiber.interrupt(fiber)).then(() => {
            interruptionSettled = true;
          });
          await delay(25);
          expect(interruptionSettled).toBe(false);
        } finally {
          release.open();
          interruption ??= runEffect(Fiber.interrupt(fiber)).then(() => {
            interruptionSettled = true;
          });
          await interruption;
          await completion;
        }
        const interrupted = await completion;
        expect(Exit.isFailure(interrupted)).toBe(true);
        if (Exit.isFailure(interrupted)) {
          expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
        }
        expect(await currentCommitSeq(fixture.persistence, stable)).toBe(1n);
        expect((await runEffect(liveScopeExecution.runRead(
          stable,
          settlement,
          observe,
          undefined,
        ))).pid).toBe(baseline.pid);
        expect(acquisitions.every(pid => pid === baseline.pid)).toBe(true);
      });
    });

    it("quarantines backend and release uncertainty before replacing the connection", async () => {
      await withScopedPostgres(1, async fixture => {
        const admin = fixture.poolWithMaximum(1);
        try {
          const target = locatedTarget(
            fixture.persistence,
            fixture.pool,
            locator,
          );
          const located = await fixture.provision(
            "deployment_scope_execution_postgres_uncertainty",
            target,
            uuidSequence(
              "41000000-0000-4000-8000-000000000011",
              "41000000-0000-4000-8000-000000000012",
            ),
          );
          const entered = promiseGate();
          const release = promiseGate();
          let terminatedPid = 0;
          const terminateDuringCallback = defineScopedReadOperation(
            (tx, _context, _input: void) => Effect.gen(function* () {
              terminatedPid = (yield* postgresTestQueryEffect(
                () => backendObservation(tx),
              )).pid;
              yield* Effect.sync(() => entered.open());
              yield* Effect.promise(() => release.promise);
              return "callback-completed" as const;
            }),
          );
          const running = runEffect(liveScopeExecution.runRead(
            located,
            settlement,
            terminateDuringCallback,
            undefined,
          ));
          let preSettlementFailure: unknown;
          try {
            await waitForGateOrSettlement(
              entered.promise,
              running,
              "backend-termination scoped read",
            );
            const termination = await admin.query<{ terminated: boolean }>(
              "select pg_terminate_backend($1) as terminated",
              [terminatedPid],
            );
            expect(termination.rows[0]?.terminated).toBe(true);
          } catch (cause) {
            preSettlementFailure = cause;
          } finally {
            release.open();
          }

          let terminationFailure: unknown;
          try {
            await running;
          } catch (cause) {
            terminationFailure = cause;
          }
          if (preSettlementFailure !== undefined) {
            throw preSettlementFailure;
          }
          expect(terminationFailure).toBeInstanceOf(
            LocatedReadCommittedTransactionFailureV1,
          );
          if (
            terminationFailure instanceof
              LocatedReadCommittedTransactionFailureV1
          ) {
            expect(terminationFailure.issue.kind).toBe("decisionUncertain");
          }

          const observe = defineScopedReadOperation(
            (tx, _context, _input: void) => postgresTestQueryEffect(
              () => backendObservation(tx),
            ).pipe(Effect.map(observed => observed.pid)),
          );
          const replacementPid = await runEffect(liveScopeExecution.runRead(
            located,
            settlement,
            observe,
            undefined,
          ));
          expect(replacementPid).not.toBe(terminatedPid);
        } finally {
          await admin.end();
        }

        let failRelease = true;
        let uncertainPid = 0;
        const releaseFailure = new Error(
          "Injected PostgreSQL scoped-execution release failure.",
        );
        const releaseTarget = locatedTarget(
          fixture.persistence,
          fixture.pool,
          locator,
          {
            release: (client, discardError) => {
              if (failRelease) {
                failRelease = false;
                throw releaseFailure;
              }
              client.release(discardError);
            },
          },
        );
        const releaseLocated = await fixture.provision(
          "deployment_scope_execution_postgres_release",
          releaseTarget,
          uuidSequence(
            "51000000-0000-4000-8000-000000000011",
            "51000000-0000-4000-8000-000000000012",
          ),
        );
        const observeRelease = defineScopedReadOperation(
          (tx, _context, _input: void) => postgresTestQueryEffect(
            () => backendObservation(tx),
          ).pipe(Effect.map(observed => {
            uncertainPid = observed.pid;
            return uncertainPid;
          })),
        );
        let releaseFailureResult: unknown;
        try {
          await runEffect(liveScopeExecution.runRead(
            releaseLocated,
            settlement,
            observeRelease,
            undefined,
          ));
        } catch (cause) {
          releaseFailureResult = cause;
        }
        expect(releaseFailureResult).toBeInstanceOf(
          LocatedReadCommittedTransactionFailureV1,
        );
        if (
          releaseFailureResult instanceof
            LocatedReadCommittedTransactionFailureV1
        ) {
          expect(releaseFailureResult.issue).toMatchObject({
            kind: "decisionUncertain",
            settlementCause: releaseFailure,
          });
        }
        const releasedUncertainPid = uncertainPid;
        const safePid = await runEffect(liveScopeExecution.runRead(
          releaseLocated,
          settlement,
          observeRelease,
          undefined,
        ));
        expect(safePid).not.toBe(releasedUncertainPid);
      });
    });
  },
);

interface ScopedPostgresFixture {
  readonly persistence: PostgresFlarexPersistence;
  readonly pool: Pool;
  readonly poolWithMaximum: (maximum: number) => Pool;
  readonly provision: (
    deploymentId: string,
    target: LocatedReadCommittedAttemptTargetV1,
    randomUuid: () => string,
  ) => Promise<
    LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>
  >;
}

async function withScopedPostgres(
  maximumPoolSize: number,
  run: (fixture: ScopedPostgresFixture) => Promise<void>,
): Promise<void> {
  await withTemporaryPostgresSchema(async options => {
    const poolOptions = Object.freeze({
      connectionString: options.connectionString,
      ...options.poolConfig,
    });
    const pool = new Pool({ ...poolOptions, max: maximumPoolSize });
    const persistence = await createPostgresPersistence({
      pool,
      migrationsSchema: options.migrationsSchema,
    });
    try {
      await persistence.migrate();
      await run(Object.freeze({
        persistence,
        pool,
        poolWithMaximum: (maximum: number) => new Pool({
          ...poolOptions,
          max: maximum,
        }),
        provision: async (
          deploymentId: string,
          target: LocatedReadCommittedAttemptTargetV1,
          randomUuid: () => string,
        ) => {
          const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
            persistence,
            { physicalLocator: locator, randomUuid },
          ).ensure({
            deploymentId,
            projectId: `${deploymentId}_project`,
          });
          await persistence.query(
            `update fx_system_scope_clock
                set storage_generation = 'flarexdb_v1'
              where scope_id = $1`,
            [provisioned.scope.scopeId],
          );
          const ports = {
            scopeMetadata: persistence,
            provisioningReceipts: {
              getScopeAuthorityProvisioningReceipt: async (_scopeId: ScopeId) => {
                throw new Error(
                  "Shared PostgreSQL scope resolution must not read split receipts.",
                );
              },
            },
            scopeClockTargets: {
              resolve: async () => target,
            },
          } satisfies TrustedScopeAuthorityResolutionPorts<
            LocatedReadCommittedAttemptTargetV1
          >;
          return runEffect(resolveLocatedTrustedScopeAuthorityEffect(
            provisioned.scope.deploymentId,
            ports,
          ));
        },
      }));
    } finally {
      await persistence.close();
      await pool.end();
    }
  });
}

function locatedTarget(
  persistence: PostgresFlarexPersistence,
  pool: Pool,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  options: PostgresLocatedReadCommittedRunnerOptionsV1 = {},
): LocatedReadCommittedAttemptTargetV1 {
  const target = createLocatedPointMutationSessionActivationTargetV1(
    persistence.drizzle,
    physicalLocator,
    {
      [LOCATED_READ_COMMITTED_RUNNER_V1]:
        createPostgresLocatedReadCommittedTransactionRunnerV1(pool, options),
    },
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error(
      "PostgreSQL scoped-execution target lacks read-committed execution.",
    );
  }
  return target;
}

async function seedScopedAppRow(
  persistence: PostgresFlarexPersistence,
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
  tenantValue: string,
): Promise<void> {
  const document = await canonicalizeAppDocumentV1({
    ...sharedAppRowIdentity,
    creationTime: appRowCreationTime,
    fields: { tenantValue },
  });
  await persistence.drizzle.transaction(async tx => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: located.authority.scopeId,
      ...sharedAppRowIdentity,
      writeEpoch: located.authority.epoch,
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      schemaVersionId: appRowSchemaVersionId,
      creationTime: appRowCreationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.execute(sql`
      update fx_system_scope_clock
         set last_commit_seq = 1
       where scope_id = ${located.authority.scopeId}
    `);
  });
}

function postgresTestQueryEffect<Value>(
  run: () => PromiseLike<Value>,
): Effect.Effect<Value, ScopeExecutionPostgresTestError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(run()),
    catch: cause => new ScopeExecutionPostgresTestError({
      reason: "query",
      cause,
    }),
  });
}

interface BackendObservation {
  readonly pid: number;
  readonly searchPath: string;
  readonly statementTimeout: string;
}

async function backendObservation(
  tx: AppRowTransaction,
): Promise<BackendObservation> {
  const result = await tx.execute(sql`
    select pg_backend_pid()::int as pid,
           current_setting('search_path') as search_path,
           current_setting('statement_timeout') as statement_timeout
  `);
  const row = firstDriverRow(result);
  const pid = Reflect.get(row, "pid");
  const searchPath = Reflect.get(row, "search_path");
  const statementTimeout = Reflect.get(row, "statement_timeout");
  if (
    typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0 ||
    typeof searchPath !== "string" ||
    typeof statementTimeout !== "string"
  ) {
    throw new Error("PostgreSQL returned an invalid backend observation.");
  }
  return Object.freeze({ pid, searchPath, statementTimeout });
}

async function clientBackendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ pid: number }>(
    "select pg_backend_pid()::int as pid",
  );
  const pid = result.rows[0]?.pid;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("PostgreSQL returned an invalid client backend PID.");
  }
  return pid;
}

async function storedClockScopeId(
  tx: AppRowTransaction,
  scopeId: ScopeId,
): Promise<string> {
  const result = await tx.execute(sql`
    select scope_id
      from fx_system_scope_clock
     where scope_id = ${scopeId}
  `);
  const stored = Reflect.get(firstDriverRow(result), "scope_id");
  if (typeof stored !== "string") {
    throw new Error("PostgreSQL returned an invalid stored scope identity.");
  }
  return stored;
}

function firstDriverRow(result: unknown): Readonly<Record<string, unknown>> {
  if (!isNonArrayRecord(result)) {
    throw new Error("PostgreSQL returned an invalid driver result.");
  }
  const rows = Reflect.get(result, "rows");
  if (!Array.isArray(rows) || !isNonArrayRecord(rows[0])) {
    throw new Error("PostgreSQL returned no driver row.");
  }
  return rows[0];
}

async function currentCommitSeq(
  persistence: PostgresFlarexPersistence,
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
): Promise<bigint> {
  const result = await persistence.query<{ last_commit_seq: string }>(
    `select last_commit_seq::text as last_commit_seq
       from fx_system_scope_clock
      where scope_id = $1`,
    [located.authority.scopeId],
  );
  const value = result.rows[0]?.last_commit_seq;
  if (typeof value !== "string") {
    throw new Error("PostgreSQL returned no scope commit sequence.");
  }
  return BigInt(value);
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

function promiseGate(): Readonly<{
  readonly promise: Promise<void>;
  readonly open: () => void;
}> {
  let open: (() => void) | undefined;
  const promise = new Promise<void>(resolve => {
    open = resolve;
  });
  return Object.freeze({
    promise,
    open: () => open?.(),
  });
}

async function waitForGateOrSettlement(
  gate: Promise<void>,
  settlement: Promise<unknown>,
  operation: string,
): Promise<void> {
  await Promise.race([
    gate,
    settlement.then(
      () => {
        throw new Error(`${operation} settled before entering its gate.`);
      },
      cause => Promise.reject(cause),
    ),
    delay(5_000).then(() => {
      throw new Error(`${operation} did not enter its gate within 5 seconds.`);
    }),
  ]);
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error("UUID sequence exhausted.");
    return value;
  };
}
