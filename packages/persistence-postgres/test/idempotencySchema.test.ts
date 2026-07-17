import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import * as persistencePackage from "../src";
import { createPGlitePersistence } from "../src/pglite";
import { flarexSchema } from "../src/schema";
import {
  classifyOutcomeIntegrity,
  insertAvailableOutcome,
  insertExpiredOutcome,
  insertS09Header,
  insertS09Scope,
  MAX_RESULT_CANONICAL_BYTES,
  MAX_RESULT_SEMANTIC_BYTES,
  POSTGRES_SIGNED_BIGINT_MAX,
  S09_EPOCH_A,
  S09_EPOCH_B,
  S09_EPOCH_C,
  S09_SCOPE_A,
  S09_SCOPE_B,
  writeJournalThrough0029,
  writeJournalThrough0030,
} from "./idempotencySchemaTestSupport";

const MIGRATION_NAME = "0030_absurd_vanisher.sql";

describe("S09-A committed-success idempotency schema", () => {
  it("installs privately, replays idempotently, and owns only the scope FK", async () => {
    const persistence = await createPGlitePersistence();

    await expect(persistence.migrate()).resolves.toBeUndefined();
    await expect(persistence.migrate()).resolves.toBeUndefined();

    const inventory = await persistence.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = current_schema()
        and table_name in ('fx_system_idempotency', 'outbox')
      order by table_name
    `);
    expect(inventory.rows).toEqual([
      { table_name: "fx_system_idempotency" },
      { table_name: "outbox" },
    ]);
    expect("fxSystemIdempotency" in flarexSchema).toBe(false);
    expect(persistencePackage).not.toHaveProperty("fxSystemIdempotency");

    const foreignKeys = await persistence.query<{
      constraint_name: string;
      foreign_table_name: string;
    }>(`
      select
        constraint_row.constraint_name,
        usage_row.table_name as foreign_table_name
      from information_schema.table_constraints as constraint_row
      join information_schema.constraint_column_usage as usage_row
        on usage_row.constraint_schema = constraint_row.constraint_schema
       and usage_row.constraint_name = constraint_row.constraint_name
      where constraint_row.table_schema = current_schema()
        and constraint_row.table_name = 'fx_system_idempotency'
        and constraint_row.constraint_type = 'FOREIGN KEY'
    `);
    expect(foreignKeys.rows).toEqual([
      {
        constraint_name: "fx_system_idempotency_scope_clock_fk",
        foreign_table_name: "fx_system_scope_clock",
      },
    ]);
  });

  it("upgrades 0029 with target and legacy rows intact", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-s09a-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      await writeJournalThrough0029(currentJournal, temporaryJournal);
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await insertS09Scope(previous, S09_SCOPE_A, S09_EPOCH_A, "1");
      await insertS09Header(previous, S09_SCOPE_A, S09_EPOCH_A, "1");
      await previous.query(`
        insert into commits (deployment_id, ts, source, write_summary)
        values ('legacy-s09a', 1, 'legacy', '{"writes":1}'::jsonb)
      `);
      await previous.query(`
        insert into outbox (deployment_id, ts, sequence, event)
        values ('legacy-s09a', 1, 0, '{"kind":"legacy"}'::jsonb)
      `);

      await writeJournalThrough0030(currentJournal, temporaryJournal);
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(current.migrate()).resolves.toBeUndefined();

      const preserved = await current.query<{
        current_headers: string;
        legacy_commits: string;
        legacy_outbox: string;
        outcomes: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text from fx_system_commit) as current_headers,
          (select count(*)::text from commits) as legacy_commits,
          (select count(*)::text from outbox) as legacy_outbox,
          (select count(*)::text from fx_system_idempotency) as outcomes,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
      `);
      expect(preserved.rows).toEqual([
        {
          current_headers: "1",
          legacy_commits: "1",
          legacy_outbox: "1",
          outcomes: "0",
          receipts: "31",
        },
      ]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("rolls back an injected 0030 failure and recovers exactly once", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-s09a-failure-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
    const copiedMigration = resolve(migrationsFolder, MIGRATION_NAME);
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      await writeJournalThrough0029(currentJournal, temporaryJournal);
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await insertS09Scope(previous, S09_SCOPE_A, S09_EPOCH_A, "0");
      await writeJournalThrough0030(currentJournal, temporaryJournal);

      const migration = await readFile(copiedMigration, "utf8");
      await writeFile(
        copiedMigration,
        `${migration}\n--> statement-breakpoint\nselect * from fx_s09a_deliberate_missing_table;\n`,
        "utf8",
      );
      const failing = await createPGlitePersistence({ db, migrationsFolder });
      await expect(failing.migrate()).rejects.toThrow();
      const rolledBack = await failing.query<{
        outcome_tables: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text from information_schema.tables
           where table_schema = current_schema()
             and table_name = 'fx_system_idempotency') as outcome_tables,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
      `);
      expect(rolledBack.rows).toEqual([
        { outcome_tables: "0", receipts: "30" },
      ]);

      await writeFile(
        copiedMigration,
        await readFile(resolve(currentMigrationsFolder, MIGRATION_NAME), "utf8"),
        "utf8",
      );
      const recovered = await createPGlitePersistence({ db, migrationsFolder });
      await expect(recovered.migrate()).resolves.toBeUndefined();
      await expect(recovered.migrate()).resolves.toBeUndefined();
      const result = await recovered.query<{
        outcome_tables: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text from information_schema.tables
           where table_schema = current_schema()
             and table_name = 'fx_system_idempotency') as outcome_tables,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
      `);
      expect(result.rows).toEqual([
        { outcome_tables: "1", receipts: "31" },
      ]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("enforces key, match, token, timestamp, and result-state boundaries", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertS09Scope(persistence, S09_SCOPE_A, S09_EPOCH_B, "3");
    await insertS09Scope(
      persistence,
      S09_SCOPE_B,
      S09_EPOCH_C,
      POSTGRES_SIGNED_BIGINT_MAX,
    );
    await insertS09Header(persistence, S09_SCOPE_A, S09_EPOCH_A, "1");

    const exactMultibyteKey = "é".repeat(512);
    await insertAvailableOutcome(persistence, {
      scopeUuid: S09_SCOPE_A,
      requestKey: exactMultibyteKey,
      epochUuid: S09_EPOCH_A,
      commitSeq: "1",
    });
    await insertAvailableOutcome(persistence, {
      scopeUuid: S09_SCOPE_B,
      requestKey: exactMultibyteKey,
      epochUuid: S09_EPOCH_C,
      commitSeq: POSTGRES_SIGNED_BIGINT_MAX,
    });
    await insertExpiredOutcome(persistence, {
      scopeUuid: S09_SCOPE_A,
      requestKey: "expired-request",
      epochUuid: S09_EPOCH_A,
      commitSeq: "1",
    });
    await insertAvailableOutcome(persistence, {
      scopeUuid: S09_SCOPE_A,
      requestKey: "zero-semantic-result",
      epochUuid: S09_EPOCH_A,
      commitSeq: "1",
      resultSemanticBytes: 0,
    });

    await expect(
      insertAvailableOutcome(persistence, {
        scopeUuid: S09_SCOPE_A,
        requestKey: `${exactMultibyteKey}x`,
        epochUuid: S09_EPOCH_A,
        commitSeq: "1",
      }),
    ).rejects.toThrow(/fx_system_idempotency_request_key_check/);
    await expect(
      insertAvailableOutcome(persistence, {
        scopeUuid: S09_SCOPE_A,
        requestKey: " \t\n ",
        epochUuid: S09_EPOCH_A,
        commitSeq: "1",
      }),
    ).rejects.toThrow(/fx_system_idempotency_request_key_check/);

    for (const invalid of invalidStateStatements()) {
      await expect(persistence.query(invalid.statement)).rejects.toThrow(
        invalid.expected,
      );
    }

    await expect(
      persistence.query(
        `delete from fx_system_scope_clock where scope_uuid = $1::uuid`,
        [S09_SCOPE_B],
      ),
    ).rejects.toThrow(/fx_system_idempotency_scope_clock_fk/);
    await expect(
      persistence.query(
        `delete from fx_system_commit where scope_uuid = $1::uuid and commit_seq = 1`,
        [S09_SCOPE_A],
      ),
    ).resolves.toBeDefined();
    const outcomes = await persistence.query<{ count: string }>(`
      select count(*)::text as count from fx_system_idempotency
    `);
    expect(outcomes.rows).toEqual([{ count: "4" }]);
  });

  it("distinguishes compacted history from retained-range corruption", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertS09Scope(persistence, S09_SCOPE_A, S09_EPOCH_B, "3");
    await insertS09Header(persistence, S09_SCOPE_A, S09_EPOCH_A, "1");
    await insertAvailableOutcome(persistence, {
      scopeUuid: S09_SCOPE_A,
      requestKey: "old-epoch",
      epochUuid: S09_EPOCH_A,
      commitSeq: "1",
    });
    expect(
      await classifyOutcomeIntegrity(persistence, S09_SCOPE_A, "old-epoch"),
    ).toBe("validRetained");

    await persistence.query(`
      delete from fx_system_commit
      where scope_uuid = '${S09_SCOPE_A}'::uuid and commit_seq = 1
    `);
    expect(
      await classifyOutcomeIntegrity(persistence, S09_SCOPE_A, "old-epoch"),
    ).toBe("corruptMissingRetainedHeader");
    await persistence.query(`
      update fx_system_scope_clock
      set oldest_available_commit_seq = 2
      where scope_uuid = '${S09_SCOPE_A}'::uuid
    `);
    expect(
      await classifyOutcomeIntegrity(persistence, S09_SCOPE_A, "old-epoch"),
    ).toBe("validCompacted");

    await insertAvailableOutcome(persistence, {
      scopeUuid: S09_SCOPE_A,
      requestKey: "missing-at-floor",
      epochUuid: S09_EPOCH_B,
      commitSeq: "2",
    });
    expect(
      await classifyOutcomeIntegrity(
        persistence,
        S09_SCOPE_A,
        "missing-at-floor",
      ),
    ).toBe("corruptMissingRetainedHeader");

    await insertAvailableOutcome(persistence, {
      scopeUuid: S09_SCOPE_A,
      requestKey: "future-token",
      epochUuid: S09_EPOCH_B,
      commitSeq: "4",
    });
    expect(
      await classifyOutcomeIntegrity(persistence, S09_SCOPE_A, "future-token"),
    ).toBe("corruptFutureToken");

    await insertS09Header(persistence, S09_SCOPE_A, S09_EPOCH_A, "3");
    await insertAvailableOutcome(persistence, {
      scopeUuid: S09_SCOPE_A,
      requestKey: "wrong-epoch",
      epochUuid: S09_EPOCH_B,
      commitSeq: "3",
    });
    expect(
      await classifyOutcomeIntegrity(persistence, S09_SCOPE_A, "wrong-epoch"),
    ).toBe("corruptRetainedEpoch");
  });

  it("accepts exact result limits and rejects semantic or canonical +1", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertS09Scope(persistence, S09_SCOPE_A, S09_EPOCH_A, "1");

    await insertAvailableOutcome(persistence, {
      scopeUuid: S09_SCOPE_A,
      requestKey: "exact-large-result",
      epochUuid: S09_EPOCH_A,
      commitSeq: "1",
      resultSemanticBytes: MAX_RESULT_SEMANTIC_BYTES,
      resultByteLength: MAX_RESULT_CANONICAL_BYTES,
    });
    const exact = await persistence.query<{
      canonical_bytes: string;
      semantic_bytes: number;
    }>(`
      select
        octet_length(result_bytes)::text as canonical_bytes,
        result_semantic_bytes as semantic_bytes
      from fx_system_idempotency
      where scope_uuid = '${S09_SCOPE_A}'::uuid
        and request_key = 'exact-large-result'
    `);
    expect(exact.rows).toEqual([
      {
        canonical_bytes: String(MAX_RESULT_CANONICAL_BYTES),
        semantic_bytes: MAX_RESULT_SEMANTIC_BYTES,
      },
    ]);
    await persistence.query(`delete from fx_system_idempotency`);

    await expect(
      insertAvailableOutcome(persistence, {
        scopeUuid: S09_SCOPE_A,
        requestKey: "semantic-plus-one",
        epochUuid: S09_EPOCH_A,
        commitSeq: "1",
        resultSemanticBytes: MAX_RESULT_SEMANTIC_BYTES + 1,
      }),
    ).rejects.toThrow(/fx_system_idempotency_result_evidence_check/);
    await expect(
      insertAvailableOutcome(persistence, {
        scopeUuid: S09_SCOPE_A,
        requestKey: "canonical-plus-one",
        epochUuid: S09_EPOCH_A,
        commitSeq: "1",
        resultByteLength: MAX_RESULT_CANONICAL_BYTES + 1,
      }),
    ).rejects.toThrow(/fx_system_idempotency_result_evidence_check/);
  }, 180_000);
});

interface InvalidStateStatement {
  readonly expected: RegExp;
  readonly statement: string;
}

function invalidStateStatements(): ReadonlyArray<InvalidStateStatement> {
  return [
    {
      expected: /fx_system_idempotency_identity_hash_check/,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state,
        result_value_codec_version, result_semantic_bytes, result_bytes,
        result_sha256)
     values ('${S09_SCOPE_A}', 'invalid-identity', decode('11', 'hex'),
       'messages:create', decode(repeat('22', 32), 'hex'),
       '${S09_EPOCH_A}'::uuid, 1,
       'available', 1, 1, decode('01', 'hex'), decode(repeat('33', 32), 'hex'))`,
    },
    {
      expected: /fx_system_idempotency_function_path_check/,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state,
        result_value_codec_version, result_semantic_bytes, result_bytes,
        result_sha256)
     values ('${S09_SCOPE_A}', 'invalid-function', decode(repeat('11', 32), 'hex'),
       '  ', decode(repeat('22', 32), 'hex'), '${S09_EPOCH_A}', 1,
       'available', 1, 1, decode('01', 'hex'), decode(repeat('33', 32), 'hex'))`,
    },
    {
      expected: /fx_system_idempotency_request_hash_check/,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state,
        result_value_codec_version, result_semantic_bytes, result_bytes,
        result_sha256)
     values ('${S09_SCOPE_A}', 'invalid-request-hash', decode(repeat('11', 32), 'hex'),
       'messages:create', decode('22', 'hex'), '${S09_EPOCH_A}', 1,
       'available', 1, 1, decode('01', 'hex'), decode(repeat('33', 32), 'hex'))`,
    },
    {
      expected: /fx_system_idempotency_commit_seq_check/,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state,
        result_value_codec_version, result_semantic_bytes, result_bytes,
        result_sha256)
     values ('${S09_SCOPE_A}', 'invalid-sequence', decode(repeat('11', 32), 'hex'),
       'messages:create', decode(repeat('22', 32), 'hex'), '${S09_EPOCH_A}', 0,
       'available', 1, 1, decode('01', 'hex'), decode(repeat('33', 32), 'hex'))`,
    },
    {
      expected: /bigint|range/i,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state,
        result_value_codec_version, result_semantic_bytes, result_bytes,
        result_sha256)
     values ('${S09_SCOPE_A}', 'invalid-sequence-overflow',
       decode(repeat('11', 32), 'hex'), 'messages:create',
       decode(repeat('22', 32), 'hex'), '${S09_EPOCH_A}',
       9223372036854775808, 'available', 1, 1, decode('01', 'hex'),
       decode(repeat('33', 32), 'hex'))`,
    },
    {
      expected: /fx_system_idempotency_result_(state|evidence)_check/,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state,
        result_value_codec_version, result_semantic_bytes, result_bytes,
        result_sha256)
     values ('${S09_SCOPE_A}', 'invalid-state',
       decode(repeat('11', 32), 'hex'), 'messages:create',
       decode(repeat('22', 32), 'hex'), '${S09_EPOCH_A}', 1, 'unknown',
       1, 1, decode('01', 'hex'), decode(repeat('33', 32), 'hex'))`,
    },
    {
      expected: /fx_system_idempotency_result_evidence_check/,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state)
     values ('${S09_SCOPE_A}', 'invalid-empty-available',
       decode(repeat('11', 32), 'hex'), 'messages:create',
       decode(repeat('22', 32), 'hex'), '${S09_EPOCH_A}', 1, 'available')`,
    },
    ...invalidAvailableEvidenceStatements(),
    {
      expected: /fx_system_idempotency_result_evidence_check/,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state,
        result_value_codec_version, result_semantic_bytes, result_bytes,
        result_sha256, result_expired_at)
     values ('${S09_SCOPE_A}', 'invalid-expired-payload',
       decode(repeat('11', 32), 'hex'), 'messages:create',
       decode(repeat('22', 32), 'hex'), '${S09_EPOCH_A}', 1, 'expired',
       1, 1, decode('01', 'hex'), decode(repeat('33', 32), 'hex'), now())`,
    },
    {
      expected: /fx_system_idempotency_result_evidence_check/,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state, result_expired_at,
        created_at)
     values ('${S09_SCOPE_A}', 'invalid-expired-time',
       decode(repeat('11', 32), 'hex'), 'messages:create',
       decode(repeat('22', 32), 'hex'), '${S09_EPOCH_A}', 1, 'expired',
       '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')`,
    },
    {
      expected: /fx_system_idempotency_result_evidence_check/,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state, result_expired_at,
        created_at)
     values ('${S09_SCOPE_A}', 'invalid-expired-infinity',
       decode(repeat('11', 32), 'hex'), 'messages:create',
       decode(repeat('22', 32), 'hex'), '${S09_EPOCH_A}', 1, 'expired',
       'infinity', '2026-01-02T00:00:00Z')`,
    },
    {
      expected: /fx_system_idempotency_created_at_check/,
      statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state,
        result_value_codec_version, result_semantic_bytes, result_bytes,
        result_sha256, created_at)
     values ('${S09_SCOPE_A}', 'invalid-created-time',
       decode(repeat('11', 32), 'hex'), 'messages:create',
       decode(repeat('22', 32), 'hex'), '${S09_EPOCH_A}', 1, 'available',
       1, 1, decode('01', 'hex'), decode(repeat('33', 32), 'hex'), 'infinity')`,
    },
  ];
}

function invalidAvailableEvidenceStatements(): ReadonlyArray<InvalidStateStatement> {
  const variants = [
    {
      evidence: "2, 1, decode('01', 'hex'), decode(repeat('33', 32), 'hex')",
      key: "invalid-result-codec",
    },
    {
      evidence: "1, -1, decode('01', 'hex'), decode(repeat('33', 32), 'hex')",
      key: "invalid-result-semantic-bytes",
    },
    {
      evidence: "1, 1, decode('', 'hex'), decode(repeat('33', 32), 'hex')",
      key: "invalid-empty-result-bytes",
    },
    {
      evidence: "1, 1, decode('01', 'hex'), decode('33', 'hex')",
      key: "invalid-result-hash",
    },
  ] as const;
  return variants.map(({ evidence, key }) => ({
    expected: /fx_system_idempotency_result_evidence_check/,
    statement: `insert into fx_system_idempotency
       (scope_uuid, request_key, identity_access_policy_sha256, function_path,
        request_sha256, epoch_uuid, commit_seq, result_state,
        result_value_codec_version, result_semantic_bytes, result_bytes,
        result_sha256)
     values ('${S09_SCOPE_A}', '${key}', decode(repeat('11', 32), 'hex'),
       'messages:create', decode(repeat('22', 32), 'hex'),
       '${S09_EPOCH_A}', 1, 'available', ${evidence})`,
  }));
}
