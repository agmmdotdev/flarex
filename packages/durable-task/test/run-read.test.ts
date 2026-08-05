import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  MAX_TASK_SYSTEM_READ_PAGE_SIZE_V1,
  decodeTaskDueDiscoveryRequestV1,
  decodeTaskRequestedEffectPageRequestV1,
} from "../src/runRead/v1";

const RUN_ID = "run_72000000-0000-4000-8000-000000000003";

describe("Task System bounded run-read contracts", () => {
  it("decodes the closed due-discovery request and cursor", () => {
    expect(success(decodeTaskDueDiscoveryRequestV1({
      version: 1,
      dueKind: "start_attempt",
      pageSize: MAX_TASK_SYSTEM_READ_PAGE_SIZE_V1,
      cursor: {
        version: 1,
        dueKind: "start_attempt",
        throughMs: 20,
        dueAtMs: 10,
        runId: RUN_ID,
      },
    }))).toMatchObject({
      dueKind: "start_attempt",
      pageSize: 100,
      cursor: { throughMs: 20, dueAtMs: 10, runId: RUN_ID },
    });
  });

  it("rejects unbounded, cross-kind, and accessor discovery input", () => {
    expect(failure(decodeTaskDueDiscoveryRequestV1({
      version: 1,
      dueKind: "start_attempt",
      pageSize: 101,
      cursor: null,
    }))).toMatchObject({ issue: "invalid_number" });
    expect(failure(decodeTaskDueDiscoveryRequestV1({
      version: 1,
      dueKind: "start_attempt",
      pageSize: 1,
      cursor: {
        version: 1,
        dueKind: "handle_lease_expiry",
        throughMs: 20,
        dueAtMs: 10,
        runId: RUN_ID,
      },
    }))).toMatchObject({ issue: "invalid_cursor" });
    let reads = 0;
    const hostile = Object.defineProperty({}, "version", {
      enumerable: true,
      get() {
        reads += 1;
        return 1;
      },
    });
    expect(Result.isFailure(decodeTaskDueDiscoveryRequestV1(hostile))).toBe(true);
    expect(reads).toBe(0);
  });

  it("decodes stable requested-effect snapshot cursors", () => {
    expect(success(decodeTaskRequestedEffectPageRequestV1({
      version: 1,
      runId: RUN_ID,
      pageSize: 1,
      cursor: {
        version: 1,
        runId: RUN_ID,
        throughSequence: 4n,
        afterSequence: 2n,
      },
    }))).toMatchObject({
      runId: RUN_ID,
      cursor: { throughSequence: 4n, afterSequence: 2n },
    });
  });

  it("rejects cross-run, reversed, and unknown-field effect cursors", () => {
    expect(failure(decodeTaskRequestedEffectPageRequestV1({
      version: 1,
      runId: RUN_ID,
      pageSize: 1,
      cursor: {
        version: 1,
        runId: "run_72000000-0000-4000-8000-000000000099",
        throughSequence: 4n,
        afterSequence: 2n,
      },
    }))).toMatchObject({ issue: "invalid_cursor" });
    expect(failure(decodeTaskRequestedEffectPageRequestV1({
      version: 1,
      runId: RUN_ID,
      pageSize: 1,
      cursor: {
        version: 1,
        runId: RUN_ID,
        throughSequence: 2n,
        afterSequence: 3n,
      },
    }))).toMatchObject({ issue: "invalid_cursor" });
    expect(failure(decodeTaskRequestedEffectPageRequestV1({
      version: 1,
      runId: RUN_ID,
      pageSize: 1,
      cursor: null,
      extra: true,
    }))).toMatchObject({ issue: "invalid_shape" });
  });
});

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw new Error("expected success");
  return result.success;
}

function failure<A, E>(result: Result.Result<A, E>): E {
  if (Result.isSuccess(result)) throw new Error("expected failure");
  return result.failure;
}
