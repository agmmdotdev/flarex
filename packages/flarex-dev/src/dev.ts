import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { build, type Plugin } from "vite";
import type { R2BucketLike } from "flarex-backend/artifact-store";
import {
  createLocalAnalyzerService,
  LocalBackendPushCoordinator,
  type DevPushStatus,
} from "./backendPush.ts";
import {
  bundleFlarexSourcePackage,
  finalCodegen,
  initialCodegen,
  type FlarexGenerateOptions,
} from "./generate.ts";
import { LocalMiniflareExecutionArtifactMaterializer } from "./runtimeMaterializer.ts";

export type FlarexDevRuntimeOptions = FlarexGenerateOptions & {
  deploymentId?: string;
  persistDir?: string | false;
};

export type FlarexDevRuntime = {
  deploymentId: string;
  reload: () => Promise<void>;
  fetch: (request: Request) => Promise<Response>;
  dispose: () => Promise<void>;
};

const compatibilityDate = "2026-06-14";

type ResponseLike = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  status: number;
  statusText: string;
  headers: { forEach: (callback: (value: string, key: string) => void) => void };
};

export async function createFlarexDevRuntime(
  options: FlarexDevRuntimeOptions,
): Promise<FlarexDevRuntime> {
  const deploymentId = options.deploymentId ?? "local-dev";
  const persistDir =
    options.persistDir === false ? false : resolve(options.root, options.persistDir ?? ".flarex/dev");
  const backendPersist = persistDir === false ? false : join(persistDir, "backend");
  const appPersist = persistDir === false ? false : join(persistDir, "app");
  if (backendPersist !== false) await mkdir(backendPersist, { recursive: true });
  if (appPersist !== false) await mkdir(appPersist, { recursive: true });

  const backend = await createBackendMiniflare(backendPersist);
  const pushCoordinator = new LocalBackendPushCoordinator(backend, deploymentId);
  let app: Miniflare | undefined;
  let lastPush: DevPushStatus | undefined;

  async function createApp(): Promise<Miniflare> {
    return new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: await bundleWorker(generatedWorkerEntry(options)),
        },
      ],
      compatibilityDate,
      bindings: { FLAREX_DEPLOYMENT_ID: deploymentId },
      serviceBindings: {
        FLAREX_BACKEND: async (request: Request) => dispatchMiniflare(backend, request),
      },
      durableObjectsPersist: appPersist,
      durableObjects: {
        CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
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
    lastPush = started;
    await finalCodegen(context, started.codegenAnalysis);
    const nextApp = await createApp();
    try {
      const finished = await pushCoordinator.finish(started.pushId);
      if (finished.state !== "activated") {
        throw new Error(`Flarex push ${started.pushId} did not activate: ${finished.state}`);
      }
      lastPush = finished;
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

  await reload();

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
                body: JSON.stringify(await devInvokeBody(request)),
              },
            ),
          );
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
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
      await app?.dispose();
      await backend.dispose();
      if (options.persistDir === undefined && persistDir !== false) {
        await rm(persistDir, { recursive: true, force: true });
      }
    },
  };
}

async function devInvokeBody(request: Request): Promise<Record<string, unknown>> {
  const parsed = await request.json();
  const body = isRecord(parsed) ? parsed : {};
  return {
    path: requiredString(body.path, "function path"),
    args: body.args ?? null,
    partitionKey:
      request.headers.get("x-flarex-partition") ??
      requiredString(body.partitionKey, "partition key"),
    ...(body.kind === undefined ? {} : { kind: requiredString(body.kind, "function kind") }),
    ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
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

async function createBackendMiniflare(persistDir: string | false): Promise<Miniflare> {
  const { createExecutionArtifactRuntimeService } =
    await import("flarex-backend/artifact-runtime");
  const { R2BackendExecutionArtifactStore } =
    await import("flarex-backend/artifact-store");
  let backend!: Miniflare;
  const artifactRuntimeToken = "local-dev-artifact-runtime";
  const artifactInternalToken = "local-dev-artifact-internal";
  const materializer = new LocalMiniflareExecutionArtifactMaterializer({
    internalToken: artifactInternalToken,
    backend: request => dispatchMiniflare(backend, request),
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
      FLAREX_ARTIFACT_RUNTIME_TOKEN: artifactRuntimeToken,
      FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE: "true",
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
      SCHEDULERS: { className: "SchedulerDO", useSQLite: true },
    },
    serviceBindings: {
      FLAREX_ANALYZER: createLocalAnalyzerService(),
      FLAREX_ARTIFACT_RUNTIME: createExecutionArtifactRuntimeService({
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
      }),
    },
  });
  return backend;
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
