import { webcrypto } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierCommandReceiptFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
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
  type LocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
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
const pageOperationBudget = {
  ...operationBudget,
  maximumRows: 5_000,
  maximumPages: 1_024,
  maximumPayloadBytes: 4_000_000,
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

  it("recovers lost page responses, retries confirmed rollbacks, preserves ordered reads, and fences takeover", async () => {
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
      let failNextStatement = false;
      let loseNextCommittedResponse = false;
      const faultTarget: LocatedReadCommittedAttemptTargetV1 = {
        physicalLocator: target.physicalLocator,
        getCurrentClock: scope => target.getCurrentClock(scope),
        [RUN_LOCATED_READ_COMMITTED_V1]: async work => {
          if (failNextStatement) {
            failNextStatement = false;
            return target[RUN_LOCATED_READ_COMMITTED_V1](tx =>
              work(withFailingFirstSelect(
                tx,
                Object.assign(
                  new Error("injected serialization rollback"),
                  { code: "40001" },
                ),
              ))
            );
          }
          const result = await target[RUN_LOCATED_READ_COMMITTED_V1](work);
          if (loseNextCommittedResponse) {
            loseNextCommittedResponse = false;
            throw new LocatedReadCommittedTransactionFailureV1({
              kind: "decisionUncertain",
              settlementCause: new Error("injected lost page response"),
            });
          }
          return result;
        },
      };
      const firstRepository =
        makeDeclarativeV2VerifierProgressRepositoryV2(faultTarget, {
          claimDurationMilliseconds: 60_000,
          randomUuid: () => "11111111-1111-4111-8111-111111111111",
        });
      const created = await runEffect(firstRepository.createAttempt({
        scopeId,
        candidateSha256: inserted.candidateSha256,
        ceilings: semanticBudget("attempt_ceilings", 1_000n),
      }, operationBudget));
      await moveAttemptToParse(
        persistence,
        created.attemptSha256,
      );
      const acquired = await runEffect(firstRepository.acquire(
        scopeId,
        created.attemptSha256,
        operationBudget,
      ));
      const reservation = await reservationInput(
        acquired.attempt,
        0x51,
        "parse_module",
      );
      const reserved = await runEffect(firstRepository.reserveCommand(
        acquired.run,
        reservation,
        operationBudget,
      ));
      const firstPage = await evidencePageInput(
        reserved.reservation,
        0n,
        null,
        0n,
        new Uint8Array([1, 2, 3]),
      );
      loseNextCommittedResponse = true;
      expect(await runEffectFailure(firstRepository.appendEvidencePage(
        reserved.work,
        firstPage,
        pageOperationBudget,
      ))).toMatchObject({
        _tag:
          "DeclarativeV2VerifierProgressRepositoryDecisionUncertainV2Error",
        operation: "appendEvidencePage",
      });

      await persistence.query(`
        update fx_system_declarative_v2_verifier_attempt_v2
        set
          lease_updated_at = clock_timestamp() - interval '2 seconds',
          lease_expires_at = clock_timestamp() - interval '1 second'
        where scope_id = $1 and attempt_sha256 = $2
      `, [scopeId, created.attemptSha256]);
      const restarted =
        makeDeclarativeV2VerifierProgressRepositoryV2(faultTarget, {
          claimDurationMilliseconds: 60_000,
          randomUuid: () => "22222222-2222-4222-8222-222222222222",
        });
      const takeover = await runEffect(restarted.acquire(
        scopeId,
        created.attemptSha256,
        operationBudget,
      ));
      const resumed = await runEffect(restarted.resumePending(
        takeover.run,
        reservation,
        operationBudget,
      ));
      const replayed = await runEffect(restarted.appendEvidencePage(
        resumed.work,
        firstPage,
        pageOperationBudget,
      ));
      expect(replayed.kind).toBe("replayed");
      const secondPage = await evidencePageInput(
        reserved.reservation,
        1n,
        replayed.pageSha256,
        1n,
        new Uint8Array([4, 5]),
      );
      failNextStatement = true;
      await runEffect(restarted.appendEvidencePage(
        resumed.work,
        secondPage,
        pageOperationBudget,
      ));
      const read = await runEffect(restarted.readEvidencePageBatch(
        resumed.work,
        {
          startPageOrdinal: 0n,
          expectedPredecessorPageSha256: null,
        },
        pageOperationBudget,
      ));
      expect(read.pages.map(page => page.manifest.pageOrdinal)).toEqual([
        0n,
        1n,
      ]);
      expect(read.nextPageOrdinal).toBeNull();

      await persistence.query(`
        update fx_system_declarative_v2_verifier_attempt_v2
        set
          lease_updated_at = clock_timestamp() - interval '2 seconds',
          lease_expires_at = clock_timestamp() - interval '1 second'
        where scope_id = $1 and attempt_sha256 = $2
      `, [scopeId, created.attemptSha256]);
      const secondRestart =
        makeDeclarativeV2VerifierProgressRepositoryV2(target, {
          claimDurationMilliseconds: 60_000,
          randomUuid: () => "33333333-3333-4333-8333-333333333333",
        });
      const secondTakeover = await runEffect(secondRestart.acquire(
        scopeId,
        created.attemptSha256,
        operationBudget,
      ));
      const secondResume = await runEffect(secondRestart.resumePending(
        secondTakeover.run,
        reservation,
        operationBudget,
      ));
      const coldRead = await runEffect(secondRestart.readEvidencePageBatch(
        secondResume.work,
        {
          startPageOrdinal: 0n,
          expectedPredecessorPageSha256: null,
        },
        pageOperationBudget,
      ));
      expect(coldRead.pages.map(page => page.pageSha256)).toEqual(
        read.pages.map(page => page.pageSha256),
      );
      expect(await runEffectFailure(
        restarted.readEvidencePageBatch(
          resumed.work,
          {
            startPageOrdinal: 0n,
            expectedPredecessorPageSha256: null,
          },
          pageOperationBudget,
        ),
      )).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressRepositoryStaleV2Error",
        reason: "ownerChanged",
      });
      const settlement = await settlementInput(
        secondResume.reservation,
        coldRead.pages[1]!.pageSha256,
        2n,
        digest(0xd1),
      );
      const settled = await runEffect(secondRestart.settleCommand(
        secondResume.work,
        settlement,
        operationBudget,
      ));
      const observed = await runEffect(
        firstRepository.observeCommandDecision({
          scopeId,
          attemptSha256: created.attemptSha256,
          sequence: 1n,
          reservationSha256:
            await frameSha256(secondResume.reservation),
        }, operationBudget),
      );
      expect(observed.decision).toMatchObject({
        kind: "settled",
        settlement: {
          receiptSha256: settled.settlement.receiptSha256,
        },
      });
      const settledPages = await runEffect(
        firstRepository.readSettledEvidencePageBatch({
          scopeId,
          attemptSha256: created.attemptSha256,
          commandKind: "parse_module",
          sequence: 1n,
          reservationSha256:
            await frameSha256(secondResume.reservation),
          outputManifestSha256:
            await frameSha256(settlement.outputManifest),
          receiptSha256: await frameSha256(settlement.receipt),
          startPageOrdinal: 0n,
          expectedPredecessorPageSha256: null,
        }, pageOperationBudget),
      );
      expect(settledPages.pages.map(page => page.manifest.pageOrdinal))
        .toEqual([0n, 1n]);
      expect(settledPages.pages.map(page => page.payloadBytes))
        .toEqual([
          new Uint8Array([1, 2, 3]),
          new Uint8Array([4, 5]),
        ]);
      expect(settledPages.next).toBeNull();
    });
  });
});

function withFailingFirstSelect<Transaction extends object>(
  transaction: Transaction,
  cause: unknown,
): Transaction {
  const failWhenAwaited = <Query extends object>(query: Query): Query =>
    new Proxy(query, {
      get(target, property, receiver) {
        if (property === "then") {
          return (
            onFulfilled: (value: unknown) => unknown,
            onRejected: (reason: unknown) => unknown,
          ) => Promise.reject(cause).then(onFulfilled, onRejected);
        }
        const member = Reflect.get(target, property, receiver);
        if (typeof member !== "function") return member;
        return (...args: readonly unknown[]) => {
          const result = Reflect.apply(member, target, args);
          return typeof result === "object" && result !== null
            ? failWhenAwaited(result)
            : result;
        };
      },
    });
  return new Proxy(transaction, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (property !== "select" || typeof member !== "function") return member;
      return (...args: readonly unknown[]) => {
        const query = Reflect.apply(member, target, args);
        if (typeof query !== "object" || query === null) {
          throw new Error("Expected Drizzle select to return a query builder.");
        }
        return failWhenAwaited(query);
      };
    },
  });
}

async function reservationInput(
  attempt: Readonly<{
    readonly attemptSha256: Uint8Array;
    readonly candidateSha256: Uint8Array;
    readonly progressSha256: Uint8Array;
    readonly lastReceiptSha256: Uint8Array | null;
  }>,
  byte: number,
  commandKind: "source_page" | "parse_module" = "source_page",
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
      commandKind,
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

async function settlementInput(
  reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  evidenceRootSha256: Uint8Array,
  evidenceCount: bigint,
  diagnosticsRootSha256: Uint8Array,
) {
  const reservationSha256 = await frameSha256(reservation);
  const commandUsage = semanticBudget("command_budget", 1n);
  const resultingUsage = semanticBudget("attempt_usage", 1n);
  const nextProgress: DeclarativeV2VerifierProgressCursorFrameV2 = {
    kind: "progress_cursor",
    phase: "parse",
    settledSequence: reservation.sequence,
    moduleOrdinal: 1n,
    edgeOrdinal: 0n,
    pageOrdinal: 2n,
    previousReceiptSha256: reservation.predecessorReceiptSha256,
  };
  const nextProgressSha256 = await frameSha256(nextProgress);
  const outputManifest:
    DeclarativeV2VerifierCommandOutputManifestFrameV2 = {
      kind: "command_output_manifest",
      reservationSha256,
      commandKind: reservation.commandKind,
      sequence: reservation.sequence,
      evidenceRootSha256,
      evidenceCount,
      diagnosticsRootSha256,
      diagnosticCount: 0n,
      nextProgressSha256,
    };
  const receipt: DeclarativeV2VerifierCommandReceiptFrameV2 = {
    kind: "command_receipt",
    reservationSha256,
    commandUsageSha256: await frameSha256(commandUsage),
    resultingAttemptUsageSha256: await frameSha256(resultingUsage),
    outputManifestSha256: await frameSha256(outputManifest),
    nextProgressSha256,
  };
  return Object.freeze({
    outputManifest,
    commandUsage,
    resultingUsage,
    nextProgress,
    receipt,
  });
}

async function frameSha256(
  frame: Parameters<typeof encodeDeclarativeV2VerifierProgressFrameV2>[0],
) {
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(frame, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  return sha256(encoded.canonicalBytes);
}

async function moveAttemptToParse(
  persistence: Readonly<{
    readonly query: (
      sql: string,
      params?: readonly unknown[],
    ) => Promise<unknown>;
  }>,
  attemptSha256: Uint8Array,
) {
  const progress = {
    kind: "progress_cursor" as const,
    phase: "parse" as const,
    settledSequence: 0n,
    moduleOrdinal: 0n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256: null,
  };
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(progress, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  const progressSha256 = await sha256(encoded.canonicalBytes);
  await persistence.query(
    `update fx_system_declarative_v2_verifier_attempt_v2
     set lifecycle = 'parsing',
         progress_byte_length = $3,
         progress_sha256 = $4,
         progress_bytes = $5,
         updated_at = clock_timestamp()
     where scope_id = $1 and attempt_sha256 = $2`,
    [
      scopeId,
      attemptSha256,
      BigInt(encoded.canonicalBytes.byteLength),
      progressSha256,
      encoded.canonicalBytes,
    ],
  );
}

async function evidencePageInput(
  reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  pageOrdinal: bigint,
  predecessorPageSha256: Uint8Array | null,
  firstEvidenceOrdinal: bigint,
  payloadBytes: Uint8Array,
) {
  const payloadSha256 = await sha256(payloadBytes);
  const encodedReservation = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(reservation, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  const manifest:
    DeclarativeV2VerifierEvidencePageManifestFrameV2 = {
      kind: "evidence_page_manifest",
      reservationSha256: await sha256(encodedReservation.canonicalBytes),
      commandKind: "parse_module",
      sequence: reservation.sequence,
      pageOrdinal,
      firstEvidenceOrdinal,
      evidenceCount: 1n,
      firstDiagnosticOrdinal: 0n,
      diagnosticCount: 0n,
      predecessorPageSha256,
      payloadByteLength: BigInt(payloadBytes.byteLength),
      payloadSha256,
      cumulativeDiagnosticsRootSha256: digest(0xd0 + Number(pageOrdinal)),
    };
  const encodedManifest = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(manifest, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  return Object.freeze({
    manifestBytes: encodedManifest.canonicalBytes,
    payloadBytes: new Uint8Array(payloadBytes),
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
