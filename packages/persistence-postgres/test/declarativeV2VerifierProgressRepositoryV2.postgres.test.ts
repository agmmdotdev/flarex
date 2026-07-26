import { webcrypto } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";

import { makeDeclarativeV2InertRepositoryV1 } from
  "../src/declarativeV2InertRepository";
import {
  makeDeclarativeV2VerifierProgressRepositoryV2,
} from "../src/declarativeV2VerifierProgressRepositoryV2";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
} from "../src/postgres";
import {
  isLocatedReadCommittedAttemptTargetV1,
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
const operationBudget = {
  maximumCalls: 200,
  maximumRows: 200,
  maximumFrameBytes: 4_000_000,
  maximumCanonicalBytes: 4_000_000,
  maximumHashBytes: 4_000_000,
  maximumElapsedMilliseconds: 60_000,
} as const;

describePostgres("real Postgres Declarative V2 progress repository V2", () => {
  it("chooses one writer, preserves pending work on takeover, and fences the stale run", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      if (globalThis.crypto === undefined) {
        Object.defineProperty(globalThis, "crypto", {
          configurable: true,
          value: webcrypto,
        });
      }
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
        throw new Error("Expected READ COMMITTED target.");
      }
      const inert = makeDeclarativeV2InertRepositoryV1(target);
      const candidate = candidateFixture();
      const encoded = Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1(
        candidate,
        {
          maximumFrameBytes: 1_000_000,
          maximumCanonicalBytes: 1_000_000,
        },
      ));
      const inserted = await runEffect(inert.insertCandidate(candidate, {
        maximumCalls: 1,
        maximumFrameBytes: encoded.canonicalBytes.byteLength,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
        maximumHashBytes: encoded.canonicalBytes.byteLength,
      }));
      const left = makeDeclarativeV2VerifierProgressRepositoryV2(target, {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "11111111-1111-4111-8111-111111111111",
      });
      const right = makeDeclarativeV2VerifierProgressRepositoryV2(target, {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "22222222-2222-4222-8222-222222222222",
      });
      const created = await runEffect(left.createAttempt({
        scopeId,
        candidateSha256: inserted.candidateSha256,
        ceilings: semanticBudget("attempt_ceilings", 1_000n),
      }, operationBudget));

      const contenders = await Promise.allSettled([
        runEffect(left.acquire(scopeId, created.attemptSha256, operationBudget)),
        runEffect(right.acquire(scopeId, created.attemptSha256, operationBudget)),
      ]);
      expect(contenders.filter(result => result.status === "fulfilled"))
        .toHaveLength(1);
      expect(contenders.filter(result => result.status === "rejected"))
        .toHaveLength(1);
      const rejected = contenders.find(result => result.status === "rejected");
      if (rejected?.status !== "rejected") {
        throw new Error("Expected one rejected contender.");
      }
      expect(rejected.reason).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressRepositoryBusyV2Error",
        operation: "acquire",
      });
      const leftWon = contenders[0]?.status === "fulfilled";
      const winnerResult = contenders[leftWon ? 0 : 1];
      if (winnerResult?.status !== "fulfilled") {
        throw new Error("Expected one winner.");
      }
      const winnerRepository = leftWon ? left : right;
      const loserRepository = leftWon ? right : left;
      const winner = winnerResult.value;
      const input = await reservationInput(winner.attempt, 0x31);
      const [observedDuringReservation] = await Promise.all([
        runEffect(loserRepository.observeAttempt(
          scopeId,
          created.attemptSha256,
          operationBudget,
        )),
        runEffect(winnerRepository.reserveCommand(
          winner.run,
          input,
          operationBudget,
        )),
      ]);
      expect(observedDuringReservation.kind).toBe("present");
      if (observedDuringReservation.kind !== "present") {
        throw new Error("Expected a coherent attempt snapshot.");
      }
      expect([0n, 1n]).toContain(observedDuringReservation.attempt.usage.calls);

      await persistence.query(`
        update fx_system_declarative_v2_verifier_attempt_v2
        set
          lease_updated_at = clock_timestamp() - interval '2 seconds',
          lease_expires_at = clock_timestamp() - interval '1 second'
        where settled_sequence = 0
      `);
      const takeover = await runEffect(loserRepository.acquire(
        scopeId,
        created.attemptSha256,
        operationBudget,
      ));
      expect(takeover.attempt).toMatchObject({
        writerFence: 2n,
        pendingKind: "source_page",
        pendingSequence: 1n,
        pendingReservedByFence: 2n,
      });
      const resumed = await runEffect(loserRepository.resumePending(
        takeover.run,
        input,
        operationBudget,
      ));
      expect(resumed.reservation.sequence).toBe(1n);
      const stale = await runEffectFailure(
        winnerRepository.renew(winner.run, operationBudget),
      );
      expect(stale).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressRepositoryStaleV2Error",
        reason: "ownerChanged",
      });
    });
  });
});

async function reservationInput(
  attempt: Readonly<{
    readonly attemptSha256: Uint8Array;
    readonly candidateSha256: Uint8Array;
    readonly progressSha256: Uint8Array;
    readonly lastReceiptSha256: Uint8Array | null;
  }>,
  byte: number,
) {
  const commandBudget = semanticBudget("command_budget", 1n);
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(commandBudget, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  return Object.freeze({
    reservation: {
      kind: "command_reservation" as const,
      attemptSha256: attempt.attemptSha256,
      candidateSha256: attempt.candidateSha256,
      commandKind: "source_page" as const,
      sequence: 1n,
      currentProgressSha256: attempt.progressSha256,
      predecessorReceiptSha256: attempt.lastReceiptSha256,
      commandBudgetSha256: await sha256(encoded.canonicalBytes),
      commandInputSha256: digest(byte),
      freshAuthenticatedInputSha256: digest(byte + 1),
      analyzerIdentitySha256: digest(byte + 2),
      verifierIdentitySha256: digest(byte + 3),
      rangeAndPredecessorTailsSha256: digest(byte + 4),
    },
    commandBudget,
  });
}

function semanticBudget(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  value: bigint,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind,
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        value,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
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

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes));
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}
