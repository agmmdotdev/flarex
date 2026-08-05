import { Effect } from "effect";
import type { TaskDatabaseTimeMsV1, TaskRetryJitterV1 } from "../../runAttempt/Model.js";
import type {
  TaskDueDiscoveryCandidateV1,
  TaskDueDiscoveryCursorV1,
  TaskDueDiscoveryRequestV1,
} from "../../runRead/Model.js";
import type { TaskDueCandidateHandlingReceiptV1 } from "../Model.js";
import type {
  TaskDueCandidateHandlerV1,
  TaskDueWorkSourceV1,
  TaskRetryJitterSourceV1,
} from "../Ports.js";

export interface InMemoryTaskDueWorkSourceV1 extends TaskDueWorkSourceV1<never> {
  readonly requests: () => ReadonlyArray<TaskDueDiscoveryRequestV1>;
}

export function makeInMemoryTaskDueWorkSourceV1(options: {
  readonly throughMs: TaskDatabaseTimeMsV1;
  readonly candidates: ReadonlyArray<TaskDueDiscoveryCandidateV1>;
}): InMemoryTaskDueWorkSourceV1 {
  const capturedThroughMs = options.throughMs;
  const candidates = [...options.candidates].map(copyCandidate).sort(compareCandidates);
  const requests: TaskDueDiscoveryRequestV1[] = [];
  return Object.freeze({
    discoverDueRuns: Effect.fn("InMemoryTaskDueWorkSource.discoverDueRuns")(
      (request) => Effect.sync(() => {
        requests.push(copyRequest(request));
        const throughMs = request.cursor?.throughMs ?? capturedThroughMs;
        const eligible = candidates.filter((candidate) =>
          candidate.kind === request.dueKind
          && candidate.dueAtMs <= throughMs
          && (request.cursor === null || comparePosition(candidate, request.cursor) > 0)
        );
        const pageCandidates = eligible.slice(0, request.pageSize).map(copyCandidate);
        const last = pageCandidates.at(-1);
        const nextCursor = eligible.length > request.pageSize && last !== undefined
          ? cursorAfter(last, throughMs)
          : null;
        return Object.freeze({
          version: 1 as const,
          dueKind: request.dueKind,
          throughMs,
          candidates: Object.freeze(pageCandidates),
          nextCursor,
        });
      }),
    ),
    requests: () => Object.freeze(requests.map(copyRequest)),
  });
}

export function makeFixedTaskRetryJitterSourceV1(
  retryJitter: TaskRetryJitterV1,
): TaskRetryJitterSourceV1 {
  return Object.freeze({
    nextRetryJitter: Effect.fn("FixedTaskRetryJitterSource.nextRetryJitter")(
      () => Effect.succeed(retryJitter),
    ),
  });
}

export interface RecordingTaskDueCandidateHandlerV1<Failure>
  extends TaskDueCandidateHandlerV1<Failure> {
  readonly handledCandidates: () => ReadonlyArray<TaskDueDiscoveryCandidateV1>;
}

export function makeRecordingTaskDueCandidateHandlerV1<Failure>(
  settle: (
    candidate: TaskDueDiscoveryCandidateV1,
    index: number,
  ) => Effect.Effect<TaskDueCandidateHandlingReceiptV1, Failure>,
): RecordingTaskDueCandidateHandlerV1<Failure> {
  const handled: TaskDueDiscoveryCandidateV1[] = [];
  return Object.freeze({
    handle: Effect.fn("RecordingTaskDueCandidateHandler.handle")((candidate) => {
      return Effect.gen(function* () {
        const snapshot = copyCandidate(candidate);
        handled.push(snapshot);
        return yield* settle(snapshot, handled.length - 1);
      });
    }),
    handledCandidates: () => Object.freeze(handled.map(copyCandidate)),
  });
}

function copyCandidate(
  candidate: TaskDueDiscoveryCandidateV1,
): TaskDueDiscoveryCandidateV1 {
  return Object.freeze({ ...candidate });
}

function copyRequest(request: TaskDueDiscoveryRequestV1): TaskDueDiscoveryRequestV1 {
  return Object.freeze({
    ...request,
    cursor: request.cursor === null ? null : Object.freeze({ ...request.cursor }),
  });
}

function compareCandidates(
  left: TaskDueDiscoveryCandidateV1,
  right: TaskDueDiscoveryCandidateV1,
): number {
  return comparePosition(left, right);
}

function comparePosition(
  left: Pick<TaskDueDiscoveryCandidateV1, "dueAtMs" | "runId">,
  right: Pick<TaskDueDiscoveryCursorV1, "dueAtMs" | "runId">,
): number {
  if (left.dueAtMs !== right.dueAtMs) return left.dueAtMs < right.dueAtMs ? -1 : 1;
  return left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0;
}

function cursorAfter(
  candidate: TaskDueDiscoveryCandidateV1,
  throughMs: TaskDatabaseTimeMsV1,
): TaskDueDiscoveryCursorV1 {
  return Object.freeze({
    version: 1,
    dueKind: candidate.kind,
    throughMs,
    dueAtMs: candidate.dueAtMs,
    runId: candidate.runId,
  });
}
