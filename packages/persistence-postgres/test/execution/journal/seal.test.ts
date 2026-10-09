import {
  canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import { makeGrantRetentionPolicyV1Result } from "flarex-protocol/grant-retention-policy";
import { expect, it, afterAll, beforeAll, describe } from "vitest";
import { Effect, Fiber, Result } from "effect";
import { eq } from "drizzle-orm";
import { fxSystemTransactionJournals } from "../../../src/database/schema";
import {
  createPointMutationExecutionClaimLivenessV1,
} from "../../../src/execution/claims/transactionExecutionClaimLiveness";
import {
  SessionJournalLeasePromotionV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalSealV1Error,
  SessionJournalStorageCorruptionV1Error,
} from "../../../src/execution/journal/api";
import { verifyJournalSealSequence } from "./journalEvidenceScenario";
import type {
  PointMutationSessionAnchorV1,
} from "../../../src/execution/transactionSessionActivation";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "../../support/effectTestRuntime";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "../transactionSessionActivationTestSupport";
import {
  selectorFromAnchor,
  syscallSequence,
  documentId,
  requireInsertedDocumentId,
  uuidSequence,
  deferredSignal,
  delay,
} from "./journalTestSupport";
import {
  createSessionJournalStorePGliteFixture,
  type SessionJournalStorePGliteFixture,
} from "./journalFixture";

interface AttemptLeaseAndSealState extends Record<string, unknown> {
  readonly root_state: string;
  readonly lease_expires_at: Date;
  readonly authorization_grant_expires_at: Date;
  readonly hard_expires_at: Date;
}

interface AttemptLeaseAndClaimState extends Record<string, unknown> {
  readonly lease_expires_at: Date;
  readonly claim_owner: string;
  readonly claim_fence: string;
  readonly claimed_at: Date;
  readonly claim_expires_at: Date;
}

describe("Journal sealing (PGlite)", () => {
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

  it("refuses durable seal preparation after claim expiry", async () => {
    const current = await scenario("finite_seal_claim_expiry", { executionProfile: "durableOperations" });
    expect(await runPointOperation(current.store, current.table, {
      kind: "insert", syscallSequence: syscallSequence(1n), fields: { name: "tentative" },
    })).toMatchObject({ kind: "completed", delivery: "executed" });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({ receipts: 1, points: 1 });
    await persistence.query(
      `update fx_system_tx_execution_claim
       set claimed_at = clock_timestamp() - interval '2 minutes',
           claim_expires_at = clock_timestamp() - interval '1 minute'
       where session_id = $1`, [current.anchor.sessionId]);
    await expect(prepareSeal(current.store, current.attempt)).rejects.toMatchObject({
      _tag: "SessionJournalAttemptUnavailableV1Error",
      issue: { reason: "executionClaimUnavailable" },
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({ receipts: 1, points: 1, events: 1 });
  });

  it("binds seal replay to the surviving root sequence", async () => {
    await verifyJournalSealSequence(persistence, await scenario("surviving_root_sequence"));
  });

  it("seals in two phases, rejects stale candidates, and exactly replays stored evidence", async () => {
    const current = await scenario("two_phase_seal", {
      randomUuid: uuidSequence(
        "87000000-0000-4000-8000-000000000001",
      ),
    });
    const inserted = await runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "seal" },
    });
    const documentId = requireInsertedDocumentId(inserted);
    const stale = await prepareSeal(current.store, current.attempt);
    const staleJournal = await runEffect(
      canonicalizeSessionJournalEffect(stale.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );

    await runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(2n),
      documentId,
    });
    await expect(runFailure(current.store.completeSealEffect(
      stale.preparation,
      staleJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      reason: "stalePreparation",
    } satisfies Partial<SessionJournalSealV1Error>);

    const callerMutablePreparation = await prepareSeal(current.store,
      current.attempt,
    );
    const callerVisibleWrite = callerMutablePreparation.journal.writes[0];
    if (callerVisibleWrite?.kind !== "insert") {
      throw new Error("Expected the inserted write in the prepared journal.");
    }
    Reflect.set(callerVisibleWrite.fieldsValueJson, "name", "caller-mutated");
    const callerMutatedJournal = await runEffect(
      canonicalizeSessionJournalEffect(callerMutablePreparation.journal),
    );
    await expect(completeSeal(current.store,
      callerMutablePreparation.preparation,
      callerMutatedJournal,
      successfulResult,
    )).rejects.toMatchObject({
      reason: "canonicalJournalMismatch",
    } satisfies Partial<SessionJournalSealV1Error>);

    const malformedJournalPreparation = await prepareSeal(current.store,
      current.attempt,
    );
    const malformedJournal = structuredClone(await runEffect(
      canonicalizeSessionJournalEffect(malformedJournalPreparation.journal),
    ));
    Reflect.set(malformedJournal.journal, "format", "invalid");
    await expect(completeSeal(current.store,
      malformedJournalPreparation.preparation,
      malformedJournal,
      successfulResult,
    )).rejects.toMatchObject({
      reason: "canonicalJournalMismatch",
    } satisfies Partial<SessionJournalSealV1Error>);

    const malformedResultPreparation = await prepareSeal(current.store,
      current.attempt,
    );
    const journalForMalformedResult = await runEffect(
      canonicalizeSessionJournalEffect(
        malformedResultPreparation.journal,
      ),
    );
    const malformedResult = structuredClone(successfulResult);
    Reflect.set(malformedResult.evidence, "unexpected", true);
    await expect(completeSeal(current.store,
      malformedResultPreparation.preparation,
      journalForMalformedResult,
      malformedResult,
    )).rejects.toMatchObject({
      reason: "canonicalResultMismatch",
    } satisfies Partial<SessionJournalSealV1Error>);

    const malformedResultValuePreparation = await prepareSeal(current.store,
      current.attempt,
    );
    const journalForMalformedResultValue = await runEffect(
      canonicalizeSessionJournalEffect(
        malformedResultValuePreparation.journal,
      ),
    );
    const malformedResultValue = structuredClone(successfulResult);
    Reflect.set(malformedResultValue, "valueJson", undefined);
    await expect(completeSeal(current.store,
      malformedResultValuePreparation.preparation,
      journalForMalformedResultValue,
      malformedResultValue,
    )).rejects.toMatchObject({
      reason: "canonicalResultMismatch",
    } satisfies Partial<SessionJournalSealV1Error>);

    const prepared = await prepareSeal(current.store, current.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalEffect(prepared.journal),
    );
    const mutableSuccessfulResult = structuredClone(successfulResult);
    const envelopePromise = completeSeal(current.store,
      prepared.preparation,
      canonicalJournal,
      mutableSuccessfulResult,
    );
    Reflect.set(
      mutableSuccessfulResult.evidence,
      "sha256Hex",
      "0".repeat(64),
    );
    const envelope = await envelopePromise;
    expect(envelope).toMatchObject({
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence,
      finalSyscallSequence: 2n,
      journal: { kind: "storedForSessionAttempt" },
      journalSha256Hex: canonicalJournal.sha256Hex,
      successfulResult: successfulResult.evidence,
    });
    const sealedState = await attemptLeaseAndSealState(
      current.anchor.sessionId,
    );
    expect(sealedState.root_state).toBe("sealed");
    expect(sealedState.lease_expires_at.getTime()).toBe(Math.min(
      sealedState.authorization_grant_expires_at.getTime(),
      sealedState.hard_expires_at.getTime(),
    ));
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(3n),
      documentId,
    })).resolves.toEqual({
      kind: "stateRejected",
      issue: { reason: "journalSealed" },
    });

    const replayPreparation = await prepareSeal(current.store, current.attempt);
    const replayJournal = await runEffect(
      canonicalizeSessionJournalEffect(replayPreparation.journal),
    );
    await expect(completeSeal(current.store,
      replayPreparation.preparation,
      replayJournal,
      successfulResult,
    )).resolves.toEqual(envelope);
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "sealed",
      last_syscall_sequence: "2",
    });

    const mismatchedReplay = await prepareSeal(current.store, current.attempt);
    const mismatchedJournal = await runEffect(
      canonicalizeSessionJournalEffect(mismatchedReplay.journal),
    );
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = lease_expires_at - interval '1 second'
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );
    await expect(runFailure(current.store.completeSealEffect(
      mismatchedReplay.preparation,
      mismatchedJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      reason: "snapshotLeaseInvalid",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);

    const expiredMismatchReplay = mismatchedReplay;
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = clock_timestamp() - interval '1 second'
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );
    await expect(runFailure(current.store.completeSealEffect(
      expiredMismatchReplay.preparation,
      mismatchedJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      reason: "snapshotLeaseInvalid",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);
  });

  it("renews only the execution claim after the sealed lease identity freezes", async () => {
    const current = await scenario("sealed_claim_liveness");
    const prepared = await prepareSeal(current.store, current.attempt);
    await completeSeal(
      current.store,
      prepared.preparation,
      await runEffect(canonicalizeSessionJournalEffect(prepared.journal)),
      await runEffect(canonicalizeSuccessfulResultV1Effect({ ok: true })),
    );
    const before = await attemptLeaseAndClaimState(
      current.anchor.sessionId,
    );
    const liveness = createPointMutationExecutionClaimLivenessV1(
      resolutionPorts(persistence),
      {
        claimDurationMilliseconds: 120_000,
        leaseRenewalDurationMilliseconds: 180_000,
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      },
    );

    const renewed = await runEffect(liveness.renewEffect({
      selector: selectorFromAnchor(current.anchor),
      executionClaim: current.executionClaim,
    }));
    const after = await attemptLeaseAndClaimState(current.anchor.sessionId);

    expect(renewed).toMatchObject({ kind: "renewed", phase: "sealed" });
    expect(after.lease_expires_at).toEqual(before.lease_expires_at);
    expect(after.claim_expires_at.getTime()).toBeGreaterThanOrEqual(
      before.claim_expires_at.getTime(),
    );
    expect(after).toMatchObject({
      claim_owner: before.claim_owner,
      claim_fence: before.claim_fence,
      claimed_at: before.claimed_at,
    });
  });

  it("retains seal preparation after transaction infrastructure failure and retries", async () => {
    const transactionFailure = new Error("seal transaction unavailable");
    let failCompletion = false;
    const current = await scenario("seal_transaction_retry", {
      targetOptions: {
        afterLoadLock: (step) => {
          if (failCompletion && step === "attemptTailLocked") {
            failCompletion = false;
            throw transactionFailure;
          }
        },
      },
    });
    await runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 205),
    });
    const prepared = await prepareSeal(current.store, current.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalEffect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );

    failCompletion = true;
    await expect(runFailure(current.store.completeSealEffect(
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      operation: "completeSealTransaction",
      cause: transactionFailure,
    } satisfies Partial<SessionJournalPersistenceV1Error>);
    await expect(journalRoot(current.anchor.sessionId)).resolves.toMatchObject({
      state: "open",
      last_syscall_sequence: "1",
    });

    await expect(runEffect(current.store.completeSealEffect(
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      sessionId: current.anchor.sessionId,
      finalSyscallSequence: 1n,
    });
    await expect(journalRoot(current.anchor.sessionId)).resolves.toMatchObject({
      state: "sealed",
      last_syscall_sequence: "1",
    });
  });

  it("rejects a database-time retention overrun without promoting or sealing", async () => {
    const oneMillisecondPolicy = Result.getOrThrow(
      makeGrantRetentionPolicyV1Result({
        maximumGrantLifetimeMilliseconds: 1,
        maximumFutureIssuedAtSkewMilliseconds: 0,
        maximumLiveSnapshotRetentionMilliseconds: 1,
      }),
    );
    const current = await scenario("seal_retention_bound", {
      grantRetentionPolicy: oneMillisecondPolicy,
    });
    const prepared = await prepareSeal(current.store, current.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalEffect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    const before = await attemptLeaseAndSealState(current.anchor.sessionId);

    await expect(runFailure(current.store.completeSealEffect(
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      issue: {
        kind: "retentionBudgetExceeded",
        remainingMilliseconds: expect.any(Number),
        maximumLiveSnapshotRetentionMilliseconds: 1,
      },
    } satisfies Partial<SessionJournalLeasePromotionV1Error>);
    const after = await attemptLeaseAndSealState(current.anchor.sessionId);
    expect(after.root_state).toBe("open");
    expect(after.lease_expires_at.getTime()).toBe(
      before.lease_expires_at.getTime(),
    );
  });

  it("rolls back a lease RETURNING mismatch before attempting the journal write", async () => {
    const current = await scenario("seal_lease_return_correlation");
    const prepared = await prepareSeal(current.store, current.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalEffect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    const before = await attemptLeaseAndSealState(current.anchor.sessionId);
    const counts = await journalCounts(current.anchor.sessionId);
    await persistence.query(`
        create function fx_test_short_promoted_lease()
        returns trigger language plpgsql as $lease$
        begin
          new.lease_expires_at := new.lease_expires_at - interval '1 second';
          return new;
        end;
        $lease$
      `);
    await persistence.query(`
        create trigger fx_test_short_promoted_lease_trigger
        before update on fx_system_snapshot_lease
        for each row execute function fx_test_short_promoted_lease()
      `);
    await installRejectSealTrigger("before");
    try {
      // A journal write would fail through the driver mapper. The correlated
      // lease refusal must win first and roll back its already executed UPDATE.
      const failure = await runFailure(
        current.store.completeSealEffect(
          prepared.preparation,
          canonicalJournal,
          successfulResult,
        ),
      );
      expect(failure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
      expect(failure).toMatchObject({ reason: "snapshotLeaseInvalid" });
      expect(await attemptLeaseAndSealState(current.anchor.sessionId)).toEqual(
        before,
      );
      expect(await journalCounts(current.anchor.sessionId)).toEqual(counts);
      expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
        state: "open",
      });
      expect(
        await persistence.drizzle
          .select({
            journalBytes: fxSystemTransactionJournals.sealedJournalBytes,
            resultBytes: fxSystemTransactionJournals.sealedResultBytes,
          })
          .from(fxSystemTransactionJournals)
          .where(
            eq(fxSystemTransactionJournals.sessionId, current.anchor.sessionId),
          ),
      ).toEqual([{ journalBytes: null, resultBytes: null }]);
    } finally {
      await removeRejectSealTrigger("before");
      await persistence.query(
        "drop trigger fx_test_short_promoted_lease_trigger on fx_system_snapshot_lease",
      );
      await persistence.query("drop function fx_test_short_promoted_lease()");
    }
    await expect(
      runEffect(
        current.store.completeSealEffect(
          prepared.preparation,
          canonicalJournal,
          successfulResult,
        ),
      ),
    ).resolves.toMatchObject({ sessionId: current.anchor.sessionId });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "sealed",
    });
  });

  it("rolls lease promotion back when sealing fails before or after the root write", async () => {
    for (const phase of ["before", "after"] as const) {
      const current = await scenario(`seal_atomic_rollback_${phase}`);
      const prepared = await prepareSeal(current.store, current.attempt);
      const canonicalJournal = await runEffect(
        canonicalizeSessionJournalEffect(prepared.journal),
      );
      const successfulResult = await runEffect(
        canonicalizeSuccessfulResultV1Effect({ phase }),
      );
      const before = await attemptLeaseAndSealState(current.anchor.sessionId);

      await installRejectSealTrigger(phase);
      try {
        await expect(runFailure(current.store.completeSealEffect(
          prepared.preparation,
          canonicalJournal,
          successfulResult,
        ))).resolves.toMatchObject({
          operation: "completeSealTransaction",
        } satisfies Partial<SessionJournalPersistenceV1Error>);
      } finally {
        await removeRejectSealTrigger(phase);
      }

      const rolledBack = await attemptLeaseAndSealState(
        current.anchor.sessionId,
      );
      expect(rolledBack.root_state).toBe("open");
      expect(rolledBack.lease_expires_at.getTime()).toBe(
        before.lease_expires_at.getTime(),
      );

      await expect(runEffect(current.store.completeSealEffect(
        prepared.preparation,
        canonicalJournal,
        successfulResult,
      ))).resolves.toMatchObject({ sessionId: current.anchor.sessionId });
      const sealed = await attemptLeaseAndSealState(current.anchor.sessionId);
      expect(sealed.root_state).toBe("sealed");
      expect(sealed.lease_expires_at.getTime()).toBe(Math.min(
        sealed.authorization_grant_expires_at.getTime(),
        sealed.hard_expires_at.getTime(),
      ));
    }
  });

  it("waits for seal completion to settle after direct Effect interruption", async () => {
    const entered = deferredSignal();
    const release = deferredSignal();
    let pauseCompletion = false;
    const current = await scenario("seal_effect_interruption_settlement", {
      targetOptions: {
        afterLoadLock: async (step) => {
          if (step !== "attemptTailLocked" || !pauseCompletion) return;
          pauseCompletion = false;
          entered.resolve();
          await release.promise;
        },
      },
    });
    await runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 204),
    });
    const prepared = await prepareSeal(current.store, current.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalEffect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    pauseCompletion = true;
    const fiber = Effect.runFork(current.store.completeSealEffect(
      prepared.preparation,
      canonicalJournal,
      successfulResult,
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
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "sealed",
      last_syscall_sequence: "1",
    });
    const settled = await attemptLeaseAndSealState(current.anchor.sessionId);
    expect(settled.lease_expires_at.getTime()).toBe(Math.min(
      settled.authorization_grant_expires_at.getTime(),
      settled.hard_expires_at.getTime(),
    ));
  });

  async function attemptLeaseAndSealState(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<AttemptLeaseAndSealState> {
    const result = await persistence.query<AttemptLeaseAndSealState>(
      `
        select root.state as root_state,
               lease.lease_expires_at,
               session.authorization_grant_expires_at,
               session.hard_expires_at
        from fx_system_tx_session session
        join fx_system_snapshot_lease lease
          on lease.scope_uuid = session.scope_uuid
         and lease.session_id = session.session_id
         and lease.attempt_fence = session.attempt_fence
        join fx_system_tx_journal root
          on root.scope_uuid = session.scope_uuid
         and root.session_id = session.session_id
         and root.attempt_fence = session.attempt_fence
        where session.session_id = $1
      `,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined || result.rows.length !== 1) {
      throw new Error("Expected one exact-attempt lease/seal state row.");
    }
    return row;
  }

  async function attemptLeaseAndClaimState(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<AttemptLeaseAndClaimState> {
    const result = await persistence.query<AttemptLeaseAndClaimState>(
      `select lease.lease_expires_at,
              claim.claim_owner,
              claim.claim_fence::text,
              claim.claimed_at,
              claim.claim_expires_at
       from fx_system_snapshot_lease lease
       join fx_system_tx_execution_claim claim
         on claim.scope_uuid = lease.scope_uuid
        and claim.session_id = lease.session_id
        and claim.attempt_fence = lease.attempt_fence
       where lease.session_id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined || result.rows.length !== 1) {
      throw new Error("Expected one exact-attempt lease/claim state row.");
    }
    return row;
  }

  async function installRejectSealTrigger(
    phase: "before" | "after",
  ): Promise<void> {
    const functionName = `fx_test_reject_seal_${phase}`;
    const triggerName = `fx_test_reject_seal_${phase}_trigger`;
    await persistence.query(
      `
        create or replace function ${functionName}()
        returns trigger
        language plpgsql
        as $$
        begin
          if old.state = 'open' and new.state = 'sealed' then
            raise exception 'reject seal ${phase}';
          end if;
          return new;
        end;
        $$
      `,
    );
    await persistence.query(
      `
        create trigger ${triggerName}
        ${phase} update on fx_system_tx_journal
        for each row execute function ${functionName}()
      `,
    );
  }

  async function removeRejectSealTrigger(
    phase: "before" | "after",
  ): Promise<void> {
    const functionName = `fx_test_reject_seal_${phase}`;
    const triggerName = `fx_test_reject_seal_${phase}_trigger`;
    await persistence.query(
      `drop trigger if exists ${triggerName} on fx_system_tx_journal`,
    );
    await persistence.query(`drop function if exists ${functionName}()`);
  }
});
