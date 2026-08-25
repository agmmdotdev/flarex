import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { eq } from "drizzle-orm";
import { Effect, Exit, Fiber, Result } from "effect";
import type { PoolClient } from "pg";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
  IndexBuildAttemptFenceSchema,
} from "flarex-protocol/index-build-state";
import {
  CommitSyscallSequenceV1Schema,
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
  type LogicalIndexRangeReadDependencyV1,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  SchemaManifestAppIndexDescriptorSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  encodeAppOrderedIndexKeyV1,
  decodeOrderedIndexRowIdHexV1,
  ORDERED_INDEX_MISSING_V1,
  orderedIndexCreationTimeV1,
  orderedIndexBoundHexV1ToBytes,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexRowIdHexV1ToBytes,
  orderedIndexValueFromFlarexValueV1,
} from "flarex-protocol/ordered-index";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  decodeReplacementScopeIdV1,
  projectScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../src/appRows";
import {
  createAppSchemaCandidateValidationPortForPointCommitAuthority,
  createAppSchemaCandidateWriteGuardPort,
  installAppSchemaCandidateValidationEffect,
  loadAppSchemaCandidateValidationEffect,
} from "../src/appSchemaCandidateValidation";
import {
  appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult,
} from "../src/appIndexEntries";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
  createIntrinsicCreationTimeIndexDefinitionPortV1,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import {
  createAppDeveloperIndexDefinitionPortV1,
  lowerAppDeveloperIndexKeyV1,
} from
  "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from
  "../src/appUniqueConstraintCommitV1";
import {
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
} from "../src/appUniqueConstraintDefinitions";
import { AppUniqueKeyConflictError } from "../src/appUniqueKeys";
import { reconcilePublishedIndexBuildsV1Effect } from
  "../src/indexBuildReconciliation";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointMutationAttemptReplacementPortV1,
  createPointCommitPublisherPortV1,
  createPointCommitRollbackProofPortV1,
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  PointCommitDecisionUncertainV1Error,
  PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
  PointCommitSqlErrorV1,
  PointCommitStaleAuthorityV1Error,
  PointMutationAttemptReplacementCommittedOutcomeV1Error,
  PointMutationAttemptReplacementCorruptionV1Error,
  type PointMutationAttemptReplacementCommandV1,
  type PointMutationAttemptReplacementOptionsV1,
  type PointMutationAttemptReplacementSqlOperationV1,
  type PointCommitSqlOperationV1,
  type PointCommitPublicationCommandV1,
  type PointCommitTransactionCommandV1,
  type PointCommitTransactionProofOptionsV1,
  type PointCommitTransactionProofStepV1,
} from "../src/pointCommitTransaction";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
  type PostgresLocatedReadCommittedRunnerOptionsV1,
} from "../src/postgresLocatedReadCommitted";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedIndexBuildReconciliationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  createAppDeveloperIndexQueryPortV1,
  createSessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  createLocatedPointMutationSessionActivationTargetV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  LOCATED_READ_COMMITTED_RUNNER_V1,
  LocatedReadCommittedTransactionFailureV1,
} from "../src/transactionSessionAttemptKernel";
import {
  pointCommitCommandFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "./pointCommitTransactionTestSupport";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
  withPostgresSequentialScansDisabled,
} from "./postgresHelpers";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "./effectTestRuntime";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  activatePointMutationSession,
  executionClaimForAnchor,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPostgresPersistence = useFileScopedPostgresPersistence();

describePostgres("real Postgres O06 point-commit transaction kernel", () => {
  it("masks interruption until forced rollback settles and exposes no tentative state", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96000000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "rollback_settlement",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "rollback_settlement",
      );
      const before = await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      let interruptionSettled = false;
      const fiber = Effect.runFork(
        createPort(persistence, {
          afterTransactionStep: async (event) => {
            if (event.step !== "beforeRollback") return;
            entered.resolve();
            await release.promise;
          },
        }).prove(attempt.command),
      );
      await entered.promise;

      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual(before);
      const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
        interruptionSettled = true;
        return exit;
      });
      await delay(25);
      expect(interruptionSettled).toBe(false);
      release.resolve();
      await interruption;
      expect(interruptionSettled).toBe(true);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual(before);

      const steps: string[] = [];
      const queries = new Map<
        PointCommitSqlOperationV1,
        Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
      >();
      const result = await runEffect(createPort(persistence, {
        afterTransactionStep: (event) => {
          steps.push(event.step);
          return Promise.resolve();
        },
        observeQuery: (query) => {
          queries.set(query.name, query);
        },
      }).prove(attempt.command));
      expect(result).toEqual({ kind: "wouldCommit" });
      expect(Object.isFrozen(result)).toBe(true);
      expect(steps).toEqual([
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
        "dependenciesValidated",
        "tentativeRowWritten",
        "beforeRollback",
      ]);
      expect([...queries.keys()]).toEqual([
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
        "readDatabaseTime",
        "loadRowHeads",
      ]);
      const sessionQuery = requireObservedQuery(queries, "lockSession");
      expect(sessionQuery.sql).not.toContain("validated_args_json");
      expect(sessionQuery.sql).not.toContain("authorization_grant_json");
      for (const name of [
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
      ] as const) {
        expect(await explainObserved(persistence, requireObservedQuery(
          queries,
          name,
        ))).toContain("Index Scan");
      }
      await expectSequentialScansEnabled(persistence);
    });
  }, 120_000);

  it("serializes one scope while an independent scope completes", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96100000");
      const firstScope = await createScope(
        persistence,
        randomUuid,
        "serialized_a",
      );
      const independentScope = await createScope(
        persistence,
        randomUuid,
        "serialized_b",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "serialized_a1",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "serialized_a2",
      );
      const independent = await createAttempt(
        persistence,
        randomUuid,
        independentScope,
        "serialized_b1",
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const order: string[] = [];
      const firstPromise = runEffect(createPort(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          order.push("first-clock");
          entered.resolve();
          await release.promise;
        },
      }).prove(first.command));
      await entered.promise;
      const secondPromise = runEffect(createPort(persistence, {
        afterTransactionStep: (event) => {
          if (event.step === "clockLocked") order.push("second-clock");
          return Promise.resolve();
        },
      }).prove(second.command));
      await waitForBlockedPointCommit(persistence, 1);

      await withTimeout(
        runEffect(createPort(persistence).prove(independent.command)),
        5_000,
        "independent O06 scope",
      );
      expect(order).toEqual(["first-clock"]);
      release.resolve();
      await Promise.all([firstPromise, secondPromise]);
      expect(order).toEqual(["first-clock", "second-clock"]);
      expect(await durableState(
        persistence,
        first.command.sealIdentity.scopeUuid,
      )).toMatchObject({ revisions: "0", last_commit_seq: "0" });
      expect(await durableState(
        persistence,
        independent.command.sealIdentity.scopeUuid,
      )).toMatchObject({ revisions: "0", last_commit_seq: "0" });
    });
  }, 120_000);

  it("linearizes revocation after the rollback and rejects detached stale authority", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96200000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "revocation_race",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "revocation_race",
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const proof = runEffect(createPort(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          entered.resolve();
          await release.promise;
        },
      }).prove(attempt.command));
      await entered.promise;
      let revocationSettled = false;
      const revocation = persistence.query(
        `
          update fx_system_scope_clock
          set authorization_revocation_epoch =
            authorization_revocation_epoch + 1
          where scope_uuid = $1
        `,
        [attempt.command.sealIdentity.scopeUuid],
      ).then(() => {
        revocationSettled = true;
      });
      try {
        await waitForBlockedPointCommit(persistence, 1);
        expect(revocationSettled).toBe(false);
      } finally {
        release.resolve();
      }
      await proof;
      await revocation;

      const failure = await runFailure(
        createPort(persistence).prove(attempt.command),
      );
      expect(failure).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
      expect(failure).toMatchObject({ reason: "revocationEpochChanged" });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({ revisions: "0", last_commit_seq: "0" });
    });
  }, 120_000);

  it("observes a competing committed row after the clock wait as an OCC conflict", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96300000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "occ_race",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "occ_race",
      );
      const writerLocked = deferredSignal();
      const releaseWriter = deferredSignal();
      const writer = commitCompetingPointRow(
        persistence,
        attempt.command,
        writerLocked,
        releaseWriter,
      );
      await writerLocked.promise;
      const proofFailure = runFailure(
        createPort(persistence).prove(attempt.command),
      );
      await waitForBlockedPointCommit(persistence, 1);
      releaseWriter.resolve();
      await writer;
      const failure = await proofFailure;
      expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        last_commit_seq: "1",
      });
      const plan = await explainHeadLookup(persistence, attempt.command);
      expect(plan).toContain("Index Scan");
      expect(plan).toContain("fx_app_row_current");
      expect(plan).toContain("fx_app_row_rev");
    });
  }, 120_000);

  it("detects an indexed phantom through the commit-range index", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96310000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "indexed_occ",
        true,
      );
      const attempt = await createIndexedAttempt(
        persistence,
        randomUuid,
        scope,
        "indexed_occ",
      );
      const inserted = await commitCompetingIndexedUser(
        persistence,
        scope,
        attempt,
        "22".repeat(16),
      );
      const failure = await runFailure(createPort(
        persistence,
        await prepareDeveloperIndexForPostgres(persistence, scope),
      ).prove(attempt.command));
      expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
      expect(failure).toMatchObject({
        conflict: {
          kind: "appIndexRange",
          reason: "overlap",
          dependencyOrdinal: 0,
          tableId: decodeCatalogTableId(1),
          indexDefinitionId: attempt.definition.indexDefinitionId,
          encodedKey: inserted.encodedKey,
          rowId: decodeOrderedIndexRowIdHexV1(inserted.rowId),
        },
        snapshotCommitSeq: CommitSeqSchema.make(0n),
        currentCommitSeq: CommitSeqSchema.make(1n),
      });
      const plan = await explainIndexRangeOccLookup(
        persistence,
        attempt.command,
      );
      expect(plan).toContain("fx_app_index_entry_rev_commit_range_idx");
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        last_commit_seq: "1",
      });
    });
  }, 120_000);

  it("publishes material and zero-row successes with complete atomic evidence", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96400000");
      const materialScope = await createScope(
        persistence,
        randomUuid,
        "publish_material",
      );
      const material = await createAttempt(
        persistence,
        randomUuid,
        materialScope,
        "publish_material",
      );
      const published = await runEffect(
        createPublisher(persistence).publish(material.publicationCommand),
      );
      expect(published).toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
        successfulResult: { valueJson: { ok: true } },
      });
      expect(await durableState(
        persistence,
        material.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      expect(await terminalPublicationState(
        persistence,
        material.command.sealIdentity.scopeUuid,
        material.anchor.sessionId,
      )).toEqual({
        lifecycle: "committed",
        leases: "0",
        journals: "0",
        change_count: 1,
        delivery_state: "pending",
        same_initial_time: true,
      });

      const zeroScope = await createScope(
        persistence,
        randomUuid,
        "publish_zero",
      );
      const zero = await createAttempt(
        persistence,
        randomUuid,
        zeroScope,
        "publish_zero",
        false,
      );
      await runEffect(
        createPublisher(persistence).publish(zero.publicationCommand),
      );
      expect(await durableState(
        persistence,
        zero.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "1",
        commit_changes: "0",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      expect(await terminalPublicationState(
        persistence,
        zero.command.sealIdentity.scopeUuid,
        zero.anchor.sessionId,
      )).toMatchObject({ change_count: 0, lifecycle: "committed" });
    });
  }, 120_000);

  it("publishes mixed multi-row sidecars and rolls every row back on failure", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96410000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "publish_multi_row",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "publish_multi_row",
        "mixed",
      );
      expect(attempt.command.rowIntents).toHaveLength(2);
      const deletedIntent = attempt.command.rowIntents.find(
        (intent) => intent.kind === "deleted",
      );
      const liveIntent = attempt.command.rowIntents.find(
        (intent) => intent.kind === "live",
      );
      if (deletedIntent === undefined || liveIntent === undefined) {
        throw new Error("Expected PostgreSQL O09-A mixed row intents.");
      }
      const intrinsicOptions = await enableIntrinsicIndexForPostgres(
        persistence,
        scope,
      );
      const beforeSidecars = await intrinsicIndexState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      );
      expect(beforeSidecars).toEqual({
        revisions: [{
          tableId: "1",
          rowIdHex: deletedIntent.rowId.replaceAll("-", ""),
          commitSeq: "1",
          isTombstone: false,
        }],
        current: [{
          tableId: "1",
          rowIdHex: deletedIntent.rowId.replaceAll("-", ""),
          commitSeq: "1",
        }],
      });
      let intrinsicWrites = 0;
      const failure = await runFailure(createPublisher(persistence, {
        ...intrinsicOptions,
        afterTransactionStep: (event) => {
          if (event.step === "intrinsicIndexEntryWritten") {
            intrinsicWrites += 1;
            if (intrinsicWrites === 2) {
              throw new PointCommitCorruptionV1Error({
                reason: "publicationInvariantInvalid",
              });
            }
          }
          return Promise.resolve();
        },
      }).publish(attempt.publicationCommand));
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      expect(intrinsicWrites).toBe(2);
      expect(await intrinsicIndexState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual(beforeSidecars);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "1",
        current_rows: "1",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "1",
        last_outbox_seq: "0",
      });

      await expect(runEffect(
        createPublisher(persistence, intrinsicOptions).publish(
          attempt.publicationCommand,
        ),
      )).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 2n },
      });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "3",
        current_rows: "2",
        commit_headers: "1",
        commit_changes: "2",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "2",
        last_outbox_seq: "1",
      });
      expect(await intrinsicIndexState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: [{
          tableId: "1",
          rowIdHex: deletedIntent.rowId.replaceAll("-", ""),
          commitSeq: "1",
          isTombstone: false,
        }, {
          tableId: "1",
          rowIdHex: deletedIntent.rowId.replaceAll("-", ""),
          commitSeq: "2",
          isTombstone: true,
        }, {
          tableId: "1",
          rowIdHex: liveIntent.rowId.replaceAll("-", ""),
          commitSeq: "2",
          isTombstone: false,
        }].sort(compareIntrinsicIndexRows),
        current: [{
          tableId: "1",
          rowIdHex: liveIntent.rowId.replaceAll("-", ""),
          commitSeq: "2",
        }],
      });
      const changes = await persistence.query<{
        change_ordinal: number;
        row_id_hex: string;
      }>(
        `
          select change_ordinal, encode(row_id, 'hex') as row_id_hex
          from fx_system_commit_app_row_change
          where scope_uuid = $1
          order by change_ordinal
        `,
        [attempt.command.sealIdentity.scopeUuid],
      );
      expect(changes.rows).toEqual(
        attempt.command.rowIntents.map((intent, changeOrdinal) => ({
          change_ordinal: changeOrdinal,
          row_id_hex: intent.rowId.replaceAll("-", ""),
        })),
      );
    });
  }, 120_000);

  it("maintains developer-index key moves and rolls both entry changes back", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "developer_index_move",
        true,
      );
      const developerOptions = await prepareDeveloperIndexForPostgres(
        persistence,
        scope,
      );
      const inserted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_insert",
      );
      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          inserted.publicationCommand,
        ),
      );
      const insertIntent = inserted.command.rowIntents[0];
      if (insertIntent?.kind !== "live") {
        throw new Error("Expected a developer-index insert intent.");
      }
      const documentId = insertIntent.documentId;
      const beforeMove = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(beforeMove.revisions).toHaveLength(1);
      expect(beforeMove.current).toHaveLength(1);
      const developerIndexes = developerOptions.developerIndexes;
      if (developerIndexes === undefined) {
        throw new Error("Missing PostgreSQL C08-A definition locator.");
      }
      const definitions = await runEffect(
        developerIndexes.locate({
          deploymentId: scope.deploymentId,
          scopeId: scope.scopeId,
          schemaVersionId: scope.schemaVersionId,
          tableIds: Object.freeze([decodeCatalogTableId(1)]),
          maximumDefinitions: 256,
        }),
      );
      const definition = definitions?.[0];
      if (definition === undefined) {
        throw new Error("Missing PostgreSQL C08-A developer definition.");
      }
      expect(beforeMove.current[0]?.encodedKeyHex).toBe(
        encodeAppOrderedIndexKeyV1({
          spec: definition.physicalSpec,
          values: Object.freeze([
            orderedIndexValueFromFlarexValueV1("developer_index_insert_0"),
            ORDERED_INDEX_MISSING_V1,
            orderedIndexCreationTimeV1(insertIntent.creationTime),
          ]),
        }),
      );

      const moved = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_move",
        { kind: "patch", documentId, name: "moved_name" },
      );
      let developerWrites = 0;
      const failure = await runFailure(createPublisher(persistence, {
        ...developerOptions,
        afterTransactionStep: (event) => {
          if (event.step === "developerIndexEntryWritten") {
            developerWrites += 1;
            if (developerWrites === 2) {
              throw new PointCommitCorruptionV1Error({
                reason: "publicationInvariantInvalid",
              });
            }
          }
          return Promise.resolve();
        },
      }).publish(moved.publicationCommand));
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      expect(developerWrites).toBe(2);
      expect(await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      )).toEqual(beforeMove);

      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          moved.publicationCommand,
        ),
      );
      const afterMove = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(afterMove.revisions).toHaveLength(3);
      expect(afterMove.revisions.filter((row) => row.isTombstone)).toHaveLength(1);
      expect(afterMove.current).toHaveLength(1);
      expect(afterMove.current[0]?.commitSeq).toBe("2");
      expect(afterMove.current[0]?.encodedKeyHex).not.toBe(
        beforeMove.current[0]?.encodedKeyHex,
      );

      const sameKey = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_same_key",
        {
          kind: "patch",
          documentId,
          patch: { category: "non-indexed-change" },
        },
      );
      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          sameKey.publicationCommand,
        ),
      );
      const afterSameKey = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(afterSameKey.revisions).toHaveLength(4);
      expect(afterSameKey.revisions.filter((row) => row.isTombstone)).toHaveLength(1);
      expect(afterSameKey.current).toHaveLength(1);
      expect(afterSameKey.current[0]).toMatchObject({
        encodedKeyHex: afterMove.current[0]?.encodedKeyHex,
        commitSeq: "3",
      });

      const deleted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_delete",
        { kind: "delete", documentId },
      );
      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          deleted.publicationCommand,
        ),
      );
      const afterDelete = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(afterDelete.revisions).toHaveLength(5);
      expect(afterDelete.revisions.filter((row) => row.isTombstone)).toHaveLength(2);
      expect(afterDelete.current).toEqual([]);
    });
  }, 120_000);

  it("resets developer validation behind its cursor and completes exact revalidation", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418200");
      const scope = await createScope(
        persistence,
        randomUuid,
        "developer_build_validation_reset",
        true,
      );
      const developerOptions = await prepareDeveloperIndexForPostgres(
        persistence,
        scope,
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_build_validation_first",
      );
      await runEffect(createPublisher(persistence, developerOptions).publish(
        first.publicationCommand,
      ));
      const firstIntent = first.command.rowIntents[0];
      if (firstIntent?.kind !== "live") {
        throw new Error("Expected first developer validation-reset insert.");
      }
      const second = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_build_validation_second",
      );
      await runEffect(createPublisher(persistence, developerOptions).publish(
        second.publicationCommand,
      ));

      const developerIndexes = developerOptions.developerIndexes;
      if (developerIndexes === undefined) {
        throw new Error("Missing PostgreSQL developer validation locator.");
      }
      const definitions = await runEffect(
        developerIndexes.locate({
          deploymentId: scope.deploymentId,
          scopeId: scope.scopeId,
          schemaVersionId: scope.schemaVersionId,
          tableIds: Object.freeze([decodeCatalogTableId(1)]),
          maximumDefinitions: 1,
        }),
      );
      const definition = definitions?.[0];
      if (definitions?.length !== 1 || definition === undefined) {
        throw new Error("Missing PostgreSQL developer validation definition.");
      }
      const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
        persistence,
        scope.physicalLocator,
      );
      const buildPorts = {
        controlDb: persistence.drizzle,
        authority: {
          scopeMetadata: {
            getScopeMetadataByDeploymentId: (deploymentId: string) =>
              persistence.getScopeMetadataByDeploymentId(deploymentId),
          },
          provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => null,
          },
          scopeClockTargets: { resolve: async () => target },
        },
      } as const;
      const buildInput = {
        deploymentId: scope.deploymentId,
        indexDefinitionId: definition.indexDefinitionId,
        pageSize: 1,
      } as const;
      let reachedCursor = false;
      for (let step = 0; step < 8; step += 1) {
        const result = await runEffect(buildAppDeveloperOrderedIndexV1Effect(
          buildPorts,
          buildInput,
        ));
        if (result.lifecycle === "validating" && result.cursorRowId !== null) {
          reachedCursor = true;
          break;
        }
      }
      expect(reachedCursor).toBe(true);
      expect(await developerIndexBuildCursor(
        persistence,
        scope,
        definition.indexDefinitionId,
      )).not.toBeNull();

      const changed = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_build_validation_change",
        {
          kind: "patch",
          documentId: firstIntent.documentId,
          name: "changed-behind-validation-cursor",
        },
      );
      await runEffect(createPublisher(persistence, developerOptions).publish(
        changed.publicationCommand,
      ));
      expect(await developerIndexBuildCursor(
        persistence,
        scope,
        definition.indexDefinitionId,
      )).toBeNull();

      let enabled = false;
      for (let step = 0; step < 8; step += 1) {
        const result = await runEffect(buildAppDeveloperOrderedIndexV1Effect(
          buildPorts,
          buildInput,
        ));
        if (result.lifecycle === "enabled") {
          enabled = true;
          break;
        }
      }
      expect(enabled).toBe(true);
      expect((await developerIndexState(
        persistence,
        changed.command.sealIdentity.scopeUuid,
      )).current).toHaveLength(2);
    });
  }, 120_000);

  it("maintains unique claims and atomically rejects PostgreSQL conflicts", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418800");
      const scope = await createScope(
        persistence,
        randomUuid,
        "unique_key_move",
      );
      const uniqueOptions = await prepareUniqueConstraintForPostgres(
        persistence,
        scope,
      );
      await setValidatingUniqueSetBuild(persistence, scope);
      await setValidatingUniqueSetBuild(
        persistence,
        scope,
        `${scope.schemaVersionId}_candidate`,
      );
      const inserted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "unique_key_insert",
      );
      await runEffect(createPublisher(persistence, uniqueOptions).publish(
        inserted.publicationCommand,
      ));
      expect(await uniqueSetBuildCursors(persistence, scope)).toEqual([
        null,
        null,
      ]);
      const insertIntent = inserted.command.rowIntents[0];
      if (insertIntent?.kind !== "live") {
        throw new Error("Expected a PostgreSQL C08-B2 insert intent.");
      }
      const beforeMove = await uniqueKeyState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(beforeMove).toMatchObject([{ commitSeq: "1" }]);

      const moved = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "unique_key_move",
        {
          kind: "patch",
          documentId: insertIntent.documentId,
          name: "moved_unique_name",
        },
      );
      let uniqueWrites = 0;
      await setValidatingUniqueSetBuild(persistence, scope);
      await setValidatingUniqueSetBuild(
        persistence,
        scope,
        `${scope.schemaVersionId}_candidate`,
      );
      const failure = await runFailure(createPublisher(persistence, {
        ...uniqueOptions,
        afterTransactionStep: (event) => {
          if (event.step === "uniqueKeyWritten") {
            uniqueWrites += 1;
          }
          if (event.step === "uniqueConstraintValidationReset") {
            throw new PointCommitCorruptionV1Error({
              reason: "publicationInvariantInvalid",
            });
          }
          return Promise.resolve();
        },
      }).publish(moved.publicationCommand));
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      expect(uniqueWrites).toBe(2);
      expect(await uniqueKeyState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      )).toEqual(beforeMove);
      expect(await uniqueSetBuildCursors(persistence, scope)).toEqual([
        "ff".repeat(16),
        "ff".repeat(16),
      ]);

      await runEffect(createPublisher(persistence, uniqueOptions).publish(
        moved.publicationCommand,
      ));
      expect(await uniqueSetBuildCursors(persistence, scope)).toEqual([
        null,
        null,
      ]);
      const afterMove = await uniqueKeyState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(afterMove).toMatchObject([{ commitSeq: "2" }]);
      expect(afterMove[0]?.encodedKeyHex).not.toBe(
        beforeMove[0]?.encodedKeyHex,
      );

      const conflictScope = await createScope(
        persistence,
        randomUuid,
        "unique_key_conflict",
      );
      const conflictOptions = await prepareUniqueConstraintForPostgres(
        persistence,
        conflictScope,
      );
      const conflict = await createAttempt(
        persistence,
        randomUuid,
        conflictScope,
        "unique_key_conflict",
        "duplicate",
      );
      expect(await runFailure(
        createPublisher(persistence, conflictOptions).publish(
          conflict.publicationCommand,
        ),
      )).toBeInstanceOf(AppUniqueKeyConflictError);
      expect(await uniqueKeyState(
        persistence,
        conflict.command.sealIdentity.scopeUuid,
      )).toEqual([]);
      expect(await durableState(
        persistence,
        conflict.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
        last_outbox_seq: "0",
      });
    });
  }, 120_000);

  it("orders developer-index and unique sidecars and rolls both back together", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418c00");
      const scope = await createScope(
        persistence,
        randomUuid,
        "o09b_combined_rollback",
        true,
      );
      const proofOptions = Object.freeze({
        ...await prepareDeveloperIndexForPostgres(persistence, scope),
        ...await prepareUniqueConstraintForPostgres(persistence, scope),
      });
      const inserted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_combined_seed",
        { kind: "insert", name: "o09b-seeded" },
      );
      await runEffect(createPublisher(persistence, proofOptions).publish(
        inserted.publicationCommand,
      ));
      const insertIntent = inserted.command.rowIntents[0];
      if (insertIntent?.kind !== "live") {
        throw new Error("Expected an O09-B inserted document.");
      }
      const beforeDeveloper = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      const beforeUnique = await uniqueKeyState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      const beforeDurable = await durableState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      const moved = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_combined_move",
        {
          kind: "patch",
          documentId: insertIntent.documentId,
          name: "o09b-moved",
        },
      );
      const sidecarSteps: PointCommitTransactionProofStepV1[] = [];
      let uniqueWrites = 0;
      const failure = await runFailure(createPublisher(persistence, {
        ...proofOptions,
        afterTransactionStep: (event) => {
          if (
            event.step === "developerIndexEntryWritten" ||
            event.step === "uniqueKeyWritten"
          ) {
            sidecarSteps.push(event.step);
          }
          if (event.step === "uniqueKeyWritten") {
            uniqueWrites += 1;
            if (uniqueWrites === 2) {
              throw new PointCommitCorruptionV1Error({
                reason: "publicationInvariantInvalid",
              });
            }
          }
          return Promise.resolve();
        },
      }).publish(moved.publicationCommand));
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      expect(sidecarSteps).toEqual([
        "developerIndexEntryWritten",
        "developerIndexEntryWritten",
        "uniqueKeyWritten",
        "uniqueKeyWritten",
      ]);
      expect(await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      )).toEqual(beforeDeveloper);
      expect(await uniqueKeyState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      )).toEqual(beforeUnique);
      expect(await durableState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      )).toEqual(beforeDurable);

      await runEffect(createPublisher(persistence, proofOptions).publish(
        moved.publicationCommand,
      ));
      const afterDeveloper = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      const afterUnique = await uniqueKeyState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(afterDeveloper.revisions).toHaveLength(3);
      expect(afterDeveloper.current).toMatchObject([{ commitSeq: "2" }]);
      expect(afterUnique).toMatchObject([{ commitSeq: "2" }]);
      expect(afterDeveloper.current[0]?.encodedKeyHex).not.toBe(
        beforeDeveloper.current[0]?.encodedKeyHex,
      );
      expect(afterUnique[0]?.encodedKeyHex).not.toBe(
        beforeUnique[0]?.encodedKeyHex,
      );
    });
  }, 120_000);

  it("linearizes competing unique claims and permits delete then reuse", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418e00");
      const scope = await createScope(
        persistence,
        randomUuid,
        "o09b_unique_contention",
        true,
      );
      const sidecarSteps: PointCommitTransactionProofStepV1[] = [];
      const proofOptions = Object.freeze({
        ...await prepareDeveloperIndexForPostgres(persistence, scope),
        ...await prepareUniqueConstraintForPostgres(persistence, scope),
      });
      const first = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_unique_first",
        { kind: "insert", name: "o09b-shared" },
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_unique_second",
        { kind: "insert", name: "o09b-shared" },
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const firstPublisher = createPublisher(persistence, {
        ...proofOptions,
        afterTransactionStep: async (event) => {
          if (event.step === "clockLocked") {
            entered.resolve();
            await release.promise;
          }
          if (
            event.step === "developerIndexEntryWritten" ||
            event.step === "uniqueKeyWritten"
          ) {
            sidecarSteps.push(event.step);
          }
        },
      });
      const secondPublisher = createPublisher(persistence, {
        ...proofOptions,
        afterTransactionStep: (event) => {
          if (
            event.step === "developerIndexEntryWritten" ||
            event.step === "uniqueKeyWritten"
          ) {
            sidecarSteps.push(event.step);
          }
          return Promise.resolve();
        },
      });
      const firstPromise = runEffect(
        firstPublisher.publish(first.publicationCommand),
      );
      const entry = await Promise.race([
        entered.promise.then(() => ({ kind: "entered" } as const)),
        firstPromise.then(
          () => ({ kind: "settled", status: "fulfilled" } as const),
          (cause: unknown) => ({
            kind: "settled",
            status: "rejected",
            cause,
          } as const),
        ),
      ]);
      if (entry.kind === "settled") {
        release.resolve();
        if (entry.status === "rejected") throw entry.cause;
        throw new Error(
          "The first O09-B publication completed before locking its scope clock.",
        );
      }
      const secondPromise = runEffect(
        secondPublisher.publish(second.publicationCommand),
      );
      let blockingFailure: unknown;
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } catch (cause) {
        blockingFailure = cause;
      } finally {
        release.resolve();
      }
      const settlements = await Promise.allSettled([
        firstPromise,
        secondPromise,
      ]);
      if (blockingFailure !== undefined) throw blockingFailure;
      const fulfilled = settlements.filter(
        (settlement) => settlement.status === "fulfilled",
      );
      const rejected = settlements.filter(
        (settlement) => settlement.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(AppUniqueKeyConflictError);
      expect(sidecarSteps).toEqual([
        "developerIndexEntryWritten",
        "uniqueKeyWritten",
        "developerIndexEntryWritten",
      ]);

      const scopeUuid = first.command.sealIdentity.scopeUuid;
      expect(settlements[0]?.status).toBe("fulfilled");
      expect(settlements[1]?.status).toBe("rejected");
      const winnerIntent = first.command.rowIntents[0];
      if (winnerIntent?.kind !== "live") {
        throw new Error("Missing the O09-B winning document.");
      }
      const winnerDeveloper = await developerIndexState(
        persistence,
        scopeUuid,
      );
      const winnerUnique = await uniqueKeyState(persistence, scopeUuid);
      expect(winnerDeveloper).toMatchObject({
        revisions: [{ rowIdHex: pointRowIdHex(winnerIntent.documentId) }],
        current: [{ rowIdHex: pointRowIdHex(winnerIntent.documentId) }],
      });
      expect(winnerUnique).toMatchObject([{
        rowIdHex: pointRowIdHex(winnerIntent.documentId),
        commitSeq: "1",
      }]);
      const winnerDeveloperKey = winnerDeveloper.current[0]?.encodedKeyHex;
      const winnerUniqueKey = winnerUnique[0]?.encodedKeyHex;
      if (winnerDeveloperKey === undefined || winnerUniqueKey === undefined) {
        throw new Error("Missing O09-B winning sidecar keys.");
      }
      expect(await durableState(persistence, scopeUuid)).toEqual({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });

      const publisher = createPublisher(persistence, proofOptions);
      const deleted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_unique_delete",
        { kind: "delete", documentId: winnerIntent.documentId },
      );
      await runEffect(publisher.publish(deleted.publicationCommand));
      expect(await uniqueKeyState(persistence, scopeUuid)).toEqual([]);
      const afterDeleteDeveloper = await developerIndexState(
        persistence,
        scopeUuid,
      );
      expect(afterDeleteDeveloper.current).toEqual([]);
      expect(afterDeleteDeveloper.revisions).toMatchObject([
        {
          encodedKeyHex: winnerDeveloperKey,
          rowIdHex: pointRowIdHex(winnerIntent.documentId),
          commitSeq: "1",
          isTombstone: false,
        },
        {
          encodedKeyHex: winnerDeveloperKey,
          rowIdHex: pointRowIdHex(winnerIntent.documentId),
          commitSeq: "2",
          isTombstone: true,
        },
      ]);

      const reused = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_unique_reuse",
        { kind: "insert", name: "o09b-shared" },
      );
      await runEffect(publisher.publish(reused.publicationCommand));
      const reusedIntent = reused.command.rowIntents[0];
      if (reusedIntent?.kind !== "live") {
        throw new Error("Missing the O09-B reused document.");
      }
      expect(reusedIntent.documentId).not.toBe(winnerIntent.documentId);
      const afterReuseDeveloper = await developerIndexState(
        persistence,
        scopeUuid,
      );
      expect(afterReuseDeveloper.revisions).toHaveLength(3);
      expect(afterReuseDeveloper.revisions.map((row) => row.commitSeq).sort())
        .toEqual(["1", "2", "3"]);
      expect(afterReuseDeveloper.revisions.filter((row) => row.isTombstone))
        .toHaveLength(1);
      expect(afterReuseDeveloper).toMatchObject({
        current: [{
          rowIdHex: pointRowIdHex(reusedIntent.documentId),
          commitSeq: "3",
        }],
      });
      expect(afterReuseDeveloper.current[0]?.encodedKeyHex).not.toBe(
        winnerDeveloperKey,
      );
      expect(await uniqueKeyState(persistence, scopeUuid)).toMatchObject([{
        encodedKeyHex: winnerUniqueKey,
        rowIdHex: pointRowIdHex(reusedIntent.documentId),
        commitSeq: "3",
      }]);
      expect(await durableState(persistence, scopeUuid)).toEqual({
        revisions: "3",
        current_rows: "2",
        commit_headers: "3",
        commit_changes: "3",
        outcomes: "3",
        wakes: "3",
        last_commit_seq: "3",
        last_outbox_seq: "3",
      });
    });
  }, 120_000);

  it("rejects developer-index entry fan-out above the private commit ceiling", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96419000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "developer_index_ceiling",
        3,
      );
      const developerOptions = await prepareDeveloperIndexForPostgres(
        persistence,
        scope,
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_ceiling",
        86,
      );
      const failure = await runFailure(
        createPublisher(persistence, developerOptions).publish(
          attempt.publicationCommand,
        ),
      );
      expect(failure).toBeInstanceOf(
        PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
      );
      expect(failure).toMatchObject({
        reason: "entryRevisionLimitExceeded",
        observed: 258,
        maximum: 256,
      });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
        last_outbox_seq: "0",
      });
    });
  }, 120_000);

  it("rolls back action-derived developer-index fan-out above the ceiling", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96419800");
      const scope = await createScope(
        persistence,
        randomUuid,
        "developer_index_action_ceiling",
        2,
      );
      const developerOptions = await prepareDeveloperIndexForPostgres(
        persistence,
        scope,
      );
      const inserted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_action_seed",
        65,
      );
      await runEffect(createPublisher(persistence, developerOptions).publish(
        inserted.publicationCommand,
      ));
      const documentIds = inserted.command.rowIntents.map((intent) =>
        intent.documentId
      );
      const before = await durableState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      const beforeIndexes = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(beforeIndexes.revisions).toHaveLength(130);
      const moved = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_action_move",
        { kind: "bulkPatch", documentIds },
      );
      const failure = await runFailure(
        createPublisher(persistence, developerOptions).publish(
          moved.publicationCommand,
        ),
      );
      expect(failure).toBeInstanceOf(
        PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
      );
      expect(failure).toMatchObject({
        reason: "entryRevisionLimitExceeded",
        observed: 260,
        maximum: 256,
      });
      expect(await durableState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      )).toEqual(before);
      expect(await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      )).toEqual(beforeIndexes);
    });
  }, 120_000);

  it("keeps the exact material-row ceiling operable and rejects plus one", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96420000");
      const profile: Array<Readonly<{
        rowCount: number;
        preCommitKernelMilliseconds: number;
        settlementInclusiveMilliseconds: number;
        publicationMilliseconds: number;
      }>> = [];

      for (const rowCount of [1, 8, 32, 64, 127, 128] as const) {
        const label = `material_profile_${rowCount}`;
        const scope = await createScope(persistence, randomUuid, label);
        const attempt = await createAttempt(
          persistence,
          randomUuid,
          scope,
          label,
          rowCount,
        );
        const intrinsicOptions = await enableIntrinsicIndexForPostgres(
          persistence,
          scope,
        );
        let clockLockedAt: number | undefined;
        let beforeCommitAt: number | undefined;
        const publicationStartedAt = performance.now();
        const published = await runEffect(createPublisher(persistence, {
          ...intrinsicOptions,
          afterTransactionStep: (event) => {
            if (event.step === "clockLocked") {
              clockLockedAt = performance.now();
            } else if (event.step === "beforeCommit") {
              beforeCommitAt = performance.now();
            }
            return Promise.resolve();
          },
        }).publish(attempt.publicationCommand));
        const publicationSettledAt = performance.now();
        const publicationMilliseconds = publicationSettledAt - publicationStartedAt;
        if (clockLockedAt === undefined || beforeCommitAt === undefined) {
          throw new Error("Missing O09-A PostgreSQL lock-window evidence.");
        }
        const preCommitKernelMilliseconds = beforeCommitAt - clockLockedAt;
        const settlementInclusiveMilliseconds = publicationSettledAt - clockLockedAt;
        profile.push(Object.freeze({
          rowCount,
          preCommitKernelMilliseconds,
          settlementInclusiveMilliseconds,
          publicationMilliseconds,
        }));
        expect(published).toMatchObject({
          kind: "published",
          token: { commitSeq: 1n },
        });
        expect(settlementInclusiveMilliseconds).toBeLessThan(30_000);
        expect(await durableState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
        )).toEqual({
          revisions: rowCount.toString(),
          current_rows: rowCount.toString(),
          commit_headers: "1",
          commit_changes: rowCount.toString(),
          outcomes: "1",
          wakes: "1",
          last_commit_seq: "1",
          last_outbox_seq: "1",
        });
        const expectedSidecars = attempt.command.rowIntents.map((intent) => ({
          tableId: intent.tableId.toString(),
          rowIdHex: intent.rowId.replaceAll("-", ""),
          commitSeq: "1",
          isTombstone: false,
        })).sort(compareIntrinsicIndexRows);
        expect(await intrinsicIndexState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
        )).toEqual({
          revisions: expectedSidecars,
          current: expectedSidecars.map(({ isTombstone: _, ...row }) => row),
        });
      }

      const rejectedScope = await createScope(
        persistence,
        randomUuid,
        "material_profile_rejected",
      );
      const atLimit = await createAttempt(
        persistence,
        randomUuid,
        rejectedScope,
        "material_profile_rejected",
        MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
      );
      const firstIntent = atLimit.publicationCommand.rowIntents[0];
      if (firstIntent === undefined) {
        throw new Error("Missing O09-A at-limit row intent.");
      }
      const oversized = Object.freeze({
        ...atLimit.publicationCommand,
        rowIntents: Object.freeze([
          ...atLimit.publicationCommand.rowIntents,
          firstIntent,
        ]),
      });
      await expect(runFailure(
        createPublisher(persistence).publish(oversized),
      )).resolves.toMatchObject({
        _tag: "PointCommitCorruptionV1Error",
        reason: "commandInvalid",
      });
      expect(await durableState(
        persistence,
        atLimit.command.sealIdentity.scopeUuid,
      )).toEqual(emptyDurableState());

      if (process.env.FLAREX_PRINT_POINT_COMMIT_PROFILE === "1") {
        console.info("O09-A PostgreSQL material-row profile", profile);
      }
    });
  }, 480_000);

  it("keeps concurrent at-limit commits bounded to their scope", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96430000");
      const contendedScope = await createScope(
        persistence,
        randomUuid,
        "material_contention",
      );
      const independentScope = await createScope(
        persistence,
        randomUuid,
        "material_independent",
      );
      const contendedIntrinsic = await enableIntrinsicIndexForPostgres(
        persistence,
        contendedScope,
      );
      const independentIntrinsic = await enableIntrinsicIndexForPostgres(
        persistence,
        independentScope,
      );
      const attempts: Array<PreparedAttempt> = [];
      for (let index = 0; index < 8; index += 1) {
        attempts.push(await createAttempt(
          persistence,
          randomUuid,
          contendedScope,
          `material_contention_${index}`,
          MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
        ));
      }
      const independent = await createAttempt(
        persistence,
        randomUuid,
        independentScope,
        "material_independent",
        MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
      );
      const preCommitKernelMilliseconds = new Array<number | undefined>(
        attempts.length,
      );
      const settlementInclusiveMilliseconds = new Array<number | undefined>(
        attempts.length,
      );
      const publicationStartedAt = performance.now();
      const contendedPublications = attempts.map((attempt, index) => {
        let clockLockedAt: number | undefined;
        return runEffect(createPublisher(persistence, {
          ...contendedIntrinsic,
          afterTransactionStep: (event) => {
            if (event.step === "clockLocked") {
              clockLockedAt = performance.now();
            } else if (event.step === "beforeCommit") {
              if (clockLockedAt === undefined) {
                throw new Error("Missing contended O09-A clock-lock evidence.");
              }
              preCommitKernelMilliseconds[index] =
                performance.now() - clockLockedAt;
            }
            return Promise.resolve();
          },
        }).publish(attempt.publicationCommand)).then((result) => {
          if (clockLockedAt === undefined) {
            throw new Error("Missing settled O09-A clock-lock evidence.");
          }
          settlementInclusiveMilliseconds[index] =
            performance.now() - clockLockedAt;
          return result;
        });
      });
      const independentStartedAt = performance.now();
      const independentPublication = runEffect(createPublisher(persistence, {
        ...independentIntrinsic,
      }).publish(independent.publicationCommand)).then((result) => Object.freeze({
        result,
        elapsedMilliseconds: performance.now() - independentStartedAt,
      }));
      const [contendedResults, independentResult] = await Promise.all([
        Promise.all(contendedPublications),
        independentPublication,
      ]);
      const contendedElapsedMilliseconds = performance.now() - publicationStartedAt;
      if (preCommitKernelMilliseconds.some((value) =>
        typeof value !== "number" || !Number.isFinite(value)
      ) || settlementInclusiveMilliseconds.some((value) =>
        typeof value !== "number" || !Number.isFinite(value)
      )) {
        throw new Error("Incomplete contended O09-A lock-window evidence.");
      }
      const sortedPreCommitKernel = preCommitKernelMilliseconds
        .map((value) => {
          if (value === undefined) {
            throw new Error("Missing contended O09-A pre-commit observation.");
          }
          return value;
        })
        .sort((left, right) => left - right);
      const sortedSettlementInclusive = settlementInclusiveMilliseconds
        .map((value) => {
          if (value === undefined) {
            throw new Error("Missing contended O09-A settlement observation.");
          }
          return value;
        })
        .sort((left, right) => left - right);
      const preCommitP99 = percentileNearestRank(sortedPreCommitKernel, 0.99);
      const settlementP50 = percentileNearestRank(
        sortedSettlementInclusive,
        0.5,
      );
      const settlementP95 = percentileNearestRank(
        sortedSettlementInclusive,
        0.95,
      );
      const settlementP99 = percentileNearestRank(
        sortedSettlementInclusive,
        0.99,
      );

      expect(contendedResults).toHaveLength(8);
      expect(contendedResults.every((result) => result.kind === "published")).toBe(true);
      expect(independentResult.result).toMatchObject({ kind: "published" });
      expect(settlementP50).toBeLessThan(30_000);
      expect(settlementP95).toBeLessThan(30_000);
      expect(settlementP99).toBeLessThan(30_000);
      expect(contendedElapsedMilliseconds).toBeLessThan(120_000);
      expect(independentResult.elapsedMilliseconds).toBeLessThan(
        contendedElapsedMilliseconds,
      );
      const firstContendedAttempt = attempts[0];
      if (firstContendedAttempt === undefined) {
        throw new Error("Missing first contended O09-A attempt.");
      }
      expect(await durableState(
        persistence,
        firstContendedAttempt.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: (8 * MAX_POINT_COMMIT_MATERIAL_ROWS_V1).toString(),
        current_rows: (8 * MAX_POINT_COMMIT_MATERIAL_ROWS_V1).toString(),
        commit_headers: "8",
        commit_changes: (8 * MAX_POINT_COMMIT_MATERIAL_ROWS_V1).toString(),
        outcomes: "8",
        wakes: "8",
        last_commit_seq: "8",
        last_outbox_seq: "8",
      });
      const expectedContendedSidecars = contendedResults.flatMap(
        (result, attemptIndex) => {
          if (result.kind !== "published") {
            throw new Error("Expected a published contended O09-A outcome.");
          }
          const attempt = attempts[attemptIndex];
          if (attempt === undefined) {
            throw new Error("Missing contended O09-A sidecar attempt.");
          }
          return attempt.command.rowIntents.map((intent) => ({
            tableId: intent.tableId.toString(),
            rowIdHex: intent.rowId.replaceAll("-", ""),
            commitSeq: result.token.commitSeq.toString(),
            isTombstone: false,
          }));
        },
      ).sort(compareIntrinsicIndexRows);
      expect(await intrinsicIndexState(
        persistence,
        firstContendedAttempt.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: expectedContendedSidecars,
        current: expectedContendedSidecars.map(
          ({ isTombstone: _, ...row }) => row,
        ),
      });
      expect(await durableState(
        persistence,
        independent.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: MAX_POINT_COMMIT_MATERIAL_ROWS_V1.toString(),
        current_rows: MAX_POINT_COMMIT_MATERIAL_ROWS_V1.toString(),
        commit_headers: "1",
        commit_changes: MAX_POINT_COMMIT_MATERIAL_ROWS_V1.toString(),
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      if (independentResult.result.kind !== "published") {
        throw new Error("Expected a published independent O09-A outcome.");
      }
      const expectedIndependentSidecars = independent.command.rowIntents.map(
        (intent) => ({
          tableId: intent.tableId.toString(),
          rowIdHex: intent.rowId.replaceAll("-", ""),
          commitSeq: independentResult.result.token.commitSeq.toString(),
          isTombstone: false,
        }),
      ).sort(compareIntrinsicIndexRows);
      expect(await intrinsicIndexState(
        persistence,
        independent.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: expectedIndependentSidecars,
        current: expectedIndependentSidecars.map(
          ({ isTombstone: _, ...row }) => row,
        ),
      });

      if (process.env.FLAREX_PRINT_POINT_COMMIT_PROFILE === "1") {
        console.info("O09-A PostgreSQL contention profile", {
          rowCountPerCommit: MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
          writers: attempts.length,
          preCommitP99,
          settlementP50,
          settlementP95,
          settlementP99,
          contendedElapsedMilliseconds,
          independentElapsedMilliseconds: independentResult.elapsedMilliseconds,
        });
      }
    });
  }, 480_000);

  it("linearizes concurrent duplicates into one publisher and one replay", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96500000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "duplicate_publish",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "duplicate_publish",
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const first = runEffect(createPublisher(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          entered.resolve();
          await release.promise;
        },
      }).publish(attempt.publicationCommand));
      await entered.promise;
      const second = runEffect(
        createPublisher(persistence).publish(attempt.publicationCommand),
      );
      await waitForBlockedPointCommit(persistence, 1);
      release.resolve();
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.kind).sort()).toEqual([
        "published",
        "replayed",
      ]);
      expect(results[0]?.token).toEqual(results[1]?.token);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        revisions: "1",
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });

      const lateProof = await runFailure(
        createPort(persistence).prove(attempt.command),
      );
      expect(lateProof).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({ commit_headers: "1", outcomes: "1", wakes: "1" });
    });
  }, 120_000);

  it("serializes distinct same-scope publications into dense paired heads", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96600000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "dense_publish",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "dense_publish_a",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "dense_publish_b",
      );
      const results = await Promise.all([
        runEffect(createPublisher(persistence).publish(
          first.publicationCommand,
        )),
        runEffect(createPublisher(persistence).publish(
          second.publicationCommand,
        )),
      ]);
      expect(results.map((result) => result.token.commitSeq).sort()).toEqual([
        1n,
        2n,
      ]);
      expect(await durableState(
        persistence,
        first.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "2",
        current_rows: "2",
        commit_headers: "2",
        commit_changes: "2",
        outcomes: "2",
        wakes: "2",
        last_commit_seq: "2",
        last_outbox_seq: "2",
      });
      const sequenceRows = await persistence.query<{
        commit_seq: string;
        outbox_seq: string;
      }>(
        `
          select commit_seq::text, outbox_seq::text
          from fx_system_outbox
          where scope_uuid = $1
          order by outbox_seq
        `,
        [first.command.sealIdentity.scopeUuid],
      );
      expect(sequenceRows.rows).toEqual([
        { commit_seq: "1", outbox_seq: "1" },
        { commit_seq: "2", outbox_seq: "2" },
      ]);
    });
  }, 120_000);

  it("rolls back late O07-B failures without a sequence or receipt gap", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96700000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "publish_rollback",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "publish_rollback",
      );
      const failure = await runFailure(createPublisher(persistence, {
        afterTransactionStep: (event) => {
          if (event.step === "clockAdvanced") {
            throw new PointCommitCorruptionV1Error({
              reason: "publicationInvariantInvalid",
            });
          }
          return Promise.resolve();
        },
      }).publish(attempt.publicationCommand));
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
        last_outbox_seq: "0",
      });
    });
  }, 120_000);

  it("atomically records candidate failure on genuine PostgreSQL", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96800000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "candidate_guard",
      );
      const candidateSchemaVersionId = CatalogSchemaVersionIdSchema.make(
        "schema_o06_postgres_candidate_guard_empty",
      );
      await persistence.publishAppSchemaV1({
        deploymentId: scope.deploymentId,
        schemaVersionId: candidateSchemaVersionId,
        version: CatalogSchemaVersionSchema.make(2),
        tables: [],
        indexes: [],
      });
      const candidateValidation =
        createAppSchemaCandidateValidationPortForPointCommitAuthority(
          persistence.drizzle,
          scope.ports,
        );
      await runEffect(installAppSchemaCandidateValidationEffect(
        candidateValidation,
        {
          deploymentId: scope.deploymentId,
          schemaVersionId: candidateSchemaVersionId,
        },
      ));
      const guard = createAppSchemaCandidateWriteGuardPort({
        candidateValidation,
        pointCommitAuthority: scope.ports,
      });
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "candidate_guard",
      );
      let candidateFailureSteps = 0;
      const publisher = createPointCommitPublisherPortV1(scope.ports, {
        candidateSchemaWriteGuard: guard,
        afterTransactionStep: (event) => {
          if (event.step === "candidateSchemaValidationFailed") {
            candidateFailureSteps += 1;
          }
          return Promise.resolve();
        },
      });
      await expect(runEffect(publisher.prove(attempt.command))).resolves
        .toEqual({ kind: "wouldCommit" });
      await expect(runEffect(loadAppSchemaCandidateValidationEffect(
        candidateValidation,
        {
          deploymentId: scope.deploymentId,
          schemaVersionId: candidateSchemaVersionId,
        },
      ))).resolves.toMatchObject({
        head: { frame: {
          kind: "app_schema_candidate_validation_progress",
        } },
      });
      expect(candidateFailureSteps).toBe(1);
      const trigger = await installCommitSqlStateTrigger(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
        "40001",
        "m03_b_candidate_guard_40001",
      );
      try {
        await expect(runFailure(publisher.publish(attempt.publicationCommand)))
          .resolves.toMatchObject({
            _tag: "PointCommitConfirmedPreDecisionRollbackV1Error",
            operation: "writeCommitHeader",
            sqlState: "40001",
          });
      } finally {
        await dropCommitTrigger(persistence, trigger);
      }
      await expect(runEffect(loadAppSchemaCandidateValidationEffect(
        candidateValidation,
        {
          deploymentId: scope.deploymentId,
          schemaVersionId: candidateSchemaVersionId,
        },
      ))).resolves.toMatchObject({
        head: { frame: {
          kind: "app_schema_candidate_validation_progress",
        } },
      });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        last_commit_seq: "0",
      });
      await expect(runEffect(publisher.publish(attempt.publicationCommand)))
        .resolves.toMatchObject({ kind: "published", token: { commitSeq: 1n } });
      const failed = await runEffect(loadAppSchemaCandidateValidationEffect(
        candidateValidation,
        {
          deploymentId: scope.deploymentId,
          schemaVersionId: candidateSchemaVersionId,
        },
      ));
      expect(failed).toMatchObject({
        head: { frame: {
          kind: "app_schema_candidate_validation_failure_evidence",
          observedFailureCount: 1n,
          entries: [{
            source: "pointCommit",
            reason: "candidateTableRemoved",
            observedCommitSeq: 1n,
          }],
        } },
      });
      if (failed.status !== "present") {
        throw new Error("Missing failed PostgreSQL candidate head.");
      }
      await expect(runEffect(publisher.publish(attempt.publicationCommand)))
        .resolves.toMatchObject({ kind: "replayed", token: { commitSeq: 1n } });
      await expect(runEffect(loadAppSchemaCandidateValidationEffect(
        candidateValidation,
        {
          deploymentId: scope.deploymentId,
          schemaVersionId: candidateSchemaVersionId,
        },
      ))).resolves.toMatchObject({
        head: { frameSha256Hex: failed.head.frameSha256Hex },
      });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        outcomes: "1",
        last_commit_seq: "1",
      });
    });
  }, 120_000);
});

describePostgres("real Postgres O08-CD0 decision provenance", () => {
  it("confirms a server 40001 only after rollback and leaves no sequence gap", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97400000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "cd0_40001",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_40001",
      );
      const trigger = await installCommitSqlStateTrigger(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
        "40001",
        "cd0_40001",
      );
      try {
        const failure = await runFailure(
          createPublisher(persistence).publish(attempt.publicationCommand),
        );
        expect(failure).toBeInstanceOf(
          PointCommitConfirmedPreDecisionRollbackV1Error,
        );
        expect(failure).toMatchObject({
          operation: "writeCommitHeader",
          sqlState: "40001",
        });
        expect(await durableState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
        )).toEqual(emptyDurableState());
      } finally {
        await dropCommitTrigger(persistence, trigger);
      }

      await expect(runEffect(
        createPublisher(persistence).publish(attempt.publicationCommand),
      )).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
      });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
    });
  }, 120_000);

  it("confirms one genuine 40P01 victim and preserves dense independent scopes", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97500000");
      const firstScope = await createScope(
        persistence,
        randomUuid,
        "cd0_deadlock_a",
      );
      const secondScope = await createScope(
        persistence,
        randomUuid,
        "cd0_deadlock_b",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "cd0_deadlock_a",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        secondScope,
        "cd0_deadlock_b",
      );
      const trigger = await installCommitDeadlockTrigger(
        persistence,
        first.command.sealIdentity.scopeUuid,
        second.command.sealIdentity.scopeUuid,
      );
      const results = await Promise.all([
        runEffect(Effect.result(
          createPublisher(persistence).publish(first.publicationCommand),
        )),
        runEffect(Effect.result(
          createPublisher(persistence).publish(second.publicationCommand),
        )),
      ]);
      await dropCommitTrigger(persistence, trigger);

      const succeededIndexes = results.flatMap((result, index) =>
        Result.isSuccess(result) ? [index] : []
      );
      const failedIndexes = results.flatMap((result, index) =>
        Result.isFailure(result) ? [index] : []
      );
      expect(succeededIndexes).toHaveLength(1);
      expect(failedIndexes).toHaveLength(1);
      const failedIndex = failedIndexes[0];
      if (failedIndex === undefined) {
        throw new Error("Expected one PostgreSQL deadlock victim.");
      }
      const failed = results[failedIndex];
      if (failed === undefined || Result.isSuccess(failed)) {
        throw new Error("Expected the deadlock failure result.");
      }
      expect(failed.failure).toBeInstanceOf(
        PointCommitConfirmedPreDecisionRollbackV1Error,
      );
      expect(failed.failure).toMatchObject({ sqlState: "40P01" });

      const attempts = [first, second] as const;
      const victim = attempts[failedIndex];
      if (victim === undefined) throw new Error("Missing deadlock victim.");
      expect(await durableState(
        persistence,
        victim.command.sealIdentity.scopeUuid,
      )).toEqual(emptyDurableState());
      await expect(runEffect(
        createPublisher(persistence).publish(victim.publicationCommand),
      )).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
      });
      for (const attempt of attempts) {
        expect(await durableState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
        )).toMatchObject({
          commit_headers: "1",
          outcomes: "1",
          wakes: "1",
          last_commit_seq: "1",
          last_outbox_seq: "1",
        });
      }
    });
  }, 120_000);

  it("preserves rollback and release failures and quarantines their clients", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97600000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "cd0_cleanup",
      );
      const rollbackAttempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_rollback_failure",
      );
      const trigger = await installCommitSqlStateTrigger(
        persistence,
        rollbackAttempt.command.sealIdentity.scopeUuid,
        "40001",
        "cd0_cleanup",
      );
      const rollbackCause = new Error("injected rollback response failure");
      let rollbackClientPid: number | undefined;
      const rollbackFailure = await runFailure(
        createPublisherWithRunner(persistence, {
          afterAcquire: async (client) => {
            rollbackClientPid = await postgresBackendPid(client);
            installClientQueryFault(client, (statement, forward) =>
              statement === "rollback"
                ? Promise.reject(rollbackCause)
                : forward()
            );
          },
        }).publish(rollbackAttempt.publicationCommand),
      );
      await dropCommitTrigger(persistence, trigger);
      expect(rollbackFailure).toBeInstanceOf(PointCommitSqlErrorV1);
      expect(rollbackFailure).toMatchObject({ operation: "beginOrRollback" });
      expectLocatedCleanupFailure(rollbackFailure, {
        transactionCause: expect.objectContaining({ cause: rollbackCause }),
      });
      await expectDifferentPoolClient(persistence, rollbackClientPid);
      expect(await durableState(
        persistence,
        rollbackAttempt.command.sealIdentity.scopeUuid,
      )).toEqual(emptyDurableState());

      const releaseAttempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_release_failure",
      );
      const callbackCause = new Error("injected callback failure");
      const releaseCause = new Error("injected release failure");
      let releaseClientPid: number | undefined;
      const releaseFailure = await runFailure(
        createPublisherWithRunner(
          persistence,
          {
            afterAcquire: async (client) => {
              releaseClientPid = await postgresBackendPid(client);
            },
            release: () => {
              throw releaseCause;
            },
          },
          {
            afterTransactionStep: (event) => {
              if (event.step === "commitHeaderWritten") {
                throw callbackCause;
              }
              return Promise.resolve();
            },
          },
        ).publish(releaseAttempt.publicationCommand),
      );
      expect(releaseFailure).toBeInstanceOf(PointCommitSqlErrorV1);
      expectLocatedCleanupFailure(releaseFailure, {
        callbackCause,
        releaseCause,
      });
      await expectDifferentPoolClient(persistence, releaseClientPid);
      expect(await durableState(
        persistence,
        releaseAttempt.command.sealIdentity.scopeUuid,
      )).toEqual(emptyDurableState());
    });
  }, 120_000);

  it("recovers a forwarded COMMIT and keeps a missing decision uncertain", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97700000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "cd0_commit_response",
      );
      const committed = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_commit_forwarded",
      );
      const lostResponse = new Error("forwarded COMMIT response lost");
      const replayed = await runEffect(
        createPublisherWithRunner(persistence, {
          afterAcquire: (client) => installClientQueryFault(
            client,
            (statement, forward) => statement === "commit"
              ? Promise.resolve(forward()).then(() => {
                  throw lostResponse;
                })
              : forward(),
          ),
        }).publish(committed.publicationCommand),
      );
      expect(replayed).toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      await expect(runEffect(
        createPublisher(persistence).publish(committed.publicationCommand),
      )).resolves.toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      expect(await durableState(
        persistence,
        committed.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });

      const missing = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_commit_missing",
      );
      const missingFailure = await runFailure(
        createPublisherWithRunner(persistence, {
          afterAcquire: (client) => installClientQueryFault(
            client,
            (statement, forward) => statement === "commit"
              ? Promise.reject(new Error("COMMIT not forwarded"))
              : forward(),
          ),
        }).publish(missing.publicationCommand),
      );
      expect(missingFailure).toBeInstanceOf(
        PointCommitDecisionUncertainV1Error,
      );
      expect(missingFailure).toMatchObject({
        outcomeCheck: { kind: "missing" },
      });
      expect(await durableState(
        persistence,
        missing.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      await expect(runEffect(
        createPublisher(persistence).publish(missing.publicationCommand),
      )).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 2n },
      });
      expect(await durableState(
        persistence,
        missing.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        commit_headers: "2",
        outcomes: "2",
        wakes: "2",
        last_commit_seq: "2",
        last_outbox_seq: "2",
      });
    });
  }, 120_000);

  it("holds interruption until a forwarded COMMIT response settles", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("97800000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "cd0_interrupt",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "cd0_interrupt",
      );
      const committed = deferredSignal();
      const release = deferredSignal();
      const fiber = Effect.runFork(
        createPublisherWithRunner(persistence, {
          afterAcquire: (client) => installClientQueryFault(
            client,
            (statement, forward) => statement === "commit"
              ? Promise.resolve(forward()).then(async () => {
                  committed.resolve();
                  await release.promise;
                  throw new Error("forwarded COMMIT response lost");
                })
              : forward(),
          ),
        }).publish(attempt.publicationCommand),
      );
      await committed.promise;
      let interruptionSettled = false;
      const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
        interruptionSettled = true;
        return exit;
      });
      await delay(25);
      expect(interruptionSettled).toBe(false);
      release.resolve();
      await interruption;
      expect(Exit.hasInterrupts(await runEffect(Fiber.await(fiber)))).toBe(true);
      await expect(runEffect(
        createPublisher(persistence).publish(attempt.publicationCommand),
      )).resolves.toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
    });
  }, 120_000);
});

describePostgres("real Postgres O08-A exact-attempt replacement", () => {
  it("advances one concurrent duplicate and uses bounded index-backed locks", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96800000");
      const scope = await createScope(persistence, randomUuid, "replace_once");
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replace_once",
      );
      await installCompetingPointRow(persistence, attempt.command);
      const command = replacementCommand(attempt.command);
      const entered = deferredSignal();
      const release = deferredSignal();
      const steps: string[] = [];
      const queries = new Map<
        PointMutationAttemptReplacementSqlOperationV1,
        Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
      >();
      const first = runEffect(createReplacementPort(persistence, {
        leaseDurationMilliseconds: 300_000,
        afterReplacementStep: async (event) => {
          steps.push(event.step);
          if (event.step !== "clockLocked") return;
          entered.resolve();
          await release.promise;
        },
        observeQuery: (query) => queries.set(query.name, query),
      }).replace(command));
      await entered.promise;
      const second = runEffect(createReplacementPort(persistence).replace(
        command,
      ));
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        release.resolve();
      }
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.kind).sort()).toEqual([
        "alreadyReplaced",
        "replaced",
      ]);
      expect(results.every((result) => result.attemptFence === 2n)).toBe(true);
      expect(steps).toEqual([
        "clockLocked",
        "outcomeRechecked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
        "dependenciesValidated",
        "sessionEnteredRetrying",
        "journalDeleted",
        "leaseDeleted",
        "attemptFenceAdvanced",
        "leaseInserted",
        "journalRootInserted",
        "executionClaimInserted",
        "sessionRunning",
        "beforeCommit",
      ]);
      expect(await replacementState(
        persistence,
        command.sealIdentity.scopeUuid,
        command.authorityPins.sessionId,
      )).toMatchObject({
        lifecycle: "running",
        attempt_fence: "2",
        lease_fence: "2",
        root_fence: "2",
        root_state: "open",
        execution_claim_count: "1",
        execution_claim_fence: "1",
        receipt_count: "0",
        point_count: "0",
        event_count: "0",
        outcome_count: "0",
      });
      const sessionQuery = requireObservedQuery(queries, "lockSession");
      expect(sessionQuery.sql).not.toContain("validated_args_json");
      expect(sessionQuery.sql).not.toContain("authorization_grant_json");
      for (const name of [
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
        "enterRetrying",
        "deleteRetryJournal",
        "deleteRetryLease",
        "advanceAttemptFence",
      ] as const) {
        expect(await explainObserved(
          persistence,
          requireObservedQuery(queries, name),
        )).toContain("Index");
      }
      const later = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replace_once_later_commit",
      );
      await runEffect(createPublisher(persistence).publish(
        later.publicationCommand,
      ));
      await expect(runEffect(createReplacementPort(persistence, {
        leaseDurationMilliseconds: 1,
      }).replace(command))).resolves.toMatchObject({
        kind: "alreadyReplaced",
        attemptFence: 2n,
      });
    });
  }, 120_000);

  it("serializes one scope, permits independent-scope progress, and masks interruption", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96900000");
      const scope = await createScope(persistence, randomUuid, "replace_scope");
      const otherScope = await createScope(
        persistence,
        randomUuid,
        "replace_other_scope",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replace_scope_a",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replace_scope_b",
      );
      const independent = await createAttempt(
        persistence,
        randomUuid,
        otherScope,
        "replace_other_scope",
      );
      await installCompetingPointRow(persistence, first.command);
      await installCompetingPointRow(persistence, second.command);
      await installCompetingPointRow(persistence, independent.command);
      const entered = deferredSignal();
      const release = deferredSignal();
      let interruptedSettled = false;
      const firstFiber = Effect.runFork(createReplacementPort(persistence, {
        afterReplacementStep: async (event) => {
          if (event.step !== "beforeCommit") return;
          entered.resolve();
          await release.promise;
        },
        leaseDurationMilliseconds: 300_000,
      }).replace(replacementCommand(first.command)));
      await entered.promise;
      const secondPromise = runEffect(createReplacementPort(persistence)
        .replace(replacementCommand(
          second.command,
          CommitSeqSchema.make(2n),
        )));
      let interruption: Promise<unknown> | undefined;
      try {
        await waitForBlockedPointCommit(persistence, 1);
        await withTimeout(
          runEffect(createReplacementPort(persistence).replace(
            replacementCommand(independent.command),
          )),
          5_000,
          "independent O08-A scope",
        );
        interruption = runEffect(Fiber.interrupt(firstFiber)).then((exit) => {
          interruptedSettled = true;
          return exit;
        });
        await delay(25);
        expect(interruptedSettled).toBe(false);
      } finally {
        release.resolve();
      }
      if (interruption === undefined) {
        throw new Error("O08-A interruption proof did not start.");
      }
      await interruption;
      expect(interruptedSettled).toBe(true);
      await expect(secondPromise).resolves.toMatchObject({ kind: "replaced" });
      await expect(runEffect(createReplacementPort(persistence).replace(
        replacementCommand(first.command),
      ))).resolves.toMatchObject({ kind: "alreadyReplaced" });
    });
  }, 120_000);

  it("serializes against O07-B publication and exact-attempt abort", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96a00000");
      const scope = await createScope(persistence, randomUuid, "replace_races");

      const replacementFirst = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "replacement_first",
      );
      await installCompetingPointRow(persistence, replacementFirst.command);
      const replacementEntered = deferredSignal();
      const replacementRelease = deferredSignal();
      const replacement = runEffect(createReplacementPort(persistence, {
        leaseDurationMilliseconds: 300_000,
        afterReplacementStep: async (event) => {
          if (event.step !== "beforeCommit") return;
          replacementEntered.resolve();
          await replacementRelease.promise;
        },
      }).replace(replacementCommand(replacementFirst.command)));
      await replacementEntered.promise;
      const latePublication = runFailure(createPublisher(persistence).publish(
        replacementFirst.publicationCommand,
      ));
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        replacementRelease.resolve();
      }
      await expect(replacement).resolves.toMatchObject({ kind: "replaced" });
      await expect(latePublication).resolves.toMatchObject({
        _tag: "PointCommitStaleAuthorityV1Error",
        reason: "attemptReplaced",
      });

      const publicationFirst = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "publication_first",
      );
      const publicationEntered = deferredSignal();
      const publicationRelease = deferredSignal();
      const publication = runEffect(createPublisher(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          publicationEntered.resolve();
          await publicationRelease.promise;
        },
      }).publish(publicationFirst.publicationCommand));
      await publicationEntered.promise;
      const lateReplacement = runFailure(createReplacementPort(persistence)
        .replace(replacementCommand(publicationFirst.command)));
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        publicationRelease.resolve();
      }
      await publication;
      const committed = await lateReplacement;
      expect(committed).toBeInstanceOf(
        PointMutationAttemptReplacementCommittedOutcomeV1Error,
      );
      expect(committed).toMatchObject({ reason: "committedOutcomeAvailable" });

      const abortRace = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "abort_race",
      );
      await installCompetingPointRow(persistence, abortRace.command);
      const abortEntered = deferredSignal();
      const abortRelease = deferredSignal();
      const replacementBeforeAbort = runEffect(createReplacementPort(
        persistence,
        {
          leaseDurationMilliseconds: 300_000,
          afterReplacementStep: async (event) => {
            if (event.step !== "clockLocked") return;
            abortEntered.resolve();
            await abortRelease.promise;
          },
        },
      ).replace(replacementCommand(abortRace.command)));
      await abortEntered.promise;
      const abort = runFailure(
        createPointMutationSessionAttemptTerminalizationPersistenceV1(
          scope.ports,
        ).abortEffect({
          selector: {
            deploymentId: abortRace.anchor.deploymentId,
            scopeId: abortRace.anchor.scopeId,
            sessionId: abortRace.anchor.sessionId,
            attemptFence: abortRace.anchor.attemptFence,
          },
          executionClaim: executionClaimForAnchor(abortRace.anchor),
          expectedSnapshotToken: abortRace.anchor.snapshotToken,
        }),
      );
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        abortRelease.resolve();
      }
      await expect(replacementBeforeAbort).resolves.toMatchObject({
        kind: "replaced",
      });
      await expect(abort).resolves.toMatchObject({
        _tag: "PointMutationSessionAttemptTerminalizationV1Error",
        issue: { reason: "staleAttemptFence" },
      });

      const expiryRace = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "expiry_race",
      );
      await installCompetingPointRow(persistence, expiryRace.command);
      const created = await persistence.query<{ created_at: Date }>(
        `select created_at from fx_system_tx_session
         where scope_uuid = $1 and session_id = $2`,
        [
          expiryRace.command.sealIdentity.scopeUuid,
          expiryRace.anchor.sessionId,
        ],
      );
      const createdAt = created.rows[0]?.created_at;
      if (!(createdAt instanceof Date)) throw new Error("Missing session time.");
      const expiresAtMilliseconds = createdAt.getTime() + 1;
      const expiresAt = new Date(expiresAtMilliseconds);
      await persistence.query(
        `update fx_system_tx_session
         set authorization_grant_expires_at = $3, hard_expires_at = $3
         where scope_uuid = $1 and session_id = $2`,
        [
          expiryRace.command.sealIdentity.scopeUuid,
          expiryRace.anchor.sessionId,
          expiresAt,
        ],
      );
      await persistence.query(
        `update fx_system_snapshot_lease set lease_expires_at = $3
         where scope_uuid = $1 and session_id = $2`,
        [
          expiryRace.command.sealIdentity.scopeUuid,
          expiryRace.anchor.sessionId,
          expiresAt,
        ],
      );
      const expiredCommand = Object.freeze({
        ...replacementCommand(expiryRace.command),
        session: Object.freeze({
          ...expiryRace.command.session,
          authorizationGrantExpiresAtMilliseconds: expiresAtMilliseconds,
          hardExpiresAtMilliseconds: expiresAtMilliseconds,
        }),
        sealIdentity: Object.freeze({
          ...expiryRace.command.sealIdentity,
          leaseExpiresAtMilliseconds: expiresAtMilliseconds,
        }),
      });
      const expiryEntered = deferredSignal();
      const expiryRelease = deferredSignal();
      const expiredReplacement = runFailure(createReplacementPort(
        persistence,
        {
          leaseDurationMilliseconds: 300_000,
          afterReplacementStep: async (event) => {
            if (event.step !== "clockLocked") return;
            expiryEntered.resolve();
            await expiryRelease.promise;
          },
        },
      ).replace(expiredCommand));
      await expiryEntered.promise;
      const expiry = runEffect(
        createPointMutationSessionAttemptTerminalizationPersistenceV1(
          scope.ports,
        ).expireEffect({
          deploymentId: expiryRace.anchor.deploymentId,
          scopeId: expiryRace.anchor.scopeId,
          sessionId: expiryRace.anchor.sessionId,
          attemptFence: expiryRace.anchor.attemptFence,
        }),
      );
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } finally {
        expiryRelease.resolve();
      }
      await expect(expiredReplacement).resolves.toMatchObject({
        _tag: "PointMutationAttemptReplacementStaleAuthorityV1Error",
        reason: "expired",
      });
      await expect(expiry).resolves.toMatchObject({
        status: "terminalized",
        terminal: { lifecycle: "expired" },
      });
    });
  }, 120_000);

  it("rolls every replacement mutation phase back on PostgreSQL", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96b00000");
      const scope = await createScope(persistence, randomUuid, "replace_rollback");
      const phases = [
        "sessionEnteredRetrying",
        "journalDeleted",
        "leaseDeleted",
        "attemptFenceAdvanced",
        "leaseInserted",
        "journalRootInserted",
        "executionClaimInserted",
        "sessionRunning",
        "beforeCommit",
      ] as const;
      for (const phase of phases) {
        const attempt = await createAttempt(
          persistence,
          randomUuid,
          scope,
          `replace_rollback_${phase}`,
        );
        await installCompetingPointRow(persistence, attempt.command);
        const before = await replacementState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
          attempt.anchor.sessionId,
        );
        const failure = await runFailure(createReplacementPort(persistence, {
          leaseDurationMilliseconds: 300_000,
          afterReplacementStep: (event) => {
            if (event.step === phase) {
              throw new PointMutationAttemptReplacementCorruptionV1Error({
                reason: "replacementMutationInvalid",
              });
            }
            return Promise.resolve();
          },
        }).replace(replacementCommand(attempt.command)));
        expect(failure).toBeInstanceOf(
          PointMutationAttemptReplacementCorruptionV1Error,
        );
        expect(await replacementState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
          attempt.anchor.sessionId,
        )).toEqual(before);
      }
    });
  }, 120_000);
});

interface ScopeScenario {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof decodeReplacementScopeIdV1>;
  readonly schemaVersionId: ReturnType<
    typeof CatalogSchemaVersionIdSchema.make
  >;
  readonly ports: PointMutationSessionAuthorityResolutionPortsV1;
  readonly physicalLocator: SharedDatabaseScopePhysicalLocator;
}

interface PreparedAttempt {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
  readonly command: PointCommitTransactionCommandV1;
  readonly publicationCommand: PointCommitPublicationCommandV1;
}

async function createScope(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  label: string,
  developerIndex: boolean | number = false,
): Promise<ScopeScenario> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_o06_postgres_${label}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_o06_postgres_${label}`,
  );
  const locator = Object.freeze({
    kind: "shared_database",
    databaseKey: `o06-postgres-${label}`,
    schemaName: "public",
  }) satisfies SharedDatabaseScopePhysicalLocator;
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator: locator, randomUuid },
  ).ensure({
    deploymentId,
    projectId: `project_o06_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  const developerIndexCount = developerIndex === true
    ? 1
    : developerIndex === false
      ? 0
      : developerIndex;
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: Array.from({ length: developerIndexCount }, (_, index) => ({
        tableLogicalName: "users",
        descriptor: `byName${index}`,
        fields: [
          ["name", "profile.alias"],
          ["alias"],
          ["category"],
        ][index] ?? ["name"],
      })),
  });
  return Object.freeze({
    deploymentId,
    scopeId,
    schemaVersionId,
    ports: resolutionPorts(persistence),
    physicalLocator: locator,
  });
}

async function createAttempt(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  scope: ScopeScenario,
  label: string,
  materialWrite:
    | boolean
    | number
    | "mixed"
    | "duplicate"
    | Readonly<{
      readonly kind: "insert";
      readonly name: string;
    }>
    | Readonly<{
      readonly kind: "patch" | "delete";
      readonly documentId: ReturnType<typeof appDocumentIdV1FromRowIdentity>;
      readonly name?: string;
      readonly patch?: Readonly<Record<string, string>>;
    }>
    | Readonly<{
      readonly kind: "bulkPatch";
      readonly documentIds: ReadonlyArray<
        ReturnType<typeof appDocumentIdV1FromRowIdentity>
      >;
    }> = true,
): Promise<PreparedAttempt> {
  const seededDocumentId = materialWrite === "mixed"
    ? await seedCommittedUser(persistence, scope)
    : null;
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      scope.ports,
      { leaseDurationMilliseconds: 300_000, randomUuid },
    ),
    pointMutationSessionActivationFixture(
      scope.deploymentId,
      scope.scopeId,
      {
        evidence: {
          schemaVersionId: scope.schemaVersionId,
          requestKey: TransactionRequestKeyV1Schema.make(
            `request:o06:postgres:${label}`,
          ),
        },
      },
    ),
  );
  const store = createSessionJournalStorePersistenceV1(scope.ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid,
  });
  const attempt = await runEffect(
    store.openAttemptEffect({
      selector: {
        deploymentId: scope.deploymentId,
        scopeId: scope.scopeId,
        sessionId: activation.anchor.sessionId,
        attemptFence: activation.anchor.attemptFence,
      },
      executionClaim: executionClaimForAnchor(activation.anchor),
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId: scope.schemaVersionId,
    }),
  );
  const materialWriteCount = typeof materialWrite === "number"
    ? materialWrite
    : materialWrite === true
      ? 1
      : materialWrite === "duplicate"
        ? 2
      : 0;
  if (
    materialWriteCount > 0 || materialWrite === "mixed" ||
    typeof materialWrite === "object"
  ) {
    const table = await runEffect(
      store.resolvePointTableEffect(attempt, "users"),
    );
    if (materialWrite === "mixed") {
      if (seededDocumentId === null) {
        throw new Error("Missing PostgreSQL O09-A seeded document.");
      }
      await runPointOperation(store, table, {
        kind: "delete",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        documentId: seededDocumentId,
      });
    }
    for (let index = 0; index < materialWriteCount; index += 1) {
      await runPointOperation(store, table, {
        kind: "insert",
        syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(index + 1)),
        fields: {
          name: materialWrite === "duplicate"
            ? `${label}_duplicate`
            : `${label}_${index}`,
        },
      });
    }
    if (materialWrite === "mixed") {
      await runPointOperation(store, table, {
        kind: "insert",
        syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
        fields: { name: `${label}_replacement` },
      });
    }
    if (typeof materialWrite === "object" && materialWrite.kind === "insert") {
      await runPointOperation(store, table, {
        kind: "insert",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        fields: { name: materialWrite.name },
      });
    } else if (
      typeof materialWrite === "object" && materialWrite.kind === "bulkPatch"
    ) {
      for (let index = 0; index < materialWrite.documentIds.length; index += 1) {
        const documentId = materialWrite.documentIds[index];
        if (documentId === undefined) throw new Error("Missing bulk-patch document ID.");
        await runPointOperation(store, table, {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(index + 1)),
          documentId,
          patch: {
            name: `${label}_name_${index}`,
            alias: `${label}_alias_${index}`,
          },
        });
      }
    } else if (typeof materialWrite === "object") {
      await runPointOperation(store, table, materialWrite.kind === "patch"
        ? {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: materialWrite.documentId,
          patch: materialWrite.patch ?? { name: materialWrite.name },
        }
        : {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: materialWrite.documentId,
        });
    }
  }
  const prepared = await prepareSeal(store, attempt);
  const journal = await runEffect(
    canonicalizeSessionJournalV1Effect(prepared.journal),
  );
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: true }),
  );
  await completeSeal(store, prepared.preparation, journal, result);
  const authority = authorityFromAnchor(
    activation.anchor,
    scope.schemaVersionId,
    executionClaimForAnchor(activation.anchor),
  );
  const loader = createStoredAttemptEvidenceLoaderV1(scope.ports);
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") {
    throw new Error(`Expected running O06 evidence, received ${running.kind}.`);
  }
  await runEffect(
    createPointCommitFinishingTransitionPortV1(scope.ports).enterFinishing(
      await pointCommitFinishingCommandFromStoredAttemptV1(
        authority,
        running.evidence,
      ),
    ),
  );
  const loaded = await runEffect(loader.loadFinishingEffect({
    deploymentId: activation.anchor.deploymentId,
    scopeId: activation.anchor.scopeId,
    sessionId: activation.anchor.sessionId,
    attemptFence: activation.anchor.attemptFence,
  }));
  if (loaded.kind !== "loaded") {
    throw new Error(`Expected O06 stored evidence, received ${loaded.kind}.`);
  }
  const command = await pointCommitCommandFromStoredAttemptV1(
    authority,
    loaded.evidence,
  );
  return Object.freeze({
    anchor: activation.anchor,
    authority,
    command,
    publicationCommand: Object.freeze({
      ...command,
      successfulResult: Object.freeze({
        valueCodecVersion: result.evidence.valueCodecVersion,
        value: Object.freeze({ ok: true }),
        canonicalBytes: result.canonicalBytes,
        semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex,
      }),
    }),
  });
}

async function createIndexedAttempt(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  scope: ScopeScenario,
  label: string,
) {
  const developerIndexes = createAppDeveloperIndexDefinitionPortV1(
    persistence.drizzle,
  );
  await prepareDeveloperIndexForPostgres(persistence, scope);
  const definitions = await runEffect(developerIndexes.locate({
    deploymentId: scope.deploymentId,
    scopeId: scope.scopeId,
    schemaVersionId: scope.schemaVersionId,
    tableIds: Object.freeze([decodeCatalogTableId(1)]),
    maximumDefinitions: 1,
  }));
  const definition = definitions?.[0];
  if (definitions?.length !== 1 || definition === undefined) {
    throw new Error("Missing PostgreSQL O10 developer-index definition.");
  }
  const clock = await persistence.getScopeClock(scope.scopeId);
  if (clock === null) throw new Error("Missing PostgreSQL O10 scope clock.");
  await persistence.drizzle.update(fxSystemIndexBuildStates).set({
    storageGeneration:
      FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
    startCommitSeq: CommitSeqSchema.make(0n),
    lifecycle: "enabled",
    cursorCodecVersion: INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
    backfillCursorRowId: null,
    attemptFence: IndexBuildAttemptFenceSchema.make(1n),
  }).where(eq(
    fxSystemIndexBuildStates.scopeId,
    scope.scopeId,
  ));

  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      scope.ports,
      { leaseDurationMilliseconds: 300_000, randomUuid },
    ),
    pointMutationSessionActivationFixture(
      scope.deploymentId,
      scope.scopeId,
      {
        evidence: {
          schemaVersionId: scope.schemaVersionId,
          requestKey: TransactionRequestKeyV1Schema.make(
            `request:o10:postgres:${label}`,
          ),
        },
      },
    ),
  );
  const store = createSessionJournalStorePersistenceV1(scope.ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid,
    indexedQueries: createAppDeveloperIndexQueryPortV1(
      persistence.drizzle,
      scope.ports,
      developerIndexes,
    ),
  });
  const attempt = await runEffect(store.openAttemptEffect({
    selector: {
      deploymentId: scope.deploymentId,
      scopeId: scope.scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
    },
    executionClaim: executionClaimForAnchor(activation.anchor),
    snapshotToken: activation.anchor.snapshotToken,
    schemaVersionId: scope.schemaVersionId,
  }));
  const table = await runEffect(
    store.resolvePointTableEffect(attempt, "users"),
  );
  const index = await runEffect(
    store.resolveDeveloperIndexEffect(table, "byName0"),
  );
  await runEffect(store.runIndexedQueryEffect(index, {
    kind: "indexRange",
    syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
    bounds: Object.freeze({}),
    limit: 16,
  }));
  const prepared = await prepareSeal(store, attempt);
  const journal = await runEffect(
    canonicalizeSessionJournalV1Effect(prepared.journal),
  );
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: true }),
  );
  await completeSeal(store, prepared.preparation, journal, result);
  const authority = authorityFromAnchor(
    activation.anchor,
    scope.schemaVersionId,
    executionClaimForAnchor(activation.anchor),
  );
  const loader = createStoredAttemptEvidenceLoaderV1(scope.ports);
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") {
    throw new Error(`Expected running O10 evidence, received ${running.kind}.`);
  }
  await runEffect(
    createPointCommitFinishingTransitionPortV1(scope.ports).enterFinishing(
      await pointCommitFinishingCommandFromStoredAttemptV1(
        authority,
        running.evidence,
      ),
    ),
  );
  const loaded = await runEffect(loader.loadFinishingEffect({
    deploymentId: activation.anchor.deploymentId,
    scopeId: activation.anchor.scopeId,
    sessionId: activation.anchor.sessionId,
    attemptFence: activation.anchor.attemptFence,
  }));
  if (loaded.kind !== "loaded") {
    throw new Error(`Expected finishing O10 evidence, received ${loaded.kind}.`);
  }
  const command = await pointCommitCommandFromStoredAttemptV1(
    authority,
    loaded.evidence,
  );
  const indexRangeDependencies = Object.freeze(
    journal.journal.readDependencies.filter(
      (dependency): dependency is LogicalIndexRangeReadDependencyV1 =>
        dependency.kind === "appIndexRange",
    ),
  );
  return Object.freeze({
    anchor: activation.anchor,
    authority,
    command: Object.freeze({ ...command, indexRangeDependencies }),
    definition,
  });
}

async function commitCompetingIndexedUser(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
  attempt: Awaited<ReturnType<typeof createIndexedAttempt>>,
  rowIdHex: string,
) {
  const tableId = decodeCatalogTableId(1);
  const rowId = decodeAppRowIdHexV1(rowIdHex);
  const creationTime = decodeAppCreationTimeV1(2);
  const document = await canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { name: "phantom" },
  });
  const clock = await persistence.getScopeClock(scope.scopeId);
  if (clock === null) throw new Error("Missing PostgreSQL O10 conflict clock.");
  const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
  const encodedKey = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(
    attempt.definition,
    document,
    creationTime,
  ));
  await persistence.drizzle.transaction(async (tx) => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: scope.scopeId,
      tableId,
      rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId: scope.schemaVersionId,
      creationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    Result.getOrThrow(
      await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        {
          kind: "live",
          scopeId: scope.scopeId,
          definition: attempt.definition,
          encodedKey,
          rowId: decodeOrderedIndexRowIdHexV1(rowId),
          writeEpoch: clock.epoch,
          commitSeq,
          prevCommitSeq: null,
        },
      ),
    );
    await tx.insert(fxSystemCommits).values({
      scopeUuid: attempt.command.sealIdentity.scopeUuid,
      epochUuid: projectScopeEpochUuidV1(clock.epoch).epochUuid,
      commitSeq,
      changeCount: 1,
    });
    await tx.insert(fxSystemCommitAppRowChanges).values({
      scopeUuid: attempt.command.sealIdentity.scopeUuid,
      epochUuid: projectScopeEpochUuidV1(clock.epoch).epochUuid,
      commitSeq,
      changeOrdinal: 0,
      tableId,
      rowId: appRowIdHexV1ToBytes(rowId),
    });
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq })
      .where(eq(fxSystemScopeClocks.scopeId, scope.scopeId));
  });
  return Object.freeze({ encodedKey, rowId });
}

async function seedCommittedUser(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
): Promise<ReturnType<typeof appDocumentIdV1FromRowIdentity>> {
  const tableId = decodeCatalogTableId(1);
  const rowId = decodeAppRowIdHexV1("11".repeat(16));
  const creationTime = decodeAppCreationTimeV1(1);
  const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
  const clock = await persistence.getScopeClock(scope.scopeId);
  if (clock === null) throw new Error("Missing PostgreSQL O09-A scope clock.");
  const document = await canonicalizeFlarexValueV1({
    _id: documentId,
    _creationTime: creationTime,
    name: "seeded",
  }, "appDocument");
  await persistence.drizzle.transaction(async (tx) => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: scope.scopeId,
      tableId,
      rowId,
      writeEpoch: clock.epoch,
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      schemaVersionId: scope.schemaVersionId,
      creationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.update(fxSystemScopeClocks).set({
      lastCommitSeq: CommitSeqSchema.make(1n),
    }).where(eq(fxSystemScopeClocks.scopeId, scope.scopeId));
  });
  return documentId;
}

async function enableIntrinsicIndexForPostgres(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
): Promise<Pick<
  PointCommitTransactionProofOptionsV1,
  "intrinsicCreationTimeIndexes"
>> {
  const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
    persistence,
    scope.physicalLocator,
  );
  const ports = {
    controlDb: persistence.drizzle,
    authority: {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: (deploymentId: string) =>
          persistence.getScopeMetadataByDeploymentId(deploymentId),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => target },
    },
  } as const;
  await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, {
    deploymentId: scope.deploymentId,
    schemaVersionId: scope.schemaVersionId,
  }));
  for (let step = 0; step < 8; step += 1) {
    const advanced = await runEffect(buildIntrinsicCreationTimeIndexV1Effect(
      ports,
      {
        deploymentId: scope.deploymentId,
        indexDefinitionId: decodeCatalogIndexDefinitionId(1),
        pageSize: 8,
      },
    ));
    if (advanced.lifecycle === "enabled") break;
  }
  return Object.freeze({
    intrinsicCreationTimeIndexes:
      createIntrinsicCreationTimeIndexDefinitionPortV1(persistence.drizzle),
  });
}

async function prepareDeveloperIndexForPostgres(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
): Promise<Pick<PointCommitTransactionProofOptionsV1, "developerIndexes">> {
  const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
    persistence,
    scope.physicalLocator,
  );
  await runEffect(reconcilePublishedIndexBuildsV1Effect({
    controlDb: persistence.drizzle,
    authority: {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: (deploymentId: string) =>
          persistence.getScopeMetadataByDeploymentId(deploymentId),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => target },
    },
  }, {
    deploymentId: scope.deploymentId,
    schemaVersionId: scope.schemaVersionId,
  }));
  return Object.freeze({
    developerIndexes: createAppDeveloperIndexDefinitionPortV1(
      persistence.drizzle,
    ),
  });
}

async function developerIndexBuildCursor(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
  indexDefinitionId: number,
): Promise<string | null> {
  const result = await persistence.query<{ cursor_row_hex: string | null }>(
    `select encode(backfill_cursor_row_id, 'hex') as cursor_row_hex
       from fx_system_index_build_state
      where scope_id = $1 and index_definition_id = $2`,
    [scope.scopeId, indexDefinitionId],
  );
  return result.rows[0]?.cursor_row_hex ?? null;
}

async function prepareUniqueConstraintForPostgres(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
): Promise<Required<Pick<
  PointCommitTransactionProofOptionsV1,
  "uniqueConstraints"
>>> {
  const prepared = await runEffect(
    prepareAppUniqueConstraintDefinitionBindingV1Effect(
      persistence.drizzle,
      {
        deploymentId: scope.deploymentId,
        schemaVersionId: scope.schemaVersionId,
        tableId: decodeCatalogTableId(1),
        descriptor: SchemaManifestAppIndexDescriptorSchema.make(
          "unique_name",
        ),
        physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({
          kind: "appUniqueConstraint",
          specVersion: 1,
          orderedFields: ["name"],
          sparse: false,
          localePolicy: { kind: "none" },
          keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
          keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
        }),
      },
    ),
  );
  await persistence.drizzle.transaction((tx) =>
    runEffect(
      ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared),
    )
  );
  return Object.freeze({
    uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(
      persistence.drizzle,
    ),
  });
}

async function setValidatingUniqueSetBuild(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
  schemaVersionId: string = scope.schemaVersionId,
) {
  const clock = await persistence.getScopeClock(scope.scopeId);
  if (clock === null) throw new Error("Missing PostgreSQL C08-B1C clock.");
  await persistence.query(
    `insert into fx_system_unique_constraint_set_build
      (scope_id, schema_version_id, set_codec_version, definition_count,
       definition_set_sha256, storage_generation, storage_generation_fence,
       epoch, start_commit_seq, lifecycle, cursor_codec_version,
       cursor_definition_id, cursor_row_id, attempt_fence)
     values ($1, $2, 1, 1, decode(repeat('ab', 32), 'hex'),
             'flarexdb_v1', $3, $4, $5, 'validating', 1, 1,
             decode(repeat('ff', 16), 'hex'), 1)
     on conflict (scope_id, schema_version_id) do update
       set lifecycle = 'validating', cursor_definition_id = 1,
           cursor_row_id = decode(repeat('ff', 16), 'hex'),
           updated_at = clock_timestamp()`,
    [
      scope.scopeId,
      schemaVersionId,
      clock.storageGenerationFence.toString(),
      clock.epoch,
      clock.lastCommitSeq.toString(),
    ],
  );
}

async function uniqueSetBuildCursors(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
) {
  const result = await persistence.query<{ cursor_row_hex: string | null }>(
    `select encode(cursor_row_id, 'hex') cursor_row_hex
       from fx_system_unique_constraint_set_build
      where scope_id = $1
      order by schema_version_id asc`,
    [scope.scopeId],
  );
  return result.rows.map((row) => row.cursor_row_hex);
}

function createPort(
  persistence: PostgresFlarexPersistence,
  options: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitRollbackProofPortV1(
    resolutionPorts(persistence),
    options,
  );
}

function createPublisher(
  persistence: PostgresFlarexPersistence,
  options: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitPublisherPortV1(
    resolutionPorts(persistence),
    options,
  );
}

function createPublisherWithRunner(
  persistence: PostgresFlarexPersistence,
  runnerOptions: PostgresLocatedReadCommittedRunnerOptionsV1,
  proofOptions: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitPublisherPortV1(
    resolutionPortsWithRunner(persistence, runnerOptions),
    proofOptions,
  );
}

function resolutionPortsWithRunner(
  persistence: PostgresFlarexPersistence,
  runnerOptions: PostgresLocatedReadCommittedRunnerOptionsV1,
): PointMutationSessionAuthorityResolutionPortsV1 {
  const base = resolutionPorts(persistence);
  return {
    ...base,
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createLocatedPointMutationSessionActivationTargetV1(
          persistence.drizzle,
          physicalLocator,
          {
            [LOCATED_READ_COMMITTED_RUNNER_V1]:
              createPostgresLocatedReadCommittedTransactionRunnerV1(
                persistence.pool,
                runnerOptions,
              ),
          },
        ),
    },
  };
}

interface CommitTriggerV1 {
  readonly triggerName: string;
  readonly functionName: string;
}

async function installCommitSqlStateTrigger(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  sqlState: "40001" | "40P01",
  suffix: string,
): Promise<CommitTriggerV1> {
  const functionName = `fx_test_${suffix}_function`;
  const triggerName = `fx_test_${suffix}_trigger`;
  await persistence.query(
    `
      create function ${functionName}()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.scope_uuid = '${scopeUuid}'::uuid then
          raise exception 'forced ${sqlState} from PostgreSQL'
            using errcode = '${sqlState}';
        end if;
        return new;
      end
      $$
    `,
  );
  await persistence.query(
    `
      create trigger ${triggerName}
      before insert on fx_system_commit
      for each row execute function ${functionName}()
    `,
  );
  return Object.freeze({ triggerName, functionName });
}

async function installCommitDeadlockTrigger(
  persistence: PostgresFlarexPersistence,
  firstScopeUuid: string,
  secondScopeUuid: string,
): Promise<CommitTriggerV1> {
  const functionName = "fx_test_cd0_deadlock_function";
  const triggerName = "fx_test_cd0_deadlock_trigger";
  await persistence.query(
    `
      create function ${functionName}()
      returns trigger
      language plpgsql
      as $$
      declare
        peer_key integer;
        wait_count integer := 0;
      begin
        if new.scope_uuid = '${firstScopeUuid}'::uuid then
          perform pg_advisory_xact_lock(80731, 1);
          peer_key := 2;
        elsif new.scope_uuid = '${secondScopeUuid}'::uuid then
          perform pg_advisory_xact_lock(80731, 2);
          peer_key := 1;
        else
          return new;
        end if;

        while not exists (
          select 1
          from pg_locks
          where locktype = 'advisory'
            and classid = 80731
            and objid = peer_key
            and granted
            and pid <> pg_backend_pid()
        ) loop
          wait_count := wait_count + 1;
          if wait_count > 500 then
            raise exception 'timed out preparing the CD0 deadlock';
          end if;
          perform pg_sleep(0.01);
        end loop;

        perform pg_advisory_xact_lock(80731, peer_key);
        return new;
      end
      $$
    `,
  );
  await persistence.query(
    `
      create trigger ${triggerName}
      before insert on fx_system_commit
      for each row execute function ${functionName}()
    `,
  );
  return Object.freeze({ triggerName, functionName });
}

async function dropCommitTrigger(
  persistence: PostgresFlarexPersistence,
  trigger: CommitTriggerV1,
): Promise<void> {
  await persistence.query(
    `drop trigger ${trigger.triggerName} on fx_system_commit`,
  );
  await persistence.query(`drop function ${trigger.functionName}()`);
}

function installClientQueryFault(
  client: PoolClient,
  fault: (
    statement: string,
    forward: () => unknown,
  ) => unknown,
): void {
  const originalQuery = client.query;
  const installed = Reflect.set(
    client,
    "query",
    (...args: ReadonlyArray<unknown>): unknown => fault(
      postgresStatementText(args[0]),
      () => Reflect.apply(originalQuery, client, args),
    ),
  );
  if (!installed) throw new Error("Failed to install the client query fault.");
}

function postgresStatementText(statement: unknown): string {
  if (typeof statement === "string") return statement.trim().toLowerCase();
  if (
    typeof statement === "object" &&
    statement !== null &&
    "text" in statement &&
    typeof statement.text === "string"
  ) {
    return statement.text.trim().toLowerCase();
  }
  return "";
}

function expectLocatedCleanupFailure(
  failure: unknown,
  expected: Readonly<{
    readonly callbackCause?: unknown;
    readonly transactionCause?: unknown;
    readonly releaseCause?: unknown;
  }>,
): void {
  if (!(failure instanceof PointCommitSqlErrorV1)) {
    throw new Error("Expected an ordinary point-commit SQL failure.");
  }
  const located = failure.cause;
  if (!(located instanceof LocatedReadCommittedTransactionFailureV1)) {
    throw new Error("Expected located transaction cleanup evidence.");
  }
  expect(located.issue).toMatchObject({
    kind: "callbackCleanupFailed",
    ...expected,
  });
}

async function expectDifferentPoolClient(
  persistence: PostgresFlarexPersistence,
  discardedPid: number | undefined,
): Promise<void> {
  if (discardedPid === undefined) {
    throw new Error("The faulted PostgreSQL backend PID was not captured.");
  }
  const client = await persistence.pool.connect();
  try {
    expect(await postgresBackendPid(client)).not.toBe(discardedPid);
  } finally {
    client.release();
  }
}

async function postgresBackendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ pid: number }>(
    "select pg_backend_pid()::int as pid",
  );
  const pid = result.rows[0]?.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid)) {
    throw new Error("PostgreSQL did not return a backend PID.");
  }
  return pid;
}

function emptyDurableState() {
  return {
    revisions: "0",
    current_rows: "0",
    commit_headers: "0",
    commit_changes: "0",
    outcomes: "0",
    wakes: "0",
    last_commit_seq: "0",
    last_outbox_seq: "0",
  } as const;
}

function percentileNearestRank(
  sortedValues: ReadonlyArray<number>,
  percentile: number,
): number {
  if (sortedValues.length === 0) {
    throw new Error("Cannot calculate a percentile from no observations.");
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(percentile * sortedValues.length) - 1),
  );
  const value = sortedValues[index];
  if (value === undefined) {
    throw new Error("Missing percentile observation.");
  }
  return value;
}

function createReplacementPort(
  persistence: PostgresFlarexPersistence,
  options: PointMutationAttemptReplacementOptionsV1 = {
    leaseDurationMilliseconds: 300_000,
  },
) {
  return createPointMutationAttemptReplacementPortV1(
    resolutionPorts(persistence),
    options,
  );
}

function replacementCommand(
  command: PointCommitTransactionCommandV1,
  currentCommitSeq: ReturnType<typeof CommitSeqSchema.make> =
    CommitSeqSchema.make(
      command.authorityPins.snapshotToken.commitSeq + 1n,
    ),
): PointMutationAttemptReplacementCommandV1 {
  return Object.freeze({
    authorityPins: command.authorityPins,
    session: command.session,
    sealIdentity: command.sealIdentity,
    dependencies: command.dependencies,
    indexRangeDependencies: command.indexRangeDependencies,
    relationDependencies: command.relationDependencies,
    expectedConflict: Object.freeze({
      conflict: Object.freeze({
        kind: "appRowPoint",
        documentId: command.dependencies[0]!.documentId,
      }),
      snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
      currentCommitSeq,
    }),
  });
}

async function installCompetingPointRow(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
): Promise<void> {
  const locked = deferredSignal();
  const release = deferredSignal();
  release.resolve();
  const commit = commitCompetingPointRow(
    persistence,
    command,
    locked,
    release,
  );
  await locked.promise;
  await commit;
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
): PointMutationSessionAuthorityResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared placement must not read split receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
    },
  };
}

function authorityFromAnchor(
  anchor: PointMutationSessionAnchorV1,
  schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>,
  executionClaim: NonNullable<
    StoredAttemptEvidenceAuthorityV1["executionClaim"]
  >,
): StoredAttemptEvidenceAuthorityV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
    storageGeneration: anchor.storageGeneration,
    storageGenerationFence: anchor.storageGenerationFence,
    snapshotToken: anchor.snapshotToken,
    schemaVersionId,
    executionClaim,
  });
}

async function commitCompetingPointRow(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
  locked: ReturnType<typeof deferredSignal>,
  release: ReturnType<typeof deferredSignal>,
): Promise<void> {
  const intent = command.rowIntents[0];
  if (intent?.kind !== "live") {
    throw new Error("O06 competing writer requires a live intent.");
  }
  const clock = await persistence.getScopeClock(command.authorityPins.scopeId);
  if (clock === null) throw new Error("Missing competing-writer scope clock.");
  const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
  const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
  const document = await canonicalizeFlarexValueV1(
    intent.value,
    "appDocument",
  );
  await persistence.drizzle.transaction(async (tx) => {
    await tx
      .select({ scopeUuid: fxSystemScopeClocks.scopeUuid })
      .from(fxSystemScopeClocks)
      .where(eq(
        fxSystemScopeClocks.scopeUuid,
        command.sealIdentity.scopeUuid,
      ))
      .limit(1)
      .for("update");
    locked.resolve();
    await release.promise;
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
      rowId: intent.rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId: command.authorityPins.schemaVersionId,
      creationTime: intent.creationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.insert(fxSystemCommits).values({
      scopeUuid: command.sealIdentity.scopeUuid,
      epochUuid,
      commitSeq,
      changeCount: 1,
    });
    await tx.insert(fxSystemCommitAppRowChanges).values({
      scopeUuid: command.sealIdentity.scopeUuid,
      epochUuid,
      commitSeq,
      changeOrdinal: 0,
      tableId: intent.tableId,
      rowId: appRowIdHexV1ToBytes(intent.rowId),
    });
    await tx
      .update(fxSystemScopeClocks)
      .set({ lastCommitSeq: commitSeq })
      .where(eq(
        fxSystemScopeClocks.scopeUuid,
        command.sealIdentity.scopeUuid,
      ));
  });
}

async function durableState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
) {
  const result = await persistence.query<{
    revisions: string;
    current_rows: string;
    commit_headers: string;
    commit_changes: string;
    outcomes: string;
    wakes: string;
    last_commit_seq: string;
    last_outbox_seq: string;
  }>(
    `
      select
        (select count(*)::text from fx_app_row_rev
          where scope_uuid = $1) as revisions,
        (select count(*)::text from fx_app_row_current
          where scope_uuid = $1) as current_rows,
        (select count(*)::text from fx_system_commit
          where scope_uuid = $1) as commit_headers,
        (select count(*)::text from fx_system_commit_app_row_change
          where scope_uuid = $1) as commit_changes,
        (select count(*)::text from fx_system_idempotency
          where scope_uuid = $1) as outcomes,
        (select count(*)::text from fx_system_outbox
          where scope_uuid = $1) as wakes,
        last_commit_seq::text,
        last_outbox_seq::text
      from fx_system_scope_clock
      where scope_uuid = $1
    `,
    [scopeUuid],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing O06 durable state.");
  return row;
}

async function intrinsicIndexState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
) {
  const revisions = await persistence.query<{
    table_id: string;
    row_id_hex: string;
    commit_seq: string;
    is_tombstone: boolean;
  }>(
    `select table_id::text, encode(row_id, 'hex') as row_id_hex,
       commit_seq::text, is_tombstone
     from fx_app_index_entry_rev
     where scope_uuid = $1
     order by table_id, row_id, commit_seq`,
    [scopeUuid],
  );
  const current = await persistence.query<{
    table_id: string;
    row_id_hex: string;
    commit_seq: string;
  }>(
    `select revision.table_id::text,
       encode(current_entry.row_id, 'hex') as row_id_hex,
       current_entry.commit_seq::text
     from fx_app_index_entry_current as current_entry
     join fx_app_index_entry_rev as revision
       on revision.scope_uuid = current_entry.scope_uuid
      and revision.index_definition_id = current_entry.index_definition_id
      and revision.encoded_key = current_entry.encoded_key
      and revision.row_id = current_entry.row_id
      and revision.commit_seq = current_entry.commit_seq
     where current_entry.scope_uuid = $1
     order by revision.table_id, current_entry.row_id`,
    [scopeUuid],
  );
  return {
    revisions: revisions.rows.map((row) => ({
      tableId: row.table_id,
      rowIdHex: row.row_id_hex,
      commitSeq: row.commit_seq,
      isTombstone: row.is_tombstone,
    })),
    current: current.rows.map((row) => ({
      tableId: row.table_id,
      rowIdHex: row.row_id_hex,
      commitSeq: row.commit_seq,
    })),
  } as const;
}

async function developerIndexState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
) {
  const revisions = await persistence.query<{
    index_definition_id: string;
    encoded_key_hex: string;
    row_id_hex: string;
    commit_seq: string;
    is_tombstone: boolean;
  }>(
    `select index_definition_id::text, encode(encoded_key, 'hex') as encoded_key_hex,
       encode(row_id, 'hex') as row_id_hex, commit_seq::text, is_tombstone
     from fx_app_index_entry_rev
     where scope_uuid = $1
     order by index_definition_id, encoded_key, row_id, commit_seq`,
    [scopeUuid],
  );
  const current = await persistence.query<{
    index_definition_id: string;
    encoded_key_hex: string;
    row_id_hex: string;
    commit_seq: string;
  }>(
    `select index_definition_id::text, encode(encoded_key, 'hex') as encoded_key_hex,
       encode(row_id, 'hex') as row_id_hex, commit_seq::text
     from fx_app_index_entry_current
     where scope_uuid = $1
     order by index_definition_id, encoded_key, row_id`,
    [scopeUuid],
  );
  return Object.freeze({
    revisions: Object.freeze(revisions.rows.map((row) => Object.freeze({
      indexDefinitionId: row.index_definition_id,
      encodedKeyHex: row.encoded_key_hex,
      rowIdHex: row.row_id_hex,
      commitSeq: row.commit_seq,
      isTombstone: row.is_tombstone,
    }))),
    current: Object.freeze(current.rows.map((row) => Object.freeze({
      indexDefinitionId: row.index_definition_id,
      encodedKeyHex: row.encoded_key_hex,
      rowIdHex: row.row_id_hex,
      commitSeq: row.commit_seq,
    }))),
  });
}

async function uniqueKeyState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
) {
  const rows = await persistence.query<{
    constraint_id: string;
    encoded_key_hex: string;
    row_id_hex: string;
    commit_seq: string;
  }>(
    `select constraint_id::text,
       encode(encoded_key, 'hex') as encoded_key_hex,
       encode(row_id, 'hex') as row_id_hex,
       commit_seq::text
     from fx_app_unique_key
     where scope_uuid = $1
     order by constraint_id, encoded_key, row_id`,
    [scopeUuid],
  );
  return Object.freeze(rows.rows.map((row) => Object.freeze({
    constraintId: row.constraint_id,
    encodedKeyHex: row.encoded_key_hex,
    rowIdHex: row.row_id_hex,
    commitSeq: row.commit_seq,
  })));
}

function compareIntrinsicIndexRows(
  left: Readonly<{
    readonly tableId: string;
    readonly rowIdHex: string;
    readonly commitSeq: string;
  }>,
  right: Readonly<{
    readonly tableId: string;
    readonly rowIdHex: string;
    readonly commitSeq: string;
  }>,
): number {
  const identityOrder = left.tableId.localeCompare(right.tableId) ||
    left.rowIdHex.localeCompare(right.rowIdHex);
  if (identityOrder !== 0) return identityOrder;
  const leftCommitSeq = BigInt(left.commitSeq);
  const rightCommitSeq = BigInt(right.commitSeq);
  return leftCommitSeq < rightCommitSeq
    ? -1
    : leftCommitSeq > rightCommitSeq
      ? 1
      : 0;
}

function pointRowIdHex(documentId: string): string {
  return decodeAppDocumentIdentityV1(documentId).rowId;
}

async function replacementState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  sessionId: string,
) {
  const result = await persistence.query<{
    lifecycle: string;
    attempt_fence: string;
    lease_fence: string;
    root_fence: string;
    root_state: string;
    execution_claim_count: string;
    execution_claim_fence: string | null;
    receipt_count: string;
    point_count: string;
    event_count: string;
    outcome_count: string;
  }>(
    `select session.lifecycle,
      session.attempt_fence::text,
      lease.attempt_fence::text as lease_fence,
      root.attempt_fence::text as root_fence,
      root.state as root_state,
      (select count(*)::text from fx_system_tx_execution_claim
        where scope_uuid = $1 and session_id = $2) as execution_claim_count,
      claim.claim_fence::text as execution_claim_fence,
      (select count(*)::text from fx_system_tx_journal_latest_receipt
        where scope_uuid = $1 and session_id = $2) as receipt_count,
      (select count(*)::text from fx_system_tx_journal_point
        where scope_uuid = $1 and session_id = $2) as point_count,
      (select count(*)::text from fx_system_tx_journal_write_event
        where scope_uuid = $1 and session_id = $2) as event_count,
      (select count(*)::text from fx_system_idempotency
        where scope_uuid = $1) as outcome_count
    from fx_system_tx_session session
    join fx_system_snapshot_lease lease
      on lease.scope_uuid = session.scope_uuid
      and lease.session_id = session.session_id
    join fx_system_tx_journal root
      on root.scope_uuid = session.scope_uuid
      and root.session_id = session.session_id
    left join fx_system_tx_execution_claim claim
      on claim.scope_uuid = session.scope_uuid
      and claim.session_id = session.session_id
      and claim.attempt_fence = session.attempt_fence
    where session.scope_uuid = $1 and session.session_id = $2`,
    [scopeUuid, sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing O08-A replacement state.");
  return row;
}

async function terminalPublicationState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  sessionId: string,
) {
  const result = await persistence.query<{
    lifecycle: string;
    leases: string;
    journals: string;
    change_count: number;
    delivery_state: string;
    same_initial_time: boolean;
  }>(
    `
      select session.lifecycle,
        (select count(*)::text from fx_system_snapshot_lease
          where scope_uuid = $1 and session_id = $2) as leases,
        (select count(*)::text from fx_system_tx_journal
          where scope_uuid = $1 and session_id = $2) as journals,
        commit.change_count,
        wake.delivery_state,
        wake.created_at = wake.next_attempt_at as same_initial_time
      from fx_system_tx_session as session
      join fx_system_commit as commit
        on commit.scope_uuid = session.scope_uuid
      join fx_system_outbox as wake
        on wake.scope_uuid = commit.scope_uuid
        and wake.commit_seq = commit.commit_seq
      where session.scope_uuid = $1 and session.session_id = $2
    `,
    [scopeUuid, sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing O07-B terminal state.");
  return row;
}

async function waitForBlockedPointCommit(
  persistence: PostgresFlarexPersistence,
  expectedBlocked: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `
        select count(*)::int as blocked
        from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and cardinality(pg_blocking_pids(pid)) > 0
          and query ilike '%fx_system_scope_clock%'
      `,
    );
    if ((result.rows[0]?.blocked ?? 0) >= expectedBlocked) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} blocked O06 transaction(s).`,
  );
}

function requireObservedQuery<Name extends string>(
  queries: ReadonlyMap<
    Name,
    Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
  >,
  name: Name,
) {
  const query = queries.get(name);
  if (query === undefined) throw new Error(`Missing O06 ${name} query.`);
  return query;
}

async function explainObserved(
  persistence: PostgresFlarexPersistence,
  query: Readonly<{
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
  }>,
): Promise<string> {
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const result = await client.query(
      `explain (format json) ${query.sql}`,
      [...query.params],
    );
    return JSON.stringify(result.rows);
  });
}

async function explainHeadLookup(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
): Promise<string> {
  const dependency = command.dependencies[0];
  if (dependency === undefined) throw new Error("Missing O06 dependency.");
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const result = await client.query(
      `
        explain (format json)
        select current_row.commit_seq, latest.commit_seq
        from (values ($1::integer, $2::bytea)) requested(table_id, row_id)
        left join fx_app_row_current current_row
          on current_row.scope_uuid = $3::uuid
          and current_row.table_id = requested.table_id
          and current_row.row_id = requested.row_id
        left join lateral (
          select revision.commit_seq
          from fx_app_row_rev revision
          where revision.scope_uuid = $3::uuid
            and revision.table_id = requested.table_id
            and revision.row_id = requested.row_id
          order by revision.commit_seq desc
          limit 1
        ) latest on true
      `,
      [
        dependency.tableId,
        appRowIdHexV1ToBytes(dependency.rowId),
        command.sealIdentity.scopeUuid,
      ],
    );
    return JSON.stringify(result.rows);
  });
}

async function explainIndexRangeOccLookup(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
): Promise<string> {
  const dependency = command.indexRangeDependencies[0];
  if (dependency === undefined) {
    throw new Error("Missing O10 index-range dependency.");
  }
  const lower = dependency.lower === null
    ? null
    : orderedIndexBoundHexV1ToBytes(dependency.lower.encodedKey);
  const upper = dependency.upper === null
    ? null
    : dependency.upper.kind === "key"
      ? orderedIndexBoundHexV1ToBytes(dependency.upper.encodedKey)
      : orderedIndexKeyBytesHexV1ToBytes(dependency.upper.encodedKey);
  const upperRowId = dependency.upper?.kind === "position"
    ? orderedIndexRowIdHexV1ToBytes(dependency.upper.rowId)
    : null;
  const clock = await persistence.getScopeClock(command.authorityPins.scopeId);
  if (clock === null) throw new Error("Missing O10 scope clock.");
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const result = await client.query(
      `
        explain (format json)
        with requested(
          ordinal,
          index_definition_id,
          lower_encoded_key,
          upper_kind,
          upper_encoded_key,
          upper_row_id
        ) as (values (0::integer, $1::integer, $2::bytea, $3::text,
          $4::bytea, $5::bytea))
        select requested.ordinal
        from requested
        join fx_app_index_entry_rev as revision
          on revision.scope_uuid = $6::uuid
          and revision.index_definition_id = requested.index_definition_id
          and revision.commit_seq > $7::bigint
          and revision.commit_seq <= $8::bigint
          and (
            requested.lower_encoded_key is null or
            revision.encoded_key >= requested.lower_encoded_key
          )
          and (
            requested.upper_kind = 'unbounded' or
            (
              requested.upper_kind = 'key' and
              revision.encoded_key < requested.upper_encoded_key
            ) or
            (
              requested.upper_kind = 'position' and
              (
                revision.encoded_key < requested.upper_encoded_key or
                (
                  revision.encoded_key = requested.upper_encoded_key and
                  revision.row_id <= requested.upper_row_id
                )
              )
            )
          )
        order by requested.ordinal asc, revision.commit_seq asc,
          revision.encoded_key asc, revision.row_id asc
        limit 1
      `,
      [
        dependency.indexDefinitionId,
        lower,
        dependency.upper?.kind ?? "unbounded",
        upper,
        upperRowId,
        command.sealIdentity.scopeUuid,
        command.authorityPins.snapshotToken.commitSeq,
        clock.lastCommitSeq,
      ],
    );
    return JSON.stringify(result.rows);
  });
}

async function expectSequentialScansEnabled(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const client = await persistence.pool.connect();
  try {
    const result = await client.query<{ enable_seqscan: string }>(
      "show enable_seqscan",
    );
    expect(result.rows).toEqual([{ enable_seqscan: "on" }]);
  } finally {
    client.release();
  }
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
          alias: {
            fieldType: { type: "string" },
            optional: true,
          },
          category: {
            fieldType: { type: "string" },
            optional: true,
          },
          profile: {
            fieldType: {
              type: "object",
              value: {
                alias: {
                  fieldType: { type: "string" },
                  optional: true,
                },
              },
            },
            optional: true,
          },
        },
      },
    },
  };
}

function uuidFactory(prefix: string): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}

function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => resolver?.(),
  });
}

async function withTimeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  label: string,
): Promise<Value> {
  return Promise.race([
    promise,
    delay(milliseconds).then(() => {
      throw new Error(`${label} did not complete within ${milliseconds} ms.`);
    }),
  ]);
}
