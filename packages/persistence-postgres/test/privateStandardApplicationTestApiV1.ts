import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect } from "effect";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";

import type {
  InvokeStandardApplicationPointMutationV1Error,
  InvokeStandardApplicationPointQueryV1Error,
} from "../../standard-application-invocation/src/v1";
import { makePrivateStandardCookingDefinitionV1 } from
  "./privateStandardApplicationTestDefinitionsV1";
import {
  type PrivateStandardApplicationTestClientV1,
  type PrivateStandardApplicationTestDefinitionV1,
  type PrivateStandardApplicationTestSetupClientV1,
  runPrivateStandardApplicationTestV1,
  type RunPrivateStandardApplicationTestV1Error,
} from "./privateStandardApplicationTestHarnessV1";
import type {
  PrivateStandardApplicationAuthoritativeInspectionV1,
  PrivateStandardApplicationTestInspectionV1Error,
} from "./privateStandardApplicationTestInspectionV1";
import type { Fsv06StandardPointMutationLaneV1 } from
  "./fsv06StandardPointMutationHarness";

export { PrivateStandardApplicationTestIntegrationV1Error } from
  "./privateStandardApplicationTestHarnessV1";

const COOKING_DEFINITION = {
  applicationId: "cooking",
  revisionName: "sac01-cooking-app",
  makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
} satisfies PrivateStandardApplicationTestDefinitionV1;

export interface PrivateStandardCookingApplicationProofV1 {
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
    PrivateStandardApplicationAuthoritativeInspectionV1;
  readonly workloadInspection:
    PrivateStandardApplicationAuthoritativeInspectionV1;
  readonly finalInspection: PrivateStandardApplicationAuthoritativeInspectionV1;
  readonly mutationRuntimeExecutions: 1;
  readonly queryRuntimeExecutions: 2;
  readonly postgresVersion: string | null;
}

interface CookingWorkloadProofV1 {
  readonly documentId: string;
  readonly mutationReplay: true;
  readonly queryReplay: true;
  readonly workloadInspection:
    PrivateStandardApplicationAuthoritativeInspectionV1;
}

interface CookingSetupProofV1 {
  readonly documentId: string;
  readonly commitSeq: bigint;
}

type CookingWorkloadErrorV1 =
  | InvokeStandardApplicationPointMutationV1Error
  | InvokeStandardApplicationPointQueryV1Error
  | PrivateStandardApplicationTestInspectionV1Error;

export type PrivateStandardCookingApplicationErrorV1 =
  RunPrivateStandardApplicationTestV1Error<CookingWorkloadErrorV1>;

export type RunPrivateStandardCookingApplicationV1 = (
  lane: Fsv06StandardPointMutationLaneV1,
) => Effect.Effect<
  PrivateStandardCookingApplicationProofV1,
  PrivateStandardCookingApplicationErrorV1
>;

export const runPrivateStandardCookingApplicationV1:
  RunPrivateStandardCookingApplicationV1 = Effect.fn(
  "PrivateStandardApplicationTest.runCookingApplicationV1",
)(function* (
  lane: Fsv06StandardPointMutationLaneV1,
): Effect.fn.Return<
  PrivateStandardCookingApplicationProofV1,
  PrivateStandardCookingApplicationErrorV1
> {
  const receipt = yield* runPrivateStandardApplicationTestV1({
    lane,
    definition: COOKING_DEFINITION,
    prepareState: prepareCookingStateV1,
    runWorkload: runCookingWorkloadV1,
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
  "PrivateStandardApplicationTest.prepareCookingStateV1",
)(function* (
  client: PrivateStandardApplicationTestSetupClientV1,
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
  "PrivateStandardApplicationTest.runCookingWorkloadV1",
)(function* (
  client: PrivateStandardApplicationTestClientV1,
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
