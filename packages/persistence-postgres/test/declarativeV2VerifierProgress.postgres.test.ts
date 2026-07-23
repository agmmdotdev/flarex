import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2BudgetFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";

import {
  makeDeclarativeV2InertRepositoryV1,
} from "../src/declarativeV2InertRepository";
import {
  makeDeclarativeV2VerifierProgressRepositoryV1,
} from "../src/declarativeV2VerifierProgress";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
} from "../src/postgres";
import {
  isLocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
  insertSessionTestScope,
} from "./sessionAuthorityTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const scopeId = `scope_${SESSION_TEST_SCOPE_UUID}`;
const epoch = `epoch_${SESSION_TEST_EPOCH_UUID}`;
const budget = {
  maximumCalls: 200,
  maximumRows: 200,
  maximumFrameBytes: 4_000_000,
  maximumCanonicalBytes: 4_000_000,
  maximumHashBytes: 4_000_000,
  maximumElapsedMilliseconds: 60_000,
} as const;

describePostgres("real Postgres Declarative V2 verifier progress", () => {
  it("serializes acquisition, takes over pending work, and fences stale settle", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const { target, attemptSha256 } = await createAttempt(persistence);
      const left = makeDeclarativeV2VerifierProgressRepositoryV1(target, {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "11111111-1111-4111-8111-111111111111",
      });
      const right = makeDeclarativeV2VerifierProgressRepositoryV1(target, {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "22222222-2222-4222-8222-222222222222",
      });
      const contenders = await Promise.allSettled([
        runEffect(left.acquire(scopeId, attemptSha256, budget)),
        runEffect(right.acquire(scopeId, attemptSha256, budget)),
      ]);
      expect(contenders.filter(result => result.status === "fulfilled"))
        .toHaveLength(1);
      expect(contenders.filter(result => result.status === "rejected"))
        .toHaveLength(1);
      const winnerResult = contenders.find(
        result => result.status === "fulfilled",
      );
      if (winnerResult?.status !== "fulfilled") {
        throw new Error("Expected one acquisition winner.");
      }
      const winner = winnerResult.value;
      if (winner.kind !== "acquired") throw new Error("Expected acquire.");
      const winnerRepository = winner.attempt.writerFence === 1n
        ? (
          contenders[0]?.status === "fulfilled"
            ? left
            : right
        )
        : left;
      const loserRepository = winnerRepository === left ? right : left;
      const reserved = await runEffect(winnerRepository.reserveCommand(
        winner.run,
        {
          commandKind: "source_page",
          sequence: 1n,
          previousReceiptSha256: null,
          commandBudget: semanticBudget("command_budget", 2n),
          inputSha256: digest(0x41),
        },
        budget,
      ));
      if (reserved.kind === "settledReplay") throw new Error("Expected work.");
      await persistence.query(`
        update fx_system_declarative_v2_verifier_attempt
        set
          lease_updated_at = clock_timestamp() - interval '2 seconds',
          lease_expires_at = clock_timestamp() - interval '1 second'
      `);
      const takeover = await runEffect(
        loserRepository.acquire(scopeId, attemptSha256, budget),
      );
      if (takeover.kind !== "acquired") throw new Error("Expected takeover.");
      expect(takeover.attempt).toMatchObject({
        pendingKind: "source_page",
        usage: { calls: 2n },
      });
      const staleSettle = await runEffectFailure(
        winnerRepository.settleCommand(
          reserved.work,
          {
            frames: [],
            nextLifecycle: "parsing",
            nextProgress: {
              kind: "progress_cursor",
              phase: "parse",
              settledSequence: 1n,
              moduleOrdinal: 0n,
              edgeOrdinal: 0n,
              pageOrdinal: 0n,
              previousReceiptSha256: null,
            },
          },
          budget,
        ),
      );
      expect(staleSettle).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressStaleV1Error",
        reason: "ownerChanged",
      });
      const resumed = await runEffect(loserRepository.resumePending(
        takeover.run,
        digest(0x41),
        budget,
      ));
      const settled = await runEffect(loserRepository.settleCommand(
        resumed.work,
        {
          frames: [],
          nextLifecycle: "parsing",
          nextProgress: {
            kind: "progress_cursor",
            phase: "parse",
            settledSequence: 1n,
            moduleOrdinal: 0n,
            edgeOrdinal: 0n,
            pageOrdinal: 0n,
            previousReceiptSha256: null,
          },
        },
        budget,
      ));
      expect(settled.receipt.sequence).toBe(1n);
      const row = await persistence.query<{
        settled_sequence: string;
        pending_kind: string | null;
      }>(`
        select settled_sequence::text, pending_kind
        from fx_system_declarative_v2_verifier_attempt
      `);
      expect(row.rows).toEqual([{
        settled_sequence: "1",
        pending_kind: null,
      }]);
      await runEffect(loserRepository.release(takeover.run, budget));
      const coldRepository =
        makeDeclarativeV2VerifierProgressRepositoryV1(target, {
          claimDurationMilliseconds: 60_000,
          randomUuid: () => "44444444-4444-4444-8444-444444444444",
        });
      const cold = await runEffect(
        coldRepository.acquire(scopeId, attemptSha256, budget),
      );
      if (cold.kind !== "acquired") throw new Error("Expected cold acquire.");
      const replay = await runEffect(coldRepository.reserveCommand(
        cold.run,
        {
          commandKind: "source_page",
          sequence: 1n,
          previousReceiptSha256: null,
          commandBudget: semanticBudget("command_budget", 2n),
          inputSha256: digest(0x41),
        },
        budget,
      ));
      expect(replay.kind).toBe("settledReplay");
      if (replay.kind !== "settledReplay") {
        throw new Error("Expected settled replay.");
      }
      expect(replay.receipt).toEqual(settled.receipt);
    });
  }, 60_000);

  it("mints no handle after a lost-response decision uncertainty", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const { target, attemptSha256 } = await createAttempt(persistence);
      let transactionCount = 0;
      const uncertainTarget: LocatedReadCommittedAttemptTargetV1 = {
        physicalLocator: target.physicalLocator,
        getCurrentClock: scope => target.getCurrentClock(scope),
        [RUN_LOCATED_READ_COMMITTED_V1]: async work => {
          transactionCount += 1;
          const result = await target[RUN_LOCATED_READ_COMMITTED_V1](work);
          if (transactionCount === 1) return result;
          throw new LocatedReadCommittedTransactionFailureV1({
            kind: "decisionUncertain",
            settlementCause: new Error("injected lost response"),
          });
        },
      };
      const uncertain =
        makeDeclarativeV2VerifierProgressRepositoryV1(uncertainTarget, {
          claimDurationMilliseconds: 60_000,
          randomUuid: () => "33333333-3333-4333-8333-333333333333",
        });
      const failure = await runEffectFailure(
        uncertain.acquire(scopeId, attemptSha256, budget),
      );
      expect(failure).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressDecisionUncertainV1Error",
        operation: "acquire",
      });
      const normal = makeDeclarativeV2VerifierProgressRepositoryV1(target, {
        claimDurationMilliseconds: 60_000,
      });
      const observed = await runEffect(
        normal.observeAttempt(scopeId, attemptSha256, budget),
      );
      expect(observed.kind).toBe("present");
      if (observed.kind !== "present") throw new Error("Expected attempt.");
      expect(observed.attempt.writerFence).toBe(1n);
      expect(observed.attempt.claimExpiresAt).toBeInstanceOf(Date);
    });
  }, 60_000);

  it("rolls back an atomic multi-row settle and preserves its reservation", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const { target, attemptSha256 } = await createAttempt(persistence);
      const repository =
        makeDeclarativeV2VerifierProgressRepositoryV1(target, {
          claimDurationMilliseconds: 60_000,
          randomUuid: () => "55555555-5555-4555-8555-555555555555",
        });
      const acquired = await runEffect(
        repository.acquire(scopeId, attemptSha256, budget),
      );
      if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
      const reserved = await runEffect(repository.reserveCommand(
        acquired.run,
        {
          commandKind: "source_page",
          sequence: 1n,
          previousReceiptSha256: null,
          commandBudget: semanticBudget("command_budget", 1n),
          inputSha256: digest(0x51),
        },
        budget,
      ));
      if (reserved.kind === "settledReplay") throw new Error("Expected work.");
      await persistence.query(`
        create function fx_test_fail_dv2_page_insert() returns trigger
        language plpgsql as $$
        begin
          raise exception 'injected page failure';
        end
        $$
      `);
      await persistence.query(`
        create trigger fx_test_fail_dv2_page_insert
        before insert on fx_system_declarative_v2_page_manifest
        for each row execute function fx_test_fail_dv2_page_insert()
      `);
      const failure = await runEffectFailure(repository.settleCommand(
        reserved.work,
        {
          frames: [
            {
              kind: "module_summary",
              attemptSha256,
              moduleOrdinal: 0n,
              modulePath: "src/atomic.mjs",
              moduleSha256: digest(0x52),
              sourceMapSha256: null,
              importCount: 0n,
              declaredFunctionCount: 0n,
            },
            {
              kind: "phase_page_manifest",
              attemptSha256,
              phase: "source",
              pageOrdinal: 0n,
              firstItemOrdinal: 0n,
              itemCount: 1n,
              previousPageSha256: null,
              pageRootSha256: digest(0x53),
            },
          ],
          nextLifecycle: "parsing",
          nextProgress: {
            kind: "progress_cursor",
            phase: "parse",
            settledSequence: 1n,
            moduleOrdinal: 1n,
            edgeOrdinal: 0n,
            pageOrdinal: 1n,
            previousReceiptSha256: null,
          },
        },
        budget,
      ));
      expect(failure).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressConfirmedRollbackV1Error",
        operation: "settleCommand",
      });
      const rows = await persistence.query<{
        modules: string;
        pages: string;
        settled_sequence: string;
        pending_kind: string;
      }>(`
        select
          (select count(*)
            from fx_system_declarative_v2_module_summary)::text as modules,
          (select count(*)
            from fx_system_declarative_v2_page_manifest)::text as pages,
          settled_sequence::text,
          pending_kind
        from fx_system_declarative_v2_verifier_attempt
      `);
      expect(rows.rows).toEqual([{
        modules: "0",
        pages: "0",
        settled_sequence: "0",
        pending_kind: "source_page",
      }]);
    });
  }, 60_000);

  it("rejects settlement whose lease expires during the locked transaction", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const { target, attemptSha256 } = await createAttempt(persistence);
      const owner =
        makeDeclarativeV2VerifierProgressRepositoryV1(target, {
          claimDurationMilliseconds: 2_000,
          randomUuid: () => "66666666-6666-4666-8666-666666666666",
        });
      const takeover =
        makeDeclarativeV2VerifierProgressRepositoryV1(target, {
          claimDurationMilliseconds: 60_000,
          randomUuid: () => "77777777-7777-4777-8777-777777777777",
        });
      const acquired = await runEffect(
        owner.acquire(scopeId, attemptSha256, budget),
      );
      if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
      const reserved = await runEffect(owner.reserveCommand(
        acquired.run,
        {
          commandKind: "source_page",
          sequence: 1n,
          previousReceiptSha256: null,
          commandBudget: semanticBudget("command_budget", 1n),
          inputSha256: digest(0x61),
        },
        budget,
      ));
      if (reserved.kind === "settledReplay") throw new Error("Expected work.");
      await persistence.query(`
        create function fx_test_delay_dv2_module_insert() returns trigger
        language plpgsql as $$
        begin
          perform pg_sleep(2.5);
          return new;
        end
        $$
      `);
      await persistence.query(`
        create trigger fx_test_delay_dv2_module_insert
        before insert on fx_system_declarative_v2_module_summary
        for each row execute function fx_test_delay_dv2_module_insert()
      `);
      const failure = await runEffectFailure(owner.settleCommand(
        reserved.work,
        {
          frames: [{
            kind: "module_summary",
            attemptSha256,
            moduleOrdinal: 0n,
            modulePath: "src/expired.mjs",
            moduleSha256: digest(0x62),
            sourceMapSha256: null,
            importCount: 0n,
            declaredFunctionCount: 0n,
          }],
          nextLifecycle: "parsing",
          nextProgress: {
            kind: "progress_cursor",
            phase: "parse",
            settledSequence: 1n,
            moduleOrdinal: 1n,
            edgeOrdinal: 0n,
            pageOrdinal: 0n,
            previousReceiptSha256: null,
          },
        },
        budget,
      ));
      expect(failure).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressStaleV1Error",
        operation: "settleCommand",
        reason: "leaseExpired",
      });
      const after = await persistence.query<{
        modules: string;
        settled_sequence: string;
        pending_kind: string;
      }>(`
        select
          (select count(*)
            from fx_system_declarative_v2_module_summary)::text as modules,
          settled_sequence::text,
          pending_kind
        from fx_system_declarative_v2_verifier_attempt
      `);
      expect(after.rows).toEqual([{
        modules: "0",
        settled_sequence: "0",
        pending_kind: "source_page",
      }]);
      const reacquired = await runEffect(
        takeover.acquire(scopeId, attemptSha256, budget),
      );
      expect(reacquired.kind).toBe("acquired");
      if (reacquired.kind !== "acquired") throw new Error("Expected takeover.");
      expect(reacquired.attempt).toMatchObject({
        pendingKind: "source_page",
        pendingReservedByFence: reacquired.attempt.writerFence,
      });
    });
  }, 60_000);

  it("keeps infrastructure failure distinct from rollback and mints no handle", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const { target, attemptSha256 } = await createAttempt(persistence);
      const infrastructureCause = new Error("injected acquire failure");
      const unavailableTarget: LocatedReadCommittedAttemptTargetV1 = {
        physicalLocator: target.physicalLocator,
        getCurrentClock: scope => target.getCurrentClock(scope),
        [RUN_LOCATED_READ_COMMITTED_V1]: async () => {
          throw new LocatedReadCommittedTransactionFailureV1({
            kind: "infrastructureFailure",
            phase: "acquire",
            cause: infrastructureCause,
          });
        },
      };
      const repository =
        makeDeclarativeV2VerifierProgressRepositoryV1(unavailableTarget, {
          claimDurationMilliseconds: 60_000,
        });
      const failure = await runEffectFailure(
        repository.acquire(scopeId, attemptSha256, budget),
      );
      expect(failure).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressResourceV1Error",
        operation: "acquire",
        phase: "infrastructure",
      });
      const normal = makeDeclarativeV2VerifierProgressRepositoryV1(target, {
        claimDurationMilliseconds: 60_000,
      });
      const observed = await runEffect(
        normal.observeAttempt(scopeId, attemptSha256, budget),
      );
      expect(observed.kind).toBe("present");
      if (observed.kind !== "present") throw new Error("Expected attempt.");
      expect(observed.attempt).toMatchObject({
        writerFence: 0n,
        claimExpiresAt: null,
      });
    });
  }, 60_000);
});

async function createAttempt(
  persistence: Parameters<
    Parameters<typeof withTemporaryPostgresPersistence>[0]
  >[0],
) {
  await insertSessionTestScope(persistence);
  const target =
    createPostgresLocatedPointMutationSessionActivationTargetV1(
      persistence,
      {
        kind: "shared_database",
        databaseKey: "primary",
        schemaName: "public",
      },
    );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located READ COMMITTED target.");
  }
  const candidate = candidateFixture();
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2PhysicalFrameV1(candidate, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  const inserted = await runEffect(
    makeDeclarativeV2InertRepositoryV1(target).insertCandidate(candidate, {
      maximumCalls: 1,
      maximumFrameBytes: encoded.canonicalBytes.byteLength,
      maximumCanonicalBytes: encoded.usage.canonicalBytes,
      maximumHashBytes: encoded.canonicalBytes.byteLength,
    }),
  );
  const repository = makeDeclarativeV2VerifierProgressRepositoryV1(target, {
    claimDurationMilliseconds: 60_000,
  });
  const created = await runEffect(repository.createAttempt({
    scopeId,
    candidateSha256: inserted.candidateSha256,
    ceilings: semanticBudget("attempt_ceilings", 1_000n),
  }, budget));
  return { target, attemptSha256: created.attemptSha256 };
}

function semanticBudget(
  kind: DeclarativeV2BudgetFrameV1["kind"],
  value: bigint,
): DeclarativeV2BudgetFrameV1 {
  return {
    kind,
    calls: value,
    sourceBytes: value,
    modules: value,
    importEdges: value,
    tokens: value,
    tokenBytes: value,
    nestingDepth: value,
    functions: value,
    schemaNodes: value,
    validatorNodes: value,
    graphNodes: value,
    frontierEntries: value,
    canonicalBytes: value,
    frameBytes: value,
    hashBytes: value,
    diagnosticBytes: value,
    outputBytes: value,
    elapsedMilliseconds: value,
  };
}

function candidateFixture(): DeclarativeV2CandidateFrameV1 {
  return {
    kind: "candidate",
    projectId: "project",
    deploymentId: "deployment",
    deploymentCreatedAt: "2026-07-23T00:00:00.000Z",
    scopeId,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    scopeEpoch: epoch,
    sourceRootSha256: digest(1),
    sourceSelectorSha256: digest(2),
    sourceCodecIdentity: "source-v2",
    semanticRootSha256: digest(3),
    semanticSelectorSha256: digest(4),
    semanticModelIdentity: "declarative-v2",
    semanticCodecIdentity: "ndjson-v1",
    semanticPolicyIdentity: "policy-v1",
    packageSha256: digest(5),
    artifactSha256: digest(6),
    artifactRuntimeIdentity: "runtime-v1",
    schemaArtifactSha256: digest(7),
    schemaBindingSha256: digest(8),
    validatorRootSha256: digest(9),
    coreLanguageIdentity: "core-v1",
    abiIdentity: "abi-v1",
    grammarIdentity: "grammar-v1",
    unicodeIdentity: "unicode-14",
    parserTableIdentity: "parser-v1",
    analyzerIdentity: "analyzer-v2",
    verifierIdentity: "verifier-v1",
    declaredHandlerSetSha256: digest(10),
    deploymentAnalysisCodecIdentity: "analysis-v1",
    deploymentAnalysisByteLength: 20n,
    deploymentAnalysisSha256: digest(11),
    deploymentCodegenAnalysisCodecIdentity: "codegen-v1",
    deploymentCodegenAnalysisByteLength: 21n,
    deploymentCodegenAnalysisSha256: digest(12),
    readinessPolicyIdentity: "readiness-v1",
  };
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}
