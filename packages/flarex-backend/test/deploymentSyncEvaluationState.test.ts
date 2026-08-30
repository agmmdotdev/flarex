import {
  createReferenceModel,
  reduceReferenceModel,
} from "@flarex/query-sync/testing/reference-model";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import { expectSingleDeploymentQuerySyncWrite } from "../src/deploymentSync/StateStorage";
import {
  beginEvaluation,
  beginRequest,
  completionInput,
  prepareEvaluationState,
  queryDescriptor,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

describe("deployment query-sync evaluation state", () => {
  it("uses RETURNING cardinality while accepting indexed physical writes", () => {
    expect(() => expectSingleDeploymentQuerySyncWrite(
      "completeQueryEvaluation",
      {
        rowsWritten: 2,
        toArray: () => Object.freeze([{ query_key: "query" }]),
      },
      "indexed-write-proof",
    )).not.toThrow();
  });

  it("matches the portable oracle for completion and exact replay", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const descriptor = queryDescriptor(1);
      const request = beginRequest(prepared.binding, descriptor);
      const reference = success(createReferenceModel(
        prepared.binding.bootstrapCursor,
      ));
      const referenceBegin = success(reduceReferenceModel(reference, {
        _tag: "beginQueryEvaluation",
        request,
      }));
      const attempt = await beginEvaluation(prepared, descriptor);
      if (referenceBegin.decision._tag !== "created") {
        throw new Error(
          `Expected reference creation, received ${referenceBegin.decision._tag}.`,
        );
      }
      expect(attempt).toEqual(referenceBegin.decision.attempt);

      const input = completionInput(prepared, attempt);
      const expected = success(reduceReferenceModel(referenceBegin.model, {
        _tag: "completeQueryEvaluation",
        attempt,
        ...input,
      }));
      const completed = await Effect.runPromise(
        prepared.state.completeQueryEvaluation(attempt, ...completionArgs(input)),
      );
      expect(completed).toEqual(receiptWithoutState(expected.decision));

      const replayed = await Effect.runPromise(
        prepared.state.completeQueryEvaluation(attempt, ...completionArgs(input)),
      );
      expect(replayed).toEqual({
        ...completed,
        _tag: "replayed",
      });
      expect(readCount(
        prepared.database,
        "deployment_sync_query_dependencies",
      )).toBe(2);
      expect(readCount(
        prepared.database,
        "deployment_sync_pending_publications",
      )).toBe(1);
    } finally {
      prepared.database.close();
    }
  });

  it("matches claim and terminal-outcome decisions and replays the block", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const descriptor = queryDescriptor(2);
      const request = beginRequest(prepared.binding, descriptor);
      const reference = success(createReferenceModel(
        prepared.binding.bootstrapCursor,
      ));
      const referenceBegin = success(reduceReferenceModel(reference, {
        _tag: "beginQueryEvaluation",
        request,
      }));
      await beginEvaluation(prepared, descriptor);
      const scanRequest = Object.freeze({
        maximumQueryInspections: 1,
        continuation: null,
      });
      const expectedClaim = success(reduceReferenceModel(
        referenceBegin.model,
        { _tag: "claimEvaluationWork", request: scanRequest },
      ));
      const claimed = await Effect.runPromise(
        prepared.state.claimEvaluationWork(scanRequest),
      );
      expect(claimed).toEqual(receiptWithoutState(expectedClaim.decision));
      if (claimed._tag !== "claimed") {
        throw new Error(`Expected claimed receipt, received ${claimed._tag}.`);
      }

      const expectedOutcome = success(reduceReferenceModel(
        expectedClaim.model,
        {
          _tag: "recordEvaluationAttemptOutcome",
          attempt: claimed.attempt,
          outcome: "terminalRefusal",
        },
      ));
      const blocked = await Effect.runPromise(
        prepared.state.recordEvaluationAttemptOutcome(
          claimed.attempt,
          "terminalRefusal",
        ),
      );
      expect(blocked).toEqual(receiptWithoutState(expectedOutcome.decision));
      await expect(Effect.runPromise(
        prepared.state.recordEvaluationAttemptOutcome(
          claimed.attempt,
          "transientExhausted",
        ),
      )).resolves.toEqual(blocked);
    } finally {
      prepared.database.close();
    }
  });

  it("rejects forged attempts and continuations without changing durable state", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const attempt = await beginEvaluation(prepared, queryDescriptor(3));
      const claimed = await Effect.runPromise(
        prepared.state.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        }),
      );
      if (claimed._tag !== "claimed") {
        throw new Error(`Expected claimed receipt, received ${claimed._tag}.`);
      }
      const before = snapshot(prepared.database);
      const forgedAttempt = { ...attempt } as typeof attempt;
      const attemptExit = await Effect.runPromiseExit(
        prepared.state.recordEvaluationAttemptOutcome(
          forgedAttempt,
          "terminalRefusal",
        ),
      );
      expectTypedFailure(attemptExit, {
        _tag: "InvalidEvaluationAttemptError",
        reason: "notStateIssued",
      });

      const forgedContinuation = {
        ...claimed.continuation,
      } as typeof claimed.continuation;
      const continuationExit = await Effect.runPromiseExit(
        prepared.state.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: forgedContinuation,
        }),
      );
      expectTypedFailure(continuationExit, {
        _tag: "InvalidEvaluationWorkContinuationError",
        reason: "notStateIssued",
      });
      expect(snapshot(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });
});

function completionArgs(input: ReturnType<typeof completionInput>) {
  return [input.evaluation, input.refresh, input.publication] as const;
}

function receiptWithoutState<Decision extends { readonly state: unknown }>(
  decision: Decision,
): Omit<Decision, "state"> {
  const { state: _state, ...receipt } = decision;
  return receipt;
}

function readCount(
  database: import("node:sqlite").DatabaseSync,
  table: string,
): number {
  const row = database.prepare(`SELECT count(*) AS value FROM ${table}`).get();
  return Number(row?.value);
}

function snapshot(database: import("node:sqlite").DatabaseSync) {
  return Object.freeze({
    scope: database.prepare(
      "SELECT * FROM deployment_sync_scope_state",
    ).all(),
    queries: database.prepare(
      "SELECT * FROM deployment_sync_queries ORDER BY query_key",
    ).all(),
    dependencies: database.prepare(
      `SELECT * FROM deployment_sync_query_dependencies
       ORDER BY query_key, role, generation, dependency_key`,
    ).all(),
    pending: database.prepare(
      "SELECT * FROM deployment_sync_pending_publications ORDER BY query_key",
    ).all(),
  });
}

function expectTypedFailure<A, E>(
  exit: Exit.Exit<A, E>,
  shape: Readonly<Record<string, unknown>>,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected typed failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject(
    shape,
  );
}
