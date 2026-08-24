import { readFileSync } from "node:fs";

import { isNonArrayRecord } from "@flarex/utils/records";
import { bytesEqual } from "@flarex/utils/bytes";
import {
  decodeTaskRunCreationRequestKeyV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { Effect, Result } from "effect";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import {
  PointMutationOccApplicationErrorV1,
  PointMutationOccUserCodeV1Error,
} from
  "@flarex/executor/internal/stored-attempt-authentication-v1";
import { ApplicationExecutionHostError } from
  "flarex-backend/internal/application-execution-host";

import {
  defineStandardApplicationTaskV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import {
  standardV1,
  type StandardIdV1,
} from
  "@flarex/standard-application-definition/v1";

import type {
  AuthoritativeCommittedApplicationPointMutationOutcomeV1,
} from "@flarex/standard-application-invocation/v1";
import {
  ValidatorValueErrorV1,
  type ValidatorValueIssueV1,
} from "flarex-protocol/validator-engine";
import type {
  StandardApplicationSystemTestClientV1,
  StandardApplicationSystemTestSetupClientV1,
  StandardApplicationLegacySimulationMutationErrorV1 as InvokeStandardApplicationPointMutationV1Error,
  StandardApplicationLegacySimulationQueryErrorV1,
  StandardApplicationTypedReferenceV1Error,
} from "@flarex/system-test/environment/v1";
import type {
  StandardApplicationAuthoritativeInspectionV1,
  StandardApplicationSystemTestInspectionV1Error,
} from "@flarex/system-test/inspection/v1";
import {
  defineStandardApplicationSimulationV1,
} from "@flarex/system-test/simulation/v1";
import { makeCreateAndReadDefinitionV1 } from
  "../support/createAndReadDefinitionV1";

export interface CookingWorkloadProofV1 {
  readonly documentId: string;
  readonly secondaryDocumentId: string;
  readonly indexedPhantomDocumentId: string;
  readonly racePrimaryDocumentId: string;
  readonly raceCompetitorDocumentId: string;
  readonly pantryDocumentId: string;
  readonly richDocumentRoundTrip: true;
  readonly taskRunId: string;
  readonly taskCreationReplay: true;
  readonly taskNestedQueryOutputValidated: true;
  readonly taskHostedDeliveryCompleted: true;
  readonly taskMutationDocumentId: string;
  readonly taskMutationRunId: string;
  readonly taskMutationCreationReplay: true;
  readonly taskMutationWorkflowCommitted: true;
  readonly taskMutationNestedQueryOutputValidated: true;
  readonly taskMutationDuplicateDeliverySuppressed: true;
  readonly taskMutationCompletionReplayDocumentId: string;
  readonly taskMutationCompletionReplayRunId: string;
  readonly taskMutationCompletionCreationReplay: true;
  readonly taskMutationCompletionResponseReplayed: true;
  readonly taskMutationCompletionWorkflowCommitted: true;
  readonly taskMutationCompletionNestedQueryOutputValidated: true;
  readonly taskMutationResultReconciliationDocumentId: string;
  readonly taskMutationResultReconciliationRunId: string;
  readonly taskMutationResultReconciliationCreationReplay: true;
  readonly taskMutationResultPublicationReconciled: true;
  readonly taskMutationResultReconciliationWorkflowCommitted: true;
  readonly taskMutationResultReconciliationNestedQueryOutputValidated: true;
  readonly taskMutationResultUncertainDocumentId: string;
  readonly taskMutationResultUncertainRunId: string;
  readonly taskMutationResultUncertainCreationReplay: true;
  readonly taskMutationResultPublicationUncertain: true;
  readonly taskMutationResultUncertainWorkflowCommitted: true;
  readonly taskMutationResultUncertainCommittedAssessmentValidated: true;
  readonly taskMutationResultUncertainTerminalResultFabricated: false;
  readonly rejectedInvalidMutations: 5;
  readonly invalidArgumentsRejectedBeforeRuntime: true;
  readonly committedStateUnchangedAfterRejections: true;
  readonly mutationReplay: true;
  readonly secondaryMutationReplay: true;
  readonly queryReplay: true;
  readonly multipleRecipesIsolated: true;
  readonly optionalFieldOmissionRoundTrip: true;
  readonly optionalFieldDeletion: true;
  readonly optionalFieldDeletionReplay: true;
  readonly unicodeRecordRoundTrip: true;
  readonly invalidReturnRollsBack: true;
  readonly thrownFailureRollsBack: true;
  readonly failedMutationsReachedRuntime: true;
  readonly failedMutationStateUnchanged: true;
  readonly applicationInvariantRejected: true;
  readonly applicationErrorPreserved: true;
  readonly queryApplicationErrorPreserved: true;
  readonly applicationInvariantFailureStateUnchanged: true;
  readonly patchReplay: true;
  readonly replaceReplay: true;
  readonly assessmentUsesCustomLogic: true;
  readonly queryCallsInternalQuery: true;
  readonly mutationCallsInternalQuery: true;
  readonly mutationCallsInternalMutation: true;
  readonly nestedMutationReplay: true;
  readonly nestedMutationPublishesOnce: true;
  readonly deleteReplay: true;
  readonly pointMutationLifecycle: true;
  readonly deletedDocumentReadsNull: true;
  readonly indexedRangeDecisionReran: true;
  readonly indexedRangeDecisionReplay: true;
  readonly losingIndexedDecisionWriteRolledBack: true;
  readonly pantryConflictReran: true;
  readonly singleStockReservationCommitted: true;
  readonly stockNeverNegative: true;
  readonly losingReservationWritesRolledBack: true;
  readonly competitorReservationReplay: true;
  readonly workloadInspection: StandardApplicationAuthoritativeInspectionV1;
}

export interface CookingSetupProofV1 {
  readonly documentId: StandardIdV1<"recipes">;
  readonly commitSeq: bigint;
}

type CookingWorkloadErrorV1 =
  | InvokeStandardApplicationPointMutationV1Error
  | StandardApplicationLegacySimulationQueryErrorV1
  | StandardApplicationSystemTestInspectionV1Error
  | StandardApplicationTypedReferenceV1Error
  | Effect.Error<
    ReturnType<StandardApplicationSystemTestClientV1["tasks"]["create"]>
  >
  | Effect.Error<
    ReturnType<StandardApplicationSystemTestClientV1["tasks"]["deliver"]>
  >;

type CookingTaskRunCreationReceiptV1 = Effect.Success<
  ReturnType<StandardApplicationSystemTestClientV1["tasks"]["create"]>
>;

type CookingMutationInvocationErrorV1 =
  | InvokeStandardApplicationPointMutationV1Error
  | StandardApplicationTypedReferenceV1Error;

type CookingUserCodeFailureV1 = Extract<
  CookingMutationInvocationErrorV1,
  PointMutationOccUserCodeV1Error
>;

type CookingApplicationFailureV1 = Extract<
  CookingMutationInvocationErrorV1,
  PointMutationOccApplicationErrorV1
>;

type CookingMutationAttemptResultV1 = Result.Result<
  AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  InvokeStandardApplicationPointMutationV1Error
>;

type CookingTypedMutationResultV1 = Result.Result<
  AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  CookingMutationInvocationErrorV1
>;

type CookingExpectedArgumentIssueV1 = Extract<
  ValidatorValueIssueV1,
  {
    readonly reason:
      | "typeMismatch"
      | "missingRequiredField"
      | "unexpectedField"
      | "unionMismatch";
  }
>;

const COOKING_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:create",
);
const COOKING_INVALID_AMOUNT_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:invalid-ingredient-amount",
  );
const COOKING_MISSING_NAME_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:missing-ingredient-name",
);
const COOKING_INVALID_DIFFICULTY_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:invalid-difficulty",
  );
const COOKING_INVALID_LOCALIZED_TITLE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:invalid-localized-title",
  );
const COOKING_UNEXPECTED_FIELD_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:unexpected-field",
  );
const COOKING_SECOND_RECIPE_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:create-second",
);
const COOKING_INVALID_RETURN_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:patch-invalid-return",
);
const COOKING_THROW_AFTER_PATCH_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:patch-then-throw",
  );
const COOKING_PATCH_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:patch",
);
const COOKING_REMOVE_DESCRIPTION_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:remove-description",
  );
const COOKING_REPLACE_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:replace",
);
const COOKING_PUBLISH_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:publish",
);
const COOKING_REJECTED_PUBLISH_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:publish-incomplete",
  );
const COOKING_DELETE_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:delete",
);
const COOKING_INDEXED_DECISION_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make("sac01:cooking:publish-smallest-batch");
const COOKING_INDEXED_PHANTOM_CREATE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make("sac01:cooking:indexed-phantom-create");
const COOKING_RACE_PRIMARY_CREATE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make("sac01:cooking:race-primary-create");
const COOKING_RACE_COMPETITOR_CREATE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make("sac01:cooking:race-competitor-create");
const COOKING_PANTRY_CREATE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make("sac01:cooking:pantry-create");
const COOKING_RACE_PRIMARY_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make("sac01:cooking:race-primary");
const COOKING_RACE_COMPETITOR_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make("sac01:cooking:race-competitor");
const COOKING_SERVING_GUIDE_TASK_REQUEST_KEY = Result.getOrThrow(
  decodeTaskRunCreationRequestKeyV1("sac01:cooking:serving-guide-task"),
);
const COOKING_TASK_DRAFT_CREATE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make("sac01:cooking:task-draft-create");
const COOKING_PUBLISH_SERVING_GUIDE_TASK_REQUEST_KEY = Result.getOrThrow(
  decodeTaskRunCreationRequestKeyV1(
    "sac01:cooking:publish-serving-guide-task",
  ),
);
const COOKING_COMPLETION_REPLAY_DRAFT_CREATE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:completion-replay-draft-create",
  );
const COOKING_COMPLETION_REPLAY_TASK_REQUEST_KEY = Result.getOrThrow(
  decodeTaskRunCreationRequestKeyV1(
    "sac01:cooking:completion-replay-serving-guide-task",
  ),
);
const COOKING_RESULT_RECONCILIATION_DRAFT_CREATE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:result-reconciliation-draft-create",
  );
const COOKING_RESULT_RECONCILIATION_TASK_REQUEST_KEY = Result.getOrThrow(
  decodeTaskRunCreationRequestKeyV1(
    "sac01:cooking:result-reconciliation-serving-guide-task",
  ),
);
const COOKING_RESULT_UNCERTAIN_DRAFT_CREATE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:result-uncertain-draft-create",
  );
const COOKING_RESULT_UNCERTAIN_TASK_REQUEST_KEY = Result.getOrThrow(
  decodeTaskRunCreationRequestKeyV1(
    "sac01:cooking:result-uncertain-serving-guide-task",
  ),
);
const COOKING_TASK_IDENTITY_SUBJECT = "cooking-task-user";
const COOKING_TASK_EXECUTION_IDENTITY = Object.freeze({
  kind: "user" as const,
  user: Object.freeze({
    tokenIdentifier: "standard-application-system-test",
    subject: COOKING_TASK_IDENTITY_SUBJECT,
    issuer: "https://system-test.flarex.invalid",
  }),
});
const COOKING_FUNCTION_SOURCES = {
  create: readFileSync(new URL(
    "./functions/recipeCreate.js",
    import.meta.url,
  )),
  patch: readFileSync(new URL(
    "./functions/recipePatch.js",
    import.meta.url,
  )),
  replace: readFileSync(new URL(
    "./functions/recipeReplace.js",
    import.meta.url,
  )),
  remove: readFileSync(new URL(
    "./functions/recipeDelete.js",
    import.meta.url,
  )),
  get: readFileSync(new URL(
    "./functions/recipesQuery.js",
    import.meta.url,
  )),
  assess: readFileSync(new URL(
    "./functions/recipeAssessment.js",
    import.meta.url,
  )),
  assessmentView: readFileSync(new URL(
    "./functions/recipeAssessmentView.js",
    import.meta.url,
  )),
  publicationView: readFileSync(new URL(
    "./functions/recipePublicationView.js",
    import.meta.url,
  )),
  publishInternal: readFileSync(new URL(
    "./functions/recipePublishInternal.js",
    import.meta.url,
  )),
  publishWorkflow: readFileSync(new URL(
    "./functions/recipePublishWorkflow.js",
    import.meta.url,
  )),
  servingSelection: readFileSync(new URL(
    "./functions/recipeServingSelection.js",
    import.meta.url,
  )),
  pantryCreate: readFileSync(new URL(
    "./functions/pantryCreate.js",
    import.meta.url,
  )),
  pantryQuery: readFileSync(new URL(
    "./functions/pantryQuery.js",
    import.meta.url,
  )),
  pantryReservation: readFileSync(new URL(
    "./functions/pantryReservation.js",
    import.meta.url,
  )),
} as const;
const COOKING_RECIPE = {
  title: "Tomato soup",
  description: "A slow-simmered weeknight soup.",
  servings: 4,
  difficulty: "medium",
  published: true,
  tags: ["soup", "vegetarian"],
  ingredients: [{
    name: "Tomato",
    amount: 6,
    unit: "whole",
    note: "ripe",
  }, {
    name: "Vegetable stock",
    amount: 750,
    unit: "ml",
  }],
  steps: [{
    position: 1,
    instruction: "Roast the tomatoes.",
    durationMinutes: 25,
  }, {
    position: 2,
    instruction: "Blend and simmer with stock.",
  }],
  nutrition: {
    caloriesPerServing: 180,
    vegetarian: true,
  },
  localizedTitles: {
    en: "Tomato soup",
    es: "Sopa de tomate",
  },
  source: null,
} as const;
const COOKING_RECIPE_WITH_INVALID_INGREDIENT_AMOUNT = {
  ...COOKING_RECIPE,
  ingredients: [{
    ...COOKING_RECIPE.ingredients[0],
    amount: "six",
  }, COOKING_RECIPE.ingredients[1]],
} as const;
const COOKING_RECIPE_WITH_MISSING_INGREDIENT_NAME = {
  ...COOKING_RECIPE,
  ingredients: [{
    amount: 6,
    unit: "whole",
    note: "ripe",
  }, COOKING_RECIPE.ingredients[1]],
} as const;
const COOKING_RECIPE_WITH_INVALID_DIFFICULTY = {
  ...COOKING_RECIPE,
  difficulty: "expert",
} as const;
const COOKING_RECIPE_WITH_INVALID_LOCALIZED_TITLE = {
  ...COOKING_RECIPE,
  localizedTitles: {
    en: 42,
  },
} as const;
const COOKING_RECIPE_WITH_UNEXPECTED_FIELD = {
  ...COOKING_RECIPE,
  internalNotes: "This field is not part of the recipe contract.",
} as const;
const COOKING_SECOND_RECIPE = {
  title: "Mohinga",
  servings: 2,
  difficulty: "easy",
  published: false,
  tags: [],
  ingredients: [{
    name: "Rice noodles",
    amount: 250,
    unit: "g",
  }, {
    name: "Fish broth",
    amount: 600,
    unit: "ml",
    note: "warm",
  }],
  steps: [],
  nutrition: {
    caloriesPerServing: 410,
    vegetarian: false,
  },
  localizedTitles: {
    en: "Mohinga",
    my: "မုန့်ဟင်းခါး",
  },
  source: null,
} as const;
const COOKING_PATCH = {
  description: "A doubled batch for the freezer.",
  servings: 8,
} as const;
const COOKING_RECIPE_AFTER_PATCH = {
  ...COOKING_RECIPE,
  ...COOKING_PATCH,
} as const;
const COOKING_REPLACEMENT_RECIPE = {
  title: "Mushroom risotto",
  description: "A creamy rice dish finished with herbs.",
  servings: 3,
  difficulty: "hard",
  published: false,
  tags: ["rice", "vegetarian"],
  ingredients: [{
    name: "Arborio rice",
    amount: 300,
    unit: "g",
  }, {
    name: "Mushroom",
    amount: 250,
    unit: "g",
    note: "sliced",
  }],
  steps: [{
    position: 1,
    instruction: "Toast the rice.",
  }, {
    position: 2,
    instruction: "Add stock gradually and stir.",
    durationMinutes: 30,
  }],
  nutrition: {
    caloriesPerServing: 520,
    vegetarian: true,
  },
  localizedTitles: {
    en: "Mushroom risotto",
    it: "Risotto ai funghi",
  },
  source: "Kitchen notebook",
} as const;
const COOKING_RACE_PRIMARY_RECIPE = {
  ...COOKING_REPLACEMENT_RECIPE,
  title: "Pantry race primary",
  localizedTitles: { en: "Pantry race primary" },
  source: "Concurrency fixture",
} as const;
const COOKING_INDEXED_PHANTOM_RECIPE = {
  ...COOKING_REPLACEMENT_RECIPE,
  title: "Solo omelette",
  servings: 1,
  difficulty: "easy",
  localizedTitles: { en: "Solo omelette" },
  source: "Indexed decision fixture",
} as const;
const COOKING_RACE_COMPETITOR_RECIPE = {
  ...COOKING_REPLACEMENT_RECIPE,
  title: "Pantry race competitor",
  localizedTitles: { en: "Pantry race competitor" },
  source: "Concurrency fixture",
} as const;
const COOKING_PANTRY_STOCK = {
  ingredient: "shared-stock",
  available: 1,
} as const;
const COOKING_DEPLETED_PANTRY_STOCK = {
  ingredient: "shared-stock",
  available: 0,
} as const;
const COOKING_TASK_DRAFT_RECIPE = {
  ...COOKING_REPLACEMENT_RECIPE,
  title: "Task-baked mushroom risotto",
  localizedTitles: { en: "Task-baked mushroom risotto" },
  source: "Durable Task fixture",
} as const;
const COOKING_COMPLETION_REPLAY_DRAFT_RECIPE = {
  ...COOKING_REPLACEMENT_RECIPE,
  title: "Replay-safe mushroom risotto",
  localizedTitles: { en: "Replay-safe mushroom risotto" },
  source: "Completion replay fixture",
} as const;
const COOKING_RESULT_RECONCILIATION_DRAFT_RECIPE = {
  ...COOKING_REPLACEMENT_RECIPE,
  title: "Reconciled mushroom risotto",
  localizedTitles: { en: "Reconciled mushroom risotto" },
  source: "Result reconciliation fixture",
} as const;
const COOKING_RESULT_UNCERTAIN_DRAFT_RECIPE = {
  ...COOKING_REPLACEMENT_RECIPE,
  title: "Uncertain mushroom risotto",
  localizedTitles: { en: "Uncertain mushroom risotto" },
  source: "Result uncertainty fixture",
} as const;
const COOKING_INITIAL_ASSESSMENT = {
  title: "Tomato soup",
  servings: 4,
  published: true,
  ingredientCount: 2,
  stepCount: 2,
  timedMinutes: 25,
  publishable: true,
  headline: "Tomato soup serves 4",
  effort: "short",
} as const;
const COOKING_REPLACEMENT_ASSESSMENT = {
  title: "Mushroom risotto",
  servings: 3,
  published: false,
  ingredientCount: 2,
  stepCount: 2,
  timedMinutes: 30,
  publishable: true,
  headline: "Mushroom risotto serves 3",
  effort: "long",
} as const;
const COOKING_PUBLISHED_ASSESSMENT = {
  ...COOKING_REPLACEMENT_ASSESSMENT,
  published: true,
} as const;
const COOKING_TASK_PUBLISHED_ASSESSMENT = {
  ...COOKING_PUBLISHED_ASSESSMENT,
  title: "Task-baked mushroom risotto",
  headline: "Task-baked mushroom risotto serves 3",
} as const;
const COOKING_COMPLETION_REPLAY_PUBLISHED_ASSESSMENT = {
  ...COOKING_PUBLISHED_ASSESSMENT,
  title: "Replay-safe mushroom risotto",
  headline: "Replay-safe mushroom risotto serves 3",
} as const;
const COOKING_RESULT_RECONCILIATION_PUBLISHED_ASSESSMENT = {
  ...COOKING_PUBLISHED_ASSESSMENT,
  title: "Reconciled mushroom risotto",
  headline: "Reconciled mushroom risotto serves 3",
} as const;
const COOKING_RESULT_UNCERTAIN_PUBLISHED_ASSESSMENT = {
  ...COOKING_PUBLISHED_ASSESSMENT,
  title: "Uncertain mushroom risotto",
  headline: "Uncertain mushroom risotto serves 3",
} as const;
const COOKING_TASK_DUPLICATE_DELIVERY_FAULT = {
  kind: "duplicate_delivery",
  duplicate: {
    dispatchCandidatesHandled: 0,
    dispatchProviderCalls: 0,
    cancellationCandidatesHandled: 0,
    cancellationProviderCalls: 0,
    candidateFailures: 0,
  },
} as const;
const COOKING_TASK_COMPLETION_RESPONSE_LOST_FAULT = {
  kind: "completion_response_lost",
  completionAttempts: 2,
  replayedSameCompletion: true,
  disposition: "idempotent",
} as const;
const COOKING_TASK_RESULT_PUBLICATION_RECONCILED_FAULT = {
  kind: "result_publication_reconciled",
  publicationAttempts: 1,
  reconciliationReads: 1,
} as const;
const COOKING_PUBLISH_RECEIPT = {
  changed: true,
  beforePublished: false,
  afterPublished: true,
  ingredientCount: 2,
  timedMinutes: 30,
} as const;
const COOKING_FIELDS = {
  title: standardV1.string(),
  description: standardV1.optional(standardV1.string()),
  servings: standardV1.number(),
  difficulty: standardV1.union(
    standardV1.literal("easy"),
    standardV1.literal("medium"),
    standardV1.literal("hard"),
  ),
  published: standardV1.boolean(),
  tags: standardV1.array(standardV1.string()),
  ingredients: standardV1.array(standardV1.object({
    name: standardV1.string(),
    amount: standardV1.number(),
    unit: standardV1.string(),
    note: standardV1.optional(standardV1.string()),
  })),
  steps: standardV1.array(standardV1.object({
    position: standardV1.number(),
    instruction: standardV1.string(),
    durationMinutes: standardV1.optional(standardV1.number()),
  })),
  nutrition: standardV1.object({
    caloriesPerServing: standardV1.number(),
    vegetarian: standardV1.boolean(),
  }),
  localizedTitles: standardV1.record(
    standardV1.string(),
    standardV1.string(),
  ),
  source: standardV1.nullable(standardV1.string()),
} as const;
const COOKING_DOCUMENT = standardV1.object({
  _id: standardV1.id("recipes"),
  _creationTime: standardV1.number(),
  ...COOKING_FIELDS,
});
const COOKING_PANTRY_FIELDS = {
  ingredient: standardV1.string(),
  available: standardV1.number(),
} as const;
const COOKING_PANTRY_DOCUMENT = standardV1.object({
  _id: standardV1.id("pantryStock"),
  _creationTime: standardV1.number(),
  ...COOKING_PANTRY_FIELDS,
});
const COOKING_ID_ARGS = standardV1.object({ id: standardV1.string() });
const COOKING_ASSESSMENT_FIELDS = {
  title: standardV1.string(),
  servings: standardV1.number(),
  published: standardV1.boolean(),
  ingredientCount: standardV1.number(),
  stepCount: standardV1.number(),
  timedMinutes: standardV1.number(),
  publishable: standardV1.boolean(),
} as const;
const COOKING_ASSESSMENT = standardV1.nullable(
  standardV1.object(COOKING_ASSESSMENT_FIELDS),
);
const COOKING_ASSESSMENT_VIEW_FIELDS = {
  ...COOKING_ASSESSMENT_FIELDS,
  headline: standardV1.string(),
  effort: standardV1.union(
    standardV1.literal("short"),
    standardV1.literal("long"),
  ),
} as const;
const COOKING_ASSESSMENT_VIEW = standardV1.nullable(
  standardV1.object(COOKING_ASSESSMENT_VIEW_FIELDS),
);
const COOKING_PUBLISH_RECEIPT_FIELDS = {
  changed: standardV1.boolean(),
  beforePublished: standardV1.boolean(),
  afterPublished: standardV1.boolean(),
  ingredientCount: standardV1.number(),
  timedMinutes: standardV1.number(),
} as const;
const COOKING_PUBLISH_RECEIPT_VALIDATOR = standardV1.nullable(
  standardV1.object(COOKING_PUBLISH_RECEIPT_FIELDS),
);
const COOKING_RESERVATION_RECEIPT_VALIDATOR = standardV1.nullable(
  standardV1.object({
    pantryId: standardV1.id("pantryStock"),
    recipeId: standardV1.id("recipes"),
    remainingStock: standardV1.number(),
  }),
);
const COOKING_INDEXED_DECISION_RECEIPT_VALIDATOR = standardV1.nullable(
  standardV1.object({
    recipeId: standardV1.id("recipes"),
    servings: standardV1.number(),
    pageExhausted: standardV1.boolean(),
  }),
);
const COOKING_MUTATION_MODULE = standardV1.module("recipeCommands", {
  create: standardV1.publicMutation({
    args: standardV1.object(COOKING_FIELDS),
    returns: standardV1.id("recipes"),
  }),
});
const COOKING_PATCH_MODULE = standardV1.module("recipePatch", {
  patch: standardV1.publicMutation({
    args: standardV1.object({
      id: standardV1.id("recipes"),
      patch: standardV1.object({
        title: standardV1.optional(standardV1.string()),
        description: standardV1.optional(standardV1.string()),
        servings: standardV1.optional(standardV1.number()),
        difficulty: standardV1.optional(standardV1.union(
          standardV1.literal("easy"),
          standardV1.literal("medium"),
          standardV1.literal("hard"),
        )),
        published: standardV1.optional(standardV1.boolean()),
        tags: standardV1.optional(standardV1.array(standardV1.string())),
        ingredients: standardV1.optional(COOKING_FIELDS.ingredients),
        steps: standardV1.optional(COOKING_FIELDS.steps),
        nutrition: standardV1.optional(COOKING_FIELDS.nutrition),
        localizedTitles: standardV1.optional(COOKING_FIELDS.localizedTitles),
        source: standardV1.optional(COOKING_FIELDS.source),
      }),
    }),
    returns: standardV1.null(),
  }),
  removeDescription: standardV1.publicMutation({
    args: standardV1.object({ id: standardV1.id("recipes") }),
    returns: standardV1.null(),
  }),
  patchThenReturnInvalid: standardV1.publicMutation({
    args: standardV1.object({ id: standardV1.id("recipes") }),
    returns: standardV1.null(),
  }),
  patchThenThrow: standardV1.publicMutation({
    args: standardV1.object({ id: standardV1.id("recipes") }),
    returns: standardV1.null(),
  }),
});
const COOKING_REPLACE_MODULE = standardV1.module("recipeReplace", {
  replace: standardV1.publicMutation({
    args: standardV1.object({
      id: standardV1.id("recipes"),
      fields: standardV1.object(COOKING_FIELDS),
    }),
    returns: standardV1.null(),
  }),
});
const COOKING_DELETE_MODULE = standardV1.module("recipeDelete", {
  remove: standardV1.publicMutation({
    args: standardV1.object({ id: standardV1.id("recipes") }),
    returns: standardV1.null(),
  }),
});
const COOKING_QUERY_MODULE = standardV1.module("recipes", {
  get: standardV1.publicQuery({
    args: COOKING_ID_ARGS,
    returns: standardV1.nullable(COOKING_DOCUMENT),
  }),
});
const COOKING_ASSESSMENT_MODULE = standardV1.module("recipeAssessment", {
  assess: standardV1.internalQuery({
    args: COOKING_ID_ARGS,
    returns: COOKING_ASSESSMENT,
  }),
});
const COOKING_ASSESSMENT_VIEW_MODULE = standardV1.module("recipeViews", {
  assessment: standardV1.publicQuery({
    args: COOKING_ID_ARGS,
    returns: COOKING_ASSESSMENT_VIEW,
  }),
});
const COOKING_PUBLICATION_VIEW_MODULE = standardV1.module(
  "recipePublicationView",
  {
    requirePublished: standardV1.publicQuery({
      args: COOKING_ID_ARGS,
      returns: standardV1.nullable(COOKING_DOCUMENT),
    }),
  },
);
const COOKING_MAINTENANCE_MODULE = standardV1.module("recipeMaintenance", {
  markPublished: standardV1.internalMutation({
    args: COOKING_ID_ARGS,
    returns: COOKING_PUBLISH_RECEIPT_VALIDATOR,
  }),
});
const COOKING_WORKFLOW_MODULE = standardV1.module("recipeWorkflows", {
  publish: standardV1.publicMutation({
    args: COOKING_ID_ARGS,
    returns: COOKING_PUBLISH_RECEIPT_VALIDATOR,
  }),
});
const COOKING_INDEXED_DECISION_MODULE = standardV1.module(
  "recipeServingSelection",
  {
    publishSmallestBatch: standardV1.publicMutation({
      args: standardV1.object({}),
      returns: COOKING_INDEXED_DECISION_RECEIPT_VALIDATOR,
    }),
  },
);
const COOKING_PANTRY_COMMAND_MODULE = standardV1.module("pantryCommands", {
  create: standardV1.publicMutation({
    args: standardV1.object(COOKING_PANTRY_FIELDS),
    returns: standardV1.id("pantryStock"),
  }),
});
const COOKING_PANTRY_QUERY_MODULE = standardV1.module("pantry", {
  get: standardV1.publicQuery({
    args: standardV1.object({ id: standardV1.id("pantryStock") }),
    returns: standardV1.nullable(COOKING_PANTRY_DOCUMENT),
  }),
});
const COOKING_RESERVATION_MODULE = standardV1.module("pantryReservation", {
  reserveAndPublish: standardV1.publicMutation({
    args: standardV1.object({
      pantryId: standardV1.id("pantryStock"),
      recipeId: standardV1.id("recipes"),
    }),
    returns: COOKING_RESERVATION_RECEIPT_VALIDATOR,
  }),
});
const COOKING_SERVING_GUIDE_TASK = Result.getOrThrow(
  defineStandardApplicationTaskV1({
    taskId: "cooking.buildServingGuide",
    handler: {
      logicalModulePath: "recipeViews",
      artifactModulePath: "recipeAssessmentView",
      exportName: "buildServingGuide",
    },
    payload: standardV1.object({
      recipeId: standardV1.id("recipes"),
    }),
    output: standardV1.object({
      recipeId: standardV1.id("recipes"),
      assessment: standardV1.object(COOKING_ASSESSMENT_VIEW_FIELDS),
    }),
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 1,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 30,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  }),
);
const COOKING_PUBLISH_SERVING_GUIDE_TASK = Result.getOrThrow(
  defineStandardApplicationTaskV1({
    taskId: "cooking.publishServingGuide",
    handler: {
      logicalModulePath: "recipeViews",
      artifactModulePath: "recipeAssessmentView",
      exportName: "publishServingGuide",
    },
    payload: standardV1.object({
      recipeId: standardV1.id("recipes"),
    }),
    output: standardV1.object({
      recipeId: standardV1.id("recipes"),
      publication: standardV1.object(COOKING_PUBLISH_RECEIPT_FIELDS),
      assessment: standardV1.object(COOKING_ASSESSMENT_VIEW_FIELDS),
    }),
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 1,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 30,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  }),
);
const COOKING_CREATE = COOKING_MUTATION_MODULE.reference("create");
const COOKING_PATCH_FUNCTION = COOKING_PATCH_MODULE.reference("patch");
const COOKING_REMOVE_DESCRIPTION =
  COOKING_PATCH_MODULE.reference("removeDescription");
const COOKING_PATCH_THEN_RETURN_INVALID =
  COOKING_PATCH_MODULE.reference("patchThenReturnInvalid");
const COOKING_PATCH_THEN_THROW =
  COOKING_PATCH_MODULE.reference("patchThenThrow");
const COOKING_REPLACE = COOKING_REPLACE_MODULE.reference("replace");
const COOKING_DELETE = COOKING_DELETE_MODULE.reference("remove");
const COOKING_GET = COOKING_QUERY_MODULE.reference("get");
const COOKING_ASSESSMENT_FUNCTION =
  COOKING_ASSESSMENT_VIEW_MODULE.reference("assessment");
const COOKING_REQUIRE_PUBLISHED =
  COOKING_PUBLICATION_VIEW_MODULE.reference("requirePublished");
const COOKING_PUBLISH = COOKING_WORKFLOW_MODULE.reference("publish");
const COOKING_PUBLISH_SMALLEST_BATCH =
  COOKING_INDEXED_DECISION_MODULE.reference("publishSmallestBatch");
const COOKING_PANTRY_CREATE =
  COOKING_PANTRY_COMMAND_MODULE.reference("create");
const COOKING_PANTRY_GET = COOKING_PANTRY_QUERY_MODULE.reference("get");
const COOKING_RESERVE_AND_PUBLISH =
  COOKING_RESERVATION_MODULE.reference("reserveAndPublish");

const prepareCookingStateV1 = Effect.fn(
  "SystemTestCookingSimulation.setupV1",
)(function* (
  client: StandardApplicationSystemTestSetupClientV1,
): Effect.fn.Return<CookingSetupProofV1, CookingWorkloadErrorV1> {
  const inserted = yield* client.mutation(
    COOKING_CREATE,
    COOKING_RECIPE,
    COOKING_REQUEST_KEY,
  );
  if (
    inserted.status !== "committed" ||
    inserted.disposition !== "published" ||
    typeof inserted.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The cooking setup did not publish an authoritative recipe id.",
    ));
  }
  return { documentId: inserted.value, commitSeq: inserted.commitSeq };
});

const runCookingWorkloadV1 = Effect.fn(
  "SystemTestCookingSimulation.workloadV1",
)(function* (
  client: StandardApplicationSystemTestClientV1,
  setup: CookingSetupProofV1,
): Effect.fn.Return<CookingWorkloadProofV1, CookingWorkloadErrorV1> {
  const replayedMutation = yield* client.mutation(
    COOKING_CREATE,
    COOKING_RECIPE,
    COOKING_REQUEST_KEY,
  );
  if (
    replayedMutation.disposition !== "replayed" ||
    replayedMutation.commitSeq !== setup.commitSeq ||
    replayedMutation.value !== setup.documentId
  ) {
    return yield* Effect.die(new Error(
      "The cooking workload did not deterministically replay its mutation.",
    ));
  }

  const taskRequest = Object.freeze({
    version: 1 as const,
    requestKey: COOKING_SERVING_GUIDE_TASK_REQUEST_KEY,
    payload: Object.freeze({ recipeId: setup.documentId }),
    executionIdentity: COOKING_TASK_EXECUTION_IDENTITY,
  });
  const taskFirst = yield* client.tasks.create(
    COOKING_SERVING_GUIDE_TASK.reference,
    taskRequest,
  );
  const taskReplay = yield* client.tasks.create(
    COOKING_SERVING_GUIDE_TASK.reference,
    taskRequest,
  );
  if (!sameTaskRunCreationReceiptV1(taskReplay, taskFirst)) {
    return yield* Effect.die(new Error(
      "The cooking serving-guide Task did not replay its durable run.",
    ));
  }
  const taskDelivery = yield* client.tasks.deliver(
    COOKING_SERVING_GUIDE_TASK.reference,
    taskFirst,
    { kind: "completion" },
  );
  if (
    taskDelivery.status !== "succeeded" ||
    taskDelivery.runId !== taskFirst.runId ||
    taskDelivery.worker.generation !== "application_v1" ||
    taskDelivery.worker.loads !== 1 ||
    taskDelivery.worker.starts !== 1 ||
    taskDelivery.worker.settlements !== 1 ||
    taskDelivery.worker.resultWrites !== 1 ||
    taskDelivery.worker.resultReads !== 2 ||
    !sameJsonValue(taskDelivery.output, {
      recipeId: setup.documentId,
      assessment: COOKING_INITIAL_ASSESSMENT,
    })
  ) {
    return yield* Effect.die(new Error(
      "The cooking serving-guide Task did not complete through the hosted nested-query path.",
    ));
  }

  const firstRead = yield* client.query(
    COOKING_GET,
    { id: setup.documentId },
  );
  requireRecipeDocument(firstRead, setup.documentId, COOKING_RECIPE);

  const beforeInvalidInputInspection =
    yield* client.inspectAuthoritativeState();
  const invalidAmountResult = yield* Effect.result(client.unsafeInvokeMutation(
    TransactionFunctionPathV1Schema.make(COOKING_CREATE.path),
    COOKING_RECIPE_WITH_INVALID_INGREDIENT_AMOUNT,
    COOKING_INVALID_AMOUNT_REQUEST_KEY,
  ));
  requireArgumentValidationFailure(
    invalidAmountResult,
    "invalid nested ingredient amount",
    {
      reason: "typeMismatch",
      path: "$args.ingredients[0].amount",
      expected: "number",
    },
  );
  const invalidDifficultyResult = yield* Effect.result(
    client.unsafeInvokeMutation(
      TransactionFunctionPathV1Schema.make(COOKING_CREATE.path),
      COOKING_RECIPE_WITH_INVALID_DIFFICULTY,
      COOKING_INVALID_DIFFICULTY_REQUEST_KEY,
    ),
  );
  requireArgumentValidationFailure(
    invalidDifficultyResult,
    "invalid difficulty literal union",
    {
      reason: "unionMismatch",
      path: "$args.difficulty",
      memberCount: 3,
    },
  );
  const invalidLocalizedTitleResult = yield* Effect.result(
    client.unsafeInvokeMutation(
      TransactionFunctionPathV1Schema.make(COOKING_CREATE.path),
      COOKING_RECIPE_WITH_INVALID_LOCALIZED_TITLE,
      COOKING_INVALID_LOCALIZED_TITLE_REQUEST_KEY,
    ),
  );
  requireArgumentValidationFailure(
    invalidLocalizedTitleResult,
    "invalid localized-title record value",
    {
      reason: "typeMismatch",
      path: "$args.localizedTitles.en",
      expected: "string",
    },
  );
  const unexpectedFieldResult = yield* Effect.result(
    client.unsafeInvokeMutation(
      TransactionFunctionPathV1Schema.make(COOKING_CREATE.path),
      COOKING_RECIPE_WITH_UNEXPECTED_FIELD,
      COOKING_UNEXPECTED_FIELD_REQUEST_KEY,
    ),
  );
  requireArgumentValidationFailure(
    unexpectedFieldResult,
    "unexpected top-level field",
    {
      reason: "unexpectedField",
      path: "$args.internalNotes",
      field: "internalNotes",
    },
  );
  const missingNameResult = yield* Effect.result(client.unsafeInvokeMutation(
    TransactionFunctionPathV1Schema.make(COOKING_CREATE.path),
    COOKING_RECIPE_WITH_MISSING_INGREDIENT_NAME,
    COOKING_MISSING_NAME_REQUEST_KEY,
  ));
  requireArgumentValidationFailure(
    missingNameResult,
    "missing required nested ingredient name",
    {
      reason: "missingRequiredField",
      path: "$args.ingredients[0].name",
      field: "name",
    },
  );
  const afterInvalidInputInspection = yield* client.inspectAuthoritativeState();
  requireNoRejectedMutationSideEffects(
    beforeInvalidInputInspection,
    afterInvalidInputInspection,
  );

  const replayedRead = yield* client.query(
    COOKING_GET,
    { id: setup.documentId },
  );
  requireRecipeDocument(replayedRead, setup.documentId, COOKING_RECIPE);
  if (JSON.stringify(firstRead) !== JSON.stringify(replayedRead)) {
    return yield* Effect.die(new Error(
      "The cooking workload did not deterministically replay its point query.",
    ));
  }

  const secondaryInserted = yield* client.mutation(
    COOKING_CREATE,
    COOKING_SECOND_RECIPE,
    COOKING_SECOND_RECIPE_REQUEST_KEY,
  );
  if (
    secondaryInserted.status !== "committed" ||
    secondaryInserted.disposition !== "published" ||
    secondaryInserted.commitSeq !== setup.commitSeq + 1n ||
    typeof secondaryInserted.value !== "string" ||
    secondaryInserted.value === setup.documentId
  ) {
    return yield* Effect.die(new Error(
      "The cooking workload did not publish an independent second recipe.",
    ));
  }
  const secondaryDocumentId = secondaryInserted.value;
  const replayedSecondaryMutation = yield* client.mutation(
    COOKING_CREATE,
    COOKING_SECOND_RECIPE,
    COOKING_SECOND_RECIPE_REQUEST_KEY,
  );
  if (
    replayedSecondaryMutation.disposition !== "replayed" ||
    replayedSecondaryMutation.commitSeq !== secondaryInserted.commitSeq ||
    replayedSecondaryMutation.value !== secondaryDocumentId
  ) {
    return yield* Effect.die(new Error(
      "The cooking workload did not replay the second recipe creation.",
    ));
  }
  const secondaryRead = yield* client.query(
    COOKING_GET,
    { id: secondaryDocumentId },
  );
  requireRecipeDocument(
    secondaryRead,
    secondaryDocumentId,
    COOKING_SECOND_RECIPE,
  );
  const beforeQueryApplicationError = yield* client.inspectAuthoritativeState();
  const queryApplicationError = yield* Effect.result(client.query(
    COOKING_REQUIRE_PUBLISHED,
    { id: secondaryDocumentId },
  ));
  requireQueryApplicationFailure(queryApplicationError, secondaryDocumentId);
  const afterQueryApplicationError = yield* client.inspectAuthoritativeState();
  requireFailedQueryIsReadOnly(
    beforeQueryApplicationError,
    afterQueryApplicationError,
  );

  const beforeApplicationInvariant =
    yield* client.inspectAuthoritativeState();
  const rejectedPublish = yield* Effect.result(client.mutation(
    COOKING_PUBLISH,
    { id: secondaryDocumentId },
    COOKING_REJECTED_PUBLISH_REQUEST_KEY,
  ));
  requireApplicationFailure(
    rejectedPublish,
    secondaryDocumentId,
  );
  const afterApplicationInvariant = yield* client.inspectAuthoritativeState();
  requireFailedMutationRollback(
    beforeApplicationInvariant,
    afterApplicationInvariant,
    1,
  );
  const secondaryReadAfterRejectedPublish = yield* client.query(
    COOKING_GET,
    { id: secondaryDocumentId },
  );
  requireRecipeDocument(
    secondaryReadAfterRejectedPublish,
    secondaryDocumentId,
    COOKING_SECOND_RECIPE,
  );

  const beforeFailedMutations = yield* client.inspectAuthoritativeState();
  const invalidReturnResult = yield* Effect.result(client.mutation(
    COOKING_PATCH_THEN_RETURN_INVALID,
    { id: setup.documentId },
    COOKING_INVALID_RETURN_REQUEST_KEY,
  ));
  requireUserCodeFailure(
    invalidReturnResult,
    "patch with invalid return value",
  );
  let failedRuntimeInterleavingExecutions = 0;
  yield* client.scheduleAfterNextMutationRuntime(() => Effect.sync(() => {
    failedRuntimeInterleavingExecutions += 1;
  }));
  const thrownMutationResult = yield* Effect.result(client.mutation(
    COOKING_PATCH_THEN_THROW,
    { id: setup.documentId },
    COOKING_THROW_AFTER_PATCH_REQUEST_KEY,
  ));
  requireUserCodeFailure(
    thrownMutationResult,
    "patch followed by a user-code throw",
  );
  if (failedRuntimeInterleavingExecutions !== 1) {
    return yield* Effect.die(new Error(
      "The cooking failed-runtime interleaving did not run exactly once.",
    ));
  }
  const afterFailedMutations = yield* client.inspectAuthoritativeState();
  requireFailedMutationRollback(
    beforeFailedMutations,
    afterFailedMutations,
    2,
  );
  const primaryReadAfterFailedMutations = yield* client.query(
    COOKING_GET,
    { id: setup.documentId },
  );
  requireRecipeDocument(
    primaryReadAfterFailedMutations,
    setup.documentId,
    COOKING_RECIPE,
  );

  const patched = yield* client.mutation(
    COOKING_PATCH_FUNCTION,
    { id: setup.documentId, patch: COOKING_PATCH },
    COOKING_PATCH_REQUEST_KEY,
  );
  requireLifecycleMutation(
    patched,
    "patch",
    "published",
    setup.commitSeq + 2n,
  );
  const replayedPatch = yield* client.mutation(
    COOKING_PATCH_FUNCTION,
    { id: setup.documentId, patch: COOKING_PATCH },
    COOKING_PATCH_REQUEST_KEY,
  );
  requireLifecycleMutation(
    replayedPatch,
    "patch replay",
    "replayed",
    patched.commitSeq,
  );
  const patchedRead = yield* client.query(
    COOKING_GET,
    { id: setup.documentId },
  );
  requireRecipeDocument(
    patchedRead,
    setup.documentId,
    COOKING_RECIPE_AFTER_PATCH,
  );

  const replaced = yield* client.mutation(
    COOKING_REPLACE,
    { id: setup.documentId, fields: COOKING_REPLACEMENT_RECIPE },
    COOKING_REPLACE_REQUEST_KEY,
  );
  requireLifecycleMutation(
    replaced,
    "replace",
    "published",
    setup.commitSeq + 3n,
  );
  const replayedReplace = yield* client.mutation(
    COOKING_REPLACE,
    { id: setup.documentId, fields: COOKING_REPLACEMENT_RECIPE },
    COOKING_REPLACE_REQUEST_KEY,
  );
  requireLifecycleMutation(
    replayedReplace,
    "replace replay",
    "replayed",
    replaced.commitSeq,
  );
  const replacedRead = yield* client.query(
    COOKING_GET,
    { id: setup.documentId },
  );
  requireRecipeDocument(
    replacedRead,
    setup.documentId,
    COOKING_REPLACEMENT_RECIPE,
  );

  const assessment = yield* client.query(
    COOKING_ASSESSMENT_FUNCTION,
    { id: setup.documentId },
  );
  requireExactObject(
    assessment,
    COOKING_REPLACEMENT_ASSESSMENT,
    "custom recipe assessment",
  );

  const published = yield* client.mutation(
    COOKING_PUBLISH,
    { id: setup.documentId },
    COOKING_PUBLISH_REQUEST_KEY,
  );
  requireValueMutation(
    published,
    "nested publish",
    "published",
    setup.commitSeq + 4n,
    COOKING_PUBLISH_RECEIPT,
  );
  const replayedPublish = yield* client.mutation(
    COOKING_PUBLISH,
    { id: setup.documentId },
    COOKING_PUBLISH_REQUEST_KEY,
  );
  requireValueMutation(
    replayedPublish,
    "nested publish replay",
    "replayed",
    published.commitSeq,
    COOKING_PUBLISH_RECEIPT,
  );
  const publishedAssessment = yield* client.query(
    COOKING_ASSESSMENT_FUNCTION,
    { id: setup.documentId },
  );
  requireExactObject(
    publishedAssessment,
    COOKING_PUBLISHED_ASSESSMENT,
    "persisted published recipe assessment",
  );

  const deleted = yield* client.mutation(
    COOKING_DELETE,
    { id: setup.documentId },
    COOKING_DELETE_REQUEST_KEY,
  );
  requireLifecycleMutation(
    deleted,
    "delete",
    "published",
    setup.commitSeq + 5n,
  );
  const replayedDelete = yield* client.mutation(
    COOKING_DELETE,
    { id: setup.documentId },
    COOKING_DELETE_REQUEST_KEY,
  );
  requireLifecycleMutation(
    replayedDelete,
    "delete replay",
    "replayed",
    deleted.commitSeq,
  );
  const deletedRead = yield* client.query(
    COOKING_GET,
    { id: setup.documentId },
  );
  if (deletedRead !== null) {
    return yield* Effect.die(new Error(
      "The cooking workload read a deleted recipe instead of null.",
    ));
  }
  const secondaryReadAfterPrimaryDelete = yield* client.query(
    COOKING_GET,
    { id: secondaryDocumentId },
  );
  requireRecipeDocument(
    secondaryReadAfterPrimaryDelete,
    secondaryDocumentId,
    COOKING_SECOND_RECIPE,
  );

  const beforeIndexedDecisionRace = yield* client.inspectAuthoritativeState();
  let indexedPhantomCreation: CookingTypedMutationResultV1 | undefined;
  yield* client.scheduleAfterNextMutationRuntime(() =>
    Effect.result(client.mutation(
      COOKING_CREATE,
      COOKING_INDEXED_PHANTOM_RECIPE,
      COOKING_INDEXED_PHANTOM_CREATE_REQUEST_KEY,
    )).pipe(
      Effect.tap(result => Effect.sync(() => {
        indexedPhantomCreation = result;
      })),
      Effect.asVoid,
    )
  );
  const indexedDecision = yield* client.mutation(
    COOKING_PUBLISH_SMALLEST_BATCH,
    {},
    COOKING_INDEXED_DECISION_REQUEST_KEY,
  );
  if (indexedPhantomCreation === undefined) {
    return yield* Effect.die(new Error(
      "The cooking indexed phantom did not settle during the interleaving.",
    ));
  }
  const indexedPhantomOutcome = requireSuccessfulMutationResult(
    indexedPhantomCreation,
    "indexed phantom creation",
  );
  const indexedPhantomDocumentId = requireCreatedDocumentId(
    indexedPhantomOutcome,
    "indexed phantom recipe",
    setup.commitSeq + 6n,
    [setup.documentId, secondaryDocumentId],
  );
  const indexedDecisionReceipt = {
    recipeId: indexedPhantomDocumentId,
    servings: 1,
    pageExhausted: false,
  } as const;
  requireValueMutation(
    indexedDecision,
    "indexed smallest-batch decision",
    "published",
    setup.commitSeq + 7n,
    indexedDecisionReceipt,
  );
  const replayedIndexedDecision = yield* client.mutation(
    COOKING_PUBLISH_SMALLEST_BATCH,
    {},
    COOKING_INDEXED_DECISION_REQUEST_KEY,
  );
  requireValueMutation(
    replayedIndexedDecision,
    "indexed smallest-batch decision replay",
    "replayed",
    indexedDecision.commitSeq,
    indexedDecisionReceipt,
  );
  const secondaryAfterIndexedDecision = yield* client.query(
    COOKING_GET,
    { id: secondaryDocumentId },
  );
  requireRecipeDocument(
    secondaryAfterIndexedDecision,
    secondaryDocumentId,
    COOKING_SECOND_RECIPE,
  );
  const indexedPhantomAfterDecision = yield* client.query(
    COOKING_GET,
    { id: indexedPhantomDocumentId },
  );
  requireRecipeDocument(
    indexedPhantomAfterDecision,
    indexedPhantomDocumentId,
    { ...COOKING_INDEXED_PHANTOM_RECIPE, published: true },
  );
  const afterIndexedDecisionRace = yield* client.inspectAuthoritativeState();
  requireIndexedDecisionRaceInspection(
    beforeIndexedDecisionRace,
    afterIndexedDecisionRace,
    String(indexedPhantomOutcome.commitSeq),
    String(indexedDecision.commitSeq),
  );

  const racePrimaryInserted = yield* client.mutation(
    COOKING_CREATE,
    COOKING_RACE_PRIMARY_RECIPE,
    COOKING_RACE_PRIMARY_CREATE_REQUEST_KEY,
  );
  const racePrimaryDocumentId = requireCreatedDocumentId(
    racePrimaryInserted,
    "race primary recipe",
    setup.commitSeq + 8n,
    [setup.documentId, secondaryDocumentId, indexedPhantomDocumentId],
  );
  const raceCompetitorInserted = yield* client.mutation(
    COOKING_CREATE,
    COOKING_RACE_COMPETITOR_RECIPE,
    COOKING_RACE_COMPETITOR_CREATE_REQUEST_KEY,
  );
  const raceCompetitorDocumentId = requireCreatedDocumentId(
    raceCompetitorInserted,
    "race competitor recipe",
    setup.commitSeq + 9n,
    [
      setup.documentId,
      secondaryDocumentId,
      indexedPhantomDocumentId,
      racePrimaryDocumentId,
    ],
  );
  const pantryInserted = yield* client.mutation(
    COOKING_PANTRY_CREATE,
    COOKING_PANTRY_STOCK,
    COOKING_PANTRY_CREATE_REQUEST_KEY,
  );
  const pantryDocumentId = requireCreatedDocumentId(
    pantryInserted,
    "shared pantry stock",
    setup.commitSeq + 10n,
    [
      setup.documentId,
      secondaryDocumentId,
      indexedPhantomDocumentId,
      racePrimaryDocumentId,
      raceCompetitorDocumentId,
    ],
  );
  const beforePantryRace = yield* client.inspectAuthoritativeState();
  let competitorReservation: CookingTypedMutationResultV1 | undefined;
  yield* client.scheduleAfterNextMutationRuntime(() =>
    Effect.result(client.mutation(
      COOKING_RESERVE_AND_PUBLISH,
      {
        pantryId: pantryDocumentId,
        recipeId: raceCompetitorDocumentId,
      },
      COOKING_RACE_COMPETITOR_REQUEST_KEY,
    )).pipe(
      Effect.tap(result => Effect.sync(() => {
        competitorReservation = result;
      })),
      Effect.asVoid,
    )
  );
  const primaryReservation = yield* Effect.result(client.mutation(
    COOKING_RESERVE_AND_PUBLISH,
    {
      pantryId: pantryDocumentId,
      recipeId: racePrimaryDocumentId,
    },
    COOKING_RACE_PRIMARY_REQUEST_KEY,
  ));
  if (competitorReservation === undefined) {
    return yield* Effect.die(new Error(
      "The cooking pantry competitor did not settle during the interleaving.",
    ));
  }
  const publishedCompetitorReservation = requireSuccessfulMutationResult(
    competitorReservation,
    "pantry competitor reservation",
  );
  requireInsufficientStockFailure(primaryReservation, pantryDocumentId);
  const competitorReceipt = {
    pantryId: pantryDocumentId,
    recipeId: raceCompetitorDocumentId,
    remainingStock: 0,
  } as const;
  requireValueMutation(
    publishedCompetitorReservation,
    "pantry competitor reservation",
    "published",
    setup.commitSeq + 11n,
    competitorReceipt,
  );
  const replayedCompetitorReservation = yield* client.mutation(
    COOKING_RESERVE_AND_PUBLISH,
    {
      pantryId: pantryDocumentId,
      recipeId: raceCompetitorDocumentId,
    },
    COOKING_RACE_COMPETITOR_REQUEST_KEY,
  );
  requireValueMutation(
    replayedCompetitorReservation,
    "pantry competitor reservation replay",
    "replayed",
    publishedCompetitorReservation.commitSeq,
    competitorReceipt,
  );
  const racePrimaryRead = yield* client.query(
    COOKING_GET,
    { id: racePrimaryDocumentId },
  );
  requireRecipeDocument(
    racePrimaryRead,
    racePrimaryDocumentId,
    COOKING_RACE_PRIMARY_RECIPE,
  );
  const raceCompetitorRead = yield* client.query(
    COOKING_GET,
    { id: raceCompetitorDocumentId },
  );
  requireRecipeDocument(
    raceCompetitorRead,
    raceCompetitorDocumentId,
    { ...COOKING_RACE_COMPETITOR_RECIPE, published: true },
  );
  const pantryRead = yield* client.query(
    COOKING_PANTRY_GET,
    { id: pantryDocumentId },
  );
  requirePantryDocument(
    pantryRead,
    pantryDocumentId,
    COOKING_DEPLETED_PANTRY_STOCK,
  );
  const afterPantryRace = yield* client.inspectAuthoritativeState();
  requirePantryRaceInspection(
    beforePantryRace,
    afterPantryRace,
    String(publishedCompetitorReservation.commitSeq),
  );
  const removedDescription = yield* client.mutation(
    COOKING_REMOVE_DESCRIPTION,
    { id: indexedPhantomDocumentId },
    COOKING_REMOVE_DESCRIPTION_REQUEST_KEY,
  );
  requireLifecycleMutation(
    removedDescription,
    "optional description deletion",
    "published",
    setup.commitSeq + 12n,
  );
  const replayedRemovedDescription = yield* client.mutation(
    COOKING_REMOVE_DESCRIPTION,
    { id: indexedPhantomDocumentId },
    COOKING_REMOVE_DESCRIPTION_REQUEST_KEY,
  );
  requireLifecycleMutation(
    replayedRemovedDescription,
    "optional description deletion replay",
    "replayed",
    removedDescription.commitSeq,
  );
  const indexedPhantomAfterDescriptionDeletion = yield* client.query(
    COOKING_GET,
    { id: indexedPhantomDocumentId },
  );
  requireRecipeDocument(
    indexedPhantomAfterDescriptionDeletion,
    indexedPhantomDocumentId,
    cookingIndexedPhantomWithoutDescription(),
  );
  const taskDraftInserted = yield* client.mutation(
    COOKING_CREATE,
    COOKING_TASK_DRAFT_RECIPE,
    COOKING_TASK_DRAFT_CREATE_REQUEST_KEY,
  );
  if (
    taskDraftInserted.status !== "committed" ||
    taskDraftInserted.disposition !== "published" ||
    taskDraftInserted.commitSeq !== setup.commitSeq + 13n ||
    typeof taskDraftInserted.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The cooking workload did not publish the isolated Task draft.",
    ));
  }
  const taskMutationDocumentId = taskDraftInserted.value;
  const taskMutationRequest = Object.freeze({
    version: 1 as const,
    requestKey: COOKING_PUBLISH_SERVING_GUIDE_TASK_REQUEST_KEY,
    payload: Object.freeze({ recipeId: taskMutationDocumentId }),
    executionIdentity: COOKING_TASK_EXECUTION_IDENTITY,
  });
  const taskMutationFirst = yield* client.tasks.create(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationRequest,
  );
  const taskMutationReplay = yield* client.tasks.create(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationRequest,
  );
  if (!sameTaskRunCreationReceiptV1(taskMutationReplay, taskMutationFirst)) {
    return yield* Effect.die(new Error(
      "The cooking publication Task did not replay its durable run.",
    ));
  }
  const taskMutationDelivery = yield* client.tasks.deliver(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationFirst,
    { kind: "fault", fault: "duplicate_delivery" },
  );
  if (
    taskMutationDelivery.status !== "succeeded" ||
    taskMutationDelivery.runId !== taskMutationFirst.runId ||
    taskMutationDelivery.worker.generation !== "application_v1" ||
    taskMutationDelivery.worker.loads !== 1 ||
    taskMutationDelivery.worker.starts !== 1 ||
    taskMutationDelivery.worker.settlements !== 1 ||
    taskMutationDelivery.worker.resultWrites !== 1 ||
    taskMutationDelivery.worker.resultReads !== 2 ||
    !sameJsonValue(
      taskMutationDelivery.fault,
      COOKING_TASK_DUPLICATE_DELIVERY_FAULT,
    ) ||
    !sameJsonValue(taskMutationDelivery.output, {
      recipeId: taskMutationDocumentId,
      publication: COOKING_PUBLISH_RECEIPT,
      assessment: COOKING_TASK_PUBLISHED_ASSESSMENT,
    })
  ) {
    return yield* Effect.die(new Error(
      "The cooking publication Task did not commit and reread its workflow result.",
    ));
  }
  const completionReplayDraftInserted = yield* client.mutation(
    COOKING_CREATE,
    COOKING_COMPLETION_REPLAY_DRAFT_RECIPE,
    COOKING_COMPLETION_REPLAY_DRAFT_CREATE_REQUEST_KEY,
  );
  if (
    completionReplayDraftInserted.status !== "committed" ||
    completionReplayDraftInserted.disposition !== "published" ||
    completionReplayDraftInserted.commitSeq !== setup.commitSeq + 15n ||
    typeof completionReplayDraftInserted.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The cooking workload did not publish the completion-replay draft.",
    ));
  }
  const taskMutationCompletionReplayDocumentId =
    completionReplayDraftInserted.value;
  const taskMutationCompletionReplayRequest = Object.freeze({
    version: 1 as const,
    requestKey: COOKING_COMPLETION_REPLAY_TASK_REQUEST_KEY,
    payload: Object.freeze({
      recipeId: taskMutationCompletionReplayDocumentId,
    }),
    executionIdentity: COOKING_TASK_EXECUTION_IDENTITY,
  });
  const taskMutationCompletionReplayFirst = yield* client.tasks.create(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationCompletionReplayRequest,
  );
  const taskMutationCompletionReplayReplay = yield* client.tasks.create(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationCompletionReplayRequest,
  );
  if (!sameTaskRunCreationReceiptV1(
    taskMutationCompletionReplayReplay,
    taskMutationCompletionReplayFirst,
  )) {
    return yield* Effect.die(new Error(
      "The cooking completion-replay Task did not replay its durable run.",
    ));
  }
  const taskMutationCompletionReplayDelivery = yield* client.tasks.deliver(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationCompletionReplayFirst,
    { kind: "fault", fault: "completion_response_lost" },
  );
  if (
    taskMutationCompletionReplayDelivery.status !== "succeeded" ||
    taskMutationCompletionReplayDelivery.runId !==
      taskMutationCompletionReplayFirst.runId ||
    taskMutationCompletionReplayDelivery.worker.generation !==
      "application_v1" ||
    taskMutationCompletionReplayDelivery.worker.loads !== 1 ||
    taskMutationCompletionReplayDelivery.worker.starts !== 1 ||
    taskMutationCompletionReplayDelivery.worker.settlements !== 1 ||
    taskMutationCompletionReplayDelivery.worker.resultWrites !== 1 ||
    taskMutationCompletionReplayDelivery.worker.resultReads !== 2 ||
    !sameJsonValue(
      taskMutationCompletionReplayDelivery.fault,
      COOKING_TASK_COMPLETION_RESPONSE_LOST_FAULT,
    ) ||
    !sameJsonValue(taskMutationCompletionReplayDelivery.output, {
      recipeId: taskMutationCompletionReplayDocumentId,
      publication: COOKING_PUBLISH_RECEIPT,
      assessment: COOKING_COMPLETION_REPLAY_PUBLISHED_ASSESSMENT,
    })
  ) {
    return yield* Effect.die(new Error(
      "The cooking Task did not preserve its committed workflow across completion replay.",
    ));
  }
  const resultReconciliationDraftInserted = yield* client.mutation(
    COOKING_CREATE,
    COOKING_RESULT_RECONCILIATION_DRAFT_RECIPE,
    COOKING_RESULT_RECONCILIATION_DRAFT_CREATE_REQUEST_KEY,
  );
  if (
    resultReconciliationDraftInserted.status !== "committed" ||
    resultReconciliationDraftInserted.disposition !== "published" ||
    resultReconciliationDraftInserted.commitSeq !== setup.commitSeq + 17n ||
    typeof resultReconciliationDraftInserted.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The cooking workload did not publish the result-reconciliation draft.",
    ));
  }
  const taskMutationResultReconciliationDocumentId =
    resultReconciliationDraftInserted.value;
  const taskMutationResultReconciliationRequest = Object.freeze({
    version: 1 as const,
    requestKey: COOKING_RESULT_RECONCILIATION_TASK_REQUEST_KEY,
    payload: Object.freeze({
      recipeId: taskMutationResultReconciliationDocumentId,
    }),
    executionIdentity: COOKING_TASK_EXECUTION_IDENTITY,
  });
  const taskMutationResultReconciliationFirst = yield* client.tasks.create(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationResultReconciliationRequest,
  );
  const taskMutationResultReconciliationReplay = yield* client.tasks.create(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationResultReconciliationRequest,
  );
  if (!sameTaskRunCreationReceiptV1(
    taskMutationResultReconciliationReplay,
    taskMutationResultReconciliationFirst,
  )) {
    return yield* Effect.die(new Error(
      "The cooking result-reconciliation Task did not replay its durable run.",
    ));
  }
  const taskMutationResultReconciliationDelivery = yield* client.tasks.deliver(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationResultReconciliationFirst,
    { kind: "fault", fault: "result_publication_reconciled" },
  );
  if (
    taskMutationResultReconciliationDelivery.status !== "succeeded" ||
    taskMutationResultReconciliationDelivery.runId !==
      taskMutationResultReconciliationFirst.runId ||
    taskMutationResultReconciliationDelivery.worker.generation !==
      "application_v1" ||
    taskMutationResultReconciliationDelivery.worker.loads !== 1 ||
    taskMutationResultReconciliationDelivery.worker.starts !== 1 ||
    taskMutationResultReconciliationDelivery.worker.settlements !== 1 ||
    taskMutationResultReconciliationDelivery.worker.resultWrites !== 1 ||
    taskMutationResultReconciliationDelivery.worker.resultReads !== 2 ||
    !sameJsonValue(
      taskMutationResultReconciliationDelivery.fault,
      COOKING_TASK_RESULT_PUBLICATION_RECONCILED_FAULT,
    ) ||
    !sameJsonValue(taskMutationResultReconciliationDelivery.output, {
      recipeId: taskMutationResultReconciliationDocumentId,
      publication: COOKING_PUBLISH_RECEIPT,
      assessment: COOKING_RESULT_RECONCILIATION_PUBLISHED_ASSESSMENT,
    })
  ) {
    return yield* Effect.die(new Error(
      "The cooking Task did not reconcile its stored result after publication response loss.",
    ));
  }
  const resultUncertainDraftInserted = yield* client.mutation(
    COOKING_CREATE,
    COOKING_RESULT_UNCERTAIN_DRAFT_RECIPE,
    COOKING_RESULT_UNCERTAIN_DRAFT_CREATE_REQUEST_KEY,
  );
  if (
    resultUncertainDraftInserted.status !== "committed" ||
    resultUncertainDraftInserted.disposition !== "published" ||
    resultUncertainDraftInserted.commitSeq !== setup.commitSeq + 19n ||
    typeof resultUncertainDraftInserted.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The cooking workload did not publish the result-uncertain draft.",
    ));
  }
  const taskMutationResultUncertainDocumentId =
    resultUncertainDraftInserted.value;
  const taskMutationResultUncertainRequest = Object.freeze({
    version: 1 as const,
    requestKey: COOKING_RESULT_UNCERTAIN_TASK_REQUEST_KEY,
    payload: Object.freeze({
      recipeId: taskMutationResultUncertainDocumentId,
    }),
    executionIdentity: COOKING_TASK_EXECUTION_IDENTITY,
  });
  const taskMutationResultUncertainFirst = yield* client.tasks.create(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationResultUncertainRequest,
  );
  const taskMutationResultUncertainReplay = yield* client.tasks.create(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationResultUncertainRequest,
  );
  if (!sameTaskRunCreationReceiptV1(
    taskMutationResultUncertainReplay,
    taskMutationResultUncertainFirst,
  )) {
    return yield* Effect.die(new Error(
      "The cooking result-uncertain Task did not replay its durable run.",
    ));
  }
  const taskMutationResultUncertainDelivery = yield* client.tasks.deliver(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationResultUncertainFirst,
    { kind: "fault", fault: "result_publication_uncertain" },
  );
  if (
    taskMutationResultUncertainDelivery.status !==
      "result_publication_uncertain" ||
    taskMutationResultUncertainDelivery.runId !==
      taskMutationResultUncertainFirst.runId ||
    taskMutationResultUncertainDelivery.settlement.stage !== "reconcileRead" ||
    taskMutationResultUncertainDelivery.settlement.terminalResultFabricated !==
      false ||
    taskMutationResultUncertainDelivery.cancellation !== null ||
    taskMutationResultUncertainDelivery.host.dispatchCandidatesHandled !== 1 ||
    taskMutationResultUncertainDelivery.host.dispatchProviderCalls !== 1 ||
    taskMutationResultUncertainDelivery.host.cancellationCandidatesHandled !==
      0 ||
    taskMutationResultUncertainDelivery.host.cancellationProviderCalls !== 0 ||
    taskMutationResultUncertainDelivery.host.candidateFailures !== 0 ||
    taskMutationResultUncertainDelivery.host.supervisionExpected !== 1 ||
    taskMutationResultUncertainDelivery.host.supervisionObserved !== 1 ||
    taskMutationResultUncertainDelivery.host.supervisionSucceeded !== 0 ||
    taskMutationResultUncertainDelivery.host.supervisionFailed !== 1 ||
    taskMutationResultUncertainDelivery.worker.generation !==
      "application_v1" ||
    taskMutationResultUncertainDelivery.worker.loads !== 1 ||
    taskMutationResultUncertainDelivery.worker.starts !== 1 ||
    taskMutationResultUncertainDelivery.worker.inputReads !== 1 ||
    taskMutationResultUncertainDelivery.worker.settlements !== 1 ||
    taskMutationResultUncertainDelivery.worker.resultWrites !== 1 ||
    taskMutationResultUncertainDelivery.worker.resultReads !== 1 ||
    taskMutationResultUncertainDelivery.worker.legacyRuntimeObjectReads !== 0
  ) {
    return yield* Effect.die(new Error(
      "The cooking Task did not preserve unresolved result-publication evidence.",
    ));
  }
  const taskMutationResultUncertainAssessment = yield* client.query(
    COOKING_ASSESSMENT_FUNCTION,
    { id: taskMutationResultUncertainDocumentId },
  );
  if (!sameJsonValue(
    taskMutationResultUncertainAssessment,
    COOKING_RESULT_UNCERTAIN_PUBLISHED_ASSESSMENT,
  )) {
    return yield* Effect.die(new Error(
      "The cooking result-uncertain Task did not commit its application workflow.",
    ));
  }
  const workloadInspection = yield* client.inspectAuthoritativeState();
  return {
    documentId: setup.documentId,
    secondaryDocumentId,
    indexedPhantomDocumentId,
    racePrimaryDocumentId,
    raceCompetitorDocumentId,
    pantryDocumentId,
    richDocumentRoundTrip: true,
    taskRunId: taskFirst.runId,
    taskCreationReplay: true,
    taskNestedQueryOutputValidated: true,
    taskHostedDeliveryCompleted: true,
    taskMutationDocumentId,
    taskMutationRunId: taskMutationFirst.runId,
    taskMutationCreationReplay: true,
    taskMutationWorkflowCommitted: true,
    taskMutationNestedQueryOutputValidated: true,
    taskMutationDuplicateDeliverySuppressed: true,
    taskMutationCompletionReplayDocumentId,
    taskMutationCompletionReplayRunId:
      taskMutationCompletionReplayFirst.runId,
    taskMutationCompletionCreationReplay: true,
    taskMutationCompletionResponseReplayed: true,
    taskMutationCompletionWorkflowCommitted: true,
    taskMutationCompletionNestedQueryOutputValidated: true,
    taskMutationResultReconciliationDocumentId,
    taskMutationResultReconciliationRunId:
      taskMutationResultReconciliationFirst.runId,
    taskMutationResultReconciliationCreationReplay: true,
    taskMutationResultPublicationReconciled: true,
    taskMutationResultReconciliationWorkflowCommitted: true,
    taskMutationResultReconciliationNestedQueryOutputValidated: true,
    taskMutationResultUncertainDocumentId,
    taskMutationResultUncertainRunId: taskMutationResultUncertainFirst.runId,
    taskMutationResultUncertainCreationReplay: true,
    taskMutationResultPublicationUncertain: true,
    taskMutationResultUncertainWorkflowCommitted: true,
    taskMutationResultUncertainCommittedAssessmentValidated: true,
    taskMutationResultUncertainTerminalResultFabricated: false,
    rejectedInvalidMutations: 5,
    invalidArgumentsRejectedBeforeRuntime: true,
    committedStateUnchangedAfterRejections: true,
    mutationReplay: true,
    secondaryMutationReplay: true,
    queryReplay: true,
    multipleRecipesIsolated: true,
    optionalFieldOmissionRoundTrip: true,
    optionalFieldDeletion: true,
    optionalFieldDeletionReplay: true,
    unicodeRecordRoundTrip: true,
    invalidReturnRollsBack: true,
    thrownFailureRollsBack: true,
    failedMutationsReachedRuntime: true,
    failedMutationStateUnchanged: true,
    applicationInvariantRejected: true,
    applicationErrorPreserved: true,
    queryApplicationErrorPreserved: true,
    applicationInvariantFailureStateUnchanged: true,
    patchReplay: true,
    replaceReplay: true,
    assessmentUsesCustomLogic: true,
    queryCallsInternalQuery: true,
    mutationCallsInternalQuery: true,
    mutationCallsInternalMutation: true,
    nestedMutationReplay: true,
    nestedMutationPublishesOnce: true,
    deleteReplay: true,
    pointMutationLifecycle: true,
    deletedDocumentReadsNull: true,
    indexedRangeDecisionReran: true,
    indexedRangeDecisionReplay: true,
    losingIndexedDecisionWriteRolledBack: true,
    pantryConflictReran: true,
    singleStockReservationCommitted: true,
    stockNeverNegative: true,
    losingReservationWritesRolledBack: true,
    competitorReservationReplay: true,
    workloadInspection,
  };
});

function cookingIndexedPhantomWithoutDescription(): Readonly<
  Record<string, unknown>
> {
  const {
    description: _description,
    ...recipe
  } = COOKING_INDEXED_PHANTOM_RECIPE;
  return {
    ...recipe,
    published: true,
  };
}

function requireValueMutation(
  outcome: AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  scenario: string,
  disposition: "published" | "replayed",
  commitSeq: bigint,
  expectedValue: Readonly<Record<string, unknown>>,
): void {
  if (
    outcome.status !== "committed" ||
    outcome.disposition !== disposition ||
    outcome.commitSeq !== commitSeq ||
    !sameJsonValue(outcome.value, expectedValue)
  ) {
    throw new Error(
      `The cooking ${scenario} mutation did not produce the expected committed value.`,
    );
  }
}

function requireCreatedDocumentId(
  outcome: AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  scenario: string,
  commitSeq: bigint,
  excludedIds: readonly string[],
): string {
  if (
    outcome.status !== "committed" ||
    outcome.disposition !== "published" ||
    outcome.commitSeq !== commitSeq ||
    typeof outcome.value !== "string" ||
    excludedIds.includes(outcome.value)
  ) {
    throw new Error(
      `The cooking ${scenario} did not publish one fresh document id.`,
    );
  }
  return outcome.value;
}

function requireSuccessfulMutationResult(
  result: CookingTypedMutationResultV1,
  scenario: string,
): AuthoritativeCommittedApplicationPointMutationOutcomeV1 {
  return Result.match(result, {
    onFailure: failure => {
      throw new Error(
        `The cooking ${scenario} failed with ${failureName(failure)}.`,
      );
    },
    onSuccess: outcome => outcome,
  });
}

function requireLifecycleMutation(
  outcome: AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  scenario: string,
  disposition: "published" | "replayed",
  commitSeq: bigint,
): void {
  if (
    outcome.status !== "committed" ||
    outcome.disposition !== disposition ||
    outcome.commitSeq !== commitSeq ||
    outcome.value !== null
  ) {
    throw new Error(
      `The cooking ${scenario} mutation did not produce the expected committed null outcome.`,
    );
  }
}

function requireArgumentValidationFailure(
  result: CookingMutationAttemptResultV1,
  scenario: string,
  expectedIssue: CookingExpectedArgumentIssueV1,
): void {
  const observation = Result.match(result, {
    onFailure: failure => ({
      rejectedAsExpected:
        failure instanceof ValidatorValueErrorV1 &&
        matchesExpectedArgumentIssue(failure.issue, expectedIssue),
      outcome: failureName(failure),
    }),
    onSuccess: () => ({
      rejectedAsExpected: false,
      outcome: "success",
    }),
  });
  if (!observation.rejectedAsExpected) {
    throw new Error(
      `The cooking ${scenario} scenario produced ${observation.outcome} instead of the expected argument-validation issue.`,
    );
  }
}

function requireUserCodeFailure<Success>(
  result: Result.Result<Success, CookingMutationInvocationErrorV1>,
  scenario: string,
): void {
  const observation = Result.match(result, {
    onFailure: failure => ({
      rejectedAsExpected:
        failure instanceof PointMutationOccUserCodeV1Error &&
        hasExpectedUserCodeFailureCause(failure),
      outcome: failureName(failure),
    }),
    onSuccess: () => ({
      rejectedAsExpected: false,
      outcome: "success",
    }),
  });
  if (!observation.rejectedAsExpected) {
    throw new Error(
      `The cooking ${scenario} scenario produced ${observation.outcome} instead of the expected user-code failure.`,
    );
  }
}

function requireApplicationFailure<Success>(
  result: Result.Result<Success, CookingMutationInvocationErrorV1>,
  recipeId: string,
): void {
  const observation = Result.match(result, {
    onFailure: failure => ({
      rejectedAsExpected:
        failure instanceof PointMutationOccApplicationErrorV1 &&
        hasExpectedApplicationFailure(failure, recipeId),
      outcome: failureName(failure),
    }),
    onSuccess: () => ({
      rejectedAsExpected: false,
      outcome: "success",
    }),
  });
  if (!observation.rejectedAsExpected) {
    throw new Error(
      `The cooking incomplete-recipe publication produced ${observation.outcome} instead of the expected application error.`,
    );
  }
}

function requireInsufficientStockFailure<Success>(
  result: Result.Result<Success, CookingMutationInvocationErrorV1>,
  pantryId: string,
): void {
  const observation = Result.match(result, {
    onFailure: failure => ({
      rejectedAsExpected:
        failure instanceof PointMutationOccApplicationErrorV1 &&
        failure.code === "INSUFFICIENT_STOCK" &&
        failure.message === "Pantry stock is insufficient." &&
        sameJsonValue(failure.data, {
          pantryId,
          requested: 1,
          available: 0,
        }),
      outcome: failureName(failure),
    }),
    onSuccess: () => ({
      rejectedAsExpected: false,
      outcome: "success",
    }),
  });
  if (!observation.rejectedAsExpected) {
    throw new Error(
      `The cooking pantry race produced ${observation.outcome} instead of the expected insufficient-stock error.`,
    );
  }
}

function hasExpectedApplicationFailure(
  failure: CookingApplicationFailureV1,
  recipeId: string,
): boolean {
  return failure.code === "RECIPE_NOT_PUBLISHABLE" &&
    failure.message === "Recipe cannot be published." &&
    sameJsonValue(failure.data, {
      recipeId,
      violations: ["steps-required"],
    });
}

function hasExpectedUserCodeFailureCause(
  failure: CookingUserCodeFailureV1,
): boolean {
  return failure.cause instanceof Error &&
    failure.cause.name === "ApplicationWorkerUserCodeV1Error" &&
    failure.cause.message === "ApplicationWorkerUserCodeV1Error";
}

function matchesExpectedArgumentIssue(
  actual: ValidatorValueIssueV1,
  expected: CookingExpectedArgumentIssueV1,
): boolean {
  switch (expected.reason) {
    case "typeMismatch":
      return actual.reason === "typeMismatch" &&
        actual.path === expected.path &&
        actual.expected === expected.expected;
    case "missingRequiredField":
      return actual.reason === "missingRequiredField" &&
        actual.path === expected.path &&
        actual.field === expected.field;
    case "unexpectedField":
      return actual.reason === "unexpectedField" &&
        actual.path === expected.path &&
        actual.field === expected.field;
    case "unionMismatch":
      return actual.reason === "unionMismatch" &&
        actual.path === expected.path &&
        actual.memberCount === expected.memberCount;
  }
}

function failureName(value: unknown): string {
  if (isNonArrayRecord(value) && typeof value._tag === "string") {
    return value._tag;
  }
  return value instanceof Error ? value.name : typeof value;
}

function requireNoRejectedMutationSideEffects(
  before: StandardApplicationAuthoritativeInspectionV1,
  after: StandardApplicationAuthoritativeInspectionV1,
): void {
  if (
    after.mutationRuntimeExecutions !== before.mutationRuntimeExecutions ||
    after.queryRuntimeExecutions !== before.queryRuntimeExecutions ||
    !sameCurrentRows(before.currentRows, after.currentRows) ||
    after.currentRowCount !== before.currentRowCount ||
    after.liveRowCount !== before.liveRowCount ||
    after.revisionRowCount !== before.revisionRowCount ||
    !sameStrings(before.commitSeqs, after.commitSeqs) ||
    !sameStrings(
      before.idempotencyOutcomeCommitSeqs,
      after.idempotencyOutcomeCommitSeqs,
    ) ||
    !sameStrings(
      before.commitFeedCommitSeqs,
      after.commitFeedCommitSeqs,
    ) ||
    !sameStrings(before.outboxCommitSeqs, after.outboxCommitSeqs)
  ) {
    throw new Error(
      "Rejected cooking arguments reached runtime or changed authoritative committed state.",
    );
  }
}

function requireQueryApplicationFailure<Success, Failure>(
  result: Result.Result<Success, Failure>,
  recipeId: string,
): void {
  const observation = Result.match(result, {
    onFailure: failure => ({
      rejectedAsExpected:
        failure instanceof ApplicationExecutionHostError &&
        failure.operation === "transaction" &&
        failure.reason === "applicationError" &&
        failure.applicationError?.code === "RECIPE_NOT_PUBLISHED" &&
        failure.applicationError.message === "Recipe is not published." &&
        sameJsonValue(failure.applicationError.data, {
          recipeId,
          published: false,
        }),
      outcome: failureName(failure),
    }),
    onSuccess: () => ({
      rejectedAsExpected: false,
      outcome: "success",
    }),
  });
  if (!observation.rejectedAsExpected) {
    throw new Error(
      `The cooking unpublished-recipe query produced ${observation.outcome} instead of the expected application error.`,
    );
  }
}

function requireFailedQueryIsReadOnly(
  before: StandardApplicationAuthoritativeInspectionV1,
  after: StandardApplicationAuthoritativeInspectionV1,
): void {
  if (
    after.queryRuntimeExecutions !== before.queryRuntimeExecutions + 1 ||
    after.mutationRuntimeExecutions !== before.mutationRuntimeExecutions ||
    !sameCurrentRows(before.currentRows, after.currentRows) ||
    after.currentRowCount !== before.currentRowCount ||
    after.liveRowCount !== before.liveRowCount ||
    after.revisionRowCount !== before.revisionRowCount ||
    !sameStrings(before.commitSeqs, after.commitSeqs) ||
    !sameStrings(
      before.idempotencyOutcomeCommitSeqs,
      after.idempotencyOutcomeCommitSeqs,
    ) ||
    !sameStrings(before.commitFeedCommitSeqs, after.commitFeedCommitSeqs) ||
    !sameStrings(before.outboxCommitSeqs, after.outboxCommitSeqs)
  ) {
    throw new Error(
      "The failed cooking query changed authoritative committed state.",
    );
  }
}

function requireFailedMutationRollback(
  before: StandardApplicationAuthoritativeInspectionV1,
  after: StandardApplicationAuthoritativeInspectionV1,
  expectedRuntimeExecutions: number,
): void {
  if (
    after.mutationRuntimeExecutions !==
      before.mutationRuntimeExecutions + expectedRuntimeExecutions ||
    after.queryRuntimeExecutions !== before.queryRuntimeExecutions ||
    !sameCurrentRows(before.currentRows, after.currentRows) ||
    after.currentRowCount !== before.currentRowCount ||
    after.liveRowCount !== before.liveRowCount ||
    after.revisionRowCount !== before.revisionRowCount ||
    !sameStrings(before.commitSeqs, after.commitSeqs) ||
    !sameStrings(
      before.idempotencyOutcomeCommitSeqs,
      after.idempotencyOutcomeCommitSeqs,
    ) ||
    !sameStrings(
      before.commitFeedCommitSeqs,
      after.commitFeedCommitSeqs,
    ) ||
    !sameStrings(before.outboxCommitSeqs, after.outboxCommitSeqs)
  ) {
    throw new Error(
      "Failed cooking mutations exposed staged writes or committed evidence.",
    );
  }
}

function sameCurrentRows(
  left: StandardApplicationAuthoritativeInspectionV1["currentRows"],
  right: StandardApplicationAuthoritativeInspectionV1["currentRows"],
): boolean {
  return left.length === right.length && left.every((row, index) => {
    const candidate = right[index];
    return candidate !== undefined &&
      candidate.tableName === row.tableName &&
      candidate.documentId === row.documentId &&
      candidate.commitSeq === row.commitSeq &&
      candidate.valueState === row.valueState;
  });
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => right[index] === value);
}

function sameTaskRunCreationReceiptV1(
  left: CookingTaskRunCreationReceiptV1,
  right: CookingTaskRunCreationReceiptV1,
): boolean {
  return left.status === right.status &&
    left.version === right.version &&
    left.runId === right.runId &&
    left.createdAtMs === right.createdAtMs &&
    bytesEqual(
      left.applicationTaskRuntimeTargetSha256,
      right.applicationTaskRuntimeTargetSha256,
    ) &&
    bytesEqual(left.requestKeySha256, right.requestKeySha256) &&
    bytesEqual(left.requestSha256, right.requestSha256) &&
    bytesEqual(left.creationAuthoritySha256, right.creationAuthoritySha256);
}

function requireIndexedDecisionRaceInspection(
  before: StandardApplicationAuthoritativeInspectionV1,
  after: StandardApplicationAuthoritativeInspectionV1,
  phantomCommitSeq: string,
  decisionCommitSeq: string,
): void {
  if (
    after.currentRowCount !== before.currentRowCount + 1 ||
    after.liveRowCount !== before.liveRowCount + 1 ||
    after.revisionRowCount !== before.revisionRowCount + 2 ||
    after.mutationRuntimeExecutions !== before.mutationRuntimeExecutions + 3 ||
    after.queryRuntimeExecutions !== before.queryRuntimeExecutions + 2 ||
    !sameStrings(
      after.commitSeqs,
      [...before.commitSeqs, phantomCommitSeq, decisionCommitSeq],
    ) ||
    !sameStrings(
      after.idempotencyOutcomeCommitSeqs,
      [
        ...before.idempotencyOutcomeCommitSeqs,
        phantomCommitSeq,
        decisionCommitSeq,
      ],
    ) ||
    !sameStrings(
      after.commitFeedCommitSeqs,
      [...before.commitFeedCommitSeqs, phantomCommitSeq, decisionCommitSeq],
    ) ||
    !sameStrings(
      after.outboxCommitSeqs,
      [...before.outboxCommitSeqs, phantomCommitSeq, decisionCommitSeq],
    )
  ) {
    throw new Error(
      "The cooking indexed decision violated phantom OCC, rollback, or publication evidence.",
    );
  }
}

function requirePantryRaceInspection(
  before: StandardApplicationAuthoritativeInspectionV1,
  after: StandardApplicationAuthoritativeInspectionV1,
  competitorCommitSeq: string,
): void {
  if (
    after.currentRowCount !== before.currentRowCount ||
    after.liveRowCount !== before.liveRowCount ||
    after.revisionRowCount !== before.revisionRowCount + 2 ||
    after.mutationRuntimeExecutions !== before.mutationRuntimeExecutions + 3 ||
    after.queryRuntimeExecutions !== before.queryRuntimeExecutions + 3 ||
    !sameStrings(
      after.commitSeqs,
      [...before.commitSeqs, competitorCommitSeq],
    ) ||
    !sameStrings(
      after.idempotencyOutcomeCommitSeqs,
      [...before.idempotencyOutcomeCommitSeqs, competitorCommitSeq],
    ) ||
    !sameStrings(
      after.commitFeedCommitSeqs,
      [...before.commitFeedCommitSeqs, competitorCommitSeq, competitorCommitSeq],
    ) ||
    !sameStrings(
      after.outboxCommitSeqs,
      [...before.outboxCommitSeqs, competitorCommitSeq],
    )
  ) {
    throw new Error(
      "The cooking pantry race violated OCC, rollback, or publication evidence.",
    );
  }
}

function requireRecipeDocument(
  value: unknown,
  documentId: string,
  expected: Readonly<Record<string, unknown>>,
): void {
  if (
    !isNonArrayRecord(value) ||
    value._id !== documentId ||
    typeof value._creationTime !== "number" ||
    !Number.isFinite(value._creationTime) ||
    Object.keys(value).length !== Object.keys(expected).length + 2 ||
    !Object.entries(expected).every(
      ([fieldName, fieldValue]) => Object.hasOwn(value, fieldName) &&
        sameJsonValue(value[fieldName], fieldValue),
    )
  ) {
    throw new Error(
      "The cooking workload did not read the authoritative recipe document.",
    );
  }
}

function requirePantryDocument(
  value: unknown,
  documentId: string,
  expected: Readonly<Record<string, unknown>>,
): void {
  if (
    !isNonArrayRecord(value) ||
    value._id !== documentId ||
    typeof value._creationTime !== "number" ||
    !Number.isFinite(value._creationTime) ||
    Object.keys(value).length !== Object.keys(expected).length + 2 ||
    !Object.entries(expected).every(
      ([fieldName, fieldValue]) => Object.hasOwn(value, fieldName) &&
        sameJsonValue(value[fieldName], fieldValue),
    )
  ) {
    throw new Error(
      "The cooking workload did not read the authoritative pantry document.",
    );
  }
}

function requireExactObject(
  value: unknown,
  expected: Readonly<Record<string, unknown>>,
  scenario: string,
): void {
  if (!sameJsonValue(value, expected)) {
    throw new Error(`The cooking workload did not produce ${scenario}.`);
  }
}

function sameJsonValue(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((member, index) => sameJsonValue(actual[index], member));
  }
  if (!isNonArrayRecord(expected) || !isNonArrayRecord(actual)) return false;
  const expectedEntries = Object.entries(expected);
  return Object.keys(actual).length === expectedEntries.length &&
    expectedEntries.every(
      ([key, value]) => Object.hasOwn(actual, key) &&
        sameJsonValue(actual[key], value),
    );
}

export const cookingSimulationV1 = defineStandardApplicationSimulationV1({
  version: 1,
  simulationId: "cooking-rich-recipe-point-lifecycle-v1",
  application: {
    applicationId: "cooking",
    revisionName: "sac01-cooking-app",
    defineTasks: () => [
      COOKING_SERVING_GUIDE_TASK,
      COOKING_PUBLISH_SERVING_GUIDE_TASK,
    ],
    define: () => makeCreateAndReadDefinitionV1({
      tableName: "recipes",
      mutationModule: COOKING_MUTATION_MODULE,
      queryModule: COOKING_QUERY_MODULE,
      mutationArtifactPath: "recipeMutation",
      queryArtifactPath: "recipeQuery",
      mutationSourceBytes: COOKING_FUNCTION_SOURCES.create,
      querySourceBytes: COOKING_FUNCTION_SOURCES.get,
      pointMutationLifecycle: {
        patchModule: COOKING_PATCH_MODULE,
        patchArtifactPath: "recipePatch",
        patchSourceBytes: COOKING_FUNCTION_SOURCES.patch,
        replaceModule: COOKING_REPLACE_MODULE,
        replaceArtifactPath: "recipeReplace",
        replaceSourceBytes: COOKING_FUNCTION_SOURCES.replace,
        deleteModule: COOKING_DELETE_MODULE,
        deleteArtifactPath: "recipeDelete",
        deleteSourceBytes: COOKING_FUNCTION_SOURCES.remove,
      },
      additionalFunctionModules: [{
        module: COOKING_ASSESSMENT_MODULE,
        artifactModulePath: "recipeAssessmentInternal",
        sourceBytes: COOKING_FUNCTION_SOURCES.assess,
      }, {
        module: COOKING_ASSESSMENT_VIEW_MODULE,
        artifactModulePath: "recipeAssessmentView",
        sourceBytes: COOKING_FUNCTION_SOURCES.assessmentView,
      }, {
        module: COOKING_PUBLICATION_VIEW_MODULE,
        artifactModulePath: "recipePublicationView",
        sourceBytes: COOKING_FUNCTION_SOURCES.publicationView,
      }, {
        module: COOKING_MAINTENANCE_MODULE,
        artifactModulePath: "recipePublishInternal",
        sourceBytes: COOKING_FUNCTION_SOURCES.publishInternal,
      }, {
        module: COOKING_WORKFLOW_MODULE,
        artifactModulePath: "recipePublishWorkflow",
        sourceBytes: COOKING_FUNCTION_SOURCES.publishWorkflow,
      }, {
        module: COOKING_INDEXED_DECISION_MODULE,
        artifactModulePath: "recipeServingSelection",
        sourceBytes: COOKING_FUNCTION_SOURCES.servingSelection,
      }, {
        module: COOKING_PANTRY_COMMAND_MODULE,
        artifactModulePath: "pantryCreate",
        sourceBytes: COOKING_FUNCTION_SOURCES.pantryCreate,
      }, {
        module: COOKING_PANTRY_QUERY_MODULE,
        artifactModulePath: "pantryQuery",
        sourceBytes: COOKING_FUNCTION_SOURCES.pantryQuery,
      }, {
        module: COOKING_RESERVATION_MODULE,
        artifactModulePath: "pantryReservation",
        sourceBytes: COOKING_FUNCTION_SOURCES.pantryReservation,
      }],
      additionalTables: [{
        logicalName: "pantryStock",
        fields: COOKING_PANTRY_FIELDS,
      }],
      indexes: [{
        tableLogicalName: "recipes",
        descriptor: "by_difficulty",
        fields: ["difficulty"],
      }, {
        tableLogicalName: "recipes",
        descriptor: "by_servings",
        fields: ["servings"],
      }],
      fields: COOKING_FIELDS,
    }),
  },
  setup: prepareCookingStateV1,
  workload: runCookingWorkloadV1,
  expectedRuntimeExecutions: {
    mutations: 27,
    queries: 24,
  },
});
