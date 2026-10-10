import {
  createPGlitePersistence,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../../../src/database/pglite";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { GrantRetentionPolicyV1 } from "flarex-protocol/grant-retention-policy";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type CatalogSchemaVersionId,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { Result } from "effect";
import {
  closeInstallationAdmission,
  lockInstallationForCurrentTransaction,
} from "../../../src/installation/installationLifecycle";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
  type AppRowValueEvidenceV1,
} from "../../../src/storage/documents/appRows";
import {
  appendAppIndexEntryRevisionsInTransactionEffect,
} from "../../../src/storage/indexes/appIndexEntries";
import {
  createAppDeveloperIndexDefinitionPortV1,
  lowerAppDeveloperIndexKeyV1,
} from "../../../src/storage/indexes/appDeveloperIndexCommitV1";
import type { LocatedScopeClockReader } from "../../../src/scope/scopeAuthorityResolution";
import { createAppDeveloperIndexQueryPortV1 } from "../../../src/execution/journal/indexQueryPort";
import {
  createSessionJournalStorePersistence,
  type SessionJournalStorePersistenceOptionsV1,
} from "../../../src/execution/sessionJournalStore";
import { fxSystemIndexBuildStates } from "../../../src/database/schema";
import {
  INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
  IndexBuildAttemptFenceSchema,
} from "flarex-protocol/index-build-state";
import { decodeOrderedIndexRowIdHexV1 } from "flarex-protocol/ordered-index";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
  PointMutationSessionAuthorityResolutionPortsV1,
} from "../../../src/execution/session/constructionContracts";
import type {
  PointMutationSessionAnchorV1,
} from "../../../src/execution/session/contracts";
import { runEffect } from "../../support/effectTestRuntime";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  pointMutationSessionActivationFixture,
} from "../session/support/activationEvidence";
import {
  activatePointMutationSession,
} from "../session/support/attemptFixture";
import {
  setFlarexActivationClock,
} from "../session/support/authorityClock";
import {
  sharedLocator,
  SEEDED_ROW_ID,
  SEEDED_CREATION_TIME,
  SECOND_ROW_ID,
  type JournalScenario,
  selectorFromAnchor,
} from "./journalTestSupport";
import { createTestPGlite } from "../../support/pgliteSearchExtensions";

const SECOND_CREATION_TIME = decodeAppCreationTimeV1(1_725_000_000_001.25);

interface ScenarioOptions {
  readonly executionProfile?: "durableOperations";
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
  readonly decimalIndex?: boolean;
  readonly developerIndexDescriptor?: unknown;
  readonly indexedQueryComposition?:
    | "exact"
    | "missing"
    | "foreignControl"
    | "mismatchedAuthority";
  readonly journalFaultAfter?: NonNullable<
    SessionJournalStorePersistenceOptionsV1["faultAfter"]
  >;
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

export async function seedSnapshotDocument(
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
  await persistence.drizzle.transaction(async (tx) => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      return await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
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
      });
    } finally { closeInstallationAdmission(tx); }
  });
  return appDocumentIdV1FromRowIdentity({ tableId, rowId });
}

/** Owns one suite's migrated database and authentic journal construction. */
export async function createSessionJournalStorePGliteFixture() {
  const db = await createTestPGlite();
  let persistence: PGliteFlarexPersistence;
  try {
    persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
  } catch (error: unknown) {
    await db.close();
    throw error;
  }
  let infrastructureUuidCounter = 1;

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
            ...(options.decimalIndex ? { decimalFields: ["name"] } : {}),
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
        coveredThroughCommitSeq: CommitSeqSchema.make(1n),
        firstReadableCommitSeq: CommitSeqSchema.make(1n),
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
        const encodedKey = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(locatedDefinition, canonical, seed.creationTime));
        if (encodedKey === null) throw new Error("Expected fixture row in the ordered index");
        await persistence.drizzle.transaction(async (tx) => {
          await runEffect(lockInstallationForCurrentTransaction(tx));
          try {
            return await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{
              kind: "live",
              scopeId,
              definition: locatedDefinition,
              encodedKey,
              rowId: decodeOrderedIndexRowIdHexV1(seed.rowId),
              writeEpoch: clock.epoch,
              commitSeq: CommitSeqSchema.make(1n),
            }]));
          } finally { closeInstallationAdmission(tx); }
        });
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
      Object.freeze({ ...pointMutationSessionActivationFixture(
        deploymentId,
        scopeId,
        { evidence: { schemaVersionId } },
      ), ...(options.executionProfile === undefined ? {} : { executionProfile: options.executionProfile }) }),
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
    const store = createSessionJournalStorePersistence(ports, {
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
        ...(options.executionProfile === undefined ? {} : { executionProfile: options.executionProfile }),
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
          (select count(*)::int from fx_system_tx_journal_receipt
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

  return {
    persistence,
    scenario,
    resolutionPorts,
    journalCounts,
    journalRoot,
    eventEvidenceByteLengths,
    close: () => db.close(),
  };
}

export type SessionJournalStorePGliteFixture = Awaited<ReturnType<typeof createSessionJournalStorePGliteFixture>>;
