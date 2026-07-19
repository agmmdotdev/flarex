import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";

import { Client } from "pg";
import {
  decodeProbeState,
  hyperdriveAbsenceLookupAttempts,
  isPostgresIdentifier,
  type ProbeState,
  writeProbeStateAtomically,
} from "./postgresProbeState";

const appRoot = new URL("../", import.meta.url);
const stateUrl = new URL("../.probe-state/p28-postgres.json", import.meta.url);
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
const ownerConnectionString = process.env[
  "RUNTIME_TOPOLOGY_PROBE_OWNER_DATABASE_URL"
];
if (ownerConnectionString === undefined || ownerConnectionString.length === 0) {
  throw new Error(
    "RUNTIME_TOPOLOGY_PROBE_OWNER_DATABASE_URL is required for cleanup only.",
  );
}

const state = decodeProbeState(JSON.parse(await readFile(stateUrl, "utf8")));
const resolvedHyperdriveId = state.hyperdriveId ??
  await readRuntimeConfigHyperdriveId() ??
  await findHyperdriveIdWithAbsenceProof(state);
if (resolvedHyperdriveId !== null && !state.hyperdriveDeleted) {
  await deleteHyperdriveIfPresent(resolvedHyperdriveId);
  await writeState({
    ...state,
    hyperdriveId: resolvedHyperdriveId,
    hyperdriveDeleted: true,
  });
}

const owner = new Client({ connectionString: ownerConnectionString });
try {
  await owner.connect();
  await owner.query("BEGIN");
  await owner.query(`DROP SCHEMA IF EXISTS ${identifier(state.schemaName)} CASCADE`);
  await owner.query(`DROP ROLE IF EXISTS ${identifier(state.roleName)}`);
  await owner.query("COMMIT");
} catch (cause) {
  await owner.query("ROLLBACK").catch(() => undefined);
  throw cause;
} finally {
  await owner.end().catch(() => undefined);
}

await Promise.all([
  rm(stateUrl, { force: true }),
  rm(runtimeConfigUrl, { force: true }),
]);
process.stdout.write(`${JSON.stringify({
  kind: "postgres-probe-removed",
  schemaName: state.schemaName,
  roleName: state.roleName,
  hyperdriveName: state.hyperdriveName,
  hyperdriveId: state.hyperdriveId,
})}\n`);

function identifier(value: string): string {
  if (!isPostgresIdentifier(value)) {
    throw new Error("Unsafe stored PostgreSQL identifier.");
  }
  return `"${value}"`;
}

async function writeState(state: ProbeState): Promise<void> {
  await writeProbeStateAtomically(stateUrl, state);
}

async function deleteHyperdriveIfPresent(hyperdriveId: string): Promise<void> {
  try {
    await runWrangler(["hyperdrive", "delete", hyperdriveId]);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!/(?:does not exist|not found|10007)/i.test(message)) throw cause;
  }
}

async function findHyperdriveIdByName(name: string): Promise<string | null> {
  const output = await runWrangler(["hyperdrive", "list"]);
  for (const line of output.split(/\r?\n/u)) {
    if (!line.includes(name)) continue;
    const id = line.match(/\b[0-9a-f]{32}\b/iu)?.[0];
    if (id === undefined) {
      throw new Error("Wrangler returned an invalid Hyperdrive list row.");
    }
    return id;
  }
  return null;
}

async function findHyperdriveIdWithAbsenceProof(
  state: ProbeState,
): Promise<string | null> {
  const attempts = hyperdriveAbsenceLookupAttempts(state.phase);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const id = await findHyperdriveIdByName(state.hyperdriveName);
    if (id !== null) return id;
    if (attempt + 1 < attempts) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }
  return null;
}

async function readRuntimeConfigHyperdriveId(): Promise<string | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(runtimeConfigUrl, "utf8"));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid generated Postgres Worker configuration.");
  }
  const hyperdrive = (value as { readonly hyperdrive?: unknown }).hyperdrive;
  if (!Array.isArray(hyperdrive) || hyperdrive.length === 0) return null;
  const first = hyperdrive[0];
  const id = typeof first === "object" && first !== null && !Array.isArray(first)
    ? (first as { readonly id?: unknown }).id
    : undefined;
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/i.test(id)) {
    throw new Error("Invalid generated Hyperdrive ID.");
  }
  return id;
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
  let output = "";
  child.stdout.on("data", chunk => {
    output += String(chunk);
  });
  child.stderr.on("data", chunk => {
    output += String(chunk);
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`Wrangler Hyperdrive deletion failed: ${output.slice(-2_000)}`);
  }
  return output;
}
