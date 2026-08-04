import { copyBytes } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";

import {
  encodeApplicationRevisionTaskBindingPreimageV1,
  encodeCanonicalTaskManifestPreimageV1,
  encodeHashedCanonicalTaskCatalogPreimageV1,
  encodeTaskDefinitionRuntimeBindingPreimageV1,
  encodeTaskRunCreationAuthorityReceiptPreimageV1,
  encodeTaskRuntimeEntryPreimageV1,
} from "./Canonical.js";
import {
  InvalidStandardApplicationTaskDefinitionV1Error,
  type StandardApplicationTaskDefinitionOperationV1,
  type StandardApplicationTaskSha256V1Error,
} from "./Errors.js";
import {
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  type HashedCanonicalTaskCatalogEntryV1,
  type HashedCanonicalTaskCatalogV1,
  type TaskDefinitionSha256V1,
} from "./Model.js";
import {
  decodeApplicationRevisionTaskBindingFrameV1,
  decodeCanonicalTaskCatalogV1,
  decodeTaskDefinitionRuntimeBindingV1,
  decodeTaskRunCreationAuthorityReceiptV1,
  decodeTaskRuntimeEntryFrameV1,
} from "./Schema.js";
import type { StandardApplicationTaskSha256V1 } from "./Sha256.js";

export type StandardApplicationTaskDigestV1Error =
  | InvalidStandardApplicationTaskDefinitionV1Error
  | StandardApplicationTaskSha256V1Error;

export const hashCanonicalTaskManifestV1 = Effect.fn(
  "StandardApplicationTask.hashManifestV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  StandardApplicationTaskDigestV1Error
> {
  const bytes = yield* Effect.fromResult(
    encodeCanonicalTaskManifestPreimageV1(input).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_manifest")),
    ),
  );
  return yield* digest(bytes, sha256);
});

export const hashCanonicalTaskCatalogV1 = Effect.fn(
  "StandardApplicationTask.hashCatalogV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  HashedCanonicalTaskCatalogV1,
  StandardApplicationTaskDigestV1Error
> {
  const catalog = yield* Effect.fromResult(
    decodeCanonicalTaskCatalogV1(input).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_catalog")),
    ),
  );
  const entries: HashedCanonicalTaskCatalogEntryV1[] = [];
  for (const manifest of catalog.tasks) {
    const canonicalTaskManifestSha256 = yield* hashCanonicalTaskManifestV1(
      manifest,
      sha256,
    );
    entries.push(Object.freeze({
      taskId: manifest.taskId,
      manifest,
      canonicalTaskManifestSha256,
    }));
  }
  const partial = Object.freeze({
    version: 1 as const,
    entries: Object.freeze(entries),
  });
  const preimage = yield* Effect.fromResult(
    encodeHashedCanonicalTaskCatalogPreimageV1({
      ...partial,
    }).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_catalog")),
    ),
  );
  const taskCatalogSha256 = yield* digest(preimage, sha256);
  return Object.freeze({ ...partial, taskCatalogSha256 });
});

export const hashTaskRuntimeEntryFrameV1 = Effect.fn(
  "StandardApplicationTask.hashRuntimeEntryV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  StandardApplicationTaskDigestV1Error
> {
  const entry = yield* Effect.fromResult(
    decodeTaskRuntimeEntryFrameV1(input).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_runtime_entry")),
    ),
  );
  const bytes = yield* Effect.fromResult(
    encodeTaskRuntimeEntryPreimageV1(entry).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_runtime_entry")),
    ),
  );
  return yield* digest(bytes, sha256);
});

export const hashApplicationRevisionTaskBindingFrameV1 = Effect.fn(
  "StandardApplicationTask.hashApplicationRevisionBindingV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  StandardApplicationTaskDigestV1Error
> {
  const binding = yield* Effect.fromResult(
    decodeApplicationRevisionTaskBindingFrameV1(input).pipe(
      Result.mapError((failure) => reoperation(
        failure,
        "hash_application_revision_task_binding",
      )),
    ),
  );
  const bytes = yield* Effect.fromResult(
    encodeApplicationRevisionTaskBindingPreimageV1(binding).pipe(
      Result.mapError((failure) => reoperation(
        failure,
        "hash_application_revision_task_binding",
      )),
    ),
  );
  return yield* digest(bytes, sha256);
});

export const hashTaskDefinitionRuntimeBindingV1 = Effect.fn(
  "StandardApplicationTask.hashRuntimeBindingV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  StandardApplicationTaskDigestV1Error
> {
  const binding = yield* Effect.fromResult(
    decodeTaskDefinitionRuntimeBindingV1(input).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_runtime_binding")),
    ),
  );
  const manifestDigest = yield* hashCanonicalTaskManifestV1(
    binding.manifest,
    sha256,
  );
  const entryDigest = yield* hashTaskRuntimeEntryFrameV1(
    binding.taskRuntimeEntry,
    sha256,
  );
  if (
    !bytesEqual(manifestDigest, binding.canonicalTaskManifestSha256) ||
    !bytesEqual(entryDigest, binding.taskRuntimeEntrySha256)
  ) {
    return yield* Effect.fail(
      new InvalidStandardApplicationTaskDefinitionV1Error({
        operation: "hash_runtime_binding",
        reason: "inconsistent_binding",
      }),
    );
  }
  const bytes = yield* Effect.fromResult(
    encodeTaskDefinitionRuntimeBindingPreimageV1(binding).pipe(
      Result.mapError((failure) => reoperation(failure, "hash_runtime_binding")),
    ),
  );
  return yield* digest(bytes, sha256);
});

export const hashTaskRunCreationAuthorityReceiptV1 = Effect.fn(
  "StandardApplicationTask.hashCreationAuthorityV1",
)(function* (
  input: unknown,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  TaskDefinitionSha256V1,
  StandardApplicationTaskDigestV1Error
> {
  const receipt = yield* Effect.fromResult(
    decodeTaskRunCreationAuthorityReceiptV1(input).pipe(
      Result.mapError((failure) => reoperation(
        failure,
        "hash_creation_authority",
      )),
    ),
  );
  const bytes = yield* Effect.fromResult(
    encodeTaskRunCreationAuthorityReceiptPreimageV1(receipt).pipe(
      Result.mapError((failure) => reoperation(
        failure,
        "hash_creation_authority",
      )),
    ),
  );
  return yield* digest(bytes, sha256);
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
  }).pipe(Effect.map((value) =>
    copyBytes(value) as TaskDefinitionSha256V1
  ));
}

function reoperation(
  failure: InvalidStandardApplicationTaskDefinitionV1Error,
  operation: StandardApplicationTaskDefinitionOperationV1,
): InvalidStandardApplicationTaskDefinitionV1Error {
  return new InvalidStandardApplicationTaskDefinitionV1Error({
    operation,
    reason: failure.reason,
    ...(failure.path === undefined ? {} : { path: failure.path }),
    ...(failure.observed === undefined ? {} : { observed: failure.observed }),
    ...(failure.maximum === undefined ? {} : { maximum: failure.maximum }),
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}
