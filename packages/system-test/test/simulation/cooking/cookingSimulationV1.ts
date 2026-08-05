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
  readonly patchReplay: true;
  readonly replaceReplay: true;
  readonly deleteReplay: true;
  readonly pointMutationLifecycle: true;
  readonly deletedDocumentReadsNull: true;
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
const COOKING_PATCH_PATH = TransactionFunctionPathV1Schema.make(
  "recipePatch:patch",
);
const COOKING_REPLACE_PATH = TransactionFunctionPathV1Schema.make(
  "recipeReplace:replace",
);
const COOKING_DELETE_PATH = TransactionFunctionPathV1Schema.make(
  "recipeDelete:remove",
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
const COOKING_PATCH_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:patch",
);
const COOKING_REPLACE_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:replace",
);
const COOKING_DELETE_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:delete",
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
  requireRecipeDocument(firstRead, setup.documentId, COOKING_RECIPE);

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
  const afterInvalidInputInspection = yield* client.inspectAuthoritativeState();
  requireNoRejectedMutationSideEffects(
    beforeInvalidInputInspection,
    afterInvalidInputInspection,
  );

  const replayedRead = yield* client.invokeQuery(
    COOKING_QUERY_PATH,
    { id: setup.documentId },
  );
  requireRecipeDocument(replayedRead, setup.documentId, COOKING_RECIPE);
  if (JSON.stringify(firstRead) !== JSON.stringify(replayedRead)) {
    return yield* Effect.die(new Error(
      "The cooking workload did not deterministically replay its point query.",
    ));
  }

  const patched = yield* client.invokeMutation(
    COOKING_PATCH_PATH,
    { id: setup.documentId, patch: COOKING_PATCH },
    COOKING_PATCH_REQUEST_KEY,
  );
  requireLifecycleMutation(
    patched,
    "patch",
    "published",
    setup.commitSeq + 1n,
  );
  const replayedPatch = yield* client.invokeMutation(
    COOKING_PATCH_PATH,
    { id: setup.documentId, patch: COOKING_PATCH },
    COOKING_PATCH_REQUEST_KEY,
  );
  requireLifecycleMutation(
    replayedPatch,
    "patch replay",
    "replayed",
    patched.commitSeq,
  );
  const patchedRead = yield* client.invokeQuery(
    COOKING_QUERY_PATH,
    { id: setup.documentId },
  );
  requireRecipeDocument(
    patchedRead,
    setup.documentId,
    COOKING_RECIPE_AFTER_PATCH,
  );

  const replaced = yield* client.invokeMutation(
    COOKING_REPLACE_PATH,
    { id: setup.documentId, fields: COOKING_REPLACEMENT_RECIPE },
    COOKING_REPLACE_REQUEST_KEY,
  );
  requireLifecycleMutation(
    replaced,
    "replace",
    "published",
    setup.commitSeq + 2n,
  );
  const replayedReplace = yield* client.invokeMutation(
    COOKING_REPLACE_PATH,
    { id: setup.documentId, fields: COOKING_REPLACEMENT_RECIPE },
    COOKING_REPLACE_REQUEST_KEY,
  );
  requireLifecycleMutation(
    replayedReplace,
    "replace replay",
    "replayed",
    replaced.commitSeq,
  );
  const replacedRead = yield* client.invokeQuery(
    COOKING_QUERY_PATH,
    { id: setup.documentId },
  );
  requireRecipeDocument(
    replacedRead,
    setup.documentId,
    COOKING_REPLACEMENT_RECIPE,
  );

  const deleted = yield* client.invokeMutation(
    COOKING_DELETE_PATH,
    { id: setup.documentId },
    COOKING_DELETE_REQUEST_KEY,
  );
  requireLifecycleMutation(
    deleted,
    "delete",
    "published",
    setup.commitSeq + 3n,
  );
  const replayedDelete = yield* client.invokeMutation(
    COOKING_DELETE_PATH,
    { id: setup.documentId },
    COOKING_DELETE_REQUEST_KEY,
  );
  requireLifecycleMutation(
    replayedDelete,
    "delete replay",
    "replayed",
    deleted.commitSeq,
  );
  const deletedRead = yield* client.invokeQuery(
    COOKING_QUERY_PATH,
    { id: setup.documentId },
  );
  if (deletedRead !== null) {
    return yield* Effect.die(new Error(
      "The cooking workload read a deleted recipe instead of null.",
    ));
  }
  const workloadInspection = yield* client.inspectAuthoritativeState();
  return {
    documentId: setup.documentId,
    richDocumentRoundTrip: true,
    rejectedInvalidMutations: 2,
    invalidArgumentsRejectedBeforeRuntime: true,
    committedStateUnchangedAfterRejections: true,
    mutationReplay: true,
    queryReplay: true,
    patchReplay: true,
    replaceReplay: true,
    deleteReplay: true,
    pointMutationLifecycle: true,
    deletedDocumentReadsNull: true,
    workloadInspection,
  };
});

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
    define: () => makeCreateAndReadDefinitionV1({
      tableName: "recipes",
      mutationModulePath: "recipeCommands",
      queryModulePath: "recipes",
      mutationArtifactPath: "recipeMutation",
      queryArtifactPath: "recipeQuery",
      pointMutationLifecycle: {
        patchModulePath: "recipePatch",
        patchArtifactPath: "recipePatch",
        replaceModulePath: "recipeReplace",
        replaceArtifactPath: "recipeReplace",
        deleteModulePath: "recipeDelete",
        deleteArtifactPath: "recipeDelete",
      },
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
    mutations: 4,
    queries: 5,
  },
});
