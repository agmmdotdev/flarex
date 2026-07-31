import { webcrypto } from "node:crypto";
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
            objectReferences: [],
            disposition: "completion",
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
          objectReferences: [sourceReference(0x42)],
          disposition: "completion",
          nextLifecycle: "parsing",
          nextProgress: {
            kind: "progress_cursor",
            phase: "parse",
            settledSequence: 1n,
            moduleOrdinal: 0n,
            edgeOrdinal: 0n,
            pageOrdinal: 1n,
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
          frames: [],
          objectReferences: [sourceReference(0x52)],
          disposition: "completion",
          nextLifecycle: "parsing",
          nextProgress: {
            kind: "progress_cursor",
            phase: "parse",
            settledSequence: 1n,
            moduleOrdinal: 0n,
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
        create function fx_test_delay_dv2_page_insert() returns trigger
        language plpgsql as $$
        begin
          perform pg_sleep(2.5);
          return new;
        end
        $$
      `);
      await persistence.query(`
        create trigger fx_test_delay_dv2_page_insert
        before insert on fx_system_declarative_v2_page_manifest
        for each row execute function fx_test_delay_dv2_page_insert()
      `);
      const failure = await runEffectFailure(owner.settleCommand(
        reserved.work,
        {
          frames: [],
          objectReferences: [sourceReference(0x62)],
          disposition: "completion",
          nextLifecycle: "parsing",
          nextProgress: {
            kind: "progress_cursor",
            phase: "parse",
            settledSequence: 1n,
            moduleOrdinal: 0n,
            edgeOrdinal: 0n,
            pageOrdinal: 1n,
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

  it("reconstructs fixed-order phase tails through real backward index reads without authority writes", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const { target, attemptSha256 } = await createAttempt(persistence);
      const repository =
        makeDeclarativeV2VerifierProgressRepositoryV1(target, {
          claimDurationMilliseconds: 60_000,
          randomUuid: () => "88888888-8888-4888-8888-888888888888",
        });
      const acquired = await runEffect(
        repository.acquire(scopeId, attemptSha256, budget),
      );
      if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
      const receipt1 = await reserveAndSettle(
        repository,
        acquired.run,
        {
          commandKind: "source_page",
          sequence: 1n,
          previousReceiptSha256: null,
          inputSha256: digest(0x71),
        },
        {
          frames: [],
          objectReferences: [sourceReference(0x71, 0n)],
          disposition: "continuation",
          nextLifecycle: "open",
          nextProgress: progress("source", 1n, 0n, 0n, 1n, null),
        },
      );
      const receipt1Sha256 = await frameDigest(receipt1);
      const receipt2 = await reserveAndSettle(
        repository,
        acquired.run,
        {
          commandKind: "source_page",
          sequence: 2n,
          previousReceiptSha256: receipt1Sha256,
          inputSha256: digest(0x72),
        },
        {
          frames: [],
          objectReferences: [sourceReference(0x72, 1n)],
          disposition: "completion",
          nextLifecycle: "parsing",
          nextProgress: progress("parse", 2n, 0n, 0n, 2n, receipt1Sha256),
        },
      );
      const receipt2Sha256 = await frameDigest(receipt2);
      const receipt3 = await reserveAndSettle(
        repository,
        acquired.run,
        {
          commandKind: "parse_module",
          sequence: 3n,
          previousReceiptSha256: receipt2Sha256,
          inputSha256: digest(0x73),
        },
        {
          frames: [{
            kind: "module_summary",
            attemptSha256,
            moduleOrdinal: 0n,
            modulePath: "src/main.mjs",
            moduleSha256: digest(0x73),
            sourceMapSha256: null,
            importCount: 0n,
            declaredFunctionCount: 1n,
          }],
          objectReferences: [],
          disposition: "completion",
          nextLifecycle: "parse_complete",
          nextProgress: progress("link", 3n, 1n, 0n, 3n, receipt2Sha256),
        },
      );
      const receipt3Sha256 = await frameDigest(receipt3);
      const receipt4 = await reserveAndSettle(
        repository,
        acquired.run,
        {
          commandKind: "link_page",
          sequence: 4n,
          previousReceiptSha256: receipt3Sha256,
          inputSha256: digest(0x74),
        },
        {
          frames: [{
            kind: "link_node",
            attemptSha256,
            moduleOrdinal: 0n,
            remainingIndegree: 0n,
            nextEdgeOrdinal: 0n,
            state: "linked",
            rowVersion: 0n,
            previousRowSha256: null,
          }],
          objectReferences: [],
          disposition: "completion",
          nextLifecycle: "link_complete",
          nextProgress: progress(
            "registration",
            4n,
            1n,
            0n,
            4n,
            receipt3Sha256,
          ),
        },
      );
      const receipt4Sha256 = await frameDigest(receipt4);
      await reserveAndSettle(
        repository,
        acquired.run,
        {
          commandKind: "registration_page",
          sequence: 5n,
          previousReceiptSha256: receipt4Sha256,
          inputSha256: digest(0x75),
        },
        {
          frames: [],
          objectReferences: [],
          disposition: "completion",
          nextLifecycle: "registering",
          nextProgress: progress("verdict", 5n, 1n, 0n, 5n, receipt4Sha256),
        },
      );

      const observed = await runEffect(
        repository.observeSettledPhaseTails(acquired.run, budget),
      );
      expect(observed.tails.phases.map(({ phase, page }) => [
        phase,
        page?.pageOrdinal ?? null,
      ])).toEqual([
        ["source", 1n],
        ["parse", 0n],
        ["link", 0n],
        ["registration", 0n],
      ]);
      expect(observed.tails.attempt).toMatchObject({
        lifecycle: "registering",
        settledSequence: 5n,
        progress: { phase: "verdict", pageOrdinal: 5n },
      });
      const authorityRows = await persistence.query<{
        projections: string;
        verdicts: string;
        revisions: string;
        heads: string;
      }>(`
        select
          (select count(*) from fx_system_declarative_v2_candidate_projection)::text
            as projections,
          (select count(*) from fx_system_declarative_v2_verdict)::text
            as verdicts,
          (select count(*) from fx_system_declarative_v2_activation_revision)::text
            as revisions,
          (select count(*) from fx_system_declarative_v2_activation_head)::text
            as heads
      `);
      expect(authorityRows.rows).toEqual([{
        projections: "0",
        verdicts: "0",
        revisions: "0",
        heads: "0",
      }]);
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
    runtimeProjectionSetSha256: digest(13),
    functionGroupManifestSha256: digest(14),
    readinessPolicyIdentity:
      "flarex.readiness/runtime-projection-cold-materialization/v1",
  };
}

function sourceReference(byte: number, firstItemOrdinal = 0n) {
  return {
    kind: "inert_object_reference" as const,
    namespace: "source" as const,
    objectKind: "block" as const,
    firstItemOrdinal,
    itemCount: 1n,
    bodyByteLength: 1n,
    objectSha256: digest(byte),
  };
}

async function reserveAndSettle(
  repository: ReturnType<
    typeof makeDeclarativeV2VerifierProgressRepositoryV1
  >,
  run: Parameters<
    ReturnType<
      typeof makeDeclarativeV2VerifierProgressRepositoryV1
    >["reserveCommand"]
  >[0],
  command: Readonly<{
    readonly commandKind:
      | "source_page"
      | "parse_module"
      | "link_page"
      | "registration_page";
    readonly sequence: bigint;
    readonly previousReceiptSha256: Uint8Array | null;
    readonly inputSha256: Uint8Array;
  }>,
  batch: Parameters<
    ReturnType<
      typeof makeDeclarativeV2VerifierProgressRepositoryV1
    >["settleCommand"]
  >[1],
) {
  const reserved = await runEffect(repository.reserveCommand(run, {
    ...command,
    commandBudget: semanticBudget("command_budget", 1n),
  }, budget));
  if (reserved.kind === "settledReplay") throw new Error("Expected work.");
  return (await runEffect(
    repository.settleCommand(reserved.work, batch, budget),
  )).receipt;
}

function progress(
  phase: "source" | "parse" | "link" | "registration" | "verdict",
  settledSequence: bigint,
  moduleOrdinal: bigint,
  edgeOrdinal: bigint,
  pageOrdinal: bigint,
  previousReceiptSha256: Uint8Array | null,
) {
  return {
    kind: "progress_cursor" as const,
    phase,
    settledSequence,
    moduleOrdinal,
    edgeOrdinal,
    pageOrdinal,
    previousReceiptSha256,
  };
}

async function frameDigest(
  frame: Parameters<typeof encodeDeclarativeV2PhysicalFrameV1>[0],
): Promise<Uint8Array> {
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2PhysicalFrameV1(frame, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  return new Uint8Array(await webcrypto.subtle.digest(
    "SHA-256",
    encoded.canonicalBytes.slice().buffer,
  ));
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}
