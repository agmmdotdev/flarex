import { Miniflare } from "miniflare";
import { bundleApplicationWorker } from "./bundleApplicationWorker";
import { createExecutorApplicationSecretFixture, type executorApplicationProfileFixture } from "./executorApplicationConfiguration";

type ScenarioOptions = Readonly<{
  profile: ReturnType<typeof executorApplicationProfileFixture>;
  connectionString: string;
  privateToken: string;
  className: string;
  hostname: string;
  headers?: Readonly<Record<string, string>>;
  bindings?: Readonly<Record<string, string>>;
  closeHooks?: Readonly<{
    beforeClose?: () => Promise<void>;
    afterClose?: () => Promise<void>;
    afterDispose?: () => Promise<void>;
  }>;
}>;

type RequestOptions = Readonly<{
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  private?: boolean;
  /** Undefined explicitly removes a default header, including credentials. */
  headers?: Readonly<Record<string, string | undefined>>;
}>;

/** Suite-local build ownership: skipped suites do no build work, concurrent
 * scenarios share one attempt, and a failed build does not poison later setup. */
export function createMedusaDOTestSuite(entry: URL) {
  let worker: Promise<string> | undefined;
  const builtWorker = () => {
    worker ??= bundleApplicationWorker(entry).catch(cause => {
      worker = undefined;
      throw cause;
    });
    return worker;
  };
  return { createScenario: async (options: ScenarioOptions): Promise<MedusaDOTestScenario> => {
    const contents = await builtWorker();
    const keys = await createExecutorApplicationSecretFixture(options.profile.keyId);
    return createScenario(contents, keys, options);
  } };
}

/** Native Promise callbacks are the Miniflare/Vitest boundary. Each scenario
 * owns its runtime; database preparation and commerce assertions stay callers'. */
function createScenario(contents: string, keys: string, options: ScenarioOptions) {
  let runtime: Miniflare | undefined;
  let stopping: Promise<void> | undefined;
  const active = () => {
    if (runtime === undefined || stopping !== undefined) throw new Error("Medusa DO scenario is stopped or draining");
    return runtime;
  };
  const start = () => {
    if (runtime !== undefined || stopping !== undefined) throw new Error("Previous Medusa DO owner has not drained");
    runtime = new Miniflare({
      modules: [{ type: "ESModule", path: "worker.js", contents }],
      compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
      bindings: { ...options.bindings, FLAREX_EXECUTOR_TOKEN: options.privateToken,
        FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [options.profile] }), FLAREX_APPLICATION_KEYS: keys },
      hyperdrives: { HYPERDRIVE_CACHE_DISABLED: options.connectionString }, workerLoaders: { LOADER: {} }, r2Buckets: ["ARTIFACTS"],
      durableObjects: { APPLICATIONS: { className: options.className, useSQLite: true } },
    });
  };
  const request = (path: string, requestOptions: RequestOptions = {}) => {
    const headers = new Headers(options.headers);
    if (requestOptions.body !== undefined) headers.set("content-type", "application/json");
    if (requestOptions.private !== false) headers.set("authorization", `Bearer ${options.privateToken}`);
    for (const [name, value] of Object.entries(requestOptions.headers ?? {})) {
      if (value === undefined) headers.delete(name);
      else headers.set(name, value);
    }
    // A negative private-auth case cannot accidentally inherit an auth default.
    if (requestOptions.private === false) headers.delete("authorization");
    return active().dispatchFetch(`https://${options.hostname}${path}`, {
      method: requestOptions.method ?? "GET", headers: Object.fromEntries(headers),
      ...(requestOptions.body === undefined ? {} : { body: JSON.stringify(requestOptions.body) }),
      ...(requestOptions.signal === undefined ? {} : { signal: requestOptions.signal }),
    });
  };
  const stop = () => {
    if (stopping !== undefined) return stopping;
    const current = runtime;
    if (current === undefined) return Promise.resolve();
    runtime = undefined;
    let disposed = false;
    const drain = async () => {
      const failures: unknown[] = [];
      try { await options.closeHooks?.beforeClose?.(); } catch (cause) { failures.push(cause); }
      try {
        const response = await current.dispatchFetch(`https://${options.hostname}/__proof/close`, {
          headers: { authorization: `Bearer ${options.privateToken}` },
        });
        if (!response.ok) throw new Error(await response.text());
        await options.closeHooks?.afterClose?.();
      } catch (cause) { failures.push(cause); }
      try { await current.dispose(); disposed = true; } catch (cause) { failures.push(cause); }
      try { await options.closeHooks?.afterDispose?.(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError(failures, "Medusa DO scenario shutdown failed");
    };
    // Publish the draining owner before any hook can reenter stop/start. Retain
    // a rejected drain when disposal is uncertain so later stop cannot hide it.
    stopping = Promise.resolve().then(drain).finally(() => { if (disposed) stopping = undefined; });
    return stopping;
  };
  return { start, ready: async () => { await active().ready; }, request, stop,
    isRunning: () => runtime !== undefined || stopping !== undefined };
}

export type MedusaDOTestScenario = ReturnType<typeof createScenario>;
