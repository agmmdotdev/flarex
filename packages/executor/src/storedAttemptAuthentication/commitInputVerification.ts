import { bytesEqualFullScan as bytesEqual } from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Effect } from "effect";

import {
  AppDocumentIdV1Error,
  requireAppDocumentIdentityV1ForTable,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  CanonicalSuccessfulResultBytesV1Schema,
  canonicalizeSuccessfulResultV1Effect,
  type CanonicalSuccessfulResultBytesV1,
  type CanonicalSuccessfulResultV1,
  type SessionJournalV1,
  type SuccessfulResultSha256HexV1,
} from "flarex-protocol/commit-protocol";
import type { SchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
import type { PointMutationTargetFunctionMetadataV1 } from "flarex-protocol/point-mutation-start";
import type { SnapshotToken } from "flarex-protocol/storage-authority";
import type {
  TransactionAttemptFence,
  TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";
import type {
  CanonicalFlarexRuntimeValueV1,
  FlarexValueCodecVersion,
} from "flarex-protocol/value";
import {
  validateValidatorValueV1,
  type ValidatorIdPolicyV1,
  type ValidatorValueIssueV1,
} from "flarex-protocol/validator-engine";

import type {
  AuthenticatedStoredAttemptPointV1,
  AuthenticatedSuccessfulResultV1,
  StoredAttemptAuthorityStateV1,
  StoredAttemptSealIdentityPortV1,
  StoredAttemptSessionScalarsPortV1,
} from "../storedAttemptAuthentication";

export class InvalidAuthenticatedCommitAuthorityV1Error extends Data.TaggedError(
  "InvalidAuthenticatedCommitAuthorityV1Error",
)<{
  readonly reason: "notSameFactory";
}> {}

export type CommitInputAuthorityCorruptionReasonV1 =
  | "duplicateTableAuthority"
  | "pointTableAuthorityMissing"
  | "pointDocumentNotObject"
  | "pointIdentityMismatch"
  | "pointCreationTimeMismatch"
  | "pointLiveEvidenceMissing"
  | "pointNonLiveEvidencePresent"
  | "returnsValidatorMissing"
  | "successfulResultInvalid"
  | "successfulResultCodecMismatch"
  | "successfulResultBytesMismatch"
  | "successfulResultByteLengthMismatch"
  | "successfulResultDigestMismatch"
  | "successfulResultSemanticBytesMismatch";

export class CommitInputAuthorityCorruptionV1Error extends Data.TaggedError(
  "CommitInputAuthorityCorruptionV1Error",
)<{
  readonly reason: CommitInputAuthorityCorruptionReasonV1;
}> {}

export type CommitDocumentValidationIssueV1 =
  | {
      readonly reason: "unexpectedSystemField";
      readonly field: string;
    }
  | {
      readonly reason: "validator";
      readonly issue: ValidatorValueIssueV1;
    };

export class CommitDocumentValidationV1Error extends Data.TaggedError(
  "CommitDocumentValidationV1Error",
)<{
  readonly documentId: AppDocumentIdV1;
  readonly tableName: string;
  readonly issue: CommitDocumentValidationIssueV1;
}> {}

export class CommitSuccessfulResultValidationV1Error extends Data.TaggedError(
  "CommitSuccessfulResultValidationV1Error",
)<{
  readonly functionPath: string;
  readonly issue: ValidatorValueIssueV1;
}> {}

export type CommitInputVerificationV1Error =
  | InvalidAuthenticatedCommitAuthorityV1Error
  | CommitInputAuthorityCorruptionV1Error
  | CommitDocumentValidationV1Error
  | CommitSuccessfulResultValidationV1Error;

export interface CommitInputAuthorityPinsV1 {
  readonly deploymentId: StoredAttemptAuthorityStateV1["deploymentId"];
  readonly scopeId: StoredAttemptAuthorityStateV1["scopeId"];
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: StoredAttemptAuthorityStateV1["storageGeneration"];
  readonly storageGenerationFence:
    StoredAttemptAuthorityStateV1["storageGenerationFence"];
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: StoredAttemptAuthorityStateV1["schemaVersionId"];
  readonly packageId: string;
  readonly artifactRuntime: string;
  readonly artifactId: string;
  readonly sourcePackageHash: string;
  readonly executionModule: string;
  readonly functionPath: string;
  readonly functionKind: "mutation";
  readonly policyVersion: string;
  readonly authorizationRevocationEpoch: bigint;
  readonly requestKey: string;
}

interface VerifiedCommitPointBaseV1 {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly dependency: AuthenticatedStoredAttemptPointV1["dependency"];
}

export type VerifiedCommitPointV1 =
  | Readonly<VerifiedCommitPointBaseV1 & {
      readonly kind: "unchanged";
    }>
  | Readonly<VerifiedCommitPointBaseV1 & {
      readonly kind: "deleted";
    }>
  | Readonly<VerifiedCommitPointBaseV1 & {
      readonly kind: "live";
      readonly creationTime: NonNullable<
        AuthenticatedStoredAttemptPointV1["overlayCreationTime"]
      >;
      readonly value: CanonicalFlarexRuntimeValueV1;
      readonly canonicalBytes: Uint8Array;
      readonly semanticSizeBytes: number;
    }>;

export interface VerifiedSuccessfulResultV1 {
  readonly valueCodecVersion: FlarexValueCodecVersion;
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly canonicalBytes: CanonicalSuccessfulResultBytesV1;
  readonly semanticSizeBytes: number;
  readonly sha256Hex: SuccessfulResultSha256HexV1;
}

export interface VerifiedCommitInputStateV1 {
  readonly authorityPins: Readonly<CommitInputAuthorityPinsV1>;
  readonly sealIdentity: Readonly<StoredAttemptSealIdentityPortV1>;
  readonly journal: SessionJournalV1;
  readonly points: ReadonlyArray<VerifiedCommitPointV1>;
  readonly successfulResult: Readonly<VerifiedSuccessfulResultV1>;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
}

export interface CommitInputVerificationSourceV1 {
  readonly authority: StoredAttemptAuthorityStateV1;
  readonly session: StoredAttemptSessionScalarsPortV1;
  readonly sealIdentity: Readonly<StoredAttemptSealIdentityPortV1>;
  readonly journal: SessionJournalV1;
  readonly points: ReadonlyArray<AuthenticatedStoredAttemptPointV1>;
  readonly successfulResult: AuthenticatedSuccessfulResultV1;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly functionMetadata: PointMutationTargetFunctionMetadataV1;
}

export const verifyCommitInputStateEffect = Effect.fn(
  "StoredAttemptAuthentication.verifyCommitInputState",
)(function* (
  source: CommitInputVerificationSourceV1,
): Effect.fn.Return<
  VerifiedCommitInputStateV1,
  Exclude<
    CommitInputVerificationV1Error,
    InvalidAuthenticatedCommitAuthorityV1Error
  >
> {
  const tablesById = new Map<
    CatalogTableId,
    SchemaManifestAppSchemaV1["tableDefinitions"]["tables"][number]
  >();
  const tableIdsByName = new Map<string, CatalogTableId>();
  for (const table of source.schemaManifest.tableDefinitions.tables) {
    if (tablesById.has(table.tableId) || tableIdsByName.has(table.logicalName)) {
      return yield* authorityCorruptionEffect("duplicateTableAuthority");
    }
    tablesById.set(table.tableId, table);
    tableIdsByName.set(table.logicalName, table.tableId);
  }
  const idPolicy = tableAwareIdPolicy(tableIdsByName);

  const verifiedPoints: VerifiedCommitPointV1[] = [];
  for (const point of source.points) {
    const base = Object.freeze({
      documentId: point.documentId,
      tableId: point.tableId,
      rowId: point.rowId,
      dependency: Object.freeze(structuredClone(point.dependency)),
    } satisfies VerifiedCommitPointBaseV1);
    const table = tablesById.get(point.tableId);
    if (table === undefined) {
      return yield* authorityCorruptionEffect("pointTableAuthorityMissing");
    }
    switch (point.overlayKind) {
      case "none":
        if (
          point.overlayCreationTime !== null ||
          point.overlayValue !== null ||
          point.overlayBytes !== null ||
          point.overlaySemanticBytes !== null
        ) {
          return yield* authorityCorruptionEffect(
            "pointNonLiveEvidencePresent",
          );
        }
        verifiedPoints.push(Object.freeze({ ...base, kind: "unchanged" }));
        break;
      case "deleted":
        if (
          point.overlayCreationTime !== null ||
          point.overlayValue !== null ||
          point.overlayBytes !== null ||
          point.overlaySemanticBytes !== null
        ) {
          return yield* authorityCorruptionEffect(
            "pointNonLiveEvidencePresent",
          );
        }
        verifiedPoints.push(Object.freeze({ ...base, kind: "deleted" }));
        break;
      case "live": {
        if (
          point.overlayCreationTime === null ||
          point.overlayValue === null ||
          point.overlayBytes === null ||
          point.overlaySemanticBytes === null
        ) {
          return yield* authorityCorruptionEffect("pointLiveEvidenceMissing");
        }
        const developerFields = yield* projectDeveloperFieldsEffect(
          point,
          table.logicalName,
        );
        yield* Effect.fromResult(validateValidatorValueV1(
          table.definition.documentType,
          developerFields,
          { path: "$document", idPolicy },
        )).pipe(
          Effect.mapError((error) => new CommitDocumentValidationV1Error({
            documentId: point.documentId,
            tableName: table.logicalName,
            issue: { reason: "validator", issue: error.issue },
          })),
        );
        verifiedPoints.push(captureVerifiedLivePoint(
          base,
          point.overlayCreationTime,
          point.overlayValue,
          point.overlayBytes,
          point.overlaySemanticBytes,
        ));
        break;
      }
    }
  }
  verifiedPoints.sort((left, right) =>
    compareUtf16Strings(left.documentId, right.documentId)
  );

  if (!Object.hasOwn(source.functionMetadata, "returnsValidator")) {
    return yield* authorityCorruptionEffect("returnsValidatorMissing");
  }
  const canonicalResult = yield* canonicalizeSuccessfulResultV1Effect(
    source.successfulResult.value,
  ).pipe(
    Effect.mapError(() =>
      authorityCorruption("successfulResultInvalid")
    ),
  );
  yield* verifySuccessfulResultSealEffect(
    source.successfulResult,
    source.sealIdentity,
    canonicalResult,
  );

  const returnsValidator = source.functionMetadata.returnsValidator;
  if (returnsValidator !== null) {
    yield* Effect.fromResult(validateValidatorValueV1(
      returnsValidator,
      source.successfulResult.value,
      { path: "$return", idPolicy },
    )).pipe(
      Effect.mapError((error) =>
        new CommitSuccessfulResultValidationV1Error({
          functionPath: source.functionMetadata.path,
          issue: error.issue,
        })
      ),
    );
  }

  const stableResultBytes = new Uint8Array(canonicalResult.canonicalBytes);
  const stableJournal = Object.freeze(structuredClone(source.journal));
  const stableSchemaManifest = Object.freeze(
    structuredClone(source.schemaManifest),
  );
  return Object.freeze({
    authorityPins: captureAuthorityPins(source.authority, source.session),
    sealIdentity: detachSealIdentity(source.sealIdentity),
    journal: stableJournal,
    points: Object.freeze(verifiedPoints),
    successfulResult: Object.freeze({
      valueCodecVersion: canonicalResult.evidence.valueCodecVersion,
      value: source.successfulResult.value,
      get canonicalBytes(): CanonicalSuccessfulResultBytesV1 {
        return CanonicalSuccessfulResultBytesV1Schema.make(
          new Uint8Array(stableResultBytes),
        );
      },
      semanticSizeBytes: canonicalResult.semanticSizeBytes,
      sha256Hex: canonicalResult.evidence.sha256Hex,
    }),
    schemaManifest: stableSchemaManifest,
  } satisfies VerifiedCommitInputStateV1);
});

const projectDeveloperFieldsEffect = Effect.fn(function* (
  point: AuthenticatedStoredAttemptPointV1,
  tableName: string,
): Effect.fn.Return<
  Readonly<Record<string, CanonicalFlarexRuntimeValueV1>>,
  CommitInputAuthorityCorruptionV1Error | CommitDocumentValidationV1Error
> {
  const value = point.overlayValue;
  if (!isCanonicalObject(value)) {
    return yield* authorityCorruptionEffect("pointDocumentNotObject");
  }
  if (value._id !== point.documentId) {
    return yield* authorityCorruptionEffect("pointIdentityMismatch");
  }
  if (value._creationTime !== point.overlayCreationTime) {
    return yield* authorityCorruptionEffect("pointCreationTimeMismatch");
  }
  const developerFields: Record<string, CanonicalFlarexRuntimeValueV1> = {};
  for (const [field, item] of Object.entries(value)) {
    if (field === "_id" || field === "_creationTime") continue;
    if (field.startsWith("_")) {
      return yield* Effect.fail(new CommitDocumentValidationV1Error({
        documentId: point.documentId,
        tableName,
        issue: { reason: "unexpectedSystemField", field },
      }));
    }
    Object.defineProperty(developerFields, field, {
      value: item,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(developerFields);
});

const verifySuccessfulResultSealEffect = Effect.fn(function* (
  authenticated: AuthenticatedSuccessfulResultV1,
  seal: StoredAttemptSealIdentityPortV1,
  canonical: CanonicalSuccessfulResultV1,
): Effect.fn.Return<void, CommitInputAuthorityCorruptionV1Error> {
  if (canonical.evidence.valueCodecVersion !== seal.resultValueCodecVersion) {
    return yield* authorityCorruptionEffect("successfulResultCodecMismatch");
  }
  if (!bytesEqual(canonical.canonicalBytes, authenticated.canonicalBytes)) {
    return yield* authorityCorruptionEffect("successfulResultBytesMismatch");
  }
  if (canonical.canonicalBytes.byteLength !== seal.resultByteLength) {
    return yield* authorityCorruptionEffect(
      "successfulResultByteLengthMismatch",
    );
  }
  const sealSha256Hex = lowercaseHexOrUndefined(seal.resultSha256);
  if (
    sealSha256Hex === undefined ||
    canonical.evidence.sha256Hex !== sealSha256Hex ||
    canonical.evidence.sha256Hex !== authenticated.sha256Hex
  ) {
    return yield* authorityCorruptionEffect("successfulResultDigestMismatch");
  }
  if (
    canonical.semanticSizeBytes !== seal.resultSemanticBytes ||
    canonical.semanticSizeBytes !== authenticated.semanticSizeBytes
  ) {
    return yield* authorityCorruptionEffect(
      "successfulResultSemanticBytesMismatch",
    );
  }
});

function tableAwareIdPolicy(
  tableIdsByName: ReadonlyMap<string, CatalogTableId>,
): ValidatorIdPolicyV1 {
  return Object.freeze({
    mode: "tableAware",
    check: (tableName, value) => {
      if (tableName.startsWith("_")) return "unavailable";
      const tableId = tableIdsByName.get(tableName);
      if (tableId === undefined) return "unavailable";
      try {
        requireAppDocumentIdentityV1ForTable(value, tableId);
        return "valid";
      } catch (cause) {
        if (cause instanceof AppDocumentIdV1Error) return "invalid";
        throw cause;
      }
    },
  } satisfies ValidatorIdPolicyV1);
}

function captureVerifiedLivePoint(
  base: Readonly<VerifiedCommitPointBaseV1>,
  creationTime: NonNullable<
    AuthenticatedStoredAttemptPointV1["overlayCreationTime"]
  >,
  value: CanonicalFlarexRuntimeValueV1,
  canonicalBytes: Uint8Array,
  semanticSizeBytes: number,
): Extract<VerifiedCommitPointV1, { readonly kind: "live" }> {
  const stableCanonicalBytes = new Uint8Array(canonicalBytes);
  return Object.freeze({
    ...base,
    kind: "live",
    creationTime,
    value,
    get canonicalBytes(): Uint8Array {
      return new Uint8Array(stableCanonicalBytes);
    },
    semanticSizeBytes,
  });
}

function detachSealIdentity(
  seal: StoredAttemptSealIdentityPortV1,
): Readonly<StoredAttemptSealIdentityPortV1> {
  return Object.freeze({
    ...seal,
    journalSha256: new Uint8Array(seal.journalSha256),
    resultSha256: new Uint8Array(seal.resultSha256),
  });
}

function captureAuthorityPins(
  authority: StoredAttemptAuthorityStateV1,
  session: StoredAttemptSessionScalarsPortV1,
): Readonly<CommitInputAuthorityPinsV1> {
  return Object.freeze({
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    sessionId: authority.sessionId,
    attemptFence: authority.attemptFence,
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: authority.storageGenerationFence,
    snapshotToken: Object.freeze({ ...authority.snapshotToken }),
    schemaVersionId: authority.schemaVersionId,
    packageId: session.packageId,
    artifactRuntime: session.artifactRuntime,
    artifactId: session.artifactId,
    sourcePackageHash: session.sourcePackageHash,
    executionModule: session.executionModule,
    functionPath: session.functionPath,
    functionKind: "mutation",
    policyVersion: session.policyVersion,
    authorizationRevocationEpoch: session.authorizationRevocationEpoch,
    requestKey: session.requestKey,
  } satisfies CommitInputAuthorityPinsV1);
}

function lowercaseHexOrUndefined(bytes: Uint8Array): string | undefined {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
    return undefined;
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function isCanonicalObject(
  value: CanonicalFlarexRuntimeValueV1 | null,
): value is Readonly<Record<string, CanonicalFlarexRuntimeValueV1>> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer);
}

function authorityCorruption(
  reason: CommitInputAuthorityCorruptionReasonV1,
): CommitInputAuthorityCorruptionV1Error {
  return new CommitInputAuthorityCorruptionV1Error({ reason });
}

function authorityCorruptionEffect(
  reason: CommitInputAuthorityCorruptionReasonV1,
): Effect.Effect<never, CommitInputAuthorityCorruptionV1Error> {
  return Effect.fail(authorityCorruption(reason));
}
