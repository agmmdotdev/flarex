import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { isNonArrayRecord } from "@flarex/utils/records";
import type { FlarexSqlClient } from "../../src";
import { SESSION_TEST_EPOCH_UUID, SESSION_TEST_SCOPE_UUID, insertOpenTransactionJournalFixture,
  insertLegacyOpenTransactionJournalFixture,
  insertLegacySessionTestScope, insertTransactionSessionFixture, transactionSessionFixture,
  transactionSessionIdAt } from "../execution/sessionAuthorityTestSupport";

type MigratingClient = Pick<FlarexSqlClient, "query"> & Readonly<{ migrate: () => Promise<void> }>;

/** The copy gives each driver an actual 0116 database, then the same 0117
 * migration text. Only the Drizzle journal is shortened for the first pass. */
export async function withMigration117Folder(run: (folder: string, predecessor: () => Promise<void>) => Promise<void>) {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-mixed-117-"));
  const folder = resolve(root, "drizzle");
  const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
  try {
    await cp(source, folder, { recursive: true });
    const journalPath = resolve(folder, "meta/_journal.json");
    const full = await readFile(journalPath, "utf8");
    const parsed: unknown = JSON.parse(full);
    if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) throw new Error("Missing Drizzle journal");
    await writeFile(journalPath, `${JSON.stringify({ ...parsed, entries: parsed.entries.filter(entry =>
      isNonArrayRecord(entry) && typeof entry.idx === "number" && entry.idx < 117) }, null, 2)}\n`, "utf8");
    await run(folder, () => writeFile(journalPath, full, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Raw rows here belong to the 0116 durable format under test, not the current
 * runtime writer. The live 0117 migrator must refuse before touching them. */
export async function assertMigration117Cutover(previous: MigratingClient, current: MigratingClient,
  migrationsSchema: string) {
  if (!/^[a-z_][a-z_0-9]*$/.test(migrationsSchema)) throw new Error("Invalid fixture migrations schema");
  const receipts = `"${migrationsSchema}".__drizzle_migrations`;
  const session = transactionSessionFixture(transactionSessionIdAt(117));
  await insertLegacySessionTestScope(previous);
  await insertTransactionSessionFixture(previous, session);
  await insertLegacyOpenTransactionJournalFixture(previous, session);
  await previous.query(`insert into fx_system_tx_journal_latest_receipt
    (scope_uuid, session_id, attempt_fence, last_syscall_sequence, operation_kind,
     request_codec_version, request_bytes, request_sha256, outcome_kind, outcome_codec_version,
     outcome_bytes, outcome_sha256, created_at, updated_at)
    values ($1, $2, 1, 1, 'get', 1, decode('7b7d', 'hex'), decode(repeat('51', 32), 'hex'),
      'missing', 1, decode('6e756c6c', 'hex'), decode(repeat('52', 32), 'hex'),
      '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z')`,
    [session.scopeUuid, session.sessionId]);
  await assertRefusal("open");

  await previous.query(`update fx_system_tx_journal set state = 'sealed',
    sealed_journal_bytes = decode('7b7d', 'hex'), sealed_journal_sha256 = decode(repeat('11', 32), 'hex'),
    sealed_result_value_codec_version = 1, sealed_result_semantic_bytes = 2,
    sealed_result_bytes = decode('7b7d', 'hex'), sealed_result_sha256 = decode(repeat('22', 32), 'hex'),
    sealed_at = '2030-01-01T00:00:00.000Z' where scope_uuid = $1 and session_id = $2`,
    [session.scopeUuid, session.sessionId]);
  await assertRefusal("sealed");

  // A completed success has independent scope-lifetime authority. Retiring the
  // temporary journal root must not remove its committed idempotency outcome.
  const result = new TextEncoder().encode("{}");
  await previous.query(`update fx_system_scope_clock set last_commit_seq = 1 where scope_uuid = $1`,
    [SESSION_TEST_SCOPE_UUID]);
  await previous.query(`insert into fx_system_commit (scope_uuid, epoch_uuid, commit_seq, change_count)
    values ($1, $2, 1, 0)`, [SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID]);
  await previous.query(`insert into fx_system_idempotency
    (scope_uuid, request_key, identity_access_policy_sha256, function_path, request_sha256,
     epoch_uuid, commit_seq, result_state, result_encoding, result_semantic_bytes, result_bytes, result_sha256)
    values ($1, 'mixed-117-committed', decode(repeat('33', 32), 'hex'), 'products:update',
      decode(repeat('44', 32), 'hex'), $2, 1, 'available', 'json', $3, $4, $5)`,
    [SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID, result.byteLength, result,
      new Uint8Array(createHash("sha256").update(result).digest())]);
  const retained = await previous.query<{ outcome: string; digest: string }>(`select encode(result_bytes, 'hex') as outcome,
    encode(result_sha256, 'hex') as digest from fx_system_idempotency where request_key = 'mixed-117-committed'`);
  await previous.query(`delete from fx_system_tx_journal where scope_uuid = $1 and session_id = $2`,
    [session.scopeUuid, session.sessionId]);
  await current.migrate();
  expect((await current.query<{ outcome: string; digest: string }>(`select encode(result_bytes, 'hex') as outcome,
    encode(result_sha256, 'hex') as digest from fx_system_idempotency where request_key = 'mixed-117-committed'`)).rows)
    .toEqual(retained.rows);
  expect((await current.query<{ count: string }>(`select count(*)::text as count from ${receipts}`)).rows)
    .toEqual([{ count: "118" }]);
  const upgraded = await current.query<{ receipt: string | null; latest: string | null; binding: string;
    effect: string; receiptPk: string | null; effectPk: string | null }>(`
    select to_regclass('fx_system_tx_journal_receipt')::text as receipt,
      to_regclass('fx_system_tx_journal_latest_receipt')::text as latest,
      (select count(*)::text from information_schema.columns where table_schema = current_schema()
        and table_name = 'fx_system_tx_journal_receipt' and column_name = 'participant_binding_sha256') as binding,
      (select count(*)::text from information_schema.columns where table_schema = current_schema()
        and table_name = 'fx_system_tx_journal_write_event' and column_name = 'effect_ordinal') as effect,
      (select pg_get_constraintdef(oid) from pg_constraint where conname = 'fx_system_tx_journal_receipt_pk'
        and conrelid = 'fx_system_tx_journal_receipt'::regclass) as "receiptPk",
      (select pg_get_constraintdef(oid) from pg_constraint where conname = 'fx_system_tx_journal_event_pk'
        and conrelid = 'fx_system_tx_journal_write_event'::regclass) as "effectPk"`);
  expect(upgraded.rows[0]).toMatchObject({ receipt: "fx_system_tx_journal_receipt", latest: null,
    binding: "1", effect: "1" });
  expect(upgraded.rows[0]?.receiptPk).toContain("last_syscall_sequence");
  expect(upgraded.rows[0]?.effectPk).toContain("effect_ordinal");
  await expect(insertLegacyOpenTransactionJournalFixture(current, session)).rejects.toThrow();
  await insertOpenTransactionJournalFixture(current, session);
  for (const sequence of [1, 2]) await current.query(`insert into fx_system_tx_journal_receipt
    (scope_uuid, session_id, attempt_fence, last_syscall_sequence, operation_kind,
     request_codec_version, request_bytes, request_sha256, participant_binding_sha256,
     outcome_kind, outcome_codec_version, outcome_bytes, outcome_sha256, created_at, updated_at)
    values ($1, $2, 1, $3, 'admittedLogicalOperation', 1, decode('7b7d', 'hex'),
      decode(repeat('61', 32), 'hex'), decode(repeat('62', 32), 'hex'),
      'admittedLogicalResult', 1, decode('7b7d', 'hex'), decode(repeat('63', 32), 'hex'),
      '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z')`,
    [session.scopeUuid, session.sessionId, sequence]);
  for (const ordinal of [0, 1]) await current.query(`insert into fx_system_tx_journal_write_event
    (scope_uuid, session_id, attempt_fence, syscall_sequence, effect_ordinal,
     write_kind, event_codec_version, event_bytes, event_sha256, created_at)
    values ($1, $2, 1, 1, $3, 'logicalDocument', 1, decode('7b7d', 'hex'),
      decode(repeat('64', 32), 'hex'), '2030-01-01T00:00:00.000Z')`,
    [session.scopeUuid, session.sessionId, ordinal]);
  expect((await current.query<{ receipts: string; effects: string }>(`select
    (select count(*)::text from fx_system_tx_journal_receipt where session_id = $1) as receipts,
    (select count(*)::text from fx_system_tx_journal_write_event where session_id = $1) as effects`,
    [session.sessionId])).rows).toEqual([{ receipts: "2", effects: "2" }]);

  async function assertRefusal(state: "open" | "sealed") {
    const before = await previous.query<{ journal: string | null; journalDigest: string | null;
      result: string | null; resultDigest: string | null; request: string; requestDigest: string;
      outcome: string; outcomeDigest: string }>(`select encode(j.sealed_journal_bytes, 'hex') as journal,
      encode(j.sealed_journal_sha256, 'hex') as "journalDigest",
      encode(j.sealed_result_bytes, 'hex') as result,
      encode(j.sealed_result_sha256, 'hex') as "resultDigest",
      encode(r.request_bytes, 'hex') as request,
      encode(r.request_sha256, 'hex') as "requestDigest",
      encode(r.outcome_bytes, 'hex') as outcome,
      encode(r.outcome_sha256, 'hex') as "outcomeDigest"
      from fx_system_tx_journal j join fx_system_tx_journal_latest_receipt r
        using (scope_uuid, session_id, attempt_fence)
      where j.scope_uuid = $1 and j.session_id = $2`, [session.scopeUuid, session.sessionId]);
    expect(before.rows).toHaveLength(1);
    await expect(current.migrate()).rejects.toThrow(/mixed attempt journal migration requires an empty legacy journal/);
    const unchanged = await previous.query<{ state: string; oldShape: string; newShape: string; receipts: string }>(`
      select j.state,
        (select count(*)::text from information_schema.tables where table_schema = current_schema()
          and table_name = 'fx_system_tx_journal_latest_receipt') as "oldShape",
        (select count(*)::text from information_schema.columns where table_schema = current_schema()
          and table_name = 'fx_system_tx_journal_write_event' and column_name = 'effect_ordinal') as "newShape",
        (select count(*)::text from ${receipts}) as receipts
      from fx_system_tx_journal j where j.scope_uuid = $1 and j.session_id = $2`,
      [session.scopeUuid, session.sessionId]);
    expect(unchanged.rows).toEqual([{ state, oldShape: "1", newShape: "0", receipts: "117" }]);
    expect((await previous.query<typeof before.rows[number]>(`select encode(j.sealed_journal_bytes, 'hex') as journal,
      encode(j.sealed_journal_sha256, 'hex') as "journalDigest",
      encode(j.sealed_result_bytes, 'hex') as result,
      encode(j.sealed_result_sha256, 'hex') as "resultDigest",
      encode(r.request_bytes, 'hex') as request,
      encode(r.request_sha256, 'hex') as "requestDigest",
      encode(r.outcome_bytes, 'hex') as outcome,
      encode(r.outcome_sha256, 'hex') as "outcomeDigest"
      from fx_system_tx_journal j join fx_system_tx_journal_latest_receipt r
        using (scope_uuid, session_id, attempt_fence)
      where j.scope_uuid = $1 and j.session_id = $2`, [session.scopeUuid, session.sessionId])).rows)
      .toEqual(before.rows);
  }
}
