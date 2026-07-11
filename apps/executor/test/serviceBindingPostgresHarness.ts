import { readFile } from "node:fs/promises";
import { env, pid } from "node:process";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { Pool } from "pg";

import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import {
  seedExecutorOccProof,
  type ExecutorOccProofFixture,
  type ExecutorOccProofResponse,
  type ExecutorOccProofTransport,
} from "./executorOccProof";

export const serviceBindingPostgresUrl = normalizePostgresUrl(
  env.FLAREX_POSTGRES_DATABASE_URL,
);

export const h04Fixture = {
  deploymentId: "deployment_h04_service_binding",
  projectId: "project_h04_service_binding",
  markerText: "h04",
} satisfies ExecutorOccProofFixture;

const callerWorkerName = "flarex-h04-caller";
const executorWorkerName = "flarex-executor";
const executorToken = "flarex-h04-executor-secret";
const serviceBindingHopHeader = "x-flarex-h04-hop";
export const h04ServiceBindingHop = {
  header: serviceBindingHopHeader,
  value: "caller-to-executor",
} as const;

export interface ServiceBindingPostgresRuntime extends ExecutorOccProofTransport {
  readonly callerBindingKeys: readonly string[];
  readonly executorBindingKeys: readonly string[];
  executorDirectUrl(): Promise<URL>;
  request(
    path: string,
    body: unknown,
    options?: { readonly authorized?: boolean },
  ): Promise<ExecutorOccProofResponse>;
}

export async function withTemporaryServiceBindingPostgres<RuntimeEvidence>(
  run: (runtime: ServiceBindingPostgresRuntime) => Promise<RuntimeEvidence>,
  verify: (
    persistence: PostgresFlarexPersistence,
    evidence: RuntimeEvidence,
  ) => Promise<void>,
): Promise<void> {
  const adminConnectionString = requiredPostgresUrl();
  const databaseName = temporaryDatabaseName();
  const databaseConnectionString = isolatedDatabaseUrl(
    adminConnectionString,
    databaseName,
  );
  let databaseCreated = false;
  let adminPool: Pool | undefined;
  let setupPersistence: PostgresFlarexPersistence | undefined;
  let assertionPersistence: PostgresFlarexPersistence | undefined;
  let miniflare: Miniflare | undefined;
  let primaryFailed = false;
  let primaryError: unknown;

  try {
    adminPool = new Pool({ connectionString: adminConnectionString });
    await adminPool.query(`create database ${quoteIdentifier(databaseName)}`);
    databaseCreated = true;
    await adminPool.end();
    adminPool = undefined;

    setupPersistence = await createPostgresPersistence({
      connectionString: databaseConnectionString,
      migrationsSchema: "flarex_migrations",
    });
    await setupPersistence.migrate();
    await seedExecutorOccProof(setupPersistence, h04Fixture);
    await setupPersistence.close();
    setupPersistence = undefined;

    miniflare = await createServiceBindingMiniflare(databaseConnectionString);
    const runtime = await serviceBindingRuntime(miniflare);
    const evidence = await run(runtime);

    adminPool = new Pool({ connectionString: adminConnectionString });
    await waitForNoDatabaseClients(adminPool, databaseName);
    await adminPool.end();
    adminPool = undefined;

    await miniflare.dispose();
    miniflare = undefined;

    assertionPersistence = await createPostgresPersistence({
      connectionString: databaseConnectionString,
      migrationsSchema: "flarex_migrations",
    });
    await verify(assertionPersistence, evidence);
    await assertionPersistence.close();
    assertionPersistence = undefined;

    adminPool = new Pool({ connectionString: adminConnectionString });
    await waitForNoDatabaseClients(adminPool, databaseName);
    await adminPool.query(`drop database ${quoteIdentifier(databaseName)}`);
    databaseCreated = false;
    await adminPool.end();
    adminPool = undefined;
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    if (miniflare !== undefined) {
      await recordCleanupError(cleanupErrors, () => miniflare?.dispose());
    }
    if (setupPersistence !== undefined) {
      await recordCleanupError(cleanupErrors, () => setupPersistence?.close());
    }
    if (assertionPersistence !== undefined) {
      await recordCleanupError(cleanupErrors, () => assertionPersistence?.close());
    }
    if (adminPool !== undefined) {
      await recordCleanupError(cleanupErrors, () => adminPool?.end());
    }
    if (databaseCreated) {
      await forceDropDatabase(
        cleanupErrors,
        adminConnectionString,
        databaseName,
      );
    }
    if (cleanupErrors.length > 0) {
      const cleanupSummary = cleanupErrors.map(errorMessage).join("; ");
      if (primaryFailed) {
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          `H04 PostgreSQL proof failed and cleanup also failed: ${cleanupSummary}`,
        );
      }
      throw new AggregateError(
        cleanupErrors,
        `Failed to clean up H04 PostgreSQL fixture: ${cleanupSummary}`,
      );
    }
  }
}

async function createServiceBindingMiniflare(
  databaseConnectionString: string,
): Promise<Miniflare> {
  const executorSource = await readFile(
    new URL("../dist/worker.js", import.meta.url),
    "utf8",
  );
  const options = {
    workers: [
      {
        name: callerWorkerName,
        modules: [
          {
            type: "ESModule",
            path: "caller.js",
            contents: callerWorkerSource,
          },
        ],
        compatibilityDate: "2026-06-14",
        serviceBindings: {
          FLAREX_EXECUTOR: executorWorkerName,
        },
      },
      {
        name: executorWorkerName,
        modules: [
          {
            type: "ESModule",
            path: "worker.js",
            contents: executorSource,
          },
        ],
        compatibilityDate: "2026-06-14",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          FLAREX_EXECUTOR_TOKEN: executorToken,
        },
        hyperdrives: {
          HYPERDRIVE_CACHE_DISABLED: databaseConnectionString,
        },
      },
    ],
  } satisfies MiniflareOptions;
  return new Miniflare(options);
}

async function serviceBindingRuntime(
  miniflare: Miniflare,
): Promise<ServiceBindingPostgresRuntime> {
  const callerBindings = await miniflare.getBindings<Record<string, unknown>>(
    callerWorkerName,
  );
  const executorBindings = await miniflare.getBindings<Record<string, unknown>>(
    executorWorkerName,
  );
  return {
    hop: h04ServiceBindingHop,
    callerBindingKeys: Object.keys(callerBindings).sort(),
    executorBindingKeys: Object.keys(executorBindings).sort(),
    executorDirectUrl: () => miniflare.unsafeGetDirectURL(executorWorkerName),
    request: async (path, body, options = {}) => {
      const headers =
        options.authorized === false
          ? { "content-type": "application/json" }
          : {
              "content-type": "application/json",
              authorization: `Bearer ${executorToken}`,
            };
      const response = await miniflare.dispatchFetch(
        `https://flarex-h04.test${path}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
      );
      return response;
    },
  } satisfies ServiceBindingPostgresRuntime;
}

const callerWorkerSource = `
export default {
  async fetch(request, env) {
    try {
      const response = await env.FLAREX_EXECUTOR.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("${serviceBindingHopHeader}", "caller-to-executor");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      return Response.json(
        {
          error: "probe_service_binding_error",
          message: String(error && error.stack ? error.stack : error),
        },
        {
          status: 502,
          headers: { "${serviceBindingHopHeader}": "caller-to-executor" },
        },
      );
    }
  },
};
`;

function requiredPostgresUrl(): string {
  if (serviceBindingPostgresUrl === null) {
    throw new Error("FLAREX_POSTGRES_DATABASE_URL is required.");
  }
  return serviceBindingPostgresUrl;
}

function normalizePostgresUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function temporaryDatabaseName(): string {
  return `flarex_h04_${pid}_${Date.now()}_${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 8)}`;
}

function isolatedDatabaseUrl(
  connectionString: string,
  databaseName: string,
): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  if (url.password.length === 0) {
    url.password = "flarex-h04-local-password";
  }
  if (!url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", "disable");
  }
  return url.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function waitForNoDatabaseClients(
  pool: Pool,
  databaseName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<{ connections: number }>(
      `select count(*)::int as connections
       from pg_stat_activity
       where datname = $1 and backend_type = 'client backend'`,
      [databaseName],
    );
    if (result.rows[0]?.connections === 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Executor Worker retained a PostgreSQL client for database ${databaseName}.`,
  );
}

async function forceDropDatabase(
  errors: unknown[],
  connectionString: string,
  databaseName: string,
): Promise<void> {
  const pool = new Pool({ connectionString });
  await recordCleanupError(errors, () =>
    pool.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`),
  );
  await recordCleanupError(errors, () => pool.end());
}

async function recordCleanupError(
  errors: unknown[],
  cleanup: () => Promise<unknown> | undefined,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    errors.push(error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
