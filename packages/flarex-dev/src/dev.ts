import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { build, type Plugin } from "vite";
import type { R2BucketLike } from "flarex-backend/artifact-store";
import { createPGlitePersistence } from "@flarex/persistence-postgres/pglite";
import {
  createLocalAnalyzerService,
  devFinishPushErrorMessage,
  devPushStatusErrorMessage,
  LOCAL_BACKEND_DEPLOY_PUSH_TOKEN,
  LocalBackendPushCoordinator,
  type BackendPushCoordinator,
  type DevPushStatus,
} from "./backendPush.ts";
import {
  createLocalPGliteExecutorHttpRuntime,
  type LocalPGliteExecutorHttpRuntime,
} from "./executorHttpRuntime.ts";
import {
  bundleFlarexSourcePackage,
  finalCodegen,
  initialCodegen,
  type FlarexGenerateOptions,
} from "./generate.ts";
import {
  generatedOutputTypecheckOptions,
  typecheckGeneratedOutput,
  type FlarexGeneratedOutputTypecheckOption,
} from "./generatedTypecheck.ts";
import { LocalMiniflareExecutionArtifactMaterializer } from "./runtimeMaterializer.ts";
import {
  decodeDevInvokeBody,
  devRouteErrorMessage,
  isDevRouteError,
} from "./routeBoundary.ts";
import type { SourcePackage } from "./sourcePackage.ts";

export type FlarexDevRuntimeOptions = FlarexGenerateOptions & {
  deploymentId?: string;
  executorTransport?: "legacy" | "postgres";
  projectId?: string;
  executorToken?: string;
  liveQueryDeliveryToken?: string;
  persistDir?: string | false;
  typecheckGeneratedOutput?: FlarexGeneratedOutputTypecheckOption;
  pushCoordinatorFactory?: (backend: Miniflare, deploymentId: string) => BackendPushCoordinator;
};

export type FlarexDevPersistDirOptions = Pick<
  FlarexDevRuntimeOptions,
  "root" | "persistDir"
>;

export type FlarexDevRuntime = {
  deploymentId: string;
  reload: () => Promise<void>;
  fetch: (request: Request) => Promise<Response>;
  dispose: () => Promise<void>;
};

export function resolveFlarexDevPersistDir(options: FlarexDevPersistDirOptions): string | false {
  return options.persistDir === false
    ? false
    : resolve(options.root, options.persistDir ?? ".flarex/dev");
}

export function resolveResettableFlarexDevPersistDir(
  options: FlarexDevPersistDirOptions,
): string | false {
  if (options.persistDir === false || options.persistDir === undefined) return false;
  const persistDir = resolveFlarexDevPersistDir(options);
  if (persistDir === false) return false;
  const root = resolve(options.root);
  const relativePersistDir = relative(root, persistDir);
  const normalizedRelativePersistDir = relativePersistDir.replaceAll("\\", "/");
  const isInsideRoot =
    relativePersistDir.length > 0 &&
    !relativePersistDir.startsWith("..") &&
    !isAbsolute(relativePersistDir);
  const isUnderFlarexDir = normalizedRelativePersistDir.startsWith(".flarex/");
  if (
    !isInsideRoot ||
    !isUnderFlarexDir ||
    persistDir === parse(persistDir).root
  ) {
    throw new Error(
      "flarex-test reset can only delete explicit persistDir paths under the app .flarex directory.",
    );
  }
  return persistDir;
}

const compatibilityDate = "2026-06-14";

type ResponseLike = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  status: number;
  statusText: string;
  headers: { forEach: (callback: (value: string, key: string) => void) => void };
};

type BackendRuntime = {
  backend: Miniflare;
  executorRuntime?: LocalPGliteExecutorHttpRuntime;
  projectId?: string;
  executorToken?: string;
  liveQueryDeliveryToken?: string;
  disposeArtifactRuntime: () => Promise<void>;
};

type BackendMiniflareOptions = {
  executorTransport: "legacy" | "postgres";
  deploymentId: string;
  projectId?: string;
  executorToken?: string;
  liveQueryDeliveryToken?: string;
  executorPersist: string | false;
};

export async function createFlarexDevRuntime(
  options: FlarexDevRuntimeOptions,
): Promise<FlarexDevRuntime> {
  const deploymentId = options.deploymentId ?? "local-dev";
  const persistDir = resolveFlarexDevPersistDir(options);
  const backendPersist = persistDir === false ? false : join(persistDir, "backend");
  const appPersist = persistDir === false ? false : join(persistDir, "app");
  const executorPersist = persistDir === false ? false : join(persistDir, "executor");
  if (backendPersist !== false) await mkdir(backendPersist, { recursive: true });
  if (appPersist !== false) await mkdir(appPersist, { recursive: true });
  if (executorPersist !== false) await mkdir(executorPersist, { recursive: true });

  const backendRuntime = await createBackendMiniflare(backendPersist, {
    executorTransport: options.executorTransport ?? "legacy",
    deploymentId,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    ...(options.executorToken === undefined ? {} : { executorToken: options.executorToken }),
    ...(options.liveQueryDeliveryToken === undefined
      ? {}
      : { liveQueryDeliveryToken: options.liveQueryDeliveryToken }),
    executorPersist,
  });
  const backend = backendRuntime.backend;
  const pushCoordinator = options.pushCoordinatorFactory === undefined
    ? new LocalBackendPushCoordinator(backend, deploymentId)
    : options.pushCoordinatorFactory(backend, deploymentId);
  let app: Miniflare | undefined;
  let lastPush: DevPushStatus | undefined;

  async function createApp(): Promise<Miniflare> {
    const postgresExecutor = backendRuntime.executorRuntime;
    return new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: await bundleWorker(generatedWorkerEntry(options)),
        },
      ],
      compatibilityDate,
      bindings: {
        FLAREX_DEPLOYMENT_ID: deploymentId,
        ...(postgresExecutor === undefined
          ? {}
          : {
              FLAREX_EXECUTOR_TRANSPORT: "postgres",
              FLAREX_PROJECT_ID: backendRuntime.projectId,
              FLAREX_EXECUTOR_TOKEN: backendRuntime.executorToken,
            }),
      },
      serviceBindings: {
        FLAREX_BACKEND: async (request: Request) =>
          postgresExecutor === undefined
            ? dispatchMiniflare(backend, request)
            : postgresExecutor.fetch(request),
      },
      durableObjectsPersist: appPersist,
      durableObjects: {
        CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
        DELIVERIES: { className: "DeliveryDO", useSQLite: true },
      },
    });
  }

  let reloadChain = Promise.resolve();
  async function reloadNow(): Promise<void> {
    const context = await initialCodegen(options);
    const sourcePackage = await bundleFlarexSourcePackage(context);
    const started = await pushCoordinator.start(sourcePackage);
    if (started.state !== "analyzed" || started.analysis === undefined) {
      throw new Error(`Flarex push ${started.pushId} is not ready to finish: ${started.state}`);
    }
    if (started.codegenAnalysis === undefined) {
      throw new Error(`Flarex push ${started.pushId} did not return codegen analysis.`);
    }
    await finalCodegen(context, started.codegenAnalysis);
    await maybeTypecheckGeneratedOutput(options);
    if (backendRuntime.executorRuntime !== undefined) {
      await activateExecutorPackage(
        backendRuntime,
        deploymentId,
        sourcePackage,
        started.analysis,
      );
    }
    const nextApp = await createApp();
    try {
      const finished = await pushCoordinator.finish(started.pushId);
      if (finished.result !== "activated") {
        throw new Error(
          devFinishPushErrorMessage(
            finished,
            `Flarex push ${started.pushId} did not activate`,
          ),
        );
      }
      lastPush = finished.push;
      const previousApp = app;
      app = nextApp;
      await previousApp?.dispose();
    } catch (error) {
      await nextApp.dispose();
      throw error;
    }
  }

  function reload(): Promise<void> {
    reloadChain = reloadChain.then(reloadNow, reloadNow);
    return reloadChain;
  }

  try {
    await reload();
  } catch (error) {
    await disposeDevRuntimeResources(app, backendRuntime, backend, options, persistDir, {
      preservePrimaryError: true,
    })
      .catch(() => undefined);
    throw error;
  }

  return {
    deploymentId,
    reload,
    fetch: async request => {
      const activeApp = app;
      if (!activeApp) {
        return Response.json({ error: "Flarex dev runtime is not ready." }, { status: 503 });
      }
      const url = new URL(request.url);
      if (url.pathname === "/__flarex_dev/health") {
        const [backendHealth, appHealth] = await Promise.all([
          backend.dispatchFetch("http://flarex.backend/health"),
          activeApp.dispatchFetch("http://flarex.app/health"),
        ]);
        return Response.json({
          service: "flarex-dev",
          status: backendHealth.ok && appHealth.ok ? "ok" : "degraded",
          deploymentId,
          backend: await responseJson(backendHealth),
          app: await responseJson(appHealth),
        });
      }
      if (url.pathname === "/__flarex_dev/push") {
        return Response.json(lastPush ?? null);
      }
      if (url.pathname === "/__flarex_dev/deployment" && request.method === "GET") {
        return toWebResponse(
          await backend.dispatchFetch(
            `http://flarex.backend/deployments/${deploymentId}/deployment`,
          ),
        );
      }
      if (url.pathname === "/__flarex_dev/invoke" && request.method === "POST") {
        try {
          return toWebResponse(
            await backend.dispatchFetch(
              `http://flarex.backend/deployments/${deploymentId}/invoke`,
              {
                method: "POST",
                headers: requestHeaders(request),
                // Deliberate runtime bridge: proxy body decode must finish before fetch.
                body: JSON.stringify(await Effect.runPromise(decodeDevInvokeBody(request))),
              },
            ),
          );
        } catch (error) {
          return Response.json(
            {
              error: isDevRouteError(error)
                ? devRouteErrorMessage(error)
                : error instanceof Error ? error.message : String(error),
            },
            { status: 400 },
          );
        }
      }
      if (url.pathname === "/__flarex_dev/sync") {
        return await backend.dispatchFetch(
          `http://flarex.backend/deployments/${deploymentId}/sync`,
          {
            headers: requestHeaders(request),
          },
        ) as unknown as Response;
      }

      const forwardedPath = url.pathname.replace(/^\/__flarex_dev/, "") || "/";
      const forwardedUrl = new URL(request.url);
      forwardedUrl.pathname = forwardedPath;
      return toWebResponse(
        await activeApp.dispatchFetch(forwardedUrl.toString(), {
          method: request.method,
          headers: requestHeaders(request),
          ...(request.method === "GET" || request.method === "HEAD"
            ? {}
            : { body: await request.text() }),
        }),
      );
    },
    dispose: async () => {
      await reloadChain.catch(() => undefined);
      await disposeDevRuntimeResources(app, backendRuntime, backend, options, persistDir, {
        preservePrimaryError: false,
      });
    },
  };
}

async function disposeDevRuntimeResources(
  app: Miniflare | undefined,
  backendRuntime: BackendRuntime,
  backend: Miniflare,
  options: FlarexDevRuntimeOptions,
  persistDir: string | false,
  mode: { preservePrimaryError: boolean },
): Promise<void> {
  const results = await Promise.allSettled([
    app?.dispose(),
    backendRuntime.executorRuntime?.dispose(),
    backendRuntime.disposeArtifactRuntime(),
    backend.dispose(),
  ]);
  if (options.persistDir === undefined && persistDir !== false) {
    results.push(await settled(rm(persistDir, { recursive: true, force: true })));
  }
  if (!mode.preservePrimaryError) {
    const failures = results.filter(isRejectedPromiseResult).map(result => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Failed to dispose Flarex dev runtime resources.");
    }
  }
}

function settled<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    value => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );
}

function isRejectedPromiseResult<T>(
  result: PromiseSettledResult<T>,
): result is PromiseRejectedResult {
  return result.status === "rejected";
}

async function maybeTypecheckGeneratedOutput(options: FlarexDevRuntimeOptions): Promise<void> {
  const typecheckOptions = generatedOutputTypecheckOptions(options);
  if (typecheckOptions === undefined) return;
  await typecheckGeneratedOutput(typecheckOptions);
}

async function activateExecutorPackage(
  backendRuntime: BackendRuntime,
  deploymentId: string,
  sourcePackage: SourcePackage,
  analysis: DevPushStatus["analysis"],
): Promise<void> {
  const executor = backendRuntime.executorRuntime?.executor;
  const projectId = backendRuntime.projectId;
  if (executor === undefined || projectId === undefined) return;
  const registered = await executor.registerDeploymentPackage({
    deploymentId,
    projectId,
    sourcePackage,
    ...(analysis === undefined ? {} : { analysisJson: analysis }),
  });
  await executor.activateDeploymentPackage({
    deploymentId,
    projectId,
    packageId: registered.package.packageId,
    schemaVersion: schemaVersionFromAnalysis(analysis),
  });
}

function schemaVersionFromAnalysis(analysis: DevPushStatus["analysis"]): number {
  const schema = analysis?.schema;
  if (
    typeof schema === "object" &&
    schema !== null &&
    !Array.isArray(schema) &&
    typeof (schema as { version?: unknown }).version === "number"
  ) {
    return (schema as { version: number }).version;
  }
  return 1;
}

async function dispatchMiniflare(target: Miniflare, request: Request): Promise<Response> {
  return toWebResponse(
    await target.dispatchFetch(request.url, {
      method: request.method,
      headers: requestHeaders(request),
      ...(request.method === "GET" || request.method === "HEAD"
        ? {}
        : { body: await request.text() }),
    }),
  );
}

async function createBackendMiniflare(
  persistDir: string | false,
  options: BackendMiniflareOptions,
): Promise<BackendRuntime> {
  const { createExecutionArtifactRuntimeService } =
    await import("flarex-backend/artifact-runtime");
  const { R2BackendExecutionArtifactStore } =
    await import("flarex-backend/artifact-store");
  let backend!: Miniflare;
  let executorRuntime: LocalPGliteExecutorHttpRuntime | undefined;
  const projectId = options.projectId ?? `local:${options.deploymentId}`;
  const executorToken = options.executorToken ?? "local-dev-executor";
  const liveQueryDeliveryToken =
    options.liveQueryDeliveryToken ?? "local-dev-live-query-delivery";
  if (options.executorTransport === "postgres") {
    executorRuntime = await createLocalPGliteExecutorHttpRuntime({
      projectId,
      capabilityToken: executorToken,
      backendUrl: "http://flarex.backend",
      triggerCapabilityToken: liveQueryDeliveryToken,
      triggerFetch: (input, init) => dispatchMiniflare(backend, new Request(input, init)),
      persistence: await createPGlitePersistence({
        ...(options.executorPersist === false
          ? {}
          : { dataDir: options.executorPersist }),
      }),
    });
  }
  const artifactRuntimeToken = "local-dev-artifact-runtime";
  const artifactInternalToken = "local-dev-artifact-internal";
  const materializer = new LocalMiniflareExecutionArtifactMaterializer({
    internalToken: artifactInternalToken,
    ...(executorRuntime === undefined
      ? {}
      : {
          executorTransport: "postgres" as const,
          projectId,
          executorToken,
        }),
    backend: request =>
      executorRuntime === undefined
        ? dispatchMiniflare(backend, request)
        : executorRuntime.fetch(request),
  });
  const artifactRuntime = createExecutionArtifactRuntimeService({
    capabilityToken: artifactRuntimeToken,
    materializer,
    store: {
      put: async sourcePackage =>
        new R2BackendExecutionArtifactStore(
          (await backend.getR2Bucket("ARTIFACTS")) as unknown as R2BucketLike,
        )
          .put(sourcePackage),
      get: async ref =>
        new R2BackendExecutionArtifactStore(
          (await backend.getR2Bucket("ARTIFACTS")) as unknown as R2BucketLike,
        )
          .get(ref),
    },
  });
  backend = new Miniflare({
    modules: [
      {
        type: "ESModule",
        path: "worker.js",
        contents: await bundleWorker(defaultBackendEntry()),
      },
    ],
    compatibilityDate,
    bindings: {
      FLAREX_ANALYZED_START_TOKEN: LOCAL_BACKEND_DEPLOY_PUSH_TOKEN,
      FLAREX_ARTIFACT_RUNTIME_TOKEN: artifactRuntimeToken,
      FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE: "true",
      ...(executorRuntime === undefined
        ? {}
        : {
            FLAREX_EXECUTOR_TOKEN: executorToken,
            FLAREX_PROJECT_ID: projectId,
            FLAREX_LIVE_QUERY_DELIVERY_TOKEN: liveQueryDeliveryToken,
          }),
    },
    r2Buckets: ["ARTIFACTS"],
    ...(persistDir === false ? {} : { r2Persist: persistDir }),
    durableObjectsPersist: persistDir,
    durableObjects: {
      REGISTRY: { className: "RegistryDO", useSQLite: true },
      DEPLOYMENTS: { className: "DeploymentDO", useSQLite: true },
      PARTITIONS: { className: "PartitionDO", useSQLite: true },
      EXECUTIONS: { className: "ExecutionDO", useSQLite: true },
      CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
      DELIVERIES: { className: "DeliveryDO", useSQLite: true },
      SCHEDULERS: { className: "SchedulerDO", useSQLite: true },
    },
    serviceBindings: {
      FLAREX_ANALYZER: createLocalAnalyzerService(),
      FLAREX_ARTIFACT_RUNTIME: artifactRuntime,
      ...(executorRuntime === undefined
        ? {}
        : { FLAREX_EXECUTOR: async (request: Request) => executorRuntime!.fetch(request) }),
    },
  });
  return {
    backend,
    ...(executorRuntime === undefined
      ? {}
      : {
          executorRuntime,
          projectId,
          executorToken,
          liveQueryDeliveryToken,
        }),
    disposeArtifactRuntime: () => artifactRuntime.dispose(),
  };
}

async function bundleWorker(entry: string): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    build: {
      write: false,
      target: "es2022",
      lib: { entry, formats: ["es"], fileName: "worker" },
      rollupOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : [],
  );
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (!worker || worker.type !== "chunk") {
    throw new Error(`Worker bundle was not emitted for ${entry}.`);
  }
  return worker.code;
}

function generatedWorkerEntry(options: FlarexGenerateOptions): string {
  return resolve(
    options.root,
    options.appDir ?? "flarex",
    options.generatedDir ?? "_generated",
    "worker.ts",
  );
}

function defaultBackendEntry(): string {
  return fileURLToPath(import.meta.resolve("flarex-backend/worker"));
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-workspace-package-resolution",
    resolveId(id) {
      if (id === "flarex" || id.startsWith("flarex/")) {
        return fileURLToPath(import.meta.resolve(id));
      }
      if (id === "flarex-backend" || id.startsWith("flarex-backend/")) {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
  };
}

function requestHeaders(request: Request): Array<[string, string]> {
  return Array.from(request.headers.entries());
}

async function toWebResponse(response: ResponseLike): Promise<Response> {
  const headers = new Headers();
  response.headers.forEach((value, key) => headers.set(key, value));
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function responseJson(response: ResponseLike): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await response.arrayBuffer()));
}
