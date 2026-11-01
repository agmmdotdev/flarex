import { encodeValidatorJsonV1 } from "flarex-protocol/validator-json";
import type {
  ApplicationManifest,
} from "@flarex/analysis/application-analysis";
import {
  applicationFunctionEntryPublicationFrameV1,
} from "@flarex/analysis/internal/application-publication-v1";
import { isCanonicalCalendarDate } from "@flarex/time/calendar-date";
import type {
  ApplicationFunctionRuntimeFunctionV1,
} from "@flarex/function-runtime/internal/application-function-runtime-v1";
import {
  bytesEqualFullScan,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Result } from "effect";
import {
  recanonicalizeApplicationRuntimeTargetV1,
  applicationRuntimeTargetWireV1,
  type ApplicationRuntimeTargetV1,
  type ValidatorIdentityEncoding,
} from "flarex-protocol/internal/application-runtime-target-v1";
import type { EdgeActionHostPolicyFrameV1 } from
  "flarex-protocol/internal/edge-action-host-policy-v1";

import type {
  ApplicationAnalysisSourceBundle,
} from "../sourceArtifactV2/ApplicationAnalysisReader";
import {
  APPLICATION_WORKER_CORE_SOURCE,
  APPLICATION_WORKER_SERVER_EXPORTS,
  APPLICATION_WORKER_VALUES_EXPORTS,
} from "./ApplicationWorkerCore.generated";
import { APPLICATION_WORKER_CORE_SOURCE as PRIVATE_NATIVE_WORKER_CORE_SOURCE,
  APPLICATION_WORKER_SERVER_EXPORTS as PRIVATE_NATIVE_WORKER_SERVER_EXPORTS,
  APPLICATION_WORKER_VALUES_EXPORTS as PRIVATE_NATIVE_WORKER_VALUES_EXPORTS } from "./PrivateNativeApplicationWorkerCore.generated";
import { makeApplicationRuntimeModuleGraph } from
  "./ApplicationRuntimeModuleGraph";
import { applicationRuntimeSourceMatchesManifest } from
  "./ApplicationRuntimeSourceAuthority";

export const APPLICATION_TRANSACTION_WORKER_ENTRYPOINT =
  "FlarexApplicationTransactionWorker" as const;
export const APPLICATION_ACTION_WORKER_ENTRYPOINT =
  "FlarexApplicationActionWorker" as const;
export const APPLICATION_WORKER_COMPATIBILITY_DATE = "2026-06-14" as const;
export const APPLICATION_TRANSACTION_WORKER_CPU_MILLISECONDS = 10_000;
export const APPLICATION_TRANSACTION_WORKER_WALL_MILLISECONDS = 30_000;

export interface ApplicationWorkerDefinition {
  readonly validatorIdentityEncoding: ValidatorIdentityEncoding;
  readonly documentIdFormat?: "convex";
  readonly privateNative?: true;
  readonly targetCanonicalText: string;
  readonly hostPolicySha256Hex: string;
  readonly transactionWallMilliseconds: number;
  readonly actionWallMilliseconds: number;
  readonly compatibilityDate: string;
  readonly transactionLimits: Readonly<{
    readonly cpuMs: number;
    readonly subRequests: 0;
  }>;
  readonly actionLimits: Readonly<{
    readonly cpuMs: number;
    readonly subRequests: number;
  }>;
  readonly mainModule: string;
  readonly modules: Readonly<Record<string, WorkerLoaderModule | string>>;
  readonly env: Readonly<Record<PropertyKey, never>>;
  readonly transactionEntrypoint:
    typeof APPLICATION_TRANSACTION_WORKER_ENTRYPOINT;
  readonly actionEntrypoint: typeof APPLICATION_ACTION_WORKER_ENTRYPOINT;
}

export function makeApplicationWorkerDefinition(input: {
  readonly source: ApplicationAnalysisSourceBundle;
  readonly target: ApplicationRuntimeTargetV1;
  /** Authenticated by the stored-program owner; never supplied by the request. */
  readonly validatorIdentityEncoding?: ValidatorIdentityEncoding;
  readonly manifest: ApplicationManifest;
  readonly hostPolicy: EdgeActionHostPolicyFrameV1;
  readonly hostPolicySha256: Uint8Array;
  readonly compatibilityDate?: string;
  /** Selected by trusted storage composition and emitted into the definition. */
  readonly documentIdFormat?: "convex";
  /** Trusted bounded native-root profile; never supplied by Worker arguments. */
  readonly privateNative?: true;
}): ApplicationWorkerDefinition {
  const compatibilityDate = input.compatibilityDate ??
    APPLICATION_WORKER_COMPATIBILITY_DATE;
  if (!isCompatibilityDate(compatibilityDate)) {
    throw new Error("Application worker compatibility date is invalid.");
  }
  if (!isUint8ArrayWithByteLength(input.hostPolicySha256, 32)) {
    throw new Error("Application worker host policy digest is invalid.");
  }
  const validatorIdentityEncoding = input.validatorIdentityEncoding ?? 2;
  const canonicalTarget = recanonicalizeApplicationRuntimeTargetV1(
    input.target,
    validatorIdentityEncoding,
  ).pipe(Result.getOrThrow);
  requireSourceAuthority(input.source, canonicalTarget.target, input.manifest);
  const rootOrdinal = input.manifest.functions.findIndex(
    fn => fn.path === canonicalTarget.target.function.path,
  );
  const manifestRoot = input.manifest.functions[rootOrdinal];
  if (
    rootOrdinal < 0 || manifestRoot === undefined ||
    !functionMatchesTarget(manifestRoot, canonicalTarget.target.function)
  ) throw new Error("Application worker root function authority mismatches.");
  const rootFunction = runtimeFunction(
    canonicalTarget.target.function,
    rootOrdinal,
  );
  if (input.privateNative === true && (input.documentIdFormat !== "convex" || rootFunction.kind !== "mutation"))
    throw new Error("Private native Worker definitions require a Core mutation");
  const internalFunctionCatalog = Object.freeze(
    input.manifest.functions.flatMap((fn, ordinal) =>
      fn.kind === "query" || fn.kind === "mutation"
        ? [runtimeFunction(fn, ordinal)]
        : []
    ),
  );
  const definition = Object.freeze({
    validatorIdentityEncoding,
    target: canonicalTarget.target,
    rootFunction,
    internalFunctionCatalog,
    hostPolicy: input.hostPolicy,
    hostPolicySha256Hex: hex(input.hostPolicySha256),
    ...(input.documentIdFormat === undefined ? {} : { documentIdFormat: input.documentIdFormat }),
  });
  const graph = makeApplicationRuntimeModuleGraph({
    source: input.source,
    coreSource: input.privateNative === true ? PRIVATE_NATIVE_WORKER_CORE_SOURCE : APPLICATION_WORKER_CORE_SOURCE,
    serverExports: input.privateNative === true ? PRIVATE_NATIVE_WORKER_SERVER_EXPORTS : APPLICATION_WORKER_SERVER_EXPORTS,
    valuesExports: input.privateNative === true ? PRIVATE_NATIVE_WORKER_VALUES_EXPORTS : APPLICATION_WORKER_VALUES_EXPORTS,
    entrypointSource: imports => entrypointSource(
      imports.core,
      imports.execution,
      definition,
      input.privateNative === true,
    ),
  });
  return Object.freeze({
    validatorIdentityEncoding,
    ...(input.privateNative === undefined ? {} : { privateNative: input.privateNative }),
    ...(input.documentIdFormat === undefined ? {} : { documentIdFormat: input.documentIdFormat }),
    targetCanonicalText: canonicalTarget.canonicalText,
    hostPolicySha256Hex: hex(input.hostPolicySha256),
    transactionWallMilliseconds:
      APPLICATION_TRANSACTION_WORKER_WALL_MILLISECONDS,
    actionWallMilliseconds: input.hostPolicy.wallMilliseconds,
    compatibilityDate,
    transactionLimits: Object.freeze({
      cpuMs: APPLICATION_TRANSACTION_WORKER_CPU_MILLISECONDS,
      subRequests: 0,
    }),
    actionLimits: Object.freeze({
      cpuMs: input.hostPolicy.cpuMilliseconds,
      subRequests: input.hostPolicy.maximumWorkerSubrequests,
    }),
    mainModule: graph.mainModule,
    modules: graph.modules,
    env: Object.freeze({}),
    transactionEntrypoint: APPLICATION_TRANSACTION_WORKER_ENTRYPOINT,
    actionEntrypoint: APPLICATION_ACTION_WORKER_ENTRYPOINT,
  });
}

function entrypointSource(
  coreImport: string,
  executionImport: string,
  definition: Readonly<{
    readonly validatorIdentityEncoding: ValidatorIdentityEncoding;
    readonly target: ApplicationRuntimeTargetV1;
    readonly rootFunction: ApplicationFunctionRuntimeFunctionV1;
    readonly internalFunctionCatalog: ReadonlyArray<
      ApplicationFunctionRuntimeFunctionV1
    >;
    readonly hostPolicy: EdgeActionHostPolicyFrameV1;
    readonly hostPolicySha256Hex: string;
    readonly documentIdFormat?: "convex";
  }>,
  privateNative = false,
): string {
  const functionWire = (fn: ApplicationFunctionRuntimeFunctionV1) => ({
    ...fn,
    args: encodeValidatorJsonV1(fn.args),
    returns: fn.returns === null ? null : encodeValidatorJsonV1(fn.returns),
  });
  const wireDefinition = {
    ...definition,
    target: { ...applicationRuntimeTargetWireV1(definition.target),
      ...(definition.validatorIdentityEncoding === 1 ? { validatorIdentityEncoding: undefined } : {}) },
    rootFunction: functionWire(definition.rootFunction),
    internalFunctionCatalog: definition.internalFunctionCatalog.map(functionWire),
  };
  return [
    'import { WorkerEntrypoint } from "cloudflare:workers";',
    `import { ${privateNative ? "executePrivateNativeApplicationTransactionWorker as executeApplicationTransactionWorkerV1" : "executeApplicationTransactionWorkerV1"}, executeApplicationActionWorkerV1, decodeValidatorJsonWireCoreV1 } from ${JSON.stringify(coreImport)};`,
    'const functionFromWire = fn => Object.freeze({ ...fn, args: decodeValidatorJsonWireCoreV1(fn.args), returns: fn.returns === null ? null : decodeValidatorJsonWireCoreV1(fn.returns) });',
    `const wireDefinition = JSON.parse(${JSON.stringify(JSON.stringify(wireDefinition))});`,
    'const definition = Object.freeze({ ...wireDefinition, target: Object.freeze({ ...wireDefinition.target, function: functionFromWire(wireDefinition.target.function) }), rootFunction: functionFromWire(wireDefinition.rootFunction), internalFunctionCatalog: Object.freeze(wireDefinition.internalFunctionCatalog.map(functionFromWire)) });',
    `const loadExecution = () => import(${JSON.stringify(executionImport)});`,
    `export class ${APPLICATION_TRANSACTION_WORKER_ENTRYPOINT} extends WorkerEntrypoint {`,
    "  run(request, capability) {",
    "    return executeApplicationTransactionWorkerV1({",
    "      request, capability, definition, loadExecution,",
    "    });",
    "  }",
    "}",
    `export class ${APPLICATION_ACTION_WORKER_ENTRYPOINT} extends WorkerEntrypoint {`,
    "  run(request, capability) {",
    "    return executeApplicationActionWorkerV1({",
    "      request, capability, definition, loadExecution,",
    "    });",
    "  }",
    "}",
    "",
  ].join("\n");
}

function runtimeFunction(
  fn: ApplicationManifest["functions"][number] |
    ApplicationRuntimeTargetV1["function"],
  ordinal: number,
): ApplicationFunctionRuntimeFunctionV1 {
  return Object.freeze({
    path: fn.path,
    moduleName: fn.moduleName,
    exportName: fn.exportName,
    kind: fn.kind,
    visibility: fn.visibility,
    args: fn.args,
    returns: fn.returns,
    partition: fn.partition,
    ordinal,
  });
}

function requireSourceAuthority(
  source: ApplicationAnalysisSourceBundle,
  target: ApplicationRuntimeTargetV1,
  manifest: ApplicationManifest,
): void {
  if (
    source.sourceArtifact.rootSha256 !== target.sourceArtifactRootSha256 ||
    source.sourceArtifact.executionModulePath !== target.executionModulePath ||
    !applicationRuntimeSourceMatchesManifest(source, manifest)
  ) throw new Error("Application worker source authority mismatches.");
}

function functionMatchesTarget(
  manifest: ApplicationManifest["functions"][number],
  target: ApplicationRuntimeTargetV1["function"],
): boolean {
  const targetProjection: ApplicationManifest["functions"][number] = {
    path: target.path,
    moduleName: target.moduleName,
    exportName: target.exportName,
    kind: target.kind,
    visibility: target.visibility,
    args: target.args,
    returns: target.returns,
    partition: target.partition,
  };
  return Result.match(Result.all([
    applicationFunctionEntryPublicationFrameV1(manifest),
    applicationFunctionEntryPublicationFrameV1(targetProjection),
  ]), {
    onFailure: () => false,
    onSuccess: ([manifestFrame, targetFrame]) =>
      bytesEqualFullScan(manifestFrame, targetFrame),
  });
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function isCompatibilityDate(value: string): boolean {
  return isCanonicalCalendarDate(value);
}
