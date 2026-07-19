import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { Client } from "pg";
import {
  type ProbeState,
  writeProbeStateAtomically,
} from "./postgresProbeState";

const appRoot = new URL("../", import.meta.url);
const stateDirectory = new URL("../.probe-state/", import.meta.url);
const stateUrl = new URL("p28-postgres.json", stateDirectory);
const deployment = process.argv[2] ?? "postgres";
if (deployment !== "postgres" && deployment !== "session-postgres") {
  throw new Error("Expected postgres or session-postgres deployment target.");
}
const runtimeConfigUrl = new URL(
  deployment === "session-postgres"
    ? "../wrangler.session-postgres.runtime.jsonc"
    : "../wrangler.postgres.runtime.jsonc",
  import.meta.url,
);
const baseConfigUrl = new URL(
  deployment === "session-postgres"
    ? "../wrangler.session-postgres.jsonc"
    : "../wrangler.postgres.jsonc",
  import.meta.url,
);
const schemaName = "flarex_runtime_topology_probe_p28";
const hyperdriveName = `flarex-runtime-topology-probe-p28-${randomToken(5)}`;
const roleName = `rtp_p28_${randomToken(5)}`;
const rolePassword = randomBytes(24).toString("base64url");

const ownerConnectionString = process.env[
  "RUNTIME_TOPOLOGY_PROBE_OWNER_DATABASE_URL"
];
if (ownerConnectionString === undefined || ownerConnectionString.length === 0) {
  throw new Error(
    "RUNTIME_TOPOLOGY_PROBE_OWNER_DATABASE_URL is required for bootstrap only.",
  );
}

await assertStateAbsent();
const ownerUrl = new URL(ownerConnectionString);
if (ownerUrl.protocol !== "postgresql:" && ownerUrl.protocol !== "postgres:") {
  throw new Error("The owner database URL must use PostgreSQL.");
}
const directHost = ownerUrl.hostname.includes("-pooler.")
  ? ownerUrl.hostname.replace("-pooler.", ".")
  : ownerUrl.hostname;
const database = ownerUrl.pathname.slice(1);
if (database.length === 0 || ownerUrl.username.length === 0) {
  throw new Error("The owner database URL is incomplete.");
}

const owner = new Client({ connectionString: ownerConnectionString });
let createdHyperdriveId: string | undefined;
let hyperdriveCreateAttempted = false;
const baseState = {
  protocolVersion: 1,
  schemaName,
  roleName,
  rolePassword,
  directHost,
  database,
  port: Number(ownerUrl.port || "5432"),
  hyperdriveName,
  hyperdriveId: null,
  hyperdriveDeleted: false,
} as const;
await mkdir(stateDirectory, { recursive: true });
await writeState({ ...baseState, phase: "planned" });
try {
  await owner.connect();
  await owner.query("BEGIN");
  await owner.query(
    `CREATE ROLE ${identifier(roleName)} LOGIN PASSWORD ${literal(rolePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
  );
  await owner.query(`CREATE SCHEMA ${identifier(schemaName)}`);
  await owner.query(`
    CREATE TABLE ${identifier(schemaName)}.scope_cursors (
      scope_id text PRIMARY KEY,
      run_id text NOT NULL,
      cursor integer NOT NULL CHECK (cursor >= 0 AND cursor <= 1000000),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
  await owner.query(`
    CREATE TABLE ${identifier(schemaName)}.terminal_outcomes (
      attempt_id text PRIMARY KEY,
      scope_id text NOT NULL REFERENCES ${identifier(schemaName)}.scope_cursors(scope_id) ON DELETE CASCADE,
      commit_seq integer NOT NULL CHECK (commit_seq >= 1 AND commit_seq <= 1000000),
      request_json text COLLATE "C" NOT NULL,
      seal_digest text NOT NULL CHECK (seal_digest ~ '^[0-9a-f]{64}$'),
      result_digest text NOT NULL CHECK (result_digest ~ '^[0-9a-f]{64}$'),
      commit_intent_digest text NOT NULL CHECK (commit_intent_digest ~ '^[0-9a-f]{64}$'),
      committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (scope_id, commit_seq)
    )
  `);
  await owner.query(
    `GRANT USAGE ON SCHEMA ${identifier(schemaName)} TO ${identifier(roleName)}`,
  );
  await owner.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${identifier(schemaName)} TO ${identifier(roleName)}`,
  );
  await owner.query("COMMIT");
  await writeState({ ...baseState, phase: "database-ready" });

  const runtimeConfig = JSON.parse(
    await readFile(baseConfigUrl, "utf8"),
  ) as Record<string, unknown>;
  delete runtimeConfig.hyperdrive;
  await writeFile(
    runtimeConfigUrl,
    `${JSON.stringify(runtimeConfig, null, 2)}\n`,
    "utf8",
  );
  await writeState({ ...baseState, phase: "hyperdrive-create-attempted" });
  hyperdriveCreateAttempted = true;
  const createOutput = await runWrangler([
    "hyperdrive",
    "create",
    hyperdriveName,
    "--origin-host",
    directHost,
    "--origin-port",
    ownerUrl.port || "5432",
    "--database",
    database,
    "--origin-user",
    roleName,
    "--origin-password",
    rolePassword,
    "--sslmode",
    "require",
    "--caching-disabled",
    "--origin-connection-limit",
    "5",
    "--binding",
    "HYPERDRIVE_CACHE_DISABLED",
    "--update-config",
    "--config",
    filePath(runtimeConfigUrl),
  ]);

  const provisionedRuntimeConfig = JSON.parse(
    await readFile(runtimeConfigUrl, "utf8"),
  ) as { readonly hyperdrive?: ReadonlyArray<{ readonly id?: unknown }> };
  const configuredHyperdriveId = provisionedRuntimeConfig.hyperdrive?.[0]?.id;
  const outputHyperdriveId = createOutput.match(/\b[0-9a-f]{32}\b/i)?.[0];
  const hyperdriveId = typeof configuredHyperdriveId === "string"
    ? configuredHyperdriveId
    : outputHyperdriveId;
  if (typeof hyperdriveId !== "string" || !isHyperdriveId(hyperdriveId)) {
    throw new Error("Wrangler did not write a valid Hyperdrive ID.");
  }
  createdHyperdriveId = hyperdriveId;
  await writeState({
    ...baseState,
    phase: "ready",
    hyperdriveId,
  });
  process.stdout.write(`${JSON.stringify({
    kind: "postgres-probe-provisioned",
    schemaName,
    roleName,
    directHost,
    database,
    hyperdriveName,
    hyperdriveId,
    cachingDisabled: true,
    originConnectionLimit: 5,
  })}\n`);
} catch (cause) {
  let cleanupFailed = false;
  let recoverableHyperdriveId = createdHyperdriveId;
  if (recoverableHyperdriveId === undefined) {
    try {
      recoverableHyperdriveId = await findHyperdriveIdByName(hyperdriveName);
    } catch {
      cleanupFailed = true;
    }
  }
  if (recoverableHyperdriveId !== undefined) {
    await runWrangler(["hyperdrive", "delete", recoverableHyperdriveId])
      .catch(() => {
        cleanupFailed = true;
      });
    try {
      if (await findHyperdriveIdByName(hyperdriveName) !== undefined) {
        cleanupFailed = true;
      }
    } catch {
      cleanupFailed = true;
    }
  } else if (hyperdriveCreateAttempted) {
    cleanupFailed = true;
  }
  await owner.end().catch(() => undefined);
  const cleanupOwner = new Client({ connectionString: ownerConnectionString });
  try {
    await cleanupOwner.connect();
    await cleanupOwner.query(`DROP SCHEMA IF EXISTS ${identifier(schemaName)} CASCADE`);
    await cleanupOwner.query(`DROP ROLE IF EXISTS ${identifier(roleName)}`);
  } catch {
    cleanupFailed = true;
  } finally {
    await cleanupOwner.end().catch(() => undefined);
  }
  if (!cleanupFailed) {
    await Promise.all([
      rm(runtimeConfigUrl, { force: true }),
      rm(stateUrl, { force: true }),
    ]);
  }
  throw cause;
} finally {
  await owner.end().catch(() => undefined);
}

async function writeState(state: ProbeState): Promise<void> {
  await writeProbeStateAtomically(stateUrl, state);
}

async function assertStateAbsent(): Promise<void> {
  try {
    await readFile(stateUrl);
    throw new Error("P28 Postgres state already exists; teardown it first.");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("Unsafe generated PostgreSQL identifier.");
  }
  return `"${value}"`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function isHyperdriveId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}

function filePath(url: URL): string {
  return decodeURIComponent(url.pathname).replace(/^\/(?:([A-Za-z]:))/, "$1");
}

async function runWrangler(args: ReadonlyArray<string>): Promise<string> {
  const wranglerCli = createRequire(import.meta.url).resolve("wrangler");
  const child = spawn(process.execPath, [wranglerCli, ...args], {
    cwd: filePath(appRoot),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => {
    stdout += String(chunk);
  });
  child.stderr.on("data", chunk => {
    stderr += String(chunk);
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`Wrangler Hyperdrive creation failed: ${redact(stderr || stdout)}`);
  }
  return stdout;
}

async function findHyperdriveIdByName(name: string): Promise<string | undefined> {
  const output = await runWrangler(["hyperdrive", "list"]);
  for (const line of output.split(/\r?\n/u)) {
    if (!line.includes(name)) continue;
    const id = line.match(/\b[0-9a-f]{32}\b/iu)?.[0];
    if (id === undefined || !isHyperdriveId(id)) {
      throw new Error("Wrangler returned an invalid Hyperdrive list row.");
    }
    return id;
  }
  return undefined;
}

function redact(value: string): string {
  return value
    .replaceAll(rolePassword, "[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .slice(-2_000);
}
