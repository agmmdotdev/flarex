/// <reference types="node" />

import { Miniflare } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Encoding, Result } from "effect";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  captureAdmittedInvalidationBatch,
  captureNamespaceCursor,
  captureQueryDescriptor,
  captureQueryEvaluationEvidence,
  captureQueryOperationTarget,
  captureQueryPublicationArtifact,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  type BeginQueryEvaluationDecision,
  type ApplyInvalidationsDecision,
  type QueryDescriptor,
  type QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import type {
  QuerySyncScopeFacts,
} from "@flarex/query-sync/internal/transition-plan";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";

import {
  encodeDeploymentQuerySyncDependencyRow,
  encodeDeploymentQuerySyncQueryRow,
  encodeDeploymentQuerySyncScopeRow,
  type DeploymentQuerySyncActiveDependency,
} from "../src/deploymentSync/RowCodec";
import {
  FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
} from "../src/deploymentSync/QuerySyncModel";

const epochA = "00000000-0000-4000-8000-000000000101";
const epochB = "00000000-0000-4000-8000-000000000102";

describe("private deployment query-sync C1 Workerd SQLite vertical", () => {
  let workerBundle: string;
  let runtime: Miniflare;

  beforeAll(async () => {
    workerBundle = await bundleWorker();
    runtime = makeRuntime(workerBundle);
  }, 60_000);

  afterAll(async () => {
    await runtime.dispose();
  });

  it("rejects crossed placement before creating application schema", async () => {
    const actorScopeUuid = testScope(1);
    const response = await invoke(runtime, "initialize", {
      ...observation(actorScopeUuid, epochA, 0n),
      observationScopeUuid: testScope(2),
    });

    expect(response).toMatchObject({
      ok: false,
      typedFailure: true,
      died: false,
      error: {
        _tag: "DeploymentQuerySyncBindingError",
        reason: "routeScopeMismatch",
      },
    });
    const catalogResponse = await invoke(runtime, "catalog", {
      actorScopeUuid,
    });
    expect(applicationObjectNames(catalogResponse)).toEqual([]);
  });

  it("requires fresh authority, consumes it after commit, and replays existing state", async () => {
    const actorScopeUuid = testScope(3);
    const input = observation(actorScopeUuid, epochA, 0n);

    expect(await invoke(runtime, "initialize", input)).toMatchObject({
      ok: false,
      typedFailure: true,
      error: {
        _tag: "QuerySyncStoredStateIncompatibleError",
        reason: "bootstrapBindingMismatch",
      },
    });
    expect(await invoke(runtime, "snapshot", { actorScopeUuid })).toEqual({
      contract: [{
        singleton: 1,
        local_contract_generation: 2,
        durable_initialized_history: 0,
      }],
      scope: [],
      queries: [],
      dependencies: [],
    });

    const initialized = await invoke(runtime, "initializeTwice", input);
    expect(initialized).toMatchObject({
      ok: true,
      value: {
        first: { _tag: "initialized", cursor: { appliedThroughSequence: "0" } },
        second: { _tag: "existing", cursor: { appliedThroughSequence: "0" } },
      },
    });
    expect(await invoke(runtime, "snapshot", { actorScopeUuid })).toEqual({
      contract: [{
        singleton: 1,
        local_contract_generation: 2,
        durable_initialized_history: 1,
      }],
      scope: [encodeScopeRow(emptyState(actorScopeUuid, epochA, 0n))],
      queries: [],
      dependencies: [],
    });
  });

  it("accepts the provider KV catalog before initialization and on re-entry", async () => {
    const actorScopeUuid = testScope(10);
    const input = observation(actorScopeUuid, epochA, 0n);

    expect(await invoke(runtime, "putKvThenInitialize", {
      ...input,
      authorizedFresh: true,
    })).toMatchObject({
      ok: true,
      value: { _tag: "initialized" },
    });
    expect(await invoke(runtime, "initialize", input)).toMatchObject({
      ok: true,
      value: { _tag: "existing" },
    });

    const catalogResponse = await invoke(runtime, "catalog", {
      actorScopeUuid,
    });
    expect(providerKvObjectNames(catalogResponse)).toEqual(["_cf_KV"]);
    expect(applicationObjectNames(catalogResponse)).toEqual([
      "deployment_sync_contract_state",
      "deployment_sync_queries",
      "deployment_sync_query_dependencies",
      "deployment_sync_query_dependencies_reverse",
      "deployment_sync_scope_state",
    ]);
  });

  it("releases reserved fresh authority after a real SQLite rollback", async () => {
    const actorScopeUuid = testScope(4);
    const response = await invoke(runtime, "initializeRollbackThenRetry",
      observation(actorScopeUuid, epochA, 0n));

    expect(response).toMatchObject({
      ok: true,
      value: {
        firstDied: true,
        firstTypedFailure: false,
        second: { _tag: "initialized" },
      },
    });
    expect(await invoke(runtime, "snapshot", { actorScopeUuid })).toMatchObject({
      contract: [{ durable_initialized_history: 1 }],
      scope: [{ applied_through_sequence: "0" }],
    });
  });

  it("atomically migrates exact generation 1 and preserves stale epoch progress", async () => {
    const actorScopeUuid = testScope(5);
    await invoke(runtime, "seedGeneration1", {
      actorScopeUuid,
      legacyRow: {
        scopeUuid: actorScopeUuid,
        epochUuid: epochA,
        storageGenerationFence: "9",
        appliedThroughCommitSeq: "5",
      },
    });

    const response = await invoke(runtime, "initialize", observation(
      actorScopeUuid,
      epochB,
      7n,
    ));
    expect(response).toMatchObject({
      ok: true,
      value: {
        _tag: "epochReplaced",
        existingCursor: {
          sourceEpoch: epochA,
          appliedThroughSequence: "5",
        },
        requestedSourceEpoch: epochB,
      },
    });
    const stored = await invoke(runtime, "snapshot", { actorScopeUuid });
    expect(stored).toMatchObject({
      contract: [{
        local_contract_generation: 2,
        durable_initialized_history: 1,
      }],
      scope: [{
        scope_uuid: actorScopeUuid,
        epoch_uuid: epochA,
        storage_generation_fence: "9",
        applied_through_sequence: "5",
        sync_model_id: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
      }],
    });
    expect(applicationObjectNames(await invoke(runtime, "catalog", {
      actorScopeUuid,
    }))).toEqual([
      "deployment_sync_contract_state",
      "deployment_sync_queries",
      "deployment_sync_query_dependencies",
      "deployment_sync_query_dependencies_reverse",
      "deployment_sync_scope_state",
    ]);
  });

  it("matches the portable begin plan for creation and replay", async () => {
    const actorScopeUuid = testScope(6);
    const input = observation(actorScopeUuid, epochA, 0n);
    await invoke(runtime, "initialize", { ...input, authorizedFresh: true });

    const initial = emptyState(actorScopeUuid, epochA, 0n);
    const descriptor = queryDescriptor(1, "query-one");
    const request = firstRequest(initial, descriptor);
    const portable = success(beginQueryEvaluation(initial, request));
    const operation = {
      ...input,
      queryKey: descriptor.queryKey,
      queryIdentity: descriptor.queryIdentity,
      expectedActiveGeneration: null,
      requestedDirtyThroughSequence: null,
    };

    expect(await invoke(runtime, "begin", operation)).toEqual({
      ok: true,
      value: serialize(portableBeginReceipt(portable)),
    });
    const replayed = success(beginQueryEvaluation(portable.state, request));
    expect(await invoke(runtime, "begin", operation)).toEqual({
      ok: true,
      value: serialize(portableBeginReceipt(replayed)),
    });
    expect(await invoke(runtime, "snapshot", { actorScopeUuid })).toEqual({
      contract: [{
        singleton: 1,
        local_contract_generation: 2,
        durable_initialized_history: 1,
      }],
      scope: [encodeScopeRow(portable.state)],
      queries: [encodeQueryState(portable.state, descriptor.queryKey)],
      dependencies: [],
    });
  });

  it("matches the portable admitted-batch plan against a valid active fixture", async () => {
    const actorScopeUuid = testScope(7);
    const dependency = Encoding.encodeBase64Url("dependency:shared");
    const initial = emptyState(actorScopeUuid, epochA, 0n);
    const active = installActiveQuery(
      initial,
      queryDescriptor(7, "active-query"),
      dependency,
    );
    const input = observation(actorScopeUuid, epochA, 0n);
    await invoke(runtime, "seedNormalizedFixture", {
      ...input,
      fixture: encodeFixture(active),
    });
    const batch = success(captureAdmittedInvalidationBatch({
      namespaceId: actorScopeUuid,
      syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
      sourceEpoch: epochA,
      sourceSequence: 1n,
      dependencyKeys: [dependency],
    }));
    const portable = success(applyAdmittedInvalidations(active, batch));

    expect(await invoke(runtime, "apply", {
      ...input,
      sourceSequence: "1",
      dependencyKeys: [dependency],
    })).toEqual({
      ok: true,
      value: serialize(portableApplyReceipt(portable)),
    });
    expect(await invoke(runtime, "snapshot", { actorScopeUuid })).toEqual({
      contract: [{
        singleton: 1,
        local_contract_generation: 2,
        durable_initialized_history: 1,
      }],
      scope: [encodeScopeRow(portable.state)],
      queries: portable.state.queries.map(query =>
        encodeDeploymentQuerySyncQueryRow(query)
      ),
      dependencies: encodeFixture(portable.state).dependencies,
    });
  });

  it("persists generation 2 across Workerd disposal and reconstruction", async () => {
    const persistPath = await mkdtemp(join(tmpdir(), "flarex-qsync-c1-"));
    const actorScopeUuid = testScope(8);
    const input = observation(actorScopeUuid, epochA, 0n);
    let first: Miniflare | undefined;
    let second: Miniflare | undefined;
    try {
      first = makeRuntime(workerBundle, persistPath);
      expect(await invoke(first, "initialize", {
        ...input,
        authorizedFresh: true,
      })).toMatchObject({ ok: true, value: { _tag: "initialized" } });
      await first.dispose();
      first = undefined;

      second = makeRuntime(workerBundle, persistPath);
      expect(await invoke(second, "initialize", input)).toMatchObject({
        ok: true,
        value: { _tag: "existing" },
      });
      expect(await invoke(second, "snapshot", { actorScopeUuid }))
        .toMatchObject({
          contract: [{ durable_initialized_history: 1 }],
          scope: [{ scope_uuid: actorScopeUuid }],
        });
    } finally {
      if (first !== undefined) await first.dispose();
      if (second !== undefined) await second.dispose();
      await rm(persistPath, { recursive: true, force: true });
    }
  });

  it("does not retain the legacy direct cursor-advance operation", async () => {
    const response = await dispatch(runtime, "advance", {
      actorScopeUuid: testScope(9),
    });
    expect(response.status).toBe(404);
  });
});

function observation(
  actorScopeUuid: string,
  epochUuid: string,
  commitSeq: bigint,
) {
  return Object.freeze({
    actorScopeUuid,
    epochUuid,
    storageGenerationFence: "9",
    commitSeq: commitSeq.toString(),
  });
}

function emptyState(
  scopeUuid: string,
  epochUuid: string,
  sequence: bigint,
): QuerySyncState {
  return success(createEmptyQuerySyncState(success(captureNamespaceCursor({
    namespaceId: scopeUuid,
    syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
    sourceEpoch: epochUuid,
    appliedThroughSequence: sequence,
  }))));
}

function queryDescriptor(seed: number, identity: string): QueryDescriptor {
  const keyBytes = new Uint8Array(32);
  new DataView(keyBytes.buffer).setUint32(0, seed);
  return success(captureQueryDescriptor({
    queryKey: Encoding.encodeBase64Url(keyBytes),
    queryIdentity: Encoding.encodeBase64Url(identity),
  }));
}

function firstRequest(
  state: QuerySyncState,
  descriptor: QueryDescriptor,
) {
  return Object.freeze({
    target: success(captureQueryOperationTarget({
      namespaceId: state.cursor.namespaceId,
      syncModelId: state.cursor.syncModelId,
      sourceEpoch: state.cursor.sourceEpoch,
      descriptor,
    })),
    expectedActiveGeneration: null,
    requestedDirtyThroughSequence: null,
  });
}

function installActiveQuery(
  state: QuerySyncState,
  descriptor: QueryDescriptor,
  dependencyKey: string,
): QuerySyncState {
  const begun = success(beginQueryEvaluation(
    state,
    firstRequest(state, descriptor),
  ));
  if (begun._tag !== "created") {
    throw new Error("Expected a new portable evaluation attempt.");
  }
  const evidence = success(captureQueryEvaluationEvidence({
    namespaceId: state.cursor.namespaceId,
    syncModelId: state.cursor.syncModelId,
    sourceEpoch: state.cursor.sourceEpoch,
    descriptor,
    generation: begun.attempt.generation,
    snapshotSequence: state.cursor.appliedThroughSequence,
    resultDigest: queryDescriptor(80, "digest").queryKey,
    authorityWitness: queryDescriptor(90, "witness").queryKey,
    dependencyKeys: [dependencyKey],
  }));
  const refresh = success(deriveGenerationRefreshEvidence(
    evidence,
    begun.state.cursor,
    [],
    evidence.authorityWitness,
  ));
  const completion = success(completeQueryEvaluation(
    begun.state,
    begun.attempt,
    evidence,
    refresh,
    success(captureQueryPublicationArtifact({
      content: Encoding.encodeBase64Url("publication"),
    })),
  ));
  if (completion._tag !== "completed") {
    throw new Error("Expected a completed portable query fixture.");
  }
  return completion.state;
}

function encodeScopeRow(state: QuerySyncState) {
  return encodeDeploymentQuerySyncScopeRow({
    scopeUuid: ScopeUuidV1Schema.make(state.cursor.namespaceId),
    epochUuid: ScopeEpochUuidV1Schema.make(state.cursor.sourceEpoch),
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(9n),
    syncModelId: state.cursor.syncModelId,
    facts: scopeFacts(state),
  });
}

function scopeFacts(state: QuerySyncState): QuerySyncScopeFacts {
  return Object.freeze({
    cursor: state.cursor,
    evaluationWork: state.evaluationWork,
    metrics: state.metrics,
  });
}

function encodeQueryState(state: QuerySyncState, queryKey: string) {
  const query = state.queries.find(candidate =>
    candidate.descriptor.queryKey === queryKey
  );
  if (query === undefined) throw new Error("Portable query fixture missing.");
  return encodeDeploymentQuerySyncQueryRow(query);
}

function encodeFixture(state: QuerySyncState) {
  const dependencies: ReturnType<
    typeof encodeDeploymentQuerySyncDependencyRow
  >[] = [];
  for (const query of state.queries) {
    if (query.active === null) continue;
    for (const dependencyKey of query.active.dependencyKeys) {
      const dependency: DeploymentQuerySyncActiveDependency = Object.freeze({
        role: "active",
        queryKey: query.descriptor.queryKey,
        generation: query.active.generation,
        dependencyKey,
      });
      dependencies.push(encodeDeploymentQuerySyncDependencyRow(dependency));
    }
  }
  return Object.freeze({
    scope: encodeScopeRow(state),
    queries: Object.freeze(state.queries.map(query =>
      encodeDeploymentQuerySyncQueryRow(query)
    )),
    dependencies: Object.freeze(dependencies),
  });
}

function portableBeginReceipt(decision: BeginQueryEvaluationDecision) {
  switch (decision._tag) {
    case "created":
    case "replayed":
      return Object.freeze({ _tag: decision._tag, attempt: decision.attempt });
    case "alreadyAdvanced":
      return Object.freeze({
        _tag: decision._tag,
        descriptor: decision.descriptor,
        requestedExpectedActiveGeneration:
          decision.requestedExpectedActiveGeneration,
        activeGeneration: decision.activeGeneration,
        freshThroughSequence: decision.freshThroughSequence,
      });
    case "notDirty":
      return Object.freeze({
        _tag: decision._tag,
        descriptor: decision.descriptor,
        activeGeneration: decision.activeGeneration,
        requestedDirtyThroughSequence: decision.requestedDirtyThroughSequence,
        freshThroughSequence: decision.freshThroughSequence,
      });
  }
}

function portableApplyReceipt(
  decision: ApplyInvalidationsDecision,
) {
  switch (decision._tag) {
    case "duplicate":
      return Object.freeze({
        _tag: decision._tag,
        observedSequence: decision.observedSequence,
      });
    case "gap":
      return Object.freeze({
        _tag: decision._tag,
        expectedSequence: decision.expectedSequence,
        observedSequence: decision.observedSequence,
      });
    case "resetRequired":
      return Object.freeze({
        _tag: decision._tag,
        expectedSourceEpoch: decision.expectedSourceEpoch,
        observedSourceEpoch: decision.observedSourceEpoch,
      });
    case "applied":
      return Object.freeze({
        _tag: decision._tag,
        appliedSequence: decision.appliedSequence,
        affectedQueryKeys: decision.affectedQueryKeys,
      });
  }
}

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [
    key,
    serialize(member),
  ]));
}

function applicationObjectNames(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.schema)) return [];
  return response.schema.flatMap(row =>
    isRecord(row)
      && typeof row.name === "string"
      && row.name.startsWith("deployment_sync_")
      ? [row.name]
      : []
  ).toSorted();
}

function providerKvObjectNames(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.schema)) return [];
  return response.schema.flatMap(row =>
    isRecord(row)
      && (row.name === "_cf_KV" || row.name === "__cf_kv")
      ? [row.name]
      : []
  ).toSorted();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function invoke(
  selectedRuntime: Miniflare,
  operation: string,
  input: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const response = await dispatch(selectedRuntime, operation, input);
  expect(response.status).toBe(200);
  return await response.json();
}

async function dispatch(
  selectedRuntime: Miniflare,
  operation: string,
  input: Readonly<Record<string, unknown>>,
) {
  return await selectedRuntime.dispatchFetch("https://deployment-sync.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, operation }),
  });
}

function testScope(ordinal: number): string {
  return `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
}

function success<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}

function makeRuntime(workerBundle: string, persistPath?: string): Miniflare {
  return new Miniflare({
    modules: [{
      type: "ESModule",
      path: "worker.js",
      contents: workerBundle,
    }],
    compatibilityDate: "2026-06-14",
    durableObjects: {
      DEPLOYMENT_SYNCS: {
        className: "DeploymentQuerySyncC1TestDO",
        useSQLite: true,
      },
    },
    ...(persistPath === undefined
      ? {}
      : { durableObjectsPersist: persistPath }),
  });
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
          "test/deploymentQuerySyncC1.workerd.worker.ts",
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
    throw new Error("Deployment query-sync C1 worker bundle missing.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-deployment-query-sync-c1-test-resolution",
    resolveId(id) {
      if (
        id === "@flarex/query-sync"
        || id.startsWith("@flarex/query-sync/")
        || id === "flarex-protocol"
        || id.startsWith("flarex-protocol/")
      ) return fileURLToPath(import.meta.resolve(id));
      return undefined;
    },
  };
}
