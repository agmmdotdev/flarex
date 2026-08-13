import { describe, expect, it, vi } from "vitest";

import {
  TaskRuntimeCapabilityUnavailableError,
  TaskRuntimeCoreError,
  makeTaskRuntimeCore,
  type TaskRuntimeExecutionContext,
  type TaskRuntimeHandlerContext,
  type TaskRuntimeInputReadCapability,
} from "../src/taskRuntime/RuntimeCore.js";
import { makeTaskRuntimeD2Fixture } from "./taskRuntimeD2Fixture.js";

describe("DTE06-D2 task runtime core", () => {
  it("cold-loads only the exact entry and returns acceptance after scheduling", async () => {
    const fixture = await makeTaskRuntimeD2Fixture();
    const observedModules: string[] = [];
    const observedInputs: unknown[] = [];
    const scheduled: Promise<unknown>[] = [];
    let inputReceiver = false;
    let waitUntilReceiver = false;
    let inputCapability: TaskRuntimeInputReadCapability;
    inputCapability = {
      read() {
        inputReceiver = inputReceiver || this === inputCapability;
        return Promise.resolve(fixture.inputBytes);
      },
    };
    let executionContext: TaskRuntimeExecutionContext;
    executionContext = {
      waitUntil(execution) {
        waitUntilReceiver = waitUntilReceiver || this === executionContext;
        scheduled.push(execution);
      },
    };
    const core = makeTaskRuntimeCore({
      loadExecution: async (module) => {
        observedModules.push(module);
        return {
          run(input: unknown) {
            observedInputs.push(input);
            return "finished";
          },
        };
      },
      executionContext,
    });

    const acceptance = await core.start(fixture.startRequest, inputCapability);
    expect(acceptance).toMatchObject({
      kind: "accepted",
      identity: fixture.startRequest.dispatch.identity,
      executionId: fixture.startRequest.executionId,
      correlationToken: fixture.startRequest.correlationToken,
    });
    expect(observedModules).toEqual(["tasks/orders.js"]);
    expect(observedInputs).toEqual([{ orderId: "A-1" }]);
    expect(inputReceiver).toBe(true);
    expect(waitUntilReceiver).toBe(true);
    await expect(scheduled[0]).resolves.toBe("finished");
  });

  it("replays only the same start identity without a second read or invocation", async () => {
    const fixture = await makeTaskRuntimeD2Fixture();
    let reads = 0;
    let invocations = 0;
    let finish: (() => void) | undefined;
    const scheduled: Promise<unknown>[] = [];
    const core = makeTaskRuntimeCore({
      loadExecution: async () => ({
        run() {
          invocations += 1;
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      }),
      executionContext: {
        waitUntil(execution) {
          scheduled.push(execution);
        },
      },
    });
    const input = {
      read: async () => {
        reads += 1;
        return fixture.inputBytes;
      },
    };
    const first = await core.start(fixture.startRequest, input);
    const replay = await core.start(fixture.startRequest, input);
    expect(replay).toBe(first);
    expect(reads).toBe(1);
    expect(invocations).toBe(1);

    await expect(core.start({
      ...fixture.startRequest,
      correlationToken: "different-token",
    }, input)).rejects.toMatchObject({
      name: "TaskRuntimeCoreError",
      reason: "execution_conflict",
    });
    finish?.();
    await scheduled[0];
  });

  it("single-flights concurrent starts before any asynchronous preparation", async () => {
    const fixture = await makeTaskRuntimeD2Fixture();
    let releaseLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    let loads = 0;
    let reads = 0;
    let invocations = 0;
    let invocationsAtWaitUntil = -1;
    const scheduled: Promise<unknown>[] = [];
    const core = makeTaskRuntimeCore({
      loadExecution: async () => {
        loads += 1;
        await loadGate;
        return {
          run() {
            invocations += 1;
          },
        };
      },
      executionContext: {
        waitUntil(execution) {
          invocationsAtWaitUntil = invocations;
          scheduled.push(execution);
        },
      },
    });
    const input = {
      read: async () => {
        reads += 1;
        return fixture.inputBytes;
      },
    };
    const first = core.start(fixture.startRequest, input);
    const duplicate = core.start(fixture.startRequest, input);
    releaseLoad?.();
    const [firstAcceptance, duplicateAcceptance] = await Promise.all([
      first,
      duplicate,
    ]);
    expect(duplicateAcceptance).toBe(firstAcceptance);
    expect({ loads, reads, invocationsAtWaitUntil }).toEqual({
      loads: 1,
      reads: 1,
      invocationsAtWaitUntil: 0,
    });
    await scheduled[0];
    expect(invocations).toBe(1);
  });

  it("delivers monotonic cancellation and rejects stale or wrong identities", async () => {
    const fixture = await makeTaskRuntimeD2Fixture();
    let observedContext: TaskRuntimeHandlerContext | undefined;
    let finish: (() => void) | undefined;
    const scheduled: Promise<unknown>[] = [];
    const core = makeTaskRuntimeCore({
      loadExecution: async () => ({
        run(_input: unknown, context: TaskRuntimeHandlerContext) {
          observedContext = context;
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      }),
      executionContext: {
        waitUntil(execution) {
          scheduled.push(execution);
        },
      },
    });
    await core.start(fixture.startRequest, {
      read: async () => fixture.inputBytes,
    });
    expect(observedContext?.cancellationSignal.aborted).toBe(false);

    const accepted = await core.cancel(fixture.cancellationRequest);
    expect(accepted.kind).toBe("interruption_requested");
    expect(accepted.cancellationGeneration).toBe(2n);
    expect(observedContext?.cancellationSignal.aborted).toBe(true);
    await expect(core.cancel(fixture.cancellationRequest)).resolves.toEqual(
      accepted,
    );
    await expect(core.cancel({
      ...fixture.cancellationRequest,
      cancellationGeneration: 1n,
    })).rejects.toMatchObject({
      reason: "stale_cancellation_generation",
    });
    await expect(core.cancel({
      ...fixture.cancellationRequest,
      executionId: "other-execution",
    })).rejects.toMatchObject({ reason: "identity_mismatch" });
    finish?.();
    await scheduled[0];
    await expect(core.cancel({
      ...fixture.cancellationRequest,
      cancellationGeneration: 3n,
    })).rejects.toMatchObject({ reason: "unknown_execution" });
  });

  it("starts with an already-requested cancellation projection aborted", async () => {
    const fixture = await makeTaskRuntimeD2Fixture({
      initialCancellationGeneration: 1n,
    });
    let aborted = false;
    const scheduled: Promise<unknown>[] = [];
    const core = makeTaskRuntimeCore({
      loadExecution: async () => ({
        run(_input: unknown, context: TaskRuntimeHandlerContext) {
          aborted = context.cancellationSignal.aborted;
        },
      }),
      executionContext: {
        waitUntil(execution) {
          scheduled.push(execution);
        },
      },
    });
    await core.start(fixture.startRequest, {
      read: async () => fixture.inputBytes,
    });
    expect(aborted).toBe(true);
    await scheduled[0];
  });

  it("keeps future lifecycle and result callbacks explicitly unavailable", async () => {
    const fixture = await makeTaskRuntimeD2Fixture();
    let unavailable: unknown;
    const scheduled: Promise<unknown>[] = [];
    const core = makeTaskRuntimeCore({
      loadExecution: async () => ({
        run(_input: unknown, context: TaskRuntimeHandlerContext) {
          try {
            context.heartbeat();
          } catch (cause) {
            unavailable = cause;
          }
        },
      }),
      executionContext: {
        waitUntil(execution) {
          scheduled.push(execution);
        },
      },
    });
    await core.start(fixture.startRequest, {
      read: async () => fixture.inputBytes,
    });
    expect(unavailable).toBeInstanceOf(TaskRuntimeCapabilityUnavailableError);
    expect(unavailable).toMatchObject({ capability: "heartbeat" });
    await scheduled[0];
  });

  it("fails closed on invalid input and missing handlers", async () => {
    const invalidInput = await makeTaskRuntimeD2Fixture({
      payloadValidator: { type: "number" },
    });
    await expect(makeTaskRuntimeCore({
      loadExecution: async () => ({ run() {} }),
      executionContext: { waitUntil() {} },
    }).start(invalidInput.startRequest, {
      read: async () => invalidInput.inputBytes,
    })).rejects.toMatchObject({ reason: "input_invalid" });

    const fixture = await makeTaskRuntimeD2Fixture();
    await expect(makeTaskRuntimeCore({
      loadExecution: async () => ({}),
      executionContext: { waitUntil() {} },
    }).start(fixture.startRequest, {
      read: async () => fixture.inputBytes,
    })).rejects.toMatchObject({ reason: "handler_missing" });
  });

  it("never invokes or accepts when waitUntil rejects scheduling", async () => {
    const fixture = await makeTaskRuntimeD2Fixture();
    let invocations = 0;
    const core = makeTaskRuntimeCore({
      loadExecution: async () => ({
        run() {
          invocations += 1;
        },
      }),
      executionContext: {
        waitUntil() {
          throw new Error("host rejected execution");
        },
      },
    });
    await expect(core.start({}, {})).rejects.toBeInstanceOf(TaskRuntimeCoreError);
    await expect(core.start(fixture.startRequest, {
      read: async () => fixture.inputBytes,
    })).rejects.toMatchObject({ reason: "wait_until_failed" });
    await expect(core.start(fixture.startRequest, {
      read: async () => fixture.inputBytes,
    })).rejects.toMatchObject({ reason: "wait_until_failed" });
    await Promise.resolve();
    expect(invocations).toBe(0);
  });

  it("preserves foreign canonical-input hashing failures", async () => {
    const fixture = await makeTaskRuntimeD2Fixture();
    const foreign = new Error("crypto unavailable");
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(
      foreign,
    );
    try {
      const core = makeTaskRuntimeCore({
        loadExecution: async () => ({ run() {} }),
        executionContext: { waitUntil() {} },
      });
      await expect(core.start(fixture.startRequest, {
        read: async () => fixture.inputBytes,
      })).rejects.toBe(foreign);
    } finally {
      digest.mockRestore();
    }
  });
});
