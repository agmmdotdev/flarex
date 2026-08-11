import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdV1,
  decodeAppDocumentIdentityV1,
  decodeAppRowIdHexV1,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  CommitSyscallSequenceV1Schema,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1,
  MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  makeGrantRetentionPolicyV1Result,
  type GrantRetentionPolicyV1,
} from "flarex-protocol/grant-retention-policy";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  decodeSchemaManifestAppTableName,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
  InvalidApplicationRevisionSyscallValidatorV1Error,
} from "../src/applicationRevisionSyscallValidatorV1";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  decodeReplacementScopeIdV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  canonicalizeFlarexValueV1,
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import {
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import { Cause, Effect, Exit, Fiber, Result } from "effect";

import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
  type AppRowValueEvidenceV1,
} from "../src/appRows";
import {
  appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult,
} from "../src/appIndexEntries";
import {
  createAppDeveloperIndexDefinitionPortV1,
  lowerAppDeveloperIndexKeyV1,
} from "../src/appDeveloperIndexCommitV1";
import type { LocatedAppIndexDefinitionV1 } from "../src/appIndexDefinitions";
import {
  PinnedPointTablePersistenceV1Error,
  resolvePinnedPointTableIdV1Effect,
  type ResolvePinnedPointTableIdV1Input,
} from "../src/pinnedPointTableResolution";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedScopeClockReader,
} from "../src/scopeAuthorityResolution";
import {
  SchemaVersionArtifactCorruptionError,
} from "../src/schemaVersionArtifacts";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import type { TransactionExecutionClaimObservationV1 } from
  "../src/transactionExecutionClaimModel";
import { createPointMutationExecutionClaimLivenessV1 } from
  "../src/transactionExecutionClaimLiveness";
import {
  InvalidSessionJournalInputV1Error,
  PinnedPointTableCorruptionV1Error,
  PinnedPointTableNotFoundV1Error,
  SessionJournalAttemptUnavailableV1Error,
  SessionJournalIdentityGenerationV1Error,
  SessionJournalLeasePromotionV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalSealV1Error,
  SessionJournalStorageCorruptionV1Error,
  createAppDeveloperIndexQueryPortV1,
  createSessionJournalStorePersistenceV1,
  type PinnedDeveloperIndexV1,
  type PinnedPointTableV1,
  type RunSessionJournalPointOperationV1Result,
  type SessionJournalAttemptV1,
  type SessionJournalIndexedQueryOperationV1,
  type SessionJournalPointOperationV1,
  type SessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import { fxSystemIndexBuildStates } from "../src/schema";
import {
  INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
  IndexBuildAttemptFenceSchema,
} from "flarex-protocol/index-build-state";
import {
  decodeOrderedIndexBoundHexV1,
  decodeOrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import {
  createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionActivationPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptSelectorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  ExactRunningAttemptTransactionV1Error,
  RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1,
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  isLocatedExactRunningAttemptKernelV1,
  reconcileExactRunningAttemptTransactionFailureV1,
} from "../src/transactionSessionAttemptKernel";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "./effectTestRuntime";
import {
  issueSetupSeededSyscallValidatorProofV1,
  revokeSetupSeededSyscallValidatorProofV1,
  SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
} from
  "./applicationRevisionSyscallValidatorTestSupport";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "session-journal-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const SEEDED_ROW_ID = decodeAppRowIdHexV1(
  "83000000000000000000000000000001",
);
const SEEDED_CREATION_TIME = decodeAppCreationTimeV1(1_725_000_000_000.25);
const SECOND_ROW_ID = decodeAppRowIdHexV1(
  "83000000000040008000000000000002",
);
const SECOND_CREATION_TIME = decodeAppCreationTimeV1(1_725_000_000_001.25);

interface ScenarioOptions {
  readonly grantRetentionPolicy?: GrantRetentionPolicyV1;
  readonly randomUuid?: () => string;
  readonly seedFields?: unknown;
  readonly additionalSeedFields?: unknown;
  readonly extraIndexedSeeds?: ReadonlyArray<Readonly<{
    readonly fields: unknown;
    readonly rowId: AppRowIdHexV1;
    readonly creationTime: AppCreationTimeV1;
  }>>;
  readonly targetOptions?: LocatedPointMutationSessionActivationTargetOptionsV1;
  readonly developerIndex?: boolean;
  readonly developerIndexDescriptor?: unknown;
  readonly indexedQueryComposition?:
    | "exact"
    | "missing"
    | "foreignControl"
    | "mismatchedAuthority";
  readonly journalFaultAfter?: (
    point: "indexedQueryEvidenceWritten",
  ) => void | Promise<void>;
}

interface JournalScenario {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly otherTableId: CatalogTableId;
  readonly anchor: PointMutationSessionAnchorV1;
  readonly executionClaim: TransactionExecutionClaimObservationV1;
  readonly store: SessionJournalStorePersistenceV1;
  readonly attempt: SessionJournalAttemptV1;
  readonly table: PinnedPointTableV1;
  readonly developerIndex: PinnedDeveloperIndexV1 | null;
  readonly developerIndexDefinition: LocatedAppIndexDefinitionV1 | null;
  readonly seededDocumentId: AppDocumentIdV1 | null;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
}

interface JournalCounts extends Record<string, unknown> {
  readonly roots: number;
  readonly receipts: number;
  readonly points: number;
  readonly events: number;
  readonly sessions: number;
}

interface JournalRootState extends Record<string, unknown> {
  readonly state: string;
  readonly last_syscall_sequence: string;
  readonly creation_time_seed: number;
  readonly next_creation_time: number;
  readonly read_documents: number;
  readonly read_semantic_bytes: number;
  readonly point_dependency_count: number;
  readonly indexed_query_syscalls: number;
  readonly index_range_dependency_count: number;
  readonly index_range_dependency_evidence_bytes: number;
  readonly write_operations: number;
  readonly write_semantic_bytes: number;
  readonly material_write_event_evidence_bytes: number;
  readonly failure_dimension: string | null;
}

interface AttemptLeaseAndSealState extends Record<string, unknown> {
  readonly root_state: string;
  readonly lease_expires_at: Date;
  readonly authorization_grant_expires_at: Date;
  readonly hard_expires_at: Date;
}

interface AttemptLeaseAndClaimState extends Record<string, unknown> {
  readonly lease_expires_at: Date;
  readonly claim_owner: string;
  readonly claim_fence: string;
  readonly claimed_at: Date;
  readonly claim_expires_at: Date;
}

interface LimitCase {
  readonly dimension:
    | "readDocuments"
    | "readSemanticBytes"
    | "pointReadDependencies"
    | "writeOperations"
    | "writeSemanticBytes"
    | "materialWriteEventEvidenceBytes";
  readonly column:
    | "read_documents"
    | "read_semantic_bytes"
    | "point_dependency_count"
    | "write_operations"
    | "write_semantic_bytes"
    | "material_write_event_evidence_bytes";
  readonly maximum: number;
  readonly seedDocument: boolean;
  readonly operation: (
    scenario: JournalScenario,
    sequence: bigint,
  ) => SessionJournalPointOperationV1;
}

describe("C03 Postgres SessionJournalStore", () => {
  let persistence: PGliteFlarexPersistence;
  let infrastructureUuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  function nextInfrastructureUuid(): string {
    const suffix = infrastructureUuidCounter.toString().padStart(12, "0");
    infrastructureUuidCounter += 1;
    return `83000000-0000-4000-8000-${suffix}`;
  }

  async function scenario(
    label: string,
    options: ScenarioOptions = {},
  ): Promise<JournalScenario> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_session_journal_${label}`,
    );
    const schemaVersionId = CatalogSchemaVersionIdSchema.make(
      `schema_session_journal_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => nextInfrastructureUuid(),
      },
    ).ensure({
      deploymentId,
      projectId: `project_session_journal_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId, {
      lastCommitSeq: options.seedFields === undefined &&
          options.additionalSeedFields === undefined &&
          (options.extraIndexedSeeds?.length ?? 0) === 0
        ? 0n
        : 1n,
    });

    const publication = await persistence.publishAppSchemaV1({
      deploymentId,
      schemaVersionId,
      version: CatalogSchemaVersionSchema.make(1),
      tables: [appTable("users"), appTable("posts")],
      indexes: options.developerIndex === true
        ? [{
            tableLogicalName: "users",
            descriptor: "by_name",
            fields: ["name"],
          }]
        : [],
    });
    const tableId = requirePublishedTableId(publication.manifest, "users");
    const otherTableId = requirePublishedTableId(
      publication.manifest,
      "posts",
    );
    const seededDocumentId = options.seedFields === undefined
      ? null
      : await seedSnapshotDocument(
        persistence,
        scopeId,
        tableId,
        schemaVersionId,
        options.seedFields,
      );
    if (options.additionalSeedFields !== undefined) {
      await seedSnapshotDocument(
        persistence,
        scopeId,
        tableId,
        schemaVersionId,
        options.additionalSeedFields,
        SECOND_ROW_ID,
        SECOND_CREATION_TIME,
      );
    }
    for (const seed of options.extraIndexedSeeds ?? []) {
      await seedSnapshotDocument(
        persistence,
        scopeId,
        tableId,
        schemaVersionId,
        seed.fields,
        seed.rowId,
        seed.creationTime,
      );
    }

    const definitions = createAppDeveloperIndexDefinitionPortV1(
      persistence.drizzle,
    );
    const locatedDefinitions = options.developerIndex === true
      ? await runEffect(definitions.locate({
          deploymentId,
          scopeId,
          schemaVersionId,
          tableIds: Object.freeze([tableId]),
          maximumDefinitions: 1,
        }))
      : null;
    const locatedDefinition = locatedDefinitions?.[0];
    if (options.developerIndex === true) {
      if (
        locatedDefinitions?.length !== 1 ||
        locatedDefinition === undefined
      ) {
        throw new Error("Expected one published developer index definition.");
      }
      const clock = await persistence.getScopeClock(scopeId);
      if (clock === null) throw new Error("Missing indexed-query scope clock.");
      await persistence.drizzle.insert(fxSystemIndexBuildStates).values({
        scopeId,
        indexDefinitionId: locatedDefinition.indexDefinitionId,
        storageGeneration:
          FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: clock.storageGenerationFence,
        epoch: clock.epoch,
        startCommitSeq: CommitSeqSchema.make(1n),
        lifecycle: "enabled",
        cursorCodecVersion: INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
        backfillCursorRowId: null,
        attemptFence: IndexBuildAttemptFenceSchema.make(1n),
      });
      const indexedSeeds = [
        ...(options.seedFields === undefined
          ? []
          : [{
              fields: options.seedFields,
              rowId: SEEDED_ROW_ID,
              creationTime: SEEDED_CREATION_TIME,
            }]),
        ...(options.additionalSeedFields === undefined
          ? []
          : [{
              fields: options.additionalSeedFields,
              rowId: SECOND_ROW_ID,
              creationTime: SECOND_CREATION_TIME,
            }]),
        ...(options.extraIndexedSeeds ?? []),
      ];
      for (const seed of indexedSeeds) {
        const canonical = await canonicalizeAppDocumentV1({
          tableId,
          rowId: seed.rowId,
          creationTime: seed.creationTime,
          fields: seed.fields,
        });
        Result.getOrThrow(
          await persistence.drizzle.transaction((tx) =>
            appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
              tx,
              {
                kind: "live",
                scopeId,
                definition: locatedDefinition,
                encodedKey: Result.getOrThrow(lowerAppDeveloperIndexKeyV1(
                  locatedDefinition,
                  canonical,
                  seed.creationTime,
                )),
                rowId: decodeOrderedIndexRowIdHexV1(seed.rowId),
                writeEpoch: clock.epoch,
                commitSeq: CommitSeqSchema.make(1n),
                prevCommitSeq: null,
              },
            )
          ),
        );
      }
    }

    const ports = resolutionPorts(persistence, options.targetOptions);
    const activation = await activatePointMutationSession(
      createPointMutationSessionActivationPersistenceV1(
        ports,
        {
          leaseDurationMilliseconds: 60_000,
          randomUuid: () => nextInfrastructureUuid(),
        },
      ),
      pointMutationSessionActivationFixture(
        deploymentId,
        scopeId,
        { evidence: { schemaVersionId } },
      ),
    );
    const randomUuid = options.randomUuid ?? (() => nextInfrastructureUuid());
    if (activation.status !== "created") {
      throw new Error("Expected a newly created journal scenario attempt.");
    }
    const indexedQueries = options.developerIndex !== true ||
        options.indexedQueryComposition === "missing"
      ? undefined
      : createAppDeveloperIndexQueryPortV1(
          options.indexedQueryComposition === "foreignControl"
            ? new Proxy(persistence.drizzle, {})
            : persistence.drizzle,
          options.indexedQueryComposition === "mismatchedAuthority"
            ? Object.freeze({ ...ports })
            : ports,
          definitions,
        );
    const store = createSessionJournalStorePersistenceV1(ports, {
      grantRetentionPolicy:
        options.grantRetentionPolicy ?? TEST_GRANT_RETENTION_POLICY_V1,
      randomUuid,
      ...(options.journalFaultAfter === undefined
        ? {}
        : { faultAfter: options.journalFaultAfter }),
      ...(indexedQueries === undefined
        ? {}
        : { indexedQueries }
      ),
    });
    const attempt = await runEffect(
      store.openAttemptEffect({
        selector: selectorFromAnchor(activation.anchor),
        executionClaim: activation.executionClaim,
        snapshotToken: activation.anchor.snapshotToken,
        schemaVersionId,
      }),
    );
    const table = await runEffect(
      store.resolvePointTableEffect(attempt, "users"),
    );
    const developerIndex = options.developerIndex === true
      ? await runEffect(store.resolveDeveloperIndexEffect(
          table,
          options.developerIndexDescriptor ?? "by_name",
        ))
      : null;

    return Object.freeze({
      deploymentId,
      schemaVersionId,
      tableId,
      otherTableId,
      anchor: activation.anchor,
      executionClaim: activation.executionClaim,
      store,
      attempt,
      table,
      developerIndex,
      developerIndexDefinition: locatedDefinition ?? null,
      seededDocumentId,
      schemaManifest: publication.manifest,
    });
  }

  it("resolves developer index descriptors through the pinned schema artifact", async () => {
    await expect(scenario("o10b_index_descriptor", {
      developerIndex: true,
      developerIndexDescriptor: "by_name",
    })).resolves.toMatchObject({ developerIndex: {} });
    await expect(scenario("o10b_numeric_index_identity_rejected", {
      developerIndex: true,
      developerIndexDescriptor: 1,
    })).rejects.toMatchObject({
      _tag: "InvalidSessionJournalInputV1Error",
      reason: "invalidIndexDescriptor",
    });
    await expect(scenario("o10b_unknown_index_descriptor", {
      developerIndex: true,
      developerIndexDescriptor: "by_missing",
    })).rejects.toMatchObject({
      _tag: "SessionJournalDeveloperIndexUnavailableV1Error",
      reason: "definitionNotFound",
    });
    for (const indexedQueryComposition of [
      "missing",
      "foreignControl",
      "mismatchedAuthority",
    ] as const) {
      await expect(scenario(
        `o10b_${indexedQueryComposition}_query_authority`,
        { developerIndex: true, indexedQueryComposition },
      )).rejects.toMatchObject({
        _tag: "SessionJournalDeveloperIndexUnavailableV1Error",
        reason: "invalidComposition",
      });
    }
  });

  it("captures and replays one exact indexed snapshot page", async () => {
    const current = await scenario("o10a_indexed_snapshot", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    const operation = Object.freeze({
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      bounds: Object.freeze({}),
      limit: 1,
    });
    const executed = await runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      operation,
    ));
    expect(executed).toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "indexRangePage",
        documents: [{ name: "Ada" }],
        isDone: true,
      },
    });
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      operation,
    ))).resolves.toMatchObject({
      kind: "completed",
      delivery: "replayed",
      outcome: { kind: "indexRangePage", isDone: true },
    });

    const state = await persistence.query<Readonly<Record<string, unknown>>>(
      `select indexed_query_syscalls, index_range_dependency_count,
              index_range_dependency_evidence_bytes
         from fx_system_tx_journal where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(state.rows[0]).toMatchObject({
      indexed_query_syscalls: 1,
      index_range_dependency_count: 1,
    });
    const ranges = await persistence.query<Readonly<Record<string, unknown>>>(
      `select ordinal, lower_kind, upper_kind, evidence_bytes
         from fx_system_tx_journal_index_range
        where session_id = $1 order by ordinal`,
      [current.anchor.sessionId],
    );
    expect(ranges.rows).toMatchObject([{
      ordinal: 0,
      lower_kind: "unbounded",
      upper_kind: "unbounded",
    }]);
    expect(state.rows[0]?.index_range_dependency_evidence_bytes).toBe(
      ranges.rows[0]?.evidence_bytes,
    );

    const prepared = await prepareSeal(current.store, current.attempt);
    expect(prepared.journal.readDependencies).toMatchObject([
      { kind: "appRowPoint", observed: { kind: "present" } },
      {
        kind: "appIndexRange",
        tableId: current.tableId,
        direction: "asc",
        lower: null,
        upper: null,
      },
    ]);
  });

  it("stops bounded page materialization when the semantic budget is exceeded", async () => {
    const seeds = Array.from({ length: 9 }, (_, index) => Object.freeze({
      fields: Object.freeze({ name: `batch-${index.toString().padStart(2, "0")}` }),
      rowId: decodeAppRowIdHexV1(
        `84000000000040008000${index.toString(16).padStart(12, "0")}`,
      ),
      creationTime: decodeAppCreationTimeV1(1_725_000_001_000.25 + index),
    }));
    const current = await scenario("o10a_bounded_materialization", {
      developerIndex: true,
      extraIndexedSeeds: seeds,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    const unreadCorruptRow = seeds.at(-1)!;
    await persistence.query(
      `update fx_app_row_rev
          set value_sha256 = $4
        where scope_uuid = $1 and table_id = $2 and row_id = $3`,
      [
        projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
        current.tableId,
        appRowIdHexV1ToBytes(unreadCorruptRow.rowId),
        new Uint8Array(32),
      ],
    );
    await persistence.query(
      `update fx_system_tx_journal
          set read_semantic_bytes = $2
        where session_id = $1`,
      [current.anchor.sessionId, MAX_COMMIT_READ_SEMANTIC_BYTES_V1 - 1],
    );

    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({}),
        limit: MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1,
      },
    ))).resolves.toMatchObject({
      kind: "rejected",
      delivery: "executed",
      issue: {
        reason: "limitExceeded",
        dimension: "readSemanticBytes",
        maximum: MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
      },
    });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "failed",
      read_semantic_bytes: MAX_COMMIT_READ_SEMANTIC_BYTES_V1 - 1,
      point_dependency_count: 0,
      indexed_query_syscalls: 0,
      index_range_dependency_count: 0,
      failure_dimension: "readSemanticBytes",
    });
  });

  it("overlays a staged patch before recording indexed evidence", async () => {
    const current = await scenario("o10a_staged_overlay", {
      seedFields: { name: "before" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    const validator = issueSetupSeededSyscallValidatorProofV1({
      scopeId: current.anchor.scopeId,
      schemaVersionId: current.schemaVersionId,
      schemaManifest: current.schemaManifest,
    });
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(1n),
      documentId: requireSeededDocumentId(current),
      patch: { name: "after" },
    }, validator));
    const result = await runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(2n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ));
    expect(result).toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "indexRangePage",
        documents: [{ name: "after" }],
        isDone: true,
      },
    });
    const ranges = await persistence.query<{ readonly count: number }>(
      `select count(*)::int as count from fx_system_tx_journal_index_range
        where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(ranges.rows[0]?.count).toBe(1);
  });

  it("orders staged inserts, patches, and deletes before applying the page limit", async () => {
    const current = await scenario("o10b_staged_overlay_order", {
      seedFields: { name: "Ada" },
      additionalSeedFields: { name: "Zoe" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-B developer index handle.");
    }
    const validator = issueSetupSeededSyscallValidatorProofV1({
      scopeId: current.anchor.scopeId,
      schemaVersionId: current.schemaVersionId,
      schemaManifest: current.schemaManifest,
    });
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(1n),
      documentId: appDocumentIdV1FromRowIdentity({
        tableId: current.tableId,
        rowId: SECOND_ROW_ID,
      }),
      patch: { name: "Aaron" },
    }, validator));
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "delete",
      syscallSequence: syscallSequence(2n),
      documentId: requireSeededDocumentId(current),
    }, validator));
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(3n),
      fields: { name: "Mia" },
    }, validator));

    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(4n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ))).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "indexRangePage",
        documents: [{ name: "Aaron" }],
        isDone: false,
      },
    });
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(5n),
        bounds: Object.freeze({}),
        limit: 3,
      },
    ))).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "indexRangePage",
        documents: [{ name: "Aaron" }, { name: "Mia" }],
        isDone: true,
      },
    });
  });

  it("captures a composite frontier, then merges an exhausted replay range", async () => {
    const current = await scenario("o10a_frontier_merge", {
      seedFields: { name: "Ada" },
      additionalSeedFields: { name: "Zoe" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ))).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        documents: [{ name: "Ada" }],
        isDone: false,
      },
    });
    const frontier = await persistence.query<Readonly<Record<string, unknown>>>(
      `select upper_kind, upper_encoded_key, upper_row_id
         from fx_system_tx_journal_index_range
        where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(frontier.rows).toMatchObject([{
      upper_kind: "position_inclusive",
    }]);
    expect(frontier.rows[0]?.upper_encoded_key).toBeInstanceOf(Uint8Array);
    expect(frontier.rows[0]?.upper_row_id).toBeInstanceOf(Uint8Array);

    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(2n),
        bounds: Object.freeze({}),
        limit: 2,
      },
    ))).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        documents: [{ name: "Ada" }, { name: "Zoe" }],
        isDone: true,
      },
    });
    const merged = await persistence.query<Readonly<Record<string, unknown>>>(
      `select ordinal, lower_kind, upper_kind
         from fx_system_tx_journal_index_range
        where session_id = $1 order by ordinal`,
      [current.anchor.sessionId],
    );
    expect(merged.rows).toEqual([{
      ordinal: 0,
      lower_kind: "unbounded",
      upper_kind: "unbounded",
    }]);
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      indexed_query_syscalls: 2,
      index_range_dependency_count: 1,
      point_dependency_count: 2,
    });
  });

  it("records the complete requested interval for an empty indexed page", async () => {
    const current = await scenario("o10a_empty_range", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({
          startInclusive: decodeOrderedIndexBoundHexV1("ff"),
        }),
        limit: 1,
      },
    ))).resolves.toMatchObject({
      kind: "completed",
      outcome: { documents: [], isDone: true },
    });
    const ranges = await persistence.query<Readonly<Record<string, unknown>>>(
      `select lower_kind, lower_encoded_key, upper_kind
         from fx_system_tx_journal_index_range
        where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(ranges.rows).toMatchObject([{
      lower_kind: "key_inclusive",
      upper_kind: "unbounded",
    }]);
    expect(ranges.rows[0]?.lower_encoded_key).toEqual(new Uint8Array([255]));
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      point_dependency_count: 0,
      read_documents: 0,
      indexed_query_syscalls: 1,
    });
  });

  it("fails the indexed-call ceiling before build or index data I/O and replays it", async () => {
    const current = await scenario("o10a_query_ceiling", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    await persistence.query(
      `update fx_system_tx_journal
          set indexed_query_syscalls = $2
        where session_id = $1`,
      [current.anchor.sessionId, MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1],
    );
    await persistence.query(
      `update fx_system_index_build_state
          set lifecycle = 'declared'
        where scope_id = $1`,
      [current.anchor.scopeId],
    );
    const request = Object.freeze({
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      bounds: Object.freeze({}),
      limit: 1,
    });
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      request,
    ))).resolves.toMatchObject({
      kind: "rejected",
      delivery: "executed",
      issue: {
        reason: "limitExceeded",
        dimension: "indexedQuerySyscalls",
        observed: MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1 + 1,
      },
    });
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      request,
    ))).resolves.toMatchObject({
      kind: "rejected",
      delivery: "replayed",
    });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "failed",
      last_syscall_sequence: "1",
      failure_dimension: "indexedQuerySyscalls",
    });
    const ranges = await persistence.query<{ readonly count: number }>(
      `select count(*)::int as count
         from fx_system_tx_journal_index_range
        where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(ranges.rows).toEqual([{ count: 0 }]);
  });

  it("rejects indexed replay and sticky receipts that disagree with the root", async () => {
    const replay = await scenario("o10a_replay_root_mismatch", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (replay.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    const operation = Object.freeze({
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      bounds: Object.freeze({}),
      limit: 1,
    });
    await runEffect(replay.store.runIndexedQueryEffect(
      replay.developerIndex,
      operation,
    ));
    await persistence.query(
      `update fx_system_tx_journal
          set state = 'failed', failure_dimension = 'indexedQuerySyscalls'
        where session_id = $1`,
      [replay.anchor.sessionId],
    );
    const replayFailure = await runFailure(
      replay.store.runIndexedQueryEffect(replay.developerIndex, operation),
    );
    expect(replayFailure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(replayFailure).toMatchObject({
      reason: "failedJournalReceiptInvalid",
    });

    const sticky = await scenario("o10a_sticky_root_mismatch", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (sticky.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    await persistence.query(
      `update fx_system_tx_journal
          set indexed_query_syscalls = $2
        where session_id = $1`,
      [sticky.anchor.sessionId, MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1],
    );
    await runEffect(sticky.store.runIndexedQueryEffect(
      sticky.developerIndex,
      operation,
    ));
    const wrongLimit = await canonicalizeFlarexValueV1({
      kind: "error",
      reason: "limitExceeded",
      dimension: "readDocuments",
      observed: MAX_COMMIT_READ_DOCUMENTS_V1 + 1,
      maximum: MAX_COMMIT_READ_DOCUMENTS_V1,
    });
    await persistence.query(
      `update fx_system_tx_journal_latest_receipt
          set outcome_bytes = $2, outcome_sha256 = $3
        where session_id = $1`,
      [
        sticky.anchor.sessionId,
        wrongLimit.canonicalBytes,
        wrongLimit.sha256,
      ],
    );
    const stickyFailure = await runFailure(
      sticky.store.runIndexedQueryEffect(sticky.developerIndex, {
        ...operation,
        syscallSequence: syscallSequence(2n),
      }),
    );
    expect(stickyFailure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(stickyFailure).toMatchObject({
      reason: "failedJournalReceiptInvalid",
    });
  });

  it("rejects indexed page receipts that violate the requested page shape", async () => {
    const current = await scenario("o10a_receipt_page_shape", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    const operation = Object.freeze({
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      bounds: Object.freeze({}),
      limit: 1,
    });
    await runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      operation,
    ));
    const malformedPages = [
      {
        kind: "indexRangePage",
        documentsValueJson: [{ name: "one" }, { name: "two" }],
        isDone: true,
      },
      {
        kind: "indexRangePage",
        documentsValueJson: [],
        isDone: false,
      },
    ] as const;
    for (const malformedPage of malformedPages) {
      const evidence = await canonicalizeFlarexValueV1(malformedPage);
      await persistence.query(
        `update fx_system_tx_journal_latest_receipt
            set outcome_bytes = $2, outcome_sha256 = $3
          where session_id = $1`,
        [
          current.anchor.sessionId,
          evidence.canonicalBytes,
          evidence.sha256,
        ],
      );
      const failure = await runFailure(current.store.runIndexedQueryEffect(
        current.developerIndex,
        operation,
      ));
      expect(failure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
      expect(failure).toMatchObject({ reason: "latestReceiptEvidenceInvalid" });
    }
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "1",
      indexed_query_syscalls: 1,
    });
  });

  it("rejects a snapshot document that no longer lowers to its stored index position", async () => {
    const current = await scenario("o10a_snapshot_position_mismatch", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    const mismatched = await canonicalizeAppDocumentV1({
      tableId: current.tableId,
      rowId: SEEDED_ROW_ID,
      creationTime: SEEDED_CREATION_TIME,
      fields: { name: "Zoe" },
    });
    await persistence.query(
      `update fx_app_row_rev
          set value_codec_version = $5,
              value_json = $6,
              value_bytes = $7,
              value_sha256 = $8
        where scope_uuid = (
          select scope_uuid from fx_system_tx_session where session_id = $1
        )
          and table_id = $2
          and row_id = $3
          and commit_seq = $4`,
      [
        current.anchor.sessionId,
        current.tableId,
        appRowIdHexV1ToBytes(SEEDED_ROW_ID),
        1n,
        mismatched.codecVersion,
        mismatched.valueJson,
        mismatched.canonicalBytes,
        mismatched.sha256,
      ],
    );
    const failure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ));
    expect(failure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(failure).toMatchObject({ reason: "indexedSnapshotPositionMismatch" });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 0,
      points: 0,
    });
  });

  it("rejects an index entry whose stored table identity changed", async () => {
    const current = await scenario("o10a_index_table_mismatch", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (
      current.developerIndex === null ||
      current.developerIndexDefinition === null
    ) {
      throw new Error("Missing O10-A developer index authority.");
    }
    await seedSnapshotDocument(
      persistence,
      current.anchor.scopeId,
      current.otherTableId,
      current.schemaVersionId,
      { name: "Ada" },
    );
    await persistence.query(
      `update fx_app_index_entry_rev
          set table_id = $2
        where scope_uuid = (
          select scope_uuid from fx_system_tx_session where session_id = $1
        )
          and index_definition_id = $3`,
      [
        current.anchor.sessionId,
        current.otherTableId,
        current.developerIndexDefinition.indexDefinitionId,
      ],
    );
    const failure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ));
    expect(failure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(failure).toMatchObject({ reason: "indexedSnapshotPositionMismatch" });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
      indexed_query_syscalls: 0,
    });
  });

  it("rolls back point and range evidence when the indexed query transaction fails", async () => {
    const current = await scenario("o10a_indexed_query_rollback", {
      seedFields: { name: "Ada" },
      developerIndex: true,
      journalFaultAfter: (point) => {
        if (point === "indexedQueryEvidenceWritten") {
          throw new Error("injected indexed-query evidence failure");
        }
      },
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    const failure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ));
    expect(failure).toBeInstanceOf(SessionJournalPersistenceV1Error);
    expect(failure).toMatchObject({ operation: "runIndexedQuery" });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
      read_documents: 0,
      point_dependency_count: 0,
      indexed_query_syscalls: 0,
      index_range_dependency_count: 0,
      index_range_dependency_evidence_bytes: 0,
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 0,
      points: 0,
    });
    const ranges = await persistence.query<{ readonly count: number }>(
      `select count(*)::int as count
         from fx_system_tx_journal_index_range
        where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(ranges.rows).toEqual([{ count: 0 }]);
  });

  it("rejects root range counters that disagree with durable child evidence", async () => {
    const cases = [
      {
        label: "count",
        column: "index_range_dependency_count",
        reason: "indexRangeDependencyCountMismatch",
      },
      {
        label: "bytes",
        column: "index_range_dependency_evidence_bytes",
        reason: "indexRangeDependencyEvidenceBytesMismatch",
      },
    ] as const;
    for (const testCase of cases) {
      const current = await scenario(`o10a_range_root_${testCase.label}`, {
        seedFields: { name: "Ada" },
        developerIndex: true,
      });
      if (current.developerIndex === null) {
        throw new Error("Missing O10-A developer index authority.");
      }
      await persistence.query(
        `update fx_system_tx_journal
            set ${testCase.column} = 1
          where session_id = $1`,
        [current.anchor.sessionId],
      );
      const failure = await runFailure(current.store.runIndexedQueryEffect(
        current.developerIndex,
        {
          kind: "indexRange",
          syscallSequence: syscallSequence(1n),
          bounds: Object.freeze({}),
          limit: 1,
        },
      ));
      expect(failure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
      expect(failure).toMatchObject({ reason: testCase.reason });
      expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
        state: "open",
        last_syscall_sequence: "0",
        indexed_query_syscalls: 0,
        index_range_dependency_count: testCase.label === "count" ? 1 : 0,
        index_range_dependency_evidence_bytes:
          testCase.label === "bytes" ? 1 : 0,
      });
      expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
        receipts: 0,
        points: 0,
      });
    }
  });

  it("rejects durable range rows stored outside canonical ordinal order", async () => {
    const current = await scenario("o10a_range_order", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    for (const [offset, bounds] of [
      { startInclusive: "10", endExclusive: "20" },
      { startInclusive: "30", endExclusive: "40" },
    ].entries()) {
      await runEffect(current.store.runIndexedQueryEffect(
        current.developerIndex,
        {
          kind: "indexRange",
          syscallSequence: syscallSequence(BigInt(offset + 1)),
          bounds: Object.freeze({
            startInclusive: decodeOrderedIndexBoundHexV1(bounds.startInclusive),
            endExclusive: decodeOrderedIndexBoundHexV1(bounds.endExclusive),
          }),
          limit: 1,
        },
      ));
    }
    await persistence.query(
      `update fx_system_tx_journal_index_range
          set ordinal = 31
        where session_id = $1 and ordinal = 0`,
      [current.anchor.sessionId],
    );
    await persistence.query(
      `update fx_system_tx_journal_index_range
          set ordinal = 0
        where session_id = $1 and ordinal = 1`,
      [current.anchor.sessionId],
    );
    await persistence.query(
      `update fx_system_tx_journal_index_range
          set ordinal = 1
        where session_id = $1 and ordinal = 31`,
      [current.anchor.sessionId],
    );
    const queryFailure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(3n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ));
    expect(queryFailure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(queryFailure).toMatchObject({ reason: "indexRangeDependencyInvalid" });
    const sealFailure = await runFailure(
      current.store.prepareSealEffect(current.attempt),
    );
    expect(sealFailure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(sealFailure).toMatchObject({ reason: "indexRangeDependencyInvalid" });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "2",
      index_range_dependency_count: 2,
    });
  });

  it("maps malformed or throwing indexed bounds to invalid input", async () => {
    const current = await scenario("o10a_invalid_bounds", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    const common = {
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      limit: 1,
    };
    const nullBounds = {
      ...common,
      bounds: null,
    } as unknown as SessionJournalIndexedQueryOperationV1;
    const nullFailure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      nullBounds,
    ));
    expect(nullFailure).toBeInstanceOf(InvalidSessionJournalInputV1Error);
    expect(nullFailure).toMatchObject({
      operation: "indexRange",
      reason: "invalidOperation",
    });

    const getterFailure = new Error("injected bound getter failure");
    const throwingBounds = Object.defineProperty({}, "startInclusive", {
      enumerable: true,
      get: () => {
        throw getterFailure;
      },
    });
    const throwingOperation = {
      ...common,
      bounds: throwingBounds,
    } as unknown as SessionJournalIndexedQueryOperationV1;
    const thrownFailure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      throwingOperation,
    ));
    expect(thrownFailure).toBeInstanceOf(InvalidSessionJournalInputV1Error);
    expect(thrownFailure).toMatchObject({
      operation: "indexRange",
      reason: "invalidOperation",
      cause: getterFailure,
    });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
      indexed_query_syscalls: 0,
    });
  });

  it("rejects invalid insert, patch, and replace before journal acceptance", async () => {
    const cases = ["insert", "patch", "replace"] as const;
    for (const operation of cases) {
      const current = await scenario(`c03v_${operation}`, {
        ...(operation === "insert" ? {} : { seedFields: { name: "before" } }),
      });
      const validator = issueSetupSeededSyscallValidatorProofV1({
        scopeId: current.anchor.scopeId,
        schemaVersionId: current.schemaVersionId,
        schemaManifest: current.schemaManifest,
      });
      const document = current.seededDocumentId;
      const invalid = operation === "insert"
        ? {
          kind: "insert" as const,
          syscallSequence: syscallSequence(1n),
          fields: { name: 42 },
        }
        : operation === "patch"
        ? {
          kind: "patch" as const,
          syscallSequence: syscallSequence(1n),
          documentId: document!,
          patch: { name: 42 },
        }
        : {
          kind: "replace" as const,
          syscallSequence: syscallSequence(1n),
          documentId: document!,
          fields: { name: 42 },
        };
      await expect(runFailure(current.store.runPointOperationEffect(
        current.table,
        invalid,
        validator,
      ))).resolves.toBeInstanceOf(
        ApplicationRevisionSyscallDocumentValidationV1Error,
      );
      await expect(journalCounts(current.anchor.sessionId)).resolves.toMatchObject({
        receipts: 0,
        points: 0,
        events: 0,
      });

      const valid = operation === "insert"
        ? {
          kind: "insert" as const,
          syscallSequence: syscallSequence(1n),
          fields: { name: "after" },
        }
        : operation === "patch"
        ? {
          kind: "patch" as const,
          syscallSequence: syscallSequence(1n),
          documentId: document!,
          patch: { name: "after" },
        }
        : {
          kind: "replace" as const,
          syscallSequence: syscallSequence(1n),
          documentId: document!,
          fields: { name: "after" },
        };
      await expect(runEffect(current.store.runPointOperationEffect(
        current.table,
        valid,
        validator,
      ))).resolves.toMatchObject({ kind: "completed", delivery: "executed" });
      await expect(journalCounts(current.anchor.sessionId)).resolves.toMatchObject({
        receipts: 1,
        points: 1,
        events: 1,
      });
    }
  });

  it("validates authority and documents before accepting a sticky limit failure", async () => {
    const current = await scenario("c03v_limit_priority");
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
    await expect(journalCounts(current.anchor.sessionId)).resolves.toMatchObject({
      receipts: 0,
      points: 0,
      events: 0,
    });
    await expect(journalRoot(current.anchor.sessionId)).resolves.toMatchObject({
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

  it("uses the pinned manifest as table authority and stable bindings only as corroboration", async () => {
    type UnsupportedStoreOperation = Extract<
      keyof SessionJournalStorePersistenceV1,
      "scan" | "query" | "range" | "relation" | "payload" | "medusa"
    >;
    expectTypeOf<UnsupportedStoreOperation>().toEqualTypeOf<never>();

    const current = await scenario("table_resolution");
    await expect(
      runEffect(current.store.openAttemptEffect({
        selector: selectorFromAnchor(current.anchor),
        executionClaim: current.executionClaim,
        snapshotToken: current.anchor.snapshotToken,
        schemaVersionId: current.schemaVersionId,
      })),
    ).resolves.toBeDefined();
    const invalidOpenAttemptInput = {
      selector: {
        ...selectorFromAnchor(current.anchor),
        attemptFence: 0n,
      },
      executionClaim: current.executionClaim,
      snapshotToken: current.anchor.snapshotToken,
      schemaVersionId: current.schemaVersionId,
    };
    const invalidOpenAttemptEffect = Reflect.apply(
      current.store.openAttemptEffect,
      undefined,
      [invalidOpenAttemptInput],
    );
    await expect(runFailure(invalidOpenAttemptEffect)).resolves.toMatchObject({
      operation: "openAttempt",
      reason: "invalidAttemptPins",
    } satisfies Partial<InvalidSessionJournalInputV1Error>);
    const propertyAccessCause = new Error("selector access failed");
    const throwingOpenAttemptInput = Object.defineProperty(
      {},
      "selector",
      {
        enumerable: true,
        get: () => {
          throw propertyAccessCause;
        },
      },
    );
    const throwingOpenAttemptEffect = Reflect.apply(
      current.store.openAttemptEffect,
      undefined,
      [throwingOpenAttemptInput],
    );
    const propertyAccessFailure = await runFailure(
      throwingOpenAttemptEffect,
    );
    expect(propertyAccessFailure).toBeInstanceOf(
      InvalidSessionJournalInputV1Error,
    );
    expect(propertyAccessFailure).toMatchObject({
      operation: "openAttempt",
      reason: "invalidAttemptPins",
      cause: propertyAccessCause,
    } satisfies Partial<InvalidSessionJournalInputV1Error>);
    await expect(
      runEffect(current.store.resolvePointTableEffect(
        current.attempt,
        "users",
      )),
    ).resolves.toBeDefined();
    await expect(
      runFailure(current.store.resolvePointTableEffect(
        current.attempt,
        "comments",
      )),
    ).resolves.toBeInstanceOf(PinnedPointTableNotFoundV1Error);
    await expect(
      runFailure(current.store.resolvePointTableEffect(current.attempt, 42)),
    ).resolves.toMatchObject({
      reason: "invalidTableName",
    } satisfies Partial<InvalidSessionJournalInputV1Error>);
    const resolutionCause = new Error("resolution persistence unavailable");
    const failingResolutionPorts = {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: async () => {
          throw resolutionCause;
        },
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Resolution must stop after the metadata failure.");
        },
      },
      scopeSessionTargets: {
        resolve: async () => {
          throw new Error("Resolution must stop after the metadata failure.");
        },
      },
    } satisfies PointMutationSessionAuthorityResolutionPortsV1;
    const failingResolutionStore = createSessionJournalStorePersistenceV1(
      failingResolutionPorts,
      { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 },
    );
    const resolutionFailure = await runFailure(
      failingResolutionStore.openAttemptEffect({
        selector: selectorFromAnchor(current.anchor),
        executionClaim: current.executionClaim,
        snapshotToken: current.anchor.snapshotToken,
        schemaVersionId: current.schemaVersionId,
      }),
    );
    expect(resolutionFailure).toBeInstanceOf(SessionJournalPersistenceV1Error);
    expect(resolutionFailure).toMatchObject({
      operation: "resolveJournalTarget",
      cause: resolutionCause,
    } satisfies Partial<SessionJournalPersistenceV1Error>);
    await expect(runFailure(current.store.runPointOperationEffect(
      current.table,
      {
        kind: "patch",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(current.tableId, 999),
        patch: { ["r".repeat(1_025)]: undefined },
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ))).resolves.toBeInstanceOf(InvalidSessionJournalInputV1Error);
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
    });

    const pointInputAccesses: string[] = [];
    const pointInputCause = new Error("syscall sequence access failed");
    const throwingPointInput = Object.defineProperties({}, {
      syscallSequence: {
        enumerable: true,
        get: () => {
          pointInputAccesses.push("syscallSequence");
          throw pointInputCause;
        },
      },
      kind: {
        enumerable: true,
        get: () => {
          pointInputAccesses.push("kind");
          return "get";
        },
      },
    });
    const throwingPointEffect = Reflect.apply(
      current.store.runPointOperationEffect,
      undefined,
      [current.table, throwingPointInput],
    );
    await expect(runFailure(throwingPointEffect)).resolves.toMatchObject({
      operation: "get",
      reason: "invalidOperation",
      cause: pointInputCause,
    } satisfies Partial<InvalidSessionJournalInputV1Error>);
    expect(pointInputAccesses).toEqual(["syscallSequence", "kind"]);

    await persistence.query(
      `
        update fx_control_table
        set logical_name = 'users_retired_for_corruption_test'
        where deployment_id = $1 and logical_name = 'users'
      `,
      [current.deploymentId],
    );
    await persistence.query(
      `
        update fx_control_table
        set logical_name = 'users'
        where deployment_id = $1 and logical_name = 'posts'
      `,
      [current.deploymentId],
    );
    await expect(
      runFailure(
        current.store.resolvePointTableEffect(current.attempt, "users"),
      ),
    ).resolves.toMatchObject({
      reason: "stableBindingMismatch",
      tableName: decodeSchemaManifestAppTableName("users"),
    } satisfies Partial<PinnedPointTableCorruptionV1Error>);
  });

  it("keeps unexpected value-normalizer failures in the defect channel", async () => {
    const current = await scenario("point_input_normalizer_defect");
    const defect = new Error("value proxy inspection failed");
    const fields = new Proxy({}, {
      ownKeys: () => {
        throw defect;
      },
    });

    const exit = await Effect.runPromiseExit(
      current.store.runPointOperationEffect(current.table, {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields,
      }, SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons).toHaveLength(1);
      const reason = exit.cause.reasons[0];
      expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
      if (reason !== undefined && Cause.isDieReason(reason)) {
        expect(reason.defect).toBe(defect);
      }
    }
    await expect(journalCounts(current.anchor.sessionId)).resolves.toMatchObject({
      receipts: 0,
      points: 0,
    });
  });

  it("rejects the stale execution owner at open, syscall, and seal after takeover", async () => {
    const current = await scenario("execution_claim_takeover");
    await persistence.query(
      `update fx_system_tx_execution_claim
       set claimed_at = clock_timestamp() - interval '2 minutes',
           claim_expires_at = clock_timestamp() - interval '1 minute'
       where session_id = $1`,
      [current.anchor.sessionId],
    );
    const acquisition = createPointMutationExecutionClaimAcquisitionV1(
      resolutionPorts(persistence),
      {
        durationMilliseconds: 30_000,
        randomOwner: () => "83000000-0000-4000-8000-000000009991",
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
    await expect(runFailure(current.store.openAttemptEffect({
      selector: selectorFromAnchor(current.anchor),
      executionClaim: current.executionClaim,
      snapshotToken: current.anchor.snapshotToken,
      schemaVersionId: current.schemaVersionId,
    }))).resolves.toMatchObject(staleIssue);
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 991),
    })).rejects.toMatchObject(staleIssue);
    await expect(runFailure(
      current.store.prepareSealEffect(current.attempt),
    )).resolves.toMatchObject(staleIssue);
  });

  it("classifies an invalid pinned manifest as stored catalog corruption", async () => {
    const current = await scenario("table_resolution_manifest_corruption");
    await persistence.query(
      `
        update fx_control_schema_version
        set manifest_json = '{}'::jsonb
        where deployment_id = $1 and schema_version_id = $2
      `,
      [current.deploymentId, current.schemaVersionId],
    );

    const failure = await runFailure(current.store.resolvePointTableEffect(
      current.attempt,
      "users",
    ));
    expect(failure).toBeInstanceOf(PinnedPointTableCorruptionV1Error);
    expect(failure).toMatchObject({
      reason: "schemaArtifactInvalid",
      cause: expect.any(SchemaVersionArtifactCorruptionError),
    } satisfies Partial<PinnedPointTableCorruptionV1Error>);
  });

  it("maps a pinned table query rejection once at the resolver boundary", async () => {
    const current = await scenario("table_resolution_sql_failure");
    const input = {
      deploymentId: current.deploymentId,
      schemaVersionId: current.schemaVersionId,
      tableName: decodeSchemaManifestAppTableName("users"),
    };
    const queryFailure = new Error("pinned schema query unavailable");
    const failingDatabase = rejectSelectedQuery(
      persistence.drizzle,
      1,
      () => Promise.reject(queryFailure),
    );
    await expect(runFailure(resolvePinnedPointTableIdV1Effect(
      failingDatabase,
      input,
    ))).resolves.toMatchObject({
      operation: "loadSchemaArtifact",
      cause: queryFailure,
    } satisfies Partial<PinnedPointTablePersistenceV1Error>);

    const bindingQueryFailure = new Error(
      "pinned stable binding query unavailable",
    );
    const bindingFailingDatabase = rejectSelectedQuery(
      persistence.drizzle,
      3,
      () => Promise.reject(bindingQueryFailure),
    );
    await expect(runFailure(resolvePinnedPointTableIdV1Effect(
      bindingFailingDatabase,
      input,
    ))).resolves.toMatchObject({
      operation: "loadStableBinding",
      cause: bindingQueryFailure,
    } satisfies Partial<PinnedPointTablePersistenceV1Error>);

    const basePorts = resolutionPorts(persistence);
    const sessionFailingDatabase = rejectSelectedQuery(
      persistence.drizzle,
      1,
      () => Promise.reject(queryFailure),
    );
    const failingPorts = {
      ...basePorts,
      scopeSessionTargets: {
        resolve: async (physicalLocator) => {
          const target = await basePorts.scopeSessionTargets.resolve(
            physicalLocator,
          );
          return Object.freeze({
            ...target,
            [RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1]: (
              resolutionInput: ResolvePinnedPointTableIdV1Input,
            ) =>
              resolvePinnedPointTableIdV1Effect(
                sessionFailingDatabase,
                resolutionInput,
              ),
          });
        },
      },
    } satisfies PointMutationSessionAuthorityResolutionPortsV1;
    const store = createSessionJournalStorePersistenceV1(failingPorts, {
      grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    });
    const attempt = await runEffect(store.openAttemptEffect({
      selector: selectorFromAnchor(current.anchor),
      executionClaim: current.executionClaim,
      snapshotToken: current.anchor.snapshotToken,
      schemaVersionId: current.schemaVersionId,
    }));
    await expect(runFailure(store.resolvePointTableEffect(
      attempt,
      "users",
    ))).resolves.toMatchObject({
      operation: "resolvePinnedPointTable",
      cause: queryFailure,
    } satisfies Partial<SessionJournalPersistenceV1Error>);
  });

  it("waits for an outstanding pinned table query after interruption", async () => {
    const current = await scenario("table_resolution_interruption");
    const entered = deferredSignal();
    const release = deferredSignal();
    const queryFailure = new Error("interrupted pinned table query settled");
    const pendingDatabase = rejectSelectedQuery(
      persistence.drizzle,
      1,
      async () => {
        entered.resolve();
        await release.promise;
        throw queryFailure;
      },
    );
    const fiber = Effect.runFork(resolvePinnedPointTableIdV1Effect(
      pendingDatabase,
      {
        deploymentId: current.deploymentId,
        schemaVersionId: current.schemaVersionId,
        tableName: decodeSchemaManifestAppTableName("users"),
      },
    ));

    await entered.promise;
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      release.resolve();
    }
    await interruption;
    expect(interruptionSettled).toBe(true);
  });

  it("keeps one durable latest receipt across replay, mismatch, gap, and stale delivery", async () => {
    const current = await scenario("latest_receipt");
    const firstDocumentId = documentId(current.tableId, 101);
    const secondDocumentId = documentId(current.tableId, 102);
    const firstRequest = Object.freeze({
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: firstDocumentId,
    } satisfies SessionJournalPointOperationV1);

    await expect(
      runEffect(current.store.runPointOperationEffect(
        current.table,
        firstRequest,
        SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
      )),
    ).resolves.toEqual({
      kind: "completed",
      delivery: "executed",
      outcome: { kind: "missing", document: null },
    });
    await expect(
      runPointOperation(current.store, current.table, firstRequest),
    ).resolves.toEqual({
      kind: "completed",
      delivery: "replayed",
      outcome: { kind: "missing", document: null },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: secondDocumentId,
    })).resolves.toMatchObject({
      kind: "sequenceRejected",
      issue: { reason: "requestMismatch", syscallSequence: 1n },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(3n),
      documentId: secondDocumentId,
    })).resolves.toMatchObject({
      kind: "sequenceRejected",
      issue: { reason: "sequenceGap", actual: 3n, expectedNext: 2n },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(2n),
      documentId: secondDocumentId,
    })).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: { kind: "missing" },
    });
    await expect(
      runPointOperation(current.store, current.table, firstRequest),
    ).resolves.toMatchObject({
      kind: "sequenceRejected",
      issue: { reason: "staleSequence", actual: 1n, lastAccepted: 2n },
    });

    const counts = await journalCounts(current.anchor.sessionId);
    expect(counts).toMatchObject({ roots: 1, receipts: 1, points: 2 });
    const receipt = await persistence.query<{
      last_syscall_sequence: string;
      operation_kind: string;
    }>(
      `
        select last_syscall_sequence::text, operation_kind
        from fx_system_tx_journal_latest_receipt
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );
    expect(receipt.rows).toEqual([{
      last_syscall_sequence: "2",
      operation_kind: "get",
    }]);
  });

  it("preserves an unexpected replay evidence rejection as a defect after rollback", async () => {
    const current = await scenario("point_replay_evidence_defect");
    const request = Object.freeze({
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 103),
    } satisfies SessionJournalPointOperationV1);
    await runPointOperation(current.store, current.table, request);

    const defect = new Error("point replay evidence hashing unavailable");
    const nativeDigest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementationOnce(nativeDigest)
      .mockRejectedValueOnce(defect);
    try {
      const exit = await Effect.runPromiseExit(
        current.store.runPointOperationEffect(
          current.table,
          request,
          SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const reason = exit.cause.reasons[0];
        expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
        if (reason !== undefined && Cause.isDieReason(reason)) {
          expect(reason.defect).toBe(defect);
        }
      }
      await expect(
        journalCounts(current.anchor.sessionId),
      ).resolves.toMatchObject({ receipts: 1, points: 1 });
    } finally {
      digest.mockRestore();
    }
  });

  it("isolates exact-attempt callback failure state for every Effect execution", async () => {
    const current = await scenario("exact_attempt_effect_reuse");
    const transactionFailure = new Error("second transaction failed");
    let failBeforeWork = false;
    const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
      persistence,
      sharedLocator,
      {
        afterLoadLock: (step) => {
          if (failBeforeWork && step === "clockLocked") {
            throw transactionFailure;
          }
        },
      },
    );
    const located = await runEffect(
      resolveLocatedTrustedScopeAuthorityEffect(current.deploymentId, {
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error(
              "Shared exact-attempt resolution must not read receipts.",
            );
          },
        },
        scopeClockTargets: {
          resolve: async (): Promise<LocatedScopeClockReader> => target,
        },
      }),
    );
    expect(isLocatedExactRunningAttemptKernelV1(located.target)).toBe(true);
    if (!isLocatedExactRunningAttemptKernelV1(located.target)) {
      throw new Error("Expected the exact-attempt Effect capability.");
    }

    const callbackFailure = new Error("first callback failed");
    const reusable = located.target[
      RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
    ](
      {
        selector: {
          deploymentId: current.anchor.deploymentId,
          scopeId: current.anchor.scopeId,
          sessionId: current.anchor.sessionId,
          attemptFence: current.anchor.attemptFence,
        },
        executionClaim: current.executionClaim,
        preliminaryAuthority: located.authority,
      },
      () => Effect.fail(callbackFailure),
    );

    await expect(runFailure(reusable)).resolves.toBe(callbackFailure);
    failBeforeWork = true;
    const secondFailure = await runFailure(reusable);
    expect(secondFailure).toBeInstanceOf(ExactRunningAttemptTransactionV1Error);
    expect(secondFailure).toMatchObject({
      cause: transactionFailure,
      callbackCause: undefined,
    } satisfies Partial<ExactRunningAttemptTransactionV1Error>);
  });

  it("preserves a callback defect or interruption when transaction cleanup also fails", async () => {
    const callbackDefect = new Error("exact-attempt callback defect");
    const interruptorFiberId = 73;
    for (const callbackCause of [
      Cause.die(callbackDefect),
      Cause.interrupt(interruptorFiberId),
    ]) {
      const transactionFailure = new ExactRunningAttemptTransactionV1Error({
        cause: new Error("rollback failed"),
        callbackCause,
      });
      const exit = await Effect.runPromiseExit(
        reconcileExactRunningAttemptTransactionFailureV1(
          transactionFailure,
          callbackCause,
          new Error("rollback signal"),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error(
          "Expected the dual failure to preserve its Effect Cause.",
        );
      }
      expect(
        exit.cause.reasons.filter(Cause.isDieReason).map(
          (reason) => reason.defect,
        ),
      ).toContain(transactionFailure);
      if (Cause.hasDies(callbackCause)) {
        expect(
          exit.cause.reasons.filter(Cause.isDieReason).map(
            (reason) => reason.defect,
          ),
        ).toContain(callbackDefect);
      } else {
        expect(
          exit.cause.reasons.filter(Cause.isInterruptReason).map(
            (reason) => reason.fiberId,
          ),
        ).toContain(interruptorFiberId);
      }
    }
  });

  it("reads the pinned snapshot once, then serves the staged same-row overlay", async () => {
    const current = await scenario("present_overlay", {
      seedFields: { name: "database" },
    });
    const documentId = requireSeededDocumentId(current);

    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId,
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "present", document: { name: "database" } },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(2n),
      documentId,
      patch: { name: "overlay" },
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "unit", operation: "patch" },
    });

    await persistence.query(
      `
        delete from fx_app_row_current
        where scope_uuid = (
          select scope_uuid from fx_system_tx_session where session_id = $1
        )
      `,
      [current.anchor.sessionId],
    );
    await persistence.query(
      `
        delete from fx_app_row_rev
        where scope_uuid = (
          select scope_uuid from fx_system_tx_session where session_id = $1
        )
      `,
      [current.anchor.sessionId],
    );

    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(3n),
      documentId,
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "present", document: { name: "overlay" } },
    });

    const prepared = await prepareSeal(current.store, current.attempt);
    expect(prepared.journal.readDependencies).toEqual([{
      kind: "appRowPoint",
      documentId,
      observed: { kind: "present", revisionCommitSeq: 1n },
    }]);
    expect(prepared.journal.readUsage.documentsRead).toBe(3);
    expect(prepared.journal.writes).toMatchObject([{
      kind: "patch",
      syscallSequence: 2n,
      documentId,
    }]);
  });

  it("retains raw material writes while deterministically composing insert, patch, replace, delete, and no-op state", async () => {
    const firstUuid = "84000000-0000-4000-8000-000000000001";
    const secondUuid = "84000000-0000-4000-8000-000000000002";
    const generated = uuidSequence(firstUuid, firstUuid, secondUuid);
    const current = await scenario("write_composition", {
      randomUuid: generated,
    });

    const inserted = await runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "created", keep: true },
    });
    const firstDocumentId = requireInsertedDocumentId(inserted);
    const firstCreationTime = requireInsertedCreationTime(inserted);

    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(2n),
      documentId: firstDocumentId,
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "present", document: { name: "created", keep: true } },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(3n),
      documentId: firstDocumentId,
      patch: { name: "patched", keep: undefined },
    })).resolves.toMatchObject({ kind: "completed" });
    await expect(runPointOperation(current.store, current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(4n),
      documentId: firstDocumentId,
      patch: { name: "patched" },
    })).resolves.toMatchObject({ kind: "completed" });
    await expect(runPointOperation(current.store, current.table, {
      kind: "replace",
      syscallSequence: syscallSequence(5n),
      documentId: firstDocumentId,
      fields: { name: "replaced" },
    })).resolves.toMatchObject({ kind: "completed" });
    await expect(runPointOperation(current.store, current.table, {
      kind: "delete",
      syscallSequence: syscallSequence(6n),
      documentId: firstDocumentId,
    })).resolves.toMatchObject({ kind: "completed" });
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(7n),
      documentId: firstDocumentId,
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "missing" },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(8n),
      documentId: firstDocumentId,
      patch: { name: "cannot-resurrect" },
    })).resolves.toMatchObject({
      kind: "rejected",
      issue: { reason: "documentNotFound", operation: "patch" },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(9n),
      fields: { name: "collision" },
    })).resolves.toMatchObject({
      kind: "rejected",
      issue: { reason: "documentIdCollision", documentId: firstDocumentId },
    });
    const secondInsert = await runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(10n),
      fields: { name: "second" },
    });
    const secondDocumentId = requireInsertedDocumentId(secondInsert);
    const secondCreationTime = requireInsertedCreationTime(secondInsert);
    expect(secondCreationTime).toBe(
      nextCreationTime(nextCreationTime(firstCreationTime)),
    );

    const prepared = await prepareSeal(current.store, current.attempt);
    expect(prepared.journal.finalSyscallSequence).toBe(10n);
    expect(prepared.journal.readDependencies).toMatchObject([
      {
        documentId: firstDocumentId,
        observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
      },
      {
        documentId: secondDocumentId,
        observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
      },
    ]);
    expect(prepared.journal.writes.map((write) => ({
      kind: write.kind,
      syscallSequence: write.syscallSequence,
    }))).toEqual([
      { kind: "insert", syscallSequence: 1n },
      { kind: "patch", syscallSequence: 3n },
      { kind: "replace", syscallSequence: 5n },
      { kind: "delete", syscallSequence: 6n },
      { kind: "insert", syscallSequence: 10n },
    ]);

    const expectedBytes = await Promise.all([
      semanticBytes(firstDocumentId, firstCreationTime, {
        name: "created",
        keep: true,
      }),
      semanticBytes(firstDocumentId, firstCreationTime, { name: "patched" }),
      semanticBytes(firstDocumentId, firstCreationTime, { name: "replaced" }),
      semanticBytes(secondDocumentId, secondCreationTime, { name: "second" }),
    ]);
    expect(prepared.journal.writes).toMatchObject([
      { resultingDocumentSemanticBytes: expectedBytes[0] },
      { resultingDocumentSemanticBytes: expectedBytes[1] },
      { resultingDocumentSemanticBytes: expectedBytes[2] },
      { kind: "delete" },
      { resultingDocumentSemanticBytes: expectedBytes[3] },
    ]);

    const root = await journalRoot(current.anchor.sessionId);
    expect(root).toMatchObject({
      last_syscall_sequence: "10",
      point_dependency_count: 2,
      read_documents: 5,
      write_operations: 5,
      next_creation_time: nextCreationTime(secondCreationTime),
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 1,
      points: 2,
      events: 5,
    });
  });

  it("uses UUIDv4 identities and IEEE-754 nextUp creation times without rerunning randomness on durable replay", async () => {
    const generatedUuid = "85000000-0000-4000-8000-000000000001";
    let randomCalls = 0;
    const randomUuid = (): string => {
      randomCalls += 1;
      return generatedUuid;
    };
    const current = await scenario("identity_creation_time", { randomUuid });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      material_write_event_evidence_bytes: 0,
    });
    const request = Object.freeze({
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "stable" },
    } satisfies SessionJournalPointOperationV1);

    const created = await runPointOperation(current.store, current.table,
      request,
    );
    const creationTime = requireInsertedCreationTime(created);
    expect(requireInsertedDocumentId(created)).toBe(
      decodeAppDocumentIdV1(`${current.tableId}:${generatedUuid}`),
    );
    expect(randomCalls).toBe(1);
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      creation_time_seed: creationTime,
      next_creation_time: nextCreationTime(creationTime),
    });

    const restartedStore = createSessionJournalStorePersistenceV1(
      resolutionPorts(persistence),
      {
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        randomUuid: () => {
          throw new Error("Replay must not request new randomness.");
        },
      },
    );
    const restartedAttempt = await runEffect(
      restartedStore.openAttemptEffect({
        selector: selectorFromAnchor(current.anchor),
        executionClaim: current.executionClaim,
        snapshotToken: current.anchor.snapshotToken,
        schemaVersionId: current.schemaVersionId,
      }),
    );
    const restartedTable = await runEffect(
      restartedStore.resolvePointTableEffect(restartedAttempt, "users"),
    );
    await expect(
      runPointOperation(restartedStore, restartedTable, request),
    ).resolves.toMatchObject({
      kind: "completed",
      delivery: "replayed",
      outcome: { kind: "inserted" },
    });
    expect(randomCalls).toBe(1);

    const invalid = await scenario("invalid_uuid", {
      randomUuid: () => "not-a-v4-uuid",
    });
    await expect(runFailure(invalid.store.runPointOperationEffect(
      invalid.table,
      {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "invalid" },
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ))).resolves.toBeInstanceOf(SessionJournalIdentityGenerationV1Error);
    expect(await journalRoot(invalid.anchor.sessionId)).toMatchObject({
      last_syscall_sequence: "0",
      state: "open",
    });
    expect(await journalCounts(invalid.anchor.sessionId)).toMatchObject({
      receipts: 0,
      points: 0,
      events: 0,
    });
  });

  it("preserves an unexpected identity-generator throw as a defect and rolls back", async () => {
    const defect = new Error("point identity generator unavailable");
    const current = await scenario("identity_generation_defect", {
      randomUuid: () => {
        throw defect;
      },
    });

    const exit = await Effect.runPromiseExit(
      current.store.runPointOperationEffect(current.table, {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "must-not-persist" },
      }, SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons).toHaveLength(1);
      const reason = exit.cause.reasons[0];
      expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
      if (reason !== undefined && Cause.isDieReason(reason)) {
        expect(reason.defect).toBe(defect);
      }
    }
    await expect(journalRoot(current.anchor.sessionId)).resolves.toMatchObject({
      last_syscall_sequence: "0",
      state: "open",
    });
    await expect(journalCounts(current.anchor.sessionId)).resolves.toMatchObject({
      receipts: 0,
      points: 0,
      events: 0,
    });
  });

  it("keeps fresh-plan overlay corruption typed and rolls back the attempted operation", async () => {
    const overlay = await scenario("planning_overlay_corruption", {
      randomUuid: () => "86000000-0000-4000-8000-000000000001",
    });
    const overlayInsert = await runPointOperation(overlay.store, overlay.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "overlay" },
    });
    const overlayDocumentId = requireInsertedDocumentId(overlayInsert);
    await persistence.query(
      `
        update fx_system_tx_journal_point
        set overlay_value_sha256 = $2
        where session_id = $1
      `,
      [overlay.anchor.sessionId, new Uint8Array(32)],
    );
    await expect(runFailure(overlay.store.runPointOperationEffect(
      overlay.table,
      {
        kind: "replace",
        syscallSequence: syscallSequence(2n),
        documentId: overlayDocumentId,
        fields: { name: "must-not-persist" },
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ))).resolves.toMatchObject({
      reason: "liveOverlaySemanticBytesMismatch",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);
    await expect(journalRoot(overlay.anchor.sessionId)).resolves.toMatchObject({
      last_syscall_sequence: "1",
    });
    await expect(journalCounts(overlay.anchor.sessionId)).resolves.toMatchObject({
      receipts: 1,
      points: 1,
      events: 1,
    });
  });

  it("turns each first operation beyond an exact execution ceiling into one sticky durable failure", async () => {
    const cases: ReadonlyArray<LimitCase> = [
      {
        dimension: "readDocuments",
        column: "read_documents",
        maximum: MAX_COMMIT_READ_DOCUMENTS_V1,
        seedDocument: true,
        operation: getSeededOperation,
      },
      {
        dimension: "readSemanticBytes",
        column: "read_semantic_bytes",
        maximum: MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
        seedDocument: true,
        operation: getSeededOperation,
      },
      {
        dimension: "pointReadDependencies",
        column: "point_dependency_count",
        maximum: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
        seedDocument: false,
        operation: getMissingOperation,
      },
      {
        dimension: "writeOperations",
        column: "write_operations",
        maximum: MAX_COMMIT_WRITE_OPERATIONS_V1,
        seedDocument: false,
        operation: insertOperation,
      },
      {
        dimension: "writeSemanticBytes",
        column: "write_semantic_bytes",
        maximum: MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
        seedDocument: false,
        operation: insertOperation,
      },
      {
        dimension: "materialWriteEventEvidenceBytes",
        column: "material_write_event_evidence_bytes",
        maximum: MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
        seedDocument: false,
        operation: insertOperation,
      },
    ];

    for (const limit of cases) {
      const current = await scenario(`limit_${limit.dimension}`, {
        ...(limit.seedDocument
          ? { seedFields: { name: "limit" } }
          : {}),
      });
      await persistence.query(
        `
          update fx_system_tx_journal
          set ${limit.column} = $2
          where session_id = $1
        `,
        [current.anchor.sessionId, limit.maximum],
      );

      const first = await runPointOperation(current.store, current.table,
        limit.operation(current, 1n),
      );
      expect(first).toMatchObject({
        kind: "rejected",
        delivery: "executed",
        issue: {
          reason: "limitExceeded",
          dimension: limit.dimension,
          maximum: limit.maximum,
        },
      });
      if (first.kind !== "rejected" ||
        first.issue.reason !== "limitExceeded") {
        throw new Error(`Expected ${limit.dimension} limit failure.`);
      }
      expect(first.issue.observed).toBeGreaterThan(limit.maximum);
      if (
        limit.dimension === "readDocuments" ||
        limit.dimension === "pointReadDependencies" ||
        limit.dimension === "writeOperations"
      ) {
        expect(first.issue.observed).toBe(limit.maximum + 1);
      }

      await expect(runPointOperation(current.store, current.table,
        limit.operation(current, 2n),
      )).resolves.toMatchObject({
        kind: "rejected",
        delivery: "sticky",
        issue: {
          reason: "limitExceeded",
          dimension: limit.dimension,
          observed: first.issue.observed,
          maximum: limit.maximum,
        },
      });
      expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
        state: "failed",
        last_syscall_sequence: "1",
        failure_dimension: limit.dimension,
        [limit.column]: limit.maximum,
      });
      expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
        receipts: 1,
        points: 0,
        events: 0,
      });
    }
  });

  it("rejects sticky limit receipts that contradict the failed journal root", async () => {
    const corruptOutcomes = [
      {
        name: "dimension",
        outcome: {
          kind: "error",
          reason: "limitExceeded",
          dimension: "pointReadDependencies",
          observed: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1,
          maximum: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
        },
      },
      {
        name: "maximum",
        outcome: {
          kind: "error",
          reason: "limitExceeded",
          dimension: "readDocuments",
          observed: MAX_COMMIT_READ_DOCUMENTS_V1 + 1,
          maximum: MAX_COMMIT_READ_DOCUMENTS_V1 - 1,
        },
      },
      {
        name: "observation",
        outcome: {
          kind: "error",
          reason: "limitExceeded",
          dimension: "readDocuments",
          observed: MAX_COMMIT_READ_DOCUMENTS_V1,
          maximum: MAX_COMMIT_READ_DOCUMENTS_V1,
        },
      },
    ] as const;

    for (const corrupt of corruptOutcomes) {
      const current = await scenario(`sticky_receipt_${corrupt.name}`, {
        seedFields: { name: "limit" },
      });
      const documentId = requireSeededDocumentId(current);
      const failedRequest = Object.freeze({
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId,
      } satisfies SessionJournalPointOperationV1);
      await persistence.query(
        `
          update fx_system_tx_journal
          set read_documents = $2
          where session_id = $1
        `,
        [current.anchor.sessionId, MAX_COMMIT_READ_DOCUMENTS_V1],
      );
      await expect(runPointOperation(current.store, current.table,
        failedRequest,
      )).resolves.toMatchObject({
        kind: "rejected",
        issue: {
          reason: "limitExceeded",
          dimension: "readDocuments",
        },
      });

      await replaceLatestOutcomeEvidence(
        current.anchor.sessionId,
        corrupt.outcome,
      );

      await expect(runPointOperation(current.store, current.table,
        failedRequest,
      )).rejects.toMatchObject({
        reason: "failedJournalReceiptInvalid",
      });
      await expect(runPointOperation(current.store, current.table, {
        kind: "get",
        syscallSequence: syscallSequence(2n),
        documentId,
      })).rejects.toMatchObject({
        reason: "failedJournalReceiptInvalid",
      });
    }
  });

  it("rejects a limit receipt attached to an open root during replay and seal", async () => {
    const current = await scenario("open_root_limit_receipt");
    const request = Object.freeze({
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 401),
    } satisfies SessionJournalPointOperationV1);
    await expect(runPointOperation(current.store, current.table,
      request,
    )).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "missing" },
    });
    await replaceLatestOutcomeEvidence(current.anchor.sessionId, {
      kind: "error",
      reason: "limitExceeded",
      dimension: "readDocuments",
      observed: MAX_COMMIT_READ_DOCUMENTS_V1 + 1,
      maximum: MAX_COMMIT_READ_DOCUMENTS_V1,
    });

    await expect(runPointOperation(current.store, current.table,
      request,
    )).rejects.toMatchObject({ reason: "journalReceiptStateMismatch" });
    await expect(prepareSeal(current.store, current.attempt)).rejects
      .toMatchObject({ reason: "journalReceiptStateMismatch" });
  });

  it("accepts an exact 64 MiB material-event total when the final journal still fits", async () => {
    const operationCount = 64;
    const removalFieldCount = 1_023;
    const minimumRemovalFieldBytes = removalFieldPrefixBytes(
      removalFieldCount,
    );
    const probe = await scenario("event_evidence_exact_probe", {
      seedFields: { name: "zero" },
    });
    const probeDocumentId = requireSeededDocumentId(probe);
    for (let index = 1; index <= operationCount; index += 1) {
      await expect(runPointOperation(probe.store, probe.table, {
        kind: "patch",
        syscallSequence: syscallSequence(BigInt(index)),
        documentId: probeDocumentId,
        patch: patchWithRemovalFields(
          removalFieldCount,
          minimumRemovalFieldBytes,
          `v${index.toString().padStart(3, "0")}`,
        ),
      })).resolves.toMatchObject({ kind: "completed" });
    }
    const probeLengths = await eventEvidenceByteLengths(
      probe.anchor.sessionId,
    );
    expect(probeLengths).toHaveLength(operationCount);
    const fixedEvidenceBytes = probeLengths.reduce(
      (total, length) => total + length - minimumRemovalFieldBytes,
      0,
    );
    const removableFieldBytes =
      MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 -
      fixedEvidenceBytes;
    const baseFieldBytes = Math.floor(removableFieldBytes / operationCount);
    const finalFieldBytes = removableFieldBytes -
      baseFieldBytes * (operationCount - 1);
    expect(baseFieldBytes).toBeGreaterThan(0);
    expect(finalFieldBytes).toBeGreaterThanOrEqual(baseFieldBytes);
    expect(finalFieldBytes).toBeLessThanOrEqual(
      removalFieldCapacityBytes(removalFieldCount),
    );

    const exact = await scenario("event_evidence_exact", {
      seedFields: { name: "zero" },
    });
    const exactDocumentId = requireSeededDocumentId(exact);
    for (let index = 1; index <= operationCount; index += 1) {
      const fieldBytes = index === operationCount
        ? finalFieldBytes
        : baseFieldBytes;
      await expect(runPointOperation(exact.store, exact.table, {
        kind: "patch",
        syscallSequence: syscallSequence(BigInt(index)),
        documentId: exactDocumentId,
        patch: patchWithRemovalFields(
          removalFieldCount,
          fieldBytes,
          `v${index.toString().padStart(3, "0")}`,
        ),
      })).resolves.toMatchObject({ kind: "completed" });
    }

    const exactLengths = await eventEvidenceByteLengths(
      exact.anchor.sessionId,
    );
    expect(exactLengths.reduce((total, length) => total + length, 0)).toBe(
      MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
    );
    expect(await journalRoot(exact.anchor.sessionId)).toMatchObject({
      state: "open",
      write_operations: operationCount,
      material_write_event_evidence_bytes:
        MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
    });

    const prepared = await prepareSeal(exact.store, exact.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    expect(canonicalJournal.canonicalBytes.byteLength).toBeLessThanOrEqual(
      MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
    );
  }, 180_000);

  it("sticks an exact +1 remove-heavy event failure without mutating its point or event rows", async () => {
    const current = await scenario("event_evidence_plus_one", {
      seedFields: { name: "zero" },
    });
    const documentId = requireSeededDocumentId(current);
    const removalFieldCount = 1_023;
    const removalFieldBytes = removalFieldCapacityBytes(removalFieldCount);
    await expect(runPointOperation(current.store, current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(1n),
      documentId,
      patch: patchWithRemovalFields(
        removalFieldCount,
        removalFieldBytes,
        "v001",
      ),
    })).resolves.toMatchObject({ kind: "completed" });
    const [eventBytes] = await eventEvidenceByteLengths(
      current.anchor.sessionId,
    );
    if (eventBytes === undefined) throw new Error("Missing probe event.");
    const seededCounter =
      MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 - eventBytes + 1;
    await persistence.query(
      `
        update fx_system_tx_journal
        set material_write_event_evidence_bytes = $2
        where session_id = $1
      `,
      [current.anchor.sessionId, seededCounter],
    );
    const overlayBefore = await pointOverlayJson(current.anchor.sessionId);
    const secondRequest = Object.freeze({
      kind: "patch",
      syscallSequence: syscallSequence(2n),
      documentId,
      patch: patchWithRemovalFields(
        removalFieldCount,
        removalFieldBytes,
        "v002",
      ),
    } satisfies SessionJournalPointOperationV1);

    await expect(
      runPointOperation(current.store, current.table, secondRequest),
    ).resolves.toEqual({
      kind: "rejected",
      delivery: "executed",
      issue: {
        reason: "limitExceeded",
        dimension: "materialWriteEventEvidenceBytes",
        observed: MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 + 1,
        maximum: MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
      },
    });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "failed",
      last_syscall_sequence: "2",
      material_write_event_evidence_bytes: seededCounter,
      failure_dimension: "materialWriteEventEvidenceBytes",
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 1,
      points: 1,
      events: 1,
    });
    expect(await pointOverlayJson(current.anchor.sessionId)).toBe(
      overlayBefore,
    );
    await expect(
      runPointOperation(current.store, current.table, secondRequest),
    ).resolves.toMatchObject({
      kind: "rejected",
      delivery: "replayed",
      issue: {
        reason: "limitExceeded",
        dimension: "materialWriteEventEvidenceBytes",
        observed: MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 + 1,
      },
    });
  }, 60_000);

  it("recomputes detached event evidence during seal preparation", async () => {
    const current = await scenario("event_evidence_seal_recompute", {
      randomUuid: uuidSequence(
        "86000000-0000-4000-8000-000000000099",
      ),
    });
    await runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "recompute" },
    });
    const [eventBytes] = await eventEvidenceByteLengths(
      current.anchor.sessionId,
    );
    if (eventBytes === undefined) throw new Error("Missing event evidence.");
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      material_write_event_evidence_bytes: eventBytes,
    });
    await expect(prepareSeal(current.store, current.attempt)).resolves.toBeDefined();

    await persistence.query(
      `
        update fx_system_tx_journal
        set material_write_event_evidence_bytes =
          material_write_event_evidence_bytes + 1
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );
    await expect(prepareSeal(current.store, current.attempt)).rejects.toMatchObject({
      reason: "materialWriteEventEvidenceBytesMismatch",
    });
  });

  it("maps malformed receipt, overlay, and write evidence at their Effect adapters", async () => {
    const invalidDigest = new Uint8Array(32);
    const receipt = await scenario("seal_invalid_receipt_evidence");
    await runPointOperation(receipt.store, receipt.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(receipt.tableId, 402),
    });
    await persistence.query(
      `
        update fx_system_tx_journal_latest_receipt
        set request_sha256 = $2
        where session_id = $1
      `,
      [receipt.anchor.sessionId, invalidDigest],
    );
    await expect(runFailure(receipt.store.prepareSealEffect(
      receipt.attempt,
    ))).resolves.toMatchObject({
      reason: "latestReceiptEvidenceInvalid",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);

    const overlay = await scenario("seal_invalid_overlay_evidence");
    await runPointOperation(overlay.store, overlay.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "overlay" },
    });
    await persistence.query(
      `
        update fx_system_tx_journal_point
        set overlay_value_sha256 = $2
        where session_id = $1
      `,
      [overlay.anchor.sessionId, invalidDigest],
    );
    await expect(runFailure(overlay.store.prepareSealEffect(
      overlay.attempt,
    ))).resolves.toMatchObject({
      reason: "liveOverlaySemanticBytesMismatch",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);

    const write = await scenario("seal_invalid_write_evidence");
    await runPointOperation(write.store, write.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "write" },
    });
    await persistence.query(
      `
        update fx_system_tx_journal_write_event
        set event_sha256 = $2
        where session_id = $1
      `,
      [write.anchor.sessionId, invalidDigest],
    );
    await expect(runFailure(write.store.prepareSealEffect(
      write.attempt,
    ))).resolves.toMatchObject({
      reason: "logicalWriteEventInvalid",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);
  });

  it("preserves an unexpected evidence-hashing rejection as a defect", async () => {
    const current = await scenario("seal_evidence_hash_defect");
    await runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 403),
    });
    const defect = new Error("seal evidence hashing unavailable");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValue(defect);
    try {
      const exit = await Effect.runPromiseExit(
        current.store.prepareSealEffect(current.attempt),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const reason = exit.cause.reasons[0];
        expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
        if (reason !== undefined && Cause.isDieReason(reason)) {
          expect(reason.defect).toBe(defect);
        }
      }
    } finally {
      digest.mockRestore();
    }
  });

  it("collects only max+1 child rows and rejects cardinality before decoding corrupt evidence", async () => {
    const excessPoints = await scenario("seal_excess_points");
    await persistence.query(
      `
        insert into fx_system_tx_journal_point (
          scope_uuid,
          session_id,
          attempt_fence,
          table_id,
          row_id,
          dependency_kind,
          dependency_revision_commit_seq,
          overlay_kind,
          overlay_creation_time,
          overlay_value_codec_version,
          overlay_value_json,
          overlay_value_bytes,
          overlay_value_sha256,
          overlay_semantic_bytes,
          created_at,
          updated_at
        )
        select root.scope_uuid,
               root.session_id,
               root.attempt_fence,
               $2,
               decode(lpad(to_hex(series.value), 32, '0'), 'hex'),
               'missing_no_visible_revision',
               null,
               'none',
               null,
               null,
               null,
               null,
               null,
               null,
               root.created_at,
               root.updated_at
        from fx_system_tx_journal root
        cross join generate_series(1, $3) as series(value)
        where root.session_id = $1
      `,
      [
        excessPoints.anchor.sessionId,
        excessPoints.tableId,
        MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1,
      ],
    );
    await expect(
      prepareSeal(excessPoints.store, excessPoints.attempt),
    ).rejects.toMatchObject({ reason: "pointDependencyCountMismatch" });

    const excessEvents = await scenario("seal_excess_events");
    await persistence.query(
      `
        insert into fx_system_tx_journal_write_event (
          scope_uuid,
          session_id,
          attempt_fence,
          syscall_sequence,
          write_kind,
          event_codec_version,
          event_json,
          event_bytes,
          event_sha256,
          created_at
        )
        select root.scope_uuid,
               root.session_id,
               root.attempt_fence,
               series.value,
               'delete',
               1,
               '{}'::jsonb,
               decode('00', 'hex'),
               decode(repeat('00', 32), 'hex'),
               root.created_at
        from fx_system_tx_journal root
        cross join generate_series(1, $2) as series(value)
        where root.session_id = $1
      `,
      [excessEvents.anchor.sessionId, MAX_COMMIT_WRITE_OPERATIONS_V1 + 1],
    );
    await expect(
      prepareSeal(excessEvents.store, excessEvents.attempt),
    ).rejects.toMatchObject({ reason: "writeOperationCountMismatch" });
  }, 60_000);

  it("cascades exact-attempt child evidence when the journal root is reclaimed", async () => {
    const current = await scenario("cleanup_cascade", {
      randomUuid: uuidSequence(
        "86000000-0000-4000-8000-000000000001",
      ),
    });
    const inserted = await runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "temporary" },
    });
    const documentId = requireInsertedDocumentId(inserted);
    await runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(2n),
      documentId,
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      roots: 1,
      receipts: 1,
      points: 1,
      events: 1,
      sessions: 1,
    });

    await persistence.query(
      `delete from fx_system_tx_journal where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(await journalCounts(current.anchor.sessionId)).toEqual({
      roots: 0,
      receipts: 0,
      points: 0,
      events: 0,
      sessions: 1,
    });
  });

  it("seals in two phases, rejects stale candidates, and exactly replays stored evidence", async () => {
    const current = await scenario("two_phase_seal", {
      randomUuid: uuidSequence(
        "87000000-0000-4000-8000-000000000001",
      ),
    });
    const inserted = await runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "seal" },
    });
    const documentId = requireInsertedDocumentId(inserted);
    const stale = await prepareSeal(current.store, current.attempt);
    const staleJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(stale.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );

    await runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(2n),
      documentId,
    });
    await expect(runFailure(current.store.completeSealEffect(
      stale.preparation,
      staleJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      reason: "stalePreparation",
    } satisfies Partial<SessionJournalSealV1Error>);

    const callerMutablePreparation = await prepareSeal(current.store,
      current.attempt,
    );
    const callerVisibleWrite = callerMutablePreparation.journal.writes[0];
    if (callerVisibleWrite?.kind !== "insert") {
      throw new Error("Expected the inserted write in the prepared journal.");
    }
    Reflect.set(callerVisibleWrite.fieldsValueJson, "name", "caller-mutated");
    const callerMutatedJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(callerMutablePreparation.journal),
    );
    await expect(completeSeal(current.store,
      callerMutablePreparation.preparation,
      callerMutatedJournal,
      successfulResult,
    )).rejects.toMatchObject({
      reason: "canonicalJournalMismatch",
    } satisfies Partial<SessionJournalSealV1Error>);

    const malformedJournalPreparation = await prepareSeal(current.store,
      current.attempt,
    );
    const malformedJournal = structuredClone(await runEffect(
      canonicalizeSessionJournalV1Effect(malformedJournalPreparation.journal),
    ));
    Reflect.set(malformedJournal.journal, "format", "invalid");
    await expect(completeSeal(current.store,
      malformedJournalPreparation.preparation,
      malformedJournal,
      successfulResult,
    )).rejects.toMatchObject({
      reason: "canonicalJournalMismatch",
    } satisfies Partial<SessionJournalSealV1Error>);

    const malformedResultPreparation = await prepareSeal(current.store,
      current.attempt,
    );
    const journalForMalformedResult = await runEffect(
      canonicalizeSessionJournalV1Effect(
        malformedResultPreparation.journal,
      ),
    );
    const malformedResult = structuredClone(successfulResult);
    Reflect.set(malformedResult.evidence, "unexpected", true);
    await expect(completeSeal(current.store,
      malformedResultPreparation.preparation,
      journalForMalformedResult,
      malformedResult,
    )).rejects.toMatchObject({
      reason: "canonicalResultMismatch",
    } satisfies Partial<SessionJournalSealV1Error>);

    const malformedResultValuePreparation = await prepareSeal(current.store,
      current.attempt,
    );
    const journalForMalformedResultValue = await runEffect(
      canonicalizeSessionJournalV1Effect(
        malformedResultValuePreparation.journal,
      ),
    );
    const malformedResultValue = structuredClone(successfulResult);
    Reflect.set(malformedResultValue, "valueJson", undefined);
    await expect(completeSeal(current.store,
      malformedResultValuePreparation.preparation,
      journalForMalformedResultValue,
      malformedResultValue,
    )).rejects.toMatchObject({
      reason: "canonicalResultMismatch",
    } satisfies Partial<SessionJournalSealV1Error>);

    const prepared = await prepareSeal(current.store, current.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const mutableSuccessfulResult = structuredClone(successfulResult);
    const envelopePromise = completeSeal(current.store,
      prepared.preparation,
      canonicalJournal,
      mutableSuccessfulResult,
    );
    Reflect.set(
      mutableSuccessfulResult.evidence,
      "sha256Hex",
      "0".repeat(64),
    );
    const envelope = await envelopePromise;
    expect(envelope).toMatchObject({
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence,
      finalSyscallSequence: 2n,
      journal: { kind: "storedForSessionAttempt" },
      journalSha256Hex: canonicalJournal.sha256Hex,
      successfulResult: successfulResult.evidence,
    });
    const sealedState = await attemptLeaseAndSealState(
      current.anchor.sessionId,
    );
    expect(sealedState.root_state).toBe("sealed");
    expect(sealedState.lease_expires_at.getTime()).toBe(Math.min(
      sealedState.authorization_grant_expires_at.getTime(),
      sealedState.hard_expires_at.getTime(),
    ));
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(3n),
      documentId,
    })).resolves.toEqual({
      kind: "stateRejected",
      issue: { reason: "journalSealed" },
    });

    const replayPreparation = await prepareSeal(current.store, current.attempt);
    const replayJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(replayPreparation.journal),
    );
    await expect(completeSeal(current.store,
      replayPreparation.preparation,
      replayJournal,
      successfulResult,
    )).resolves.toEqual(envelope);
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "sealed",
      last_syscall_sequence: "2",
    });

    const mismatchedReplay = await prepareSeal(current.store, current.attempt);
    const mismatchedJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(mismatchedReplay.journal),
    );
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = lease_expires_at - interval '1 second'
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );
    await expect(runFailure(current.store.completeSealEffect(
      mismatchedReplay.preparation,
      mismatchedJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      reason: "snapshotLeaseInvalid",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);

    const expiredMismatchReplay = mismatchedReplay;
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = clock_timestamp() - interval '1 second'
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );
    await expect(runFailure(current.store.completeSealEffect(
      expiredMismatchReplay.preparation,
      mismatchedJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      reason: "snapshotLeaseInvalid",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);
  });

  it("renews only the execution claim after the sealed lease identity freezes", async () => {
    const current = await scenario("sealed_claim_liveness");
    const prepared = await prepareSeal(current.store, current.attempt);
    await completeSeal(
      current.store,
      prepared.preparation,
      await runEffect(canonicalizeSessionJournalV1Effect(prepared.journal)),
      await runEffect(canonicalizeSuccessfulResultV1Effect({ ok: true })),
    );
    const before = await attemptLeaseAndClaimState(
      current.anchor.sessionId,
    );
    const liveness = createPointMutationExecutionClaimLivenessV1(
      resolutionPorts(persistence),
      {
        claimDurationMilliseconds: 120_000,
        leaseRenewalDurationMilliseconds: 180_000,
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      },
    );

    const renewed = await runEffect(liveness.renewEffect({
      selector: selectorFromAnchor(current.anchor),
      executionClaim: current.executionClaim,
    }));
    const after = await attemptLeaseAndClaimState(current.anchor.sessionId);

    expect(renewed).toMatchObject({ kind: "renewed", phase: "sealed" });
    expect(after.lease_expires_at).toEqual(before.lease_expires_at);
    expect(after.claim_expires_at.getTime()).toBeGreaterThanOrEqual(
      before.claim_expires_at.getTime(),
    );
    expect(after).toMatchObject({
      claim_owner: before.claim_owner,
      claim_fence: before.claim_fence,
      claimed_at: before.claimed_at,
    });
  });

  it("retains seal preparation after transaction infrastructure failure and retries", async () => {
    const transactionFailure = new Error("seal transaction unavailable");
    let failCompletion = false;
    const current = await scenario("seal_transaction_retry", {
      targetOptions: {
        afterLoadLock: (step) => {
          if (failCompletion && step === "journalRootLocked") {
            failCompletion = false;
            throw transactionFailure;
          }
        },
      },
    });
    await runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 205),
    });
    const prepared = await prepareSeal(current.store, current.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );

    failCompletion = true;
    await expect(runFailure(current.store.completeSealEffect(
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      operation: "completeSealTransaction",
      cause: transactionFailure,
    } satisfies Partial<SessionJournalPersistenceV1Error>);
    await expect(journalRoot(current.anchor.sessionId)).resolves.toMatchObject({
      state: "open",
      last_syscall_sequence: "1",
    });

    await expect(runEffect(current.store.completeSealEffect(
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      sessionId: current.anchor.sessionId,
      finalSyscallSequence: 1n,
    });
    await expect(journalRoot(current.anchor.sessionId)).resolves.toMatchObject({
      state: "sealed",
      last_syscall_sequence: "1",
    });
  });

  it("rejects a database-time retention overrun without promoting or sealing", async () => {
    const oneMillisecondPolicy = Result.getOrThrow(
      makeGrantRetentionPolicyV1Result({
        maximumGrantLifetimeMilliseconds: 1,
        maximumFutureIssuedAtSkewMilliseconds: 0,
        maximumLiveSnapshotRetentionMilliseconds: 1,
      }),
    );
    const current = await scenario("seal_retention_bound", {
      grantRetentionPolicy: oneMillisecondPolicy,
    });
    const prepared = await prepareSeal(current.store, current.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    const before = await attemptLeaseAndSealState(current.anchor.sessionId);

    await expect(runFailure(current.store.completeSealEffect(
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    ))).resolves.toMatchObject({
      issue: {
        kind: "retentionBudgetExceeded",
        remainingMilliseconds: expect.any(Number),
        maximumLiveSnapshotRetentionMilliseconds: 1,
      },
    } satisfies Partial<SessionJournalLeasePromotionV1Error>);
    const after = await attemptLeaseAndSealState(current.anchor.sessionId);
    expect(after.root_state).toBe("open");
    expect(after.lease_expires_at.getTime()).toBe(
      before.lease_expires_at.getTime(),
    );
  });

  it("rolls lease promotion back when sealing fails before or after the root write", async () => {
    for (const phase of ["before", "after"] as const) {
      const current = await scenario(`seal_atomic_rollback_${phase}`);
      const prepared = await prepareSeal(current.store, current.attempt);
      const canonicalJournal = await runEffect(
        canonicalizeSessionJournalV1Effect(prepared.journal),
      );
      const successfulResult = await runEffect(
        canonicalizeSuccessfulResultV1Effect({ phase }),
      );
      const before = await attemptLeaseAndSealState(current.anchor.sessionId);

      await installRejectSealTrigger(phase);
      try {
        await expect(runFailure(current.store.completeSealEffect(
          prepared.preparation,
          canonicalJournal,
          successfulResult,
        ))).resolves.toMatchObject({
          operation: "completeSealTransaction",
        } satisfies Partial<SessionJournalPersistenceV1Error>);
      } finally {
        await removeRejectSealTrigger(phase);
      }

      const rolledBack = await attemptLeaseAndSealState(
        current.anchor.sessionId,
      );
      expect(rolledBack.root_state).toBe("open");
      expect(rolledBack.lease_expires_at.getTime()).toBe(
        before.lease_expires_at.getTime(),
      );

      await expect(runEffect(current.store.completeSealEffect(
        prepared.preparation,
        canonicalJournal,
        successfulResult,
      ))).resolves.toMatchObject({ sessionId: current.anchor.sessionId });
      const sealed = await attemptLeaseAndSealState(current.anchor.sessionId);
      expect(sealed.root_state).toBe("sealed");
      expect(sealed.lease_expires_at.getTime()).toBe(Math.min(
        sealed.authorization_grant_expires_at.getTime(),
        sealed.hard_expires_at.getTime(),
      ));
    }
  });

  it("waits for seal completion to settle after direct Effect interruption", async () => {
    const entered = deferredSignal();
    const release = deferredSignal();
    let pauseCompletion = false;
    const current = await scenario("seal_effect_interruption_settlement", {
      targetOptions: {
        afterLoadLock: async (step) => {
          if (step !== "journalRootLocked" || !pauseCompletion) return;
          pauseCompletion = false;
          entered.resolve();
          await release.promise;
        },
      },
    });
    await runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 204),
    });
    const prepared = await prepareSeal(current.store, current.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    pauseCompletion = true;
    const fiber = Effect.runFork(current.store.completeSealEffect(
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    ));

    await entered.promise;
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      release.resolve();
    }
    await interruption;
    expect(interruptionSettled).toBe(true);
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "sealed",
      last_syscall_sequence: "1",
    });
    const settled = await attemptLeaseAndSealState(current.anchor.sessionId);
    expect(settled.lease_expires_at.getTime()).toBe(Math.min(
      settled.authorization_grant_expires_at.getTime(),
      settled.hard_expires_at.getTime(),
    ));
  });

  it("makes every nullable journal CHECK branch and event-byte bound fail closed", async () => {
    const sealed = await scenario("nullable_checks_sealed", {
      randomUuid: uuidSequence(
        "88000000-0000-4000-8000-000000000001",
      ),
    });
    await runPointOperation(sealed.store, sealed.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "sealed" },
    });
    const prepared = await prepareSeal(sealed.store, sealed.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    await completeSeal(sealed.store,
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    );

    const sealedNullableColumns = [
      "sealed_final_syscall_sequence",
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
        `update fx_system_tx_journal set ${column} = null where session_id = $1`,
        [sealed.anchor.sessionId],
      )).rejects.toThrow();
    }

    const point = await scenario("nullable_checks_point", {
      seedFields: { name: "point" },
    });
    await runPointOperation(point.store, point.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: requireSeededDocumentId(point),
    });
    await expect(persistence.query(
      `
        update fx_system_tx_journal_point
        set dependency_revision_commit_seq = null
        where session_id = $1
          and dependency_kind = 'present'
      `,
      [point.anchor.sessionId],
    )).rejects.toThrow();
    await runPointOperation(point.store, point.table, {
      kind: "patch",
      syscallSequence: syscallSequence(2n),
      documentId: requireSeededDocumentId(point),
      patch: { name: "live-overlay" },
    });
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
        where session_id = $1
          and dependency_kind = 'missing_tombstone'
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

    const bounds = await scenario("event_evidence_sql_bounds");
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

  it("freshly rejects terminal and database-time-expired attempts before mutating journal state", async () => {
    const terminal = await scenario("late_terminal");
    await persistence.query(
      `
        update fx_system_tx_session
        set lifecycle = 'finishing'
        where session_id = $1
      `,
      [terminal.anchor.sessionId],
    );
    await expect(runFailure(terminal.store.runPointOperationEffect(
      terminal.table,
      {
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(terminal.tableId, 201),
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ))).resolves.toMatchObject({
      issue: { reason: "attemptNotRunning", lifecycle: "finishing" },
    } satisfies Partial<SessionJournalAttemptUnavailableV1Error>);
    expect(await journalRoot(terminal.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
    });

    const expired = await scenario("late_expired");
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = '2000-01-01T00:00:00.000Z'
        where session_id = $1
      `,
      [expired.anchor.sessionId],
    );
    await expect(runFailure(expired.store.runPointOperationEffect(
      expired.table,
      {
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(expired.tableId, 202),
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ))).resolves.toMatchObject({
      issue: { reason: "activeAttemptExpired" },
    } satisfies Partial<SessionJournalAttemptUnavailableV1Error>);
    expect(await journalCounts(expired.anchor.sessionId)).toMatchObject({
      receipts: 0,
      points: 0,
      events: 0,
    });
  });

  it("waits for the transaction Promise to settle after direct Effect interruption", async () => {
    const entered = deferredSignal();
    const release = deferredSignal();
    let pauseJournalRootLock = false;
    const current = await scenario("effect_interruption_settlement", {
      targetOptions: {
        afterLoadLock: async (step) => {
          if (step !== "journalRootLocked" || !pauseJournalRootLock) return;
          pauseJournalRootLock = false;
          entered.resolve();
          await release.promise;
        },
      },
    });
    pauseJournalRootLock = true;
    const fiber = Effect.runFork(current.store.runPointOperationEffect(
      current.table,
      {
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(current.tableId, 203),
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ));

    await entered.promise;
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      release.resolve();
    }
    await interruption;
    expect(interruptionSettled).toBe(true);
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 1,
      points: 1,
    });
  });

  function resolutionPorts(
    selectedPersistence: PGliteFlarexPersistence,
    targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
  ): PointMutationSessionAuthorityResolutionPortsV1 {
    return {
      scopeMetadata: selectedPersistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error(
            "Shared SessionJournalStore resolution must not read receipts.",
          );
        },
      },
      scopeSessionTargets: {
        resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
          createPGliteLocatedPointMutationSessionActivationTargetV1(
            selectedPersistence,
            physicalLocator,
            targetOptions,
          ),
      },
    };
  }

  async function journalCounts(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<JournalCounts> {
    const result = await persistence.query<JournalCounts>(
      `
        select
          (select count(*)::int from fx_system_tx_journal
            where session_id = $1) as roots,
          (select count(*)::int from fx_system_tx_journal_latest_receipt
            where session_id = $1) as receipts,
          (select count(*)::int from fx_system_tx_journal_point
            where session_id = $1) as points,
          (select count(*)::int from fx_system_tx_journal_write_event
            where session_id = $1) as events,
          (select count(*)::int from fx_system_tx_session
            where session_id = $1) as sessions
      `,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing journal count row.");
    return row;
  }

  async function replaceLatestOutcomeEvidence<
    Outcome extends Readonly<{ readonly kind: string }>,
  >(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
    outcome: Outcome,
  ): Promise<void> {
    const evidence = await canonicalizeFlarexValueV1(outcome);
    await persistence.query(
      `
        update fx_system_tx_journal_latest_receipt
        set outcome_bytes = $2,
            outcome_sha256 = $3,
            outcome_kind = $4
        where session_id = $1
      `,
      [sessionId, evidence.canonicalBytes, evidence.sha256, outcome.kind],
    );
  }

  async function journalRoot(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<JournalRootState> {
    const result = await persistence.query<JournalRootState>(
      `
        select state,
               last_syscall_sequence::text,
               creation_time_seed,
               next_creation_time,
               read_documents,
               read_semantic_bytes,
               point_dependency_count,
               indexed_query_syscalls,
               index_range_dependency_count,
               index_range_dependency_evidence_bytes,
               write_operations,
               write_semantic_bytes,
               material_write_event_evidence_bytes,
               failure_dimension
        from fx_system_tx_journal
        where session_id = $1
      `,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing journal root row.");
    return row;
  }

  async function attemptLeaseAndSealState(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<AttemptLeaseAndSealState> {
    const result = await persistence.query<AttemptLeaseAndSealState>(
      `
        select root.state as root_state,
               lease.lease_expires_at,
               session.authorization_grant_expires_at,
               session.hard_expires_at
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

  async function attemptLeaseAndClaimState(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<AttemptLeaseAndClaimState> {
    const result = await persistence.query<AttemptLeaseAndClaimState>(
      `select lease.lease_expires_at,
              claim.claim_owner,
              claim.claim_fence::text,
              claim.claimed_at,
              claim.claim_expires_at
       from fx_system_snapshot_lease lease
       join fx_system_tx_execution_claim claim
         on claim.scope_uuid = lease.scope_uuid
        and claim.session_id = lease.session_id
        and claim.attempt_fence = lease.attempt_fence
       where lease.session_id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined || result.rows.length !== 1) {
      throw new Error("Expected one exact-attempt lease/claim state row.");
    }
    return row;
  }

  async function installRejectSealTrigger(
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
    phase: "before" | "after",
  ): Promise<void> {
    const functionName = `fx_test_reject_seal_${phase}`;
    const triggerName = `fx_test_reject_seal_${phase}_trigger`;
    await persistence.query(
      `drop trigger if exists ${triggerName} on fx_system_tx_journal`,
    );
    await persistence.query(`drop function if exists ${functionName}()`);
  }

  async function eventEvidenceByteLengths(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<ReadonlyArray<number>> {
    const result = await persistence.query<{ evidence_bytes: number }>(
      `
        select octet_length(event_bytes)::int as evidence_bytes
        from fx_system_tx_journal_write_event
        where session_id = $1
        order by syscall_sequence
      `,
      [sessionId],
    );
    return result.rows.map((row) => row.evidence_bytes);
  }

  async function pointOverlayJson(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<string> {
    const result = await persistence.query<{ overlay_json: string }>(
      `
        select overlay_value_json::text as overlay_json
        from fx_system_tx_journal_point
        where session_id = $1
      `,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined || result.rows.length !== 1) {
      throw new Error("Expected exactly one journal point row.");
    }
    return row.overlay_json;
  }
});

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

function documentId(tableId: CatalogTableId, suffix: number): AppDocumentIdV1 {
  return decodeAppDocumentIdV1(
    `${tableId}:88000000-0000-4000-8000-${suffix
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

async function seedSnapshotDocument(
  persistence: PGliteFlarexPersistence,
  scopeId: JournalScenario["anchor"]["scopeId"],
  tableId: CatalogTableId,
  schemaVersionId: CatalogSchemaVersionId,
  fields: unknown,
  rowId = SEEDED_ROW_ID,
  creationTime = SEEDED_CREATION_TIME,
): Promise<AppDocumentIdV1> {
  const clock = await persistence.getScopeClock(scopeId);
  if (clock === null) throw new Error("Missing seeded scope clock.");
  const canonical = await canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields,
  });
  const value = {
    codecVersion: canonical.codecVersion,
    valueJson: canonical.valueJson,
    canonicalBytes: canonical.canonicalBytes,
    sha256: canonical.sha256,
  } satisfies AppRowValueEvidenceV1;
  await persistence.drizzle.transaction((tx) =>
    appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId,
      tableId,
      rowId,
      writeEpoch: clock.epoch,
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      schemaVersionId,
      creationTime,
      value,
    })
  );
  return appDocumentIdV1FromRowIdentity({ tableId, rowId });
}

function requireSeededDocumentId(scenario: JournalScenario): AppDocumentIdV1 {
  if (scenario.seededDocumentId === null) {
    throw new Error("Scenario has no seeded document.");
  }
  return scenario.seededDocumentId;
}

function requireInsertedDocumentId(
  result: RunSessionJournalPointOperationV1Result,
): AppDocumentIdV1 {
  if (result.kind !== "completed" || result.outcome.kind !== "inserted") {
    throw new Error("Expected inserted journal outcome.");
  }
  return result.outcome.documentId;
}

function requireInsertedCreationTime(
  result: RunSessionJournalPointOperationV1Result,
): AppCreationTimeV1 {
  if (result.kind !== "completed" || result.outcome.kind !== "inserted") {
    throw new Error("Expected inserted journal outcome.");
  }
  const document = result.outcome.document;
  if (!isCanonicalFlarexRuntimeObjectV1(document)) {
    throw new Error("Inserted outcome is not an app document.");
  }
  return decodeAppCreationTimeV1(document._creationTime);
}

async function semanticBytes(
  documentId: AppDocumentIdV1,
  creationTime: AppCreationTimeV1,
  fields: unknown,
): Promise<number> {
  const identity = decodeAppDocumentIdentityV1(documentId);
  return (await canonicalizeAppDocumentV1({
    tableId: identity.tableId,
    rowId: identity.rowId,
    creationTime,
    fields,
  })).semanticSizeBytes;
}

function nextCreationTime(value: AppCreationTimeV1): AppCreationTimeV1 {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  if (low === 0xffff_ffff) {
    view.setUint32(0, high + 1, false);
    view.setUint32(4, 0, false);
  } else {
    view.setUint32(4, low + 1, false);
  }
  return decodeAppCreationTimeV1(view.getFloat64(0, false));
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error("UUID sequence exhausted.");
    return value;
  };
}

function getSeededOperation(
  scenario: JournalScenario,
  sequence: bigint,
): SessionJournalPointOperationV1 {
  return Object.freeze({
    kind: "get",
    syscallSequence: syscallSequence(sequence),
    documentId: requireSeededDocumentId(scenario),
  });
}

function getMissingOperation(
  scenario: JournalScenario,
  sequence: bigint,
): SessionJournalPointOperationV1 {
  return Object.freeze({
    kind: "get",
    syscallSequence: syscallSequence(sequence),
    documentId: documentId(scenario.tableId, 301),
  });
}

function insertOperation(
  _scenario: JournalScenario,
  sequence: bigint,
): SessionJournalPointOperationV1 {
  return Object.freeze({
    kind: "insert",
    syscallSequence: syscallSequence(sequence),
    fields: { name: "limit" },
  });
}

function patchWithRemovalFields(
  fieldCount: number,
  totalFieldBytes: number,
  name: string,
): Readonly<Record<string, string | undefined>> {
  const prefixes = removalFieldPrefixes(fieldCount);
  const minimumBytes = prefixes.reduce(
    (total, prefix) => total + prefix.length,
    0,
  );
  const capacityBytes = prefixes.reduce(
    (total, prefix) => total + 1_024 - prefix.length,
    minimumBytes,
  );
  if (totalFieldBytes < minimumBytes || totalFieldBytes > capacityBytes) {
    throw new Error("Requested removal-field bytes are outside capacity.");
  }
  let remainingPadding = totalFieldBytes - minimumBytes;
  const patch: Record<string, string | undefined> = { name };
  for (const prefix of prefixes) {
    const padding = Math.min(1_024 - prefix.length, remainingPadding);
    remainingPadding -= padding;
    Object.defineProperty(patch, `${prefix}${"x".repeat(padding)}`, {
      value: undefined,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  if (remainingPadding !== 0) {
    throw new Error("Removal-field byte distribution was incomplete.");
  }
  return patch;
}

function removalFieldPrefixBytes(fieldCount: number): number {
  return removalFieldPrefixes(fieldCount).reduce(
    (total, prefix) => total + prefix.length,
    0,
  );
}

function removalFieldCapacityBytes(fieldCount: number): number {
  return removalFieldPrefixes(fieldCount).reduce(
    (total) => total + 1_024,
    0,
  );
}

function removalFieldPrefixes(fieldCount: number): ReadonlyArray<string> {
  return Array.from(
    { length: fieldCount },
    (_, index) => `r${index.toString(36).padStart(6, "0")}_`,
  );
}

function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolveSignal: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => {
      if (resolveSignal === undefined) {
        throw new Error("Deferred signal was not initialized.");
      }
      resolveSignal();
    },
  });
}

function rejectSelectedQuery(
  database: PGliteFlarexPersistence["drizzle"],
  rejectedSelectNumber: number,
  rejectQuery: () => Promise<never>,
): PGliteFlarexPersistence["drizzle"] {
  let selectNumber = 0;
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "select") {
        return Reflect.get(target, property, receiver);
      }
      return (...args: Array<unknown>) => {
        selectNumber += 1;
        return selectNumber === rejectedSelectNumber
          ? new RejectingSelectQuery(rejectQuery)
          : Reflect.apply(target.select, target, args);
      };
    },
  });
}

class RejectingSelectQuery {
  constructor(private readonly rejectQuery: () => Promise<never>) {}

  from(): this {
    return this;
  }

  where(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  then(
    onfulfilled?: ((value: never) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return this.rejectQuery().then(onfulfilled, onrejected);
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
