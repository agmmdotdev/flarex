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
import type { Fsv06StandardPointMutationLaneV1 } from
  "./fsv06StandardPointMutationHarness";
import { makePrivateStandardEnglishLearningDefinitionV1 } from
  "./privateStandardApplicationTestDefinitionsV1";
import {
  type PrivateStandardApplicationTestClientV1,
  type PrivateStandardApplicationTestDefinitionV1,
  runPrivateStandardApplicationTestV1,
  type RunPrivateStandardApplicationTestV1Error,
} from "./privateStandardApplicationTestHarnessV1";

const ENGLISH_LEARNING_DEFINITION = {
  applicationId: "english-learning",
  revisionName: "sac01-english-learning-app",
  makeDefinitionInput: makePrivateStandardEnglishLearningDefinitionV1,
} satisfies PrivateStandardApplicationTestDefinitionV1;

export interface PrivateStandardEnglishLearningApplicationProofV1 {
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
  readonly mutationRuntimeExecutions: 1;
  readonly queryRuntimeExecutions: 2;
  readonly postgresVersion: string | null;
}

interface EnglishLearningWorkloadProofV1 {
  readonly documentId: string;
  readonly mutationReplay: true;
  readonly queryReplay: true;
}

type EnglishLearningWorkloadErrorV1 =
  | InvokeStandardApplicationPointMutationV1Error
  | InvokeStandardApplicationPointQueryV1Error;

export type PrivateStandardEnglishLearningApplicationErrorV1 =
  RunPrivateStandardApplicationTestV1Error<EnglishLearningWorkloadErrorV1>;

export const runPrivateStandardEnglishLearningApplicationV1 = Effect.fn(
  "PrivateStandardApplicationTest.runEnglishLearningApplicationV1",
)(function* (
  lane: Fsv06StandardPointMutationLaneV1,
): Effect.fn.Return<
  PrivateStandardEnglishLearningApplicationProofV1,
  PrivateStandardEnglishLearningApplicationErrorV1
> {
  const receipt = yield* runPrivateStandardApplicationTestV1({
    lane,
    definition: ENGLISH_LEARNING_DEFINITION,
    runWorkload: runEnglishLearningWorkloadV1,
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
    mutationRuntimeExecutions: 1,
    queryRuntimeExecutions: 2,
    postgresVersion: receipt.postgresVersion,
  };
});

const runEnglishLearningWorkloadV1 = Effect.fn(
  "PrivateStandardApplicationTest.runEnglishLearningWorkloadV1",
)(function* (
  client: PrivateStandardApplicationTestClientV1,
): Effect.fn.Return<
  EnglishLearningWorkloadProofV1,
  EnglishLearningWorkloadErrorV1
> {
  const mutationPath = TransactionFunctionPathV1Schema.make(
    "lessonCommands:create",
  );
  const queryPath = TransactionFunctionPathV1Schema.make("lessons:get");
  const requestKey = TransactionRequestKeyV1Schema.make(
    "sac01:english-learning:create",
  );
  const lesson = {
    term: "apple",
    translation: "a fruit",
    mastery: 0,
  } as const;
  const inserted = yield* client.invokeMutation(
    mutationPath,
    lesson,
    requestKey,
  );
  if (
    inserted.status !== "committed" ||
    inserted.disposition !== "published" ||
    typeof inserted.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The English-learning workload did not publish an authoritative lesson id.",
    ));
  }
  const documentId = inserted.value;
  const replayedMutation = yield* client.invokeMutation(
    mutationPath,
    lesson,
    requestKey,
  );
  if (
    replayedMutation.disposition !== "replayed" ||
    replayedMutation.commitSeq !== inserted.commitSeq ||
    replayedMutation.value !== documentId
  ) {
    return yield* Effect.die(new Error(
      "The English-learning workload did not replay its mutation.",
    ));
  }

  const firstRead = yield* client.invokeQuery(queryPath, { id: documentId });
  requireLessonDocument(firstRead, documentId);
  const replayedRead = yield* client.invokeQuery(queryPath, { id: documentId });
  requireLessonDocument(replayedRead, documentId);
  if (JSON.stringify(firstRead) !== JSON.stringify(replayedRead)) {
    return yield* Effect.die(new Error(
      "The English-learning workload did not replay its point query.",
    ));
  }
  return { documentId, mutationReplay: true, queryReplay: true };
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
