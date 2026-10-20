import { setTimeout as delay } from "node:timers/promises";
import { asc, eq } from "drizzle-orm";

import {
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdV1,
  decodeAppDocumentIdentityV1,
  type AppDocumentIdV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  CommitSyscallSequenceV1Schema,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  makeGrantRetentionPolicyV1Result,
  type GrantRetentionPolicyV1,
} from "flarex-protocol/grant-retention-policy";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { Effect, Fiber, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { sessionJournalReceiptScenario } from "./sessionJournalReceiptScenario";
import { finiteDocumentValidationScenario } from "./finiteDocumentValidationScenario";
import { verifyJournalEventEvidence, verifyJournalSealSequence } from "./journalEvidenceScenario";

import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
  InvalidApplicationRevisionSyscallValidatorV1Error,
} from "../../../src/application/revision/applicationRevisionSyscallValidatorErrors";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresPersistence,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../../../src/database/postgres";
import type { LocatedScopeClockReader } from "../../../src/scope/scopeAuthorityResolution";
import { fxSystemTransactionJournalReceipts } from "../../../src/database/schema";
import type { SharedDatabaseScopePhysicalLocator } from "../../../src/scope/scopeMetadataTypes";
import {
  createSessionJournalStorePersistence,
} from "../../../src/execution/sessionJournalStore";
import {
  type PinnedPointTableV1,
  type RunSessionJournalPointOperationV1Result,
  type SessionJournalAttempt,
  type SessionJournalPointOperationV1,
  type SessionJournalStorePersistence,
} from "../../../src/execution/journal/api";
import {
  createPointMutationExecutionClaimAcquisitionV1,
} from "../../../src/execution/claims/acquisition";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import {
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
} from "../../../src/execution/session/terminalization";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
  PointMutationSessionAuthorityResolutionPortsV1,
} from "../../../src/execution/session/constructionContracts";
import type {
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptSelectorV1,
} from "../../../src/execution/session/contracts";
import {
  postgresUrl,
  rollbackAndReleasePostgresClient,
  useFileScopedPostgresPersistence,
  withPostgresSequentialScansDisabled,
  withTemporaryPostgresSchema,
} from "../../support/postgresHelpers";
import {
  injectMigrationFailure,
  makeDrizzleCopyFixture,
  restoreMigrationFile,
  writeJournalThrough,
} from "../../support/migrationFixtureSupport";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "../../support/effectTestRuntime";
import {
  issueSetupSeededSyscallValidatorProofV1,
  revokeSetupSeededSyscallValidatorProofV1,
} from
  "../../application/revision/applicationRevisionSyscallValidatorTestSupport";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  pointMutationSessionActivationFixture,
} from "../session/support/activationEvidence";
import {
  abortPointMutationSessionAttempt,
  activatePointMutationSession,
  executionClaimForAnchor,
} from "../session/support/attemptFixture";
import {
  setFlarexActivationClock,
} from "../session/support/authorityClock";
import {
  insertLegacyOpenTransactionJournalFixture,
  insertLegacySessionTestScope,
  insertTransactionSessionFixture,
  transactionSessionFixture,
  transactionSessionIdAt,
} from "../session/support/sessionStorage";

const describePostgres = postgresUrl === null ? describe.skip : describe;

interface ScenarioOptions {
  readonly grantRetentionPolicy?: GrantRetentionPolicyV1;
  readonly randomUuid?: () => string;
  readonly targetOptions?: LocatedPointMutationSessionActivationTargetOptionsV1;
  readonly executionProfile?: "durableOperations";
}

interface JournalScenario {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly anchor: PointMutationSessionAnchorV1;
  readonly ports: PointMutationSessionAuthorityResolutionPortsV1;
  readonly store: SessionJournalStorePersistence;
  readonly attempt: SessionJournalAttempt;
  readonly table: PinnedPointTableV1;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
}

interface JournalCounts extends Record<string, unknown> {
  readonly roots: number;
  readonly receipts: number;
  readonly points: number;
  readonly events: number;
}

interface AttemptCleanupState extends JournalCounts {
  readonly sessions: number;
  readonly leases: number;
  readonly lifecycle: string;
}

interface JournalRootIdentity extends Record<string, unknown> {
  readonly scope_uuid: string;
  readonly session_id: string;
  readonly attempt_fence: string;
}

interface AttemptLeaseAndSealState extends Record<string, unknown> {
  readonly root_state: string;
  readonly lease_expires_at: Date;
  readonly authorization_grant_expires_at: Date;
  readonly hard_expires_at: Date;
  readonly lease_xmin: string;
  readonly root_xmin: string;
}

describePostgres("real Postgres C03 SessionJournalStore", { concurrent: false }, () => {
  const withPostgresPersistence = useFileScopedPostgresPersistence();

  it("authenticates canonical write bytes and scalar metadata without a JSON mirror", async () => {
    await withPostgresPersistence(async persistence => {
      const tables = await persistence.query<{ count: number }>(`
        select count(*)::int as count
        from information_schema.tables
        where table_schema = current_schema()
          and table_name like 'fx_system_tx_journal%'
      `);
      expect(tables.rows).toEqual([{ count: 6 }]);
      await verifyJournalEventEvidence(persistence, await scenario(persistence, "canonical_event_only"));
    });
  });

  it("binds seal replay to the surviving root sequence", async () => {
    await withPostgresPersistence(async persistence => {
      await verifyJournalSealSequence(persistence, await scenario(persistence, "surviving_root_sequence"));
    });
  });

  it("rolls back invalid syscall-time validation before journal acceptance", async () => {
    await withPostgresPersistence(async persistence => {
      const current = await scenario(persistence, "c03v_validation");
      const validator = issueSetupSeededSyscallValidatorProofV1({
        scopeId: current.anchor.scopeId,
        schemaVersionId: current.schemaVersionId,
        schemaManifest: current.schemaManifest,
      });
      await expect(runFailure(current.store.runPointOperationEffect(
        current.table,
        {
          kind: "insert",
          syscallSequence: syscallSequence(1n),
          fields: { name: 42 },
        },
        validator,
      ))).resolves.toBeInstanceOf(
        ApplicationRevisionSyscallDocumentValidationV1Error,
      );
      await expect(journalCounts(persistence, current.anchor.sessionId))
        .resolves.toEqual({ roots: 1, receipts: 0, points: 0, events: 0 });
      await expect(runEffect(current.store.runPointOperationEffect(
        current.table,
        {
          kind: "insert",
          syscallSequence: syscallSequence(1n),
          fields: { name: "accepted" },
        },
        validator,
      ))).resolves.toMatchObject({ kind: "completed", delivery: "executed" });
      await expect(journalCounts(persistence, current.anchor.sessionId))
        .resolves.toEqual({ roots: 1, receipts: 1, points: 1, events: 1 });
    });
  }, 120_000);

  it("validates authority and documents before a PostgreSQL limit receipt", async () => {
    await withPostgresPersistence(async persistence => {
      const current = await scenario(persistence, "c03v_limit_priority");
      const validator = issueSetupSeededSyscallValidatorProofV1({
        scopeId: current.anchor.scopeId,
        schemaVersionId: current.schemaVersionId,
        schemaManifest: current.schemaManifest,
      });
      await persistence.query(
        `update fx_system_tx_journal
            set write_operations = $2
          where session_id = $1`,
        [current.anchor.sessionId, MAX_COMMIT_WRITE_OPERATIONS_V1],
      );
      await expect(runFailure(current.store.runPointOperationEffect(
        current.table,
        {
          kind: "insert",
          syscallSequence: syscallSequence(1n),
          fields: { name: 42 },
        },
        validator,
      ))).resolves.toBeInstanceOf(
        ApplicationRevisionSyscallDocumentValidationV1Error,
      );
      const revoked = issueSetupSeededSyscallValidatorProofV1({
        scopeId: current.anchor.scopeId,
        schemaVersionId: current.schemaVersionId,
        schemaManifest: current.schemaManifest,
      });
      revokeSetupSeededSyscallValidatorProofV1(revoked);
      await expect(runFailure(current.store.runPointOperationEffect(
        current.table,
        {
          kind: "insert",
          syscallSequence: syscallSequence(1n),
          fields: { name: "valid" },
        },
        revoked,
      ))).resolves.toBeInstanceOf(
        InvalidApplicationRevisionSyscallValidatorV1Error,
      );
      await expect(journalCounts(persistence, current.anchor.sessionId))
        .resolves.toEqual({ roots: 1, receipts: 0, points: 0, events: 0 });
      const root = await persistence.query<{
        state: string;
        last_syscall_sequence: string;
        write_operations: number;
      }>(`select state, last_syscall_sequence, write_operations
            from fx_system_tx_journal
           where session_id = $1`, [current.anchor.sessionId]);
      expect(root.rows[0]).toMatchObject({
        state: "open",
        last_syscall_sequence: "0",
        write_operations: MAX_COMMIT_WRITE_OPERATIONS_V1,
      });
      await expect(runEffect(current.store.runPointOperationEffect(
        current.table,
        {
          kind: "insert",
          syscallSequence: syscallSequence(1n),
          fields: { name: "valid" },
        },
        validator,
      ))).resolves.toMatchObject({
        kind: "rejected",
        issue: { reason: "limitExceeded", dimension: "writeOperations" },
      });
    });
  }, 120_000);

  it("rolls back and recovers migration 0028 in a non-public schema", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-c03", "postgres", "0028_glossy_galactus.sql");
    const migrationsFolder = fixture.migrationsFolder;

    try {
      await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 27);

      await withTemporaryPostgresSchema(async (databaseOptions) => {
        const previousPersistence = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder,
        });
        let currentPersistence:
          | Awaited<ReturnType<typeof createPostgresPersistence>>
          | undefined;
        try {
          await previousPersistence.migrate();
          await expect(previousPersistence.query(
            `select count(*) from fx_system_tx_journal`,
          )).rejects.toThrow();

          await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 28);
          await injectMigrationFailure(fixture.migrationPath, "fx_c03_deliberate_missing_table");
          currentPersistence = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder,
          });
          await expect(currentPersistence.migrate()).rejects.toThrow();
          const absent = await currentPersistence.query<{ count: number }>(`
            select count(*)::int as count
            from information_schema.tables
            where table_schema = current_schema()
              and table_name like 'fx_system_tx_journal%'
          `);
          expect(absent.rows).toEqual([{ count: 0 }]);

          const failedReceipts = await currentPersistence.query<{ count: number }>(`
            select count(*)::int as count
            from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations
          `);
          expect(failedReceipts.rows).toEqual([{ count: 28 }]);
          await restoreMigrationFile(fixture.migrationPath, fixture.currentMigrationsFolder);
          await expect(currentPersistence.migrate()).resolves.toBeUndefined();
          await expect(currentPersistence.migrate()).resolves.toBeUndefined();
          const recovered = await currentPersistence.query<{ count: number }>(`
            select count(*)::int as count
            from information_schema.tables
            where table_schema = current_schema()
              and table_name like 'fx_system_tx_journal%'
          `);
          expect(recovered.rows).toEqual([{ count: 4 }]);
          const eventEvidenceColumn = await currentPersistence.query<{
            column_default: string | null;
            is_nullable: string;
          }>(`
            select column_default, is_nullable
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'fx_system_tx_journal'
              and column_name = 'material_write_event_evidence_bytes'
          `);
          expect(eventEvidenceColumn.rows).toHaveLength(1);
          expect(eventEvidenceColumn.rows[0]?.is_nullable).toBe("NO");
          expect(eventEvidenceColumn.rows[0]?.column_default).toContain("0");
          const eventEvidenceCheck = await currentPersistence.query<{
            definition: string;
          }>(`
            select pg_get_constraintdef(constraint_row.oid) as definition
            from pg_constraint constraint_row
            join pg_class relation on relation.oid = constraint_row.conrelid
            join pg_namespace namespace on namespace.oid = relation.relnamespace
            where namespace.nspname = current_schema()
              and relation.relname = 'fx_system_tx_journal'
              and constraint_row.conname =
                'fx_system_tx_journal_material_write_event_evidence_bytes_check'
          `);
          expect(eventEvidenceCheck.rows).toHaveLength(1);
          expect(eventEvidenceCheck.rows[0]?.definition).toContain("67108864");
          const receipts = await currentPersistence.query<{ count: number }>(`
            select count(*)::int as count
            from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations
          `);
          expect(receipts.rows).toEqual([{ count: 29 }]);
        } finally {
          const closing = [
            previousPersistence.close(),
            currentPersistence?.close(),
          ];
          await Promise.allSettled(closing);
          await Promise.all(closing);
        }
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("locks and refuses migration 0076 while legacy relation evidence exists", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-ra01-j", "postgres", "0076_pink_toxin.sql");
    const { migrationsFolder, currentJournal, temporaryJournal } = fixture;

    try {
      await writeJournalThrough(currentJournal, temporaryJournal, 75);

      await withTemporaryPostgresSchema(async databaseOptions => {
        const previous = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder,
        });
        let current:
          | Awaited<ReturnType<typeof createPostgresPersistence>>
          | undefined;
        try {
          const version = await previous.query<{ version: string }>(
            "select version() as version",
          );
          expect(version.rows[0]?.version).toMatch(/^PostgreSQL /);
          await previous.migrate();
          await insertLegacySessionTestScope(previous);
          const session = transactionSessionFixture(
            transactionSessionIdAt(176),
          );
          await insertTransactionSessionFixture(previous, session);
          await insertLegacyOpenTransactionJournalFixture(previous, session);
          await previous.query(`
            insert into fx_system_tx_journal_relation_incoming
              (scope_uuid, session_id, attempt_fence, edge_definition_id,
               target_row_id, observed_adjacency_version,
               created_at, updated_at)
            values
              ($1, $2, 1, 1, decode(repeat('21', 16), 'hex'), 0,
               '2030-01-01T00:00:00.000Z',
               '2030-01-01T00:00:00.000Z')
          `, [session.scopeUuid, session.sessionId]);

          await writeJournalThrough(currentJournal, temporaryJournal, 76);
          current = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder,
          });
          await expect(current.migrate()).rejects.toMatchObject({
            _tag: "InstallationLifecycleError", reason: "resourceFailure", cause: { cause: {
              code: "P0001",
              message: "cannot add active relation selection authority to populated private relation journal evidence",
            } },
          });
          const rejected = await current.query<{
            rows: number;
            new_columns: number;
            receipts: number;
          }>(`
            select
              (select count(*)::int
                 from fx_system_tx_journal_relation_incoming) as rows,
              (select count(*)::int
                 from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'fx_system_tx_journal_relation_incoming'
                  and column_name in
                    ('activation_sequence', 'active_head_sha256'))
                as new_columns,
              (select count(*)::int
                 from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations)
                as receipts
          `);
          expect(rejected.rows).toEqual([{
            rows: 1,
            new_columns: 0,
            receipts: 76,
          }]);

          await current.query(
            "delete from fx_system_tx_journal_relation_incoming",
          );
          await current.migrate();
          await current.migrate();
          const installed = await current.query<{
            new_columns: number;
            receipts: number;
            identity_check: string;
          }>(`
            select
              (select count(*)::int
                 from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'fx_system_tx_journal_relation_incoming'
                  and column_name in
                    ('activation_sequence', 'active_head_sha256'))
                as new_columns,
              (select count(*)::int
                 from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations)
                as receipts,
              (select pg_get_constraintdef(constraint_row.oid)
                 from pg_constraint constraint_row
                 join pg_class relation
                   on relation.oid = constraint_row.conrelid
                 join pg_namespace namespace
                   on namespace.oid = relation.relnamespace
                where namespace.nspname = current_schema()
                  and constraint_row.conname =
                  'fx_system_tx_journal_relation_incoming_identity_check')
                as identity_check
          `);
          expect(installed.rows[0]).toMatchObject({
            new_columns: 2,
            receipts: 77,
          });
          expect(installed.rows[0]?.identity_check).toContain(
            "octet_length(active_head_sha256) = 32",
          );
        } finally {
          await Promise.all([
            previous.close(),
            current?.close(),
          ]);
        }
      });
    } finally {
      await fixture.cleanup();
    }
  }, 120_000);

  it("rolls back a receipt upsert with its root and material writes", async () => {
    await withPostgresPersistence(async (persistence) => {
      await sessionJournalReceiptScenario(persistence, await scenario(persistence, "receipt_upsert"));
    });
  }, 120_000);

  it("serializes same-sequence and ordered adjacent-sequence races with one retained receipt per sequence", async () => {
    await withPostgresPersistence(async (persistence) => {
      const same = await scenario(persistence, "same_sequence");
      const sameRequest = Object.freeze({
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(same.tableId, 1),
      } satisfies SessionJournalPointOperationV1);

      const sameAttempts = await Promise.allSettled([
        runPointOperation(same.store, same.table, sameRequest),
        runPointOperation(same.store, same.table, sameRequest),
      ]);
      const sameResults = sameAttempts.map(attempt => {
        if (attempt.status === "rejected") throw attempt.reason;
        return attempt.value;
      });

      expect(sameResults.map(requireCompletedDelivery).sort()).toEqual([
        "executed",
        "replayed",
      ]);
      for (const result of sameResults) {
        expect(result).toMatchObject({
          kind: "completed",
          outcome: { kind: "missing" },
        });
      }
      await expect(journalCounts(persistence, same.anchor.sessionId))
        .resolves.toEqual({ roots: 1, receipts: 1, points: 1, events: 0 });
      await expect(retainedReceiptSequences(persistence, same.anchor.sessionId))
        .resolves.toEqual(["1"]);

      const entered = deferred<void>();
      const release = deferred<void>();
      let pauseFirstRootLock = false;
      const adjacent = await scenario(persistence, "adjacent_sequence", {
        targetOptions: {
          afterLoadLock: async (step) => {
            if (step !== "attemptTailLocked" || !pauseFirstRootLock) return;
            pauseFirstRootLock = false;
            entered.resolve(undefined);
            await release.promise;
          },
        },
      });
      pauseFirstRootLock = true;
      const firstPromise = runPointOperation(adjacent.store, adjacent.table, {
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(adjacent.tableId, 2),
      });
      const pending = [firstPromise];
      const firstSettled = Promise.allSettled([firstPromise]);
      try {
        await within(
          Promise.race([
            entered.promise,
            firstSettled.then(([attempt]) => {
              if (attempt.status === "rejected") throw attempt.reason;
              throw new Error("First adjacent syscall settled before the root-lock gate.");
            }),
          ]),
          5_000,
          "First adjacent syscall did not acquire the journal root lock.",
        );
        const secondPromise = runPointOperation(adjacent.store, adjacent.table,
          {
            kind: "get",
            syscallSequence: syscallSequence(2n),
            documentId: documentId(adjacent.tableId, 3),
          },
        );
        pending.push(secondPromise);
        const attempts = Promise.allSettled(pending);
        release.resolve(undefined);
        const adjacentResults = (await attempts).map(attempt => {
          if (attempt.status === "rejected") throw attempt.reason;
          return attempt.value;
        });
        expect(adjacentResults.map(requireCompletedDelivery)).toEqual([
          "executed",
          "executed",
        ]);
      } finally {
        release.resolve(undefined);
        await Promise.allSettled(pending);
      }

      await expect(journalCounts(persistence, adjacent.anchor.sessionId))
        .resolves.toEqual({ roots: 1, receipts: 2, points: 2, events: 0 });
      await expect(
        retainedReceiptSequences(persistence, adjacent.anchor.sessionId),
      ).resolves.toEqual(["1", "2"]);
    });
  }, 120_000);

  it("replays a lost insert response without rerunning identity generation", async () => {
    await withPostgresPersistence(async (persistence) => {
      const generatedUuid = "93000000-0000-4000-8000-000000000001";
      let generationCalls = 0;
      const current = await scenario(persistence, "lost_response", {
        randomUuid: () => {
          generationCalls += 1;
          return generatedUuid;
        },
      });
      const request = Object.freeze({
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "durable" },
      } satisfies SessionJournalPointOperationV1);

      const executed = await runPointOperation(current.store, current.table,
        request,
      );
      expect(executed).toMatchObject({
        kind: "completed",
        delivery: "executed",
        outcome: { kind: "inserted" },
      });
      expect(generationCalls).toBe(1);

      let replayGenerationCalled = false;
      const restartedStore = createSessionJournalStorePersistence(
        current.ports,
        {
          grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
          randomUuid: () => {
            replayGenerationCalled = true;
            throw new Error("Lost-response replay requested new randomness.");
          },
        },
      );
      const restartedAttempt = await runEffect(
        restartedStore.openAttemptEffect({
          selector: selectorFromAnchor(current.anchor),
          executionClaim: executionClaimForAnchor(current.anchor),
          snapshotToken: current.anchor.snapshotToken,
          schemaVersionId: current.schemaVersionId,
        }),
      );
      const restartedTable = await runEffect(
        restartedStore.resolvePointTableEffect(restartedAttempt, "users"),
      );
      const replayed = await runPointOperation(restartedStore, restartedTable,
        request,
      );

      if (executed.kind !== "completed") {
        throw new Error("Expected the original insert to complete.");
      }
      expect(replayed).toEqual({ ...executed, delivery: "replayed" });
      expect(replayGenerationCalled).toBe(false);
      await expect(journalCounts(persistence, current.anchor.sessionId))
        .resolves.toEqual({ roots: 1, receipts: 1, points: 1, events: 1 });
    });
  }, 120_000);

  it("rejects the stale execution owner at syscall and seal after takeover", async () => {
    await withPostgresPersistence(async (persistence) => {
      const current = await scenario(persistence, "execution_claim_takeover");
      await persistence.query(
        `update fx_system_tx_execution_claim
         set claimed_at = clock_timestamp() - interval '2 minutes',
             claim_expires_at = clock_timestamp() - interval '1 minute'
         where session_id = $1`,
        [current.anchor.sessionId],
      );
      const acquisition = createPointMutationExecutionClaimAcquisitionV1(
        current.ports,
        {
          durationMilliseconds: 30_000,
          randomOwner: () => "93000000-0000-4000-8000-000000009991",
        },
      );
      await expect(runEffect(acquisition.acquireEffect(
        selectorFromAnchor(current.anchor),
      ))).resolves.toMatchObject({
        kind: "acquired",
        mode: "execute",
        observation: { claimFence: 2n },
      });

      const staleIssue = {
        _tag: "SessionJournalAttemptUnavailableV1Error",
        issue: { reason: "executionClaimUnavailable" },
      } as const;
      await expect(runPointOperation(current.store, current.table, {
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(current.tableId, 991),
      })).rejects.toMatchObject(staleIssue);
      await expect(prepareSeal(current.store, current.attempt)).rejects
        .toMatchObject(staleIssue);
    });
  }, 120_000);

  it("preserves durable accepted work across pre-stage document validation rejection", async () => {
    await withPostgresPersistence(async persistence => {
      await finiteDocumentValidationScenario(persistence, await scenario(persistence, "finite_document_validation", { executionProfile: "durableOperations" }));
    });
  }, 120_000);

  it("refuses durable seal preparation after claim expiry", async () => {
    await withPostgresPersistence(async persistence => {
      const current = await scenario(persistence, "finite_seal_claim_expiry", { executionProfile: "durableOperations" });
      expect(await runPointOperation(current.store, current.table, {
        kind: "insert", syscallSequence: syscallSequence(1n), fields: { name: "tentative" },
      })).toMatchObject({ kind: "completed", delivery: "executed" });
      await expect(journalCounts(persistence, current.anchor.sessionId))
        .resolves.toMatchObject({ receipts: 1, points: 1 });
      await persistence.query(
        `update fx_system_tx_execution_claim
         set claimed_at = clock_timestamp() - interval '2 minutes',
             claim_expires_at = clock_timestamp() - interval '1 minute'
         where session_id = $1`, [current.anchor.sessionId]);
      await expect(prepareSeal(current.store, current.attempt)).rejects.toMatchObject({
        _tag: "SessionJournalAttemptUnavailableV1Error",
        issue: { reason: "executionClaimUnavailable" },
      });
      await expect(journalCounts(persistence, current.anchor.sessionId))
        .resolves.toMatchObject({ receipts: 1, points: 1, events: 1 });
    });
  }, 120_000);

  it("cascades the exact journal evidence through the public abort path", async () => {
    await withPostgresPersistence(async (persistence) => {
      const current = await scenario(persistence, "abort_cleanup", {
        randomUuid: () => "94000000-0000-4000-8000-000000000001",
      });
      await runPointOperation(current.store, current.table, {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "temporary" },
      });
      await expect(journalCounts(persistence, current.anchor.sessionId))
        .resolves.toEqual({ roots: 1, receipts: 1, points: 1, events: 1 });

      const terminalized = await abortPointMutationSessionAttempt(
        createPointMutationSessionAttemptTerminalizationPersistenceV1(
          current.ports,
        ),
        {
          selector: selectorFromAnchor(current.anchor),
          executionClaim: executionClaimForAnchor(current.anchor),
          expectedSnapshotToken: current.anchor.snapshotToken,
        },
      );

      expect(terminalized).toMatchObject({
        status: "terminalized",
        terminal: { lifecycle: "aborted" },
      });
      await expect(attemptCleanupState(persistence, current.anchor.sessionId))
        .resolves.toEqual({
          roots: 0,
          receipts: 0,
          points: 0,
          events: 0,
          sessions: 1,
          leases: 0,
          lifecycle: "aborted",
        });
    });
  }, 120_000);

  it("keeps the activated schema manifest pinned during publication and uses primary-key lookup plans", async () => {
    await withPostgresPersistence(async (persistence) => {
      const current = await scenario(persistence, "pinned_manifest");
      const nextSchemaVersionId = CatalogSchemaVersionIdSchema.make(
        "schema_session_journal_pinned_manifest_v2",
      );

      const publishing = [
        runEffect(
          current.store.resolvePointTableEffect(current.attempt, "users"),
        ),
        persistence.publishAppSchemaV1({
          deploymentId: current.deploymentId,
          schemaVersionId: nextSchemaVersionId,
          version: CatalogSchemaVersionSchema.make(2),
          tables: [appTable("users")],
          indexes: [],
        }),
      ] as const;
      await Promise.allSettled(publishing);
      const [competingTable, nextPublication] = await Promise.all(publishing);
      expect(requirePublishedTableId(nextPublication.manifest, "users"))
        .toBe(current.tableId);

      const pinnedDocumentId = documentId(current.tableId, 4);
      await expect(runPointOperation(current.store, competingTable, {
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId: pinnedDocumentId,
      })).resolves.toMatchObject({
        kind: "completed",
        outcome: { kind: "missing" },
      });
      await expect(runPointOperation(current.store, current.table, {
        kind: "insert",
        syscallSequence: syscallSequence(2n),
        fields: { name: "plan" },
      })).resolves.toMatchObject({ kind: "completed" });

      const pinned = await persistence.query<{
        schema_version_id: string;
      }>(
        `select schema_version_id
         from fx_system_tx_session
         where session_id = $1`,
        [current.anchor.sessionId],
      );
      expect(pinned.rows).toEqual([{
        schema_version_id: current.schemaVersionId,
      }]);

      const namespace = await persistence.query<{
        current_schema: string;
        journal_relation: string | null;
      }>(
        `select current_schema() as current_schema,
                to_regclass('fx_system_tx_journal')::text as journal_relation`,
      );
      expect(namespace.rows[0]?.current_schema).not.toBe("public");
      expect(namespace.rows[0]?.journal_relation).not.toBeNull();

      const root = await journalRootIdentity(
        persistence,
        current.anchor.sessionId,
      );
      const identity = decodeAppDocumentIdentityV1(pinnedDocumentId);
      const plans = await journalLookupPlans(
        persistence,
        root,
        identity.tableId,
        appRowIdHexV1ToBytes(identity.rowId),
      );
      expect(plans.root).toContain("fx_system_tx_journal_pk");
      expect(plans.receipt).toContain("fx_system_tx_journal_receipt_pk");
      expect(plans.point).toContain("fx_system_tx_journal_point_pk");
      expect(plans.events).toContain("fx_system_tx_journal_event_pk");
    });
  }, 120_000);

  it("prepares without retaining locks and canonicalizes near-limit result evidence before short seal revalidation", async () => {
    await withPostgresPersistence(async (persistence) => {
      const lockSteps: string[] = [];
      const current = await scenario(persistence, "two_phase_large_seal", {
        randomUuid: () => "95000000-0000-4000-8000-000000000001",
        targetOptions: {
          afterLoadLock: (step) => {
            lockSteps.push(step);
          },
        },
      });
      await runPointOperation(current.store, current.table, {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "seal" },
      });
      lockSteps.length = 0;

      const digestEntered = deferredSignal();
      const releaseDigest = deferredSignal();
      const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
      let gatedDigest = false;
      const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(
        async (algorithm, data) => {
          if (!gatedDigest) {
            gatedDigest = true;
            digestEntered.resolve();
            await releaseDigest.promise;
          }
          return originalDigest(algorithm, data);
        },
      );
      let preparePromise: ReturnType<typeof prepareSeal> | undefined;
      let prepared: Awaited<ReturnType<typeof prepareSeal>>;
      try {
        const preparing = prepareSeal(current.store, current.attempt);
        preparePromise = preparing;
        const settled = Promise.allSettled([preparing]);
        await Promise.race([
          digestEntered.promise,
          settled.then(([attempt]) => {
            if (attempt.status === "rejected") throw attempt.reason;
            throw new Error("Seal preparation settled before the digest gate.");
          }),
        ]);
        const evidenceLocker = await persistence.pool.connect();
        let evidenceLockOpen = false;
        try {
          await evidenceLocker.query("begin");
          evidenceLockOpen = true;
          await evidenceLocker.query("set local lock_timeout = '2s'");
          await evidenceLocker.query(`
          lock table
            fx_system_tx_journal_receipt,
            fx_system_tx_journal_point,
            fx_system_tx_journal_write_event
          in access exclusive mode nowait
        `);
          await evidenceLocker.query("rollback");
          evidenceLockOpen = false;
        } finally {
          if (evidenceLockOpen) {
            await rollbackAndReleasePostgresClient(evidenceLocker);
          } else {
            evidenceLocker.release();
          }
        }
        releaseDigest.resolve();
        prepared = await preparing;
      } finally {
        releaseDigest.resolve();
        if (preparePromise !== undefined) await Promise.allSettled([preparePromise]);
        digestSpy.mockRestore();
      }
      expect(lockSteps).toEqual([
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "attemptTailLocked",
      ]);

      const resultPayloadBytes = MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1 - 1_024;
      const canonicalJournalPromise = runEffect(
        canonicalizeSessionJournalEffect(prepared.journal),
      );
      const successfulResultPromise = runEffect(
        canonicalizeSuccessfulResultV1Effect(
          new ArrayBuffer(resultPayloadBytes),
        ),
      );

      const canonicalizing = Promise.allSettled([
        canonicalJournalPromise,
        successfulResultPromise,
      ]);
      const pendingReads: Promise<unknown>[] = [];
      let canonicalJournal: Awaited<typeof canonicalJournalPromise>;
      let successfulResult: Awaited<typeof successfulResultPromise>;
      try {
        const locker = await persistence.pool.connect();
        let transactionOpen = false;
        try {
          await locker.query("begin");
          transactionOpen = true;
          await locker.query("set local lock_timeout = '5s'");
          const preparing = [
            locker.query(
            `select session_id
             from fx_system_tx_journal
             where session_id = $1
             for update`,
              [current.anchor.sessionId],
            ),
            canonicalJournalPromise,
            successfulResultPromise,
          ] as const;
          await Promise.allSettled(preparing);
          const [locked, journalEvidence, resultEvidence] = await Promise.all(preparing);
          expect(locked.rowCount).toBe(1);
          canonicalJournal = journalEvidence;
          successfulResult = resultEvidence;
          expect(successfulResult.semanticSizeBytes).toBe(
            resultPayloadBytes + 2,
          );

          const reading = persistence.query(
            `select state
             from fx_system_tx_journal
             where session_id = $1`,
            [current.anchor.sessionId],
          );
          pendingReads.push(reading);
          await expect(within(
            reading,
            5_000,
            "Independent journal read was blocked by seal preparation.",
          )).resolves.toMatchObject({ rows: [{ state: "open" }] });

          await locker.query("rollback");
          transactionOpen = false;
        } finally {
          if (transactionOpen) {
            await rollbackAndReleasePostgresClient(locker);
          } else {
            locker.release();
          }
        }
      } finally {
        await canonicalizing;
        await Promise.allSettled(pendingReads);
      }

      lockSteps.length = 0;
      const envelope = await completeSeal(current.store,
        prepared.preparation,
        canonicalJournal,
        successfulResult,
      );
      expect(envelope).toMatchObject({
        sessionId: current.anchor.sessionId,
        finalSyscallSequence: 1n,
        journal: { kind: "storedForSessionAttempt" },
      });
      expect(lockSteps).toEqual([
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "attemptTailLocked",
      ]);

      const sealed = await persistence.query<{
        state: string;
        sealed_result_semantic_bytes: number;
        sealed_result_octets: number;
        lease_expires_at: Date;
        authorization_grant_expires_at: Date;
        hard_expires_at: Date;
      }>(
        `select root.state,
                root.sealed_result_semantic_bytes,
                octet_length(root.sealed_result_bytes)::int
                  as sealed_result_octets,
                lease.lease_expires_at,
                session.authorization_grant_expires_at,
                session.hard_expires_at
         from fx_system_tx_journal root
         join fx_system_snapshot_lease lease
           on lease.scope_uuid = root.scope_uuid
          and lease.session_id = root.session_id
          and lease.attempt_fence = root.attempt_fence
         join fx_system_tx_session session
           on session.scope_uuid = root.scope_uuid
          and session.session_id = root.session_id
          and session.attempt_fence = root.attempt_fence
         where root.session_id = $1`,
        [current.anchor.sessionId],
      );
      expect(sealed.rows).toHaveLength(1);
      expect(sealed.rows[0]).toMatchObject({
        state: "sealed",
        sealed_result_semantic_bytes: resultPayloadBytes + 2,
        sealed_result_octets: successfulResult.canonicalBytes.byteLength,
      });
      const sealedRow = sealed.rows[0];
      if (sealedRow === undefined) throw new Error("Missing sealed row.");
      expect(sealedRow.lease_expires_at.getTime()).toBe(Math.min(
        sealedRow.authorization_grant_expires_at.getTime(),
        sealedRow.hard_expires_at.getTime(),
      ));
    });
  }, 180_000);

  it("atomically promotes the exact lease, replays without writes, and rolls back every seal phase", async () => {
    await withPostgresPersistence(async (persistence) => {
      const concurrent = await scenario(
        persistence,
        "atomic_lease_promotion",
      );
      const shortened = await persistence.query<{ hard_expires_at: Date }>(
        `
          update fx_system_tx_session
          set hard_expires_at = clock_timestamp() + interval '30 minutes'
          where session_id = $1
          returning hard_expires_at
        `,
        [concurrent.anchor.sessionId],
      );
      const hardExpiresAt = shortened.rows[0]?.hard_expires_at;
      if (hardExpiresAt === undefined) {
        throw new Error("Expected a shortened hard expiry.");
      }
      const firstPrepared = await prepareSeal(
        concurrent.store,
        concurrent.attempt,
      );
      const secondPrepared = await prepareSeal(
        concurrent.store,
        concurrent.attempt,
      );
      const canonicalizing = [
        runEffect(canonicalizeSessionJournalEffect(firstPrepared.journal)),
        runEffect(canonicalizeSessionJournalEffect(secondPrepared.journal)),
        runEffect(canonicalizeSuccessfulResultV1Effect({ ok: true })),
      ] as const;
      await Promise.allSettled(canonicalizing);
      const [firstJournal, secondJournal, successfulResult] = await Promise.all(canonicalizing);

      const completing = [
        completeSeal(
          concurrent.store,
          firstPrepared.preparation,
          firstJournal,
          successfulResult,
        ),
        completeSeal(
          concurrent.store,
          secondPrepared.preparation,
          secondJournal,
          successfulResult,
        ),
      ] as const;
      await Promise.allSettled(completing);
      const [firstEnvelope, secondEnvelope] = await Promise.all(completing);
      expect(secondEnvelope).toEqual(firstEnvelope);
      const sealed = await attemptLeaseAndSealState(
        persistence,
        concurrent.anchor.sessionId,
      );
      expect(sealed.root_state).toBe("sealed");
      expect(sealed.lease_expires_at.getTime()).toBe(hardExpiresAt.getTime());
      expect(sealed.authorization_grant_expires_at.getTime()).toBeGreaterThan(
        hardExpiresAt.getTime(),
      );

      const replayPrepared = await prepareSeal(
        concurrent.store,
        concurrent.attempt,
      );
      await expect(completeSeal(
        concurrent.store,
        replayPrepared.preparation,
        await runEffect(canonicalizeSessionJournalEffect(
          replayPrepared.journal,
        )),
        successfulResult,
      )).resolves.toEqual(firstEnvelope);
      const replayed = await attemptLeaseAndSealState(
        persistence,
        concurrent.anchor.sessionId,
      );
      expect(replayed.lease_xmin).toBe(sealed.lease_xmin);
      expect(replayed.root_xmin).toBe(sealed.root_xmin);

      const mismatchPrepared = await prepareSeal(
        concurrent.store,
        concurrent.attempt,
      );
      const mismatchJournal = await runEffect(
        canonicalizeSessionJournalEffect(mismatchPrepared.journal),
      );
      await persistence.query(
        `
          update fx_system_snapshot_lease
          set lease_expires_at = lease_expires_at - interval '1 second'
          where session_id = $1
        `,
        [concurrent.anchor.sessionId],
      );
      await expect(runFailure(concurrent.store.completeSealEffect(
        mismatchPrepared.preparation,
        mismatchJournal,
        successfulResult,
      ))).resolves.toMatchObject({ reason: "snapshotLeaseInvalid" });

      await persistence.query(
        `
          update fx_system_snapshot_lease
          set lease_expires_at = clock_timestamp() - interval '1 second'
          where session_id = $1
        `,
        [concurrent.anchor.sessionId],
      );
      await expect(runFailure(concurrent.store.completeSealEffect(
        mismatchPrepared.preparation,
        mismatchJournal,
        successfulResult,
      ))).resolves.toMatchObject({ reason: "snapshotLeaseInvalid" });

      const oneMillisecondPolicy = Result.getOrThrow(
        makeGrantRetentionPolicyV1Result({
          maximumGrantLifetimeMilliseconds: 1,
          maximumFutureIssuedAtSkewMilliseconds: 0,
          maximumLiveSnapshotRetentionMilliseconds: 1,
        }),
      );
      const overBudget = await scenario(persistence, "retention_overrun", {
        grantRetentionPolicy: oneMillisecondPolicy,
      });
      const overBudgetPrepared = await prepareSeal(
        overBudget.store,
        overBudget.attempt,
      );
      const beforeOverrun = await attemptLeaseAndSealState(
        persistence,
        overBudget.anchor.sessionId,
      );
      await expect(runFailure(overBudget.store.completeSealEffect(
        overBudgetPrepared.preparation,
        await runEffect(canonicalizeSessionJournalEffect(
          overBudgetPrepared.journal,
        )),
        successfulResult,
      ))).resolves.toMatchObject({
        issue: {
          kind: "retentionBudgetExceeded",
          maximumLiveSnapshotRetentionMilliseconds: 1,
        },
      });
      const afterOverrun = await attemptLeaseAndSealState(
        persistence,
        overBudget.anchor.sessionId,
      );
      expect(afterOverrun.root_state).toBe("open");
      expect(afterOverrun.lease_expires_at.getTime()).toBe(
        beforeOverrun.lease_expires_at.getTime(),
      );

      for (const phase of ["before", "after"] as const) {
        const rollback = await scenario(
          persistence,
          `atomic_rollback_${phase}`,
        );
        const prepared = await prepareSeal(rollback.store, rollback.attempt);
        const journal = await runEffect(
          canonicalizeSessionJournalEffect(prepared.journal),
        );
        const before = await attemptLeaseAndSealState(
          persistence,
          rollback.anchor.sessionId,
        );
        await installRejectSealTrigger(persistence, phase);
        try {
          await expect(runFailure(rollback.store.completeSealEffect(
            prepared.preparation,
            journal,
            successfulResult,
          ))).resolves.toMatchObject({
            operation: "completeSealTransaction",
          });
        } finally {
          await removeRejectSealTrigger(persistence, phase);
        }
        const rolledBack = await attemptLeaseAndSealState(
          persistence,
          rollback.anchor.sessionId,
        );
        expect(rolledBack.root_state).toBe("open");
        expect(rolledBack.lease_expires_at.getTime()).toBe(
          before.lease_expires_at.getTime(),
        );

        await expect(completeSeal(
          rollback.store,
          prepared.preparation,
          journal,
          successfulResult,
        )).resolves.toMatchObject({ sessionId: rollback.anchor.sessionId });
        const retried = await attemptLeaseAndSealState(
          persistence,
          rollback.anchor.sessionId,
        );
        expect(retried.root_state).toBe("sealed");
        expect(retried.lease_expires_at.getTime()).toBe(Math.min(
          retried.authorization_grant_expires_at.getTime(),
          retried.hard_expires_at.getTime(),
        ));
      }
    });
  }, 180_000);

  it("holds interruption until the atomic lease promotion and seal settle", async () => {
    await withPostgresPersistence(async (persistence) => {
      const entered = deferredSignal();
      const release = deferredSignal();
      let pauseCompletion = false;
      const current = await scenario(
        persistence,
        "atomic_promotion_interruption",
        {
          targetOptions: {
            afterLoadLock: async (step) => {
              if (step !== "attemptTailLocked" || !pauseCompletion) return;
              pauseCompletion = false;
              entered.resolve();
              await release.promise;
            },
          },
        },
      );
      const prepared = await prepareSeal(current.store, current.attempt);
      const journal = await runEffect(
        canonicalizeSessionJournalEffect(prepared.journal),
      );
      const successfulResult = await runEffect(
        canonicalizeSuccessfulResultV1Effect({ ok: true }),
      );
      pauseCompletion = true;
      const fiber = Effect.runFork(current.store.completeSealEffect(
        prepared.preparation,
        journal,
        successfulResult,
      ));

      const completion = runEffect(Fiber.await(fiber));
      let interruptionSettled = false;
      try {
        await Promise.race([
          entered.promise,
          completion.then(exit => {
            throw new Error("Seal completion settled before the interruption gate.", { cause: exit });
          }),
        ]);
        const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
          interruptionSettled = true;
          return exit;
        });
        try {
          await delay(25);
          expect(interruptionSettled).toBe(false);
        } finally {
          release.resolve();
          await interruption;
        }
      } finally {
        release.resolve();
        await runEffect(Fiber.interrupt(fiber));
        await completion;
      }
      const settled = await attemptLeaseAndSealState(
        persistence,
        current.anchor.sessionId,
      );
      expect(settled.root_state).toBe("sealed");
      expect(settled.lease_expires_at.getTime()).toBe(Math.min(
        settled.authorization_grant_expires_at.getTime(),
        settled.hard_expires_at.getTime(),
      ));
    });
  }, 180_000);

  it("enforces nullable evidence checks and the material-event byte bound in real Postgres", async () => {
    await withPostgresPersistence(async (persistence) => {
      const point = await scenario(persistence, "nullable_point", {
        randomUuid: () => "96000000-0000-4000-8000-000000000001",
      });
      await runPointOperation(point.store, point.table, {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "point" },
      });
      await persistence.query(
        `
          update fx_system_tx_journal_point
          set dependency_kind = 'present',
              dependency_revision_commit_seq = 1
          where session_id = $1
        `,
        [point.anchor.sessionId],
      );
      await expect(persistence.query(
        `
          update fx_system_tx_journal_point
          set dependency_revision_commit_seq = null
          where session_id = $1 and dependency_kind = 'present'
        `,
        [point.anchor.sessionId],
      )).rejects.toThrow();
      await persistence.query(
        `
          update fx_system_tx_journal_point
          set dependency_kind = 'missing_tombstone',
              dependency_revision_commit_seq = 1
          where session_id = $1
        `,
        [point.anchor.sessionId],
      );
      await expect(persistence.query(
        `
          update fx_system_tx_journal_point
          set dependency_revision_commit_seq = null
          where session_id = $1 and dependency_kind = 'missing_tombstone'
        `,
        [point.anchor.sessionId],
      )).rejects.toThrow();
      const liveOverlayColumns = [
        "overlay_creation_time",
        "overlay_value_codec_version",
        "overlay_value_json",
        "overlay_value_bytes",
        "overlay_value_sha256",
        "overlay_semantic_bytes",
      ] as const;
      for (const column of liveOverlayColumns) {
        await expect(persistence.query(
          `
            update fx_system_tx_journal_point
            set ${column} = null
            where session_id = $1 and overlay_kind = 'live'
          `,
          [point.anchor.sessionId],
        )).rejects.toThrow();
      }

      const sealed = await scenario(persistence, "nullable_sealed", {
        randomUuid: () => "96000000-0000-4000-8000-000000000002",
      });
      await runPointOperation(sealed.store, sealed.table, {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "sealed" },
      });
      const prepared = await prepareSeal(sealed.store, sealed.attempt);
      await completeSeal(sealed.store,
        prepared.preparation,
        await runEffect(canonicalizeSessionJournalEffect(prepared.journal)),
        await runEffect(canonicalizeSuccessfulResultV1Effect({ ok: true })),
      );
      const sealedNullableColumns = [
        "sealed_journal_bytes",
        "sealed_journal_sha256",
        "sealed_result_value_codec_version",
        "sealed_result_semantic_bytes",
        "sealed_result_bytes",
        "sealed_result_sha256",
        "sealed_at",
      ] as const;
      for (const column of sealedNullableColumns) {
        await expect(persistence.query(
          `
            update fx_system_tx_journal
            set ${column} = null
            where session_id = $1
          `,
          [sealed.anchor.sessionId],
        )).rejects.toThrow();
      }

      const bounds = await scenario(persistence, "event_evidence_bounds");
      await expect(persistence.query(
        `
          update fx_system_tx_journal
          set material_write_event_evidence_bytes = $2
          where session_id = $1
        `,
        [
          bounds.anchor.sessionId,
          MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
        ],
      )).resolves.toBeDefined();
      for (const invalid of [
        -1,
        MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 + 1,
      ]) {
        await expect(persistence.query(
          `
            update fx_system_tx_journal
            set material_write_event_evidence_bytes = $2
            where session_id = $1
          `,
          [bounds.anchor.sessionId, invalid],
        )).rejects.toThrow();
      }
    });
  }, 120_000);
});

async function scenario(
  persistence: PostgresFlarexPersistence,
  label: string,
  options: ScenarioOptions = {},
): Promise<JournalScenario> {
  const infrastructureIds = uuidFactory("91000000");
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_session_journal_postgres_${label}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_session_journal_postgres_${label}`,
  );
  const locator = sharedLocator(`session-journal-${label}`);
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator: locator, randomUuid: infrastructureIds },
  ).ensure({
    deploymentId,
    projectId: `project_session_journal_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  const publication = await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [],
  });
  const tableId = requirePublishedTableId(publication.manifest, "users");
  const ports = resolutionPorts(persistence, options.targetOptions);
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      ports,
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid: infrastructureIds,
      },
    ),
    Object.freeze({ ...pointMutationSessionActivationFixture(
      deploymentId,
      scopeId,
      { evidence: { schemaVersionId } },
    ), ...(options.executionProfile === undefined ? {} : { executionProfile: options.executionProfile }) }),
  );
  const store = createSessionJournalStorePersistence(ports, {
    grantRetentionPolicy:
      options.grantRetentionPolicy ?? TEST_GRANT_RETENTION_POLICY_V1,
    ...(options.randomUuid === undefined
      ? {}
      : { randomUuid: options.randomUuid }),
  });
  const attempt = await runEffect(
    store.openAttemptEffect({
      selector: selectorFromAnchor(activation.anchor),
      executionClaim: executionClaimForAnchor(activation.anchor),
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
      ...(options.executionProfile === undefined ? {} : { executionProfile: options.executionProfile }),
    }),
  );
  const table = await runEffect(
    store.resolvePointTableEffect(attempt, "users"),
  );
  return Object.freeze({
    deploymentId,
    schemaVersionId,
    tableId,
    anchor: activation.anchor,
    ports,
    store,
    attempt,
    table,
    schemaManifest: publication.manifest,
  });
}

async function attemptLeaseAndSealState(
  persistence: PostgresFlarexPersistence,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
): Promise<AttemptLeaseAndSealState> {
  const result = await persistence.query<AttemptLeaseAndSealState>(
    `
      select root.state as root_state,
             lease.lease_expires_at,
             session.authorization_grant_expires_at,
             session.hard_expires_at,
             lease.xmin::text as lease_xmin,
             root.xmin::text as root_xmin
      from fx_system_tx_session session
      join fx_system_snapshot_lease lease
        on lease.scope_uuid = session.scope_uuid
       and lease.session_id = session.session_id
       and lease.attempt_fence = session.attempt_fence
      join fx_system_tx_journal root
        on root.scope_uuid = session.scope_uuid
       and root.session_id = session.session_id
       and root.attempt_fence = session.attempt_fence
      where session.session_id = $1
    `,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined || result.rows.length !== 1) {
    throw new Error("Expected one exact-attempt lease/seal state row.");
  }
  return row;
}

async function installRejectSealTrigger(
  persistence: PostgresFlarexPersistence,
  phase: "before" | "after",
): Promise<void> {
  const functionName = `fx_test_reject_seal_${phase}`;
  const triggerName = `fx_test_reject_seal_${phase}_trigger`;
  await persistence.query(
    `
      create or replace function ${functionName}()
      returns trigger
      language plpgsql
      as $$
      begin
        if old.state = 'open' and new.state = 'sealed' then
          raise exception 'reject seal ${phase}';
        end if;
        return new;
      end;
      $$
    `,
  );
  await persistence.query(
    `
      create trigger ${triggerName}
      ${phase} update on fx_system_tx_journal
      for each row execute function ${functionName}()
    `,
  );
}

async function removeRejectSealTrigger(
  persistence: PostgresFlarexPersistence,
  phase: "before" | "after",
): Promise<void> {
  const functionName = `fx_test_reject_seal_${phase}`;
  const triggerName = `fx_test_reject_seal_${phase}_trigger`;
  await persistence.query(
    `drop trigger if exists ${triggerName} on fx_system_tx_journal`,
  );
  await persistence.query(`drop function if exists ${functionName}()`);
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): PointMutationSessionAuthorityResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared journal resolution must not read receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
          targetOptions,
        ),
    },
  };
}

function selectorFromAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

function syscallSequence(value: bigint) {
  return CommitSyscallSequenceV1Schema.make(value);
}

function documentId(
  tableId: CatalogTableId,
  suffix: number,
): AppDocumentIdV1 {
  return decodeAppDocumentIdV1(
    `${tableId}:92000000-0000-4000-8000-${suffix
      .toString()
      .padStart(12, "0")}`,
  );
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: true,
          },
        },
      },
    },
  };
}

function requirePublishedTableId(
  manifest: Readonly<{
    readonly tableDefinitions: Readonly<{
      readonly tables: ReadonlyArray<Readonly<{
        readonly logicalName: string;
        readonly tableId: CatalogTableId;
      }>>;
    }>;
  }>,
  logicalName: string,
): CatalogTableId {
  const table = manifest.tableDefinitions.tables.find(
    (candidate) => candidate.logicalName === logicalName,
  );
  if (table === undefined) {
    throw new Error(`Missing published table ${logicalName}.`);
  }
  return table.tableId;
}

function sharedLocator(
  databaseKey: string,
): SharedDatabaseScopePhysicalLocator {
  return Object.freeze({
    kind: "shared_database",
    databaseKey,
    schemaName: "public",
  });
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function uuidFactory(prefix: string): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}

function requireCompletedDelivery(
  result: RunSessionJournalPointOperationV1Result,
): "executed" | "replayed" {
  if (result.kind !== "completed") {
    throw new Error(`Expected completed result, received ${result.kind}.`);
  }
  return result.delivery;
}

async function journalCounts(
  persistence: PostgresFlarexPersistence,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
): Promise<JournalCounts> {
  const result = await persistence.query<JournalCounts>(
    `select
       (select count(*)::int from fx_system_tx_journal
         where session_id = $1) as roots,
       (select count(*)::int from fx_system_tx_journal_receipt
         where session_id = $1) as receipts,
       (select count(*)::int from fx_system_tx_journal_point
         where session_id = $1) as points,
       (select count(*)::int from fx_system_tx_journal_write_event
         where session_id = $1) as events`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing journal count row.");
  return row;
}

async function retainedReceiptSequences(
  persistence: PostgresFlarexPersistence,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
): Promise<readonly string[]> {
  const rows = await persistence.drizzle.select({
    lastSyscallSequence: fxSystemTransactionJournalReceipts.lastSyscallSequence,
  }).from(fxSystemTransactionJournalReceipts)
    .where(eq(fxSystemTransactionJournalReceipts.sessionId, sessionId))
    .orderBy(asc(fxSystemTransactionJournalReceipts.lastSyscallSequence));
  if (rows.length === 0) throw new Error("Missing retained journal receipts.");
  return rows.map(row => String(row.lastSyscallSequence));
}

async function attemptCleanupState(
  persistence: PostgresFlarexPersistence,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
): Promise<AttemptCleanupState> {
  const result = await persistence.query<AttemptCleanupState>(
    `select
       (select count(*)::int from fx_system_tx_journal
         where session_id = $1) as roots,
       (select count(*)::int from fx_system_tx_journal_receipt
         where session_id = $1) as receipts,
       (select count(*)::int from fx_system_tx_journal_point
         where session_id = $1) as points,
       (select count(*)::int from fx_system_tx_journal_write_event
         where session_id = $1) as events,
       (select count(*)::int from fx_system_tx_session
         where session_id = $1) as sessions,
       (select count(*)::int from fx_system_snapshot_lease
         where session_id = $1) as leases,
       (select lifecycle from fx_system_tx_session
         where session_id = $1) as lifecycle`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing attempt cleanup row.");
  return row;
}

async function journalRootIdentity(
  persistence: PostgresFlarexPersistence,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
): Promise<JournalRootIdentity> {
  const result = await persistence.query<JournalRootIdentity>(
    `select scope_uuid::text,
            session_id::text,
            attempt_fence::text
     from fx_system_tx_journal
     where session_id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing journal root identity.");
  return row;
}

async function journalLookupPlans(
  persistence: PostgresFlarexPersistence,
  root: JournalRootIdentity,
  tableId: CatalogTableId,
  rowId: Uint8Array,
): Promise<Readonly<{
  root: string;
  receipt: string;
  point: string;
  events: string;
}>> {
  return withPostgresSequentialScansDisabled(persistence, async (planner) => {
    const common = [root.scope_uuid, root.session_id, root.attempt_fence];
    const rootPlan = await explain(
      planner,
      `select state from fx_system_tx_journal
       where scope_uuid = $1::uuid
         and session_id = $2::uuid
         and attempt_fence = $3::bigint`,
      common,
    );
    const receiptPlan = await explain(
      planner,
      `select outcome_kind from fx_system_tx_journal_receipt
       where scope_uuid = $1::uuid
         and session_id = $2::uuid
         and attempt_fence = $3::bigint`,
      common,
    );
    const pointPlan = await explain(
      planner,
      `select dependency_kind from fx_system_tx_journal_point
       where scope_uuid = $1::uuid
         and session_id = $2::uuid
         and attempt_fence = $3::bigint
         and table_id = $4
         and row_id = $5`,
      [...common, tableId, rowId],
    );
    const eventPlan = await explain(
      planner,
      `select event_bytes from fx_system_tx_journal_write_event
       where scope_uuid = $1::uuid
         and session_id = $2::uuid
         and attempt_fence = $3::bigint
       order by syscall_sequence`,
      common,
    );
    return Object.freeze({
      root: rootPlan,
      receipt: receiptPlan,
      point: pointPlan,
      events: eventPlan,
    });
  });
}

async function explain(
  client: {
    query(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
  },
  query: string,
  params: readonly unknown[],
): Promise<string> {
  const result = await client.query(`explain (format json) ${query}`, params);
  return JSON.stringify(result.rows);
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolver: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      if (resolver === undefined) {
        throw new Error("Deferred resolver is unavailable.");
      }
      resolver(value);
    },
  };
}

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function deferredSignal(): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}> {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => {
      resolvePromise?.();
    },
  });
}
