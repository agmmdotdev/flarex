import { bytesEqual } from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import {
  canonicalizeSchemaManifestV1,
  decodeCanonicalSchemaManifestBytes,
  decodeCatalogSchemaVersion,
  decodeCatalogSchemaVersionId,
  decodeSchemaManifestJson,
  decodeSchemaManifestCodecVersion,
  decodeSchemaManifestSha256,
  type CanonicalSchemaManifestBytes,
  type CanonicalSchemaManifestV1,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestCodecVersion,
  type SchemaManifestJson,
  type SchemaManifestSha256,
} from "flarex-protocol/schema-manifest";

import type { FlarexMetadataDatabase } from "./deployments";
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

export type SchemaVersionArtifactTransaction = FlarexMetadataDatabase & {
  rollback(): never;
  setTransaction(config: PgTransactionConfig): Promise<void>;
};

const forbiddenInputFields = [
  "manifestCodecVersion",
  "manifestJson",
  "manifestBytes",
  "manifestSha256",
  "createdAt",
] as const;

type ForbiddenSchemaVersionArtifactInputField =
  (typeof forbiddenInputFields)[number];

export class InvalidSchemaVersionArtifactInputError extends Error {
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
  constructor() {
    super(
      "Schema version artifact transaction input was not prepared by this repository instance.",
    );
    this.name = "InvalidPreparedSchemaVersionArtifactError";
  }
}

export class SchemaVersionArtifactPreparationError extends Error {
  constructor(readonly deploymentId: string, options?: ErrorOptions) {
    super(
      `Schema version artifact canonical encoding or SHA-256 failed for ${deploymentId}.`,
      options,
    );
    this.name = "SchemaVersionArtifactPreparationError";
  }
}

export class SchemaVersionArtifactDeploymentNotFoundError extends Error {
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
  constructor(readonly conflict: SchemaVersionArtifactConflict) {
    super(schemaVersionArtifactConflictMessage(conflict));
    this.name = "SchemaVersionArtifactConflictError";
  }
}

export class SchemaManifestChecksumCollisionError extends Error {
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

/**
 * Validate, canonicalize, and hash one trusted artifact before opening SQL.
 *
 * The returned token is opaque and repository-owned. It exposes no canonical
 * bytes or checksum for callers to replace between preparation and commit.
 */
export async function prepareSchemaVersionArtifact(
  input: EnsureSchemaVersionArtifactInput,
): Promise<PreparedSchemaVersionArtifact> {
  const validated = validateEnsureInput(input);
  let canonical: CanonicalSchemaManifestV1;
  try {
    canonical = await canonicalizeSchemaManifestV1(validated.manifest);
  } catch (cause) {
    throw new SchemaVersionArtifactPreparationError(validated.deploymentId, {
      cause,
    });
  }
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
export async function ensureSchemaVersionArtifactInTransaction(
  tx: SchemaVersionArtifactTransaction,
  artifact: PreparedSchemaVersionArtifact,
): Promise<EnsureSchemaVersionArtifactResult> {
  const prepared = preparedSchemaVersionArtifactStates.get(artifact);
  if (prepared === undefined) {
    throw new InvalidPreparedSchemaVersionArtifactError();
  }
  const deploymentRows = await tx
    .select({ deploymentId: deployments.deploymentId })
    .from(deployments)
    .where(eq(deployments.deploymentId, prepared.deploymentId))
    .limit(1)
    .for("update");
  if (deploymentRows[0] === undefined) {
    throw new SchemaVersionArtifactDeploymentNotFoundError(
      prepared.deploymentId,
    );
  }

  const byIdRow = await selectSchemaVersionArtifactById(
    tx,
    prepared.deploymentId,
    prepared.schemaVersionId,
  );
  const byVersionRow = await selectSchemaVersionArtifactByVersion(
    tx,
    prepared.deploymentId,
    prepared.version,
  );
  if (byIdRow === null && byVersionRow === null) {
    return insertSchemaVersionArtifact(tx, prepared, prepared.canonical);
  }

  const existing = requireExactPreparedArtifactRows(
    byIdRow,
    byVersionRow,
    prepared,
  );
  return { status: "existing", artifact: existing };
}

/**
 * Read back one prepared artifact using only its already-canonical evidence.
 *
 * D2c calls this after the owning deployment row has been locked and the
 * artifact has been ensured in the same transaction. This verifier performs
 * no canonical encoding, hashing, analyzer work, user-code work, or writes.
 */
export async function verifyPreparedSchemaVersionArtifactInTransaction(
  tx: SchemaVersionArtifactTransaction,
  artifact: PreparedSchemaVersionArtifact,
): Promise<SchemaVersionArtifact> {
  const prepared = preparedSchemaVersionArtifactStates.get(artifact);
  if (prepared === undefined) {
    throw new InvalidPreparedSchemaVersionArtifactError();
  }
  const byIdRow = await selectSchemaVersionArtifactById(
    tx,
    prepared.deploymentId,
    prepared.schemaVersionId,
  );
  const byVersionRow = await selectSchemaVersionArtifactByVersion(
    tx,
    prepared.deploymentId,
    prepared.version,
  );
  return requireExactPreparedArtifactRows(byIdRow, byVersionRow, prepared);
}

/** Full JSON/byte/digest integrity read; keep it outside locked write phases. */
export async function getSchemaVersionArtifactById(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<SchemaVersionArtifact | null> {
  validateDeploymentId(deploymentId);
  const decodedId = decodeInputSchemaVersionId(schemaVersionId);
  const row = await selectSchemaVersionArtifactById(
    db,
    deploymentId,
    decodedId,
  );
  return row === null ? null : decodeSchemaVersionArtifactRow(row);
}

/** Full JSON/byte/digest integrity read; keep it outside locked write phases. */
export async function getSchemaVersionArtifactByVersion(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  version: CatalogSchemaVersion,
): Promise<SchemaVersionArtifact | null> {
  validateDeploymentId(deploymentId);
  const decodedVersion = decodeInputSchemaVersion(version);
  const row = await selectSchemaVersionArtifactByVersion(
    db,
    deploymentId,
    decodedVersion,
  );
  return row === null ? null : decodeSchemaVersionArtifactRow(row);
}

async function insertSchemaVersionArtifact(
  tx: SchemaVersionArtifactTransaction,
  input: ValidatedSchemaVersionArtifactInput,
  canonical: CanonicalSchemaManifestV1,
): Promise<EnsureSchemaVersionArtifactResult> {
  const rows = await tx
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
  const createdAt = rows[0]?.createdAt;
  if (!isValidDate(createdAt)) {
    throw new SchemaVersionArtifactCorruptionError(
      input.deploymentId,
      "insert returned no valid creation timestamp",
    );
  }
  return {
    status: "created",
    artifact: artifactFromCanonical(input, canonical, createdAt),
  } satisfies EnsureSchemaVersionArtifactResult;
}

function validateEnsureInput(
  input: EnsureSchemaVersionArtifactInput,
): ValidatedSchemaVersionArtifactInput {
  for (const field of forbiddenInputFields) {
    if (Object.hasOwn(input, field)) {
      throw new InvalidSchemaVersionArtifactInputError(field);
    }
  }
  validateDeploymentId(input.deploymentId);
  return {
    deploymentId: input.deploymentId,
    schemaVersionId: decodeInputSchemaVersionId(input.schemaVersionId),
    version: decodeInputSchemaVersion(input.version),
    manifest: decodeInputManifest(input.manifest),
  } satisfies ValidatedSchemaVersionArtifactInput;
}

function validateDeploymentId(deploymentId: string): void {
  if (typeof deploymentId !== "string" || deploymentId.trim().length === 0) {
    throw new InvalidSchemaVersionArtifactInputError("deploymentId");
  }
}

function decodeInputSchemaVersionId(value: unknown): CatalogSchemaVersionId {
  try {
    return decodeCatalogSchemaVersionId(value);
  } catch (cause) {
    throw new InvalidSchemaVersionArtifactInputError("schemaVersionId", {
      cause,
    });
  }
}

function decodeInputSchemaVersion(value: unknown): CatalogSchemaVersion {
  try {
    return decodeCatalogSchemaVersion(value);
  } catch (cause) {
    throw new InvalidSchemaVersionArtifactInputError("version", { cause });
  }
}

function decodeInputManifest(manifest: unknown): SchemaManifestJson {
  try {
    return decodeSchemaManifestJson(manifest);
  } catch (cause) {
    throw new InvalidSchemaVersionArtifactInputError("manifest", { cause });
  }
}

async function selectSchemaVersionArtifactById(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<SchemaVersionArtifactRow | null> {
  const rows = await db
    .select()
    .from(fxControlSchemaVersions)
    .where(
      and(
        eq(fxControlSchemaVersions.deploymentId, deploymentId),
        eq(fxControlSchemaVersions.schemaVersionId, schemaVersionId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function selectSchemaVersionArtifactByVersion(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  version: CatalogSchemaVersion,
): Promise<SchemaVersionArtifactRow | null> {
  const rows = await db
    .select()
    .from(fxControlSchemaVersions)
    .where(
      and(
        eq(fxControlSchemaVersions.deploymentId, deploymentId),
        eq(fxControlSchemaVersions.version, version),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

type SchemaVersionArtifactRow =
  typeof fxControlSchemaVersions.$inferSelect;

interface StoredSchemaVersionArtifact
  extends SchemaVersionArtifactVersionIdentity {
  readonly manifestCodecVersion: SchemaManifestCodecVersion;
  readonly manifestJson: SchemaManifestJson;
  readonly manifestBytes: CanonicalSchemaManifestBytes;
  readonly manifestSha256: SchemaManifestSha256;
  readonly createdAt: Date;
}

async function decodeSchemaVersionArtifactRow(
  row: SchemaVersionArtifactRow,
): Promise<SchemaVersionArtifact> {
  const stored = decodeStoredSchemaVersionArtifactRow(row);

  let canonical: CanonicalSchemaManifestV1;
  try {
    canonical = await canonicalizeSchemaManifestV1(stored.manifestJson);
  } catch (cause) {
    throw new SchemaVersionArtifactCorruptionError(
      stored.deploymentId,
      "manifest JSON cannot be canonicalized",
      { cause },
    );
  }
  if (stored.manifestCodecVersion !== canonical.codecVersion) {
    throw new SchemaVersionArtifactCorruptionError(
      stored.deploymentId,
      "manifest codec does not match canonical artifact",
    );
  }
  if (!bytesEqual(stored.manifestBytes, canonical.canonicalBytes)) {
    throw new SchemaVersionArtifactCorruptionError(
      stored.deploymentId,
      "stored manifest bytes do not match manifest JSON",
    );
  }
  if (!bytesEqual(stored.manifestSha256, canonical.sha256)) {
    throw new SchemaVersionArtifactCorruptionError(
      stored.deploymentId,
      "stored manifest SHA-256 does not match canonical bytes",
    );
  }

  return artifactFromCanonical(stored, canonical, stored.createdAt);
}

function decodeStoredSchemaVersionArtifactRow(
  row: SchemaVersionArtifactRow,
): StoredSchemaVersionArtifact {
  if (row.deploymentId.trim().length === 0) {
    throw new SchemaVersionArtifactCorruptionError(
      row.deploymentId,
      "deployment ID is blank",
    );
  }
  const schemaVersionId = decodeStoredValue(
    row.deploymentId,
    "schema version ID",
    () => decodeCatalogSchemaVersionId(row.schemaVersionId),
  );
  const version = decodeStoredValue(
    row.deploymentId,
    "version",
    () => decodeCatalogSchemaVersion(row.version),
  );
  const manifestCodecVersion = decodeStoredValue(
    row.deploymentId,
    "manifest codec version",
    () => decodeSchemaManifestCodecVersion(row.manifestCodecVersion),
  );
  const manifestBytes = decodeStoredValue(
    row.deploymentId,
    "manifest bytes",
    () => decodeCanonicalSchemaManifestBytes(row.manifestBytes),
  );
  const manifestSha256 = decodeStoredValue(
    row.deploymentId,
    "manifest SHA-256",
    () => decodeSchemaManifestSha256(row.manifestSha256),
  );
  if (!isValidDate(row.createdAt)) {
    throw new SchemaVersionArtifactCorruptionError(
      row.deploymentId,
      "creation timestamp is invalid",
    );
  }
  return {
    deploymentId: row.deploymentId,
    schemaVersionId,
    version,
    manifestCodecVersion,
    manifestJson: row.manifestJson,
    manifestBytes,
    manifestSha256,
    createdAt: row.createdAt,
  } satisfies StoredSchemaVersionArtifact;
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

function requireExactPreparedArtifactRows(
  byIdRow: SchemaVersionArtifactRow | null,
  byVersionRow: SchemaVersionArtifactRow | null,
  prepared: PreparedSchemaVersionArtifactState,
): SchemaVersionArtifact {
  const byId = byIdRow === null
    ? null
    : decodeStoredSchemaVersionArtifactRow(byIdRow);
  const byVersion = byVersionRow === null
    ? null
    : sameArtifactRow(byIdRow, byVersionRow) && byId !== null
      ? byId
      : decodeStoredSchemaVersionArtifactRow(byVersionRow);

  if (byId !== null && byId.version !== prepared.version) {
    throw new SchemaVersionArtifactConflictError({
      reason: "schemaVersionIdReused",
      deploymentId: prepared.deploymentId,
      schemaVersionId: prepared.schemaVersionId,
      requestedVersion: prepared.version,
      existingVersion: byId.version,
    });
  }
  if (
    byVersion !== null &&
    byVersion.schemaVersionId !== prepared.schemaVersionId
  ) {
    throw new SchemaVersionArtifactConflictError({
      reason: "versionReused",
      deploymentId: prepared.deploymentId,
      version: prepared.version,
      requestedSchemaVersionId: prepared.schemaVersionId,
      existingSchemaVersionId: byVersion.schemaVersionId,
    });
  }
  if (byId === null || byVersion === null || byId !== byVersion) {
    throw new SchemaVersionArtifactCorruptionError(
      prepared.deploymentId,
      "ID and version lookups did not resolve the same artifact",
    );
  }
  return requireExactArtifactReplay(byId, prepared);
}

function requireExactArtifactReplay(
  existing: StoredSchemaVersionArtifact,
  requested: PreparedSchemaVersionArtifactState,
): SchemaVersionArtifact {
  if (existing.manifestCodecVersion !== requested.canonical.codecVersion) {
    throw new SchemaVersionArtifactCorruptionError(
      existing.deploymentId,
      "stored manifest codec does not match prepared artifact",
    );
  }
  if (
    bytesEqual(existing.manifestBytes, requested.canonical.canonicalBytes)
  ) {
    if (!bytesEqual(existing.manifestSha256, requested.canonical.sha256)) {
      throw new SchemaVersionArtifactCorruptionError(
        existing.deploymentId,
        "stored manifest SHA-256 does not match equal canonical bytes",
      );
    }
    if (
      !jsonValuesEqual(
        existing.manifestJson,
        requested.canonical.manifestJson,
      )
    ) {
      throw new SchemaVersionArtifactCorruptionError(
        existing.deploymentId,
        "stored manifest JSON does not match equal canonical bytes",
      );
    }
    return artifactFromCanonical(
      requested,
      requested.canonical,
      existing.createdAt,
    );
  }
  if (bytesEqual(existing.manifestSha256, requested.canonical.sha256)) {
    throw new SchemaManifestChecksumCollisionError(
      existing.deploymentId,
      existing.schemaVersionId,
      existing.version,
    );
  }
  throw new SchemaVersionArtifactConflictError({
    reason: "artifactMismatch",
    deploymentId: existing.deploymentId,
    schemaVersionId: existing.schemaVersionId,
    version: existing.version,
  });
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
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (const [index, key] of leftKeys.entries()) {
    if (key !== rightKeys[index] || !Object.hasOwn(right, key)) return false;
    if (!jsonValuesEqual(left[key], right[key])) return false;
  }
  return true;
}

function isJsonObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function decodeStoredValue<Value>(
  deploymentId: string,
  field: string,
  decode: () => Value,
): Value {
  try {
    return decode();
  } catch (cause) {
    throw new SchemaVersionArtifactCorruptionError(
      deploymentId,
      `${field} is invalid`,
      { cause },
    );
  }
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
