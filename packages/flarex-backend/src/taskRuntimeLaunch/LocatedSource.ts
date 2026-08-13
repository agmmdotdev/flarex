import {
  decodeTaskRuntimeEntryPreimageV1,
  decodeTaskRuntimeGroupManifestPreimageV1,
  decodeTaskRuntimeMaterializationSpecPreimageV1,
  decodeTaskRuntimeProjectionModulePreimageV1,
  decodeTaskRuntimeProjectionPreimageV1,
  type TaskRuntimeObjectReferenceV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Data, Effect, Result, Schema } from "effect";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";

import {
  TaskRunInputStoreCorruptionError,
  TaskRunInputStoreInputError,
  TaskRunInputStoreNotFoundError,
  TaskRunInputStoreResourceError,
  TaskRunInputStoreSettlementUncertainError,
  taskRunInputStoreResourceCause,
  taskRunInputStoreSettlementUncertainCause,
  type TaskRunInputStore,
} from "../taskRunInput/TaskRunInputStore.js";
import {
  TaskRuntimeObjectStoreCorruptionError,
  TaskRuntimeObjectStoreInputError,
  TaskRuntimeObjectStoreNotFoundError,
  TaskRuntimeObjectStoreResourceError,
  TaskRuntimeObjectStoreSettlementUncertainError,
  taskRuntimeObjectStoreResourceCause,
  taskRuntimeObjectStoreSettlementUncertainCause,
  type TaskRuntimeObjectStore,
} from "../taskRuntimePublication/TaskRuntimeObjectStore.js";
import {
  TaskRuntimeLaunchObjectCodecError,
  TaskRuntimeLaunchPortError,
  type TaskRuntimeLaunchLocatedSource,
  type TaskRuntimeLaunchObjectValidator,
} from "./Model.js";

export interface TaskRuntimeLaunchLocatedEvidenceSource {
  readonly scopeId: TaskRuntimeLaunchLocatedSource["scopeId"];
  readonly readEvidence: TaskRuntimeLaunchLocatedSource["readEvidence"];
}

/**
 * Host-located immutable stores. The host must derive this scope identity from
 * the same trusted directory resolution used by the evidence source.
 */
export interface TaskRuntimeLaunchLocatedStores {
  readonly scopeId: TaskRuntimeLaunchLocatedSource["scopeId"];
  readonly runtimeObjects: Pick<TaskRuntimeObjectStore, "read">;
  readonly runInputs: Pick<TaskRunInputStore, "read">;
}

export class TaskRuntimeLaunchLocatedSourceConfigurationError
  extends Data.TaggedError("TaskRuntimeLaunchLocatedSourceConfigurationError")<{
    readonly reason: "invalid_source" | "scope_mismatch";
    readonly cause?: unknown;
  }> {}

type RuntimeObjectReadError =
  | TaskRuntimeObjectStoreInputError
  | TaskRuntimeObjectStoreNotFoundError
  | TaskRuntimeObjectStoreResourceError
  | TaskRuntimeObjectStoreCorruptionError
  | TaskRuntimeObjectStoreSettlementUncertainError;

type RunInputReadError =
  | TaskRunInputStoreInputError
  | TaskRunInputStoreNotFoundError
  | TaskRunInputStoreResourceError
  | TaskRunInputStoreCorruptionError
  | TaskRunInputStoreSettlementUncertainError;

interface CapturedLocatedSource {
  readonly evidenceOwner: TaskRuntimeLaunchLocatedEvidenceSource;
  readonly readEvidence: TaskRuntimeLaunchLocatedSource["readEvidence"];
  readonly runtimeObjectOwner: Pick<TaskRuntimeObjectStore, "read">;
  readonly readRuntimeObject: TaskRuntimeObjectStore["read"];
  readonly runInputOwner: Pick<TaskRunInputStore, "read">;
  readonly readInput: TaskRunInputStore["read"];
  readonly scopeId: TaskRuntimeLaunchLocatedSource["scopeId"];
}

const decodeReplacementScopeId = Schema.decodeUnknownResult(
  ReplacementScopeIdV1Schema,
);

/**
 * Connects one already-located SAP-TRP6 evidence source to the two existing
 * immutable object readers. It creates no provider, Worker, route, or bucket
 * selection authority.
 */
export function makeTaskRuntimeLaunchLocatedSource(
  evidence: TaskRuntimeLaunchLocatedEvidenceSource,
  stores: TaskRuntimeLaunchLocatedStores,
): Result.Result<
  TaskRuntimeLaunchLocatedSource,
  TaskRuntimeLaunchLocatedSourceConfigurationError
> {
  return captureLocatedSource(evidence, stores).pipe(
    Result.map((captured) => {
      const readEvidence: TaskRuntimeLaunchLocatedSource["readEvidence"] =
        Effect.fn("TaskRuntimeLaunchLocatedSource.readEvidence")(
          request => captured.readEvidence.call(
            captured.evidenceOwner,
            request,
          ),
        );
      const readRuntimeObject:
        TaskRuntimeLaunchLocatedSource["readRuntimeObject"] = Effect.fn(
          "TaskRuntimeLaunchLocatedSource.readRuntimeObject",
        )(reference => captured.readRuntimeObject
            .call(captured.runtimeObjectOwner, reference)
            .pipe(
              Effect.map(({ bytes }) => bytes),
              Effect.mapError(mapRuntimeObjectReadError),
            ));
      const readInput: TaskRuntimeLaunchLocatedSource["readInput"] =
        Effect.fn("TaskRuntimeLaunchLocatedSource.readInput")(
          reference => captured.readInput
            .call(captured.runInputOwner, reference).pipe(
            Effect.map(({ canonicalBytes }) => canonicalBytes),
            Effect.mapError(mapRunInputReadError),
            ),
        );
      const source: TaskRuntimeLaunchLocatedSource = Object.freeze({
        scopeId: captured.scopeId,
        readEvidence,
        readRuntimeObject,
        readInput,
      });
      return source;
    }),
  );
}

/** Exact Standard Application role decoder for the DTE06-D1 launch seam. */
export const validateStandardApplicationTaskRuntimeObject:
  TaskRuntimeLaunchObjectValidator = Effect.fn(
    "TaskRuntimeLaunchLocatedSource.validateStandardApplicationTaskRuntimeObject",
  )(function* (reference, ownedBytes) {
    const decoded = decodeRuntimeObject(reference, ownedBytes).pipe(
      Result.mapError((cause) =>
        cause instanceof TaskRuntimeLaunchObjectCodecError
          ? cause
          : new TaskRuntimeLaunchObjectCodecError({
            reason: "invalid_body",
            cause,
          })
      ),
    );
    yield* Effect.fromResult(decoded);
  });

function captureLocatedSource(
  evidence: TaskRuntimeLaunchLocatedEvidenceSource,
  stores: TaskRuntimeLaunchLocatedStores,
): Result.Result<
  CapturedLocatedSource,
  TaskRuntimeLaunchLocatedSourceConfigurationError
> {
  return Result.try({
    try: () => {
      const evidenceScopeId = evidence.scopeId;
      const readEvidence = evidence.readEvidence;
      const storesScopeId = stores.scopeId;
      const runtimeObjectOwner = stores.runtimeObjects;
      const readRuntimeObject = runtimeObjectOwner.read;
      const runInputOwner = stores.runInputs;
      const readInput = runInputOwner.read;
      return {
        evidenceOwner: evidence,
        evidenceScopeId,
        readEvidence,
        storesScopeId,
        runtimeObjectOwner,
        readRuntimeObject,
        runInputOwner,
        readInput,
      };
    },
    catch: (cause) => configurationError("invalid_source", cause),
  }).pipe(
    Result.flatMap((captured) => Result.gen(function* () {
      const evidenceScopeId = yield* decodeReplacementScopeId(
        captured.evidenceScopeId,
      ).pipe(Result.mapError((cause) =>
        configurationError("invalid_source", cause)
      ));
      const storesScopeId = yield* decodeReplacementScopeId(
        captured.storesScopeId,
      ).pipe(Result.mapError((cause) =>
        configurationError("invalid_source", cause)
      ));
      if (
        typeof captured.readEvidence !== "function"
        || typeof captured.readRuntimeObject !== "function"
        || typeof captured.readInput !== "function"
      ) return yield* Result.fail(configurationError("invalid_source"));
      if (evidenceScopeId !== storesScopeId) {
        return yield* Result.fail(configurationError("scope_mismatch"));
      }
      return Object.freeze({
        evidenceOwner: captured.evidenceOwner,
        readEvidence: captured.readEvidence,
        runtimeObjectOwner: captured.runtimeObjectOwner,
        readRuntimeObject: captured.readRuntimeObject,
        runInputOwner: captured.runInputOwner,
        readInput: captured.readInput,
        scopeId: evidenceScopeId,
      });
    })),
  );
}

function decodeRuntimeObject(
  reference: TaskRuntimeObjectReferenceV1,
  ownedBytes: Uint8Array,
): Result.Result<unknown, unknown> {
  switch (reference.role) {
    case "runtime_projection_module":
      return decodeTaskRuntimeProjectionModulePreimageV1(ownedBytes);
    case "task_runtime_projection":
      return decodeTaskRuntimeProjectionPreimageV1(ownedBytes);
    case "task_runtime_entry":
      return decodeTaskRuntimeEntryPreimageV1(ownedBytes);
    case "task_runtime_group_manifest":
      return decodeTaskRuntimeGroupManifestPreimageV1(ownedBytes);
    case "task_runtime_materialization_spec":
      return decodeTaskRuntimeMaterializationSpecPreimageV1(ownedBytes);
    default:
      return Result.fail(new TaskRuntimeLaunchObjectCodecError({
        reason: "unsupported_role",
      }));
  }
}

function mapRuntimeObjectReadError(
  error: RuntimeObjectReadError,
): TaskRuntimeLaunchPortError<"read_runtime_object"> {
  if (error instanceof TaskRuntimeObjectStoreNotFoundError) {
    return runtimeObjectPortError("not_found", error);
  }
  if (
    error instanceof TaskRuntimeObjectStoreCorruptionError
    || error instanceof TaskRuntimeObjectStoreInputError
  ) return runtimeObjectPortError("corrupt", error);
  if (error instanceof TaskRuntimeObjectStoreResourceError) {
    return runtimeObjectPortError(
      "resource_failure",
      taskRuntimeObjectStoreResourceCause(error) ?? error,
    );
  }
  return runtimeObjectPortError(
    "resource_failure",
    taskRuntimeObjectStoreSettlementUncertainCause(error) ?? error,
  );
}

function mapRunInputReadError(
  error: RunInputReadError,
): TaskRuntimeLaunchPortError<"read_input"> {
  if (error instanceof TaskRunInputStoreNotFoundError) {
    return inputPortError("not_found", error);
  }
  if (
    error instanceof TaskRunInputStoreCorruptionError
    || error instanceof TaskRunInputStoreInputError
  ) return inputPortError("corrupt", error);
  if (error instanceof TaskRunInputStoreResourceError) {
    return inputPortError(
      "resource_failure",
      taskRunInputStoreResourceCause(error) ?? error,
    );
  }
  return inputPortError(
    "resource_failure",
    taskRunInputStoreSettlementUncertainCause(error) ?? error,
  );
}

function runtimeObjectPortError(
  reason: "not_found" | "corrupt" | "resource_failure",
  cause: unknown,
): TaskRuntimeLaunchPortError<"read_runtime_object"> {
  return new TaskRuntimeLaunchPortError<"read_runtime_object">({
    operation: "read_runtime_object",
    reason,
    cause,
  });
}

function inputPortError(
  reason: "not_found" | "corrupt" | "resource_failure",
  cause: unknown,
): TaskRuntimeLaunchPortError<"read_input"> {
  return new TaskRuntimeLaunchPortError<"read_input">({
    operation: "read_input",
    reason,
    cause,
  });
}

function configurationError(
  reason: TaskRuntimeLaunchLocatedSourceConfigurationError["reason"],
  cause?: unknown,
): TaskRuntimeLaunchLocatedSourceConfigurationError {
  return new TaskRuntimeLaunchLocatedSourceConfigurationError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
