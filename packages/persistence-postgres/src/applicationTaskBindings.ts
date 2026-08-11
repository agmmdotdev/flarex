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
  decodeCanonicalTaskManifestV1,
  encodeCanonicalTaskManifestPreimageV1,
  encodeHashedCanonicalTaskCatalogPreimageV1,
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
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
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect, Result } from "effect";

import type { AppRowTransaction } from "./appRows";
import type { ApplicationAnalysisAuthority } from
  "./applicationAnalysisRegistration";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import { runEffectTransaction } from "./effectTransaction";
import {
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
  fxSystemScopeClocks,
} from "./schema";

export interface RegisterApplicationTaskBindingsInput {
  readonly authority: ApplicationAnalysisAuthority;
  readonly bindings: PreparedApplicationTaskBindingsV1;
}

export interface ApplicationTaskBindingRegistration {
  readonly scopeId: ApplicationAnalysisAuthority["scopeId"];
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: string;
  readonly publicationSha256: string;
  readonly taskCatalogSha256: string;
  readonly taskCatalogBindingSha256: string;
  readonly taskCount: number;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly registeredAt: Date;
}

export class ApplicationTaskBindingPersistenceError extends Data.TaggedError(
  "ApplicationTaskBindingPersistenceError",
)<{
  readonly operation: "register";
  readonly reason:
    | "invalidInput"
    | "authorityChanged"
    | "publicationMissing"
    | "publicationMismatch"
    | "conflictingReplay"
    | "storedState"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export interface ApplicationTaskBindingRepository {
  readonly register: (
    input: RegisterApplicationTaskBindingsInput,
  ) => Effect.Effect<
    ApplicationTaskBindingRegistration,
    ApplicationTaskBindingPersistenceError
  >;
}

export function makeApplicationTaskBindingRepository(
  db: FlarexMetadataDatabase,
): ApplicationTaskBindingRepository {
  const register = Effect.fn("ApplicationTaskBindingRepository.register")(
    function* (input: RegisterApplicationTaskBindingsInput): Effect.fn.Return<
      ApplicationTaskBindingRegistration,
      ApplicationTaskBindingPersistenceError
    > {
      const prepared = yield* prepareRegistration(input);
      return yield* runTransaction(db, tx => registerInTransaction(tx, prepared));
    },
  );
  return Object.freeze({ register });
}

interface PreparedDefinition {
  readonly taskId: string;
  readonly canonicalTaskManifestSha256: Uint8Array;
  readonly logicalModulePath: string;
  readonly sourceModulePath: string;
  readonly exportName: string;
  readonly manifestBytes: Uint8Array;
  readonly bindingBytes: Uint8Array;
  readonly bindingSha256: Uint8Array;
}

interface PreparedRegistration {
  readonly authority: ApplicationAnalysisAuthority;
  readonly binding: PreparedApplicationTaskBindingsV1["catalog"]["binding"];
  readonly sourceRootBytes: Uint8Array;
  readonly publicationSha256Bytes: Uint8Array;
  readonly taskCatalogSha256Bytes: Uint8Array;
  readonly catalogBindingSha256Bytes: Uint8Array;
  readonly catalogBindingBytes: Uint8Array;
  readonly definitions: ReadonlyArray<PreparedDefinition>;
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

const prepareRegistration = Effect.fn("ApplicationTaskBinding.prepare")(
  function* (
    input: RegisterApplicationTaskBindingsInput,
  ): Effect.fn.Return<
    PreparedRegistration,
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

    const definitions: PreparedDefinition[] = [];
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
  },
);

function registerInTransaction(
  tx: AppRowTransaction,
  prepared: PreparedRegistration,
): Effect.Effect<
  ApplicationTaskBindingRegistration,
  ApplicationTaskBindingPersistenceError
> {
  return Effect.gen(function* () {
    yield* requireExactAuthority(tx, prepared.authority);
    const candidateRows = yield* query(
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId, prepared.authority.scopeId),
        eq(fxSystemApplicationCandidatesV1.candidateId,
          prepared.binding.candidateId),
      )).limit(1).for("update"),
    );
    const candidate = candidateRows[0];
    if (
      candidate === undefined ||
      candidate.storageGeneration !== prepared.authority.storageGeneration ||
      candidate.storageGenerationFence !==
        prepared.authority.storageGenerationFence ||
      candidate.epoch !== prepared.authority.epoch
    ) return yield* failure("authorityChanged");
    const publicationRows = yield* query(
      tx.select().from(fxSystemApplicationPublicationsV1).where(and(
        eq(fxSystemApplicationPublicationsV1.scopeId, prepared.authority.scopeId),
        eq(fxSystemApplicationPublicationsV1.revisionId,
          prepared.binding.revisionId),
      )).limit(1).for("update"),
    );
    const publication = publicationRows[0];
    if (publication === undefined) return yield* failure("publicationMissing");
    if (
      publication.candidateId !== prepared.binding.candidateId ||
      publication.analysisId !== prepared.binding.analysisId ||
      !bytesEqualFullScan(
        publication.sourceArtifactRootSha256,
        prepared.sourceRootBytes,
      ) || !bytesEqualFullScan(
        publication.publicationSha256,
        prepared.publicationSha256Bytes,
      )
    ) return yield* failure("publicationMismatch");

    const registeredAt = yield* databaseTime(tx, prepared.authority.scopeId);
    const inserted = yield* query(
      tx.insert(fxSystemApplicationTaskCatalogsV1).values({
        scopeId: prepared.authority.scopeId,
        revisionId: prepared.binding.revisionId,
        candidateId: prepared.binding.candidateId,
        analysisId: prepared.binding.analysisId,
        sourceArtifactRootSha256: prepared.sourceRootBytes,
        publicationSha256: prepared.publicationSha256Bytes,
        taskCatalogSha256: prepared.taskCatalogSha256Bytes,
        taskCatalogBindingSha256: prepared.catalogBindingSha256Bytes,
        taskCount: prepared.binding.taskCount,
        runtimeHostIdentity: prepared.binding.runtimeHostIdentity,
        compatibilityDate: prepared.binding.compatibilityDate,
        bindingBytes: prepared.catalogBindingBytes,
        registeredAt,
      }).onConflictDoNothing().returning({
        revisionId: fxSystemApplicationTaskCatalogsV1.revisionId,
      }),
    );
    if (inserted.length === 1) {
      if (prepared.definitions.length > 0) {
        yield* execute(tx.insert(fxSystemApplicationTaskDefinitionsV1).values(
          prepared.definitions.map(definition => ({
            scopeId: prepared.authority.scopeId,
            revisionId: prepared.binding.revisionId,
            taskCatalogBindingSha256: prepared.catalogBindingSha256Bytes,
            taskDefinitionBindingSha256: definition.bindingSha256,
            taskId: definition.taskId,
            canonicalTaskManifestSha256:
              definition.canonicalTaskManifestSha256,
            logicalModulePath: definition.logicalModulePath,
            sourceModulePath: definition.sourceModulePath,
            exportName: definition.exportName,
            manifestBytes: definition.manifestBytes,
            bindingBytes: definition.bindingBytes,
          })),
        ));
      }
      return projection(prepared, registeredAt);
    }
    return yield* loadExactReplay(tx, prepared);
  });
}

function loadExactReplay(
  tx: AppRowTransaction,
  prepared: PreparedRegistration,
): Effect.Effect<
  ApplicationTaskBindingRegistration,
  ApplicationTaskBindingPersistenceError
> {
  return Effect.gen(function* () {
    const rows = yield* query(
      tx.select().from(fxSystemApplicationTaskCatalogsV1).where(and(
        eq(fxSystemApplicationTaskCatalogsV1.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationTaskCatalogsV1.revisionId,
          prepared.binding.revisionId),
      )).limit(1),
    );
    const row = rows[0];
    if (
      row === undefined || row.candidateId !== prepared.binding.candidateId ||
      row.analysisId !== prepared.binding.analysisId ||
      row.taskCount !== prepared.binding.taskCount ||
      row.runtimeHostIdentity !== prepared.binding.runtimeHostIdentity ||
      row.compatibilityDate !== prepared.binding.compatibilityDate ||
      !bytesEqualFullScan(row.sourceArtifactRootSha256, prepared.sourceRootBytes) ||
      !bytesEqualFullScan(row.publicationSha256,
        prepared.publicationSha256Bytes) ||
      !bytesEqualFullScan(row.taskCatalogSha256,
        prepared.taskCatalogSha256Bytes) ||
      !bytesEqualFullScan(row.taskCatalogBindingSha256,
        prepared.catalogBindingSha256Bytes) ||
      !bytesEqualFullScan(row.bindingBytes, prepared.catalogBindingBytes)
    ) return yield* failure("conflictingReplay");
    const definitionRows = yield* query(
      tx.select().from(fxSystemApplicationTaskDefinitionsV1).where(and(
        eq(fxSystemApplicationTaskDefinitionsV1.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationTaskDefinitionsV1.revisionId,
          prepared.binding.revisionId),
      )),
    );
    const definitionsByTaskId = new Map(
      definitionRows.map(definition => [definition.taskId, definition]),
    );
    if (
      definitionRows.length !== prepared.definitions.length ||
      prepared.definitions.some(expected => {
        const stored = definitionsByTaskId.get(expected.taskId);
        return stored === undefined ||
          stored.logicalModulePath !== expected.logicalModulePath ||
          stored.sourceModulePath !== expected.sourceModulePath ||
          stored.exportName !== expected.exportName ||
          !bytesEqualFullScan(stored.taskCatalogBindingSha256,
            prepared.catalogBindingSha256Bytes) ||
          !bytesEqualFullScan(stored.taskDefinitionBindingSha256,
            expected.bindingSha256) ||
          !bytesEqualFullScan(stored.canonicalTaskManifestSha256,
            expected.canonicalTaskManifestSha256) ||
          !bytesEqualFullScan(stored.manifestBytes, expected.manifestBytes) ||
          !bytesEqualFullScan(stored.bindingBytes, expected.bindingBytes);
      })
    ) return yield* failure("conflictingReplay");
    const registeredAt = databaseTimestampFromUnknown(row.registeredAt);
    return registeredAt === null
      ? yield* failure("storedState")
      : projection(prepared, registeredAt);
  });
}

function projection(
  prepared: PreparedRegistration,
  registeredAt: Date,
): ApplicationTaskBindingRegistration {
  return Object.freeze({
    scopeId: prepared.authority.scopeId,
    revisionId: prepared.binding.revisionId,
    candidateId: prepared.binding.candidateId,
    analysisId: prepared.binding.analysisId,
    sourceArtifactRootSha256: prepared.binding.sourceArtifactRootSha256,
    publicationSha256: prepared.binding.publicationSha256,
    taskCatalogSha256:
      encodeBytesToLowercaseHex(prepared.taskCatalogSha256Bytes),
    taskCatalogBindingSha256:
      encodeBytesToLowercaseHex(prepared.catalogBindingSha256Bytes),
    taskCount: prepared.binding.taskCount,
    runtimeHostIdentity: prepared.binding.runtimeHostIdentity,
    compatibilityDate: prepared.binding.compatibilityDate,
    registeredAt: new Date(registeredAt.getTime()),
  });
}

function requireExactAuthority(
  tx: AppRowTransaction,
  authority: ApplicationAnalysisAuthority,
): Effect.Effect<void, ApplicationTaskBindingPersistenceError> {
  return Effect.gen(function* () {
    const rows = yield* query(
      tx.select().from(fxSystemScopeClocks).where(
        eq(fxSystemScopeClocks.scopeId, authority.scopeId),
      ).limit(1).for("update"),
    );
    const clock = rows[0];
    if (
      clock === undefined ||
      clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence ||
      clock.epoch !== authority.epoch
    ) return yield* failure("authorityChanged");
  });
}

function databaseTime(
  tx: AppRowTransaction,
  scopeId: ApplicationAnalysisAuthority["scopeId"],
): Effect.Effect<Date, ApplicationTaskBindingPersistenceError> {
  return query(
    tx.select({ now: sql<Date>`current_timestamp` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
  ).pipe(Effect.flatMap(rows => {
    const date = databaseTimestampFromUnknown(rows[0]?.now);
    return date === null ? failure("storedState") : Effect.succeed(date);
  }));
}

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationTaskBindingPersistenceError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => failureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  });
}

function execute(
  statement: PromiseLike<unknown>,
): Effect.Effect<void, ApplicationTaskBindingPersistenceError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => failureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  }).pipe(Effect.asVoid);
}

function runTransaction<A>(
  db: FlarexMetadataDatabase,
  body: (tx: AppRowTransaction) => Effect.Effect<
    A,
    ApplicationTaskBindingPersistenceError
  >,
): Effect.Effect<A, ApplicationTaskBindingPersistenceError> {
  return runEffectTransaction(
    callback => db.transaction(callback),
    "Application task-binding transaction rolled back.",
    body,
    cause => failureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  );
}

function sha256(
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, ApplicationTaskBindingPersistenceError> {
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

function isRetryableTransactionCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  try {
    const code = Reflect.get(cause, "code");
    return code === "40001" || code === "40P01";
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
