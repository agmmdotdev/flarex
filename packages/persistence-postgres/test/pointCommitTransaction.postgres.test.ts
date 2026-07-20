import { setTimeout as delay } from "node:timers/promises";

import { eq } from "drizzle-orm";
import { Effect, Exit, Fiber, Result } from "effect";
import type { PoolClient } from "pg";
import {
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import {
  CommitSyscallSequenceV1Schema,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  projectScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../src/appRows";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointMutationAttemptReplacementPortV1,
  createPointCommitPublisherPortV1,
  createPointCommitRollbackProofPortV1,
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  PointCommitDecisionUncertainV1Error,
  PointCommitSqlErrorV1,
  PointCommitStaleAuthorityV1Error,
  PointMutationAttemptReplacementCommittedOutcomeV1Error,
  PointMutationAttemptReplacementCorruptionV1Error,
  type PointMutationAttemptReplacementCommandV1,
  type PointMutationAttemptReplacementOptionsV1,
  type PointMutationAttemptReplacementSqlOperationV1,
  type PointCommitSqlOperationV1,
  type PointCommitPublicationCommandV1,
  type PointCommitTransactionCommandV1,
  type PointCommitTransactionProofOptionsV1,
} from "../src/pointCommitTransaction";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
  type PostgresLocatedReadCommittedRunnerOptionsV1,
} from "../src/postgresLocatedReadCommitted";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "../src/schema";
import { createSessionJournalStorePersistenceV1 } from "../src/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  createLocatedPointMutationSessionActivationTargetV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  LOCATED_READ_COMMITTED_RUNNER_V1,
  LocatedReadCommittedTransactionFailureV1,
} from "../src/transactionSessionAttemptKernel";
import {
  pointCommitCommandFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "./pointCommitTransactionTestSupport";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
  withPostgresSequentialScansDisabled,
} from "./postgresHelpers";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "./effectTestRuntime";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  activatePointMutationSession,
  executionClaimForAnchor,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPostgresPersistence = useFileScopedPostgresPersistence();

describePostgres("real Postgres O06 point-commit transaction kernel", () => {
  it("masks interruption until forced rollback settles and exposes no tentative state", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96000000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "rollback_settlement",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "rollback_settlement",
      );
      const before = await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      let interruptionSettled = false;
      const fiber = Effect.runFork(
        createPort(persistence, {
          afterTransactionStep: async (event) => {
            if (event.step !== "beforeRollback") return;
            entered.resolve();
            await release.promise;
          },
        }).prove(attempt.command),
      );
      await entered.promise;

      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual(before);
      const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
        interruptionSettled = true;
        return exit;
      });
      await delay(25);
      expect(interruptionSettled).toBe(false);
      release.resolve();
      await interruption;
      expect(interruptionSettled).toBe(true);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual(before);

      const steps: string[] = [];
      const queries = new Map<
        PointCommitSqlOperationV1,
        Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
      >();
      const result = await runEffect(createPort(persistence, {
        afterTransactionStep: (event) => {
          steps.push(event.step);
          return Promise.resolve();
        },
        observeQuery: (query) => {
          queries.set(query.name, query);
        },
      }).prove(attempt.command));
      expect(result).toEqual({ kind: "wouldCommit" });
      expect(Object.isFrozen(result)).toBe(true);
      expect(steps).toEqual([
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
        "dependenciesValidated",
        "tentativeRowWritten",
        "beforeRollback",
      ]);
      expect([...queries.keys()]).toEqual([
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
        "readDatabaseTime",
        "loadRowHeads",
      ]);
      const sessionQuery = requireObservedQuery(queries, "lockSession");
      expect(sessionQuery.sql).not.toContain("validated_args_json");
      expect(sessionQuery.sql).not.toContain("authorization_grant_json");
      for (const name of [
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
      ] as const) {
        expect(await explainObserved(persistence, requireObservedQuery(
          queries,
          name,
        ))).toContain("Index Scan");
      }
      await expectSequentialScansEnabled(persistence);
    });
  }, 120_000);

  it("serializes one scope while an independent scope completes", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96100000");
      const firstScope = await createScope(
        persistence,
        randomUuid,
        "serialized_a",
      );
      const independentScope = await createScope(
        persistence,
        randomUuid,
        "serialized_b",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "serialized_a1",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "serialized_a2",
      );
      const independent = await createAttempt(
        persistence,
        randomUuid,
        independentScope,
        "serialized_b1",
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const order: string[] = [];
      const firstPromise = runEffect(createPort(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          order.push("first-clock");
          entered.resolve();
          await release.promise;
        },
      }).prove(first.command));
      await entered.promise;
      const secondPromise = runEffect(createPort(persistence, {
        afterTransactionStep: (event) => {
          if (event.step === "clockLocked") order.push("second-clock");
          return Promise.resolve();
        },
      }).prove(second.command));
      await waitForBlockedPointCommit(persistence, 1);

      await withTimeout(
        runEffect(createPort(persistence).prove(independent.command)),
        5_000,
        "independent O06 scope",
      );
      expect(order).toEqual(["first-clock"]);
      release.resolve();
      await Promise.all([firstPromise, secondPromise]);
      expect(order).toEqual(["first-clock", "second-clock"]);
      expect(await durableState(
        persistence,
        first.command.sealIdentity.scopeUuid,
      )).toMatchObject({ revisions: "0", last_commit_seq: "0" });
      expect(await durableState(
        persistence,
        independent.command.sealIdentity.scopeUuid,
      )).toMatchObject({ revisions: "0", last_commit_seq: "0" });
    });
  }, 120_000);

  it("linearizes revocation after the rollback and rejects detached stale authority", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96200000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "revocation_race",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "revocation_race",
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const proof = runEffect(createPort(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          entered.resolve();
          await release.promise;
        },
      }).prove(attempt.command));
      await entered.promise;
      let revocationSettled = false;
      const revocation = persistence.query(
        `
          update fx_system_scope_clock
          set authorization_revocation_epoch =
            authorization_revocation_epoch + 1
          where scope_uuid = $1
        `,
        [attempt.command.sealIdentity.scopeUuid],
      ).then(() => {
        revocationSettled = true;
      });
      try {
        await waitForBlockedPointCommit(persistence, 1);
        expect(revocationSettled).toBe(false);
      } finally {
        release.resolve();
      }
      await proof;
      await revocation;

      const failure = await runFailure(
        createPort(persistence).prove(attempt.command),
      );
      expect(failure).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
      expect(failure).toMatchObject({ reason: "revocationEpochChanged" });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({ revisions: "0", last_commit_seq: "0" });
    });
  }, 120_000);

  it("observes a competing committed row after the clock wait as an OCC conflict", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96300000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "occ_race",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "occ_race",
      );
      const writerLocked = deferredSignal();
      const releaseWriter = deferredSignal();
      const writer = commitCompetingPointRow(
        persistence,
        attempt.command,
        writerLocked,
        releaseWriter,
      );
      await writerLocked.promise;
      const proofFailure = runFailure(
        createPort(persistence).prove(attempt.command),
      );
      await waitForBlockedPointCommit(persistence, 1);
      releaseWriter.resolve();
      await writer;
      const failure = await proofFailure;
      expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        last_commit_seq: "1",
      });
      const plan = await explainHeadLookup(persistence, attempt.command);
      expect(plan).toContain("Index Scan");
      expect(plan).toContain("fx_app_row_current");
      expect(plan).toContain("fx_app_row_rev");
    });
  }, 120_000);

  it("publishes material and zero-row successes with complete atomic evidence", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96400000");
      const materialScope = await createScope(
        persistence,
        randomUuid,
        "publish_material",
      );
      const material = await createAttempt(
        persistence,
        randomUuid,
        materialScope,
        "publish_material",
      );
      const published = await runEffect(
        createPublisher(persistence).publish(material.publicationCommand),
      );
      expect(published).toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
        successfulResult: { valueJson: { ok: true } },
      });
      expect(await durableState(
        persistence,
        material.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      expect(await terminalPublicationState(
        persistence,
        material.command.sealIdentity.scopeUuid,
        material.anchor.sessionId,
      )).toEqual({
        lifecycle: "committed",
        leases: "0",
        journals: "0",
        change_count: 1,
        delivery_state: "pending",
        same_initial_time: true,
      });

      const zeroScope = await createScope(
        persistence,
        randomUuid,
        "publish_zero",
      );
      const zero = await createAttempt(
        persistence,
        randomUuid,
        zeroScope,
        "publish_zero",
        false,
      );
      await runEffect(
        createPublisher(persistence).publish(zero.publicationCommand),
      );
      expect(await durableState(
        persistence,
        zero.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "1",
        commit_changes: "0",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      expect(await terminalPublicationState(
        persistence,
        zero.command.sealIdentity.scopeUuid,
        zero.anchor.sessionId,
      )).toMatchObject({ change_count: 0, lifecycle: "committed" });
    });
  }, 120_000);

  it("linearizes concurrent duplicates into one publisher and one replay", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96500000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "duplicate_publish",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "duplicate_publish",
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const first = runEffect(createPublisher(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          entered.resolve();
          await release.promise;
        },
      }).publish(attempt.publicationCommand));
      await entered.promise;
      const second = runEffect(
        createPublisher(persistence).publish(attempt.publicationCommand),
      );
      await waitForBlockedPointCommit(persistence, 1);
      release.resolve();
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.kind).sort()).toEqual([
        "published",
        "replayed",
      ]);
      expect(results[0]?.token).toEqual(results[1]?.token);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        revisions: "1",
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });

      const lateProof = await runFailure(
        createPort(persistence).prove(attempt.command),
      );
      expect(lateProof).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({ commit_headers: "1", outcomes: "1", wakes: "1" });
    });
  }, 120_000);

  it("serializes distinct same-scope publications into dense paired heads", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96600000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "dense_publish",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "dense_publish_a",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "dense_publish_b",
      );
      const results = await Promise.all([
        runEffect(createPublisher(persistence).publish(
          first.publicationCommand,
        )),
        runEffect(createPublisher(persistence).publish(
          second.publicationCommand,
        )),
      ]);
      expect(results.map((result) => result.token.commitSeq).sort()).toEqual([
        1n,
        2n,
      ]);
      expect(await durableState(
        persistence,
        first.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "2",
        current_rows: "2",
        commit_headers: "2",
        commit_changes: "2",
        outcomes: "2",
        wakes: "2",
        last_commit_seq: "2",
        last_outbox_seq: "2",
      });
      const sequenceRows = await persistence.query<{
        commit_seq: string;
        outbox_seq: string;
      }>(
        `
          select commit_seq::text, outbox_seq::text
          from fx_system_outbox
          where scope_uuid = $1
          order by outbox_seq
        `,
        [first.command.sealIdentity.scopeUuid],
      );
      expect(sequenceRows.rows).toEqual([
        { commit_seq: "1", outbox_seq: "1" },
        { commit_seq: "2", outbox_seq: "2" },
      ]);
    });
  }, 120_000);

  it("rolls back late O07-B failures without a sequence or receipt gap", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96700000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "publish_rollback",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "publish_rollback",
      );
      const failure = await runFailure(createPublisher(persistence, {
        afterTransactionStep: (event) => {
          if (event.step === "clockAdvanced") {
            throw new PointCommitCorruptionV1Error({
              reason: "publicationInvariantInvalid",
            });
          }
          return Promise.resolve();
        },
      }).publish(attempt.publicationCommand));
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
        last_outbox_seq: "0",
      });
    });
  }, 120_000);
});

describePostgres("real Postgres O08-CD0 decision provenance", () => {
  it("confirms a server 40001 only after rollback and leaves no sequence gap", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97400000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "cd0_40001",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_40001",
      );
      const trigger = await installCommitSqlStateTrigger(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
        "40001",
        "cd0_40001",
      );
      try {
        const failure = await runFailure(
          createPublisher(persistence).publish(attempt.publicationCommand),
        );
        expect(failure).toBeInstanceOf(
          PointCommitConfirmedPreDecisionRollbackV1Error,
        );
        expect(failure).toMatchObject({
          operation: "writeCommitHeader",
          sqlState: "40001",
        });
        expect(await durableState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
        )).toEqual(emptyDurableState());
      } finally {
        await dropCommitTrigger(persistence, trigger);
      }

      await expect(runEffect(
        createPublisher(persistence).publish(attempt.publicationCommand),
      )).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
      });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
    });
  }, 120_000);

  it("confirms one genuine 40P01 victim and preserves dense independent scopes", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97500000");
      const firstScope = await createScope(
        persistence,
        randomUuid,
        "cd0_deadlock_a",
      );
      const secondScope = await createScope(
        persistence,
        randomUuid,
        "cd0_deadlock_b",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "cd0_deadlock_a",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        secondScope,
        "cd0_deadlock_b",
      );
      const trigger = await installCommitDeadlockTrigger(
        persistence,
        first.command.sealIdentity.scopeUuid,
        second.command.sealIdentity.scopeUuid,
      );
      const results = await Promise.all([
        runEffect(Effect.result(
          createPublisher(persistence).publish(first.publicationCommand),
        )),
        runEffect(Effect.result(
          createPublisher(persistence).publish(second.publicationCommand),
        )),
      ]);
      await dropCommitTrigger(persistence, trigger);

      const succeededIndexes = results.flatMap((result, index) =>
        Result.isSuccess(result) ? [index] : []
      );
      const failedIndexes = results.flatMap((result, index) =>
        Result.isFailure(result) ? [index] : []
      );
      expect(succeededIndexes).toHaveLength(1);
      expect(failedIndexes).toHaveLength(1);
      const failedIndex = failedIndexes[0];
      if (failedIndex === undefined) {
        throw new Error("Expected one PostgreSQL deadlock victim.");
      }
      const failed = results[failedIndex];
      if (failed === undefined || Result.isSuccess(failed)) {
        throw new Error("Expected the deadlock failure result.");
      }
      expect(failed.failure).toBeInstanceOf(
        PointCommitConfirmedPreDecisionRollbackV1Error,
      );
      expect(failed.failure).toMatchObject({ sqlState: "40P01" });

      const attempts = [first, second] as const;
      const victim = attempts[failedIndex];
      if (victim === undefined) throw new Error("Missing deadlock victim.");
      expect(await durableState(
        persistence,
        victim.command.sealIdentity.scopeUuid,
      )).toEqual(emptyDurableState());
      await expect(runEffect(
        createPublisher(persistence).publish(victim.publicationCommand),
      )).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
      });
      for (const attempt of attempts) {
        expect(await durableState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
        )).toMatchObject({
          commit_headers: "1",
          outcomes: "1",
          wakes: "1",
          last_commit_seq: "1",
          last_outbox_seq: "1",
        });
      }
    });
  }, 120_000);

  it("preserves rollback and release failures and quarantines their clients", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97600000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "cd0_cleanup",
      );
      const rollbackAttempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_rollback_failure",
      );
      const trigger = await installCommitSqlStateTrigger(
        persistence,
        rollbackAttempt.command.sealIdentity.scopeUuid,
        "40001",
        "cd0_cleanup",
      );
      const rollbackCause = new Error("injected rollback response failure");
      let rollbackClientPid: number | undefined;
      const rollbackFailure = await runFailure(
        createPublisherWithRunner(persistence, {
          afterAcquire: async (client) => {
            rollbackClientPid = await postgresBackendPid(client);
            installClientQueryFault(client, (statement, forward) =>
              statement === "rollback"
                ? Promise.reject(rollbackCause)
                : forward()
            );
          },
        }).publish(rollbackAttempt.publicationCommand),
      );
      await dropCommitTrigger(persistence, trigger);
      expect(rollbackFailure).toBeInstanceOf(PointCommitSqlErrorV1);
      expect(rollbackFailure).toMatchObject({ operation: "beginOrRollback" });
      expectLocatedCleanupFailure(rollbackFailure, {
        transactionCause: expect.objectContaining({ cause: rollbackCause }),
      });
      await expectDifferentPoolClient(persistence, rollbackClientPid);
      expect(await durableState(
        persistence,
        rollbackAttempt.command.sealIdentity.scopeUuid,
      )).toEqual(emptyDurableState());

      const releaseAttempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_release_failure",
      );
      const callbackCause = new Error("injected callback failure");
      const releaseCause = new Error("injected release failure");
      let releaseClientPid: number | undefined;
      const releaseFailure = await runFailure(
        createPublisherWithRunner(
          persistence,
          {
            afterAcquire: async (client) => {
              releaseClientPid = await postgresBackendPid(client);
            },
            release: () => {
              throw releaseCause;
            },
          },
          {
            afterTransactionStep: (event) => {
              if (event.step === "commitHeaderWritten") {
                throw callbackCause;
              }
              return Promise.resolve();
            },
          },
        ).publish(releaseAttempt.publicationCommand),
      );
      expect(releaseFailure).toBeInstanceOf(PointCommitSqlErrorV1);
      expectLocatedCleanupFailure(releaseFailure, {
        callbackCause,
        releaseCause,
      });
      await expectDifferentPoolClient(persistence, releaseClientPid);
      expect(await durableState(
        persistence,
        releaseAttempt.command.sealIdentity.scopeUuid,
      )).toEqual(emptyDurableState());
    });
  }, 120_000);

  it("recovers a forwarded COMMIT and keeps a missing decision uncertain", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97700000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "cd0_commit_response",
      );
      const committed = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_commit_forwarded",
      );
      const lostResponse = new Error("forwarded COMMIT response lost");
      const replayed = await runEffect(
        createPublisherWithRunner(persistence, {
          afterAcquire: (client) => installClientQueryFault(
            client,
            (statement, forward) => statement === "commit"
              ? Promise.resolve(forward()).then(() => {
                  throw lostResponse;
                })
              : forward(),
          ),
        }).publish(committed.publicationCommand),
      );
      expect(replayed).toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      await expect(runEffect(
        createPublisher(persistence).publish(committed.publicationCommand),
      )).resolves.toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      expect(await durableState(
        persistence,
        committed.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });

      const missing = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_commit_missing",
      );
      const missingFailure = await runFailure(
        createPublisherWithRunner(persistence, {
          afterAcquire: (client) => installClientQueryFault(
            client,
            (statement, forward) => statement === "commit"
              ? Promise.reject(new Error("COMMIT not forwarded"))
              : forward(),
          ),
        }).publish(missing.publicationCommand),
      );
      expect(missingFailure).toBeInstanceOf(
        PointCommitDecisionUncertainV1Error,
      );
      expect(missingFailure).toMatchObject({
        outcomeCheck: { kind: "missing" },
      });
      expect(await durableState(
        persistence,
        missing.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      await expect(runEffect(
        createPublisher(persistence).publish(missing.publicationCommand),
      )).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 2n },
      });
      expect(await durableState(
        persistence,
        missing.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        commit_headers: "2",
        outcomes: "2",
        wakes: "2",
        last_commit_seq: "2",
        last_outbox_seq: "2",
      });
    });
  }, 120_000);

  it("holds interruption until a forwarded COMMIT response settles", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97800000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "cd0_interrupt",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_interrupt",
      );
      const committed = deferredSignal();
      const release = deferredSignal();
      const fiber = Effect.runFork(
        createPublisherWithRunner(persistence, {
          afterAcquire: (client) => installClientQueryFault(
            client,
            (statement, forward) => statement === "commit"
              ? Promise.resolve(forward()).then(async () => {
                  committed.resolve();
                  await release.promise;
                  throw new Error("forwarded COMMIT response lost");
                })
              : forward(),
          ),
        }).publish(attempt.publicationCommand),
      );
      await committed.promise;
      let interruptionSettled = false;
      const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
        interruptionSettled = true;
        return exit;
      });
      await delay(25);
      expect(interruptionSettled).toBe(false);
      release.resolve();
      await interruption;
      expect(Exit.hasInterrupts(await runEffect(Fiber.await(fiber)))).toBe(true);
      await expect(runEffect(
        createPublisher(persistence).publish(attempt.publicationCommand),
      )).resolves.toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
    });
  }, 120_000);
});

describePostgres("real Postgres O08-A exact-attempt replacement", () => {
  it("advances one concurrent duplicate and uses bounded index-backed locks", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96800000");
      const scope = await createScope(persistence, randomUuid, "replace_once");
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replace_once",
      );
      await installCompetingPointRow(persistence, attempt.command);
      const command = replacementCommand(attempt.command);
      const entered = deferredSignal();
      const release = deferredSignal();
      const steps: string[] = [];
      const queries = new Map<
        PointMutationAttemptReplacementSqlOperationV1,
        Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
      >();
      const first = runEffect(createReplacementPort(persistence, {
        leaseDurationMilliseconds: 300_000,
        afterReplacementStep: async (event) => {
          steps.push(event.step);
          if (event.step !== "clockLocked") return;
          entered.resolve();
          await release.promise;
        },
        observeQuery: (query) => queries.set(query.name, query),
      }).replace(command));
      await entered.promise;
      const second = runEffect(createReplacementPort(persistence).replace(
        command,
      ));
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        release.resolve();
      }
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.kind).sort()).toEqual([
        "alreadyReplaced",
        "replaced",
      ]);
      expect(results.every((result) => result.attemptFence === 2n)).toBe(true);
      expect(steps).toEqual([
        "clockLocked",
        "outcomeRechecked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
        "dependenciesValidated",
        "sessionEnteredRetrying",
        "journalDeleted",
        "leaseDeleted",
        "attemptFenceAdvanced",
        "leaseInserted",
        "journalRootInserted",
        "executionClaimInserted",
        "sessionRunning",
        "beforeCommit",
      ]);
      expect(await replacementState(
        persistence,
        command.sealIdentity.scopeUuid,
        command.authorityPins.sessionId,
      )).toMatchObject({
        lifecycle: "running",
        attempt_fence: "2",
        lease_fence: "2",
        root_fence: "2",
        root_state: "open",
        execution_claim_count: "1",
        execution_claim_fence: "1",
        receipt_count: "0",
        point_count: "0",
        event_count: "0",
        outcome_count: "0",
      });
      const sessionQuery = requireObservedQuery(queries, "lockSession");
      expect(sessionQuery.sql).not.toContain("validated_args_json");
      expect(sessionQuery.sql).not.toContain("authorization_grant_json");
      for (const name of [
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
        "enterRetrying",
        "deleteRetryJournal",
        "deleteRetryLease",
        "advanceAttemptFence",
      ] as const) {
        expect(await explainObserved(
          persistence,
          requireObservedQuery(queries, name),
        )).toContain("Index");
      }
      const later = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replace_once_later_commit",
      );
      await runEffect(createPublisher(persistence).publish(
        later.publicationCommand,
      ));
      await expect(runEffect(createReplacementPort(persistence, {
        leaseDurationMilliseconds: 1,
      }).replace(command))).resolves.toMatchObject({
        kind: "alreadyReplaced",
        attemptFence: 2n,
      });
    });
  }, 120_000);

  it("serializes one scope, permits independent-scope progress, and masks interruption", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96900000");
      const scope = await createScope(persistence, randomUuid, "replace_scope");
      const otherScope = await createScope(
        persistence,
        randomUuid,
        "replace_other_scope",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replace_scope_a",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replace_scope_b",
      );
      const independent = await createAttempt(
        persistence,
        randomUuid,
        otherScope,
        "replace_other_scope",
      );
      await installCompetingPointRow(persistence, first.command);
      await installCompetingPointRow(persistence, second.command);
      await installCompetingPointRow(persistence, independent.command);
      const entered = deferredSignal();
      const release = deferredSignal();
      let interruptedSettled = false;
      const firstFiber = Effect.runFork(createReplacementPort(persistence, {
        afterReplacementStep: async (event) => {
          if (event.step !== "beforeCommit") return;
          entered.resolve();
          await release.promise;
        },
        leaseDurationMilliseconds: 300_000,
      }).replace(replacementCommand(first.command)));
      await entered.promise;
      const secondPromise = runEffect(createReplacementPort(persistence)
        .replace(replacementCommand(second.command)));
      let interruption: Promise<unknown> | undefined;
      try {
        await waitForBlockedPointCommit(persistence, 1);
        await withTimeout(
          runEffect(createReplacementPort(persistence).replace(
            replacementCommand(independent.command),
          )),
          5_000,
          "independent O08-A scope",
        );
        interruption = runEffect(Fiber.interrupt(firstFiber)).then((exit) => {
          interruptedSettled = true;
          return exit;
        });
        await delay(25);
        expect(interruptedSettled).toBe(false);
      } finally {
        release.resolve();
      }
      if (interruption === undefined) {
        throw new Error("O08-A interruption proof did not start.");
      }
      await interruption;
      expect(interruptedSettled).toBe(true);
      await expect(secondPromise).resolves.toMatchObject({ kind: "replaced" });
      await expect(runEffect(createReplacementPort(persistence).replace(
        replacementCommand(first.command),
      ))).resolves.toMatchObject({ kind: "alreadyReplaced" });
    });
  }, 120_000);

  it("serializes against O07-B publication and exact-attempt abort", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96a00000");
      const scope = await createScope(persistence, randomUuid, "replace_races");

      const replacementFirst = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replacement_first",
      );
      await installCompetingPointRow(persistence, replacementFirst.command);
      const replacementEntered = deferredSignal();
      const replacementRelease = deferredSignal();
      const replacement = runEffect(createReplacementPort(persistence, {
        leaseDurationMilliseconds: 300_000,
        afterReplacementStep: async (event) => {
          if (event.step !== "beforeCommit") return;
          replacementEntered.resolve();
          await replacementRelease.promise;
        },
      }).replace(replacementCommand(replacementFirst.command)));
      await replacementEntered.promise;
      const latePublication = runFailure(createPublisher(persistence).publish(
        replacementFirst.publicationCommand,
      ));
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        replacementRelease.resolve();
      }
      await expect(replacement).resolves.toMatchObject({ kind: "replaced" });
      await expect(latePublication).resolves.toMatchObject({
        _tag: "PointCommitStaleAuthorityV1Error",
        reason: "attemptReplaced",
      });

      const publicationFirst = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "publication_first",
      );
      const publicationEntered = deferredSignal();
      const publicationRelease = deferredSignal();
      const publication = runEffect(createPublisher(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          publicationEntered.resolve();
          await publicationRelease.promise;
        },
      }).publish(publicationFirst.publicationCommand));
      await publicationEntered.promise;
      const lateReplacement = runFailure(createReplacementPort(persistence)
        .replace(replacementCommand(publicationFirst.command)));
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        publicationRelease.resolve();
      }
      await publication;
      const committed = await lateReplacement;
      expect(committed).toBeInstanceOf(
        PointMutationAttemptReplacementCommittedOutcomeV1Error,
      );
      expect(committed).toMatchObject({ reason: "committedOutcomeAvailable" });

      const abortRace = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "abort_race",
      );
      await installCompetingPointRow(persistence, abortRace.command);
      const abortEntered = deferredSignal();
      const abortRelease = deferredSignal();
      const replacementBeforeAbort = runEffect(createReplacementPort(
        persistence,
        {
          leaseDurationMilliseconds: 300_000,
          afterReplacementStep: async (event) => {
            if (event.step !== "clockLocked") return;
            abortEntered.resolve();
            await abortRelease.promise;
          },
        },
      ).replace(replacementCommand(abortRace.command)));
      await abortEntered.promise;
      const abort = runFailure(
        createPointMutationSessionAttemptTerminalizationPersistenceV1(
          scope.ports,
        ).abortEffect({
          selector: {
            deploymentId: abortRace.anchor.deploymentId,
            scopeId: abortRace.anchor.scopeId,
            sessionId: abortRace.anchor.sessionId,
            attemptFence: abortRace.anchor.attemptFence,
          },
          executionClaim: executionClaimForAnchor(abortRace.anchor),
          expectedSnapshotToken: abortRace.anchor.snapshotToken,
        }),
      );
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        abortRelease.resolve();
      }
      await expect(replacementBeforeAbort).resolves.toMatchObject({
        kind: "replaced",
      });
      await expect(abort).resolves.toMatchObject({
        _tag: "PointMutationSessionAttemptTerminalizationV1Error",
        issue: { reason: "staleAttemptFence" },
      });

      const expiryRace = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "expiry_race",
      );
      await installCompetingPointRow(persistence, expiryRace.command);
      const created = await persistence.query<{ created_at: Date }>(
        `select created_at from fx_system_tx_session
         where scope_uuid = $1 and session_id = $2`,
        [
          expiryRace.command.sealIdentity.scopeUuid,
          expiryRace.anchor.sessionId,
        ],
      );
      const createdAt = created.rows[0]?.created_at;
      if (!(createdAt instanceof Date)) throw new Error("Missing session time.");
      const expiresAtMilliseconds = createdAt.getTime() + 1;
      const expiresAt = new Date(expiresAtMilliseconds);
      await persistence.query(
        `update fx_system_tx_session
         set authorization_grant_expires_at = $3, hard_expires_at = $3
         where scope_uuid = $1 and session_id = $2`,
        [
          expiryRace.command.sealIdentity.scopeUuid,
          expiryRace.anchor.sessionId,
          expiresAt,
        ],
      );
      await persistence.query(
        `update fx_system_snapshot_lease set lease_expires_at = $3
         where scope_uuid = $1 and session_id = $2`,
        [
          expiryRace.command.sealIdentity.scopeUuid,
          expiryRace.anchor.sessionId,
          expiresAt,
        ],
      );
      const expiredCommand = Object.freeze({
        ...replacementCommand(expiryRace.command),
        session: Object.freeze({
          ...expiryRace.command.session,
          authorizationGrantExpiresAtMilliseconds: expiresAtMilliseconds,
          hardExpiresAtMilliseconds: expiresAtMilliseconds,
        }),
        sealIdentity: Object.freeze({
          ...expiryRace.command.sealIdentity,
          leaseExpiresAtMilliseconds: expiresAtMilliseconds,
        }),
      });
      const expiryEntered = deferredSignal();
      const expiryRelease = deferredSignal();
      const expiredReplacement = runFailure(createReplacementPort(
        persistence,
        {
          leaseDurationMilliseconds: 300_000,
          afterReplacementStep: async (event) => {
            if (event.step !== "clockLocked") return;
            expiryEntered.resolve();
            await expiryRelease.promise;
          },
        },
      ).replace(expiredCommand));
      await expiryEntered.promise;
      const expiry = runEffect(
        createPointMutationSessionAttemptTerminalizationPersistenceV1(
          scope.ports,
        ).expireEffect({
          deploymentId: expiryRace.anchor.deploymentId,
          scopeId: expiryRace.anchor.scopeId,
          sessionId: expiryRace.anchor.sessionId,
          attemptFence: expiryRace.anchor.attemptFence,
        }),
      );
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        expiryRelease.resolve();
      }
      await expect(expiredReplacement).resolves.toMatchObject({
        _tag: "PointMutationAttemptReplacementStaleAuthorityV1Error",
        reason: "expired",
      });
      await expect(expiry).resolves.toMatchObject({
        status: "terminalized",
        terminal: { lifecycle: "expired" },
      });
    });
  }, 120_000);

  it("rolls every replacement mutation phase back on PostgreSQL", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96b00000");
      const scope = await createScope(persistence, randomUuid, "replace_rollback");
      const phases = [
        "sessionEnteredRetrying",
        "journalDeleted",
        "leaseDeleted",
        "attemptFenceAdvanced",
        "leaseInserted",
        "journalRootInserted",
        "executionClaimInserted",
        "sessionRunning",
        "beforeCommit",
      ] as const;
      for (const phase of phases) {
        const attempt = await createAttempt(
          persistence,
          randomUuid,
          scope,
          `replace_rollback_${phase}`,
        );
        await installCompetingPointRow(persistence, attempt.command);
        const before = await replacementState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
          attempt.anchor.sessionId,
        );
        const failure = await runFailure(createReplacementPort(persistence, {
          leaseDurationMilliseconds: 300_000,
          afterReplacementStep: (event) => {
            if (event.step === phase) {
              throw new PointMutationAttemptReplacementCorruptionV1Error({
                reason: "replacementMutationInvalid",
              });
            }
            return Promise.resolve();
          },
        }).replace(replacementCommand(attempt.command)));
        expect(failure).toBeInstanceOf(
          PointMutationAttemptReplacementCorruptionV1Error,
        );
        expect(await replacementState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
          attempt.anchor.sessionId,
        )).toEqual(before);
      }
    });
  }, 120_000);
});

interface ScopeScenario {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof decodeReplacementScopeIdV1>;
  readonly schemaVersionId: ReturnType<
    typeof CatalogSchemaVersionIdSchema.make
  >;
  readonly ports: PointMutationSessionAuthorityResolutionPortsV1;
}

interface PreparedAttempt {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
  readonly command: PointCommitTransactionCommandV1;
  readonly publicationCommand: PointCommitPublicationCommandV1;
}

async function createScope(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  label: string,
): Promise<ScopeScenario> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_o06_postgres_${label}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_o06_postgres_${label}`,
  );
  const locator = Object.freeze({
    kind: "shared_database",
    databaseKey: `o06-postgres-${label}`,
    schemaName: "public",
  }) satisfies SharedDatabaseScopePhysicalLocator;
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator: locator, randomUuid },
  ).ensure({
    deploymentId,
    projectId: `project_o06_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [],
  });
  return Object.freeze({
    deploymentId,
    scopeId,
    schemaVersionId,
    ports: resolutionPorts(persistence),
  });
}

async function createAttempt(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  scope: ScopeScenario,
  label: string,
  materialWrite = true,
): Promise<PreparedAttempt> {
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      scope.ports,
      { leaseDurationMilliseconds: 300_000, randomUuid },
    ),
    pointMutationSessionActivationFixture(
      scope.deploymentId,
      scope.scopeId,
      {
        evidence: {
          schemaVersionId: scope.schemaVersionId,
          requestKey: TransactionRequestKeyV1Schema.make(
            `request:o06:postgres:${label}`,
          ),
        },
      },
    ),
  );
  const store = createSessionJournalStorePersistenceV1(scope.ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid,
  });
  const attempt = await runEffect(
    store.openAttemptEffect({
      selector: {
        deploymentId: scope.deploymentId,
        scopeId: scope.scopeId,
        sessionId: activation.anchor.sessionId,
        attemptFence: activation.anchor.attemptFence,
      },
      executionClaim: executionClaimForAnchor(activation.anchor),
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId: scope.schemaVersionId,
    }),
  );
  if (materialWrite) {
    const table = await runEffect(
      store.resolvePointTableEffect(attempt, "users"),
    );
    await runPointOperation(store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      fields: { name: label },
    });
  }
  const prepared = await prepareSeal(store, attempt);
  const journal = await runEffect(
    canonicalizeSessionJournalV1Effect(prepared.journal),
  );
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: true }),
  );
  await completeSeal(store, prepared.preparation, journal, result);
  const authority = authorityFromAnchor(
    activation.anchor,
    scope.schemaVersionId,
    executionClaimForAnchor(activation.anchor),
  );
  const loader = createStoredAttemptEvidenceLoaderV1(scope.ports);
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") {
    throw new Error(`Expected running O06 evidence, received ${running.kind}.`);
  }
  await runEffect(
    createPointCommitFinishingTransitionPortV1(scope.ports).enterFinishing(
      await pointCommitFinishingCommandFromStoredAttemptV1(
        authority,
        running.evidence,
      ),
    ),
  );
  const loaded = await runEffect(loader.loadFinishingEffect({
    deploymentId: activation.anchor.deploymentId,
    scopeId: activation.anchor.scopeId,
    sessionId: activation.anchor.sessionId,
    attemptFence: activation.anchor.attemptFence,
  }));
  if (loaded.kind !== "loaded") {
    throw new Error(`Expected O06 stored evidence, received ${loaded.kind}.`);
  }
  const command = await pointCommitCommandFromStoredAttemptV1(
    authority,
    loaded.evidence,
  );
  return Object.freeze({
    anchor: activation.anchor,
    authority,
    command,
    publicationCommand: Object.freeze({
      ...command,
      successfulResult: Object.freeze({
        valueCodecVersion: result.evidence.valueCodecVersion,
        value: Object.freeze({ ok: true }),
        canonicalBytes: result.canonicalBytes,
        semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex,
      }),
    }),
  });
}

function createPort(
  persistence: PostgresFlarexPersistence,
  options: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitRollbackProofPortV1(
    resolutionPorts(persistence),
    options,
  );
}

function createPublisher(
  persistence: PostgresFlarexPersistence,
  options: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitPublisherPortV1(
    resolutionPorts(persistence),
    options,
  );
}

function createPublisherWithRunner(
  persistence: PostgresFlarexPersistence,
  runnerOptions: PostgresLocatedReadCommittedRunnerOptionsV1,
  proofOptions: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitPublisherPortV1(
    resolutionPortsWithRunner(persistence, runnerOptions),
    proofOptions,
  );
}

function resolutionPortsWithRunner(
  persistence: PostgresFlarexPersistence,
  runnerOptions: PostgresLocatedReadCommittedRunnerOptionsV1,
): PointMutationSessionAuthorityResolutionPortsV1 {
  const base = resolutionPorts(persistence);
  return {
    ...base,
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createLocatedPointMutationSessionActivationTargetV1(
          persistence.drizzle,
          physicalLocator,
          {
            [LOCATED_READ_COMMITTED_RUNNER_V1]:
              createPostgresLocatedReadCommittedTransactionRunnerV1(
                persistence.pool,
                runnerOptions,
              ),
          },
        ),
    },
  };
}

interface CommitTriggerV1 {
  readonly triggerName: string;
  readonly functionName: string;
}

async function installCommitSqlStateTrigger(
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

async function installCommitDeadlockTrigger(
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

async function dropCommitTrigger(
  persistence: PostgresFlarexPersistence,
  trigger: CommitTriggerV1,
): Promise<void> {
  await persistence.query(
    `drop trigger ${trigger.triggerName} on fx_system_commit`,
  );
  await persistence.query(`drop function ${trigger.functionName}()`);
}

function installClientQueryFault(
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

function expectLocatedCleanupFailure(
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

async function expectDifferentPoolClient(
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

async function postgresBackendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ pid: number }>(
    "select pg_backend_pid()::int as pid",
  );
  const pid = result.rows[0]?.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid)) {
    throw new Error("PostgreSQL did not return a backend PID.");
  }
  return pid;
}

function emptyDurableState() {
  return {
    revisions: "0",
    current_rows: "0",
    commit_headers: "0",
    commit_changes: "0",
    outcomes: "0",
    wakes: "0",
    last_commit_seq: "0",
    last_outbox_seq: "0",
  } as const;
}

function createReplacementPort(
  persistence: PostgresFlarexPersistence,
  options: PointMutationAttemptReplacementOptionsV1 = {
    leaseDurationMilliseconds: 300_000,
  },
) {
  return createPointMutationAttemptReplacementPortV1(
    resolutionPorts(persistence),
    options,
  );
}

function replacementCommand(
  command: PointCommitTransactionCommandV1,
): PointMutationAttemptReplacementCommandV1 {
  return Object.freeze({
    authorityPins: command.authorityPins,
    session: command.session,
    sealIdentity: command.sealIdentity,
    dependencies: command.dependencies,
  });
}

async function installCompetingPointRow(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
): Promise<void> {
  const locked = deferredSignal();
  const release = deferredSignal();
  release.resolve();
  const commit = commitCompetingPointRow(
    persistence,
    command,
    locked,
    release,
  );
  await locked.promise;
  await commit;
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
): PointMutationSessionAuthorityResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared placement must not read split receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
    },
  };
}

function authorityFromAnchor(
  anchor: PointMutationSessionAnchorV1,
  schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>,
  executionClaim: NonNullable<
    StoredAttemptEvidenceAuthorityV1["executionClaim"]
  >,
): StoredAttemptEvidenceAuthorityV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
    storageGeneration: anchor.storageGeneration,
    storageGenerationFence: anchor.storageGenerationFence,
    snapshotToken: anchor.snapshotToken,
    schemaVersionId,
    executionClaim,
  });
}

async function commitCompetingPointRow(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
  locked: ReturnType<typeof deferredSignal>,
  release: ReturnType<typeof deferredSignal>,
): Promise<void> {
  const intent = command.rowIntent;
  if (intent === null || intent.kind !== "live") {
    throw new Error("O06 competing writer requires a live intent.");
  }
  const clock = await persistence.getScopeClock(command.authorityPins.scopeId);
  if (clock === null) throw new Error("Missing competing-writer scope clock.");
  const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
  const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
  const document = await canonicalizeFlarexValueV1(
    intent.value,
    "appDocument",
  );
  await persistence.drizzle.transaction(async (tx) => {
    await tx
      .select({ scopeUuid: fxSystemScopeClocks.scopeUuid })
      .from(fxSystemScopeClocks)
      .where(eq(
        fxSystemScopeClocks.scopeUuid,
        command.sealIdentity.scopeUuid,
      ))
      .limit(1)
      .for("update");
    locked.resolve();
    await release.promise;
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
      rowId: intent.rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId: command.authorityPins.schemaVersionId,
      creationTime: intent.creationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.insert(fxSystemCommits).values({
      scopeUuid: command.sealIdentity.scopeUuid,
      epochUuid,
      commitSeq,
      changeCount: 1,
    });
    await tx.insert(fxSystemCommitAppRowChanges).values({
      scopeUuid: command.sealIdentity.scopeUuid,
      epochUuid,
      commitSeq,
      changeOrdinal: 0,
      tableId: intent.tableId,
      rowId: appRowIdHexV1ToBytes(intent.rowId),
    });
    await tx
      .update(fxSystemScopeClocks)
      .set({ lastCommitSeq: commitSeq })
      .where(eq(
        fxSystemScopeClocks.scopeUuid,
        command.sealIdentity.scopeUuid,
      ));
  });
}

async function durableState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
) {
  const result = await persistence.query<{
    revisions: string;
    current_rows: string;
    commit_headers: string;
    commit_changes: string;
    outcomes: string;
    wakes: string;
    last_commit_seq: string;
    last_outbox_seq: string;
  }>(
    `
      select
        (select count(*)::text from fx_app_row_rev
          where scope_uuid = $1) as revisions,
        (select count(*)::text from fx_app_row_current
          where scope_uuid = $1) as current_rows,
        (select count(*)::text from fx_system_commit
          where scope_uuid = $1) as commit_headers,
        (select count(*)::text from fx_system_commit_app_row_change
          where scope_uuid = $1) as commit_changes,
        (select count(*)::text from fx_system_idempotency
          where scope_uuid = $1) as outcomes,
        (select count(*)::text from fx_system_outbox
          where scope_uuid = $1) as wakes,
        last_commit_seq::text,
        last_outbox_seq::text
      from fx_system_scope_clock
      where scope_uuid = $1
    `,
    [scopeUuid],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing O06 durable state.");
  return row;
}

async function replacementState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  sessionId: string,
) {
  const result = await persistence.query<{
    lifecycle: string;
    attempt_fence: string;
    lease_fence: string;
    root_fence: string;
    root_state: string;
    execution_claim_count: string;
    execution_claim_fence: string | null;
    receipt_count: string;
    point_count: string;
    event_count: string;
    outcome_count: string;
  }>(
    `select session.lifecycle,
      session.attempt_fence::text,
      lease.attempt_fence::text as lease_fence,
      root.attempt_fence::text as root_fence,
      root.state as root_state,
      (select count(*)::text from fx_system_tx_execution_claim
        where scope_uuid = $1 and session_id = $2) as execution_claim_count,
      claim.claim_fence::text as execution_claim_fence,
      (select count(*)::text from fx_system_tx_journal_latest_receipt
        where scope_uuid = $1 and session_id = $2) as receipt_count,
      (select count(*)::text from fx_system_tx_journal_point
        where scope_uuid = $1 and session_id = $2) as point_count,
      (select count(*)::text from fx_system_tx_journal_write_event
        where scope_uuid = $1 and session_id = $2) as event_count,
      (select count(*)::text from fx_system_idempotency
        where scope_uuid = $1) as outcome_count
    from fx_system_tx_session session
    join fx_system_snapshot_lease lease
      on lease.scope_uuid = session.scope_uuid
      and lease.session_id = session.session_id
    join fx_system_tx_journal root
      on root.scope_uuid = session.scope_uuid
      and root.session_id = session.session_id
    left join fx_system_tx_execution_claim claim
      on claim.scope_uuid = session.scope_uuid
      and claim.session_id = session.session_id
      and claim.attempt_fence = session.attempt_fence
    where session.scope_uuid = $1 and session.session_id = $2`,
    [scopeUuid, sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing O08-A replacement state.");
  return row;
}

async function terminalPublicationState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  sessionId: string,
) {
  const result = await persistence.query<{
    lifecycle: string;
    leases: string;
    journals: string;
    change_count: number;
    delivery_state: string;
    same_initial_time: boolean;
  }>(
    `
      select session.lifecycle,
        (select count(*)::text from fx_system_snapshot_lease
          where scope_uuid = $1 and session_id = $2) as leases,
        (select count(*)::text from fx_system_tx_journal
          where scope_uuid = $1 and session_id = $2) as journals,
        commit.change_count,
        wake.delivery_state,
        wake.created_at = wake.next_attempt_at as same_initial_time
      from fx_system_tx_session as session
      join fx_system_commit as commit
        on commit.scope_uuid = session.scope_uuid
      join fx_system_outbox as wake
        on wake.scope_uuid = commit.scope_uuid
        and wake.commit_seq = commit.commit_seq
      where session.scope_uuid = $1 and session.session_id = $2
    `,
    [scopeUuid, sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing O07-B terminal state.");
  return row;
}

async function waitForBlockedPointCommit(
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
          and query ilike '%fx_system_scope_clock%'
      `,
    );
    if ((result.rows[0]?.blocked ?? 0) >= expectedBlocked) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} blocked O06 transaction(s).`,
  );
}

function requireObservedQuery<Name extends string>(
  queries: ReadonlyMap<
    Name,
    Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
  >,
  name: Name,
) {
  const query = queries.get(name);
  if (query === undefined) throw new Error(`Missing O06 ${name} query.`);
  return query;
}

async function explainObserved(
  persistence: PostgresFlarexPersistence,
  query: Readonly<{
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
  }>,
): Promise<string> {
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const result = await client.query(
      `explain (format json) ${query.sql}`,
      [...query.params],
    );
    return JSON.stringify(result.rows);
  });
}

async function explainHeadLookup(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
): Promise<string> {
  const dependency = command.dependencies[0];
  if (dependency === undefined) throw new Error("Missing O06 dependency.");
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const result = await client.query(
      `
        explain (format json)
        select current_row.commit_seq, latest.commit_seq
        from (values ($1::integer, $2::bytea)) requested(table_id, row_id)
        left join fx_app_row_current current_row
          on current_row.scope_uuid = $3::uuid
          and current_row.table_id = requested.table_id
          and current_row.row_id = requested.row_id
        left join lateral (
          select revision.commit_seq
          from fx_app_row_rev revision
          where revision.scope_uuid = $3::uuid
            and revision.table_id = requested.table_id
            and revision.row_id = requested.row_id
          order by revision.commit_seq desc
          limit 1
        ) latest on true
      `,
      [
        dependency.tableId,
        appRowIdHexV1ToBytes(dependency.rowId),
        command.sealIdentity.scopeUuid,
      ],
    );
    return JSON.stringify(result.rows);
  });
}

async function expectSequentialScansEnabled(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const client = await persistence.pool.connect();
  try {
    const result = await client.query<{ enable_seqscan: string }>(
      "show enable_seqscan",
    );
    expect(result.rows).toEqual([{ enable_seqscan: "on" }]);
  } finally {
    client.release();
  }
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: true,
          },
        },
      },
    },
  };
}

function uuidFactory(prefix: string): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}

function deferredSignal(): Readonly<{
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

async function withTimeout<Value>(
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
