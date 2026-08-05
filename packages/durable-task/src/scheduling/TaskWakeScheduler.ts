import { Brand, Effect, Result } from "effect";
import {
  InvalidTaskWakeSchedulerConfigurationError,
  InvalidTaskWakeSchedulerRunRequestError,
  TaskWakeSchedulerHandlerContractError,
  TaskWakeSchedulerSourceContractError,
} from "./Errors.js";
import {
  MAX_TASK_WAKE_SCHEDULER_CANDIDATES_V1,
  MAX_TASK_WAKE_SCHEDULER_PAGES_V1,
  type TaskDueCandidateHandlingReceiptV1,
  type TaskWakeSchedulerOptionsV1,
  type TaskWakeSchedulerRunReceiptV1,
  type TaskWakeSchedulerRunRequestV1,
  type TaskWakeSchedulerStopReasonV1,
} from "./Model.js";
import type {
  TaskDueCandidateHandlerV1,
  TaskDueWorkSourceV1,
} from "./Ports.js";
import type { TaskRunIdV1 } from "../runAttempt/Model.js";
import type {
  TaskDueDiscoveryCandidateV1,
  TaskDueDiscoveryCursorV1,
  TaskDueDiscoveryPageV1,
  TaskSystemReadPageSizeV1,
} from "../runRead/Model.js";
import { MAX_TASK_SYSTEM_READ_PAGE_SIZE_V1 } from "../runRead/Model.js";

interface CapturedTaskWakeSchedulerOptionsV1 {
  readonly pageSize: TaskSystemReadPageSizeV1;
  readonly maximumPages: number;
  readonly maximumCandidates: number;
}

export type TaskWakeSchedulerRunErrorV1<SourceFailure, HandlerFailure> =
  | SourceFailure
  | HandlerFailure
  | InvalidTaskWakeSchedulerRunRequestError
  | TaskWakeSchedulerSourceContractError
  | TaskWakeSchedulerHandlerContractError;

export interface TaskWakeSchedulerV1<SourceFailure, HandlerFailure> {
  readonly run: (
    request: TaskWakeSchedulerRunRequestV1,
  ) => Effect.Effect<
    TaskWakeSchedulerRunReceiptV1,
    TaskWakeSchedulerRunErrorV1<SourceFailure, HandlerFailure>
  >;
}

/**
 * Constructs one scope-bound scheduler. The captured source and handler must
 * belong to the same trusted scope; callers cannot select a scope per run.
 */
export function makeTaskWakeSchedulerV1<SourceFailure, HandlerFailure>(
  source: TaskDueWorkSourceV1<SourceFailure>,
  handler: TaskDueCandidateHandlerV1<HandlerFailure>,
  options: TaskWakeSchedulerOptionsV1,
): Result.Result<
  TaskWakeSchedulerV1<SourceFailure, HandlerFailure>,
  InvalidTaskWakeSchedulerConfigurationError
> {
  return Result.map(captureOptions(options), (captured) => {
    const run: TaskWakeSchedulerV1<SourceFailure, HandlerFailure>["run"] =
      Effect.fn("TaskWakeScheduler.run")(function* (request) {
        const runRequest = captureRunRequest(request);
        if (runRequest.cursor !== null && runRequest.cursor.version !== 1) {
          return yield* Effect.fail(new InvalidTaskWakeSchedulerRunRequestError({
            dueKind: runRequest.dueKind,
            reason: "cursor_version_mismatch",
          }));
        }
        if (
          runRequest.cursor !== null
          && runRequest.cursor.dueKind !== runRequest.dueKind
        ) {
          return yield* Effect.fail(new InvalidTaskWakeSchedulerRunRequestError({
            dueKind: runRequest.dueKind,
            reason: "cursor_kind_mismatch",
          }));
        }

        let cursor = runRequest.cursor;
        let pagesRead = 0;
        let candidatesHandled = 0;
        const handled: TaskDueCandidateHandlingReceiptV1[] = [];

        while (true) {
          const sourcePage = yield* source.discoverDueRuns({
            version: 1,
            dueKind: runRequest.dueKind,
            pageSize: captured.pageSize,
            cursor,
          });
          const page = capturePage(sourcePage);
          pagesRead += 1;
          yield* Effect.fromResult(validatePage(
            runRequest,
            cursor,
            page,
            captured.pageSize,
          ));

          for (let index = 0; index < page.candidates.length; index += 1) {
            if (candidatesHandled >= captured.maximumCandidates) {
              return completed(
                runRequest,
                page.throughMs,
                "candidate_budget",
                pagesRead,
                candidatesHandled,
                handled,
                cursorAfter(page.candidates[index - 1] ?? null, page),
              );
            }

            const candidate = page.candidates[index];
            if (candidate === undefined) continue;
            const settlement = yield* handler.handle(candidate);
            const capturedSettlement = yield* Effect.fromResult(
              captureSettlement(candidate, settlement),
            );
            handled.push(capturedSettlement);
            candidatesHandled += 1;
          }

          if (page.nextCursor === null) {
            return completed(
              runRequest,
              page.throughMs,
              "source_exhausted",
              pagesRead,
              candidatesHandled,
              handled,
              null,
            );
          }
          if (candidatesHandled >= captured.maximumCandidates) {
            return completed(
              runRequest,
              page.throughMs,
              "candidate_budget",
              pagesRead,
              candidatesHandled,
              handled,
              page.nextCursor,
            );
          }
          if (pagesRead >= captured.maximumPages) {
            return completed(
              runRequest,
              page.throughMs,
              "page_budget",
              pagesRead,
              candidatesHandled,
              handled,
              page.nextCursor,
            );
          }
          cursor = page.nextCursor;
        }
      });

    return Object.freeze({ run });
  });
}

function captureOptions(
  options: TaskWakeSchedulerOptionsV1,
): Result.Result<
  CapturedTaskWakeSchedulerOptionsV1,
  InvalidTaskWakeSchedulerConfigurationError
> {
  if (
    !isPositiveSafeInteger(options.pageSize)
    || options.pageSize > MAX_TASK_SYSTEM_READ_PAGE_SIZE_V1
  ) {
    return Result.fail(new InvalidTaskWakeSchedulerConfigurationError({
      reason: "invalid_page_size",
    }));
  }
  if (
    !isPositiveSafeInteger(options.maximumPages)
    || options.maximumPages > MAX_TASK_WAKE_SCHEDULER_PAGES_V1
  ) {
    return Result.fail(new InvalidTaskWakeSchedulerConfigurationError({
      reason: "invalid_page_budget",
    }));
  }
  if (
    !isPositiveSafeInteger(options.maximumCandidates)
    || options.maximumCandidates > MAX_TASK_WAKE_SCHEDULER_CANDIDATES_V1
  ) {
    return Result.fail(new InvalidTaskWakeSchedulerConfigurationError({
      reason: "invalid_candidate_budget",
    }));
  }
  return Result.succeed(Object.freeze({
    pageSize: Brand.nominal<TaskSystemReadPageSizeV1>()(options.pageSize),
    maximumPages: options.maximumPages,
    maximumCandidates: options.maximumCandidates,
  }));
}

function captureRunRequest(
  request: TaskWakeSchedulerRunRequestV1,
): TaskWakeSchedulerRunRequestV1 {
  const dueKind = request.dueKind;
  const suppliedCursor = request.cursor;
  return Object.freeze({
    dueKind,
    cursor: suppliedCursor === null ? null : captureCursor(suppliedCursor),
  });
}

function validatePage(
  request: TaskWakeSchedulerRunRequestV1,
  cursor: TaskDueDiscoveryCursorV1 | null,
  page: TaskDueDiscoveryPageV1,
  pageSize: TaskSystemReadPageSizeV1,
): Result.Result<void, TaskWakeSchedulerSourceContractError> {
  if (page.version !== 1) {
    return sourceContractError(request, null, "page_version_mismatch");
  }
  if (page.dueKind !== request.dueKind) {
    return sourceContractError(request, null, "page_kind_mismatch");
  }
  if (cursor !== null && page.throughMs !== cursor.throughMs) {
    return sourceContractError(request, null, "snapshot_mismatch");
  }
  if (page.candidates.length > pageSize) {
    return sourceContractError(request, null, "page_size_exceeded");
  }
  let previous = cursor;
  for (const candidate of page.candidates) {
    if (candidate.kind !== request.dueKind) {
      return sourceContractError(request, candidate.runId, "candidate_kind_mismatch");
    }
    if (candidate.dueAtMs > page.throughMs) {
      return sourceContractError(request, candidate.runId, "candidate_after_snapshot");
    }
    if (previous !== null && comparePosition(candidate, previous) <= 0) {
      return sourceContractError(request, candidate.runId, "candidate_order_invalid");
    }
    previous = cursorAfter(candidate, page);
  }
  if (page.candidates.length === 0 && page.nextCursor !== null) {
    return sourceContractError(request, null, "empty_page_has_continuation");
  }
  if (page.nextCursor !== null) {
    const last = page.candidates.at(-1);
    if (
      last === undefined
      || page.nextCursor.version !== 1
      || page.nextCursor.dueKind !== request.dueKind
      || page.nextCursor.throughMs !== page.throughMs
      || page.nextCursor.dueAtMs !== last.dueAtMs
      || page.nextCursor.runId !== last.runId
    ) {
      return sourceContractError(request, last?.runId ?? null, "continuation_invalid");
    }
  }
  return Result.succeed(undefined);
}

function captureSettlement(
  candidate: TaskDueDiscoveryCandidateV1,
  settlement: TaskDueCandidateHandlingReceiptV1,
): Result.Result<
  TaskDueCandidateHandlingReceiptV1,
  TaskWakeSchedulerHandlerContractError
> {
  const version = settlement.version;
  const kind = settlement.kind;
  const dueAtMs = settlement.dueAtMs;
  const runId = settlement.runId;
  const disposition = settlement.disposition;
  const observedAtMs = settlement.observedAtMs;
  const runVersion = settlement.runVersion;
  const outcomeKind = settlement.outcomeKind;

  if (
    version !== "flarex.task-due-candidate-handling-receipt.v1"
    || kind !== candidate.kind
    || runId !== candidate.runId
    || dueAtMs !== candidate.dueAtMs
  ) {
    return handlerContractError(candidate);
  }

  if (kind === "start_attempt") {
    if (outcomeKind === "current" && disposition === "current") {
      return Result.succeed(Object.freeze({
        version,
        kind,
        dueAtMs,
        runId,
        disposition,
        observedAtMs,
        runVersion,
        outcomeKind,
      }));
    }
    if (outcomeKind === "attempt_granted" && isAcceptedDisposition(disposition)) {
      return Result.succeed(Object.freeze({
        version,
        kind,
        dueAtMs,
        runId,
        disposition,
        observedAtMs,
        runVersion,
        outcomeKind,
      }));
    }
    return handlerContractError(candidate);
  }

  if (outcomeKind === "current") {
    return disposition === "current"
      ? Result.succeed(Object.freeze({
          version,
          kind,
          dueAtMs,
          runId,
          disposition,
          observedAtMs,
          runVersion,
          outcomeKind,
        }))
      : handlerContractError(candidate);
  }
  if (
    isAcceptedDisposition(disposition)
    && (outcomeKind === "retry_scheduled"
      || outcomeKind === "terminal_failed"
      || outcomeKind === "terminal_cancelled")
  ) {
    return Result.succeed(Object.freeze({
      version,
      kind,
      dueAtMs,
      runId,
      disposition,
      observedAtMs,
      runVersion,
      outcomeKind,
    }));
  }
  return handlerContractError(candidate);
}

function isAcceptedDisposition(
  disposition: TaskDueCandidateHandlingReceiptV1["disposition"],
): disposition is "accepted" | "idempotent" {
  return disposition === "accepted" || disposition === "idempotent";
}

function handlerContractError(
  candidate: TaskDueDiscoveryCandidateV1,
): Result.Result<never, TaskWakeSchedulerHandlerContractError> {
  return Result.fail(new TaskWakeSchedulerHandlerContractError({
    dueKind: candidate.kind,
    runId: candidate.runId,
    reason: "receipt_candidate_mismatch",
  }));
}

function sourceContractError(
  request: TaskWakeSchedulerRunRequestV1,
  runId: TaskRunIdV1 | null,
  reason: TaskWakeSchedulerSourceContractError["reason"],
): Result.Result<never, TaskWakeSchedulerSourceContractError> {
  return Result.fail(new TaskWakeSchedulerSourceContractError({
    dueKind: request.dueKind,
    runId,
    reason,
  }));
}

function comparePosition(
  left: Pick<TaskDueDiscoveryCandidateV1, "dueAtMs" | "runId">,
  right: Pick<TaskDueDiscoveryCursorV1, "dueAtMs" | "runId">,
): number {
  if (left.dueAtMs !== right.dueAtMs) return left.dueAtMs < right.dueAtMs ? -1 : 1;
  return left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0;
}

function capturePage(page: TaskDueDiscoveryPageV1): TaskDueDiscoveryPageV1 {
  const version = page.version;
  const dueKind = page.dueKind;
  const throughMs = page.throughMs;
  const candidates = page.candidates.map(captureCandidate);
  const suppliedNextCursor = page.nextCursor;
  const nextCursor = suppliedNextCursor === null
    ? null
    : captureCursor(suppliedNextCursor);
  return Object.freeze({
    version,
    dueKind,
    throughMs,
    candidates: Object.freeze(candidates),
    nextCursor,
  });
}

function captureCandidate(
  candidate: TaskDueDiscoveryCandidateV1,
): TaskDueDiscoveryCandidateV1 {
  const kind = candidate.kind;
  return kind === "start_attempt"
    ? Object.freeze({
        kind,
        dueAtMs: candidate.dueAtMs,
        runId: candidate.runId,
        expectedRunVersion: candidate.expectedRunVersion,
      })
    : Object.freeze({
        kind,
        dueAtMs: candidate.dueAtMs,
        runId: candidate.runId,
        attemptId: candidate.attemptId,
        executionFence: candidate.executionFence,
        expectedLeaseVersion: candidate.expectedLeaseVersion,
      });
}

function captureCursor(cursor: TaskDueDiscoveryCursorV1): TaskDueDiscoveryCursorV1 {
  return Object.freeze({
    version: cursor.version,
    dueKind: cursor.dueKind,
    throughMs: cursor.throughMs,
    dueAtMs: cursor.dueAtMs,
    runId: cursor.runId,
  });
}

function cursorAfter(
  candidate: TaskDueDiscoveryCandidateV1 | null,
  page: TaskDueDiscoveryPageV1,
): TaskDueDiscoveryCursorV1 | null {
  return candidate === null
    ? null
    : Object.freeze({
        version: 1,
        dueKind: page.dueKind,
        throughMs: page.throughMs,
        dueAtMs: candidate.dueAtMs,
        runId: candidate.runId,
      });
}

function completed(
  request: TaskWakeSchedulerRunRequestV1,
  throughMs: TaskWakeSchedulerRunReceiptV1["throughMs"],
  stopReason: TaskWakeSchedulerStopReasonV1,
  pagesRead: number,
  candidatesHandled: number,
  handled: ReadonlyArray<TaskDueCandidateHandlingReceiptV1>,
  continuation: TaskDueDiscoveryCursorV1 | null,
): TaskWakeSchedulerRunReceiptV1 {
  return Object.freeze({
    version: "flarex.task-wake-scheduler-run-receipt.v1",
    dueKind: request.dueKind,
    throughMs,
    stopReason,
    pagesRead,
    candidatesHandled,
    handled: Object.freeze([...handled]),
    continuation: continuation === null ? null : captureCursor(continuation),
  });
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
