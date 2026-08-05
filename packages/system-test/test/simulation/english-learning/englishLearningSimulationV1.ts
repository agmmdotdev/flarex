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
import {
  defineStandardApplicationSimulationV1,
} from "@flarex/system-test/simulation/v1";
import { makeCreateAndReadDefinitionV1 } from
  "../support/createAndReadDefinitionV1";

export interface EnglishLearningWorkloadProofV1 {
  readonly documentId: string;
  readonly mutationReplay: true;
  readonly queryReplay: true;
}

export interface EnglishLearningSetupProofV1 {
  readonly documentId: string;
  readonly commitSeq: bigint;
}

type EnglishLearningWorkloadErrorV1 =
  | InvokeStandardApplicationPointMutationV1Error
  | InvokeStandardApplicationPointQueryV1Error;

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
  "SystemTestEnglishLearningSimulation.setupV1",
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
  "SystemTestEnglishLearningSimulation.workloadV1",
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

export const englishLearningSimulationV1 =
  defineStandardApplicationSimulationV1({
    version: 1,
    simulationId: "english-learning-lesson-create-and-read-v1",
    application: {
      applicationId: "english-learning",
      revisionName: "sac01-english-learning-app",
      define: () => makeCreateAndReadDefinitionV1({
        tableName: "lessons",
        mutationModulePath: "lessonCommands",
        queryModulePath: "lessons",
        mutationArtifactPath: "lessonMutation",
        queryArtifactPath: "lessonQuery",
        fields: {
          term: {
            fieldType: { type: "string" },
            optional: false,
          },
          translation: {
            fieldType: { type: "string" },
            optional: false,
          },
          mastery: {
            fieldType: { type: "number" },
            optional: false,
          },
        },
      }),
    },
    setup: prepareEnglishLearningStateV1,
    workload: runEnglishLearningWorkloadV1,
    expectedRuntimeExecutions: {
      mutations: 1,
      queries: 2,
    },
  });
