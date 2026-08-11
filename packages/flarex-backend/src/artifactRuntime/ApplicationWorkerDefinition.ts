import type {
  ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import type {
  ApplicationFunctionRuntimeFunctionV1,
} from "@flarex/function-runtime/internal/application-function-runtime-v1";
import { isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import type {
  ApplicationRuntimeTargetV1,
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

export interface ApplicationWorkerDefinition {
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
  readonly manifest: ApplicationManifestV1;
  readonly hostPolicy: EdgeActionHostPolicyFrameV1;
  readonly hostPolicySha256: Uint8Array;
  readonly compatibilityDate?: string;
}): ApplicationWorkerDefinition {
  const compatibilityDate = input.compatibilityDate ??
    APPLICATION_WORKER_COMPATIBILITY_DATE;
  if (!isCompatibilityDate(compatibilityDate)) {
    throw new Error("Application worker compatibility date is invalid.");
  }
  if (!isUint8ArrayWithByteLength(input.hostPolicySha256, 32)) {
    throw new Error("Application worker host policy digest is invalid.");
  }
  requireSourceAuthority(input.source, input.target, input.manifest);
  const rootOrdinal = input.manifest.functions.findIndex(
    fn => fn.path === input.target.function.path,
  );
  const manifestRoot = input.manifest.functions[rootOrdinal];
  if (
    rootOrdinal < 0 || manifestRoot === undefined ||
    !functionMatchesTarget(manifestRoot, input.target.function)
  ) throw new Error("Application worker root function authority mismatches.");
  const rootFunction = runtimeFunction(input.target.function, rootOrdinal);
  const internalFunctionCatalog = Object.freeze(
    input.manifest.functions.flatMap((fn, ordinal) =>
      fn.visibility === "internal" &&
          (fn.kind === "query" || fn.kind === "mutation")
        ? [runtimeFunction(fn, ordinal)]
        : []
    ),
  );
  const definition = Object.freeze({
    target: input.target,
    rootFunction,
    internalFunctionCatalog,
    hostPolicy: input.hostPolicy,
    hostPolicySha256Hex: hex(input.hostPolicySha256),
  });
  const graph = makeApplicationRuntimeModuleGraph({
    source: input.source,
    coreSource: APPLICATION_WORKER_CORE_SOURCE,
    serverExports: APPLICATION_WORKER_SERVER_EXPORTS,
    valuesExports: APPLICATION_WORKER_VALUES_EXPORTS,
    entrypointSource: imports => entrypointSource(
      imports.core,
      imports.execution,
      definition,
    ),
  });
  return Object.freeze({
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
    readonly target: ApplicationRuntimeTargetV1;
    readonly rootFunction: ApplicationFunctionRuntimeFunctionV1;
    readonly internalFunctionCatalog: ReadonlyArray<
      ApplicationFunctionRuntimeFunctionV1
    >;
    readonly hostPolicy: EdgeActionHostPolicyFrameV1;
    readonly hostPolicySha256Hex: string;
  }>,
): string {
  return [
    'import { WorkerEntrypoint } from "cloudflare:workers";',
    `import { executeApplicationTransactionWorkerV1, executeApplicationActionWorkerV1 } from ${JSON.stringify(coreImport)};`,
    `const definition = Object.freeze(${JSON.stringify(definition)});`,
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
  fn: ApplicationManifestV1["functions"][number] |
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
  manifest: ApplicationManifestV1,
): void {
  if (
    source.sourceArtifact.rootSha256 !== target.sourceArtifactRootSha256 ||
    source.sourceArtifact.executionModulePath !== target.executionModulePath ||
    !applicationRuntimeSourceMatchesManifest(source, manifest)
  ) throw new Error("Application worker source authority mismatches.");
}

function functionMatchesTarget(
  manifest: ApplicationManifestV1["functions"][number],
  target: ApplicationRuntimeTargetV1["function"],
): boolean {
  return JSON.stringify({
    path: manifest.path,
    moduleName: manifest.moduleName,
    exportName: manifest.exportName,
    kind: manifest.kind,
    visibility: manifest.visibility,
    args: manifest.args,
    returns: manifest.returns,
    partition: manifest.partition,
  }) === JSON.stringify({
    path: target.path,
    moduleName: target.moduleName,
    exportName: target.exportName,
    kind: target.kind,
    visibility: target.visibility,
    args: target.args,
    returns: target.returns,
    partition: target.partition,
  });
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function isCompatibilityDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 10) === value;
}
