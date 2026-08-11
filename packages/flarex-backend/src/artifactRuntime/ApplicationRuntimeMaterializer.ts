import {
  APPLICATION_IMPORT_POLICY_IDENTITY_V1,
} from "@flarex/analysis/internal/application-import-policy-v1";
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
  bytesEqualFullScan,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";
import {
  canonicalizeApplicationRuntimeColdReceiptV1,
  type CanonicalApplicationRuntimeColdReceiptV1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
  type ApplicationRuntimeFunctionV1,
  type ApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";

import type {
  ApplicationAnalysisSourceBundle,
  ApplicationAnalysisSourceReader,
} from "../sourceArtifactV2/ApplicationAnalysisReader";
import {
  APPLICATION_RUNTIME_SERVER_EXPORTS,
  APPLICATION_RUNTIME_VALUES_EXPORTS,
  APPLICATION_RUNTIME_WORKER_CORE_SHA256,
  APPLICATION_RUNTIME_WORKER_CORE_SOURCE,
} from "./ApplicationRuntimeWorkerCore.generated";
import {
  makeLiveDeclarativeV2RuntimeArtifactSha256V1,
} from "./DeclarativeV2RuntimeArtifactSha256";
import { makeApplicationRuntimeModuleGraph } from
  "./ApplicationRuntimeModuleGraph";
import { applicationRuntimeSourceMatchesManifest } from
  "./ApplicationRuntimeSourceAuthority";

export const APPLICATION_RUNTIME_COLD_ENTRYPOINT =
  "FlarexApplicationRuntimeColdLoad" as const;
export const APPLICATION_RUNTIME_COMPATIBILITY_DATE = "2026-06-14" as const;
export const APPLICATION_RUNTIME_COLD_CPU_MILLISECONDS = 10_000;
export const APPLICATION_RUNTIME_HOST_IDENTITY =
  `flarex.application-runtime-host/v1;core=${APPLICATION_RUNTIME_WORKER_CORE_SHA256};import=${APPLICATION_IMPORT_POLICY_IDENTITY_V1};cpu=10000;subrequests=0;outbound=null;mode=registration-resolution-only` as const;

export interface ApplicationRuntimeMaterializationInput {
  readonly target: unknown;
  readonly manifest: unknown;
  readonly compatibilityDate?: string;
}

export interface ApplicationRuntimeMaterializer {
  readonly materialize: (
    input: ApplicationRuntimeMaterializationInput,
  ) => Effect.Effect<
    CanonicalApplicationRuntimeColdReceiptV1,
    ApplicationRuntimeMaterializationError
  >;
}

export interface ApplicationRuntimeMaterializerCapabilities {
  readonly source: ApplicationAnalysisSourceReader;
  readonly loader: WorkerLoader;
}

export interface ApplicationRuntimeColdWorkerDefinition
  extends WorkerLoaderWorkerCode {
  readonly compatibilityDate: string;
  readonly mainModule: string;
  readonly modules: Readonly<Record<string, WorkerLoaderModule | string>>;
  readonly env: Readonly<Record<PropertyKey, never>>;
  readonly globalOutbound: null;
  readonly entrypoint: typeof APPLICATION_RUNTIME_COLD_ENTRYPOINT;
}

export class ApplicationRuntimeMaterializationError extends Data.TaggedError(
  "ApplicationRuntimeMaterializationError",
)<{
  readonly operation: "materialize";
  readonly reason:
    | "invalidTarget"
    | "invalidManifest"
    | "authorityMismatch"
    | "sourceMismatch"
    | "sourceReadFailed"
    | "workerDefinitionFailed"
    | "workerLoadFailed"
    | "functionResolutionFailed"
    | "resourceFailure";
  readonly cause?: unknown;
}> {}

export class ApplicationRuntimeMaterializationInvariantDefect
  extends Data.TaggedError("ApplicationRuntimeMaterializationInvariantDefect")<{
    readonly reason: "invalidReceipt";
    readonly cause: unknown;
  }> {}

interface ApplicationRuntimeColdEntrypoint extends Rpc.WorkerEntrypointBranded {
  readonly resolve: () => Promise<unknown>;
}

export function makeApplicationRuntimeMaterializer(
  capabilities: ApplicationRuntimeMaterializerCapabilities,
): ApplicationRuntimeMaterializer {
  const materialize = Effect.fn("ApplicationRuntime.materialize")(
    function* (
      input: ApplicationRuntimeMaterializationInput,
    ): Effect.fn.Return<
      CanonicalApplicationRuntimeColdReceiptV1,
      ApplicationRuntimeMaterializationError
    > {
      const target = yield* Effect.fromResult(
        canonicalizeApplicationRuntimeTargetV1(input.target).pipe(
          Result.mapError(cause => failure("invalidTarget", cause)),
        ),
      );
      const manifest = yield* Effect.fromResult(
        canonicalizeApplicationManifestV1(input.manifest).pipe(
          Result.mapError(cause => failure("invalidManifest", cause)),
        ),
      );
      const compatibilityDate = input.compatibilityDate ??
        APPLICATION_RUNTIME_COMPATIBILITY_DATE;
      yield* verifyApplicationRuntimeAuthority(
        target.target,
        manifest.manifest,
        manifest.canonicalBytes,
      );
      const source = yield* capabilities.source.read(
        target.target.sourceArtifactRootSha256,
      ).pipe(Effect.mapError(cause => failure("sourceReadFailed", cause)));
      if (!applicationRuntimeSourceMatchesManifest(source, manifest.manifest)) {
        return yield* failure("sourceMismatch");
      }
      const definition = yield* Effect.try({
        try: () => makeApplicationRuntimeColdWorkerDefinition({
          source,
          function: target.target.function,
          compatibilityDate,
        }),
        catch: cause => failure("workerDefinitionFailed", cause),
      });
      const resolution = yield* runColdResolution(capabilities.loader, definition);
      if (
        resolution.path !== target.target.function.path ||
        resolution.functionKind !== target.target.function.kind ||
        resolution.visibility !== target.target.function.visibility
      ) return yield* failure("functionResolutionFailed");
      const targetDigest = yield* sha256(target.canonicalBytes);
      return yield* Effect.fromResult(
        canonicalizeApplicationRuntimeColdReceiptV1({
          format: "flarex.application-runtime-cold-receipt",
          version: 1,
          status: "resolved",
          runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
          compatibilityDate,
          sourceArtifactRootSha256:
            target.target.sourceArtifactRootSha256,
          manifestSha256: target.target.manifestSha256,
          publicationSha256: target.target.publicationSha256,
          runtimeTargetSha256: encodeBytesToLowercaseHex(targetDigest),
          functionPath: target.target.function.path,
          functionKind: target.target.function.kind,
          visibility: target.target.function.visibility,
        }),
      ).pipe(Effect.catch(cause => Effect.die(
        new ApplicationRuntimeMaterializationInvariantDefect({
          reason: "invalidReceipt",
          cause,
        }),
      )));
    },
  );
  return Object.freeze({ materialize });
}

export function makeApplicationRuntimeColdWorkerDefinition(input: {
  readonly source: ApplicationAnalysisSourceBundle;
  readonly function: ApplicationRuntimeFunctionV1;
  readonly compatibilityDate: string;
}): ApplicationRuntimeColdWorkerDefinition {
  if (!isCompatibilityDate(input.compatibilityDate)) {
    throw new Error("Application runtime compatibility date is invalid.");
  }
  const graph = makeApplicationRuntimeModuleGraph({
    source: input.source,
    coreSource: APPLICATION_RUNTIME_WORKER_CORE_SOURCE,
    serverExports: APPLICATION_RUNTIME_SERVER_EXPORTS,
    valuesExports: APPLICATION_RUNTIME_VALUES_EXPORTS,
    entrypointSource: imports => coldEntrypointSource(
      input.function,
      imports.core,
      imports.execution,
    ),
  });
  return Object.freeze({
    compatibilityDate: input.compatibilityDate,
    limits: Object.freeze({
      cpuMs: APPLICATION_RUNTIME_COLD_CPU_MILLISECONDS,
      subRequests: 0,
    }),
    mainModule: graph.mainModule,
    modules: graph.modules,
    env: Object.freeze({}),
    globalOutbound: null,
    entrypoint: APPLICATION_RUNTIME_COLD_ENTRYPOINT,
  });
}

function verifyApplicationRuntimeAuthority(
  target: ApplicationRuntimeTargetV1,
  manifest: ApplicationManifestV1,
  manifestBytes: Uint8Array,
): Effect.Effect<void, ApplicationRuntimeMaterializationError> {
  return Effect.gen(function* () {
    if (
      target.sourceArtifactRootSha256 !==
        manifest.sourceArtifact.rootSha256 ||
      target.executionModulePath !==
        manifest.sourceArtifact.executionModulePath
    ) return yield* failure("authorityMismatch");
    const manifestDigest = yield* sha256(manifestBytes);
    if (encodeBytesToLowercaseHex(manifestDigest) !== target.manifestSha256) {
      return yield* failure("authorityMismatch");
    }
    const schemaFrame = yield* publicationFrame(
      applicationSchemaPublicationFrameV1(manifest),
    );
    const catalogFrame = yield* publicationFrame(
      applicationFunctionCatalogPublicationFrameV1(manifest),
    );
    const schemaDigest = yield* sha256(schemaFrame);
    const catalogDigest = yield* sha256(catalogFrame);
    if (
      encodeBytesToLowercaseHex(schemaDigest) !== target.schemaSha256 ||
      encodeBytesToLowercaseHex(catalogDigest) !==
        target.functionCatalogSha256
    ) return yield* failure("authorityMismatch");
    const manifestFunction = manifest.functions.find(
      fn => fn.path === target.function.path,
    );
    if (manifestFunction === undefined) {
      return yield* failure("authorityMismatch");
    }
    const manifestEntry = yield* publicationFrame(
      applicationFunctionEntryPublicationFrameV1(manifestFunction),
    );
    const targetEntry = yield* publicationFrame(
      applicationFunctionEntryPublicationFrameV1({
        path: target.function.path,
        moduleName: target.function.moduleName,
        exportName: target.function.exportName,
        kind: target.function.kind,
        visibility: target.function.visibility,
        args: target.function.args,
        returns: target.function.returns,
        partition: target.function.partition,
      }),
    );
    const entryDigest = yield* sha256(manifestEntry);
    if (
      !bytesEqualFullScan(manifestEntry, targetEntry) ||
      encodeBytesToLowercaseHex(entryDigest) !== target.function.entrySha256
    ) return yield* failure("authorityMismatch");
    const publicationFrameBytes = yield* publicationFrame(
      applicationPublicationCommitmentFrameV1({
        scopeId: target.scopeId,
        revisionId: target.revisionId,
        candidateId: target.candidateId,
        analysisId: target.analysisId,
        sourceArtifactRootSha256: target.sourceArtifactRootSha256,
        manifestSha256: target.manifestSha256,
        schemaSha256: target.schemaSha256,
        functionCatalogSha256: target.functionCatalogSha256,
      }),
    );
    const publicationDigest = yield* sha256(publicationFrameBytes);
    if (
      encodeBytesToLowercaseHex(publicationDigest) !==
        target.publicationSha256
    ) return yield* failure("authorityMismatch");
  });
}

function publicationFrame(
  frame: Result.Result<Uint8Array, unknown>,
): Effect.Effect<Uint8Array, ApplicationRuntimeMaterializationError> {
  return Effect.fromResult(frame.pipe(
    Result.mapError(cause => failure("authorityMismatch", cause)),
  ));
}

function runColdResolution(
  loader: WorkerLoader,
  definition: ApplicationRuntimeColdWorkerDefinition,
): Effect.Effect<
  Readonly<{
    readonly path: string;
    readonly functionKind: ApplicationRuntimeFunctionV1["kind"];
    readonly visibility: ApplicationRuntimeFunctionV1["visibility"];
  }>,
  ApplicationRuntimeMaterializationError
> {
  return Effect.try({
    try: () => loader.load(definition).getEntrypoint<
      ApplicationRuntimeColdEntrypoint
    >(APPLICATION_RUNTIME_COLD_ENTRYPOINT),
    catch: cause => failure("workerLoadFailed", cause),
  }).pipe(Effect.flatMap(stub => Effect.tryPromise({
    try: signal => awaitDetachedResolution(stub, signal),
    catch: cause => cause instanceof ApplicationRuntimeMaterializationError
      ? cause
      : failure("workerLoadFailed", cause),
  })));
}

function awaitDetachedResolution(
  stub: ApplicationRuntimeColdEntrypoint,
  signal: AbortSignal,
): Promise<Readonly<{
  readonly path: string;
  readonly functionKind: ApplicationRuntimeFunctionV1["kind"];
  readonly visibility: ApplicationRuntimeFunctionV1["visibility"];
}>> {
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
      pending = Promise.resolve(stub.resolve());
    } catch (cause) {
      signal.removeEventListener("abort", onAbort);
      reject(cause);
      return;
    }
    pending.then(value => {
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
        Result.match(decodeResolution(detached), {
          onFailure: reject,
          onSuccess: resolve,
        });
      } catch (cause) {
        reject(cause);
      }
    }, cause => {
      signal.removeEventListener("abort", onAbort);
      if (!cancelled) reject(cause);
    });
  });
}

function decodeResolution(value: unknown): Result.Result<Readonly<{
  readonly path: string;
  readonly functionKind: ApplicationRuntimeFunctionV1["kind"];
  readonly visibility: ApplicationRuntimeFunctionV1["visibility"];
}>, ApplicationRuntimeMaterializationError> {
  if (
    !isNonArrayRecord(value) ||
    Object.keys(value).length !== 4 ||
    value.kind !== "resolved" ||
    typeof value.path !== "string" ||
    !isFunctionKind(value.functionKind) ||
    (value.visibility !== "public" && value.visibility !== "internal")
  ) return Result.fail(failure("functionResolutionFailed"));
  return Result.succeed(Object.freeze({
    path: value.path,
    functionKind: value.functionKind,
    visibility: value.visibility,
  }));
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
      throw failure("functionResolutionFailed");
    }
    Object.defineProperty(detached, key, descriptor);
  }
  return detached;
}

function sha256(
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, ApplicationRuntimeMaterializationError> {
  return makeLiveDeclarativeV2RuntimeArtifactSha256V1()(
    bytes,
    { maximumInputBytes: bytes.byteLength },
  ).pipe(
    Effect.catchTag(
      "DeclarativeV2RuntimeArtifactSha256InputV1Error",
      cause => Effect.die(cause),
    ),
    Effect.mapError(cause => failure("resourceFailure", cause)),
  );
}

function coldEntrypointSource(
  fn: ApplicationRuntimeFunctionV1,
  coreImport: string,
  executionImport: string,
): string {
  return [
    'import { WorkerEntrypoint } from "cloudflare:workers";',
    `import { runApplicationRuntimeColdResolutionV1 } from ${JSON.stringify(
      coreImport,
    )};`,
    `const applicationFunction = ${JSON.stringify({
      path: fn.path,
      moduleName: fn.moduleName,
      exportName: fn.exportName,
      kind: fn.kind,
      visibility: fn.visibility,
      args: fn.args,
      returns: fn.returns,
      partition: fn.partition,
    })};`,
    `export class ${APPLICATION_RUNTIME_COLD_ENTRYPOINT} extends WorkerEntrypoint {`,
    "  async resolve() {",
    "    return runApplicationRuntimeColdResolutionV1({",
    `      loadExecution: () => import(${JSON.stringify(executionImport)}),`,
    "      function: applicationFunction,",
    "    });",
    "  }",
    "}",
    "",
  ].join("\n");
}

function isFunctionKind(
  value: unknown,
): value is ApplicationRuntimeFunctionV1["kind"] {
  return value === "query" || value === "mutation" ||
    value === "workflowMutation" || value === "action";
}

function isCompatibilityDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 10) === value;
}

function failure(
  reason: ApplicationRuntimeMaterializationError["reason"],
  cause?: unknown,
): ApplicationRuntimeMaterializationError {
  return new ApplicationRuntimeMaterializationError({
    operation: "materialize",
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
