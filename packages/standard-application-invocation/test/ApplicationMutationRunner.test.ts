import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  ApplicationPointMutationJournalProjectionV1Error,
} from "@flarex/executor/point-mutation-journal-rpc";
import {
  PointMutationExactRuntimeRunnerHostV1Error,
} from "@flarex/executor/point-mutation-exact-runtime-runner";
import type {
  PointMutationOccBoundJournalV1,
  PointMutationOccRuntimeNeutralRunnerInputV1,
} from "@flarex/executor/internal/stored-attempt-authentication-v1";
import {
  PointMutationOccApplicationErrorV1,
  PointMutationOccUserCodeV1Error,
} from "@flarex/executor/internal/stored-attempt-authentication-v1";
import type {
  ApplicationMutationCommitAuthorityGraphEvidence,
  AuthenticatedApplicationMutationCommitAuthorityGraph,
} from "@flarex/persistence-postgres/internal/application-mutation-commit-authority-graph";
import { Effect, Result } from "effect";
import type {
  InertApplicationMutationGrantEvidenceV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import type {
  ApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION } from
  "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationExecutionHostApplicationError,
  ApplicationExecutionHostError,
  type ApplicationExecutionHost,
} from "flarex-backend/internal/application-execution-host";
import {
  ApplicationAnalysisSourceReadError,
} from "flarex-backend/internal/application-analysis-source-reader";

const graphOperations = vi.hoisted(() => ({ inspect: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {} }));
vi.mock(
  "@flarex/persistence-postgres/internal/application-mutation-commit-authority-graph",
  () => ({
    inspectApplicationMutationCommitAuthorityGraph: graphOperations.inspect,
  }),
);

import {
  makeApplicationMutationRuntimeNeutralRunner,
} from "../src/ApplicationMutationRunner";

const SOURCE = "export const save = mutation(() => ({ ok: true }));\n";
const SOURCE_BYTES = new TextEncoder().encode(SOURCE).byteLength;

describe("Application mutation runner", () => {
  beforeEach(() => {
    graphOperations.inspect.mockReset();
  });

  it("dispatches Application authority through exact source, definition, journal, and host composition", async () => {
    const fixture = makeFixture();
    graphOperations.inspect.mockReturnValue(fixture.graph);
    const sourceRead = vi.fn(() => Effect.succeed(fixture.source));
    const hostRun = vi.fn((hostInput: Parameters<
      ApplicationExecutionHost["runTransaction"]
    >[0]) => Effect.promise(async () => {
      await (hostInput.capability as { revalidate(): Promise<void> }).revalidate();
      expect(hostInput.definition.compatibilityDate).toBe("2026-08-12");
      expect(hostInput.request).toMatchObject({
        target: { function: { path: "recipes:save", kind: "mutation" } },
        auth: { kind: "anonymous" },
        argumentSemanticBytes: fixture.argumentSemanticBytes,
        context: {
          mode: "write",
          executionId: "execution-application",
          executionTime: 1_800_000_000_000,
          initialCreationTimeCursor: 1_800_000_000_001,
        },
      });
      expect((hostInput.request as { arguments: unknown }).arguments).toEqual({
        photo: new Uint8Array([0, 1]).buffer,
        servings: 4n,
        title: "Soup",
      });
      return { ok: true };
    }));
    const legacyRun = vi.fn(() => Effect.succeed("legacy"));
    const runner = await Effect.runPromise(
      makeApplicationMutationRuntimeNeutralRunner({
        legacy: Object.freeze({ run: legacyRun }),
        source: Object.freeze({ read: sourceRead }),
        host: Object.freeze({ runTransaction: hostRun }),
      }),
    );

    await expect(Effect.runPromise(runner.run(fixture.input)))
      .resolves.toEqual({ ok: true });
    expect(sourceRead).toHaveBeenCalledWith("1".repeat(64));
    expect(hostRun).toHaveBeenCalledOnce();
    expect(legacyRun).not.toHaveBeenCalled();
  });

  it("delegates legacy authority without inspecting or loading Application evidence", async () => {
    const fixture = makeFixture();
    const legacyRun = vi.fn(() => Effect.succeed("legacy-result"));
    const sourceRead = vi.fn(() => Effect.die("must not read"));
    const hostRun = vi.fn(() => Effect.die("must not run"));
    const runner = await Effect.runPromise(
      makeApplicationMutationRuntimeNeutralRunner({
        legacy: Object.freeze({ run: legacyRun }),
        source: Object.freeze({ read: sourceRead }),
        host: Object.freeze({ runTransaction: hostRun }),
      }),
    );
    const legacyInput = Object.freeze({
      ...fixture.input,
      executionAuthorityGeneration: "legacy_dynamic_worker_v1" as const,
      verifiedGrant: Object.freeze({}),
      functionMetadata: Object.freeze({}),
      applicationGraph: undefined,
    }) as unknown as PointMutationOccRuntimeNeutralRunnerInputV1;

    await expect(Effect.runPromise(runner.run(legacyInput)))
      .resolves.toBe("legacy-result");
    expect(legacyRun).toHaveBeenCalledWith(legacyInput);
    expect(graphOperations.inspect).not.toHaveBeenCalled();
    expect(sourceRead).not.toHaveBeenCalled();
    expect(hostRun).not.toHaveBeenCalled();
  });

  it("projects the authenticated host application-error branch into the existing mutation error", async () => {
    const fixture = makeFixture();
    graphOperations.inspect.mockReturnValue(fixture.graph);
    const runner = await applicationRunner(
      fixture,
      Effect.fail(new ApplicationExecutionHostApplicationError({
        operation: "transaction",
        code: "recipe-not-publishable",
        message: "Recipe is not publishable.",
        data: { missing: ["photo"] },
      })),
    );

    const error = await Effect.runPromise(runner.run(fixture.input).pipe(
      Effect.flip,
    ));
    expect(error).toEqual(new PointMutationOccApplicationErrorV1({
      code: "recipe-not-publishable",
      message: "Recipe is not publishable.",
      data: { missing: ["photo"] },
    }));
  });

  it("preserves poisoned journal precedence over a later host user-code failure", async () => {
    const fixture = makeFixture();
    graphOperations.inspect.mockReturnValue(fixture.graph);
    const host = Effect.promise(async () => {
      const input = hostInputCapture.value;
      try {
        await (input.capability as {
          readPointDocument(table: unknown, id: unknown): Promise<unknown>;
        }).readPointDocument("recipes", "not-an-id");
      } catch {
        // Model user code catching the redacted remote stop.
      }
    }).pipe(Effect.andThen(Effect.fail(new ApplicationExecutionHostError({
      operation: "transaction",
      reason: "userCodeFailed",
      cause: new Error("later user failure"),
    }))));
    const runner = await applicationRunner(fixture, host);

    const error = await Effect.runPromise(runner.run(fixture.input).pipe(
      Effect.flip,
    ));
    expect(error).toBeInstanceOf(
      ApplicationPointMutationJournalProjectionV1Error,
    );
    expect(error).not.toBeInstanceOf(PointMutationOccUserCodeV1Error);
  });

  it("maps source and infrastructure failures into the existing runner host family", async () => {
    const fixture = makeFixture();
    graphOperations.inspect.mockReturnValue(fixture.graph);
    const sourceCause = new ApplicationAnalysisSourceReadError({
      operation: "read",
      reason: "sourceReadFailed",
      cause: new Error("R2 unavailable"),
    });
    const runner = await Effect.runPromise(
      makeApplicationMutationRuntimeNeutralRunner({
        legacy: Object.freeze({ run: () => Effect.succeed("legacy") }),
        source: Object.freeze({ read: () => Effect.fail(sourceCause) }),
        host: Object.freeze({ runTransaction: () => Effect.die("must not run") }),
      }),
    );

    const error = await Effect.runPromise(runner.run(fixture.input).pipe(
      Effect.flip,
    ));
    expect(error).toBeInstanceOf(PointMutationExactRuntimeRunnerHostV1Error);
    expect(error).toMatchObject({
      reason: "sourceArtifactLoadFailed",
      cause: sourceCause,
    });
  });

  it("fails a forged graph before source, journal, or host work", async () => {
    const fixture = makeFixture();
    const graphCause = new Error("forged graph");
    graphOperations.inspect.mockImplementation(() => {
      throw graphCause;
    });
    const sourceRead = vi.fn(() => Effect.die("must not read"));
    const hostRun = vi.fn(() => Effect.die("must not run"));
    const runner = await Effect.runPromise(
      makeApplicationMutationRuntimeNeutralRunner({
        legacy: Object.freeze({ run: () => Effect.succeed("legacy") }),
        source: Object.freeze({ read: sourceRead }),
        host: Object.freeze({ runTransaction: hostRun }),
      }),
    );

    const error = await Effect.runPromise(runner.run(fixture.input).pipe(
      Effect.flip,
    ));
    expect(error).toBeInstanceOf(PointMutationExactRuntimeRunnerHostV1Error);
    expect(error).toMatchObject({
      reason: "requestProjectionInvalid",
      cause: graphCause,
    });
    expect(sourceRead).not.toHaveBeenCalled();
    expect(hostRun).not.toHaveBeenCalled();
  });

  it("rejects authenticated argument-accounting drift before source or Worker work", async () => {
    const fixture = makeFixture();
    graphOperations.inspect.mockReturnValue(fixture.graph);
    const sourceRead = vi.fn(() => Effect.die("must not read"));
    const hostRun = vi.fn(() => Effect.die("must not run"));
    const runner = await Effect.runPromise(
      makeApplicationMutationRuntimeNeutralRunner({
        legacy: Object.freeze({ run: () => Effect.succeed("legacy") }),
        source: Object.freeze({ read: sourceRead }),
        host: Object.freeze({ runTransaction: hostRun }),
      }),
    );
    const mismatched = Object.freeze({
      ...fixture.input,
      argumentArraySemanticBytes: fixture.input.argumentArraySemanticBytes + 1,
    }) as PointMutationOccRuntimeNeutralRunnerInputV1;

    const error = await Effect.runPromise(runner.run(mismatched).pipe(
      Effect.flip,
    ));
    expect(error).toBeInstanceOf(PointMutationExactRuntimeRunnerHostV1Error);
    expect(error).toMatchObject({ reason: "requestProjectionInvalid" });
    expect(sourceRead).not.toHaveBeenCalled();
    expect(hostRun).not.toHaveBeenCalled();
  });

  it("rebuilds source and Worker definition for every OCC runner invocation", async () => {
    const fixture = makeFixture();
    graphOperations.inspect.mockReturnValue(fixture.graph);
    const sourceRead = vi.fn(() => Effect.succeed(fixture.source));
    const hostRun = vi.fn((
      _input: Parameters<ApplicationExecutionHost["runTransaction"]>[0],
    ) => Effect.succeed({ ok: true }));
    const runner = await Effect.runPromise(
      makeApplicationMutationRuntimeNeutralRunner({
        legacy: Object.freeze({ run: () => Effect.succeed("legacy") }),
        source: Object.freeze({ read: sourceRead }),
        host: Object.freeze({ runTransaction: hostRun }),
      }),
    );

    await Effect.runPromise(runner.run(fixture.input));
    await Effect.runPromise(runner.run(fixture.input));
    expect(graphOperations.inspect).toHaveBeenCalledTimes(2);
    expect(sourceRead).toHaveBeenCalledTimes(2);
    expect(hostRun).toHaveBeenCalledTimes(2);
    expect(hostRun.mock.calls[0]?.[0].definition).not.toBe(
      hostRun.mock.calls[1]?.[0].definition,
    );
  });
});

const hostInputCapture: { value: Parameters<
  ApplicationExecutionHost["runTransaction"]
>[0] } = { value: undefined as never };

async function applicationRunner(
  fixture: ReturnType<typeof makeFixture>,
  hostEffect: Effect.Effect<CanonicalFlarexRuntimeValueV1, ApplicationExecutionHostError |
    ApplicationExecutionHostApplicationError>,
) {
  return Effect.runPromise(makeApplicationMutationRuntimeNeutralRunner({
    legacy: Object.freeze({ run: () => Effect.succeed("legacy") }),
    source: Object.freeze({ read: () => Effect.succeed(fixture.source) }),
    host: Object.freeze({
      runTransaction: input => {
        hostInputCapture.value = input;
        return hostEffect;
      },
    }),
  }));
}

function makeFixture() {
  const manifest = applicationManifest();
  const runtimeTarget: ApplicationRuntimeTargetV1 = Object.freeze({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: "scope-application",
    revisionId: "revision-application",
    candidateId: "candidate-application",
    analysisId: "analysis-application",
    sourceArtifactRootSha256: "1".repeat(64),
    manifestSha256: "2".repeat(64),
    schemaSha256: "3".repeat(64),
    functionCatalogSha256: "4".repeat(64),
    publicationSha256: "5".repeat(64),
    executionModulePath: "_flarex/application.js",
    function: Object.freeze({
      ...manifest.functions[0]!,
      entrySha256: "6".repeat(64),
    }),
  });
  const graph = Object.freeze({
    authority: Object.freeze({}),
    manifest,
    runtimeTarget,
    compatibilityDate: "2026-08-12",
    readinessSha256: "7".repeat(64),
    activationSha256: "8".repeat(64),
  }) as ApplicationMutationCommitAuthorityGraphEvidence;
  const normalized = normalizeFlarexValueV1({
    photo: new Uint8Array([0, 1]).buffer,
    servings: 4n,
    title: "Soup",
  });
  const input = Object.freeze({
    executionAuthorityGeneration: "application_v1" as const,
    verifiedGrant: Object.freeze({
      payload: Object.freeze({ auth: Object.freeze({ kind: "anonymous" }) }),
    }) as InertApplicationMutationGrantEvidenceV1,
    applicationGraph: Object.freeze({}) as
      AuthenticatedApplicationMutationCommitAuthorityGraph,
    argumentsJson: normalized.valueJson,
    argumentArraySemanticBytes: normalized.semanticSizeBytes + 2,
    schemaManifest: Object.freeze({}),
    stableBindings: Object.freeze([]),
    context: Object.freeze({
      executionId: "execution-application",
      logScopeId: "log-application",
      randomSeed: new Uint8Array(32).fill(0x11),
      executionTime: 1_800_000_000_000,
      initialCreationTimeCursor: 1_800_000_000_001,
      snapshotToken: Object.freeze({
        scopeId: "scope-application",
        epoch: "epoch-application",
        commitSeq: 7n,
      }),
    }),
    journal: inertJournal(),
  }) as unknown as PointMutationOccRuntimeNeutralRunnerInputV1;
  return Object.freeze({
    argumentSemanticBytes: normalized.semanticSizeBytes,
    graph,
    input,
    source: Object.freeze({
      sourceArtifact: manifest.sourceArtifact,
      modules: Object.freeze([Object.freeze({
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "c".repeat(64),
        sourceByteLength: SOURCE_BYTES,
        source: SOURCE,
      })]),
    }),
  });
}

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
        sourceByteLength: SOURCE_BYTES,
      }],
    },
    schema: { version: 1, tables: [], indexes: [] },
    functions: [{
      path: "recipes:save",
      moduleName: "recipes",
      exportName: "save",
      kind: "mutation",
      visibility: "public",
      args: { type: "any" },
      returns: { type: "any" },
      partition: null,
    }],
  })).manifest;
}

function inertJournal(): PointMutationOccBoundJournalV1 {
  return Object.freeze({
    resolvePointTable: () => Effect.die("point table must not resolve"),
    runPointOperation: () => Effect.die("point operation must not run"),
    resolveDeveloperIndex: () => Effect.die("index must not resolve"),
    runIndexedQuery: () => Effect.die("indexed query must not run"),
  });
}
