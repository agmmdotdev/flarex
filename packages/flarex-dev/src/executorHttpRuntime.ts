import {
  createFlarexBackendLiveQueryTriggerNotifier,
  createFlarexHttpHandler,
  type FlarexHttpAppConfig,
} from "@flarex/executor-http";
import type {
  FlarexExecutor,
  FlarexExecutorConfig,
  Json,
  RerunStaleLiveQuerySubscriptionsInput,
} from "@flarex/executor";
import { createFlarexExecutor } from "@flarex/executor";
import {
  createPostgresFreshnessMirrorStore,
  type PostgresFreshnessMirrorStore,
} from "@flarex/freshness";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import {
  CachedExecutionArtifactMaterializer,
  type ExecutionArtifactMaterializer,
  type MaterializedExecutionArtifactPayload,
} from "flarex-backend/artifact-runtime";
import { materializedExecutionArtifactInvokePayload } from "flarex-protocol/artifact-runtime";
import type { ExecutionArtifactRef } from "flarex/artifacts";
import type { PushSourcePackage } from "flarex-backend/types";

import {
  createMaterializedArtifactLiveQueryExecutionHost,
  LocalMiniflareExecutionArtifactMaterializer,
} from "./runtimeMaterializer.ts";

export type LocalExecutorHttpRuntimeOptions =
  Omit<FlarexHttpAppConfig, "liveQueryRerun"> & {
    projectId: string;
    freshnessStore: RerunStaleLiveQuerySubscriptionsInput["freshnessStore"];
    materializer?: ExecutionArtifactMaterializer;
  };

export type LocalExecutorHttpRuntime = {
  fetch(request: Request): Promise<Response>;
  dispose(): Promise<void>;
  cacheSize(): number;
};

export type LocalPGliteExecutorHttpRuntimeOptions =
  Omit<LocalExecutorHttpRuntimeOptions, "executor" | "freshnessStore"> & {
    backendUrl: string | URL;
    persistence?: PGliteFlarexPersistence;
    migrate?: boolean;
    clock?: FlarexExecutorConfig["clock"];
    ids?: FlarexExecutorConfig["ids"];
    triggerCapabilityToken?: string;
    triggerFetch?: typeof fetch;
    triggerLimit?: number;
    triggerDeliveryLimit?: number;
    triggerMaxBatches?: number;
    onTriggerError?: NonNullable<
      NonNullable<FlarexExecutorConfig["liveQueryInvalidation"]>["onError"]
    >;
  };

export type LocalPGliteExecutorHttpRuntime = LocalExecutorHttpRuntime & {
  executor: FlarexExecutor;
  persistence: PGliteFlarexPersistence;
  freshnessStore: PostgresFreshnessMirrorStore;
};

export function createLocalExecutorHttpRuntime(
  options: LocalExecutorHttpRuntimeOptions,
): LocalExecutorHttpRuntime {
  let handler!: (request: Request) => Promise<Response>;
  const materializer = new CachedExecutionArtifactMaterializer(
    options.materializer ??
      new LocalMiniflareExecutionArtifactMaterializer({
        executorTransport: "postgres",
        projectId: options.projectId,
        ...(options.capabilityToken === undefined
          ? {}
          : { executorToken: options.capabilityToken }),
        backend: request => handler(request),
      }),
  );

  const executeQuery: NonNullable<FlarexHttpAppConfig["liveQueryRerun"]>["executeQuery"] =
    async (attempt, subscription) => {
      const payload = await materializedPayloadForSubscription(
        options.executor,
        options.projectId,
        subscription.deploymentId,
        subscription.functionPath,
        subscription.argsJson as Json,
        subscription.partitionKey,
      );
      const artifact = await materializer.get(payload);
      return await createMaterializedArtifactLiveQueryExecutionHost({
        artifact,
        payload,
        projectId: options.projectId,
      })(attempt, subscription);
    };

  handler = createFlarexHttpHandler({
    ...options,
    liveQueryRerun: {
      freshnessStore: options.freshnessStore,
      executeQuery,
    },
  });

  return {
    fetch: request => handler(request),
    dispose: () => materializer.clear(),
    cacheSize: () => materializer.size(),
  };
}

export async function createLocalPGliteExecutorHttpRuntime(
  options: LocalPGliteExecutorHttpRuntimeOptions,
): Promise<LocalPGliteExecutorHttpRuntime> {
  const {
    backendUrl,
    persistence: providedPersistence,
    migrate,
    clock,
    ids,
    triggerCapabilityToken,
    triggerFetch,
    triggerLimit,
    triggerDeliveryLimit,
    triggerMaxBatches,
    onTriggerError,
    ...runtimeOptions
  } = options;
  const persistence = providedPersistence ?? await createPGlitePersistence();
  if (migrate !== false) {
    await persistence.migrate();
  }
  const freshnessStore = createPostgresFreshnessMirrorStore(persistence);
  const executor = createFlarexExecutor({
    persistence,
    ...(clock === undefined ? {} : { clock }),
    ...(ids === undefined ? {} : { ids }),
    liveQueryInvalidation: {
      freshnessStore,
      notifyTrigger: createFlarexBackendLiveQueryTriggerNotifier({
        backendUrl,
        ...(triggerCapabilityToken === undefined
          ? {}
          : { capabilityToken: triggerCapabilityToken }),
        ...(triggerFetch === undefined ? {} : { fetch: triggerFetch }),
        ...(triggerLimit === undefined ? {} : { limit: triggerLimit }),
        ...(triggerDeliveryLimit === undefined
          ? {}
          : { deliveryLimit: triggerDeliveryLimit }),
        ...(triggerMaxBatches === undefined
          ? {}
          : { maxBatches: triggerMaxBatches }),
      }),
      ...(onTriggerError === undefined ? {} : { onError: onTriggerError }),
    },
  });
  const runtime = createLocalExecutorHttpRuntime({
    ...runtimeOptions,
    executor,
    freshnessStore,
  });
  return {
    ...runtime,
    executor,
    persistence,
    freshnessStore,
  };
}

async function materializedPayloadForSubscription(
  executor: FlarexExecutor,
  projectId: string,
  deploymentId: string,
  path: string,
  args: Json,
  partitionKey: string | null,
): Promise<MaterializedExecutionArtifactPayload> {
  const active = await executor.getActiveDeploymentPackage({
    deploymentId,
    projectId,
  });
  const ref: ExecutionArtifactRef = {
    runtime: "dynamic-worker",
    artifactId: active.package.packageId,
    sourcePackageHash: active.package.sourcePackageHash,
    executionModule: active.package.executionModule,
  };
  return materializedExecutionArtifactInvokePayload({
    deploymentId,
    ref,
    sourcePackage: validateMaterializableSourcePackage(
      active.package.sourcePackageJson,
      active.package.packageId,
    ),
    request: {
      path,
      args,
      kind: "query",
      ...(partitionKey === null ? {} : { partitionKey }),
    },
  });
}

function validateMaterializableSourcePackage(
  value: Record<string, unknown>,
  packageId: string,
): PushSourcePackage {
  if (!Array.isArray(value.modules)) {
    throw new Error(`Deployment package ${packageId} is missing source modules.`);
  }
  const modules: PushSourcePackage["modules"] = value.modules.map((module, index) => {
    if (typeof module !== "object" || module === null || Array.isArray(module)) {
      throw new Error(`Deployment package ${packageId} has an invalid module at ${index}.`);
    }
    const candidate = module as Record<string, unknown>;
    if (
      typeof candidate.path !== "string" ||
      candidate.environment !== "isolate" ||
      typeof candidate.sha256 !== "string" ||
      typeof candidate.source !== "string"
    ) {
      throw new Error(
        `Deployment package ${packageId} module ${index} is not materializable.`,
      );
    }
    return {
      path: candidate.path,
      environment: "isolate" as const,
      sha256: candidate.sha256,
      source: candidate.source,
      ...(typeof candidate.sourceMap === "string" ? { sourceMap: candidate.sourceMap } : {}),
    };
  });
  if (!Array.isArray(value.functions) || typeof value.execution !== "string") {
    throw new Error(`Deployment package ${packageId} is not a valid source package.`);
  }
  return {
    modules,
    functions: value.functions.map((fn, index) => {
      if (typeof fn !== "string") {
        throw new Error(`Deployment package ${packageId} has an invalid function at ${index}.`);
      }
      return fn;
    }),
    ...(typeof value.schema === "string" ? { schema: value.schema } : {}),
    execution: value.execution,
  };
}
