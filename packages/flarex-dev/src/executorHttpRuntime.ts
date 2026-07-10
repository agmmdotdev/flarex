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
import {
  createFlarexExecutor,
  withReadyDeploymentAuthority,
} from "@flarex/executor";
import {
  createPostgresFreshnessMirrorStore,
  type PostgresFreshnessMirrorStore,
} from "@flarex/freshness";
import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import type { SharedDatabaseScopePhysicalLocator } from "@flarex/persistence-postgres";
import {
  CachedExecutionArtifactMaterializer,
  type ExecutionArtifactMaterializer,
  type MaterializedExecutionArtifactPayload,
} from "flarex-backend/artifact-runtime";
import { materializedExecutionArtifactInvokePayload } from "flarex-protocol/artifact-runtime";
import { decodeAuthConfigPromise, type ExecutionIdentity } from "flarex-protocol/auth";
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
    scopePhysicalLocator?: SharedDatabaseScopePhysicalLocator;
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
        subscription.identityJson,
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
    scopePhysicalLocator = localSharedScopePhysicalLocator,
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
  const executorPersistence = withReadyDeploymentAuthority(
    persistence,
    createPGliteSharedScopeAuthorityProvisioner(persistence, {
      physicalLocator: scopePhysicalLocator,
    }),
  );
  const executor = createFlarexExecutor({
    persistence: executorPersistence,
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

const localSharedScopePhysicalLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

async function materializedPayloadForSubscription(
  executor: FlarexExecutor,
  projectId: string,
  deploymentId: string,
  path: string,
  args: Json,
  partitionKey: string | null,
  identity: ExecutionIdentity,
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
    sourcePackage: await validateMaterializableSourcePackage(
      active.package.sourcePackageJson,
      active.package.packageId,
    ),
    request: {
      path,
      args,
      kind: "query",
      ...(partitionKey === null ? {} : { partitionKey }),
    },
    identity,
  });
}

async function validateMaterializableSourcePackage(
  value: Record<string, unknown>,
  packageId: string,
): Promise<PushSourcePackage> {
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
  const functions = value.functions;
  const execution = value.execution;
  const authConfigModule = value.authConfigModule;
  if (value.authConfig !== undefined && (typeof authConfigModule !== "string" || authConfigModule.length === 0)) {
    throw new Error(`Deployment package ${packageId} auth config module is required when auth config is present.`);
  }
  if (authConfigModule !== undefined && typeof authConfigModule !== "string") {
    throw new Error(`Deployment package ${packageId} has an invalid auth config module.`);
  }
  if (authConfigModule !== undefined && value.authConfig === undefined) {
    throw new Error(`Deployment package ${packageId} auth config is required when auth config module is present.`);
  }
  if (
    typeof authConfigModule === "string" &&
    !modules.some(module => module.path === authConfigModule)
  ) {
    throw new Error(`Deployment package ${packageId} auth config module ${authConfigModule} is missing.`);
  }
  const authConfig = await decodeMaterializableAuthConfig(value.authConfig, packageId);
  return {
    modules,
    functions: functions.map((fn, index) => {
      if (typeof fn !== "string") {
        throw new Error(`Deployment package ${packageId} has an invalid function at ${index}.`);
      }
      return fn;
    }),
    ...(typeof value.schema === "string" ? { schema: value.schema } : {}),
    ...(authConfig === undefined ? {} : { authConfig }),
    ...(typeof authConfigModule === "string"
      ? { authConfigModule }
      : {}),
    execution,
  };
}

async function decodeMaterializableAuthConfig(
  value: unknown,
  packageId: string,
): Promise<PushSourcePackage["authConfig"]> {
  if (value === undefined) return undefined;
  try {
    return await decodeAuthConfigPromise(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Deployment package ${packageId} has invalid auth config: ${message}`);
  }
}
