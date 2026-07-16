import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
} from "@flarex/utils/bytes";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { JsonObject } from "flarex-protocol/json";
import {
  MAX_SCHEMA_MANIFEST_APP_TABLES,
  canonicalizeSchemaManifestV1,
  decodeCanonicalSchemaManifestBytes,
  decodeCatalogSchemaVersionId,
  decodeSchemaManifestAppSchemaV1,
  decodeSchemaManifestCodecVersion,
  decodeSchemaManifestJson,
  decodeSchemaManifestSha256,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  replacementScopeEpochV1FromUuid,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionSessionIdV1Schema,
  type TransactionAttemptFence,
  type TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";

import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import { decodeScopeClockRecord } from "../scopeClock";
import {
  authorityMismatch,
  corrupt,
  type StoredCommitAuthorityCorruptionReasonV1,
  type StoredCommitAuthorityEvidenceAuthorityV1,
  type StoredCommitAuthorityEvidenceLoadResultV1,
  type StoredCommitAuthoritySealIdentityV1,
  type StoredCommitAuthoritySessionScalarsV1,
} from "./model";

type SessionRow =
  typeof import("../schema").fxSystemTransactionSessions.$inferSelect;
type LeaseRow =
  typeof import("../schema").fxSystemSnapshotLeases.$inferSelect;
type RootRow =
  typeof import("../schema").fxSystemTransactionJournals.$inferSelect;
type SchemaRow =
  typeof import("../schema").fxControlSchemaVersions.$inferSelect;
export type ClockRow =
  typeof import("../schema").fxSystemScopeClocks.$inferSelect;

export interface SessionSizeRow extends Omit<
  SessionRow,
  | "validatedArgsJson"
  | "validatedArgsCanonicalBytes"
  | "authorizationGrantJson"
  | "authorizationGrantCanonicalBytes"
> {
  readonly validatedArgsJsonByteLengthText: string;
  readonly validatedArgsCanonicalByteLengthText: string;
  readonly authorizationGrantJsonByteLengthText: string;
  readonly authorizationGrantCanonicalByteLengthText: string;
}

export interface SessionPayloadRow {
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly validatedArgsJsonText: string;
  readonly validatedArgsCanonicalBytes: Uint8Array;
  readonly authorizationGrantJsonText: string;
  readonly authorizationGrantCanonicalBytes: Uint8Array;
}

export interface SchemaPayloadRow extends Omit<
  SchemaRow,
  "manifestJson" | "manifestBytes" | "manifestSha256"
> {
  readonly manifestJsonText: string;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: Uint8Array;
}

export interface SchemaSizeRow extends Omit<
  SchemaRow,
  "manifestJson" | "manifestBytes"
> {
  readonly manifestJsonByteLengthText: string;
  readonly manifestCanonicalByteLengthText: string;
}

interface BindingRow {
  readonly ordinalText: string;
  readonly declaredTableIdText: string | null;
  readonly stableTableIdText: string | null;
}

export interface CapturedRowsV1 {
  readonly clockRows: ReadonlyArray<ClockRow>;
  readonly databaseNowText: string | undefined;
  readonly sessionSizeRows: ReadonlyArray<SessionSizeRow>;
  readonly leaseRows: ReadonlyArray<LeaseRow>;
  readonly rootRows: ReadonlyArray<RootScalarRow>;
  readonly schemaSizeRows: ReadonlyArray<SchemaSizeRow>;
  readonly skipReason?: StoredCommitAuthorityCorruptionReasonV1;
  readonly sessionPayloadRows: ReadonlyArray<SessionPayloadRow>;
  readonly schemaPayloadRows: ReadonlyArray<SchemaPayloadRow>;
  readonly bindingRows: ReadonlyArray<unknown>;
}

export interface StoredCommitAuthorityMaterializationOptionsV1 {
  /** Test-only: runs immediately before schema evidence decoding. */
  readonly beforeSchemaArtifactDecode?: () => void | Promise<void>;
}

export interface RootScalarRow extends Omit<
  RootRow,
  "sealedJournalBytes" | "sealedResultBytes"
> {
  readonly sealedJournalByteLengthText: string | null;
  readonly sealedResultByteLengthText: string | null;
}

const UTF8_ENCODER = new TextEncoder();

export async function materialize(
  expected: StoredCommitAuthorityEvidenceAuthorityV1,
  preliminary: TrustedScopeAuthority,
  captured: CapturedRowsV1,
  options: StoredCommitAuthorityMaterializationOptionsV1 = {},
): Promise<StoredCommitAuthorityEvidenceLoadResultV1> {
  return materializeUnsafe(expected, preliminary, captured, options);
}

async function materializeUnsafe(
  expected: StoredCommitAuthorityEvidenceAuthorityV1,
  preliminary: TrustedScopeAuthority,
  captured: CapturedRowsV1,
  options: StoredCommitAuthorityMaterializationOptionsV1,
): Promise<StoredCommitAuthorityEvidenceLoadResultV1> {
  if (captured.skipReason !== undefined) {
    return corrupt(captured.skipReason);
  }
  if (captured.clockRows.length !== 1) {
    return corrupt("authorityProjectionInvalid");
  }
  const clockRow = captured.clockRows[0];
  if (clockRow === undefined) return corrupt("authorityProjectionInvalid");
  const decodedClock = decodeClockAuthority(clockRow);
  if (decodedClock === undefined) return corrupt("authorityProjectionInvalid");
  const { clock, scopeUuid, epochUuid, revocationEpoch } = decodedClock;
  if (
    scopeUuid !== projectScopeIdUuidV1(expected.scopeId).scopeUuid ||
    epochUuid !== projectScopeEpochUuidV1(clock.epoch).epochUuid ||
    clock.scopeId !== expected.scopeId ||
    preliminary.scopeId !== expected.scopeId
  ) {
    return authorityMismatch("scopeChanged");
  }
  if (
    clock.storageGeneration !== expected.storageGeneration ||
    clock.storageGenerationFence !== expected.storageGenerationFence ||
    preliminary.storageGeneration !== expected.storageGeneration ||
    preliminary.storageGenerationFence !== expected.storageGenerationFence
  ) {
    return authorityMismatch("generationChanged");
  }
  if (
    clock.epoch !== expected.snapshotToken.epoch ||
    preliminary.epoch !== expected.snapshotToken.epoch
  ) {
    return authorityMismatch("epochChanged");
  }
  const databaseNowMilliseconds = decodeDatabaseNow(
    captured.databaseNowText,
  );
  if (databaseNowMilliseconds === undefined) {
    return corrupt("databaseClockInvalid");
  }

  if (captured.sessionSizeRows.length === 0) {
    return authorityMismatch("attemptMissing");
  }
  if (captured.sessionSizeRows.length !== 1) {
    return corrupt("sessionEvidenceMissingOrDuplicate");
  }
  const session = captured.sessionSizeRows[0];
  if (session === undefined) {
    return corrupt("sessionEvidenceMissingOrDuplicate");
  }
  const sessionIdentity = decodeSessionIdentity(session);
  if (sessionIdentity === undefined) return corrupt("sessionEvidenceInvalid");
  if (
    session.scopeUuid !== scopeUuid ||
    sessionIdentity.sessionId !== expected.sessionId
  ) {
    return authorityMismatch("attemptMissing");
  }
  if (sessionIdentity.attemptFence !== expected.attemptFence) {
    return authorityMismatch("attemptReplaced");
  }
  if (
    session.storageGeneration !== expected.storageGeneration ||
    sessionIdentity.storageGenerationFence !==
      expected.storageGenerationFence
  ) {
    return authorityMismatch("generationChanged");
  }
  if (session.schemaVersionId !== expected.schemaVersionId) {
    return authorityMismatch("schemaChanged");
  }
  if (session.authorizationRevocationEpoch !== revocationEpoch) {
    return authorityMismatch("revocationEpochChanged");
  }
  if (session.lifecycle !== "running" && session.lifecycle !== "finishing") {
    return Object.freeze({ kind: "notPlannable", reason: "lifecycle" });
  }
  if (!validSessionScalars(session)) {
    return corrupt("sessionEvidenceInvalid");
  }
  if (
    session.authorizationGrantExpiresAt.getTime() <= databaseNowMilliseconds ||
    session.hardExpiresAt.getTime() <= databaseNowMilliseconds
  ) {
    return Object.freeze({ kind: "notPlannable", reason: "expired" });
  }

  if (captured.leaseRows.length !== 1) {
    return corrupt("snapshotLeaseMissingOrDuplicate");
  }
  const lease = captured.leaseRows[0];
  if (lease === undefined) {
    return corrupt("snapshotLeaseMissingOrDuplicate");
  }
  const leaseSnapshot = decodeLeaseSnapshot(expected, lease);
  if (leaseSnapshot === undefined) return corrupt("snapshotLeaseInvalid");
  if (
    lease.scopeUuid !== scopeUuid ||
    lease.sessionId !== expected.sessionId ||
    lease.attemptFence !== expected.attemptFence ||
    !validDate(lease.leaseExpiresAt) ||
    lease.leaseExpiresAt.getTime() > session.hardExpiresAt.getTime() ||
    leaseSnapshot.commitSeq > clock.lastCommitSeq
  ) {
    return corrupt("snapshotLeaseInvalid");
  }
  if (
    leaseSnapshot.scopeId !== expected.snapshotToken.scopeId ||
    leaseSnapshot.epoch !== expected.snapshotToken.epoch ||
    leaseSnapshot.commitSeq !== expected.snapshotToken.commitSeq
  ) {
    return authorityMismatch("snapshotChanged");
  }
  if (lease.leaseExpiresAt.getTime() <= databaseNowMilliseconds) {
    return Object.freeze({ kind: "notPlannable", reason: "expired" });
  }

  if (captured.rootRows.length !== 1) {
    return corrupt("journalRootMissingOrDuplicate");
  }
  const root = captured.rootRows[0];
  if (root === undefined) return corrupt("journalRootMissingOrDuplicate");
  if (root.state !== "sealed") {
    return Object.freeze({ kind: "notPlannable", reason: "rootNotSealed" });
  }
  if (!validRootScalars(root)) {
    return corrupt("journalRootInvalid");
  }

  const sessionScalars = captureSessionScalars(session);
  if (sessionScalars === undefined) return corrupt("sessionEvidenceInvalid");
  if (!sameSessionScalars(sessionScalars, expected.session)) {
    return authorityMismatch("sealChanged");
  }
  if (!sameSealIdentity(
    expected.sealIdentity,
    session,
    lease,
    root,
    scopeUuid,
  )) {
    return authorityMismatch("sealChanged");
  }

  if (captured.sessionPayloadRows.length !== 1) {
    return corrupt("sessionEvidenceMissingOrDuplicate");
  }
  const payload = captured.sessionPayloadRows[0];
  if (
    payload === undefined ||
    payload.scopeUuid !== scopeUuid ||
    payload.sessionId !== expected.sessionId ||
    payload.attemptFence !== expected.attemptFence ||
    typeof payload.validatedArgsJsonText !== "string" ||
    typeof payload.authorizationGrantJsonText !== "string"
  ) {
    return corrupt("sessionEvidenceInvalid");
  }
  const validatedArgsJson = parseJsonObjectText(
    payload.validatedArgsJsonText,
  );
  const authorizationGrantJson = parseJsonObjectText(
    payload.authorizationGrantJsonText,
  );
  const projectedArgsLength = parseLength(
    session.validatedArgsCanonicalByteLengthText,
  );
  const projectedGrantLength = parseLength(
    session.authorizationGrantCanonicalByteLengthText,
  );
  const projectedArgsJsonLength = parseLength(
    session.validatedArgsJsonByteLengthText,
  );
  const projectedGrantJsonLength = parseLength(
    session.authorizationGrantJsonByteLengthText,
  );
  if (
    validatedArgsJson === undefined ||
    authorizationGrantJson === undefined ||
    projectedArgsLength === undefined ||
    projectedGrantLength === undefined ||
    projectedArgsJsonLength === undefined ||
    projectedGrantJsonLength === undefined ||
    utf8ByteLength(payload.validatedArgsJsonText) !==
      projectedArgsJsonLength ||
    utf8ByteLength(payload.authorizationGrantJsonText) !==
      projectedGrantJsonLength ||
    payload.validatedArgsCanonicalBytes.byteLength !== projectedArgsLength ||
    payload.authorizationGrantCanonicalBytes.byteLength !== projectedGrantLength
  ) {
    return corrupt("sessionEvidenceInvalid");
  }

  if (captured.schemaSizeRows.length !== 1) {
    return corrupt("schemaArtifactMissingOrDuplicate");
  }
  const schemaSize = captured.schemaSizeRows[0];
  if (schemaSize === undefined) {
    return corrupt("schemaArtifactMissingOrDuplicate");
  }
  if (captured.schemaPayloadRows.length !== 1) {
    return corrupt("schemaArtifactMissingOrDuplicate");
  }
  const schemaRow = captured.schemaPayloadRows[0];
  if (schemaRow === undefined) {
    return corrupt("schemaArtifactMissingOrDuplicate");
  }
  await options.beforeSchemaArtifactDecode?.();
  const manifest = await verifySchemaArtifact(
    expected,
    schemaSize,
    schemaRow,
  );
  if (manifest === undefined) return corrupt("schemaArtifactInvalid");
  const stableBindings = materializeBindings(
    manifest,
    captured.bindingRows,
  );
  if (stableBindings === "overflow") {
    return corrupt("stableBindingOverflow");
  }
  if (stableBindings === "missing") {
    return corrupt("stableBindingMissing");
  }
  if (stableBindings === "mismatch") {
    return corrupt("stableBindingMismatch");
  }

  return Object.freeze({
    kind: "loaded",
    evidence: Object.freeze({
      databaseNowMilliseconds,
      currentAuthorizationRevocationEpoch: revocationEpoch,
      session: Object.freeze({
        ...sessionScalars,
        validatedArgsJson: Object.freeze(
          structuredClone(validatedArgsJson),
        ),
        validatedArgsCanonicalBytes: copyBytes(
          payload.validatedArgsCanonicalBytes,
        ),
        authorizationGrantJson: Object.freeze(
          structuredClone(authorizationGrantJson),
        ),
        authorizationGrantCanonicalBytes: copyBytes(
          payload.authorizationGrantCanonicalBytes,
        ),
      }),
      schema: Object.freeze({
        deploymentId: expected.deploymentId,
        schemaVersionId: expected.schemaVersionId,
        manifest: Object.freeze(structuredClone(manifest)),
        stableBindings,
      }),
    }),
  });
}

function decodeClockAuthority(row: ClockRow) {
  try {
    return Object.freeze({
      clock: decodeScopeClockRecord(row),
      scopeUuid: decodeScopeUuidV1(row.scopeUuid),
      epochUuid: decodeScopeEpochUuidV1(row.epochUuid),
      revocationEpoch: TransactionAuthorizationRevocationEpochSchema.make(
        row.authorizationRevocationEpoch,
      ),
    });
  } catch {
    return undefined;
  }
}

function decodeSessionIdentity(session: SessionSizeRow) {
  try {
    return Object.freeze({
      sessionId: TransactionSessionIdV1Schema.make(session.sessionId),
      attemptFence: TransactionAttemptFenceSchema.make(session.attemptFence),
      storageGenerationFence: StorageGenerationFenceSchema.make(
        session.storageGenerationFence,
      ),
    });
  } catch {
    return undefined;
  }
}

function decodeLeaseSnapshot(
  expected: StoredCommitAuthorityEvidenceAuthorityV1,
  lease: LeaseRow,
) {
  try {
    return SnapshotTokenSchema.make({
      scopeId: expected.scopeId,
      epoch: replacementScopeEpochV1FromUuid(lease.snapshotEpochUuid),
      commitSeq: CommitSeqSchema.make(lease.snapshotCommitSeq),
    });
  } catch {
    return undefined;
  }
}

function validSessionScalars(session: SessionSizeRow): boolean {
  return session.protocolVersion === TRANSACTION_SESSION_PROTOCOL_VERSION_V1 &&
    validDate(session.authorizationGrantExpiresAt) &&
    validDate(session.hardExpiresAt) &&
    validDate(session.createdAt) &&
    validDate(session.updatedAt) &&
    session.hardExpiresAt.getTime() ===
      session.authorizationGrantExpiresAt.getTime() &&
    session.updatedAt.getTime() >= session.createdAt.getTime() &&
    validByteLength(session.identityAccessPolicySha256, 32) &&
    validByteLength(session.validatedArgsSha256, 32) &&
    validByteLength(session.authorizationGrantSha256, 32) &&
    validByteLength(session.requestSha256, 32) &&
    positiveSafeInteger(
      parseLength(session.validatedArgsCanonicalByteLengthText),
    ) &&
    positiveSafeInteger(
      parseLength(session.authorizationGrantCanonicalByteLengthText),
    );
}

function captureSessionScalars(
  session: SessionSizeRow,
): StoredCommitAuthoritySessionScalarsV1 | undefined {
  if (session.lifecycle !== "running" && session.lifecycle !== "finishing") {
    return undefined;
  }
  const argsLength = parseLength(
    session.validatedArgsCanonicalByteLengthText,
  );
  const grantLength = parseLength(
    session.authorizationGrantCanonicalByteLengthText,
  );
  if (argsLength === undefined || grantLength === undefined) {
    return undefined;
  }
  return Object.freeze({
    lifecycle: session.lifecycle,
    storageGeneration: session.storageGeneration,
    storageGenerationFence: session.storageGenerationFence,
    packageId: session.packageId,
    artifactRuntime: session.artifactRuntime,
    artifactId: session.artifactId,
    sourcePackageHash: session.sourcePackageHash,
    executionModule: session.executionModule,
    functionPath: session.functionPath,
    functionKind: session.functionKind,
    schemaVersionId: session.schemaVersionId,
    policyVersion: session.policyVersion,
    identityAccessPolicySha256: copyBytes(
      session.identityAccessPolicySha256,
    ),
    validatedArgsValueCodecVersion:
      session.validatedArgsValueCodecVersion,
    validatedArgsCanonicalByteLength: argsLength,
    validatedArgsSha256: copyBytes(session.validatedArgsSha256),
    authorizationGrantId: session.authorizationGrantId,
    authorizationGrantValueCodecVersion:
      session.authorizationGrantValueCodecVersion,
    authorizationGrantCanonicalByteLength: grantLength,
    authorizationGrantSha256: copyBytes(session.authorizationGrantSha256),
    authorizationRevocationEpoch: session.authorizationRevocationEpoch,
    authorizationGrantExpiresAtMilliseconds:
      session.authorizationGrantExpiresAt.getTime(),
    requestKey: session.requestKey,
    requestSha256: copyBytes(session.requestSha256),
    protocolVersion: session.protocolVersion,
    hardExpiresAtMilliseconds: session.hardExpiresAt.getTime(),
    createdAtMilliseconds: session.createdAt.getTime(),
    updatedAtMilliseconds: session.updatedAt.getTime(),
  });
}

function validRootScalars(root: RootScalarRow): boolean {
  return root.failureDimension === null &&
    root.sealedFinalSyscallSequence !== null &&
    root.sealedFinalSyscallSequence === root.lastSyscallSequence &&
    root.sealedJournalByteLengthText !== null &&
    root.sealedJournalSha256 !== null &&
    root.sealedResultValueCodecVersion !== null &&
    root.sealedResultSemanticBytes !== null &&
    root.sealedResultByteLengthText !== null &&
    root.sealedResultSha256 !== null &&
    root.sealedAt !== null &&
    positiveSafeInteger(parseLength(root.sealedJournalByteLengthText)) &&
    positiveSafeInteger(parseLength(root.sealedResultByteLengthText)) &&
    validByteLength(root.sealedJournalSha256, 32) &&
    validByteLength(root.sealedResultSha256, 32) &&
    validDate(root.createdAt) &&
    validDate(root.updatedAt) &&
    validDate(root.sealedAt) &&
    root.updatedAt.getTime() >= root.createdAt.getTime() &&
    root.sealedAt.getTime() >= root.createdAt.getTime();
}

function sameSessionScalars(
  actual: StoredCommitAuthoritySessionScalarsV1,
  expected: StoredCommitAuthoritySessionScalarsV1,
): boolean {
  const scalarFields = [
    "lifecycle",
    "storageGeneration",
    "storageGenerationFence",
    "packageId",
    "artifactRuntime",
    "artifactId",
    "sourcePackageHash",
    "executionModule",
    "functionPath",
    "functionKind",
    "schemaVersionId",
    "policyVersion",
    "validatedArgsValueCodecVersion",
    "validatedArgsCanonicalByteLength",
    "authorizationGrantId",
    "authorizationGrantValueCodecVersion",
    "authorizationGrantCanonicalByteLength",
    "authorizationRevocationEpoch",
    "authorizationGrantExpiresAtMilliseconds",
    "requestKey",
    "protocolVersion",
    "hardExpiresAtMilliseconds",
    "createdAtMilliseconds",
    "updatedAtMilliseconds",
  ] as const;
  return scalarFields.every((field) => actual[field] === expected[field]) &&
    bytesEqual(
      actual.identityAccessPolicySha256,
      expected.identityAccessPolicySha256,
    ) &&
    bytesEqual(actual.validatedArgsSha256, expected.validatedArgsSha256) &&
    bytesEqual(
      actual.authorizationGrantSha256,
      expected.authorizationGrantSha256,
    ) &&
    bytesEqual(actual.requestSha256, expected.requestSha256);
}

function sameSealIdentity(
  expected: StoredCommitAuthoritySealIdentityV1,
  session: SessionSizeRow,
  lease: LeaseRow,
  root: RootScalarRow,
  scopeUuid: ScopeUuidV1,
): boolean {
  const journalLength = root.sealedJournalByteLengthText === null
    ? undefined
    : parseLength(root.sealedJournalByteLengthText);
  const resultLength = root.sealedResultByteLengthText === null
    ? undefined
    : parseLength(root.sealedResultByteLengthText);
  return root.sealedAt !== null &&
    root.sealedFinalSyscallSequence !== null &&
    root.sealedJournalSha256 !== null &&
    root.sealedResultValueCodecVersion !== null &&
    root.sealedResultSemanticBytes !== null &&
    root.sealedResultSha256 !== null &&
    expected.scopeUuid === scopeUuid &&
    expected.lifecycle === session.lifecycle &&
    expected.sessionUpdatedAtMilliseconds === session.updatedAt.getTime() &&
    expected.leaseExpiresAtMilliseconds === lease.leaseExpiresAt.getTime() &&
    expected.rootCreatedAtMilliseconds === root.createdAt.getTime() &&
    expected.rootUpdatedAtMilliseconds === root.updatedAt.getTime() &&
    expected.sealedAtMilliseconds === root.sealedAt.getTime() &&
    expected.finalSyscallSequence === root.sealedFinalSyscallSequence &&
    expected.creationTimeSeed === root.creationTimeSeed &&
    expected.nextCreationTime === root.nextCreationTime &&
    expected.journalByteLength === journalLength &&
    bytesEqual(expected.journalSha256, root.sealedJournalSha256) &&
    expected.resultValueCodecVersion ===
      root.sealedResultValueCodecVersion &&
    expected.resultSemanticBytes === root.sealedResultSemanticBytes &&
    expected.resultByteLength === resultLength &&
    bytesEqual(expected.resultSha256, root.sealedResultSha256) &&
    expected.readDocuments === root.readDocuments &&
    expected.readSemanticBytes === root.readSemanticBytes &&
    expected.pointDependencyCount === root.pointDependencyCount &&
    expected.writeOperations === root.writeOperations &&
    expected.writeSemanticBytes === root.writeSemanticBytes &&
    expected.materialWriteEventEvidenceBytes ===
      root.materialWriteEventEvidenceBytes;
}

async function verifySchemaArtifact(
  expected: StoredCommitAuthorityEvidenceAuthorityV1,
  size: SchemaSizeRow,
  row: SchemaPayloadRow,
): Promise<SchemaManifestAppSchemaV1 | undefined> {
  if (
    row.deploymentId !== expected.deploymentId ||
    row.schemaVersionId !== expected.schemaVersionId ||
    size.deploymentId !== row.deploymentId ||
    size.schemaVersionId !== row.schemaVersionId ||
    size.version !== row.version ||
    size.manifestCodecVersion !== row.manifestCodecVersion ||
    !bytesEqual(size.manifestSha256, row.manifestSha256) ||
    size.createdAt.getTime() !== row.createdAt.getTime() ||
    parseLength(size.manifestJsonByteLengthText) !==
      utf8ByteLength(row.manifestJsonText) ||
    parseLength(size.manifestCanonicalByteLengthText) !==
      row.manifestBytes.byteLength ||
    !validDate(row.createdAt)
  ) {
    return undefined;
  }
  const decoded = decodeStoredSchemaArtifact(row);
  if (
    decoded === undefined ||
    decoded.schemaVersionId !== expected.schemaVersionId
  ) {
    return undefined;
  }
  const canonical = await canonicalizeSchemaManifestV1(decoded.json);
  if (
    decoded.codecVersion !== canonical.codecVersion ||
    !bytesEqual(decoded.canonicalBytes, canonical.canonicalBytes) ||
    !bytesEqual(decoded.sha256, canonical.sha256)
  ) {
    return undefined;
  }
  return decodeAppSchema(canonical.manifestJson);
}

function decodeStoredSchemaArtifact(row: SchemaPayloadRow) {
  try {
    return Object.freeze({
      schemaVersionId: decodeCatalogSchemaVersionId(row.schemaVersionId),
      codecVersion: decodeSchemaManifestCodecVersion(row.manifestCodecVersion),
      json: decodeSchemaManifestJson(parseJsonText(row.manifestJsonText)),
      canonicalBytes: decodeCanonicalSchemaManifestBytes(row.manifestBytes),
      sha256: decodeSchemaManifestSha256(row.manifestSha256),
    });
  } catch {
    return undefined;
  }
}

function decodeAppSchema(value: unknown): SchemaManifestAppSchemaV1 | undefined {
  try {
    return decodeSchemaManifestAppSchemaV1(value);
  } catch {
    return undefined;
  }
}

function materializeBindings(
  manifest: SchemaManifestAppSchemaV1,
  rawRows: ReadonlyArray<unknown>,
): ReadonlyArray<Readonly<{
  readonly logicalName: string;
  readonly tableId: CatalogTableId;
}>> | "overflow" | "missing" | "mismatch" {
  if (rawRows.length > MAX_SCHEMA_MANIFEST_APP_TABLES) return "overflow";
  const tables = manifest.tableDefinitions.tables;
  if (rawRows.length !== tables.length) return "missing";
  const bindings: Array<Readonly<{
    readonly logicalName: string;
    readonly tableId: CatalogTableId;
  }>> = [];
  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    const row = decodeBindingRow(rawRows[index]);
    if (table === undefined || row === undefined) return "missing";
    const ordinal = parsePositiveIntegerText(row.ordinalText);
    const declaredTableId = parsePositiveIntegerText(
      row.declaredTableIdText,
    );
    const stableTableId = parsePositiveIntegerText(row.stableTableIdText);
    if (stableTableId === undefined) return "missing";
    if (
      ordinal !== index + 1 ||
      declaredTableId !== table.tableId ||
      stableTableId !== table.tableId
    ) {
      return "mismatch";
    }
    bindings.push(Object.freeze({
      logicalName: table.logicalName,
      tableId: table.tableId,
    }));
  }
  return Object.freeze(bindings);
}

function decodeBindingRow(value: unknown): BindingRow | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const ordinalText =
    Reflect.get(value, "ordinalText") ?? Reflect.get(value, "ordinaltext");
  const declaredTableIdText =
    Reflect.get(value, "declaredTableIdText") ??
    Reflect.get(value, "declaredtableidtext");
  const stableTableIdText =
    Reflect.get(value, "stableTableIdText") ??
    Reflect.get(value, "stabletableidtext");
  if (
    typeof ordinalText !== "string" ||
    (declaredTableIdText !== null &&
      typeof declaredTableIdText !== "string") ||
    (stableTableIdText !== null && typeof stableTableIdText !== "string")
  ) {
    return undefined;
  }
  return Object.freeze({
    ordinalText,
    declaredTableIdText,
    stableTableIdText,
  });
}

export function parseLength(
  value: string | null | undefined,
): number | undefined {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parsePositiveIntegerText(
  value: string | null | undefined,
): number | undefined {
  const parsed = parseLength(value);
  return parsed !== undefined && parsed >= 1 && parsed <= 2_147_483_647
    ? parsed
    : undefined;
}

function parseJsonText(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  return parsed;
}

function parseJsonObjectText(value: string): JsonObject | undefined {
  try {
    const parsed = parseJsonText(value);
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function decodeDatabaseNow(value: string | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const milliseconds = Number(value);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0
    ? milliseconds
    : undefined;
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validByteLength(value: Uint8Array, length: number): boolean {
  return value instanceof Uint8Array && value.byteLength === length;
}

function positiveSafeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof Date);
}
