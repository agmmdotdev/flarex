import { webcrypto } from "node:crypto";

import {
  canonicalizeApplicationManifestV1,
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV1,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import {
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
  type AppDocumentIdV1,
} from "flarex-protocol/app-document-id";
import type { CatalogEdgeDefinitionId } from "flarex-protocol/catalog";
import {
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  projectScopeIdUuidV1,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";

import {
  advanceAppSchemaCandidateValidationEffect,
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
  installAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../appSchemaCandidateValidation";
import { locateAppIndexDefinitionByIdEffect } from
  "../appIndexDefinitions";
import { createAppUniqueConstraintDefinitionPortV1 } from
  "../appUniqueConstraintCommitV1";
import { createAppUniqueConstraintSetEligibilityPortV1 } from
  "../appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../appUniqueConstraintSetClosureV1";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../applicationAnalysisRegistration";
import { makeApplicationPublicationRepository } from
  "../applicationPublication";
import {
  makeApplicationActivationRepository,
  type ApplicationActiveSelection,
  type ApplicationRelationActivationRepository,
} from "../applicationActivation";
import { fxSystemApplicationActiveHeads } from
  "../applicationActivationSchema";
import {
  type ApplicationRelationBindingPublication,
  type ApplicationRelationBindingRepository,
  type PublishApplicationRelationBindingInput,
  publishApplicationRelationBindingEffect,
} from "../applicationRelationBinding";
import { createApplicationRelationBuildPort } from
  "../applicationRelationBuild";
import {
  applyApplicationRelationCommitEdgesInTransactionEffect,
  createApplicationRelationCommitPort,
  type LocatedApplicationRelationDefinitionSet,
  prepareApplicationRelationCommitResult,
} from "../applicationRelationCommit";
import { makeApplicationRelationPublicationRepository } from
  "../applicationRelationPublication";
import {
  createApplicationRelationReadPort,
  type ApplicationRelationSourceReference,
} from "../applicationRelationRead";
import { makeApplicationRelationReadinessFoldRepository } from
  "../applicationRelationReadinessFold";
import { createApplicationRelationReadinessPort } from
  "../applicationRelationReadiness";
import { createApplicationRelationSchemaAuthorityPort } from
  "../applicationRelationSchemaAuthority";
import { createApplicationRelationServingInspector } from
  "../applicationRelationServing";
import {
  createApplicationRelationTaskCatalogSnapshotPort,
  makeApplicationRelationTaskBindingRepository,
} from "../applicationRelationTaskBindings";
import { makeApplicationReadinessRepository } from
  "../applicationReadiness";
import { makeApplicationSchemaAuthorityPublisher } from
  "../applicationSchemaAuthority";
import {
  createApplicationTaskCatalogSnapshotPort,
  makeApplicationTaskBindingRepository,
} from "../applicationTaskBindings";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../appRows";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexPersistence } from "../index";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../intrinsicCreationTimeIndexBuildV1";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../indexBuildReconciliation";
import { createPhysicalDefinitionLifecyclePort } from
  "../physicalDefinitionLifecycle";
import {
  createPGliteLocatedIndexBuildReconciliationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedSplitScopeClockTarget,
  createPGliteSplitScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../pglite";
import {
  createPointCommitPublisherPortV1,
} from "../pointCommitTransaction";
import {
  createPostgresLocatedIndexBuildReconciliationTargetV1,
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedSplitScopeClockTarget,
  createPostgresSplitScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../postgres";
import type { ApplicationRelationQuerySnapshotContext } from
  "../applicationQuerySnapshot";
import {
  fxControlSchemaVersions,
  fxControlTables,
  fxSystemScopeClocks,
} from "../schema";
import { getScopeAuthorityProvisioningReceipt } from
  "../scopeAuthorityProvisioningReceipt";
import type { LocatedScopeClockReader } from
  "../scopeAuthorityResolution";
import type { SplitScopePhysicalLocator } from
  "../scopeMetadataTypes";
import type { LocatedReadCommittedAttemptTargetV1 } from
  "../transactionSessionAttemptKernel";

const LOCATOR = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "application_relation_query_system_test_target",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;
const RUNTIME_HOST_IDENTITY =
  "flarex.test/application-relation-query-system";
const COMPATIBILITY_DATE = "2026-08-26";
const INITIAL_SOURCE_COUNT = 129;
const EXACT_SOURCE_COUNT = 128;
const INITIAL_TARGET_ORDINAL = 90_001;
const EMPTY_TARGET_ORDINAL = 90_002;
const EXACT_TARGET_ORDINAL = 90_003;
const INITIAL_SOURCE_ORDINAL = 91_000;
const SNAPSHOT_CHANGE_SOURCE_ORDINAL = 92_000;
const EXACT_SOURCE_ORDINAL = 93_000;

type FixturePersistence = FlarexPersistence & Readonly<{
  readonly drizzle: FlarexMetadataDatabase;
}>;

export interface ApplicationRelationQueryCoreStateSnapshot {
  readonly tables: ReadonlyArray<Readonly<{
    readonly name: string;
    readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  }>>;
}

export interface ApplicationRelationQuerySystemTestFixture {
  readonly deploymentId: string;
  readonly activation: Pick<
    ApplicationRelationActivationRepository<unknown, unknown>,
    "readActive"
  >;
  readonly snapshot: ApplicationRelationQuerySnapshotContext;
  readonly initialSelection: ApplicationActiveSelection;
  readonly relation: ApplicationRelationSourceReference;
  readonly target: AppDocumentIdV1;
  readonly emptyTarget: AppDocumentIdV1;
  readonly exactTarget: AppDocumentIdV1;
  readonly expectedSources: ReadonlyArray<AppDocumentIdV1>;
  readonly expectedExactSources: ReadonlyArray<AppDocumentIdV1>;
  readonly incomingPageQueryExpectation: Readonly<{
    readonly scopeUuid: string;
    readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  }>;
  readonly captureCoreState: () => Promise<
    ApplicationRelationQueryCoreStateSnapshot
  >;
  readonly activateSuccessor: () => Promise<void>;
  readonly applySnapshotChangingSource: () => Promise<AppDocumentIdV1>;
  readonly withEdgeStorageUnavailable: <Value>(
    use: () => Promise<Value>,
  ) => Promise<Value>;
  readonly removeActiveHeadForTest: () => Promise<void>;
}

export async function createApplicationRelationQueryPGliteSystemTestFixture(
  persistence: Readonly<{
    readonly control: PGliteFlarexPersistence;
    readonly target: PGliteFlarexPersistence;
  }>,
): Promise<ApplicationRelationQuerySystemTestFixture> {
  ensureWebCrypto();
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    "deployment_application_relation_query_pglite",
  );
  const provisioned = await createPGliteSplitScopeAuthorityProvisioner(
    persistence.control,
    {
      placementPlanner: { plan: () => LOCATOR },
      targetResolver: {
        resolve: async locator =>
          createPGliteLocatedSplitScopeClockTarget(
            persistence.target,
            locator,
          ),
      },
      randomUuid: uuidSequence(1, 2),
    },
  ).ensure({
    deploymentId,
    projectId: "project_application_relation_query_pglite",
  });
  return createFixture({
    control: persistence.control,
    target: persistence.target,
    deploymentId,
    scopeId: provisioned.scope.scopeId,
    locatedTarget: createPGliteLocatedIndexBuildReconciliationTargetV1(
      persistence.target,
      LOCATOR,
    ),
    pointTarget: createPGliteLocatedPointMutationSessionActivationTargetV1(
      persistence.target,
      LOCATOR,
    ),
  });
}

export async function createApplicationRelationQueryPostgresSystemTestFixture(
  persistence: Readonly<{
    readonly control: PostgresFlarexPersistence;
    readonly target: PostgresFlarexPersistence;
  }>,
): Promise<ApplicationRelationQuerySystemTestFixture> {
  ensureWebCrypto();
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    "deployment_application_relation_query_postgres",
  );
  const provisioned = await createPostgresSplitScopeAuthorityProvisioner(
    persistence.control,
    {
      placementPlanner: { plan: () => LOCATOR },
      targetResolver: {
        resolve: async locator =>
          createPostgresLocatedSplitScopeClockTarget(
            persistence.target,
            locator,
          ),
      },
      randomUuid: uuidSequence(21, 22),
    },
  ).ensure({
    deploymentId,
    projectId: "project_application_relation_query_postgres",
  });
  return createFixture({
    control: persistence.control,
    target: persistence.target,
    deploymentId,
    scopeId: provisioned.scope.scopeId,
    locatedTarget: createPostgresLocatedIndexBuildReconciliationTargetV1(
      persistence.target,
      LOCATOR,
    ),
    pointTarget: createPostgresLocatedPointMutationSessionActivationTargetV1(
      persistence.target,
      LOCATOR,
    ),
  });
}

interface CreateFixtureInput {
  readonly control: FixturePersistence;
  readonly target: FixturePersistence;
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ScopeId;
  readonly locatedTarget: LocatedReadCommittedAttemptTargetV1;
  readonly pointTarget: LocatedScopeClockReader;
}

async function createFixture(
  input: CreateFixtureInput,
): Promise<ApplicationRelationQuerySystemTestFixture> {
  await input.target.query(
    `update fx_system_scope_clock
        set storage_generation = 'flarexdb_v1'
      where scope_id = $1`,
    [input.scopeId],
  );
  const clock = await input.target.getScopeClock(input.scopeId);
  if (clock === null || clock.storageGeneration !== "flarexdb_v1") {
    throw new Error("Expected a FlarexDB relation-query scope authority.");
  }
  const authority: ApplicationAnalysisAuthority = Object.freeze({
    scopeId: clock.scopeId,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
  });
  const provisioningReceipts = Object.freeze({
    getScopeAuthorityProvisioningReceipt: (scopeId: ScopeId) =>
      getScopeAuthorityProvisioningReceipt(input.control.drizzle, scopeId),
  });
  const authorityPorts = Object.freeze({
    scopeMetadata: input.control,
    provisioningReceipts,
    scopeClockTargets: { resolve: async () => input.locatedTarget },
  });
  const pointCommitAuthority = Object.freeze({
    scopeMetadata: input.control,
    applicationControlDb: input.control.drizzle,
    provisioningReceipts,
    scopeSessionTargets: { resolve: async () => input.pointTarget },
  });
  const relationCommit = createApplicationRelationCommitPort(
    input.control.drizzle,
    pointCommitAuthority,
  );
  const relationBuild = createApplicationRelationBuildPort(
    input.control.drizzle,
    authorityPorts,
    relationCommit,
    createApplicationRelationServingInspector(),
  );
  const relationReadiness = createApplicationRelationReadinessPort(
    input.control.drizzle,
    authorityPorts,
    relationCommit,
    relationBuild,
  );
  const relationInput = await relationPublicationInput(input.deploymentId);
  const relationPublication = await runEffect(
    publishApplicationRelationBindingEffect(
      relationBindingRepository(input.control.drizzle),
      relationInput,
    ),
  );
  await publishExecutionSchema(
    input,
    relationPublication.binding.schemaVersionId,
  );
  const canonicalManifest = requireFixtureResult(
    canonicalizeApplicationManifestV2(relationInput.manifest),
    "Expected a canonical relation-query Application Manifest.",
  );
  const analyses = makeApplicationAnalysisRepository(input.target.drizzle, {
    randomUuid: uuidSequence(31, 32, 33, 34, 35, 36, 37, 38, 39),
  });
  const publications = makeApplicationRelationPublicationRepository(
    input.target.drizzle,
    input.control.drizzle,
  );
  const taskBindings = makeApplicationRelationTaskBindingRepository(
    input.target.drizzle,
    input.control.drizzle,
  );
  const taskSha256 = makeStandardApplicationTaskSha256V1(bytes =>
    globalThis.crypto.subtle.digest("SHA-256", bytes)
  );
  const registerRevision = async (
    requestKey: string,
  ) => {
    const pending = await runEffect(analyses.begin({
      authority,
      requestKey,
      sourceArtifactRootSha256:
        canonicalManifest.manifest.sourceArtifact.rootSha256,
      analyzerIdentity: "application-relation-query-analyzer",
      analyzerPolicyIdentity: "application-relation-query-policy",
    }));
    const analyzed = await runEffect(analyses.settle(authority, {
      kind: "analyzed",
      candidateId: pending.candidateId,
      sourceArtifactRootSha256:
        canonicalManifest.manifest.sourceArtifact.rootSha256,
      analyzerIdentity: "application-relation-query-analyzer",
      analyzerPolicyIdentity: "application-relation-query-policy",
      canonicalManifest: canonicalManifest.canonicalText,
    }));
    if (analyzed.status !== "analyzed") {
      throw new Error("Expected an analyzed relation-query revision.");
    }
    const publication = await runEffect(publications.publish({
      authority,
      deploymentId: input.deploymentId,
      revisionId: analyzed.revision.revisionId,
      candidateId: analyzed.candidateId,
      analysisId: analyzed.analysisId,
      manifestSha256: analyzed.manifestSha256,
      manifest: canonicalManifest.manifest,
    }));
    const catalog = await runEffect(hashCanonicalTaskCatalogV1({
      version: 1,
      tasks: [],
    }, taskSha256));
    const bindings = await runEffect(produceApplicationTaskBindingsV1({
      definition: preparedDefinition(),
      catalog,
      authority: {
        scopeId: publication.scopeId,
        revisionId: publication.revisionId,
        candidateId: publication.candidateId,
        analysisId: publication.analysisId,
        sourceArtifactRootSha256: publication.sourceArtifactRootSha256,
        publicationSha256: publication.publicationSha256,
      },
      runtimePolicy: {
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
      },
    }, taskSha256));
    await runEffect(taskBindings.register({ authority, publication, bindings }));
    return publication;
  };
  const firstPublication = await registerRevision(
    "request:application-relation-query:initial",
  );

  const candidateValidation = createAppSchemaCandidateValidationPort({
    controlDb: input.control.drizzle,
    authority: authorityPorts,
  });
  await closeUniqueConstraintSet(
    input.control.drizzle,
    input.deploymentId,
    relationPublication.binding.schemaVersionId,
  );
  await settleCandidateValidation(candidateValidation, {
    deploymentId: input.deploymentId,
    schemaVersionId: relationPublication.binding.schemaVersionId,
  });
  await enableApplicationPhysicalBuilds(
    input.control.drizzle,
    authorityPorts,
    authority.scopeId,
    input.deploymentId,
    relationPublication.binding.schemaVersionId,
  );
  await enableRelationPhysicalBuilds(
    relationCommit,
    relationBuild,
    input.deploymentId,
    relationPublication.binding.schemaVersionId,
  );

  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(
    input.control.drizzle,
  );
  const uniqueConstraintEligibility =
    createAppUniqueConstraintSetEligibilityPortV1({
      controlDb: input.control.drizzle,
      authority: authorityPorts,
    }, uniqueConstraints);
  const pointCommit = createPointCommitPublisherPortV1({
    scopeMetadata: input.control,
    provisioningReceipts,
    scopeSessionTargets: {
      resolve: async () => {
        throw new Error(
          "Relation-query readiness must not open a commit session.",
        );
      },
    },
  }, { uniqueConstraints, uniqueConstraintEligibility });
  const candidateReadiness = createAppSchemaCandidateReadinessPort(
    candidateValidation,
  );
  const physicalDefinitionLifecycle = createPhysicalDefinitionLifecyclePort({
    controlDb: input.control.drizzle,
    authority: authorityPorts,
  });
  const relationFold = makeApplicationRelationReadinessFoldRepository({
    controlDb: input.control.drizzle,
    authority: authorityPorts,
    schema: createApplicationRelationSchemaAuthorityPort(
      input.control.drizzle,
    ),
    taskCatalog: createApplicationRelationTaskCatalogSnapshotPort(),
    candidateValidation: candidateReadiness,
    pointCommit,
    physicalDefinitionLifecycle,
    relations: relationReadiness,
  });
  const legacySchemaAuthority = makeApplicationSchemaAuthorityPublisher({
    db: input.control.drizzle,
    runTransaction: run => input.control.drizzle.transaction(run),
  });
  const legacyReadiness = makeApplicationReadinessRepository({
    controlDb: input.control.drizzle,
    authority: authorityPorts,
    schema: legacySchemaAuthority,
    taskCatalog: createApplicationTaskCatalogSnapshotPort(),
    candidateValidation: candidateReadiness,
    pointCommit,
    physicalDefinitionLifecycle,
    cold: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      materialize: () => Effect.die(new Error(
        "Legacy cold materialization must remain inert for relation queries.",
      )),
    },
  });
  const activation = makeApplicationActivationRepository({
    deploymentId: input.deploymentId,
    readiness: legacyReadiness,
    relationReadiness: relationFold,
    authority: authorityPorts,
  });
  const initialReadiness = await runEffect(relationFold.settle({
    deploymentId: input.deploymentId,
    revisionId: firstPublication.revisionId,
  }));
  if (initialReadiness.status !== "ready") {
    throw new Error("Expected ready relation-query Application evidence.");
  }
  await runEffect(activation.activate({
    revisionId: initialReadiness.revisionId,
    expectedActiveHead: null,
  }));
  const initialActive = await runEffect(activation.readActive());
  const legacyManifest = requireFixtureResult(
    canonicalizeApplicationManifestV1({
      format: "flarex.application-manifest",
      version: 1,
      sourceArtifact: canonicalManifest.manifest.sourceArtifact,
      schema: {
        version: 1,
        tables: canonicalManifest.manifest.schema.tables,
        indexes: canonicalManifest.manifest.schema.indexes,
      },
      functions: canonicalManifest.manifest.functions,
    } satisfies ApplicationManifestV1),
    "Expected a canonical Legacy relation-query transition manifest.",
  );
  const legacyPending = await runEffect(analyses.begin({
    authority,
    requestKey: "request:application-relation-query:legacy",
    sourceArtifactRootSha256: legacyManifest.manifest.sourceArtifact.rootSha256,
    analyzerIdentity: "application-relation-query-legacy-analyzer",
    analyzerPolicyIdentity: "application-relation-query-legacy-policy",
  }));
  const legacyAnalyzed = await runEffect(analyses.settle(authority, {
    kind: "analyzed",
    candidateId: legacyPending.candidateId,
    sourceArtifactRootSha256: legacyManifest.manifest.sourceArtifact.rootSha256,
    analyzerIdentity: "application-relation-query-legacy-analyzer",
    analyzerPolicyIdentity: "application-relation-query-legacy-policy",
    canonicalManifest: legacyManifest.canonicalText,
  }));
  if (legacyAnalyzed.status !== "analyzed") {
    throw new Error("Expected one analyzed Legacy relation-query revision.");
  }
  const legacyPublication = await runEffect(
    makeApplicationPublicationRepository(input.target.drizzle).publish({
      authority,
      revisionId: legacyAnalyzed.revision.revisionId,
      candidateId: legacyAnalyzed.candidateId,
      analysisId: legacyAnalyzed.analysisId,
      manifestSha256: legacyAnalyzed.manifestSha256,
      manifest: legacyManifest.manifest,
    }),
  );
  const legacyCatalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [],
  }, taskSha256));
  const legacyBindings = await runEffect(produceApplicationTaskBindingsV1({
    definition: preparedDefinition(),
    catalog: legacyCatalog,
    authority: {
      scopeId: legacyPublication.scopeId,
      revisionId: legacyPublication.revisionId,
      candidateId: legacyPublication.candidateId,
      analysisId: legacyPublication.analysisId,
      sourceArtifactRootSha256: legacyPublication.sourceArtifactRootSha256,
      publicationSha256: legacyPublication.publicationSha256,
    },
    runtimePolicy: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
    },
  }, taskSha256));
  await runEffect(
    makeApplicationTaskBindingRepository(input.target.drizzle).register({
      authority,
      bindings: legacyBindings,
    }),
  );
  const legacySchema = await runEffect(legacySchemaAuthority.publish({
    deploymentId: input.deploymentId,
    manifest: legacyManifest.manifest,
  }));
  await closeUniqueConstraintSet(
    input.control.drizzle,
    input.deploymentId,
    legacySchema.schemaVersionId,
  );
  await settleCandidateValidation(candidateValidation, {
    deploymentId: input.deploymentId,
    schemaVersionId: legacySchema.schemaVersionId,
  });
  await enableApplicationPhysicalBuilds(
    input.control.drizzle,
    authorityPorts,
    authority.scopeId,
    input.deploymentId,
    legacySchema.schemaVersionId,
  );
  const legacyEvidence = await runEffect(legacyReadiness.settle({
    deploymentId: input.deploymentId,
    revisionId: legacyPublication.revisionId,
  }));
  if (legacyEvidence.status !== "ready") {
    throw new Error(
      `Expected ready Legacy relation-query transition evidence; received ${legacyEvidence.status}.`,
    );
  }
  await runEffect(activation.activate({
    revisionId: legacyEvidence.revisionId,
    expectedActiveHead: initialActive.expectedActiveHead,
  }));
  const legacyActive = await runEffect(activation.readActive());
  await settleCandidateValidation(candidateValidation, {
    deploymentId: input.deploymentId,
    schemaVersionId: relationPublication.binding.schemaVersionId,
  });
  const successorPublication = await registerRevision(
    "request:application-relation-query:successor",
  );
  const successorReadiness = await runEffect(relationFold.settle({
    deploymentId: input.deploymentId,
    revisionId: successorPublication.revisionId,
  }));
  if (successorReadiness.status !== "ready") {
    throw new Error(
      `Expected ready relation-query successor evidence; received ${successorReadiness.status}${
        "reason" in successorReadiness
          ? `:${successorReadiness.reason}`
          : ""
      }.`,
    );
  }
  const relationBinding = relationPublication.binding.relationBindings[0];
  if (relationBinding === undefined) {
    throw new Error("Expected one relation-query binding.");
  }
  const definitions = await runEffect(relationCommit.locate({
    deploymentId: input.deploymentId,
    schemaVersionId: relationPublication.binding.schemaVersionId,
  }));
  const definition = definitions?.definitions[0];
  if (definition === undefined || definitions?.definitions.length !== 1) {
    throw new Error("Expected one exact relation-query definition.");
  }
  const relation: ApplicationRelationSourceReference = Object.freeze({
    source: Object.freeze({
      table: definition.semantic.declaration.source.table,
      path: definition.semantic.declaration.source.path,
    }),
  });
  const target = appDocumentIdV1FromRowIdentity({
    tableId: relationBinding.targetTableId,
    rowId: rowId(INITIAL_TARGET_ORDINAL),
  });
  const emptyTarget = appDocumentIdV1FromRowIdentity({
    tableId: relationBinding.targetTableId,
    rowId: rowId(EMPTY_TARGET_ORDINAL),
  });
  const exactTarget = appDocumentIdV1FromRowIdentity({
    tableId: relationBinding.targetTableId,
    rowId: rowId(EXACT_TARGET_ORDINAL),
  });
  const initialSourceOrdinals = Object.freeze(Array.from(
    { length: INITIAL_SOURCE_COUNT },
    (_, index) => INITIAL_SOURCE_ORDINAL + index,
  ));
  const exactSourceOrdinals = Object.freeze(Array.from(
    { length: EXACT_SOURCE_COUNT },
    (_, index) => EXACT_SOURCE_ORDINAL + index,
  ));
  const expectedSources = Object.freeze(initialSourceOrdinals.map(ordinal =>
    appDocumentIdV1FromRowIdentity({
      tableId: relationBinding.sourceTableId,
      rowId: rowId(ordinal),
    })
  ));
  const expectedExactSources = Object.freeze(exactSourceOrdinals.map(ordinal =>
    appDocumentIdV1FromRowIdentity({
      tableId: relationBinding.sourceTableId,
      rowId: rowId(ordinal),
    })
  ));
  const reads = createApplicationRelationReadPort(
    input.control.drizzle,
    pointCommitAuthority,
    relationCommit,
    relationFold,
  );
  const snapshot: ApplicationRelationQuerySnapshotContext = Object.freeze({
    deploymentId: input.deploymentId,
    controlDb: input.control.drizzle,
    authority: authorityPorts,
    relations: reads,
  });
  let successorActivated = false;
  let snapshotChangeApplied = false;
  return Object.freeze({
    deploymentId: input.deploymentId,
    activation: Object.freeze({
      readActive: () => activation.readActive(),
    }),
    snapshot,
    initialSelection: initialActive.selection,
    relation,
    target,
    emptyTarget,
    exactTarget,
    expectedSources,
    expectedExactSources,
    incomingPageQueryExpectation: Object.freeze({
      scopeUuid: projectScopeIdUuidV1(authority.scopeId).scopeUuid,
      edgeDefinitionId: definition.edge.edgeDefinitionId,
    }),
    captureCoreState: () => captureCoreState(input.target),
    activateSuccessor: async () => {
      if (successorActivated) return;
      await runEffect(activation.activate({
        revisionId: successorReadiness.revisionId,
        expectedActiveHead: legacyActive.expectedActiveHead,
      }));
      const seeded = await applySourceCommit({
        target: input.target,
        relationCommit,
        definitions,
        relationBinding,
        scopeId: authority.scopeId,
        epoch: authority.epoch,
        schemaVersionId: relationPublication.binding.schemaVersionId,
        commitSeq: CommitSeqSchema.make(1n),
        sources: Object.freeze([
          ...initialSourceOrdinals.map(ordinal => Object.freeze({
            ordinal,
            targetOrdinal: INITIAL_TARGET_ORDINAL,
          })),
          ...exactSourceOrdinals.map(ordinal => Object.freeze({
            ordinal,
            targetOrdinal: EXACT_TARGET_ORDINAL,
          })),
        ]),
        targets: Object.freeze([
          Object.freeze({ ordinal: INITIAL_TARGET_ORDINAL, name: "occupied" }),
          Object.freeze({ ordinal: EMPTY_TARGET_ORDINAL, name: "empty" }),
          Object.freeze({ ordinal: EXACT_TARGET_ORDINAL, name: "exact" }),
        ]),
      });
      const expectedSeeded = Object.freeze([
        ...expectedSources,
        ...expectedExactSources,
      ]);
      if (
        seeded.length !== expectedSeeded.length ||
        seeded.some((source, index) => source !== expectedSeeded[index])
      ) {
        throw new Error("Relation-query seed identities drifted.");
      }
      successorActivated = true;
    },
    applySnapshotChangingSource: async () => {
      if (snapshotChangeApplied) {
        throw new Error("The snapshot-changing source is single-use.");
      }
      const sources = await applySourceCommit({
        target: input.target,
        relationCommit,
        definitions,
        relationBinding,
        scopeId: authority.scopeId,
        epoch: authority.epoch,
        schemaVersionId: relationPublication.binding.schemaVersionId,
        commitSeq: CommitSeqSchema.make(2n),
        sources: Object.freeze([Object.freeze({
          ordinal: SNAPSHOT_CHANGE_SOURCE_ORDINAL,
          targetOrdinal: INITIAL_TARGET_ORDINAL,
        })]),
        targets: Object.freeze([]),
      });
      const source = sources[0];
      if (source === undefined) {
        throw new Error("Expected one snapshot-changing source.");
      }
      snapshotChangeApplied = true;
      return source;
    },
    withEdgeStorageUnavailable: <Value>(use: () => Promise<Value>) =>
      withEdgeStorageUnavailable(input.target, use),
    removeActiveHeadForTest: async () => {
      await input.target.drizzle.delete(fxSystemApplicationActiveHeads).where(
        eq(fxSystemApplicationActiveHeads.scopeId, authority.scopeId),
      );
    },
  });
}

interface ApplySourceCommitInput {
  readonly target: FixturePersistence;
  readonly relationCommit: ReturnType<typeof createApplicationRelationCommitPort>;
  readonly definitions: LocatedApplicationRelationDefinitionSet;
  readonly relationBinding: ApplicationRelationBindingPublication["binding"][
    "relationBindings"
  ][number];
  readonly scopeId: ApplicationAnalysisAuthority["scopeId"];
  readonly epoch: ApplicationAnalysisAuthority["epoch"];
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly commitSeq: ReturnType<typeof CommitSeqSchema.make>;
  readonly sources: ReadonlyArray<Readonly<{
    readonly ordinal: number;
    readonly targetOrdinal: number;
  }>>;
  readonly targets: ReadonlyArray<Readonly<{
    readonly ordinal: number;
    readonly name: string;
  }>>;
}

async function applySourceCommit(
  input: ApplySourceCommitInput,
): Promise<ReadonlyArray<AppDocumentIdV1>> {
  const targetTransitions = await Promise.all(input.targets.map(
    async targetInput => {
      const targetRowId = rowId(targetInput.ordinal);
      const creationTime = decodeAppCreationTimeV1(targetInput.ordinal);
      const documentId = appDocumentIdV1FromRowIdentity({
        tableId: input.relationBinding.targetTableId,
        rowId: targetRowId,
      });
      const final = await canonicalizeAppDocumentV1({
        tableId: input.relationBinding.targetTableId,
        rowId: targetRowId,
        creationTime,
        fields: { name: targetInput.name },
      });
      return Object.freeze({
        documentId,
        tableId: input.relationBinding.targetTableId,
        rowId: targetRowId,
        creationTime,
        prior: null,
        final,
      });
    },
  ));
  const sourceTransitions = await Promise.all(input.sources.map(
    async sourceInput => {
      const { ordinal, targetOrdinal } = sourceInput;
      const sourceRowId = rowId(ordinal);
      const creationTime = decodeAppCreationTimeV1(ordinal);
      const documentId = appDocumentIdV1FromRowIdentity({
        tableId: input.relationBinding.sourceTableId,
        rowId: sourceRowId,
      });
      const targetDocumentId = appDocumentIdV1FromRowIdentity({
        tableId: input.relationBinding.targetTableId,
        rowId: rowId(targetOrdinal),
      });
      const final = await canonicalizeAppDocumentV1({
        tableId: input.relationBinding.sourceTableId,
        rowId: sourceRowId,
        creationTime,
        fields: { author: targetDocumentId },
      });
      return Object.freeze({
        documentId,
        tableId: input.relationBinding.sourceTableId,
        rowId: sourceRowId,
        creationTime,
        prior: null,
        final,
      });
    },
  ));
  const transitions = Object.freeze([
    ...targetTransitions,
    ...sourceTransitions,
  ]);
  const prepared = requireFixtureResult(
    prepareApplicationRelationCommitResult(input.definitions, transitions),
    "Expected valid relation-query commit transitions.",
  );
  await input.target.drizzle.transaction(async tx => {
    for (const transition of transitions) {
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: input.scopeId,
        tableId: transition.tableId,
        rowId: transition.rowId,
        writeEpoch: input.epoch,
        commitSeq: input.commitSeq,
        prevCommitSeq: null,
        schemaVersionId: input.schemaVersionId,
        creationTime: transition.creationTime,
        value: {
          codecVersion: transition.final.codecVersion,
          valueJson: transition.final.valueJson,
          canonicalBytes: transition.final.canonicalBytes,
          sha256: transition.final.sha256,
        },
      });
    }
    await runEffect(applyApplicationRelationCommitEdgesInTransactionEffect(
      input.relationCommit,
      tx,
      {
        scopeId: input.scopeId,
        schemaVersionId: input.schemaVersionId,
        commitSeq: input.commitSeq,
        prepared,
      },
    ));
    const advanced = await tx.update(fxSystemScopeClocks).set({
      lastCommitSeq: input.commitSeq,
      updatedAt: new Date(),
    }).where(and(
      eq(fxSystemScopeClocks.scopeId, input.scopeId),
      eq(
        fxSystemScopeClocks.lastCommitSeq,
        CommitSeqSchema.make(input.commitSeq - 1n),
      ),
    )).returning({ lastCommitSeq: fxSystemScopeClocks.lastCommitSeq });
    if (advanced.length !== 1 ||
      advanced[0]?.lastCommitSeq !== input.commitSeq) {
      throw new Error("Expected one exact relation-query commit sequence.");
    }
  });
  return Object.freeze(sourceTransitions.map(source => source.documentId));
}

async function publishExecutionSchema(
  input: CreateFixtureInput,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const [schemaRows, tableRows] = await Promise.all([
    input.control.drizzle.select().from(fxControlSchemaVersions).where(and(
      eq(fxControlSchemaVersions.deploymentId, input.deploymentId),
      eq(fxControlSchemaVersions.schemaVersionId, schemaVersionId),
    )).limit(2),
    input.control.drizzle.select().from(fxControlTables).where(eq(
      fxControlTables.deploymentId,
      input.deploymentId,
    )).orderBy(asc(fxControlTables.tableId)),
  ]);
  const schema = schemaRows[0];
  if (schemaRows.length !== 1 || schema === undefined || tableRows.length !== 2) {
    throw new Error("Expected one exact relation-query schema publication.");
  }
  await input.target.insertDeploymentMetadata({
    deploymentId: input.deploymentId,
    projectId: `target_${input.deploymentId}`,
  });
  await input.target.drizzle.transaction(async tx => {
    await tx.insert(fxControlSchemaVersions).values(schema);
    await tx.insert(fxControlTables).values(tableRows);
  });
}

async function closeUniqueConstraintSet(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const prepared = await runEffect(
    prepareAppUniqueConstraintSetClosureV1Effect(db, {
      deploymentId,
      schemaVersionId,
    }),
  );
  await db.transaction(tx => runEffect(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
  ));
}

async function settleCandidateValidation(
  candidateValidation: ReturnType<typeof createAppSchemaCandidateValidationPort>,
  input: Readonly<{
    readonly deploymentId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
  }>,
): Promise<void> {
  await runEffect(installAppSchemaCandidateValidationEffect(
    candidateValidation,
    input,
  ));
  for (let step = 0; step < 64; step += 1) {
    const result = await runEffect(advanceAppSchemaCandidateValidationEffect(
      candidateValidation,
      input,
    ));
    if (result.disposition !== "readyToSettle") continue;
    await runEffect(settleAppSchemaCandidateValidationEffect(
      candidateValidation,
      input,
    ));
    return;
  }
  throw new Error("Relation-query candidate validation did not settle.");
}

async function enableApplicationPhysicalBuilds(
  controlDb: FlarexMetadataDatabase,
  authority: Parameters<typeof reconcilePublishedIndexBuildsV1Effect>[0][
    "authority"
  ],
  scopeId: ApplicationAnalysisAuthority["scopeId"],
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const ports = Object.freeze({ controlDb, authority });
  await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, {
    deploymentId,
    schemaVersionId,
  }));
  const requirements = await runEffect(
    loadPublishedPhysicalRequirementSnapshotV1(
      controlDb,
      Object.freeze({ deploymentId, schemaVersionId }),
    ),
  );
  if (requirements === null || requirements.definitions.length === 0) {
    throw new Error("Expected relation-query physical requirements.");
  }
  for (const definition of requirements.definitions) {
    const located = await runEffect(locateAppIndexDefinitionByIdEffect(
      controlDb,
      scopeId,
      definition.indexDefinitionId,
    ));
    if (located === null) {
      throw new Error("Expected a relation-query index definition.");
    }
    for (let step = 0; step < 16; step += 1) {
      const buildInput = Object.freeze({
        deploymentId,
        indexDefinitionId: definition.indexDefinitionId,
        pageSize: 16,
      });
      const built = located.access.kind === "developer"
        ? await runEffect(buildAppDeveloperOrderedIndexV1Effect(
            ports,
            buildInput,
          ))
        : await runEffect(buildIntrinsicCreationTimeIndexV1Effect(
            ports,
            buildInput,
          ));
      if (built.lifecycle === "enabled") break;
      if (step === 15) {
        throw new Error("Relation-query index build did not enable.");
      }
    }
  }
}

async function enableRelationPhysicalBuilds(
  relationCommit: ReturnType<typeof createApplicationRelationCommitPort>,
  relationBuild: ReturnType<typeof createApplicationRelationBuildPort>,
  deploymentId: ReturnType<typeof TransactionGrantDeploymentIdV1Schema.make>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const definitions = await runEffect(relationCommit.locate({
    deploymentId,
    schemaVersionId,
  }));
  if (definitions === null || definitions.definitions.length !== 1) {
    throw new Error("Expected one relation-query physical definition.");
  }
  for (const definition of definitions.definitions) {
    for (let step = 0; step < 128; step += 1) {
      const built = await runEffect(relationBuild.advance({
        deploymentId,
        schemaVersionId,
        edgeDefinitionId: definition.edge.edgeDefinitionId,
      }));
      if (built.lifecycle === "enabled") break;
      if (step === 127) {
        throw new Error("Relation-query physical definition did not enable.");
      }
    }
  }
}

async function captureCoreState(
  target: FixturePersistence,
): Promise<ApplicationRelationQueryCoreStateSnapshot> {
  const tableQueries = Object.freeze([
    ["fx_system_scope_clock", "scope_id"],
    ["fx_system_idempotency", "scope_uuid, request_key"],
    ["fx_system_application_activation", "scope_id, activation_sequence"],
    ["fx_system_application_active_head", "scope_id"],
    ["fx_system_application_readiness", "scope_id, revision_id"],
    ["fx_system_application_readiness_relation", "scope_id, revision_id, relation_ordinal"],
    ["fx_app_row_rev", "scope_uuid, table_id, row_id, commit_seq"],
    ["fx_app_row_current", "scope_uuid, table_id, row_id"],
    ["fx_app_edge_current", "scope_uuid, edge_definition_id, source_row_id, target_row_id, duplicate_ordinal"],
    ["fx_app_edge_adjacency_version", "scope_uuid, edge_definition_id, direction, endpoint_row_id"],
    ["fx_system_tx_session", "scope_uuid, session_id"],
    ["fx_system_snapshot_lease", "scope_uuid, session_id"],
    ["fx_system_tx_journal", "scope_uuid, session_id, attempt_fence"],
    ["fx_system_tx_execution_claim", "scope_uuid, session_id, attempt_fence"],
    ["fx_system_tx_journal_latest_receipt", "scope_uuid, session_id, attempt_fence"],
    ["fx_system_tx_journal_point", "scope_uuid, session_id, attempt_fence, table_id, row_id"],
    ["fx_system_tx_journal_index_range", "scope_uuid, session_id, attempt_fence, ordinal"],
    ["fx_system_tx_journal_relation_incoming", "scope_uuid, session_id, attempt_fence, edge_definition_id, target_row_id"],
    ["fx_system_tx_journal_write_event", "scope_uuid, session_id, attempt_fence, syscall_sequence"],
    ["fx_system_commit", "scope_uuid, commit_seq"],
    ["fx_system_commit_app_row_change", "scope_uuid, commit_seq, change_ordinal"],
    ["fx_system_outbox", "scope_uuid, outbox_seq"],
  ] as const);
  const tables = await Promise.all(tableQueries.map(async ([name, order]) => {
    const result = await target.query<Readonly<Record<string, unknown>>>(
      `select * from ${name} order by ${order}`,
    );
    return Object.freeze({
      name,
      rows: Object.freeze(structuredClone(result.rows)),
    });
  }));
  return Object.freeze({ tables: Object.freeze(tables) });
}

async function withEdgeStorageUnavailable<Value>(
  target: FixturePersistence,
  use: () => Promise<Value>,
): Promise<Value> {
  await target.query(
    "alter table fx_app_edge_adjacency_version rename to fx_app_edge_adjacency_version_query_guard",
  );
  let currentRenamed = false;
  try {
    await target.query(
      "alter table fx_app_edge_current rename to fx_app_edge_current_query_guard",
    );
    currentRenamed = true;
    return await use();
  } finally {
    if (currentRenamed) {
      await target.query(
        "alter table fx_app_edge_current_query_guard rename to fx_app_edge_current",
      );
    }
    await target.query(
      "alter table fx_app_edge_adjacency_version_query_guard rename to fx_app_edge_adjacency_version",
    );
  }
}

function relationBindingRepository(
  db: FlarexMetadataDatabase,
): ApplicationRelationBindingRepository {
  return {
    db,
    runTransaction: run => db.transaction(run),
  };
}

async function relationPublicationInput(
  deploymentId: ReturnType<typeof TransactionGrantDeploymentIdV1Schema.make>,
): Promise<PublishApplicationRelationBindingInput> {
  const canonical = requireFixtureResult(
    canonicalizeApplicationManifestV2(relationManifest()),
    "Expected canonical relation-query publication input.",
  );
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(canonical.canonicalBytes),
  ));
  return Object.freeze({
    deploymentId,
    manifest: canonical.manifest,
    manifestSha256: encodeBytesToLowercaseHex(digest),
    decisions: Object.freeze([Object.freeze({
      relationOrdinal: 1,
      evolution: Object.freeze({ kind: "new" as const }),
    })]),
  });
}

function relationManifest(): ApplicationManifestV2 {
  return requireFixtureResult(canonicalizeApplicationManifestV2({
    format: "flarex.application-manifest",
    version: 2,
    sourceArtifact: {
      rootSha256: "a".repeat(64),
      executionModulePath: "functions.js",
      schemaModulePath: "schema.js",
      modules: [{
        path: "functions.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "e".repeat(64),
        sourceByteLength: 18,
      }, {
        path: "schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: "f".repeat(64),
        sourceByteLength: 32,
      }],
    },
    schema: {
      version: 2,
      tables: [{
        tableId: 1,
        name: "posts",
        validator: {
          type: "object",
          value: {
            author: {
              fieldType: { type: "id", tableName: "users" },
              optional: false,
            },
          },
        },
        placement: { kind: "global" },
      }, {
        tableId: 2,
        name: "users",
        validator: {
          type: "object",
          value: {
            name: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        placement: { kind: "global" },
      }],
      indexes: [],
      relations: [{
        relationOrdinal: 1,
        sourceTableOrdinal: 1,
        targetTableOrdinal: 2,
        declaration: {
          format: "flarex.relation-declaration",
          version: 1,
          source: {
            table: "posts",
            path: [{ kind: "field", name: "author" }],
            forwardName: "author",
          },
          target: { table: "users" },
          value: { cardinality: "one", required: true },
          inverse: { cardinality: "many", name: "posts" },
          localized: false,
          onTargetDelete: "restrict",
        },
      }],
    },
    functions: [],
  }), "Expected a valid relation-query manifest fixture.").manifest;
}

function preparedDefinition() {
  return requireFixtureResult(prepareStandardApplicationDefinitionV1({
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 32,
      maximumValidatorDepth: 8,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: { tables: [], indexes: [] },
      modules: [{
        modulePath: "users",
        functions: [{
          exportName: "get",
          kind: "query",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: null,
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
      maximumEntryBindings: 1,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 16_384,
      maximumSemanticRecords: 16,
      maximumSemanticRecordBytes: 4_096,
      maximumSemanticStreamBytes: 16_384,
    },
    graphInput: {
      modules: [{
        path: "users.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode(
          "export const get = () => null;\n",
        ),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "users",
        artifactModulePath: "users.js",
      }],
      executionPath: "users.js",
      schemaPath: null,
      authPath: null,
    },
  }), "Expected a valid Standard Application definition fixture.");
}

function rowId(ordinal: number) {
  return decodeAppRowIdHexV1(ordinal.toString(16).padStart(32, "0"));
}

function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    return `70000000-0000-4000-8000-${sequence
      .toString()
      .padStart(12, "0")}`;
  };
}

function ensureWebCrypto(): void {
  if (globalThis.crypto !== undefined) return;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

function requireFixtureResult<Value, Failure>(
  result: Result.Result<Value, Failure>,
  message: string,
): Value {
  return Result.match(result, {
    onFailure: cause => {
      throw new Error(message, { cause });
    },
    onSuccess: value => value,
  });
}

function runEffect<Value, Error>(
  effect: Effect.Effect<Value, Error>,
): Promise<Value> {
  return Effect.runPromise(effect);
}
