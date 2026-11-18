import { performance } from "node:perf_hooks";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from "flarex-protocol/commit-protocol";
import { expect, it } from "vitest";
import {
  PointCommitConflictV1Error,
  PointCommitStaleAuthorityV1Error,
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
  createPort,
  durableState,
  commitCompetingPointRow,
  enableIntrinsicIndexForPostgres,
  createPublisherWithRunner,
  createPublisher,
  intrinsicIndexState,
  compareIntrinsicIndexRows,
  type PreparedAttempt,
  describePostgres,
} from "./support/postgresFixture";
import {
  deferredSignal,
  waitForBlockedPointCommit,
  withTimeout,
  postgresBackendPid,
} from "./support/postgresFaults";
import {
  explainHeadLookup,
  percentileNearestRank,
} from "./support/postgresDiagnostics";

describePostgres("real Postgres O06 point-commit transaction kernel", () => {
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
      const firstPromise = runEffect(
        createPort(persistence, {
          afterTransactionStep: async (event) => {
            if (event.step !== "clockLocked") return;
            order.push("first-clock");
            entered.resolve();
            await release.promise;
          },
        }).prove(first.command),
      );
      await entered.promise;
      const secondPromise = runEffect(
        createPort(persistence, {
          afterTransactionStep: (event) => {
            if (event.step === "clockLocked") order.push("second-clock");
            return Promise.resolve();
          },
        }).prove(second.command),
      );
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
      expect(
        await durableState(persistence, first.command.sealIdentity.scopeUuid),
      ).toMatchObject({ revisions: "0", last_commit_seq: "0" });
      expect(
        await durableState(
          persistence,
          independent.command.sealIdentity.scopeUuid,
        ),
      ).toMatchObject({ revisions: "0", last_commit_seq: "0" });
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
      const proof = runEffect(
        createPort(persistence, {
          afterTransactionStep: async (event) => {
            if (event.step !== "clockLocked") return;
            entered.resolve();
            await release.promise;
          },
        }).prove(attempt.command),
      );
      await entered.promise;
      let revocationSettled = false;
      const revocation = persistence
        .query(
          `
          update fx_system_scope_execution_authority
          set authorization_revocation_epoch =
            authorization_revocation_epoch + 1
          where scope_id = (select scope_id from fx_system_scope_clock where scope_uuid = $1)
        `,
          [attempt.command.sealIdentity.scopeUuid],
        )
        .then(() => {
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
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toMatchObject({ revisions: "0", last_commit_seq: "0" });
    });
  }, 120_000);

  it("observes a competing committed row after the clock wait as an OCC conflict", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96300000");
      const scope = await createScope(persistence, randomUuid, "occ_race");
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
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toMatchObject({
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

  it("proves CE0 same-index disjoint commits wait on the scope clock while another scope progresses", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96450000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "ce0_shared_index",
      );
      const other = await createScope(persistence, randomUuid, "ce0_other_scope");
      const intrinsic = await enableIntrinsicIndexForPostgres(persistence, scope);
      const otherIntrinsic = await enableIntrinsicIndexForPostgres(
        persistence,
        other,
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "ce0_first",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "ce0_second",
      );
      const independent = await createAttempt(
        persistence,
        randomUuid,
        other,
        "ce0_independent",
      );
      expect(first.command.rowIntents[0]?.rowId).not.toEqual(
        second.command.rowIntents[0]?.rowId,
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      let blockerPid = 0;
      let waiterPid = 0;
      let secondLocked = false;
      const firstPublication = runEffect(
        createPublisherWithRunner(
          persistence,
          {
            afterAcquire: async (client) => {
              blockerPid = await postgresBackendPid(client);
            },
          },
          {
            ...intrinsic,
            afterTransactionStep: async (event) => {
              if (event.step === "intrinsicIndexBuildLocked") {
                entered.resolve();
                await release.promise;
              }
            },
          },
        ).publish(first.publicationCommand),
      );
      let secondPublication: typeof firstPublication | undefined;
      // Attach rejection handlers immediately, but preserve the original
      // promises for outcome assertions. Timed-out work still owns its
      // connection; all three operations must settle before fixture reset.
      const settlements = [Promise.allSettled([firstPublication])];
      try {
        await withTimeout(
          Promise.race([
            entered.promise,
            firstPublication.then(() => {
              throw new Error("Missing CE0 index-lock barrier.");
            }),
          ]),
          10_000,
          "CE0 first writer",
        );
        secondPublication = runEffect(
          createPublisherWithRunner(
            persistence,
            {
              afterAcquire: async (client) => {
                waiterPid = await postgresBackendPid(client);
              },
            },
            {
              ...intrinsic,
              afterTransactionStep: async (event) => {
                if (event.step === "clockLocked") secondLocked = true;
              },
            },
          ).publish(second.publicationCommand),
        );
        settlements.push(Promise.allSettled([secondPublication]));
        await waitForBlockedPointCommit(persistence, 1);
        expect(blockerPid).not.toBe(waiterPid);
        expect(waiterPid).toBeGreaterThan(0);
        const blocked = await persistence.query<{ blocked: boolean }>(
          "select $1::int = any(pg_blocking_pids($2::int)) as blocked",
          [blockerPid, waiterPid],
        );
        expect(blocked.rows).toEqual([{ blocked: true }]);
        expect(secondLocked).toBe(false);
        const independentPublication = runEffect(
          createPublisher(persistence, otherIntrinsic).publish(
            independent.publicationCommand,
          ),
        );
        settlements.push(Promise.allSettled([independentPublication]));
        const independentResult = await withTimeout(
          independentPublication,
          10_000,
          "CE0 independent scope",
        );
        expect(independentResult).toMatchObject({
          kind: "published",
          token: { commitSeq: 1n },
        });
        expect(secondLocked).toBe(false);
      } finally {
        release.resolve();
        await Promise.all(settlements);
      }
      if (secondPublication === undefined)
        throw new Error("CE0 second writer did not start.");
      const results = await Promise.all([firstPublication, secondPublication]);
      expect(results.map((result) => result.token.commitSeq)).toEqual([1n, 2n]);
      expect(
        await durableState(persistence, first.command.sealIdentity.scopeUuid),
      ).toEqual({
        revisions: "2",
        current_rows: "2",
        commit_headers: "2",
        commit_changes: "2",
        outcomes: "2",
        wakes: "2",
        last_commit_seq: "2",
      });
      expect(
        (
          await intrinsicIndexState(
            persistence,
            first.command.sealIdentity.scopeUuid,
          )
        ).current,
      ).toHaveLength(2);
    });
  }, 120_000);

  it("keeps concurrent at-limit commits bounded to their scope", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96430000");
      const contendedScope = await createScope(
        persistence,
        randomUuid,
        "material_contention",
      );
      const independentScope = await createScope(
        persistence,
        randomUuid,
        "material_independent",
      );
      const contendedIntrinsic = await enableIntrinsicIndexForPostgres(
        persistence,
        contendedScope,
      );
      const independentIntrinsic = await enableIntrinsicIndexForPostgres(
        persistence,
        independentScope,
      );
      const attempts: Array<PreparedAttempt> = [];
      for (let index = 0; index < 8; index += 1) {
        attempts.push(
          await createAttempt(
            persistence,
            randomUuid,
            contendedScope,
            `material_contention_${index}`,
            MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
          ),
        );
      }
      const independent = await createAttempt(
        persistence,
        randomUuid,
        independentScope,
        "material_independent",
        MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
      );
      const preCommitKernelMilliseconds = new Array<number | undefined>(
        attempts.length,
      );
      const settlementInclusiveMilliseconds = new Array<number | undefined>(
        attempts.length,
      );
      const publicationStartedAt = performance.now();
      const contendedPublications = attempts.map((attempt, index) => {
        let clockLockedAt: number | undefined;
        return runEffect(
          createPublisher(persistence, {
            ...contendedIntrinsic,
            afterTransactionStep: (event) => {
              if (event.step === "clockLocked") {
                clockLockedAt = performance.now();
              } else if (event.step === "beforeCommit") {
                if (clockLockedAt === undefined) {
                  throw new Error(
                    "Missing contended O09-A clock-lock evidence.",
                  );
                }
                preCommitKernelMilliseconds[index] =
                  performance.now() - clockLockedAt;
              }
              return Promise.resolve();
            },
          }).publish(attempt.publicationCommand),
        ).then((result) => {
          if (clockLockedAt === undefined) {
            throw new Error("Missing settled O09-A clock-lock evidence.");
          }
          settlementInclusiveMilliseconds[index] =
            performance.now() - clockLockedAt;
          return result;
        });
      });
      const independentStartedAt = performance.now();
      const independentPublication = runEffect(
        createPublisher(persistence, {
          ...independentIntrinsic,
        }).publish(independent.publicationCommand),
      ).then((result) =>
        Object.freeze({
          result,
          elapsedMilliseconds: performance.now() - independentStartedAt,
        }),
      );
      const [contendedResults, independentResult] = await Promise.all([
        Promise.all(contendedPublications),
        independentPublication,
      ]);
      const contendedElapsedMilliseconds =
        performance.now() - publicationStartedAt;
      if (
        preCommitKernelMilliseconds.some(
          (value) => typeof value !== "number" || !Number.isFinite(value),
        ) ||
        settlementInclusiveMilliseconds.some(
          (value) => typeof value !== "number" || !Number.isFinite(value),
        )
      ) {
        throw new Error("Incomplete contended O09-A lock-window evidence.");
      }
      const sortedPreCommitKernel = preCommitKernelMilliseconds
        .map((value) => {
          if (value === undefined) {
            throw new Error("Missing contended O09-A pre-commit observation.");
          }
          return value;
        })
        .sort((left, right) => left - right);
      const sortedSettlementInclusive = settlementInclusiveMilliseconds
        .map((value) => {
          if (value === undefined) {
            throw new Error("Missing contended O09-A settlement observation.");
          }
          return value;
        })
        .sort((left, right) => left - right);
      const preCommitP99 = percentileNearestRank(sortedPreCommitKernel, 0.99);
      const settlementP50 = percentileNearestRank(
        sortedSettlementInclusive,
        0.5,
      );
      const settlementP95 = percentileNearestRank(
        sortedSettlementInclusive,
        0.95,
      );
      const settlementP99 = percentileNearestRank(
        sortedSettlementInclusive,
        0.99,
      );

      expect(contendedResults).toHaveLength(8);
      expect(
        contendedResults.every((result) => result.kind === "published"),
      ).toBe(true);
      expect(independentResult.result).toMatchObject({ kind: "published" });
      expect(settlementP50).toBeLessThan(30_000);
      expect(settlementP95).toBeLessThan(30_000);
      expect(settlementP99).toBeLessThan(30_000);
      expect(contendedElapsedMilliseconds).toBeLessThan(120_000);
      expect(independentResult.elapsedMilliseconds).toBeLessThan(
        contendedElapsedMilliseconds,
      );
      const firstContendedAttempt = attempts[0];
      if (firstContendedAttempt === undefined) {
        throw new Error("Missing first contended O09-A attempt.");
      }
      expect(
        await durableState(
          persistence,
          firstContendedAttempt.command.sealIdentity.scopeUuid,
        ),
      ).toEqual({
        revisions: (8 * MAX_POINT_COMMIT_MATERIAL_ROWS_V1).toString(),
        current_rows: (8 * MAX_POINT_COMMIT_MATERIAL_ROWS_V1).toString(),
        commit_headers: "8",
        commit_changes: (8 * MAX_POINT_COMMIT_MATERIAL_ROWS_V1).toString(),
        outcomes: "8",
        wakes: "8",
        last_commit_seq: "8",
      });
      const expectedContendedSidecars = contendedResults
        .flatMap((result, attemptIndex) => {
          if (result.kind !== "published") {
            throw new Error("Expected a published contended O09-A outcome.");
          }
          const attempt = attempts[attemptIndex];
          if (attempt === undefined) {
            throw new Error("Missing contended O09-A sidecar attempt.");
          }
          return attempt.command.rowIntents.map((intent) => ({
            tableId: intent.tableId.toString(),
            rowIdHex: intent.rowId.replaceAll("-", ""),
            commitSeq: result.token.commitSeq.toString(),
            isTombstone: false,
          }));
        })
        .sort(compareIntrinsicIndexRows);
      expect(
        await intrinsicIndexState(
          persistence,
          firstContendedAttempt.command.sealIdentity.scopeUuid,
        ),
      ).toEqual({
        revisions: expectedContendedSidecars,
        current: expectedContendedSidecars.map(
          ({ isTombstone: _, ...row }) => row,
        ),
      });
      expect(
        await durableState(
          persistence,
          independent.command.sealIdentity.scopeUuid,
        ),
      ).toEqual({
        revisions: MAX_POINT_COMMIT_MATERIAL_ROWS_V1.toString(),
        current_rows: MAX_POINT_COMMIT_MATERIAL_ROWS_V1.toString(),
        commit_headers: "1",
        commit_changes: MAX_POINT_COMMIT_MATERIAL_ROWS_V1.toString(),
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
      });
      if (independentResult.result.kind !== "published") {
        throw new Error("Expected a published independent O09-A outcome.");
      }
      const expectedIndependentSidecars = independent.command.rowIntents
        .map((intent) => ({
          tableId: intent.tableId.toString(),
          rowIdHex: intent.rowId.replaceAll("-", ""),
          commitSeq: independentResult.result.token.commitSeq.toString(),
          isTombstone: false,
        }))
        .sort(compareIntrinsicIndexRows);
      expect(
        await intrinsicIndexState(
          persistence,
          independent.command.sealIdentity.scopeUuid,
        ),
      ).toEqual({
        revisions: expectedIndependentSidecars,
        current: expectedIndependentSidecars.map(
          ({ isTombstone: _, ...row }) => row,
        ),
      });

      if (process.env.FLAREX_PRINT_POINT_COMMIT_PROFILE === "1") {
        console.info("O09-A PostgreSQL contention profile", {
          rowCountPerCommit: MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
          writers: attempts.length,
          preCommitP99,
          settlementP50,
          settlementP95,
          settlementP99,
          contendedElapsedMilliseconds,
          independentElapsedMilliseconds: independentResult.elapsedMilliseconds,
        });
      }
    });
  }, 480_000);

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
      const first = runEffect(
        createPublisher(persistence, {
          afterTransactionStep: async (event) => {
            if (event.step !== "clockLocked") return;
            entered.resolve();
            await release.promise;
          },
        }).publish(attempt.publicationCommand),
      );
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
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toMatchObject({
        revisions: "1",
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
      });

      const lateProof = await runFailure(
        createPort(persistence).prove(attempt.command),
      );
      expect(lateProof).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toMatchObject({ commit_headers: "1", outcomes: "1", wakes: "1" });
    });
  }, 120_000);

  it("serializes distinct same-scope publications into dense paired heads", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96600000");
      const scope = await createScope(persistence, randomUuid, "dense_publish");
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
        runEffect(
          createPublisher(persistence).publish(first.publicationCommand),
        ),
        runEffect(
          createPublisher(persistence).publish(second.publicationCommand),
        ),
      ]);
      expect(results.map((result) => result.token.commitSeq).sort()).toEqual([
        1n,
        2n,
      ]);
      expect(
        await durableState(persistence, first.command.sealIdentity.scopeUuid),
      ).toEqual({
        revisions: "2",
        current_rows: "2",
        commit_headers: "2",
        commit_changes: "2",
        outcomes: "2",
        wakes: "2",
        last_commit_seq: "2",
      });
      const sequenceRows = await persistence.query<{
        commit_seq: string;
      }>(
        `
          select commit_seq::text
          from fx_system_commit_wake
          where scope_uuid = $1
          order by commit_seq
        `,
        [first.command.sealIdentity.scopeUuid],
      );
      expect(sequenceRows.rows).toEqual([
        { commit_seq: "1" },
        { commit_seq: "2" },
      ]);
    });
  }, 120_000);
});
