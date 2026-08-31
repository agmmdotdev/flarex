import {
  MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS,
  MAX_PUBLICATION_ATTEMPT_ORDINAL,
  capturePublicationAttemptInstant,
  type PublicationAttemptInstant,
} from "@flarex/query-sync/internal/kernel";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  prepareEvaluationState,
  snapshotEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";
import {
  COMPLETION_READ_STAGES,
  EMPTY_CLAIM_READ_STAGES,
  IN_FLIGHT_CLAIM_READ_STAGES,
  OUTCOME_READ_STAGES,
  acceptanceFor,
  claimInstalledPublication,
  installPendingPublication,
  makeDeterministicPublicationOperations,
  makePublicationSqlProbe,
} from "./deploymentSyncPublicationTestSupport";

function instant(value: number): PublicationAttemptInstant {
  return success(capturePublicationAttemptInstant(value));
}

describe("deployment query-sync publication boundaries", () => {
  it("persists ordinal 128 and blocks its outcome at the exact attempt limit", async () => {
    const prepared = await prepareEvaluationState();
    try {
      await installPendingPublication(
        prepared,
        60,
        "publication-ordinal-limit",
      );
      const deterministic = makeDeterministicPublicationOperations(
        prepared,
        Array.from({ length: 256 }, () => instant(1_000)),
      );
      let attempt = await claimInstalledPublication(
        prepared,
        deterministic.operations,
      );

      for (
        let ordinal = 1;
        ordinal < MAX_PUBLICATION_ATTEMPT_ORDINAL;
        ordinal += 1
      ) {
        expect(attempt.attemptOrdinal).toBe(ordinal);
        await expect(Effect.runPromise(
          deterministic.operations.recordPublicationAttemptOutcome(
            attempt,
            "knownNotAppended",
          ),
        )).resolves.toMatchObject({
          _tag: "recorded",
          attemptOrdinal: ordinal,
          nextAttemptOrdinal: ordinal + 1,
          nextDisposition: "ready",
        });
        const replay = await Effect.runPromise(
          deterministic.operations.claimPublication(),
        );
        expect(replay).toMatchObject({
          _tag: "replayed",
          attempt: { attemptOrdinal: ordinal + 1 },
        });
        if (replay._tag !== "replayed") {
          throw new Error("Expected an ordinal-boundary publication replay.");
        }
        attempt = replay.attempt;
      }

      await expect(Effect.runPromise(
        deterministic.operations.recordPublicationAttemptOutcome(
          attempt,
          "knownNotAppended",
        ),
      )).resolves.toMatchObject({
        _tag: "blocked",
        attemptOrdinal: MAX_PUBLICATION_ATTEMPT_ORDINAL,
        reason: "attemptLimitReached",
        resetRequired: true,
      });
      expect(deterministic.clockReads()).toBe(256);
      expect(prepared.database.prepare(`SELECT
        attempt_ordinal,
        first_attempt_at,
        last_attempt_at,
        attempt_disposition,
        attempt_block_reason,
        preceding_attempt_ordinal,
        preceding_receipt_tag,
        preceding_block_reason
        FROM deployment_sync_publication_state`).get()).toEqual({
        attempt_ordinal: MAX_PUBLICATION_ATTEMPT_ORDINAL,
        first_attempt_at: "1000",
        last_attempt_at: "1000",
        attempt_disposition: "blocked",
        attempt_block_reason: "attemptLimitReached",
        preceding_attempt_ordinal: MAX_PUBLICATION_ATTEMPT_ORDINAL,
        preceding_receipt_tag: "blocked",
        preceding_block_reason: "attemptLimitReached",
      });
    } finally {
      prepared.database.close();
    }
  });

  it("replays one millisecond before seven days and blocks at the inclusive claim boundary", async () => {
    const prepared = await prepareEvaluationState();
    try {
      await installPendingPublication(prepared, 61, "publication-claim-age");
      const first = 10_000;
      const deterministic = makeDeterministicPublicationOperations(
        prepared,
        [
          instant(first),
          instant(first + MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS - 1),
          instant(first + MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS),
        ],
      );
      const attempt = await claimInstalledPublication(
        prepared,
        deterministic.operations,
      );
      const beforeReplay = snapshotEvaluationState(prepared.database);

      await expect(Effect.runPromise(
        deterministic.operations.claimPublication(),
      )).resolves.toMatchObject({
        _tag: "replayed",
        attempt: { attemptOrdinal: 1 },
      });
      expect(snapshotEvaluationState(prepared.database)).toEqual(beforeReplay);
      await expect(Effect.runPromise(
        deterministic.operations.claimPublication(),
      )).resolves.toMatchObject({
        _tag: "blocked",
        identity: attempt.publication.identity,
        attemptOrdinal: 1,
        reason: "ageLimitReached",
      });
      expect(deterministic.clockReads()).toBe(3);
      expect(prepared.database.prepare(`SELECT
        first_attempt_at,
        last_attempt_at,
        attempt_disposition,
        attempt_block_reason
        FROM deployment_sync_publication_state`).get()).toEqual({
        first_attempt_at: first.toString(),
        last_attempt_at: first.toString(),
        attempt_disposition: "blocked",
        attempt_block_reason: "ageLimitReached",
      });
    } finally {
      prepared.database.close();
    }
  });

  it("blocks an outcome at the inclusive seven-day boundary", async () => {
    const prepared = await prepareEvaluationState();
    try {
      await installPendingPublication(prepared, 62, "publication-outcome-age");
      const first = 20_000;
      const deterministic = makeDeterministicPublicationOperations(
        prepared,
        [
          instant(first),
          instant(first + MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS),
        ],
      );
      const attempt = await claimInstalledPublication(
        prepared,
        deterministic.operations,
      );

      await expect(Effect.runPromise(
        deterministic.operations.recordPublicationAttemptOutcome(
          attempt,
          "knownNotAppended",
        ),
      )).resolves.toMatchObject({
        _tag: "blocked",
        attemptOrdinal: 1,
        reason: "ageLimitReached",
      });
      expect(deterministic.clockReads()).toBe(2);
    } finally {
      prepared.database.close();
    }
  });

  it("clamps backward claim and outcome clocks to the persisted last instant", async () => {
    const prepared = await prepareEvaluationState();
    try {
      await installPendingPublication(prepared, 63, "publication-regression");
      const deterministic = makeDeterministicPublicationOperations(
        prepared,
        [instant(500), instant(400), instant(300)],
      );
      const attempt = await claimInstalledPublication(
        prepared,
        deterministic.operations,
      );
      const beforeReplay = snapshotEvaluationState(prepared.database);

      await expect(Effect.runPromise(
        deterministic.operations.claimPublication(),
      )).resolves.toMatchObject({
        _tag: "replayed",
        attempt: {
          attemptOrdinal: 1,
          firstAttemptAt: 500,
          lastAttemptAt: 500,
        },
      });
      expect(snapshotEvaluationState(prepared.database)).toEqual(beforeReplay);
      await expect(Effect.runPromise(
        deterministic.operations.recordPublicationAttemptOutcome(
          attempt,
          "outcomeUnknown",
        ),
      )).resolves.toMatchObject({
        _tag: "recorded",
        nextAttemptOrdinal: 2,
        nextDisposition: "uncertain",
      });
      expect(deterministic.clockReads()).toBe(3);
      expect(prepared.database.prepare(`SELECT
        attempt_ordinal,
        first_attempt_at,
        last_attempt_at,
        attempt_disposition
        FROM deployment_sync_publication_state`).get()).toEqual({
        attempt_ordinal: 2,
        first_attempt_at: "500",
        last_attempt_at: "500",
        attempt_disposition: "uncertain",
      });
    } finally {
      prepared.database.close();
    }
  });

  it("keeps every terminal no-write path read-only with an armed first-write fault", async () => {
    const emptyProbe = makePublicationSqlProbe();
    const empty = await prepareEvaluationState(emptyProbe.hooks);
    try {
      emptyProbe.start({
        phase: "before",
        writeOrdinal: 1,
        cause: new Error("empty claim must not consume a write fault"),
      });
      await expect(Effect.runPromise(
        empty.state.claimPublication(),
      )).resolves.toEqual({ _tag: "none" });
      expect(emptyProbe.writeCount()).toBe(0);
      expect(emptyProbe.faultWasTriggered()).toBe(false);
      expect(emptyProbe.stop()).toEqual(EMPTY_CLAIM_READ_STAGES);
    } finally {
      empty.database.close();
    }

    const claimProbe = makePublicationSqlProbe();
    const claimed = await prepareEvaluationState(claimProbe.hooks);
    try {
      await installPendingPublication(claimed, 64, "publication-read-claim");
      await claimInstalledPublication(claimed);
      claimProbe.start({
        phase: "before",
        writeOrdinal: 1,
        cause: new Error("claim replay must not consume a write fault"),
      });
      await expect(Effect.runPromise(
        claimed.state.claimPublication(),
      )).resolves.toMatchObject({ _tag: "replayed" });
      expect(claimProbe.writeCount()).toBe(0);
      expect(claimProbe.faultWasTriggered()).toBe(false);
      expect(claimProbe.stop()).toEqual(IN_FLIGHT_CLAIM_READ_STAGES);
    } finally {
      claimed.database.close();
    }

    const outcomeProbe = makePublicationSqlProbe();
    const recorded = await prepareEvaluationState(outcomeProbe.hooks);
    try {
      await installPendingPublication(
        recorded,
        65,
        "publication-read-outcome",
      );
      const attempt = await claimInstalledPublication(recorded);
      await Effect.runPromise(recorded.state.recordPublicationAttemptOutcome(
        attempt,
        "knownNotAppended",
      ));
      const before = snapshotEvaluationState(recorded.database);
      outcomeProbe.start({
        phase: "before",
        writeOrdinal: 1,
        cause: new Error("outcome replay must not consume a write fault"),
      });
      await expect(Effect.runPromise(
        recorded.state.recordPublicationAttemptOutcome(
          attempt,
          "knownNotAppended",
        ),
      )).resolves.toMatchObject({
        _tag: "recorded",
        attemptOrdinal: 1,
        nextAttemptOrdinal: 2,
      });
      expect(outcomeProbe.writeCount()).toBe(0);
      expect(outcomeProbe.faultWasTriggered()).toBe(false);
      expect(outcomeProbe.stop()).toEqual(OUTCOME_READ_STAGES);
      expect(snapshotEvaluationState(recorded.database)).toEqual(before);
    } finally {
      recorded.database.close();
    }

    const completionProbe = makePublicationSqlProbe();
    const completed = await prepareEvaluationState(completionProbe.hooks);
    try {
      await installPendingPublication(
        completed,
        66,
        "publication-read-completion",
      );
      const attempt = await claimInstalledPublication(completed);
      const evidence = acceptanceFor(attempt);
      await Effect.runPromise(completed.state.completePublication(evidence));
      const before = snapshotEvaluationState(completed.database);
      completionProbe.start({
        phase: "before",
        writeOrdinal: 1,
        cause: new Error("completion replay must not consume a write fault"),
      });
      await expect(Effect.runPromise(
        completed.state.completePublication(evidence),
      )).resolves.toMatchObject({ _tag: "replayed" });
      expect(completionProbe.writeCount()).toBe(0);
      expect(completionProbe.faultWasTriggered()).toBe(false);
      expect(completionProbe.stop()).toEqual(COMPLETION_READ_STAGES);
      expect(snapshotEvaluationState(completed.database)).toEqual(before);
    } finally {
      completed.database.close();
    }
  });
});
