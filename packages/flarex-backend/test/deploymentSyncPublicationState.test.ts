import type {
  AcceptedQueryPublicationEvidence,
  PublicationAttempt,
} from "@flarex/query-sync/internal/kernel";
import {
  makeAcceptedQueryPublicationEvidenceForTesting,
} from "@flarex/query-sync/testing/conformance";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  DEPLOYMENT_QUERY_SYNC_PUBLICATION_CLOCK_SQL,
} from "../src/deploymentSync/PublicationClock";
import {
  DeploymentQuerySyncAdapterInvariantDefect,
} from "../src/deploymentSync/StateStorage";
import {
  applyCompletionBatch,
  captureCompletionBatch,
  completeEvaluation,
  makeCompletionEvidence,
} from "./deploymentSyncCompletionTestSupport";
import {
  beginEvaluation,
  completionInput,
  type EvaluationSqlInvocation,
  makeEvaluationSqlProbe,
  prepareEvaluationState,
  type PreparedEvaluationState,
  queryDescriptor,
  snapshotEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

type PublicationSqlStage = "read" | "write";

function classifyPublicationSql(
  invocation: EvaluationSqlInvocation,
): PublicationSqlStage {
  return invocation.isWrite ? "write" : "read";
}

function normalizeSql(query: string): string {
  return query.replace(/\s+/gu, " ").trim().toLowerCase();
}

function expectTypedFailure<A, E>(
  exit: Exit.Exit<A, E>,
  shape: Readonly<Record<string, unknown>>,
): E {
  if (!Exit.isFailure(exit)) throw new Error("Expected typed failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(error).toMatchObject(shape);
  return error;
}

function expectDefect<A, E>(exit: Exit.Exit<A, E>, expected: Error): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  expect(Cause.hasDies(exit.cause)).toBe(true);
  expect(success(Cause.findDefect(exit.cause))).toBe(expected);
}

async function installPendingPublication(
  prepared: PreparedEvaluationState,
  seed: number,
  label: string,
) {
  const evaluationAttempt = await beginEvaluation(
    prepared,
    queryDescriptor(seed),
  );
  const input = completionInput(prepared, evaluationAttempt, label);
  await expect(Effect.runPromise(prepared.state.completeQueryEvaluation(
    evaluationAttempt,
    input.evaluation,
    input.refresh,
    input.publication,
  ))).resolves.toMatchObject({ _tag: "completed" });
  return Object.freeze({ evaluationAttempt, input });
}

async function claimInstalledPublication(
  prepared: PreparedEvaluationState,
): Promise<PublicationAttempt> {
  const receipt = await Effect.runPromise(prepared.state.claimPublication());
  if (receipt._tag !== "claimed") {
    throw new Error(`Expected publication claim, received ${receipt._tag}.`);
  }
  return receipt.attempt;
}

function acceptanceFor(attempt: PublicationAttempt) {
  return makeAcceptedQueryPublicationEvidenceForTesting({
    identity: attempt.publication.identity,
    resultDigest: attempt.publication.resultDigest,
  });
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isNonArrayRecord(value)) throw new Error("Expected record evidence.");
  return value;
}

describe("deployment query-sync publication state", () => {
  it("claims, advances, completes, and replays one durable publication", async () => {
    let clockReads = 0;
    const expectedClockSql = normalizeSql(
      DEPLOYMENT_QUERY_SYNC_PUBLICATION_CLOCK_SQL,
    );
    const prepared = await prepareEvaluationState({
      beforeExecute: invocation => {
        if (normalizeSql(invocation.query) === expectedClockSql) {
          clockReads += 1;
        }
      },
    });
    try {
      const evaluationAttempt = await beginEvaluation(
        prepared,
        queryDescriptor(41),
      );
      const input = completionInput(
        prepared,
        evaluationAttempt,
        "publication",
      );
      await expect(Effect.runPromise(prepared.state.completeQueryEvaluation(
        evaluationAttempt,
        input.evaluation,
        input.refresh,
        input.publication,
      ))).resolves.toMatchObject({ _tag: "completed" });
      expect(clockReads).toBe(0);

      const claimed = await Effect.runPromise(
        prepared.state.claimPublication(),
      );
      expect(claimed._tag).toBe("claimed");
      if (claimed._tag !== "claimed") {
        throw new Error("Expected publication claim.");
      }
      expect(Object.isFrozen(claimed.attempt)).toBe(true);
      expect(clockReads).toBe(1);

      const afterClaim = snapshotEvaluationState(prepared.database);
      await expect(Effect.runPromise(
        prepared.state.completeQueryEvaluation(
          evaluationAttempt,
          input.evaluation,
          input.refresh,
          input.publication,
        ),
      )).resolves.toMatchObject({ _tag: "replayed" });
      expect(snapshotEvaluationState(prepared.database)).toEqual(afterClaim);
      expect(clockReads).toBe(1);

      const recorded = await Effect.runPromise(
        prepared.state.recordPublicationAttemptOutcome(
          claimed.attempt,
          "outcomeUnknown",
        ),
      );
      expect(recorded).toMatchObject({
        _tag: "recorded",
        attemptOrdinal: 1,
        nextAttemptOrdinal: 2,
        nextDisposition: "uncertain",
      });
      expect(clockReads).toBe(2);

      const replayedClaim = await Effect.runPromise(
        prepared.state.claimPublication(),
      );
      expect(replayedClaim).toMatchObject({
        _tag: "replayed",
        attempt: {
          attemptOrdinal: 2,
        },
      });
      expect(clockReads).toBe(3);

      const accepted = makeAcceptedQueryPublicationEvidenceForTesting({
        identity: claimed.attempt.publication.identity,
        resultDigest: claimed.attempt.publication.resultDigest,
      });
      await expect(Effect.runPromise(
        prepared.state.completePublication(accepted),
      )).resolves.toMatchObject({ _tag: "completed" });
      await expect(Effect.runPromise(
        prepared.state.completePublication(accepted),
      )).resolves.toMatchObject({ _tag: "replayed" });
      expect(clockReads).toBe(3);

      expect(prepared.database.prepare(
        "SELECT * FROM deployment_sync_in_flight_publication",
      ).all()).toEqual([]);
      expect(prepared.database.prepare(
        "SELECT * FROM deployment_sync_pending_publications",
      ).all()).toEqual([]);
      expect(prepared.database.prepare(`SELECT
        attempt_ordinal,
        attempt_disposition,
        latest_delivered_query_key,
        preceding_receipt_tag,
        preceding_next_attempt_ordinal,
        preceding_next_disposition
        FROM deployment_sync_publication_state`).get()).toMatchObject({
        attempt_ordinal: null,
        attempt_disposition: null,
        latest_delivered_query_key:
          claimed.attempt.publication.identity.queryKey,
        preceding_receipt_tag: "recorded",
        preceding_next_attempt_ordinal: 2,
        preceding_next_disposition: "uncertain",
      });
      expect(prepared.database.prepare(`SELECT
        pending_publication_count,
        in_flight_publication_count,
        retained_publication_content_bytes
        FROM deployment_sync_scope_state`).get()).toMatchObject({
        pending_publication_count: 0,
        in_flight_publication_count: 0,
        retained_publication_content_bytes: 0,
      });
    } finally {
      prepared.database.close();
    }
  });

  it("returns none without mutating empty publication state", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const before = snapshotEvaluationState(prepared.database);
      await expect(Effect.runPromise(
        prepared.state.claimPublication(),
      )).resolves.toEqual({ _tag: "none" });
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });

  it("authenticates nominal publication capabilities before field access or SQL", async () => {
    const probe = makeEvaluationSqlProbe(classifyPublicationSql);
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const before = snapshotEvaluationState(prepared.database);
      let attemptReads = 0;
      const rawAttempt = new Proxy({}, {
        get: () => {
          attemptReads += 1;
          throw new Error("Unauthenticated publication attempt field read.");
        },
      });
      probe.start();
      const attemptExit = await Effect.runPromiseExit(
        prepared.state.recordPublicationAttemptOutcome(
          // SAFETY: adversarial test input proves the nominal boundary is
          // authenticated before any property or storage access.
          rawAttempt as PublicationAttempt,
          "knownNotAppended",
        ),
      );
      expectTypedFailure(attemptExit, {
        _tag: "InvalidPublicationAttemptError",
        operation: "recordPublicationAttemptOutcome",
        reason: "notStateIssued",
      });
      expect(attemptReads).toBe(0);
      expect(probe.stop()).toEqual([]);

      let evidenceReads = 0;
      const rawEvidence = new Proxy({}, {
        get: () => {
          evidenceReads += 1;
          throw new Error("Unauthenticated acceptance evidence field read.");
        },
      });
      probe.start();
      const evidenceExit = await Effect.runPromiseExit(
        prepared.state.completePublication(
          // SAFETY: adversarial test input proves the nominal boundary is
          // authenticated before any property or storage access.
          rawEvidence as AcceptedQueryPublicationEvidence,
        ),
      );
      expectTypedFailure(evidenceExit, {
        _tag: "InvalidAcceptedPublicationEvidenceError",
        operation: "completePublication",
        reason: "notStateIssued",
      });
      expect(evidenceReads).toBe(0);
      expect(probe.stop()).toEqual([]);
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });

  it("persists terminal refusal, blocks later claims, and still accepts delivery evidence", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const evaluationAttempt = await beginEvaluation(
        prepared,
        queryDescriptor(43),
      );
      const input = completionInput(
        prepared,
        evaluationAttempt,
        "publication-terminal",
      );
      await Effect.runPromise(prepared.state.completeQueryEvaluation(
        evaluationAttempt,
        input.evaluation,
        input.refresh,
        input.publication,
      ));
      const claim = await Effect.runPromise(
        prepared.state.claimPublication(),
      );
      if (claim._tag !== "claimed") {
        throw new Error("Expected terminal fixture publication claim.");
      }

      await expect(Effect.runPromise(
        prepared.state.recordPublicationAttemptOutcome(
          claim.attempt,
          "terminalRefusal",
        ),
      )).resolves.toMatchObject({
        _tag: "blocked",
        reason: "terminalPublisherRefusal",
        resetRequired: true,
      });
      const blockedBeforeReplay = snapshotEvaluationState(prepared.database);
      await expect(Effect.runPromise(
        prepared.state.recordPublicationAttemptOutcome(
          claim.attempt,
          "terminalRefusal",
        ),
      )).resolves.toMatchObject({
        _tag: "blocked",
        reason: "terminalPublisherRefusal",
      });
      await expect(Effect.runPromise(
        prepared.state.claimPublication(),
      )).resolves.toMatchObject({
        _tag: "blocked",
        reason: "terminalPublisherRefusal",
      });
      expect(snapshotEvaluationState(prepared.database)).toEqual(
        blockedBeforeReplay,
      );

      const accepted = makeAcceptedQueryPublicationEvidenceForTesting({
        identity: claim.attempt.publication.identity,
        resultDigest: claim.attempt.publication.resultDigest,
      });
      await expect(Effect.runPromise(
        prepared.state.completePublication(accepted),
      )).resolves.toMatchObject({ _tag: "completed" });
    } finally {
      prepared.database.close();
    }
  });

  it("projects another query's global lifecycle slots as absent during completion", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const firstAttempt = await beginEvaluation(
        prepared,
        queryDescriptor(44),
      );
      const firstInput = completionInput(
        prepared,
        firstAttempt,
        "publication-owner",
      );
      await Effect.runPromise(prepared.state.completeQueryEvaluation(
        firstAttempt,
        firstInput.evaluation,
        firstInput.refresh,
        firstInput.publication,
      ));
      const firstClaim = await Effect.runPromise(
        prepared.state.claimPublication(),
      );
      if (firstClaim._tag !== "claimed") {
        throw new Error("Expected the first query publication claim.");
      }
      await Effect.runPromise(
        prepared.state.recordPublicationAttemptOutcome(
          firstClaim.attempt,
          "outcomeUnknown",
        ),
      );
      const ownerLifecycle = snapshotEvaluationState(prepared.database);

      const secondAttempt = await beginEvaluation(
        prepared,
        queryDescriptor(45),
      );
      const secondInput = completionInput(
        prepared,
        secondAttempt,
        "publication-unrelated",
      );
      await expect(Effect.runPromise(
        prepared.state.completeQueryEvaluation(
          secondAttempt,
          secondInput.evaluation,
          secondInput.refresh,
          secondInput.publication,
        ),
      )).resolves.toMatchObject({ _tag: "completed" });

      const afterSecond = snapshotEvaluationState(prepared.database);
      expect(afterSecond.inFlight).toEqual(ownerLifecycle.inFlight);
      expect(afterSecond.publicationState).toEqual(
        ownerLifecycle.publicationState,
      );
      expect(afterSecond.pending).toHaveLength(1);
      expect(afterSecond.pending[0]).toMatchObject({
        query_key: secondAttempt.descriptor.queryKey,
      });
    } finally {
      prepared.database.close();
    }
  });

  it("rolls back claim, outcome, and completion when the final scope write fails", async () => {
    const probe = makeEvaluationSqlProbe(classifyPublicationSql);
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const evaluationAttempt = await beginEvaluation(
        prepared,
        queryDescriptor(42),
      );
      const input = completionInput(
        prepared,
        evaluationAttempt,
        "publication-atomicity",
      );
      await Effect.runPromise(prepared.state.completeQueryEvaluation(
        evaluationAttempt,
        input.evaluation,
        input.refresh,
        input.publication,
      ));

      const beforeClaim = snapshotEvaluationState(prepared.database);
      const claimFault = new Error("claim final scope write fault");
      probe.start({ phase: "after", writeOrdinal: 4, cause: claimFault });
      const claimExit = await Effect.runPromiseExit(
        prepared.state.claimPublication(),
      );
      expectDefect(claimExit, claimFault);
      probe.stop();
      expect(snapshotEvaluationState(prepared.database)).toEqual(beforeClaim);
      const claim = await Effect.runPromise(
        prepared.state.claimPublication(),
      );
      if (claim._tag !== "claimed") {
        throw new Error("Expected retry to claim the pending publication.");
      }

      const beforeOutcome = snapshotEvaluationState(prepared.database);
      const outcomeFault = new Error("outcome final scope write fault");
      probe.start({ phase: "after", writeOrdinal: 2, cause: outcomeFault });
      const outcomeExit = await Effect.runPromiseExit(
        prepared.state.recordPublicationAttemptOutcome(
          claim.attempt,
          "outcomeUnknown",
        ),
      );
      expectDefect(outcomeExit, outcomeFault);
      probe.stop();
      expect(snapshotEvaluationState(prepared.database)).toEqual(beforeOutcome);
      await expect(Effect.runPromise(
        prepared.state.recordPublicationAttemptOutcome(
          claim.attempt,
          "outcomeUnknown",
        ),
      )).resolves.toMatchObject({ _tag: "recorded" });

      const accepted = makeAcceptedQueryPublicationEvidenceForTesting({
        identity: claim.attempt.publication.identity,
        resultDigest: claim.attempt.publication.resultDigest,
      });
      const beforeCompletion = snapshotEvaluationState(prepared.database);
      const completionFault = new Error("completion final scope write fault");
      probe.start({
        phase: "after",
        writeOrdinal: 3,
        cause: completionFault,
      });
      const completionExit = await Effect.runPromiseExit(
        prepared.state.completePublication(accepted),
      );
      expectDefect(completionExit, completionFault);
      probe.stop();
      expect(snapshotEvaluationState(prepared.database)).toEqual(
        beforeCompletion,
      );
      await expect(Effect.runPromise(
        prepared.state.completePublication(accepted),
      )).resolves.toMatchObject({ _tag: "completed" });
      await expect(Effect.runPromise(
        prepared.state.completePublication(accepted),
      )).resolves.toMatchObject({ _tag: "replayed" });
    } finally {
      prepared.database.close();
    }
  });

  it("retains bounded historical outcome and completion windows without writes", async () => {
    const probe = makeEvaluationSqlProbe(classifyPublicationSql);
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      await installPendingPublication(prepared, 46, "publication-history-a");
      const firstAttempt = await claimInstalledPublication(prepared);
      const firstEvidence = acceptanceFor(firstAttempt);
      await expect(Effect.runPromise(
        prepared.state.completePublication(firstEvidence),
      )).resolves.toMatchObject({ _tag: "completed" });

      const beforeSupersededOutcome = snapshotEvaluationState(
        prepared.database,
      );
      probe.start();
      await expect(Effect.runPromise(
        prepared.state.recordPublicationAttemptOutcome(
          firstAttempt,
          "knownNotAppended",
        ),
      )).resolves.toMatchObject({
        _tag: "superseded",
        identity: firstAttempt.publication.identity,
        attemptOrdinal: 1,
      });
      expect(probe.stop()).not.toContain("write");
      expect(snapshotEvaluationState(prepared.database)).toEqual(
        beforeSupersededOutcome,
      );

      await installPendingPublication(prepared, 47, "publication-history-b");
      const secondAttempt = await claimInstalledPublication(prepared);
      await expect(Effect.runPromise(
        prepared.state.completePublication(acceptanceFor(secondAttempt)),
      )).resolves.toMatchObject({ _tag: "completed" });
      const beforeExpiredEvidence = snapshotEvaluationState(prepared.database);

      probe.start();
      await expect(Effect.runPromise(
        prepared.state.completePublication(firstEvidence),
      )).resolves.toMatchObject({
        _tag: "superseded",
        identity: firstAttempt.publication.identity,
      });
      expect(probe.stop()).not.toContain("write");
      expect(snapshotEvaluationState(prepared.database)).toEqual(
        beforeExpiredEvidence,
      );

      probe.start();
      await expect(Effect.runPromise(
        prepared.state.recordPublicationAttemptOutcome(
          firstAttempt,
          "knownNotAppended",
        ),
      )).resolves.toMatchObject({
        _tag: "recoveryEvidenceExpired",
        identity: firstAttempt.publication.identity,
        attemptOrdinal: 1,
      });
      expect(probe.stop()).not.toContain("write");
      expect(snapshotEvaluationState(prepared.database)).toEqual(
        beforeExpiredEvidence,
      );
    } finally {
      prepared.database.close();
    }
  });

  it("rejects a conflicting retained outcome replay without writes", async () => {
    const probe = makeEvaluationSqlProbe(classifyPublicationSql);
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      await installPendingPublication(prepared, 48, "publication-conflict");
      const attempt = await claimInstalledPublication(prepared);
      await expect(Effect.runPromise(
        prepared.state.recordPublicationAttemptOutcome(
          attempt,
          "knownNotAppended",
        ),
      )).resolves.toMatchObject({
        _tag: "recorded",
        attemptOrdinal: 1,
        nextAttemptOrdinal: 2,
        nextDisposition: "ready",
      });
      const before = snapshotEvaluationState(prepared.database);

      probe.start();
      const exit = await Effect.runPromiseExit(
        prepared.state.recordPublicationAttemptOutcome(
          attempt,
          "outcomeUnknown",
        ),
      );
      expectTypedFailure(exit, {
        _tag: "InvalidPublicationAttemptOutcomeReplayError",
        operation: "recordPublicationAttemptOutcome",
        reason: "outcomeMismatch",
        queryKey: attempt.publication.identity.queryKey,
        generation: attempt.publication.identity.generation,
        ordinal: 1,
      });
      expect(probe.stop()).not.toContain("write");
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });

  it("serializes competing claims as one claim and one exact replay", async () => {
    const prepared = await prepareEvaluationState();
    try {
      await installPendingPublication(prepared, 49, "publication-claims");
      const receipts = await Effect.runPromise(Effect.all([
        prepared.state.claimPublication(),
        prepared.state.claimPublication(),
      ], { concurrency: "unbounded" }));
      expect(receipts.map(receipt => receipt._tag).toSorted()).toEqual([
        "claimed",
        "replayed",
      ]);
      const attempts = receipts.flatMap(receipt =>
        receipt._tag === "claimed" || receipt._tag === "replayed"
          ? [receipt.attempt]
          : []
      );
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);

      const snapshot = snapshotEvaluationState(prepared.database);
      expect(snapshot.pending).toEqual([]);
      expect(snapshot.inFlight).toHaveLength(1);
      expect(snapshot.scope[0]).toMatchObject({
        pending_publication_count: 0,
        in_flight_publication_count: 1,
      });
    } finally {
      prepared.database.close();
    }
  });

  it.each(["outcomeFirst", "completionFirst"] as const)(
    "serializes publication outcome and completion in %s order",
    async order => {
      const prepared = await prepareEvaluationState();
      try {
        await installPendingPublication(
          prepared,
          order === "outcomeFirst" ? 50 : 51,
          `publication-${order}`,
        );
        const attempt = await claimInstalledPublication(prepared);
        const evidence = acceptanceFor(attempt);

        if (order === "outcomeFirst") {
          await expect(Effect.runPromise(
            prepared.state.recordPublicationAttemptOutcome(
              attempt,
              "knownNotAppended",
            ),
          )).resolves.toMatchObject({
            _tag: "recorded",
            nextAttemptOrdinal: 2,
            nextDisposition: "ready",
          });
          await expect(Effect.runPromise(
            prepared.state.completePublication(evidence),
          )).resolves.toMatchObject({ _tag: "completed" });
        } else {
          await expect(Effect.runPromise(
            prepared.state.completePublication(evidence),
          )).resolves.toMatchObject({ _tag: "completed" });
          await expect(Effect.runPromise(
            prepared.state.recordPublicationAttemptOutcome(
              attempt,
              "knownNotAppended",
            ),
          )).resolves.toMatchObject({ _tag: "superseded" });
        }

        const snapshot = snapshotEvaluationState(prepared.database);
        expect(snapshot.pending).toEqual([]);
        expect(snapshot.inFlight).toEqual([]);
        expect(snapshot.publicationState[0]).toMatchObject({
          latest_delivered_query_key: attempt.publication.identity.queryKey,
          preceding_receipt_tag: order === "outcomeFirst"
            ? "recorded"
            : null,
          preceding_next_attempt_ordinal: order === "outcomeFirst" ? 2 : null,
          preceding_next_disposition: order === "outcomeFirst"
            ? "ready"
            : null,
        });
      } finally {
        prepared.database.close();
      }
    },
  );

  it("rolls back an in-flight delete when publication-state CAS refuses", async () => {
    const probe = makeEvaluationSqlProbe(classifyPublicationSql);
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      await installPendingPublication(prepared, 52, "publication-cas");
      const attempt = await claimInstalledPublication(prepared);
      const evidence = acceptanceFor(attempt);
      const before = snapshotEvaluationState(prepared.database);

      probe.startAffectedRowRefusal(2, "skip");
      const exit = await Effect.runPromiseExit(
        prepared.state.completePublication(evidence),
      );
      if (!Exit.isFailure(exit)) throw new Error("Expected CAS defect.");
      expect(Cause.hasDies(exit.cause)).toBe(true);
      const defect = success(Cause.findDefect(exit.cause));
      expect(defect).toBeInstanceOf(DeploymentQuerySyncAdapterInvariantDefect);
      expect(defect).toMatchObject({
        operation: "completePublication",
        stage: "publication-state-cas",
      });
      probe.stop();
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);

      await expect(Effect.runPromise(
        prepared.state.completePublication(evidence),
      )).resolves.toMatchObject({ _tag: "completed" });
    } finally {
      prepared.database.close();
    }
  });

  it("completes an older in-flight generation without removing newer pending work", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const descriptor = queryDescriptor(53);
      const firstEvaluation = await beginEvaluation(prepared, descriptor);
      await completeEvaluation(
        prepared,
        firstEvaluation,
        makeCompletionEvidence(prepared, firstEvaluation, {
          dependencyLabels: ["publication-newer"],
          resultSeed: 201,
          publicationLabel: "publication-generation-1",
        }),
      );
      const firstPublicationAttempt = await claimInstalledPublication(prepared);

      const batch = captureCompletionBatch(
        prepared.binding,
        12n,
        ["publication-newer"],
      );
      await applyCompletionBatch(prepared, batch);
      const secondEvaluation = await beginEvaluation(prepared, descriptor, {
        expectedActiveGeneration: firstEvaluation.generation,
        requestedDirtyThroughSequence: batch.sourceSequence,
      });
      await completeEvaluation(
        prepared,
        secondEvaluation,
        makeCompletionEvidence(prepared, secondEvaluation, {
          dependencyLabels: ["publication-newer"],
          resultSeed: 202,
          publicationLabel: "publication-generation-2",
        }),
      );

      const before = snapshotEvaluationState(prepared.database);
      expect(before.inFlight[0]).toMatchObject({ generation: "1" });
      expect(before.pending[0]).toMatchObject({ generation: "2" });
      await expect(Effect.runPromise(prepared.state.completePublication(
        acceptanceFor(firstPublicationAttempt),
      ))).resolves.toMatchObject({
        _tag: "completed",
        identity: firstPublicationAttempt.publication.identity,
      });

      const after = snapshotEvaluationState(prepared.database);
      expect(after.inFlight).toEqual([]);
      expect(after.pending).toEqual(before.pending);
      expect(after.publicationState[0]).toMatchObject({
        latest_delivered_generation: "1",
      });
      expect(after.scope[0]).toMatchObject({
        pending_publication_count: 1,
        in_flight_publication_count: 0,
      });
    } finally {
      prepared.database.close();
    }
  });

  it("omits retained publication payloads from lifecycle corruption evidence", async () => {
    const prepared = await prepareEvaluationState();
    try {
      await installPendingPublication(
        prepared,
        54,
        "sensitive-publication-content",
      );
      await claimInstalledPublication(prepared);
      prepared.database.exec(`UPDATE deployment_sync_scope_state
        SET retained_publication_content_bytes = 0`);

      const exit = await Effect.runPromiseExit(
        prepared.state.claimPublication(),
      );
      const error = requireRecord(expectTypedFailure(exit, {
        _tag: "QuerySyncStoredStateCorruptError",
        operation: "claimPublication",
        reason: "storedAggregateInvalid",
      }));
      const issue = requireRecord(error.cause);
      const evidence = requireRecord(issue.evidence);
      const inFlight = requireRecord(evidence.inFlight);
      expect(inFlight).not.toHaveProperty("content");
      expect(inFlight).not.toHaveProperty("queryIdentity");
      expect(inFlight.contentBytes).toBeGreaterThan(0);
      expect(inFlight.queryIdentityBytes).toBeGreaterThan(0);
    } finally {
      prepared.database.close();
    }
  });
});
