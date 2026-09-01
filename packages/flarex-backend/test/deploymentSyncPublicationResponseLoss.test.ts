import {
  capturePublicationAttemptInstant,
} from "@flarex/query-sync/internal/kernel";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import type {
  DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";
import {
  prepareEvaluationState,
  snapshotEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";
import {
  CLAIM_WRITE_STAGES,
  COMPLETION_READ_STAGES,
  COMPLETION_WRITE_STAGES,
  IN_FLIGHT_CLAIM_READ_STAGES,
  OUTCOME_READ_STAGES,
  OUTCOME_WRITE_STAGES,
  PENDING_CLAIM_READ_STAGES,
  type PublicationSqlStage,
  acceptanceFor,
  claimInstalledPublication,
  installPendingPublication,
  makeDeterministicPublicationOperations,
  makePublicationSqlProbe,
} from "./deploymentSyncPublicationTestSupport";

type ResponseLossTiming = "beforeCommit" | "afterCommit";

const timings = ["beforeCommit", "afterCommit"] as const;
const deterministicPendingClaimReadStages = withoutClock(
  PENDING_CLAIM_READ_STAGES,
);
const deterministicInFlightClaimReadStages = withoutClock(
  IN_FLIGHT_CLAIM_READ_STAGES,
);
const deterministicOutcomeReadStages = withoutClock(OUTCOME_READ_STAGES);

describe("deployment query-sync publication response loss", () => {
  it.each(timings)(
    "recovers a claim response lost %s without duplicating the move",
    async timing => {
      const probe = makePublicationSqlProbe();
      const prepared = await prepareEvaluationState(probe.hooks);
      try {
        await installPendingPublication(
          prepared,
          80,
          `publication-claim-response-loss-${timing}`,
        );
        const cause = new Error(`claim response lost ${timing}`);
        const responseLoss = makeResponseLossStorage(
          prepared.storage,
          timing,
          cause,
        );
        const first = success(capturePublicationAttemptInstant(100));
        const retry = success(capturePublicationAttemptInstant(200));
        const deterministic = makeDeterministicPublicationOperations(
          prepared,
          [first, retry],
          responseLoss.storage,
        );
        const before = snapshotEvaluationState(prepared.database);
        probe.start();

        const lostExit = await Effect.runPromiseExit(
          deterministic.operations.claimPublication(),
        );

        expectOnlyDefect(lostExit, cause);
        expect(responseLoss.faultWasTriggered()).toBe(true);
        expect(probe.stop()).toEqual([
          ...deterministicPendingClaimReadStages,
          ...CLAIM_WRITE_STAGES,
        ]);
        const afterLoss = snapshotEvaluationState(prepared.database);
        const lostReceipt = responseLoss.readLostReceipt();
        expect(lostReceipt).toMatchObject({
          _tag: "claimed",
          attempt: { attemptOrdinal: 1, firstAttemptAt: first },
        });
        if (timing === "beforeCommit") {
          expect(afterLoss).toEqual(before);
        } else {
          expect(afterLoss).not.toEqual(before);
        }

        const unexpectedWrite = new Error("claim replay attempted a write");
        probe.start(timing === "afterCommit"
          ? { phase: "before", writeOrdinal: 1, cause: unexpectedWrite }
          : undefined);
        const recovered = await Effect.runPromise(
          deterministic.operations.claimPublication(),
        );

        if (timing === "beforeCommit") {
          expect(recovered).toMatchObject({
            _tag: "claimed",
            attempt: { attemptOrdinal: 1, firstAttemptAt: retry },
          });
          expect(recovered).not.toEqual(lostReceipt);
          expect(probe.stop()).toEqual([
            ...deterministicPendingClaimReadStages,
            ...CLAIM_WRITE_STAGES,
          ]);
          expect(snapshotEvaluationState(prepared.database)).not.toEqual(before);
        } else {
          if (recovered._tag !== "replayed") {
            throw new Error(
              `Expected a replayed claim, received ${recovered._tag}.`,
            );
          }
          if (!isNonArrayRecord(lostReceipt)) {
            throw new Error("Expected the lost claim receipt record.");
          }
          expect(recovered.attempt).toEqual(lostReceipt.attempt);
          expect(probe.writeCount()).toBe(0);
          expect(probe.faultWasTriggered()).toBe(false);
          expect(probe.stop()).toEqual(deterministicInFlightClaimReadStages);
          expect(snapshotEvaluationState(prepared.database)).toEqual(afterLoss);
        }
        expect(deterministic.clockReads()).toBe(2);
      } finally {
        prepared.database.close();
      }
    },
  );

  it.each(timings)(
    "recovers an outcome response lost %s without advancing twice",
    async timing => {
      const probe = makePublicationSqlProbe();
      const prepared = await prepareEvaluationState(probe.hooks);
      try {
        await installPendingPublication(
          prepared,
          81,
          `publication-outcome-response-loss-${timing}`,
        );
        const claimInstant = success(capturePublicationAttemptInstant(100));
        const claimOperations = makeDeterministicPublicationOperations(
          prepared,
          [claimInstant],
        );
        const attempt = await claimInstalledPublication(
          prepared,
          claimOperations.operations,
        );
        const cause = new Error(`outcome response lost ${timing}`);
        const responseLoss = makeResponseLossStorage(
          prepared.storage,
          timing,
          cause,
        );
        const first = success(capturePublicationAttemptInstant(200));
        const retry = success(capturePublicationAttemptInstant(300));
        const deterministic = makeDeterministicPublicationOperations(
          prepared,
          [first, retry],
          responseLoss.storage,
        );
        const before = snapshotEvaluationState(prepared.database);
        probe.start();

        const lostExit = await Effect.runPromiseExit(
          deterministic.operations.recordPublicationAttemptOutcome(
            attempt,
            "outcomeUnknown",
          ),
        );

        expectOnlyDefect(lostExit, cause);
        expect(responseLoss.faultWasTriggered()).toBe(true);
        expect(probe.stop()).toEqual([
          ...deterministicOutcomeReadStages,
          ...OUTCOME_WRITE_STAGES,
        ]);
        const afterLoss = snapshotEvaluationState(prepared.database);
        const lostReceipt = responseLoss.readLostReceipt();
        expect(lostReceipt).toMatchObject({
          _tag: "recorded",
          attemptOrdinal: 1,
          nextAttemptOrdinal: 2,
          nextDisposition: "uncertain",
        });

        if (timing === "beforeCommit") {
          expect(afterLoss).toEqual(before);
          probe.start();
          const recovered = await Effect.runPromise(
            deterministic.operations.recordPublicationAttemptOutcome(
              attempt,
              "outcomeUnknown",
            ),
          );
          expect(recovered).toEqual(lostReceipt);
          expect(probe.stop()).toEqual([
            ...deterministicOutcomeReadStages,
            ...OUTCOME_WRITE_STAGES,
          ]);
          expect(snapshotEvaluationState(prepared.database).publicationState)
            .toEqual([expect.objectContaining({ last_attempt_at: retry.toString() })]);
        } else {
          expect(afterLoss).not.toEqual(before);
          expect(afterLoss.publicationState).toEqual([
            expect.objectContaining({ last_attempt_at: first.toString() }),
          ]);
          await Effect.runPromise(
            prepared.state.completePublication(acceptanceFor(attempt)),
          );
          const afterDelivery = snapshotEvaluationState(prepared.database);
          const unexpectedWrite = new Error("outcome replay attempted a write");
          probe.start({ phase: "before", writeOrdinal: 1, cause: unexpectedWrite });
          const recovered = await Effect.runPromise(
            deterministic.operations.recordPublicationAttemptOutcome(
              attempt,
              "outcomeUnknown",
            ),
          );
          expect(recovered).toEqual(lostReceipt);
          expect(probe.writeCount()).toBe(0);
          expect(probe.faultWasTriggered()).toBe(false);
          expect(probe.stop()).toEqual(deterministicOutcomeReadStages);
          expect(snapshotEvaluationState(prepared.database)).toEqual(
            afterDelivery,
          );
        }
        expect(deterministic.clockReads()).toBe(2);
      } finally {
        prepared.database.close();
      }
    },
  );

  it.each(timings)(
    "recovers a completion response lost %s without settling twice",
    async timing => {
      const probe = makePublicationSqlProbe();
      const prepared = await prepareEvaluationState(probe.hooks);
      try {
        await installPendingPublication(
          prepared,
          82,
          `publication-completion-response-loss-${timing}`,
        );
        const attempt = await claimInstalledPublication(prepared);
        const evidence = acceptanceFor(attempt);
        const cause = new Error(`completion response lost ${timing}`);
        const responseLoss = makeResponseLossStorage(
          prepared.storage,
          timing,
          cause,
        );
        const deterministic = makeDeterministicPublicationOperations(
          prepared,
          [],
          responseLoss.storage,
        );
        const before = snapshotEvaluationState(prepared.database);
        probe.start();

        const lostExit = await Effect.runPromiseExit(
          deterministic.operations.completePublication(evidence),
        );

        expectOnlyDefect(lostExit, cause);
        expect(responseLoss.faultWasTriggered()).toBe(true);
        expect(probe.stop()).toEqual([
          ...COMPLETION_READ_STAGES,
          ...COMPLETION_WRITE_STAGES,
        ]);
        const afterLoss = snapshotEvaluationState(prepared.database);
        const lostReceipt = responseLoss.readLostReceipt();
        expect(lostReceipt).toMatchObject({
          _tag: "completed",
          identity: evidence.identity,
        });
        if (timing === "beforeCommit") {
          expect(afterLoss).toEqual(before);
        } else {
          expect(afterLoss).not.toEqual(before);
        }

        const unexpectedWrite = new Error("completion replay attempted a write");
        probe.start(timing === "afterCommit"
          ? { phase: "before", writeOrdinal: 1, cause: unexpectedWrite }
          : undefined);
        const recovered = await Effect.runPromise(
          deterministic.operations.completePublication(evidence),
        );

        if (timing === "beforeCommit") {
          expect(recovered).toMatchObject({
            _tag: "completed",
            identity: evidence.identity,
          });
          expect(probe.stop()).toEqual([
            ...COMPLETION_READ_STAGES,
            ...COMPLETION_WRITE_STAGES,
          ]);
          expect(snapshotEvaluationState(prepared.database)).not.toEqual(before);
        } else {
          expect(recovered).toMatchObject({
            _tag: "replayed",
            identity: evidence.identity,
          });
          if (!isNonArrayRecord(lostReceipt)) {
            throw new Error("Expected the lost completion receipt record.");
          }
          const { _tag: _lostTag, ...lostReceiptWithoutTag } = lostReceipt;
          expect(recovered).toEqual({
            ...lostReceiptWithoutTag,
            _tag: "replayed",
          });
          expect(probe.writeCount()).toBe(0);
          expect(probe.faultWasTriggered()).toBe(false);
          expect(probe.stop()).toEqual(COMPLETION_READ_STAGES);
          expect(snapshotEvaluationState(prepared.database)).toEqual(afterLoss);
        }
        expect(deterministic.clockReads()).toBe(0);
      } finally {
        prepared.database.close();
      }
    },
  );
});

function makeResponseLossStorage(
  base: DeploymentQuerySyncStorage,
  timing: ResponseLossTiming,
  cause: Error,
): Readonly<{
  readonly storage: DeploymentQuerySyncStorage;
  readonly faultWasTriggered: () => boolean;
  readonly readLostReceipt: () => unknown;
}> {
  let armed = true;
  let lostReceipt: unknown;
  const transactionSync = <A>(closure: () => A): A => {
    if (!armed) return base.transactionSync(closure);
    if (timing === "beforeCommit") {
      return base.transactionSync(() => {
        const value = closure();
        lostReceipt = value;
        armed = false;
        throw cause;
      });
    }
    const value = base.transactionSync(closure);
    lostReceipt = value;
    armed = false;
    throw cause;
  };
  return Object.freeze({
    storage: Object.freeze({ sql: base.sql, transactionSync }),
    faultWasTriggered: () => !armed,
    readLostReceipt: () => lostReceipt,
  });
}

function expectOnlyDefect(
  exit: Exit.Exit<unknown, unknown>,
  expected: Error,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  expect(exit.cause.reasons).toHaveLength(1);
  const reason = exit.cause.reasons[0];
  if (reason === undefined || !Cause.isDieReason(reason)) {
    throw new Error("Expected exactly one Effect die reason.");
  }
  expect(reason.defect).toBe(expected);
}

function withoutClock(
  stages: readonly PublicationSqlStage[],
): readonly PublicationSqlStage[] {
  return Object.freeze(stages.filter(stage => stage !== "clock-read"));
}
