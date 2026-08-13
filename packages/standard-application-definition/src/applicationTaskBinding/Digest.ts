import { copyBytes } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";

import {
  encodeApplicationTaskCatalogBindingPreimageV1,
  encodeApplicationTaskDefinitionBindingPreimageV1,
  encodeApplicationTaskRuntimeTargetPreimageV1,
  encodeApplicationTaskRunCreationAuthorityPreimageV1,
} from "./Canonical.js";
import {
  ApplicationTaskBindingSha256InvariantV1Defect,
  InvalidApplicationTaskBindingV1Error,
  type ApplicationTaskBindingOperationV1,
} from "./Errors.js";
import { MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1 } from "./Model.js";
import type { TaskDefinitionSha256V1 } from "../taskDefinition/Model.js";
import type {
  StandardApplicationTaskSha256V1,
} from "../taskDefinition/Sha256.js";
import type {
  StandardApplicationTaskSha256ResourceV1Error,
} from "../taskDefinition/Errors.js";

export type ApplicationTaskBindingDigestV1Error =
  | InvalidApplicationTaskBindingV1Error
  | StandardApplicationTaskSha256ResourceV1Error;

export const hashApplicationTaskCatalogBindingV1 = Effect.fn(
  "ApplicationTaskBinding.hashCatalogV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  ApplicationTaskBindingDigestV1Error
> {
  const bytes = yield* Effect.fromResult(
    encodeApplicationTaskCatalogBindingPreimageV1(input).pipe(
      Result.mapError(error => reoperation(error, "hash_catalog_binding")),
    ),
  );
  return yield* digest(bytes, sha256, "hash_catalog_binding");
});

export const hashApplicationTaskDefinitionBindingV1 = Effect.fn(
  "ApplicationTaskBinding.hashDefinitionV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  ApplicationTaskBindingDigestV1Error
> {
  const bytes = yield* Effect.fromResult(
    encodeApplicationTaskDefinitionBindingPreimageV1(input).pipe(
      Result.mapError(error => reoperation(error, "hash_definition_binding")),
    ),
  );
  return yield* digest(bytes, sha256, "hash_definition_binding");
});

export const hashApplicationTaskRuntimeTargetV1 = Effect.fn(
  "ApplicationTaskBinding.hashRuntimeTargetV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  ApplicationTaskBindingDigestV1Error
> {
  const bytes = yield* Effect.fromResult(
    encodeApplicationTaskRuntimeTargetPreimageV1(input).pipe(
      Result.mapError(error => reoperation(error, "hash_runtime_target")),
    ),
  );
  return yield* digest(bytes, sha256, "hash_runtime_target");
});

export const hashApplicationTaskRunCreationAuthorityV1 = Effect.fn(
  "ApplicationTaskBinding.hashCreationAuthorityV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  ApplicationTaskBindingDigestV1Error
> {
  const bytes = yield* Effect.fromResult(
    encodeApplicationTaskRunCreationAuthorityPreimageV1(input).pipe(
      Result.mapError(error => reoperation(error, "hash_creation_authority")),
    ),
  );
  return yield* digest(bytes, sha256, "hash_creation_authority");
});

function digest(
  bytes: Uint8Array,
  sha256: StandardApplicationTaskSha256V1,
  operation: ApplicationTaskBindingOperationV1,
): Effect.Effect<
  TaskDefinitionSha256V1,
  StandardApplicationTaskSha256ResourceV1Error
> {
  return sha256(bytes, {
    maximumInputBytes: MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1,
  }).pipe(
    Effect.catchTag("StandardApplicationTaskSha256InputV1Error", error =>
      Effect.die(new ApplicationTaskBindingSha256InvariantV1Defect({
        operation,
        reason: error.reason,
      }))
    ),
    Effect.map(value => copyBytes(value) as TaskDefinitionSha256V1),
  );
}

function reoperation(
  error: InvalidApplicationTaskBindingV1Error,
  operation: ApplicationTaskBindingOperationV1,
): InvalidApplicationTaskBindingV1Error {
  return new InvalidApplicationTaskBindingV1Error({
    operation,
    reason: error.reason,
    ...(error.path === undefined ? {} : { path: error.path }),
  });
}
