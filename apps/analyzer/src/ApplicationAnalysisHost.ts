import {
  ApplicationAnalysisRejectionCodeV1,
  canonicalizeApplicationManifestV1,
  type ApplicationAnalysisRejectionCodeV1 as ApplicationAnalysisRejectionCode,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Cause, Data, Effect, Exit, Result } from "effect";
import {
  makeApplicationAnalysisR2SourceReader,
  type ApplicationAnalysisSourceBundle,
  type ApplicationAnalysisSourceReader,
  type ApplicationAnalysisSourceReadError,
} from "flarex-backend/internal/application-analysis-source-reader";
import {
  APPLICATION_ANALYSIS_WORKER_CORE_SHA256,
  APPLICATION_ANALYSIS_WORKER_CORE_SOURCE,
  APPLICATION_ANALYSIS_SERVER_EXPORTS,
  APPLICATION_ANALYSIS_VALUES_EXPORTS,
} from "./ApplicationAnalysisWorkerCore.generated";

export const APPLICATION_ANALYSIS_HOST_FORMAT =
  "flarex.application-analysis-host-result" as const;
export const APPLICATION_ANALYSIS_HOST_VERSION = 1 as const;
export const APPLICATION_ANALYSIS_HOST_ENTRYPOINT =
  "FlarexApplicationAnalysisHost" as const;
export const APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT =
  "FlarexApplicationAnalysisColdLoad" as const;
export const APPLICATION_ANALYSIS_COMPATIBILITY_DATE = "2026-06-14" as const;
export const APPLICATION_ANALYSIS_WHOLE_ATTEMPT_MILLISECONDS = 30_000;
export const APPLICATION_ANALYSIS_COLD_LOAD_CPU_MILLISECONDS = 10_000;
export const APPLICATION_ANALYSIS_ANALYZER_IDENTITY =
  APPLICATION_ANALYSIS_WORKER_CORE_SHA256;
export const APPLICATION_ANALYSIS_POLICY_IDENTITY =
  "flarex.application-analysis-policy/compat=2026-06-14;loads=2;cpu=10000;deadline=30000;diag=100/65536;outbound=null;ambient=date-random-performance-fixed,fetch-crypto-timers-scheduler-reject" as const;

const SUPPORTED_FRAMEWORK_MODULES = Object.freeze({
  "flarex/server": APPLICATION_ANALYSIS_SERVER_EXPORTS,
  "flarex/values": APPLICATION_ANALYSIS_VALUES_EXPORTS,
} as const);
const APPLICATION_MODULE_PREFIX = "__flarex_application_modules" as const;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;

export interface ApplicationAnalysisHostRequest {
  readonly format: "flarex.application-analysis-host-request";
  readonly version: 1;
  readonly sourceArtifactRootSha256: string;
  readonly analyzerIdentity: string;
  readonly analyzerPolicyIdentity: string;
}

interface ApplicationAnalysisHostBaseResult {
  readonly format: typeof APPLICATION_ANALYSIS_HOST_FORMAT;
  readonly version: typeof APPLICATION_ANALYSIS_HOST_VERSION;
  readonly sourceArtifactRootSha256: string;
  readonly analyzerIdentity: typeof APPLICATION_ANALYSIS_ANALYZER_IDENTITY;
  readonly analyzerPolicyIdentity: typeof APPLICATION_ANALYSIS_POLICY_IDENTITY;
}

export type ApplicationAnalysisHostResult =
  | Readonly<ApplicationAnalysisHostBaseResult & {
    readonly kind: "analyzed";
    readonly manifest: ApplicationManifestV1;
    readonly canonicalManifest: string;
  }>
  | Readonly<ApplicationAnalysisHostBaseResult & {
    readonly kind: "rejected";
    readonly failureCode: ApplicationAnalysisRejectionCode;
    readonly detail: string;
  }>
  | Readonly<{
    readonly format: typeof APPLICATION_ANALYSIS_HOST_FORMAT;
    readonly version: typeof APPLICATION_ANALYSIS_HOST_VERSION;
    readonly kind: "failed";
    readonly reason:
      | "invalidRequest"
      | "identityMismatch"
      | "sourceReadFailed"
      | "workerLoadFailed"
      | "invalidWorkerResult"
      | "internalFailure";
  }>;

export interface ApplicationAnalysisHostEnv {
  readonly ARTIFACTS: R2Bucket;
  readonly LOADER?: WorkerLoader;
}

export interface ApplicationAnalysisHostCapabilities {
  readonly source: ApplicationAnalysisSourceReader;
  readonly loader: WorkerLoader | undefined;
}

export class ApplicationAnalysisHostError extends Data.TaggedError(
  "ApplicationAnalysisHostError",
)<{
  readonly reason:
    | "invalidRequest"
    | "identityMismatch"
    | "sourceReadFailed"
    | "workerLoadFailed"
    | "invalidWorkerResult"
    | "internalFailure"
    | "timeout";
  readonly cause?: unknown;
}> {}

interface ColdLoadEntrypoint extends Rpc.WorkerEntrypointBranded {
  readonly analyze: () => Promise<unknown>;
}

type ColdLoadOutcome =
  | Readonly<{ readonly kind: "analyzed"; readonly canonicalManifest: string }>
  | Readonly<{
    readonly kind: "rejected";
    readonly failureCode: ApplicationAnalysisRejectionCode;
    readonly detail: string;
  }>;

export async function runApplicationAnalysisHost(
  env: ApplicationAnalysisHostEnv,
  input: unknown,
): Promise<ApplicationAnalysisHostResult> {
  return runApplicationAnalysisHostWithCapabilities({
    source: makeApplicationAnalysisR2SourceReader(env.ARTIFACTS),
    loader: env.LOADER,
  }, input, APPLICATION_ANALYSIS_WHOLE_ATTEMPT_MILLISECONDS);
}

export async function runApplicationAnalysisHostWithCapabilities(
  capabilities: ApplicationAnalysisHostCapabilities,
  input: unknown,
  deadlineMilliseconds: number,
): Promise<ApplicationAnalysisHostResult> {
  const exit = await Effect.runPromiseExit(
    applicationAnalysisHostEffect(capabilities, input).pipe(
      Effect.timeout(`${deadlineMilliseconds} millis`),
      Effect.mapError(error => Cause.isTimeoutError(error)
        ? new ApplicationAnalysisHostError({ reason: "timeout" })
        : error),
    ),
  );
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.findError(exit.cause);
  if (Result.isFailure(failure)) return failed("internalFailure");
  if (failure.success.reason === "timeout") {
    const request = decodeRequest(input);
    return Result.isSuccess(request)
      ? rejectedResult(
        request.success,
        ApplicationAnalysisRejectionCodeV1.timeout,
        "Application Analysis exceeded its deadline.",
      )
      : failed("invalidRequest");
  }
  return failed(failure.success.reason);
}

const applicationAnalysisHostEffect = Effect.fn(
  "ApplicationAnalysisHost.analyze",
)(function* (
  capabilities: ApplicationAnalysisHostCapabilities,
  input: unknown,
): Effect.fn.Return<ApplicationAnalysisHostResult, ApplicationAnalysisHostError> {
  const request = yield* Effect.fromResult(decodeRequest(input));
  if (
    request.analyzerIdentity !== APPLICATION_ANALYSIS_ANALYZER_IDENTITY ||
    request.analyzerPolicyIdentity !== APPLICATION_ANALYSIS_POLICY_IDENTITY
  ) {
    return yield* new ApplicationAnalysisHostError({ reason: "identityMismatch" });
  }
  const loader = yield* capabilities.loader === undefined
    ? Effect.fail(new ApplicationAnalysisHostError({ reason: "workerLoadFailed" }))
    : Effect.succeed(capabilities.loader);
  const sourceOutcome = yield* capabilities.source.read(
      request.sourceArtifactRootSha256,
    ).pipe(Effect.matchEffect({
      onFailure: error => projectSourceReadFailure(request, error).pipe(
        Effect.map(result => Object.freeze({
          kind: "terminal" as const,
          result,
        })),
      ),
      onSuccess: source => Effect.succeed(Object.freeze({
        kind: "source" as const,
        source,
      })),
    }));
  if (sourceOutcome.kind === "terminal") {
    return sourceOutcome.result;
  }
  const source = sourceOutcome.source;
  if (findFrameworkShimCollision(source) !== undefined) {
    return rejectedResult(
      request,
      ApplicationAnalysisRejectionCodeV1.invalidSourceArtifact,
      "The authenticated source artifact collides with a trusted framework shim.",
    );
  }
  const definition = makeApplicationAnalysisWorkerDefinition(source);
  const first = yield* runColdLoad(loader, definition);
  const second = yield* runColdLoad(loader, definition);
  if (first.kind !== second.kind) {
    return rejectedResult(
      request,
      ApplicationAnalysisRejectionCodeV1.nondeterministicRegistration,
      "Cold application registrations produced different outcomes.",
    );
  }
  if (first.kind === "rejected" && second.kind === "rejected") {
    return first.failureCode === second.failureCode
      ? rejectedResult(request, first.failureCode, first.detail)
      : rejectedResult(
        request,
        ApplicationAnalysisRejectionCodeV1.nondeterministicRegistration,
        "Cold application registrations produced different failure classifications.",
      );
  }
  if (first.kind !== "analyzed" || second.kind !== "analyzed") {
    return yield* Effect.die(
      new Error("Application Analysis cold-load comparison lost its discriminant."),
    );
  }
  if (first.canonicalManifest !== second.canonicalManifest) {
    return rejectedResult(
      request,
      ApplicationAnalysisRejectionCodeV1.nondeterministicRegistration,
      "Cold application registrations produced different manifests.",
    );
  }
  const canonical = yield* Effect.fromResult(
    parseCanonicalManifest(first.canonicalManifest),
  );
  return Object.freeze({
    ...baseResult(request),
    kind: "analyzed",
    manifest: canonical.manifest,
    canonicalManifest: canonical.canonicalText,
  });
});

export const applicationAnalysisHostEffectWithCapabilities =
  applicationAnalysisHostEffect;

function projectSourceReadFailure(
  request: ApplicationAnalysisHostRequest,
  error: ApplicationAnalysisSourceReadError,
): Effect.Effect<ApplicationAnalysisHostResult, ApplicationAnalysisHostError> {
  switch (error.reason) {
    case "invalidRoot":
    case "invalidSourceArtifact":
    case "unsupportedAuth":
    case "invalidSourceText":
      return Effect.succeed(rejectedResult(
        request,
        ApplicationAnalysisRejectionCodeV1.invalidSourceArtifact,
        "The authenticated source artifact is invalid.",
      ));
    case "limitExceeded":
      return Effect.succeed(rejectedResult(
        request,
        ApplicationAnalysisRejectionCodeV1.limitExceeded,
        "Application Analysis admitted limits were exceeded.",
      ));
    case "sourceReadFailed":
      return Effect.fail(new ApplicationAnalysisHostError({
        reason: "sourceReadFailed",
        cause: error,
      }));
    case "internalFailure":
      return Effect.fail(new ApplicationAnalysisHostError({
        reason: "internalFailure",
        cause: error,
      }));
  }
}

function runColdLoad(
  loader: WorkerLoader,
  definition: WorkerLoaderWorkerCode,
): Effect.Effect<ColdLoadOutcome, ApplicationAnalysisHostError> {
  return Effect.acquireUseRelease(
    Effect.try({
      try: () => loader.load(definition).getEntrypoint<ColdLoadEntrypoint>(
        APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT,
      ),
      catch: cause => new ApplicationAnalysisHostError({
        reason: "workerLoadFailed",
        cause,
      }),
    }),
    stub => Effect.tryPromise({
      try: signal => awaitDetachedRpcOutcome(stub, signal),
      catch: cause => cause instanceof ApplicationAnalysisHostError
        ? cause
        : new ApplicationAnalysisHostError({
          reason: "internalFailure",
          cause,
        }),
    }),
    stub => disposeRpcValue(stub),
  );
}

export function makeApplicationAnalysisWorkerDefinition(
  source: ApplicationAnalysisSourceBundle,
): WorkerLoaderWorkerCode {
  const trustedModules = dynamicTrustedModuleNames(source);
  const modules: Record<string, WorkerLoaderModule | string> = {
    [trustedModules.entrypoint]: {
      js: dynamicEntrypointSource(
        source.sourceArtifact,
        `./${trustedModules.core}`,
      ),
    },
    [trustedModules.core]: { js: APPLICATION_ANALYSIS_WORKER_CORE_SOURCE },
  };
  for (const module of source.modules) {
    modules[applicationModuleName(module.path)] = { js: module.source };
  }
  for (const applicationModule of source.modules) {
    for (const [frameworkModule, exportNames] of Object.entries(
      SUPPORTED_FRAMEWORK_MODULES,
    )) {
      const shimName = frameworkShimName(applicationModule.path, frameworkModule);
      if (Object.hasOwn(modules, shimName)) continue;
      const coreImport = JSON.stringify(
        relativeFrameworkImport(shimName, trustedModules.core),
      );
      modules[shimName] = {
        js: [
          `import * as applicationAnalysisCore from ${coreImport};`,
          ...exportNames.map(name =>
            `export const ${name} = applicationAnalysisCore.${name};`
          ),
          "",
        ].join("\n"),
      };
    }
  }
  return Object.freeze({
    compatibilityDate: APPLICATION_ANALYSIS_COMPATIBILITY_DATE,
    limits: Object.freeze({
      cpuMs: APPLICATION_ANALYSIS_COLD_LOAD_CPU_MILLISECONDS,
      subRequests: 0,
    }),
    mainModule: trustedModules.entrypoint,
    modules: Object.freeze(modules),
    env: Object.freeze({}),
    globalOutbound: null,
  });
}

function dynamicTrustedModuleNames(source: ApplicationAnalysisSourceBundle): {
  readonly entrypoint: string;
  readonly core: string;
} {
  const stem = `__flarex_application_analysis_${source.sourceArtifact.rootSha256}`;
  return Object.freeze({
    entrypoint: `${stem}_entrypoint.js`,
    core: `${stem}_core.js`,
  });
}

function relativeFrameworkImport(
  frameworkModule: string,
  coreModule: string,
): string {
  const directoryDepth = frameworkModule.split("/").length - 1;
  return `${directoryDepth === 0 ? "./" : "../".repeat(directoryDepth)}${coreModule}`;
}

function dynamicEntrypointSource(
  sourceArtifact: ApplicationAnalysisSourceBundle["sourceArtifact"],
  coreImport: string,
): string {
  const executionImport = relativeImport(
    applicationModuleName(sourceArtifact.executionModulePath),
  );
  const schemaImport = sourceArtifact.schemaModulePath === null
    ? null
    : relativeImport(applicationModuleName(sourceArtifact.schemaModulePath));
  return [
    'import { WorkerEntrypoint } from "cloudflare:workers";',
    `import { runApplicationAnalysisColdLoad } from ${JSON.stringify(coreImport)};`,
    `const sourceArtifact = ${JSON.stringify(sourceArtifact)};`,
    `export class ${APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT} extends WorkerEntrypoint {`,
    "  analyze() {",
    "    return runApplicationAnalysisColdLoad({",
    "      sourceArtifact,",
    `      loadExecution: () => import(${JSON.stringify(executionImport)}),`,
    schemaImport === null
      ? "      loadSchema: null,"
      : `      loadSchema: () => import(${JSON.stringify(schemaImport)}),`,
    "    });",
    "  }",
    "}",
    "",
  ].join("\n");
}

function relativeImport(path: string): string {
  return path.startsWith("./") ? path : `./${path}`;
}

function applicationModuleName(path: string): string {
  return `${APPLICATION_MODULE_PREFIX}/${path}`;
}

function frameworkShimName(
  importingApplicationPath: string,
  frameworkModule: string,
): string {
  const importingModule = applicationModuleName(importingApplicationPath);
  const lastSlash = importingModule.lastIndexOf("/");
  return `${importingModule.slice(0, lastSlash + 1)}${frameworkModule}`;
}

function findFrameworkShimCollision(
  source: ApplicationAnalysisSourceBundle,
): string | undefined {
  const applicationPaths = new Map(
    source.modules.map(module => [applicationModuleName(module.path), module.path]),
  );
  for (const importingModule of source.modules) {
    for (const frameworkModule of Object.keys(SUPPORTED_FRAMEWORK_MODULES)) {
      const collision = applicationPaths.get(
        frameworkShimName(importingModule.path, frameworkModule),
      );
      if (collision !== undefined) return collision;
    }
  }
  return undefined;
}

function decodeRequest(
  value: unknown,
): Result.Result<ApplicationAnalysisHostRequest, ApplicationAnalysisHostError> {
  if (
    !isNonArrayRecord(value) ||
    Object.keys(value).length !== 5 ||
    value.format !== "flarex.application-analysis-host-request" ||
    value.version !== 1 ||
    typeof value.sourceArtifactRootSha256 !== "string" ||
    !LOWERCASE_SHA256.test(value.sourceArtifactRootSha256) ||
    typeof value.analyzerIdentity !== "string" ||
    typeof value.analyzerPolicyIdentity !== "string"
  ) {
    return Result.fail(new ApplicationAnalysisHostError({ reason: "invalidRequest" }));
  }
  return Result.succeed(Object.freeze({
    format: value.format,
    version: value.version,
    sourceArtifactRootSha256: value.sourceArtifactRootSha256,
    analyzerIdentity: value.analyzerIdentity,
    analyzerPolicyIdentity: value.analyzerPolicyIdentity,
  }));
}

function decodeColdLoadOutcome(
  value: unknown,
): Result.Result<ColdLoadOutcome, ApplicationAnalysisHostError> {
  if (!isNonArrayRecord(value) || typeof value.kind !== "string") {
    return invalidWorkerResult();
  }
  if (value.kind === "analyzed" && typeof value.canonicalManifest === "string") {
    return Result.succeed(Object.freeze({
      kind: "analyzed",
      canonicalManifest: value.canonicalManifest,
    }));
  }
  if (
    value.kind === "rejected" &&
    isRejectionCode(value.failureCode) &&
    typeof value.detail === "string"
  ) {
    return Result.succeed(Object.freeze({
      kind: "rejected",
      failureCode: value.failureCode,
      detail: value.detail.slice(0, 8_192),
    }));
  }
  return invalidWorkerResult();
}

function parseCanonicalManifest(
  value: string,
): Result.Result<
  ReturnType<typeof canonicalizeApplicationManifestV1> extends
    Result.Result<infer Success, unknown> ? Success : never,
  ApplicationAnalysisHostError
> {
  try {
    return canonicalizeApplicationManifestV1(JSON.parse(value)).pipe(
      Result.mapError(cause => new ApplicationAnalysisHostError({
        reason: "invalidWorkerResult",
        cause,
      })),
      Result.flatMap(canonical => canonical.canonicalText === value
        ? Result.succeed(canonical)
        : invalidWorkerResult()),
    );
  } catch (cause) {
    return Result.fail(new ApplicationAnalysisHostError({
      reason: "invalidWorkerResult",
      cause,
    }));
  }
}

function baseResult(
  request: ApplicationAnalysisHostRequest,
): ApplicationAnalysisHostBaseResult {
  return Object.freeze({
    format: APPLICATION_ANALYSIS_HOST_FORMAT,
    version: APPLICATION_ANALYSIS_HOST_VERSION,
    sourceArtifactRootSha256: request.sourceArtifactRootSha256,
    analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
    analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
  });
}

function rejectedResult(
  request: ApplicationAnalysisHostRequest,
  failureCode: ApplicationAnalysisRejectionCode,
  detail: string,
): ApplicationAnalysisHostResult {
  return Object.freeze({
    ...baseResult(request),
    kind: "rejected",
    failureCode,
    detail,
  });
}

function failed(
  reason: Exclude<ApplicationAnalysisHostError["reason"], "timeout">,
): ApplicationAnalysisHostResult {
  return Object.freeze({
    format: APPLICATION_ANALYSIS_HOST_FORMAT,
    version: APPLICATION_ANALYSIS_HOST_VERSION,
    kind: "failed",
    reason,
  });
}

function invalidWorkerResult(): Result.Result<never, ApplicationAnalysisHostError> {
  return Result.fail(new ApplicationAnalysisHostError({
    reason: "invalidWorkerResult",
  }));
}

function isRejectionCode(value: unknown): value is ApplicationAnalysisRejectionCode {
  return typeof value === "string" &&
    Object.values(ApplicationAnalysisRejectionCodeV1).some(code => code === value);
}

function disposeRpcValue(value: unknown): Effect.Effect<void> {
  return Effect.sync(() => disposeRpcValueNow(value));
}

function awaitDetachedRpcOutcome(
  stub: ColdLoadEntrypoint,
  signal: AbortSignal,
): Promise<ColdLoadOutcome> {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    const onAbort = (): void => {
      cancelled = true;
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(stub.analyze());
    } catch (cause) {
      signal.removeEventListener("abort", onAbort);
      reject(cause);
      return;
    }
    pending.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        try {
          if (cancelled || signal.aborted) {
            disposeRpcValueNow(value);
            return;
          }
          let detached: unknown;
          try {
            detached = detachRpcResult(value);
          } finally {
            disposeRpcValueNow(value);
          }
          const decoded = decodeColdLoadOutcome(detached);
          if (Result.isFailure(decoded)) {
            reject(decoded.failure);
          } else {
            resolve(decoded.success);
          }
        } catch (cause) {
          reject(cause);
        }
      },
      cause => {
        signal.removeEventListener("abort", onAbort);
        if (!cancelled) reject(cause);
      },
    );
  });
}

function disposeRpcValueNow(value: unknown): void {
  if (value === null ||
    (typeof value !== "object" && typeof value !== "function")) return;
  const dispose = Reflect.get(value, Symbol.dispose);
  if (typeof dispose === "function") Reflect.apply(dispose, value, []);
}

function detachRpcResult(value: unknown): unknown {
  if (value === null ||
    (typeof value !== "object" && typeof value !== "function")) return value;
  const detached: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (key === Symbol.dispose) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error("Application Analysis RPC result must contain data properties only.");
    }
    Object.defineProperty(detached, key, descriptor);
  }
  return detached;
}
