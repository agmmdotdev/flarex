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

interface ScopeOutcomeRow extends QueryResultRow {
  readonly cursor: number;
  readonly outcome_count: number;
  readonly run_id: string;
}

const state = JSON.parse(await readFile(
  new URL("../.probe-state/p28-postgres.json", import.meta.url),
  "utf8",
)) as ProbeState;
if (
  state.protocolVersion !== 1 ||
  !/^[a-z][a-z0-9_]{0,62}$/.test(state.schemaName) ||
  !/^[a-z][a-z0-9_]{0,62}$/.test(state.roleName)
) throw new Error("Invalid Postgres probe state.");

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
  const result = await client.query<ScopeOutcomeRow>(`
    SELECT cursors.run_id,
           cursors.cursor,
           count(outcomes.attempt_id)::int AS outcome_count
    FROM "${state.schemaName}".scope_cursors AS cursors
    LEFT JOIN "${state.schemaName}".terminal_outcomes AS outcomes
      ON outcomes.scope_id = cursors.scope_id
    GROUP BY cursors.scope_id, cursors.run_id, cursors.cursor
    ORDER BY cursors.run_id
  `);
  process.stdout.write(`${JSON.stringify({
    kind: "session-postgres-outcomes",
    scopes: result.rows.map(row => ({
      runId: row.run_id,
      cursor: row.cursor,
      outcomeCount: row.outcome_count,
    })),
  })}\n`);
} finally {
  await client.end().catch(() => undefined);
}
