import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  FX02B_HOST_WORKER,
  FX02B_SOURCE_WORKER,
  type HostedReceiptCommandExecutor,
  type HostedReceiptFetch,
  HostedReceiptRunnerError,
  runHostedReceipt,
  type WranglerCommandResult,
} from "../scripts/hostedReceiptRunner";
import {
  decodeFx02bInitialHostedReceipt,
} from "../src/hostedReceiptProtocol";

const RUN_ID = "0123456789abcdef01234567";
const INITIAL_MARKER = `fx02b-${RUN_ID}-initial`;
const RESTART_MARKER = `fx02b-${RUN_ID}-restart`;
const HOST_URL = `https://${FX02B_HOST_WORKER}.example.workers.dev`;
const OPTIONS = Object.freeze({
  maximumRestartProbes: 3,
  restartProbeDelayMilliseconds: 0,
  requestTimeoutMilliseconds: 25,
  overallTimeoutMilliseconds: 2_000,
});
const IDENTITY = Object.freeze({
  runId: RUN_ID,
  initialMarker: INITIAL_MARKER,
  restartMarker: RESTART_MARKER,
  gatewayToken: "g".repeat(43),
  probeToken: "p".repeat(43),
  executorToken: "e".repeat(43),
});

describe("FX02-B hosted receipt protocol", () => {
  it("requires the exact object identity and rejects excess properties", () => {
    const exact = initialReceipt();
    expect(Result.isSuccess(decodeFx02bInitialHostedReceipt(exact))).toBe(true);
    expect(Result.isFailure(decodeFx02bInitialHostedReceipt({
      ...exact,
      objectName: "deployment-sync:wrong",
    }))).toBe(true);
    expect(Result.isFailure(decodeFx02bInitialHostedReceipt({
      ...exact,
      unexpected: true,
    }))).toBe(true);
  });
});

describe("FX02-B hosted receipt runner", () => {
  it("returns success only after namespace and Worker absence are proven", async () => {
    const harness = makeCommandHarness();
    const responses = [
      new Response(null, { status: 401 }),
      jsonResponse(initialReceipt()),
      jsonResponse(identityReceipt(INITIAL_MARKER, "boot-initial", "version-initial")),
      jsonResponse(identityReceipt(RESTART_MARKER, "boot-restart", "version-restart")),
      jsonResponse(restartReceipt()),
    ];
    const receipt = await Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, () => {
        const response = responses.shift();
        return response === undefined
          ? Promise.reject(new Error("Unexpected hosted request."))
          : Promise.resolve(response);
      }),
      IDENTITY,
      OPTIONS,
    ));

    expect(receipt).toMatchObject({
      kind: "fx02b-hosted-restart-receipt",
      restartAttempts: 2,
      teardown: {
        hostNamespaceDeleted: true,
        hostWorkerAbsent: true,
        sourceWorkerAbsent: true,
      },
    });
    expect(harness.exists()).toEqual({ host: false, source: false });
    expect(harness.calls).toContain(
      `delete ${FX02B_HOST_WORKER} --config wrangler.host.teardown.jsonc`,
    );
    expect(harness.calls).toContain(
      `delete ${FX02B_SOURCE_WORKER} --config wrangler.source.jsonc`,
    );
  });

  it("rejects invalid destructive identity before any command", async () => {
    const harness = makeCommandHarness();
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, () =>
        Promise.reject(new Error("Fetch must not run."))
      ),
      { ...IDENTITY, runId: "" },
      OPTIONS,
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      operation: "validateIdentity",
      reason: "invalidConfiguration",
    });
    expect(harness.calls).toEqual([]);
  });

  it("aborts a stalled request and still tears down both owned Workers", async () => {
    const harness = makeCommandHarness();
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, stalledFetch),
      IDENTITY,
      { ...OPTIONS, requestTimeoutMilliseconds: 5 },
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      reason: "hostedRequestFailed",
    });
    expect(harness.exists()).toEqual({ host: false, source: false });
  });

  it("cancels a stalled success body before teardown", async () => {
    const harness = makeCommandHarness();
    let bodyCancelled = false;
    const stalledBody = new ReadableStream<Uint8Array>({
      cancel: () => {
        bodyCancelled = true;
      },
    });
    const responses = [
      new Response(null, { status: 401 }),
      new Response(stalledBody, { status: 200 }),
    ];
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, () => {
        const response = responses.shift();
        return response === undefined
          ? Promise.reject(new Error("Unexpected hosted request."))
          : Promise.resolve(response);
      }),
      IDENTITY,
      { ...OPTIONS, requestTimeoutMilliseconds: 5 },
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      reason: "hostedRequestFailed",
    });
    expect(bodyCancelled).toBe(true);
    expect(harness.exists()).toEqual({ host: false, source: false });
  });

  it("observes a rejecting stream cancellation without escaping cleanup", async () => {
    const harness = makeCommandHarness();
    let cancelAttempted = false;
    const stalledBody = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelAttempted = true;
        return Promise.reject(new Error("hostile cancel rejection"));
      },
    });
    const responses = [
      new Response(null, { status: 401 }),
      new Response(stalledBody, { status: 200 }),
    ];
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, () => {
        const response = responses.shift();
        return response === undefined
          ? Promise.reject(new Error("Unexpected hosted request."))
          : Promise.resolve(response);
      }),
      IDENTITY,
      { ...OPTIONS, requestTimeoutMilliseconds: 5 },
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      reason: "hostedRequestFailed",
    });
    expect(cancelAttempted).toBe(true);
    expect(harness.exists()).toEqual({ host: false, source: false });
  });

  it("reconciles an ambiguous source deployment before cleanup", async () => {
    const harness = makeCommandHarness({ ambiguousSourceDeploy: true });
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, () =>
        Promise.reject(new Error("Fetch must not run."))
      ),
      IDENTITY,
      OPTIONS,
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      reason: "commandFailed",
    });
    expect(harness.exists()).toEqual({ host: false, source: false });
    expect(harness.calls).toContain(
      "deployments list --config wrangler.source.jsonc --json",
    );
    expect(harness.calls).toContain(
      `delete ${FX02B_SOURCE_WORKER} --config wrangler.source.jsonc`,
    );
  });

  it("deletes the source when a failed host deploy reconciles absent", async () => {
    const harness = makeCommandHarness({ failHostDeployAbsent: true });
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, () =>
        Promise.reject(new Error("Fetch must not run."))
      ),
      IDENTITY,
      OPTIONS,
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      reason: "commandFailed",
    });
    expect(harness.exists()).toEqual({ host: false, source: false });
    expect(harness.calls).toContain(
      "deployments list --config wrangler.host.jsonc --json",
    );
  });

  it("does not retry a malformed receipt from the expected restart release", async () => {
    const harness = makeCommandHarness();
    let restartRequests = 0;
    const responses = [
      new Response(null, { status: 401 }),
      jsonResponse(initialReceipt()),
    ];
    const fetchValue: HostedReceiptFetch = (_input, _init) => {
      const response = responses.shift();
      if (response !== undefined) return Promise.resolve(response);
      restartRequests += 1;
      return Promise.resolve(jsonResponse({
        ...identityReceipt(RESTART_MARKER, "boot-restart", "version-restart"),
        unexpected: true,
      }));
    };
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, fetchValue),
      IDENTITY,
      OPTIONS,
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      reason: "invalidReceipt",
    });
    expect(restartRequests).toBe(1);
    expect(harness.exists()).toEqual({ host: false, source: false });
  });

  it("does not retry a terminal Durable Object RPC rejection", async () => {
    const harness = makeCommandHarness();
    let identityRequests = 0;
    const responses = [
      new Response(null, { status: 401 }),
      jsonResponse(initialReceipt()),
    ];
    const fetchValue: HostedReceiptFetch = (_input, _init) => {
      const response = responses.shift();
      if (response !== undefined) return Promise.resolve(response);
      identityRequests += 1;
      return Promise.resolve(jsonResponse({
        error: "probe_rpc_failed",
        classification: "durable_object_rpc_rejected",
      }, 500, { "x-flarex-probe-classification": "durable_object_rpc_rejected" }));
    };
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, fetchValue),
      IDENTITY,
      OPTIONS,
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      reason: "hostedRequestFailed",
      message: "Hosted probe returned terminal status 500 (durable_object_rpc_rejected).",
    });
    expect(identityRequests).toBe(1);
    expect(harness.exists()).toEqual({ host: false, source: false });
  });

  it("retains the source when host namespace teardown fails", async () => {
    const harness = makeCommandHarness({ failHostTeardown: true });
    const responses = [
      new Response(null, { status: 401 }),
      jsonResponse(initialReceipt()),
      jsonResponse(identityReceipt(RESTART_MARKER, "boot-restart", "version-restart")),
      jsonResponse(restartReceipt()),
    ];
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, () => {
        const response = responses.shift();
        return response === undefined
          ? Promise.reject(new Error("Unexpected hosted request."))
          : Promise.resolve(response);
      }),
      IDENTITY,
      OPTIONS,
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      reason: "cleanupFailed",
    });
    expect(harness.exists()).toEqual({ host: true, source: true });
    expect(harness.calls).not.toContain(
      `delete ${FX02B_SOURCE_WORKER} --config wrangler.source.jsonc`,
    );
  });

  it("reconciles remotely completed teardown and deletes after local failures", async () => {
    const harness = makeCommandHarness({ ambiguousCleanupCompletion: true });
    const responses = [
      new Response(null, { status: 401 }),
      jsonResponse(initialReceipt()),
      jsonResponse(identityReceipt(RESTART_MARKER, "boot-restart", "version-restart")),
      jsonResponse(restartReceipt()),
    ];
    const receipt = await Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, () => {
        const response = responses.shift();
        return response === undefined
          ? Promise.reject(new Error("Unexpected hosted request."))
          : Promise.resolve(response);
      }),
      IDENTITY,
      OPTIONS,
    ));
    expect(receipt.teardown).toEqual({
      hostNamespaceDeleted: true,
      hostWorkerAbsent: true,
      sourceWorkerAbsent: true,
    });
    expect(harness.exists()).toEqual({ host: false, source: false });
  });

  it("refuses destructive cleanup after current host ownership changes", async () => {
    const harness = makeCommandHarness({ foreignHostAtCleanup: true });
    const responses = [
      new Response(null, { status: 401 }),
      jsonResponse(initialReceipt()),
      jsonResponse(identityReceipt(RESTART_MARKER, "boot-restart", "version-restart")),
      jsonResponse(restartReceipt()),
    ];
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, () => {
        const response = responses.shift();
        return response === undefined
          ? Promise.reject(new Error("Unexpected hosted request."))
          : Promise.resolve(response);
      }),
      IDENTITY,
      OPTIONS,
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      reason: "cleanupFailed",
    });
    expect(harness.exists()).toEqual({ host: true, source: true });
    expect(harness.calls).not.toContain(
      `delete ${FX02B_HOST_WORKER} --config wrangler.host.teardown.jsonc`,
    );
  });

  it("does not accept a generic not-found response as Worker absence", async () => {
    const harness = makeCommandHarness({ ambiguousAbsence: true });
    await expect(Effect.runPromise(runHostedReceipt(
      dependencies(harness.commands, () =>
        Promise.reject(new Error("Fetch must not run."))
      ),
      IDENTITY,
      OPTIONS,
    ))).rejects.toMatchObject({
      _tag: "HostedReceiptRunnerError",
      reason: "ownershipUnknown",
    });
    expect(harness.calls).toHaveLength(2);
  });
});

interface CommandHarness {
  readonly commands: HostedReceiptCommandExecutor;
  readonly calls: string[];
  readonly exists: () => Readonly<{ readonly host: boolean; readonly source: boolean }>;
}

function makeCommandHarness(
  options: Readonly<{
    readonly ambiguousSourceDeploy?: boolean;
    readonly ambiguousAbsence?: boolean;
    readonly ambiguousCleanupCompletion?: boolean;
    readonly failHostDeployAbsent?: boolean;
    readonly failHostTeardown?: boolean;
    readonly foreignHostAtCleanup?: boolean;
  }> = {},
): CommandHarness {
  const calls: string[] = [];
  let sourceExists = false;
  let hostExists = false;
  let sourceMessage: string | undefined;
  let hostMessage: string | undefined;
  let sourceDeployAttempted = false;
  const commands: HostedReceiptCommandExecutor = {
    run: args => {
      calls.push(args.join(" "));
      if (args[0] === "whoami") {
        return Effect.succeed(result(0, "Account ID: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
      }
      const config = readArgument(args, "--config");
      if (args[0] === "deployments" && args[1] === "list") {
        const source = config === "wrangler.source.jsonc";
        const exists = source ? sourceExists : hostExists;
        const worker = source ? FX02B_SOURCE_WORKER : FX02B_HOST_WORKER;
        const message = source ? sourceMessage : hostMessage;
        if (!exists) return Effect.succeed(result(
          1,
          options.ambiguousAbsence
            ? "The selected account was not found."
            : absentOutput(worker),
        ));
        return Effect.succeed(args.includes("--json")
          ? result(0, JSON.stringify([{
            annotations: { "workers/message": message },
          }]))
          : result(0, "deployment exists"));
      }
      if (args[0] === "deploy" && config === "wrangler.source.jsonc") {
        sourceExists = true;
        sourceMessage = readArgument(args, "--message");
        sourceDeployAttempted = true;
        return Effect.succeed(options.ambiguousSourceDeploy
          ? result(1, "local connection ended after upload")
          : result(0, "source deployed"));
      }
      if (args[0] === "deploy" && config === "wrangler.host.jsonc") {
        if (options.failHostDeployAbsent) {
          return Effect.succeed(result(1, "host upload failed before creation"));
        }
        hostExists = true;
        hostMessage = readArgument(args, "--message");
        if (
          options.foreignHostAtCleanup
          && hostMessage?.includes(" restart ") === true
        ) hostMessage = "FX02-B isolated host restart ffffffffffffffffffffffff";
        return Effect.succeed(result(0, `host deployed ${HOST_URL}`));
      }
      if (args[0] === "deploy" && config === "wrangler.host.teardown.jsonc") {
        if (options.failHostTeardown) {
          return Effect.succeed(result(1, "namespace deletion failed"));
        }
        hostMessage = readArgument(args, "--message");
        return Effect.succeed(options.ambiguousCleanupCompletion
          ? result(1, "local response lost after namespace deletion deployed")
          : result(0, "namespace deletion deployed"));
      }
      if (args[0] === "delete" && args[1] === FX02B_HOST_WORKER) {
        hostExists = false;
        hostMessage = undefined;
        return Effect.succeed(options.ambiguousCleanupCompletion
          ? result(1, "local response lost after host deletion")
          : result(0, "host deleted"));
      }
      if (args[0] === "delete" && args[1] === FX02B_SOURCE_WORKER) {
        sourceExists = false;
        sourceMessage = undefined;
        return Effect.succeed(options.ambiguousCleanupCompletion
          ? result(1, "local response lost after source deletion")
          : result(0, "source deleted"));
      }
      return Effect.fail(new HostedReceiptRunnerError({
        operation: "testCommand",
        reason: "commandFailed",
        message: `Unexpected command after source attempt ${sourceDeployAttempted}: ${args.join(" ")}`,
      }));
    },
  };
  return {
    commands,
    calls,
    exists: () => Object.freeze({ host: hostExists, source: sourceExists }),
  };
}

function dependencies(
  commands: HostedReceiptCommandExecutor,
  fetchValue: HostedReceiptFetch,
) {
  return Object.freeze({ commands, fetch: fetchValue, stage: () => {} });
}

const stalledFetch: HostedReceiptFetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      reject(init.signal?.reason ?? new Error("aborted"));
    }, { once: true });
  });

function readArgument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function result(code: number, output: string): WranglerCommandResult {
  return Object.freeze({ code, output });
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function absentOutput(worker: string): string {
  return `A request to the Cloudflare API (/accounts/test/workers/scripts/${worker}/deployments) failed. This Worker does not exist on your account. [code: 10007]`;
}

function initialReceipt() {
  return Object.freeze({
    protocolVersion: 1,
    phase: "initialize",
    releaseMarker: INITIAL_MARKER,
    workerVersionId: "version-initial",
    objectName: "deployment-sync:93000000-0000-4000-8000-000000000001",
    bootId: "boot-initial",
    outcome: Object.freeze({
      state: "continuationRequired",
      reason: "admittedBatchLimitReached",
      cursor: "1",
    }),
  });
}

function restartReceipt() {
  return Object.freeze({
    protocolVersion: 1,
    phase: "resume",
    releaseMarker: RESTART_MARKER,
    workerVersionId: "version-restart",
    objectName: "deployment-sync:93000000-0000-4000-8000-000000000001",
    bootId: "boot-restart",
    outcome: Object.freeze({ state: "caughtUp", cursor: "2" }),
  });
}

function identityReceipt(
  releaseMarker: string,
  bootId: string,
  workerVersionId: string,
) {
  return Object.freeze({
    protocolVersion: 1,
    phase: "identity",
    releaseMarker,
    workerVersionId,
    objectName: "deployment-sync:93000000-0000-4000-8000-000000000001",
    bootId,
  });
}
