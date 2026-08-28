import { readFileSync } from "node:fs";

import { isNonArrayRecord } from "@flarex/utils/records";
import { bytesEqual } from "@flarex/utils/bytes";
import {
  action,
  defineApplication,
  defineModule,
  defineSchema,
  defineTable,
  internalMutation,
  internalQuery,
  mutation,
  query,
  sourceModule,
  v,
  type FunctionDefinition,
  type Id,
} from "@flarex/application-definition";
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

import type {
  AuthoritativeCommittedApplicationMutationOutcome,
  InvokeApplicationMutationError,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  ValidatorValueErrorV1,
  type ValidatorValueIssueV1,
} from "flarex-protocol/validator-engine";
import type {
  RunMutationError,
  RunQueryError,
  SimulationClient,
  SimulationSetupClient,
} from "@flarex/system-test/environment";
import type {
  AuthoritativeInspection,
  InspectionError,
} from "@flarex/system-test/inspection";
import {
  defineSimulation,
} from "@flarex/system-test/simulation";
import {
  COOKING_PUBLISH_SERVING_GUIDE_TASK,
  COOKING_SERVING_GUIDE_TASK,
} from "../../support/cookingTaskDefinitionsV1";

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
  readonly taskMutationRecoveryDocumentId: string;
  readonly taskMutationRecoveryRunId: string;
  readonly taskMutationRecoveryCreationReplay: true;
  readonly taskMutationRecoveredAfterResultUncertainty: true;
  readonly taskMutationRecoveryCommittedOnce: true;
  readonly taskMutationRecoveryNestedQueryOutputValidated: true;
  readonly actionPublishedAndValidated: true;
  readonly actionPublicQueryCallback: true;
  readonly actionInternalMutationCallback: true;
  readonly actionControlledOutbound: true;
  readonly actionAnonymousIdentity: true;
  readonly actionReplay: true;
  readonly actionDeniedOutboundFailedBeforeDispatch: true;
  readonly actionDeniedOutboundReplay: true;
  readonly actionOutboundUncertaintyPersisted: true;
  readonly actionOutboundUncertaintyReplay: true;
  readonly actionInvalidReturnFailed: true;
  readonly actionInvalidReturnReplay: true;
  readonly actionCommittedMutationSurvivedFailure: true;
  readonly actionCommittedMutationFailureReplay: true;
  readonly actionRejectedMutationUncertain: true;
  readonly actionRejectedMutationReplay: true;
  readonly actionRejectedMutationRolledBack: true;
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
  readonly workloadInspection: AuthoritativeInspection;
}

export interface CookingSetupProofV1 {
  readonly documentId: Id<"recipes">;
  readonly commitSeq: bigint;
}

type CookingWorkloadErrorV1 =
  | RunMutationError
  | RunQueryError
  | InspectionError
  | Effect.Error<
    ReturnType<SimulationClient["tasks"]["create"]>
  >
  | Effect.Error<
    ReturnType<SimulationClient["tasks"]["deliver"]>
  >
  | Effect.Error<
    ReturnType<SimulationClient["action"]>
  >;

type CookingTaskRunCreationReceiptV1 = Effect.Success<
  ReturnType<SimulationClient["tasks"]["create"]>
>;

type CookingMutationInvocationErrorV1 = RunMutationError;

type CookingUserCodeFailureV1 = Extract<
  CookingMutationInvocationErrorV1,
  PointMutationOccUserCodeV1Error
>;

type CookingApplicationFailureV1 = Extract<
  CookingMutationInvocationErrorV1,
  PointMutationOccApplicationErrorV1
>;

type CookingMutationAttemptResultV1 = Result.Result<
  AuthoritativeCommittedApplicationMutationOutcome,
  InvokeApplicationMutationError
>;

type CookingTypedMutationResultV1 = Result.Result<
  AuthoritativeCommittedApplicationMutationOutcome,
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
const COOKING_ACTION_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:publish-action",
);
const COOKING_ACTION_DENIED_OUTBOUND_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:action-denied-outbound",
  );
const COOKING_ACTION_UNCERTAIN_OUTBOUND_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:action-uncertain-outbound",
  );
const COOKING_ACTION_INVALID_RETURN_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:action-invalid-return",
  );
const COOKING_ACTION_COMMITTED_MUTATION_FAILURE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:action-committed-mutation-failure",
  );
const COOKING_ACTION_REJECTED_MUTATION_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:action-rejected-mutation",
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
const COOKING_RECOVERY_DRAFT_CREATE_REQUEST_KEY =
  TransactionRequestKeyV1Schema.make(
    "sac01:cooking:recovery-draft-create",
  );
const COOKING_RECOVERY_TASK_REQUEST_KEY = Result.getOrThrow(
  decodeTaskRunCreationRequestKeyV1(
    "sac01:cooking:recovery-serving-guide-task",
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
  publishAction: readFileSync(new URL(
    "./functions/recipePublishAction.js",
    import.meta.url,
  )),
  actionCallbacks: readFileSync(new URL(
    "./functions/recipeActionCallbacks.js",
    import.meta.url,
  )),
} as const;

const COOKING_MODULE_SOURCES = {
  recipeCommands: { path: "recipeMutation", bytes: COOKING_FUNCTION_SOURCES.create },
  recipePatch: { path: "recipePatch", bytes: COOKING_FUNCTION_SOURCES.patch },
  recipeReplace: { path: "recipeReplace", bytes: COOKING_FUNCTION_SOURCES.replace },
  recipeDelete: { path: "recipeDelete", bytes: COOKING_FUNCTION_SOURCES.remove },
  recipes: { path: "recipeQuery", bytes: COOKING_FUNCTION_SOURCES.get },
  recipeAssessment: { path: "recipeAssessmentInternal", bytes: COOKING_FUNCTION_SOURCES.assess },
  recipeViews: { path: "recipeAssessmentView", bytes: COOKING_FUNCTION_SOURCES.assessmentView },
  recipePublicationView: { path: "recipePublicationView", bytes: COOKING_FUNCTION_SOURCES.publicationView },
  recipeMaintenance: { path: "recipePublishInternal", bytes: COOKING_FUNCTION_SOURCES.publishInternal },
  recipeWorkflows: { path: "recipePublishWorkflow", bytes: COOKING_FUNCTION_SOURCES.publishWorkflow },
  recipeServingSelection: { path: "recipeServingSelection", bytes: COOKING_FUNCTION_SOURCES.servingSelection },
  pantryCommands: { path: "pantryCreate", bytes: COOKING_FUNCTION_SOURCES.pantryCreate },
  pantry: { path: "pantryQuery", bytes: COOKING_FUNCTION_SOURCES.pantryQuery },
  pantryReservation: { path: "pantryReservation", bytes: COOKING_FUNCTION_SOURCES.pantryReservation },
  recipeActions: { path: "recipePublishAction", bytes: COOKING_FUNCTION_SOURCES.publishAction },
  recipeActionCallbacks: { path: "recipeActionCallbacks", bytes: COOKING_FUNCTION_SOURCES.actionCallbacks },
} as const;

function defineCookingModule<
  const Path extends keyof typeof COOKING_MODULE_SOURCES,
  const Functions extends Readonly<Record<string, FunctionDefinition>>,
>(path: Path, functions: Functions) {
  return defineModule({
    path,
    source: sourceModule(COOKING_MODULE_SOURCES[path]),
    functions,
  });
}

const applicationApi = Object.freeze({
  ...v,
  module: defineCookingModule,
  publicMutation: mutation,
  publicQuery: query,
  internalMutation,
  internalQuery,
  publicAction: action,
});

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
const COOKING_ACTION_FAILURE_DESCRIPTION =
  "Child committed.";
const COOKING_SECOND_RECIPE_AFTER_ACTION_FAILURE = {
  ...COOKING_SECOND_RECIPE,
  description: COOKING_ACTION_FAILURE_DESCRIPTION,
  published: true,
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
const COOKING_RECOVERY_DRAFT_RECIPE = {
  ...COOKING_REPLACEMENT_RECIPE,
  title: "Recovered mushroom risotto",
  localizedTitles: { en: "Recovered mushroom risotto" },
  source: "Fresh-host recovery fixture",
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
const COOKING_RECOVERY_PUBLISHED_ASSESSMENT = {
  ...COOKING_PUBLISHED_ASSESSMENT,
  title: "Recovered mushroom risotto",
  headline: "Recovered mushroom risotto serves 3",
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
  title: applicationApi.string(),
  description: applicationApi.optional(applicationApi.string()),
  servings: applicationApi.number(),
  difficulty: applicationApi.union(
    applicationApi.literal("easy"),
    applicationApi.literal("medium"),
    applicationApi.literal("hard"),
  ),
  published: applicationApi.boolean(),
  tags: applicationApi.array(applicationApi.string()),
  ingredients: applicationApi.array(applicationApi.object({
    name: applicationApi.string(),
    amount: applicationApi.number(),
    unit: applicationApi.string(),
    note: applicationApi.optional(applicationApi.string()),
  })),
  steps: applicationApi.array(applicationApi.object({
    position: applicationApi.number(),
    instruction: applicationApi.string(),
    durationMinutes: applicationApi.optional(applicationApi.number()),
  })),
  nutrition: applicationApi.object({
    caloriesPerServing: applicationApi.number(),
    vegetarian: applicationApi.boolean(),
  }),
  localizedTitles: applicationApi.record(
    applicationApi.string(),
    applicationApi.string(),
  ),
  source: applicationApi.nullable(applicationApi.string()),
} as const;
const COOKING_DOCUMENT = applicationApi.object({
  _id: applicationApi.id("recipes"),
  _creationTime: applicationApi.number(),
  ...COOKING_FIELDS,
});
const COOKING_PANTRY_FIELDS = {
  ingredient: applicationApi.string(),
  available: applicationApi.number(),
} as const;
const COOKING_PANTRY_DOCUMENT = applicationApi.object({
  _id: applicationApi.id("pantryStock"),
  _creationTime: applicationApi.number(),
  ...COOKING_PANTRY_FIELDS,
});
const COOKING_ID_ARGS = applicationApi.object({ id: applicationApi.string() });
const COOKING_ASSESSMENT_FIELDS = {
  title: applicationApi.string(),
  servings: applicationApi.number(),
  published: applicationApi.boolean(),
  ingredientCount: applicationApi.number(),
  stepCount: applicationApi.number(),
  timedMinutes: applicationApi.number(),
  publishable: applicationApi.boolean(),
} as const;
const COOKING_ASSESSMENT = applicationApi.nullable(
  applicationApi.object(COOKING_ASSESSMENT_FIELDS),
);
const COOKING_ASSESSMENT_VIEW_FIELDS = {
  ...COOKING_ASSESSMENT_FIELDS,
  headline: applicationApi.string(),
  effort: applicationApi.union(
    applicationApi.literal("short"),
    applicationApi.literal("long"),
  ),
} as const;
const COOKING_ASSESSMENT_VIEW = applicationApi.nullable(
  applicationApi.object(COOKING_ASSESSMENT_VIEW_FIELDS),
);
const COOKING_PUBLISH_RECEIPT_FIELDS = {
  changed: applicationApi.boolean(),
  beforePublished: applicationApi.boolean(),
  afterPublished: applicationApi.boolean(),
  ingredientCount: applicationApi.number(),
  timedMinutes: applicationApi.number(),
} as const;
const COOKING_PUBLISH_RECEIPT_VALIDATOR = applicationApi.nullable(
  applicationApi.object(COOKING_PUBLISH_RECEIPT_FIELDS),
);
const COOKING_RESERVATION_RECEIPT_VALIDATOR = applicationApi.nullable(
  applicationApi.object({
    pantryId: applicationApi.id("pantryStock"),
    recipeId: applicationApi.id("recipes"),
    remainingStock: applicationApi.number(),
  }),
);
const COOKING_INDEXED_DECISION_RECEIPT_VALIDATOR = applicationApi.nullable(
  applicationApi.object({
    recipeId: applicationApi.id("recipes"),
    servings: applicationApi.number(),
    pageExhausted: applicationApi.boolean(),
  }),
);
const COOKING_MUTATION_MODULE = applicationApi.module("recipeCommands", {
  create: applicationApi.publicMutation({
    args: applicationApi.object(COOKING_FIELDS),
    returns: applicationApi.id("recipes"),
  }),
});
const COOKING_PATCH_MODULE = applicationApi.module("recipePatch", {
  patch: applicationApi.publicMutation({
    args: applicationApi.object({
      id: applicationApi.id("recipes"),
      patch: applicationApi.object({
        title: applicationApi.optional(applicationApi.string()),
        description: applicationApi.optional(applicationApi.string()),
        servings: applicationApi.optional(applicationApi.number()),
        difficulty: applicationApi.optional(applicationApi.union(
          applicationApi.literal("easy"),
          applicationApi.literal("medium"),
          applicationApi.literal("hard"),
        )),
        published: applicationApi.optional(applicationApi.boolean()),
        tags: applicationApi.optional(applicationApi.array(applicationApi.string())),
        ingredients: applicationApi.optional(COOKING_FIELDS.ingredients),
        steps: applicationApi.optional(COOKING_FIELDS.steps),
        nutrition: applicationApi.optional(COOKING_FIELDS.nutrition),
        localizedTitles: applicationApi.optional(COOKING_FIELDS.localizedTitles),
        source: applicationApi.optional(COOKING_FIELDS.source),
      }),
    }),
    returns: applicationApi.null(),
  }),
  removeDescription: applicationApi.publicMutation({
    args: applicationApi.object({ id: applicationApi.id("recipes") }),
    returns: applicationApi.null(),
  }),
  patchThenReturnInvalid: applicationApi.publicMutation({
    args: applicationApi.object({ id: applicationApi.id("recipes") }),
    returns: applicationApi.null(),
  }),
  patchThenThrow: applicationApi.publicMutation({
    args: applicationApi.object({ id: applicationApi.id("recipes") }),
    returns: applicationApi.null(),
  }),
});
const COOKING_REPLACE_MODULE = applicationApi.module("recipeReplace", {
  replace: applicationApi.publicMutation({
    args: applicationApi.object({
      id: applicationApi.id("recipes"),
      fields: applicationApi.object(COOKING_FIELDS),
    }),
    returns: applicationApi.null(),
  }),
});
const COOKING_DELETE_MODULE = applicationApi.module("recipeDelete", {
  remove: applicationApi.publicMutation({
    args: applicationApi.object({ id: applicationApi.id("recipes") }),
    returns: applicationApi.null(),
  }),
});
const COOKING_QUERY_MODULE = applicationApi.module("recipes", {
  get: applicationApi.publicQuery({
    args: COOKING_ID_ARGS,
    returns: applicationApi.nullable(COOKING_DOCUMENT),
  }),
});
const COOKING_ASSESSMENT_MODULE = applicationApi.module("recipeAssessment", {
  assess: applicationApi.internalQuery({
    args: COOKING_ID_ARGS,
    returns: COOKING_ASSESSMENT,
  }),
});
const COOKING_ASSESSMENT_VIEW_MODULE = applicationApi.module("recipeViews", {
  assessment: applicationApi.publicQuery({
    args: COOKING_ID_ARGS,
    returns: COOKING_ASSESSMENT_VIEW,
  }),
});
const COOKING_PUBLICATION_VIEW_MODULE = applicationApi.module(
  "recipePublicationView",
  {
    requirePublished: applicationApi.publicQuery({
      args: COOKING_ID_ARGS,
      returns: applicationApi.nullable(COOKING_DOCUMENT),
    }),
  },
);
const COOKING_MAINTENANCE_MODULE = applicationApi.module("recipeMaintenance", {
  markPublished: applicationApi.internalMutation({
    args: COOKING_ID_ARGS,
    returns: COOKING_PUBLISH_RECEIPT_VALIDATOR,
  }),
});
const COOKING_WORKFLOW_MODULE = applicationApi.module("recipeWorkflows", {
  publish: applicationApi.publicMutation({
    args: COOKING_ID_ARGS,
    returns: COOKING_PUBLISH_RECEIPT_VALIDATOR,
  }),
});
const COOKING_INDEXED_DECISION_MODULE = applicationApi.module(
  "recipeServingSelection",
  {
    publishSmallestBatch: applicationApi.publicMutation({
      args: applicationApi.object({}),
      returns: COOKING_INDEXED_DECISION_RECEIPT_VALIDATOR,
    }),
  },
);
const COOKING_PANTRY_COMMAND_MODULE = applicationApi.module("pantryCommands", {
  create: applicationApi.publicMutation({
    args: applicationApi.object(COOKING_PANTRY_FIELDS),
    returns: applicationApi.id("pantryStock"),
  }),
});
const COOKING_PANTRY_QUERY_MODULE = applicationApi.module("pantry", {
  get: applicationApi.publicQuery({
    args: applicationApi.object({ id: applicationApi.id("pantryStock") }),
    returns: applicationApi.nullable(COOKING_PANTRY_DOCUMENT),
  }),
});
const COOKING_RESERVATION_MODULE = applicationApi.module("pantryReservation", {
  reserveAndPublish: applicationApi.publicMutation({
    args: applicationApi.object({
      pantryId: applicationApi.id("pantryStock"),
      recipeId: applicationApi.id("recipes"),
    }),
    returns: COOKING_RESERVATION_RECEIPT_VALIDATOR,
  }),
});
const COOKING_ACTION_MODULE = applicationApi.module("recipeActions", {
  publishAndNotify: applicationApi.publicAction({
    args: COOKING_ID_ARGS,
    returns: applicationApi.object({
      recipeId: applicationApi.id("recipes"),
      beforePublished: applicationApi.boolean(),
      publication: applicationApi.boolean(),
      afterPublished: applicationApi.boolean(),
      notificationStatus: applicationApi.number(),
      notificationAccepted: applicationApi.boolean(),
      anonymous: applicationApi.boolean(),
    }),
  }),
  rejectDeniedNotification: applicationApi.publicAction({
    args: COOKING_ID_ARGS,
    returns: applicationApi.object({
      recipeId: applicationApi.id("recipes"),
      notificationStatus: applicationApi.number(),
    }),
  }),
  preserveUncertainNotification: applicationApi.publicAction({
    args: COOKING_ID_ARGS,
    returns: applicationApi.object({
      recipeId: applicationApi.id("recipes"),
      notificationStatus: applicationApi.number(),
    }),
  }),
  returnInvalidNotificationReceipt: applicationApi.publicAction({
    args: COOKING_ID_ARGS,
    returns: applicationApi.object({
      recipeId: applicationApi.id("recipes"),
      notificationStatus: applicationApi.number(),
    }),
  }),
  commitFail: applicationApi.publicAction({
    args: COOKING_ID_ARGS,
    returns: applicationApi.object({
      recipeId: applicationApi.id("recipes"),
      notificationStatus: applicationApi.number(),
    }),
  }),
  rejectChild: applicationApi.publicAction({
    args: COOKING_ID_ARGS,
    returns: applicationApi.object({
      recipeId: applicationApi.id("recipes"),
      notificationStatus: applicationApi.number(),
    }),
  }),
});
const COOKING_ACTION_CALLBACK_MODULE = applicationApi.module(
  "recipeActionCallbacks",
  {
    isPublished: applicationApi.publicQuery({
      args: COOKING_ID_ARGS,
      returns: applicationApi.boolean(),
    }),
    markPublished: applicationApi.internalMutation({
      args: COOKING_ID_ARGS,
      returns: applicationApi.boolean(),
    }),
    markFailure: applicationApi.internalMutation({
      args: COOKING_ID_ARGS,
      returns: applicationApi.boolean(),
    }),
  },
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
const COOKING_PUBLISH_AND_NOTIFY =
  COOKING_ACTION_MODULE.reference("publishAndNotify");
const COOKING_REJECT_DENIED_NOTIFICATION =
  COOKING_ACTION_MODULE.reference("rejectDeniedNotification");
const COOKING_PRESERVE_UNCERTAIN_NOTIFICATION =
  COOKING_ACTION_MODULE.reference("preserveUncertainNotification");
const COOKING_RETURN_INVALID_NOTIFICATION_RECEIPT =
  COOKING_ACTION_MODULE.reference("returnInvalidNotificationReceipt");
const COOKING_COMMIT_MUTATION_THEN_RETURN_INVALID =
  COOKING_ACTION_MODULE.reference("commitFail");
const COOKING_INVOKE_REJECTED_CHILD_MUTATION =
  COOKING_ACTION_MODULE.reference("rejectChild");

const prepareCookingStateV1 = Effect.fn(
  "SystemTestCookingSimulation.setupV1",
)(function* (
  client: SimulationSetupClient,
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
  client: SimulationClient,
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
  const recoveryDraftInserted = yield* client.mutation(
    COOKING_CREATE,
    COOKING_RECOVERY_DRAFT_RECIPE,
    COOKING_RECOVERY_DRAFT_CREATE_REQUEST_KEY,
  );
  if (
    recoveryDraftInserted.status !== "committed" ||
    recoveryDraftInserted.disposition !== "published" ||
    recoveryDraftInserted.commitSeq !== setup.commitSeq + 19n ||
    typeof recoveryDraftInserted.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The cooking workload did not publish the fresh-host recovery draft.",
    ));
  }
  const taskMutationRecoveryDocumentId = recoveryDraftInserted.value;
  const taskMutationRecoveryRequest = Object.freeze({
    version: 1 as const,
    requestKey: COOKING_RECOVERY_TASK_REQUEST_KEY,
    payload: Object.freeze({ recipeId: taskMutationRecoveryDocumentId }),
    executionIdentity: COOKING_TASK_EXECUTION_IDENTITY,
  });
  const taskMutationRecoveryFirst = yield* client.tasks.create(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationRecoveryRequest,
  );
  const taskMutationRecoveryReplay = yield* client.tasks.create(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationRecoveryRequest,
  );
  if (!sameTaskRunCreationReceiptV1(
    taskMutationRecoveryReplay,
    taskMutationRecoveryFirst,
  )) {
    return yield* Effect.die(new Error(
      "The cooking fresh-host recovery Task did not replay its durable run.",
    ));
  }
  const taskMutationRecoveryDelivery = yield* client.tasks.deliver(
    COOKING_PUBLISH_SERVING_GUIDE_TASK.reference,
    taskMutationRecoveryFirst,
    {
      kind: "recovery",
      recovery: "result_publication_uncertain_takeover",
    },
  );
  if (
    taskMutationRecoveryDelivery.status !== "recovered" ||
    taskMutationRecoveryDelivery.runId !== taskMutationRecoveryFirst.runId ||
    taskMutationRecoveryDelivery.recovery.abandonedAttemptNumber !== 1 ||
    taskMutationRecoveryDelivery.recovery.replacementAttemptNumber !== 2 ||
    taskMutationRecoveryDelivery.recovery.leaseExpiryOutcome !==
      "retry_scheduled" ||
    taskMutationRecoveryDelivery.recovery.retryStartOutcome !==
      "attempt_granted" ||
    !taskMutationRecoveryDelivery.recovery.staleHeartbeatRejected ||
    !taskMutationRecoveryDelivery.recovery.staleCompletionRejected ||
    !taskMutationRecoveryDelivery.recovery.staleAttemptStatePreserved ||
    !taskMutationRecoveryDelivery.recovery.freshControlTarget ||
    !taskMutationRecoveryDelivery.recovery.freshWorkerLoader ||
    !taskMutationRecoveryDelivery.recovery.freshResourcePorts ||
    taskMutationRecoveryDelivery.abandonedWorker.loads !== 1 ||
    taskMutationRecoveryDelivery.abandonedWorker.starts !== 1 ||
    taskMutationRecoveryDelivery.abandonedWorker.settlements !== 1 ||
    taskMutationRecoveryDelivery.host.dispatchCandidatesHandled !== 1 ||
    taskMutationRecoveryDelivery.host.dispatchProviderCalls !== 1 ||
    taskMutationRecoveryDelivery.host.cancellationCandidatesHandled !== 0 ||
    taskMutationRecoveryDelivery.host.cancellationProviderCalls !== 0 ||
    taskMutationRecoveryDelivery.host.candidateFailures !== 0 ||
    taskMutationRecoveryDelivery.host.supervisionExpected !== 1 ||
    taskMutationRecoveryDelivery.host.supervisionObserved !== 1 ||
    taskMutationRecoveryDelivery.host.supervisionSucceeded !== 1 ||
    taskMutationRecoveryDelivery.host.supervisionFailed !== 0 ||
    taskMutationRecoveryDelivery.worker.generation !== "application_v1" ||
    taskMutationRecoveryDelivery.worker.loads !== 1 ||
    taskMutationRecoveryDelivery.worker.starts !== 1 ||
    taskMutationRecoveryDelivery.worker.inputReads !== 1 ||
    taskMutationRecoveryDelivery.worker.settlements !== 1 ||
    taskMutationRecoveryDelivery.worker.resultWrites !== 1 ||
    taskMutationRecoveryDelivery.worker.resultReads !== 2 ||
    taskMutationRecoveryDelivery.worker.legacyRuntimeObjectReads !== 0 ||
    !sameJsonValue(taskMutationRecoveryDelivery.output, {
      recipeId: taskMutationRecoveryDocumentId,
      publication: COOKING_PUBLISH_RECEIPT,
      assessment: COOKING_RECOVERY_PUBLISHED_ASSESSMENT,
    })
  ) {
    return yield* Effect.die(new Error(
      "The cooking Task did not recover result uncertainty on a fresh host.",
    ));
  }
  const taskMutationRecoveryAssessment = yield* client.query(
    COOKING_ASSESSMENT_FUNCTION,
    { id: taskMutationRecoveryDocumentId },
  );
  if (!sameJsonValue(
    taskMutationRecoveryAssessment,
    COOKING_RECOVERY_PUBLISHED_ASSESSMENT,
  )) {
    return yield* Effect.die(new Error(
      "The recovered cooking Task did not preserve its single committed mutation.",
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
    resultUncertainDraftInserted.commitSeq !== setup.commitSeq + 21n ||
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
  const actionResult = yield* client.action(
    COOKING_PUBLISH_AND_NOTIFY,
    { id: secondaryDocumentId },
    COOKING_ACTION_REQUEST_KEY,
  );
  const expectedActionValue = {
    recipeId: secondaryDocumentId,
    beforePublished: false,
    publication: true,
    afterPublished: true,
    notificationStatus: 202,
    notificationAccepted: true,
    anonymous: true,
  } as const;
  if (
    actionResult.status !== "completed" ||
    actionResult.disposition !== "published" ||
    !sameJsonValue(actionResult.value, expectedActionValue)
  ) {
    return yield* Effect.die(new Error(
      "The cooking Action did not publish through its real callbacks and controlled outbound host.",
    ));
  }
  const actionReplay = yield* client.action(
    COOKING_PUBLISH_AND_NOTIFY,
    { id: secondaryDocumentId },
    COOKING_ACTION_REQUEST_KEY,
  );
  if (
    actionReplay.status !== "completed" ||
    actionReplay.disposition !== "replayed" ||
    actionReplay.invocationId !== actionResult.invocationId ||
    !sameJsonValue(actionReplay.value, expectedActionValue)
  ) {
    return yield* Effect.die(new Error(
      "The cooking Action did not replay its durable completed result.",
    ));
  }
  const deniedOutbound = yield* client.action(
    COOKING_REJECT_DENIED_NOTIFICATION,
    { id: secondaryDocumentId },
    COOKING_ACTION_DENIED_OUTBOUND_REQUEST_KEY,
  );
  if (
    deniedOutbound.status !== "notCompleted" ||
    deniedOutbound.disposition !== "settled" ||
    deniedOutbound.lifecycle !== "failed"
  ) {
    return yield* Effect.die(new Error(
      `The denied cooking Action did not fail before outbound dispatch: ${JSON.stringify(deniedOutbound)}.`,
    ));
  }
  const deniedOutboundReplay = yield* client.action(
    COOKING_REJECT_DENIED_NOTIFICATION,
    { id: secondaryDocumentId },
    COOKING_ACTION_DENIED_OUTBOUND_REQUEST_KEY,
  );
  if (
    deniedOutboundReplay.status !== "notCompleted" ||
    deniedOutboundReplay.disposition !== "replayed" ||
    deniedOutboundReplay.lifecycle !== "failed" ||
    deniedOutboundReplay.invocationId !== deniedOutbound.invocationId ||
    deniedOutboundReplay.terminalCode !== deniedOutbound.terminalCode
  ) {
    return yield* Effect.die(new Error(
      "The denied cooking Action did not replay its terminal failure.",
    ));
  }
  const uncertainOutbound = yield* client.action(
    COOKING_PRESERVE_UNCERTAIN_NOTIFICATION,
    { id: secondaryDocumentId },
    COOKING_ACTION_UNCERTAIN_OUTBOUND_REQUEST_KEY,
  );
  if (
    uncertainOutbound.status !== "notCompleted" ||
    uncertainOutbound.disposition !== "settled" ||
    uncertainOutbound.lifecycle !== "uncertain"
  ) {
    return yield* Effect.die(new Error(
      `The cooking Action did not preserve outbound uncertainty: ${JSON.stringify(uncertainOutbound)}.`,
    ));
  }
  const uncertainOutboundReplay = yield* client.action(
    COOKING_PRESERVE_UNCERTAIN_NOTIFICATION,
    { id: secondaryDocumentId },
    COOKING_ACTION_UNCERTAIN_OUTBOUND_REQUEST_KEY,
  );
  if (
    uncertainOutboundReplay.status !== "notCompleted" ||
    uncertainOutboundReplay.disposition !== "replayed" ||
    uncertainOutboundReplay.lifecycle !== "uncertain" ||
    uncertainOutboundReplay.invocationId !== uncertainOutbound.invocationId ||
    uncertainOutboundReplay.terminalCode !== uncertainOutbound.terminalCode
  ) {
    return yield* Effect.die(new Error(
      "The uncertain cooking Action did not replay without redispatch.",
    ));
  }
  const invalidReturn = yield* client.action(
    COOKING_RETURN_INVALID_NOTIFICATION_RECEIPT,
    { id: secondaryDocumentId },
    COOKING_ACTION_INVALID_RETURN_REQUEST_KEY,
  );
  if (
    invalidReturn.status !== "notCompleted" ||
    invalidReturn.disposition !== "settled" ||
    invalidReturn.lifecycle !== "failed"
  ) {
    return yield* Effect.die(new Error(
      `The cooking Action invalid return was not terminally rejected: ${JSON.stringify(invalidReturn)}.`,
    ));
  }
  const invalidReturnReplay = yield* client.action(
    COOKING_RETURN_INVALID_NOTIFICATION_RECEIPT,
    { id: secondaryDocumentId },
    COOKING_ACTION_INVALID_RETURN_REQUEST_KEY,
  );
  if (
    invalidReturnReplay.status !== "notCompleted" ||
    invalidReturnReplay.disposition !== "replayed" ||
    invalidReturnReplay.lifecycle !== "failed" ||
    invalidReturnReplay.invocationId !== invalidReturn.invocationId ||
    invalidReturnReplay.terminalCode !== invalidReturn.terminalCode
  ) {
    return yield* Effect.die(new Error(
      "The cooking Action invalid-return failure did not replay terminally.",
    ));
  }
  const committedMutationFailure = yield* client.action(
    COOKING_COMMIT_MUTATION_THEN_RETURN_INVALID,
    { id: secondaryDocumentId },
    COOKING_ACTION_COMMITTED_MUTATION_FAILURE_REQUEST_KEY,
  );
  if (
    committedMutationFailure.status !== "notCompleted" ||
    committedMutationFailure.disposition !== "settled" ||
    committedMutationFailure.lifecycle !== "failed"
  ) {
    return yield* Effect.die(new Error(
      `The cooking Action did not preserve its confirmed child mutation before return validation failed: ${JSON.stringify(committedMutationFailure)}.`,
    ));
  }
  const committedMutationFailureReplay = yield* client.action(
    COOKING_COMMIT_MUTATION_THEN_RETURN_INVALID,
    { id: secondaryDocumentId },
    COOKING_ACTION_COMMITTED_MUTATION_FAILURE_REQUEST_KEY,
  );
  if (
    committedMutationFailureReplay.status !== "notCompleted" ||
    committedMutationFailureReplay.disposition !== "replayed" ||
    committedMutationFailureReplay.lifecycle !== "failed" ||
    committedMutationFailureReplay.invocationId !==
      committedMutationFailure.invocationId ||
    committedMutationFailureReplay.terminalCode !==
      committedMutationFailure.terminalCode
  ) {
    return yield* Effect.die(new Error(
      "The cooking Action did not replay its post-mutation validation failure.",
    ));
  }
  const rejectedMutation = yield* client.action(
    COOKING_INVOKE_REJECTED_CHILD_MUTATION,
    { id: secondaryDocumentId },
    COOKING_ACTION_REJECTED_MUTATION_REQUEST_KEY,
  );
  if (
    rejectedMutation.status !== "notCompleted" ||
    rejectedMutation.disposition !== "settled" ||
    rejectedMutation.lifecycle !== "uncertain"
  ) {
    return yield* Effect.die(new Error(
      `The cooking Action did not fail closed after its child mutation callback rejected: ${JSON.stringify(rejectedMutation)}.`,
    ));
  }
  const rejectedMutationReplay = yield* client.action(
    COOKING_INVOKE_REJECTED_CHILD_MUTATION,
    { id: secondaryDocumentId },
    COOKING_ACTION_REJECTED_MUTATION_REQUEST_KEY,
  );
  if (
    rejectedMutationReplay.status !== "notCompleted" ||
    rejectedMutationReplay.disposition !== "replayed" ||
    rejectedMutationReplay.lifecycle !== "uncertain" ||
    rejectedMutationReplay.invocationId !== rejectedMutation.invocationId ||
    rejectedMutationReplay.terminalCode !== rejectedMutation.terminalCode
  ) {
    return yield* Effect.die(new Error(
      "The cooking Action reran instead of replaying its rejected-child uncertainty.",
    ));
  }
  const secondaryAfterActionFailures = yield* client.query(
    COOKING_GET,
    { id: secondaryDocumentId },
  );
  requireRecipeDocument(
    secondaryAfterActionFailures,
    secondaryDocumentId,
    COOKING_SECOND_RECIPE_AFTER_ACTION_FAILURE,
  );
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
    taskMutationRecoveryDocumentId,
    taskMutationRecoveryRunId: taskMutationRecoveryFirst.runId,
    taskMutationRecoveryCreationReplay: true,
    taskMutationRecoveredAfterResultUncertainty: true,
    taskMutationRecoveryCommittedOnce: true,
    taskMutationRecoveryNestedQueryOutputValidated: true,
    actionPublishedAndValidated: true,
    actionPublicQueryCallback: true,
    actionInternalMutationCallback: true,
    actionControlledOutbound: true,
    actionAnonymousIdentity: true,
    actionReplay: true,
    actionDeniedOutboundFailedBeforeDispatch: true,
    actionDeniedOutboundReplay: true,
    actionOutboundUncertaintyPersisted: true,
    actionOutboundUncertaintyReplay: true,
    actionInvalidReturnFailed: true,
    actionInvalidReturnReplay: true,
    actionCommittedMutationSurvivedFailure: true,
    actionCommittedMutationFailureReplay: true,
    actionRejectedMutationUncertain: true,
    actionRejectedMutationReplay: true,
    actionRejectedMutationRolledBack: true,
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
  outcome: AuthoritativeCommittedApplicationMutationOutcome,
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
  outcome: AuthoritativeCommittedApplicationMutationOutcome,
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
): AuthoritativeCommittedApplicationMutationOutcome {
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
  outcome: AuthoritativeCommittedApplicationMutationOutcome,
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
  before: AuthoritativeInspection,
  after: AuthoritativeInspection,
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
  before: AuthoritativeInspection,
  after: AuthoritativeInspection,
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
  before: AuthoritativeInspection,
  after: AuthoritativeInspection,
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
  left: AuthoritativeInspection["currentRows"],
  right: AuthoritativeInspection["currentRows"],
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
  before: AuthoritativeInspection,
  after: AuthoritativeInspection,
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
  before: AuthoritativeInspection,
  after: AuthoritativeInspection,
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

export const cookingSimulationV1 = defineSimulation({
  version: 1,
  simulationId: "cooking-rich-recipe-point-lifecycle-v1",
  application: {
    applicationId: "cooking",
    revisionName: "sac01-cooking-app",
    actionHost: {
      allowedOrigins: ["https://api.example.com"],
      fetch: async request => {
        const body: unknown = await request.json();
        if (
          request.url ===
            "https://api.example.com/cooking-publication-uncertain" &&
          request.method === "POST" &&
          request.headers.get("content-type") === "application/json" &&
          isNonArrayRecord(body) &&
          typeof body.recipeId === "string" &&
          Object.keys(body).length === 1
        ) {
          throw new Error(
            "The cooking notification outcome was lost after dispatch.",
          );
        }
        if (
          request.url !==
            "https://api.example.com/cooking-publication" ||
          request.method !== "POST" ||
          request.headers.get("content-type") !== "application/json" ||
          !isNonArrayRecord(body) ||
          typeof body.recipeId !== "string" ||
          body.published !== true ||
          Object.keys(body).length !== 2
        ) {
          throw new Error(
            "The cooking Action emitted an unexpected outbound request.",
          );
        }
        return new Response(JSON.stringify({ accepted: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      },
    },
    defineTasks: () => [
      COOKING_SERVING_GUIDE_TASK,
      COOKING_PUBLISH_SERVING_GUIDE_TASK,
    ],
    define: () => defineApplication({
      schema: defineSchema({
        recipes: defineTable(COOKING_FIELDS)
          .index("by_difficulty", ["difficulty"])
          .index("by_servings", ["servings"]),
        pantryStock: defineTable(COOKING_PANTRY_FIELDS),
      }),
      modules: [
        COOKING_MUTATION_MODULE,
        COOKING_PATCH_MODULE,
        COOKING_REPLACE_MODULE,
        COOKING_DELETE_MODULE,
        COOKING_ASSESSMENT_MODULE,
        COOKING_ASSESSMENT_VIEW_MODULE,
        COOKING_PUBLICATION_VIEW_MODULE,
        COOKING_MAINTENANCE_MODULE,
        COOKING_WORKFLOW_MODULE,
        COOKING_INDEXED_DECISION_MODULE,
        COOKING_PANTRY_COMMAND_MODULE,
        COOKING_PANTRY_QUERY_MODULE,
        COOKING_RESERVATION_MODULE,
        COOKING_ACTION_MODULE,
        COOKING_ACTION_CALLBACK_MODULE,
        COOKING_QUERY_MODULE,
      ],
    }),
  },
  setup: prepareCookingStateV1,
  workload: runCookingWorkloadV1,
  expectedRuntimeExecutions: {
    mutations: 32,
    queries: 30,
    actions: 6,
  },
});
