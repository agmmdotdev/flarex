import {
  decodeQuerySyncSourceReadRequestV1,
  encodeQuerySyncSourceReadResponseV1,
  querySyncSourceReadMediaTypeV1,
} from "@flarex/executor-http/internal-query-sync-source-read-v1";
import type {
  CatchUpTurnBudget,
} from "@flarex/query-sync/internal/orchestration";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Result } from "effect";
import {
  CommitSeqSchema,
  decodeScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";
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
const REPLACEMENT_EPOCH = "92000000-0000-4000-8000-000000000002";

const BUDGET: CatchUpTurnBudget = Object.freeze({
  sourceReads: 32,
  admittedBatches: 4_096,
  sourceTransportBytes: 16 * 1_024 * 1_024,
  modelSemanticWorkUnits: 65_536,
  modelSemanticBytes: 16 * 1_024 * 1_024,
  dependencyKeyExaminations: 65_536,
  canonicalDependencyBytes: 16 * 1_024 * 1_024,
  newWorkWindowMilliseconds: 10_000,
});

type SourceMode = "page" | "historyUnavailable" | "epochReplaced";

interface SourceFixture {
  readonly mode: SourceMode;
  readonly epochUuid: string;
  readonly sequences: readonly bigint[];
}

let workerBundle: string;

beforeAll(async () => {
  workerBundle = await bundleWorker();
}, 120_000);

afterAll(() => {
  workerBundle = "";
});

describe("DeploymentSyncDO private catch-up host in Workerd", () => {
  it("fails closed when the probe is disabled, unauthorized, or malformed", async () => {
    const scope = testScope(1);
    const sources = new Map([[scope, pageSource(0n)]]);
    const disabled = makeRuntime(sources, { probeToken: null });
    const enabled = makeRuntime(sources);
    try {
      await expect(invoke(disabled, scope, probeRequest(scope, {
        authorizeFreshInitialization: true,
      }))).resolves.toEqual({
        ok: false,
        error: {
          tag: "DeploymentSyncCatchUpProbeAuthorizationError",
          reason: "probeDisabled",
        },
      });
      await expect(invoke(enabled, scope, {
        ...probeRequest(scope, { authorizeFreshInitialization: true }),
        authorizationToken: "wrong-secret",
      })).resolves.toEqual({
        ok: false,
        error: {
          tag: "DeploymentSyncCatchUpProbeAuthorizationError",
          reason: "unauthorized",
        },
      });
      await expect(invoke(enabled, scope, {
        ...probeRequest(scope, { authorizeFreshInitialization: true }),
        unexpected: true,
      })).resolves.toEqual({
        ok: false,
        error: {
          tag: "DeploymentSyncCatchUpProbeRequestError",
          reason: "invalidRequest",
        },
      });
    } finally {
      await disabled.dispose();
      await enabled.dispose();
    }
  });

  it("runs bounded contiguous catch-up and replays a lost response", async () => {
    const scope = testScope(2);
    const sources = new Map([[scope, pageSource(3n)]]);
    const runtime = makeRuntime(sources);
    try {
      const firstBudget = { ...BUDGET, admittedBatches: 2 };
      const lost = await dispatch(runtime, scope, probeRequest(scope, {
        authorizeFreshInitialization: true,
        budget: firstBudget,
      }));
      expect(lost.status).toBe(200);
      await expect(lost.json()).resolves.toMatchObject({
        ok: true,
        value: {
          _tag: "continuationRequired",
          reason: "admittedBatchLimitReached",
          progress: {
            admittedBatches: 2,
            lastDurableCursor: { appliedThroughSequence: "2" },
          },
        },
      });

      await expect(invoke(runtime, scope, probeRequest(scope, {
        authorizeFreshInitialization: false,
        budget: firstBudget,
      }))).resolves.toMatchObject({
        ok: true,
        value: {
          _tag: "caughtUp",
          cursor: { appliedThroughSequence: "3" },
          progress: {
            admittedBatches: 1,
            lastDurableCursor: { appliedThroughSequence: "3" },
          },
        },
      });

      await expect(invoke(runtime, scope, probeRequest(scope, {
        authorizeFreshInitialization: false,
      }))).resolves.toMatchObject({
        ok: true,
        value: {
          _tag: "caughtUp",
          cursor: { appliedThroughSequence: "3" },
          progress: {
            admittedBatches: 0,
            settledBatchTransitions: 0,
          },
        },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects a source gap and returns history and epoch evidence", async () => {
    const gapScope = testScope(3);
    const historyScope = testScope(4);
    const epochScope = testScope(5);
    const sources = new Map<string, SourceFixture>([
      [gapScope, {
        mode: "page",
        epochUuid: EPOCH,
        sequences: Object.freeze([2n]),
      }],
      [historyScope, {
        mode: "historyUnavailable",
        epochUuid: EPOCH,
        sequences: Object.freeze([1n, 2n]),
      }],
      [epochScope, {
        mode: "epochReplaced",
        epochUuid: REPLACEMENT_EPOCH,
        sequences: Object.freeze([]),
      }],
    ]);
    const runtime = makeRuntime(sources);
    try {
      await expect(invoke(runtime, gapScope, probeRequest(gapScope, {
        authorizeFreshInitialization: true,
      }))).resolves.toEqual({
        ok: false,
        error: {
          tag: "ChangeSourceCorruptionError",
          reason: "nonContiguousPage",
        },
      });
      await expect(invoke(runtime, historyScope, probeRequest(historyScope, {
        authorizeFreshInitialization: true,
      }))).resolves.toMatchObject({
        ok: true,
        value: { _tag: "historyUnavailable" },
      });
      await expect(invoke(runtime, epochScope, probeRequest(epochScope, {
        authorizeFreshInitialization: true,
      }))).resolves.toMatchObject({
        ok: true,
        value: {
          _tag: "epochReplaced",
          evidence: { source: "changeSource" },
        },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("proves same-scope overlap while isolating a second scope", async () => {
    const firstScope = testScope(6);
    const secondScope = testScope(7);
    const sources = new Map<string, SourceFixture>([
      [firstScope, pageSource(1n)],
      [secondScope, pageSource(2n)],
    ]);
    const sourceBarrier = makeTwoReadSourceBarrier(firstScope);
    const runtime = makeRuntime(sources, {
      beforeSourceResponse: sourceBarrier.beforeSourceResponse,
    });
    try {
      const [firstA, firstB, second] = await Promise.all([
        invoke(runtime, firstScope, probeRequest(firstScope, {
          authorizeFreshInitialization: true,
        })),
        invoke(runtime, firstScope, probeRequest(firstScope, {
          authorizeFreshInitialization: true,
        })),
        invoke(runtime, secondScope, probeRequest(secondScope, {
          authorizeFreshInitialization: true,
        })),
      ]);
      expect(firstA).toMatchObject({
        ok: true,
        value: { _tag: "caughtUp", cursor: { appliedThroughSequence: "1" } },
      });
      expect(firstB).toMatchObject({
        ok: true,
        value: { _tag: "caughtUp", cursor: { appliedThroughSequence: "1" } },
      });
      expect(second).toMatchObject({
        ok: true,
        value: { _tag: "caughtUp", cursor: { appliedThroughSequence: "2" } },
      });
      expect(sourceBarrier.requestedAfterCommitSeqExclusive).toEqual([0n, 0n]);
    } finally {
      await runtime.dispose();
    }
  });

  it("recovers persisted cursor state after object reconstruction", async () => {
    const scope = testScope(8);
    const sources = new Map<string, SourceFixture>([[scope, pageSource(2n)]]);
    const persistPath = await mkdtemp(join(tmpdir(), "flarex-fx02b-"));
    let first: Miniflare | undefined;
    let second: Miniflare | undefined;
    try {
      first = makeRuntime(sources, { persistPath });
      await expect(invoke(first, scope, probeRequest(scope, {
        authorizeFreshInitialization: true,
      }))).resolves.toMatchObject({
        ok: true,
        value: { _tag: "caughtUp", cursor: { appliedThroughSequence: "2" } },
      });
      await first.dispose();
      first = undefined;

      sources.set(scope, pageSource(3n));
      second = makeRuntime(sources, { persistPath });
      await expect(invoke(second, scope, probeRequest(scope, {
        authorizeFreshInitialization: false,
      }))).resolves.toMatchObject({
        ok: true,
        value: {
          _tag: "caughtUp",
          cursor: { appliedThroughSequence: "3" },
          progress: { admittedBatches: 1 },
        },
      });
    } finally {
      if (first !== undefined) await first.dispose();
      if (second !== undefined) await second.dispose();
      await rm(persistPath, { recursive: true, force: true });
    }
  }, 120_000);
});

function pageSource(latest: bigint): SourceFixture {
  return Object.freeze({
    mode: "page",
    epochUuid: EPOCH,
    sequences: Object.freeze(Array.from(
      { length: Number(latest) },
      (_value, index) => BigInt(index + 1),
    )),
  });
}

function probeRequest(
  scopeUuid: string,
  options: Readonly<{
    readonly authorizeFreshInitialization: boolean;
    readonly budget?: CatchUpTurnBudget;
  }>,
) {
  return Object.freeze({
    authorizationToken: PROBE_TOKEN,
    observation: Object.freeze({
      format: "flarex.scope-sync-active-head-observation",
      version: 1,
      scopeUuid,
      epochUuid: EPOCH,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: "1",
      observedAtCommitSeq: "0",
      activationSequence: "1",
      activeHeadSha256Hex: "00".repeat(32),
    }),
    budget: options.budget ?? BUDGET,
    authorizeFreshInitialization: options.authorizeFreshInitialization,
  });
}

function makeRuntime(
  sources: Map<string, SourceFixture>,
  options: Readonly<{
    readonly beforeSourceResponse?: (
      scopeUuid: string,
      requestedAfterCommitSeqExclusive: bigint,
    ) => Promise<void>;
    readonly probeToken?: string | null;
    readonly persistPath?: string;
  }> = {},
): Miniflare {
  const probeToken = options.probeToken === undefined
    ? PROBE_TOKEN
    : options.probeToken;
  return new Miniflare({
    modules: [{
      type: "ESModule",
      path: "worker.js",
      contents: workerBundle,
    }],
    compatibilityDate: "2026-06-14",
    bindings: {
      FLAREX_EXECUTOR_TOKEN: EXECUTOR_TOKEN,
      ...(probeToken === null
        ? {}
        : { FLAREX_QUERY_SYNC_PROBE_TOKEN: probeToken }),
    },
    serviceBindings: {
      FLAREX_EXECUTOR: (request: Request) => sourceResponse(
        request,
        sources,
        options.beforeSourceResponse,
      ),
    },
    durableObjects: {
      DEPLOYMENT_SYNCS: {
        className: "DeploymentSyncDO",
        useSQLite: true,
      },
    },
    ...(options.persistPath === undefined
      ? {}
      : { durableObjectsPersist: options.persistPath }),
  });
}

async function sourceResponse(
  request: Request,
  sources: Map<string, SourceFixture>,
  beforeSourceResponse?: (
    scopeUuid: string,
    requestedAfterCommitSeqExclusive: bigint,
  ) => Promise<void>,
): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${EXECUTOR_TOKEN}`) {
    return new Response(null, { status: 401 });
  }
  const decoded = unwrap(decodeQuerySyncSourceReadRequestV1(
    new Uint8Array(await request.arrayBuffer()),
  )).value;
  const source = sources.get(decoded.scopeUuid);
  if (source === undefined) return new Response(null, { status: 404 });
  await beforeSourceResponse?.(
    decoded.scopeUuid,
    decoded.requestedAfterCommitSeqExclusive,
  );
  const currentEpoch = decodeScopeEpochUuidV1(source.epochUuid);
  const latestValue = source.sequences.at(-1) ?? 0n;
  const latest = CommitSeqSchema.make(latestValue);
  const zero = CommitSeqSchema.make(0n);
  const one = CommitSeqSchema.make(1n);
  const replayableAfter = source.mode === "historyUnavailable" ? one : zero;
  const retainedFrom = source.mode === "historyUnavailable"
    ? CommitSeqSchema.make(2n)
    : latestValue === 0n ? null : one;
  const common = {
    codecVersion: 1 as const,
    scopeUuid: decoded.scopeUuid,
    syncModelId: decoded.syncModelId,
    requestedSourceEpoch: decoded.requestedSourceEpoch,
    requestedAfterCommitSeqExclusive:
      decoded.requestedAfterCommitSeqExclusive,
    currentSourceEpoch: currentEpoch,
    observedLatestCommitSeq: latest,
    replayableAfterCommitSeqExclusive: replayableAfter,
    retainedFromCommitSeqInclusive: retainedFrom,
  };
  if (source.mode !== "page") {
    return encodedResponse({
      ...common,
      kind: source.mode,
    });
  }
  if (decoded.requestedAfterCommitSeqExclusive > latest) {
    return encodedResponse({ ...common, kind: "cursorAhead" as const });
  }
  const available = source.sequences.filter(sequence =>
    sequence > decoded.requestedAfterCommitSeqExclusive
  );
  const selected = available.slice(
    0,
    decoded.budget.maximumCommittedBatches,
  );
  const readThroughValue = selected.at(-1)
    ?? decoded.requestedAfterCommitSeqExclusive;
  const readThrough = CommitSeqSchema.make(readThroughValue);
  const hasMore = readThrough < latest;
  return encodedResponse({
    ...common,
    kind: "page" as const,
    commits: Object.freeze(selected.map(sequence => Object.freeze({
      scopeUuid: decoded.scopeUuid,
      epochUuid: currentEpoch,
      commitSeq: CommitSeqSchema.make(sequence),
      committedAtMilliseconds: 1_788_134_400_000 + Number(sequence),
      appRowChanges: Object.freeze([]),
      relationAdjacencyChanges: Object.freeze([]),
    }))),
    readThroughCommitSeq: readThrough,
    hasMore,
    authorityObservation: hasMore ? null : Object.freeze({
      format: "flarex.scope-sync-active-head-observation",
      version: 1,
      scopeUuid: decoded.scopeUuid,
      epochUuid: currentEpoch,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      observedAtCommitSeq: latest,
      activationSequence: 1n,
      activeHeadSha256Hex: "00".repeat(32),
    }),
  });
}

function makeTwoReadSourceBarrier(scopeUuid: string): Readonly<{
  readonly requestedAfterCommitSeqExclusive: bigint[];
  readonly beforeSourceResponse: (
    requestedScopeUuid: string,
    requestedAfterCommitSeqExclusive: bigint,
  ) => Promise<void>;
}> {
  const requestedAfterCommitSeqExclusive: bigint[] = [];
  let openBarrier: (() => void) | undefined;
  const barrier = new Promise<void>(resolve => {
    openBarrier = resolve;
  });
  return Object.freeze({
    requestedAfterCommitSeqExclusive,
    beforeSourceResponse: async (requestedScopeUuid, requestedAfter) => {
      if (requestedScopeUuid !== scopeUuid) return;
      requestedAfterCommitSeqExclusive.push(requestedAfter);
      if (requestedAfterCommitSeqExclusive.length === 2) openBarrier?.();
      await barrier;
    },
  });
}

function encodedResponse(value: unknown): Response {
  const encoded = unwrap(encodeQuerySyncSourceReadResponseV1(
    value,
    16 * 1_024 * 1_024,
  ));
  return new Response(copyBytesToArrayBuffer(encoded.bytes), {
    status: 200,
    headers: {
      "content-length": String(encoded.bytes.byteLength),
      "content-type": querySyncSourceReadMediaTypeV1,
    },
  });
}

async function invoke(
  runtime: Miniflare,
  scopeUuid: string,
  request: unknown,
): Promise<unknown> {
  const response = await dispatch(runtime, scopeUuid, request);
  if (response.status !== 200) {
    throw new Error(
      `Expected Workerd status 200, received ${response.status}: ${await response.text()}`,
    );
  }
  return await response.json();
}

async function dispatch(
  runtime: Miniflare,
  scopeUuid: string,
  request: unknown,
) {
  return await runtime.dispatchFetch("https://deployment-sync.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      objectName: `deployment-sync:${scopeUuid}`,
      request,
    }),
  });
}

function testScope(ordinal: number): string {
  return `91000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
}

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

async function bundleWorker(): Promise<string> {
  const backendDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(
          backendDirectory,
          "test/deploymentSyncCatchUp.workerd.worker.ts",
        ),
        formats: ["es"],
        fileName: "worker",
      },
      rolldownOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : []
  );
  const worker = chunks.find(chunk =>
    chunk.type === "chunk" && chunk.fileName === "worker.js"
  );
  if (worker === undefined || worker.type !== "chunk") {
    throw new Error("Deployment sync catch-up worker bundle missing.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-deployment-sync-catch-up-test-resolution",
    resolveId(id) {
      if (
        id.startsWith("@flarex/")
        || id === "flarex-protocol"
        || id.startsWith("flarex-protocol/")
      ) return fileURLToPath(import.meta.resolve(id));
      return undefined;
    },
  };
}
