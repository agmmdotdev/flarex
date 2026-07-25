import { Data, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  createExecutorScheduledEventHost,
  type ExecutorScheduledEventCleanupErrorInput,
  type ExecutorScheduledEventHost,
} from "../src/scheduledLifecycle";
import type {
  ExecutorDatabaseClient,
  ExecutorWorkerEnv,
} from "../src/requestLifecycle";

const validEnv = {
  HYPERDRIVE_CACHE_DISABLED: {
    connectionString: "postgres://hyperdrive.internal/flarex",
  },
} satisfies ExecutorWorkerEnv;

class TestSchedulerRunV1Error
  extends Data.TaggedError("TestSchedulerRunV1Error")<{
    readonly reason: "failed";
  }> {}

describe("inert executor scheduled-event lifecycle", () => {
  it("disables platform retry for missing Hyperdrive before client allocation", async () => {
    const harness = createHarness();

    await expect(
      harness.host.scheduled(harness.controller, {}),
    ).rejects.toMatchObject({
      _tag: "HostedExecutorScheduledEventConfigurationV1Error",
      reason: "missingHyperdrive",
    });

    expect(harness.noRetryCalls).toBe(1);
    expect(harness.clients).toHaveLength(0);
    expect(harness.events).toEqual(["noRetry"]);
  });

  it("keeps the returned event promise pending through run and client cleanup", async () => {
    const runGate = deferred<void>();
    const endGate = deferred<void>();
    const harness = createHarness({
      run: () => Effect.promise(async () => {
        await runGate.promise;
        return completedResult();
      }),
      end: async () => {
        await endGate.promise;
      },
    });
    let settled = false;

    const scheduled = harness.host.scheduled(harness.controller, validEnv);
    scheduled.then(
      () => settled = true,
      () => settled = true,
    );
    await vi.waitFor(() => {
      expect(harness.events).toContain("run:1");
    });
    expect(settled).toBe(false);

    runGate.resolve();
    await vi.waitFor(() => {
      expect(harness.events).toContain("end:1");
    });
    expect(settled).toBe(false);

    endGate.resolve();
    await expect(scheduled).resolves.toBeUndefined();
    expect(settled).toBe(true);
    expect(harness.events).toEqual([
      "create:postgres://hyperdrive.internal/flarex",
      "connect:1",
      "run:1",
      "end:1",
    ]);
    expect(harness.noRetryCalls).toBe(0);
  });

  it("preserves a retryable run failure after deterministic client cleanup", async () => {
    const failure = new TestSchedulerRunV1Error({ reason: "failed" });
    const harness = createHarness({
      run: () => Effect.fail(failure),
    });

    await expect(
      harness.host.scheduled(harness.controller, validEnv),
    ).rejects.toBe(failure);

    expect(harness.events).toEqual([
      "create:postgres://hyperdrive.internal/flarex",
      "connect:1",
      "run:1",
      "end:1",
    ]);
    expect(harness.noRetryCalls).toBe(0);
  });

  it("attempts cleanup after connect failure and keeps platform retry enabled", async () => {
    const connectFailure = new Error("connect failed");
    const harness = createHarness({ connectFailure });

    await expect(
      harness.host.scheduled(harness.controller, validEnv),
    ).rejects.toMatchObject({
      _tag: "HostedExecutorScheduledEventDatabaseClientV1Error",
      operation: "connect",
      cause: connectFailure,
    });

    expect(harness.events).toEqual([
      "create:postgres://hyperdrive.internal/flarex",
      "connect:1",
      "end:1",
    ]);
    expect(harness.noRetryCalls).toBe(0);
  });

  it("reports secondary cleanup failure without replacing the run failure", async () => {
    const runFailure = new TestSchedulerRunV1Error({ reason: "failed" });
    const endFailure = new Error("end failed");
    const harness = createHarness({
      run: () => Effect.fail(runFailure),
      endFailure,
      cleanupReporterFailure: new Error("reporter failed"),
    });

    await expect(
      harness.host.scheduled(harness.controller, validEnv),
    ).rejects.toBe(runFailure);

    expect(harness.cleanupErrors).toHaveLength(1);
    expect(harness.cleanupErrors[0]?.cleanupError).toMatchObject({
      _tag: "HostedExecutorScheduledEventDatabaseClientV1Error",
      operation: "end",
      cause: endFailure,
    });
    expect(harness.noRetryCalls).toBe(0);
  });

  it("surfaces cleanup failure after a successful bounded run", async () => {
    const endFailure = new Error("end failed");
    const harness = createHarness({ endFailure });

    await expect(
      harness.host.scheduled(harness.controller, validEnv),
    ).rejects.toMatchObject({
      _tag: "HostedExecutorScheduledEventDatabaseClientV1Error",
      operation: "end",
      cause: endFailure,
    });

    expect(harness.cleanupErrors).toEqual([]);
    expect(harness.noRetryCalls).toBe(0);
  });

  it("runs duplicate platform wakes independently and exactly once per event", async () => {
    const harness = createHarness({
      run: (clientId) => Effect.succeed(
        clientId === 1
          ? completedResult()
          : Object.freeze({
            kind: "busy" as const,
            claimExpiresAt: new Date(60_000),
          }),
      ),
    });
    const duplicateController = scheduledController(harness.events);

    await Promise.all([
      harness.host.scheduled(harness.controller, validEnv),
      harness.host.scheduled(duplicateController, validEnv),
    ]);

    expect(harness.clients).toHaveLength(2);
    expect(harness.events.filter((event) => event.startsWith("run:")))
      .toEqual(["run:1", "run:2"]);
    for (const client of harness.clients) {
      const connect = harness.events.indexOf(`connect:${client.id}`);
      const run = harness.events.indexOf(`run:${client.id}`);
      const end = harness.events.indexOf(`end:${client.id}`);
      expect(connect).toBeGreaterThan(-1);
      expect(run).toBeGreaterThan(connect);
      expect(end).toBeGreaterThan(run);
    }
    expect(harness.noRetryCalls).toBe(0);
  });
});

interface HarnessOptions {
  readonly cleanupReporterFailure?: Error;
  readonly connectFailure?: Error;
  readonly end?: () => Promise<void>;
  readonly endFailure?: Error;
  readonly run?: (
    clientId: number,
  ) => Effect.Effect<unknown, TestSchedulerRunV1Error>;
}

interface Harness {
  readonly host: ExecutorScheduledEventHost;
  readonly controller: ScheduledController;
  readonly clients: TestClient[];
  readonly events: string[];
  readonly cleanupErrors: ExecutorScheduledEventCleanupErrorInput[];
  readonly noRetryCalls: number;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const clients: TestClient[] = [];
  const events: string[] = [];
  const cleanupErrors: ExecutorScheduledEventCleanupErrorInput[] = [];
  let noRetryCalls = 0;
  const controller = scheduledController(events, () => {
    noRetryCalls += 1;
  });
  const host = createExecutorScheduledEventHost({
    createClient: (connectionString) => {
      events.push(`create:${connectionString}`);
      const client = new TestClient(
        clients.length + 1,
        events,
        options,
      );
      clients.push(client);
      return client;
    },
    createRun: ({ client }) => Object.freeze({
      runEffect: () => {
        events.push(`run:${client.id}`);
        return options.run?.(client.id) ?? Effect.succeed(completedResult());
      },
    }),
    onCleanupError: (input) => {
      cleanupErrors.push(input);
      if (options.cleanupReporterFailure !== undefined) {
        throw options.cleanupReporterFailure;
      }
    },
  });
  return {
    host,
    controller,
    clients,
    events,
    cleanupErrors,
    get noRetryCalls() {
      return noRetryCalls;
    },
  };
}

class TestClient implements ExecutorDatabaseClient {
  constructor(
    readonly id: number,
    private readonly events: string[],
    private readonly options: HarnessOptions,
  ) {}

  async connect(): Promise<void> {
    this.events.push(`connect:${this.id}`);
    if (this.options.connectFailure !== undefined) {
      throw this.options.connectFailure;
    }
  }

  async end(): Promise<void> {
    this.events.push(`end:${this.id}`);
    if (this.options.end !== undefined) await this.options.end();
    if (this.options.endFailure !== undefined) {
      throw this.options.endFailure;
    }
  }
}

function scheduledController(
  events: string[],
  onNoRetry: () => void = () => undefined,
): ScheduledController {
  return Object.freeze({
    scheduledTime: 0,
    cron: "0 * * * *",
    noRetry: () => {
      events.push("noRetry");
      onNoRetry();
    },
  });
}

function completedResult(): Readonly<{
  readonly kind: "completed";
  readonly reason: "continuationExhausted";
  readonly invocations: 1;
  readonly attemptPagesCharged: 0;
  readonly candidateAttemptsCharged: 0;
  readonly batches: ReadonlyArray<never>;
  readonly nextRunAt: Date;
}> {
  return Object.freeze({
    kind: "completed",
    reason: "continuationExhausted",
    invocations: 1,
    attemptPagesCharged: 0,
    candidateAttemptsCharged: 0,
    batches: Object.freeze([]),
    nextRunAt: new Date(60_000),
  });
}

function deferred<Value>(): Readonly<{
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve: (value) => {
      if (resolvePromise === undefined) {
        throw new Error("Deferred resolver was not initialized.");
      }
      resolvePromise(value);
    },
  });
}
