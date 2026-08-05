import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect, Result } from "effect";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";

import type {
  AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  InvokeStandardApplicationPointMutationV1Error,
  InvokeStandardApplicationPointQueryV1Error,
} from "@flarex/standard-application-invocation/v1";
import {
  ValidatorValueErrorV1,
  type ValidatorValueIssueV1,
} from "flarex-protocol/validator-engine";
import type {
  StandardApplicationSystemTestClientV1,
  StandardApplicationSystemTestSetupClientV1,
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
  readonly richDocumentRoundTrip: true;
  readonly rejectedInvalidMutations: 2;
  readonly invalidArgumentsRejectedBeforeRuntime: true;
  readonly committedStateUnchangedAfterRejections: true;
  readonly mutationReplay: true;
  readonly queryReplay: true;
  readonly workloadInspection: StandardApplicationAuthoritativeInspectionV1;
}

export interface CookingSetupProofV1 {
  readonly documentId: string;
  readonly commitSeq: bigint;
}

type CookingWorkloadErrorV1 =
  | InvokeStandardApplicationPointMutationV1Error
  | InvokeStandardApplicationPointQueryV1Error
  | StandardApplicationSystemTestInspectionV1Error;

type CookingMutationAttemptResultV1 = Result.Result<
  AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  InvokeStandardApplicationPointMutationV1Error
>;

type CookingExpectedArgumentIssueV1 = Extract<
  ValidatorValueIssueV1,
  { readonly reason: "typeMismatch" | "missingRequiredField" }
>;

const COOKING_MUTATION_PATH = TransactionFunctionPathV1Schema.make(
  "recipeCommands:create",
);
const COOKING_QUERY_PATH = TransactionFunctionPathV1Schema.make("recipes:get");
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

const prepareCookingStateV1 = Effect.fn(
  "SystemTestCookingSimulation.setupV1",
)(function* (
  client: StandardApplicationSystemTestSetupClientV1,
): Effect.fn.Return<CookingSetupProofV1, CookingWorkloadErrorV1> {
  const inserted = yield* client.invokeMutation(
    COOKING_MUTATION_PATH,
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
  const replayedMutation = yield* client.invokeMutation(
    COOKING_MUTATION_PATH,
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

  const firstRead = yield* client.invokeQuery(
    COOKING_QUERY_PATH,
    { id: setup.documentId },
  );
  requireRecipeDocument(firstRead, setup.documentId);

  const beforeInvalidInputInspection =
    yield* client.inspectAuthoritativeState();
  const invalidAmountResult = yield* Effect.result(client.invokeMutation(
    COOKING_MUTATION_PATH,
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
  const missingNameResult = yield* Effect.result(client.invokeMutation(
    COOKING_MUTATION_PATH,
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
  const workloadInspection = yield* client.inspectAuthoritativeState();
  requireNoRejectedMutationSideEffects(
    beforeInvalidInputInspection,
    workloadInspection,
  );

  const replayedRead = yield* client.invokeQuery(
    COOKING_QUERY_PATH,
    { id: setup.documentId },
  );
  requireRecipeDocument(replayedRead, setup.documentId);
  if (JSON.stringify(firstRead) !== JSON.stringify(replayedRead)) {
    return yield* Effect.die(new Error(
      "The cooking workload did not deterministically replay its point query.",
    ));
  }
  return {
    documentId: setup.documentId,
    richDocumentRoundTrip: true,
    rejectedInvalidMutations: 2,
    invalidArgumentsRejectedBeforeRuntime: true,
    committedStateUnchangedAfterRejections: true,
    mutationReplay: true,
    queryReplay: true,
    workloadInspection,
  };
});

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

function requireRecipeDocument(value: unknown, documentId: string): void {
  if (
    !isNonArrayRecord(value) ||
    value._id !== documentId ||
    typeof value._creationTime !== "number" ||
    !Number.isFinite(value._creationTime) ||
    value.title !== "Tomato soup" ||
    value.description !== "A slow-simmered weeknight soup." ||
    value.servings !== 4 ||
    value.difficulty !== "medium" ||
    value.published !== true ||
    !hasExpectedRecipeTags(value.tags) ||
    !hasExpectedRecipeIngredients(value.ingredients) ||
    !hasExpectedRecipeSteps(value.steps) ||
    !hasExpectedRecipeNutrition(value.nutrition) ||
    !hasExpectedLocalizedTitles(value.localizedTitles) ||
    value.source !== null
  ) {
    throw new Error(
      "The cooking workload did not read the authoritative recipe document.",
    );
  }
}

function hasExpectedRecipeTags(value: unknown): boolean {
  return Array.isArray(value) &&
    value.length === 2 &&
    value[0] === "soup" &&
    value[1] === "vegetarian";
}

function hasExpectedRecipeIngredients(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const tomato = value[0];
  const stock = value[1];
  return isNonArrayRecord(tomato) &&
    tomato.name === "Tomato" &&
    tomato.amount === 6 &&
    tomato.unit === "whole" &&
    tomato.note === "ripe" &&
    isNonArrayRecord(stock) &&
    stock.name === "Vegetable stock" &&
    stock.amount === 750 &&
    stock.unit === "ml" &&
    !("note" in stock);
}

function hasExpectedRecipeSteps(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const roast = value[0];
  const simmer = value[1];
  return isNonArrayRecord(roast) &&
    roast.position === 1 &&
    roast.instruction === "Roast the tomatoes." &&
    roast.durationMinutes === 25 &&
    isNonArrayRecord(simmer) &&
    simmer.position === 2 &&
    simmer.instruction === "Blend and simmer with stock." &&
    !("durationMinutes" in simmer);
}

function hasExpectedRecipeNutrition(value: unknown): boolean {
  return isNonArrayRecord(value) &&
    value.caloriesPerServing === 180 &&
    value.vegetarian === true;
}

function hasExpectedLocalizedTitles(value: unknown): boolean {
  return isNonArrayRecord(value) &&
    value.en === "Tomato soup" &&
    value.es === "Sopa de tomate" &&
    Object.keys(value).length === 2;
}

export const cookingSimulationV1 = defineStandardApplicationSimulationV1({
  version: 1,
  simulationId: "cooking-rich-recipe-create-and-read-v1",
  application: {
    applicationId: "cooking",
    revisionName: "sac01-cooking-app",
    define: () => makeCreateAndReadDefinitionV1({
      tableName: "recipes",
      mutationModulePath: "recipeCommands",
      queryModulePath: "recipes",
      mutationArtifactPath: "recipeMutation",
      queryArtifactPath: "recipeQuery",
      fields: {
        title: {
          fieldType: { type: "string" },
          optional: false,
        },
        description: {
          fieldType: { type: "string" },
          optional: true,
        },
        servings: {
          fieldType: { type: "number" },
          optional: false,
        },
        difficulty: {
          fieldType: {
            type: "union",
            value: [
              { type: "literal", value: "easy" },
              { type: "literal", value: "medium" },
              { type: "literal", value: "hard" },
            ],
          },
          optional: false,
        },
        published: {
          fieldType: { type: "boolean" },
          optional: false,
        },
        tags: {
          fieldType: {
            type: "array",
            value: { type: "string" },
          },
          optional: false,
        },
        ingredients: {
          fieldType: {
            type: "array",
            value: {
              type: "object",
              value: {
                name: {
                  fieldType: { type: "string" },
                  optional: false,
                },
                amount: {
                  fieldType: { type: "number" },
                  optional: false,
                },
                unit: {
                  fieldType: { type: "string" },
                  optional: false,
                },
                note: {
                  fieldType: { type: "string" },
                  optional: true,
                },
              },
            },
          },
          optional: false,
        },
        steps: {
          fieldType: {
            type: "array",
            value: {
              type: "object",
              value: {
                position: {
                  fieldType: { type: "number" },
                  optional: false,
                },
                instruction: {
                  fieldType: { type: "string" },
                  optional: false,
                },
                durationMinutes: {
                  fieldType: { type: "number" },
                  optional: true,
                },
              },
            },
          },
          optional: false,
        },
        nutrition: {
          fieldType: {
            type: "object",
            value: {
              caloriesPerServing: {
                fieldType: { type: "number" },
                optional: false,
              },
              vegetarian: {
                fieldType: { type: "boolean" },
                optional: false,
              },
            },
          },
          optional: false,
        },
        localizedTitles: {
          fieldType: {
            type: "record",
            keys: { type: "string" },
            values: { type: "string" },
          },
          optional: false,
        },
        source: {
          fieldType: {
            type: "union",
            value: [{ type: "string" }, { type: "null" }],
          },
          optional: false,
        },
      },
    }),
  },
  setup: prepareCookingStateV1,
  workload: runCookingWorkloadV1,
  expectedRuntimeExecutions: {
    mutations: 1,
    queries: 2,
  },
});
