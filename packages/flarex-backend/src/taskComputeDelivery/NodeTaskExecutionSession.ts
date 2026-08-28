import { Effect } from "effect";

import {
  makeNodeTaskExecutorInterruptionRequestV1,
  type NodeTaskExecutorClientError,
  type NodeTaskExecutorSession,
} from "./NodeTaskExecutorClient.js";
import {
  type TaskExecutionSession,
  TaskExecutionSessionError,
} from "./TaskExecutionSession.js";

/**
 * Projects an attached Node executor session into the provider-neutral Task
 * supervision seam. Callback attachment remains a Node-private prerequisite.
 */
export function adaptNodeTaskExecutionSession(
  nodeSession: NodeTaskExecutorSession,
  maximumCloseMilliseconds: number,
): TaskExecutionSession {
  if (!Number.isSafeInteger(maximumCloseMilliseconds) ||
    maximumCloseMilliseconds <= 0) {
    throw new Error("Node Task maximum close duration is invalid.");
  }
  const requestInterruption: TaskExecutionSession["requestInterruption"] =
    Effect.fn("NodeTaskExecutionSession.requestInterruption")(
      request => {
        if (request.generation !== nodeSession.acceptance.generation ||
          request.executionId !== nodeSession.acceptance.executionId ||
          !identitiesEqual(request.identity, nodeSession.acceptance.identity)) {
          return Effect.fail(sessionFailure(
            "requestInterruption",
            "invalidRequest",
          ));
        }
        return nodeSession.requestInterruption(
          makeNodeTaskExecutorInterruptionRequestV1(
            nodeSession.acceptance,
            request.cancellationGeneration,
            request.reason,
          ),
        ).pipe(
          Effect.mapError(cause => mapClientFailure(
            "requestInterruption",
            cause,
          )),
          Effect.flatMap(response => {
            switch (response.kind) {
              case "interruption_requested":
                return Effect.void;
              case "stale_generation":
                return Effect.fail(sessionFailure(
                  "requestInterruption",
                  "staleCancellation",
                ));
              case "execution_not_found":
              case "session_lost":
                return Effect.fail(sessionFailure(
                  "requestInterruption",
                  "sessionLost",
                ));
            }
          }),
        );
      },
    );
  return Object.freeze({
    acceptance: Object.freeze({
      generation: nodeSession.acceptance.generation,
      identity: nodeSession.acceptance.identity,
      executionId: nodeSession.acceptance.executionId,
      cancellationGeneration: nodeSession.acceptance.cancellationGeneration,
    }),
    maximumCloseMilliseconds,
    requestInterruption,
    settlement: nodeSession.settlement.pipe(
      Effect.map(settlement => Object.freeze({
        generation: settlement.generation,
        identity: settlement.identity,
        executionId: settlement.executionId,
        outcome: settlement.outcome,
      })),
      Effect.mapError(cause => mapClientFailure("settlement", cause)),
    ),
    close: nodeSession.close.pipe(
      Effect.mapError(cause => mapClientFailure("close", cause)),
      Effect.flatMap(outcome => outcome.kind === "session_lost"
        ? Effect.fail(sessionFailure("close", "sessionLost"))
        : Effect.void),
    ),
  });
}

function identitiesEqual(
  left: NodeTaskExecutorSession["acceptance"]["identity"],
  right: NodeTaskExecutorSession["acceptance"]["identity"],
): boolean {
  return left.version === right.version && left.scopeId === right.scopeId &&
    left.runId === right.runId &&
    left.requestedEffectSequence === right.requestedEffectSequence &&
    left.attemptId === right.attemptId &&
    left.executionFence === right.executionFence;
}

function mapClientFailure(
  operation: TaskExecutionSessionError["operation"],
  cause: NodeTaskExecutorClientError,
): TaskExecutionSessionError {
  switch (cause.reason) {
    case "invalidRequest":
    case "invalidResponse":
    case "sessionLost":
    case "clientClosed":
    case "cleanupFailed":
      return sessionFailure(
        operation,
        cause.reason === "clientClosed" ? "sessionLost" : cause.reason,
        cause,
      );
    case "transportBeforeAcceptance":
    case "acceptanceUnknown":
    case "transportAfterAcceptance":
      return sessionFailure(operation, "providerUnavailable", cause);
    case "idempotencyConflict":
      return sessionFailure(operation, "invalidRequest", cause);
  }
}

function sessionFailure(
  operation: TaskExecutionSessionError["operation"],
  reason: TaskExecutionSessionError["reason"],
  cause?: unknown,
): TaskExecutionSessionError {
  return new TaskExecutionSessionError({
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
