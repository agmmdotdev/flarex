import {
  APPLICATION_MANIFEST_FORMAT_V1,
  ApplicationAnalysisRejectionCodeV1,
  canonicalizeApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { Effect, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { describe, expect, it, vi } from "vitest";
import type {
  ApplicationAnalysisSourceBundle,
  ApplicationAnalysisSourceReader,
} from "flarex-backend/internal/application-analysis-source-reader";
import {
  APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
  APPLICATION_ANALYSIS_COLD_LOAD_CPU_MILLISECONDS,
  APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT,
  APPLICATION_ANALYSIS_COMPATIBILITY_DATE,
  APPLICATION_ANALYSIS_POLICY_IDENTITY,
  applicationAnalysisHostEffectWithCapabilities,
  makeApplicationAnalysisWorkerDefinition,
  runApplicationAnalysisHostWithCapabilities,
  type ApplicationAnalysisHostRequest,
} from "../src/ApplicationAnalysisHost";

const ROOT = "a".repeat(64);
const SOURCE_DIGEST = "b".repeat(64);
const SOURCE = "export default {};";

describe("Application Analysis trusted cold-load host", () => {
  it("checks both identities before source reads or Worker Loader calls", async () => {
    const source = sourceReader();
    const read = vi.fn(source.read);
    const observedSource: ApplicationAnalysisSourceReader = { read };
    const loader = new FakeWorkerLoader([]);
    const result = await Effect.runPromise(Effect.result(
      applicationAnalysisHostEffectWithCapabilities(
        { source: observedSource, loader },
        { ...request(), analyzerPolicyIdentity: "wrong" },
      ),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("identityMismatch");
    }
    expect(read).not.toHaveBeenCalled();
    expect(loader.loaded).toEqual([]);
  });

  it("performs two uncached exact-byte loads and returns one validated manifest", async () => {
    const canonical = manifestText();
    const loader = new FakeWorkerLoader([
      analyzed(canonical),
      analyzed(canonical),
    ]);

    const result = await Effect.runPromise(
      applicationAnalysisHostEffectWithCapabilities(
        { source: sourceReader(), loader },
        request(),
      ),
    );

    expect(result.kind).toBe("analyzed");
    if (result.kind !== "analyzed") throw new Error("expected analyzed result");
    expect(result.canonicalManifest).toBe(canonical);
    expect(result.manifest.functions).toEqual([]);
    expect(loader.loaded).toHaveLength(2);
    expect(loader.requestedEntrypoints).toEqual([
      APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT,
      APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT,
    ]);
    expect(loader.stubDisposals).toBe(2);
    expect(loader.resultDisposals).toBe(2);
    for (const code of loader.loaded) {
      expect(code.compatibilityDate).toBe(APPLICATION_ANALYSIS_COMPATIBILITY_DATE);
      expect(code.globalOutbound).toBeNull();
      expect(code.env).toEqual({});
      expect(code.limits).toEqual({
        cpuMs: APPLICATION_ANALYSIS_COLD_LOAD_CPU_MILLISECONDS,
        subRequests: 0,
      });
      expect(code.modules["__flarex_application_modules/functions.js"]).toEqual({
        js: SOURCE,
      });
      expect(code.modules["__flarex_application_modules/flarex/server"])
        .toMatchObject({
          js: expect.stringMatching(/^import \* as applicationAnalysisCore from "(?:\.\.\/)+__flarex_application_analysis_/),
        });
      expect(code.modules["flarex/server"]).toBeUndefined();
    }
  });

  it("rejects a genuine application/framework graph-path collision", async () => {
    const base = sourceBundle();
    const collision = Object.freeze({
      path: "flarex/server",
      roles: 0,
      sourceSha256: "c".repeat(64),
      sourceByteLength: SOURCE.length,
      source: SOURCE,
    });
    const source = Object.freeze({
      sourceArtifact: Object.freeze({
        ...base.sourceArtifact,
        modules: Object.freeze([
          ...base.sourceArtifact.modules,
          Object.freeze({
            path: collision.path,
            roles: collision.roles,
            sourceSha256: collision.sourceSha256,
            sourceByteLength: collision.sourceByteLength,
          }),
        ]),
      }),
      modules: Object.freeze([...base.modules, collision]),
    });
    const loader = new FakeWorkerLoader([]);
    const result = await Effect.runPromise(
      applicationAnalysisHostEffectWithCapabilities(
        { source: { read: () => Effect.succeed(source) }, loader },
        request(),
      ),
    );

    expect(result).toMatchObject({
      kind: "rejected",
      failureCode: ApplicationAnalysisRejectionCodeV1.invalidSourceArtifact,
    });
    expect(loader.loaded).toEqual([]);
  });

  it("keeps an application module named like a framework path isolated", () => {
    const source = sourceBundle("flarex/server");
    const definition = makeApplicationAnalysisWorkerDefinition(source);

    expect(definition.modules["__flarex_application_modules/flarex/server"])
      .toEqual({ js: SOURCE });
    expect(definition.modules[
      "__flarex_application_modules/flarex/flarex/server"
    ]).toMatchObject({
      js: expect.stringMatching(/^import \* as applicationAnalysisCore from /),
    });
    expect(definition.modules[definition.mainModule]).toMatchObject({
      js: expect.stringContaining(
        'import("./__flarex_application_modules/flarex/server")',
      ),
    });
  });

  it("rejects success/failure and manifest mismatches as nondeterministic", async () => {
    const canonical = manifestText();
    const successMismatch = new FakeWorkerLoader([
      analyzed(canonical),
      rejected(ApplicationAnalysisRejectionCodeV1.invalidSchema),
    ]);
    const first = await Effect.runPromise(
      applicationAnalysisHostEffectWithCapabilities(
        { source: sourceReader(), loader: successMismatch },
        request(),
      ),
    );
    expect(first).toMatchObject({
      kind: "rejected",
      failureCode:
        ApplicationAnalysisRejectionCodeV1.nondeterministicRegistration,
    });

    const changed = canonical.replace('"functions":[]',
      '"functions":[{"args":{"type":"any"},"exportName":"x","kind":"query","moduleName":"functions","partition":null,"path":"functions:x","returns":null,"visibility":"public"}]');
    const manifestMismatch = new FakeWorkerLoader([
      analyzed(canonical),
      analyzed(changed),
    ]);
    const second = await Effect.runPromise(
      applicationAnalysisHostEffectWithCapabilities(
        { source: sourceReader(), loader: manifestMismatch },
        request(),
      ),
    );
    expect(second).toMatchObject({
      kind: "rejected",
      failureCode:
        ApplicationAnalysisRejectionCodeV1.nondeterministicRegistration,
    });
  });

  it("accepts equal stable rejection classes and keeps detail bounded", async () => {
    const loader = new FakeWorkerLoader([
      rejected(ApplicationAnalysisRejectionCodeV1.invalidSchema, "x".repeat(9_000)),
      rejected(ApplicationAnalysisRejectionCodeV1.invalidSchema, "different"),
    ]);
    const result = await Effect.runPromise(
      applicationAnalysisHostEffectWithCapabilities(
        { source: sourceReader(), loader },
        request(),
      ),
    );
    expect(result).toMatchObject({
      kind: "rejected",
      failureCode: ApplicationAnalysisRejectionCodeV1.invalidSchema,
    });
    if (result.kind !== "rejected") throw new Error("expected rejection");
    expect(result.detail).toHaveLength(8_192);
  });

  it("maps the whole-attempt deadline to a terminal rejection and disposes the live RPC capability", async () => {
    const loader = new FakeWorkerLoader([new Promise(() => undefined)]);
    const result = await runApplicationAnalysisHostWithCapabilities(
        { source: sourceReader(), loader },
        request(),
        5,
    );
    expect(result).toMatchObject({
      kind: "rejected",
      failureCode: ApplicationAnalysisRejectionCodeV1.timeout,
    });
    expect(loader.stubDisposals).toBe(1);
  });

  it("disposes an RPC result that arrives after deadline interruption", async () => {
    const late = deferred<unknown>();
    const loader = new FakeWorkerLoader([late.promise]);
    const result = await runApplicationAnalysisHostWithCapabilities(
      { source: sourceReader(), loader },
      request(),
      5,
    );
    expect(result).toMatchObject({
      kind: "rejected",
      failureCode: ApplicationAnalysisRejectionCodeV1.timeout,
    });
    expect(loader.stubDisposals).toBe(1);

    late.resolve(analyzed(manifestText()));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loader.resultDisposals).toBe(1);
  });
});

function request(): ApplicationAnalysisHostRequest {
  return Object.freeze({
    format: "flarex.application-analysis-host-request",
    version: 1,
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
    analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
  });
}

function sourceReader(): ApplicationAnalysisSourceReader {
  return Object.freeze({
    read: () => Effect.succeed(sourceBundle()),
  });
}

function sourceBundle(path = "functions.js"): ApplicationAnalysisSourceBundle {
  const module = Object.freeze({
    path,
    roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
    sourceSha256: SOURCE_DIGEST,
    sourceByteLength: new TextEncoder().encode(SOURCE).byteLength,
    source: SOURCE,
  });
  return Object.freeze({
    sourceArtifact: Object.freeze({
      rootSha256: ROOT,
      executionModulePath: module.path,
      schemaModulePath: null,
      modules: Object.freeze([Object.freeze({
        path: module.path,
        roles: module.roles,
        sourceSha256: module.sourceSha256,
        sourceByteLength: module.sourceByteLength,
      })]),
    }),
    modules: Object.freeze([module]),
  });
}

function deferred<A>(): Readonly<{
  readonly promise: Promise<A>;
  readonly resolve: (value: A) => void;
}> {
  let resolvePromise: ((value: A) => void) | undefined;
  const promise = new Promise<A>(resolve => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve: value => {
      if (resolvePromise === undefined) throw new Error("Deferred was not initialized.");
      resolvePromise(value);
    },
  });
}

function manifestText(): string {
  const source = sourceBundle().sourceArtifact;
  return Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: APPLICATION_MANIFEST_FORMAT_V1,
    version: 1,
    sourceArtifact: source,
    schema: { version: 1, tables: [], indexes: [] },
    functions: [],
  })).canonicalText;
}

function analyzed(canonicalManifest: string): object {
  return {
    kind: "analyzed",
    canonicalManifest,
    diagnostics: [],
  };
}

function rejected(
  failureCode: string,
  detail = "rejected",
): object {
  return { kind: "rejected", failureCode, detail, diagnostics: [] };
}

type FakeOutcome = object | Promise<unknown>;

class FakeWorkerLoader implements WorkerLoader {
  readonly loaded: WorkerLoaderWorkerCode[] = [];
  readonly requestedEntrypoints: string[] = [];
  stubDisposals = 0;
  resultDisposals = 0;
  private next = 0;

  constructor(private readonly outcomes: readonly FakeOutcome[]) {}

  get(): WorkerStub {
    throw new Error("Application Analysis forbids cached WorkerLoader.get().");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loaded.push(code);
    const outcome = this.outcomes[this.next];
    this.next += 1;
    if (outcome === undefined) throw new Error("Missing fake cold-load outcome.");
    return new FakeWorkerStub(
      this,
      outcome,
    );
  }
}

class FakeWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: FakeWorkerLoader,
    private readonly outcome: FakeOutcome,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    this.owner.requestedEntrypoints.push(name ?? "");
    const result = this.outcome;
    const owner = this.owner;
    return {
      analyze: async () => {
        const value = await result;
        if (typeof value !== "object" || value === null) return value;
        return Object.defineProperty(value, Symbol.dispose, {
          configurable: true,
          value: () => {
            owner.resultDisposals += 1;
          },
        });
      },
      [Symbol.dispose]: () => {
        this.owner.stubDisposals += 1;
      },
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Application Analysis does not load Durable Objects.");
  }
}
