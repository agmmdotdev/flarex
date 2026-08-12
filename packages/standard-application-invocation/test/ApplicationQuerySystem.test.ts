import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import type {
  ApplicationActiveSelection,
  CoherentActiveApplication,
} from "@flarex/persistence-postgres/internal/application-activation";
import { Effect, Result } from "effect";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import {
  MAX_APPLICATION_QUERY_ARGUMENT_SEMANTIC_BYTES_V1,
} from "flarex-protocol/internal/application-worker-v1";
import { TransactionFunctionPathV1Schema } from
  "flarex-protocol/transaction-session";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION } from
  "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { describe, expect, it, vi } from "vitest";
import { ApplicationExecutionHostError } from
  "flarex-backend/internal/application-execution-host";

const operations = vi.hoisted(() => ({
  open: vi.fn(),
  revalidate: vi.fn(),
  readPoint: vi.fn(),
  readIndex: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  RpcTarget: class {},
}));

vi.mock(
  "@flarex/persistence-postgres/internal/application-query-snapshot",
  async importOriginal => ({
    ...await importOriginal<Readonly<Record<string, unknown>>>(),
    openApplicationQuerySnapshot: operations.open,
    revalidateApplicationQuerySnapshot: operations.revalidate,
    readApplicationQueryPoint: operations.readPoint,
    readApplicationQueryIndex: operations.readIndex,
  }),
);

import {
  makeApplicationQuerySystemLayer,
  invokeApplicationQuery,
  type ApplicationQuerySystemLive,
} from "../src/ApplicationQuerySystem";
import { invokeStandardApplicationPointQueryV1 } from "../src/v1";

describe("Application query system", () => {
  it("composes the active target, Source Artifact, snapshot capability, and fresh host request", async () => {
    const manifest = applicationManifest();
    const selection = Object.freeze({}) as ApplicationActiveSelection;
    const basis = activeBasis(manifest);
    const snapshot = Object.freeze({});
    const metadata = Object.freeze({
      basis,
      function: Object.freeze({
        ...manifest.functions[0]!,
        kind: "query" as const,
        visibility: "public" as const,
        entrySha256: "a".repeat(64),
      }),
      tables: Object.freeze([]),
      snapshotToken: Object.freeze({
        scopeId: "scope_query",
        epoch: "epoch-query",
        commitSeq: 7n,
      }),
      budget: queryBudget(),
    });
    operations.open.mockReturnValue(Effect.succeed({ snapshot, metadata }));
    operations.revalidate.mockReturnValue(Effect.succeed(metadata));
    operations.readPoint.mockReturnValue(Effect.succeed({ kind: "missing" }));
    operations.readIndex.mockReturnValue(Effect.succeed({
      documents: [],
      isDone: true,
    }));
    const readActive = vi.fn(() => Effect.succeed({
      selection,
      basis,
      expectedActiveHead: {
        activationSequence: 1n,
        headSha256: "b".repeat(64),
      },
    } as CoherentActiveApplication));
    const sourceRead = vi.fn(() => Effect.succeed({
      sourceArtifact: manifest.sourceArtifact,
      modules: Object.freeze([{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "c".repeat(64),
        sourceByteLength: 65,
        source: "export const get = query(() => ({ ok: true }));\n",
      }]),
    }));
    const hostRun = vi.fn(input => {
      expect(input.request).toMatchObject({
        target: {
          revisionId: "revision-query",
          function: { path: "users:get", entrySha256: "a".repeat(64) },
        },
        arguments: { value: 1 },
        tables: [],
        context: {
          mode: "query",
          executionId: "execution-query",
          executionTime: 1_800_000_000_000,
          snapshotCommitSeq: 7n,
        },
      });
      expect(input.capability).toEqual(expect.objectContaining({}));
      return Effect.promise(async () => {
        await input.capability.revalidate();
        await input.capability.readPointDocument(
          "users",
          "1:00000000-0000-0000-0000-000000000001",
        );
        await input.capability.queryIndexRange(
          "users",
          "by_name",
          { startInclusive: "" },
          2,
        );
        return { ok: true };
      });
    });
    const live = {
      activation: { readActive },
      snapshot: {} as ApplicationQuerySystemLive["snapshot"],
      snapshotBudget: queryBudget(),
      source: { read: sourceRead },
      host: { runTransaction: hostRun, runAction: vi.fn() },
      executionContextFactory: () => ({
        executionId: "execution-query",
        executionTime: 1_800_000_000_000,
        randomSeed: new Uint8Array(32).fill(3),
      }),
    } satisfies ApplicationQuerySystemLive;

    const result = await Effect.runPromise(Effect.scoped(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("users:get"),
        { value: 1 },
      ).pipe(
        Effect.provide(makeApplicationQuerySystemLayer(live)),
      ),
    ));

    expect(result).toEqual({ ok: true });
    expect(readActive).toHaveBeenCalledOnce();
    expect(operations.open).toHaveBeenCalledWith(
      selection,
      "users:get",
      live.snapshotBudget,
      live.snapshot,
    );
    expect(sourceRead).toHaveBeenCalledWith("1".repeat(64));
    expect(hostRun).toHaveBeenCalledOnce();
    expect(operations.revalidate).toHaveBeenCalledWith(snapshot);
    expect(operations.readPoint).toHaveBeenCalledWith(
      snapshot,
      "users",
      "1:00000000-0000-0000-0000-000000000001",
    );
    expect(operations.readIndex).toHaveBeenCalledWith(
      snapshot,
      "users",
      "by_name",
      { startInclusive: "" },
      2,
    );
  });

  it("projects authenticated user identity into the exact Worker request", async () => {
    const manifest = applicationManifest();
    const selection = Object.freeze({}) as ApplicationActiveSelection;
    const basis = activeBasis(manifest);
    const snapshot = Object.freeze({});
    const metadata = Object.freeze({
      basis,
      function: Object.freeze({
        ...manifest.functions[0]!,
        kind: "query" as const,
        visibility: "public" as const,
        entrySha256: "a".repeat(64),
      }),
      tables: Object.freeze([]),
      snapshotToken: Object.freeze({
        scopeId: "scope_query",
        epoch: "epoch-query",
        commitSeq: 7n,
      }),
      budget: queryBudget(),
    });
    operations.open.mockReturnValue(Effect.succeed({ snapshot, metadata }));
    const identity = Object.freeze({
      kind: "user" as const,
      user: Object.freeze({
        tokenIdentifier: "issuer|user-1",
        subject: "user-1",
        issuer: "https://auth.example.com",
        role: "cook",
      }),
    });
    const hostRun = vi.fn(input => {
      expect(input.request.auth).toEqual(identity);
      return Effect.succeed({ ok: true });
    });
    const live = {
      activation: { readActive: () => Effect.succeed({
        selection,
        basis,
        expectedActiveHead: {
          activationSequence: 1n,
          headSha256: "b".repeat(64),
        },
      } as CoherentActiveApplication) },
      snapshot: {} as ApplicationQuerySystemLive["snapshot"],
      snapshotBudget: queryBudget(),
      source: { read: () => Effect.succeed({
        sourceArtifact: manifest.sourceArtifact,
        modules: Object.freeze([{
          path: "_flarex/application.js",
          roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
          sourceSha256: "c".repeat(64),
          sourceByteLength: 65,
          source: "export const get = query(() => ({ ok: true }));\n",
        }]),
      }) },
      host: { runTransaction: hostRun, runAction: vi.fn() },
      executionContextFactory: () => ({
        executionId: "execution-query-user",
        executionTime: 1_800_000_000_000,
        randomSeed: new Uint8Array(32).fill(4),
      }),
    } satisfies ApplicationQuerySystemLive;

    await Effect.runPromise(Effect.scoped(
      invokeApplicationQuery("users:get", { value: 1 }, identity).pipe(
        Effect.provide(makeApplicationQuerySystemLayer(live)),
      ),
    ));

    expect(hostRun).toHaveBeenCalledOnce();
  });

  it("exposes rejected Worker read capabilities through the host boundary", async () => {
    const manifest = applicationManifest();
    const selection = Object.freeze({}) as ApplicationActiveSelection;
    const basis = activeBasis(manifest);
    operations.open.mockReturnValue(Effect.succeed({
      snapshot: Object.freeze({}),
      metadata: Object.freeze({
        basis,
        function: Object.freeze({
          ...manifest.functions[0]!,
          kind: "query" as const,
          visibility: "public" as const,
          entrySha256: "a".repeat(64),
        }),
        tables: Object.freeze([]),
        snapshotToken: Object.freeze({
          scopeId: "scope_query",
          epoch: "epoch-query",
          commitSeq: 7n,
        }),
        budget: queryBudget(),
      }),
    }));
    const readBoundaryError = new ApplicationExecutionHostError({
      operation: "transaction",
      reason: "readBoundaryFailed",
    });
    const live = {
      activation: { readActive: () => Effect.succeed({
        selection,
        basis,
        expectedActiveHead: {
          activationSequence: 1n,
          headSha256: "b".repeat(64),
        },
      } as CoherentActiveApplication) },
      snapshot: {} as ApplicationQuerySystemLive["snapshot"],
      snapshotBudget: queryBudget(),
      source: { read: () => Effect.succeed({
        sourceArtifact: manifest.sourceArtifact,
        modules: Object.freeze([{
          path: "_flarex/application.js",
          roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
          sourceSha256: "c".repeat(64),
          sourceByteLength: 65,
          source: "export const get = query(() => ({ ok: true }));\n",
        }]),
      }) },
      host: {
        runTransaction: () => Effect.fail(readBoundaryError),
        runAction: vi.fn(),
      },
      executionContextFactory: () => ({
        executionId: "execution-query-read-boundary",
        executionTime: 1_800_000_000_000,
        randomSeed: new Uint8Array(32).fill(6),
      }),
    } satisfies ApplicationQuerySystemLive;

    const result = await Effect.runPromise(Effect.result(Effect.scoped(
      invokeApplicationQuery("users:get", { value: 1 }).pipe(
        Effect.provide(makeApplicationQuerySystemLayer(live)),
      ),
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBe(readBoundaryError);
      expect(result.failure).toMatchObject({
        _tag: "ApplicationExecutionHostError",
        operation: "transaction",
        reason: "readBoundaryFailed",
      });
    }
  });

  it("rejects non-object arguments before reading active authority", async () => {
    const readActive = vi.fn(() => Effect.die("must not read"));
    const live = {
      activation: { readActive },
      snapshot: {} as ApplicationQuerySystemLive["snapshot"],
      snapshotBudget: queryBudget(),
      source: { read: () => Effect.die("must not read") },
      host: {
        runTransaction: () => Effect.die("must not run"),
        runAction: () => Effect.die("must not run"),
      },
      executionContextFactory: () => ({
        executionId: "unused",
        executionTime: 1,
        randomSeed: new Uint8Array(32),
      }),
    } satisfies ApplicationQuerySystemLive;

    const result = await Effect.runPromise(Effect.result(Effect.scoped(
      invokeApplicationQuery("users:get", "not-an-object").pipe(
        Effect.provide(makeApplicationQuerySystemLayer(live)),
      ),
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "invalidArguments" });
    }
    expect(readActive).not.toHaveBeenCalled();
  });

  it("reports malformed authentication separately from query arguments", async () => {
    const readActive = vi.fn(() => Effect.die("must not read"));
    const live = {
      activation: { readActive },
      snapshot: {} as ApplicationQuerySystemLive["snapshot"],
      snapshotBudget: queryBudget(),
      source: { read: () => Effect.die("must not read") },
      host: {
        runTransaction: () => Effect.die("must not run"),
        runAction: () => Effect.die("must not run"),
      },
      executionContextFactory: () => ({
        executionId: "unused",
        executionTime: 1,
        randomSeed: new Uint8Array(32),
      }),
    } satisfies ApplicationQuerySystemLive;

    const result = await Effect.runPromise(Effect.result(Effect.scoped(
      invokeApplicationQuery(
        "users:get",
        { ok: true },
        { kind: "user", user: {} } as never,
      ).pipe(Effect.provide(makeApplicationQuerySystemLayer(live))),
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "invalidIdentity" });
    }
    expect(readActive).not.toHaveBeenCalled();
  });

  it("applies the query argument ceiling during traversal before reading active authority", async () => {
    const readActive = vi.fn(() => Effect.die("must not read"));
    const live = {
      activation: { readActive },
      snapshot: {} as ApplicationQuerySystemLive["snapshot"],
      snapshotBudget: queryBudget(),
      source: { read: () => Effect.die("must not read") },
      host: {
        runTransaction: () => Effect.die("must not run"),
        runAction: () => Effect.die("must not run"),
      },
      executionContextFactory: () => ({
        executionId: "unused",
        executionTime: 1,
        randomSeed: new Uint8Array(32),
      }),
    } satisfies ApplicationQuerySystemLive;
    let hostileReads = 0;
    const hostile = Object.defineProperty({}, "late", {
      enumerable: true,
      get: () => {
        hostileReads += 1;
        throw new Error("must not traverse after the query byte ceiling");
      },
    });

    const result = await Effect.runPromise(Effect.result(Effect.scoped(
      invokeApplicationQuery("users:get", {
        first: "x".repeat(MAX_APPLICATION_QUERY_ARGUMENT_SEMANTIC_BYTES_V1),
        hostile,
      }).pipe(Effect.provide(makeApplicationQuerySystemLayer(live))),
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "invalidArguments" });
    }
    expect(hostileReads).toBe(0);
    expect(readActive).not.toHaveBeenCalled();
  });

  it("captures the exact live capabilities once when constructing the Layer", async () => {
    const manifest = applicationManifest();
    const selection = Object.freeze({}) as ApplicationActiveSelection;
    const basis = activeBasis(manifest);
    const snapshot = Object.freeze({});
    operations.open.mockReturnValue(Effect.succeed({
      snapshot,
      metadata: Object.freeze({
        basis,
        function: Object.freeze({
          ...manifest.functions[0]!,
          kind: "query" as const,
          visibility: "public" as const,
          entrySha256: "a".repeat(64),
        }),
        tables: Object.freeze([]),
        snapshotToken: Object.freeze({
          scopeId: "scope_query",
          epoch: "epoch-query",
          commitSeq: 7n,
        }),
        budget: queryBudget(),
      }),
    }));
    const originalRead = vi.fn(() => Effect.succeed({
      selection,
      basis,
      expectedActiveHead: {
        activationSequence: 1n,
        headSha256: "b".repeat(64),
      },
    } as CoherentActiveApplication));
    const swappedRead = vi.fn(() => Effect.die("must not use swapped authority"));
    const originalHost = vi.fn(() => Effect.succeed({ ok: true }));
    const swappedHost = vi.fn(() => Effect.die("must not use swapped host"));
    const mutableLive = {
      activation: { readActive: originalRead },
      snapshot: {} as ApplicationQuerySystemLive["snapshot"],
      snapshotBudget: queryBudget(),
      source: { read: () => Effect.succeed({
        sourceArtifact: manifest.sourceArtifact,
        modules: Object.freeze([{
          path: "_flarex/application.js",
          roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
          sourceSha256: "c".repeat(64),
          sourceByteLength: 65,
          source: "export const get = query(() => ({ ok: true }));\n",
        }]),
      }) },
      host: { runTransaction: originalHost, runAction: vi.fn() },
      executionContextFactory: () => ({
        executionId: "execution-query-captured",
        executionTime: 1_800_000_000_000,
        randomSeed: new Uint8Array(32).fill(5),
      }),
    } satisfies ApplicationQuerySystemLive;
    const layer = makeApplicationQuerySystemLayer(mutableLive);
    mutableLive.activation.readActive = swappedRead;
    mutableLive.host.runTransaction = swappedHost;

    const result = await Effect.runPromise(Effect.scoped(
      invokeApplicationQuery("users:get", { value: 1 }).pipe(
        Effect.provide(layer),
      ),
    ));

    expect(result).toEqual({ ok: true });
    expect(originalRead).toHaveBeenCalledOnce();
    expect(originalHost).toHaveBeenCalledOnce();
    expect(swappedRead).not.toHaveBeenCalled();
    expect(swappedHost).not.toHaveBeenCalled();
  });
});

function applicationManifest(): ApplicationManifestV1 {
  return Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: {
      rootSha256: "1".repeat(64),
      executionModulePath: "_flarex/application.js",
      schemaModulePath: null,
      modules: [{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "c".repeat(64),
        sourceByteLength: 65,
      }],
    },
    schema: { version: 1, tables: [], indexes: [] },
    functions: [{
      path: "users:get",
      moduleName: "users",
      exportName: "get",
      kind: "query",
      visibility: "public",
      args: { type: "any" },
      returns: { type: "any" },
      partition: null,
    }],
  })).manifest;
}

function activeBasis(manifest: ApplicationManifestV1) {
  return Object.freeze({
    authority: Object.freeze({
      deploymentId: "deployment-query",
      scopeId: "scope_query",
      physicalLocator: Object.freeze({
        kind: "shared_database" as const,
        databaseKey: "primary",
        schemaName: "public",
      }),
      storageGeneration: "flarexdb_v1" as const,
      storageGenerationFence: 1n,
      epoch: "epoch-query",
      lastCommitSeq: 7n,
      lastOutboxSeq: 0n,
    }),
    deploymentId: "deployment-query",
    revisionId: "revision-query",
    candidateId: "candidate-query",
    analysisId: "analysis-query",
    sourceArtifactRootSha256: new Uint8Array(32).fill(0x11),
    manifestSha256: new Uint8Array(32).fill(0x22),
    manifest,
    publicationSha256: new Uint8Array(32).fill(0x33),
    functionCatalogSha256: new Uint8Array(32).fill(0x44),
    applicationSchemaSha256: new Uint8Array(32).fill(0x55),
    schemaVersionId: "application_schema",
    schemaManifestSha256: new Uint8Array(32).fill(0x66),
    schemaBindingSha256: new Uint8Array(32).fill(0x77),
    taskCatalogSha256: new Uint8Array(32).fill(0x88),
    taskCatalogBindingSha256: new Uint8Array(32).fill(0x99),
    runtimeHostIdentity: "cold-materializer-fixture-v1",
    compatibilityDate: "2026-06-14",
    readinessSha256: new Uint8Array(32).fill(0xaa),
    activationSequence: 1n,
    activationSha256: new Uint8Array(32).fill(0xbb),
    headSha256: new Uint8Array(32).fill(0xcc),
  }) as CoherentActiveApplication["basis"];
}

function queryBudget() {
  return Object.freeze({
    maximumPointReads: 16,
    maximumIndexReads: 16,
    maximumDocuments: 64,
    maximumSemanticBytes: 1_048_576,
  });
}
