import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { fxSystemTransactionSessions } from "../src/schema";
import type { PointMutationSessionAnchorV1 } from "../src/transactionSessionActivation";
import { insertSessionTestScope, insertTransactionSessionFixture,
  transactionSessionFixture, transactionSessionIdAt } from "./sessionAuthorityTestSupport";
import { injectMigrationFailure, restoreMigrationFile, writeJournalThrough,
  type DrizzleCopyFixture } from "./migrationFixtureSupport";

type Session = typeof fxSystemTransactionSessions.$inferSelect;
type Sql = Pick<FlarexPersistence, "query" | "exec">;
const BODY_COLUMNS = [
  "validated_args_json", "validated_args_canonical_bytes",
  "authorization_grant_json", "authorization_grant_canonical_bytes",
  "application_execution_authority_json", "application_execution_authority_canonical_bytes",
] as const;
const CLEAR_BODIES = BODY_COLUMNS.map(column => `${column} = null`).join(", ");
const RETAINED = BODY_COLUMNS.map(column => ` - '${column}'`).join("");
const TERMINAL = ["committed", "aborted", "expired"] as const;

export async function captureSessionStorage(
  persistence: { readonly drizzle: FlarexMetadataDatabase },
  anchor: Pick<PointMutationSessionAnchorV1, "scopeId" | "sessionId">,
): Promise<Session> {
  const rows = await persistence.drizzle.select().from(fxSystemTransactionSessions).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, projectScopeIdUuidV1(anchor.scopeId).scopeUuid),
    eq(fxSystemTransactionSessions.sessionId, anchor.sessionId),
  ));
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (row === undefined) throw new Error("Missing retained session.");
  return row;
}

export function expectSessionPayloadScrubbed(before: Session, after: Session): void {
  expect(before.validatedArgsCanonicalBytes?.byteLength).toBeGreaterThan(0);
  expect(before.authorizationGrantCanonicalBytes?.byteLength).toBeGreaterThan(0);
  if (before.executionAuthorityGeneration === "application_v1") {
    expect(before.applicationExecutionAuthorityJson).not.toBeNull();
    expect(before.applicationExecutionAuthorityCanonicalBytes?.byteLength).toBeGreaterThan(0);
  }
  expect(TERMINAL).toContain(after.lifecycle);
  expect(after).toEqual({
    ...before, lifecycle: after.lifecycle, updatedAt: after.updatedAt,
    validatedArgsJson: null, validatedArgsCanonicalBytes: null,
    authorizationGrantJson: null, authorizationGrantCanonicalBytes: null,
    applicationExecutionAuthorityJson: null, applicationExecutionAuthorityCanonicalBytes: null,
  });
}

async function insertGenerationFixture(persistence: Sql, sequence: number, application: boolean) {
  const fixture = transactionSessionFixture(transactionSessionIdAt(sequence));
  await insertTransactionSessionFixture(persistence, fixture);
  if (application) {
    // Deliberate SQL-shape fixture; execution tests use admitted canonical authority.
    await persistence.query(`update fx_system_tx_session set
      execution_authority_generation = 'application_v1', package_id = null,
      artifact_runtime = null, artifact_id = null, source_package_hash = null,
      execution_module = null, application_execution_authority_json = '{"format":"application"}',
      application_execution_authority_canonical_bytes = decode('0123','hex'),
      application_execution_authority_sha256 = decode(repeat('67',32),'hex')
      where session_id = $1`, [fixture.sessionId]);
  }
  return fixture;
}

export async function verifyTerminalSessionSchema(persistence: Sql): Promise<void> {
  await insertSessionTestScope(persistence);
  let sequence = 9400;
  for (const application of [false, true]) {
    for (const lifecycle of ["created", "running", "finishing", "committing", "retrying", ...TERMINAL]) {
      const fixture = await insertGenerationFixture(persistence, sequence++, application);
      const terminal = lifecycle === "committed" || lifecycle === "aborted" || lifecycle === "expired";
      await persistence.query(`update fx_system_tx_session set lifecycle = $2
        ${terminal ? `, ${CLEAR_BODIES}` : ""} where session_id = $1`, [fixture.sessionId, lifecycle]);
      const read = () => persistence.query("select to_jsonb(s)::text as session from fx_system_tx_session s where session_id = $1", [fixture.sessionId]);
      const original = await read();
      const bodies = application || terminal ? BODY_COLUMNS : BODY_COLUMNS.slice(0, 4);
      for (const column of bodies) {
        const invalid = terminal
          ? column.endsWith("_json") ? "'{}'::jsonb" : "decode('01','hex')"
          : "null";
        await expect(persistence.query(`update fx_system_tx_session set ${column} = ${invalid} where session_id = $1`, [fixture.sessionId])).rejects.toThrow(/check constraint/);
        expect((await read()).rows).toEqual(original.rows);
      }
      for (const assignment of [
        "validated_args_value_codec_version = 2",
        "authorization_grant_sha256 = decode('01','hex')",
        ...(application ? ["application_execution_authority_sha256 = null", "package_id = 'forbidden'"] : ["application_execution_authority_sha256 = decode(repeat('67',32),'hex')"]),
        ...(!terminal ? ["validated_args_json = 'null'::jsonb", "authorization_grant_json = '[]'::jsonb", "validated_args_canonical_bytes = decode('','hex')"] : []),
      ]) {
        await expect(persistence.query(`update fx_system_tx_session set ${assignment} where session_id = $1`, [fixture.sessionId])).rejects.toThrow(/check constraint/);
        expect((await read()).rows).toEqual(original.rows);
      }
    }
  }
}

export async function verifyTerminalSessionMigration(
  persistence: Sql & Pick<FlarexPersistence, "migrate">,
  fixture: DrizzleCopyFixture, migrationsSchema: string,
): Promise<void> {
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 93);
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  let sequence = 9500;
  for (const application of [false, true]) {
    for (const lifecycle of ["running", "finishing", ...TERMINAL]) {
      const session = await insertGenerationFixture(persistence, sequence++, application);
      await persistence.query(`update fx_system_tx_session set lifecycle = $2,
        updated_at = '2030-01-01T00:00:00.123456Z', attempt_fence = 9223372036854775807
        where session_id = $1`, [session.sessionId, lifecycle]);
    }
  }
  const whole = "select to_jsonb(s)::text as session from fx_system_tx_session s order by session_id";
  const retained = `select (to_jsonb(s) ${RETAINED})::text as session from fx_system_tx_session s order by session_id`;
  const active = "select to_jsonb(s)::text as session from fx_system_tx_session s where lifecycle in ('running','finishing') order by session_id";
  const before = await persistence.query(whole);
  const expectedRetained = await persistence.query(retained);
  const expectedActive = await persistence.query(active);
  const receipts = `"${migrationsSchema.replaceAll('"', '""')}".__drizzle_migrations`;
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 94);
  await injectMigrationFailure(fixture.migrationPath, "fx_terminal_payload_deliberate_missing_table");
  await expect(persistence.migrate()).rejects.toThrow(/fx_terminal_payload_deliberate_missing_table/);
  expect((await persistence.query(whole)).rows).toEqual(before.rows);
  expect((await persistence.query(`select count(*)::int as count from ${receipts}`)).rows).toEqual([{ count: 94 }]);
  await restoreMigrationFile(fixture.migrationPath, fixture.currentMigrationsFolder);
  await persistence.migrate();
  await persistence.migrate();
  expect((await persistence.query(retained)).rows).toEqual(expectedRetained.rows);
  expect((await persistence.query(active)).rows).toEqual(expectedActive.rows);
  expect((await persistence.query(`select count(*)::int as count from fx_system_tx_session
    where lifecycle in ('committed','aborted','expired') and ${BODY_COLUMNS.map(column => `${column} is null`).join(" and ")}`)).rows).toEqual([{ count: 6 }]);
  expect((await persistence.query(`select count(*)::int as count from ${receipts}`)).rows).toEqual([{ count: 95 }]);
}
