/// <reference types="@cloudflare/workers-types" />

import { Effect, Encoding, Result, Scope } from "effect";
import { Miniflare } from "miniflare";
import {
  planAppSchemaEvolutionV1Effect,
} from "@flarex/managed-schema/planning";
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
import {
  SchemaManifestSha256Schema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import { ValidatorValueErrorV1 } from "flarex-protocol/validator-engine";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";

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
  return withCookingScenario(createFixture, async scenario =>
    (await establishCookingSchemaB(scenario)).proof
  );
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
    const schemaB = await scenario.fixture.preparePublishedSchema(
      firstSchemaB.manifest,
    );
    const clock = await scenario.fixture.target.getScopeClock(
      scenario.fixture.authority.scopeId,
    );
    if (clock === null) throw new Error("Cooking schema planning clock is missing.");
    const plan = await Effect.runPromise(planAppSchemaEvolutionV1Effect({
      authority: {
        scopeId: scenario.fixture.authority.scopeId,
        storageGeneration: scenario.fixture.authority.storageGeneration,
        storageGenerationFence:
          scenario.fixture.authority.storageGenerationFence,
        scopeEpoch: scenario.fixture.authority.epoch,
        activeSchemaVersionId:
          scenario.fixture.schemaAuthority.schemaVersionId,
        activeManifestSha256: schemaManifestSha256(
          scenario.fixture.schemaAuthority.schemaManifestSha256,
        ),
        candidateSchemaVersionId: schemaB.schemaVersionId,
        candidateManifestSha256: schemaManifestSha256(
          schemaB.schemaManifestSha256,
        ),
        dataFrontierCommitSeq: clock.lastCommitSeq,
      },
      activeManifest: scenario.fixture.schemaAuthority.manifest,
      candidateManifest: schemaB.manifest,
    }));
    if (plan.disposition !== "managedBuildAndValidation" ||
      !plan.operations.some(operation =>
        operation.safetyClass === "requiresDataValidation" &&
        operation.change.kind === "tableValidatorChanged"
      )) {
      throw new Error("Cooking schema B did not produce a managed validation plan.");
    }

    const validationInput = {
      deploymentId: scenario.fixture.deploymentId,
      schemaVersionId: schemaB.schemaVersionId,
    } as const;
    await Effect.runPromise(installAppSchemaCandidateValidationEffect(
      scenario.fixture.candidateValidation,
      validationInput,
    ));
    const failed = await advanceUntilCandidateFailure(
      scenario.fixture,
      validationInput,
    );
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

    const retriedSchemaB = await scenario.fixture.registerRevision({
      requestKey: "request:managed-schema:cooking:schema-b:retry",
      analysis: cookingAnalysis(
        schemaBSource,
        scenario.analysisLoader,
        "schema B retry",
      ),
    });
    const restarted = await Effect.runPromise(
      installAppSchemaCandidateValidationEffect(
        scenario.fixture.candidateValidation,
        validationInput,
      ),
    );
    if (restarted.disposition !== "restarted") {
      throw new Error("Cooking schema B validation did not restart at a new frontier.");
    }
    await settleReadyCandidateValidation(
      scenario.fixture,
      validationInput,
    );
    const ready = await Effect.runPromise(scenario.fixture.readiness.settle({
      deploymentId: scenario.fixture.deploymentId,
      revisionId: retriedSchemaB.publication.revisionId,
    }));
    if (ready.status !== "ready") {
      throw new Error("Remediated cooking schema B did not become ready.");
    }
    const activated = await Effect.runPromise(
      scenario.fixture.activation.activate({
        revisionId: retriedSchemaB.publication.revisionId,
        expectedActiveHead: stillSchemaA.expectedActiveHead,
      }),
    );
    if (activated.status !== "activated") {
      throw new Error("Remediated cooking schema B did not activate.");
    }
    const activeSchemaB = await Effect.runPromise(
      scenario.fixture.activation.readActive(),
    );
    if (activeSchemaB.basis.revisionId !==
        retriedSchemaB.publication.revisionId ||
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
    const clock = await scenario.fixture.target.getScopeClock(
      scenario.fixture.authority.scopeId,
    );
    if (clock === null) throw new Error("Cooking schema C planning clock is missing.");
    const plan = await Effect.runPromise(planAppSchemaEvolutionV1Effect({
      authority: {
        scopeId: scenario.fixture.authority.scopeId,
        storageGeneration: scenario.fixture.authority.storageGeneration,
        storageGenerationFence:
          scenario.fixture.authority.storageGenerationFence,
        scopeEpoch: scenario.fixture.authority.epoch,
        activeSchemaVersionId: schemaBState.activeSchemaB.basis.schemaVersionId,
        activeManifestSha256: schemaManifestSha256(
          schemaBState.schemaB.schemaManifestSha256,
        ),
        candidateSchemaVersionId: schemaC.schemaVersionId,
        candidateManifestSha256: schemaManifestSha256(
          schemaC.schemaManifestSha256,
        ),
        dataFrontierCommitSeq: clock.lastCommitSeq,
      },
      activeManifest: schemaBState.schemaB.manifest,
      candidateManifest: schemaC.manifest,
    }));
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
    const clock = await scenario.fixture.target.getScopeClock(
      scenario.fixture.authority.scopeId,
    );
    if (clock === null) throw new Error("Cooking schema D planning clock is missing.");
    const plan = await Effect.runPromise(planAppSchemaEvolutionV1Effect({
      authority: {
        scopeId: scenario.fixture.authority.scopeId,
        storageGeneration: scenario.fixture.authority.storageGeneration,
        storageGenerationFence:
          scenario.fixture.authority.storageGenerationFence,
        scopeEpoch: scenario.fixture.authority.epoch,
        activeSchemaVersionId: schemaCState.activeSchemaC.basis.schemaVersionId,
        activeManifestSha256: schemaManifestSha256(
          schemaCState.schemaC.schemaManifestSha256,
        ),
        candidateSchemaVersionId: schemaD.schemaVersionId,
        candidateManifestSha256: schemaManifestSha256(
          schemaD.schemaManifestSha256,
        ),
        dataFrontierCommitSeq: clock.lastCommitSeq,
      },
      activeManifest: schemaCState.schemaC.manifest,
      candidateManifest: schemaD.manifest,
    }));
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
    const clock = await scenario.fixture.target.getScopeClock(
      scenario.fixture.authority.scopeId,
    );
    if (clock === null) throw new Error("Cooking schema E planning clock is missing.");
    const plan = await Effect.runPromise(planAppSchemaEvolutionV1Effect({
      authority: {
        scopeId: scenario.fixture.authority.scopeId,
        storageGeneration: scenario.fixture.authority.storageGeneration,
        storageGenerationFence:
          scenario.fixture.authority.storageGenerationFence,
        scopeEpoch: scenario.fixture.authority.epoch,
        activeSchemaVersionId: schemaDState.activeSchemaD.basis.schemaVersionId,
        activeManifestSha256: schemaManifestSha256(
          schemaDState.schemaD.schemaManifestSha256,
        ),
        candidateSchemaVersionId: schemaE.schemaVersionId,
        candidateManifestSha256: schemaManifestSha256(
          schemaE.schemaManifestSha256,
        ),
        dataFrontierCommitSeq: clock.lastCommitSeq,
      },
      activeManifest: schemaDState.schemaD.manifest,
      candidateManifest: schemaE.manifest,
    }));
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
  schema: "A" | "B" | "C" | "D" | "E" | "F",
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
  const difficultyValidator = schema === "D" || schema === "E" || schema === "F"
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
          logicalName: "recipes",
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
                ...(schema === "F"
                  ? {
                    notes: {
                      fieldType: { type: "string" },
                      optional: true,
                    },
                  }
                  : {}),
              },
            },
          },
        }],
        indexes: [],
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

function schemaManifestSha256(value: string) {
  return SchemaManifestSha256Schema.make(
    Result.getOrThrow(Encoding.decodeHex(value)),
  );
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
