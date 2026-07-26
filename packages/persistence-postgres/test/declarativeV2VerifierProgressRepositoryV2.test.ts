import { webcrypto } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";

import { makeDeclarativeV2InertRepositoryV1 } from
  "../src/declarativeV2InertRepository";
import {
  makeDeclarativeV2VerifierProgressRepositoryV2,
  type DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
} from "../src/declarativeV2VerifierProgressRepositoryV2";
import { createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence } from "../src/pglite";
import {
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
  insertSessionTestScope,
} from "./sessionAuthorityTestSupport";

const scopeId = `scope_${SESSION_TEST_SCOPE_UUID}`;
const epoch = `epoch_${SESSION_TEST_EPOCH_UUID}`;
const operationBudget = Object.freeze({
  maximumCalls: 100,
  maximumRows: 100,
  maximumFrameBytes: 2_000_000,
  maximumCanonicalBytes: 2_000_000,
  maximumHashBytes: 2_000_000,
  maximumElapsedMilliseconds: 60_000,
}) satisfies DeclarativeV2VerifierProgressRepositoryOperationBudgetV2;

describe("Declarative V2 progress repository V2 attempt/lease/reservation", () => {
  it("creates and observes an inert attempt, acquires with same-owner replay, renews, and releases", async () => {
    const current = await fixture();
    const replayedCreate = await runEffect(current.repository.createAttempt({
      scopeId,
      candidateSha256: current.candidateSha256,
      ceilings: semanticBudget("attempt_ceilings", 1_000n),
    }, operationBudget));
    expect(replayedCreate.kind).toBe("replayed");
    expect(replayedCreate.attemptSha256).toEqual(current.attemptSha256);
    const observed = await runEffect(current.repository.observeAttempt(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    expect(observed.kind).toBe("present");
    if (observed.kind !== "present") throw new Error("Expected attempt.");
    expect(observed.attempt).toMatchObject({
      lifecycle: "open",
      writerFence: 0n,
      settledSequence: 0n,
      pendingKind: null,
      progress: { phase: "source", settledSequence: 0n },
    });

    const acquired = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    expect(acquired.kind).toBe("acquired");
    const replay = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    expect(replay.kind).toBe("sameOwnerReplay");
    expect(replay.run).toBe(acquired.run);
    expect(replay.attempt.writerFence).toBe(1n);

    const renewed = await runEffect(
      current.repository.renew(acquired.run, operationBudget),
    );
    expect(renewed.leaseExpiresAt.getTime()).toBeGreaterThanOrEqual(
      acquired.leaseExpiresAt.getTime(),
    );
    await runEffect(current.repository.release(acquired.run, operationBudget));
    const closed = await runEffectFailure(
      current.repository.renew(acquired.run, operationBudget),
    );
    expect(closed).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      reason: "runClosed",
    });

    const reacquired = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    expect(reacquired.attempt.writerFence).toBe(2n);
  });

  it("admits exactly one factory while a foreign live lease is held", async () => {
    const current = await fixture();
    const acquired = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    const contender = makeDeclarativeV2VerifierProgressRepositoryV2(
      current.target,
      {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "22222222-2222-4222-8222-222222222222",
      },
    );
    const busy = await runEffectFailure(contender.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    expect(busy).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryBusyV2Error",
      operation: "acquire",
    });
    await runEffect(current.repository.release(acquired.run, operationBudget));
  });

  it("reserves once, replays byte-identically without durable recharge, resumes, and refuses release", async () => {
    const current = await fixture();
    const acquired = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    const input = await reservationInput(acquired.attempt, 1n, 0x51);
    const first = await runEffect(
      current.repository.reserveCommand(
        acquired.run,
        input,
        operationBudget,
      ),
    );
    expect(first.kind).toBe("reserved");
    const afterFirst = await runEffect(current.repository.observeAttempt(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    if (afterFirst.kind !== "present") throw new Error("Expected attempt.");
    expect(afterFirst.attempt).toMatchObject({
      pendingKind: "source_page",
      pendingSequence: 1n,
      pendingReservedByFence: 1n,
    });
    expect(afterFirst.attempt.usage.calls).toBe(1n);

    const replay = await runEffect(
      current.repository.reserveCommand(
        acquired.run,
        input,
        operationBudget,
      ),
    );
    expect(replay.kind).toBe("pendingReplay");
    const resumed = await runEffect(
      current.repository.resumePending(
        acquired.run,
        input,
        operationBudget,
      ),
    );
    expect(resumed.reservation.sequence).toBe(1n);
    const afterReplay = await runEffect(current.repository.observeAttempt(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    if (afterReplay.kind !== "present") throw new Error("Expected attempt.");
    expect(afterReplay.attempt.usage.calls).toBe(1n);

    const mismatch = await reservationInput(acquired.attempt, 1n, 0x52);
    const failure = await runEffectFailure(
      current.repository.resumePending(
        acquired.run,
        mismatch,
        operationBudget,
      ),
    );
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryConflictV2Error",
      operation: "resumePending",
      reason: "commandChanged",
    });
    const malformedCapture = await runEffectFailure(
      current.repository.resumePending(
        acquired.run,
        {
          reservation: input.reservation,
          commandBudget: semanticBudget("command_budget", 2n),
        },
        operationBudget,
      ),
    );
    expect(malformedCapture).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      operation: "resumePending",
      reason: "commandMismatch",
    });
    const release = await runEffectFailure(
      current.repository.release(acquired.run, operationBudget),
    );
    expect(release).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryConflictV2Error",
      operation: "release",
      reason: "pendingExists",
    });
  });

  it("serializes simultaneous byte-identical reservation attempts", async () => {
    const current = await fixture();
    const acquired = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    const input = await reservationInput(acquired.attempt, 1n, 0x58);
    const results = await Promise.all([
      runEffect(current.repository.reserveCommand(
        acquired.run,
        input,
        operationBudget,
      )),
      runEffect(current.repository.reserveCommand(
        acquired.run,
        input,
        operationBudget,
      )),
    ]);
    expect(results.map(result => result.kind).sort()).toEqual([
      "pendingReplay",
      "reserved",
    ]);
    const counts = await current.persistence.query<{ commands: string }>(`
      select count(*)::text as commands
      from fx_system_declarative_v2_verifier_command_v2
    `);
    expect(counts.rows).toEqual([{ commands: "1" }]);
  });

  it("takes over an expired lease while preserving and rebinding pending work", async () => {
    const current = await fixture({ claimDurationMilliseconds: 100 });
    const acquired = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    const input = await reservationInput(acquired.attempt, 1n, 0x61);
    await runEffect(current.repository.reserveCommand(
      acquired.run,
      input,
      operationBudget,
    ));
    await new Promise(resolve => setTimeout(resolve, 150));
    const restarted = makeDeclarativeV2VerifierProgressRepositoryV2(
      current.target,
      {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "22222222-2222-4222-8222-222222222222",
      },
    );
    const takeover = await runEffect(restarted.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    expect(takeover.attempt).toMatchObject({
      writerFence: 2n,
      pendingKind: "source_page",
      pendingSequence: 1n,
      pendingReservedByFence: 2n,
    });
    const resumed = await runEffect(
      restarted.resumePending(takeover.run, input, operationBudget),
    );
    expect(resumed.reservation.sequence).toBe(1n);
    const stale = await runEffectFailure(
      current.repository.renew(acquired.run, operationBudget),
    );
    expect(stale).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryStaleV2Error",
      reason: "ownerChanged",
    });
  });

  it("abandons terminally even with pending work and preserves immutable command rows", async () => {
    const current = await fixture();
    const acquired = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    const input = await reservationInput(acquired.attempt, 1n, 0x71);
    await runEffect(current.repository.reserveCommand(
      acquired.run,
      input,
      operationBudget,
    ));
    await runEffect(current.repository.abandon(acquired.run, operationBudget));
    const observed = await runEffect(current.repository.observeAttempt(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    if (observed.kind !== "present") throw new Error("Expected attempt.");
    expect(observed.attempt).toMatchObject({
      lifecycle: "abandoned",
      pendingKind: null,
      pendingSequence: null,
      leaseExpiresAt: null,
    });
    const counts = await current.persistence.query<{ commands: string }>(`
      select count(*)::text as commands
      from fx_system_declarative_v2_verifier_command_v2
    `);
    expect(counts.rows).toEqual([{ commands: "1" }]);
    const terminal = await runEffectFailure(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    expect(terminal).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryLifecycleV2Error",
      lifecycle: "abandoned",
    });
  });

  it("fails hostile inputs and exact-minus-one operation budgets before SQL", async () => {
    const current = await fixture();
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile");
      },
    });
    const invalid = await runEffectFailure(
      current.repository.createAttempt(hostile, operationBudget),
    );
    expect(invalid).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      reason: "invalidInput",
    });
    const noCalls = await runEffectFailure(current.repository.observeAttempt(
      scopeId,
      current.attemptSha256,
      { ...operationBudget, maximumCalls: 0 },
    ));
    expect(noCalls).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      reason: "budgetExceeded",
      dimension: "calls",
    });
  });

  it("admits elapsed time immediately before mutation and never rejects after commit", async () => {
    const current = await fixture();
    let clockReads = 0;
    const repository = makeDeclarativeV2VerifierProgressRepositoryV2(
      current.target,
      {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "33333333-3333-4333-8333-333333333333",
        monotonicMilliseconds: () => clockReads++ < 3 ? 0 : 1,
      },
    );
    const acquired = await runEffect(repository.acquire(
      scopeId,
      current.attemptSha256,
      {
        ...operationBudget,
        maximumElapsedMilliseconds: 0,
      },
    ));
    expect(acquired.kind).toBe("acquired");
    expect(acquired.operationUsage.elapsedMilliseconds).toBe(0);
    expect(clockReads).toBe(3);
  });

  it("rechecks elapsed admission before returning read-only replay capabilities", async () => {
    const clockValues: number[] = [];
    const current = await fixture({
      monotonicMilliseconds: () => clockValues.shift() ?? 0,
    });
    const acquired = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    clockValues.push(0, 0, 1);
    const acquireReplay = await runEffectFailure(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      {
        ...operationBudget,
        maximumElapsedMilliseconds: 0,
      },
    ));
    expect(acquireReplay).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      operation: "acquire",
      reason: "budgetExceeded",
      dimension: "elapsedMilliseconds",
    });

    const input = await reservationInput(acquired.attempt, 1n, 0x75);
    await runEffect(current.repository.reserveCommand(
      acquired.run,
      input,
      operationBudget,
    ));
    clockValues.push(0, 0, 1);
    const commandReplay = await runEffectFailure(
      current.repository.reserveCommand(
        acquired.run,
        input,
        {
          ...operationBudget,
          maximumElapsedMilliseconds: 0,
        },
      ),
    );
    expect(commandReplay).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      operation: "reserveCommand",
      reason: "budgetExceeded",
      dimension: "elapsedMilliseconds",
    });
  });

  it("admits exact durable and operation ceilings and rejects one-less before the next work", async () => {
    const current = await fixture({ semanticCeiling: 1n });
    const observed = await runEffect(current.repository.observeAttempt(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    if (observed.kind !== "present") throw new Error("Expected attempt.");
    const exactOperation = {
      maximumCalls: observed.operationUsage.calls,
      maximumRows: observed.operationUsage.rows,
      maximumFrameBytes: observed.operationUsage.frameBytes,
      maximumCanonicalBytes: observed.operationUsage.canonicalBytes,
      maximumHashBytes: observed.operationUsage.hashBytes,
      maximumElapsedMilliseconds:
        observed.operationUsage.elapsedMilliseconds,
    };
    await runEffect(current.repository.observeAttempt(
      scopeId,
      current.attemptSha256,
      exactOperation,
    ));
    const oneLess = await runEffectFailure(current.repository.observeAttempt(
      scopeId,
      current.attemptSha256,
      {
        ...exactOperation,
        maximumRows: exactOperation.maximumRows - 1,
      },
    ));
    expect(oneLess).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      reason: "budgetExceeded",
      dimension: "rows",
    });

    const acquired = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    const over = await reservationInput(acquired.attempt, 1n, 0x78, 2n);
    const exhausted = await runEffectFailure(current.repository.reserveCommand(
      acquired.run,
      over,
      operationBudget,
    ));
    expect(exhausted).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryExhaustionV2Error",
      operation: "reserveCommand",
      dimension: "calls",
      observed: 2n,
      maximum: 1n,
    });
    const exact = await reservationInput(acquired.attempt, 1n, 0x79, 1n);
    await runEffect(current.repository.reserveCommand(
      acquired.run,
      exact,
      operationBudget,
    ));
    const replay = await runEffect(current.repository.reserveCommand(
      acquired.run,
      exact,
      operationBudget,
    ));
    expect(replay.kind).toBe("pendingReplay");
  });

  it("keeps query observation ordered and does not compile when absent", async () => {
    const queries: Array<Readonly<{ readonly name: string; readonly sql: string }>> =
      [];
    const current = await fixture({
      observeQuery: observation => queries.push(observation),
    });
    await runEffect(current.repository.observeAttempt(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    const names = queries.map(query => query.name);
    expect(names).toContain("attemptMetadata");
    expect(names).toContain("attemptFrames");
    expect(names.indexOf("attemptMetadata")).toBeLessThan(
      names.indexOf("attemptFrames"),
    );
    expect(
      queries.find(query => query.name === "attemptMetadata")?.sql.toLowerCase(),
    ).toContain("for share");
  });
});

async function fixture(
  options: Readonly<{
    readonly claimDurationMilliseconds?: number;
    readonly semanticCeiling?: bigint;
    readonly monotonicMilliseconds?: () => number;
    readonly observeQuery?:
      Parameters<typeof makeDeclarativeV2VerifierProgressRepositoryV2>[1][
        "observeQuery"
      ];
  }> = {},
) {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
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
  const locatedTarget: LocatedReadCommittedAttemptTargetV1 = target;
  const inert = makeDeclarativeV2InertRepositoryV1(locatedTarget);
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
  const repository = makeDeclarativeV2VerifierProgressRepositoryV2(
    locatedTarget,
    {
      claimDurationMilliseconds: options.claimDurationMilliseconds ?? 60_000,
      randomUuid: () => "11111111-1111-4111-8111-111111111111",
      monotonicMilliseconds: options.monotonicMilliseconds ?? (() => 0),
      ...(options.observeQuery === undefined
        ? {}
        : { observeQuery: options.observeQuery }),
    },
  );
  const created = await runEffect(repository.createAttempt({
    scopeId,
    candidateSha256: inserted.candidateSha256,
    ceilings: semanticBudget(
      "attempt_ceilings",
      options.semanticCeiling ?? 1_000n,
    ),
  }, operationBudget));
  return {
    persistence,
    target: locatedTarget,
    repository,
    candidateSha256: inserted.candidateSha256,
    attemptSha256: created.attemptSha256,
  };
}

async function reservationInput(
  attempt: Readonly<{
    readonly attemptSha256: Uint8Array;
    readonly candidateSha256: Uint8Array;
    readonly progressSha256: Uint8Array;
    readonly lastReceiptSha256: Uint8Array | null;
  }>,
  sequence: bigint,
  byte: number,
  commandBudgetValue = 1n,
) {
  const commandBudget = semanticBudget(
    "command_budget",
    commandBudgetValue,
  );
  const encodedBudget = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(commandBudget, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  const commandBudgetSha256 = await sha256(encodedBudget.canonicalBytes);
  const reservation: DeclarativeV2VerifierCommandReservationFrameV2 = {
    kind: "command_reservation",
    attemptSha256: attempt.attemptSha256,
    candidateSha256: attempt.candidateSha256,
    commandKind: "source_page",
    sequence,
    currentProgressSha256: attempt.progressSha256,
    predecessorReceiptSha256: attempt.lastReceiptSha256,
    commandBudgetSha256,
    commandInputSha256: digest(byte),
    freshAuthenticatedInputSha256: digest(byte + 1),
    analyzerIdentitySha256: digest(byte + 2),
    verifierIdentitySha256: digest(byte + 3),
    rangeAndPredecessorTailsSha256: digest(byte + 4),
  };
  return Object.freeze({ reservation, commandBudget });
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
