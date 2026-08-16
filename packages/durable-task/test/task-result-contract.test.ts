import {
  decodeTaskResultCommitmentV1,
  MAX_TASK_RESULT_CANONICAL_BYTES_V1,
  taskResultObjectKeyV1,
  TASK_RESULT_CODEC_V1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

describe("Task result contract", () => {
  it("accepts the exact byte ceiling and owns the digest", () => {
    const digest = new Uint8Array(32).fill(0xab);
    const decoded = decodeTaskResultCommitmentV1({
      codec: TASK_RESULT_CODEC_V1,
      byteLength: MAX_TASK_RESULT_CANONICAL_BYTES_V1,
      sha256: digest,
    });

    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      digest[0] = 0;
      expect(decoded.success.sha256[0]).toBe(0xab);
      expect(taskResultObjectKeyV1(decoded.success.sha256)).toBe(
        `durable-task-result/v1/sha256/${"ab".repeat(32)}`,
      );
    }
  });

  it.each([0, MAX_TASK_RESULT_CANONICAL_BYTES_V1 + 1])(
    "rejects the out-of-contract byte length %s",
    byteLength => {
      expect(Result.isFailure(decodeTaskResultCommitmentV1({
        codec: TASK_RESULT_CODEC_V1,
        byteLength,
        sha256: new Uint8Array(32),
      }))).toBe(true);
    },
  );
});
