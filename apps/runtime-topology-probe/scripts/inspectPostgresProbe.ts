import { readFile } from "node:fs/promises";

import { Client, type QueryResultRow } from "pg";

interface ProbeState {
  readonly protocolVersion: 1;
  readonly schemaName: string;
  readonly roleName: string;
  readonly rolePassword: string;
  readonly directHost: string;
  readonly database: string;
  readonly port: number;
}

interface CountRow extends QueryResultRow {
  readonly scope_count: number;
  readonly outcome_count: number;
  readonly maximum_cursor: number | null;
}

const stateUrl = new URL("../.probe-state/p28-postgres.json", import.meta.url);
const state = JSON.parse(await readFile(stateUrl, "utf8")) as ProbeState;
if (
  state.protocolVersion !== 1 ||
  !/^[a-z][a-z0-9_]{0,62}$/.test(state.schemaName) ||
  !/^[a-z][a-z0-9_]{0,62}$/.test(state.roleName)
) throw new Error("Invalid P28 Postgres state.");

const client = new Client({
  host: state.directHost,
  port: state.port,
  database: state.database,
  user: state.roleName,
  password: state.rolePassword,
  ssl: { rejectUnauthorized: true },
});
try {
  await client.connect();
  const result = await client.query<CountRow>(`
    SELECT
      (SELECT count(*)::int FROM "${state.schemaName}".scope_cursors) AS scope_count,
      (SELECT count(*)::int FROM "${state.schemaName}".terminal_outcomes) AS outcome_count,
      (SELECT max(cursor)::int FROM "${state.schemaName}".scope_cursors) AS maximum_cursor
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing P28 inspection row.");
  process.stdout.write(`${JSON.stringify({
    kind: "postgres-probe-inspection",
    scopeCount: row.scope_count,
    outcomeCount: row.outcome_count,
    maximumCursor: row.maximum_cursor,
  })}\n`);
} finally {
  await client.end().catch(() => undefined);
}
