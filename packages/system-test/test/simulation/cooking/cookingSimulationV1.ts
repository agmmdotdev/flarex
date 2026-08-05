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

const COOKING_MUTATION_PATH = TransactionFunctionPathV1Schema.make(
  "recipeCommands:create",
);
const COOKING_QUERY_PATH = TransactionFunctionPathV1Schema.make("recipes:get");
const COOKING_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:cooking:create",
);
const COOKING_RECIPE = { title: "Tomato soup", servings: 4 } as const;

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

export const cookingSimulationV1 = defineStandardApplicationSimulationV1({
  version: 1,
  simulationId: "cooking-recipe-create-and-read-v1",
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
        title: { type: "string" },
        servings: { type: "number" },
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
