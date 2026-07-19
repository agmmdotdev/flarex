import { Client, type QueryResultRow } from "pg";

interface CollisionRow extends QueryResultRow {
  readonly role_count: number;
  readonly schema_count: number;
}

const ownerConnectionString = process.env[
  "RUNTIME_TOPOLOGY_PROBE_OWNER_DATABASE_URL"
];
if (ownerConnectionString === undefined || ownerConnectionString.length === 0) {
  throw new Error("RUNTIME_TOPOLOGY_PROBE_OWNER_DATABASE_URL is required.");
}

const ownerUrl = new URL(ownerConnectionString);
if (
  (ownerUrl.protocol !== "postgresql:" && ownerUrl.protocol !== "postgres:") ||
  ownerUrl.pathname.slice(1).length === 0 ||
  ownerUrl.username.length === 0
) {
  throw new Error("The owner database URL is incomplete.");
}

const client = new Client({ connectionString: ownerConnectionString });
try {
  await client.connect();
  const result = await client.query<CollisionRow>(`
    SELECT
      (SELECT count(*)::int FROM pg_namespace
        WHERE nspname = 'flarex_runtime_topology_probe_p28') AS schema_count,
      (SELECT count(*)::int FROM pg_roles
        WHERE rolname LIKE 'rtp_p28_%') AS role_count
  `);
  const row = result.rows[0];
  if (row === undefined || row.schema_count !== 0 || row.role_count !== 0) {
    throw new Error("A prior probe schema or generated role still exists.");
  }
  process.stdout.write(`${JSON.stringify({
    kind: "postgres-probe-preflight",
    ownerHost: ownerUrl.hostname,
    database: ownerUrl.pathname.slice(1),
    schemaCount: row.schema_count,
    roleCount: row.role_count,
  })}\n`);
} finally {
  await client.end().catch(() => undefined);
}
