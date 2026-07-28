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
  type DeclarativeV2VerifierDurableCommandKindV2,
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
  type DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  type DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
} from "../src/declarativeV2VerifierProgressRepositoryV2";
import { createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence } from "../src/pglite";
import {
  isLocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
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
const pageOperationBudget = Object.freeze({
  ...operationBudget,
  maximumRows: 5_000,
  maximumPages: 1_024,
  maximumPayloadBytes: 2_000_000,
}) satisfies DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2;

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

  it("appends, replays, and reads a contiguous metadata-first page chain", async () => {
    const queries: string[] = [];
    const current = await pendingParseFixture({
      observeQuery: query => queries.push(query.name),
    });
    const first = await evidencePageInput(
      current.reserved.reservation,
      0n,
      null,
      0n,
      2n,
      0n,
      1n,
      new Uint8Array([1, 2, 3]),
      0x91,
    );
    queries.length = 0;
    const appended = await runEffect(
      current.repository.appendEvidencePage(
        current.reserved.work,
        first,
        pageOperationBudget,
      ),
    );
    expect(appended).toMatchObject({ kind: "appended", pageOrdinal: 0n });
    expect(queries).toEqual([
      "lockAttempt",
      "pageCommandMetadata",
      "pageMetadata",
      "insertEvidencePage",
      "advanceCommandPageTail",
    ]);

    queries.length = 0;
    const replayed = await runEffect(
      current.repository.appendEvidencePage(
        current.reserved.work,
        first,
        pageOperationBudget,
      ),
    );
    expect(replayed.kind).toBe("replayed");
    expect(queries).toEqual([
      "lockAttempt",
      "pageCommandMetadata",
      "pageMetadata",
      "pageBytes",
    ]);

    const second = await evidencePageInput(
      current.reserved.reservation,
      1n,
      appended.pageSha256,
      2n,
      1n,
      1n,
      0n,
      new Uint8Array([4, 5]),
      0x92,
    );
    await runEffect(current.repository.appendEvidencePage(
      current.reserved.work,
      second,
      pageOperationBudget,
    ));

    queries.length = 0;
    const firstBatch = await runEffect(
      current.repository.readEvidencePageBatch(
        current.reserved.work,
        {
          startPageOrdinal: 0n,
          expectedPredecessorPageSha256: null,
        },
        { ...pageOperationBudget, maximumPages: 1 },
      ),
    );
    expect(firstBatch.pages).toHaveLength(1);
    expect(firstBatch.pages[0]?.payloadBytes).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(firstBatch.nextPageOrdinal).toBe(1n);
    expect(queries.indexOf("pageMetadata")).toBeLessThan(
      queries.indexOf("pageBytes"),
    );

    const secondBatch = await runEffect(
      current.repository.readEvidencePageBatch(
        current.reserved.work,
        {
          startPageOrdinal: 1n,
          expectedPredecessorPageSha256: appended.pageSha256,
        },
        { ...pageOperationBudget, maximumPages: 1 },
      ),
    );
    expect(secondBatch.pages).toHaveLength(1);
    expect(secondBatch.pages[0]?.payloadBytes).toEqual(
      new Uint8Array([4, 5]),
    );
    expect(secondBatch.nextPageOrdinal).toBeNull();
    expect(Object.isFrozen(secondBatch.pages)).toBe(true);
  });

  it("rejects page collisions, gaps, and predecessor mismatches without changing the tail", async () => {
    const current = await pendingParseFixture();
    const first = await evidencePageInput(
      current.reserved.reservation,
      0n,
      null,
      0n,
      1n,
      0n,
      0n,
      new Uint8Array([1]),
      0xa1,
    );
    const appended = await runEffect(current.repository.appendEvidencePage(
      current.reserved.work,
      first,
      pageOperationBudget,
    ));
    const collision = await evidencePageInput(
      current.reserved.reservation,
      0n,
      null,
      0n,
      1n,
      0n,
      0n,
      new Uint8Array([2]),
      0xa2,
    );
    expect(await runEffectFailure(current.repository.appendEvidencePage(
      current.reserved.work,
      collision,
      pageOperationBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryConflictV2Error",
      reason: "pageCollision",
    });
    const gap = await evidencePageInput(
      current.reserved.reservation,
      2n,
      appended.pageSha256,
      1n,
      1n,
      0n,
      0n,
      new Uint8Array([3]),
      0xa3,
    );
    expect(await runEffectFailure(current.repository.appendEvidencePage(
      current.reserved.work,
      gap,
      pageOperationBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryConflictV2Error",
      reason: "pageGap",
    });
    const predecessorMismatch = await evidencePageInput(
      current.reserved.reservation,
      1n,
      digest(0xff),
      1n,
      1n,
      0n,
      0n,
      new Uint8Array([4]),
      0xa4,
    );
    expect(await runEffectFailure(current.repository.appendEvidencePage(
      current.reserved.work,
      predecessorMismatch,
      pageOperationBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryConflictV2Error",
      reason: "predecessorMismatch",
    });
  });

  it("fails closed on a coherently corrupted replay transition or command tail", async () => {
    const current = await pendingParseFixture();
    const first = await evidencePageInput(
      current.reserved.reservation,
      0n,
      null,
      0n,
      1n,
      0n,
      0n,
      new Uint8Array([1]),
      0xa5,
    );
    const firstResult = await runEffect(
      current.repository.appendEvidencePage(
        current.reserved.work,
        first,
        pageOperationBudget,
      ),
    );
    const second = await evidencePageInput(
      current.reserved.reservation,
      1n,
      firstResult.pageSha256,
      1n,
      1n,
      0n,
      0n,
      new Uint8Array([2]),
      0xa6,
    );
    const secondResult = await runEffect(
      current.repository.appendEvidencePage(
        current.reserved.work,
        second,
        pageOperationBudget,
      ),
    );
    const corruptedSecond = await evidencePageInput(
      current.reserved.reservation,
      1n,
      digest(0xfe),
      1n,
      1n,
      0n,
      0n,
      new Uint8Array([2]),
      0xa6,
    );
    const corruptedSecondSha256 = await sha256(
      corruptedSecond.manifestBytes,
    );
    await current.persistence.query(
      `update fx_system_declarative_v2_verifier_evidence_page_v2
       set page_sha256 = $5,
           predecessor_page_sha256 = $6,
           manifest_byte_length = $7,
           manifest_sha256 = $5,
           manifest_bytes = $8
       where scope_id = $1
         and attempt_sha256 = $2
         and sequence = $3
         and page_ordinal = $4`,
      [
        scopeId,
        current.attemptSha256,
        1n,
        1n,
        corruptedSecondSha256,
        digest(0xfe),
        BigInt(corruptedSecond.manifestBytes.byteLength),
        corruptedSecond.manifestBytes,
      ],
    );
    await current.persistence.query(
      `update fx_system_declarative_v2_verifier_command_v2
       set last_page_sha256 = $4
       where scope_id = $1
         and attempt_sha256 = $2
         and sequence = $3`,
      [scopeId, current.attemptSha256, 1n, corruptedSecondSha256],
    );
    expect(await runEffectFailure(
      current.repository.appendEvidencePage(
        current.reserved.work,
        corruptedSecond,
        pageOperationBudget,
      ),
    )).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryCorruptionV2Error",
      operation: "appendEvidencePage",
      reason: "normalizedMismatch",
    });

    await current.persistence.query(
      `update fx_system_declarative_v2_verifier_evidence_page_v2
       set page_sha256 = $5,
           predecessor_page_sha256 = $6,
           manifest_byte_length = $7,
           manifest_sha256 = $5,
           manifest_bytes = $8
       where scope_id = $1
         and attempt_sha256 = $2
         and sequence = $3
         and page_ordinal = $4`,
      [
        scopeId,
        current.attemptSha256,
        1n,
        1n,
        secondResult.pageSha256,
        firstResult.pageSha256,
        BigInt(second.manifestBytes.byteLength),
        second.manifestBytes,
      ],
    );
    await current.persistence.query(
      `update fx_system_declarative_v2_verifier_command_v2
       set last_page_sha256 = $4
       where scope_id = $1
         and attempt_sha256 = $2
         and sequence = $3`,
      [scopeId, current.attemptSha256, 1n, digest(0xfd)],
    );
    expect(await runEffectFailure(
      current.repository.readEvidencePageBatch(
        current.reserved.work,
        {
          startPageOrdinal: 0n,
          expectedPredecessorPageSha256: null,
        },
        pageOperationBudget,
      ),
    )).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryCorruptionV2Error",
      operation: "readEvidencePageBatch",
      reason: "normalizedMismatch",
    });
  });

  it("enforces hostile input and exact page/payload admissions before body reads", async () => {
    const queries: string[] = [];
    const current = await pendingParseFixture({
      observeQuery: query => queries.push(query.name),
    });
    const input = await evidencePageInput(
      current.reserved.reservation,
      0n,
      null,
      0n,
      1n,
      0n,
      0n,
      new Uint8Array([1, 2, 3]),
      0xb1,
    );
    expect(await runEffectFailure(current.repository.appendEvidencePage(
      current.reserved.work,
      input,
      { ...pageOperationBudget, maximumPayloadBytes: 2 },
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      reason: "budgetExceeded",
      dimension: "payloadBytes",
    });
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile");
      },
    });
    expect(await runEffectFailure(current.repository.appendEvidencePage(
      current.reserved.work,
      hostile,
      pageOperationBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      reason: "invalidInput",
    });
    await runEffect(current.repository.appendEvidencePage(
      current.reserved.work,
      input,
      pageOperationBudget,
    ));
    for (const maximumPages of [0, 1_025]) {
      expect(await runEffectFailure(
        current.repository.readEvidencePageBatch(
          current.reserved.work,
          {
            startPageOrdinal: 0n,
            expectedPredecessorPageSha256: null,
          },
          { ...pageOperationBudget, maximumPages },
        ),
      )).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
        reason: "invalidBudget",
      });
    }
    queries.length = 0;
    expect(await runEffectFailure(
      current.repository.readEvidencePageBatch(
        current.reserved.work,
        {
          startPageOrdinal: 0n,
          expectedPredecessorPageSha256: null,
        },
        { ...pageOperationBudget, maximumPayloadBytes: 2 },
      ),
    )).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      reason: "budgetExceeded",
      dimension: "payloadBytes",
    });
    expect(queries).toContain("pageMetadata");
    expect(queries).not.toContain("pageBytes");
    const maximumBatch = await runEffect(
      current.repository.readEvidencePageBatch(
        current.reserved.work,
        {
          startPageOrdinal: 0n,
          expectedPredecessorPageSha256: null,
        },
        { ...pageOperationBudget, maximumPages: 1_024 },
      ),
    );
    expect(maximumBatch.pages).toHaveLength(1);
  });

  it("recovers pages under a fresh takeover work capability and rejects missing durable tail rows", async () => {
    const current = await pendingParseFixture({
      claimDurationMilliseconds: 100,
    });
    const first = await evidencePageInput(
      current.reserved.reservation,
      0n,
      null,
      0n,
      1n,
      0n,
      0n,
      new Uint8Array([7]),
      0xc1,
    );
    const appended = await runEffect(current.repository.appendEvidencePage(
      current.reserved.work,
      first,
      pageOperationBudget,
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
    const resumed = await runEffect(restarted.resumePending(
      takeover.run,
      current.reservationInput,
      operationBudget,
    ));
    const recovered = await runEffect(restarted.readEvidencePageBatch(
      resumed.work,
      {
        startPageOrdinal: 0n,
        expectedPredecessorPageSha256: null,
      },
      pageOperationBudget,
    ));
    expect(recovered.pages[0]?.pageSha256).toEqual(appended.pageSha256);
    expect(await runEffectFailure(current.repository.readEvidencePageBatch(
      current.reserved.work,
      {
        startPageOrdinal: 0n,
        expectedPredecessorPageSha256: null,
      },
      pageOperationBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryStaleV2Error",
      reason: "ownerChanged",
    });

    await current.persistence.query(
      `delete from fx_system_declarative_v2_verifier_evidence_page_v2
       where scope_id = $1 and attempt_sha256 = $2 and sequence = 1`,
      [scopeId, current.attemptSha256],
    );
    expect(await runEffectFailure(restarted.readEvidencePageBatch(
      resumed.work,
      {
        startPageOrdinal: 0n,
        expectedPredecessorPageSha256: null,
      },
      pageOperationBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryCorruptionV2Error",
      reason: "missingPageWithinTail",
    });
  });

  it("settles a page command atomically and observes the committed decision without authority", async () => {
    const queries: string[] = [];
    const current = await pendingParseFixture({
      observeQuery: query => queries.push(query.name),
    });
    const page = await evidencePageInput(
      current.reserved.reservation,
      0n,
      null,
      0n,
      2n,
      0n,
      0n,
      new Uint8Array([1, 2, 3]),
      0xd1,
    );
    const appended = await runEffect(current.repository.appendEvidencePage(
      current.reserved.work,
      page,
      pageOperationBudget,
    ));
    const input = await settlementInput(
      current.reserved.reservation,
      appended.pageSha256,
      2n,
      digest(0xd1),
      1n,
      "parse",
    );
    queries.length = 0;
    const settled = await runEffect(current.repository.settleCommand(
      current.reserved.work,
      input,
      operationBudget,
    ));
    expect(settled).toMatchObject({
      kind: "settled",
      settlement: {
        commandKind: "parse_module",
        sequence: 1n,
        nextProgress: { phase: "parse", settledSequence: 1n },
      },
    });
    expect(queries).toEqual([
      "settlementCommandMetadata",
      "settlementFinalPageMetadata",
      "settlementFinalPageManifest",
      "lockAttempt",
      "settlementCommandMetadata",
      "settlementCommandFrames",
      "settlementFinalPageMetadata",
      "settlementFinalPageManifest",
      "settleCommand",
      "settleAttempt",
    ]);
    expect(await runEffectFailure(current.repository.appendEvidencePage(
      current.reserved.work,
      page,
      pageOperationBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      reason: "workClosed",
    });

    const reservationSha256 =
      await frameSha256(current.reserved.reservation);
    const restarted = makeDeclarativeV2VerifierProgressRepositoryV2(
      current.target,
      {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "22222222-2222-4222-8222-222222222222",
        observeQuery: query => queries.push(query.name),
      },
    );
    queries.length = 0;
    const observed = await runEffect(restarted.observeCommandDecision({
      scopeId,
      attemptSha256: current.attemptSha256,
      sequence: 1n,
      reservationSha256,
    }, operationBudget));
    expect(observed.decision).toMatchObject({
      kind: "settled",
      settlement: {
        commandKind: "parse_module",
        sequence: 1n,
        receiptSha256: settled.settlement.receiptSha256,
      },
    });
    expect(queries).toEqual([
      "decisionAttemptMetadata",
      "decisionCommandMetadata",
      "decisionFinalPageMetadata",
      "decisionAttemptFrames",
      "decisionCommandFrames",
    ]);
    const historicalIdentity = {
      scopeId,
      attemptSha256: current.attemptSha256,
      commandKind: "parse_module" as const,
      sequence: 1n,
      reservationSha256,
      outputManifestSha256: await frameSha256Any(input.outputManifest),
      receiptSha256: await frameSha256Any(input.receipt),
      startPageOrdinal: 0n,
      expectedPredecessorPageSha256: null,
    };
    queries.length = 0;
    const coldPages = await runEffect(
      restarted.readSettledEvidencePageBatch(
        historicalIdentity,
        pageOperationBudget,
      ),
    );
    expect(coldPages).toMatchObject({
      settlement: {
        commandKind: "parse_module",
        sequence: 1n,
        receiptSha256: settled.settlement.receiptSha256,
      },
      pages: [{
        manifest: {
          pageOrdinal: 0n,
          evidenceCount: 2n,
        },
        payloadBytes: new Uint8Array([1, 2, 3]),
      }],
      next: null,
    });
    expect(Object.isFrozen(coldPages)).toBe(true);
    expect(Object.isFrozen(coldPages.pages)).toBe(true);
    expect(queries).toEqual([
      "settledReadCommandMetadata",
      "settledReadPageMetadata",
      "settledReadFinalPageMetadata",
      "settledReadSettlementFrames",
      "settledReadPageBytes",
      "settledReadFinalPageManifest",
    ]);
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile settled selector");
      },
    });
    queries.length = 0;
    expect(await runEffectFailure(
      restarted.readSettledEvidencePageBatch(
        hostile,
        pageOperationBudget,
      ),
    )).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      operation: "readSettledEvidencePageBatch",
      reason: "invalidInput",
    });
    expect(queries).toEqual([]);
    for (const maximumPages of [0, 1_025]) {
      expect(await runEffectFailure(
        restarted.readSettledEvidencePageBatch(
          historicalIdentity,
          { ...pageOperationBudget, maximumPages },
        ),
      )).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
        operation: "readSettledEvidencePageBatch",
        reason: "invalidBudget",
      });
    }
    expect(await runEffectFailure(
      restarted.readSettledEvidencePageBatch({
        ...historicalIdentity,
        outputManifestSha256: digest(0xfe),
      }, pageOperationBudget),
    )).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryConflictV2Error",
      operation: "readSettledEvidencePageBatch",
      reason: "commandChanged",
    });

    queries.length = 0;
    expect(await runEffectFailure(
      restarted.readSettledEvidencePageBatch(
        historicalIdentity,
        { ...pageOperationBudget, maximumPayloadBytes: 2 },
      ),
    )).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      operation: "readSettledEvidencePageBatch",
      reason: "budgetExceeded",
      dimension: "payloadBytes",
    });
    expect(queries).toEqual([
      "settledReadCommandMetadata",
      "settledReadPageMetadata",
      "settledReadFinalPageMetadata",
    ]);

    queries.length = 0;
    const exhausted = await runEffect(
      restarted.readSettledEvidencePageBatch({
        ...historicalIdentity,
        startPageOrdinal: 1n,
        expectedPredecessorPageSha256: appended.pageSha256,
      }, pageOperationBudget),
    );
    expect(exhausted.pages).toEqual([]);
    expect(exhausted.next).toBeNull();
    expect(queries).toEqual([
      "settledReadCommandMetadata",
      "settledReadPredecessorMetadata",
      "settledReadPageMetadata",
      "settledReadFinalPageMetadata",
      "settledReadSettlementFrames",
      "settledReadPredecessorManifest",
      "settledReadFinalPageManifest",
    ]);

    expect(await runEffectFailure(
      restarted.readSettledEvidencePageBatch({
        ...historicalIdentity,
        expectedPredecessorPageSha256: digest(0xff),
      }, pageOperationBudget),
    )).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryConflictV2Error",
      operation: "readSettledEvidencePageBatch",
      reason: "predecessorMismatch",
    });

    const uncertainTarget: LocatedReadCommittedAttemptTargetV1 = {
      physicalLocator: current.target.physicalLocator,
      getCurrentClock: requestedScope =>
        current.target.getCurrentClock(requestedScope),
      [RUN_LOCATED_READ_COMMITTED_V1]: async work => {
        await current.target[RUN_LOCATED_READ_COMMITTED_V1](work);
        throw new LocatedReadCommittedTransactionFailureV1({
          kind: "decisionUncertain",
          settlementCause: new Error("lost read settlement"),
        });
      },
    };
    const uncertainRepository =
      makeDeclarativeV2VerifierProgressRepositoryV2(uncertainTarget, {
        claimDurationMilliseconds: 60_000,
      });
    expect(await runEffectFailure(
      uncertainRepository.readSettledEvidencePageBatch(
        historicalIdentity,
        pageOperationBudget,
      ),
    )).toMatchObject({
      _tag:
        "DeclarativeV2VerifierProgressRepositoryDecisionUncertainV2Error",
      operation: "readSettledEvidencePageBatch",
    });

    await current.persistence.query(
      `update fx_system_declarative_v2_verifier_evidence_page_v2
       set evidence_count = evidence_count + 1
       where scope_id = $1 and attempt_sha256 = $2 and sequence = 1`,
      [scopeId, current.attemptSha256],
    );
    expect(await runEffectFailure(restarted.observeCommandDecision({
      scopeId,
      attemptSha256: current.attemptSha256,
      sequence: 1n,
      reservationSha256,
    }, operationBudget))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryCorruptionV2Error",
      operation: "observeCommandDecision",
      reason: "normalizedMismatch",
    });
  });

  it("returns pending and terminal-unsettled decisions without reading frame bytes", async () => {
    const queries: string[] = [];
    const current = await pendingParseFixture({
      observeQuery: query => queries.push(query.name),
    });
    const reservationSha256 =
      await frameSha256(current.reserved.reservation);
    queries.length = 0;
    const pending = await runEffect(
      current.repository.observeCommandDecision({
        scopeId,
        attemptSha256: current.attemptSha256,
        sequence: 1n,
        reservationSha256,
      }, operationBudget),
    );
    expect(pending.decision.kind).toBe("pending");
    expect(queries).toEqual([
      "decisionAttemptMetadata",
      "decisionCommandMetadata",
    ]);
    await runEffect(current.repository.abandon(
      current.acquired.run,
      operationBudget,
    ));
    queries.length = 0;
    const terminal = await runEffect(
      current.repository.observeCommandDecision({
        scopeId,
        attemptSha256: current.attemptSha256,
        sequence: 1n,
        reservationSha256,
      }, operationBudget),
    );
    expect(terminal.decision).toMatchObject({
      kind: "terminalUnsettled",
      lifecycle: "abandoned",
    });
    expect(queries).toEqual([
      "decisionAttemptMetadata",
      "decisionCommandMetadata",
    ]);
  });

  it("paginates detached historical pages under inert lineage without a Work capability", async () => {
    const current = await pendingParseFixture();
    const first = await evidencePageInput(
      current.reserved.reservation,
      0n,
      null,
      0n,
      1n,
      0n,
      0n,
      new Uint8Array([7]),
      0xd1,
    );
    const firstAppend = await runEffect(
      current.repository.appendEvidencePage(
        current.reserved.work,
        first,
        pageOperationBudget,
      ),
    );
    const second = await evidencePageInput(
      current.reserved.reservation,
      1n,
      firstAppend.pageSha256,
      1n,
      1n,
      0n,
      0n,
      new Uint8Array([8, 9]),
      0xd2,
    );
    const secondAppend = await runEffect(
      current.repository.appendEvidencePage(
        current.reserved.work,
        second,
        pageOperationBudget,
      ),
    );
    const settlement = await settlementInput(
      current.reserved.reservation,
      secondAppend.pageSha256,
      2n,
      digest(0xd2),
      1n,
      "parse",
    );
    await runEffect(current.repository.settleCommand(
      current.reserved.work,
      settlement,
      operationBudget,
    ));
    const restarted = makeDeclarativeV2VerifierProgressRepositoryV2(
      current.target,
      {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "22222222-2222-4222-8222-222222222222",
      },
    );
    const identity = {
      scopeId,
      attemptSha256: current.attemptSha256,
      commandKind: "parse_module" as const,
      sequence: 1n,
      reservationSha256:
        await frameSha256(current.reserved.reservation),
      outputManifestSha256:
        await frameSha256Any(settlement.outputManifest),
      receiptSha256: await frameSha256Any(settlement.receipt),
    };
    const firstBatch = await runEffect(
      restarted.readSettledEvidencePageBatch({
        ...identity,
        startPageOrdinal: 0n,
        expectedPredecessorPageSha256: null,
      }, { ...pageOperationBudget, maximumPages: 1 }),
    );
    expect(firstBatch.pages.map(page => page.payloadBytes))
      .toEqual([new Uint8Array([7])]);
    expect(firstBatch.next).toEqual({
      startPageOrdinal: 1n,
      expectedPredecessorPageSha256: firstAppend.pageSha256,
    });
    const exactBudget = {
      maximumCalls: firstBatch.operationUsage.calls,
      maximumRows: firstBatch.operationUsage.rows,
      maximumFrameBytes: firstBatch.operationUsage.frameBytes,
      maximumCanonicalBytes: firstBatch.operationUsage.canonicalBytes,
      maximumHashBytes: firstBatch.operationUsage.hashBytes,
      maximumElapsedMilliseconds:
        pageOperationBudget.maximumElapsedMilliseconds,
      maximumPages: firstBatch.operationUsage.pages,
      maximumPayloadBytes: firstBatch.operationUsage.payloadBytes,
    };
    await runEffect(restarted.readSettledEvidencePageBatch({
      ...identity,
      startPageOrdinal: 0n,
      expectedPredecessorPageSha256: null,
    }, exactBudget));
    for (const [maximum, dimension] of [
      ["maximumCalls", "calls"],
      ["maximumRows", "rows"],
      ["maximumFrameBytes", "frameBytes"],
      ["maximumCanonicalBytes", "canonicalBytes"],
      ["maximumHashBytes", "hashBytes"],
      ["maximumPayloadBytes", "payloadBytes"],
    ] as const) {
      const currentMaximum = exactBudget[maximum];
      expect(currentMaximum).toBeGreaterThan(0);
      expect(await runEffectFailure(
        restarted.readSettledEvidencePageBatch({
          ...identity,
          startPageOrdinal: 0n,
          expectedPredecessorPageSha256: null,
        }, {
          ...exactBudget,
          [maximum]: currentMaximum - 1,
        }),
      )).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
        operation: "readSettledEvidencePageBatch",
        reason: "budgetExceeded",
        dimension,
      });
    }
    if (firstBatch.next === null) throw new Error("Expected next lineage.");
    firstBatch.pages[0]!.payloadBytes[0] = 0xff;
    const secondBatch = await runEffect(
      restarted.readSettledEvidencePageBatch({
        ...identity,
        ...firstBatch.next,
      }, { ...pageOperationBudget, maximumPages: 1 }),
    );
    expect(secondBatch.pages.map(page => page.payloadBytes))
      .toEqual([new Uint8Array([8, 9])]);
    expect(secondBatch.next).toBeNull();
    const reread = await runEffect(
      restarted.readSettledEvidencePageBatch({
        ...identity,
        startPageOrdinal: 0n,
        expectedPredecessorPageSha256: null,
      }, { ...pageOperationBudget, maximumPages: 1 }),
    );
    expect(reread.pages[0]!.payloadBytes).toEqual(new Uint8Array([7]));
    await current.persistence.query(
      `update fx_system_declarative_v2_verifier_evidence_page_v2
       set evidence_count = evidence_count + 1
       where scope_id = $1
         and attempt_sha256 = $2
         and sequence = 1
         and page_ordinal = 0`,
      [scopeId, current.attemptSha256],
    );
    expect(await runEffectFailure(
      restarted.readSettledEvidencePageBatch({
        ...identity,
        startPageOrdinal: 1n,
        expectedPredecessorPageSha256: firstAppend.pageSha256,
      }, { ...pageOperationBudget, maximumPages: 1 }),
    )).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryCorruptionV2Error",
      operation: "readSettledEvidencePageBatch",
      reason: "normalizedMismatch",
    });
  });

  it("settles source work without evidence pages or a terminal lifecycle", async () => {
    const queries: string[] = [];
    const current = await fixture({
      observeQuery: query => queries.push(query.name),
    });
    const acquired = await runEffect(current.repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    const reservation = await reservationInput(
      acquired.attempt,
      1n,
      0xe1,
      1n,
      "source_page",
    );
    const reserved = await runEffect(current.repository.reserveCommand(
      acquired.run,
      reservation,
      operationBudget,
    ));
    const input = await settlementInput(
      reserved.reservation,
      digest(0xe2),
      0n,
      digest(0xe3),
      1n,
      "source",
    );
    queries.length = 0;
    const settled = await runEffect(current.repository.settleCommand(
      reserved.work,
      input,
      operationBudget,
    ));
    expect(settled.settlement.nextProgress.phase).toBe("source");
    expect(queries).toEqual([
      "lockAttempt",
      "settlementCommandMetadata",
      "settlementCommandFrames",
      "settleCommand",
      "settleAttempt",
    ]);
    await runEffect(current.repository.release(
      acquired.run,
      operationBudget,
    ));
  });

  it("rejects over-budget settlement and mismatched final page roots before writes", async () => {
    const incomplete = await pendingParseFixture();
    const premature = await settlementInput(
      incomplete.reserved.reservation,
      digest(0xd0),
      1n,
      digest(0xd1),
      1n,
      "parse",
    );
    expect(await runEffectFailure(incomplete.repository.settleCommand(
      incomplete.reserved.work,
      premature,
      operationBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      operation: "settleCommand",
      reason: "commandMismatch",
    });

    const overBudget = await pendingParseFixture();
    const page = await evidencePageInput(
      overBudget.reserved.reservation,
      0n,
      null,
      0n,
      1n,
      0n,
      0n,
      new Uint8Array([1]),
      0xd2,
    );
    const appended = await runEffect(overBudget.repository.appendEvidencePage(
      overBudget.reserved.work,
      page,
      pageOperationBudget,
    ));
    const excessive = await settlementInput(
      overBudget.reserved.reservation,
      appended.pageSha256,
      1n,
      digest(0xd2),
      2n,
      "parse",
    );
    expect(await runEffectFailure(overBudget.repository.settleCommand(
      overBudget.reserved.work,
      excessive,
      operationBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      operation: "settleCommand",
      reason: "commandMismatch",
    });

    const mismatched = await pendingParseFixture();
    const secondPage = await evidencePageInput(
      mismatched.reserved.reservation,
      0n,
      null,
      0n,
      1n,
      0n,
      0n,
      new Uint8Array([2]),
      0xd3,
    );
    await runEffect(mismatched.repository.appendEvidencePage(
      mismatched.reserved.work,
      secondPage,
      pageOperationBudget,
    ));
    const wrongRoot = await settlementInput(
      mismatched.reserved.reservation,
      digest(0xff),
      1n,
      digest(0xd3),
      1n,
      "parse",
    );
    const wrongRootFailure = await runEffectFailure(
      mismatched.repository.settleCommand(
      mismatched.reserved.work,
      wrongRoot,
      operationBudget,
      ),
    );
    expect(wrongRootFailure).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      operation: "settleCommand",
      reason: "commandMismatch",
    });
    expect(wrongRootFailure).toHaveProperty("codecCause");
    const observed = await runEffect(mismatched.repository.observeAttempt(
      scopeId,
      mismatched.attemptSha256,
      operationBudget,
    ));
    expect(observed.kind).toBe("present");
    if (observed.kind !== "present") throw new Error("Expected attempt.");
    expect(observed.attempt.pendingSequence).toBe(1n);
  });

  it("returns no receipt authority after an uncertain settlement and recovers by inert readback", async () => {
    const current = await fixture();
    await moveAttemptToParse(current.persistence, current.attemptSha256);
    let transactionsUntilLoss: number | null = null;
    const faultTarget: LocatedReadCommittedAttemptTargetV1 = {
      physicalLocator: current.target.physicalLocator,
      getCurrentClock: scope => current.target.getCurrentClock(scope),
      [RUN_LOCATED_READ_COMMITTED_V1]: async work => {
        const result =
          await current.target[RUN_LOCATED_READ_COMMITTED_V1](work);
        if (transactionsUntilLoss !== null) {
          transactionsUntilLoss -= 1;
          if (transactionsUntilLoss === 0) {
            transactionsUntilLoss = null;
            throw new LocatedReadCommittedTransactionFailureV1({
              kind: "decisionUncertain",
              settlementCause: new Error("lost settlement response"),
            });
          }
        }
        return result;
      },
    };
    const repository = makeDeclarativeV2VerifierProgressRepositoryV2(
      faultTarget,
      {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "33333333-3333-4333-8333-333333333333",
      },
    );
    const acquired = await runEffect(repository.acquire(
      scopeId,
      current.attemptSha256,
      operationBudget,
    ));
    const reservation = await reservationInput(
      acquired.attempt,
      1n,
      0xe4,
      1n,
      "parse_module",
    );
    const reserved = await runEffect(repository.reserveCommand(
      acquired.run,
      reservation,
      operationBudget,
    ));
    const page = await evidencePageInput(
      reserved.reservation,
      0n,
      null,
      0n,
      1n,
      0n,
      0n,
      new Uint8Array([4]),
      0xe5,
    );
    const appended = await runEffect(repository.appendEvidencePage(
      reserved.work,
      page,
      pageOperationBudget,
    ));
    const settlement = await settlementInput(
      reserved.reservation,
      appended.pageSha256,
      1n,
      digest(0xe5),
      1n,
      "parse",
    );
    transactionsUntilLoss = 2;
    expect(await runEffectFailure(repository.settleCommand(
      reserved.work,
      settlement,
      operationBudget,
    ))).toMatchObject({
      _tag:
        "DeclarativeV2VerifierProgressRepositoryDecisionUncertainV2Error",
      operation: "settleCommand",
    });
    expect(await runEffectFailure(repository.renew(
      acquired.run,
      operationBudget,
    ))).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressRepositoryInputV2Error",
      reason: "runClosed",
    });
    const observed = await runEffect(
      current.repository.observeCommandDecision({
        scopeId,
        attemptSha256: current.attemptSha256,
        sequence: 1n,
        reservationSha256: await frameSha256(reserved.reservation),
      }, operationBudget),
    );
    expect(observed.decision.kind).toBe("settled");
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

async function pendingParseFixture(
  options: Parameters<typeof fixture>[0] = {},
) {
  const current = await fixture(options);
  await moveAttemptToParse(current.persistence, current.attemptSha256);
  const acquired = await runEffect(current.repository.acquire(
    scopeId,
    current.attemptSha256,
    operationBudget,
  ));
  const input = await reservationInput(
    acquired.attempt,
    1n,
    0x88,
    1n,
    "parse_module",
  );
  const reserved = await runEffect(current.repository.reserveCommand(
    acquired.run,
    input,
    operationBudget,
  ));
  return {
    ...current,
    acquired,
    reservationInput: input,
    reserved,
  };
}

async function moveAttemptToParse(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
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
  const digest = await sha256(encoded.canonicalBytes);
  await persistence.query(
    `update fx_system_declarative_v2_verifier_attempt_v2
     set lifecycle = 'parsing',
         progress_byte_length = $3,
         progress_sha256 = $4,
         progress_bytes = $5,
         updated_at = now()
     where scope_id = $1 and attempt_sha256 = $2`,
    [
      scopeId,
      attemptSha256,
      BigInt(encoded.canonicalBytes.byteLength),
      digest,
      encoded.canonicalBytes,
    ],
  );
}

async function evidencePageInput(
  reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  pageOrdinal: bigint,
  predecessorPageSha256: Uint8Array | null,
  firstEvidenceOrdinal: bigint,
  evidenceCount: bigint,
  firstDiagnosticOrdinal: bigint,
  diagnosticCount: bigint,
  payloadBytes: Uint8Array,
  rootByte: number,
) {
  const payloadSha256 = await sha256(payloadBytes);
  const manifest:
    DeclarativeV2VerifierEvidencePageManifestFrameV2 = {
      kind: "evidence_page_manifest",
      reservationSha256: await frameSha256(reservation),
      commandKind: reservation.commandKind as "parse_module" | "link_page",
      sequence: reservation.sequence,
      pageOrdinal,
      firstEvidenceOrdinal,
      evidenceCount,
      firstDiagnosticOrdinal,
      diagnosticCount,
      predecessorPageSha256,
      payloadByteLength: BigInt(payloadBytes.byteLength),
      payloadSha256,
      cumulativeDiagnosticsRootSha256: digest(rootByte),
    };
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(manifest, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  return Object.freeze({
    manifestBytes: encoded.canonicalBytes,
    payloadBytes: new Uint8Array(payloadBytes),
  });
}

async function frameSha256(
  frame: DeclarativeV2VerifierCommandReservationFrameV2,
) {
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(frame, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  return sha256(encoded.canonicalBytes);
}

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
  commandKind: DeclarativeV2VerifierDurableCommandKindV2 = "source_page",
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
    commandKind,
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

async function settlementInput(
  reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  evidenceRootSha256: Uint8Array,
  evidenceCount: bigint,
  diagnosticsRootSha256: Uint8Array,
  commandUsageValue: bigint,
  nextPhase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
) {
  const reservationSha256 = await frameSha256(reservation);
  const commandUsage = semanticBudget("command_budget", commandUsageValue);
  const resultingUsage = semanticBudget("attempt_usage", 1n);
  const nextProgress: DeclarativeV2VerifierProgressCursorFrameV2 = {
    kind: "progress_cursor",
    phase: nextPhase,
    settledSequence: reservation.sequence,
    moduleOrdinal: 1n,
    edgeOrdinal: 0n,
    pageOrdinal: 1n,
    previousReceiptSha256: reservation.predecessorReceiptSha256,
  };
  const nextProgressSha256 = await frameSha256Any(nextProgress);
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
    commandUsageSha256: await frameSha256Any(commandUsage),
    resultingAttemptUsageSha256: await frameSha256Any(resultingUsage),
    outputManifestSha256: await frameSha256Any(outputManifest),
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

async function frameSha256Any(
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
