import { Client, type QueryResultRow } from "pg";

interface AbsenceRow extends QueryResultRow {
  readonly role_count: number;
  readonly schema_count: number;
}

const ownerConnectionString = process.env[
  "RUNTIME_TOPOLOGY_PROBE_OWNER_DATABASE_URL"
];
const roleName = process.env.RUNTIME_TOPOLOGY_PROBE_DROPPED_ROLE;
if (
  ownerConnectionString === undefined || ownerConnectionString.length === 0 ||
  roleName === undefined || !/^rtp_p28_[0-9a-f]{10}$/.test(roleName)
) throw new Error("Owner URL and exact generated probe role are required.");

const client = new Client({ connectionString: ownerConnectionString });
try {
  await client.connect();
  const result = await client.query<AbsenceRow>(`
    SELECT
      (SELECT count(*)::int FROM pg_namespace WHERE nspname = $1) AS schema_count,
      (SELECT count(*)::int FROM pg_roles WHERE rolname = $2) AS role_count
  `, ["flarex_runtime_topology_probe_p28", roleName]);
  const row = result.rows[0];
  if (row === undefined || row.schema_count !== 0 || row.role_count !== 0) {
    throw new Error("The P28 schema or generated role still exists.");
  }
  process.stdout.write(`${JSON.stringify({
    kind: "postgres-probe-absence-proved",
    schemaCount: row.schema_count,
    roleCount: row.role_count,
  })}\n`);
} finally {
  await client.end().catch(() => undefined);
}
