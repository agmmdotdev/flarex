import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import type {
  ApplicationActiveSelection,
  CoherentActiveApplication,
} from "@flarex/persistence-postgres/internal/application-activation";
import { ScopeExecutionLive } from
  "@flarex/persistence-postgres/internal/scope-execution";
import { Effect, Result } from "effect";
import {
  ScopeSyncQueryModelSha256,
  ScopeSyncQueryModelSha256Error,
} from "flarex-protocol/internal/scope-sync-query-model-v1";
import {
  ScopeSyncQueryGenerationSequenceV1Schema,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import {
  MAX_APPLICATION_QUERY_ARGUMENT_SEMANTIC_BYTES_V1,
} from "flarex-protocol/internal/application-worker-v1";
import { TransactionFunctionPathV1Schema } from
  "flarex-protocol/transaction-session";
import { decodeAppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION } from
  "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { describe, expect, it, vi } from "vitest";
import { ApplicationExecutionHostError } from
  "flarex-backend/internal/application-execution-host";
import {
  captureScopeSyncQueryEvaluationProjectionV1Result,
} from "flarex-backend/internal/query-sync-model-v1";

const operations = vi.hoisted(() => ({
  open: vi.fn(),
  finalize: vi.fn(),
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
    finalizeApplicationQueryEvaluationSnapshot: operations.finalize,
    revalidateApplicationQuerySnapshot: operations.revalidate,
    readApplicationQueryPoint: operations.readPoint,
    readApplicationQueryIndex: operations.readIndex,
  }),
);

import {
  makeApplicationSelectionQueryPort,
  makeApplicationSelectionQueryEvaluationPort,
  makeApplicationQuerySystemLayer,
  invokeApplicationQuery,
  type ApplicationQuerySystemLive,
  type ApplicationSelectionQueryLive,
} from "../src/ApplicationQuerySystem";

describe("Application query system", () => {
  it("reuses the query core against one supplied opaque selection", async () => {
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
    const source = {
      read(rootSha256: string) {
        expect(this).toBe(source);
        expect(rootSha256).toBe("1".repeat(64));
        return Effect.succeed({
          sourceArtifact: manifest.sourceArtifact,
          modules: Object.freeze([{
            path: "_flarex/application.js",
            roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
            sourceSha256: "c".repeat(64),
            sourceByteLength: 65,
            source: "export const get = query(() => ({ ok: true }));\n",
          }]),
        });
      },
    };
    const host = {
      runTransaction(input: Parameters<
        ApplicationSelectionQueryLive["host"]["runTransaction"]
      >[0]) {
        expect(this).toBe(host);
        expect(input.request).toMatchObject({
          auth: {
            kind: "user",
            user: { tokenIdentifier: "task-query-user" },
          },
          arguments: { value: 1 },
          context: { mode: "query", snapshotCommitSeq: 7n },
        });
        return Effect.succeed({ reused: true });
      },
    };
    const live = {
      snapshot: {} as ApplicationSelectionQueryLive["snapshot"],
      snapshotBudget: queryBudget(),
      source,
      host,
      executionContextFactory: () => ({
        executionId: "selection-query",
        executionTime: 1_800_000_000_000,
        randomSeed: new Uint8Array(32).fill(6),
      }),
    } satisfies ApplicationSelectionQueryLive;
    const port = await Effect.runPromise(
      makeApplicationSelectionQueryPort(live).pipe(
        Effect.provide(ScopeExecutionLive),
      ),
    );

    const result = await Effect.runPromise(Effect.scoped(port.runQuery(
      selection,
      "users:get",
      { value: 1 },
      {
        kind: "user",
        user: {
          tokenIdentifier: "task-query-user",
          subject: "user-1",
          issuer: "https://issuer.example",
        },
      },
    )));

    expect(result).toEqual({ reused: true });
    expect(operations.open).toHaveBeenCalledWith(
      selection,
      "users:get",
      live.snapshotBudget,
      live.snapshot,
    );
    expect(operations.open.mock.calls[0]).toHaveLength(4);
  });

  it("produces one coherent private evaluation receipt and portable projection", async () => {
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
        scopeId: basis.authority.scopeId,
        epoch: basis.authority.epoch,
        commitSeq: 7n,
      }),
      budget: queryBudget(),
    });
    const pointDependency = Object.freeze({
      kind: "appRowPoint" as const,
      documentId: decodeAppDocumentIdV1(
        "1:00000000-0000-0000-0000-000000000001",
      ),
    });
    const tableDependency = Object.freeze({
      kind: "appTable" as const,
      tableId: decodeCatalogTableId(1),
    });
    operations.open.mockReturnValue(Effect.succeed({ snapshot, metadata }));
    operations.revalidate.mockReturnValue(Effect.succeed(metadata));
    operations.readPoint.mockReturnValue(Effect.succeed({ kind: "missing" }));
    operations.readIndex.mockReturnValue(Effect.succeed({
      documents: [],
      isDone: true,
    }));
    operations.finalize.mockReturnValue(Effect.succeed(Object.freeze({
      metadata,
      dependencies: Object.freeze([tableDependency, pointDependency]),
    })));
    const live = {
      snapshot: {} as ApplicationSelectionQueryLive["snapshot"],
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
        runTransaction: input => Effect.promise(async () => {
          const readPoint = Reflect.get(
            input.capability,
            "readPointDocument",
          );
          const queryIndex = Reflect.get(input.capability, "queryIndexRange");
          if (typeof readPoint !== "function" || typeof queryIndex !== "function") {
            throw new Error("Expected Application query RPC capability.");
          }
          await Reflect.apply(readPoint, input.capability, [
            "users",
            pointDependency.documentId,
          ]);
          await Reflect.apply(queryIndex, input.capability, [
            "users",
            "by_name",
            {},
            10,
          ]);
          return { ok: true };
        }),
      },
      executionContextFactory: () => ({
        executionId: "evaluation-query",
        executionTime: 1_800_000_000_000,
        randomSeed: new Uint8Array(32).fill(7),
      }),
    } satisfies ApplicationSelectionQueryLive;
    const port = await Effect.runPromise(
      makeApplicationSelectionQueryEvaluationPort(live).pipe(
        Effect.provide(ScopeExecutionLive),
      ),
    );

    const receipt = await Effect.runPromise(Effect.scoped(port.evaluate(
      selection,
      "users:get",
      { value: 1 },
      {
        kind: "user",
        user: {
          tokenIdentifier: "issuer|user-1",
          subject: "user-1",
          issuer: "https://issuer.example",
          role: "cook",
        },
      },
    ).pipe(
      Effect.provideService(ScopeSyncQueryModelSha256, webCryptoSha256),
    )));

    expect(receipt.query.frame.identity).toMatchObject({
      scopeUuid: "00000000-0000-4000-8000-000000000001",
      epochUuid: "00000000-0000-4000-8000-000000000002",
      activationSequence: 1n,
      activeHeadSha256Hex: "cc".repeat(32),
      sourcePackageSha256Hex: "11".repeat(32),
      schemaVersionId: "application_schema",
      policyVersion: "policy_query_v1",
      componentPath: null,
      functionPath: "users:get",
    });
    expect(receipt.query.frame.identity.argumentsSha256Hex).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(receipt.query.frame.identity.identityAccessPolicySha256Hex).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(receipt.authority.authority).toMatchObject({
      scopeUuid: "00000000-0000-4000-8000-000000000001",
      epochUuid: "00000000-0000-4000-8000-000000000002",
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      activationSequence: 1n,
      activeHeadSha256Hex: "cc".repeat(32),
    });
    expect(receipt.snapshotCommitSeq).toBe(7n);
    expect(receipt.dependencies.map(value => value.dependencyKey)).toEqual([
      {
        format: "flarex.scope-sync-dependency-key",
        version: 1,
        kind: "appRowPoint",
        documentId: pointDependency.documentId,
      },
      {
        format: "flarex.scope-sync-dependency-key",
        version: 1,
        kind: "appTable",
        tableId: tableDependency.tableId,
      },
    ]);
    expect(receipt.result.value).toEqual({ ok: true });
    expect(operations.finalize).toHaveBeenCalledWith(snapshot);
    expect(operations.open).toHaveBeenLastCalledWith(
      selection,
      "users:get",
      live.snapshotBudget,
      live.snapshot,
      { dependencyCapture: "evaluation" },
    );
    const projected = captureScopeSyncQueryEvaluationProjectionV1Result({
      ...receipt,
      generation: ScopeSyncQueryGenerationSequenceV1Schema.make(1n),
    });
    expect(Result.isSuccess(projected)).toBe(true);
    if (Result.isSuccess(projected)) {
      expect(projected.success.evaluation).toMatchObject({
        namespaceId: "00000000-0000-4000-8000-000000000001",
        sourceEpoch: "00000000-0000-4000-8000-000000000002",
        snapshotSequence: 7n,
      });
    }
  });

  it("refuses evaluation evidence when the selected source root is incoherent", async () => {
    operations.finalize.mockClear();
    const manifest = applicationManifest();
    const selection = Object.freeze({}) as ApplicationActiveSelection;
    const coherentBasis = activeBasis(manifest);
    const basis = Object.freeze({
      ...coherentBasis,
      sourceArtifactRootSha256: new Uint8Array(32).fill(0x12),
    });
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
        scopeId: basis.authority.scopeId,
        epoch: basis.authority.epoch,
        commitSeq: 7n,
      }),
      budget: queryBudget(),
    });
    operations.open.mockReturnValue(Effect.succeed({ snapshot, metadata }));
    operations.finalize.mockReturnValue(Effect.succeed(Object.freeze({
      metadata,
      dependencies: Object.freeze([]),
    })));
    const live = {
      snapshot: {} as ApplicationSelectionQueryLive["snapshot"],
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
      host: { runTransaction: () => Effect.succeed({ ok: true }) },
      executionContextFactory: () => ({
        executionId: "evaluation-query-invalid-source",
        executionTime: 1_800_000_000_000,
        randomSeed: new Uint8Array(32).fill(8),
      }),
    } satisfies ApplicationSelectionQueryLive;
    const port = await Effect.runPromise(
      makeApplicationSelectionQueryEvaluationPort(live).pipe(
        Effect.provide(ScopeExecutionLive),
      ),
    );

    const result = await Effect.runPromise(Effect.result(Effect.scoped(
      port.evaluate(
        selection,
        "users:get",
        { value: 1 },
        { kind: "anonymous" },
      ).pipe(
        Effect.provideService(ScopeSyncQueryModelSha256, webCryptoSha256),
      ),
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationQueryCompositionError",
        reason: "invalidSourceIdentity",
      });
    }
  });

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
      host: { runTransaction: hostRun },
      executionContextFactory: () => ({
        executionId: "execution-query",
        executionTime: 1_800_000_000_000,
        randomSeed: new Uint8Array(32).fill(3),
      }),
    } satisfies ApplicationQuerySystemLive;

    const result = await Effect.runPromise(Effect.scoped(
      invokeApplicationQuery(
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
      host: { runTransaction: hostRun },
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
      host: { runTransaction: originalHost },
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
      scopeId: "scope_00000000-0000-4000-8000-000000000001",
      physicalLocator: Object.freeze({
        kind: "shared_database" as const,
        databaseKey: "primary",
        schemaName: "public",
      }),
      storageGeneration: "flarexdb_v1" as const,
      storageGenerationFence: 1n,
      epoch: "epoch_00000000-0000-4000-8000-000000000002",
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

const webCryptoSha256 = ScopeSyncQueryModelSha256.of({
  digest: canonicalBytes => Effect.tryPromise({
    try: async () => new Uint8Array(
      await crypto.subtle.digest("SHA-256", canonicalBytes.slice()),
    ),
    catch: cause => new ScopeSyncQueryModelSha256Error({
      operation: "digest",
      cause,
    }),
  }),
});
