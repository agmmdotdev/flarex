import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect } from "effect";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";

import type {
  InvokeStandardApplicationPointMutationV1Error,
  InvokeStandardApplicationPointQueryV1Error,
} from "@flarex/standard-application-invocation/v1";
import {
  type StandardApplicationSystemTestClientV1,
  type StandardApplicationSystemTestDefinitionV1,
  type StandardApplicationSystemTestLaneV1,
  type StandardApplicationSystemTestSetupClientV1,
  runStandardApplicationSystemTestV1,
  type RunStandardApplicationSystemTestV1Error,
  StandardApplicationSystemTestIntegrationV1Error,
} from "@flarex/system-test/environment/v1";
import type {
  StandardApplicationAuthoritativeInspectionV1,
  StandardApplicationSystemTestInspectionV1Error,
} from "@flarex/system-test/inspection/v1";
import type {
  StandardApplicationSystemTestScenarioV1,
} from "@flarex/system-test/scenario/v1";
import { makeCreateAndReadDefinitionV1 } from
  "../support/createAndReadDefinitionV1";

export { StandardApplicationSystemTestIntegrationV1Error };

const COOKING_DEFINITION = {
  applicationId: "cooking",
  revisionName: "sac01-cooking-app",
  makeDefinitionInput: () => makeCreateAndReadDefinitionV1({
    tableName: "recipes",
    mutationModulePath: "recipeCommands",
    queryModulePath: "recipes",
    mutationArtifactPath: "recipeMutation",
    queryArtifactPath: "recipeQuery",
    fields: {
      title: { type: "string" },
      servings: { type: "number" },
    },
  }),
} satisfies StandardApplicationSystemTestDefinitionV1;

export interface CookingScenarioProofV1 {
  readonly version: 1;
  readonly scenario: "cooking-recipe-create-and-read-v1";
  readonly lane: "pglite" | "postgres";
  readonly definitionAnalyzedRegisteredReadyActivated: true;
  readonly mutationPath: "recipeCommands:create";
  readonly queryPath: "recipes:get";
  readonly documentId: string;
  readonly title: "Tomato soup";
  readonly servings: 4;
  readonly mutationReplay: true;
  readonly queryReplay: true;
  readonly controlledSetup: true;
  readonly afterSetupInspection:
    StandardApplicationAuthoritativeInspectionV1;
  readonly workloadInspection:
    StandardApplicationAuthoritativeInspectionV1;
  readonly finalInspection: StandardApplicationAuthoritativeInspectionV1;
  readonly mutationRuntimeExecutions: 1;
  readonly queryRuntimeExecutions: 2;
  readonly postgresVersion: string | null;
}

interface CookingWorkloadProofV1 {
  readonly documentId: string;
  readonly mutationReplay: true;
  readonly queryReplay: true;
  readonly workloadInspection:
    StandardApplicationAuthoritativeInspectionV1;
}

interface CookingSetupProofV1 {
  readonly documentId: string;
  readonly commitSeq: bigint;
}

type CookingWorkloadErrorV1 =
  | InvokeStandardApplicationPointMutationV1Error
  | InvokeStandardApplicationPointQueryV1Error
  | StandardApplicationSystemTestInspectionV1Error;

export type CookingScenarioErrorV1 =
  RunStandardApplicationSystemTestV1Error<CookingWorkloadErrorV1>;

export type RunCookingScenarioV1 = (
  lane: StandardApplicationSystemTestLaneV1,
) => Effect.Effect<
  CookingScenarioProofV1,
  CookingScenarioErrorV1
>;

export const runCookingScenarioV1: RunCookingScenarioV1 = Effect.fn(
  "SystemTestCookingScenario.runV1",
)(function* (
  lane: StandardApplicationSystemTestLaneV1,
): Effect.fn.Return<
  CookingScenarioProofV1,
  CookingScenarioErrorV1
> {
  const receipt = yield* runStandardApplicationSystemTestV1({
    lane,
    scenario: {
      version: 1,
      scenarioId: "cooking-recipe-create-and-read-v1",
      definition: COOKING_DEFINITION,
      prepareState: prepareCookingStateV1,
      runWorkload: runCookingWorkloadV1,
    } satisfies StandardApplicationSystemTestScenarioV1<
      CookingSetupProofV1,
      CookingWorkloadProofV1,
      CookingWorkloadErrorV1
    >,
  });
  if (
    receipt.mutationRuntimeExecutions !== 1 ||
    receipt.queryRuntimeExecutions !== 2
  ) {
    return yield* Effect.die(new Error(
      "The cooking workload observed unexpected runtime execution counts.",
    ));
  }
  return {
    version: 1,
    scenario: "cooking-recipe-create-and-read-v1",
    lane: receipt.lane,
    definitionAnalyzedRegisteredReadyActivated:
      receipt.definitionAnalyzedRegisteredReadyActivated,
    mutationPath: "recipeCommands:create",
    queryPath: "recipes:get",
    documentId: receipt.workloadProof.documentId,
    title: "Tomato soup",
    servings: 4,
    mutationReplay: receipt.workloadProof.mutationReplay,
    queryReplay: receipt.workloadProof.queryReplay,
    controlledSetup: true,
    afterSetupInspection: receipt.afterSetupInspection,
    workloadInspection: receipt.workloadProof.workloadInspection,
    finalInspection: receipt.finalInspection,
    mutationRuntimeExecutions: 1,
    queryRuntimeExecutions: 2,
    postgresVersion: receipt.postgresVersion,
  };
});

const COOKING_MUTATION_PATH = TransactionFunctionPathV1Schema.make(
  "recipeCommands:create",
);
const COOKING_QUERY_PATH = TransactionFunctionPathV1Schema.make("recipes:get");
const COOKING_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:create",
);
const COOKING_RECIPE = { title: "Tomato soup", servings: 4 } as const;

const prepareCookingStateV1 = Effect.fn(
  "SystemTestCookingScenario.prepareStateV1",
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
  "SystemTestCookingScenario.runWorkloadV1",
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
  const workloadInspection = yield* client.inspectAuthoritativeState();
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
    mutationReplay: true,
    queryReplay: true,
    workloadInspection,
  };
});

function requireRecipeDocument(value: unknown, documentId: string): void {
  if (
    !isNonArrayRecord(value) ||
    value._id !== documentId ||
    typeof value._creationTime !== "number" ||
    !Number.isFinite(value._creationTime) ||
    value.title !== "Tomato soup" ||
    value.servings !== 4
  ) {
    throw new Error(
      "The cooking workload did not read the authoritative recipe document.",
    );
  }
}
