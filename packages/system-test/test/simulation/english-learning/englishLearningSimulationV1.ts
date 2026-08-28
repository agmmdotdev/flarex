import { readFileSync } from "node:fs";

import { isNonArrayRecord } from "@flarex/utils/records";
import {
  defineApplication,
  defineModule,
  defineSchema,
  defineTable,
  mutation,
  query,
  sourceModule,
  v,
} from "@flarex/application-definition";
import { Effect } from "effect";
import {
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";

import type {
  RunMutationError,
  RunQueryError,
  SimulationClient,
  SimulationSetupClient,
} from "@flarex/system-test/environment";
import {
  defineSimulation,
} from "@flarex/system-test/simulation";

export interface EnglishLearningWorkloadProofV1 {
  readonly documentId: string;
  readonly mutationReplay: true;
  readonly queryReplay: true;
}

export interface EnglishLearningSetupProofV1 {
  readonly documentId: string;
  readonly commitSeq: bigint;
}

type EnglishLearningWorkloadErrorV1 = RunMutationError | RunQueryError;

const ENGLISH_LEARNING_FIELDS = {
  term: v.string(),
  translation: v.string(),
  mastery: v.number(),
} as const;
const ENGLISH_LEARNING_DOCUMENT = v.object({
  _id: v.id("lessons"),
  _creationTime: v.number(),
  ...ENGLISH_LEARNING_FIELDS,
});
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
const ENGLISH_LEARNING_MUTATION_MODULE = defineModule({
  path: "lessonCommands",
  source: sourceModule({
    path: "lessonMutation",
    bytes: ENGLISH_LEARNING_FUNCTION_SOURCES.create,
  }),
  functions: {
    create: mutation({
      args: v.object(ENGLISH_LEARNING_FIELDS),
      returns: v.id("lessons"),
    }),
  },
});
const ENGLISH_LEARNING_QUERY_MODULE = defineModule({
  path: "lessons",
  source: sourceModule({
    path: "lessonQuery",
    bytes: ENGLISH_LEARNING_FUNCTION_SOURCES.get,
  }),
  functions: {
    get: query({
      args: v.object({ id: v.string() }),
      returns: v.nullable(ENGLISH_LEARNING_DOCUMENT),
    }),
  },
});
const ENGLISH_LEARNING_CREATE =
  ENGLISH_LEARNING_MUTATION_MODULE.reference("create");
const ENGLISH_LEARNING_GET = ENGLISH_LEARNING_QUERY_MODULE.reference("get");
const ENGLISH_LEARNING_LESSON = {
  term: "apple",
  translation: "a fruit",
  mastery: 0,
} as const;

const prepareEnglishLearningStateV1 = Effect.fn(
  "SystemTestEnglishLearningSimulation.setupV1",
)(function* (
  client: SimulationSetupClient,
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
  client: SimulationClient,
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
  defineSimulation({
    simulationId: "english-learning-lesson-create-and-read-v1",
    application: {
      applicationId: "english-learning",
      revisionName: "sac01-english-learning-app",
      define: () => defineApplication({
        schema: defineSchema({
          lessons: defineTable(ENGLISH_LEARNING_FIELDS),
        }),
        modules: [
          ENGLISH_LEARNING_MUTATION_MODULE,
          ENGLISH_LEARNING_QUERY_MODULE,
        ],
      }),
    },
    setup: prepareEnglishLearningStateV1,
    workload: runEnglishLearningWorkloadV1,
    expectedRuntimeExecutions: {
      mutations: 1,
      queries: 2,
    },
  });
