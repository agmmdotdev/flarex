import { readFileSync } from "node:fs";

import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect } from "effect";
import {
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";

import { standardV1 } from
  "@flarex/standard-application-definition/v1";

import type {
  InvokeStandardApplicationPointMutationV1Error,
} from "@flarex/standard-application-invocation/v1";
import type {
  StandardApplicationSystemTestClientV1,
  StandardApplicationSystemTestSetupClientV1,
  StandardApplicationLegacySimulationQueryErrorV1,
  StandardApplicationTypedReferenceV1Error,
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
  | StandardApplicationLegacySimulationQueryErrorV1
  | StandardApplicationTypedReferenceV1Error;

const ENGLISH_LEARNING_FIELDS = {
  term: standardV1.string(),
  translation: standardV1.string(),
  mastery: standardV1.number(),
} as const;
const ENGLISH_LEARNING_DOCUMENT = standardV1.object({
  _id: standardV1.id("lessons"),
  _creationTime: standardV1.number(),
  ...ENGLISH_LEARNING_FIELDS,
});
const ENGLISH_LEARNING_MUTATION_MODULE = standardV1.module(
  "lessonCommands",
  {
    create: standardV1.publicMutation({
      args: standardV1.object(ENGLISH_LEARNING_FIELDS),
      returns: standardV1.id("lessons"),
    }),
  },
);
const ENGLISH_LEARNING_QUERY_MODULE = standardV1.module("lessons", {
  get: standardV1.publicQuery({
    args: standardV1.object({ id: standardV1.string() }),
    returns: standardV1.nullable(ENGLISH_LEARNING_DOCUMENT),
  }),
});
const ENGLISH_LEARNING_CREATE =
  ENGLISH_LEARNING_MUTATION_MODULE.reference("create");
const ENGLISH_LEARNING_GET = ENGLISH_LEARNING_QUERY_MODULE.reference("get");
const ENGLISH_LEARNING_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "sac01:english-learning:create",
);
const ENGLISH_LEARNING_FUNCTION_SOURCES = {
  create: readFileSync(new URL(
    "./functions/lessonCreate.js",
    import.meta.url,
  )),
  get: readFileSync(new URL(
    "./functions/lessonsQuery.js",
    import.meta.url,
  )),
} as const;
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
  const inserted = yield* client.mutation(
    ENGLISH_LEARNING_CREATE,
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
  const replayedMutation = yield* client.mutation(
    ENGLISH_LEARNING_CREATE,
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

  const firstRead = yield* client.query(
    ENGLISH_LEARNING_GET,
    { id: setup.documentId },
  );
  requireLessonDocument(firstRead, setup.documentId);
  const replayedRead = yield* client.query(
    ENGLISH_LEARNING_GET,
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
        mutationModule: ENGLISH_LEARNING_MUTATION_MODULE,
        queryModule: ENGLISH_LEARNING_QUERY_MODULE,
        mutationArtifactPath: "lessonMutation",
        queryArtifactPath: "lessonQuery",
        mutationSourceBytes: ENGLISH_LEARNING_FUNCTION_SOURCES.create,
        querySourceBytes: ENGLISH_LEARNING_FUNCTION_SOURCES.get,
        fields: ENGLISH_LEARNING_FIELDS,
      }),
    },
    setup: prepareEnglishLearningStateV1,
    workload: runEnglishLearningWorkloadV1,
    expectedRuntimeExecutions: {
      mutations: 1,
      queries: 2,
    },
  });
