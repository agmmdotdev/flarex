/// <reference types="node" />

import { Miniflare } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MAX_CANONICAL_QUERY_IDENTITY_BYTES,
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
  MAX_REFERENCE_QUERIES,
  MAX_RETAINED_QUERY_IDENTITY_BYTES,
  canonicalBase64UrlEncodedLength,
} from "@flarex/query-sync/internal/kernel";

const epoch = "00000000-0000-4000-8000-000000000201";

describe("private deployment query-sync C2 Workerd SQLite vertical", () => {
  let workerBundle: string;
  let runtime: Miniflare;

  beforeAll(async () => {
    workerBundle = await bundleWorker();
    runtime = makeRuntime(workerBundle);
  }, 60_000);

  afterAll(async () => {
    await runtime.dispose();
  });

  it("creates the exact strict generation-3 catalog beside provider KV", async () => {
    const actorScopeUuid = testScope(1);
    expect(await invoke(runtime, "putKvThenInitialize", {
      ...observation(actorScopeUuid),
      authorizedFresh: true,
    })).toMatchObject({
      ok: true,
      value: { _tag: "initialized" },
    });

    const catalogResponse = await invoke(runtime, "catalog", {
      actorScopeUuid,
    });
    expect(providerKvObjectNames(catalogResponse)).toEqual(["_cf_KV"]);
    expect(applicationObjectNames(catalogResponse)).toEqual([
      "deployment_sync_contract_state",
      "deployment_sync_pending_publications",
      "deployment_sync_queries",
      "deployment_sync_query_dependencies",
      "deployment_sync_query_dependencies_reverse",
      "deployment_sync_scope_state",
    ]);
    expect(applicationTableFacts(catalogResponse)).toEqual([
      { name: "deployment_sync_contract_state", strict: 1, wr: 1 },
      { name: "deployment_sync_pending_publications", strict: 1, wr: 1 },
      { name: "deployment_sync_queries", strict: 1, wr: 1 },
      { name: "deployment_sync_query_dependencies", strict: 1, wr: 1 },
      { name: "deployment_sync_scope_state", strict: 1, wr: 1 },
    ]);
  });

  it("completes, invalidates, claims, and durably blocks evaluation work", async () => {
    const actorScopeUuid = testScope(2);
    const response = await invoke(runtime, "fullVertical", {
      ...observation(actorScopeUuid),
      querySeed: 2,
    });

    expectSuccessResponse(response);
    expect(response).toMatchObject({
      ok: true,
      value: {
        initialized: { _tag: "initialized" },
        begun: { _tag: "created", attempt: { generation: "1" } },
        completed: {
          _tag: "completed",
          generation: "1",
          publicationDisposition: { _tag: "pending" },
        },
        applied: { _tag: "applied", appliedSequence: "1" },
        claimed: { _tag: "claimed", attempt: { generation: "2" } },
        blocked: {
          _tag: "blocked",
          blockedWork: { generation: "2", resetRequired: true },
        },
        replayedBlock: {
          _tag: "blocked",
          blockedWork: { generation: "2", resetRequired: true },
        },
      },
    });
    const stored = await invoke(runtime, "snapshot", { actorScopeUuid });
    expect(stored).toMatchObject({
      contract: [{ local_contract_generation: 3 }],
      scope: [{
        applied_through_sequence: "1",
        query_count: 1,
        dependency_memberships: 1,
        pending_publication_count: 1,
        in_flight_publication_count: 0,
        settlement_envelope_bytes: 0,
      }],
      queries: [{
        active_generation: "1",
        active_dirty_through_sequence: "1",
        provisional_generation: "2",
        provisional_disposition: "blocked",
        completion_generation: "1",
        completion_publication_disposition: "pending",
      }],
      dependencies: [
        { role: "active", generation: "1" },
        { role: "completion", generation: "1" },
      ],
      pending: [{ generation: "1" }],
    });
  });

  it("rolls back a failed completion, then completes and replays exactly", async () => {
    const actorScopeUuid = testScope(3);
    const response = await invoke(runtime, "completionRollbackThenReplay", {
      ...observation(actorScopeUuid),
      querySeed: 3,
    });
    expectSuccessResponse(response);
    expect(response).toMatchObject({
      ok: true,
      value: {
        firstDied: true,
        firstTypedFailure: false,
        completed: { _tag: "completed", generation: "1" },
        replayed: { _tag: "replayed", generation: "1" },
      },
    });
    expect(await invoke(runtime, "snapshot", { actorScopeUuid })).toMatchObject({
      queries: [{ completion_generation: "1" }],
      dependencies: [
        { role: "active", generation: "1" },
        { role: "completion", generation: "1" },
      ],
      pending: [{ generation: "1" }],
    });
  });

  it("reopens generation 3 after real Workerd disposal", async () => {
    const persistPath = await mkdtemp(join(tmpdir(), "flarex-qsync-c2-"));
    const actorScopeUuid = testScope(4);
    let first: Miniflare | undefined;
    let second: Miniflare | undefined;
    try {
      first = makeRuntime(workerBundle, persistPath);
      const response = await invoke(first, "fullVertical", {
        ...observation(actorScopeUuid),
        querySeed: 4,
      });
      expectSuccessResponse(response);
      expect(response).toMatchObject({ ok: true });
      await first.dispose();
      first = undefined;

      second = makeRuntime(workerBundle, persistPath);
      expect(await invoke(second, "initialize", observation(actorScopeUuid)))
        .toMatchObject({
          ok: true,
          value: { _tag: "existing" },
        });
      expect(await invoke(second, "snapshot", { actorScopeUuid }))
        .toMatchObject({
          contract: [{ local_contract_generation: 3 }],
          queries: [{ provisional_disposition: "blocked" }],
          pending: [{ generation: "1" }],
        });
    } finally {
      if (first !== undefined) await first.dispose();
      if (second !== undefined) await second.dispose();
      await rm(persistPath, { recursive: true, force: true });
    }
  });

  it("migrates empty generation 2 and refuses orphaned predecessor state", async () => {
    const migratableScope = testScope(5);
    expect(await invoke(runtime, "seedGeneration2Empty", {
      ...observation(migratableScope),
      querySeed: 5,
    })).toEqual({ ok: true });
    expect(await invoke(runtime, "initialize", {
      ...observation(migratableScope),
      authorizedFresh: true,
    })).toMatchObject({
      ok: true,
      value: { _tag: "initialized" },
    });
    expect(await invoke(runtime, "snapshot", {
      actorScopeUuid: migratableScope,
    })).toMatchObject({
      contract: [{ local_contract_generation: 3 }],
      pending: [],
    });

    const refusedScope = testScope(6);
    expect(await invoke(runtime, "seedGeneration2Orphan", {
      ...observation(refusedScope),
      querySeed: 6,
    })).toEqual({ ok: true });
    expect(await invoke(runtime, "initialize", {
      ...observation(refusedScope),
      authorizedFresh: true,
    })).toMatchObject({
      ok: false,
      typedFailure: true,
      died: false,
      error: {
        _tag: "QuerySyncStoredStateCorruptError",
        reason: "storedAggregateInvalid",
      },
    });
    expect(await invoke(runtime, "snapshot", {
      actorScopeUuid: refusedScope,
    })).toMatchObject({
      contract: [{ local_contract_generation: 2 }],
      pending: [],
    });
  });

  it("proves maximum C2 host boundaries across disposal and reopen", async () => {
    const persistPath = await mkdtemp(join(tmpdir(), "flarex-qsync-c2-max-"));
    const populationScope = testScope(8);
    const maximumRowScope = testScope(9);
    const populationIdentityBytes = MAX_RETAINED_QUERY_IDENTITY_BYTES
      / MAX_REFERENCE_QUERIES;
    const populationIdentityCharacters = canonicalBase64UrlEncodedLength(
      populationIdentityBytes,
    );
    const maximumIdentityCharacters = canonicalBase64UrlEncodedLength(
      MAX_CANONICAL_QUERY_IDENTITY_BYTES,
    );
    const maximumContentCharacters = canonicalBase64UrlEncodedLength(
      MAX_INLINE_PUBLICATION_CONTENT_BYTES,
    );
    let first: Miniflare | undefined;
    let second: Miniflare | undefined;
    try {
      first = makeRuntime(workerBundle, persistPath);
      const seededPopulation = await invoke(first, "seedGeneration2Maximum", {
        ...observation(populationScope),
        querySeed: 8,
      });
      expectSuccessResponse(seededPopulation);
      const seededPopulationValue = successValue(seededPopulation);
      const seededPopulationScopeMetrics = recordMember(
        seededPopulationValue,
        "scopeMetrics",
      );
      expect(seededPopulationScopeMetrics).toEqual(
        populationScopeMetricsExpectation(safeIntegerMember(
          seededPopulationScopeMetrics,
          "countedCanonicalBytes",
        )),
      );
      expect(seededPopulationValue).toMatchObject({
        queryCount: MAX_REFERENCE_QUERIES,
        retainedIdentityBytes: MAX_RETAINED_QUERY_IDENTITY_BYTES,
        queryIdentityCharacters: populationIdentityCharacters,
      });

      const migration = await invoke(first, "migrateAndClaimMaximum", {
        ...observation(populationScope),
        authorizedFresh: true,
      });
      expectSuccessResponse(migration);
      const migrationValue = successValue(migration);
      const claimedPopulation = recordMember(
        migrationValue,
        "claimedPopulation",
      );
      const populationScopeMetrics = recordMember(
        claimedPopulation,
        "scopeMetrics",
      );
      expect(populationScopeMetrics).toEqual(populationScopeMetricsExpectation(
        safeIntegerMember(populationScopeMetrics, "countedCanonicalBytes"),
      ));
      expect(migration).toMatchObject({
        ok: true,
        value: {
          initialized: {
            _tag: "existing",
            queryCount: MAX_REFERENCE_QUERIES,
            retainedIdentityBytes: MAX_RETAINED_QUERY_IDENTITY_BYTES,
          },
          claimed: {
            _tag: "claimed",
            generation: "1",
            queryIdentityCharacters: populationIdentityCharacters,
          },
          migratedPopulation: maximumPopulationExpectation(
            populationIdentityCharacters,
            seededPopulationScopeMetrics,
          ),
          claimedPopulation: maximumPopulationExpectation(
            populationIdentityCharacters,
            populationScopeMetrics,
          ),
        },
      });

      const maximumRow = await invoke(first, "maximumRowVertical", {
        ...observation(maximumRowScope),
        querySeed: 9,
      });
      expectSuccessResponse(maximumRow);
      const maximumRowValue = successValue(maximumRow);
      const maximumRowStored = recordMember(maximumRowValue, "maximumRow");
      const maximumRowScopeMetrics = recordMember(
        maximumRowStored,
        "scopeMetrics",
      );
      expect(maximumRowScopeMetrics).toEqual(maximumRowScopeMetricsExpectation(
        safeIntegerMember(maximumRowScopeMetrics, "countedCanonicalBytes"),
      ));
      expect(maximumRow).toMatchObject({
        ok: true,
        value: {
          initialized: "initialized",
          begun: "created",
          completed: {
            _tag: "completed",
            generation: "1",
            publicationDisposition: "pending",
          },
          replayed: {
            _tag: "replayed",
            generation: "1",
            publicationDisposition: "pending",
          },
          applied: {
            _tag: "applied",
            appliedSequence: "1",
            affectedQueryCount: 1,
          },
          dependencyLookupBindingCounts: [96, 1],
          bindingBudget: { bindings: 100, total: 4_950 },
          maximumRow: maximumRowExpectation(
            maximumIdentityCharacters,
            maximumContentCharacters,
            maximumRowScopeMetrics,
          ),
        },
      });

      await first.dispose();
      first = undefined;
      second = makeRuntime(workerBundle, persistPath);

      expect(await invoke(
        second,
        "initialize",
        observation(populationScope),
      )).toMatchObject({
        ok: true,
        value: {
          _tag: "existing",
          metrics: populationScopeMetrics,
        },
      });
      expect(await invoke(second, "maximumPopulationSummary", {
        actorScopeUuid: populationScope,
      })).toEqual({
        ok: true,
        value: maximumPopulationExpectation(
          populationIdentityCharacters,
          populationScopeMetrics,
        ),
      });

      expect(await invoke(
        second,
        "initialize",
        observation(maximumRowScope),
      )).toMatchObject({
        ok: true,
        value: {
          _tag: "existing",
          metrics: maximumRowScopeMetrics,
        },
      });
      expect(await invoke(second, "maximumRowSummary", {
        ...observation(maximumRowScope),
        querySeed: 9,
      })).toEqual({
        ok: true,
        value: maximumRowExpectation(
          maximumIdentityCharacters,
          maximumContentCharacters,
          maximumRowScopeMetrics,
        ),
      });
    } finally {
      if (first !== undefined) await first.dispose();
      if (second !== undefined) await second.dispose();
      await rm(persistPath, { recursive: true, force: true });
    }
  }, 480_000);

  it("does not expose C3 publication operations", async () => {
    const response = await dispatch(runtime, "claimPublication", {
      actorScopeUuid: testScope(7),
    });
    expect(response.status).toBe(404);
  });
});

function observation(actorScopeUuid: string) {
  return Object.freeze({
    actorScopeUuid,
    epochUuid: epoch,
    storageGenerationFence: "9",
    commitSeq: "0",
  });
}

function testScope(ordinal: number): string {
  return `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
}

function maximumPopulationExpectation(
  identityCharacters: number,
  scopeMetrics: Readonly<Record<string, unknown>>,
) {
  return {
    localContractGeneration: 3,
    queryCount: MAX_REFERENCE_QUERIES,
    readyQueryCount: MAX_REFERENCE_QUERIES,
    minimumIdentityCharacters: identityCharacters,
    maximumIdentityCharacters: identityCharacters,
    scopeMetrics,
    firstEdgeExact: true,
    lastEdgeExact: true,
  };
}

function maximumRowExpectation(
  identityCharacters: number,
  contentCharacters: number,
  scopeMetrics: Readonly<Record<string, unknown>>,
) {
  return {
    queryIdentityExact: true,
    pendingQueryIdentityExact: true,
    publicationContentExact: true,
    queryIdentityCharacters: identityCharacters,
    publicationContentCharacters: contentCharacters,
    combinedPendingPayloadCharacters:
      identityCharacters + contentCharacters,
    activeDependencyCount: 97,
    completionDependencyCount: 97,
    scopeMetrics,
    activeGeneration: "1",
    activeDirtyThroughSequence: "1",
    completionGeneration: "1",
    completionPublicationDisposition: "pending",
    pendingGeneration: "1",
  };
}

function populationScopeMetricsExpectation(countedCanonicalBytes: number) {
  return {
    queryCount: MAX_REFERENCE_QUERIES,
    retainedIdentityBytes: MAX_RETAINED_QUERY_IDENTITY_BYTES,
    dependencyMemberships: 0,
    pendingPublicationCount: 0,
    inFlightPublicationCount: 0,
    retainedPublicationContentBytes: 0,
    settlementEnvelopeBytes: 0,
    countedCanonicalBytes,
  };
}

function maximumRowScopeMetricsExpectation(countedCanonicalBytes: number) {
  return {
    queryCount: 1,
    retainedIdentityBytes: MAX_CANONICAL_QUERY_IDENTITY_BYTES,
    dependencyMemberships: 97,
    pendingPublicationCount: 1,
    inFlightPublicationCount: 0,
    retainedPublicationContentBytes: MAX_INLINE_PUBLICATION_CONTENT_BYTES,
    settlementEnvelopeBytes: 0,
    countedCanonicalBytes,
  };
}

function successValue(
  response: Readonly<{ readonly ok: true; readonly value: unknown }>,
): Readonly<Record<string, unknown>> {
  if (isRecord(response.value)) return response.value;
  throw new Error("Expected successful Workerd response value to be a record.");
}

function recordMember(
  record: Readonly<Record<string, unknown>>,
  member: string,
): Readonly<Record<string, unknown>> {
  const value = record[member];
  if (isRecord(value)) return value;
  throw new Error(`Expected Workerd response member ${member} to be a record.`);
}

function safeIntegerMember(
  record: Readonly<Record<string, unknown>>,
  member: string,
): number {
  const value = record[member];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new Error(
    `Expected Workerd response member ${member} to be a safe integer.`,
  );
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

function applicationObjectNames(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.schema)) return [];
  return response.schema.flatMap(row => isRecord(row)
      && typeof row.name === "string"
      && row.name.startsWith("deployment_sync_")
    ? [row.name]
    : []).toSorted();
}

function providerKvObjectNames(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.schema)) return [];
  return response.schema.flatMap(row => isRecord(row)
      && (row.name === "_cf_KV" || row.name === "__cf_kv")
    ? [row.name]
    : []).toSorted();
}

function applicationTableFacts(response: unknown): readonly Readonly<{
  readonly name: string;
  readonly strict: number;
  readonly wr: number;
}>[] {
  if (!isRecord(response) || !Array.isArray(response.tables)) return [];
  return response.tables.flatMap(row => isRecord(row)
      && row.type === "table"
      && typeof row.name === "string"
      && row.name.startsWith("deployment_sync_")
      && typeof row.strict === "number"
      && typeof row.wr === "number"
    ? [{ name: row.name, strict: row.strict, wr: row.wr }]
    : []).toSorted((left, right) => left.name.localeCompare(right.name));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectSuccessResponse(value: unknown): asserts value is Readonly<{
  readonly ok: true;
  readonly value: unknown;
}> {
  if (isRecord(value) && value.ok === true) return;
  throw new Error(`Expected successful Workerd response: ${JSON.stringify(value)}`);
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
        className: "DeploymentQuerySyncC2TestDO",
        useSQLite: true,
      },
    },
    ...(persistPath === undefined ? {} : { durableObjectsPersist: persistPath }),
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
          "test/deploymentQuerySyncC2.workerd.worker.ts",
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
    throw new Error("Deployment query-sync C2 worker bundle missing.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-deployment-query-sync-c2-test-resolution",
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
