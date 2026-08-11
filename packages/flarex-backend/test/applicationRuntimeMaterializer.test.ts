import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  applicationFunctionCatalogPublicationFrameV1,
  applicationFunctionEntryPublicationFrameV1,
  applicationPublicationCommitmentFrameV1,
  applicationSchemaPublicationFrameV1,
} from "@flarex/analysis/internal/application-publication-v1";
import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Effect, Fiber, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import { describe, expect, it } from "vitest";

import {
  APPLICATION_RUNTIME_COLD_ENTRYPOINT,
  APPLICATION_RUNTIME_HOST_IDENTITY,
  makeApplicationRuntimeColdWorkerDefinition,
  makeApplicationRuntimeMaterializer,
} from "../src/artifactRuntime/ApplicationRuntimeMaterializer";
import type {
  ApplicationAnalysisSourceBundle,
  ApplicationAnalysisSourceReader,
} from "../src/sourceArtifactV2/ApplicationAnalysisReader";

describe("Application Runtime materializer", () => {
  it("verifies all authority, source, and exact cold resolution before receipt", async () => {
    const fixture = await runtimeFixture();
    const loader = new FakeWorkerLoader({
      kind: "resolved",
      path: "users:get",
      functionKind: "query",
      visibility: "public",
    });
    const materializer = makeApplicationRuntimeMaterializer({
      source: reader(fixture.source),
      loader,
    });

    const receipt = await Effect.runPromise(materializer.materialize({
      target: fixture.target,
      manifest: fixture.manifest,
    }));

    expect(receipt.receipt).toMatchObject({
      status: "resolved",
      runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
      sourceArtifactRootSha256: ROOT,
      functionPath: "users:get",
      functionKind: "query",
      visibility: "public",
    });
    expect(loader.loaded).toHaveLength(1);
    expect(loader.loaded[0]).toMatchObject({
      globalOutbound: null,
      mainModule: expect.stringContaining(ROOT),
    });
    expect(loader.requestedEntrypoints).toEqual([
      APPLICATION_RUNTIME_COLD_ENTRYPOINT,
    ]);
    expect(loader.resultDisposals).toBe(1);
    const valuesShim = Object.entries(loader.loaded[0]!.modules).find(
      ([path]) => path.endsWith("/flarex/values"),
    )?.[1];
    expect(valuesShim).toMatchObject({ js: expect.any(String) });
    if (typeof valuesShim !== "object" || valuesShim === null ||
      !("js" in valuesShim) || typeof valuesShim.js !== "string") {
      throw new Error("Application Runtime values shim is missing.");
    }
    expect(valuesShim.js).not.toContain("export const query =");
  });

  it("rejects commitment mismatch before reading source or loading code", async () => {
    const fixture = await runtimeFixture();
    const loader = new FakeWorkerLoader({
      kind: "resolved",
      path: "users:get",
      functionKind: "query",
      visibility: "public",
    });
    let reads = 0;
    const source: ApplicationAnalysisSourceReader = Object.freeze({
      read: () => {
        reads += 1;
        return Effect.succeed(fixture.source);
      },
    });
    const result = await Effect.runPromise(Effect.result(
      makeApplicationRuntimeMaterializer({ source, loader }).materialize({
        target: { ...fixture.target, publicationSha256: "f".repeat(64) },
        manifest: fixture.manifest,
      }),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("authorityMismatch");
    }
    expect(reads).toBe(0);
    expect(loader.loaded).toHaveLength(0);
  });

  it("rejects ordered authenticated-source mismatch before Worker Loader", async () => {
    const fixture = await runtimeFixture();
    const loader = new FakeWorkerLoader({
      kind: "resolved",
      path: "users:get",
      functionKind: "query",
      visibility: "public",
    });
    const changed = Object.freeze({
      ...fixture.source,
      modules: Object.freeze(fixture.source.modules.map((module, index) =>
        index === 0
          ? Object.freeze({ ...module, sourceByteLength: module.sourceByteLength + 1 })
          : module
      )),
    });
    const result = await Effect.runPromise(Effect.result(
      makeApplicationRuntimeMaterializer({
        source: reader(changed),
        loader,
      }).materialize({
        target: fixture.target,
        manifest: fixture.manifest,
      }),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("sourceMismatch");
    }
    expect(loader.loaded).toHaveLength(0);
  });

  it("rejects an application path that would occupy a trusted shim", async () => {
    const fixture = await runtimeFixture();
    const collision = Object.freeze({
      path: "_flarex/flarex/server",
      roles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      sourceSha256: "e".repeat(64),
      sourceByteLength: 18,
      source: "export default {};\n",
    });

    expect(() => makeApplicationRuntimeColdWorkerDefinition({
      source: Object.freeze({
        sourceArtifact: fixture.source.sourceArtifact,
        modules: Object.freeze([...fixture.source.modules, collision]),
      }),
      function: fixture.target.function,
      compatibilityDate: "2026-06-14",
    })).toThrow(/collides/);
  });

  it("interrupts a pending RPC promptly and disposes its late result once", async () => {
    const fixture = await runtimeFixture();
    let resolveOutcome: ((value: Readonly<Record<string, unknown>>) => void) |
      undefined;
    const pending = new Promise<Readonly<Record<string, unknown>>>(resolve => {
      resolveOutcome = resolve;
    });
    let resolutionStarted: (() => void) | undefined;
    const started = new Promise<void>(resolve => {
      resolutionStarted = resolve;
    });
    const loader = new FakeWorkerLoader(pending, () => resolutionStarted?.());
    const materialization = makeApplicationRuntimeMaterializer({
      source: reader(fixture.source),
      loader,
    }).materialize({
      target: fixture.target,
      manifest: fixture.manifest,
    });
    const fiber = Effect.runFork(materialization);
    await started;

    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(loader.resultDisposals).toBe(0);
    resolveOutcome?.({
      kind: "resolved",
      path: "users:get",
      functionKind: "query",
      visibility: "public",
    });
    for (let turn = 0; turn < 10 && loader.resultDisposals === 0; turn += 1) {
      await Promise.resolve();
    }

    expect(loader.resultDisposals).toBe(1);
  });
});

const ROOT = "a".repeat(64);
const EXECUTION_SHA = "b".repeat(64);
const SCHEMA_SHA = "c".repeat(64);
const HANDLER_SHA = "d".repeat(64);

const EXECUTION_SOURCE = [
  'import { query } from "flarex/server";',
  'import { v } from "flarex/values";',
  'import * as users from "../functions/users.js";',
  "export default {",
  "  users: {",
  "    get: query({",
  '      args: v.object({ id: v.id("users") }),',
  "      returns: v.null(),",
  "      handler: users.get,",
  "    }),",
  "  },",
  "};",
  "",
].join("\n");
const SCHEMA_SOURCE = "export default {};\n";
const HANDLER_SOURCE = "export function get() { return null; }\n";

async function runtimeFixture(): Promise<Readonly<{
  readonly manifest: ApplicationManifestV1;
  readonly target: ReturnType<
    typeof canonicalizeApplicationRuntimeTargetV1
  > extends Result.Result<infer Success, unknown>
    ? Success extends { readonly target: infer Target } ? Target : never
    : never;
  readonly source: ApplicationAnalysisSourceBundle;
}>> {
  const modules = Object.freeze([{
    path: "_flarex/application.js",
    roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
    sourceSha256: EXECUTION_SHA,
    sourceByteLength: new TextEncoder().encode(EXECUTION_SOURCE).byteLength,
    source: EXECUTION_SOURCE,
  }, {
    path: "_flarex/schema.js",
    roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
    sourceSha256: SCHEMA_SHA,
    sourceByteLength: new TextEncoder().encode(SCHEMA_SOURCE).byteLength,
    source: SCHEMA_SOURCE,
  }, {
    path: "functions/users.js",
    roles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
    sourceSha256: HANDLER_SHA,
    sourceByteLength: new TextEncoder().encode(HANDLER_SOURCE).byteLength,
    source: HANDLER_SOURCE,
  }]);
  const sourceArtifact = Object.freeze({
    rootSha256: ROOT,
    executionModulePath: "_flarex/application.js",
    schemaModulePath: "_flarex/schema.js",
    modules: Object.freeze(modules.map(module => Object.freeze({
      path: module.path,
      roles: module.roles,
      sourceSha256: module.sourceSha256,
      sourceByteLength: module.sourceByteLength,
    }))),
  });
  const manifestCanonical = Result.getOrThrow(
    canonicalizeApplicationManifestV1({
      format: "flarex.application-manifest",
      version: 1,
      sourceArtifact,
      schema: { version: 1, tables: [], indexes: [] },
      functions: [{
        path: "users:get",
        moduleName: "users",
        exportName: "get",
        kind: "query",
        visibility: "public",
        args: {
          type: "object",
          value: {
            id: {
              fieldType: { type: "id", tableName: "users" },
              optional: false,
            },
          },
        },
        returns: { type: "null" },
        partition: null,
      }],
    }),
  );
  const manifest = manifestCanonical.manifest;
  const manifestSha256 = await digest(manifestCanonical.canonicalBytes);
  const schemaSha256 = await digest(Result.getOrThrow(
    applicationSchemaPublicationFrameV1(manifest),
  ));
  const functionCatalogSha256 = await digest(Result.getOrThrow(
    applicationFunctionCatalogPublicationFrameV1(manifest),
  ));
  const entrySha256 = await digest(Result.getOrThrow(
    applicationFunctionEntryPublicationFrameV1(manifest.functions[0]!),
  ));
  const publicationSha256 = await digest(Result.getOrThrow(
    applicationPublicationCommitmentFrameV1({
      scopeId: "scope",
      revisionId: "revision",
      candidateId: "candidate",
      analysisId: "analysis",
      sourceArtifactRootSha256: ROOT,
      manifestSha256,
      schemaSha256,
      functionCatalogSha256,
    }),
  ));
  const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: "scope",
    revisionId: "revision",
    candidateId: "candidate",
    analysisId: "analysis",
    sourceArtifactRootSha256: ROOT,
    manifestSha256,
    schemaSha256,
    functionCatalogSha256,
    publicationSha256,
    executionModulePath: "_flarex/application.js",
    function: { ...manifest.functions[0]!, entrySha256 },
  })).target;
  return Object.freeze({
    manifest,
    target,
    source: Object.freeze({ sourceArtifact, modules }),
  });
}

function reader(
  source: ApplicationAnalysisSourceBundle,
): ApplicationAnalysisSourceReader {
  return Object.freeze({ read: () => Effect.succeed(source) });
}

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  );
  return encodeBytesToLowercaseHex(new Uint8Array(value));
}

class FakeWorkerLoader implements WorkerLoader {
  readonly loaded: WorkerLoaderWorkerCode[] = [];
  readonly requestedEntrypoints: string[] = [];
  resultDisposals = 0;

  constructor(
    private readonly outcome: Readonly<Record<string, unknown>> |
      PromiseLike<Readonly<Record<string, unknown>>>,
    readonly onResolve: () => void = () => undefined,
  ) {}

  get(): WorkerStub {
    throw new Error("Application Runtime forbids cached WorkerLoader.get().");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loaded.push(code);
    return new FakeWorkerStub(this, this.outcome);
  }
}

class FakeWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: FakeWorkerLoader,
    private readonly outcome: Readonly<Record<string, unknown>> |
      PromiseLike<Readonly<Record<string, unknown>>>,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    this.owner.requestedEntrypoints.push(name ?? "");
    const owner = this.owner;
    return {
      resolve: async () => {
        owner.onResolve();
        const outcome = { ...await this.outcome };
        return Object.defineProperty(outcome, Symbol.dispose, {
          configurable: true,
          value: () => {
            owner.resultDisposals += 1;
          },
        });
      },
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Application Runtime does not load Durable Objects.");
  }
}
