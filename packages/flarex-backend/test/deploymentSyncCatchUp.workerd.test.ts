import type { CheckpointBudget } from "@flarex/query-sync/internal/checkpoint";
import { Result } from "effect";
import { decodeCoreQueryCheckpointRequest, encodeCoreQueryCheckpointResponse,
  type CoreQueryCheckpointRequest } from "flarex-protocol/internal/core-query-checkpoint";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "vite";

const PROBE_TOKEN = "query-sync-probe-secret";
const EXECUTOR_TOKEN = "executor-secret";
const EPOCH = "92000000-0000-4000-8000-000000000001";
const SOURCE_ID = "ab".repeat(32);
const BUDGET: CheckpointBudget = Object.freeze({ sourceReads: 1, stateTransitions: 2, maximumElapsedMilliseconds: 10_000 });
interface SourceFixture {
  readonly through: bigint;
  readonly retainedFrom?: bigint;
  readonly sourceId?: string;
  readonly epochUuid?: string;
  readonly malformed?: boolean;
}
interface RuntimeOptions {
  readonly beforeResponse?: (request: CoreQueryCheckpointRequest, snapshot: SourceFixture) => Promise<void>;
  readonly probeToken?: string | null;
  readonly persistPath?: string;
  readonly executorToken?: string;
}
let workerBundle = "";
beforeAll(async () => { workerBundle = await bundleWorker(); }, 120_000);
afterAll(() => { workerBundle = ""; });

describe("DeploymentSyncDO fixed-target checkpoint in Workerd", () => {
  it("refuses disabled, unauthorized, malformed and misrouted probes", async () => {
    const scope = testScope(1);
    const sources = new Map([[scope, { through: 0n }]]);
    const disabled = makeRuntime(sources, { probeToken: null });
    const enabled = makeRuntime(sources);
    try {
      expect(await invoke(disabled, scope, probeRequest(scope, true))).toMatchObject({
        ok: false, error: { tag: "DeploymentSyncCatchUpProbeAuthorizationError", reason: "probeDisabled" },
      });
      expect(await invoke(enabled, scope, { ...probeRequest(scope, true), authorizationToken: "wrong" })).toMatchObject({
        ok: false, error: { tag: "DeploymentSyncCatchUpProbeAuthorizationError", reason: "unauthorized" },
      });
      expect(await invoke(enabled, scope, { ...probeRequest(scope, true), unexpected: true })).toMatchObject({
        ok: false, error: { tag: "DeploymentSyncCatchUpProbeRequestError", reason: "invalidRequest" },
      });
      expect(await invoke(enabled, testScope(2), probeRequest(scope, true))).toMatchObject({
        ok: false, error: { tag: "DeploymentCheckpointBindingError", reason: "routeScopeMismatch" },
      });
      expect(await invoke(enabled, scope, probeRequest(scope, false))).toMatchObject({
        ok: false, error: { tag: "CheckpointError", reason: "initializationRequired" },
      });
    } finally { await disabled.dispose(); await enabled.dispose(); }
  });

  it("bounds initialization, accepts sparse progress, and replays a lost response", async () => {
    const scope = testScope(3);
    const sources = new Map([[scope, { through: 6000n }]]);
    const runtime = makeRuntime(sources);
    try {
      expect(await invoke(runtime, scope, probeRequest(scope, true, { ...BUDGET, stateTransitions: 1 }))).toMatchObject({
        ok: true, value: { kind: "continuationRequired", reason: "stateTransitionLimitReached",
          progress: { sourceReads: 0, stateTransitions: 1, lastCheckpoint: null } },
      });
      const lost = await dispatch(runtime, scope, probeRequest(scope, false));
      expect(lost.status).toBe(200);
      await lost.body?.cancel();
      expect(await invoke(runtime, scope, probeRequest(scope, false))).toMatchObject({
        ok: true, value: { kind: "caughtUp", target: { position: "6000" }, checkpoint: { position: "6000" },
          progress: { sourceReads: 1, stateTransitions: 1 } },
      });
      sources.set(scope, { through: 40000n });
      expect(await invoke(runtime, scope, probeRequest(scope, false))).toMatchObject({
        ok: true, value: { kind: "caughtUp", target: { position: "40000" },
          progress: { sourceReads: 1, stateTransitions: 1, lastCheckpoint: { position: "40000" } } },
      });
    } finally { await runtime.dispose(); }
  });

  it("preserves history, source replacement and cursor-ahead refusals", async () => {
    const scope = testScope(4);
    const sources = new Map<string, SourceFixture>([[scope, { through: 1n }]]);
    const runtime = makeRuntime(sources);
    try {
      await invoke(runtime, scope, probeRequest(scope, true));
      sources.set(scope, { through: 5n, retainedFrom: 2n });
      expect(await invoke(runtime, scope, probeRequest(scope, false))).toMatchObject({
        ok: true, value: { kind: "resetRequired", reason: "historyUnavailable", progress: { lastCheckpoint: { position: "1" } } },
      });
      sources.set(scope, { through: 5n, sourceId: "cd".repeat(32) });
      expect(await invoke(runtime, scope, probeRequest(scope, false))).toMatchObject({
        ok: true, value: { kind: "resetRequired", reason: "sourceReplaced" },
      });
      sources.set(scope, { through: 5n, epochUuid: "92000000-0000-4000-8000-000000000002" });
      expect(await invoke(runtime, scope, probeRequest(scope, false))).toMatchObject({
        ok: true, value: { kind: "resetRequired", reason: "sourceReplaced" },
      });
      sources.set(scope, { through: 0n });
      expect(await invoke(runtime, scope, probeRequest(scope, false))).toMatchObject({
        ok: false, error: { tag: "CheckpointError", reason: "invalidCheckpoint" },
      });
    } finally { await runtime.dispose(); }
  });

  it("keeps an older overlapping target fixed without regressing durable progress or another scope", async () => {
    const scope = testScope(5);
    const other = testScope(6);
    const sources = new Map<string, SourceFixture>([[scope, { through: 1n }], [other, { through: 17n }]]);
    let openFirst: (() => void) | undefined;
    let markFirst: (() => void) | undefined;
    const held = new Promise<void>(resolve => { openFirst = resolve; });
    const entered = new Promise<void>(resolve => { markFirst = resolve; });
    const runtime = makeRuntime(sources, { beforeResponse: async (request, snapshot) => {
      if (request.route.scopeUuid === scope && snapshot.through === 6000n) { markFirst?.(); await held; }
    } });
    try {
      await invoke(runtime, scope, probeRequest(scope, true));
      sources.set(scope, { through: 6000n });
      const older = invoke(runtime, scope, probeRequest(scope, false));
      await entered;
      sources.set(scope, { through: 40000n });
      expect(await invoke(runtime, scope, probeRequest(scope, false))).toMatchObject({
        ok: true, value: { kind: "caughtUp", target: { position: "40000" }, checkpoint: { position: "40000" } },
      });
      expect(await invoke(runtime, other, probeRequest(other, true))).toMatchObject({
        ok: true, value: { kind: "caughtUp", checkpoint: { position: "17" } },
      });
      openFirst?.();
      expect(await older).toMatchObject({ ok: true, value: { kind: "caughtUp", target: { position: "6000" },
        checkpoint: { position: "40000" }, progress: { lastCheckpoint: { position: "40000" } } } });
    } finally { openFirst?.(); await runtime.dispose(); }
  });

  it("resumes a ready checkpoint across object reconstruction", async () => {
    const scope = testScope(7);
    const sources = new Map<string, SourceFixture>([[scope, { through: 6000n }]]);
    const persistPath = await mkdtemp(join(tmpdir(), "flarex-checkpoint-"));
    let first: Miniflare | undefined;
    let second: Miniflare | undefined;
    try {
      first = makeRuntime(sources, { persistPath });
      expect(await invoke(first, scope, probeRequest(scope, true))).toMatchObject({
        ok: true, value: { kind: "caughtUp", checkpoint: { position: "6000" } },
      });
      await first.dispose(); first = undefined;
      sources.set(scope, { through: 40000n });
      second = makeRuntime(sources, { persistPath });
      expect(await invoke(second, scope, probeRequest(scope, false))).toMatchObject({
        ok: true, value: { kind: "caughtUp", checkpoint: { position: "40000" }, progress: { stateTransitions: 1 } },
      });
    } finally {
      if (first !== undefined) await first.dispose();
      if (second !== undefined) await second.dispose();
      await rm(persistPath, { recursive: true, force: true });
    }
  });

  it.each(["position", "empty", "catalog"] as const)("refuses %s corruption without fresh fallback", async corrupt => {
    const scope = testScope(corrupt === "position" ? 8 : corrupt === "empty" ? 9 : 10);
    const runtime = makeRuntime(new Map([[scope, { through: 1n }]]));
    try {
      await invoke(runtime, scope, probeRequest(scope, true));
      await runtime.dispatchFetch("https://deployment-sync.test", { method: "POST", body: JSON.stringify({
        objectName: `deployment-sync:${scope}`, corrupt,
      }) });
      expect(await invoke(runtime, scope, probeRequest(scope, true))).toMatchObject({ ok: false,
        error: { tag: "CheckpointError", reason: corrupt === "catalog" ? "stateIncompatible" : "stateCorrupt" } });
    } finally { await runtime.dispose(); }
  });

  it("refuses an unauthenticated source and malformed source certificate", async () => {
    const scope = testScope(11);
    const sources = new Map<string, SourceFixture>([[scope, { through: 1n }]]);
    const unauthorized = makeRuntime(sources, { executorToken: "wrong-secret" });
    const malformed = makeRuntime(new Map([[scope, { through: 1n, malformed: true }]]));
    try {
      expect(await invoke(unauthorized, scope, probeRequest(scope, true))).toMatchObject({
        ok: false, error: { tag: "CheckpointError", reason: "sourceUnavailable" },
      });
      expect(await invoke(malformed, scope, probeRequest(scope, true))).toMatchObject({
        ok: false, error: { tag: "CheckpointError", reason: "invalidEvidence" },
      });
    } finally { await unauthorized.dispose(); await malformed.dispose(); }
  });

  it("preserves interruption and failed foreign body cleanup through the real probe boundary", async () => {
    const scope = testScope(12);
    const runtime = makeRuntime(new Map());
    try {
      const response = await runtime.dispatchFetch("https://deployment-sync.test", { method: "POST", body: JSON.stringify({
        operation: "probeInterruptedBodyCause", objectName: `deployment-sync:${scope}`, request: probeRequest(scope, true),
      }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ failed: true, interrupted: true, cleanupFailure: true });
    } finally { await runtime.dispose(); }
  });
});

function probeRequest(scopeUuid: string, authorizeFreshInitialization: boolean, budget: CheckpointBudget = BUDGET) {
  return { authorizationToken: PROBE_TOKEN, route: { deploymentId: "checkpoint-test", scopeUuid, epochUuid: EPOCH },
    budget, authorizeFreshInitialization };
}
function makeRuntime(sources: Map<string, SourceFixture>, options: RuntimeOptions = {}): Miniflare {
  const probeToken = options.probeToken === undefined ? PROBE_TOKEN : options.probeToken;
  return new Miniflare({ modules: [{ type: "ESModule", path: "worker.js", contents: workerBundle }],
    compatibilityDate: "2026-06-14",
    bindings: { FLAREX_EXECUTOR_TOKEN: options.executorToken ?? EXECUTOR_TOKEN,
      ...(probeToken === null ? {} : { FLAREX_QUERY_SYNC_PROBE_TOKEN: probeToken }) },
    serviceBindings: { FLAREX_EXECUTOR: (request: Request) => sourceResponse(request, sources, options.beforeResponse) },
    durableObjects: { DEPLOYMENT_SYNCS: { className: "DeploymentSyncDO", useSQLite: true } },
    ...(options.persistPath === undefined ? {} : { durableObjectsPersist: options.persistPath }) });
}
async function sourceResponse(request: Request, sources: Map<string, SourceFixture>, beforeResponse: RuntimeOptions["beforeResponse"]): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${EXECUTOR_TOKEN}`) return Response.json({}, { status: 401 });
  const json: unknown = await request.json();
  const decoded = unwrap(decodeCoreQueryCheckpointRequest(json));
  const source = sources.get(decoded.route.scopeUuid);
  if (source === undefined) return Response.json({}, { status: 404 });
  await beforeResponse?.(decoded, source);
  if (source.malformed) return Response.json({ kind: "certified" });
  const retainedFrom = source.retainedFrom ?? 0n;
  const sourceId = source.sourceId ?? SOURCE_ID;
  const epochUuid = source.epochUuid ?? EPOCH;
  const after = decoded.after === null ? null : BigInt(decoded.after);
  if (after !== null && after > source.through) return Response.json({ format: "flarex.core-application.failure", version: 1,
    error: { code: "invalid_checkpoint", message: "Invalid checkpoint" } }, { status: 409 });
  const kind = decoded.route.epochUuid !== epochUuid || decoded.sourceId !== null && decoded.sourceId !== sourceId
    ? "sourceReplaced" : after !== null && after < retainedFrom ? "historyUnavailable" : "certified";
  return Response.json(unwrap(encodeCoreQueryCheckpointResponse({ format: "flarex.core-query-checkpoint.response", version: 1,
    kind, route: { ...decoded.route, epochUuid }, sourceId, after: decoded.after,
    retainedFrom: retainedFrom.toString(), through: source.through.toString() })));
}
async function invoke(runtime: Miniflare, scopeUuid: string, request: unknown): Promise<unknown> {
  const response = await dispatch(runtime, scopeUuid, request);
  expect(response.status).toBe(200);
  return await response.json();
}
function dispatch(runtime: Miniflare, scopeUuid: string, request: unknown) {
  return runtime.dispatchFetch("https://deployment-sync.test", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ objectName: `deployment-sync:${scopeUuid}`, request }) });
}
function testScope(ordinal: number): string { return `91000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`; }
function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
async function bundleWorker(): Promise<string> {
  const backendDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
  const output = await build({ configFile: false, logLevel: "silent", plugins: [workspacePackageResolution()],
    build: { write: false, target: "es2022", lib: { entry: join(backendDirectory, "test/deploymentSyncCatchUp.workerd.worker.ts"),
      formats: ["es"], fileName: "worker" }, rolldownOptions: { external: ["cloudflare:workers"] } } });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => "output" in result ? result.output : []);
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (worker === undefined || worker.type !== "chunk") throw new Error("Checkpoint worker bundle missing");
  return worker.code;
}
function workspacePackageResolution(): Plugin {
  return { name: "flarex-checkpoint-test-resolution", resolveId(id) {
    if (id.startsWith("@flarex/") || id === "flarex-protocol" || id.startsWith("flarex-protocol/"))
      return fileURLToPath(import.meta.resolve(id));
    return undefined;
  } };
}
