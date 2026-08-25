import {
  decodeApplicationTaskCatalogBindingV1,
  decodeApplicationTaskDefinitionBindingV1,
  encodeApplicationTaskCatalogBindingPreimageV1,
  encodeApplicationTaskDefinitionBindingPreimageV1,
  MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1,
  MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1,
  type PreparedApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  decodeCanonicalTaskManifestPreimageV1,
  decodeCanonicalTaskManifestV1,
  encodeCanonicalTaskManifestPreimageV1,
  encodeHashedCanonicalTaskCatalogPreimageV1,
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  type TaskDefinitionSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Effect, Result } from "effect";

import type { ApplicationAnalysisAuthority } from
  "./applicationAnalysisRegistration";
import {
  ApplicationTaskBindingPersistenceError,
  ApplicationTaskCatalogSnapshotError,
  type ApplicationTaskCatalogSnapshot,
  type RegisterApplicationTaskBindingsInput,
} from "./applicationTaskBindingModel";
import {
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
} from "./schema";

type ApplicationTaskCatalogSnapshotCatalogRow =
  typeof fxSystemApplicationTaskCatalogsV1.$inferSelect;

type ApplicationTaskCatalogSnapshotDefinitionRow =
  typeof fxSystemApplicationTaskDefinitionsV1.$inferSelect;

export interface PreparedApplicationTaskDefinition {
  readonly taskId: string;
  readonly canonicalTaskManifestSha256: Uint8Array;
  readonly logicalModulePath: string;
  readonly sourceModulePath: string;
  readonly exportName: string;
  readonly manifestBytes: Uint8Array;
  readonly bindingBytes: Uint8Array;
  readonly bindingSha256: Uint8Array;
}

export interface PreparedApplicationTaskBindingRegistration {
  readonly authority: ApplicationAnalysisAuthority;
  readonly binding: PreparedApplicationTaskBindingsV1["catalog"]["binding"];
  readonly sourceRootBytes: Uint8Array;
  readonly publicationSha256Bytes: Uint8Array;
  readonly taskCatalogSha256Bytes: Uint8Array;
  readonly catalogBindingSha256Bytes: Uint8Array;
  readonly catalogBindingBytes: Uint8Array;
  readonly definitions: ReadonlyArray<PreparedApplicationTaskDefinition>;
}

interface CapturedDefinitionInput {
  readonly binding: Result.Result<
    PreparedApplicationTaskBindingsV1["definitions"][number]["binding"],
    ApplicationTaskBindingPersistenceError
  >;
  readonly manifest: Result.Result<
    PreparedApplicationTaskBindingsV1["definitions"][number]["manifest"],
    ApplicationTaskBindingPersistenceError
  >;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
  readonly canonicalManifestBytes: Uint8Array;
}

interface CapturedDefinitionWrapper {
  readonly binding: unknown;
  readonly manifest: unknown;
  readonly canonicalBytes: unknown;
  readonly sha256: unknown;
  readonly canonicalManifestBytes: unknown;
}

const DEFINITION_WRAPPER_KEYS = [
  "binding",
  "canonicalBytes",
  "canonicalManifestBytes",
  "manifest",
  "sha256",
] as const;
const DEFINITION_WRAPPER_KEY_SET: ReadonlySet<string> = new Set(
  DEFINITION_WRAPPER_KEYS,
);
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const ARRAY_BUFFER_RESIZABLE_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
      SharedArrayBuffer.prototype,
      "byteLength",
    )?.get;

/**
 * Exact capture, codec, digest, and ordering owner shared by the retained and
 * relation-aware Application task-binding persistence adapters.
 */
export const prepareApplicationTaskBindingRegistrationEffect = Effect.fn(
  "ApplicationTaskBinding.prepare",
)(function* (
  input: RegisterApplicationTaskBindingsInput,
): Effect.fn.Return<
  PreparedApplicationTaskBindingRegistration,
  ApplicationTaskBindingPersistenceError
> {
  const authority = Object.freeze({ ...input.authority });
  const catalogInput = input.bindings.catalog;
  const binding = yield* Effect.fromResult(
    decodeApplicationTaskCatalogBindingV1(catalogInput.binding).pipe(
      Result.mapError(cause => failureValue("invalidInput", false, cause)),
    ),
  );
  if (binding.scopeId !== authority.scopeId) {
    return yield* failure("invalidInput");
  }
  const definitionWrappers = yield* Effect.fromResult(
    captureDefinitionWrappers(input.bindings.definitions, binding.taskCount),
  );
  yield* Effect.fromResult(validateEvidenceByteBudget(
    catalogInput.canonicalBytes,
    catalogInput.sha256,
    definitionWrappers,
  ));
  const catalog = Object.freeze({
    binding,
    canonicalBytes: yield* Effect.fromResult(boundedCanonicalBytes(
      catalogInput.canonicalBytes,
      MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1,
    )),
    sha256: yield* Effect.fromResult(snapshotSha256(catalogInput.sha256)),
  });
  const catalogBindingBytes = yield* Effect.fromResult(
    encodeApplicationTaskCatalogBindingPreimageV1(binding).pipe(
      Result.mapError(cause => failureValue("invalidInput", false, cause)),
    ),
  );
  if (!bytesEqualFullScan(catalogBindingBytes, catalog.canonicalBytes)) {
    return yield* failure("invalidInput");
  }
  const capturedDefinitions: CapturedDefinitionInput[] = [];
  for (const definition of definitionWrappers) {
    capturedDefinitions.push(Object.freeze({
      binding: decodeApplicationTaskDefinitionBindingV1(
        definition.binding,
      ).pipe(Result.mapError(cause =>
        failureValue("invalidInput", false, cause)
      )),
      manifest: decodeCanonicalTaskManifestV1(definition.manifest).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
      canonicalBytes: yield* Effect.fromResult(boundedCanonicalBytes(
        definition.canonicalBytes,
        MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1,
      )),
      sha256: yield* Effect.fromResult(snapshotSha256(definition.sha256)),
      canonicalManifestBytes: yield* Effect.fromResult(
        boundedCanonicalBytes(
          definition.canonicalManifestBytes,
          MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
        ),
      ),
    }));
  }
  const catalogBindingSha256Bytes = yield* sha256(catalogBindingBytes);
  if (!bytesEqualFullScan(catalogBindingSha256Bytes, catalog.sha256)) {
    return yield* failure("invalidInput");
  }
  if (binding.taskCount !== capturedDefinitions.length) {
    return yield* failure("invalidInput");
  }

  const definitions: PreparedApplicationTaskDefinition[] = [];
  const catalogEntries: Array<Readonly<{
    readonly taskId: PreparedApplicationTaskBindingsV1["definitions"][number]["binding"]["taskId"];
    readonly manifest: PreparedApplicationTaskBindingsV1["definitions"][number]["manifest"];
    readonly canonicalTaskManifestSha256: PreparedApplicationTaskBindingsV1["definitions"][number]["binding"]["canonicalTaskManifestSha256"];
  }>> = [];
  for (const captured of capturedDefinitions) {
    const definition = Object.freeze({
      binding: yield* Effect.fromResult(captured.binding),
      manifest: yield* Effect.fromResult(captured.manifest),
      canonicalBytes: captured.canonicalBytes,
      sha256: captured.sha256,
      canonicalManifestBytes: captured.canonicalManifestBytes,
    });
    if (!bytesEqualFullScan(
      definition.binding.applicationTaskCatalogBindingSha256,
      catalogBindingSha256Bytes,
    ) || definition.binding.taskId !== definition.manifest.taskId ||
      definition.binding.handler.logicalModulePath !==
        definition.manifest.handler.logicalModulePath ||
      definition.binding.handler.sourceModulePath !==
        definition.manifest.handler.artifactModulePath ||
      definition.binding.handler.exportName !==
        definition.manifest.handler.exportName) {
      return yield* failure("invalidInput");
    }
    const manifestBytes = yield* Effect.fromResult(
      encodeCanonicalTaskManifestPreimageV1(definition.manifest).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
    );
    const manifestSha256 = yield* sha256(manifestBytes);
    if (
      !bytesEqualFullScan(manifestBytes, definition.canonicalManifestBytes) ||
      !bytesEqualFullScan(
        manifestSha256,
        definition.binding.canonicalTaskManifestSha256,
      )
    ) return yield* failure("invalidInput");
    const bindingBytes = yield* Effect.fromResult(
      encodeApplicationTaskDefinitionBindingPreimageV1(
        definition.binding,
      ).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
    );
    const bindingSha256 = yield* sha256(bindingBytes);
    if (
      !bytesEqualFullScan(bindingBytes, definition.canonicalBytes) ||
      !bytesEqualFullScan(bindingSha256, definition.sha256)
    ) return yield* failure("invalidInput");
    definitions.push(Object.freeze({
      taskId: definition.binding.taskId,
      canonicalTaskManifestSha256: copyBytes(manifestSha256),
      logicalModulePath: definition.binding.handler.logicalModulePath,
      sourceModulePath: definition.binding.handler.sourceModulePath,
      exportName: definition.binding.handler.exportName,
      manifestBytes: copyBytes(manifestBytes),
      bindingBytes: copyBytes(bindingBytes),
      bindingSha256: copyBytes(bindingSha256),
    }));
    catalogEntries.push(Object.freeze({
      taskId: definition.binding.taskId,
      manifest: definition.manifest,
      canonicalTaskManifestSha256:
        definition.binding.canonicalTaskManifestSha256,
    }));
  }
  const catalogBytes = yield* Effect.fromResult(
    encodeHashedCanonicalTaskCatalogPreimageV1({
      version: 1,
      entries: catalogEntries,
    }).pipe(Result.mapError(cause =>
      failureValue("invalidInput", false, cause)
    )),
  );
  const taskCatalogSha256Bytes = yield* sha256(catalogBytes);
  if (!bytesEqualFullScan(
    taskCatalogSha256Bytes,
    catalog.binding.taskCatalogSha256,
  )) return yield* failure("invalidInput");
  const sourceRootBytes = yield* Effect.fromResult(
    decodeSha256(catalog.binding.sourceArtifactRootSha256),
  );
  const publicationSha256Bytes = yield* Effect.fromResult(
    decodeSha256(catalog.binding.publicationSha256),
  );
  return Object.freeze({
    authority,
    binding,
    sourceRootBytes,
    publicationSha256Bytes,
    taskCatalogSha256Bytes,
    catalogBindingSha256Bytes,
    catalogBindingBytes: copyBytes(catalogBindingBytes),
    definitions: Object.freeze(definitions),
  });
});

/** Exact stored-row reconstruction shared by both table generations. */
export const reconstructApplicationTaskCatalogSnapshotEffect = Effect.fn(
  "ApplicationTaskCatalogSnapshot.reconstruct",
)(function* (
  catalog: ApplicationTaskCatalogSnapshotCatalogRow,
  definitions: ReadonlyArray<ApplicationTaskCatalogSnapshotDefinitionRow>,
): Effect.fn.Return<
  ApplicationTaskCatalogSnapshot,
  ApplicationTaskCatalogSnapshotError
> {
  if (definitions.length !== catalog.taskCount) {
    return yield* taskSnapshotFailure("storedState");
  }
  const catalogBinding = yield* Effect.fromResult(
    decodeApplicationTaskCatalogBindingV1({
      version: 1,
      scopeId: catalog.scopeId,
      revisionId: catalog.revisionId,
      candidateId: catalog.candidateId,
      analysisId: catalog.analysisId,
      sourceArtifactRootSha256: encodeBytesToLowercaseHex(
        catalog.sourceArtifactRootSha256,
      ),
      publicationSha256: encodeBytesToLowercaseHex(catalog.publicationSha256),
      taskCatalogSha256: copyBytes(catalog.taskCatalogSha256),
      taskCount: catalog.taskCount,
      runtimeHostIdentity: catalog.runtimeHostIdentity,
      compatibilityDate: catalog.compatibilityDate,
    }).pipe(Result.mapError(cause => taskSnapshotFailureValue(
      "storedState",
      cause,
    ))),
  );
  const catalogBindingBytes = yield* Effect.fromResult(
    encodeApplicationTaskCatalogBindingPreimageV1(catalogBinding).pipe(
      Result.mapError(cause => taskSnapshotFailureValue(
        "storedState",
        cause,
      )),
    ),
  );
  const catalogBindingSha256 = yield* taskSnapshotSha256(catalogBindingBytes);
  if (!bytesEqualFullScan(catalogBindingBytes, catalog.bindingBytes) ||
    !bytesEqualFullScan(
      catalogBindingSha256,
      catalog.taskCatalogBindingSha256,
    )) return yield* taskSnapshotFailure("storedState");
  const entries: Array<Readonly<{
    readonly taskId: PreparedApplicationTaskBindingsV1["definitions"][number]["binding"]["taskId"];
    readonly manifest: PreparedApplicationTaskBindingsV1["definitions"][number]["manifest"];
    readonly canonicalTaskManifestSha256: TaskDefinitionSha256V1;
  }>> = [];
  for (const row of definitions) {
    const manifest = yield* Effect.fromResult(
      decodeCanonicalTaskManifestPreimageV1(row.manifestBytes).pipe(
        Result.mapError(cause => taskSnapshotFailureValue(
          "storedState",
          cause,
        )),
      ),
    );
    const manifestBytes = yield* Effect.fromResult(
      encodeCanonicalTaskManifestPreimageV1(manifest).pipe(
        Result.mapError(cause => taskSnapshotFailureValue(
          "storedState",
          cause,
        )),
      ),
    );
    const manifestSha256 = yield* taskSnapshotSha256(manifestBytes);
    const binding = yield* Effect.fromResult(
      decodeApplicationTaskDefinitionBindingV1({
        version: 1,
        applicationTaskCatalogBindingSha256:
          copyBytes(row.taskCatalogBindingSha256),
        canonicalTaskManifestSha256:
          copyBytes(row.canonicalTaskManifestSha256),
        taskId: row.taskId,
        handler: {
          logicalModulePath: row.logicalModulePath,
          sourceModulePath: row.sourceModulePath,
          exportName: row.exportName,
        },
      }).pipe(Result.mapError(cause => taskSnapshotFailureValue(
        "storedState",
        cause,
      ))),
    );
    const bindingBytes = yield* Effect.fromResult(
      encodeApplicationTaskDefinitionBindingPreimageV1(binding).pipe(
        Result.mapError(cause => taskSnapshotFailureValue(
          "storedState",
          cause,
        )),
      ),
    );
    if (manifest.taskId !== row.taskId ||
      manifest.handler.logicalModulePath !== row.logicalModulePath ||
      manifest.handler.artifactModulePath !== row.sourceModulePath ||
      manifest.handler.exportName !== row.exportName ||
      !bytesEqualFullScan(manifestBytes, row.manifestBytes) ||
      !bytesEqualFullScan(manifestSha256, row.canonicalTaskManifestSha256) ||
      !bytesEqualFullScan(bindingBytes, row.bindingBytes) ||
      !bytesEqualFullScan(
        yield* taskSnapshotSha256(bindingBytes),
        row.taskDefinitionBindingSha256,
      ) || !bytesEqualFullScan(
        row.taskCatalogBindingSha256,
        catalogBindingSha256,
      )) return yield* taskSnapshotFailure("storedState");
    entries.push(Object.freeze({
      taskId: manifest.taskId,
      manifest,
      canonicalTaskManifestSha256:
        binding.canonicalTaskManifestSha256,
    }));
  }
  entries.sort((left, right) => compareTaskIds(left.taskId, right.taskId));
  const catalogBytes = yield* Effect.fromResult(
    encodeHashedCanonicalTaskCatalogPreimageV1({
      version: 1,
      entries,
    }).pipe(Result.mapError(cause => taskSnapshotFailureValue(
      "storedState",
      cause,
    ))),
  );
  if (!bytesEqualFullScan(
    yield* taskSnapshotSha256(catalogBytes),
    catalog.taskCatalogSha256,
  )) return yield* taskSnapshotFailure("storedState");
  return Object.freeze({
    scopeId: catalog.scopeId,
    revisionId: catalog.revisionId,
    candidateId: catalog.candidateId,
    analysisId: catalog.analysisId,
    sourceArtifactRootSha256: copyBytes(catalog.sourceArtifactRootSha256),
    publicationSha256: copyBytes(catalog.publicationSha256),
    taskCatalogSha256: copyBytes(catalog.taskCatalogSha256),
    taskCatalogBindingSha256: copyBytes(catalogBindingSha256),
    taskCount: catalog.taskCount,
    runtimeHostIdentity: catalog.runtimeHostIdentity,
    compatibilityDate: catalog.compatibilityDate,
  });
});

function compareTaskIds(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function taskSnapshotSha256(bytes: Uint8Array): Effect.Effect<Uint8Array> {
  return Effect.tryPromise(() => crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  )).pipe(
    Effect.map(buffer => new Uint8Array(buffer)),
    Effect.orDie,
  );
}

function taskSnapshotFailure(
  reason: ApplicationTaskCatalogSnapshotError["reason"],
  cause?: unknown,
): Effect.Effect<never, ApplicationTaskCatalogSnapshotError> {
  return Effect.fail(taskSnapshotFailureValue(reason, cause));
}

function taskSnapshotFailureValue(
  reason: ApplicationTaskCatalogSnapshotError["reason"],
  cause?: unknown,
): ApplicationTaskCatalogSnapshotError {
  return new ApplicationTaskCatalogSnapshotError({
    reason,
    retryable: false,
    ...(cause === undefined ? {} : { cause }),
  });
}

function sha256(
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, ApplicationTaskBindingPersistenceError> {
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: host - SHA-256 of an owned ArrayBuffer copy is treated as a non-rejecting WebCrypto digest
  return Effect.promise(async () =>
    new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    ))
  ).pipe(Effect.flatMap(digest => digest.byteLength === 32
    ? Effect.succeed(digest)
    : Effect.die(new Error("SHA-256 returned a non-32-byte digest."))));
}

function decodeSha256(
  value: string,
): Result.Result<Uint8Array, ApplicationTaskBindingPersistenceError> {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    return Result.fail(failureValue("invalidInput"));
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return Result.succeed(bytes);
}

function boundedCanonicalBytes(
  value: unknown,
  maximumByteLength: number,
): Result.Result<Uint8Array, ApplicationTaskBindingPersistenceError> {
  if (!isUint8Array(value) || !isFixedArrayBufferBacked(value)) {
    return Result.fail(failureValue("invalidInput"));
  }
  const byteLength = uint8ArrayByteLength(value);
  if (
    byteLength === undefined || byteLength === 0 ||
    byteLength > maximumByteLength
  ) return Result.fail(failureValue("invalidInput"));
  try {
    return Result.succeed(copyBytes(value));
  } catch (cause) {
    return Result.fail(failureValue("invalidInput", false, cause));
  }
}

function validateEvidenceByteBudget(
  catalogCanonicalBytes: unknown,
  catalogSha256: unknown,
  definitions: ReadonlyArray<CapturedDefinitionWrapper>,
): Result.Result<void, ApplicationTaskBindingPersistenceError> {
  return Result.gen(function* () {
    let total = yield* boundedCanonicalByteLength(
      catalogCanonicalBytes,
      MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1,
    );
    yield* validateSha256(catalogSha256);
    for (const definition of definitions) {
      const bindingByteLength = yield* boundedCanonicalByteLength(
        definition.canonicalBytes,
        MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1,
      );
      const manifestByteLength = yield* boundedCanonicalByteLength(
        definition.canonicalManifestBytes,
        MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
      );
      yield* validateSha256(definition.sha256);
      const increment = bindingByteLength + manifestByteLength;
      if (
        !Number.isSafeInteger(increment) ||
        total > MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1 - increment
      ) return yield* Result.fail(failureValue("invalidInput"));
      total += increment;
    }
  });
}

function boundedCanonicalByteLength(
  value: unknown,
  maximumByteLength: number,
): Result.Result<number, ApplicationTaskBindingPersistenceError> {
  if (!isUint8Array(value) || !isFixedArrayBufferBacked(value)) {
    return Result.fail(failureValue("invalidInput"));
  }
  const byteLength = uint8ArrayByteLength(value);
  return byteLength !== undefined && byteLength > 0 &&
      byteLength <= maximumByteLength
    ? Result.succeed(byteLength)
    : Result.fail(failureValue("invalidInput"));
}

function validateSha256(
  value: unknown,
): Result.Result<void, ApplicationTaskBindingPersistenceError> {
  return isUint8ArrayWithByteLength(value, 32) &&
      isFixedArrayBufferBacked(value)
    ? Result.succeed(undefined)
    : Result.fail(failureValue("invalidInput"));
}

function captureDefinitionWrappers(
  input: unknown,
  expectedCount: number,
): Result.Result<
  ReadonlyArray<CapturedDefinitionWrapper>,
  ApplicationTaskBindingPersistenceError
> {
  try {
    if (!Array.isArray(input)) {
      return Result.fail(failureValue("invalidInput"));
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    const arrayKeys = Reflect.ownKeys(input);
    const arrayKeySet = new Set(arrayKeys);
    if (
      lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== expectedCount ||
      arrayKeys.length !== expectedCount + 1 ||
      !arrayKeySet.has("length")
    ) return Result.fail(failureValue("invalidInput"));
    const wrappers: CapturedDefinitionWrapper[] = [];
    for (let index = 0; index < expectedCount; index += 1) {
      if (!arrayKeySet.has(String(index))) {
        return Result.fail(failureValue("invalidInput"));
      }
      const member = Object.getOwnPropertyDescriptor(input, String(index));
      if (
        member === undefined || !member.enumerable || !("value" in member) ||
        typeof member.value !== "object" || member.value === null ||
        Array.isArray(member.value)
      ) return Result.fail(failureValue("invalidInput"));
      const keys = Reflect.ownKeys(member.value);
      if (
        keys.length !== DEFINITION_WRAPPER_KEYS.length ||
        keys.some(key =>
          typeof key !== "string" ||
          !DEFINITION_WRAPPER_KEY_SET.has(key)
        )
      ) return Result.fail(failureValue("invalidInput"));
      const captured: Record<string, unknown> = Object.create(null);
      for (const key of DEFINITION_WRAPPER_KEYS) {
        const descriptor = Object.getOwnPropertyDescriptor(member.value, key);
        if (
          descriptor === undefined || !descriptor.enumerable ||
          !("value" in descriptor)
        ) return Result.fail(failureValue("invalidInput"));
        captured[key] = descriptor.value;
      }
      wrappers.push(Object.freeze({
        binding: captured.binding,
        manifest: captured.manifest,
        canonicalBytes: captured.canonicalBytes,
        sha256: captured.sha256,
        canonicalManifestBytes: captured.canonicalManifestBytes,
      }));
    }
    return Result.succeed(Object.freeze(wrappers));
  } catch (cause) {
    return Result.fail(failureValue("invalidInput", false, cause));
  }
}

function snapshotSha256(
  value: unknown,
): Result.Result<Uint8Array, ApplicationTaskBindingPersistenceError> {
  if (
    !isUint8ArrayWithByteLength(value, 32) ||
    !isFixedArrayBufferBacked(value)
  ) {
    return Result.fail(failureValue("invalidInput"));
  }
  try {
    return Result.succeed(copyBytes(value));
  } catch (cause) {
    return Result.fail(failureValue("invalidInput", false, cause));
  }
}

function isFixedArrayBufferBacked(value: Uint8Array): boolean {
  try {
    if (
      TYPED_ARRAY_BUFFER_GETTER === undefined ||
      ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined
    ) return false;
    const buffer: unknown = TYPED_ARRAY_BUFFER_GETTER.call(value);
    const arrayBufferByteLength: unknown =
      ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(buffer);
    if (typeof arrayBufferByteLength === "number") {
      const resizable: unknown = ARRAY_BUFFER_RESIZABLE_GETTER?.call(buffer);
      return resizable !== true;
    }
    if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER !== undefined) {
      const sharedByteLength: unknown =
        SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(buffer);
      if (typeof sharedByteLength === "number") return false;
    }
    return false;
  } catch {
    return false;
  }
}

function failure(
  reason: ApplicationTaskBindingPersistenceError["reason"],
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationTaskBindingPersistenceError> {
  return Effect.fail(failureValue(reason, retryable, cause));
}

function failureValue(
  reason: ApplicationTaskBindingPersistenceError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationTaskBindingPersistenceError {
  return new ApplicationTaskBindingPersistenceError({
    operation: "register",
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
