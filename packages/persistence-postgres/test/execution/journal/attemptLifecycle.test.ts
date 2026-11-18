import { finiteDocumentValidationScenario } from "./finiteDocumentValidationScenario";
import {
  canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import { expect, it, vi, afterAll, beforeAll, describe } from "vitest";
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
} from "../../../src/database/pglite";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedScopeClockReader,
} from "../../../src/scope/scopeAuthorityResolution";
import {
  SessionJournalAttemptUnavailableV1Error,
  type SessionJournalPointOperationV1,
} from "../../../src/execution/journal/api";
import {
  createPointMutationExecutionClaimAcquisitionV1,
} from "../../../src/execution/claims/acquisition";
import {
  ExactRunningAttemptTransactionV1Error,
} from "../../../src/execution/session/errors";
import {
  reconcileExactRunningAttemptTransactionFailureV1,
} from "../../../src/execution/session/errorProjections";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  isLocatedExactRunningAttemptKernelV1,
} from "../../../src/execution/session/kernelContracts";
import {
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "../../support/effectTestRuntime";
import {
  SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
} from "../../application/revision/applicationRevisionSyscallValidatorTestSupport";
import {
  sharedLocator,
  selectorFromAnchor,
  syscallSequence,
  documentId,
  requireSeededDocumentId,
  deferredSignal,
  delay,
} from "./journalTestSupport";
import {
  createSessionJournalStorePGliteFixture,
  type SessionJournalStorePGliteFixture,
} from "./journalFixture";

describe("Journal attempt lifecycle (PGlite)", () => {
  let fixture: SessionJournalStorePGliteFixture;
  let persistence: SessionJournalStorePGliteFixture["persistence"];
  let scenario: SessionJournalStorePGliteFixture["scenario"];
  let resolutionPorts: SessionJournalStorePGliteFixture["resolutionPorts"];
  let journalCounts: SessionJournalStorePGliteFixture["journalCounts"];
  let journalRoot: SessionJournalStorePGliteFixture["journalRoot"];

  beforeAll(async () => {
    fixture = await createSessionJournalStorePGliteFixture();
    ({ persistence, scenario, resolutionPorts, journalCounts, journalRoot } = fixture);
  });

  afterAll(async () => {
    await fixture?.close();
  });

  it("retains durable Application point and index receipts through settlement", async () => {
    const current = await scenario("finite_app_point_index", {
      executionProfile: "durableOperations", seedFields: { name: "before" }, developerIndex: true,
    });
    if (current.developerIndex === null) throw new Error("Missing developer index handle");
    const documentId = requireSeededDocumentId(current);
    expect(await runPointOperation(current.store, current.table, {
      kind: "get", syscallSequence: syscallSequence(1n), documentId,
    })).toMatchObject({ kind: "completed", delivery: "executed",
      outcome: { kind: "present", document: { name: "before" } } });
    expect(await runPointOperation(current.store, current.table, {
      kind: "patch", syscallSequence: syscallSequence(2n), documentId,
      patch: { name: "after" },
    })).toMatchObject({ kind: "completed", delivery: "executed",
      outcome: { kind: "unit", operation: "patch" } });
    const page = await runEffect(current.store.runIndexedQueryEffect(current.developerIndex, {
      kind: "indexRange", syscallSequence: syscallSequence(3n), bounds: Object.freeze({}), limit: 8,
    }));
    expect(page).toMatchObject({ kind: "completed", delivery: "executed",
      outcome: { kind: "indexRangePage", documents: [{ name: "after" }], isDone: true } });
    expect(await runPointOperation(current.store, current.table, {
      kind: "get", syscallSequence: syscallSequence(4n), documentId,
    })).toMatchObject({ kind: "completed", outcome: { kind: "present", document: { name: "after" } } });
    const beforeSeal = await persistence.query<{ count: number }>(
      `select count(*)::int as count from fx_system_tx_journal_receipt where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(beforeSeal.rows[0]?.count).toBe(4);
    const prepared = await prepareSeal(current.store, current.attempt);
    await runEffect(current.store.completeSealEffect(prepared.preparation,
      await runEffect(canonicalizeSessionJournalEffect(prepared.journal)),
      await runEffect(canonicalizeSuccessfulResultV1Effect({ ok: true }))));
    const afterSeal = await persistence.query<{ count: number }>(
      `select count(*)::int as count from fx_system_tx_journal_receipt where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(afterSeal.rows[0]?.count).toBe(4);
  });

  it("preserves durable accepted work across pre-stage document validation rejection", async () => {
    await finiteDocumentValidationScenario(persistence, await scenario("finite_document_validation", {
      executionProfile: "durableOperations", seedFields: { name: "persisted" },
    }));
  });

  it("rejects the stale execution owner at open, syscall, and seal after takeover", async () => {
    const current = await scenario("execution_claim_takeover");
    await persistence.query(
      `update fx_system_tx_execution_claim
       set claimed_at = clock_timestamp() - interval '2 minutes',
           claim_expires_at = clock_timestamp() - interval '1 minute'
       where session_id = $1`,
      [current.anchor.sessionId],
    );
    const acquisition = createPointMutationExecutionClaimAcquisitionV1(
      resolutionPorts(persistence),
      {
        durationMilliseconds: 30_000,
        randomOwner: () => "83000000-0000-4000-8000-000000009991",
      },
    );
    await expect(runEffect(acquisition.acquireEffect(
      selectorFromAnchor(current.anchor),
    ))).resolves.toMatchObject({
      kind: "acquired",
      mode: "execute",
      observation: { claimFence: 2n },
    });

    const staleIssue = {
      _tag: "SessionJournalAttemptUnavailableV1Error",
      issue: { reason: "executionClaimUnavailable" },
    } as const;
    await expect(runFailure(current.store.openAttemptEffect({
      selector: selectorFromAnchor(current.anchor),
      executionClaim: current.executionClaim,
      snapshotToken: current.anchor.snapshotToken,
      schemaVersionId: current.schemaVersionId,
    }))).resolves.toMatchObject(staleIssue);
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 991),
    })).rejects.toMatchObject(staleIssue);
    await expect(runFailure(
      current.store.prepareSealEffect(current.attempt),
    )).resolves.toMatchObject(staleIssue);
  });

  it("preserves an unexpected replay evidence rejection as a defect after rollback", async () => {
    const current = await scenario("point_replay_evidence_defect");
    const request = Object.freeze({
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 103),
    } satisfies SessionJournalPointOperationV1);
    await runPointOperation(current.store, current.table, request);

    const defect = new Error("point replay evidence hashing unavailable");
    const nativeDigest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementationOnce(nativeDigest)
      .mockRejectedValueOnce(defect);
    try {
      const exit = await Effect.runPromiseExit(
        current.store.runPointOperationEffect(
          current.table,
          request,
          SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const reason = exit.cause.reasons[0];
        expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
        if (reason !== undefined && Cause.isDieReason(reason)) {
          expect(reason.defect).toBe(defect);
        }
      }
      await expect(
        journalCounts(current.anchor.sessionId),
      ).resolves.toMatchObject({ receipts: 1, points: 1 });
    } finally {
      digest.mockRestore();
    }
  });

  it("isolates exact-attempt callback failure state for every Effect execution", async () => {
    const current = await scenario("exact_attempt_effect_reuse");
    const transactionFailure = new Error("second transaction failed");
    let failBeforeWork = false;
    const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
      persistence,
      sharedLocator,
      {
        afterLoadLock: (step) => {
          if (failBeforeWork && step === "clockLocked") {
            throw transactionFailure;
          }
        },
      },
    );
    const located = await runEffect(
      resolveLocatedTrustedScopeAuthorityEffect(current.deploymentId, {
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error(
              "Shared exact-attempt resolution must not read receipts.",
            );
          },
        },
        scopeClockTargets: {
          resolve: async (): Promise<LocatedScopeClockReader> => target,
        },
      }),
    );
    expect(isLocatedExactRunningAttemptKernelV1(located.target)).toBe(true);
    if (!isLocatedExactRunningAttemptKernelV1(located.target)) {
      throw new Error("Expected the exact-attempt Effect capability.");
    }

    const callbackFailure = new Error("first callback failed");
    const reusable = located.target[
      RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
    ](
      {
        selector: {
          deploymentId: current.anchor.deploymentId,
          scopeId: current.anchor.scopeId,
          sessionId: current.anchor.sessionId,
          attemptFence: current.anchor.attemptFence,
        },
        executionClaim: current.executionClaim,
        preliminaryAuthority: located.authority,
      },
      () => Effect.fail(callbackFailure),
    );

    await expect(runFailure(reusable)).resolves.toBe(callbackFailure);
    failBeforeWork = true;
    const secondFailure = await runFailure(reusable);
    expect(secondFailure).toBeInstanceOf(ExactRunningAttemptTransactionV1Error);
    expect(secondFailure).toMatchObject({
      cause: transactionFailure,
      callbackCause: undefined,
    } satisfies Partial<ExactRunningAttemptTransactionV1Error>);
  });

  it("preserves a callback defect or interruption when transaction cleanup also fails", async () => {
    const callbackDefect = new Error("exact-attempt callback defect");
    const interruptorFiberId = 73;
    for (const callbackCause of [
      Cause.die(callbackDefect),
      Cause.interrupt(interruptorFiberId),
    ]) {
      const transactionFailure = new ExactRunningAttemptTransactionV1Error({
        cause: new Error("rollback failed"),
        callbackCause,
      });
      const exit = await Effect.runPromiseExit(
        reconcileExactRunningAttemptTransactionFailureV1(
          transactionFailure,
          callbackCause,
          new Error("rollback signal"),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error(
          "Expected the dual failure to preserve its Effect Cause.",
        );
      }
      expect(
        exit.cause.reasons.filter(Cause.isDieReason).map(
          (reason) => reason.defect,
        ),
      ).toContain(transactionFailure);
      if (Cause.hasDies(callbackCause)) {
        expect(
          exit.cause.reasons.filter(Cause.isDieReason).map(
            (reason) => reason.defect,
          ),
        ).toContain(callbackDefect);
      } else {
        expect(
          exit.cause.reasons.filter(Cause.isInterruptReason).map(
            (reason) => reason.fiberId,
          ),
        ).toContain(interruptorFiberId);
      }
    }
  });

  it("freshly rejects terminal and database-time-expired attempts before mutating journal state", async () => {
    const terminal = await scenario("late_terminal");
    await persistence.query(
      `
        update fx_system_tx_session
        set lifecycle = 'finishing'
        where session_id = $1
      `,
      [terminal.anchor.sessionId],
    );
    await expect(runFailure(terminal.store.runPointOperationEffect(
      terminal.table,
      {
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(terminal.tableId, 201),
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ))).resolves.toMatchObject({
      issue: { reason: "attemptNotRunning", lifecycle: "finishing" },
    } satisfies Partial<SessionJournalAttemptUnavailableV1Error>);
    expect(await journalRoot(terminal.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
    });

    const expired = await scenario("late_expired");
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = '2000-01-01T00:00:00.000Z'
        where session_id = $1
      `,
      [expired.anchor.sessionId],
    );
    await expect(runFailure(expired.store.runPointOperationEffect(
      expired.table,
      {
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(expired.tableId, 202),
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ))).resolves.toMatchObject({
      issue: { reason: "activeAttemptExpired" },
    } satisfies Partial<SessionJournalAttemptUnavailableV1Error>);
    expect(await journalCounts(expired.anchor.sessionId)).toMatchObject({
      receipts: 0,
      points: 0,
      events: 0,
    });
  });

  it("waits for the transaction Promise to settle after direct Effect interruption", async () => {
    const entered = deferredSignal();
    const release = deferredSignal();
    let pauseJournalRootLock = false;
    const current = await scenario("effect_interruption_settlement", {
      targetOptions: {
        afterLoadLock: async (step) => {
          if (step !== "attemptTailLocked" || !pauseJournalRootLock) return;
          pauseJournalRootLock = false;
          entered.resolve();
          await release.promise;
        },
      },
    });
    pauseJournalRootLock = true;
    const fiber = Effect.runFork(current.store.runPointOperationEffect(
      current.table,
      {
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(current.tableId, 203),
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ));

    await entered.promise;
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      release.resolve();
    }
    await interruption;
    expect(interruptionSettled).toBe(true);
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 1,
      points: 1,
    });
  });


});
