import {
  constructApplicationServingOwners,
  retainApplicationServing,
} from "../../../src/application/applicationServing";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import type {
  ApplicationActivationTargetProfile,
} from "../../../src/application/readiness/contracts";
import {
  canonicalizeApplicationManifestV1,
  canonicalizeApplicationManifestV2,
  verifyApplicationManifestWithRelations,
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
import {
  prepareStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import {
  CommitSyscallSequenceV1Schema,
  canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import { type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  projectScopeIdUuidV1,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { expect } from "vitest";
import {
  exactRelationCommitRowId,
  publishExactRelationSourceCommit,
} from "./applicationRelationSourceCommitFixture";
import { policyManifestFixture } from "../ownership/applicationWritePolicyFixture";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import {
  advanceAppSchemaCandidateValidationEffect,
  createAppSchemaCandidateValidationPort,
  createLocatedAppSchemaCandidateValidationTarget,
  installAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../../../src/storage/catalog/appSchemaCandidateValidation";
import { locateAppIndexDefinitionByIdEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import {
  reconcileAppUniqueConstraintSetBuildV1Effect,
  advanceAppUniqueConstraintSetBackfillV1Effect,
} from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import {
  readAppUniqueConstraintSetClosureV1Effect,
} from "../../../src/storage/unique/appUniqueConstraintSetClosureV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../../../src/storage/unique/appUniqueConstraintSetClosureV1";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../../../src/application/applicationAnalysisRegistration";
import { makeApplicationPublicationRepository } from "../../../src/application/applicationPublication";
import {
  makeApplicationReadinessRepository,
} from "../../../src/application/readiness/repository";
import {
  type ApplicationRelationBindingPublication,
  publishApplicationRelationBindingEffect,
} from "../../../src/application/relations/binding";
import {
  createApplicationRelationBuildPort,
} from "../../../src/application/relations/applicationRelationBuild";
import {
  createApplicationRelationCommitPort,
} from "../../../src/application/relations/applicationRelationCommit";
import {
  makeApplicationRelationPublicationRepository,
} from "../../../src/application/relations/applicationRelationPublication";
import {
  createApplicationRelationReadPort,
} from "../../../src/application/relations/applicationRelationRead";
import {
  fxSystemApplicationReadiness,
  fxSystemApplicationReadinessRelations,
} from "../../../src/application/relations/applicationRelationSchema";
import {
  makeApplicationRelationTaskBindingRepository,
} from "../../../src/application/relations/applicationRelationTaskBindings";
import {
  makeApplicationSchemaAuthorityPublisher,
} from "../../../src/application/applicationSchemaAuthority";
import {
  makeApplicationTaskBindingRepository,
} from "../../../src/application/tasks/applicationTaskBindings";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../../../src/storage/indexes/indexBuildReconciliation";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedSplitScopeClockTarget,
  createPGliteSplitScopeAuthorityProvisioner,
} from "../../../src/database/pglite";
import {
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../../../src/database/locatedTransactionIdentity";
import type { SplitScopePhysicalLocator } from "../../../src/scope/scopeMetadataTypes";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "../../../src/application/applicationActivationSchema";
import { deployments, fxSystemScopeClocks } from "../../../src/database/schema";
import { createSessionJournalStorePersistence } from "../../../src/execution/sessionJournalStore";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
} from "../../../src/execution/session/constructionContracts";
import { createStoredAttemptEvidenceLoaderV1 } from "../../../src/execution/storedAttemptEvidence";
import type { StableTableCatalogTransaction } from "../../../src/storage/catalog/stableTableCatalog";
import {
  ensureRelationBuildTestWebCrypto,
  relationBuildRowId,
  relationBuildPublicationInput,
} from "./applicationRelationBuildTestSupport";
import {
  completeSessionJournalSeal,
  prepareSessionJournalSeal,
  runEffect,
} from "../../support/effectTestRuntime";
import {
  relationAuthorityFromAnchor,
  selectorFromRelationAnchor,
} from "../../commit/point/support/relations";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  pointMutationSessionActivationFixture,
} from "../../execution/session/support/activationEvidence";
import {
  activatePointMutationSession,
} from "../../execution/session/support/attemptFixture";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { ApplicationNativeMutationPersistence } from "../applicationNativeMutationTestFixture";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedSplitScopeClockTarget,
  createPostgresSplitScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../../../src/database/postgres";
const LOCATOR = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "application_relation_readiness_fold_target",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;
const RUNTIME_HOST_IDENTITY = "flarex.test/application-relation-runtime-host";
const COMPATIBILITY_DATE = "2026-08-25";
const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);



let fixtureOrdinal = 0;

export async function relationActivationInventory(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
) {
  const [roots, children, activations, heads] = await Promise.all([
    fixture.persistence.drizzle.select().from(
      fxSystemApplicationReadiness,
    ).where(eq(fxSystemApplicationReadiness.scopeId, fixture.authority.scopeId)),
    fixture.persistence.drizzle.select().from(
      fxSystemApplicationReadinessRelations,
    ).where(eq(fxSystemApplicationReadinessRelations.scopeId, fixture.authority.scopeId)),
    fixture.persistence.drizzle.select().from(
      fxSystemApplicationActivations,
    ).where(eq(fxSystemApplicationActivations.scopeId, fixture.authority.scopeId)),
    fixture.persistence.drizzle.select().from(
      fxSystemApplicationActiveHeads,
    ).where(eq(fxSystemApplicationActiveHeads.scopeId, fixture.authority.scopeId)),
  ]);
  return Object.freeze({
    roots: roots.length,
    children: children.length,
    activations: activations.length,
    heads: heads.length,
  });
}

export async function readyExactRelationReadFixture(
  options: RelationReadinessFixtureOptions = {},
) {
  const fixture = await relationReadinessFixture(options);
  await prepareReadinessEvidence(fixture);
  const readiness = await runEffect(fixture.fold.settle(fixture.input));
  if (readiness.status !== "ready") {
    throw new Error("Expected relation-aware Application readiness.");
  }
  await runEffect(fixture.relationActivation.activate({
    revisionId: readiness.revisionId,
    expectedActiveHead: null,
  }));
  const active = await runEffect(fixture.relationActivation.readActive());
  const binding = fixture.relation.binding.relationBindings[0];
  if (binding === undefined) throw new Error("Expected a relation binding.");
  const reads = createApplicationRelationReadPort(
    fixture.control.drizzle,
    fixture.pointCommitAuthority,
    fixture.relationCommit,
    fixture.fold,
  );
  const capability = await runEffect(reads.prepare({
    deploymentId: fixture.deploymentId,
    selection: active.selection,
    relationId: binding.relationId,
  }));
  const input = Object.freeze({
    deploymentId: fixture.deploymentId,
    scopeId: fixture.authority.scopeId,
    schemaVersionId: fixture.relation.binding.schemaVersionId,
  });
  const resolved = Result.getOrThrow(reads.resolve(capability, input));
  const definitions = await runEffect(fixture.relationCommit.locate({
    deploymentId: fixture.deploymentId,
    schemaVersionId: fixture.relation.binding.schemaVersionId,
  }));
  const expectedDefinitions = fixture.semanticReuse ? 1 : 2;
  if (definitions === null ||
    definitions.definitions.length !== expectedDefinitions) {
    throw new Error("Expected the exact relation definitions.");
  }
  return Object.freeze({
    fixture,
    readiness,
    active,
    binding,
    reads,
    capability,
    input,
    resolved,
    definitions,
  });
}

type ReadyExactRelationReadFixture = Awaited<
  ReturnType<typeof readyExactRelationReadFixture>
>;

export async function prepareSealedRelationAttempt(
  ready: ReadyExactRelationReadFixture,
  applicationRelations: typeof ready.reads = ready.reads,
) {
  const randomUuid = uuidSequence(101, 102, 103);
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      ready.fixture.pointCommitAuthority,
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid,
        randomExecutionClaimOwner: randomUuid,
      },
    ),
    pointMutationSessionActivationFixture(
      ready.fixture.deploymentId,
      decodeReplacementScopeIdV1(ready.readiness.scopeId),
      { evidence: {
        schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
      } },
    ),
  );
  if (activation.status !== "created") {
    throw new Error("Expected one relation-aware mutation attempt.");
  }
  const store = createSessionJournalStorePersistence(
    ready.fixture.pointCommitAuthority,
    {
      grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      applicationRelations,
    },
  );
  const attempt = await runEffect(store.openAttemptEffect({
    selector: selectorFromRelationAnchor(activation.anchor),
    executionClaim: activation.executionClaim,
    snapshotToken: activation.anchor.snapshotToken,
    schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
  }));
  const relation = await runEffect(
    store.resolveApplicationRelationReadEffect(attempt, ready.capability),
  );
  const operation = Object.freeze({
    kind: "relationIncoming" as const,
    syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
    targetDocumentId: appDocumentIdV1FromRowIdentity({
      tableId: ready.binding.targetTableId,
      rowId: relationBuildRowId(9_301),
    }),
    limit: 1,
  });
  const read = await runEffect(
    store.runApplicationRelationIncomingReadEffect(relation, operation),
  );
  if (read.kind !== "completed") {
    throw new Error("Expected one completed relation read before sealing.");
  }
  const prepared = await prepareSessionJournalSeal(store, attempt);
  const journal = await runEffect(
    canonicalizeSessionJournalEffect(prepared.journal),
  );
  const successfulResult = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: true }),
  );
  await completeSessionJournalSeal(
    store,
    prepared.preparation,
    journal,
    successfulResult,
  );
  const authority = relationAuthorityFromAnchor(
    activation.anchor,
    ready.fixture.relation.binding.schemaVersionId,
    activation.executionClaim,
  );
  const loader = createStoredAttemptEvidenceLoaderV1(
    ready.fixture.pointCommitAuthority,
  );
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") {
    throw new Error("Expected sealed running relation evidence.");
  }
  return Object.freeze({
    activation,
    store,
    attempt,
    relation,
    operation,
    authority,
    loader,
    running,
  });
}

export async function applyExactRelationSourceCommit(
  ready: ReadyExactRelationReadFixture,
  targetRowId: ReturnType<typeof exactRelationCommitRowId>,
  sourceOrdinal: number,
  expectedCommitSeq: ReturnType<typeof CommitSeqSchema.make>,
  includeTarget: boolean = expectedCommitSeq === 1n,
) {
  return publishExactRelationSourceCommit({
    controlDb: ready.fixture.control.drizzle, scopeId: ready.fixture.authority.scopeId,
    selection: ready.active.selection,
    ports: ready.fixture.pointCommitAuthority, authority: ready.fixture.authorityPorts,
    publication: ready.fixture.relation, definitions: ready.definitions, relationCommit: ready.fixture.relationCommit,
  }, targetRowId, sourceOrdinal, expectedCommitSeq, includeTarget);
}

export async function advanceExactRelationScopeClock(
  ready: ReadyExactRelationReadFixture,
  commitSeq: ReturnType<typeof CommitSeqSchema.make>,
): Promise<void> {
  const updated = await ready.fixture.persistence.drizzle.update(
    fxSystemScopeClocks,
  ).set({
    lastCommitSeq: commitSeq,
    updatedAt: new Date(),
  }).where(eq(
    fxSystemScopeClocks.scopeId,
    ready.fixture.authority.scopeId,
  )).returning({ lastCommitSeq: fxSystemScopeClocks.lastCommitSeq });
  if (updated.length !== 1 || updated[0]?.lastCommitSeq !== commitSeq) {
    throw new Error("Expected one exact relation scope clock update.");
  }
}

export async function setExactRelationAdjacencyVersion(
  ready: ReadyExactRelationReadFixture,
  targetRowId: ReturnType<typeof relationBuildRowId>,
  commitSeq: ReturnType<typeof CommitSeqSchema.make>,
): Promise<void> {
  const updated = await ready.fixture.persistence.query<{
    readonly last_changed_commit_seq: string;
  }>(
    `update fx_app_edge_adjacency_version
        set last_changed_commit_seq = $5
      where scope_uuid = $1
        and edge_definition_id = $2
        and direction = $3
        and endpoint_row_id = $4
      returning last_changed_commit_seq::text`,
    [
      projectScopeIdUuidV1(ready.fixture.authority.scopeId).scopeUuid,
      ready.binding.edgeDefinitionId,
      "incoming",
      appRowIdHexV1ToBytes(targetRowId),
      commitSeq,
    ],
  );
  if (
    updated.rows.length !== 1 ||
    updated.rows[0]?.last_changed_commit_seq !== commitSeq.toString()
  ) {
    throw new Error("Expected one exact incoming adjacency version update.");
  }
}

export interface RelationReadinessFixtureOptions {
  readonly activationProfile?: ApplicationActivationTargetProfile;
  /** Wrap the genuine target before serving owners capture their immutable ports. */
  readonly wrapServingTarget?: (target: LocatedReadCommittedAttemptTargetV1) => LocatedReadCommittedAttemptTargetV1;
  readonly physicalLocator?: SplitScopePhysicalLocator;
  readonly sessionTargetOptions?: LocatedPointMutationSessionActivationTargetOptionsV1;
  readonly persistence?: PGliteFlarexPersistence | PostgresFlarexPersistence;
  readonly controlPersistence?: PGliteFlarexPersistence | PostgresFlarexPersistence;
  readonly fixtureIdentity?: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }>;
  readonly writePolicy?: boolean;
  readonly cmsIndexes?: boolean;
  readonly cmsFields?: Parameters<typeof policyManifestFixture>[2];
  readonly cmsManifest?: Awaited<ReturnType<typeof policyManifestFixture>>;
  /** Compose the database-authenticated session target for DataBinding admission. */
  readonly bindingAdmission?: boolean;
  readonly includeFunction?: boolean;
  readonly semanticReuse?: boolean;
}

export async function relationReadinessFixture(
  options: RelationReadinessFixtureOptions = {},
) {
  ensureRelationBuildTestWebCrypto();
  fixtureOrdinal += 1;
  const fixtureUuidSequence = (...values: number[]) => uuidSequence(...values.map(value => value + (options.fixtureIdentity?.uuidOffset ?? 0)));
  const resource = options.persistence ?? await createMigratedPGlitePersistence();
  const fixtureLocator = options.physicalLocator ?? await (async () => {
    // File-scoped Postgres migrations live in the connection's selected schema.
    const schemaName = (await resource.query<{ name: unknown }>("select current_schema() as name")).rows[0]?.name;
    if (typeof schemaName !== "string" || schemaName.length === 0) throw new Error("Missing fixture schema");
    return { ...LOCATOR, schemaName };
  })();
  const persistence: ApplicationNativeMutationPersistence = resource;
  const controlResource = options.controlPersistence ?? (options.writePolicy === true && !("pool" in resource) ? await createMigratedPGlitePersistence() : resource);
  const control: ApplicationNativeMutationPersistence = controlResource;
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    options.fixtureIdentity?.deploymentId ?? `deployment_application_relation_fold_${fixtureOrdinal}`,
  );
  const provisionOptions =
    {
      placementPlanner: { plan: () => fixtureLocator },
      targetResolver: {
        resolve: async (locator: SplitScopePhysicalLocator) =>
          "pool" in resource ? createPostgresLocatedSplitScopeClockTarget(resource, locator) : createPGliteLocatedSplitScopeClockTarget(resource, locator),
      },
      randomUuid: fixtureUuidSequence(1, 2),
    };
  const provisioned = await ("pool" in controlResource
    ? createPostgresSplitScopeAuthorityProvisioner(controlResource, provisionOptions)
    : createPGliteSplitScopeAuthorityProvisioner(controlResource, provisionOptions)).ensure({
    deploymentId,
    projectId: options.fixtureIdentity?.projectId ?? `project_application_relation_fold_${fixtureOrdinal}`,
  });
  await persistence.query(
    `update fx_system_scope_execution_authority
        set storage_generation = 'flarexdb_v1'
      where scope_id = $1`,
    [provisioned.scope.scopeId],
  );
  const clock = await persistence.getScopeClock(provisioned.scope.scopeId);
  if (clock === null || clock.storageGeneration !== "flarexdb_v1") {
    throw new Error("Expected relation-aware Application scope authority.");
  }
  const authority: ApplicationAnalysisAuthority = Object.freeze({
    scopeId: clock.scopeId,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
  });
  const runtime = composeRelationReadinessFixtureRuntime(control, resource, {
    deploymentId, scopeId: authority.scopeId, physicalLocator: fixtureLocator,
    bindingAdmission: options.bindingAdmission === true,
    ...(options.sessionTargetOptions === undefined ? {} : { sessionTargetOptions: options.sessionTargetOptions }),
    ...(options.activationProfile === undefined ? {} : { activationProfile: options.activationProfile }),
    ...(options.wrapServingTarget === undefined ? {} : { wrapServingTarget: options.wrapServingTarget }),
  });
  const { pointTarget, authorityPorts, pointCommitAuthority, relationCommit, servingInspector,
    relationBuild, relations, candidateValidation, physicalDefinitionLifecycle, foldContext, fold,
    legacyReadiness, relationActivation, activationProfile } = runtime;
  let relationInput = options.writePolicy === true
    ? { ...(options.cmsManifest ?? await policyManifestFixture(undefined, options.cmsIndexes, options.cmsFields)), deploymentId,
      decisions: options.cmsManifest?.manifest.schema.relations.map(relation => ({ relationOrdinal: relation.relationOrdinal, evolution: { kind: "new" as const } })) ?? [] }
    : await relationApplicationInput(
    deploymentId,
    fixtureOrdinal,
    options.includeFunction === true,
  );
  let relation: ApplicationRelationBindingPublication;
  if (options.semanticReuse === true) {
    const originInput = await relationBuildPublicationInput(
      deploymentId,
      fixtureOrdinal,
      { inverseName: "authoredPosts" },
    );
    const origin = await runEffect(publishApplicationRelationBindingEffect(
      relationBindingRepository(control.drizzle),
      originInput,
    ));
    await enableRelationPhysicalBuildsFor(
      relationCommit,
      relationBuild,
      deploymentId,
      authority.scopeId,
      origin.binding.schemaVersionId,
      1,
    );
    relationInput = await relationBuildPublicationInput(
      deploymentId,
      fixtureOrdinal + 1_000,
      {
        inverseName: "articlesAuthored",
        sourceMutation: true,
        decisions: Object.freeze([{
          relationOrdinal: 1,
          evolution: Object.freeze({
            kind: "preserve" as const,
            fromSchemaVersionId: origin.binding.schemaVersionId,
            fromRelationOrdinal: 1,
            physical: "reuse" as const,
          }),
        }]),
      },
    );
    relation = await runEffect(publishApplicationRelationBindingEffect(
      relationBindingRepository(control.drizzle),
      relationInput,
    ));
  } else {
    relation = await runEffect(publishApplicationRelationBindingEffect(
      relationBindingRepository(control.drizzle),
      relationInput,
    ));
  }
  const canonicalManifest = await runEffect(verifyApplicationManifestWithRelations(relationInput.manifest));
  if (control !== persistence) {
    // Exercise the existing publication owner for the located runtime catalog.
    if (options.fixtureIdentity === undefined) {
      await persistence.insertDeploymentMetadata({ deploymentId, projectId: `project_application_relation_fold_${fixtureOrdinal}` });
    } else {
      const existingDeployment = await persistence.drizzle.select().from(deployments)
        .where(eq(deployments.deploymentId, deploymentId));
      expect(existingDeployment).toMatchObject([{ projectId: options.fixtureIdentity.projectId }]);
    }
    const distributed = await runEffect(publishApplicationRelationBindingEffect(relationBindingRepository(persistence.drizzle), relationInput));
    expect(distributed.binding).toEqual(relation.binding);
    expect(distributed.boundPublicationSha256).toBe(relation.boundPublicationSha256);
  }
  const analyses = makeApplicationAnalysisRepository(persistence.drizzle, {
    randomUuid: fixtureUuidSequence(11, 12, 13),
  });
  const pending = await runEffect(analyses.begin({
    authority,
    requestKey: `request:application-relation-fold:${fixtureOrdinal}`,
    sourceArtifactRootSha256:
      canonicalManifest.manifest.sourceArtifact.rootSha256,
    analyzerIdentity: "application-relation-analyzer",
    analyzerPolicyIdentity: "application-relation-analyzer-policy",
  }));
  const analyzed = await runEffect(analyses.settle(authority, {
    kind: "analyzed",
    candidateId: pending.candidateId,
    sourceArtifactRootSha256:
      canonicalManifest.manifest.sourceArtifact.rootSha256,
    analyzerIdentity: "application-relation-analyzer",
    analyzerPolicyIdentity: "application-relation-analyzer-policy",
    canonicalManifest: canonicalManifest.canonicalText,
  }));
  if (analyzed.status !== "analyzed") {
    throw new Error("Expected analyzed relation-aware Application revision.");
  }
  expect(analyzed.manifestSha256).toBe(relationInput.manifestSha256);
  const publications = makeApplicationRelationPublicationRepository(
    persistence.drizzle,
    control.drizzle,
  );
  const publicationInput = Object.freeze({
      authority,
      deploymentId,
      revisionId: analyzed.revision.revisionId,
      candidateId: analyzed.candidateId,
      analysisId: analyzed.analysisId,
      manifestSha256: analyzed.manifestSha256,
      manifest: canonicalManifest.manifest,
  });
  const publication = await runEffect(publications.publish(publicationInput));
  expect(await runEffect(publications.publish(publicationInput)))
    .toEqual(publication);
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [taskManifest()],
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
  const taskBindings = makeApplicationRelationTaskBindingRepository(
    persistence.drizzle,
    control.drizzle,
  );
  const taskBindingInput = Object.freeze({ authority, publication, bindings });
  const taskRegistration = await runEffect(
    taskBindings.register(taskBindingInput),
  );
  expect(await runEffect(taskBindings.register(taskBindingInput)))
    .toEqual(taskRegistration);
  const copiedPublication = await runEffect(Effect.result(
    taskBindings.register({
      ...taskBindingInput,
      publication: Object.freeze({ ...publication }),
    }),
  ));
  expect(Result.isFailure(copiedPublication)).toBe(true);
  if (Result.isFailure(copiedPublication)) {
    expect(copiedPublication.failure).toMatchObject({ reason: "invalidInput" });
  }

  return Object.freeze({
    persistence,
    control,
    deploymentId,
    authority,
    authorityPorts,
    pointCommitAuthority,
    pointTarget,
    relation,
    manifest: canonicalManifest.manifest,
    publication,
    publications,
    publicationInput,
    taskBindings,
    taskBindingInput,
    relationBuild,
    relationCommit,
    servingInspector,
    relations,
    candidateValidation,
    physicalDefinitionLifecycle,
    semanticReuse: options.semanticReuse === true,
    foldContext,
    fold,
    legacyReadiness,
    relationActivation,
    activationProfile,
    legacyActivation: makeApplicationActivationRepository({
      activation: activationProfile,
      deploymentId,
      scopeId: authority.scopeId,
      readiness: legacyReadiness,
      authority: authorityPorts,
    }),
    legacyColdCalls: runtime.legacyColdCalls,
    servingOwners: runtime.servingOwners,
    makeServing: runtime.makeServing,
    input: Object.freeze({
      deploymentId,
      scopeId: authority.scopeId,
      revisionId: publication.revisionId,
    }),
  });
}

/** Original fixture composition is reused by setup and a genuinely restricted
 * serving login. This constructs ports only; it issues no readiness verdict. */
export function composeRelationReadinessFixtureRuntime(
  control: ApplicationNativeMutationPersistence,
  target: PGliteFlarexPersistence | PostgresFlarexPersistence,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; physicalLocator: SplitScopePhysicalLocator;
    bindingAdmission: boolean; sessionTargetOptions?: LocatedPointMutationSessionActivationTargetOptionsV1;
    activationProfile?: ApplicationActivationTargetProfile;
    wrapServingTarget?: (target: LocatedReadCommittedAttemptTargetV1) => LocatedReadCommittedAttemptTargetV1;
    protectedMetadata?: Parameters<typeof makeApplicationReadinessRepository>[0]["protectedMetadata"];
    coldRuntime?: Readonly<{ runtimeHostIdentity: string; compatibilityDate: string }> }>,
) {
  const pointTarget = "pool" in target
    ? createPostgresLocatedPointMutationSessionActivationTargetV1(target, input.physicalLocator, input.sessionTargetOptions)
    : createPGliteLocatedPointMutationSessionActivationTargetV1(target, input.physicalLocator, input.sessionTargetOptions);
  const locatedTarget = (() => {
    if (!input.bindingAdmission) return createLocatedAppSchemaCandidateValidationTarget(target.drizzle, input.physicalLocator);
    if (!isLocatedReadCommittedAttemptTargetV1(pointTarget))
      throw new Error("Binding fixture requires a read-committed session target");
    return pointTarget;
  })();
  let legacyColdCalls = 0;
  if (!isLocatedReadCommittedAttemptTargetV1(pointTarget))
    throw new Error("Expected a read-committed session target");
  if (input.sessionTargetOptions?.managedInstallation !== undefined && input.activationProfile === undefined)
    throw new Error("A managed relation fixture requires its genuine activation target profile");
  const activationProfile: ApplicationActivationTargetProfile = input.activationProfile ?? { kind: "fullProof" };
  const servingTarget = input.wrapServingTarget === undefined ? locatedTarget : input.wrapServingTarget(locatedTarget);
  const owners = constructApplicationServingOwners({ controlDatabase: control.drizzle, database: target.drizzle,
    target: servingTarget, scopeSessionTarget: pointTarget, deploymentId: input.deploymentId, scopeId: input.scopeId,
    activation: activationProfile,
    ...(input.protectedMetadata === undefined ? {} : { protectedMetadata: input.protectedMetadata }),
    cold: { runtimeHostIdentity: input.coldRuntime?.runtimeHostIdentity ?? RUNTIME_HOST_IDENTITY,
      compatibilityDate: input.coldRuntime?.compatibilityDate ?? COMPATIBILITY_DATE, materialize: () => {
        legacyColdCalls++;
        return Effect.die(new Error("Legacy cold materialization must not run for relation readiness."));
      } } });
  return { ...owners, servingOwners: owners, makeServing: (session: RelationalSession) => retainApplicationServing(owners, session),
    pointTarget, authorityPorts: owners.authority, legacyReadiness: owners.readiness,
    relationActivation: owners.application, activationProfile, legacyColdCalls: () => legacyColdCalls };
}

export async function prepareReadinessEvidence(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
): Promise<void> {
  await closeEmptyUniqueConstraintSet(
    fixture.control.drizzle,
    fixture.deploymentId,
    fixture.relation.binding.schemaVersionId,
  );
  await settleCandidateValidation(
    fixture.candidateValidation,
    fixture.deploymentId,
    fixture.authority.scopeId,
    fixture.relation.binding.schemaVersionId,
  );
  await enableApplicationPhysicalBuilds(
    fixture.control.drizzle,
    fixture.authorityPorts,
    fixture.authority.scopeId,
    fixture.deploymentId,
    fixture.relation.binding.schemaVersionId,
  );
  const uniquePorts = { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts };
  const uniqueInput = { deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, schemaVersionId: fixture.relation.binding.schemaVersionId };
  const closure = await runEffect(readAppUniqueConstraintSetClosureV1Effect(fixture.control.drizzle, uniqueInput.deploymentId, uniqueInput.schemaVersionId));
  if (closure !== null && closure.members.length !== 0) {
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(uniquePorts, uniqueInput));
    let enabled = false;
    // Each call advances one selected definition through its empty-table build.
    for (let step = 0; step < 8 * closure.members.length; step += 1) {
      const advanced = await runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(uniquePorts, { ...uniqueInput, pageSize: 16 }));
      if (advanced.lifecycle === "enabled") { enabled = true; break; }
    }
    expect(enabled).toBe(true);
  }
  if (fixture.relation.binding.relationBindings.length === 0) return;
  if (fixture.semanticReuse) {
    await settleRelationSemanticReadiness(fixture);
  } else {
    await enableRelationPhysicalBuilds(fixture);
    if (fixture.relation.binding.relationBindings.some(binding => binding.evolution.kind === "preserve" && binding.evolution.physical === "reuse")) {
      await settleRelationSemanticReadiness(fixture);
    }
  }
}

export async function prepareAdditionalRelationRevision(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
  ordinal = 0,
  beforeReadiness?: () => Promise<void>,
) {
  const manifest = await runEffect(verifyApplicationManifestWithRelations(fixture.manifest));
  const analyses = makeApplicationAnalysisRepository(
    fixture.persistence.drizzle,
    { randomUuid: uuidSequence(111 + ordinal * 3, 112 + ordinal * 3, 113 + ordinal * 3) },
  );
  const pending = await runEffect(analyses.begin({
    authority: fixture.authority,
    requestKey:
      `request:application-relation-aba:${fixture.publication.revisionId}:${ordinal}`,
    sourceArtifactRootSha256: manifest.manifest.sourceArtifact.rootSha256,
    analyzerIdentity: `application-relation-aba-analyzer:${ordinal}`,
    analyzerPolicyIdentity: `application-relation-aba-policy:${ordinal}`,
  }));
  const analyzed = await runEffect(analyses.settle(fixture.authority, {
    kind: "analyzed",
    candidateId: pending.candidateId,
    sourceArtifactRootSha256: manifest.manifest.sourceArtifact.rootSha256,
    analyzerIdentity: `application-relation-aba-analyzer:${ordinal}`,
    analyzerPolicyIdentity: `application-relation-aba-policy:${ordinal}`,
    canonicalManifest: manifest.canonicalText,
  }));
  if (analyzed.status !== "analyzed") {
    throw new Error("Expected one additional analyzed relation revision.");
  }
  const publication = await runEffect(fixture.publications.publish({
    authority: fixture.authority,
    deploymentId: fixture.deploymentId,
    revisionId: analyzed.revision.revisionId,
    candidateId: analyzed.candidateId,
    analysisId: analyzed.analysisId,
    manifestSha256: analyzed.manifestSha256,
    manifest: manifest.manifest,
  }));
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [taskManifest()],
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
  await runEffect(fixture.taskBindings.register({
    authority: fixture.authority,
    publication,
    bindings,
  }));
  if (beforeReadiness !== undefined) await beforeReadiness();
  const readiness = await runEffect(fixture.fold.settle({
    deploymentId: fixture.deploymentId,
    scopeId: fixture.authority.scopeId,
    revisionId: publication.revisionId,
  }));
  if (readiness.status !== "ready") {
    throw new Error(`Expected one additional ready relation revision: ${JSON.stringify(readiness)}`);
  }
  return Object.freeze({ publication, readiness });
}

export async function prepareLegacyRevisionInRelationFixture(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
) {
  const manifest = Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: fixture.manifest.sourceArtifact,
    schema: {
      version: 1,
      tables: fixture.manifest.schema.tables,
      indexes: fixture.manifest.schema.indexes,
    },
    // This transition-only legacy revision has no executable fixture writer.
    functions: fixture.manifest.functions.filter(fn => fn.path !== "functions:write"),
  } satisfies ApplicationManifestV1));
  const analyses = makeApplicationAnalysisRepository(
    fixture.persistence.drizzle,
    { randomUuid: uuidSequence(121, 122, 123) },
  );
  const pending = await runEffect(analyses.begin({
    authority: fixture.authority,
    requestKey:
      `request:application-relation-transition:legacy:${fixture.publication.revisionId}`,
    sourceArtifactRootSha256: manifest.manifest.sourceArtifact.rootSha256,
    analyzerIdentity: "application-relation-transition-legacy-analyzer",
    analyzerPolicyIdentity:
      "application-relation-transition-legacy-policy",
  }));
  const analyzed = await runEffect(analyses.settle(fixture.authority, {
    kind: "analyzed",
    candidateId: pending.candidateId,
    sourceArtifactRootSha256: manifest.manifest.sourceArtifact.rootSha256,
    analyzerIdentity: "application-relation-transition-legacy-analyzer",
    analyzerPolicyIdentity:
      "application-relation-transition-legacy-policy",
    canonicalManifest: manifest.canonicalText,
  }));
  if (analyzed.status !== "analyzed") {
    throw new Error("Expected one analyzed Legacy replacement.");
  }
  const publication = await runEffect(
    makeApplicationPublicationRepository(
      fixture.persistence.drizzle,
    ).publish({
      authority: fixture.authority,
      revisionId: analyzed.revision.revisionId,
      candidateId: analyzed.candidateId,
      analysisId: analyzed.analysisId,
      manifestSha256: analyzed.manifestSha256,
      manifest: manifest.manifest,
    }),
  );
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [taskManifest()],
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
  await runEffect(
    makeApplicationTaskBindingRepository(
      fixture.persistence.drizzle,
    ).register({
      authority: fixture.authority,
      bindings,
    }),
  );
  const schema = await runEffect(
    makeApplicationSchemaAuthorityPublisher({
      db: fixture.persistence.drizzle,
      runTransaction: run => fixture.persistence.drizzle.transaction(run),
    }).publish({
      deploymentId: fixture.deploymentId,
      manifest: manifest.manifest,
    }),
  );
  await closeEmptyUniqueConstraintSet(
    fixture.persistence.drizzle,
    fixture.deploymentId,
    schema.schemaVersionId,
  );
  await settleCandidateValidation(
    fixture.candidateValidation,
    fixture.deploymentId,
    fixture.authority.scopeId,
    schema.schemaVersionId,
  );
  await enableApplicationPhysicalBuilds(
    fixture.persistence.drizzle,
    fixture.authorityPorts,
    fixture.authority.scopeId,
    fixture.deploymentId,
    schema.schemaVersionId,
  );
  const readiness = await runEffect(fixture.legacyReadiness.settle({
    deploymentId: fixture.deploymentId,
    scopeId: fixture.authority.scopeId,
    revisionId: publication.revisionId,
  }));
  if (readiness.status !== "ready") {
    throw new Error("Expected one ready Legacy replacement.");
  }
  return Object.freeze({ publication, schema, readiness });
}

export async function closeEmptyUniqueConstraintSet(
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

export async function settleCandidateValidation(
  candidateValidation: ReturnType<typeof createAppSchemaCandidateValidationPort>,
  deploymentId: string,
  scopeId: ApplicationAnalysisAuthority["scopeId"],
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const input = Object.freeze({ deploymentId, scopeId, schemaVersionId });
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
  throw new Error("Relation-aware candidate validation did not settle.");
}

export async function enableApplicationPhysicalBuilds(
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
    scopeId,
    schemaVersionId,
  }));
  const requirements = await runEffect(
    loadPublishedPhysicalRequirementSnapshotV1(
      controlDb,
      Object.freeze({ deploymentId, schemaVersionId }),
    ),
  );
  if (requirements === null || requirements.definitions.length === 0) {
    throw new Error("Expected relation-aware physical requirements.");
  }
  for (const definition of requirements.definitions) {
    const located = await runEffect(locateAppIndexDefinitionByIdEffect(
      controlDb,
      scopeId,
      definition.indexDefinitionId,
    ));
    if (located === null) {
      throw new Error("Relation-aware index definition is missing.");
    }
    for (let step = 0; step < 16; step += 1) {
      const input = Object.freeze({
        deploymentId,
        scopeId,
        indexDefinitionId: definition.indexDefinitionId,
        pageSize: 16,
      });
      const built = located.access.kind === "developer"
        ? await runEffect(buildAppDeveloperOrderedIndexV1Effect(ports, input))
        : await runEffect(buildIntrinsicCreationTimeIndexV1Effect(ports, input));
      if (built.lifecycle === "enabled") break;
      if (step === 15) {
        throw new Error("Relation-aware physical build did not enable.");
      }
    }
  }
}

export async function enableRelationPhysicalBuilds(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
): Promise<void> {
  await enableRelationPhysicalBuildsFor(
    fixture.relationCommit,
    fixture.relationBuild,
    fixture.deploymentId,
    fixture.input.scopeId,
    fixture.relation.binding.schemaVersionId,
    fixture.relation.binding.relationBindings.length,
  );
}

export async function enableRelationPhysicalBuildsFor(
  relationCommit: ReturnType<typeof createApplicationRelationCommitPort>,
  relationBuild: ReturnType<typeof createApplicationRelationBuildPort>,
  deploymentId: Parameters<
    ReturnType<typeof createApplicationRelationCommitPort>["locate"]
  >[0]["deploymentId"],
  scopeId: ScopeId,
  schemaVersionId: CatalogSchemaVersionId,
  expectedCount: number,
): Promise<void> {
  const definitions = await runEffect(relationCommit.locate({
    deploymentId,
    schemaVersionId,
  }));
  if (
    definitions === null || definitions.definitions.length !== expectedCount
  ) throw new Error("Expected the complete relation physical definition set.");
  for (const definition of definitions.definitions) {
    // Reused physical state retains its origin binding; validate the new semantic binding separately.
    if (definition.binding.evolution.kind === "preserve" && definition.binding.evolution.physical === "reuse") continue;
    for (let step = 0; step < 128; step += 1) {
      const result = await runEffect(relationBuild.advance({
        deploymentId,
        scopeId,
        schemaVersionId,
        edgeDefinitionId: definition.edge.edgeDefinitionId,
      }));
      if (result.lifecycle === "enabled") break;
      if (step === 127) {
        throw new Error("Relation physical readiness did not enable.");
      }
    }
  }
}

export async function settleRelationSemanticReadiness(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
): Promise<void> {
  const input = Object.freeze({
    deploymentId: fixture.deploymentId,
    applicationManifestSha256:
      fixture.relation.manifestBinding.applicationManifestSha256,
  });
  for (let step = 0; step < 128; step += 1) {
    const result = await runEffect(fixture.relations.advance(input));
    if (result.status === "complete") return;
    if (result.status === "not_ready") {
      throw new Error(`Semantic relation readiness blocked: ${result.reason}.`);
    }
  }
  throw new Error("Semantic relation readiness did not settle.");
}

export async function relationApplicationInput(
  deploymentId: string,
  ordinal: number,
  includeFunction: boolean,
) {
  const base = await relationBuildPublicationInput(deploymentId, ordinal, {
    secondRelation: true,
    inverseName: "authoredPosts",
    secondInverseName: "reviewedPosts",
    sourceMutation: true,
  });
  if (!includeFunction) return base;
  const canonical = Result.getOrThrow(canonicalizeApplicationManifestV2({
    ...base.manifest,
    functions: [...base.manifest.functions, relationFunction("a"), relationFunction("default")],
  }));
  return Object.freeze({
    ...base,
    manifest: canonical.manifest,
    manifestSha256: await sha256Hex(canonical.canonicalBytes),
  });
}

export function relationFunction(
  exportName: "a" | "default",
): ApplicationManifestV2["functions"][number] {
  return Object.freeze({
    path: exportName === "default" ? "users" : `users:${exportName}`,
    moduleName: "users",
    exportName,
    kind: "query",
    visibility: "public",
    args: Object.freeze({ type: "any" as const }),
    returns: null,
    partition: null,
  });
}

export function relationBindingRepository(db: FlarexMetadataDatabase) {
  return Object.freeze({
    db,
    runTransaction: <Value>(
      run: (tx: StableTableCatalogTransaction) => Promise<Value>,
    ): Promise<Value> => db.transaction(run),
  });
}

export function preparedDefinition() {
  return Result.getOrThrow(prepareStandardApplicationDefinitionV1({
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
  }));
}

export function taskManifest() {
  return {
    version: 1,
    taskId: "tasks.users.get",
    handler: {
      logicalModulePath: "users",
      artifactModulePath: "users.js",
      exportName: "get",
    },
    payloadValidator: { type: "any" },
    outputValidator: null,
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 300,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  } as const;
}

export function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  const prefix = fixtureOrdinal.toString(16).padStart(8, "0");
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    return `${prefix}-0000-4000-8000-${sequence
      .toString()
      .padStart(12, "0")}`;
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  ));
  return encodeBytesToLowercaseHex(digest);
}
