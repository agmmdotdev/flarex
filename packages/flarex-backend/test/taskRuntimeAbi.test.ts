import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  TASK_RUNTIME_CANCELLATION_ACCEPTANCE_VERSION_V1,
  TASK_RUNTIME_START_ACCEPTANCE_VERSION_V1,
  TaskRuntimeAbiError,
  decodeTaskRuntimeCancellationAcceptanceV1,
  decodeTaskRuntimeCancellationRequestV1,
  decodeTaskRuntimeStartAcceptanceV1,
  decodeTaskRuntimeStartRequestV1,
  encodeTaskRuntimeCancellationAcceptanceV1,
  encodeTaskRuntimeCancellationRequestV1,
  encodeTaskRuntimeStartAcceptanceV1,
  encodeTaskRuntimeStartRequestV1,
} from "../src/taskRuntime/Abi.js";
import { makeTaskRuntimeD2Fixture } from "./taskRuntimeD2Fixture.js";

describe("DTE06-D2 private task runtime ABI", () => {
  it("strictly decodes and encodes every owned RPC contract", async () => {
    const fixture = await makeTaskRuntimeD2Fixture();
    const start = success(decodeTaskRuntimeStartRequestV1(
      fixture.startRequest,
    ));
    expect(success(encodeTaskRuntimeStartRequestV1(start))).toEqual(start);
    expect(start.runtimeBinding.candidateSha256).not.toBe(
      fixture.startRequest.runtimeBinding.candidateSha256,
    );

    const startAcceptance = success(decodeTaskRuntimeStartAcceptanceV1({
      version: TASK_RUNTIME_START_ACCEPTANCE_VERSION_V1,
      bridgeAbiIdentity: fixture.startRequest.bridgeAbiIdentity,
      kind: "accepted",
      identity: fixture.startRequest.dispatch.identity,
      executionId: fixture.startRequest.executionId,
      correlationToken: fixture.startRequest.correlationToken,
    }));
    expect(success(encodeTaskRuntimeStartAcceptanceV1(startAcceptance))).toEqual(
      startAcceptance,
    );

    const cancellation = success(decodeTaskRuntimeCancellationRequestV1(
      fixture.cancellationRequest,
    ));
    expect(success(encodeTaskRuntimeCancellationRequestV1(cancellation))).toEqual(
      cancellation,
    );
    const cancellationAcceptance = success(
      decodeTaskRuntimeCancellationAcceptanceV1({
        version: TASK_RUNTIME_CANCELLATION_ACCEPTANCE_VERSION_V1,
        bridgeAbiIdentity: fixture.startRequest.bridgeAbiIdentity,
        kind: "interruption_requested",
        identity: fixture.startRequest.dispatch.identity,
        executionId: fixture.startRequest.executionId,
        cancellationGeneration: 2n,
        correlationToken: fixture.startRequest.correlationToken,
      }),
    );
    expect(success(encodeTaskRuntimeCancellationAcceptanceV1(
      cancellationAcceptance,
    ))).toEqual(cancellationAcceptance);
  });

  it("rejects version drift, excess fields, and nonpositive cancellation", async () => {
    const fixture = await makeTaskRuntimeD2Fixture();
    expectFailureReason(decodeTaskRuntimeStartRequestV1({
      ...fixture.startRequest,
      version: 2,
    }), "invalid_shape");
    expectFailureReason(decodeTaskRuntimeStartRequestV1({
      ...fixture.startRequest,
      dispatch: {
        ...fixture.startRequest.dispatch,
        computeProfile: "",
      },
    }), "invalid_dispatch");
    expectFailureReason(decodeTaskRuntimeStartRequestV1({
      ...fixture.startRequest,
      unexpected: true,
    }), "invalid_shape");
    expectFailureReason(decodeTaskRuntimeCancellationRequestV1({
      ...fixture.cancellationRequest,
      cancellationGeneration: 0n,
    }), "invalid_cancellation_generation");
  });

  it("contains hostile record traps in the exact typed codec channel", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expectFailureReason(
      decodeTaskRuntimeStartRequestV1(revoked.proxy),
      "invalid_shape",
    );

    let getterInvoked = false;
    const input: Record<string, unknown> = {};
    for (const key of [
      "version",
      "bridgeAbiIdentity",
      "dispatch",
      "executionId",
      "runtimeBinding",
      "inputReference",
      "correlationToken",
    ]) {
      Object.defineProperty(input, key, {
        enumerable: true,
        get() {
          getterInvoked = true;
          throw new Error("hostile getter");
        },
      });
    }
    expectFailureReason(
      decodeTaskRuntimeStartRequestV1(input),
      "invalid_shape",
    );
    expect(getterInvoked).toBe(false);
  });

  it("keeps every encoder failure operation exact", async () => {
    const fixture = await makeTaskRuntimeD2Fixture();
    const invalid = {
      ...fixture.startRequest,
      correlationToken: " contains-space",
    };
    const failure = encodeTaskRuntimeStartRequestV1(invalid);
    expect(Result.isFailure(failure)).toBe(true);
    if (Result.isFailure(failure)) {
      expect(failure.failure.operation).toBe("encode_start_request");
      expect(failure.failure.reason).toBe("invalid_correlation_token");
    }
  });
});

function success<Success, Failure>(result: Result.Result<Success, Failure>): Success {
  return Result.match(result, {
    onFailure: (cause) => {
      throw new Error("Expected test fixture Result success.", { cause });
    },
    onSuccess: (value) => value,
  });
}

function expectFailureReason(
  result: Result.Result<unknown, TaskRuntimeAbiError>,
  reason: TaskRuntimeAbiError["reason"],
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.reason).toBe(reason);
}
