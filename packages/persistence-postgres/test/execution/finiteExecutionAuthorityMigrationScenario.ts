import { expect } from "vitest";
import { sql } from "drizzle-orm";
import type { FlarexSqlClient } from "../../src";
import { scopeExecutionAuthorityInstallationSql } from "../../src/installation/scopeExecutionAuthorityInstallation";
import { writeJournalThrough, type DrizzleCopyFixture } from "../support/migrationFixtureSupport";
import {
  insertLegacySessionTestScope,
  insertSnapshotLeaseFixture,
  insertTransactionSessionFixture,
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
  transactionSessionFixture,
  transactionSessionIdAt,
} from "./session/support/sessionStorage";

/** Historical SQL deliberately targets the installed predecessor layout. */
export async function finiteExecutionAuthorityMigrationScenario(
  persistence: Pick<FlarexSqlClient, "query" | "execute">,
  fixture: DrizzleCopyFixture,
  migrate: () => Promise<void>,
  migrateCurrent: () => Promise<void>,
): Promise<void> {
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 125);
  await migrate();
  // Historical installation fixture, independent of current catalog issuance.
  await persistence.query("update fx_system_installation set state = 'active' where singleton_id = 1");
  await insertLegacySessionTestScope(persistence);
  await persistence.query(`update fx_system_scope_clock set storage_generation_fence = 7,
    last_commit_seq = 19, oldest_available_commit_seq = 3, authorization_revocation_epoch = 23,
    updated_at = '2030-01-01T00:00:00Z' where scope_uuid = $1`, [SESSION_TEST_SCOPE_UUID]);
  const finiteSessionId = transactionSessionIdAt(126);
  const directSessionId = transactionSessionIdAt(127);
  for (const sessionId of [finiteSessionId, directSessionId]) {
    await insertTransactionSessionFixture(persistence, transactionSessionFixture(sessionId, {
      lifecycle: "running", storageGenerationFence: "7", authorizationRevocationEpoch: "23",
    }));
    await insertSnapshotLeaseFixture(persistence, { scopeUuid: SESSION_TEST_SCOPE_UUID, sessionId,
      attemptFence: "1", snapshotEpochUuid: SESSION_TEST_EPOCH_UUID, snapshotCommitSeq: "19",
      leaseExpiresAt: "2030-01-02T00:00:00Z" });
    await persistence.query(`insert into fx_system_tx_journal
      (scope_uuid, session_id, attempt_fence, journal_format, execution_profile, state,
       creation_time_seed, next_creation_time, created_at, updated_at)
      values ($1, $2, 1, 'flarex.session-journal', $3, 'open', 1893456000000, 1893456000000,
        '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z')`,
    [SESSION_TEST_SCOPE_UUID, sessionId, sessionId === finiteSessionId ? "finiteRoot" : "durableOperations"]);
  }
  await persistence.query(`insert into fx_system_scope_clock
    (scope_id, storage_generation, storage_generation_fence, last_commit_seq,
     oldest_available_commit_seq, authorization_revocation_epoch, epoch)
    values ('scope_61000000-0000-0000-0000-000000000009', 'legacy_v1', 4, 11, 2, 9,
      'epoch_61000000-0000-0000-0000-000000000010')`);
  const inventory = () => persistence.query<{
    session: Record<string, unknown>; journal: Record<string, unknown>; lease: Record<string, unknown>;
  }>(`select to_jsonb(s) as session,
    to_jsonb(j) as journal, to_jsonb(l) as lease from fx_system_tx_session s
    join fx_system_tx_journal j using(scope_uuid, session_id, attempt_fence)
    join fx_system_snapshot_lease l using(scope_uuid, session_id, attempt_fence)
    order by s.session_id`);
  const before = await inventory();
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 126);
  await expect(migrate()).rejects.toThrow();
  expect(await inventory()).toEqual(before);
  expect((await persistence.query(`select to_regclass('fx_system_scope_execution_authority')::text as relation`)).rows)
    .toEqual([{ relation: null }]);
  // Valid historical terminal disposition fixture; never assign old finite work
  // a watermark or erase its journal to make the cutover pass.
  await persistence.query(`update fx_system_tx_session set lifecycle = 'aborted',
    validated_args_json = null, validated_args_canonical_bytes = null,
    authorization_grant_json = null, authorization_grant_canonical_bytes = null
    where session_id = $1`, [finiteSessionId]);
  const drained = await inventory();
  await migrate();
  await migrate();
  const after = await inventory();
  expect(after.rows).toEqual(drained.rows.map(row => ({ ...row,
    lease: { ...row.lease, metadata_watermark: null,
      finite_metadata_reservation_bytes: null, finite_metadata_reservation_sha256: null } })));
  expect((await persistence.query(`select c.scope_uuid::text, a.storage_generation,
    a.storage_generation_fence::text, c.last_commit_seq::text,
    a.oldest_available_commit_seq::text, a.authorization_revocation_epoch::text,
    a.epoch_uuid::text, c.last_metadata_sequence::text,
    (c.updated_at = a.updated_at) as same_timestamp
    from fx_system_scope_clock c join fx_system_scope_execution_authority a using(scope_id)
    order by c.scope_id`)).rows).toEqual([
    { scope_uuid: SESSION_TEST_SCOPE_UUID, storage_generation: "flarexdb_v1", storage_generation_fence: "7",
      last_commit_seq: "19", oldest_available_commit_seq: "3", authorization_revocation_epoch: "23",
      epoch_uuid: SESSION_TEST_EPOCH_UUID, last_metadata_sequence: "0", same_timestamp: true },
    { scope_uuid: "61000000-0000-0000-0000-000000000009", storage_generation: "legacy_v1",
      storage_generation_fence: "4", last_commit_seq: "11", oldest_available_commit_seq: "2",
      authorization_revocation_epoch: "9", epoch_uuid: "61000000-0000-0000-0000-000000000010",
      last_metadata_sequence: "0", same_timestamp: true },
  ]);
  await expect(persistence.query(`update fx_system_scope_execution_authority
    set oldest_available_commit_seq = 20 where scope_id = $1`, [`scope_${SESSION_TEST_SCOPE_UUID}`])).rejects.toThrow();
  await expect(persistence.query(`delete from fx_system_scope_execution_authority
    where scope_id = $1`, [`scope_${SESSION_TEST_SCOPE_UUID}`])).rejects.toThrow();
  // Each autocommit statement reaches the deferred trigger's COMMIT boundary.
  await expect(persistence.query(`insert into fx_system_scope_clock(scope_id)
    values ('scope_61000000-0000-0000-0000-000000000011')`)).rejects.toThrow();
  await expect(persistence.query(`with peer as (insert into fx_system_scope_clock(scope_id)
    values ('scope_61000000-0000-0000-0000-000000000012') returning scope_id)
    update fx_system_scope_execution_authority set scope_id = (select scope_id from peer)
    where scope_id = $1`, [`scope_${SESSION_TEST_SCOPE_UUID}`])).rejects.toThrow();
  expect((await persistence.query(`select count(*)::int as roots from fx_system_scope_clock`)).rows)
    .toEqual([{ roots: 2 }]);
  // The exact 125->126 drain/inventory proof above belongs to that historical
  // layout. Today's verifier owns the complete current installation, so reach
  // it through the real maintenance/bootstrap owner before attestation.
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, Number.MAX_SAFE_INTEGER);
  await migrateCurrent();
  await migrateCurrent();
  const current = await inventory();
  expect(current.rows).toHaveLength(after.rows.length);
  for (const [ordinal, retained] of after.rows.entries()) {
    const observed = current.rows[ordinal];
    if (observed === undefined) throw new Error("Current migration lost a retained historical owner");
    for (const kind of ["session", "journal", "lease"] as const)
      expect(Object.fromEntries(Object.keys(retained[kind]).map(key => [key, observed[kind][key]])))
        .toEqual(retained[kind]);
  }
  const attestation = async () => (await persistence.execute<{ valid: boolean }>(
    sql`select ${scopeExecutionAuthorityInstallationSql(sql`current_schema()`)} as valid`)).rows;
  expect(await attestation()).toEqual([{ valid: true }]);
  try {
    await persistence.query("alter table fx_system_scope_execution_authority drop constraint fx_scope_execution_authority_epoch_check");
    await persistence.query("alter table fx_system_scope_execution_authority add constraint fx_scope_execution_authority_epoch_check check (btrim(epoch) <> '')");
    expect(await attestation()).toEqual([{ valid: false }]);
  } finally {
    await persistence.query("alter table fx_system_scope_execution_authority drop constraint fx_scope_execution_authority_epoch_check");
    await persistence.query(String.raw`alter table fx_system_scope_execution_authority add constraint fx_scope_execution_authority_epoch_check
      check (btrim(epoch, U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> '')`);
  }
  expect(await attestation()).toEqual([{ valid: true }]);
  try {
    await persistence.query("alter table fx_system_scope_clock alter column last_metadata_sequence set default 1");
    expect(await attestation()).toEqual([{ valid: false }]);
  } finally {
    await persistence.query("alter table fx_system_scope_clock alter column last_metadata_sequence set default 0");
  }
  expect(await attestation()).toEqual([{ valid: true }]);
  // This generated column has no dependent durable identity FK. Replacing only
  // its expression preserves its UUID type and generated flag while proving
  // the catalog refuses a wrong native projection.
  try {
    await persistence.query("alter table fx_system_scope_execution_authority drop column epoch_uuid");
    await persistence.query("alter table fx_system_scope_execution_authority add column epoch_uuid uuid generated always as (null::uuid) stored");
    expect(await attestation()).toEqual([{ valid: false }]);
  } finally {
    await persistence.query("alter table fx_system_scope_execution_authority drop column epoch_uuid");
    await persistence.query(`alter table fx_system_scope_execution_authority add column epoch_uuid uuid generated always as
      (case when epoch ~ '^epoch_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then substring(epoch from 7)::uuid else null end) stored`);
  }
  expect(await attestation()).toEqual([{ valid: true }]);
}
