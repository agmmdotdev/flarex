import {
  completeTaskRuntimeReadinessVerification,
  decodeTaskRuntimeReadinessBasisPreimageV1,
  MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1,
  prepareTaskRuntimeReadinessVerification,
  type CompleteTaskRuntimeReadinessVerificationError,
  type PrepareTaskRuntimeReadinessVerificationError,
  type PreparedTaskRuntimeReadinessBasisV1,
  type StandardApplicationTaskSha256V1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeReadinessObject,
  type TaskRuntimeReadinessBasisV1,
  type TaskRuntimeReadinessPreparationInput,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Data, Effect, Result } from "effect";

import type {
  TaskRuntimeObjectStore,
  TaskRuntimeObjectStoreError,
} from "../taskRuntimePublication/TaskRuntimeObjectStore.js";

export interface TaskRuntimeReadinessColdVerificationPolicy {
  readonly maximumObjectCount: number;
  readonly maximumObjectBytes: number;
  readonly maximumRetainedObjectBytes: number;
}

export class TaskRuntimeReadinessColdVerificationConfigurationError
  extends Data.TaggedError(
    "TaskRuntimeReadinessColdVerificationConfigurationError",
  )<{
    readonly field:
      | "maximumObjectCount"
      | "maximumObjectBytes"
      | "maximumRetainedObjectBytes";
    readonly reason: "invalidLimit" | "incompatibleLimits";
  }> {}

export class TaskRuntimeReadinessColdVerificationAdmissionError
  extends Data.TaggedError("TaskRuntimeReadinessColdVerificationAdmissionError")<{
    readonly reason:
      | "objectCountExceeded"
      | "objectBytesExceeded"
      | "retainedObjectBytesExceeded";
    readonly objectIndex?: number;
    readonly observed: bigint;
    readonly maximum: bigint;
  }> {}

export class TaskRuntimeReadinessColdVerificationProofError
  extends Data.TaggedError("TaskRuntimeReadinessColdVerificationProofError")<{
    readonly reason: "invalidProof";
  }> {}

export type TaskRuntimeReadinessColdVerificationError =
  | PrepareTaskRuntimeReadinessVerificationError
  | CompleteTaskRuntimeReadinessVerificationError
  | TaskRuntimeObjectStoreError
  | TaskRuntimeReadinessColdVerificationAdmissionError;

export interface TaskRuntimeReadinessColdVerificationProof {
  readonly kind: "task_runtime_readiness_cold_verification";
}

export interface CapturedTaskRuntimeReadinessColdVerification {
  readonly readBasis: () => TaskRuntimeReadinessBasisV1;
  readonly readCanonicalBytes: () => Uint8Array;
  readonly readSha256: () => TaskDefinitionSha256V1;
}

export interface TaskRuntimeReadinessColdVerificationAuthority {
  readonly verify: (
    input: TaskRuntimeReadinessPreparationInput,
  ) => Effect.Effect<
    TaskRuntimeReadinessColdVerificationProof,
    TaskRuntimeReadinessColdVerificationError
  >;
  readonly capture: (
    proof: unknown,
  ) => Result.Result<
    CapturedTaskRuntimeReadinessColdVerification,
    TaskRuntimeReadinessColdVerificationProofError
  >;
}

type CapturedPolicy = Readonly<{
  maximumObjectCount: number;
  maximumObjectBytes: number;
  maximumRetainedObjectBytes: number;
}>;

type ProofState = Readonly<{
  canonicalBytes: Uint8Array;
  sha256: TaskDefinitionSha256V1;
}>;

export function makeTaskRuntimeReadinessColdVerificationAuthority(
  store: Pick<TaskRuntimeObjectStore, "read">,
  sha256: StandardApplicationTaskSha256V1,
  policyInput: TaskRuntimeReadinessColdVerificationPolicy,
): Result.Result<
  TaskRuntimeReadinessColdVerificationAuthority,
  TaskRuntimeReadinessColdVerificationConfigurationError
> {
  return capturePolicy(policyInput).pipe(Result.map(policy => {
    const proofStates = new WeakMap<object, ProofState>();
    const storeOwner = store;
    const read = store.read;

    const verify: TaskRuntimeReadinessColdVerificationAuthority["verify"] =
      Effect.fn("TaskRuntimeReadinessColdVerificationAuthority.verify")(
        function* (input) {
          const prepared = yield* prepareTaskRuntimeReadinessVerification(
            input,
            sha256,
          );
          const references = prepared.readRuntimeObjectReferences();
          yield* admitReferences(references, policy);

          const runtimeObjects: Array<TaskRuntimeReadinessObject> = [];
          for (const reference of references) {
            const stored = yield* read.call(storeOwner, reference);
            runtimeObjects.push(Object.freeze({
              reference: stored.reference,
              canonicalBytes: stored.bytes,
            }));
          }

          const completed = yield* completeTaskRuntimeReadinessVerification({
            prepared,
            runtimeObjects: Object.freeze(runtimeObjects),
          });
          const state = captureCompleted(completed);
          const proof = Object.freeze({
            kind: "task_runtime_readiness_cold_verification" as const,
          });
          proofStates.set(proof, state);
          return proof;
        },
      );

    const capture: TaskRuntimeReadinessColdVerificationAuthority["capture"] =
      proof => {
        if (typeof proof !== "object" || proof === null) {
          return Result.fail(invalidProof());
        }
        const state = proofStates.get(proof);
        return state === undefined
          ? Result.fail(invalidProof())
          : Result.succeed(readableProofState(state));
      };

    return Object.freeze({ verify, capture });
  }));
}

function capturePolicy(
  input: unknown,
): Result.Result<
  CapturedPolicy,
  TaskRuntimeReadinessColdVerificationConfigurationError
> {
  let maximumObjectCount: unknown;
  let maximumObjectBytes: unknown;
  let maximumRetainedObjectBytes: unknown;
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return Result.fail(configurationError(
        "maximumObjectCount",
        "invalidLimit",
      ));
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    const expected = [
      "maximumObjectCount",
      "maximumObjectBytes",
      "maximumRetainedObjectBytes",
    ];
    if (
      keys.length !== expected.length ||
      keys.some(key => typeof key !== "string" || !expected.includes(key))
    ) return Result.fail(configurationError(
      "maximumObjectCount",
      "invalidLimit",
    ));
    const countDescriptor = descriptors.maximumObjectCount;
    const objectDescriptor = descriptors.maximumObjectBytes;
    const retainedDescriptor = descriptors.maximumRetainedObjectBytes;
    if (
      countDescriptor === undefined || !("value" in countDescriptor) ||
      countDescriptor.enumerable !== true ||
      objectDescriptor === undefined || !("value" in objectDescriptor) ||
      objectDescriptor.enumerable !== true ||
      retainedDescriptor === undefined || !("value" in retainedDescriptor)
      || retainedDescriptor.enumerable !== true
    ) return Result.fail(configurationError(
      "maximumObjectCount",
      "invalidLimit",
    ));
    maximumObjectCount = countDescriptor.value;
    maximumObjectBytes = objectDescriptor.value;
    maximumRetainedObjectBytes = retainedDescriptor.value;
  } catch {
    return Result.fail(configurationError(
      "maximumObjectCount",
      "invalidLimit",
    ));
  }

  if (!isPositiveSafeInteger(maximumObjectCount) ||
    maximumObjectCount > MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1) {
    return Result.fail(configurationError(
      "maximumObjectCount",
      "invalidLimit",
    ));
  }
  if (!isPositiveSafeInteger(maximumObjectBytes) ||
    maximumObjectBytes > MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1) {
    return Result.fail(configurationError(
      "maximumObjectBytes",
      "invalidLimit",
    ));
  }
  if (!isPositiveSafeInteger(maximumRetainedObjectBytes) ||
    maximumRetainedObjectBytes >
      MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1) {
    return Result.fail(configurationError(
      "maximumRetainedObjectBytes",
      "invalidLimit",
    ));
  }
  if (maximumObjectBytes > maximumRetainedObjectBytes) {
    return Result.fail(configurationError(
      "maximumRetainedObjectBytes",
      "incompatibleLimits",
    ));
  }
  return Result.succeed(Object.freeze({
    maximumObjectCount,
    maximumObjectBytes,
    maximumRetainedObjectBytes,
  }));
}

function admitReferences(
  references: ReadonlyArray<TaskRuntimeObjectReferenceV1>,
  policy: CapturedPolicy,
): Effect.Effect<void, TaskRuntimeReadinessColdVerificationAdmissionError> {
  if (references.length > policy.maximumObjectCount) {
    return Effect.fail(new TaskRuntimeReadinessColdVerificationAdmissionError({
      reason: "objectCountExceeded",
      observed: BigInt(references.length),
      maximum: BigInt(policy.maximumObjectCount),
    }));
  }
  let retainedBytes = 0n;
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index]!;
    if (reference.byteLength > BigInt(policy.maximumObjectBytes)) {
      return Effect.fail(new TaskRuntimeReadinessColdVerificationAdmissionError({
        reason: "objectBytesExceeded",
        objectIndex: index,
        observed: reference.byteLength,
        maximum: BigInt(policy.maximumObjectBytes),
      }));
    }
    retainedBytes += reference.byteLength;
    if (retainedBytes > BigInt(policy.maximumRetainedObjectBytes)) {
      return Effect.fail(new TaskRuntimeReadinessColdVerificationAdmissionError({
        reason: "retainedObjectBytesExceeded",
        objectIndex: index,
        observed: retainedBytes,
        maximum: BigInt(policy.maximumRetainedObjectBytes),
      }));
    }
  }
  return Effect.succeed(undefined);
}

function captureCompleted(
  completed: PreparedTaskRuntimeReadinessBasisV1,
): ProofState {
  return Object.freeze({
    canonicalBytes: completed.readCanonicalBytes(),
    sha256: completed.readSha256(),
  });
}

function readableProofState(
  state: ProofState,
): CapturedTaskRuntimeReadinessColdVerification {
  return Object.freeze({
    readBasis: () => Result.getOrThrow(
      decodeTaskRuntimeReadinessBasisPreimageV1(state.canonicalBytes),
    ),
    readCanonicalBytes: () => copyBytes(state.canonicalBytes),
    readSha256: () => copyBytes(state.sha256) as TaskDefinitionSha256V1,
  });
}

function configurationError(
  field: TaskRuntimeReadinessColdVerificationConfigurationError["field"],
  reason: TaskRuntimeReadinessColdVerificationConfigurationError["reason"],
): TaskRuntimeReadinessColdVerificationConfigurationError {
  return new TaskRuntimeReadinessColdVerificationConfigurationError({
    field,
    reason,
  });
}

function invalidProof(): TaskRuntimeReadinessColdVerificationProofError {
  return new TaskRuntimeReadinessColdVerificationProofError({
    reason: "invalidProof",
  });
}
