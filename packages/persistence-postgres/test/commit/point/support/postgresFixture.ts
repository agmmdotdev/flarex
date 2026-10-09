import { conditionalUniqueSpec } from "../../../storage/unique/conditionalUniqueTestSupport";
import {
  ScopePhysicalLocator,
  SharedDatabaseScopePhysicalLocator,
} from "../../../../src/scope/scopeMetadataTypes";
import {
  advanceAppUniqueConstraintSetBackfillV1Effect,
  createLocatedAppUniqueConstraintSetBuildTargetV1,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../../../../src/storage/unique/appUniqueConstraintSetClosureV1";
import { type PostgresExecutionPhase } from "../../../performance/postgresExecutionObservation";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
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
  CommitSyscallSequenceV1Schema,
  canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect,
  type LogicalIndexRangeReadDependencyV1,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  SchemaManifestAppIndexDescriptorSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { decodeOrderedIndexRowIdHexV1 } from "flarex-protocol/ordered-index";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  projectScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe } from "vitest";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from "../../../../src/storage/documents/appRows";
import { runEffectTransaction } from "../../../../src/database/effectTransaction";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../../../src/scope/scopeClock";
import { appendAppIndexEntryRevisionsInTransactionEffect } from "../../../../src/storage/indexes/appIndexEntries";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
  createIntrinsicCreationTimeIndexDefinitionPortV1,
} from "../../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import {
  createAppDeveloperIndexDefinitionPortV1,
  lowerAppDeveloperIndexKeyV1,
} from "../../../../src/storage/indexes/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../../../../src/storage/unique/appUniqueConstraintCommitV1";
import {
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
} from "../../../../src/storage/unique/appUniqueConstraintDefinitions";
import { reconcilePublishedIndexBuildsV1Effect } from "../../../../src/storage/indexes/indexBuildReconciliation";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointMutationAttemptReplacementPortV1,
  createPointCommitPublisherPortV1,
  createPointCommitRollbackProofPortV1,
} from "../../../../src/commit/point/construction";
import {
  type PointMutationAttemptReplacementCommandV1,
  type PointCommitPublicationCommandV1,
  type PointCommitTransactionCommandV1,
} from "../../../../src/commit/point/contracts";
import {
  type PointMutationAttemptReplacementOptionsV1,
  type PointCommitTransactionProofOptionsV1,
} from "../../../../src/commit/point/constructionContracts";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
  type PostgresLocatedReadCommittedRunnerOptionsV1,
} from "../../../../src/database/postgresLocatedReadCommitted";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedIndexBuildReconciliationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../../../../src/database/postgres";
import type { LocatedScopeClockReader } from "../../../../src/scope/scopeAuthorityResolution";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "../../../../src/database/schema";
import { createAppDeveloperIndexQueryPortV1 } from "../../../../src/execution/journal/indexQueryPort";
import { createSessionJournalStorePersistence } from "../../../../src/execution/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
} from "../../../../src/execution/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  createLocatedPointMutationSessionActivationTargetV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../../../../src/execution/transactionSessionActivation";
import { LOCATED_READ_COMMITTED_RUNNER_V1 } from "../../../../src/execution/transactionSessionAttemptKernel";
import {
  pointCommitCommandFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "./commandEvidence";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "../../../support/postgresHelpers";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runSessionJournalPointOperation as runPointOperation,
} from "../../../support/effectTestRuntime";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  activatePointMutationSession,
  executionClaimForAnchor,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "../../../execution/transactionSessionActivationTestSupport";
import { deferredSignal } from "./postgresFaults";

export const describePostgres: typeof describe | typeof describe.skip = postgresUrl === null ? describe.skip : describe;

export const withPostgresPersistence = useFileScopedPostgresPersistence();

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

export interface PreparedAttempt {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
  readonly command: PointCommitTransactionCommandV1;
  readonly publicationCommand: PointCommitPublicationCommandV1;
}

export async function createScope(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  label: string,
  developerIndex: boolean | number = false,
  logicalTables: readonly string[] = ["users"],
  decimalIndex = false,
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
  const developerIndexCount =
    developerIndex === true ? 1 : developerIndex === false ? 0 : developerIndex;
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: logicalTables.map(appTable),
    indexes: Array.from({ length: developerIndexCount }, (_, index) => ({
      tableLogicalName: "users",
      descriptor: `byName${index}`,
      ...(decimalIndex ? { decimalFields: ["name"] } : {}),
      fields: [["name", "profile.alias"], ["alias"], ["category"]][index] ?? [
        "name",
      ],
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

export async function createAttempt(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  scope: ScopeScenario,
  label: string,
  materialWrite:
    | boolean
    | number
    | "mixed"
    | "duplicate"
    | Readonly<{ readonly kind: "insertTables"; readonly tables: readonly string[] }>
    | Readonly<{
        readonly kind: "insert";
        readonly name: string;
        readonly fields?: Readonly<Record<string, string | null>>;
      }>
    | Readonly<{
        readonly kind: "patch" | "delete";
        readonly documentId: ReturnType<typeof appDocumentIdV1FromRowIdentity>;
        readonly name?: string;
        readonly patch?: Readonly<Record<string, string | null>>;
      }>
    | Readonly<{
        readonly kind: "bulkPatch";
        readonly documentIds: ReadonlyArray<
          ReturnType<typeof appDocumentIdV1FromRowIdentity>
        >;
      }> = true,
  markPhase?: (phase: PostgresExecutionPhase) => void,
): Promise<PreparedAttempt> {
  const seededDocumentId =
    materialWrite === "mixed"
      ? await seedCommittedUser(persistence, scope)
      : null;
  markPhase?.("sessionActivation");
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(scope.ports, {
      leaseDurationMilliseconds: 300_000,
      randomUuid,
    }),
    pointMutationSessionActivationFixture(scope.deploymentId, scope.scopeId, {
      evidence: {
        schemaVersionId: scope.schemaVersionId,
        requestKey: TransactionRequestKeyV1Schema.make(
          `request:o06:postgres:${label}`,
        ),
      },
    }),
  );
  const store = createSessionJournalStorePersistence(scope.ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid,
  });
  markPhase?.("journalOpen");
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
  const materialWriteCount =
    typeof materialWrite === "number"
      ? materialWrite
      : materialWrite === true
        ? 1
        : materialWrite === "duplicate"
          ? 2
          : 0;
  if (
    materialWriteCount > 0 ||
    materialWrite === "mixed" ||
    typeof materialWrite === "object"
  ) {
    markPhase?.("tableResolution");
    const table = await runEffect(
      store.resolvePointTableEffect(attempt, "users"),
    );
    markPhase?.("pointOperations");
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
          name:
            materialWrite === "duplicate"
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
    if (typeof materialWrite === "object" && materialWrite.kind === "insertTables") {
      for (let index = 0; index < materialWrite.tables.length; index += 1) {
        const name = materialWrite.tables[index];
        if (name === undefined) throw new Error("Missing table fixture name.");
        const target = await runEffect(store.resolvePointTableEffect(attempt, name));
        await runPointOperation(store, target, {
          kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(index + 1)), fields: { name: `${label}_${index}` },
        });
      }
    } else if (typeof materialWrite === "object" && materialWrite.kind === "insert") {
      await runPointOperation(store, table, {
        kind: "insert",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        fields: { name: materialWrite.name, ...materialWrite.fields },
      });
    } else if (
      typeof materialWrite === "object" &&
      materialWrite.kind === "bulkPatch"
    ) {
      for (
        let index = 0;
        index < materialWrite.documentIds.length;
        index += 1
      ) {
        const documentId = materialWrite.documentIds[index];
        if (documentId === undefined)
          throw new Error("Missing bulk-patch document ID.");
        await runPointOperation(store, table, {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(
            BigInt(index + 1),
          ),
          documentId,
          patch: {
            name: `${label}_name_${index}`,
            alias: `${label}_alias_${index}`,
          },
        });
      }
    } else if (typeof materialWrite === "object") {
      await runPointOperation(
        store,
        table,
        materialWrite.kind === "patch"
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
            },
      );
    }
  }
  markPhase?.("sealPreparation");
  const prepared = await prepareSeal(store, attempt);
  markPhase?.("sealCanonicalization");
  const journal = await runEffect(
    canonicalizeSessionJournalEffect(prepared.journal),
  );
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: true }),
  );
  markPhase?.("sealPersistence");
  await completeSeal(store, prepared.preparation, journal, result);
  const authority = authorityFromAnchor(
    activation.anchor,
    scope.schemaVersionId,
    executionClaimForAnchor(activation.anchor),
  );
  const loader = createStoredAttemptEvidenceLoaderV1(scope.ports);
  markPhase?.("runningEvidenceCapture");
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") {
    throw new Error(`Expected running O06 evidence, received ${running.kind}.`);
  }
  markPhase?.("enterFinishing");
  await runEffect(
    createPointCommitFinishingTransitionPortV1(scope.ports).enterFinishing(
      await pointCommitFinishingCommandFromStoredAttemptV1(
        authority,
        running.evidence,
      ),
    ),
  );
  markPhase?.("finishingEvidenceCapture");
  const loaded = await runEffect(
    loader.loadFinishingEffect({
      deploymentId: activation.anchor.deploymentId,
      scopeId: activation.anchor.scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
    }),
  );
  if (loaded.kind !== "loaded") {
    throw new Error(`Expected O06 stored evidence, received ${loaded.kind}.`);
  }
  markPhase?.("commandProjection");
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

export async function createIndexedAttempt(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  scope: ScopeScenario,
  label: string,
) {
  const developerIndexes = createAppDeveloperIndexDefinitionPortV1(
    persistence.drizzle,
  );
  await prepareDeveloperIndexForPostgres(persistence, scope);
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
    throw new Error("Missing PostgreSQL O10 developer-index definition.");
  }
  const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
    persistence,
    scope.physicalLocator,
  );
  let enabled = false;
  for (let step = 0; step < 16; step += 1) {
    const built = await runEffect(
      buildAppDeveloperOrderedIndexV1Effect(
        {
          controlDb: persistence.drizzle,
          authority: {
            scopeMetadata: persistence,
            provisioningReceipts: {
              getScopeAuthorityProvisioningReceipt: async () => null,
            },
            scopeClockTargets: { resolve: async () => target },
          },
        },
        {
          deploymentId: scope.deploymentId,
          scopeId: scope.scopeId,
          indexDefinitionId: definition.indexDefinitionId,
          pageSize: 16,
        },
      ),
    );
    if (built.lifecycle === "enabled") {
      enabled = true;
      break;
    }
  }
  if (!enabled)
    throw new Error("Indexed attempt requires a completed physical build.");

  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(scope.ports, {
      leaseDurationMilliseconds: 300_000,
      randomUuid,
    }),
    pointMutationSessionActivationFixture(scope.deploymentId, scope.scopeId, {
      evidence: {
        schemaVersionId: scope.schemaVersionId,
        requestKey: TransactionRequestKeyV1Schema.make(
          `request:o10:postgres:${label}`,
        ),
      },
    }),
  );
  const store = createSessionJournalStorePersistence(scope.ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid,
    indexedQueries: createAppDeveloperIndexQueryPortV1(
      persistence.drizzle,
      scope.ports,
      developerIndexes,
    ),
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
  const table = await runEffect(
    store.resolvePointTableEffect(attempt, "users"),
  );
  const index = await runEffect(
    store.resolveDeveloperIndexEffect(table, "byName0"),
  );
  const queryResult = await runEffect(
    store.runIndexedQueryEffect(index, {
      kind: "indexRange",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      bounds: Object.freeze({}),
      limit: 16,
    }),
  );
  const prepared = await prepareSeal(store, attempt);
  const journal = await runEffect(
    canonicalizeSessionJournalEffect(prepared.journal),
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
  const loaded = await runEffect(
    loader.loadFinishingEffect({
      deploymentId: activation.anchor.deploymentId,
      scopeId: activation.anchor.scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
    }),
  );
  if (loaded.kind !== "loaded") {
    throw new Error(
      `Expected finishing O10 evidence, received ${loaded.kind}.`,
    );
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
    queryResult,
  });
}

export async function commitCompetingIndexedUser(
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
  const encodedKey = Result.getOrThrow(
    lowerAppDeveloperIndexKeyV1(attempt.definition, document, creationTime),
  );
    if (encodedKey === null) throw new Error("Expected fixture row in the ordered index");
  await runEffect(runEffectTransaction(callback => persistence.drizzle.transaction(callback),
    "Competing indexed row fixture rollback", tx => Effect.tryPromise({ try: async () => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scope.scopeId));
    const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
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
    await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{
          kind: "live",
          scopeId: scope.scopeId,
          definition: attempt.definition,
          encodedKey,
          rowId: decodeOrderedIndexRowIdHexV1(rowId),
          writeEpoch: clock.epoch,
          commitSeq,
        }]));
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
    await tx
      .update(fxSystemScopeClocks)
      .set({ lastCommitSeq: commitSeq })
      .where(eq(fxSystemScopeClocks.scopeId, scope.scopeId));
  }, catch: cause => cause }), cause => cause));
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
  const document = await canonicalizeFlarexValueV1(
    {
      _id: documentId,
      _creationTime: creationTime,
      name: "seeded",
    },
    "appDocument",
  );
  await runEffect(runEffectTransaction(callback => persistence.drizzle.transaction(callback),
    "Committed user fixture rollback", tx => Effect.tryPromise({ try: async () => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scope.scopeId));
    const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
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
    await tx
      .update(fxSystemScopeClocks)
      .set({
        lastCommitSeq: commitSeq,
      })
      .where(eq(fxSystemScopeClocks.scopeId, scope.scopeId));
  }, catch: cause => cause }), cause => cause));
  return documentId;
}

export async function enableIntrinsicIndexForPostgres(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
): Promise<
  Pick<PointCommitTransactionProofOptionsV1, "intrinsicCreationTimeIndexes">
> {
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
  await runEffect(
    reconcilePublishedIndexBuildsV1Effect(ports, {
      deploymentId: scope.deploymentId,
      scopeId: scope.scopeId,
      schemaVersionId: scope.schemaVersionId,
    }),
  );
  for (let step = 0; step < 8; step += 1) {
    const advanced = await runEffect(
      buildIntrinsicCreationTimeIndexV1Effect(ports, {
        deploymentId: scope.deploymentId,
        scopeId: scope.scopeId,
        indexDefinitionId: decodeCatalogIndexDefinitionId(1),
        pageSize: 8,
      }),
    );
    if (advanced.lifecycle === "enabled") break;
  }
  return Object.freeze({
    intrinsicCreationTimeIndexes:
      createIntrinsicCreationTimeIndexDefinitionPortV1(persistence.drizzle),
  });
}

export async function prepareDeveloperIndexForPostgres(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
): Promise<Pick<PointCommitTransactionProofOptionsV1, "developerIndexes">> {
  const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
    persistence,
    scope.physicalLocator,
  );
  await runEffect(
    reconcilePublishedIndexBuildsV1Effect(
      {
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
      },
      {
        deploymentId: scope.deploymentId,
        scopeId: scope.scopeId,
        schemaVersionId: scope.schemaVersionId,
      },
    ),
  );
  return Object.freeze({
    developerIndexes: createAppDeveloperIndexDefinitionPortV1(
      persistence.drizzle,
    ),
  });
}

export async function developerIndexBuildCursor(
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

export async function prepareUniqueConstraintForPostgres(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
  uniqueSpec?: typeof conditionalUniqueSpec,
  descriptors: readonly string[] = ["unique_name"],
): Promise<
  Required<Pick<PointCommitTransactionProofOptionsV1, "uniqueConstraints">>
> {
  for (const descriptor of descriptors) {
    const prepared = await runEffect(
      prepareAppUniqueConstraintDefinitionBindingV1Effect(persistence.drizzle, {
        deploymentId: scope.deploymentId,
        schemaVersionId: scope.schemaVersionId,
        tableId: decodeCatalogTableId(1),
        descriptor: SchemaManifestAppIndexDescriptorSchema.make(descriptor),
        physicalSpec: uniqueSpec ?? decodeAppUniqueConstraintPhysicalSpecV1({
          kind: "appUniqueConstraint",
          specVersion: 1,
          orderedFields: ["name"],
          sparse: false,
          localePolicy: { kind: "none" },
          keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
          keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
        }),
      }),
    );
    await persistence.drizzle.transaction((tx) =>
      runEffect(
        ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared),
      ),
    );
  }
  const input = {
    deploymentId: scope.deploymentId,
    schemaVersionId: scope.schemaVersionId,
  };
  const closure = await runEffect(
    prepareAppUniqueConstraintSetClosureV1Effect(persistence.drizzle, input),
  );
  await persistence.drizzle.transaction((tx) =>
    runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure)),
  );
  const buildPorts = {
    controlDb: persistence.drizzle,
    authority: {
      scopeMetadata: persistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: {
        resolve: async (locator: ScopePhysicalLocator) =>
          createLocatedAppUniqueConstraintSetBuildTargetV1(
            persistence.drizzle,
            locator,
          ),
      },
    },
  };
  await runEffect(
    reconcileAppUniqueConstraintSetBuildV1Effect(buildPorts, { ...input, scopeId: scope.scopeId }),
  );
  let enabled = false;
  for (let step = 0; step < 16; step += 1) {
    const advanced = await runEffect(
      advanceAppUniqueConstraintSetBackfillV1Effect(buildPorts, {
        ...input,
        scopeId: scope.scopeId,
        pageSize: 16,
      }),
    );
    if (advanced.lifecycle === "enabled") {
      enabled = true;
      break;
    }
  }
  if (!enabled) throw new Error("Expected PostgreSQL unique build to enable.");
  return Object.freeze({
    uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(
      persistence.drizzle,
    ),
  });
}

export async function setValidatingUniqueSetBuild(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
  definitionId = 1000,
) {
  await persistence.query(
    `insert into fx_system_unique_constraint_build (scope_id, unique_constraint_definition_id, storage_generation, storage_generation_fence, epoch, start_commit_seq, covered_through_commit_seq, lifecycle, cursor_row_id, attempt_fence)
    select clock.scope_id, $2, authority.storage_generation, authority.storage_generation_fence, authority.epoch, clock.last_commit_seq, clock.last_commit_seq, 'validating', decode(repeat('ff',16),'hex'), 1 from fx_system_scope_clock clock join fx_system_scope_execution_authority authority using (scope_id) where clock.scope_id = $1
    on conflict (scope_id, unique_constraint_definition_id) do nothing`,
    [scope.scopeId, definitionId],
  );
}

export async function uniqueSetBuildCursors(
  persistence: PostgresFlarexPersistence,
  scope: ScopeScenario,
) {
  const result = await persistence.query<{ cursor_row_hex: string | null }>(
    `select encode(cursor_row_id, 'hex') cursor_row_hex from fx_system_unique_constraint_build where scope_id = $1 and unique_constraint_definition_id >= 1000 order by unique_constraint_definition_id`,
    [scope.scopeId],
  );
  return result.rows.map((row) => row.cursor_row_hex);
}

export function createPort(
  persistence: PostgresFlarexPersistence,
  options: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitRollbackProofPortV1(
    resolutionPorts(persistence),
    options,
  );
}

export function createPublisher(
  persistence: PostgresFlarexPersistence,
  options: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitPublisherPortV1(
    resolutionPorts(persistence),
    options,
  );
}

export function createPublisherWithRunner(
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

export function emptyDurableState() {
  return {
    revisions: "0",
    current_rows: "0",
    commit_headers: "0",
    commit_changes: "0",
    outcomes: "0",
    wakes: "0",
    last_commit_seq: "0",
  } as const;
}

export function createReplacementPort(
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

export function replacementCommand(
  command: PointCommitTransactionCommandV1,
  currentCommitSeq: ReturnType<
    typeof CommitSeqSchema.make
  > = CommitSeqSchema.make(command.authorityPins.snapshotToken.commitSeq + 1n),
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

export async function installCompetingPointRow(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
): Promise<void> {
  const locked = deferredSignal();
  const release = deferredSignal();
  release.resolve();
  const commit = commitCompetingPointRow(persistence, command, locked, release);
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

export async function commitCompetingPointRow(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
  locked: ReturnType<typeof deferredSignal>,
  release: ReturnType<typeof deferredSignal>,
): Promise<void> {
  const intent = command.rowIntents[0];
  if (intent?.kind !== "live") {
    throw new Error("O06 competing writer requires a live intent.");
  }
  const document = await canonicalizeFlarexValueV1(intent.value, "appDocument");
  await runEffect(runEffectTransaction(callback => persistence.drizzle.transaction(callback),
    "Competing point row fixture rollback", tx => Effect.tryPromise({ try: async () => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, command.authorityPins.scopeId));
    const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
    const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
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
      .where(eq(fxSystemScopeClocks.scopeUuid, command.sealIdentity.scopeUuid));
  }, catch: cause => cause }), cause => cause));
}

export async function durableState(
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
        (select count(*)::text from fx_system_commit_wake
          where scope_uuid = $1) as wakes,
        last_commit_seq::text
      from fx_system_scope_clock
      where scope_uuid = $1
    `,
    [scopeUuid],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing O06 durable state.");
  return row;
}

export async function intrinsicIndexState(
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

export async function developerIndexState(
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
    revisions: Object.freeze(
      revisions.rows.map((row) =>
        Object.freeze({
          indexDefinitionId: row.index_definition_id,
          encodedKeyHex: row.encoded_key_hex,
          rowIdHex: row.row_id_hex,
          commitSeq: row.commit_seq,
          isTombstone: row.is_tombstone,
        }),
      ),
    ),
    current: Object.freeze(
      current.rows.map((row) =>
        Object.freeze({
          indexDefinitionId: row.index_definition_id,
          encodedKeyHex: row.encoded_key_hex,
          rowIdHex: row.row_id_hex,
          commitSeq: row.commit_seq,
        }),
      ),
    ),
  });
}

export async function uniqueKeyState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
) {
  const rows = await persistence.query<{
    constraint_id: string;
    encoded_key_hex: string;
    row_id_hex: string;
    table_id: number;
    locale_key: string;
    key_sha256_hex: string;
  }>(
    `select constraint_id::text,
       encode(encoded_key, 'hex') as encoded_key_hex,
       encode(row_id, 'hex') as row_id_hex,
       table_id, locale_key, encode(canonical_key_sha256, 'hex') key_sha256_hex
     from fx_app_unique_key
     where scope_uuid = $1
     order by constraint_id, encoded_key, row_id`,
    [scopeUuid],
  );
  return Object.freeze(
    rows.rows.map((row) =>
      Object.freeze({
        constraintId: row.constraint_id,
        encodedKeyHex: row.encoded_key_hex,
        rowIdHex: row.row_id_hex,
        tableId: row.table_id,
        localeKey: row.locale_key,
        keySha256Hex: row.key_sha256_hex,
      }),
    ),
  );
}

export function compareIntrinsicIndexRows(
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
  const identityOrder =
    left.tableId.localeCompare(right.tableId) ||
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

export function pointRowIdHex(documentId: string): string {
  return decodeAppDocumentIdentityV1(documentId).rowId;
}

export async function replacementState(
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
      (select count(*)::text from fx_system_tx_journal_receipt
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

export async function terminalPublicationState(
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
      join fx_system_commit_wake as wake
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
          deleted_at: { fieldType: { type: "union", value: [{ type: "null" }, { type: "string" }] }, optional: true },
          nullable_key: { fieldType: { type: "union", value: [{ type: "null" }, { type: "string" }] }, optional: true },
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

export function uuidFactory(prefix: string): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}
