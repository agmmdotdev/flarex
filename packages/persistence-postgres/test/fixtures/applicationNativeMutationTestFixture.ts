import { webcrypto } from "node:crypto";

import { and, eq } from "drizzle-orm";
import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
  type ApplicationManifestSourceArtifactV1Input,
} from "@flarex/analysis/application-analysis";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import { Effect, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  canonicalizeApplicationRuntimeColdReceiptV1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
  type CanonicalApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";

import {
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
  createAppSchemaCandidateWriteGuardPort,
  advanceAppSchemaCandidateValidationEffect,
  installAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../../src/appSchemaCandidateValidation";
import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../../src/appUniqueConstraintCommitV1";
import {
  createAppUniqueConstraintSetEligibilityPortV1,
} from "../../src/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../../src/appUniqueConstraintSetClosureV1";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
  type ApplicationAnalysisProjection,
  type ApplicationAnalysisRepository,
} from "../../src/applicationAnalysisRegistration";
import {
  makeApplicationActivationRepository,
  type CoherentActiveApplication,
} from "../../src/applicationActivation";
import {
  makeApplicationPublicationRepository,
  type ApplicationPublication,
} from "../../src/applicationPublication";
import {
  createApplicationManagedSchemaPlanningPort,
  type ApplicationManagedSchemaPlanningPort,
} from "../../src/applicationManagedSchemaPlanning";
import {
  createApplicationManagedSchemaApplicationPort,
  type ApplicationManagedSchemaApplicationPort,
} from "../../src/applicationManagedSchemaApplication";
import { makeApplicationReadinessRepository } from "../../src/applicationReadiness";
import {
  makeApplicationSchemaAuthorityPublisher,
  type ApplicationSchemaAuthority,
} from "../../src/applicationSchemaAuthority";
import {
  createApplicationTaskCatalogSnapshotPort,
  makeApplicationTaskBindingRepository,
} from "../../src/applicationTaskBindings";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../../src/appRows";
import {
  createAppDeveloperIndexDefinitionPortV1,
} from "../../src/appDeveloperIndexCommitV1";
import {
  locateAppIndexDefinitionByIdEffect,
} from "../../src/appIndexDefinitions";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../../src/indexBuildReconciliation";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
  createIntrinsicCreationTimeIndexDefinitionPortV1,
} from "../../src/intrinsicCreationTimeIndexBuildV1";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedScopeAuthorizationEpochTarget,
  createPGliteLocatedSplitScopeClockTarget,
  createPGlitePersistence,
  createPGliteSplitScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../../src/pglite";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedScopeAuthorizationEpochTarget,
  createPostgresLocatedSplitScopeClockTarget,
  createPostgresSplitScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../../src/postgres";
import type { FlarexMetadataDatabase } from "../../src/deployments";
import type { FlarexPersistence } from "../../src/index";
import type { LocatedScopeClockReader } from
  "../../src/scopeAuthorityResolution";
import { createPointCommitPublisherPortV1 } from "../../src/pointCommitTransaction";
import { createPhysicalDefinitionLifecyclePort } from
  "../../src/physicalDefinitionLifecycle";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "../../src/transactionSessionAttemptKernel";
import {
  fxSystemApplicationPublicationsV1,
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "../../src/schema";
import { getScopeAuthorityProvisioningReceipt } from
  "../../src/scopeAuthorityProvisioningReceipt";
import { createAppDeveloperIndexQueryPortV1 } from "../../src/sessionJournalStore";
import type {
  ScopePhysicalLocator,
  SplitScopePhysicalLocator,
} from "../../src/scopeMetadataTypes";

export interface ApplicationNativeMutationAnalysis {
  readonly source: ApplicationNativeMutationSourceBundle;
  readonly run: (input: Readonly<{
    readonly authority: ApplicationAnalysisAuthority;
    readonly repository: ApplicationAnalysisRepository;
    readonly requestKey: string;
    readonly sourceArtifactRootSha256: string;
  }>) => Promise<ApplicationAnalysisProjection>;
}

export interface ApplicationNativeMutationFixtureOptions {
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly includeTask?: boolean;
  readonly taskMaximumDurationInSeconds?: number;
  readonly taskRetryMinimumTimeoutInMs?: number;
  readonly analysis?: Readonly<ApplicationNativeMutationAnalysis>;
}

export interface ApplicationNativeMutationSourceBundle {
  readonly sourceArtifact: ApplicationManifestSourceArtifactV1Input;
  readonly modules: ReadonlyArray<Readonly<{
    readonly path: string;
    readonly roles: number;
    readonly sourceSha256: string;
    readonly sourceByteLength: number;
    readonly source: string;
  }>>;
}

export type ApplicationNativeMutationPersistence = FlarexPersistence & Readonly<{
  drizzle: FlarexMetadataDatabase;
}>;

export interface ApplicationNativeMutationRegisteredRevision {
  readonly source: ApplicationNativeMutationSourceBundle;
  readonly manifest: ApplicationManifestV1;
  readonly publication: ApplicationPublication;
}

export interface ApplicationNativeMutationFixture<
  Persistence extends ApplicationNativeMutationPersistence,
> {
  readonly control: Persistence;
  readonly target: Persistence;
  readonly deploymentId: string;
  readonly authority: ApplicationAnalysisAuthority;
  readonly authorityPorts: ReturnType<typeof fixtureAuthorityPorts>;
  readonly readiness: ReturnType<typeof makeApplicationReadinessRepository>;
  readonly activation: ReturnType<typeof makeApplicationActivationRepository>;
  readonly active: CoherentActiveApplication;
  readonly source: ApplicationNativeMutationSourceBundle;
  readonly schema: ReturnType<typeof makeApplicationSchemaAuthorityPublisher>;
  readonly schemaAuthority: ApplicationSchemaAuthority;
  readonly managedSchemaPlanning: ApplicationManagedSchemaPlanningPort;
  readonly managedSchemaApplication: ApplicationManagedSchemaApplicationPort;
  readonly candidateValidation: ReturnType<
    typeof createAppSchemaCandidateValidationPort
  >;
  readonly uniqueConstraintEligibility: ReturnType<
    typeof createAppUniqueConstraintSetEligibilityPortV1
  >;
  readonly candidateSchemaWriteGuard: ReturnType<
    typeof createAppSchemaCandidateWriteGuardPort
  >;
  readonly registerRevision: (input: Readonly<{
    readonly requestKey: string;
    readonly analysis: ApplicationNativeMutationAnalysis;
  }>) => Promise<ApplicationNativeMutationRegisteredRevision>;
  readonly preparePublishedSchema: (
    manifest: ApplicationManifestV1,
  ) => Promise<ApplicationSchemaAuthority>;
  readonly publishManagedSchemaCandidate: (
    manifest: ApplicationManifestV1,
  ) => Promise<ApplicationSchemaAuthority>;
  readonly sessionAuthority: Readonly<{
    readonly scopeMetadata: Persistence;
    readonly provisioningReceipts: ReturnType<typeof fixtureProvisioningReceipts>;
    readonly scopeSessionTargets: Readonly<{
      readonly resolve: (locator: ScopePhysicalLocator) =>
        Promise<LocatedScopeClockReader>;
    }>;
    readonly applicationControlDb: FlarexMetadataDatabase;
  }>;
  readonly currentEpochAuthority: Readonly<{
    readonly scopeMetadata: Persistence;
    readonly provisioningReceipts: ReturnType<typeof fixtureProvisioningReceipts>;
    readonly scopeEpochTargets: Readonly<{
      readonly resolve: (locator: ScopePhysicalLocator) =>
        Promise<LocatedScopeClockReader>;
    }>;
  }>;
  readonly intrinsicCreationTimeIndexes: ReturnType<
    typeof createIntrinsicCreationTimeIndexDefinitionPortV1
  >;
  readonly developerIndexes: ReturnType<
    typeof createAppDeveloperIndexDefinitionPortV1
  >;
  readonly indexedQueries: ReturnType<typeof createAppDeveloperIndexQueryPortV1>;
  readonly seedUserDocument: (name: string) => Promise<Readonly<{
    readonly documentId: string;
    readonly name: string;
  }>>;
  readonly moveHead: () => Promise<CoherentActiveApplication>;
  /** Persistence-owned corruption seam for fail-closed system-test proof. */
  readonly corruptCandidateValidationFrameBytesForTest: () => Promise<void>;
  /** Persistence-owned corruption seam for publication revalidation proof. */
  readonly corruptApplicationPublicationSchemaSha256ForTest: (
    publication: ApplicationPublication,
  ) => Promise<() => Promise<void>>;
}

export type ApplicationNativeMutationPGliteFixture =
  ApplicationNativeMutationFixture<PGliteFlarexPersistence>;

export type ApplicationNativeMutationPostgresFixture =
  ApplicationNativeMutationFixture<PostgresFlarexPersistence>;

interface ApplicationNativeMutationFixtureLane<
  Persistence extends ApplicationNativeMutationPersistence,
> {
  readonly control: Persistence;
  readonly target: Persistence;
  readonly provision: (
    options: Parameters<typeof createPGliteSplitScopeAuthorityProvisioner>[1],
  ) => ReturnType<typeof createPGliteSplitScopeAuthorityProvisioner>;
  readonly locateClock: (
    locator: SplitScopePhysicalLocator,
  ) => ReturnType<typeof createPGliteLocatedSplitScopeClockTarget>;
  readonly locateSession: (locator: ScopePhysicalLocator) =>
    LocatedScopeClockReader;
  readonly locateEpoch: (locator: ScopePhysicalLocator) =>
    LocatedScopeClockReader;
}

const LOCATOR = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "application_native_mutation_target",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;

const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

export async function createApplicationNativeMutationPGliteFixture(
  options: ApplicationNativeMutationFixtureOptions,
): Promise<ApplicationNativeMutationPGliteFixture> {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  const [control, target] = await Promise.all([
    createPGlitePersistence(),
    createPGlitePersistence(),
  ]);
  await Promise.all([control.migrate(), target.migrate()]);
  return createApplicationNativeMutationFixture(options, {
    control,
    target,
    provision: options =>
      createPGliteSplitScopeAuthorityProvisioner(control, options),
    locateClock: locator =>
      createPGliteLocatedSplitScopeClockTarget(target, locator),
    locateSession: locator =>
      createPGliteLocatedPointMutationSessionActivationTargetV1(target, locator),
    locateEpoch: locator =>
      createPGliteLocatedScopeAuthorizationEpochTarget(target, locator),
  });
}

export function createApplicationNativeMutationPostgresFixture(
  options: ApplicationNativeMutationFixtureOptions,
  persistence: Readonly<{
    readonly control: PostgresFlarexPersistence;
    readonly target: PostgresFlarexPersistence;
  }>,
): Promise<ApplicationNativeMutationPostgresFixture> {
  return createApplicationNativeMutationFixture(options, {
    ...persistence,
    provision: options =>
      createPostgresSplitScopeAuthorityProvisioner(
        persistence.control,
        options,
      ),
    locateClock: locator =>
      createPostgresLocatedSplitScopeClockTarget(persistence.target, locator),
    locateSession: locator =>
      createPostgresLocatedPointMutationSessionActivationTargetV1(
        persistence.target,
        locator,
      ),
    locateEpoch: locator =>
      createPostgresLocatedScopeAuthorizationEpochTarget(
        persistence.target,
        locator,
      ),
  });
}

async function createApplicationNativeMutationFixture<
  Persistence extends ApplicationNativeMutationPersistence,
>(
  options: ApplicationNativeMutationFixtureOptions,
  lane: ApplicationNativeMutationFixtureLane<Persistence>,
): Promise<ApplicationNativeMutationFixture<Persistence>> {
  const { control, target } = lane;
  const deploymentId = "deployment_application_native_mutation";
  const provisioned = await lane.provision({
      placementPlanner: { plan: () => LOCATOR },
      targetResolver: {
        resolve: async locator =>
          lane.locateClock(locator),
      },
      randomUuid: uuidSequence(1, 2),
    },
  ).ensure({
    deploymentId,
    projectId: "project_application_native_mutation",
  });
  await target.query(
    `insert into deployments (deployment_id, project_id)
     values ($1, $2)`,
    [deploymentId, "project_application_native_mutation"],
  );
  await target.query(
    `update fx_system_scope_clock
        set storage_generation = 'flarexdb_v1'
      where scope_id = $1`,
    [provisioned.scope.scopeId],
  );
  const clock = await target.getScopeClock(provisioned.scope.scopeId);
  if (clock === null || clock.storageGeneration !== "flarexdb_v1") {
    throw new Error("Application-native mutation scope clock is invalid.");
  }
  const authority: ApplicationAnalysisAuthority = Object.freeze({
    scopeId: clock.scopeId,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
  });
  const source = options.analysis?.source ?? await mutationSourceBundle();
  const fixtureManifest = {
      format: "flarex.application-manifest",
      version: 1,
      sourceArtifact: source.sourceArtifact,
      schema: {
        version: 1,
        tables: [{
          tableId: 1,
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
      },
      functions: [{
        path: "users:create",
        moduleName: "users",
        exportName: "create",
        kind: "mutation",
        visibility: "public",
        args: { type: "any" },
        returns: null,
        partition: null,
      }, {
        path: "users:get",
        moduleName: "users",
        exportName: "get",
        kind: "query",
        visibility: "public",
        args: { type: "any" },
        returns: { type: "any" },
        partition: null,
      }, {
        path: "users:notify",
        moduleName: "users",
        exportName: "notify",
        kind: "action",
        visibility: "public",
        args: { type: "any" },
        returns: { type: "any" },
        partition: null,
      }],
    } as const;
  const analyses = makeApplicationAnalysisRepository(target.drizzle, {
    randomUuid: uuidSequence(11, 12, 13),
  });
  const requestKey = "request:application-native-mutation:analysis";
  const analyzed = options.analysis === undefined
    ? await settleFixtureAnalysis(
        analyses,
        authority,
        requestKey,
        source.sourceArtifact.rootSha256,
        Result.getOrThrow(canonicalizeApplicationManifestV1(fixtureManifest))
          .canonicalText,
      )
    : await options.analysis.run({
        authority,
        repository: analyses,
        requestKey,
        sourceArtifactRootSha256: source.sourceArtifact.rootSha256,
      });
  if (analyzed.status !== "analyzed") {
    throw new Error("Application-native mutation analysis did not settle.");
  }
  const canonicalManifest = Result.getOrThrow(
    canonicalizeApplicationManifestV1(analyzed.manifest),
  );
  const publication = await Effect.runPromise(
    makeApplicationPublicationRepository(target.drizzle).publish({
      authority,
      revisionId: analyzed.revision.revisionId,
      candidateId: analyzed.candidateId,
      analysisId: analyzed.analysisId,
      manifestSha256: analyzed.manifestSha256,
      manifest: analyzed.manifest,
    }),
  );
  await registerFixtureTaskBindings(target, authority, publication, options);

  const authorityPorts = fixtureAuthorityPorts(
    control,
    authority,
    lane.locateSession,
  );
  const sessionAuthority = Object.freeze({
    scopeMetadata: control,
    provisioningReceipts: authorityPorts.provisioningReceipts,
    scopeSessionTargets: authorityPorts.scopeClockTargets,
    applicationControlDb: control.drizzle,
  });
  const candidateValidation = createAppSchemaCandidateValidationPort({
    controlDb: control.drizzle,
    authority: authorityPorts,
  });
  const candidateSchemaWriteGuard = createAppSchemaCandidateWriteGuardPort({
    candidateValidation,
    pointCommitAuthority: sessionAuthority,
  });
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(
    control.drizzle,
  );
  const uniqueConstraintEligibility =
    createAppUniqueConstraintSetEligibilityPortV1({
      controlDb: control.drizzle,
      authority: authorityPorts,
    }, uniqueConstraints);
  const pointCommit = createPointCommitPublisherPortV1({
    scopeMetadata: control,
    provisioningReceipts: authorityPorts.provisioningReceipts,
    scopeSessionTargets: {
      resolve: async () => {
        throw new Error("Readiness must not open a mutation session.");
      },
    },
  }, { uniqueConstraints, uniqueConstraintEligibility });
  const schema = makeApplicationSchemaAuthorityPublisher({
    db: control.drizzle,
    runTransaction: run => control.drizzle.transaction(run),
  });
  const readiness = makeApplicationReadinessRepository(Object.freeze({
    controlDb: control.drizzle,
    authority: authorityPorts,
    schema,
    taskCatalog: createApplicationTaskCatalogSnapshotPort(),
    candidateValidation: createAppSchemaCandidateReadinessPort(
      candidateValidation,
    ),
    pointCommit,
    physicalDefinitionLifecycle: createPhysicalDefinitionLifecyclePort({
      controlDb: control.drizzle,
      authority: authorityPorts,
    }),
    cold: {
      runtimeHostIdentity: options.runtimeHostIdentity,
      compatibilityDate: options.compatibilityDate,
      materialize: (input: {
        readonly target: CanonicalApplicationRuntimeTargetV1["target"];
        readonly manifest: ApplicationManifestV1;
      }) => Effect.promise(async () => {
        const canonicalTarget = Result.getOrThrow(
          canonicalizeApplicationRuntimeTargetV1(input.target),
        );
        return Result.getOrThrow(canonicalizeApplicationRuntimeColdReceiptV1({
          format: "flarex.application-runtime-cold-receipt",
          version: 1,
          status: "resolved",
          runtimeHostIdentity: options.runtimeHostIdentity,
          compatibilityDate: options.compatibilityDate,
          sourceArtifactRootSha256: input.target.sourceArtifactRootSha256,
          manifestSha256: input.target.manifestSha256,
          publicationSha256: input.target.publicationSha256,
          runtimeTargetSha256: await sha256Hex(canonicalTarget.canonicalBytes),
          functionPath: input.target.function.path,
          functionKind: input.target.function.kind,
          visibility: input.target.function.visibility,
        }));
      }),
    },
  }));
  const publishManagedSchemaCandidate = async (
    manifest: ApplicationManifestV1,
  ): Promise<ApplicationSchemaAuthority> => {
    const published = await Effect.runPromise(schema.publish({
      deploymentId,
      manifest,
    }));
    const targetPublished = await Effect.runPromise(
      makeApplicationSchemaAuthorityPublisher({
        db: target.drizzle,
        runTransaction: run => target.drizzle.transaction(run),
      }).publish({ deploymentId, manifest }),
    );
    if (targetPublished.schemaVersionId !== published.schemaVersionId ||
      targetPublished.schemaManifestSha256 !== published.schemaManifestSha256) {
      throw new Error("Application-native schema authorities diverged.");
    }
    return published;
  };
  const preparePublishedSchema = async (
    manifest: ApplicationManifestV1,
  ): Promise<ApplicationSchemaAuthority> => {
    const published = await publishManagedSchemaCandidate(manifest);
    await closeEmptyUniqueConstraintSet(
      control,
      deploymentId,
      published.schemaVersionId,
    );
    await enablePhysicalBuilds(
      control,
      authorityPorts,
      authority.scopeId,
      deploymentId,
      published.schemaVersionId,
    );
    return published;
  };
  const notReady = await Effect.runPromise(readiness.settle({
    deploymentId,
    revisionId: publication.revisionId,
  }));
  if (notReady.status !== "not_ready" ||
    notReady.reason !== "candidateValidationMissing") {
    throw new Error("Application-native readiness skipped candidate validation.");
  }
  // The located journal resolves the pinned schema catalog locally. Exercise
  // the existing schema publisher as the test topology's distribution owner;
  // do not copy control rows or add a journal fallback.
  const schemaAuthority = await preparePublishedSchema(
    canonicalManifest.manifest,
  );
  const schemaVersionId = schemaAuthority.schemaVersionId;
  await settleCandidateValidation(
    candidateValidation,
    deploymentId,
    schemaVersionId,
  );
  const ready = await Effect.runPromise(readiness.settle({
    deploymentId,
    revisionId: publication.revisionId,
  }));
  if (ready.status !== "ready") {
    throw new Error("Application-native mutation readiness did not settle.");
  }
  const activation = makeApplicationActivationRepository({
    deploymentId,
    readiness,
    authority: authorityPorts,
  });
  const activated = await Effect.runPromise(activation.activate({
    revisionId: publication.revisionId,
    expectedActiveHead: null,
  }));
  if (activated.status !== "activated") {
    throw new Error("Application-native mutation did not activate.");
  }
  const active = await Effect.runPromise(activation.readActive());
  let headMoveSequence = 0;
  let currentActive = active;
  let registrationSequence = 0;
  const registerRevision = async (input: Readonly<{
    readonly requestKey: string;
    readonly analysis: ApplicationNativeMutationAnalysis;
  }>): Promise<ApplicationNativeMutationRegisteredRevision> => {
    registrationSequence += 1;
    const sequence = registrationSequence;
    const repository = makeApplicationAnalysisRepository(target.drizzle, {
      randomUuid: uuidSequence(
        100 + sequence * 3 + 1,
        100 + sequence * 3 + 2,
        100 + sequence * 3 + 3,
      ),
    });
    const projected = await input.analysis.run({
      authority,
      repository,
      requestKey: input.requestKey,
      sourceArtifactRootSha256:
        input.analysis.source.sourceArtifact.rootSha256,
    });
    if (projected.status !== "analyzed") {
      throw new Error("Application-native registered analysis did not settle.");
    }
    const registeredManifest = Result.getOrThrow(
      canonicalizeApplicationManifestV1(projected.manifest),
    ).manifest;
    const registeredPublication = await Effect.runPromise(
      makeApplicationPublicationRepository(target.drizzle).publish({
        authority,
        revisionId: projected.revision.revisionId,
        candidateId: projected.candidateId,
        analysisId: projected.analysisId,
        manifestSha256: projected.manifestSha256,
        manifest: projected.manifest,
      }),
    );
    await registerFixtureTaskBindings(
      target,
      authority,
      registeredPublication,
      options,
    );
    return Object.freeze({
      source: input.analysis.source,
      manifest: registeredManifest,
      publication: registeredPublication,
    });
  };
  const moveHead = async (): Promise<CoherentActiveApplication> => {
    headMoveSequence += 1;
    const sequence = headMoveSequence;
    const nextAnalyses = makeApplicationAnalysisRepository(target.drizzle, {
      randomUuid: uuidSequence(
        30 + sequence * 3 + 1,
        30 + sequence * 3 + 2,
        30 + sequence * 3 + 3,
      ),
    });
    const nextPending = await Effect.runPromise(nextAnalyses.begin({
      authority,
      requestKey: `request:application-native-mutation:analysis:next:${sequence}`,
      sourceArtifactRootSha256: source.sourceArtifact.rootSha256,
      analyzerIdentity: "application-analyzer",
      analyzerPolicyIdentity: "application-analyzer-policy",
    }));
    const nextAnalysis = await Effect.runPromise(nextAnalyses.settle(authority, {
      kind: "analyzed",
      candidateId: nextPending.candidateId,
      sourceArtifactRootSha256: source.sourceArtifact.rootSha256,
      analyzerIdentity: "application-analyzer",
      analyzerPolicyIdentity: "application-analyzer-policy",
      canonicalManifest: canonicalManifest.canonicalText,
    }));
    if (nextAnalysis.status !== "analyzed") {
      throw new Error("Application-native next analysis did not settle.");
    }
    const nextPublication = await Effect.runPromise(
      makeApplicationPublicationRepository(target.drizzle).publish({
        authority,
        revisionId: nextAnalysis.revision.revisionId,
        candidateId: nextAnalysis.candidateId,
        analysisId: nextAnalysis.analysisId,
        manifestSha256: nextAnalysis.manifestSha256,
        manifest: nextAnalysis.manifest,
      }),
    );
    const nextCatalog = await Effect.runPromise(hashCanonicalTaskCatalogV1({
      version: 1,
      tasks: options.includeTask === true
        ? [applicationTaskManifest(options)]
        : [],
    }, taskSha256));
    const nextBindings = await Effect.runPromise(produceApplicationTaskBindingsV1({
      definition: options.includeTask === true
        ? taskPreparedDefinition()
        : emptyPreparedDefinition(),
      catalog: nextCatalog,
      authority: {
        scopeId: nextPublication.scopeId,
        revisionId: nextPublication.revisionId,
        candidateId: nextPublication.candidateId,
        analysisId: nextPublication.analysisId,
        sourceArtifactRootSha256: nextPublication.sourceArtifactRootSha256,
        publicationSha256: nextPublication.publicationSha256,
      },
      runtimePolicy: {
        runtimeHostIdentity: options.runtimeHostIdentity,
        compatibilityDate: options.compatibilityDate,
      },
    }, taskSha256));
    await Effect.runPromise(
      makeApplicationTaskBindingRepository(target.drizzle).register({
        authority,
        bindings: nextBindings,
      }),
    );
    const nextReady = await Effect.runPromise(readiness.settle({
      deploymentId,
      revisionId: nextPublication.revisionId,
    }));
    if (nextReady.status !== "ready") {
      throw new Error("Application-native next revision is not ready.");
    }
    await Effect.runPromise(activation.activate({
      revisionId: nextPublication.revisionId,
      expectedActiveHead: currentActive.expectedActiveHead,
    }));
    currentActive = await Effect.runPromise(activation.readActive());
    return currentActive;
  };
  const currentEpochAuthority = Object.freeze({
    scopeMetadata: control,
    provisioningReceipts: authorityPorts.provisioningReceipts,
    scopeEpochTargets: Object.freeze({
      resolve: async (locator: ScopePhysicalLocator) =>
        lane.locateEpoch(locator),
    }),
  });
  const managedSchemaPlanning = createApplicationManagedSchemaPlanningPort({
    deploymentId,
    controlDb: control.drizzle,
    activation,
    schema,
    authority: authorityPorts,
  });
  const managedSchemaApplication = createApplicationManagedSchemaApplicationPort({
    deploymentId,
    controlDb: control.drizzle,
    targetDb: target.drizzle,
    authority: authorityPorts,
    activation,
    candidateValidation,
    uniqueConstraintEligibility,
    planning: managedSchemaPlanning,
  });
  const developerIndexes = createAppDeveloperIndexDefinitionPortV1(
    control.drizzle,
  );
  const seedUserDocument = async (name: string) => {
    const tableRows = await control.query<{ table_id: number }>(
      `select table_id
         from fx_control_table
        where deployment_id = $1
          and namespace = 'app'
          and logical_name = 'users'
        limit 1`,
      [deploymentId],
    );
    const tableIdValue = tableRows.rows[0]?.table_id;
    if (tableIdValue === undefined) {
      throw new Error("Application-native users table is missing.");
    }
    const tableId = decodeCatalogTableId(tableIdValue);
    const rowId = decodeAppRowIdHexV1("00000000000000000000000000000001");
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    const clock = await target.getScopeClock(authority.scopeId);
    if (clock === null) {
      throw new Error("Application-native scope clock is missing.");
    }
    const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
    const canonicalDocument = await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime: decodeAppCreationTimeV1(1),
      fields: { name },
    });
    const scopeUuid = projectScopeIdUuidV1(authority.scopeId).scopeUuid;
    const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
    await target.drizzle.transaction(async tx => {
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: authority.scopeId,
        tableId,
        rowId,
        writeEpoch: clock.epoch,
        commitSeq,
        prevCommitSeq: null,
        schemaVersionId,
        creationTime: decodeAppCreationTimeV1(1),
        value: {
          codecVersion: canonicalDocument.codecVersion,
          valueJson: canonicalDocument.valueJson,
          canonicalBytes: canonicalDocument.canonicalBytes,
          sha256: canonicalDocument.sha256,
        },
      });
      await tx.insert(fxSystemCommits).values({
        scopeUuid,
        epochUuid,
        commitSeq,
        changeCount: 1,
      });
      await tx.insert(fxSystemCommitAppRowChanges).values({
        scopeUuid,
        epochUuid,
        commitSeq,
        changeOrdinal: 0,
        tableId,
        rowId: appRowIdHexV1ToBytes(rowId),
      });
      await tx.update(fxSystemScopeClocks)
        .set({ lastCommitSeq: commitSeq })
        .where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid));
    });
    return Object.freeze({ documentId, name });
  };
  const corruptCandidateValidationFrameBytesForTest = async () => {
    await target.query(
      `update fx_system_app_schema_candidate_validation
          set frame_bytes = set_byte(
            frame_bytes,
            0,
            (get_byte(frame_bytes, 0) + 1) % 256
          )
        where scope_id = $1`,
      [authority.scopeId],
    );
  };
  const corruptApplicationPublicationSchemaSha256ForTest = async (
    publication: ApplicationPublication,
  ) => {
    const rows = await target.drizzle.select({
      schemaSha256: fxSystemApplicationPublicationsV1.schemaSha256,
    }).from(fxSystemApplicationPublicationsV1).where(and(
      eq(fxSystemApplicationPublicationsV1.scopeId, publication.scopeId),
      eq(fxSystemApplicationPublicationsV1.revisionId, publication.revisionId),
    )).limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("Application publication corruption target is missing.");
    }
    const original = new Uint8Array(row.schemaSha256);
    await target.drizzle.update(fxSystemApplicationPublicationsV1).set({
      schemaSha256: new Uint8Array(32),
    }).where(and(
      eq(fxSystemApplicationPublicationsV1.scopeId, publication.scopeId),
      eq(fxSystemApplicationPublicationsV1.revisionId, publication.revisionId),
    ));
    return async () => {
      await target.drizzle.update(fxSystemApplicationPublicationsV1).set({
        schemaSha256: original,
      }).where(and(
        eq(fxSystemApplicationPublicationsV1.scopeId, publication.scopeId),
        eq(fxSystemApplicationPublicationsV1.revisionId, publication.revisionId),
      ));
    };
  };
  return Object.freeze({
    control,
    target,
    deploymentId,
    authority,
    authorityPorts,
    readiness,
    activation,
    active,
    source,
    schema,
    schemaAuthority,
    managedSchemaPlanning,
    managedSchemaApplication,
    candidateValidation,
    uniqueConstraintEligibility,
    candidateSchemaWriteGuard,
    registerRevision,
    preparePublishedSchema,
    publishManagedSchemaCandidate,
    sessionAuthority,
    currentEpochAuthority,
    intrinsicCreationTimeIndexes:
      createIntrinsicCreationTimeIndexDefinitionPortV1(control.drizzle),
    developerIndexes,
    indexedQueries: createAppDeveloperIndexQueryPortV1(
      control.drizzle,
      sessionAuthority,
      developerIndexes,
    ),
    seedUserDocument,
    moveHead,
    corruptCandidateValidationFrameBytesForTest,
    corruptApplicationPublicationSchemaSha256ForTest,
  });
}

function fixtureProvisioningReceipts(
  control: ApplicationNativeMutationPersistence,
) {
  return Object.freeze({
    getScopeAuthorityProvisioningReceipt: (scopeId: ApplicationAnalysisAuthority["scopeId"]) =>
      getScopeAuthorityProvisioningReceipt(control.drizzle, scopeId),
  });
}

function fixtureAuthorityPorts(
  control: ApplicationNativeMutationPersistence,
  authority: ApplicationAnalysisAuthority,
  locateSession: (locator: ScopePhysicalLocator) => LocatedScopeClockReader,
) {
  return Object.freeze({
    scopeMetadata: control,
    provisioningReceipts: fixtureProvisioningReceipts(control),
    scopeClockTargets: Object.freeze({
      resolve: async (locator: ScopePhysicalLocator) => {
        const target = locateSession(locator);
        if (!isLocatedReadCommittedAttemptTargetV1(target)) {
          throw new Error(
            "Application-native session target lacks read-committed authority.",
          );
        }
        return target;
      },
    }),
    authority,
  });
}

async function enablePhysicalBuilds(
  control: ApplicationNativeMutationPersistence,
  authority: ReturnType<typeof fixtureAuthorityPorts>,
  scopeId: ApplicationAnalysisAuthority["scopeId"],
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const ports = Object.freeze({ controlDb: control.drizzle, authority });
  await Effect.runPromise(reconcilePublishedIndexBuildsV1Effect(ports, {
    deploymentId,
    schemaVersionId,
  }));
  const requirements = await Effect.runPromise(
    loadPublishedPhysicalRequirementSnapshotV1(control.drizzle, {
      deploymentId,
      schemaVersionId,
    }),
  );
  if (requirements === null || requirements.definitions.length === 0) {
    throw new Error("Application-native physical requirements are missing.");
  }
  for (const definition of requirements.definitions) {
    const located = await Effect.runPromise(locateAppIndexDefinitionByIdEffect(
      control.drizzle,
      scopeId,
      definition.indexDefinitionId,
    ));
    if (located === null) throw new Error("Application-native index is missing.");
    for (let step = 0; step < 16; step += 1) {
      const input = {
        deploymentId,
        indexDefinitionId: definition.indexDefinitionId,
        pageSize: 16,
      } as const;
      const built = located.access.kind === "developer"
        ? await Effect.runPromise(buildAppDeveloperOrderedIndexV1Effect(
            ports,
            input,
          ))
        : await Effect.runPromise(buildIntrinsicCreationTimeIndexV1Effect(
            ports,
            input,
          ));
      if (built.lifecycle === "enabled") break;
      if (step === 15) throw new Error("Application-native index did not enable.");
    }
  }
}

async function closeEmptyUniqueConstraintSet(
  control: ApplicationNativeMutationPersistence,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const prepared = await Effect.runPromise(
    prepareAppUniqueConstraintSetClosureV1Effect(control.drizzle, {
      deploymentId,
      schemaVersionId,
    }),
  );
  await control.drizzle.transaction(tx => Effect.runPromise(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
  ));
}

async function settleCandidateValidation(
  candidateValidation: ReturnType<
    typeof createAppSchemaCandidateValidationPort
  >,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const input = { deploymentId, schemaVersionId } as const;
  await Effect.runPromise(installAppSchemaCandidateValidationEffect(
    candidateValidation,
    input,
  ));
  for (let step = 0; step < 64; step += 1) {
    const advanced = await Effect.runPromise(
      advanceAppSchemaCandidateValidationEffect(candidateValidation, input),
    );
    if (advanced.disposition !== "readyToSettle") continue;
    await Effect.runPromise(settleAppSchemaCandidateValidationEffect(
      candidateValidation,
      input,
    ));
    return;
  }
  throw new Error("Application-native candidate validation did not settle.");
}

async function settleFixtureAnalysis(
  repository: ApplicationAnalysisRepository,
  authority: ApplicationAnalysisAuthority,
  requestKey: string,
  sourceArtifactRootSha256: string,
  canonicalManifest: string,
): Promise<ApplicationAnalysisProjection> {
  const pending = await Effect.runPromise(repository.begin({
    authority,
    requestKey,
    sourceArtifactRootSha256,
    analyzerIdentity: "application-analyzer",
    analyzerPolicyIdentity: "application-analyzer-policy",
  }));
  return Effect.runPromise(repository.settle(authority, {
    kind: "analyzed",
    candidateId: pending.candidateId,
    sourceArtifactRootSha256,
    analyzerIdentity: "application-analyzer",
    analyzerPolicyIdentity: "application-analyzer-policy",
    canonicalManifest,
  }));
}

async function registerFixtureTaskBindings(
  target: ApplicationNativeMutationPersistence,
  authority: ApplicationAnalysisAuthority,
  publication: ApplicationPublication,
  options: ApplicationNativeMutationFixtureOptions,
): Promise<void> {
  const catalog = await Effect.runPromise(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: options.includeTask === true
      ? [applicationTaskManifest(options)]
      : [],
  }, taskSha256));
  const bindings = await Effect.runPromise(produceApplicationTaskBindingsV1({
    definition: options.includeTask === true
      ? taskPreparedDefinition()
      : emptyPreparedDefinition(),
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
      runtimeHostIdentity: options.runtimeHostIdentity,
      compatibilityDate: options.compatibilityDate,
    },
  }, taskSha256));
  await Effect.runPromise(
    makeApplicationTaskBindingRepository(target.drizzle).register({
      authority,
      bindings,
    }),
  );
}

async function mutationSourceBundle(): Promise<ApplicationNativeMutationSourceBundle> {
  const execution = [
    'import { query } from "flarex/server";',
    'import { mutation } from "flarex/server";',
    'import { action } from "flarex/server";',
    'import * as users from "../functions/users.js";',
    "export default { users: {",
    "  get: query({ handler: users.get }),",
    "  create: mutation({ handler: users.create }),",
    "  notify: action({ handler: users.notify }),",
    "} };",
    "",
  ].join("\n");
  const handler = [
    "export async function get(ctx, args) {",
    "  return await ctx.db.get(args.id);",
    "}",
    "export async function create(ctx, args) {",
    "  return await ctx.db.insert(\"users\", { name: args.name });",
    "}",
    "export async function notify(_ctx, args) {",
    "  return { delivered: args.message };",
    "}",
    "export async function task(ctx, payload) {",
    "  if (payload?.__fixtureTaskQuery === true) {",
    "    return await ctx.runQuery('users:get', { id: payload.id });",
    "  }",
    "  if (payload?.__fixtureTaskMutation === true) {",
    "    return await ctx.runMutation('users:create', { name: payload.name });",
    "  }",
    "  if (payload?.__fixtureTaskFailure === true) {",
    "    throw new Error('fixture task failure');",
    "  }",
    "  if (payload?.__fixtureTaskWaitForInterruption === true) {",
    "    return await new Promise(() => {});",
    "  }",
    "  return { accepted: payload };",
    "}",
    "",
  ].join("\n");
  const schema = "export default {};\n";
  const raw = [
    { path: "_flarex/application.js", roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION, source: execution },
    { path: "_flarex/schema.js", roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA, source: schema },
    { path: "functions/users.js", roles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION, source: handler },
  ] as const;
  const modules = Object.freeze(await Promise.all(raw.map(async module => {
    const bytes = new TextEncoder().encode(module.source);
    return Object.freeze({
      ...module,
      sourceSha256: await sha256Hex(bytes),
      sourceByteLength: bytes.byteLength,
    });
  })));
  const rootSha256 = await sha256Hex(new TextEncoder().encode(
    modules.map(module => `${module.path}:${module.sourceSha256}`).join("\n"),
  ));
  return Object.freeze({
    sourceArtifact: Object.freeze({
      rootSha256,
      executionModulePath: "_flarex/application.js",
      schemaModulePath: "_flarex/schema.js",
      modules: Object.freeze(modules.map(module => Object.freeze({
        path: module.path,
        roles: module.roles,
        sourceSha256: module.sourceSha256,
        sourceByteLength: module.sourceByteLength,
      }))),
    }),
    modules,
  });
}

function emptyPreparedDefinition() {
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
          exportName: "create",
          kind: "mutation",
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
          "export const create = () => null;\n",
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

function taskPreparedDefinition() {
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
          exportName: "create",
          kind: "mutation",
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
        path: "functions/users.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode([
          "export const create = () => null;",
          "export const task = async (ctx, payload) => {",
          "  if (payload?.__fixtureTaskQuery === true) {",
          "    return await ctx.runQuery('users:get', { id: payload.id });",
          "  }",
          "  if (payload?.__fixtureTaskMutation === true) {",
          "    return await ctx.runMutation('users:create', { name: payload.name });",
          "  }",
          "  if (payload?.__fixtureTaskFailure === true) {",
          "    throw new Error('fixture task failure');",
          "  }",
          "  if (payload?.__fixtureTaskWaitForInterruption === true) {",
          "    return await new Promise(() => {});",
          "  }",
          "  return { accepted: payload };",
          "};",
          "",
        ].join("\n")),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "users",
        artifactModulePath: "functions/users.js",
      }],
      executionPath: "functions/users.js",
      schemaPath: null,
      authPath: null,
    },
  }));
}

function applicationTaskManifest(options: ApplicationNativeMutationFixtureOptions) {
  const maximumDurationInSeconds = options.taskMaximumDurationInSeconds ?? 30;
  const retryMinimumTimeoutInMs = options.taskRetryMinimumTimeoutInMs ?? 1_000;
  return Object.freeze({
    version: 1 as const,
    taskId: "tasks.users.task",
    handler: Object.freeze({
      logicalModulePath: "users",
      artifactModulePath: "functions/users.js",
      exportName: "task",
    }),
    payloadValidator: Object.freeze({ type: "any" as const }),
    outputValidator: Object.freeze({ type: "any" as const }),
    runAttemptPolicy: Object.freeze({
      version: 1 as const,
      retry: Object.freeze({
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: retryMinimumTimeoutInMs,
        maxTimeoutInMs: 60_000,
        randomize: true,
      }),
      outOfMemory: Object.freeze({ kind: "disabled" as const }),
    }),
    maximumDurationInSeconds,
    computeProfile: "standard-1x",
    queue: Object.freeze({ kind: "default" as const }),
  });
}

function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("Fixture UUID sequence exhausted.");
    index += 1;
    return `34000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  ));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
