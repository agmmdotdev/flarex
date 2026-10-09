import { setTimeout as delay } from "node:timers/promises";
import { Effect, Fiber } from "effect";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { expect, it } from "vitest";
import {
  PointMutationAttemptReplacementCommittedOutcomeV1Error,
  PointMutationAttemptReplacementCorruptionV1Error,
  type PointMutationAttemptReplacementSqlOperationV1,
} from "../../../src/commit/point/errors";
import { createPointMutationSessionAttemptTerminalizationPersistenceV1 } from "../../../src/execution/transactionSessionActivation";
import {
  runEffect,
  runEffectFailure as runFailure,
} from "../../support/effectTestRuntime";
import { executionClaimForAnchor } from "../../execution/transactionSessionActivationTestSupport";
import {
  withPostgresPersistence,
  uuidFactory,
  createScope,
  createAttempt,
  installCompetingPointRow,
  replacementCommand,
  createReplacementPort,
  replacementState,
  createPublisher,
  describePostgres,
} from "./support/postgresFixture";
import {
  deferredSignal,
  waitForBlockedPointCommit,
  withTimeout,
} from "./support/postgresFaults";
import {
  requireObservedQuery,
  explainObserved,
} from "./support/postgresDiagnostics";

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
        Readonly<{
          readonly sql: string;
          readonly params: ReadonlyArray<unknown>;
        }>
      >();
      const first = runEffect(
        createReplacementPort(persistence, {
          leaseDurationMilliseconds: 300_000,
          afterReplacementStep: async (event) => {
            steps.push(event.step);
            if (event.step !== "clockLocked") return;
            entered.resolve();
            await release.promise;
          },
          observeQuery: (query) => queries.set(query.name, query),
        }).replace(command),
      );
      await entered.promise;
      const second = runEffect(
        createReplacementPort(persistence).replace(command),
      );
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
      expect(
        await replacementState(
          persistence,
          command.sealIdentity.scopeUuid,
          command.authorityPins.sessionId,
        ),
      ).toMatchObject({
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
        expect(
          await explainObserved(
            persistence,
            requireObservedQuery(queries, name),
          ),
        ).toContain("Index");
      }
      const later = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replace_once_later_commit",
      );
      await runEffect(
        createPublisher(persistence).publish(later.publicationCommand),
      );
      await expect(
        runEffect(
          createReplacementPort(persistence, {
            leaseDurationMilliseconds: 1,
          }).replace(command),
        ),
      ).resolves.toMatchObject({
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
      const firstFiber = Effect.runFork(
        createReplacementPort(persistence, {
          afterReplacementStep: async (event) => {
            if (event.step !== "beforeCommit") return;
            entered.resolve();
            await release.promise;
          },
          leaseDurationMilliseconds: 300_000,
        }).replace(replacementCommand(first.command)),
      );
      await entered.promise;
      const secondPromise = runEffect(
        createReplacementPort(persistence).replace(
          replacementCommand(second.command, CommitSeqSchema.make(2n)),
        ),
      );
      let interruption: Promise<unknown> | undefined;
      try {
        await waitForBlockedPointCommit(persistence, 1);
        await withTimeout(
          runEffect(
            createReplacementPort(persistence).replace(
              replacementCommand(independent.command),
            ),
          ),
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
      await expect(
        runEffect(
          createReplacementPort(persistence).replace(
            replacementCommand(first.command),
          ),
        ),
      ).resolves.toMatchObject({ kind: "alreadyReplaced" });
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
      const replacement = runEffect(
        createReplacementPort(persistence, {
          leaseDurationMilliseconds: 300_000,
          afterReplacementStep: async (event) => {
            if (event.step !== "beforeCommit") return;
            replacementEntered.resolve();
            await replacementRelease.promise;
          },
        }).replace(replacementCommand(replacementFirst.command)),
      );
      await replacementEntered.promise;
      const latePublication = runFailure(
        createPublisher(persistence).publish(
          replacementFirst.publicationCommand,
        ),
      );
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
      const publication = runEffect(
        createPublisher(persistence, {
          afterTransactionStep: async (event) => {
            if (event.step !== "clockLocked") return;
            publicationEntered.resolve();
            await publicationRelease.promise;
          },
        }).publish(publicationFirst.publicationCommand),
      );
      await publicationEntered.promise;
      const lateReplacement = runFailure(
        createReplacementPort(persistence).replace(
          replacementCommand(publicationFirst.command),
        ),
      );
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
      const replacementBeforeAbort = runEffect(
        createReplacementPort(persistence, {
          leaseDurationMilliseconds: 300_000,
          afterReplacementStep: async (event) => {
            if (event.step !== "clockLocked") return;
            abortEntered.resolve();
            await abortRelease.promise;
          },
        }).replace(replacementCommand(abortRace.command)),
      );
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
      if (!(createdAt instanceof Date))
        throw new Error("Missing session time.");
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
      const expiredReplacement = runFailure(
        createReplacementPort(persistence, {
          leaseDurationMilliseconds: 300_000,
          afterReplacementStep: async (event) => {
            if (event.step !== "clockLocked") return;
            expiryEntered.resolve();
            await expiryRelease.promise;
          },
        }).replace(expiredCommand),
      );
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
      const scope = await createScope(
        persistence,
        randomUuid,
        "replace_rollback",
      );
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
        const failure = await runFailure(
          createReplacementPort(persistence, {
            leaseDurationMilliseconds: 300_000,
            afterReplacementStep: (event) => {
              if (event.step === phase) {
                throw new PointMutationAttemptReplacementCorruptionV1Error({
                  reason: "replacementMutationInvalid",
                });
              }
              return Promise.resolve();
            },
          }).replace(replacementCommand(attempt.command)),
        );
        expect(failure).toBeInstanceOf(
          PointMutationAttemptReplacementCorruptionV1Error,
        );
        expect(
          await replacementState(
            persistence,
            attempt.command.sealIdentity.scopeUuid,
            attempt.anchor.sessionId,
          ),
        ).toEqual(before);
      }
    });
  }, 120_000);
});
