import { describe, expect, it } from "vitest";

import {
  createRequestScopedExecutorWorker,
  HostedExecutorErrorResponse,
  type ExecutorCleanupErrorInput,
  type ExecutorDatabaseClient,
  type ExecutorRequestHandler,
  type ExecutorWorkerEnv,
} from "../src/requestLifecycle";

const authorizedRequest = (): Request =>
  new Request("https://flarex-executor.internal/invoke/start", {
    method: "POST",
    headers: { authorization: "Bearer executor-secret" },
  });

const validEnv = {
  FLAREX_EXECUTOR_TOKEN: "executor-secret",
  HYPERDRIVE_CACHE_DISABLED: {
    connectionString: "postgres://hyperdrive.internal/flarex",
  },
} satisfies ExecutorWorkerEnv;

describe("request-scoped executor Worker lifecycle", () => {
  it("fails closed on missing configuration without allocating a client", async () => {
    const harness = createHarness();

    const missingToken = await harness.worker.fetch(authorizedRequest(), {
      HYPERDRIVE_CACHE_DISABLED: validEnv.HYPERDRIVE_CACHE_DISABLED,
    });
    expect(missingToken.status).toBe(500);
    await expect(missingToken.json()).resolves.toEqual({
      error: "executor_misconfigured",
      message: "FLAREX_EXECUTOR_TOKEN is required for hosted executor requests.",
    });

    const missingHyperdrive = await harness.worker.fetch(authorizedRequest(), {
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    });
    expect(missingHyperdrive.status).toBe(500);
    await expect(missingHyperdrive.json()).resolves.toEqual({
      error: "executor_misconfigured",
      message:
        "HYPERDRIVE_CACHE_DISABLED with a connection string is required for hosted executor requests.",
    });
    expect(harness.clients).toHaveLength(0);
    expect(harness.events).toEqual([]);
  });

  it.each([
    ["missing", undefined],
    ["wrong", "Bearer wrong-secret"],
    ["wrong scheme", "Basic executor-secret"],
  ])("rejects %s authorization before client allocation", async (_, authorization) => {
    const harness = createHarness();
    const request = new Request(
      "https://flarex-executor.internal/invoke/start",
      {
        method: "POST",
        ...(authorization === undefined
          ? {}
          : { headers: { authorization } }),
      },
    );

    const response = await harness.worker.fetch(request, validEnv);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Unauthorized Flarex executor request.",
    });
    expect(harness.clients).toHaveLength(0);
    expect(harness.events).toEqual([]);
  });

  it("creates, connects, uses, and closes exactly one client per Fetch", async () => {
    const harness = createHarness({
      handler: async () => Response.json({ status: "ok" }),
    });

    const first = await harness.worker.fetch(authorizedRequest(), validEnv);
    const second = await harness.worker.fetch(authorizedRequest(), validEnv);

    await expect(first.json()).resolves.toEqual({ status: "ok" });
    await expect(second.json()).resolves.toEqual({ status: "ok" });
    expect(harness.clients).toHaveLength(2);
    expect(harness.events).toEqual([
      "create:postgres://hyperdrive.internal/flarex",
      "connect:1",
      "handler:1:executor-secret",
      "end:1",
      "create:postgres://hyperdrive.internal/flarex",
      "connect:2",
      "handler:2:executor-secret",
      "end:2",
    ]);
  });

  it("attempts cleanup after connect failure and preserves that primary error", async () => {
    const connectError = new Error("connect failed");
    const harness = createHarness({ connectError });

    await expect(
      harness.worker.fetch(authorizedRequest(), validEnv),
    ).rejects.toBe(connectError);
    expect(harness.events).toEqual([
      "create:postgres://hyperdrive.internal/flarex",
      "connect:1",
      "end:1",
    ]);
  });

  it("attempts cleanup after handler failure and preserves that primary error", async () => {
    const handlerError = new Error("handler failed");
    const harness = createHarness({
      handler: () => Promise.reject(handlerError),
    });

    await expect(
      harness.worker.fetch(authorizedRequest(), validEnv),
    ).rejects.toBe(handlerError);
    expect(harness.events).toEqual([
      "create:postgres://hyperdrive.internal/flarex",
      "connect:1",
      "handler:1:executor-secret",
      "end:1",
    ]);
  });

  it("reports secondary cleanup failure without masking the primary error", async () => {
    const handlerError = new Error("handler failed");
    const cleanupError = new Error("cleanup failed");
    const harness = createHarness({
      handler: () => Promise.reject(handlerError),
      cleanupError,
      throwFromCleanupReporter: true,
    });

    await expect(
      harness.worker.fetch(authorizedRequest(), validEnv),
    ).rejects.toBe(handlerError);
    expect(harness.cleanupErrors).toEqual([
      { primaryError: handlerError, cleanupError },
    ]);
  });

  it("awaits a rejecting async cleanup reporter without masking the primary error", async () => {
    const handlerError = new Error("handler failed");
    const cleanupError = new Error("cleanup failed");
    const harness = createHarness({
      handler: () => Promise.reject(handlerError),
      cleanupError,
      rejectFromCleanupReporter: true,
    });

    await expect(
      harness.worker.fetch(authorizedRequest(), validEnv),
    ).rejects.toBe(handlerError);
    expect(harness.cleanupErrors).toEqual([
      { primaryError: handlerError, cleanupError },
    ]);
  });

  it("preserves a protocol error response when cleanup also fails", async () => {
    const cleanupError = new Error("cleanup failed");
    const harness = createHarness({
      handler: async () =>
        Response.json({ error: "occ_conflict" }, { status: 409 }),
      cleanupError,
    });

    const response = await harness.worker.fetch(authorizedRequest(), validEnv);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "occ_conflict" });
    const reported = harness.cleanupErrors[0];
    expect(reported?.cleanupError).toBe(cleanupError);
    expect(reported?.primaryError).toBeInstanceOf(HostedExecutorErrorResponse);
    if (!(reported?.primaryError instanceof HostedExecutorErrorResponse)) {
      throw new Error("Expected a hosted executor response failure.");
    }
    expect(reported.primaryError.status).toBe(409);
  });

  it("surfaces cleanup failure when the request otherwise succeeds", async () => {
    const cleanupError = new Error("cleanup failed");
    const harness = createHarness({ cleanupError });

    await expect(
      harness.worker.fetch(authorizedRequest(), validEnv),
    ).rejects.toBe(cleanupError);
    expect(harness.cleanupErrors).toEqual([]);
  });
});

interface HarnessOptions {
  readonly connectError?: Error;
  readonly cleanupError?: Error;
  readonly handler?: ExecutorRequestHandler;
  readonly rejectFromCleanupReporter?: boolean;
  readonly throwFromCleanupReporter?: boolean;
}

interface Harness {
  readonly worker: ReturnType<typeof createRequestScopedExecutorWorker<TestClient>>;
  readonly clients: TestClient[];
  readonly events: string[];
  readonly cleanupErrors: ExecutorCleanupErrorInput[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const clients: TestClient[] = [];
  const events: string[] = [];
  const cleanupErrors: ExecutorCleanupErrorInput[] = [];
  const worker = createRequestScopedExecutorWorker({
    createClient: (connectionString) => {
      events.push(`create:${connectionString}`);
      const client = new TestClient(
        clients.length + 1,
        events,
        options.connectError,
        options.cleanupError,
      );
      clients.push(client);
      return client;
    },
    createHandler: ({ client, capabilityToken }) => async (request) => {
      events.push(`handler:${client.id}:${capabilityToken}`);
      return await (options.handler ?? defaultHandler)(request);
    },
    onCleanupError: (input) => {
      cleanupErrors.push(input);
      if (options.rejectFromCleanupReporter === true) {
        return Promise.reject(new Error("async cleanup reporter failed"));
      }
      if (options.throwFromCleanupReporter === true) {
        throw new Error("cleanup reporter failed");
      }
    },
  });
  return { worker, clients, events, cleanupErrors };
}

class TestClient implements ExecutorDatabaseClient {
  constructor(
    readonly id: number,
    private readonly events: string[],
    private readonly connectError: Error | undefined,
    private readonly cleanupError: Error | undefined,
  ) {}

  async connect(): Promise<void> {
    this.events.push(`connect:${this.id}`);
    if (this.connectError !== undefined) throw this.connectError;
  }

  async end(): Promise<void> {
    this.events.push(`end:${this.id}`);
    if (this.cleanupError !== undefined) throw this.cleanupError;
  }
}

async function defaultHandler(): Promise<Response> {
  return Response.json({ status: "ok" });
}
