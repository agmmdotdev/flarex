import {
  PointCommitPublicationObservation,
  type PointCommitPublicationEvent,
} from "../../../src/commit/point/observation";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Exit, Fiber, Result } from "effect";
import { expect, it } from "vitest";
import {
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitDecisionUncertainV1Error,
  PointCommitSqlErrorV1,
} from "../../../src/commit/point/errors";
import {
  runEffect,
  runEffectFailure as runFailure,
} from "../../support/effectTestRuntime";
import {
  withPostgresPersistence,
  uuidFactory,
  createScope,
  createAttempt,
  createPublisher,
  durableState,
  emptyDurableState,
  createPublisherWithRunner,
  describePostgres,
} from "./support/postgresFixture";
import {
  installCommitSqlStateTrigger,
  dropCommitTrigger,
  installCommitDeadlockTrigger,
  postgresBackendPid,
  installClientQueryFault,
  expectLocatedCleanupFailure,
  expectDifferentPoolClient,
  deferredSignal,
} from "./support/postgresFaults";

describePostgres("real Postgres O08-CD0 decision provenance", () => {
  it("confirms a server 40001 only after rollback and leaves no sequence gap", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97400000");
      const scope = await createScope(persistence, randomUuid, "cd0_40001");
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
        expect(
          await durableState(
            persistence,
            attempt.command.sealIdentity.scopeUuid,
          ),
        ).toEqual(emptyDurableState());
      } finally {
        await dropCommitTrigger(persistence, trigger);
      }

      await expect(
        runEffect(
          createPublisher(persistence).publish(attempt.publicationCommand),
        ),
      ).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
      });
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
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
        runEffect(
          Effect.result(
            createPublisher(persistence).publish(first.publicationCommand),
          ),
        ),
        runEffect(
          Effect.result(
            createPublisher(persistence).publish(second.publicationCommand),
          ),
        ),
      ]);
      await dropCommitTrigger(persistence, trigger);

      const succeededIndexes = results.flatMap((result, index) =>
        Result.isSuccess(result) ? [index] : [],
      );
      const failedIndexes = results.flatMap((result, index) =>
        Result.isFailure(result) ? [index] : [],
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
      expect(
        await durableState(persistence, victim.command.sealIdentity.scopeUuid),
      ).toEqual(emptyDurableState());
      await expect(
        runEffect(
          createPublisher(persistence).publish(victim.publicationCommand),
        ),
      ).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
      });
      for (const attempt of attempts) {
        expect(
          await durableState(
            persistence,
            attempt.command.sealIdentity.scopeUuid,
          ),
        ).toMatchObject({
          commit_headers: "1",
          outcomes: "1",
          wakes: "1",
          last_commit_seq: "1",
        });
      }
    });
  }, 120_000);

  it("preserves rollback and release failures and quarantines their clients", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97600000");
      const scope = await createScope(persistence, randomUuid, "cd0_cleanup");
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
                : forward(),
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
      expect(
        await durableState(
          persistence,
          rollbackAttempt.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(emptyDurableState());

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
      expect(
        await durableState(
          persistence,
          releaseAttempt.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(emptyDurableState());
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
          afterAcquire: (client) =>
            installClientQueryFault(client, (statement, forward) =>
              statement === "commit"
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
      await expect(
        runEffect(
          createPublisher(persistence).publish(committed.publicationCommand),
        ),
      ).resolves.toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      expect(
        await durableState(
          persistence,
          committed.command.sealIdentity.scopeUuid,
        ),
      ).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
      });

      const missing = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_commit_missing",
      );
      const missingFailure = await runFailure(
        createPublisherWithRunner(persistence, {
          afterAcquire: (client) =>
            installClientQueryFault(client, (statement, forward) =>
              statement === "commit"
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
      expect(
        await durableState(persistence, missing.command.sealIdentity.scopeUuid),
      ).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
      });
      await expect(
        runEffect(
          createPublisher(persistence).publish(missing.publicationCommand),
        ),
      ).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 2n },
      });
      expect(
        await durableState(persistence, missing.command.sealIdentity.scopeUuid),
      ).toMatchObject({
        commit_headers: "2",
        outcomes: "2",
        wakes: "2",
        last_commit_seq: "2",
      });
    });
  }, 120_000);

  it("holds interruption until a forwarded COMMIT response settles", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97800000");
      const scope = await createScope(persistence, randomUuid, "cd0_interrupt");
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_interrupt",
      );
      const committed = deferredSignal();
      const release = deferredSignal();
      const phaseEvents: PointCommitPublicationEvent[] = [];
      const observation = new PointCommitPublicationObservation({ detail: false, record: event => {
        phaseEvents.push(event);
        throw new Error("COMMIT interruption collector unavailable");
      } });
      const fiber = Effect.runFork(
        createPublisherWithRunner(persistence, {
          afterAcquire: (client) =>
            installClientQueryFault(client, (statement, forward) =>
              statement === "commit"
                ? Promise.resolve(forward()).then(async () => {
                    committed.resolve();
                    await release.promise;
                    throw new Error("forwarded COMMIT response lost");
                  })
                : forward(),
            ),
        }, { publicationObservation: observation }).publish(attempt.publicationCommand),
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
      expect(Exit.hasInterrupts(await runEffect(Fiber.await(fiber)))).toBe(
        true,
      );
      await expect(
        runEffect(
          createPublisher(persistence).publish(attempt.publicationCommand),
        ),
      ).resolves.toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
      });
      for (const phase of ["occProof", "lowering", "clockAdvance"])
        for (const edge of ["begin", "end"])
          expect(phaseEvents).toContainEqual({ kind: "phase", phase, edge });
      expect(observation.status().failureCount).toBeGreaterThan(0);
      expect(() => observation.assertHealthy()).toThrow("publication observation failed");
    });
  }, 120_000);
});
