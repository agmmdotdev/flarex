/// <reference types="@cloudflare/workers-types" />

import { Effect, Result, Scope } from "effect";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import {
  applyApplicationManagedSchemaPlan,
  claimPreparedApplicationManagedSchemaPlanResult,
  makeApplicationManagedSchemaApplicationLayer,
  makeApplicationManagedSchemaPlanningLayer,
  prepareApplicationManagedSchemaPlan,
  ApplicationManagedSchemaApplyError,
  ApplicationManagedSchemaPlanCompositionError,
  type ApplyApplicationManagedSchemaPlanResult,
  type PreparedApplicationManagedSchemaPlan,
  type PrepareApplicationManagedSchemaPlanInput,
} from "@flarex/standard-application-registration/application";
import {
  makeApplicationAnalysisContext,
} from "@flarex/source-analyzer-v2/internal/application-analysis-composition";
import {
  applicationAnalysisHostEffectWithCapabilities,
} from "@flarex/source-analyzer-v2/internal/application-analysis-host";
import {
  produceStandardApplicationSource,
} from "@flarex/standard-application-definition/application-source";
import {
  prepareStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import {
  createApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationAnalysis,
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationFixtureOptions,
  type ApplicationNativeMutationPersistence,
  type ApplicationNativeMutationRegisteredRevision,
  type ApplicationNativeMutationSourceBundle,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  advanceAppSchemaCandidateValidationEffect,
  createAppSchemaCandidateValidationPort,
  createLocatedAppSchemaCandidateValidationTarget,
  installAppSchemaCandidateValidationEffect,
  loadAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from
  "@flarex/persistence-postgres/internal/app-schema-candidate-validation";
import {
  LocatedReadCommittedTransactionFailureV1,
} from
  "@flarex/persistence-postgres/internal/system-test/transactionSessionAttemptKernel";
import {
  ApplicationManagedSchemaApplicationError,
  createApplicationManagedSchemaApplicationPort,
} from
  "@flarex/persistence-postgres/internal/application-managed-schema-application";
import {
  ApplicationManagedSchemaPlanningError,
  createApplicationManagedSchemaPlanningPort,
} from
  "@flarex/persistence-postgres/internal/application-managed-schema-planning";
import { fxSystemScopeClocks } from
  "@flarex/persistence-postgres/internal/system-test/schema";
import { PointCommitStaleAuthorityV1Error } from
  "@flarex/persistence-postgres/point-commit-transaction";
import type { ScopePhysicalLocator } from
  "@flarex/persistence-postgres/internal/system-test/scopeMetadataTypes";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  ApplicationMutationSystem,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { PointMutationOccUserCodeV1Error } from
  "@flarex/executor/internal/stored-attempt-authentication-v1";
import {
  ApplicationQuerySystem,
  makeApplicationQuerySystemLayer,
} from
  "@flarex/standard-application-invocation/internal/application-query-system";
import {
  invokeStandardApplicationPointMutationV1,
  invokeStandardApplicationPointQueryV1,
} from "@flarex/standard-application-invocation/v1";
import {
  APPLICATION_RUNTIME_HOST_IDENTITY,
} from "flarex-backend/artifact-runtime";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  ApplicationAnalysisSourceReadError,
  type ApplicationAnalysisSourceBundle,
} from "flarex-backend/internal/application-analysis-source-reader";
import { makeApplicationExecutionHost } from
  "flarex-backend/internal/application-execution-host";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import { ValidatorValueErrorV1 } from "flarex-protocol/validator-engine";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { ScopeEpochSchema } from "flarex-protocol/storage-authority";

import {
  makeApplicationNativeMutationTestLayer,
} from "./applicationNativeMutationHarness";
import {
  MiniflareApplicationWorkerLoader,
} from "./applicationNativeQueryHarness";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

const COMPATIBILITY_DATE = "2026-06-14";

export interface ManagedSchemaCookingSchemaAProof {
  readonly analyzedWithTwoColdLoads: true;
  readonly activatedSchemaA: true;
  readonly mutationPublished: true;
  readonly exactReplay: true;
  readonly queryReadCommittedDocument: true;
  readonly runtimeWorkerLoads: 2;
  readonly commitCount: 1;
  readonly outcomeCount: 1;
  readonly feedCount: 1;
  readonly outboxCount: 1;
}

export interface ManagedSchemaCookingSchemaBProof {
  readonly plannedManagedValidation: true;
  readonly applyRejectedCopiedHandle: true;
  readonly applyRejectedForeignTarget: true;
  readonly applyRejectedStaleFrontier: true;
  readonly applyDrovePhysicalBuild: true;
  readonly applyObservedActiveCandidate: true;
  readonly applyDidNotMislabelStaleReplay: true;
  readonly populatedRemovalBlocked: true;
  readonly schemaAStayedActive: true;
  readonly remediatedThroughSchemaA: true;
  readonly activatedSchemaB: true;
  readonly schemaBRejectedRemovedArgument: true;
  readonly schemaBRejectedRemovedWrite: true;
  readonly finalDocumentConformsToSchemaB: true;
  readonly analysisWorkerLoads: 6;
  readonly runtimeWorkerLoads: 7;
  readonly commitCount: 3;
  readonly outcomeCount: 3;
  readonly feedCount: 3;
  readonly outboxCount: 3;
}

export interface ManagedSchemaBlockedApplyProof {
  readonly blockedPlanStayedNonApplicable: true;
  readonly candidateValidationWasNotInstalled: true;
  readonly activeSchemaStayedExact: true;
}

export interface ManagedSchemaCookingSchemaCProof {
  readonly plannedRequiredFieldValidation: true;
  readonly missingRequiredFieldBlocked: true;
  readonly schemaBStayedActive: true;
  readonly backfilledThroughSchemaB: true;
  readonly activatedSchemaC: true;
  readonly schemaCRejectedMissingSlugArgument: true;
  readonly finalDocumentsConformToSchemaC: true;
  readonly analysisWorkerLoads: 10;
  readonly runtimeWorkerLoads: 12;
  readonly commitCount: 5;
  readonly outcomeCount: 5;
  readonly feedCount: 5;
  readonly outboxCount: 5;
}

export interface ManagedSchemaCookingSchemaDProof {
  readonly plannedNestedValidatorValidation: true;
  readonly nestedValidatorBlocked: true;
  readonly failureEvidenceWasPathOnly: true;
  readonly schemaCStayedActive: true;
  readonly remediatedThroughSchemaC: true;
  readonly activatedSchemaD: true;
  readonly schemaDRejectedInvalidNestedArgument: true;
  readonly finalDocumentsConformToSchemaD: true;
  readonly analysisWorkerLoads: 14;
  readonly runtimeWorkerLoads: 16;
  readonly commitCount: 6;
  readonly outcomeCount: 6;
  readonly feedCount: 6;
  readonly outboxCount: 6;
}

export interface ManagedSchemaCookingSchemaEProof {
  readonly plannedConcurrentWriteValidation: true;
  readonly pausedAfterNonNullCursor: true;
  readonly candidateValidCommitPreservedProgress: true;
  readonly candidateInvalidCommitPublished: true;
  readonly candidateInvalidCommitFailedValidationAtomically: true;
  readonly failureEvidenceWasPathOnly: true;
  readonly schemaDStayedActive: true;
  readonly finalWritesVisibleThroughSchemaD: true;
  readonly analysisWorkerLoads: 16;
  readonly runtimeWorkerLoads: 20;
  readonly commitCount: 8;
  readonly outcomeCount: 8;
  readonly feedCount: 8;
  readonly outboxCount: 8;
}

export interface ManagedSchemaCookingSchemaFProof {
  readonly supersededCandidate: true;
  readonly exactCandidateReplay: true;
  readonly decisionUncertaintyColdReplayed: true;
  readonly confirmedRollbackPreservedHead: true;
  readonly concurrentActivationConverged: true;
  readonly corruptionRejectedCold: true;
  readonly activeSchemaSurvivedCandidateCorruption: true;
  readonly candidateHeadCount: 1;
  readonly activationCount: 5;
  readonly activeHeadCount: 1;
  readonly analysisWorkerLoads: 18;
  readonly runtimeWorkerLoads: 18;
  readonly commitCount: 6;
  readonly outcomeCount: 6;
  readonly feedCount: 6;
  readonly outboxCount: 6;
}

export interface ManagedSchemaCookingSchemaGProof {
  readonly attemptStartedUnderSchemaF: true;
  readonly replacementActivatedBeforePublication: true;
  readonly staleAttemptRejected: true;
  readonly staleAttemptLeftPublicationUnchanged: true;
  readonly staleAttemptLeftApplicationStorageUnchanged: true;
  readonly candidateReceiptStayedExact: true;
  readonly ordinaryRetrySelectedSchemaG: true;
  readonly ordinaryRetryPublishedExactlyOnce: true;
  readonly finalDocumentConformsToSchemaG: true;
  readonly candidateHeadCount: 1;
  readonly activationCount: 6;
  readonly activeHeadCount: 1;
  readonly analysisWorkerLoads: 18;
  readonly runtimeWorkerLoads: 19;
  readonly commitCount: 7;
  readonly outcomeCount: 7;
  readonly feedCount: 7;
  readonly outboxCount: 7;
}

export type ManagedSchemaCookingFixtureFactory = (
  options: ApplicationNativeMutationFixtureOptions,
) => Promise<
  ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>
>;

export async function proveManagedSchemaCookingSchemaA(
  createFixture: ManagedSchemaCookingFixtureFactory = options =>
    createApplicationNativeMutationPGliteFixture(options),
): Promise<
  ManagedSchemaCookingSchemaAProof
> {
  return withCookingScenario(createFixture, async scenario => {
    await establishCookingSchemaABaseline(scenario);
    return Object.freeze({
      analyzedWithTwoColdLoads: true,
      activatedSchemaA: true,
      mutationPublished: true,
      exactReplay: true,
      queryReadCommittedDocument: true,
      runtimeWorkerLoads: 2,
      commitCount: 1,
      outcomeCount: 1,
      feedCount: 1,
      outboxCount: 1,
    });
  });
}

export async function proveManagedSchemaCookingSchemaB(
  createFixture: ManagedSchemaCookingFixtureFactory = options =>
    createApplicationNativeMutationPGliteFixture(options),
): Promise<ManagedSchemaCookingSchemaBProof> {
  return withCookingScenario(createFixture, async scenario => {
    const state = await establishCookingSchemaB(scenario);
    await proveCrossTargetPlanningRejection(
      scenario,
      state.activePublication,
      state.candidateManifest,
    );
    await scenario.fixture.target.drizzle.update(fxSystemScopeClocks).set({
      epoch: ScopeEpochSchema.make("22222222-2222-4222-8222-222222222222"),
    }).where(eq(
      fxSystemScopeClocks.scopeId,
      scenario.fixture.authority.scopeId,
    ));
    const changedAuthority = await runSystemTestEffectV1(Effect.result(
      prepareApplicationManagedSchemaPlan({
        candidatePublication: state.activePublication,
      }).pipe(Effect.provide(
        makeApplicationManagedSchemaPlanningLayer(
          scenario.fixture.managedSchemaPlanning,
        ),
      )),
    ));
    if (Result.isSuccess(changedAuthority) ||
      !hasTaggedReason(
        changedAuthority.failure,
        "ApplicationReadinessError",
        "authorityChanged",
      )) {
      throw new Error(
        `Managed-schema planning accepted changed scope authority: ${
          Result.isSuccess(changedAuthority)
            ? "success"
            : failureIdentity(changedAuthority.failure)
        }.`,
      );
    }
    return state.proof;
  });
}

export async function proveManagedSchemaBlockedPlanDoesNotApply(
  createFixture: ManagedSchemaCookingFixtureFactory = options =>
    createApplicationNativeMutationPGliteFixture(options),
): Promise<ManagedSchemaBlockedApplyProof> {
  return withCookingScenario(createFixture, async scenario => {
    const source = await cookingSourceBundle("BLOCKED");
    scenario.sources.set(source.sourceArtifact.rootSha256, source);
    const candidate = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:blocked-table-replacement",
      analysis: cookingAnalysis(
        source,
        scenario.analysisLoader,
        "blocked table replacement",
      ),
    });
    const schema = await scenario.fixture.publishManagedSchemaCandidate(
      candidate.manifest,
    );
    const prepared = await prepareManagedSchemaPlan(
      scenario,
      candidate.publication,
    );
    if (prepared.plan.disposition !== "blocked") {
      throw new Error("Managed-schema replacement candidate was not blocked.");
    }
    const applied = await runSystemTestEffectV1(
      applyApplicationManagedSchemaPlan({
        prepared: prepared.prepared,
      }).pipe(Effect.provide(
        makeApplicationManagedSchemaApplicationLayer(
          scenario.fixture.managedSchemaPlanning,
          scenario.fixture.managedSchemaApplication,
        ),
      )),
    );
    if (applied.status !== "blocked" || applied.reason !== "planBlocked") {
      throw new Error("Managed-schema blocked plan became applicable.");
    }
    const validation = await runSystemTestEffectV1(Effect.result(
      loadAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        {
          deploymentId: scenario.fixture.deploymentId,
          schemaVersionId: schema.schemaVersionId,
        },
      ),
    ));
    const active = await runSystemTestEffectV1(
      scenario.fixture.activation.readActive(),
    );
    const validationWasNotInstalled = Result.isFailure(validation) &&
      hasTaggedReason(
        validation.failure,
        "AppSchemaCandidateValidationOperationV1Error",
        "superseded",
      );
    if (!validationWasNotInstalled ||
      active.basis.revisionId !== scenario.fixture.active.basis.revisionId) {
      throw new Error("Blocked plan changed managed-schema authority.");
    }
    return Object.freeze({
      blockedPlanStayedNonApplicable: true,
      candidateValidationWasNotInstalled: true,
      activeSchemaStayedExact: true,
    });
  });
}

async function establishCookingSchemaB(scenario: CookingScenario) {
    const baseline = await establishCookingSchemaABaseline(scenario);
    const withoutDescription = await scenario.mutation(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:create"),
        { name: "Mohinga" },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-a:create-without-description",
        ),
      ),
    );
    if (withoutDescription.disposition !== "published" ||
      typeof withoutDescription.value !== "string") {
      throw new Error("Cooking schema A did not seed its optional-field row.");
    }

    const schemaBSource = await cookingSourceBundle("B");
    scenario.sources.set(
      schemaBSource.sourceArtifact.rootSha256,
      schemaBSource,
    );
    const firstSchemaB = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-b:first",
      analysis: cookingAnalysis(
        schemaBSource,
        scenario.analysisLoader,
        "schema B",
      ),
    });
    const priorValidation = await Effect.runPromise(
      scenario.fixture.readiness.settle({
        deploymentId: scenario.fixture.deploymentId,
        revisionId: firstSchemaB.publication.revisionId,
      }),
    );
    if (priorValidation.status !== "not_ready" ||
      priorValidation.reason !== "candidateValidationWrongSchema") {
      const detail = priorValidation.status === "not_ready"
        ? `${priorValidation.status}:${priorValidation.reason}`
        : priorValidation.status;
      throw new Error(
        `Cooking schema B did not reject schema A validation evidence: ${detail}.`,
      );
    }
    const schemaB = await scenario.fixture.publishManagedSchemaCandidate(
      firstSchemaB.manifest,
    );
    const restorePublication = await scenario.fixture
      .corruptApplicationPublicationSchemaSha256ForTest(
        firstSchemaB.publication,
      );
    try {
      const corrupted = await runSystemTestEffectV1(Effect.result(
        prepareApplicationManagedSchemaPlan({
          candidatePublication: firstSchemaB.publication,
        }).pipe(Effect.provide(
          makeApplicationManagedSchemaPlanningLayer(
            scenario.fixture.managedSchemaPlanning,
          ),
        )),
      ));
      if (Result.isSuccess(corrupted) ||
        !(corrupted.failure instanceof ApplicationManagedSchemaPlanningError) ||
        corrupted.failure.reason !== "candidatePublicationChanged") {
        throw new Error(
          "Managed-schema planning accepted changed publication evidence.",
        );
      }
    } finally {
      await restorePublication();
    }
    const preparedPlan = await prepareManagedSchemaPlan(
      scenario,
      firstSchemaB.publication,
    );
    const plan = preparedPlan.plan;
    if (plan.disposition !== "managedBuildAndValidation" ||
      !plan.operations.some(operation =>
        operation.safetyClass === "requiresDataValidation" &&
        operation.change.kind === "tableValidatorChanged"
      ) ||
      !plan.operations.some(operation =>
        operation.safetyClass === "requiresPhysicalWork" &&
        operation.change.kind === "indexAdded"
      )) {
      throw new Error(
        "Cooking schema B did not produce managed validation and build work.",
      );
    }

    const validationInput = {
      deploymentId: scenario.fixture.deploymentId,
      schemaVersionId: schemaB.schemaVersionId,
    } as const;
    const copiedApply = await runSystemTestEffectV1(Effect.result(
      applyApplicationManagedSchemaPlan({
        prepared: { ...preparedPlan.prepared },
      }).pipe(Effect.provide(
        makeApplicationManagedSchemaApplicationLayer(
          scenario.fixture.managedSchemaPlanning,
          scenario.fixture.managedSchemaApplication,
        ),
      )),
    ));
    if (Result.isSuccess(copiedApply) ||
      !(copiedApply.failure instanceof
        ApplicationManagedSchemaPlanCompositionError) ||
      copiedApply.failure.reason !== "invalidPreparedPlan") {
      throw new Error("Managed-schema apply accepted a copied plan handle.");
    }
    const wrongTargetApplication = createApplicationManagedSchemaApplicationPort({
      deploymentId: scenario.fixture.deploymentId,
      controlDb: scenario.fixture.control.drizzle,
      targetDb: scenario.fixture.control.drizzle,
      authority: scenario.fixture.authorityPorts,
      activation: scenario.fixture.activation,
      candidateValidation: scenario.fixture.candidateValidation,
      planning: scenario.fixture.managedSchemaPlanning,
    });
    const wrongTargetApply = await runSystemTestEffectV1(Effect.result(
      applyApplicationManagedSchemaPlan({
        prepared: preparedPlan.prepared,
      }).pipe(Effect.provide(
        makeApplicationManagedSchemaApplicationLayer(
          scenario.fixture.managedSchemaPlanning,
          wrongTargetApplication,
        ),
      )),
    ));
    if (Result.isSuccess(wrongTargetApply) ||
      !(wrongTargetApply.failure instanceof
        ApplicationManagedSchemaApplicationError) ||
      wrongTargetApply.failure.reason !== "invalidComposition") {
      throw new Error("Managed-schema apply accepted a foreign target DB.");
    }
    const failedApply = await applyManagedSchemaPlanUntilTerminal(
      scenario,
      preparedPlan.prepared,
    );
    if (failedApply.status !== "requires_remediation" ||
      failedApply.reason !== "candidateValidationFailed") {
      throw new Error("Cooking schema B apply did not require remediation.");
    }
    const loadedFailure = await runSystemTestEffectV1(
      loadAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        validationInput,
      ),
    );
    if (loadedFailure.status !== "present") {
      throw new Error("Cooking schema B apply omitted candidate failure state.");
    }
    const failed = loadedFailure;
    if (failed.head.frame.kind !==
        "app_schema_candidate_validation_failure_evidence" ||
      !failed.head.frame.entries.some(entry =>
        entry.reason === "candidateValidatorRejected" &&
        entry.validatorPath === "$document.description"
      )) {
      throw new Error("Cooking schema B omitted bounded description evidence.");
    }
    const failedReadiness = await Effect.runPromise(
      scenario.fixture.readiness.settle({
        deploymentId: scenario.fixture.deploymentId,
        revisionId: firstSchemaB.publication.revisionId,
      }),
    );
    if (failedReadiness.status !== "not_ready" ||
      failedReadiness.reason !== "candidateValidationFailed") {
      throw new Error("Cooking schema B failure did not block readiness.");
    }
    const activationAttempt = await Effect.runPromise(Effect.result(
      scenario.fixture.activation.activate({
        revisionId: firstSchemaB.publication.revisionId,
        expectedActiveHead: scenario.fixture.active.expectedActiveHead,
      }),
    ));
    const activationBlocked = Result.isFailure(activationAttempt) &&
      isNonArrayRecord(activationAttempt.failure) &&
      activationAttempt.failure._tag === "ApplicationActivationError" &&
      activationAttempt.failure.reason === "notReady";
    if (!activationBlocked) {
      throw new Error("Cooking schema B activation did not fail closed.");
    }
    const stillSchemaA = await Effect.runPromise(
      scenario.fixture.activation.readActive(),
    );
    if (stillSchemaA.basis.revisionId !==
      scenario.fixture.active.basis.revisionId) {
      throw new Error("Rejected cooking schema B replaced schema A.");
    }
    const stillReadable = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: baseline.recipeId },
      ),
    );
    if (!isCookingRecipe(stillReadable) ||
      stillReadable.description !== "A bright, crunchy salad.") {
      throw new Error("Schema A stopped serving after schema B failed.");
    }

    const remediated = await scenario.mutation(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:removeDescription"),
        { id: baseline.recipeId },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-a:remove-description",
        ),
      ),
    );
    if (remediated.disposition !== "published" ||
      remediated.value !== true) {
      throw new Error("Schema A did not remove the description normally.");
    }
    const staleApply = await runSystemTestEffectV1(Effect.result(
      applyApplicationManagedSchemaPlan({
        prepared: preparedPlan.prepared,
      }).pipe(Effect.provide(
        makeApplicationManagedSchemaApplicationLayer(
          scenario.fixture.managedSchemaPlanning,
          scenario.fixture.managedSchemaApplication,
        ),
      )),
    ));
    if (Result.isSuccess(staleApply) ||
      !(staleApply.failure instanceof ApplicationManagedSchemaApplyError) ||
      staleApply.failure.reason !== "stalePlan") {
      throw new Error("Cooking schema B apply accepted a stale data frontier.");
    }

    const retriedSchemaB = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-b:retry",
      analysis: cookingAnalysis(
        schemaBSource,
        scenario.analysisLoader,
        "schema B retry",
      ),
    });
    const initialClaim = claimPreparedApplicationManagedSchemaPlanResult(
      preparedPlan.prepared,
      scenario.fixture.managedSchemaPlanning,
    );
    if (Result.isFailure(initialClaim) ||
      initialClaim.success.candidatePublication !== firstSchemaB.publication ||
      initialClaim.success.candidatePublication === retriedSchemaB.publication) {
      throw new Error(
        "Managed-schema prepared authority did not retain the exact publication.",
      );
    }
    const retriedPreparedPlan = await prepareManagedSchemaPlan(
      scenario,
      firstSchemaB.publication,
    );
    if (preparedPlan.plan.planSha256Hex ===
        retriedPreparedPlan.plan.planSha256Hex) {
      throw new Error("Managed-schema frontier movement did not change the plan.");
    }
    const applyPhases = new Set<string>();
    const applied = await applyManagedSchemaPlanUntilTerminal(
      scenario,
      retriedPreparedPlan.prepared,
      applyPhases,
    );
    if (applied.status !== "activated" || !applyPhases.has("physicalBuild")) {
      throw new Error("Remediated cooking schema B apply did not activate.");
    }
    const staleConvergedApply = await applyManagedSchemaPlanUntilTerminal(
      scenario,
      preparedPlan.prepared,
    );
    if (staleConvergedApply.status !== "already_active" ||
      staleConvergedApply.activationSequence !== applied.activationSequence ||
      "planSha256Hex" in staleConvergedApply) {
      throw new Error("Stale managed-schema plan was mislabeled as exact replay.");
    }
    const convergedApply = await applyManagedSchemaPlanUntilTerminal(
      scenario,
      retriedPreparedPlan.prepared,
    );
    if (convergedApply.status !== "already_active" ||
      convergedApply.activationSequence !== applied.activationSequence) {
      throw new Error("Managed-schema apply did not observe the active candidate.");
    }
    const activeSchemaB = await Effect.runPromise(
      scenario.fixture.activation.readActive(),
    );
    if (activeSchemaB.basis.revisionId !==
        firstSchemaB.publication.revisionId ||
      activeSchemaB.basis.schemaVersionId !== schemaB.schemaVersionId) {
      throw new Error("Cooking schema B active authority is inconsistent.");
    }
    const removedArgumentResult = await scenario.mutation(Effect.result(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:create"),
        { name: "Invalid salad", description: "must not return" },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-b:removed-field",
        ),
      ),
    ));
    const removedArgumentRejected = Result.match(removedArgumentResult, {
      onFailure: failure => failure instanceof ValidatorValueErrorV1 &&
        failure.issue.reason === "unexpectedField" &&
        failure.issue.path === "$args.description" &&
        failure.issue.field === "description",
      onSuccess: () => false,
    });
    if (!removedArgumentRejected) {
      throw new Error(
        "Cooking schema B did not reject the removed description argument exactly.",
      );
    }
    const countsBeforeRejectedWrite = await durableCounts(scenario.fixture);
    const removedWriteResult = await scenario.mutation(Effect.result(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:writeRemovedDescription"),
        { id: baseline.recipeId },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-b:removed-write",
        ),
      ),
    ));
    const removedWriteRejected = Result.match(removedWriteResult, {
      onFailure: failure =>
        failure instanceof PointMutationOccUserCodeV1Error &&
        failure.cause instanceof Error &&
        failure.cause.name === "ApplicationWorkerUserCodeV1Error" &&
        failure.cause.message === "ApplicationWorkerUserCodeV1Error",
      onSuccess: () => false,
    });
    if (!removedWriteRejected) {
      throw new Error(
        "Cooking schema B journal did not reject the removed description write.",
      );
    }
    const countsAfterRejectedWrite = await durableCounts(scenario.fixture);
    if (countsAfterRejectedWrite.commits !== countsBeforeRejectedWrite.commits ||
      countsAfterRejectedWrite.outcomes !== countsBeforeRejectedWrite.outcomes ||
      countsAfterRejectedWrite.feed !== countsBeforeRejectedWrite.feed ||
      countsAfterRejectedWrite.outbox !== countsBeforeRejectedWrite.outbox) {
      throw new Error(
        "Cooking schema B forbidden write changed durable commit projections.",
      );
    }
    const finalRecipe = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: baseline.recipeId },
      ),
    );
    if (!isCookingRecipe(finalRecipe) ||
      finalRecipe.name !== "Tea leaf salad" ||
      finalRecipe.description !== undefined) {
      throw new Error("Cooking schema B returned a nonconforming document.");
    }
    const counts = await durableCounts(scenario.fixture);
    if (scenario.analysisLoader.loads !== 6 ||
      scenario.runtimeLoader.loads !== 7 ||
      counts.commits !== 3 || counts.outcomes !== 3 || counts.feed !== 3 ||
      counts.outbox !== 3) {
      throw new Error("Cooking schema B observed unexpected durable counts.");
    }
    const proof = Object.freeze({
      plannedManagedValidation: true,
      applyRejectedCopiedHandle: true,
      applyRejectedForeignTarget: true,
      applyRejectedStaleFrontier: true,
      applyDrovePhysicalBuild: true,
      applyObservedActiveCandidate: true,
      applyDidNotMislabelStaleReplay: true,
      populatedRemovalBlocked: true,
      schemaAStayedActive: true,
      remediatedThroughSchemaA: true,
      activatedSchemaB: true,
      schemaBRejectedRemovedArgument: true,
      schemaBRejectedRemovedWrite: true,
      finalDocumentConformsToSchemaB: true,
      analysisWorkerLoads: 6,
      runtimeWorkerLoads: 7,
      commitCount: 3,
      outcomeCount: 3,
      feedCount: 3,
      outboxCount: 3,
    } satisfies ManagedSchemaCookingSchemaBProof);
    return Object.freeze({
      baseline,
      secondRecipeId: withoutDescription.value,
      schemaB,
      activeSchemaB,
      activePublication: firstSchemaB.publication,
      candidateManifest: firstSchemaB.manifest,
      proof,
    });
}

export async function proveManagedSchemaCookingSchemaC(
  createFixture: ManagedSchemaCookingFixtureFactory = options =>
    createApplicationNativeMutationPGliteFixture(options),
): Promise<ManagedSchemaCookingSchemaCProof> {
  return withCookingScenario(createFixture, async scenario =>
    (await establishCookingSchemaC(scenario)).proof
  );
}

async function establishCookingSchemaC(scenario: CookingScenario) {
    const schemaBState = await establishCookingSchemaB(scenario);
    const staleCandidate = await runSystemTestEffectV1(Effect.result(
      prepareApplicationManagedSchemaPlan({
        candidatePublication: schemaBState.activePublication,
      }).pipe(Effect.provide(
        makeApplicationManagedSchemaPlanningLayer(
          scenario.fixture.managedSchemaPlanning,
        ),
      )),
    ));
    if (Result.isSuccess(staleCandidate) ||
      !(staleCandidate.failure instanceof ApplicationManagedSchemaPlanningError) ||
      staleCandidate.failure.reason !== "candidateAlreadyActive") {
      throw new Error("Managed-schema planning accepted the active revision as a candidate.");
    }
    const schemaCSource = await cookingSourceBundle("C");
    scenario.sources.set(
      schemaCSource.sourceArtifact.rootSha256,
      schemaCSource,
    );
    const firstSchemaC = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-c:first",
      analysis: cookingAnalysis(
        schemaCSource,
        scenario.analysisLoader,
        "schema C",
      ),
    });
    const priorValidation = await Effect.runPromise(
      scenario.fixture.readiness.settle({
        deploymentId: scenario.fixture.deploymentId,
        revisionId: firstSchemaC.publication.revisionId,
      }),
    );
    if (priorValidation.status !== "not_ready" ||
      priorValidation.reason !== "candidateValidationWrongSchema") {
      throw new Error(
        "Cooking schema C did not reject schema B validation evidence.",
      );
    }
    const schemaC = await scenario.fixture.preparePublishedSchema(
      firstSchemaC.manifest,
    );
    const { plan } = await prepareManagedSchemaPlan(
      scenario,
      firstSchemaC.publication,
    );
    if (plan.disposition !== "managedBuildAndValidation" ||
      !plan.operations.some(operation =>
        operation.safetyClass === "requiresDataValidation" &&
        operation.change.kind === "tableValidatorChanged"
      )) {
      throw new Error(
        "Cooking schema C did not produce a required-field validation plan.",
      );
    }

    const validationInput = {
      deploymentId: scenario.fixture.deploymentId,
      schemaVersionId: schemaC.schemaVersionId,
    } as const;
    await Effect.runPromise(installAppSchemaCandidateValidationEffect(
      scenario.fixture.candidateValidation,
      validationInput,
    ));
    const failed = await advanceUntilCandidateFailure(
      scenario.fixture,
      validationInput,
      "schema C",
    );
    if (failed.head.frame.kind !==
        "app_schema_candidate_validation_failure_evidence" ||
      !failed.head.frame.entries.some(entry =>
        entry.reason === "candidateValidatorRejected" &&
        entry.validatorPath === "$document.slug"
      )) {
      throw new Error("Cooking schema C omitted bounded slug evidence.");
    }
    const blockedReadiness = await Effect.runPromise(
      scenario.fixture.readiness.settle({
        deploymentId: scenario.fixture.deploymentId,
        revisionId: firstSchemaC.publication.revisionId,
      }),
    );
    if (blockedReadiness.status !== "not_ready" ||
      blockedReadiness.reason !== "candidateValidationFailed") {
      throw new Error("Cooking schema C failure did not block readiness.");
    }
    const activationAttempt = await Effect.runPromise(Effect.result(
      scenario.fixture.activation.activate({
        revisionId: firstSchemaC.publication.revisionId,
        expectedActiveHead: schemaBState.activeSchemaB.expectedActiveHead,
      }),
    ));
    const activationBlocked = Result.match(activationAttempt, {
      onFailure: failure => isNonArrayRecord(failure) &&
        failure._tag === "ApplicationActivationError" &&
        failure.reason === "notReady",
      onSuccess: () => false,
    });
    if (!activationBlocked) {
      throw new Error("Cooking schema C activation did not fail closed.");
    }
    const stillSchemaB = await Effect.runPromise(
      scenario.fixture.activation.readActive(),
    );
    if (stillSchemaB.basis.revisionId !==
      schemaBState.activeSchemaB.basis.revisionId) {
      throw new Error("Rejected cooking schema C replaced schema B.");
    }
    const stillReadable = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaBState.baseline.recipeId },
      ),
    );
    if (!isCookingRecipe(stillReadable) || stillReadable.slug !== undefined) {
      throw new Error("Schema B stopped serving after schema C failed.");
    }

    for (const [recipeId, slug, difficulty, requestKey] of [
      [
        schemaBState.baseline.recipeId,
        "tea-leaf-salad",
        "easy",
        "managed-schema:cooking:schema-b:backfill-tea-leaf-salad",
      ],
      [
        schemaBState.secondRecipeId,
        "mohinga",
        "expert",
        "managed-schema:cooking:schema-b:backfill-mohinga",
      ],
    ] as const) {
      const backfilled = await scenario.mutation(
        invokeStandardApplicationPointMutationV1(
          TransactionFunctionPathV1Schema.make("recipes:addSlug"),
          { id: recipeId, slug, details: { difficulty, servings: 2 } },
          TransactionRequestKeyV1Schema.make(requestKey),
        ),
      );
      if (backfilled.disposition !== "published" || backfilled.value !== true) {
        throw new Error("Schema B did not backfill the required slug normally.");
      }
    }

    const retriedSchemaC = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-c:retry",
      analysis: cookingAnalysis(
        schemaCSource,
        scenario.analysisLoader,
        "schema C retry",
      ),
    });
    const restarted = await Effect.runPromise(
      installAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        validationInput,
      ),
    );
    if (restarted.disposition !== "restarted") {
      throw new Error("Cooking schema C validation did not restart.");
    }
    await settleReadyCandidateValidation(
      scenario.fixture,
      validationInput,
      "schema C",
    );
    const ready = await Effect.runPromise(scenario.fixture.readiness.settle({
      deploymentId: scenario.fixture.deploymentId,
      revisionId: retriedSchemaC.publication.revisionId,
    }));
    if (ready.status !== "ready") {
      throw new Error("Backfilled cooking schema C did not become ready.");
    }
    const activated = await Effect.runPromise(
      scenario.fixture.activation.activate({
        revisionId: retriedSchemaC.publication.revisionId,
        expectedActiveHead: stillSchemaB.expectedActiveHead,
      }),
    );
    if (activated.status !== "activated") {
      throw new Error("Backfilled cooking schema C did not activate.");
    }
    const activeSchemaC = await Effect.runPromise(
      scenario.fixture.activation.readActive(),
    );
    if (activeSchemaC.basis.revisionId !==
        retriedSchemaC.publication.revisionId ||
      activeSchemaC.basis.schemaVersionId !== schemaC.schemaVersionId) {
      throw new Error("Cooking schema C active authority is inconsistent.");
    }
    const missingSlugResult = await scenario.mutation(Effect.result(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:create"),
        { name: "Invalid schema C recipe" },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-c:missing-slug",
        ),
      ),
    ));
    const missingSlugRejected = Result.match(missingSlugResult, {
      onFailure: failure => failure instanceof ValidatorValueErrorV1 &&
        failure.issue.reason === "missingRequiredField" &&
        failure.issue.path === "$args.slug" &&
        failure.issue.field === "slug",
      onSuccess: () => false,
    });
    if (!missingSlugRejected) {
      throw new Error("Cooking schema C did not reject its missing slug argument.");
    }
    const teaLeafSalad = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaBState.baseline.recipeId },
      ),
    );
    const mohinga = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaBState.secondRecipeId },
      ),
    );
    if (!isCookingRecipe(teaLeafSalad) ||
      teaLeafSalad.slug !== "tea-leaf-salad" ||
      teaLeafSalad.details?.difficulty !== "easy" ||
      teaLeafSalad.details.servings !== 2 ||
      teaLeafSalad.description !== undefined ||
      !isCookingRecipe(mohinga) || mohinga.slug !== "mohinga" ||
      mohinga.details?.difficulty !== "expert" ||
      mohinga.details.servings !== 2 ||
      mohinga.description !== undefined) {
      throw new Error("Cooking schema C returned nonconforming documents.");
    }
    const counts = await durableCounts(scenario.fixture);
    if (scenario.analysisLoader.loads !== 10 ||
      scenario.runtimeLoader.loads !== 12 ||
      counts.commits !== 5 || counts.outcomes !== 5 || counts.feed !== 5 ||
      counts.outbox !== 5) {
      throw new Error("Cooking schema C observed unexpected durable counts.");
    }
    const proof = Object.freeze({
      plannedRequiredFieldValidation: true,
      missingRequiredFieldBlocked: true,
      schemaBStayedActive: true,
      backfilledThroughSchemaB: true,
      activatedSchemaC: true,
      schemaCRejectedMissingSlugArgument: true,
      finalDocumentsConformToSchemaC: true,
      analysisWorkerLoads: 10,
      runtimeWorkerLoads: 12,
      commitCount: 5,
      outcomeCount: 5,
      feedCount: 5,
      outboxCount: 5,
    } satisfies ManagedSchemaCookingSchemaCProof);
    return Object.freeze({
      schemaBState,
      schemaC,
      activeSchemaC,
      proof,
    });
}

export async function proveManagedSchemaCookingSchemaD(
  createFixture: ManagedSchemaCookingFixtureFactory = options =>
    createApplicationNativeMutationPGliteFixture(options),
): Promise<ManagedSchemaCookingSchemaDProof> {
  return withCookingScenario(createFixture, async scenario =>
    (await establishCookingSchemaD(scenario)).proof
  );
}

async function establishCookingSchemaD(scenario: CookingScenario) {
    const schemaCState = await establishCookingSchemaC(scenario);
    const schemaDSource = await cookingSourceBundle("D");
    scenario.sources.set(
      schemaDSource.sourceArtifact.rootSha256,
      schemaDSource,
    );
    const firstSchemaD = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-d:first",
      analysis: cookingAnalysis(
        schemaDSource,
        scenario.analysisLoader,
        "schema D",
      ),
    });
    const priorValidation = await Effect.runPromise(
      scenario.fixture.readiness.settle({
        deploymentId: scenario.fixture.deploymentId,
        revisionId: firstSchemaD.publication.revisionId,
      }),
    );
    if (priorValidation.status !== "not_ready" ||
      priorValidation.reason !== "candidateValidationWrongSchema") {
      throw new Error(
        "Cooking schema D did not reject schema C validation evidence.",
      );
    }
    const schemaD = await scenario.fixture.preparePublishedSchema(
      firstSchemaD.manifest,
    );
    const { plan } = await prepareManagedSchemaPlan(
      scenario,
      firstSchemaD.publication,
    );
    if (plan.disposition !== "managedBuildAndValidation" ||
      !plan.operations.some(operation =>
        operation.safetyClass === "requiresDataValidation" &&
        operation.change.kind === "tableValidatorChanged"
      ) ||
      !plan.incompatibilityEvidence.entries.some(evidence =>
        evidence.code === "candidateDocumentValidationRequired" &&
        evidence.logicalName === "recipes" &&
        evidence.validatorPath === "$document.details.difficulty"
      )) {
      throw new Error(
        "Cooking schema D did not plan nested-validator validation.",
      );
    }

    const validationInput = {
      deploymentId: scenario.fixture.deploymentId,
      schemaVersionId: schemaD.schemaVersionId,
    } as const;
    await Effect.runPromise(installAppSchemaCandidateValidationEffect(
      scenario.fixture.candidateValidation,
      validationInput,
    ));
    const failed = await advanceUntilCandidateFailure(
      scenario.fixture,
      validationInput,
      "schema D",
    );
    if (failed.head.frame.kind !==
      "app_schema_candidate_validation_failure_evidence") {
      throw new Error("Cooking schema D did not persist failure evidence.");
    }
    const recipesTable = schemaD.manifest.tableDefinitions.tables.find(
      table => table.logicalName === "recipes",
    );
    const failureEntry = failed.head.frame.entries.find(entry =>
      entry.reason === "candidateValidatorRejected" &&
      entry.validatorPath === "$document.details.difficulty"
    );
    const failureEntryKeys = failureEntry === undefined
      ? ""
      : Object.keys(failureEntry).sort().join(",");
    if (recipesTable === undefined || failureEntry === undefined ||
      failureEntry.tableId !== recipesTable.tableId ||
      failed.head.frame.entries.length !== 1 ||
      failed.head.frame.observedFailureCount !== 1n ||
      failed.head.frame.truncated ||
      failureEntryKeys !==
        "observedCommitSeq,reason,rowId,source,tableId,validatorPath" ||
      Object.values(failureEntry).some(value =>
        value === "Mohinga" || value === "mohinga" || value === "expert"
      )) {
      throw new Error(
        "Cooking schema D failure evidence was not bounded table/path-only evidence.",
      );
    }
    const blockedReadiness = await Effect.runPromise(
      scenario.fixture.readiness.settle({
        deploymentId: scenario.fixture.deploymentId,
        revisionId: firstSchemaD.publication.revisionId,
      }),
    );
    if (blockedReadiness.status !== "not_ready" ||
      blockedReadiness.reason !== "candidateValidationFailed") {
      throw new Error("Cooking schema D failure did not block readiness.");
    }
    const activationAttempt = await Effect.runPromise(Effect.result(
      scenario.fixture.activation.activate({
        revisionId: firstSchemaD.publication.revisionId,
        expectedActiveHead: schemaCState.activeSchemaC.expectedActiveHead,
      }),
    ));
    const activationBlocked = Result.match(activationAttempt, {
      onFailure: failure => isNonArrayRecord(failure) &&
        failure._tag === "ApplicationActivationError" &&
        failure.reason === "notReady",
      onSuccess: () => false,
    });
    if (!activationBlocked) {
      throw new Error("Cooking schema D activation did not fail closed.");
    }
    const stillSchemaC = await Effect.runPromise(
      scenario.fixture.activation.readActive(),
    );
    if (stillSchemaC.basis.revisionId !==
      schemaCState.activeSchemaC.basis.revisionId) {
      throw new Error("Rejected cooking schema D replaced schema C.");
    }
    const stillReadable = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaCState.schemaBState.secondRecipeId },
      ),
    );
    if (!isCookingRecipe(stillReadable) ||
      stillReadable.details?.difficulty !== "expert") {
      throw new Error("Schema C stopped serving after schema D failed.");
    }

    const remediated = await scenario.mutation(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:addSlug"),
        {
          id: schemaCState.schemaBState.secondRecipeId,
          slug: "mohinga",
          details: { difficulty: "easy", servings: 2 },
        },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-c:remediate-nested-difficulty",
        ),
      ),
    );
    if (remediated.disposition !== "published" || remediated.value !== true) {
      throw new Error("Schema C did not remediate nested difficulty normally.");
    }

    const retriedSchemaD = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-d:retry",
      analysis: cookingAnalysis(
        schemaDSource,
        scenario.analysisLoader,
        "schema D retry",
      ),
    });
    const restarted = await Effect.runPromise(
      installAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        validationInput,
      ),
    );
    if (restarted.disposition !== "restarted") {
      throw new Error("Cooking schema D validation did not restart.");
    }
    await settleReadyCandidateValidation(
      scenario.fixture,
      validationInput,
      "schema D",
    );
    const ready = await Effect.runPromise(scenario.fixture.readiness.settle({
      deploymentId: scenario.fixture.deploymentId,
      revisionId: retriedSchemaD.publication.revisionId,
    }));
    if (ready.status !== "ready") {
      throw new Error("Remediated cooking schema D did not become ready.");
    }
    const activated = await Effect.runPromise(
      scenario.fixture.activation.activate({
        revisionId: retriedSchemaD.publication.revisionId,
        expectedActiveHead: stillSchemaC.expectedActiveHead,
      }),
    );
    if (activated.status !== "activated") {
      throw new Error("Remediated cooking schema D did not activate.");
    }
    const activeSchemaD = await Effect.runPromise(
      scenario.fixture.activation.readActive(),
    );
    if (activeSchemaD.basis.revisionId !==
        retriedSchemaD.publication.revisionId ||
      activeSchemaD.basis.schemaVersionId !== schemaD.schemaVersionId) {
      throw new Error("Cooking schema D active authority is inconsistent.");
    }
    const invalidNestedArgument = await scenario.mutation(Effect.result(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:addSlug"),
        {
          id: schemaCState.schemaBState.secondRecipeId,
          slug: "mohinga",
          details: { difficulty: "expert", servings: 2 },
        },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-d:invalid-nested-difficulty",
        ),
      ),
    ));
    const invalidNestedArgumentRejected = Result.match(invalidNestedArgument, {
      onFailure: failure => failure instanceof ValidatorValueErrorV1 &&
        failure.issue.reason === "literalMismatch" &&
        failure.issue.path === "$args.details.difficulty",
      onSuccess: () => false,
    });
    if (!invalidNestedArgumentRejected) {
      throw new Error(
        "Cooking schema D did not reject its invalid nested argument exactly.",
      );
    }
    const teaLeafSalad = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaCState.schemaBState.baseline.recipeId },
      ),
    );
    const mohinga = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaCState.schemaBState.secondRecipeId },
      ),
    );
    if (!isCookingRecipe(teaLeafSalad) ||
      teaLeafSalad.details?.difficulty !== "easy" ||
      teaLeafSalad.details.servings !== 2 ||
      !isCookingRecipe(mohinga) ||
      mohinga.details?.difficulty !== "easy" ||
      mohinga.details.servings !== 2) {
      throw new Error("Cooking schema D returned nonconforming documents.");
    }
    const counts = await durableCounts(scenario.fixture);
    if (scenario.analysisLoader.loads !== 14 ||
      scenario.runtimeLoader.loads !== 16 ||
      counts.commits !== 6 || counts.outcomes !== 6 || counts.feed !== 6 ||
      counts.outbox !== 6) {
      throw new Error("Cooking schema D observed unexpected durable counts.");
    }
    const proof = Object.freeze({
      plannedNestedValidatorValidation: true,
      nestedValidatorBlocked: true,
      failureEvidenceWasPathOnly: true,
      schemaCStayedActive: true,
      remediatedThroughSchemaC: true,
      activatedSchemaD: true,
      schemaDRejectedInvalidNestedArgument: true,
      finalDocumentsConformToSchemaD: true,
      analysisWorkerLoads: 14,
      runtimeWorkerLoads: 16,
      commitCount: 6,
      outcomeCount: 6,
      feedCount: 6,
      outboxCount: 6,
    } satisfies ManagedSchemaCookingSchemaDProof);
    return Object.freeze({
      schemaCState,
      schemaD,
      activeSchemaD,
      sourceArtifactRootSha256: schemaDSource.sourceArtifact.rootSha256,
      proof,
    });
}

export async function proveManagedSchemaCookingSchemaE(
  createFixture: ManagedSchemaCookingFixtureFactory = options =>
    createApplicationNativeMutationPGliteFixture(options),
): Promise<ManagedSchemaCookingSchemaEProof> {
  return withCookingScenario(createFixture, async scenario => {
    const schemaDState = await establishCookingSchemaD(scenario);
    const schemaESource = await cookingSourceBundle("E");
    scenario.sources.set(
      schemaESource.sourceArtifact.rootSha256,
      schemaESource,
    );
    const schemaERevision = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-e:first",
      analysis: cookingAnalysis(
        schemaESource,
        scenario.analysisLoader,
        "schema E",
      ),
    });
    if (schemaESource.sourceArtifact.rootSha256 ===
      schemaDState.sourceArtifactRootSha256) {
      throw new Error("Cooking schema D and E source identities collided.");
    }
    const schemaE = await scenario.fixture.preparePublishedSchema(
      schemaERevision.manifest,
    );
    const { plan } = await prepareManagedSchemaPlan(
      scenario,
      schemaERevision.publication,
    );
    if (plan.disposition !== "managedBuildAndValidation" ||
      !plan.incompatibilityEvidence.entries.some(evidence =>
        evidence.code === "candidateDocumentValidationRequired" &&
        evidence.logicalName === "recipes" &&
        evidence.validatorPath === "$document.details.servings"
      )) {
      throw new Error(
        "Cooking schema E did not plan nested servings validation.",
      );
    }

    const validationInput = {
      deploymentId: scenario.fixture.deploymentId,
      schemaVersionId: schemaE.schemaVersionId,
    } as const;
    await Effect.runPromise(installAppSchemaCandidateValidationEffect(
      scenario.fixture.candidateValidation,
      validationInput,
    ));
    const paused = await Effect.runPromise(
      advanceAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        validationInput,
      ),
    );
    if (paused.disposition !== "readyToSettle" ||
      paused.head.frame.kind !== "app_schema_candidate_validation_progress" ||
      paused.head.frame.cursor === null) {
      throw new Error(
        "Cooking schema E did not pause after a non-null validation cursor.",
      );
    }
    const pausedFrameSha256Hex = paused.head.frameSha256Hex;

    const candidateValid = await scenario.mutation(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:addSlug"),
        {
          id: schemaDState.schemaCState.schemaBState.baseline.recipeId,
          slug: "tea-leaf-salad-v2",
          details: { difficulty: "easy", servings: 2 },
        },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-d:candidate-valid-write",
        ),
      ),
    );
    if (candidateValid.disposition !== "published" ||
      candidateValid.value !== true) {
      throw new Error("Schema D candidate-valid write did not publish.");
    }
    const afterValid = await Effect.runPromise(
      loadAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        validationInput,
      ),
    );
    if (afterValid.status !== "present" ||
      afterValid.head.frameSha256Hex !== pausedFrameSha256Hex) {
      throw new Error(
        "Candidate-valid point commit changed paused schema E progress.",
      );
    }

    const candidateInvalid = await scenario.mutation(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:addSlug"),
        {
          id: schemaDState.schemaCState.schemaBState.secondRecipeId,
          slug: "mohinga",
          details: { difficulty: "easy", servings: 4 },
        },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-d:candidate-invalid-write",
        ),
      ),
    );
    if (candidateInvalid.disposition !== "published" ||
      candidateInvalid.value !== true) {
      throw new Error("Schema D candidate-invalid write did not publish.");
    }
    const failed = await Effect.runPromise(
      loadAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        validationInput,
      ),
    );
    if (failed.status !== "present" ||
      failed.head.frame.kind !==
        "app_schema_candidate_validation_failure_evidence") {
      throw new Error(
        "Candidate-invalid point commit did not atomically fail schema E.",
      );
    }
    const recipesTable = schemaE.manifest.tableDefinitions.tables.find(
      table => table.logicalName === "recipes",
    );
    const failureEntry = failed.head.frame.entries[0];
    const failureEntryKeys = failureEntry === undefined
      ? ""
      : Object.keys(failureEntry).sort().join(",");
    if (recipesTable === undefined || failureEntry === undefined ||
      failed.head.frame.entries.length !== 1 ||
      failed.head.frame.observedFailureCount !== 1n ||
      failed.head.frame.truncated ||
      failureEntry.source !== "pointCommit" ||
      failureEntry.reason !== "candidateValidatorRejected" ||
      failureEntry.tableId !== recipesTable.tableId ||
      failureEntry.validatorPath !== "$document.details.servings" ||
      failureEntry.observedCommitSeq !== candidateInvalid.commitSeq ||
      failureEntryKeys !==
        "observedCommitSeq,reason,rowId,source,tableId,validatorPath" ||
      Object.values(failureEntry).some(value =>
        value === "Mohinga" || value === "mohinga" || value === 4
      )) {
      throw new Error(
        "Schema E point-commit failure evidence was not exact and path-only.",
      );
    }
    const blockedReadiness = await Effect.runPromise(
      scenario.fixture.readiness.settle({
        deploymentId: scenario.fixture.deploymentId,
        revisionId: schemaERevision.publication.revisionId,
      }),
    );
    if (blockedReadiness.status !== "not_ready" ||
      blockedReadiness.reason !== "candidateValidationFailed") {
      throw new Error("Schema E point-commit failure did not block readiness.");
    }
    const activationAttempt = await Effect.runPromise(Effect.result(
      scenario.fixture.activation.activate({
        revisionId: schemaERevision.publication.revisionId,
        expectedActiveHead: schemaDState.activeSchemaD.expectedActiveHead,
      }),
    ));
    const activationBlocked = Result.match(activationAttempt, {
      onFailure: failure => isNonArrayRecord(failure) &&
        failure._tag === "ApplicationActivationError" &&
        failure.reason === "notReady",
      onSuccess: () => false,
    });
    if (!activationBlocked) {
      throw new Error("Failed schema E remained activatable.");
    }
    const activeSchemaD = await Effect.runPromise(
      scenario.fixture.activation.readActive(),
    );
    if (activeSchemaD.basis.revisionId !==
      schemaDState.activeSchemaD.basis.revisionId) {
      throw new Error("Failed schema E replaced active schema D.");
    }
    const teaLeafSalad = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaDState.schemaCState.schemaBState.baseline.recipeId },
      ),
    );
    const mohinga = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaDState.schemaCState.schemaBState.secondRecipeId },
      ),
    );
    if (!isCookingRecipe(teaLeafSalad) ||
      teaLeafSalad.slug !== "tea-leaf-salad-v2" ||
      teaLeafSalad.details?.servings !== 2 ||
      !isCookingRecipe(mohinga) ||
      mohinga.slug !== "mohinga" ||
      mohinga.details?.servings !== 4) {
      throw new Error("Schema D did not expose both concurrent writes.");
    }
    const counts = await durableCounts(scenario.fixture);
    if (scenario.analysisLoader.loads !== 16 ||
      scenario.runtimeLoader.loads !== 20 ||
      counts.commits !== 8 || counts.outcomes !== 8 || counts.feed !== 8 ||
      counts.outbox !== 8) {
      throw new Error("Cooking schema E observed unexpected durable counts.");
    }
    return Object.freeze({
      plannedConcurrentWriteValidation: true,
      pausedAfterNonNullCursor: true,
      candidateValidCommitPreservedProgress: true,
      candidateInvalidCommitPublished: true,
      candidateInvalidCommitFailedValidationAtomically: true,
      failureEvidenceWasPathOnly: true,
      schemaDStayedActive: true,
      finalWritesVisibleThroughSchemaD: true,
      analysisWorkerLoads: 16,
      runtimeWorkerLoads: 20,
      commitCount: 8,
      outcomeCount: 8,
      feedCount: 8,
      outboxCount: 8,
    } satisfies ManagedSchemaCookingSchemaEProof);
  });
}

export async function proveManagedSchemaCookingSchemaF(
  createFixture: ManagedSchemaCookingFixtureFactory = options =>
    createApplicationNativeMutationPGliteFixture(options),
): Promise<ManagedSchemaCookingSchemaFProof> {
  return withCookingScenario(createFixture, async scenario => {
    const schemaDState = await establishCookingSchemaD(scenario);

    const schemaESource = await cookingSourceBundle("E");
    scenario.sources.set(schemaESource.sourceArtifact.rootSha256, schemaESource);
    const schemaERevision = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-e:recovery",
      analysis: cookingAnalysis(
        schemaESource,
        scenario.analysisLoader,
        "schema E recovery candidate",
      ),
    });
    const schemaE = await scenario.fixture.preparePublishedSchema(
      schemaERevision.manifest,
    );
    const schemaEInput = Object.freeze({
      deploymentId: scenario.fixture.deploymentId,
      schemaVersionId: schemaE.schemaVersionId,
    });
    const installedE = await runSystemTestEffectV1(
      installAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        schemaEInput,
      ),
    );
    const replayedE = await runSystemTestEffectV1(
      installAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        schemaEInput,
      ),
    );
    if (replayedE.disposition !== "replayed" ||
      replayedE.head.frameSha256Hex !== installedE.head.frameSha256Hex ||
      replayedE.head.frame.attemptFence !==
        installedE.head.frame.attemptFence) {
      throw new Error("Cooking schema E candidate did not replay exactly.");
    }

    const schemaFSource = await cookingSourceBundle("F");
    scenario.sources.set(schemaFSource.sourceArtifact.rootSha256, schemaFSource);
    const schemaFRevision = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-f:first",
      analysis: cookingAnalysis(
        schemaFSource,
        scenario.analysisLoader,
        "schema F",
      ),
    });
    const schemaF = await scenario.fixture.preparePublishedSchema(
      schemaFRevision.manifest,
    );
    if (schemaF.schemaVersionId === schemaE.schemaVersionId ||
      schemaF.schemaVersionId === schemaDState.schemaD.schemaVersionId) {
      throw new Error("Cooking schema F did not receive a distinct identity.");
    }
    const schemaFInput = Object.freeze({
      deploymentId: scenario.fixture.deploymentId,
      schemaVersionId: schemaF.schemaVersionId,
    });

    const baseRunner = createDefaultLocatedReadCommittedTransactionRunnerV1(
      scenario.fixture.target.drizzle,
    );
    let uncertaintyInjected = false;
    const uncertainCandidateValidation = createAppSchemaCandidateValidationPort({
      controlDb: scenario.fixture.control.drizzle,
      authority: Object.freeze({
        scopeMetadata: scenario.fixture.authorityPorts.scopeMetadata,
        provisioningReceipts:
          scenario.fixture.authorityPorts.provisioningReceipts,
        scopeClockTargets: Object.freeze({
          resolve: async (locator: ScopePhysicalLocator) =>
            createLocatedAppSchemaCandidateValidationTarget(
              scenario.fixture.target.drizzle,
              locator,
              async work => {
                const result = await baseRunner(work);
                if (!uncertaintyInjected) {
                  uncertaintyInjected = true;
                  throw new LocatedReadCommittedTransactionFailureV1(
                    Object.freeze({
                      kind: "decisionUncertain",
                      settlementCause: new Error(
                        "lost schema F candidate-install response",
                      ),
                    }),
                  );
                }
                return result;
              },
            ),
        }),
      }),
    });
    const uncertainInstall = await runSystemTestEffectV1(Effect.result(
      installAppSchemaCandidateValidationEffect(
        uncertainCandidateValidation,
        schemaFInput,
      ),
    ));
    const uncertaintyProjected = Result.match(uncertainInstall, {
      onFailure: failure => isNonArrayRecord(failure) &&
        failure._tag === "AppSchemaCandidateValidationOperationV1Error" &&
        failure.operation === "install" &&
        failure.reason === "decisionUncertain",
      onSuccess: () => false,
    });
    if (!uncertaintyInjected || !uncertaintyProjected) {
      throw new Error(
        "Cooking schema F did not project committed decision uncertainty.",
      );
    }

    const coldCandidateValidation = createAppSchemaCandidateValidationPort({
      controlDb: scenario.fixture.control.drizzle,
      authority: scenario.fixture.authorityPorts,
    });
    const coldLoadedF = await runSystemTestEffectV1(
      loadAppSchemaCandidateValidationEffect(
        coldCandidateValidation,
        schemaFInput,
      ),
    );
    if (coldLoadedF.status !== "present" ||
      coldLoadedF.head.schemaVersionId !== schemaF.schemaVersionId ||
      coldLoadedF.head.frame.attemptFence !==
        installedE.head.frame.attemptFence + 1n) {
      throw new Error(
        "Cold candidate-validation port did not recover schema F supersession.",
      );
    }
    const supersededE = await runSystemTestEffectV1(Effect.result(
      loadAppSchemaCandidateValidationEffect(
        coldCandidateValidation,
        schemaEInput,
      ),
    ));
    const eWasSuperseded = Result.match(supersededE, {
      onFailure: failure => isNonArrayRecord(failure) &&
        failure._tag === "AppSchemaCandidateValidationOperationV1Error" &&
        failure.operation === "load" && failure.reason === "superseded",
      onSuccess: () => false,
    });
    if (!eWasSuperseded) {
      throw new Error("Cooking schema F did not supersede schema E exactly.");
    }
    const replayedF = await runSystemTestEffectV1(
      installAppSchemaCandidateValidationEffect(
        coldCandidateValidation,
        schemaFInput,
      ),
    );
    if (replayedF.disposition !== "replayed" ||
      replayedF.head.frameSha256Hex !== coldLoadedF.head.frameSha256Hex) {
      throw new Error(
        "Cold candidate-validation replay did not preserve schema F evidence.",
      );
    }

    let rollbackFaultInjected = false;
    const rolledBackAdvance = await runSystemTestEffectV1(Effect.result(
      advanceAppSchemaCandidateValidationEffect(
        coldCandidateValidation,
        schemaFInput,
        {
          faultAfter: point => {
            if (point !== "afterProgressWrite") return;
            rollbackFaultInjected = true;
            throw new Error("rollback schema F candidate progress");
          },
        },
      ),
    ));
    const rollbackConfirmed = Result.match(rolledBackAdvance, {
      onFailure: failure => isNonArrayRecord(failure) &&
        failure._tag === "AppSchemaCandidateValidationOperationV1Error" &&
        failure.operation === "advance" &&
        failure.reason === "rollbackConfirmed",
      onSuccess: () => false,
    });
    const afterRollback = await runSystemTestEffectV1(
      loadAppSchemaCandidateValidationEffect(
        coldCandidateValidation,
        schemaFInput,
      ),
    );
    if (!rollbackFaultInjected || !rollbackConfirmed ||
      afterRollback.status !== "present" ||
      afterRollback.head.frameSha256Hex !== coldLoadedF.head.frameSha256Hex) {
      throw new Error(
        "Cooking schema F rollback did not preserve the exact candidate head.",
      );
    }

    await settleReadyCandidateValidation(
      scenario.fixture,
      schemaFInput,
      "schema F",
      coldCandidateValidation,
    );
    const readyF = await runSystemTestEffectV1(scenario.fixture.readiness.settle({
      deploymentId: scenario.fixture.deploymentId,
      revisionId: schemaFRevision.publication.revisionId,
    }));
    if (readyF.status !== "ready") {
      throw new Error("Cooking schema F did not become ready.");
    }
    const activationResults = await runSystemTestEffectV1(Effect.all([
      scenario.fixture.activation.activate({
        revisionId: schemaFRevision.publication.revisionId,
        expectedActiveHead: schemaDState.activeSchemaD.expectedActiveHead,
      }),
      scenario.fixture.activation.activate({
        revisionId: schemaFRevision.publication.revisionId,
        expectedActiveHead: schemaDState.activeSchemaD.expectedActiveHead,
      }),
    ], { concurrency: "unbounded" }));
    if (activationResults.some(result => result.status !== "activated") ||
      activationResults.map(result => result.disposition).sort().join(",") !==
        "inserted,replayed") {
      throw new Error(
        "Concurrent cooking schema F activation did not converge exactly.",
      );
    }
    const activeF = await runSystemTestEffectV1(
      scenario.fixture.activation.readActive(),
    );
    if (activeF.basis.revisionId !== schemaFRevision.publication.revisionId ||
      activeF.basis.schemaVersionId !== schemaF.schemaVersionId ||
      activeF.basis.activationSequence !==
        schemaDState.activeSchemaD.basis.activationSequence + 1n) {
      throw new Error("Cooking schema F active authority is inconsistent.");
    }

    const teaLeafSalad = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaDState.schemaCState.schemaBState.baseline.recipeId },
      ),
    );
    const mohinga = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaDState.schemaCState.schemaBState.secondRecipeId },
      ),
    );
    if (!isCookingRecipe(teaLeafSalad) ||
      teaLeafSalad.details?.servings !== 2 ||
      !isCookingRecipe(mohinga) || mohinga.details?.servings !== 2) {
      throw new Error("Cooking schema F did not read the schema-D documents.");
    }

    const lifecycleCounts = await managedSchemaLifecycleCounts(scenario.fixture);
    const counts = await durableCounts(scenario.fixture);
    if (scenario.analysisLoader.loads !== 18 ||
      scenario.runtimeLoader.loads !== 18 ||
      lifecycleCounts.candidateHeads !== 1 ||
      lifecycleCounts.activations !== 5 ||
      lifecycleCounts.activeHeads !== 1 ||
      counts.commits !== 6 || counts.outcomes !== 6 || counts.feed !== 6 ||
      counts.outbox !== 6) {
      throw new Error("Cooking schema F observed unexpected durable counts.");
    }

    await scenario.fixture.corruptCandidateValidationFrameBytesForTest();
    const corruptedColdPort = createAppSchemaCandidateValidationPort({
      controlDb: scenario.fixture.control.drizzle,
      authority: scenario.fixture.authorityPorts,
    });
    const corruptedLoad = await runSystemTestEffectV1(Effect.result(
      loadAppSchemaCandidateValidationEffect(
        corruptedColdPort,
        schemaFInput,
      ),
    ));
    const corruptionRejected = Result.match(corruptedLoad, {
      onFailure: failure => isNonArrayRecord(failure) &&
        failure._tag === "AppSchemaCandidateValidationOperationV1Error" &&
        failure.operation === "load" && failure.reason === "corruption",
      onSuccess: () => false,
    });
    const activeAfterCorruption = await runSystemTestEffectV1(
      scenario.fixture.activation.readActive(),
    );
    if (!corruptionRejected || activeAfterCorruption.basis.revisionId !==
        schemaFRevision.publication.revisionId) {
      throw new Error(
        "Schema F candidate corruption was not isolated from active authority.",
      );
    }

    return Object.freeze({
      supersededCandidate: true,
      exactCandidateReplay: true,
      decisionUncertaintyColdReplayed: true,
      confirmedRollbackPreservedHead: true,
      concurrentActivationConverged: true,
      corruptionRejectedCold: true,
      activeSchemaSurvivedCandidateCorruption: true,
      candidateHeadCount: 1,
      activationCount: 5,
      activeHeadCount: 1,
      analysisWorkerLoads: 18,
      runtimeWorkerLoads: 18,
      commitCount: 6,
      outcomeCount: 6,
      feedCount: 6,
      outboxCount: 6,
    } satisfies ManagedSchemaCookingSchemaFProof);
  });
}

export async function proveManagedSchemaCookingSchemaG(
  createFixture: ManagedSchemaCookingFixtureFactory = options =>
    createApplicationNativeMutationPGliteFixture(options),
): Promise<ManagedSchemaCookingSchemaGProof> {
  return withCookingScenario(createFixture, async scenario => {
    const schemaDState = await establishCookingSchemaD(scenario);

    const schemaFSource = await cookingSourceBundle("F");
    scenario.sources.set(schemaFSource.sourceArtifact.rootSha256, schemaFSource);
    const schemaFRevision = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-f:stale-attempt-base",
      analysis: cookingAnalysis(
        schemaFSource,
        scenario.analysisLoader,
        "schema F stale-attempt base",
      ),
    });
    const schemaF = await scenario.fixture.preparePublishedSchema(
      schemaFRevision.manifest,
    );
    const schemaFInput = Object.freeze({
      deploymentId: scenario.fixture.deploymentId,
      schemaVersionId: schemaF.schemaVersionId,
    });
    await runSystemTestEffectV1(installAppSchemaCandidateValidationEffect(
      scenario.fixture.candidateValidation,
      schemaFInput,
    ));
    await settleReadyCandidateValidation(
      scenario.fixture,
      schemaFInput,
      "schema F stale-attempt base",
    );
    const readyF = await runSystemTestEffectV1(scenario.fixture.readiness.settle({
      deploymentId: scenario.fixture.deploymentId,
      revisionId: schemaFRevision.publication.revisionId,
    }));
    if (readyF.status !== "ready") {
      throw new Error("Cooking schema F stale-attempt base did not become ready.");
    }
    const activatedF = await runSystemTestEffectV1(
      scenario.fixture.activation.activate({
        revisionId: schemaFRevision.publication.revisionId,
        expectedActiveHead: schemaDState.activeSchemaD.expectedActiveHead,
      }),
    );
    const activeF = await runSystemTestEffectV1(
      scenario.fixture.activation.readActive(),
    );
    if (activatedF.status !== "activated" ||
      activeF.basis.revisionId !== schemaFRevision.publication.revisionId ||
      activeF.basis.schemaVersionId !== schemaF.schemaVersionId) {
      throw new Error("Cooking schema F stale-attempt base did not activate.");
    }

    const schemaGSource = await cookingSourceBundle("G");
    scenario.sources.set(schemaGSource.sourceArtifact.rootSha256, schemaGSource);
    const schemaGRevision = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-g:first",
      analysis: cookingAnalysis(
        schemaGSource,
        scenario.analysisLoader,
        "schema G",
      ),
    });
    const schemaG = await scenario.fixture.preparePublishedSchema(
      schemaGRevision.manifest,
    );
    if (schemaG.schemaVersionId === schemaF.schemaVersionId) {
      throw new Error("Cooking schema G did not receive a replacement identity.");
    }
    const schemaGInput = Object.freeze({
      deploymentId: scenario.fixture.deploymentId,
      schemaVersionId: schemaG.schemaVersionId,
    });
    await runSystemTestEffectV1(installAppSchemaCandidateValidationEffect(
      scenario.fixture.candidateValidation,
      schemaGInput,
    ));
    await settleReadyCandidateValidation(
      scenario.fixture,
      schemaGInput,
      "schema G",
    );
    const readyG = await runSystemTestEffectV1(scenario.fixture.readiness.settle({
      deploymentId: scenario.fixture.deploymentId,
      revisionId: schemaGRevision.publication.revisionId,
    }));
    const candidateBeforeActivation = await runSystemTestEffectV1(
      loadAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        schemaGInput,
      ),
    );
    if (readyG.status !== "ready" ||
      candidateBeforeActivation.status !== "present" ||
      candidateBeforeActivation.head.frame.kind !==
        "app_schema_candidate_validation_receipt") {
      throw new Error("Cooking schema G did not become exactly ready.");
    }

    const beforeStaleAttempt = await durableCounts(scenario.fixture);
    const storageBeforeStaleAttempt = await applicationStorageCounts(
      scenario.fixture,
    );
    const runtimeRevisionStart = scenario.runtimeLoader.revisionIds.length;
    const block = scenario.runtimeLoader.blockNextInvocation();
    const staleAttempt = scenario.mutation(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:addSlug"),
        {
          id: schemaDState.schemaCState.schemaBState.baseline.recipeId,
          slug: "tea-leaf-salad-stale-f",
          details: { difficulty: "easy", servings: 2 },
        },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-f:stale-attempt",
        ),
      ),
    );
    await block.started;
    const startedRevision = scenario.runtimeLoader.revisionIds.at(-1);
    let activationFailure: unknown;
    try {
      const activatedG = await runSystemTestEffectV1(
        scenario.fixture.activation.activate({
          revisionId: schemaGRevision.publication.revisionId,
          expectedActiveHead: activeF.expectedActiveHead,
        }),
      );
      const activeG = await runSystemTestEffectV1(
        scenario.fixture.activation.readActive(),
      );
      if (activatedG.status !== "activated" ||
        activeG.basis.revisionId !== schemaGRevision.publication.revisionId ||
        activeG.basis.schemaVersionId !== schemaG.schemaVersionId) {
        throw new Error("Cooking schema G replacement did not activate.");
      }
    } catch (cause) {
      activationFailure = cause;
    } finally {
      block.release();
    }

    let staleAttemptRejected = false;
    try {
      await staleAttempt;
    } catch (cause) {
      staleAttemptRejected =
        cause instanceof PointCommitStaleAuthorityV1Error &&
        cause.reason === "activeSchemaChanged";
    }
    if (activationFailure !== undefined) {
      throw activationFailure;
    }
    const afterStaleAttempt = await durableCounts(scenario.fixture);
    const storageAfterStaleAttempt = await applicationStorageCounts(
      scenario.fixture,
    );
    const candidateAfterStaleAttempt = await runSystemTestEffectV1(
      loadAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        schemaGInput,
      ),
    );
    if (startedRevision !== schemaFRevision.publication.revisionId ||
      !staleAttemptRejected) {
      throw new Error("Schema F attempt was not rejected after G activation.");
    }
    if (!sameDurableCounts(beforeStaleAttempt, afterStaleAttempt)) {
      throw new Error("Schema-stale attempt changed publication evidence.");
    }
    if (!sameApplicationStorageCounts(
      storageBeforeStaleAttempt,
      storageAfterStaleAttempt,
    )) {
      throw new Error("Schema-stale attempt changed application storage.");
    }
    if (candidateAfterStaleAttempt.status !== "present" ||
      candidateAfterStaleAttempt.head.frameSha256Hex !==
        candidateBeforeActivation.head.frameSha256Hex) {
      throw new Error("Schema-stale attempt changed the exact G receipt.");
    }

    const retried = await scenario.mutation(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:addSlug"),
        {
          id: schemaDState.schemaCState.schemaBState.baseline.recipeId,
          slug: "tea-leaf-salad-g",
          details: { difficulty: "easy", servings: 2 },
        },
        TransactionRequestKeyV1Schema.make(
          "managed-schema:cooking:schema-g:ordinary-retry",
        ),
      ),
    );
    if (retried.disposition !== "published" || retried.value !== true) {
      throw new Error("Ordinary schema G retry did not publish.");
    }
    const finalDocument = await scenario.query(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: schemaDState.schemaCState.schemaBState.baseline.recipeId },
      ),
    );
    if (!isCookingRecipe(finalDocument) ||
      finalDocument.slug !== "tea-leaf-salad-g" ||
      finalDocument.details?.difficulty !== "easy" ||
      finalDocument.details.servings !== 2) {
      throw new Error("Schema G retry did not produce its authoritative row.");
    }
    const runtimeRevisionIds = scenario.runtimeLoader.revisionIds.slice(
      runtimeRevisionStart,
    );
    if (runtimeRevisionIds.join(",") !== [
      schemaFRevision.publication.revisionId,
      schemaGRevision.publication.revisionId,
      schemaGRevision.publication.revisionId,
    ].join(",")) {
      throw new Error("Ordinary retry did not select only the new revision.");
    }

    const finalCounts = await durableCounts(scenario.fixture);
    const finalStorage = await applicationStorageCounts(scenario.fixture);
    const lifecycleCounts = await managedSchemaLifecycleCounts(scenario.fixture);
    if (scenario.analysisLoader.loads !== 18 ||
      scenario.runtimeLoader.loads !== 19 ||
      finalCounts.commits !== beforeStaleAttempt.commits + 1 ||
      finalCounts.outcomes !== beforeStaleAttempt.outcomes + 1 ||
      finalCounts.feed !== beforeStaleAttempt.feed + 1 ||
      finalCounts.outbox !== beforeStaleAttempt.outbox + 1 ||
      finalStorage.rowRevisions !== storageBeforeStaleAttempt.rowRevisions + 1 ||
      finalStorage.currentRows !== storageBeforeStaleAttempt.currentRows ||
      finalStorage.indexRevisions !==
        storageBeforeStaleAttempt.indexRevisions + 2 ||
      finalStorage.indexCurrent !== storageBeforeStaleAttempt.indexCurrent ||
      finalStorage.uniqueKeys !== storageBeforeStaleAttempt.uniqueKeys ||
      lifecycleCounts.candidateHeads !== 1 ||
      lifecycleCounts.activations !== 6 ||
      lifecycleCounts.activeHeads !== 1 ||
      finalCounts.commits !== 7 || finalCounts.outcomes !== 7 ||
      finalCounts.feed !== 7 || finalCounts.outbox !== 7) {
      throw new Error("Cooking schema G observed unexpected durable evidence.");
    }

    return Object.freeze({
      attemptStartedUnderSchemaF: true,
      replacementActivatedBeforePublication: true,
      staleAttemptRejected: true,
      staleAttemptLeftPublicationUnchanged: true,
      staleAttemptLeftApplicationStorageUnchanged: true,
      candidateReceiptStayedExact: true,
      ordinaryRetrySelectedSchemaG: true,
      ordinaryRetryPublishedExactlyOnce: true,
      finalDocumentConformsToSchemaG: true,
      candidateHeadCount: 1,
      activationCount: 6,
      activeHeadCount: 1,
      analysisWorkerLoads: 18,
      runtimeWorkerLoads: 19,
      commitCount: 7,
      outcomeCount: 7,
      feedCount: 7,
      outboxCount: 7,
    } satisfies ManagedSchemaCookingSchemaGProof);
  });
}

interface CookingScenario {
  readonly fixture: ApplicationNativeMutationFixture<
    ApplicationNativeMutationPersistence
  >;
  readonly analysisLoader: MiniflareAnalysisWorkerLoader;
  readonly runtimeLoader: MiniflareApplicationWorkerLoader;
  readonly sources: Map<string, ApplicationNativeMutationSourceBundle>;
  readonly mutation: <A, E>(effect: Effect.Effect<
    A,
    E,
    ApplicationMutationSystem | Scope.Scope
  >) => Promise<A>;
  readonly query: <A, E>(effect: Effect.Effect<
    A,
    E,
    ApplicationQuerySystem | Scope.Scope
  >) => Promise<A>;
}

async function withCookingScenario<A>(
  createFixture: ManagedSchemaCookingFixtureFactory,
  run: (scenario: CookingScenario) => Promise<A>,
): Promise<A> {
  const source = await cookingSourceBundle("A");
  const analysisLoader = new MiniflareAnalysisWorkerLoader();
  const runtimeLoader = new MiniflareApplicationWorkerLoader();
  const sources = new Map([[source.sourceArtifact.rootSha256, source]]);
  const sourceReader = cookingSourceReader(sources);
  try {
    const fixture = await createFixture({
      runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      analysis: cookingAnalysis(source, analysisLoader, "schema A"),
    });
    const mutationLayer = await makeApplicationNativeMutationTestLayer(
      fixture,
      runtimeLoader,
      { source: sourceReader },
    );
    const mutation = <A, E>(effect: Effect.Effect<
      A,
      E,
      ApplicationMutationSystem | Scope.Scope
    >) => Effect.runPromise(Effect.scoped(
      effect.pipe(Effect.provide(mutationLayer)),
    ));
    const queryLayer = makeCookingQueryLayer(
      fixture,
      runtimeLoader,
      sourceReader,
    );
    const query = <A, E>(effect: Effect.Effect<
      A,
      E,
      ApplicationQuerySystem | Scope.Scope
    >) => Effect.runPromise(Effect.scoped(
      effect.pipe(Effect.provide(queryLayer)),
    ));
    return await run({
      fixture,
      analysisLoader,
      runtimeLoader,
      sources,
      mutation,
      query,
    });
  } finally {
    await Promise.all([
      analysisLoader.dispose(),
      runtimeLoader.dispose(),
    ]);
  }
}

async function establishCookingSchemaABaseline(
  scenario: CookingScenario,
): Promise<Readonly<{ readonly recipeId: string }>> {
  const requestKey = TransactionRequestKeyV1Schema.make(
    "managed-schema:cooking:schema-a:create",
  );
  const create = TransactionFunctionPathV1Schema.make("recipes:create");
  const published = await scenario.mutation(
    invokeStandardApplicationPointMutationV1(
      create,
      { name: "Tea leaf salad", description: "A bright, crunchy salad." },
      requestKey,
    ),
  );
  if (published.disposition !== "published" ||
    typeof published.value !== "string") {
    throw new Error("Cooking schema-A mutation did not publish a document.");
  }
  const loadsAfterPublish = scenario.runtimeLoader.loads;
  const replayed = await scenario.mutation(
    invokeStandardApplicationPointMutationV1(
      create,
      { name: "Tea leaf salad", description: "A bright, crunchy salad." },
      requestKey,
    ),
  );
  if (replayed.disposition !== "replayed" ||
    replayed.status !== published.status ||
    replayed.scopeUuid !== published.scopeUuid ||
    replayed.epochUuid !== published.epochUuid ||
    replayed.commitSeq !== published.commitSeq ||
    replayed.value !== published.value ||
    scenario.runtimeLoader.loads !== loadsAfterPublish) {
    throw new Error("Cooking schema-A replay did not return the exact outcome.");
  }

  const queried = await scenario.query(
    invokeStandardApplicationPointQueryV1(
      TransactionFunctionPathV1Schema.make("recipes:get"),
      { id: published.value },
    ),
  );
  if (!isCookingRecipe(queried) ||
    queried.name !== "Tea leaf salad" ||
    queried.description !== "A bright, crunchy salad.") {
    throw new Error("Cooking schema-A query did not read the committed recipe.");
  }
  const counts = await durableCounts(scenario.fixture);
  if (scenario.analysisLoader.loads !== 2 ||
    scenario.runtimeLoader.loads !== 2 ||
    counts.commits !== 1 || counts.outcomes !== 1 || counts.feed !== 1 ||
    counts.outbox !== 1) {
    throw new Error("Cooking schema-A proof observed unexpected durable counts.");
  }
  return Object.freeze({ recipeId: published.value });
}

function makeCookingQueryLayer(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
  loader: MiniflareApplicationWorkerLoader,
  source: ReturnType<typeof cookingSourceReader>,
) {
  let executionSequence = 0;
  return makeApplicationQuerySystemLayer({
    activation: fixture.activation,
    snapshot: {
      deploymentId: fixture.deploymentId,
      controlDb: fixture.control.drizzle,
      authority: fixture.authorityPorts,
      schema: fixture.schema,
      developerIndexes: fixture.developerIndexes,
    },
    snapshotBudget: Object.freeze({
      maximumPointReads: 16,
      maximumIndexReads: 16,
      maximumDocuments: 64,
      maximumSemanticBytes: 1_048_576,
    }),
    source,
    host: makeApplicationExecutionHost(loader),
    executionContextFactory: () => {
      executionSequence += 1;
      return Object.freeze({
        executionId: `managed-schema-cooking-query-${executionSequence}`,
        randomSeed: new Uint8Array(32).fill(executionSequence),
        executionTime: 1_800_000_000_000 + executionSequence,
      });
    },
  });
}

async function cookingSourceBundle(
  schema: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "BLOCKED",
): Promise<
  ApplicationNativeMutationSourceBundle
> {
  const descriptionField = {
    fieldType: { type: "string" as const },
    optional: true,
  };
  const slugField = {
    fieldType: { type: "string" as const },
    optional: schema === "B",
  };
  const difficultyValidator = schema === "D" || schema === "E" ||
      schema === "F" || schema === "G"
    ? { type: "literal" as const, value: "easy" }
    : { type: "string" as const };
  const servingsValidator = schema === "E"
    ? { type: "literal" as const, value: 2 }
    : { type: "number" as const };
  const detailsField = {
    fieldType: {
      type: "object" as const,
      value: {
        difficulty: {
          fieldType: difficultyValidator,
          optional: false,
        },
        servings: {
          fieldType: servingsValidator,
          optional: false,
        },
      },
    },
    optional: true,
  };
  const tableLogicalName = schema === "BLOCKED" ? "meals" : "recipes";
  const prepared = Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 5,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 128,
      maximumValidatorDepth: 16,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: {
        tables: [{
          logicalName: tableLogicalName,
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                name: {
                  fieldType: { type: "string" },
                  optional: false,
                },
                ...(schema === "A" ? { description: descriptionField } : {}),
                ...(schema === "A" ? {} : { slug: slugField }),
                ...(schema === "A" ? {} : { details: detailsField }),
                ...(schema === "F" || schema === "G"
                  ? {
                    notes: {
                      fieldType: { type: "string" },
                      optional: true,
                    },
                  }
                  : {}),
                ...(schema === "G"
                  ? {
                    category: {
                      fieldType: { type: "string" },
                      optional: true,
                    },
                  }
                  : {}),
              },
            },
          },
        }],
        indexes: schema === "A"
          ? []
          : [{
              tableLogicalName,
              descriptor: "by_name",
              fields: ["name"],
            }],
      },
      modules: [{
        modulePath: "recipes",
        functions: [{
          exportName: "create",
          kind: "mutation",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: {
              name: {
                fieldType: { type: "string" },
                optional: false,
              },
              ...(schema === "A" ? { description: descriptionField } : {}),
              ...(schema === "A" ? {} : { slug: slugField }),
              ...(schema === "A" ? {} : { details: detailsField }),
            },
          },
          returnsValidator: { type: "string" },
        }, {
          exportName: "removeDescription",
          kind: "mutation",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: {
              id: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
          returnsValidator: { type: "boolean" },
        }, {
          exportName: "get",
          kind: "query",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: {
              id: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
          returnsValidator: { type: "any" },
        }, ...(schema === "B" ? [{
          exportName: "writeRemovedDescription",
          kind: "mutation" as const,
          visibility: "public" as const,
          argsValidator: {
            type: "object" as const,
            value: {
              id: {
                fieldType: { type: "string" as const },
                optional: false,
              },
            },
          },
          returnsValidator: { type: "boolean" as const },
        }] : []), ...(schema === "A" ? [] : [{
          exportName: "addSlug",
          kind: "mutation" as const,
          visibility: "public" as const,
          argsValidator: {
            type: "object" as const,
            value: {
              id: {
                fieldType: { type: "string" as const },
                optional: false,
              },
              slug: {
                fieldType: { type: "string" as const },
                optional: false,
              },
              details: {
                ...detailsField,
                optional: false,
              },
            },
          },
          returnsValidator: { type: "boolean" as const },
        }])],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
      maximumEntryBindings: 5,
      maximumSourceBytes: 8_192,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 65_536,
      maximumSemanticRecords: 64,
      maximumSemanticRecordBytes: 8_192,
      maximumSemanticStreamBytes: 65_536,
    },
    graphInput: {
      modules: [{
        path: "functions/recipes.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode([
          `// managed schema ${schema}`,
          "export async function create(ctx, args) {",
          ...(schema === "A"
            ? [
              "  const value = args.description === undefined",
              "    ? { name: args.name }",
              "    : { name: args.name, description: args.description };",
            ]
            : schema === "B"
            ? [
              "  const value = args.slug === undefined",
              "    ? { name: args.name }",
              "    : args.details === undefined",
              "    ? { name: args.name, slug: args.slug }",
              "    : { name: args.name, slug: args.slug, details: args.details };",
            ]
            : [
              "  const value = args.details === undefined",
              "    ? { name: args.name, slug: args.slug }",
              "    : { name: args.name, slug: args.slug, details: args.details };",
            ]),
          '  const id = await ctx.db.insert("recipes", value);',
          "  await ctx.db.replace(id, value);",
          "  return id;",
          "}",
          "export async function removeDescription(ctx, args) {",
          "  const current = await ctx.db.get(args.id);",
          "  if (current === null) return false;",
          ...(schema === "A"
            ? ["  await ctx.db.replace(args.id, { name: current.name });"]
            : [
              "  const value = current.slug === undefined",
              "    ? { name: current.name }",
              "    : current.details === undefined",
              "    ? { name: current.name, slug: current.slug }",
              "    : { name: current.name, slug: current.slug, details: current.details };",
              "  await ctx.db.replace(args.id, value);",
            ]),
          "  return true;",
          "}",
          "export async function get(ctx, args) {",
          "  return ctx.db.get(args.id);",
          "}",
          ...(schema === "B"
            ? [
              "export async function writeRemovedDescription(ctx, args) {",
              "  const current = await ctx.db.get(args.id);",
              "  if (current === null) return false;",
              '  await ctx.db.replace(args.id, { name: current.name, description: "forbidden" });',
              "  return true;",
              "}",
            ]
            : []),
          ...(schema === "A"
            ? []
            : [
              "export async function addSlug(ctx, args) {",
              "  const current = await ctx.db.get(args.id);",
              "  if (current === null) return false;",
              "  await ctx.db.replace(args.id, { name: current.name, slug: args.slug, details: args.details });",
              "  return true;",
              "}",
            ]),
          "",
        ].join("\n")),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "recipes",
        artifactModulePath: "functions/recipes.js",
      }],
      executionPath: "functions/recipes.js",
      schemaPath: null,
      authPath: null,
    },
  }));
  const produced = Result.getOrThrow(produceStandardApplicationSource(prepared));
  const modules = Object.freeze(await Promise.all(produced.modules.map(
    async module => {
      const sourceSha256 = await sha256Hex(module.sourceBytes);
      return Object.freeze({
        path: module.path,
        roles: module.roles,
        sourceSha256,
        sourceByteLength: module.sourceBytes.byteLength,
        source: new TextDecoder().decode(module.sourceBytes),
      });
    },
  )));
  const rootSha256 = await sha256Hex(new TextEncoder().encode(
    modules.map(module => `${module.path}:${module.sourceSha256}`).join("\n"),
  ));
  return Object.freeze({
    sourceArtifact: Object.freeze({
      rootSha256,
      executionModulePath: produced.executionPath,
      schemaModulePath: produced.schemaPath,
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

function cookingAnalysis(
  source: ApplicationNativeMutationSourceBundle,
  loader: MiniflareAnalysisWorkerLoader,
  label: string,
): ApplicationNativeMutationAnalysis {
  const run: ApplicationNativeMutationAnalysis["run"] = async input => {
    const context = makeApplicationAnalysisContext({
      authority: input.authority,
      repository: input.repository,
      host: {
        analyze: request => applicationAnalysisHostEffectWithCapabilities({
          source: {
            read: rootSha256 => rootSha256 ===
                input.sourceArtifactRootSha256
              ? Effect.succeed(
                  source satisfies ApplicationAnalysisSourceBundle,
                )
              : Effect.fail(new ApplicationAnalysisSourceReadError({
                operation: "read",
                reason: "invalidRoot",
              })),
          },
          loader,
        }, request),
      },
    });
    const analyzed = await Effect.runPromise(context.analyze({
      requestKey: input.requestKey,
      sourceArtifactRootSha256: input.sourceArtifactRootSha256,
    }));
    if (analyzed.kind !== "analyzed") {
      throw new Error(`Cooking ${label} was rejected by Application Analysis.`);
    }
    return Effect.runPromise(input.repository.inspect(
      input.authority,
      analyzed.receipt.candidateId,
    ));
  };
  return Object.freeze({
    source,
    run,
  });
}

function cookingSourceReader(
  sources: ReadonlyMap<string, ApplicationNativeMutationSourceBundle>,
) {
  return Object.freeze({
    read: (rootSha256: string) => {
      const source = sources.get(rootSha256);
      return source === undefined
        ? Effect.fail(new ApplicationAnalysisSourceReadError({
          operation: "read",
          reason: "invalidRoot",
        }))
        : Effect.succeed(source satisfies ApplicationAnalysisSourceBundle);
    },
  });
}

async function advanceUntilCandidateFailure(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
  input: Readonly<{
    readonly deploymentId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
  }>,
  label = "schema B",
) {
  for (let step = 0; step < 64; step += 1) {
    const advanced = await Effect.runPromise(
      advanceAppSchemaCandidateValidationEffect(
        fixture.candidateValidation,
        input,
      ),
    );
    if (advanced.disposition === "failed") return advanced;
    if (advanced.disposition === "readyToSettle") {
      throw new Error(`Cooking ${label} unexpectedly passed validation.`);
    }
  }
  throw new Error(`Cooking ${label} validation did not reach failure.`);
}

async function settleReadyCandidateValidation(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
  input: Readonly<{
    readonly deploymentId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
  }>,
  label = "schema B",
  candidateValidation = fixture.candidateValidation,
): Promise<void> {
  for (let step = 0; step < 64; step += 1) {
    const advanced = await runSystemTestEffectV1(
      advanceAppSchemaCandidateValidationEffect(
        candidateValidation,
        input,
      ),
    );
    if (advanced.disposition === "failed") {
      throw new Error(`Remediated cooking ${label} still failed validation.`);
    }
    if (advanced.disposition !== "readyToSettle") continue;
    await runSystemTestEffectV1(settleAppSchemaCandidateValidationEffect(
      candidateValidation,
      input,
    ));
    return;
  }
  throw new Error(`Remediated cooking ${label} did not settle.`);
}

async function prepareManagedSchemaPlan(
  scenario: CookingScenario,
  candidatePublication: ApplicationNativeMutationRegisteredRevision["publication"],
) {
  const result = await runSystemTestEffectV1(
    prepareApplicationManagedSchemaPlan({ candidatePublication }).pipe(
      Effect.provide(
        makeApplicationManagedSchemaPlanningLayer(
          scenario.fixture.managedSchemaPlanning,
        ),
      ),
    ),
  );
  const claimed = claimPreparedApplicationManagedSchemaPlanResult(
    result.prepared,
    scenario.fixture.managedSchemaPlanning,
  );
  const copied = claimPreparedApplicationManagedSchemaPlanResult(
    { ...result.prepared },
    scenario.fixture.managedSchemaPlanning,
  );
  if (Result.isFailure(claimed) || claimed.success.plan !== result.plan ||
    claimed.success.candidatePublication !== candidatePublication ||
    Result.isSuccess(copied)) {
    throw new Error(
      "Managed-schema prepared-plan capability authenticity was not preserved.",
    );
  }

  const copiedPort = structuredClone(scenario.fixture.managedSchemaPlanning);
  const crossControlPort = createApplicationManagedSchemaPlanningPort({
    deploymentId: scenario.fixture.deploymentId,
    controlDb: scenario.fixture.target.drizzle,
    activation: scenario.fixture.activation,
    schema: scenario.fixture.schema,
    authority: scenario.fixture.authorityPorts,
  });
  const copiedAuthorityPort = createApplicationManagedSchemaPlanningPort({
    deploymentId: scenario.fixture.deploymentId,
    controlDb: scenario.fixture.control.drizzle,
    activation: scenario.fixture.activation,
    schema: scenario.fixture.schema,
    authority: { ...scenario.fixture.authorityPorts },
  });
  for (const invalidPort of [
    copiedPort,
    crossControlPort,
    copiedAuthorityPort,
  ]) {
    const rejected = await runSystemTestEffectV1(Effect.result(
      prepareApplicationManagedSchemaPlan({ candidatePublication }).pipe(
        Effect.provide(makeApplicationManagedSchemaPlanningLayer(invalidPort)),
      ),
    ));
    if (Result.isSuccess(rejected) ||
      !(rejected.failure instanceof ApplicationManagedSchemaPlanningError) ||
      rejected.failure.reason !== "invalidComposition") {
      throw new Error("Managed-schema planning accepted an invalid composition.");
    }
  }
  const copiedCandidate = await runSystemTestEffectV1(Effect.result(
    prepareApplicationManagedSchemaPlan({
      candidatePublication: { ...candidatePublication },
    }).pipe(Effect.provide(
      makeApplicationManagedSchemaPlanningLayer(
        scenario.fixture.managedSchemaPlanning,
      ),
    )),
  ));
  if (Result.isSuccess(copiedCandidate) ||
    !(copiedCandidate.failure instanceof ApplicationManagedSchemaPlanningError) ||
    copiedCandidate.failure.reason !== "candidateEvidenceInvalid") {
    throw new Error("Managed-schema planning accepted copied candidate evidence.");
  }
  let candidateReads = 0;
  const changingInput: PrepareApplicationManagedSchemaPlanInput = {
    get candidatePublication() {
      candidateReads += 1;
      return candidateReads === 1
        ? candidatePublication
        : { ...candidatePublication };
    },
  };
  const capturedOnce = await runSystemTestEffectV1(
    prepareApplicationManagedSchemaPlan(changingInput).pipe(Effect.provide(
      makeApplicationManagedSchemaPlanningLayer(
        scenario.fixture.managedSchemaPlanning,
      ),
    )),
  );
  const capturedClaim = claimPreparedApplicationManagedSchemaPlanResult(
    capturedOnce.prepared,
    scenario.fixture.managedSchemaPlanning,
  );
  if (candidateReads !== 1 || Result.isFailure(capturedClaim) ||
    capturedClaim.success.candidatePublication !== candidatePublication) {
    throw new Error(
      "Managed-schema planning did not capture candidate evidence exactly once.",
    );
  }
  return result;
}

async function applyManagedSchemaPlanUntilTerminal(
  scenario: CookingScenario,
  prepared: PreparedApplicationManagedSchemaPlan,
  observedPhases?: Set<string>,
): Promise<Exclude<
  ApplyApplicationManagedSchemaPlanResult,
  { readonly status: "in_progress" }
>> {
  for (let step = 0; step < 128; step += 1) {
    const result = await runSystemTestEffectV1(
      applyApplicationManagedSchemaPlan({ prepared }).pipe(Effect.provide(
        makeApplicationManagedSchemaApplicationLayer(
          scenario.fixture.managedSchemaPlanning,
          scenario.fixture.managedSchemaApplication,
        ),
      )),
    );
    if (result.status === "in_progress") {
      observedPhases?.add(result.phase);
    }
    if (result.status !== "in_progress") return result;
  }
  throw new Error("Managed-schema apply did not settle within 128 steps.");
}

async function proveCrossTargetPlanningRejection(
  scenario: CookingScenario,
  candidatePublication: ApplicationNativeMutationRegisteredRevision["publication"],
  candidateManifest: ApplicationNativeMutationRegisteredRevision["manifest"],
): Promise<void> {
  await withCookingScenario(
    options => createApplicationNativeMutationPGliteFixture(options),
    async foreign => {
      await foreign.fixture.preparePublishedSchema(candidateManifest);
      const crossControlPort = createApplicationManagedSchemaPlanningPort({
        deploymentId: scenario.fixture.deploymentId,
        controlDb: foreign.fixture.control.drizzle,
        activation: scenario.fixture.activation,
        schema: foreign.fixture.schema,
        authority: scenario.fixture.authorityPorts,
      });
      for (const [label, port] of [
        ["foreign target database", foreign.fixture.managedSchemaPlanning],
        ["split activation/control composition", crossControlPort],
      ] as const) {
        const rejected = await runSystemTestEffectV1(Effect.result(
          prepareApplicationManagedSchemaPlan({ candidatePublication }).pipe(
            Effect.provide(makeApplicationManagedSchemaPlanningLayer(port)),
          ),
        ));
        if (Result.isSuccess(rejected) ||
          !(rejected.failure instanceof ApplicationManagedSchemaPlanningError) ||
          rejected.failure.reason !== "invalidComposition") {
          throw new Error(`Managed-schema planning accepted ${label}.`);
        }
      }
    },
  );
}

function hasTaggedReason(
  value: unknown,
  tag: string,
  reason: string,
): boolean {
  return isNonArrayRecord(value) && value._tag === tag && value.reason === reason;
}

function failureIdentity(value: unknown): string {
  if (!isNonArrayRecord(value)) return "unknown";
  return `${String(value._tag)}:${String(value.reason)}`;
}

class MiniflareAnalysisWorkerLoader implements WorkerLoader {
  loads = 0;
  readonly #disposals: Array<Promise<void>> = [];
  readonly #runtimes = new Set<Miniflare>();

  get(): WorkerStub {
    throw new Error("Cooking analysis forbids cached Worker loading.");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loads += 1;
    return new MiniflareAnalysisWorkerStub(this, code);
  }

  attach(runtime: Miniflare): void {
    this.#runtimes.add(runtime);
  }

  release(runtime: Miniflare): void {
    if (!this.#runtimes.delete(runtime)) return;
    this.#disposals.push(runtime.dispose());
  }

  async dispose(): Promise<void> {
    const runtimes = [...this.#runtimes];
    this.#runtimes.clear();
    await Promise.all([
      ...this.#disposals.splice(0),
      ...runtimes.map(runtime => runtime.dispose()),
    ]);
  }
}

class MiniflareAnalysisWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: MiniflareAnalysisWorkerLoader,
    private readonly code: WorkerLoaderWorkerCode,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    const entrypoint = {
      analyze: () => this.analyze(name),
      fetch: async () => new Response(null, { status: 501 }),
      connect: () => {
        throw new Error("Cooking analysis forbids sockets.");
      },
    };
    // SAFETY: the test adapter implements the exact analyze RPC used by the
    // Application Analysis host plus Cloudflare's declared Fetcher surface.
    return entrypoint as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Cooking analysis forbids Durable Objects.");
  }

  private async analyze(name: string | undefined): Promise<unknown> {
    if (name === undefined) {
      throw new Error("Cooking analysis omitted its Worker entrypoint.");
    }
    const script = `export default {
  async fetch(_request, env) {
    const worker = env.LOADER.load(${JSON.stringify(this.code)});
    const stub = worker.getEntrypoint(${JSON.stringify(name)});
    const result = await stub.analyze();
    try { return Response.json(result); }
    finally { result?.[Symbol.dispose]?.(); }
  },
};`;
    const runtime = new Miniflare({
      compatibilityDate: COMPATIBILITY_DATE,
      modules: true,
      script,
      workerLoaders: { LOADER: {} },
    });
    this.owner.attach(runtime);
    try {
      const response = await runtime.dispatchFetch(
        "https://managed-schema-analysis.invalid/",
      );
      return await response.json();
    } finally {
      this.owner.release(runtime);
    }
  }
}

async function durableCounts(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
) {
  const result = await fixture.target.query<{
    commits: string;
    outcomes: string;
    feed: string;
    outbox: string;
  }>(`select
    (select count(*)::text from fx_system_commit) as commits,
    (select count(*)::text from fx_system_idempotency) as outcomes,
    (select count(*)::text from fx_system_commit_app_row_change) as feed,
    (select count(*)::text from fx_system_outbox) as outbox`);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Cooking durable counts are missing.");
  return Object.freeze({
    commits: Number(row.commits),
    outcomes: Number(row.outcomes),
    feed: Number(row.feed),
    outbox: Number(row.outbox),
  });
}

type DurableCounts = Awaited<ReturnType<typeof durableCounts>>;

function sameDurableCounts(left: DurableCounts, right: DurableCounts): boolean {
  return left.commits === right.commits &&
    left.outcomes === right.outcomes &&
    left.feed === right.feed &&
    left.outbox === right.outbox;
}

async function applicationStorageCounts(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
) {
  const result = await fixture.target.query<{
    row_revisions: string;
    current_rows: string;
    index_revisions: string;
    index_current: string;
    unique_keys: string;
  }>(`select
    (select count(*)::text from fx_app_row_rev) as row_revisions,
    (select count(*)::text from fx_app_row_current) as current_rows,
    (select count(*)::text from fx_app_index_entry_rev) as index_revisions,
    (select count(*)::text from fx_app_index_entry_current) as index_current,
    (select count(*)::text from fx_app_unique_key) as unique_keys`);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Cooking application storage counts are missing.");
  }
  return Object.freeze({
    rowRevisions: Number(row.row_revisions),
    currentRows: Number(row.current_rows),
    indexRevisions: Number(row.index_revisions),
    indexCurrent: Number(row.index_current),
    uniqueKeys: Number(row.unique_keys),
  });
}

type ApplicationStorageCounts = Awaited<
  ReturnType<typeof applicationStorageCounts>
>;

function sameApplicationStorageCounts(
  left: ApplicationStorageCounts,
  right: ApplicationStorageCounts,
): boolean {
  return left.rowRevisions === right.rowRevisions &&
    left.currentRows === right.currentRows &&
    left.indexRevisions === right.indexRevisions &&
    left.indexCurrent === right.indexCurrent &&
    left.uniqueKeys === right.uniqueKeys;
}

async function managedSchemaLifecycleCounts(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
) {
  const result = await fixture.target.query<{
    candidate_heads: string;
    activations: string;
    active_heads: string;
  }>(`select
    (select count(*)::text
       from fx_system_app_schema_candidate_validation) as candidate_heads,
    (select count(*)::text
       from fx_system_application_activation_v1) as activations,
    (select count(*)::text
       from fx_system_application_active_head_v1) as active_heads`);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Cooking managed-schema lifecycle counts are missing.");
  }
  return Object.freeze({
    candidateHeads: Number(row.candidate_heads),
    activations: Number(row.activations),
    activeHeads: Number(row.active_heads),
  });
}

function isCookingRecipe(value: unknown): value is Readonly<{
  readonly name: string;
  readonly description?: string;
  readonly slug?: string;
  readonly details?: Readonly<{
    readonly difficulty: string;
    readonly servings: number;
  }>;
}> {
  if (value === null || typeof value !== "object") return false;
  const name = Reflect.get(value, "name");
  const description = Reflect.get(value, "description");
  const slug = Reflect.get(value, "slug");
  const details = Reflect.get(value, "details");
  return typeof name === "string" &&
    (description === undefined || typeof description === "string") &&
    (slug === undefined || typeof slug === "string") &&
    (details === undefined ||
      (isNonArrayRecord(details) &&
        typeof Reflect.get(details, "difficulty") === "string" &&
        typeof Reflect.get(details, "servings") === "number"));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  ))]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}
