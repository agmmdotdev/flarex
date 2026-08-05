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
} from "@flarex/system-test/environment/v1";
import type {
  StandardApplicationAuthoritativeInspectionV1,
} from "@flarex/system-test/inspection/v1";
import type {
  StandardApplicationSystemTestScenarioV1,
} from "@flarex/system-test/scenario/v1";
import { makeCreateAndReadDefinitionV1 } from
  "../support/createAndReadDefinitionV1";

const ENGLISH_LEARNING_DEFINITION = {
  applicationId: "english-learning",
  revisionName: "sac01-english-learning-app",
  makeDefinitionInput: () => makeCreateAndReadDefinitionV1({
    tableName: "lessons",
    mutationModulePath: "lessonCommands",
    queryModulePath: "lessons",
    mutationArtifactPath: "lessonMutation",
    queryArtifactPath: "lessonQuery",
    fields: {
      term: { type: "string" },
      translation: { type: "string" },
      mastery: { type: "number" },
    },
  }),
} satisfies StandardApplicationSystemTestDefinitionV1;

export interface EnglishLearningScenarioProofV1 {
  readonly version: 1;
  readonly scenario: "english-learning-lesson-create-and-read-v1";
  readonly lane: "pglite" | "postgres";
  readonly definitionAnalyzedRegisteredReadyActivated: true;
  readonly mutationPath: "lessonCommands:create";
  readonly queryPath: "lessons:get";
  readonly documentId: string;
  readonly term: "apple";
  readonly translation: "a fruit";
  readonly mastery: 0;
  readonly mutationReplay: true;
  readonly queryReplay: true;
  readonly controlledSetup: true;
  readonly afterSetupInspection:
    StandardApplicationAuthoritativeInspectionV1;
  readonly finalInspection: StandardApplicationAuthoritativeInspectionV1;
  readonly mutationRuntimeExecutions: 1;
  readonly queryRuntimeExecutions: 2;
  readonly postgresVersion: string | null;
}

interface EnglishLearningWorkloadProofV1 {
  readonly documentId: string;
  readonly mutationReplay: true;
  readonly queryReplay: true;
}

interface EnglishLearningSetupProofV1 {
  readonly documentId: string;
  readonly commitSeq: bigint;
}

type EnglishLearningWorkloadErrorV1 =
  | InvokeStandardApplicationPointMutationV1Error
  | InvokeStandardApplicationPointQueryV1Error;

export type EnglishLearningScenarioErrorV1 =
  RunStandardApplicationSystemTestV1Error<EnglishLearningWorkloadErrorV1>;

export const runEnglishLearningScenarioV1 = Effect.fn(
  "SystemTestEnglishLearningScenario.runV1",
)(function* (
  lane: StandardApplicationSystemTestLaneV1,
): Effect.fn.Return<
  EnglishLearningScenarioProofV1,
  EnglishLearningScenarioErrorV1
> {
  const receipt = yield* runStandardApplicationSystemTestV1({
    lane,
    scenario: {
      version: 1,
      scenarioId: "english-learning-lesson-create-and-read-v1",
      definition: ENGLISH_LEARNING_DEFINITION,
      prepareState: prepareEnglishLearningStateV1,
      runWorkload: runEnglishLearningWorkloadV1,
    } satisfies StandardApplicationSystemTestScenarioV1<
      EnglishLearningSetupProofV1,
      EnglishLearningWorkloadProofV1,
      EnglishLearningWorkloadErrorV1
    >,
  });
  if (
    receipt.mutationRuntimeExecutions !== 1 ||
    receipt.queryRuntimeExecutions !== 2
  ) {
    return yield* Effect.die(new Error(
      "The English-learning workload observed unexpected runtime execution counts.",
    ));
  }
  return {
    version: 1,
    scenario: "english-learning-lesson-create-and-read-v1",
    lane: receipt.lane,
    definitionAnalyzedRegisteredReadyActivated:
      receipt.definitionAnalyzedRegisteredReadyActivated,
    mutationPath: "lessonCommands:create",
    queryPath: "lessons:get",
    documentId: receipt.workloadProof.documentId,
    term: "apple",
    translation: "a fruit",
    mastery: 0,
    mutationReplay: receipt.workloadProof.mutationReplay,
    queryReplay: receipt.workloadProof.queryReplay,
    controlledSetup: true,
    afterSetupInspection: receipt.afterSetupInspection,
    finalInspection: receipt.finalInspection,
    mutationRuntimeExecutions: 1,
    queryRuntimeExecutions: 2,
    postgresVersion: receipt.postgresVersion,
  };
});

const ENGLISH_LEARNING_MUTATION_PATH = TransactionFunctionPathV1Schema.make(
  "lessonCommands:create",
);
const ENGLISH_LEARNING_QUERY_PATH = TransactionFunctionPathV1Schema.make(
  "lessons:get",
);
const ENGLISH_LEARNING_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:english-learning:create",
);
const ENGLISH_LEARNING_LESSON = {
  term: "apple",
  translation: "a fruit",
  mastery: 0,
} as const;

const prepareEnglishLearningStateV1 = Effect.fn(
  "SystemTestEnglishLearningScenario.prepareStateV1",
)(function* (
  client: StandardApplicationSystemTestSetupClientV1,
): Effect.fn.Return<EnglishLearningSetupProofV1, EnglishLearningWorkloadErrorV1> {
  const inserted = yield* client.invokeMutation(
    ENGLISH_LEARNING_MUTATION_PATH,
    ENGLISH_LEARNING_LESSON,
    ENGLISH_LEARNING_REQUEST_KEY,
  );
  if (
    inserted.status !== "committed" ||
    inserted.disposition !== "published" ||
    typeof inserted.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The English-learning setup did not publish an authoritative lesson id.",
    ));
  }
  return { documentId: inserted.value, commitSeq: inserted.commitSeq };
});

const runEnglishLearningWorkloadV1 = Effect.fn(
  "SystemTestEnglishLearningScenario.runWorkloadV1",
)(function* (
  client: StandardApplicationSystemTestClientV1,
  setup: EnglishLearningSetupProofV1,
): Effect.fn.Return<
  EnglishLearningWorkloadProofV1,
  EnglishLearningWorkloadErrorV1
> {
  const replayedMutation = yield* client.invokeMutation(
    ENGLISH_LEARNING_MUTATION_PATH,
    ENGLISH_LEARNING_LESSON,
    ENGLISH_LEARNING_REQUEST_KEY,
  );
  if (
    replayedMutation.disposition !== "replayed" ||
    replayedMutation.commitSeq !== setup.commitSeq ||
    replayedMutation.value !== setup.documentId
  ) {
    return yield* Effect.die(new Error(
      "The English-learning workload did not replay its mutation.",
    ));
  }

  const firstRead = yield* client.invokeQuery(
    ENGLISH_LEARNING_QUERY_PATH,
    { id: setup.documentId },
  );
  requireLessonDocument(firstRead, setup.documentId);
  const replayedRead = yield* client.invokeQuery(
    ENGLISH_LEARNING_QUERY_PATH,
    { id: setup.documentId },
  );
  requireLessonDocument(replayedRead, setup.documentId);
  if (JSON.stringify(firstRead) !== JSON.stringify(replayedRead)) {
    return yield* Effect.die(new Error(
      "The English-learning workload did not replay its point query.",
    ));
  }
  return {
    documentId: setup.documentId,
    mutationReplay: true,
    queryReplay: true,
  };
});

function requireLessonDocument(value: unknown, documentId: string): void {
  if (
    !isNonArrayRecord(value) ||
    value._id !== documentId ||
    typeof value._creationTime !== "number" ||
    !Number.isFinite(value._creationTime) ||
    value.term !== "apple" ||
    value.translation !== "a fruit" ||
    value.mastery !== 0
  ) {
    throw new Error(
      "The English-learning workload did not read its authoritative lesson.",
    );
  }
}
