import { setTimeout as delay } from "node:timers/promises";

import { canonicalizeApplicationManifestV2 } from
  "@flarex/analysis/application-analysis";
import { produceApplicationTaskBindingsV1 } from
  "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import { and, asc, eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity } from
  "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { CommitSyscallSequenceV1Schema } from
  "flarex-protocol/commit-protocol";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  FlarexDbV1StorageGenerationSchema,
  projectScopeIdUuidV1,
  projectScopeIdUuidV1Result,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  advanceAppSchemaCandidateValidationEffect,
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
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
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../src/applicationAnalysisRegistration";
import { makeApplicationActivationRepository } from
  "../src/applicationActivation";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "../src/applicationActivationSchema";
import {
  type ApplicationRelationBindingPublication,
  type ApplicationRelationBindingRepository,
  publishApplicationRelationBindingEffect,
} from "../src/applicationRelationBinding";
import { makeApplicationReadinessRepository } from
  "../src/applicationReadiness";
import { createApplicationRelationServingInspector } from
  "../src/applicationRelationServing";
import {
  createApplicationRelationBuildPort,
  type ApplicationRelationBuildPort,
} from "../src/applicationRelationBuild";
import {
  applyApplicationRelationCommitEdgesInTransactionEffect,
  createApplicationRelationCommitPort,
  prepareApplicationRelationCommitResult,
  type LocatedApplicationRelationDefinitionSet,
} from "../src/applicationRelationCommit";
import { makeApplicationRelationPublicationRepository } from
  "../src/applicationRelationPublication";
import { createApplicationRelationReadPort } from
  "../src/applicationRelationRead";
import {
  hasApplicationRelationReadinessFoldAuthority,
  makeApplicationRelationReadinessFoldRepository,
  validateApplicationRelationReadinessForActivationInTransaction,
  validateStoredApplicationRelationReadinessForActivationInTransaction,
} from "../src/applicationRelationReadinessFold";
import {
  createApplicationRelationReadinessPort,
  type PreparedApplicationRelationReadiness,
  type ApplicationRelationReadinessPort,
  type ApplicationRelationReadinessStepResult,
  validateApplicationRelationSetReadinessInTransactionEffect,
} from "../src/applicationRelationReadiness";
import {
  fxSystemApplicationReadiness,
  fxSystemApplicationReadinessRelations,
} from "../src/applicationRelationSchema";
import { createApplicationRelationSchemaAuthorityPort } from
  "../src/applicationRelationSchemaAuthority";
import { makeApplicationSchemaAuthorityPublisher } from
  "../src/applicationSchemaAuthority";
import {
  createApplicationRelationTaskCatalogSnapshotPort,
  makeApplicationRelationTaskBindingRepository,
} from "../src/applicationRelationTaskBindings";
import { createApplicationTaskCatalogSnapshotPort } from
  "../src/applicationTaskBindings";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from
  "../src/appRows";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../src/indexBuildReconciliation";
import { createPhysicalDefinitionLifecyclePort } from
  "../src/physicalDefinitionLifecycle";
import {
  createPointCommitPublisherPortV1,
  createPointMutationAttemptReplacementPortV1,
} from "../src/pointCommitTransaction";
import {
  createPostgresLocatedIndexBuildReconciliationTargetV1,
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
  fxControlSchemaVersions,
  fxControlTables,
  fxControlEdgeDefinitions,
  fxControlRelations,
  fxSystemApplicationRelationSemanticReadiness,
  fxSystemApplicationRelationSemanticValidations,
  fxSystemApplicationReadinessV1,
  fxSystemEdgeDefinitionBuilds,
  fxSystemEdgeDefinitionReadiness,
  fxSystemScopeClocks,
} from "../src/schema";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { resolveLocatedTrustedScopeAuthorityEffect } from
  "../src/scopeAuthorityResolution";
import { lockScopeClockForUpdateInTransactionEffect } from
  "../src/scopeClock";
import { createSessionJournalStorePersistenceV1 } from
  "../src/sessionJournalStore";
import { createStoredOccExecutionEvidenceLoaderV1 } from
  "../src/storedOccExecution";
import {
  createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
} from "../src/transactionSessionActivation";
import {
  ensureRelationBuildTestWebCrypto,
  relationBuildDocumentId,
  relationBuildPublicationInput,
  relationBuildRowId,
  type RelationBuildPublicationOptions,
} from "./applicationRelationBuildTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { selectorFromRelationAnchor } from
  "./pointCommitRelationTestSupport";
import {
  runningRelationConflictAttemptReplacementCommandFromStoredOccExecutionV1,
  runningRelationConflictRecoveryCommandFromStoredOccExecutionV1,
} from "./pointCommitTransactionTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "e01-b-postgres",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

describe("E01-B PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting E01-B.",
    ).not.toBeNull();
  });
});

describePostgres("real PostgreSQL E01-B application relation readiness", () => {
  it("migrates, restarts, rolls back, serializes settlement, replays, and chains without sidecar writes", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await fixtureFor(control, target);
      const version = await target.query<{ server_version: string }>(
        "show server_version",
      );
      expect(version.rows[0]?.server_version).toMatch(/^18\./);

      const original = await publishNew(fixture, 20_001);
      await seedPopulatedRows(fixture, original, 3);
      const edgeDefinitionId = await enablePhysicalReadiness(
        fixture,
        original,
      );
      const sidecarsBefore = await sidecarCounts(fixture, edgeDefinitionId);
      expect(sidecarsBefore).toEqual({ edges: "3", versions: "6" });

      const reused = await publishReuse(fixture, 20_002, original, {
        extraUserField: true,
      });
      const chained = await publishReuse(fixture, 20_003, reused, {
        extraUserField: true,
        inverseName: "articles",
      });
      const chainedBlocked = await runEffect(fixture.readiness.advance(
        readinessInput(fixture, chained),
      ));
      expect(chainedBlocked).toMatchObject({
        status: "not_ready",
        reason: "semanticOriginMissing",
      });

      const reusedInput = readinessInput(fixture, reused);
      expect(await runEffect(fixture.readiness.advance(reusedInput)))
        .toMatchObject({
          status: "initialized",
          lifecycle: "validating_sources",
          attemptFence: 1n,
          frontierCommitSeq: 1n,
        });
      await target.drizzle.update(fxSystemScopeClocks).set({
        lastCommitSeq: CommitSeqSchema.make(2n),
      }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
      expect(await runEffect(fixture.readiness.advance(reusedInput)))
        .toMatchObject({
          status: "restarted",
          lifecycle: "validating_sources",
          attemptFence: 2n,
          frontierCommitSeq: 2n,
        });
      expect(await runEffect(fixture.readiness.advance(reusedInput)))
        .toMatchObject({
          status: "advanced",
          lifecycle: "validating_edges",
        });
      expect(await runEffect(fixture.readiness.advance(reusedInput)))
        .toMatchObject({
          status: "advanced",
          lifecycle: "validating_versions",
        });

      const rollback = await runEffectFailure(fixture.readiness.advance(
        reusedInput,
        {
          faultAfter: (point) => {
            if (point === "afterReceiptInsert") {
              throw new Error("injected PostgreSQL E01-B receipt failure");
            }
          },
        },
      ));
      expect(rollback).toMatchObject({
        _tag: "ApplicationRelationReadinessPersistenceError",
        retryable: false,
      });
      expect(await semanticReceiptCount(fixture)).toBe("0");
      expect(await semanticHead(fixture, reused)).toMatchObject({
        lifecycle: "validating_versions",
        attempt_fence: "2",
        frontier_commit_seq: "2",
        readiness_sha256: null,
      });

      const blocker = await acquireScopeClockLock(fixture);
      let released = false;
      let concurrent: ReadonlyArray<ApplicationRelationReadinessStepResult> |
        undefined;
      const pending = Array.from({ length: 3 }, () =>
        runEffect(fixture.readiness.advance(reusedInput))
      );
      try {
        await waitForBlockedScopeClockOperations(target, blocker.pid, 3);
        await blocker.client.query("commit");
        released = true;
        concurrent = await Promise.all(pending);
      } finally {
        if (!released) {
          await blocker.client.query("rollback").catch(() => undefined);
        }
        blocker.client.release();
        if (concurrent === undefined) await Promise.allSettled(pending);
      }
      if (concurrent === undefined) {
        throw new Error("PostgreSQL E01-B concurrent settlement did not finish.");
      }
      expect(concurrent.map((result) => result.status).sort()).toEqual([
        "complete",
        "complete",
        "ready",
      ]);
      expect(await semanticReceiptCount(fixture)).toBe("1");
      expect(await semanticHead(fixture, reused)).toMatchObject({
        lifecycle: "ready",
        attempt_fence: "2",
        frontier_commit_seq: "2",
        source_count: "3",
        edge_count: "3",
        version_count: "6",
      });
      expect(await runEffect(fixture.readiness.advance(reusedInput)))
        .toMatchObject({ status: "complete" });

      const cold = composePorts(fixture).readiness;
      expect(await runEffect(cold.advance(reusedInput))).toMatchObject({
        status: "complete",
      });
      const chainedSteps = await advanceUntilComplete(fixture, chained);
      expect(chainedSteps.at(-1)?.status).toBe("complete");
      const reusedHead = await semanticHead(fixture, reused);
      const chainedReceipt = await semanticReceipt(fixture, chained);
      expect(chainedReceipt).toMatchObject({
        origin_readiness_kind: "semantic",
        origin_schema_version_id: reused.binding.schemaVersionId,
        origin_semantic_attempt_fence: reusedHead?.attempt_fence,
        physical_origin_schema_version_id: original.binding.schemaVersionId,
        physical_frontier_commit_seq: "1",
        frontier_commit_seq: "2",
      });
      expect(chainedReceipt?.origin_semantic_readiness_sha256).toEqual(
        reusedHead?.readiness_sha256,
      );
      expect(await semanticReceiptCount(fixture)).toBe("2");
      expect(await sidecarCounts(fixture, edgeDefinitionId)).toEqual(
        sidecarsBefore,
      );
    });
  }, 240_000);

  it("authenticates an ordered two-relation set across semantic reuse", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await fixtureFor(control, target);
      const original = await publishNew(fixture, 30_001, {
        secondRelation: true,
        inverseName: "authoredPosts",
        secondInverseName: "reviewedPosts",
      });
      const enabled = await enablePhysicalReadinessSet(fixture, original);
      expect(enabled.map(definition => definition.relationOrdinal)).toEqual([
        1,
        2,
      ]);
      const originalPrepared = await runEffect(fixture.readiness.prepare(
        readinessInput(fixture, original),
      ));
      const direct = await validateSet(fixture, originalPrepared);
      expect(direct.status).toBe("ready");
      if (direct.status !== "ready") {
        throw new Error("PostgreSQL direct relation set was not ready.");
      }
      expect(direct.evidence.receipt.relations.map(child => ({
        ordinal: child.relationOrdinal,
        kind: child.readinessKind,
      }))).toEqual([
        { ordinal: 1, kind: "physical" },
        { ordinal: 2, kind: "physical" },
      ]);
      const before = await physicalStateSnapshot(fixture);

      const successor = await publishReuse(fixture, 30_002, original, {
        inverseName: "articlesAuthored",
        secondInverseName: "articlesReviewed",
      });
      await advanceUntilComplete(fixture, successor);
      const successorPrepared = await runEffect(fixture.readiness.prepare(
        readinessInput(fixture, successor),
      ));
      const semantic = await validateSet(fixture, successorPrepared);
      expect(semantic.status).toBe("ready");
      if (semantic.status !== "ready") {
        throw new Error("PostgreSQL semantic relation set was not ready.");
      }
      expect(semantic.evidence.receipt.relations.map(child => ({
        ordinal: child.relationOrdinal,
        kind: child.readinessKind,
      }))).toEqual([
        { ordinal: 1, kind: "semantic" },
        { ordinal: 2, kind: "semantic" },
      ]);
      expect(new Set(semantic.evidence.receipt.relations.map(child =>
        child.readinessSha256
      )).size).toBe(2);
      expect(semantic.evidence.sha256).not.toEqual(direct.evidence.sha256);
      expect(await physicalStateSnapshot(fixture)).toEqual(before);
    });
  }, 240_000);

  it("concurrently settles one authentic relation-aware Application root and replaces a natural exact-read conflict", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await fixtureFor(control, target);
      const version = await target.query<{ server_version: string }>(
        "show server_version",
      );
      expect(version.rows[0]?.server_version).toMatch(/^18\./);
      const relationInput = await relationBuildPublicationInput(
        fixture.deploymentId,
        40_001,
        {
          secondRelation: true,
          inverseName: "authoredPosts",
          secondInverseName: "reviewedPosts",
        },
      );
      const canonical = Result.getOrThrow(
        canonicalizeApplicationManifestV2(relationInput.manifest),
      );
      const relation = await runEffect(
        publishApplicationRelationBindingEffect(
          repositoryFor(fixture),
          relationInput,
        ),
      );
      const authority = Object.freeze({
        scopeId: fixture.scopeId,
        storageGeneration:
          FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: StorageGenerationFenceSchema.make(1n),
        epoch: fixture.epoch,
      }) satisfies ApplicationAnalysisAuthority;
      const analyses = makeApplicationAnalysisRepository(
        fixture.target.drizzle,
        { randomUuid: relationFoldUuidSequence(11, 12, 13) },
      );
      const pending = await runEffect(analyses.begin({
        authority,
        requestKey: "request:application-relation-fold:postgres",
        sourceArtifactRootSha256:
          canonical.manifest.sourceArtifact.rootSha256,
        analyzerIdentity: "application-relation-analyzer",
        analyzerPolicyIdentity: "application-relation-analyzer-policy",
      }));
      const analyzed = await runEffect(analyses.settle(authority, {
        kind: "analyzed",
        candidateId: pending.candidateId,
        sourceArtifactRootSha256:
          canonical.manifest.sourceArtifact.rootSha256,
        analyzerIdentity: "application-relation-analyzer",
        analyzerPolicyIdentity: "application-relation-analyzer-policy",
        canonicalManifest: canonical.canonicalText,
      }));
      if (analyzed.status !== "analyzed") {
        throw new Error("Expected analyzed PostgreSQL relation Application.");
      }
      expect(analyzed.manifestSha256).toBe(relationInput.manifestSha256);
      const publication = await runEffect(
        makeApplicationRelationPublicationRepository(
          fixture.target.drizzle,
          fixture.control.drizzle,
        ).publish({
          authority,
          deploymentId: fixture.deploymentId,
          revisionId: analyzed.revision.revisionId,
          candidateId: analyzed.candidateId,
          analysisId: analyzed.analysisId,
          manifestSha256: analyzed.manifestSha256,
          manifest: canonical.manifest,
        }),
      );
      const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
        globalThis.crypto.subtle.digest("SHA-256", input)
      );
      const catalog = await runEffect(hashCanonicalTaskCatalogV1({
        version: 1,
        tasks: [],
      }, taskSha256));
      const bindings = await runEffect(produceApplicationTaskBindingsV1({
        definition: relationFoldPreparedDefinition(),
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
          runtimeHostIdentity:
            "flarex.test/application-relation-postgres-runtime",
          compatibilityDate: "2026-08-25",
        },
      }, taskSha256));
      await runEffect(makeApplicationRelationTaskBindingRepository(
        fixture.target.drizzle,
        fixture.control.drizzle,
      ).register({ authority, publication, bindings }));

      const candidateValidation = createAppSchemaCandidateValidationPort({
        controlDb: fixture.control.drizzle,
        authority: fixture.authority,
      });
      const candidateInput = Object.freeze({
        deploymentId: fixture.deploymentId,
        schemaVersionId: relation.binding.schemaVersionId,
      });
      const closure = await runEffect(
        prepareAppUniqueConstraintSetClosureV1Effect(
          fixture.control.drizzle,
          candidateInput,
        ),
      );
      await fixture.control.drizzle.transaction(tx => runEffect(
        closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure),
      ));
      await settlePostgresCandidateValidation(
        candidateValidation,
        candidateInput,
      );
      await enablePostgresApplicationPhysicalBuilds(
        fixture,
        relation.binding.schemaVersionId,
      );
      expect((await enablePhysicalReadinessSet(fixture, relation)).map(
        definition => definition.relationOrdinal
      )).toEqual([1, 2]);

      const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(
        fixture.control.drizzle,
      );
      const uniqueConstraintEligibility =
        createAppUniqueConstraintSetEligibilityPortV1({
          controlDb: fixture.control.drizzle,
          authority: fixture.authority,
        }, uniqueConstraints);
      const pointCommit = createPointCommitPublisherPortV1({
        scopeMetadata: fixture.control,
        provisioningReceipts: fixture.authority.provisioningReceipts,
        scopeSessionTargets: {
          resolve: async () => {
            throw new Error(
              "PostgreSQL relation readiness must not open a commit session.",
            );
          },
        },
      }, { uniqueConstraints, uniqueConstraintEligibility });
      const candidateReadiness = createAppSchemaCandidateReadinessPort(
        candidateValidation,
      );
      const physicalDefinitionLifecycle = createPhysicalDefinitionLifecyclePort({
        controlDb: fixture.control.drizzle,
        authority: fixture.authority,
      });
      const fold = makeApplicationRelationReadinessFoldRepository({
        controlDb: fixture.control.drizzle,
        authority: fixture.authority,
        schema: createApplicationRelationSchemaAuthorityPort(
          fixture.control.drizzle,
        ),
        taskCatalog: createApplicationRelationTaskCatalogSnapshotPort(),
        candidateValidation: candidateReadiness,
        pointCommit,
        physicalDefinitionLifecycle,
        relations: fixture.readiness,
      });
      const legacyReadiness = makeApplicationReadinessRepository({
        controlDb: fixture.control.drizzle,
        authority: fixture.authority,
        schema: makeApplicationSchemaAuthorityPublisher({
          db: fixture.control.drizzle,
          runTransaction: run => fixture.control.drizzle.transaction(run),
        }),
        taskCatalog: createApplicationTaskCatalogSnapshotPort(),
        candidateValidation: candidateReadiness,
        pointCommit,
        physicalDefinitionLifecycle,
        cold: {
          runtimeHostIdentity: "postgres-ra01-legacy-cold-inert",
          compatibilityDate: "2026-08-25",
          materialize: () => Effect.die(new Error(
            "Legacy cold materialization must not run for relation activation.",
          )),
        },
      });
      const input = Object.freeze({
        deploymentId: fixture.deploymentId,
        revisionId: publication.revisionId,
      });
      const [left, right] = await Promise.all([
        runEffect(fold.settle(input)),
        runEffect(fold.settle(input)),
      ]);
      if (left.status !== "ready" || right.status !== "ready") {
        throw new Error("Expected concurrent PostgreSQL relation readiness.");
      }
      expect([left.disposition, right.disposition].sort()).toEqual([
        "inserted",
        "replayed",
      ]);
      expect(right.readinessSha256).toBe(left.readinessSha256);
      expect(right.readinessBytes).toEqual(left.readinessBytes);
      expect(right.relationSetReadinessSha256).toBe(
        left.relationSetReadinessSha256,
      );
      expect(right.readyAt).toEqual(left.readyAt);
      expect(hasApplicationRelationReadinessFoldAuthority(fold, left))
        .toBe(true);
      expect(hasApplicationRelationReadinessFoldAuthority(
        fold,
        Object.freeze({ ...left }),
      )).toBe(false);
      const stored = await runEffect(fold.readReady(input));
      if (stored.status !== "ready") {
        throw new Error("Expected PostgreSQL cold readiness reconstruction.");
      }
      expect(stored).toMatchObject({
        status: "ready",
        disposition: "replayed",
        readinessSha256: left.readinessSha256,
        relationSetReadinessSha256: left.relationSetReadinessSha256,
        relationCount: 2,
      });
      expect(stored.readinessBytes).toEqual(left.readinessBytes);
      expect(stored.readyAt).toEqual(left.readyAt);
      const [preparedValidation, storedValidation] =
        await fixture.target.drizzle.transaction(async tx => {
          const clock = await runEffect(
            lockScopeClockForUpdateInTransactionEffect(tx, fixture.scopeId),
          );
          const preparedResult = await runEffect(
            validateApplicationRelationReadinessForActivationInTransaction(
              fold,
              left,
              tx,
              clock,
            ),
          );
          const storedResult = await runEffect(
            validateStoredApplicationRelationReadinessForActivationInTransaction(
              fold,
              stored,
              tx,
              clock,
            ),
          );
          return [preparedResult, storedResult] as const;
        });
      expect(preparedValidation).toMatchObject({
        status: "ready",
        basis: { revisionId: left.revisionId, relationCount: 2 },
      });
      expect(storedValidation).toMatchObject({
        status: "ready",
        basis: { revisionId: left.revisionId, relationCount: 2 },
      });
      const [roots, children, legacy] = await Promise.all([
        fixture.target.drizzle.select().from(fxSystemApplicationReadiness),
        fixture.target.drizzle.select().from(
          fxSystemApplicationReadinessRelations,
        ).orderBy(asc(
          fxSystemApplicationReadinessRelations.relationOrdinal,
        )),
        fixture.target.drizzle.select().from(fxSystemApplicationReadinessV1),
      ]);
      expect(roots).toHaveLength(1);
      expect(roots[0]).toMatchObject({
        readinessCodecVersion: 2,
        relationCount: 2,
      });
      expect(children.map(child => child.relationOrdinal)).toEqual([1, 2]);
      expect(children.map(child => child.relationId)).toEqual(
        relation.binding.relationBindings.map(binding => binding.relationId),
      );
      expect(legacy).toHaveLength(0);

      const relationActivation = makeApplicationActivationRepository({
        deploymentId: fixture.deploymentId,
        readiness: legacyReadiness,
        relationReadiness: fold,
        authority: fixture.authority,
      });
      const insertedActivation = await runEffect(relationActivation.activate({
        revisionId: left.revisionId,
        expectedActiveHead: null,
      }));
      const active = await runEffect(relationActivation.readActive());

      const binding = relation.binding.relationBindings[0];
      if (binding === undefined) {
        throw new Error("Expected a PostgreSQL exact relation binding.");
      }
      const reads = createApplicationRelationReadPort(
        fixture.control.drizzle,
        fixture.pointCommitAuthority,
        fixture.relationCommit,
        fold,
      );
      const capability = await runEffect(reads.prepare({
        deploymentId: fixture.deploymentId,
        selection: active.selection,
        relationId: binding.relationId,
      }));
      const resolved = Result.getOrThrow(reads.resolve(capability, {
        deploymentId: fixture.deploymentId,
        scopeId: left.scopeId,
        schemaVersionId: relation.binding.schemaVersionId,
      }));
      expect(resolved.definition.binding.relationId).toBe(binding.relationId);
      const definitions = await runEffect(fixture.relationCommit.locate({
        deploymentId: fixture.deploymentId,
        schemaVersionId: relation.binding.schemaVersionId,
      }));
      if (definitions === null || definitions.definitions.length !== 2) {
        throw new Error("Expected both PostgreSQL exact relation definitions.");
      }
      await publishExactRelationSchemaToPostgresExecutionFixture(
        fixture,
        relation.binding.schemaVersionId,
      );

      const targetRowId = relationBuildRowId(40_101);
      const activationInventoryBeforeReplay = await Promise.all([
        fixture.target.drizzle.select().from(
          fxSystemApplicationActivations,
        ),
        fixture.target.drizzle.select().from(
          fxSystemApplicationActiveHeads,
        ),
      ]);
      const firstSourceDocumentId =
        await applyExactPostgresRelationSourceCommit(
          fixture,
          relation,
          definitions,
          binding,
          targetRowId,
          40_102,
          CommitSeqSchema.make(1n),
        );
      const replayedActivation = await runEffect(
        relationActivation.activate({
          revisionId: left.revisionId,
          expectedActiveHead: null,
        }),
      );
      expect(replayedActivation).toMatchObject({
        ...insertedActivation,
        disposition: "replayed",
      });
      expect(await Promise.all([
        fixture.target.drizzle.select().from(
          fxSystemApplicationActivations,
        ),
        fixture.target.drizzle.select().from(
          fxSystemApplicationActiveHeads,
        ),
      ])).toEqual(activationInventoryBeforeReplay);
      const reacquiredActive = await runEffect(relationActivation.readActive());
      expect(reacquiredActive).toMatchObject({
        basis: {
          revisionId: left.revisionId,
          relationFrontierCommitSeq: "0",
        },
      });
      await expect(runEffect(reads.prepare({
        deploymentId: fixture.deploymentId,
        selection: reacquiredActive.selection,
        relationId: binding.relationId,
      }))).resolves.toBeDefined();
      const randomUuid = relationFoldUuidSequence(31, 32, 33);
      const activation = await activatePointMutationSession(
        createPointMutationSessionActivationPersistenceV1(
          fixture.pointCommitAuthority,
          {
            leaseDurationMilliseconds: 60_000,
            randomUuid,
            randomExecutionClaimOwner: randomUuid,
          },
        ),
        pointMutationSessionActivationFixture(
          fixture.deploymentId,
          decodeReplacementScopeIdV1(left.scopeId),
          { evidence: {
            schemaVersionId: relation.binding.schemaVersionId,
          } },
        ),
      );
      if (activation.status !== "created") {
        throw new Error("Expected a new PostgreSQL natural-conflict attempt.");
      }
      expect(activation.anchor.snapshotToken.commitSeq).toBe(1n);
      const store = createSessionJournalStorePersistenceV1(
        fixture.pointCommitAuthority,
        {
          grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
          applicationRelations: reads,
        },
      );
      const attempt = await runEffect(store.openAttemptEffect({
        selector: selectorFromRelationAnchor(activation.anchor),
        executionClaim: activation.executionClaim,
        snapshotToken: activation.anchor.snapshotToken,
        schemaVersionId: relation.binding.schemaVersionId,
      }));
      const relationRead = await runEffect(
        store.resolveApplicationRelationReadEffect(attempt, capability),
      );
      const claimedAuthority = Object.freeze({
        kind: "claimedAttempt" as const,
        deploymentId: activation.anchor.deploymentId,
        scopeId: activation.anchor.scopeId,
        scopeUuid: projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid,
        sessionId: activation.anchor.sessionId,
        attemptFence: activation.anchor.attemptFence,
        storageGeneration: activation.anchor.storageGeneration,
        storageGenerationFence: activation.anchor.storageGenerationFence,
        snapshotToken: activation.anchor.snapshotToken,
        schemaVersionId: relation.binding.schemaVersionId,
        executionClaim: activation.executionClaim,
      });
      const execution = await runEffect(
        createStoredOccExecutionEvidenceLoaderV1(
          fixture.pointCommitAuthority,
        ).loadEffect(claimedAuthority),
      );
      if (execution.kind !== "loaded") {
        throw new Error(
          `Expected pristine PostgreSQL running evidence; received ${execution.kind}${
            "reason" in execution ? `:${execution.reason}` : ""
          }.`,
        );
      }

      const secondSourceDocumentId =
        await applyExactPostgresRelationSourceCommit(
          fixture,
          relation,
          definitions,
          binding,
          targetRowId,
          40_103,
          CommitSeqSchema.make(2n),
        );
      const operation = Object.freeze({
        kind: "relationIncoming" as const,
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        targetDocumentId: appDocumentIdV1FromRowIdentity({
          tableId: binding.targetTableId,
          rowId: targetRowId,
        }),
        limit: 2,
      });
      const conflicted = await runEffect(
        store.runApplicationRelationIncomingReadEffect(
          relationRead,
          operation,
        ),
      );
      expect(conflicted).toMatchObject({
        kind: "conflicted",
        delivery: "executed",
        conflict: {
          kind: "relationConflict",
          edgeDefinitionId: binding.edgeDefinitionId,
          targetRowId,
          expectedAdjacencyVersion: 1n,
          actualAdjacencyVersion: 2n,
          snapshotCommitSeq: 1n,
        },
      });
      if (conflicted.kind !== "conflicted") {
        throw new Error("Expected a persisted PostgreSQL relation conflict.");
      }
      await fixture.target.query(
        `update fx_system_tx_execution_claim
         set claimed_at = clock_timestamp() - interval '2 minutes',
             claim_expires_at = clock_timestamp() - interval '1 minute'
         where session_id = $1`,
        [activation.anchor.sessionId],
      );
      const selector = selectorFromRelationAnchor(activation.anchor);
      const acquisitions = await Promise.all([
        runEffect(createPointMutationExecutionClaimAcquisitionV1(
          fixture.pointCommitAuthority,
          {
            durationMilliseconds: 60_000,
            randomOwner: relationFoldUuidSequence(34),
          },
        ).acquireEffect(selector)),
        runEffect(createPointMutationExecutionClaimAcquisitionV1(
          fixture.pointCommitAuthority,
          {
            durationMilliseconds: 60_000,
            randomOwner: relationFoldUuidSequence(35),
          },
        ).acquireEffect(selector)),
      ]);
      const acquired = acquisitions.find(result => result.kind === "acquired");
      const busy = acquisitions.find(result => result.kind === "busy");
      if (
        acquired?.kind !== "acquired" ||
        acquired.mode !== "replaceRelationConflict" ||
        busy?.kind !== "busy"
      ) {
        throw new Error(
          "Expected one PostgreSQL relation-conflict takeover and one busy result.",
        );
      }
      expect(acquired.observation.claimFence).toBe(
        activation.executionClaim.claimFence + 1n,
      );
      expect(busy.observation).toMatchObject({
        claimOwner: acquired.observation.claimOwner,
        claimFence: acquired.observation.claimFence,
      });

      const freshAttempt = await runEffect(
        createPointMutationSessionAttemptLoadPersistenceV1(
          fixture.pointCommitAuthority,
        ).loadEffect(selector),
      );
      if (freshAttempt.status !== "loaded") {
        throw new Error("Expected the PostgreSQL takeover attempt to load.");
      }
      const recoveredAuthority = Object.freeze({
        kind: "claimedRelationConflict" as const,
        deploymentId: freshAttempt.anchor.deploymentId,
        scopeId: freshAttempt.anchor.scopeId,
        scopeUuid: projectScopeIdUuidV1(freshAttempt.anchor.scopeId).scopeUuid,
        sessionId: freshAttempt.anchor.sessionId,
        attemptFence: freshAttempt.anchor.attemptFence,
        storageGeneration: freshAttempt.anchor.storageGeneration,
        storageGenerationFence: freshAttempt.anchor.storageGenerationFence,
        snapshotToken: freshAttempt.anchor.snapshotToken,
        schemaVersionId: freshAttempt.executionPin.schemaVersionId,
        executionClaim: acquired.observation,
      });
      const recoveredExecution = await runEffect(
        createStoredOccExecutionEvidenceLoaderV1(
          fixture.pointCommitAuthority,
        ).loadEffect(recoveredAuthority),
      );
      if (recoveredExecution.kind !== "loaded") {
        throw new Error(
          `Expected PostgreSQL conflict authority; received ${recoveredExecution.kind}.`,
        );
      }

      const replacementSteps: string[] = [];
      const replacement = createPointMutationAttemptReplacementPortV1(
        fixture.pointCommitAuthority,
        {
          leaseDurationMilliseconds: 60_000,
          randomExecutionClaimOwner: relationFoldUuidSequence(36),
          afterReplacementStep: event => {
            replacementSteps.push(event.step);
            return Promise.resolve();
          },
        },
      );
      const recovered = await runEffect(
        replacement.recoverRunningRelationConflict(
          runningRelationConflictRecoveryCommandFromStoredOccExecutionV1(
            recoveredAuthority,
            recoveredExecution.evidence,
          ),
        ),
      );
      expect(recovered).toMatchObject({
        request: {
          syscallSequence: operation.syscallSequence,
          edgeDefinitionId: binding.edgeDefinitionId,
          targetRowId,
          limit: operation.limit,
        },
        conflict: {
          expectedAdjacencyVersion: 1n,
          actualAdjacencyVersion: 2n,
          snapshotCommitSeq: 1n,
        },
      });
      const replacementCommand =
        runningRelationConflictAttemptReplacementCommandFromStoredOccExecutionV1(
          recoveredAuthority,
          recoveredExecution.evidence,
          recovered,
        );
      const replaced = await runEffect(
        replacement.replaceRunningRelationConflict(replacementCommand),
      );
      expect(replaced).toMatchObject({
        kind: "replaced",
        previousAttemptFence: activation.anchor.attemptFence,
        attemptFence: activation.anchor.attemptFence + 1n,
      });
      expect(replacementSteps).toEqual([
        "clockLocked",
        "outcomeRechecked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
        "dependenciesValidated",
        "executionClaimDeleted",
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
      if (replaced.kind !== "replaced") {
        throw new Error("Expected exact PostgreSQL conflict replacement.");
      }
      const loaded = await runEffect(
        createPointMutationSessionAttemptLoadPersistenceV1(
          fixture.pointCommitAuthority,
        ).loadEffect({
          deploymentId: activation.anchor.deploymentId,
          scopeId: activation.anchor.scopeId,
          sessionId: activation.anchor.sessionId,
          attemptFence: replaced.attemptFence,
        }),
      );
      expect(loaded).toMatchObject({
        status: "loaded",
        anchor: { snapshotToken: { commitSeq: 2n } },
        attemptFacet: { kind: "pristineOpen" },
      });
      const retryStore = createSessionJournalStorePersistenceV1(
        fixture.pointCommitAuthority,
        {
          grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
          applicationRelations: reads,
        },
      );
      const retryAttempt = await runEffect(retryStore.openAttemptEffect({
        selector: selectorFromRelationAnchor(loaded.anchor),
        executionClaim: replaced.executionClaim,
        snapshotToken: loaded.anchor.snapshotToken,
        schemaVersionId: loaded.executionPin.schemaVersionId,
      }));
      const retryRelation = await runEffect(
        retryStore.resolveApplicationRelationReadEffect(
          retryAttempt,
          capability,
        ),
      );
      const retried = await runEffect(
        retryStore.runApplicationRelationIncomingReadEffect(
          retryRelation,
          operation,
        ),
      );
      expect(retried).toMatchObject({
        kind: "completed",
        delivery: "executed",
        outcome: {
          kind: "relationIncomingPage",
          exhausted: true,
        },
      });
      if (retried.kind !== "completed") {
        throw new Error("Expected the PostgreSQL retry read to succeed.");
      }
      expect(retried.outcome.items.map(item => item.sourceDocumentId)).toEqual([
        firstSourceDocumentId,
        secondSourceDocumentId,
      ]);
    });
  }, 300_000);
});

interface Fixture {
  readonly control: PostgresFlarexPersistence;
  readonly target: PostgresFlarexPersistence;
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly epoch: ReturnType<typeof ScopeEpochSchema.make>;
  readonly relationCommit: ReturnType<typeof createApplicationRelationCommitPort>;
  readonly pointCommitAuthority: Parameters<
    typeof createApplicationRelationCommitPort
  >[1];
  readonly authority: Parameters<typeof createApplicationRelationBuildPort>[1];
  readonly build: ApplicationRelationBuildPort;
  readonly readiness: ApplicationRelationReadinessPort;
}

async function fixtureFor(
  control: PostgresFlarexPersistence,
  target: PostgresFlarexPersistence,
): Promise<Fixture> {
  ensureRelationBuildTestWebCrypto();
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    "deployment_e01_b_postgres",
  );
  const scopeId = ScopeIdSchema.make(
    "scope_e01b0000-0000-4000-8000-000000000001",
  );
  const epoch = ScopeEpochSchema.make(
    "epoch_e01b0000-0000-4000-8000-000000000001",
  );
  await control.insertDeploymentMetadata({
    deploymentId,
    projectId: "project_e01_b_postgres",
  });
  await control.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: LOCATOR,
  });
  await target.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, storage_generation_fence,
        last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, epoch],
  );
  const pointTarget = createPostgresLocatedPointMutationSessionActivationTargetV1(
    target,
    LOCATOR,
  );
  const pointCommitAuthority = Object.freeze({
    scopeMetadata: control,
    applicationControlDb: control.drizzle,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => null,
    },
    scopeSessionTargets: { resolve: async () => pointTarget },
  });
  const relationCommit = createApplicationRelationCommitPort(
    control.drizzle,
    pointCommitAuthority,
  );
  const base = Object.freeze({
    control,
    target,
    deploymentId,
    scopeId,
    epoch,
    relationCommit,
    pointCommitAuthority,
  });
  return Object.freeze({ ...base, ...composePorts(base) });
}

function composePorts(fixture: Pick<
  Fixture,
  "control" | "target" | "relationCommit"
>): Pick<Fixture, "authority" | "build" | "readiness"> {
  const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
    fixture.target,
    LOCATOR,
  );
  const authority = {
    scopeMetadata: fixture.control,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => null,
    },
    scopeClockTargets: { resolve: async () => target },
  } satisfies Parameters<typeof createApplicationRelationBuildPort>[1];
  const build = createApplicationRelationBuildPort(
    fixture.control.drizzle,
    authority,
    fixture.relationCommit,
    createApplicationRelationServingInspector(),
  );
  return Object.freeze({
    authority,
    build,
    readiness: createApplicationRelationReadinessPort(
      fixture.control.drizzle,
      authority,
      fixture.relationCommit,
      build,
    ),
  });
}

function repositoryFor(fixture: Fixture): ApplicationRelationBindingRepository {
  return {
    db: fixture.control.drizzle,
    runTransaction: (run) => fixture.control.drizzle.transaction(run),
  };
}

async function publishNew(
  fixture: Fixture,
  ordinal: number,
  options: RelationBuildPublicationOptions = {},
): Promise<ApplicationRelationBindingPublication> {
  return runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(fixture),
    await relationBuildPublicationInput(
      fixture.deploymentId,
      ordinal,
      options,
    ),
  ));
}

async function publishReuse(
  fixture: Fixture,
  ordinal: number,
  origin: ApplicationRelationBindingPublication,
  options: Readonly<{
    readonly extraUserField?: boolean;
    readonly inverseName?: string;
    readonly secondInverseName?: string;
  }>,
): Promise<ApplicationRelationBindingPublication> {
  return runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(fixture),
    await relationBuildPublicationInput(fixture.deploymentId, ordinal, {
      ...options,
      secondRelation: origin.binding.relationBindings.length === 2,
      decisions: Object.freeze(origin.binding.relationBindings.map(
        binding => Object.freeze({
          relationOrdinal: binding.relationOrdinal,
          evolution: Object.freeze({
            kind: "preserve" as const,
            fromSchemaVersionId: origin.binding.schemaVersionId,
            fromRelationOrdinal: binding.relationOrdinal,
            physical: "reuse" as const,
          }),
        }))),
    }),
  ));
}

function readinessInput(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  return Object.freeze({
    deploymentId: fixture.deploymentId,
    applicationManifestSha256:
      publication.manifestBinding.applicationManifestSha256,
  });
}

async function enablePhysicalReadiness(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  const enabled = await enablePhysicalReadinessSet(fixture, publication);
  const first = enabled[0];
  if (first === undefined) {
    throw new Error("PostgreSQL E01-B physical definition is missing.");
  }
  return first.edgeDefinitionId;
}

async function enablePhysicalReadinessSet(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  const definitions = await runEffect(fixture.relationCommit.locate({
    deploymentId: fixture.deploymentId,
    schemaVersionId: publication.binding.schemaVersionId,
  }));
  if (definitions === null) {
    throw new Error("PostgreSQL E01-B physical definition set is missing.");
  }
  const enabled: Array<Readonly<{
    readonly relationOrdinal: number;
    readonly edgeDefinitionId: Parameters<
      ApplicationRelationBuildPort["advance"]
    >[0]["edgeDefinitionId"];
  }>> = [];
  for (let index = 0; index < definitions.definitions.length; index += 1) {
    const definition = definitions.definitions[index];
    if (
      definition === undefined ||
      definition.binding.relationOrdinal !== index + 1
    ) {
      throw new Error("PostgreSQL E01-B definition set is not dense.");
    }
    const input = Object.freeze({
      deploymentId: fixture.deploymentId,
      schemaVersionId: publication.binding.schemaVersionId,
      edgeDefinitionId: definition.edge.edgeDefinitionId,
    });
    let settled = false;
    for (let step = 0; step < 32; step += 1) {
      if ((await runEffect(fixture.build.advance(input))).lifecycle ===
        "enabled") {
        settled = true;
        break;
      }
    }
    if (!settled) {
      throw new Error("PostgreSQL E01-B physical readiness did not settle.");
    }
    enabled.push(Object.freeze({
      relationOrdinal: definition.binding.relationOrdinal,
      edgeDefinitionId: definition.edge.edgeDefinitionId,
    }));
  }
  return Object.freeze(enabled);
}

async function seedPopulatedRows(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
  count: number,
): Promise<void> {
  const rows = Array.from({ length: count }, (_, index) => [{
    tableIdValue: 2,
    ordinal: 201 + index,
    fields: Object.freeze({ name: `target-${index + 1}` }),
  }, {
    tableIdValue: 1,
    ordinal: 101 + index,
    fields: Object.freeze({
      author: relationBuildDocumentId(2, 201 + index),
    }),
  }]).flat();
  const commitSeq = CommitSeqSchema.make(1n);
  await fixture.target.drizzle.transaction(async (tx) => {
    for (const row of rows) {
      const tableId = decodeCatalogTableId(row.tableIdValue);
      const rowId = relationBuildRowId(row.ordinal);
      const creationTime = decodeAppCreationTimeV1(row.ordinal);
      const value = await canonicalizeFlarexValueV1({
        _id: appDocumentIdV1FromRowIdentity({ tableId, rowId }),
        _creationTime: creationTime,
        ...row.fields,
      }, "appDocument");
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: fixture.scopeId,
        tableId,
        rowId,
        writeEpoch: fixture.epoch,
        commitSeq,
        prevCommitSeq: null,
        schemaVersionId: publication.binding.schemaVersionId,
        creationTime,
        value: {
          codecVersion: value.codecVersion,
          valueJson: value.valueJson,
          canonicalBytes: value.canonicalBytes,
          sha256: value.sha256,
        },
      });
    }
    await tx.update(fxSystemScopeClocks).set({
      lastCommitSeq: commitSeq,
    }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
  });
}

async function advanceUntilComplete(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
): Promise<ReadonlyArray<ApplicationRelationReadinessStepResult>> {
  const input = readinessInput(fixture, publication);
  const steps: ApplicationRelationReadinessStepResult[] = [];
  for (let step = 0; step < 32; step += 1) {
    const result = await runEffect(fixture.readiness.advance(input));
    steps.push(result);
    if (result.status === "complete") return Object.freeze(steps);
    if (result.status === "not_ready") {
      throw new Error(`PostgreSQL E01-B blocked: ${result.reason}.`);
    }
  }
  throw new Error("PostgreSQL E01-B semantic readiness did not settle.");
}

async function validateSet(
  fixture: Fixture,
  prepared: PreparedApplicationRelationReadiness,
) {
  const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(
    fixture.deploymentId,
    fixture.authority,
  ));
  return fixture.target.drizzle.transaction(async (tx) => {
    const clock = await runEffect(
      lockScopeClockForUpdateInTransactionEffect(tx, fixture.scopeId),
    );
    return runEffect(
      validateApplicationRelationSetReadinessInTransactionEffect(
        fixture.readiness,
        tx,
        located.authority,
        clock,
        prepared,
      ),
    );
  });
}

async function physicalStateSnapshot(fixture: Fixture) {
  const [relations, definitions, builds, receipts, edges, versions] =
    await Promise.all([
      fixture.control.drizzle.select().from(fxControlRelations).orderBy(
        asc(fxControlRelations.relationId),
      ),
      fixture.control.drizzle.select().from(
        fxControlEdgeDefinitions,
      ).orderBy(asc(fxControlEdgeDefinitions.edgeDefinitionId)),
      fixture.target.drizzle.select().from(
        fxSystemEdgeDefinitionBuilds,
      ).orderBy(asc(fxSystemEdgeDefinitionBuilds.edgeDefinitionId)),
      fixture.target.drizzle.select().from(
        fxSystemEdgeDefinitionReadiness,
      ).orderBy(
        asc(fxSystemEdgeDefinitionReadiness.edgeDefinitionId),
        asc(fxSystemEdgeDefinitionReadiness.attemptFence),
      ),
      fixture.target.drizzle.select().from(fxAppEdgeCurrent).orderBy(
        asc(fxAppEdgeCurrent.edgeDefinitionId),
        asc(fxAppEdgeCurrent.sourceRowId),
        asc(fxAppEdgeCurrent.targetRowId),
        asc(fxAppEdgeCurrent.duplicateOrdinal),
      ),
      fixture.target.drizzle.select().from(
        fxAppEdgeAdjacencyVersions,
      ).orderBy(
        asc(fxAppEdgeAdjacencyVersions.edgeDefinitionId),
        asc(fxAppEdgeAdjacencyVersions.direction),
        asc(fxAppEdgeAdjacencyVersions.endpointRowId),
      ),
    ]);
  return structuredClone({
    relations,
    definitions,
    builds,
    receipts,
    edges,
    versions,
  });
}

async function sidecarCounts(
  fixture: Fixture,
  edgeDefinitionId: Awaited<ReturnType<typeof enablePhysicalReadiness>>,
) {
  const scopeUuid = Result.getOrThrow(
    projectScopeIdUuidV1Result(fixture.scopeId),
  ).scopeUuid;
  const [edges, versions] = await Promise.all([
    fixture.target.drizzle.select({ count: sql<string>`count(*)::text` })
      .from(fxAppEdgeCurrent).where(and(
        eq(fxAppEdgeCurrent.scopeUuid, scopeUuid),
        eq(fxAppEdgeCurrent.edgeDefinitionId, edgeDefinitionId),
      )),
    fixture.target.drizzle.select({ count: sql<string>`count(*)::text` })
      .from(fxAppEdgeAdjacencyVersions).where(and(
        eq(fxAppEdgeAdjacencyVersions.scopeUuid, scopeUuid),
        eq(fxAppEdgeAdjacencyVersions.edgeDefinitionId, edgeDefinitionId),
      )),
  ]);
  return Object.freeze({
    edges: edges[0]?.count ?? "missing",
    versions: versions[0]?.count ?? "missing",
  });
}

async function semanticReceiptCount(fixture: Fixture): Promise<string> {
  const rows = await fixture.target.drizzle.select({
    count: sql<string>`count(*)::text`,
  }).from(fxSystemApplicationRelationSemanticReadiness).where(eq(
    fxSystemApplicationRelationSemanticReadiness.scopeId,
    fixture.scopeId,
  ));
  return rows[0]?.count ?? "missing";
}

async function semanticHead(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  const result = await fixture.target.query<{
    lifecycle: string;
    attempt_fence: string;
    frontier_commit_seq: string;
    source_count: string;
    edge_count: string;
    version_count: string;
    readiness_sha256: Uint8Array | null;
  }>(
    `select lifecycle, attempt_fence::text, frontier_commit_seq::text,
            validated_source_count::text source_count,
            validated_edge_count::text edge_count,
            validated_version_count::text version_count,
            readiness_sha256
       from fx_system_application_relation_semantic_validation
      where scope_id = $1 and schema_version_id = $2 and relation_ordinal = 1`,
    [fixture.scopeId, publication.binding.schemaVersionId],
  );
  return result.rows[0] ?? null;
}

async function semanticReceipt(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  const result = await fixture.target.query<{
    origin_readiness_kind: string;
    origin_schema_version_id: string;
    origin_semantic_attempt_fence: string | null;
    origin_semantic_readiness_sha256: Uint8Array | null;
    physical_origin_schema_version_id: string;
    physical_frontier_commit_seq: string;
    frontier_commit_seq: string;
  }>(
    `select origin_readiness_kind, origin_schema_version_id,
            origin_semantic_attempt_fence::text,
            origin_semantic_readiness_sha256,
            physical_origin_schema_version_id,
            physical_frontier_commit_seq::text,
            frontier_commit_seq::text
       from fx_system_application_relation_semantic_readiness
      where scope_id = $1 and schema_version_id = $2 and relation_ordinal = 1`,
    [fixture.scopeId, publication.binding.schemaVersionId],
  );
  return result.rows[0] ?? null;
}

async function acquireScopeClockLock(fixture: Fixture): Promise<{
  readonly client: PoolClient;
  readonly pid: number;
}> {
  const client = await fixture.target.pool.connect();
  try {
    await client.query("begin");
    const pid = await client.query<{ pid: number }>(
      "select pg_backend_pid()::int pid",
    );
    const value = pid.rows[0]?.pid;
    if (value === undefined) throw new Error("E01-B blocker PID missing.");
    await client.query(
      `select 1 from fx_system_scope_clock
        where scope_id = $1 for update`,
      [fixture.scopeId],
    );
    return Object.freeze({ client, pid: value });
  } catch (cause) {
    await client.query("rollback").catch(() => undefined);
    client.release();
    throw cause;
  }
}

async function waitForBlockedScopeClockOperations(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `with recursive blocked(pid) as (
         select activity.pid
           from pg_stat_activity activity
          where $1::int = any(pg_blocking_pids(activity.pid))
         union
         select activity.pid
           from pg_stat_activity activity
           join blocked blocker
             on blocker.pid = any(pg_blocking_pids(activity.pid))
       )
       select count(*)::int blocked
         from blocked
         join pg_stat_activity activity using (pid)
        where activity.datname = current_database()`,
      [blockerPid],
    );
    if ((result.rows[0]?.blocked ?? 0) >= expected) return;
    await delay(25);
  }
  throw new Error(`Expected ${expected} E01-B scope-clock waiters.`);
}

async function settlePostgresCandidateValidation(
  candidateValidation: ReturnType<
    typeof createAppSchemaCandidateValidationPort
  >,
  input: Parameters<typeof installAppSchemaCandidateValidationEffect>[1],
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
  throw new Error("PostgreSQL relation candidate validation did not settle.");
}

async function enablePostgresApplicationPhysicalBuilds(
  fixture: Fixture,
  schemaVersionId: ApplicationRelationBindingPublication[
    "binding"
  ]["schemaVersionId"],
): Promise<void> {
  const ports = Object.freeze({
    controlDb: fixture.control.drizzle,
    authority: fixture.authority,
  });
  await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, {
    deploymentId: fixture.deploymentId,
    schemaVersionId,
  }));
  const requirements = await runEffect(
    loadPublishedPhysicalRequirementSnapshotV1(
      fixture.control.drizzle,
      Object.freeze({
        deploymentId: fixture.deploymentId,
        schemaVersionId,
      }),
    ),
  );
  if (requirements === null || requirements.definitions.length === 0) {
    throw new Error("Expected PostgreSQL Application physical requirements.");
  }
  for (const definition of requirements.definitions) {
    const located = await runEffect(locateAppIndexDefinitionByIdEffect(
      fixture.control.drizzle,
      fixture.scopeId,
      definition.indexDefinitionId,
    ));
    if (located === null) {
      throw new Error("PostgreSQL Application index definition is missing.");
    }
    for (let step = 0; step < 16; step += 1) {
      const input = Object.freeze({
        deploymentId: fixture.deploymentId,
        indexDefinitionId: definition.indexDefinitionId,
        pageSize: 16,
      });
      const built = located.access.kind === "developer"
        ? await runEffect(buildAppDeveloperOrderedIndexV1Effect(ports, input))
        : await runEffect(buildIntrinsicCreationTimeIndexV1Effect(ports, input));
      if (built.lifecycle === "enabled") break;
      if (step === 15) {
        throw new Error("PostgreSQL Application physical build did not enable.");
      }
    }
  }
}

function relationFoldPreparedDefinition() {
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

/**
 * Test-local publication for the legacy located-execution owner. Production
 * schema placement remains outside this relation-read acceptance scenario.
 */
async function publishExactRelationSchemaToPostgresExecutionFixture(
  fixture: Fixture,
  schemaVersionId: ApplicationRelationBindingPublication["binding"][
    "schemaVersionId"
  ],
): Promise<void> {
  const [schemaRows, tableRows] = await Promise.all([
    fixture.control.drizzle.select().from(fxControlSchemaVersions).where(and(
      eq(fxControlSchemaVersions.deploymentId, fixture.deploymentId),
      eq(fxControlSchemaVersions.schemaVersionId, schemaVersionId),
    )).limit(2),
    fixture.control.drizzle.select().from(fxControlTables).where(eq(
      fxControlTables.deploymentId,
      fixture.deploymentId,
    )).orderBy(asc(fxControlTables.tableId)),
  ]);
  if (schemaRows.length !== 1 || tableRows.length !== 2) {
    throw new Error(
      "Expected one exact PostgreSQL schema and two stable table bindings.",
    );
  }
  const schema = schemaRows[0];
  if (schema === undefined) {
    throw new Error("Expected the exact PostgreSQL schema artifact.");
  }
  await fixture.target.insertDeploymentMetadata({
    deploymentId: fixture.deploymentId,
    projectId: "project_e01_b_postgres",
  });
  await fixture.target.drizzle.transaction(async tx => {
    await tx.insert(fxControlSchemaVersions).values(schema);
    await tx.insert(fxControlTables).values(tableRows);
  });
}

async function applyExactPostgresRelationSourceCommit(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
  definitions: LocatedApplicationRelationDefinitionSet,
  binding: ApplicationRelationBindingPublication["binding"][
    "relationBindings"
  ][number],
  targetRowId: ReturnType<typeof relationBuildRowId>,
  sourceOrdinal: number,
  commitSeq: ReturnType<typeof CommitSeqSchema.make>,
): Promise<ReturnType<typeof appDocumentIdV1FromRowIdentity>> {
  const sourceRowId = relationBuildRowId(sourceOrdinal);
  const sourceDocumentId = appDocumentIdV1FromRowIdentity({
    tableId: binding.sourceTableId,
    rowId: sourceRowId,
  });
  const targetDocumentId = appDocumentIdV1FromRowIdentity({
    tableId: binding.targetTableId,
    rowId: targetRowId,
  });
  const sourcePaths = definitions.definitions.map((definition) => {
    const sourcePath = definition.edge.physical.sourcePath[0];
    if (sourcePath === undefined) {
      throw new Error("Expected one PostgreSQL exact relation source field.");
    }
    return sourcePath.name;
  });
  const sourceFields = Object.freeze(Object.fromEntries(
    sourcePaths.map(name => [name, targetDocumentId]),
  ));
  const sourceCreationTime = decodeAppCreationTimeV1(sourceOrdinal);
  const final = await canonicalizeAppDocumentV1({
    tableId: binding.sourceTableId,
    rowId: sourceRowId,
    creationTime: sourceCreationTime,
    fields: sourceFields,
  });
  const targetCreationTime = decodeAppCreationTimeV1(40_101);
  const target = commitSeq === 1n
    ? await canonicalizeAppDocumentV1({
        tableId: binding.targetTableId,
        rowId: targetRowId,
        creationTime: targetCreationTime,
        fields: { name: "PostgreSQL natural relation target" },
      })
    : null;
  const transitions = Object.freeze([
    ...(target === null
      ? []
      : [Object.freeze({
          documentId: targetDocumentId,
          tableId: binding.targetTableId,
          rowId: targetRowId,
          prior: null,
          final: target,
        })]),
    Object.freeze({
      documentId: sourceDocumentId,
      tableId: binding.sourceTableId,
      rowId: sourceRowId,
      prior: null,
      final,
    }),
  ]);
  const prepared = Result.getOrThrow(prepareApplicationRelationCommitResult(
    definitions,
    transitions,
  ));
  await fixture.target.drizzle.transaction(async tx => {
    for (const transition of transitions) {
      const document = transition.final;
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: fixture.scopeId,
        tableId: transition.tableId,
        rowId: transition.rowId,
        writeEpoch: fixture.epoch,
        commitSeq,
        prevCommitSeq: null,
        schemaVersionId: publication.binding.schemaVersionId,
        creationTime: transition.documentId === targetDocumentId
          ? targetCreationTime
          : sourceCreationTime,
        value: {
          codecVersion: document.codecVersion,
          valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes,
          sha256: document.sha256,
        },
      });
    }
    await runEffect(applyApplicationRelationCommitEdgesInTransactionEffect(
      fixture.relationCommit,
      tx,
      {
        scopeId: fixture.scopeId,
        schemaVersionId: publication.binding.schemaVersionId,
        commitSeq,
        prepared,
      },
    ));
    const advanced = await tx.update(fxSystemScopeClocks).set({
      lastCommitSeq: commitSeq,
      updatedAt: new Date(),
    }).where(and(
      eq(fxSystemScopeClocks.scopeId, fixture.scopeId),
      eq(
        fxSystemScopeClocks.lastCommitSeq,
        CommitSeqSchema.make(commitSeq - 1n),
      ),
    )).returning({ lastCommitSeq: fxSystemScopeClocks.lastCommitSeq });
    if (advanced.length !== 1 || advanced[0]?.lastCommitSeq !== commitSeq) {
      throw new Error(
        "Expected one PostgreSQL exact relation source commit sequence.",
      );
    }
  });
  return sourceDocumentId;
}

function relationFoldUuidSequence(
  ...sequences: ReadonlyArray<number>
): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) {
      throw new Error("PostgreSQL relation UUID sequence exhausted.");
    }
    index += 1;
    return `40000000-0000-4000-8000-${sequence
      .toString()
      .padStart(12, "0")}`;
  };
}
