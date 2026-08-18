import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
} from "flarex-protocol/internal/application-task-worker-v1";
import {
  LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
  LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
} from "flarex-protocol/internal/legacy-task-worker-v1";
import {
  TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
  TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
  TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
  TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
} from "flarex-protocol/internal/task-worker-session-v1";

import type { ApplicationTaskWorkerDefinition } from
  "../src/artifactRuntime/ApplicationTaskWorkerDefinition";
import type { LegacyTaskWorkerDefinition } from
  "../src/artifactRuntime/LegacyTaskWorkerDefinition";
import {
  makeTaskWorkerSessionHost,
  type TaskWorkerSessionHostStartInput,
} from "../src/artifactRuntime/TaskWorkerSessionHost";

describe("Task Worker session host", () => {
  it.each(["application_v1", "legacy_dynamic_worker_v1"] as const)(
    "starts a fresh outbound-denied %s session before terminal settlement",
    async generation => {
      const terminal = deferred<unknown>();
      let interruptionCalls = 0;
      const loader = new FakeWorkerLoader(start => remoteSession(
        start,
        terminal.promise,
        request => {
          interruptionCalls += 1;
          return interruptionFor(
            start,
            (request as { cancellationGeneration: bigint }).cancellationGeneration,
            true,
            (request as { reason: "cancellation_requested" }).reason,
          );
        },
      ));
      const input = startInput(generation);
      const session = await Effect.runPromise(
        makeTaskWorkerSessionHost(loader).start(input),
      );

      expect(session.acceptance).toMatchObject({
        kind: "accepted",
        generation,
        executionId: "execution-1",
      });
      expect(loader.loaded).toHaveLength(1);
      expect(loader.loaded[0]?.globalOutbound).toBeNull();
      if (input.generation === "legacy_dynamic_worker_v1") {
        expect(loader.loaded[0]?.compatibilityFlags).toEqual([
          "nodejs_compat",
          "nodejs_compat_populate_process_env",
        ]);
        expect(loader.loaded[0]?.compatibilityFlags).not.toBe(
          input.definition.compatibilityFlags,
        );
      } else {
        expect(loader.loaded[0]?.compatibilityFlags).toBeUndefined();
      }
      let settled = false;
      const waiting = Effect.runPromise(session.settlement).then(value => {
        settled = true;
        return value;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      terminal.resolve(settlementFor(session.acceptance));
      await expect(waiting).resolves.toMatchObject({ kind: "settled", generation });
      await Effect.runPromise(session.close);
      expect(interruptionCalls).toBe(0);
      expect(loader.sessionDisposals).toBe(1);
      const lost = await Effect.runPromise(session.settlement.pipe(Effect.flip));
      expect(lost.reason).toBe("sessionLost");
    },
  );

  it("maps fresh Worker entrypoint acquisition failure before session start", async () => {
    const cause = new Error("entrypoint unavailable");
    let loadCalls = 0;
    const loader = {
      get(): WorkerStub {
        throw new Error("cached loading is forbidden");
      },
      load(): WorkerStub {
        loadCalls += 1;
        return new FailingEntrypointWorkerStub(cause);
      },
    } satisfies WorkerLoader;

    const error = await Effect.runPromise(
      makeTaskWorkerSessionHost(loader).start(
        startInput("application_v1"),
      ).pipe(Effect.flip),
    );

    expect(error).toMatchObject({
      operation: "start",
      reason: "workerLoadFailed",
    });
    expect(error.cause).toBe(cause);
    expect(loadCalls).toBe(1);
  });

  it("correlates interruption receipts and maps stale cancellation distinctly", async () => {
    let interruptionCalls = 0;
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      request => {
        interruptionCalls += 1;
        const requested = (request as { cancellationGeneration: bigint })
          .cancellationGeneration;
        if (requested < 2n) {
          throw Object.assign(new Error("stale"), {
            name: "TaskWorkerSessionStaleCancellationV1Error",
          });
        }
        return interruptionFor(
          start,
          requested,
          true,
          (request as { reason: "cancellation_requested" }).reason,
        );
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(
      startInput("application_v1"),
    ));
    const accepted = await Effect.runPromise(session.requestInterruption(
      interruptionFor(startInput("application_v1"), 2n, false),
    ));
    expect(accepted.cancellationGeneration).toBe(2n);
    const stale = await Effect.runPromise(session.requestInterruption(
      interruptionFor(startInput("application_v1"), 1n, false),
    ).pipe(Effect.flip));
    expect(stale.reason).toBe("staleCancellation");

    const invalid = interruptionFor(startInput("application_v1"), 3n, false);
    invalid.executionId = "other-execution";
    const rejected = await Effect.runPromise(
      session.requestInterruption(invalid).pipe(Effect.flip),
    );
    expect(rejected.reason).toBe("invalidRequest");
    expect(interruptionCalls).toBe(1);
    await Effect.runPromise(session.close);
    expect(interruptionCalls).toBe(2);
  });

  it("accepts only settlement for the first exact interruption provenance", async () => {
    for (const settlementReason of [
      "cancellation_requested",
      "maximum_duration",
    ] as const) {
      const pending = deferred<unknown>();
      const input = startInput("application_v1");
      const loader = new FakeWorkerLoader(start => remoteSession(
        start,
        pending.promise,
        request => interruptionFor(
          start,
          (request as { readonly cancellationGeneration: bigint })
            .cancellationGeneration,
          true,
          (request as { readonly reason: "cancellation_requested" }).reason,
        ),
      ));
      const session = await Effect.runPromise(
        makeTaskWorkerSessionHost(loader).start(input),
      );
      await Effect.runPromise(session.requestInterruption(
        interruptionFor(input, 1n, false, "cancellation_requested"),
      ));
      pending.resolve(interruptedSettlementFor(
        session.acceptance,
        1n,
        settlementReason,
      ));
      if (settlementReason === "cancellation_requested") {
        await expect(Effect.runPromise(session.settlement)).resolves.toMatchObject({
          outcome: {
            kind: "interrupted",
            interruption: { reason: "cancellation_requested" },
          },
        });
      } else {
        const failure = await Effect.runPromise(session.settlement.pipe(Effect.flip));
        expect(failure.reason).toBe("invalidResponse");
      }
      await Effect.runPromise(session.close);
    }
  });

  it("correlates cancellation settlement to the newest accepted generation", async () => {
    const pending = deferred<unknown>();
    const input = startInput("application_v1");
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      pending.promise,
      request => interruptionFor(
        start,
        (request as { readonly cancellationGeneration: bigint })
          .cancellationGeneration,
        true,
        "cancellation_requested",
      ),
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(input));
    await Effect.runPromise(session.requestInterruption(
      interruptionFor(input, 1n, false, "cancellation_requested"),
    ));
    await Effect.runPromise(session.requestInterruption(
      interruptionFor(input, 2n, false, "cancellation_requested"),
    ));
    pending.resolve(interruptedSettlementFor(
      session.acceptance,
      2n,
      "cancellation_requested",
    ));
    await expect(Effect.runPromise(session.settlement)).resolves.toMatchObject({
      outcome: {
        interruption: { cancellationGeneration: 2n },
      },
    });
    await Effect.runPromise(session.close);
  });

  it("accepts the exact later interruption when an earlier delivery is uncertain", async () => {
    const terminal = deferred<unknown>();
    const input = startInput("application_v1", 1_000);
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      terminal.promise,
      request => {
        const interruption = request as {
          readonly cancellationGeneration: bigint;
          readonly reason: "cancellation_requested" | "maximum_duration";
        };
        if (interruption.reason === "cancellation_requested") {
          return new Promise(() => undefined);
        }
        terminal.resolve(interruptedSettlementFor(
          acceptanceFor(start),
          interruption.cancellationGeneration,
          interruption.reason,
        ));
        return interruptionFor(
          start,
          interruption.cancellationGeneration,
          true,
          interruption.reason,
        );
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 5,
    }).start(input));
    const uncertain = await Effect.runPromise(session.requestInterruption(
      interruptionFor(input, 1n, false, "cancellation_requested"),
    ).pipe(Effect.flip));
    expect(uncertain.reason).toBe("timedOut");
    await Effect.runPromise(session.requestInterruption(
      interruptionFor(input, 2n, false, "maximum_duration"),
    ));
    await expect(Effect.runPromise(session.settlement)).resolves.toMatchObject({
      outcome: {
        kind: "interrupted",
        interruption: {
          cancellationGeneration: 2n,
          reason: "maximum_duration",
        },
      },
    });
    await Effect.runPromise(session.close);
  });

  it("disposes a session that arrives after start interruption", async () => {
    const pending = deferred<unknown>();
    const loader = new FakeWorkerLoader(() => pending.promise);
    const host = makeTaskWorkerSessionHost(loader);
    const fiber = Effect.runFork(host.start(startInput("application_v1")));
    await Promise.resolve();
    await Effect.runPromise(Fiber.interrupt(fiber));
    pending.resolve(remoteSessionValue(startInput("application_v1"), Promise.resolve(
      settlementForAcceptance(startInput("application_v1")),
    ), loader));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loader.sessionDisposals).toBe(1);
  });

  it("classifies an unknown start rejection as workerStartFailed", async () => {
    const host = makeTaskWorkerSessionHost(new FakeWorkerLoader(() => {
      throw new Error("transport disconnected");
    }));
    const failure = await Effect.runPromise(host.start(
      startInput("application_v1"),
    ).pipe(Effect.flip));
    expect(failure.reason).toBe("workerStartFailed");
  });

  it("recomputes the absolute deadline after synchronous Worker loading", async () => {
    const loader = new FakeWorkerLoader(
      start => remoteSession(start, new Promise(() => undefined)),
      20,
    );
    const failure = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 100,
    }).start(startInput("application_v1", 5)).pipe(Effect.flip));
    expect(failure.reason).toBe("timedOut");
    expect(loader.starts).toBe(0);
  });

  it.each(["requestInterruption", "settlement"] as const)(
    "classifies a post-acceptance %s disconnect as sessionLost",
    async operation => {
      const disconnected = Promise.reject(new Error("transport disconnected"));
      disconnected.catch(() => undefined);
      const input = startInput("application_v1");
      const loader = new FakeWorkerLoader(start => remoteSession(
        start,
        operation === "settlement" ? disconnected : new Promise(() => undefined),
        operation === "requestInterruption" ? () => disconnected : undefined,
      ));
      const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(input));
      const failure = operation === "settlement"
        ? await Effect.runPromise(session.settlement.pipe(Effect.flip))
        : await Effect.runPromise(session.requestInterruption(
            interruptionFor(input, 1n, false),
          ).pipe(Effect.flip));
      expect(failure.reason).toBe("sessionLost");
      if (operation === "requestInterruption") {
        const cleanup = await Effect.runPromise(session.close.pipe(Effect.flip));
        expect(cleanup.reason).toBe("cleanupFailed");
      } else {
        await Effect.runPromise(session.close);
      }
    },
  );

  it("expires and disposes an unobserved session from the absolute start deadline", async () => {
    let expiryInterruptions = 0;
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      request => {
        expiryInterruptions += 1;
        return interruptionFor(
          start,
          1n,
          true,
          (request as { reason: "maximum_duration" }).reason,
        );
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 100,
    }).start(startInput("application_v1", 25)));

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(loader.sessionDisposals).toBe(1);
    expect(expiryInterruptions).toBe(1);
    const expired = await Effect.runPromise(session.settlement.pipe(Effect.flip));
    expect(expired.reason).toBe("timedOut");
  });

  it("observes the exact maximum-duration settlement after expiry delivery", async () => {
    const input = startInput("application_v1", 20);
    const terminal = deferred<unknown>();
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      terminal.promise,
      request => {
        const interruption = request as {
          readonly cancellationGeneration: bigint;
          readonly reason: "maximum_duration";
        };
        terminal.resolve(interruptedSettlementFor(
          acceptanceFor(start),
          interruption.cancellationGeneration,
          interruption.reason,
        ));
        return interruptionFor(
          start,
          interruption.cancellationGeneration,
          true,
          interruption.reason,
        );
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 100,
    }).start(input));

    await expect(Effect.runPromise(session.settlement)).resolves.toMatchObject({
      outcome: {
        kind: "interrupted",
        interruption: {
          cancellationGeneration: 1n,
          reason: "maximum_duration",
        },
      },
    });
    await Effect.runPromise(session.close);
    expect(loader.sessionDisposals).toBe(1);
  });

  it("does not accept a non-interrupted settlement observed after the deadline", async () => {
    const input = startInput("application_v1", 20);
    const terminal = deferred<unknown>();
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      terminal.promise,
      request => {
        terminal.resolve(settlementForAcceptance(start));
        return interruptionFor(
          start,
          (request as { readonly cancellationGeneration: bigint })
            .cancellationGeneration,
          true,
          "maximum_duration",
        );
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 100,
    }).start(input));

    const failure = await Effect.runPromise(session.settlement.pipe(Effect.flip));
    expect(failure).toMatchObject({ operation: "settlement", reason: "timedOut" });
    await Effect.runPromise(session.close);
    expect(loader.sessionDisposals).toBe(1);
  });

  it("bounds a missing settlement after expiry interruption", async () => {
    const input = startInput("application_v1", 20);
    const expirySent = deferred<void>();
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      request => {
        expirySent.resolve();
        return interruptionFor(
          start,
          (request as { cancellationGeneration: bigint }).cancellationGeneration,
          true,
          "maximum_duration",
        );
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 100,
    }).start(input));

    const settling = Effect.runPromise(session.settlement.pipe(Effect.flip));
    await expirySent.promise;
    const failure = await settling;
    expect(failure).toMatchObject({ operation: "settlement", reason: "timedOut" });
    await Effect.runPromise(session.close);
    expect(loader.sessionDisposals).toBe(1);
  });

  it("interrupts and drains a concurrent settlement RPC before close returns", async () => {
    const pending = deferred<unknown>();
    const loader = new FakeWorkerLoader(start => remoteSession(start, pending.promise));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(
      startInput("application_v1"),
    ));
    const settling = Effect.runPromise(session.settlement);
    await Promise.resolve();
    await Effect.runPromise(session.close);
    await expect(settling).rejects.toMatchObject({ reason: "sessionLost" });
    expect(loader.sessionDisposals).toBe(1);

    pending.resolve(settlementFor(session.acceptance));
    await Promise.resolve();
  });

  it("advances beyond and interrupts a concurrent accepted interruption", async () => {
    const pending = deferred<unknown>();
    const input = startInput("application_v1");
    let closeGeneration: bigint | undefined;
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      request => {
        const generation = (request as { cancellationGeneration: bigint })
          .cancellationGeneration;
        if (generation === 2n) return pending.promise;
        closeGeneration = generation;
        return interruptionFor(
          start,
          generation,
          true,
          (request as { reason: "cancellation_requested" | "host_shutdown" }).reason,
        );
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(input));
    const interrupting = Effect.runPromise(session.requestInterruption(
      interruptionFor(input, 2n, false),
    ));
    await Promise.resolve();
    await Effect.runPromise(session.close);
    expect(closeGeneration).toBe(3n);
    expect(loader.sessionDisposals).toBe(1);
    await expect(interrupting).rejects.toMatchObject({ reason: "sessionLost" });

    pending.resolve(interruptionFor(input, 2n));
    await Promise.resolve();
  });

  it("drains an active expiry interruption before explicit close", async () => {
    const pending = deferred<unknown>();
    const input = startInput("application_v1", 20);
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      () => pending.promise,
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 100,
    }).start(input));
    await new Promise(resolve => setTimeout(resolve, 30));
    let closeFinished = false;
    const closing = Effect.runPromise(session.close).then(() => { closeFinished = true; });
    await Promise.resolve();
    expect(closeFinished).toBe(false);
    expect(loader.sessionDisposals).toBe(0);

    pending.resolve(interruptionFor(input, 1n, true, "maximum_duration"));
    await closing;
    expect(loader.sessionDisposals).toBe(1);
  });

  it("delivers interruption before an early explicit close disposes the session", async () => {
    let closeGeneration: bigint | undefined;
    const input = startInput("application_v1");
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      request => {
        closeGeneration = (request as { cancellationGeneration: bigint })
          .cancellationGeneration;
        return interruptionFor(start, closeGeneration, true, "host_shutdown");
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(input));
    await Effect.runPromise(session.close);
    expect(closeGeneration).toBe(1n);
    expect(loader.sessionDisposals).toBe(1);
  });

  it("advertises and internally enforces its close settlement bound", async () => {
    const input = startInput("application_v1");
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      () => new Promise(() => undefined),
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 5,
    }).start(input));

    expect(session.maximumCloseMilliseconds).toBe(5);
    const failure = await Effect.runPromise(session.close.pipe(Effect.flip));
    expect(failure).toMatchObject({ operation: "close", reason: "cleanupFailed" });
    expect(loader.sessionDisposals).toBe(1);
  });
});

function startInput(
  generation: "application_v1" | "legacy_dynamic_worker_v1",
  maximumDurationMs = 30_000,
): TaskWorkerSessionHostStartInput {
  return generation === "application_v1"
    ? {
        generation,
        definition: applicationDefinition(maximumDurationMs),
        request: applicationRequest(maximumDurationMs),
        capability: Object.freeze({ read: async () => null }),
        executionId: "execution-1",
      }
    : {
        generation,
        definition: legacyDefinition(maximumDurationMs),
        request: legacyRequest(maximumDurationMs),
        capability: Object.freeze({ read: async () => null }),
        executionId: "execution-1",
      };
}

function remoteSession(
  start: TaskWorkerSessionHostStartInput,
  settlement: Promise<unknown>,
  interrupt?: (request: unknown) => unknown,
): unknown {
  return remoteSessionValue(start, settlement, undefined, interrupt);
}

function remoteSessionValue(
  start: TaskWorkerSessionHostStartInput,
  settlement: Promise<unknown>,
  owner?: FakeWorkerLoader,
  interrupt?: (request: unknown) => unknown,
): unknown {
  const acceptance = acceptanceFor(start);
  return Object.assign({
    acceptance: async () => acceptance,
    requestInterruption: async (request: unknown) => {
      if (owner !== undefined) owner.interruptionCalls += 1;
      const requested = request as {
        readonly cancellationGeneration: bigint;
        readonly reason: "cancellation_requested" | "maximum_duration" | "host_shutdown";
      };
      return interrupt?.(request) ?? interruptionFor(
        start,
        requested.cancellationGeneration,
        true,
        requested.reason,
      );
    },
    settlement: () => settlement,
  }, owner === undefined ? {} : {
    [Symbol.dispose]: () => { owner.sessionDisposals += 1; },
  });
}

function acceptanceFor(start: TaskWorkerSessionHostStartInput) {
  return {
    format: TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
    version: TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
    kind: "accepted" as const,
    generation: start.generation,
    identity: (start.request as ReturnType<typeof applicationRequest>).dispatch.identity,
    executionId: start.executionId,
    cancellationGeneration: 0n,
  };
}

function interruptionFor(
  start: TaskWorkerSessionHostStartInput,
  cancellationGeneration: bigint,
  acceptance = true,
  reason: "cancellation_requested" | "maximum_duration" | "host_shutdown" =
    "cancellation_requested",
) {
  return {
    format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
    version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
    ...(acceptance ? { kind: "interruption_requested" as const } : {}),
    generation: start.generation,
    identity: (start.request as ReturnType<typeof applicationRequest>).dispatch.identity,
    executionId: start.executionId,
    cancellationGeneration,
    reason,
  };
}

function settlementFor(acceptance: ReturnType<typeof acceptanceFor>) {
  return {
    format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
    version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
    kind: "settled" as const,
    generation: acceptance.generation,
    identity: acceptance.identity,
    executionId: acceptance.executionId,
    outcome: {
      kind: "failed" as const,
      failure: { code: "handler_failed" as const, message: null },
    },
  };
}

function settlementForAcceptance(start: TaskWorkerSessionHostStartInput) {
  return settlementFor(acceptanceFor(start));
}

function interruptedSettlementFor(
  acceptance: ReturnType<typeof acceptanceFor>,
  cancellationGeneration: bigint,
  reason: "cancellation_requested" | "maximum_duration" | "host_shutdown",
) {
  return {
    format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
    version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
    kind: "settled" as const,
    generation: acceptance.generation,
    identity: acceptance.identity,
    executionId: acceptance.executionId,
    outcome: {
      kind: "interrupted" as const,
      interruption: { cancellationGeneration, reason },
    },
  };
}

function applicationDefinition(wallMilliseconds = 30_000): ApplicationTaskWorkerDefinition {
  return Object.freeze({
    runtimeTargetSha256Hex: "07".repeat(32),
    computeProfile: "standard-1x",
    compatibilityDate: "2026-06-14",
    wallMilliseconds,
    limits: Object.freeze({ cpuMs: 10_000, subRequests: 0 }),
    mainModule: "application.js",
    modules: Object.freeze({ "application.js": "export default {};" }),
    env: Object.freeze({}),
    entrypoint: "FlarexApplicationTaskWorker",
  });
}

function legacyDefinition(wallMilliseconds = 30_000): LegacyTaskWorkerDefinition {
  return Object.freeze({
    taskDefinitionRevisionId: "taskdef_00000000-0000-4000-8000-000000000004",
    computeProfile: "standard-1x",
    compatibilityDate: "2026-06-14",
    compatibilityFlags: Object.freeze([
      "nodejs_compat",
      "nodejs_compat_populate_process_env",
    ]),
    wallMilliseconds,
    limits: Object.freeze({ cpuMs: 10_000, subRequests: 0 }),
    mainModule: "application.js",
    modules: Object.freeze({ "application.js": "export default {};" }),
    env: Object.freeze({}),
    entrypoint: "FlarexLegacyTaskWorker",
  });
}

function applicationRequest(maximumDurationMs = 30_000) {
  return {
    format: APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
    dispatch: {
      ...dispatch(maximumDurationMs),
      applicationTaskRuntimeTargetSha256: new Uint8Array(32).fill(7),
    },
  };
}

function legacyRequest(maximumDurationMs = 30_000) {
  return {
    format: LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
    version: LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
    dispatch: {
      ...dispatch(maximumDurationMs),
      taskDefinitionRevisionId: "taskdef_00000000-0000-4000-8000-000000000004",
    },
  };
}

function dispatch(maximumDurationMs = 30_000) {
  return {
    version: "flarex.task-compute-dispatch-request.v1" as const,
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1" as const,
      scopeId: "scope_00000000-0000-4000-8000-000000000001",
      runId: "run_00000000-0000-4000-8000-000000000002",
      requestedEffectSequence: 1n,
      attemptId: "attempt_00000000-0000-4000-8000-000000000003",
      executionFence: 1n,
    },
    attemptNumber: 1,
    leaseVersion: 1n,
    computeProfile: "standard-1x",
    cancellation: { kind: "not_requested" as const, generation: 0n },
    maximumDurationMs,
  };
}

type Start = (
  start: TaskWorkerSessionHostStartInput,
  capability: unknown,
) => PromiseLike<unknown> | unknown;

class FakeWorkerLoader implements WorkerLoader {
  readonly loaded: WorkerLoaderWorkerCode[] = [];
  sessionDisposals = 0;
  interruptionCalls = 0;
  starts = 0;

  constructor(
    private readonly runStart: Start,
    private readonly synchronousLoadMilliseconds = 0,
  ) {}
  get(): WorkerStub { throw new Error("get forbidden"); }
  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loaded.push(code);
    const stopAt = performance.now() + this.synchronousLoadMilliseconds;
    while (performance.now() < stopAt) {
      // Deliberately consume synchronous cold-load wall time.
    }
    return new FakeWorkerStub(this, this.runStart);
  }
}

class FakeWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: FakeWorkerLoader,
    private readonly runStart: Start,
  ) {}
  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(): Fetcher<T> {
    const entrypoint = {
      start: async (request: unknown, capability: unknown) => {
        this.owner.starts += 1;
        const start = request as TaskWorkerSessionHostStartInput;
        const value = await this.runStart(start, capability);
        if (value !== null && (typeof value === "object" || typeof value === "function") &&
          !(Symbol.dispose in value)) {
          Object.defineProperty(value, Symbol.dispose, {
            value: () => { this.owner.sessionDisposals += 1; },
          });
        }
        return value;
      },
    };
    return entrypoint as unknown as Fetcher<T>;
  }
  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Durable Objects forbidden");
  }
}

class FailingEntrypointWorkerStub implements WorkerStub {
  constructor(private readonly cause: Error) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(): Fetcher<T> {
    throw this.cause;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Durable Objects forbidden");
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return Object.freeze({ promise, resolve });
}
