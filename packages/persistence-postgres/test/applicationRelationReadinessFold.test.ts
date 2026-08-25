import {
  canonicalizeApplicationManifestV2,
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
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { describe, expect, it } from "vitest";

import {
  advanceAppSchemaCandidateValidationEffect,
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
  createLocatedAppSchemaCandidateValidationTarget,
  installAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../src/appSchemaCandidateValidation";
import { locateAppIndexDefinitionByIdEffect } from
  "../src/appIndexDefinitions";
import { createAppUniqueConstraintDefinitionPortV1 } from
  "../src/appUniqueConstraintCommitV1";
import { createAppUniqueConstraintSetEligibilityPortV1 } from
  "../src/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import {
  makeApplicationActivationRepository,
} from "../src/applicationActivation";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../src/applicationAnalysisRegistration";
import { makeApplicationReadinessRepository } from
  "../src/applicationReadiness";
import {
  type ApplicationRelationBindingPublication,
  publishApplicationRelationBindingEffect,
} from "../src/applicationRelationBinding";
import { createApplicationRelationBuildPort } from
  "../src/applicationRelationBuild";
import { createApplicationRelationCommitPort } from
  "../src/applicationRelationCommit";
import {
  makeApplicationRelationPublicationRepository,
} from "../src/applicationRelationPublication";
import {
  hasApplicationRelationReadinessFoldAuthority,
  makeApplicationRelationReadinessFoldRepository,
} from "../src/applicationRelationReadinessFold";
import { createApplicationRelationReadinessPort } from
  "../src/applicationRelationReadiness";
import {
  fxSystemApplicationFunctions,
  fxSystemApplicationPublications,
  fxSystemApplicationReadiness,
  fxSystemApplicationReadinessRelations,
  fxSystemApplicationRevisionSchemas,
  fxSystemApplicationTaskCatalogs,
  fxSystemApplicationTaskDefinitions,
} from "../src/applicationRelationSchema";
import { createApplicationRelationSchemaAuthorityPort } from
  "../src/applicationRelationSchemaAuthority";
import { createApplicationRelationServingInspector } from
  "../src/applicationRelationServing";
import {
  createApplicationRelationTaskCatalogSnapshotPort,
  makeApplicationRelationTaskBindingRepository,
} from "../src/applicationRelationTaskBindings";
import { makeApplicationSchemaAuthorityPublisher } from
  "../src/applicationSchemaAuthority";
import {
  createApplicationTaskCatalogSnapshotPort,
} from "../src/applicationTaskBindings";
import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../src/indexBuildReconciliation";
import { isRetryableSqlTransactionCause } from
  "../src/locatedReadCommittedEffect";
import { createPhysicalDefinitionLifecyclePort } from
  "../src/physicalDefinitionLifecycle";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedSplitScopeClockTarget,
  createPGlitePersistence,
  createPGliteSplitScopeAuthorityProvisioner,
} from "../src/pglite";
import { createPointCommitPublisherPortV1 } from
  "../src/pointCommitTransaction";
import { getScopeAuthorityProvisioningReceipt } from
  "../src/scopeAuthorityProvisioningReceipt";
import type { SplitScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  fxControlApplicationSchemaAuthoritiesV1,
  fxSystemApplicationActiveHeadsV1,
  fxSystemApplicationActivationsV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
  fxSystemEdgeDefinitionReadiness,
} from "../src/schema";
import type { StableTableCatalogTransaction } from
  "../src/stableTableCatalog";
import {
  ensureRelationBuildTestWebCrypto,
  relationBuildPublicationInput,
} from "./applicationRelationBuildTestSupport";
import { runEffect } from "./effectTestRuntime";

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

describe("Application relation readiness fold", { timeout: 60_000 }, () => {
  it("classifies PostgreSQL lock contention as retryable", () => {
    expect(isRetryableSqlTransactionCause({ code: "55P03" })).toBe(true);
    expect(isRetryableSqlTransactionCause({ code: "42P01" })).toBe(false);
  });

  it("atomically folds two ordered relations, exactly replays, and stays outside legacy activation", async () => {
    const fixture = await relationReadinessFixture();
    await prepareReadinessEvidence(fixture);

    const first = await runEffect(fixture.fold.settle(fixture.input));
    const replay = await runEffect(fixture.fold.settle(fixture.input));
    expect(first).toMatchObject({
      status: "ready",
      disposition: "inserted",
      relationCount: 2,
      schemaVersionId: fixture.relation.binding.schemaVersionId,
    });
    expect(replay).toMatchObject({
      status: "ready",
      disposition: "replayed",
      relationCount: 2,
    });
    if (first.status !== "ready" || replay.status !== "ready") {
      throw new Error("Expected relation-aware Application readiness.");
    }
    expect(replay.readinessSha256).toBe(first.readinessSha256);
    expect(replay.readinessBytes).toEqual(first.readinessBytes);
    expect(replay.relationSetReadinessSha256).toBe(
      first.relationSetReadinessSha256,
    );
    expect(replay.readyAt).toEqual(first.readyAt);
    expect(hasApplicationRelationReadinessFoldAuthority(
      fixture.fold,
      first,
    )).toBe(true);
    expect(hasApplicationRelationReadinessFoldAuthority(
      fixture.fold,
      Object.freeze({ ...first }),
    )).toBe(false);
    const callerBytes = first.readinessBytes;
    callerBytes[0] = callerBytes[0] === 0 ? 1 : 0;
    const callerReadyAt = first.readyAt;
    callerReadyAt.setTime(0);
    expect(hasApplicationRelationReadinessFoldAuthority(
      fixture.fold,
      first,
    )).toBe(true);
    expect(first.readinessBytes).toEqual(replay.readinessBytes);
    expect(first.readyAt).toEqual(replay.readyAt);
    const schemaAuthority = await runEffect(
      fixture.foldContext.schema.resolve({
        deploymentId: fixture.deploymentId,
        applicationManifestSha256: fixture.publication.manifestSha256,
        manifest: fixture.manifest,
      }),
    );
    const manifestTables = schemaAuthority.manifest.tableDefinitions.tables;
    const firstManifestTable = manifestTables[0];
    if (firstManifestTable === undefined) {
      throw new Error("Expected a relation-aware schema manifest table.");
    }
    expect(Object.isFrozen(schemaAuthority.manifest)).toBe(true);
    expect(Object.isFrozen(manifestTables)).toBe(true);
    expect(Object.isFrozen(firstManifestTable)).toBe(true);
    expect(Reflect.set(firstManifestTable, "testMutation", true)).toBe(false);
    expect(Reflect.has(firstManifestTable, "testMutation")).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(first.readinessBytes)))
      .toMatchObject({
        format: "flarex.application-readiness",
        version: 2,
        status: "ready",
        scopeId: fixture.authority.scopeId,
        deploymentId: fixture.deploymentId,
        revisionId: fixture.input.revisionId,
        manifestSha256: fixture.publication.manifestSha256,
        publicationSha256: fixture.publication.publicationSha256,
        applicationSchemaSha256:
          fixture.publication.applicationSchemaSha256,
        schemaVersionId: fixture.relation.binding.schemaVersionId,
        schemaManifestSha256:
          fixture.publication.schemaManifestSha256,
        manifestSchemaBindingSha256:
          fixture.publication.manifestSchemaBindingSha256,
        boundPublicationSha256:
          fixture.publication.boundPublicationSha256,
        relationSet: {
          version: 1,
          frontierCommitSeq: "0",
          relationCount: 2,
          readinessSha256: first.relationSetReadinessSha256,
        },
        coldReceipts: [],
      });

    const [roots, children, taskDefinitions] = await Promise.all([
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationReadiness,
      ),
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationReadinessRelations,
      ).orderBy(asc(fxSystemApplicationReadinessRelations.relationOrdinal)),
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationTaskDefinitions,
      ),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({
      readinessCodecVersion: 2,
      relationSetCodecVersion: 1,
      relationCount: 2,
      readinessBytes: first.readinessBytes,
    });
    expect(encodeBytesToLowercaseHex(
      roots[0]?.relationSetReadinessSha256 ?? new Uint8Array(),
    )).toBe(first.relationSetReadinessSha256);
    expect(children.map(child => child.relationOrdinal)).toEqual([1, 2]);
    expect(children.map(child => child.relationId)).toEqual(
      fixture.relation.binding.relationBindings.map(binding =>
        binding.relationId
      ),
    );
    expect(children.every(child =>
      child.readinessKind === "physical" &&
      child.physicalAttemptFence !== null &&
      child.semanticAttemptFence === null
    )).toBe(true);
    const firstChild = children[0];
    const secondChild = children[1];
    if (firstChild === undefined || secondChild === undefined) {
      throw new Error("Expected two persisted relation readiness children.");
    }
    await expect(fixture.persistence.drizzle.update(
      fxSystemApplicationReadinessRelations,
    ).set({
      relationReadinessSha256: secondChild.relationReadinessSha256,
    }).where(and(
      eq(fxSystemApplicationReadinessRelations.scopeId, firstChild.scopeId),
      eq(
        fxSystemApplicationReadinessRelations.revisionId,
        firstChild.revisionId,
      ),
      eq(
        fxSystemApplicationReadinessRelations.relationOrdinal,
        firstChild.relationOrdinal,
      ),
    ))).rejects.toThrow();
    expect(taskDefinitions).toHaveLength(1);
    expect(taskDefinitions[0]?.taskId).toBe("tasks.users.get");

    const activationResult = await runEffect(Effect.result(
      fixture.legacyActivation.activate({
        revisionId: fixture.input.revisionId,
        expectedActiveHead: null,
      }),
    ));
    expect(Result.isFailure(activationResult)).toBe(true);
    if (Result.isFailure(activationResult)) {
      expect(activationResult.failure).toMatchObject({
        _tag: "ApplicationReadinessError",
        operation: "settle",
        reason: "storedState",
      });
    }
    expect(fixture.legacyColdCalls()).toBe(0);
    const [legacySchemaAuthorities, legacyPublications, legacyTaskCatalogs,
      legacyTaskDefinitions, legacyReadiness, legacyActivations, legacyHeads] =
      await Promise.all([
        fixture.persistence.drizzle.select().from(
          fxControlApplicationSchemaAuthoritiesV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationPublicationsV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationTaskCatalogsV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationTaskDefinitionsV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationReadinessV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationActivationsV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationActiveHeadsV1,
        ),
      ]);
    expect(legacySchemaAuthorities).toHaveLength(0);
    expect(legacyPublications).toHaveLength(0);
    expect(legacyTaskCatalogs).toHaveLength(0);
    expect(legacyTaskDefinitions).toHaveLength(0);
    expect(legacyReadiness).toHaveLength(0);
    expect(legacyActivations).toHaveLength(0);
    expect(legacyHeads).toHaveLength(0);
  });

  it("exactly replays a two-export publication then fails closed at the unavailable runtime", async () => {
    const fixture = await relationReadinessFixture({ includeFunction: true });

    const result = await runEffect(fixture.fold.settle(fixture.input));

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "functionRuntimeUnavailable",
      revisionId: fixture.input.revisionId,
    });
    expect(await fixture.persistence.drizzle.select().from(
      fxSystemApplicationReadiness,
    )).toHaveLength(0);
    expect(await fixture.persistence.drizzle.select().from(
      fxSystemApplicationReadinessV1,
    )).toHaveLength(0);
    expect(fixture.legacyColdCalls()).toBe(0);
  });

  it("bounds overfull persisted function sets before rejecting replay and fold", async () => {
    const fixture = await relationReadinessFixture();
    const storedPublications = await fixture.persistence.drizzle.select().from(
      fxSystemApplicationPublications,
    );
    const storedPublication = storedPublications[0];
    if (storedPublication === undefined) {
      throw new Error("Expected a relation-aware Application publication.");
    }
    await fixture.persistence.drizzle.insert(
      fxSystemApplicationFunctions,
    ).values({
      scopeId: fixture.authority.scopeId,
      revisionId: fixture.publication.revisionId,
      functionCatalogSha256: storedPublication.functionCatalogSha256,
      functionPath: "rogue:query",
      moduleName: "rogue",
      exportName: "query",
      functionKind: "query",
      visibility: "internal",
      entrySha256: new Uint8Array(32).fill(1),
      entryBytes: new Uint8Array([1]),
    });

    const publicationReplay = await runEffect(Effect.result(
      fixture.publications.publish(fixture.publicationInput),
    ));
    expect(Result.isFailure(publicationReplay)).toBe(true);
    if (Result.isFailure(publicationReplay)) {
      expect(publicationReplay.failure).toMatchObject({
        reason: "conflictingReplay",
      });
    }
    const fold = await runEffect(Effect.result(
      fixture.fold.settle(fixture.input),
    ));
    expect(Result.isFailure(fold)).toBe(true);
    if (Result.isFailure(fold)) {
      expect(fold.failure).toMatchObject({ reason: "storedState" });
    }
  });

  it("bounds overfull persisted task sets before rejecting replay and fold", async () => {
    const fixture = await relationReadinessFixture();
    const catalogs = await fixture.persistence.drizzle.select().from(
      fxSystemApplicationTaskCatalogs,
    );
    const catalog = catalogs[0];
    if (catalog === undefined) {
      throw new Error("Expected a relation-aware Application task catalog.");
    }
    await fixture.persistence.drizzle.insert(
      fxSystemApplicationTaskDefinitions,
    ).values({
      scopeId: fixture.authority.scopeId,
      revisionId: fixture.publication.revisionId,
      taskCatalogBindingSha256: catalog.taskCatalogBindingSha256,
      taskDefinitionBindingSha256: new Uint8Array(32).fill(2),
      taskId: "tasks.rogue",
      canonicalTaskManifestSha256: new Uint8Array(32).fill(3),
      logicalModulePath: "tasks/rogue.ts",
      sourceModulePath: "_flarex/tasks/rogue.js",
      exportName: "run",
      manifestBytes: new Uint8Array([1]),
      bindingBytes: new Uint8Array([1]),
    });

    const taskReplay = await runEffect(Effect.result(
      fixture.taskBindings.register(fixture.taskBindingInput),
    ));
    expect(Result.isFailure(taskReplay)).toBe(true);
    if (Result.isFailure(taskReplay)) {
      expect(taskReplay.failure).toMatchObject({ reason: "conflictingReplay" });
    }
    const fold = await runEffect(Effect.result(
      fixture.fold.settle(fixture.input),
    ));
    expect(Result.isFailure(fold)).toBe(true);
    if (Result.isFailure(fold)) {
      expect(fold.failure).toMatchObject({ reason: "storedState" });
    }
  });

  it("rejects a relation-readiness port from a different authority composition", async () => {
    const fixture = await relationReadinessFixture();
    const foreignAuthority = Object.freeze({ ...fixture.authorityPorts });
    const foreignRelations = createApplicationRelationReadinessPort(
      fixture.persistence.drizzle,
      foreignAuthority,
      fixture.relationCommit,
      fixture.relationBuild,
    );
    const foreignFold = makeApplicationRelationReadinessFoldRepository({
      ...fixture.foldContext,
      relations: foreignRelations,
    });

    const result = await runEffect(Effect.result(
      foreignFold.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationRelationReadinessFoldError",
        reason: "invalidComposition",
      });
    }
  });

  it("rolls back schema, root, and children when ordered child insertion fails", async () => {
    const fixture = await relationReadinessFixture();
    await prepareReadinessEvidence(fixture);
    await fixture.persistence.query(
      `alter table fx_system_application_readiness_relation
        add constraint fx_test_reject_second_relation_child
        check (relation_ordinal <> 2)`,
      [],
    );

    const result = await runEffect(Effect.result(
      fixture.fold.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationRelationReadinessFoldError",
        reason: "resourceFailure",
      });
    }
    const [schemas, roots, children] = await Promise.all([
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationRevisionSchemas,
      ),
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationReadiness,
      ),
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationReadinessRelations,
      ),
    ]);
    expect(schemas).toHaveLength(0);
    expect(roots).toHaveLength(0);
    expect(children).toHaveLength(0);
  });

  it("persists, replays, and digest-binds a semantic-reuse child", async () => {
    const fixture = await relationReadinessFixture({ semanticReuse: true });
    await prepareReadinessEvidence(fixture);

    const first = await runEffect(fixture.fold.settle(fixture.input));
    const replay = await runEffect(fixture.fold.settle(fixture.input));

    expect(first).toMatchObject({
      status: "ready",
      disposition: "inserted",
      relationCount: 1,
    });
    expect(replay).toMatchObject({
      status: "ready",
      disposition: "replayed",
      relationCount: 1,
    });
    const children = await fixture.persistence.drizzle.select().from(
      fxSystemApplicationReadinessRelations,
    );
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      relationOrdinal: 1,
      readinessKind: "semantic",
      physicalAttemptFence: null,
    });
    expect(children[0]?.semanticAttemptFence).not.toBeNull();
    const physicalRows = await fixture.persistence.drizzle.select().from(
      fxSystemEdgeDefinitionReadiness,
    );
    const child = children[0];
    const physical = physicalRows[0];
    if (child === undefined || physical === undefined) {
      throw new Error("Expected semantic and physical readiness evidence.");
    }
    await expect(fixture.persistence.drizzle.update(
      fxSystemApplicationReadinessRelations,
    ).set({
      relationReadinessSha256: physical.readinessSha256,
    }).where(and(
      eq(fxSystemApplicationReadinessRelations.scopeId, child.scopeId),
      eq(fxSystemApplicationReadinessRelations.revisionId, child.revisionId),
      eq(
        fxSystemApplicationReadinessRelations.relationOrdinal,
        child.relationOrdinal,
      ),
    ))).rejects.toThrow();
  });
});

interface RelationReadinessFixtureOptions {
  readonly includeFunction?: boolean;
  readonly semanticReuse?: boolean;
}

async function relationReadinessFixture(
  options: RelationReadinessFixtureOptions = {},
) {
  ensureRelationBuildTestWebCrypto();
  fixtureOrdinal += 1;
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_application_relation_fold_${fixtureOrdinal}`,
  );
  const provisioned = await createPGliteSplitScopeAuthorityProvisioner(
    persistence,
    {
      placementPlanner: { plan: () => LOCATOR },
      targetResolver: {
        resolve: async locator =>
          createPGliteLocatedSplitScopeClockTarget(persistence, locator),
      },
      randomUuid: uuidSequence(1, 2),
    },
  ).ensure({
    deploymentId,
    projectId: `project_application_relation_fold_${fixtureOrdinal}`,
  });
  await persistence.query(
    `update fx_system_scope_clock
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
  const locatedTarget = createLocatedAppSchemaCandidateValidationTarget(
    persistence.drizzle,
    LOCATOR,
  );
  const authorityPorts = Object.freeze({
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: (scopeId: typeof authority.scopeId) =>
        getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId),
    },
    scopeClockTargets: { resolve: async () => locatedTarget },
  });
  const pointTarget = createPGliteLocatedPointMutationSessionActivationTargetV1(
    persistence,
    LOCATOR,
  );
  const relationCommit = createApplicationRelationCommitPort(
    persistence.drizzle,
    {
      scopeMetadata: persistence,
      provisioningReceipts: authorityPorts.provisioningReceipts,
      scopeSessionTargets: { resolve: async () => pointTarget },
    },
  );
  const relationBuild = createApplicationRelationBuildPort(
    persistence.drizzle,
    authorityPorts,
    relationCommit,
    createApplicationRelationServingInspector(),
  );
  const relations = createApplicationRelationReadinessPort(
    persistence.drizzle,
    authorityPorts,
    relationCommit,
    relationBuild,
  );
  let relationInput = await relationApplicationInput(
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
      relationBindingRepository(persistence.drizzle),
      originInput,
    ));
    await enableRelationPhysicalBuildsFor(
      relationCommit,
      relationBuild,
      deploymentId,
      origin.binding.schemaVersionId,
      1,
    );
    relationInput = await relationBuildPublicationInput(
      deploymentId,
      fixtureOrdinal + 1_000,
      {
        inverseName: "articlesAuthored",
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
      relationBindingRepository(persistence.drizzle),
      relationInput,
    ));
  } else {
    relation = await runEffect(publishApplicationRelationBindingEffect(
      relationBindingRepository(persistence.drizzle),
      relationInput,
    ));
  }
  const canonicalManifest = Result.getOrThrow(
    canonicalizeApplicationManifestV2(relationInput.manifest),
  );
  const analyses = makeApplicationAnalysisRepository(persistence.drizzle, {
    randomUuid: uuidSequence(11, 12, 13),
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
    persistence.drizzle,
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
    persistence.drizzle,
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

  const candidateValidation = createAppSchemaCandidateValidationPort({
    controlDb: persistence.drizzle,
    authority: authorityPorts,
  });
  const candidateReadiness = createAppSchemaCandidateReadinessPort(
    candidateValidation,
  );
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(
    persistence.drizzle,
  );
  const uniqueConstraintEligibility =
    createAppUniqueConstraintSetEligibilityPortV1({
      controlDb: persistence.drizzle,
      authority: authorityPorts,
    }, uniqueConstraints);
  const pointCommit = createPointCommitPublisherPortV1({
    scopeMetadata: persistence,
    provisioningReceipts: authorityPorts.provisioningReceipts,
    scopeSessionTargets: {
      resolve: async () => {
        throw new Error("Relation readiness must not open a commit session.");
      },
    },
  }, { uniqueConstraints, uniqueConstraintEligibility });
  const physicalDefinitionLifecycle = createPhysicalDefinitionLifecyclePort({
    controlDb: persistence.drizzle,
    authority: authorityPorts,
  });
  const foldContext = Object.freeze({
    controlDb: persistence.drizzle,
    authority: authorityPorts,
    schema: createApplicationRelationSchemaAuthorityPort(
      persistence.drizzle,
    ),
    taskCatalog: createApplicationRelationTaskCatalogSnapshotPort(),
    candidateValidation: candidateReadiness,
    pointCommit,
    physicalDefinitionLifecycle,
    relations,
  });
  const fold = makeApplicationRelationReadinessFoldRepository(foldContext);
  let legacyColdCalls = 0;
  const legacyReadiness = makeApplicationReadinessRepository({
    controlDb: persistence.drizzle,
    authority: authorityPorts,
    schema: makeApplicationSchemaAuthorityPublisher({
      db: persistence.drizzle,
      runTransaction: run => persistence.drizzle.transaction(run),
    }),
    taskCatalog: createApplicationTaskCatalogSnapshotPort(),
    candidateValidation: candidateReadiness,
    pointCommit,
    physicalDefinitionLifecycle,
    cold: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      materialize: () => {
        legacyColdCalls += 1;
        return Effect.die(new Error(
          "Legacy cold materialization must not run for relation readiness.",
        ));
      },
    },
  });
  return Object.freeze({
    persistence,
    deploymentId,
    authority,
    authorityPorts,
    relation,
    manifest: canonicalManifest.manifest,
    publication,
    publications,
    publicationInput,
    taskBindings,
    taskBindingInput,
    relationBuild,
    relationCommit,
    relations,
    candidateValidation,
    physicalDefinitionLifecycle,
    semanticReuse: options.semanticReuse === true,
    foldContext,
    fold,
    legacyActivation: makeApplicationActivationRepository({
      deploymentId,
      readiness: legacyReadiness,
      authority: authorityPorts,
    }),
    legacyColdCalls: () => legacyColdCalls,
    input: Object.freeze({
      deploymentId,
      revisionId: publication.revisionId,
    }),
  });
}

async function prepareReadinessEvidence(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
): Promise<void> {
  await closeEmptyUniqueConstraintSet(
    fixture.persistence.drizzle,
    fixture.deploymentId,
    fixture.relation.binding.schemaVersionId,
  );
  await settleCandidateValidation(
    fixture.candidateValidation,
    fixture.deploymentId,
    fixture.relation.binding.schemaVersionId,
  );
  await enableApplicationPhysicalBuilds(
    fixture.persistence.drizzle,
    fixture.authorityPorts,
    fixture.authority.scopeId,
    fixture.deploymentId,
    fixture.relation.binding.schemaVersionId,
  );
  if (fixture.semanticReuse) {
    await settleRelationSemanticReadiness(fixture);
  } else {
    await enableRelationPhysicalBuilds(fixture);
  }
}

async function closeEmptyUniqueConstraintSet(
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
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const input = Object.freeze({ deploymentId, schemaVersionId });
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

async function enableRelationPhysicalBuilds(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
): Promise<void> {
  await enableRelationPhysicalBuildsFor(
    fixture.relationCommit,
    fixture.relationBuild,
    fixture.deploymentId,
    fixture.relation.binding.schemaVersionId,
    fixture.semanticReuse ? 1 : 2,
  );
}

async function enableRelationPhysicalBuildsFor(
  relationCommit: ReturnType<typeof createApplicationRelationCommitPort>,
  relationBuild: ReturnType<typeof createApplicationRelationBuildPort>,
  deploymentId: Parameters<
    ReturnType<typeof createApplicationRelationCommitPort>["locate"]
  >[0]["deploymentId"],
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
    for (let step = 0; step < 128; step += 1) {
      const result = await runEffect(relationBuild.advance({
        deploymentId,
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

async function settleRelationSemanticReadiness(
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

async function relationApplicationInput(
  deploymentId: string,
  ordinal: number,
  includeFunction: boolean,
) {
  const base = await relationBuildPublicationInput(deploymentId, ordinal, {
    secondRelation: true,
    inverseName: "authoredPosts",
    secondInverseName: "reviewedPosts",
  });
  if (!includeFunction) return base;
  const canonical = Result.getOrThrow(canonicalizeApplicationManifestV2({
    ...base.manifest,
    functions: [relationFunction("a"), relationFunction("default")],
  }));
  return Object.freeze({
    ...base,
    manifest: canonical.manifest,
    manifestSha256: await sha256Hex(canonical.canonicalBytes),
  });
}

function relationFunction(
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

function relationBindingRepository(db: FlarexMetadataDatabase) {
  return Object.freeze({
    db,
    runTransaction: <Value>(
      run: (tx: StableTableCatalogTransaction) => Promise<Value>,
    ): Promise<Value> => db.transaction(run),
  });
}

function preparedDefinition() {
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

function taskManifest() {
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

function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    const prefix = (fixtureOrdinal % 10).toString();
    return `${prefix}0000000-0000-4000-8000-${sequence
      .toString()
      .padStart(12, "0")}`;
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  ));
  return encodeBytesToLowercaseHex(digest);
}
