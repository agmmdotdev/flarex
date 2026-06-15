import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { build } from "vite";
import { generateFlarex, type FlarexGenerateOptions } from "./generate.ts";

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

type MetadataResponse = {
  schema: unknown;
  functions: unknown[];
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
  let app: Miniflare | undefined;

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
        FLAREX_BACKEND: async (request: Request) =>
          backend.dispatchFetch(request.url, {
            method: request.method,
            headers: Array.from(request.headers.entries()),
            body: await request.text(),
          }),
      },
      durableObjectsPersist: appPersist,
      durableObjects: {
        CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
      },
    });
  }

  async function deployMetadata(appRuntime: Miniflare): Promise<void> {
    const metadataResponse = await appRuntime.dispatchFetch(
      "http://flarex.local/__flarex_internal/metadata",
    );
    if (!metadataResponse.ok) {
      throw new Error(
        `Generated Worker metadata failed with status ${metadataResponse.status}`,
      );
    }
    const metadata = (await metadataResponse.json()) as MetadataResponse;
    await putBackend(backend, `/deployments/${deploymentId}/schema`, metadata.schema);
    await putBackend(backend, `/deployments/${deploymentId}/functions`, {
      functions: metadata.functions,
    });
  }

  let reloadChain = Promise.resolve();
  async function reloadNow(): Promise<void> {
    await generateFlarex(options);
    const nextApp = await createApp();
    await deployMetadata(nextApp);
    const previousApp = app;
    app = nextApp;
    await previousApp?.dispose();
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
          backend: await backendHealth.json().catch(() => null),
          app: await appHealth.json().catch(() => null),
        });
      }

      const forwardedPath = url.pathname.replace(/^\/__flarex_dev/, "") || "/";
      const forwardedUrl = new URL(request.url);
      forwardedUrl.pathname = forwardedPath;
      return toWebResponse(
        await activeApp.dispatchFetch(forwardedUrl.toString(), {
          method: request.method,
          headers: Array.from(request.headers.entries()),
          body: await request.text(),
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

async function createBackendMiniflare(persistDir: string | false): Promise<Miniflare> {
  return new Miniflare({
    modules: [
      {
        type: "ESModule",
        path: "worker.js",
        contents: await bundleWorker(defaultBackendEntry()),
      },
    ],
    compatibilityDate,
    durableObjectsPersist: persistDir,
    durableObjects: {
      REGISTRY: { className: "RegistryDO", useSQLite: true },
      DEPLOYMENTS: { className: "DeploymentDO", useSQLite: true },
      PARTITIONS: { className: "PartitionDO", useSQLite: true },
      EXECUTIONS: { className: "ExecutionDO", useSQLite: true },
      CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
      SCHEDULERS: { className: "SchedulerDO", useSQLite: true },
    },
  });
}

async function putBackend(backend: Miniflare, path: string, body: unknown): Promise<void> {
  const response = await backend.dispatchFetch(`http://flarex.backend${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend deploy ${path} failed with status ${response.status}: ${text}`);
  }
}

async function bundleWorker(entry: string): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: "silent",
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

async function toWebResponse(response: ResponseLike): Promise<Response> {
  const headers = new Headers();
  response.headers.forEach((value, key) => headers.set(key, value));
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
