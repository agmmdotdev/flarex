import { bytesEqual } from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  CanonicalSchemaManifestBytesSchema,
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  canonicalizeSchemaManifestV1,
  decodeCanonicalSchemaManifestBytes,
  decodeSchemaManifestSha256,
  SchemaManifestCodecVersionSchema,
  SchemaManifestJsonSchema,
  SchemaManifestSha256Schema,
  type CanonicalSchemaManifestBytes,
  type CanonicalSchemaManifestV1,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestCodecVersion,
  type SchemaManifestJson,
  type SchemaManifestSha256,
} from "flarex-protocol/schema-manifest";

import type { FlarexMetadataDatabase } from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { deployments, fxControlSchemaVersions } from "./schema";

export interface SchemaVersionArtifactIdentity {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export interface SchemaVersionArtifact extends SchemaVersionArtifactIdentity {
  readonly version: CatalogSchemaVersion;
  readonly manifestCodecVersion: SchemaManifestCodecVersion;
  readonly manifestJson: SchemaManifestJson;
  readonly manifestBytes: CanonicalSchemaManifestBytes;
  readonly manifestSha256: SchemaManifestSha256;
  readonly createdAt: Date;
}

export interface EnsureSchemaVersionArtifactInput
  extends SchemaVersionArtifactIdentity {
  readonly version: CatalogSchemaVersion;
  readonly manifest: SchemaManifestJson;
  readonly manifestCodecVersion?: never;
  readonly manifestJson?: never;
  readonly manifestBytes?: never;
  readonly manifestSha256?: never;
  readonly createdAt?: never;
}

const preparedSchemaVersionArtifactBrand: unique symbol = Symbol(
  "FlarexDB/PreparedSchemaVersionArtifact",
);

export interface PreparedSchemaVersionArtifact
  extends SchemaVersionArtifactIdentity {
  readonly version: CatalogSchemaVersion;
  readonly [preparedSchemaVersionArtifactBrand]: true;
}

export type EnsureSchemaVersionArtifactResult =
  | {
      readonly status: "created";
      readonly artifact: SchemaVersionArtifact;
    }
  | {
      readonly status: "existing";
      readonly artifact: SchemaVersionArtifact;
    };

export type SchemaVersionArtifactTransaction = FlarexMetadataTransaction;

const forbiddenInputFields = [
  "manifestCodecVersion",
  "manifestJson",
  "manifestBytes",
  "manifestSha256",
  "createdAt",
] as const;
const decodeCanonicalSchemaManifestBytesResult = Schema.decodeUnknownResult(
  CanonicalSchemaManifestBytesSchema,
);
const decodeCatalogSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);
const decodeCatalogSchemaVersionResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionSchema,
);
const decodeSchemaManifestCodecVersionResult = Schema.decodeUnknownResult(
  SchemaManifestCodecVersionSchema,
);
const decodeSchemaManifestJsonResult = Schema.decodeUnknownResult(
  SchemaManifestJsonSchema,
);
const decodeSchemaManifestSha256Result = Schema.decodeUnknownResult(
  SchemaManifestSha256Schema,
);

type ForbiddenSchemaVersionArtifactInputField =
  (typeof forbiddenInputFields)[number];

export class InvalidSchemaVersionArtifactInputError extends Error {
  readonly _tag = "InvalidSchemaVersionArtifactInputError" as const;

  constructor(
    readonly field:
      | "deploymentId"
      | "schemaVersionId"
      | "version"
      | "manifest"
      | ForbiddenSchemaVersionArtifactInputField,
    options?: ErrorOptions,
  ) {
    super(`Schema version artifact ${field} is invalid.`, options);
    this.name = "InvalidSchemaVersionArtifactInputError";
  }
}

export class InvalidPreparedSchemaVersionArtifactError extends Error {
  readonly _tag = "InvalidPreparedSchemaVersionArtifactError" as const;

  constructor() {
    super(
      "Schema version artifact transaction input was not prepared by this repository instance.",
    );
    this.name = "InvalidPreparedSchemaVersionArtifactError";
  }
}

export class SchemaVersionArtifactPreparationError extends Error {
  readonly _tag = "SchemaVersionArtifactPreparationError" as const;

  constructor(readonly deploymentId: string, options?: ErrorOptions) {
    super(
      `Schema version artifact canonical encoding or SHA-256 failed for ${deploymentId}.`,
      options,
    );
    this.name = "SchemaVersionArtifactPreparationError";
  }
}

export type PrepareSchemaVersionArtifactError =
  | InvalidSchemaVersionArtifactInputError
  | SchemaVersionArtifactPreparationError;

export class SchemaVersionArtifactDeploymentNotFoundError extends Error {
  readonly _tag = "SchemaVersionArtifactDeploymentNotFoundError" as const;

  constructor(readonly deploymentId: string) {
    super(
      `Cannot persist a schema version artifact for missing deployment: ${deploymentId}`,
    );
    this.name = "SchemaVersionArtifactDeploymentNotFoundError";
  }
}

export type SchemaVersionArtifactConflict =
  | {
      readonly reason: "schemaVersionIdReused";
      readonly deploymentId: string;
      readonly schemaVersionId: CatalogSchemaVersionId;
      readonly requestedVersion: CatalogSchemaVersion;
      readonly existingVersion: CatalogSchemaVersion;
    }
  | {
      readonly reason: "versionReused";
      readonly deploymentId: string;
      readonly version: CatalogSchemaVersion;
      readonly requestedSchemaVersionId: CatalogSchemaVersionId;
      readonly existingSchemaVersionId: CatalogSchemaVersionId;
    }
  | {
      readonly reason: "artifactMismatch";
      readonly deploymentId: string;
      readonly schemaVersionId: CatalogSchemaVersionId;
      readonly version: CatalogSchemaVersion;
    };

export class SchemaVersionArtifactConflictError extends Error {
  readonly _tag = "SchemaVersionArtifactConflictError" as const;

  constructor(readonly conflict: SchemaVersionArtifactConflict) {
    super(schemaVersionArtifactConflictMessage(conflict));
    this.name = "SchemaVersionArtifactConflictError";
  }
}

export class SchemaManifestChecksumCollisionError extends Error {
  readonly _tag = "SchemaManifestChecksumCollisionError" as const;

  constructor(
    readonly deploymentId: string,
    readonly schemaVersionId: CatalogSchemaVersionId,
    readonly version: CatalogSchemaVersion,
  ) {
    super(
      `Schema manifests have equal SHA-256 but unequal canonical bytes for ${deploymentId}/${schemaVersionId} version ${version}.`,
    );
    this.name = "SchemaManifestChecksumCollisionError";
  }
}

export class SchemaVersionArtifactCorruptionError extends Error {
  readonly _tag = "SchemaVersionArtifactCorruptionError" as const;

  constructor(
    readonly deploymentId: string,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(
      `Schema version artifact is corrupt for ${deploymentId}: ${detail}`,
      options,
    );
    this.name = "SchemaVersionArtifactCorruptionError";
  }
}

export class SchemaVersionArtifactPersistenceError extends Data.TaggedError(
  "SchemaVersionArtifactPersistenceError",
)<{
  readonly operation:
    | "lockDeployment"
    | "readById"
    | "readByVersion"
    | "insert";
  readonly cause: unknown;
}> {}

export type EnsureSchemaVersionArtifactError =
  | InvalidPreparedSchemaVersionArtifactError
  | SchemaVersionArtifactPersistenceError
  | SchemaVersionArtifactDeploymentNotFoundError
  | SchemaVersionArtifactConflictError
  | SchemaManifestChecksumCollisionError
  | SchemaVersionArtifactCorruptionError;

export type VerifyPreparedSchemaVersionArtifactError =
  | InvalidPreparedSchemaVersionArtifactError
  | SchemaVersionArtifactPersistenceError
  | SchemaVersionArtifactConflictError
  | SchemaManifestChecksumCollisionError
  | SchemaVersionArtifactCorruptionError;

export type ReadSchemaVersionArtifactError =
  | InvalidSchemaVersionArtifactInputError
  | SchemaVersionArtifactPersistenceError
  | SchemaVersionArtifactCorruptionError;

interface SchemaVersionArtifactVersionIdentity
  extends SchemaVersionArtifactIdentity {
  readonly version: CatalogSchemaVersion;
}

interface ValidatedSchemaVersionArtifactInput
  extends SchemaVersionArtifactVersionIdentity {
  readonly manifest: SchemaManifestJson;
}

interface PreparedSchemaVersionArtifactState
  extends ValidatedSchemaVersionArtifactInput {
  readonly canonical: CanonicalSchemaManifestV1;
}

const preparedSchemaVersionArtifactStates = new WeakMap<
  PreparedSchemaVersionArtifact,
  PreparedSchemaVersionArtifactState
>();

/** Validate, canonicalize, and hash one trusted artifact before opening SQL. */
export const prepareSchemaVersionArtifactEffect = Effect.fn(
  "SchemaVersionArtifacts.prepare",
)(function* (
  input: EnsureSchemaVersionArtifactInput,
): Effect.fn.Return<
  PreparedSchemaVersionArtifact,
  PrepareSchemaVersionArtifactError
> {
  const validated = yield* Effect.fromResult(validateEnsureInputResult(input));
  const canonical = yield* Effect.tryPromise({
    try: () => canonicalizeSchemaManifestV1(validated.manifest),
    catch: (cause) => new SchemaVersionArtifactPreparationError(
      validated.deploymentId,
      { cause },
    ),
  });
  return makePreparedSchemaVersionArtifact(validated, canonical);
});

function makePreparedSchemaVersionArtifact(
  validated: ValidatedSchemaVersionArtifactInput,
  canonical: CanonicalSchemaManifestV1,
): PreparedSchemaVersionArtifact {
  const preparedValue = {
    deploymentId: validated.deploymentId,
    schemaVersionId: validated.schemaVersionId,
    version: validated.version,
    [preparedSchemaVersionArtifactBrand]: true,
  } satisfies PreparedSchemaVersionArtifact;
  const prepared = Object.freeze(preparedValue);
  preparedSchemaVersionArtifactStates.set(prepared, {
    ...validated,
    canonical,
  });
  return prepared;
}

/** Package-internal authenticated evidence for pre-transaction quota checks. */
export function getPreparedSchemaVersionArtifactCanonicalByteLength(
  artifact: PreparedSchemaVersionArtifact,
): number {
  const prepared = preparedSchemaVersionArtifactStates.get(artifact);
  if (prepared === undefined) {
    throw new InvalidPreparedSchemaVersionArtifactError();
  }
  return prepared.canonical.canonicalBytes.byteLength;
}

/**
 * Persist or replay one immutable schema-version artifact.
 *
 * The caller prepares the artifact before opening a short database
 * transaction. This phase only locks, resolves conflicts, verifies replay,
 * and inserts by comparing stored canonical byte/digest evidence. It performs
 * no canonical encoding, hashing, analyzer work, or user-code work.
 */
export const ensureSchemaVersionArtifactInTransactionEffect = Effect.fn(
  "SchemaVersionArtifacts.ensureInTransaction",
)(function* (
  tx: SchemaVersionArtifactTransaction,
  artifact: PreparedSchemaVersionArtifact,
): Effect.fn.Return<
  EnsureSchemaVersionArtifactResult,
  EnsureSchemaVersionArtifactError
> {
  const prepared = preparedSchemaVersionArtifactStates.get(artifact);
  if (prepared === undefined) {
    return yield* Effect.fail(new InvalidPreparedSchemaVersionArtifactError());
  }
  const deploymentQuery = tx
    .select({ deploymentId: deployments.deploymentId })
    .from(deployments)
    .where(eq(deployments.deploymentId, prepared.deploymentId))
    .limit(1)
    .for("update");
  const deploymentRows = yield* runSchemaVersionArtifactQueryEffect(
    "lockDeployment",
    deploymentQuery,
  );
  if (deploymentRows[0] === undefined) {
    return yield* Effect.fail(
      new SchemaVersionArtifactDeploymentNotFoundError(prepared.deploymentId),
    );
  }

  const byIdRow = yield* selectSchemaVersionArtifactByIdEffect(
    tx,
    prepared.deploymentId,
    prepared.schemaVersionId,
  );
  const byVersionRow = yield* selectSchemaVersionArtifactByVersionEffect(
    tx,
    prepared.deploymentId,
    prepared.version,
  );
  if (byIdRow === null && byVersionRow === null) {
    return yield* insertSchemaVersionArtifactEffect(
      tx,
      prepared,
      prepared.canonical,
    );
  }

  const existing = yield* Effect.fromResult(
    requireExactPreparedArtifactRowsResult(
      byIdRow,
      byVersionRow,
      prepared,
    ),
  );
  return { status: "existing", artifact: existing };
});

/**
 * Read back one prepared artifact using only its already-canonical evidence.
 *
 * D2c calls this after the owning deployment row has been locked and the
 * artifact has been ensured in the same transaction. This verifier performs
 * no canonical encoding, hashing, analyzer work, user-code work, or writes.
 */
export const verifyPreparedSchemaVersionArtifactInTransactionEffect = Effect.fn(
  "SchemaVersionArtifacts.verifyPreparedInTransaction",
)(function* (
  tx: SchemaVersionArtifactTransaction,
  artifact: PreparedSchemaVersionArtifact,
): Effect.fn.Return<
  SchemaVersionArtifact,
  VerifyPreparedSchemaVersionArtifactError
> {
  const prepared = preparedSchemaVersionArtifactStates.get(artifact);
  if (prepared === undefined) {
    return yield* Effect.fail(new InvalidPreparedSchemaVersionArtifactError());
  }
  const byIdRow = yield* selectSchemaVersionArtifactByIdEffect(
    tx,
    prepared.deploymentId,
    prepared.schemaVersionId,
  );
  const byVersionRow = yield* selectSchemaVersionArtifactByVersionEffect(
    tx,
    prepared.deploymentId,
    prepared.version,
  );
  return yield* Effect.fromResult(
    requireExactPreparedArtifactRowsResult(
      byIdRow,
      byVersionRow,
      prepared,
    ),
  );
});

/** Full JSON/byte/digest integrity read; keep it outside locked write phases. */
export const getSchemaVersionArtifactByIdEffect = Effect.fn(
  "SchemaVersionArtifacts.getById",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Effect.fn.Return<
  SchemaVersionArtifact | null,
  ReadSchemaVersionArtifactError
> {
  const validatedDeploymentId = yield* Effect.fromResult(
    validateDeploymentIdResult(deploymentId),
  );
  const decodedId = yield* Effect.fromResult(decodeInputFieldResult(
    "schemaVersionId",
    decodeCatalogSchemaVersionIdResult(schemaVersionId),
  ));
  return yield* readSchemaVersionArtifactByIdEffect(
    db,
    validatedDeploymentId,
    decodedId,
  );
});

/** Full JSON/byte/digest integrity read; keep it outside locked write phases. */
export const getSchemaVersionArtifactByVersionEffect = Effect.fn(
  "SchemaVersionArtifacts.getByVersion",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  version: CatalogSchemaVersion,
): Effect.fn.Return<
  SchemaVersionArtifact | null,
  ReadSchemaVersionArtifactError
> {
  const validatedDeploymentId = yield* Effect.fromResult(
    validateDeploymentIdResult(deploymentId),
  );
  const decodedVersion = yield* Effect.fromResult(decodeInputFieldResult(
    "version",
    decodeCatalogSchemaVersionResult(version),
  ));
  return yield* readSchemaVersionArtifactByVersionEffect(
    db,
    validatedDeploymentId,
    decodedVersion,
  );
});

/** Package-internal read for callers that already own validated identity. */
export const readSchemaVersionArtifactByIdEffect = Effect.fn(
  "SchemaVersionArtifacts.readById",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Effect.fn.Return<
  SchemaVersionArtifact | null,
  SchemaVersionArtifactPersistenceError | SchemaVersionArtifactCorruptionError
> {
  const row = yield* selectSchemaVersionArtifactByIdEffect(
    db,
    deploymentId,
    schemaVersionId,
  );
  return row === null
    ? null
    : yield* decodeSchemaVersionArtifactRowEffect(row);
});

const readSchemaVersionArtifactByVersionEffect = Effect.fn(
  "SchemaVersionArtifacts.readByVersion",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  version: CatalogSchemaVersion,
): Effect.fn.Return<
  SchemaVersionArtifact | null,
  SchemaVersionArtifactPersistenceError | SchemaVersionArtifactCorruptionError
> {
  const row = yield* selectSchemaVersionArtifactByVersionEffect(
    db,
    deploymentId,
    version,
  );
  return row === null
    ? null
    : yield* decodeSchemaVersionArtifactRowEffect(row);
});

const insertSchemaVersionArtifactEffect = Effect.fn(
  "SchemaVersionArtifacts.insert",
)(function* (
  tx: SchemaVersionArtifactTransaction,
  input: ValidatedSchemaVersionArtifactInput,
  canonical: CanonicalSchemaManifestV1,
): Effect.fn.Return<
  EnsureSchemaVersionArtifactResult,
  SchemaVersionArtifactPersistenceError | SchemaVersionArtifactCorruptionError
> {
  const query = tx
    .insert(fxControlSchemaVersions)
    .values({
      deploymentId: input.deploymentId,
      schemaVersionId: input.schemaVersionId,
      version: input.version,
      manifestCodecVersion: canonical.codecVersion,
      manifestJson: canonical.manifestJson,
      manifestBytes: copyCanonicalSchemaManifestBytes(
        canonical.canonicalBytes,
      ),
      manifestSha256: copySchemaManifestSha256(canonical.sha256),
    })
    .returning({ createdAt: fxControlSchemaVersions.createdAt });
  const rows = yield* runSchemaVersionArtifactQueryEffect("insert", query);
  const createdAt = copyFiniteDate(rows[0]?.createdAt);
  if (createdAt === undefined) {
    return yield* Effect.fail(
      new SchemaVersionArtifactCorruptionError(
        input.deploymentId,
        "insert returned no valid creation timestamp",
      ),
    );
  }
  return {
    status: "created",
    artifact: artifactFromCanonical(input, canonical, createdAt),
  } satisfies EnsureSchemaVersionArtifactResult;
});

function validateEnsureInputResult(
  input: EnsureSchemaVersionArtifactInput,
): Result.Result<
  ValidatedSchemaVersionArtifactInput,
  InvalidSchemaVersionArtifactInputError
> {
  for (const field of forbiddenInputFields) {
    if (Object.hasOwn(input, field)) {
      return Result.fail(new InvalidSchemaVersionArtifactInputError(field));
    }
  }
  if (!isNonBlankString(input.deploymentId)) {
    return Result.fail(
      new InvalidSchemaVersionArtifactInputError("deploymentId"),
    );
  }
  return Result.gen(function* () {
    const schemaVersionId = yield* decodeInputFieldResult(
      "schemaVersionId",
      decodeCatalogSchemaVersionIdResult(input.schemaVersionId),
    );
    const version = yield* decodeInputFieldResult(
      "version",
      decodeCatalogSchemaVersionResult(input.version),
    );
    const manifest = yield* decodeInputFieldResult(
      "manifest",
      decodeSchemaManifestJsonResult(input.manifest),
    );
    return {
      deploymentId: input.deploymentId,
      schemaVersionId,
      version,
      manifest,
    } satisfies ValidatedSchemaVersionArtifactInput;
  });
}

function validateDeploymentIdResult(
  deploymentId: string,
): Result.Result<string, InvalidSchemaVersionArtifactInputError> {
  if (!isNonBlankString(deploymentId)) {
    return Result.fail(
      new InvalidSchemaVersionArtifactInputError("deploymentId"),
    );
  }
  return Result.succeed(deploymentId);
}

function decodeInputFieldResult<Value>(
  field: "schemaVersionId" | "version" | "manifest",
  result: Result.Result<Value, unknown>,
): Result.Result<Value, InvalidSchemaVersionArtifactInputError> {
  return result.pipe(
    Result.mapError((cause) => new InvalidSchemaVersionArtifactInputError(
      field,
      { cause },
    )),
  );
}

const selectSchemaVersionArtifactByIdEffect = Effect.fn(
  "SchemaVersionArtifacts.selectById",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Effect.fn.Return<
  SchemaVersionArtifactRow | null,
  SchemaVersionArtifactPersistenceError
> {
  const query = selectSchemaVersionArtifactByIdQuery(
    db,
    deploymentId,
    schemaVersionId,
  );
  const rows = yield* runSchemaVersionArtifactQueryEffect("readById", query);
  return rows[0] ?? null;
});

function selectSchemaVersionArtifactByIdQuery(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
) {
  return db
    .select()
    .from(fxControlSchemaVersions)
    .where(
      and(
        eq(fxControlSchemaVersions.deploymentId, deploymentId),
        eq(fxControlSchemaVersions.schemaVersionId, schemaVersionId),
      ),
    )
    .limit(1);
}

const selectSchemaVersionArtifactByVersionEffect = Effect.fn(
  "SchemaVersionArtifacts.selectByVersion",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  version: CatalogSchemaVersion,
): Effect.fn.Return<
  SchemaVersionArtifactRow | null,
  SchemaVersionArtifactPersistenceError
> {
  const query = selectSchemaVersionArtifactByVersionQuery(
    db,
    deploymentId,
    version,
  );
  const rows = yield* runSchemaVersionArtifactQueryEffect(
    "readByVersion",
    query,
  );
  return rows[0] ?? null;
});

function selectSchemaVersionArtifactByVersionQuery(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  version: CatalogSchemaVersion,
) {
  return db
    .select()
    .from(fxControlSchemaVersions)
    .where(
      and(
        eq(fxControlSchemaVersions.deploymentId, deploymentId),
        eq(fxControlSchemaVersions.version, version),
      ),
    )
    .limit(1);
}

const runSchemaVersionArtifactQueryEffect = Effect.fn(<Value>(
  operation: SchemaVersionArtifactPersistenceError["operation"],
  query: PromiseLike<Value>,
): Effect.Effect<Value, SchemaVersionArtifactPersistenceError> =>
  Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new SchemaVersionArtifactPersistenceError({
      operation,
      cause,
    }),
  })));

export type SchemaVersionArtifactRow =
  typeof fxControlSchemaVersions.$inferSelect;

interface StoredSchemaVersionArtifact
  extends SchemaVersionArtifactVersionIdentity {
  readonly manifestCodecVersion: SchemaManifestCodecVersion;
  readonly manifestJson: SchemaManifestJson;
  readonly manifestBytes: CanonicalSchemaManifestBytes;
  readonly manifestSha256: SchemaManifestSha256;
  readonly createdAt: Date;
}

const decodeSchemaVersionArtifactRowEffect = Effect.fn(
  "SchemaVersionArtifacts.decodeRow",
)(function* (
  row: SchemaVersionArtifactRow,
): Effect.fn.Return<
  SchemaVersionArtifact,
  SchemaVersionArtifactCorruptionError
> {
  const stored = yield* Effect.fromResult(
    decodeStoredSchemaVersionArtifactRowResult(row),
  );
  const canonical = yield* Effect.tryPromise({
    try: () => canonicalizeSchemaManifestV1(stored.manifestJson),
    catch: (cause) => new SchemaVersionArtifactCorruptionError(
      stored.deploymentId,
      "manifest JSON cannot be canonicalized",
      { cause },
    ),
  });
  if (stored.manifestCodecVersion !== canonical.codecVersion) {
    return yield* Effect.fail(new SchemaVersionArtifactCorruptionError(
      stored.deploymentId,
      "manifest codec does not match canonical artifact",
    ));
  }
  if (!bytesEqual(stored.manifestBytes, canonical.canonicalBytes)) {
    return yield* Effect.fail(new SchemaVersionArtifactCorruptionError(
      stored.deploymentId,
      "stored manifest bytes do not match manifest JSON",
    ));
  }
  if (!bytesEqual(stored.manifestSha256, canonical.sha256)) {
    return yield* Effect.fail(new SchemaVersionArtifactCorruptionError(
      stored.deploymentId,
      "stored manifest SHA-256 does not match canonical bytes",
    ));
  }

  return artifactFromCanonical(stored, canonical, stored.createdAt);
});

function decodeStoredSchemaVersionArtifactRowResult(
  row: SchemaVersionArtifactRow,
): Result.Result<
  StoredSchemaVersionArtifact,
  SchemaVersionArtifactCorruptionError
> {
  if (!isNonBlankString(row.deploymentId)) {
    return Result.fail(
      new SchemaVersionArtifactCorruptionError(
        row.deploymentId,
        "deployment ID is blank",
      ),
    );
  }
  return Result.gen(function* () {
    const schemaVersionId = yield* decodeStoredValueResult(
      row.deploymentId,
      "schema version ID",
      decodeCatalogSchemaVersionIdResult(row.schemaVersionId),
    );
    const version = yield* decodeStoredValueResult(
      row.deploymentId,
      "version",
      decodeCatalogSchemaVersionResult(row.version),
    );
    const manifestCodecVersion = yield* decodeStoredValueResult(
      row.deploymentId,
      "manifest codec version",
      decodeSchemaManifestCodecVersionResult(row.manifestCodecVersion),
    );
    const manifestBytes = yield* decodeStoredValueResult(
      row.deploymentId,
      "manifest bytes",
      decodeCanonicalSchemaManifestBytesResult(row.manifestBytes),
    );
    const manifestSha256 = yield* decodeStoredValueResult(
      row.deploymentId,
      "manifest SHA-256",
      decodeSchemaManifestSha256Result(row.manifestSha256),
    );
    const createdAt = copyFiniteDate(row.createdAt);
    if (createdAt === undefined) {
      return yield* Result.fail(new SchemaVersionArtifactCorruptionError(
        row.deploymentId,
        "creation timestamp is invalid",
      ));
    }
    return {
      deploymentId: row.deploymentId,
      schemaVersionId,
      version,
      manifestCodecVersion,
      manifestJson: row.manifestJson,
      manifestBytes,
      manifestSha256,
      createdAt,
    } satisfies StoredSchemaVersionArtifact;
  });
}

function artifactFromCanonical(
  input: SchemaVersionArtifactVersionIdentity,
  canonical: CanonicalSchemaManifestV1,
  createdAt: Date,
): SchemaVersionArtifact {
  return {
    deploymentId: input.deploymentId,
    schemaVersionId: input.schemaVersionId,
    version: input.version,
    manifestCodecVersion: canonical.codecVersion,
    manifestJson: canonical.manifestJson,
    manifestBytes: copyCanonicalSchemaManifestBytes(canonical.canonicalBytes),
    manifestSha256: copySchemaManifestSha256(canonical.sha256),
    createdAt,
  } satisfies SchemaVersionArtifact;
}

function sameArtifactRow(
  left: SchemaVersionArtifactRow | null,
  right: SchemaVersionArtifactRow,
): boolean {
  return left !== null &&
    left.deploymentId === right.deploymentId &&
    left.schemaVersionId === right.schemaVersionId &&
    left.version === right.version;
}

function requireExactPreparedArtifactRowsResult(
  byIdRow: SchemaVersionArtifactRow | null,
  byVersionRow: SchemaVersionArtifactRow | null,
  prepared: PreparedSchemaVersionArtifactState,
): Result.Result<
  SchemaVersionArtifact,
  | SchemaVersionArtifactConflictError
  | SchemaManifestChecksumCollisionError
  | SchemaVersionArtifactCorruptionError
> {
  return Result.gen(function* () {
    const byId = byIdRow === null
      ? null
      : yield* decodeStoredSchemaVersionArtifactRowResult(byIdRow);
    const byVersion = byVersionRow === null
      ? null
      : sameArtifactRow(byIdRow, byVersionRow) && byId !== null
        ? byId
        : yield* decodeStoredSchemaVersionArtifactRowResult(byVersionRow);

    if (byId !== null && byId.version !== prepared.version) {
      return yield* Result.fail(new SchemaVersionArtifactConflictError({
        reason: "schemaVersionIdReused",
        deploymentId: prepared.deploymentId,
        schemaVersionId: prepared.schemaVersionId,
        requestedVersion: prepared.version,
        existingVersion: byId.version,
      }));
    }
    if (
      byVersion !== null &&
      byVersion.schemaVersionId !== prepared.schemaVersionId
    ) {
      return yield* Result.fail(new SchemaVersionArtifactConflictError({
        reason: "versionReused",
        deploymentId: prepared.deploymentId,
        version: prepared.version,
        requestedSchemaVersionId: prepared.schemaVersionId,
        existingSchemaVersionId: byVersion.schemaVersionId,
      }));
    }
    if (byId === null || byVersion === null || byId !== byVersion) {
      return yield* Result.fail(new SchemaVersionArtifactCorruptionError(
        prepared.deploymentId,
        "ID and version lookups did not resolve the same artifact",
      ));
    }
    return yield* requireExactArtifactReplayResult(byId, prepared);
  });
}

function requireExactArtifactReplayResult(
  existing: StoredSchemaVersionArtifact,
  requested: PreparedSchemaVersionArtifactState,
): Result.Result<
  SchemaVersionArtifact,
  | SchemaVersionArtifactConflictError
  | SchemaManifestChecksumCollisionError
  | SchemaVersionArtifactCorruptionError
> {
  if (existing.manifestCodecVersion !== requested.canonical.codecVersion) {
    return Result.fail(new SchemaVersionArtifactCorruptionError(
      existing.deploymentId,
      "stored manifest codec does not match prepared artifact",
    ));
  }
  if (
    bytesEqual(existing.manifestBytes, requested.canonical.canonicalBytes)
  ) {
    if (!bytesEqual(existing.manifestSha256, requested.canonical.sha256)) {
      return Result.fail(new SchemaVersionArtifactCorruptionError(
        existing.deploymentId,
        "stored manifest SHA-256 does not match equal canonical bytes",
      ));
    }
    if (
      !jsonValuesEqual(
        existing.manifestJson,
        requested.canonical.manifestJson,
      )
    ) {
      return Result.fail(new SchemaVersionArtifactCorruptionError(
        existing.deploymentId,
        "stored manifest JSON does not match equal canonical bytes",
      ));
    }
    return Result.succeed(artifactFromCanonical(
      requested,
      requested.canonical,
      existing.createdAt,
    ));
  }
  if (bytesEqual(existing.manifestSha256, requested.canonical.sha256)) {
    return Result.fail(new SchemaManifestChecksumCollisionError(
      existing.deploymentId,
      existing.schemaVersionId,
      existing.version,
    ));
  }
  return Result.fail(new SchemaVersionArtifactConflictError({
    reason: "artifactMismatch",
    deploymentId: existing.deploymentId,
    schemaVersionId: existing.schemaVersionId,
    version: existing.version,
  }));
}

function copyCanonicalSchemaManifestBytes(
  value: CanonicalSchemaManifestBytes,
): CanonicalSchemaManifestBytes {
  return decodeCanonicalSchemaManifestBytes(new Uint8Array(value));
}

function copySchemaManifestSha256(
  value: SchemaManifestSha256,
): SchemaManifestSha256 {
  return decodeSchemaManifestSha256(new Uint8Array(value));
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((value, index) =>
      jsonValuesEqual(value, right[index])
    );
  }
  if (!isNonArrayRecord(left) || !isNonArrayRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (const [index, key] of leftKeys.entries()) {
    if (key !== rightKeys[index] || !Object.hasOwn(right, key)) return false;
    if (!jsonValuesEqual(left[key], right[key])) return false;
  }
  return true;
}

function decodeStoredValueResult<Value>(
  deploymentId: string,
  field: string,
  result: Result.Result<Value, unknown>,
): Result.Result<Value, SchemaVersionArtifactCorruptionError> {
  return result.pipe(
    Result.mapError((cause) => new SchemaVersionArtifactCorruptionError(
      deploymentId,
      `${field} is invalid`,
      { cause },
    )),
  );
}

function schemaVersionArtifactConflictMessage(
  conflict: SchemaVersionArtifactConflict,
): string {
  switch (conflict.reason) {
    case "schemaVersionIdReused":
      return `Schema version ID ${conflict.schemaVersionId} already owns version ${conflict.existingVersion}, not ${conflict.requestedVersion}.`;
    case "versionReused":
      return `Schema version ${conflict.version} already belongs to ${conflict.existingSchemaVersionId}, not ${conflict.requestedSchemaVersionId}.`;
    case "artifactMismatch":
      return `Schema version artifact ${conflict.schemaVersionId} version ${conflict.version} is immutable and does not match the requested manifest.`;
    default:
      return assertNever(conflict);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled schema version artifact conflict: ${String(value)}`);
}
