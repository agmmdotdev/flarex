import { bytesEqualFullScan, copyBytes } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";

import { encodeTaskRuntimeEntryPreimageV1 } from "./Canonical.js";
import {
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeEntryFrameV1,
  type TaskRuntimeProjectionFrameV1,
  type TaskRuntimeProjectionModuleFrameV1,
} from "./Model.js";
import {
  encodeTaskRuntimeEntryRootPreimageV1,
  encodeTaskRuntimeGroupManifestPreimageV1,
  encodeTaskRuntimeMaterializationSpecPreimageV1,
  encodeTaskRuntimeModuleRootPreimageV1,
  encodeTaskRuntimeProjectionModulePreimageV1,
  encodeTaskRuntimeProjectionPreimageV1,
} from "./RuntimePublicationCanonical.js";
import {
  InvalidTaskRuntimePublicationV1Error,
  type TaskRuntimePublicationOperationV1,
  type TaskRuntimePublicationReasonV1,
} from "./RuntimePublicationErrors.js";
import {
  decodeTaskRuntimeEntryFramesForRootV1,
  decodeTaskRuntimeGroupManifestFrameV1,
  decodeTaskRuntimeMaterializationSpecV1,
  decodeTaskRuntimeProjectionFrameV1,
  decodeTaskRuntimeProjectionModuleFramesV1,
} from "./RuntimePublicationSchema.js";
import type { StandardApplicationTaskSha256V1 } from "./Sha256.js";
import type { StandardApplicationTaskSha256V1Error } from "./Errors.js";

export type TaskRuntimePublicationDigestV1Error<
  Operation extends TaskRuntimePublicationOperationV1 =
    TaskRuntimePublicationOperationV1,
> =
  | InvalidTaskRuntimePublicationV1Error<Operation>
  | StandardApplicationTaskSha256V1Error;

export interface HashedTaskRuntimeProjectionModulesV1 {
  readonly modules: ReadonlyArray<TaskRuntimeProjectionModuleFrameV1>;
  readonly moduleFrameSha256: ReadonlyArray<TaskDefinitionSha256V1>;
  readonly moduleRootSha256: TaskDefinitionSha256V1;
  readonly rawByteLength: bigint;
}

export interface VerifiedTaskRuntimeProjectionV1
  extends HashedTaskRuntimeProjectionModulesV1 {
  readonly projection: TaskRuntimeProjectionFrameV1;
  readonly projectionSha256: TaskDefinitionSha256V1;
}

export const hashTaskRuntimeProjectionModuleFrameV1 = Effect.fn(
  "StandardApplicationTask.hashRuntimeProjectionModuleV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  TaskRuntimePublicationDigestV1Error<"hash_projection_module">
> {
  const bytes = yield* Effect.fromResult(
    encodeTaskRuntimeProjectionModulePreimageV1(input).pipe(
      Result.mapError((failure) => reoperation(
        failure,
        "hash_projection_module",
      )),
    ),
  );
  return yield* digest(bytes, sha256);
});

export const hashTaskRuntimeProjectionFrameV1 = Effect.fn(
  "StandardApplicationTask.hashRuntimeProjectionV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  TaskRuntimePublicationDigestV1Error<"hash_projection">
> {
  const bytes = yield* Effect.fromResult(
    encodeTaskRuntimeProjectionPreimageV1(input).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_projection")),
    ),
  );
  return yield* digest(bytes, sha256);
});

export const hashTaskRuntimeGroupManifestFrameV1 = Effect.fn(
  "StandardApplicationTask.hashRuntimeGroupManifestV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  TaskRuntimePublicationDigestV1Error<"hash_group_manifest">
> {
  const frame = yield* Effect.fromResult(
    decodeTaskRuntimeGroupManifestFrameV1(input).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_group_manifest")),
    ),
  );
  const bytes = yield* Effect.fromResult(
    encodeTaskRuntimeGroupManifestPreimageV1(frame).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_group_manifest")),
    ),
  );
  return yield* digest(bytes, sha256);
});

export const hashTaskRuntimeMaterializationSpecV1 = Effect.fn(
  "StandardApplicationTask.hashRuntimeMaterializationSpecV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  TaskRuntimePublicationDigestV1Error<"hash_materialization_spec">
> {
  const spec = yield* Effect.fromResult(
    decodeTaskRuntimeMaterializationSpecV1(input).pipe(
      Result.mapError((failure) => reoperation(
        failure,
        "hash_materialization_spec",
      )),
    ),
  );
  const bytes = yield* Effect.fromResult(
    encodeTaskRuntimeMaterializationSpecPreimageV1(spec).pipe(
      Result.mapError((failure) => reoperation(
        failure,
        "hash_materialization_spec",
      )),
    ),
  );
  return yield* digest(bytes, sha256);
});

export const hashTaskRuntimeProjectionModuleRootV1 = Effect.fn(
  "StandardApplicationTask.hashRuntimeProjectionModuleRootV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  HashedTaskRuntimeProjectionModulesV1,
  TaskRuntimePublicationDigestV1Error<
    "hash_module_root" | "hash_projection_module"
  >
> {
  const modules = yield* Effect.fromResult(
    decodeTaskRuntimeProjectionModuleFramesV1(input).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_module_root")),
    ),
  );
  const frameDigests: TaskDefinitionSha256V1[] = [];
  let rawByteLength = 0n;
  for (let index = 0; index < modules.length; index += 1) {
    const module = modules[index]!;
    rawByteLength += module.rawByteLength;
    if (rawByteLength > BigInt(MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1)) {
      return yield* Effect.fail(invalid(
        "hash_module_root",
        "invalid_byte_length",
        `[${index}].rawByteLength`,
        Number(rawByteLength),
        MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1,
      ));
    }
    const sourceSha256 = yield* digest(module.sourceBytes, sha256);
    if (!bytesEqualFullScan(sourceSha256, module.sourceSha256)) {
      return yield* Effect.fail(invalid(
        "hash_module_root",
        "source_digest_mismatch",
        `[${index}].sourceSha256`,
      ));
    }
    frameDigests.push(yield* hashTaskRuntimeProjectionModuleFrameV1(
      module,
      sha256,
    ));
  }
  const rootPreimage = yield* Effect.fromResult(
    encodeTaskRuntimeModuleRootPreimageV1(frameDigests).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_module_root")),
    ),
  );
  const moduleRootSha256 = yield* digest(rootPreimage, sha256);
  return Object.freeze({
    modules,
    moduleFrameSha256: Object.freeze(frameDigests),
    moduleRootSha256,
    rawByteLength,
  });
});

export const verifyTaskRuntimeProjectionV1 = Effect.fn(
  "StandardApplicationTask.verifyRuntimeProjectionV1",
)(function* (
  projectionInput: unknown,
  moduleInput: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  VerifiedTaskRuntimeProjectionV1,
  TaskRuntimePublicationDigestV1Error<
    "hash_projection" | "hash_module_root" | "hash_projection_module"
  >
> {
  const projection = yield* Effect.fromResult(
    decodeTaskRuntimeProjectionFrameV1(projectionInput).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_projection")),
    ),
  );
  const modules = yield* hashTaskRuntimeProjectionModuleRootV1(
    moduleInput,
    sha256,
  );
  if (
    projection.moduleCount !== BigInt(modules.modules.length) ||
    projection.rawByteLength !== modules.rawByteLength ||
    !bytesEqualFullScan(projection.moduleRootSha256, modules.moduleRootSha256)
  ) {
    return yield* Effect.fail(invalid(
      "hash_projection",
      "invalid_root",
    ));
  }
  if (!modules.modules.some((module) =>
    module.artifactModulePath === projection.executionModule &&
    (module.sourceRoles & SOURCE_ARTIFACT_V2_ROLE_EXECUTION) !== 0
  )) {
    return yield* Effect.fail(invalid(
      "hash_projection",
      "missing_execution_module",
      "executionModule",
    ));
  }
  const projectionSha256 = yield* hashTaskRuntimeProjectionFrameV1(
    projection,
    sha256,
  );
  return Object.freeze({ ...modules, projection, projectionSha256 });
});

export const hashTaskRuntimeEntryRootV1 = Effect.fn(
  "StandardApplicationTask.hashRuntimeEntryRootV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  TaskRuntimePublicationDigestV1Error<"hash_entry_root">
> {
  const entries = yield* Effect.fromResult(
    decodeTaskRuntimeEntryFramesForRootV1(input).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_entry_root")),
    ),
  );
  const entryDigests: TaskDefinitionSha256V1[] = [];
  for (const entry of entries) {
    const bytes = yield* Effect.fromResult(
      encodeTaskRuntimeEntryPreimageV1(entry).pipe(
        Result.mapError((failure) => invalid(
          "hash_entry_root",
          failure.reason === "invalid_digest" ? "invalid_digest" : "invalid_root",
          failure.path,
        )),
      ),
    );
    entryDigests.push(yield* digest(bytes, sha256));
  }
  const rootPreimage = yield* Effect.fromResult(
    encodeTaskRuntimeEntryRootPreimageV1(entryDigests).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_entry_root")),
    ),
  );
  return yield* digest(rootPreimage, sha256);
});

function digest(
  bytes: Uint8Array,
  sha256: StandardApplicationTaskSha256V1,
): Effect.Effect<
  TaskDefinitionSha256V1,
  StandardApplicationTaskSha256V1Error
> {
  return sha256(bytes, {
    maximumInputBytes: MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  }).pipe(Effect.map((value) => copyBytes(value) as TaskDefinitionSha256V1));
}

function reoperation<Operation extends TaskRuntimePublicationOperationV1>(
  failure: InvalidTaskRuntimePublicationV1Error,
  operation: Operation,
): InvalidTaskRuntimePublicationV1Error<Operation> {
  return new InvalidTaskRuntimePublicationV1Error({
    operation,
    reason: failure.reason,
    ...(failure.path === undefined ? {} : { path: failure.path }),
    ...(failure.observed === undefined ? {} : { observed: failure.observed }),
    ...(failure.maximum === undefined ? {} : { maximum: failure.maximum }),
  });
}

function invalid<Operation extends TaskRuntimePublicationOperationV1>(
  operation: Operation,
  reason: TaskRuntimePublicationReasonV1,
  path?: string,
  observed?: number,
  maximum?: number,
): InvalidTaskRuntimePublicationV1Error<Operation> {
  return new InvalidTaskRuntimePublicationV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}
