import {
  bytesEqualFullScan as bytesEqual,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect } from "effect";

import {
  decodeAppCreationTimeV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1,
  decodeAppRowIdHexV1,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogTableId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  SESSION_JOURNAL_FORMAT_V1,
  type CommitFinalSyscallSequenceV1,
  type CommitMaterialWriteEventEvidenceBytesV1,
  type LogicalReadDependencyV1,
} from "flarex-protocol/commit-protocol";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  MAX_PERSISTED_SIGNED_INT64_V1,
  CommitSeqSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  replacementScopeEpochV1FromUuid,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ReplacementScopeIdV1,
  type ScopeEpoch,
  type ScopeUuidV1,
  type SnapshotToken,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAuthorizationRevocationEpochSchema,
  type TransactionArtifactIdV1,
  type TransactionArtifactRuntimeV1,
  type TransactionAttemptFence,
  type TransactionAuthorizationGrantIdV1,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionExecutionModuleV1,
  type TransactionFunctionPathV1,
  type TransactionIdentityAccessPolicySha256V1,
  type TransactionPackageIdV1,
  type TransactionPolicyVersionV1,
  type TransactionRequestKeyV1,
  type TransactionSessionIdV1,
  type TransactionSourcePackageSha256HexV1,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueCodecV1Error,
  canonicalizeFlarexValueV1,
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1,
  type FlarexValueCodecVersion,
} from "flarex-protocol/value";

import {
  AppRowCreationTimeConflictError,
  AppRowRevisionAlreadyExistsError,
  AppRowRevisionChainConflictError,
  AppRowScopeAuthorityUnavailableError,
  AppRowStorageCorruptionError,
  InvalidAppRowRevisionV1InputError,
  appendPreparedAppRowRevisionAndAdvanceCurrentInTransaction,
  type AppRowIdentityV1,
  type AppRowPointDependencyV1,
  type AppRowTransaction,
} from "./appRows";
import {
  validateAppRowPointOccV1,
  type AppRowPointHeadObservationV1,
} from "./appRowPointOcc";
import {
  decodeScopeClockRecord,
  ScopeClockCorruptionError,
  ScopeClockNotFoundError,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthority,
  TrustedScopeAuthorityResolutionError,
  type TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import {
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "./schema";
import {
  isLocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";
import type {
  PointMutationSessionAuthorityResolutionPortsV1,
} from "./transactionSessionActivation";

const MAX_SIGNED_COMMIT_SEQ = MAX_PERSISTED_SIGNED_INT64_V1;
const HASH_BYTE_LENGTH = 32;

export interface PointCommitAuthorityPinsV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly packageId: TransactionPackageIdV1;
  readonly artifactRuntime: TransactionArtifactRuntimeV1;
  readonly artifactId: TransactionArtifactIdV1;
  readonly sourcePackageHash: TransactionSourcePackageSha256HexV1;
  readonly executionModule: TransactionExecutionModuleV1;
  readonly functionPath: TransactionFunctionPathV1;
  readonly functionKind: "mutation";
  readonly policyVersion: TransactionPolicyVersionV1;
  readonly authorizationRevocationEpoch: TransactionAuthorizationRevocationEpoch;
  readonly requestKey: TransactionRequestKeyV1;
}

export interface PointCommitSessionScalarsV1 {
  readonly lifecycle: "running" | "finishing";
  readonly storageGeneration: string;
  readonly storageGenerationFence: bigint;
  readonly packageId: string;
  readonly artifactRuntime: string;
  readonly artifactId: string;
  readonly sourcePackageHash: string;
  readonly executionModule: string;
  readonly functionPath: string;
  readonly functionKind: string;
  readonly schemaVersionId: string;
  readonly policyVersion: string;
  readonly identityAccessPolicySha256: Uint8Array;
  readonly validatedArgsValueCodecVersion: number;
  readonly validatedArgsCanonicalByteLength: number;
  readonly validatedArgsSha256: Uint8Array;
  readonly authorizationGrantId: TransactionAuthorizationGrantIdV1;
  readonly authorizationGrantValueCodecVersion: number;
  readonly authorizationGrantCanonicalByteLength: number;
  readonly authorizationGrantSha256: Uint8Array;
  readonly authorizationRevocationEpoch: bigint;
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly requestKey: string;
  readonly requestSha256: Uint8Array;
  readonly protocolVersion: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}

export interface PointCommitSealIdentityV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly lifecycle: "running" | "finishing";
  readonly sessionUpdatedAtMilliseconds: number;
  readonly leaseExpiresAtMilliseconds: number;
  readonly rootCreatedAtMilliseconds: number;
  readonly rootUpdatedAtMilliseconds: number;
  readonly sealedAtMilliseconds: number;
  readonly finalSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly creationTimeSeed: AppCreationTimeV1;
  readonly nextCreationTime: AppCreationTimeV1;
  readonly journalFormat: typeof SESSION_JOURNAL_FORMAT_V1;
  readonly journalProtocolVersion: number;
  readonly journalValueCodecVersion: FlarexValueCodecVersion;
  readonly journalByteLength: number;
  readonly journalSha256: Uint8Array;
  readonly resultValueCodecVersion: FlarexValueCodecVersion;
  readonly resultSemanticBytes: number;
  readonly resultByteLength: number;
  readonly resultSha256: Uint8Array;
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointDependencyCount: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes:
    CommitMaterialWriteEventEvidenceBytesV1;
}

export interface PointCommitDependencyV1 {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly dependency: LogicalReadDependencyV1;
}

export type PointCommitRowIntentV1 =
  | Readonly<PointCommitDependencyV1 & {
      readonly kind: "live";
      readonly creationTime: AppCreationTimeV1;
      readonly value: CanonicalFlarexRuntimeValueV1;
      readonly canonicalBytes: Uint8Array;
      readonly semanticSizeBytes: number;
    }>
  | Readonly<PointCommitDependencyV1 & {
      readonly kind: "deleted";
    }>;

export interface PointCommitTransactionCommandV1 {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitSessionScalarsV1;
  readonly sealIdentity: PointCommitSealIdentityV1;
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
  readonly rowIntent: PointCommitRowIntentV1 | null;
}

export interface PointCommitWouldCommitV1 {
  readonly kind: "wouldCommit";
}

export class PointCommitConflictV1Error extends Data.TaggedError(
  "PointCommitConflictV1Error",
)<{
  readonly documentId: AppDocumentIdV1;
  readonly snapshotCommitSeq: CommitSeq;
  readonly currentCommitSeq: CommitSeq;
}> {}

export type PointCommitStaleAuthorityReasonV1 =
  | "placementChanged"
  | "scopeChanged"
  | "generationChanged"
  | "epochChanged"
  | "revocationEpochChanged"
  | "attemptMissing"
  | "attemptReplaced"
  | "lifecycleChanged"
  | "snapshotChanged"
  | "leaseMissing"
  | "leaseReplaced"
  | "expired";

export class PointCommitStaleAuthorityV1Error extends Data.TaggedError(
  "PointCommitStaleAuthorityV1Error",
)<{
  readonly reason: PointCommitStaleAuthorityReasonV1;
}> {}

export type PointCommitCorruptionReasonV1 =
  | "commandInvalid"
  | "readCommittedCapabilityMissing"
  | "scopeClockInvalid"
  | "sessionDuplicate"
  | "sessionInvalid"
  | "leaseDuplicate"
  | "leaseInvalid"
  | "journalRootMissingOrDuplicate"
  | "journalRootInvalid"
  | "dependencySetInvalid"
  | "rowHeadInvalid"
  | "occEvidenceInvalid"
  | "rowTransitionInvalid"
  | "rowWriteInvalid"
  | "rollbackSentinelMissing";

export class PointCommitCorruptionV1Error extends Data.TaggedError(
  "PointCommitCorruptionV1Error",
)<{
  readonly reason: PointCommitCorruptionReasonV1;
}> {}

export class PointCommitResourceExhaustionV1Error extends Data.TaggedError(
  "PointCommitResourceExhaustionV1Error",
)<{
  readonly dimension: "commitSequence";
  readonly maximum: bigint;
}> {}

export type PointCommitSqlOperationV1 =
  | "resolveAuthority"
  | "beginOrRollback"
  | "lockScopeClock"
  | "lockSession"
  | "lockLease"
  | "lockJournalRoot"
  | "readDatabaseTime"
  | "loadRowHeads"
  | "writeTentativeRow";

export class PointCommitSqlErrorV1 extends Data.TaggedError(
  "PointCommitSqlErrorV1",
)<{
  readonly operation: PointCommitSqlOperationV1;
  readonly sqlState?: string;
  readonly retryable: boolean;
  readonly cause: unknown;
}> {}

export type PointCommitRollbackProofV1Error =
  | PointCommitConflictV1Error
  | PointCommitStaleAuthorityV1Error
  | PointCommitCorruptionV1Error
  | PointCommitResourceExhaustionV1Error
  | PointCommitSqlErrorV1;

export interface PointCommitRollbackProofPortV1 {
  readonly prove: (
    command: PointCommitTransactionCommandV1,
  ) => Effect.Effect<
    PointCommitWouldCommitV1,
    PointCommitRollbackProofV1Error,
    never
  >;
}

export type PointCommitTransactionProofStepV1 =
  | "clockLocked"
  | "sessionLocked"
  | "leaseLocked"
  | "journalRootLocked"
  | "dependenciesValidated"
  | "tentativeRowWritten"
  | "beforeRollback";

export interface PointCommitTransactionProofOptionsV1 {
  readonly afterTransactionStep?: (
    event: Readonly<{
      readonly scopeId: ReplacementScopeIdV1;
      readonly step: PointCommitTransactionProofStepV1;
    }>,
  ) => Promise<void>;
  readonly observeQuery?: (
    query: Readonly<{
      readonly name: PointCommitSqlOperationV1;
      readonly sql: string;
      readonly params: ReadonlyArray<unknown>;
    }>,
  ) => void;
}

interface PreparedLivePointCommitRowIntentV1
  extends Omit<Extract<PointCommitRowIntentV1, { readonly kind: "live" }>,
    "value" | "canonicalBytes" | "semanticSizeBytes"> {
  readonly document: CanonicalFlarexValueV1;
}

type PreparedPointCommitRowIntentV1 =
  | PreparedLivePointCommitRowIntentV1
  | Extract<PointCommitRowIntentV1, { readonly kind: "deleted" }>;

interface PreparedPointCommitTransactionCommandV1
  extends Omit<PointCommitTransactionCommandV1, "rowIntent"> {
  readonly rowIntent: PreparedPointCommitRowIntentV1 | null;
}

const WOULD_COMMIT = Object.freeze({
  kind: "wouldCommit",
} satisfies PointCommitWouldCommitV1);

const ROLLBACK_SENTINEL = Object.freeze({
  kind: "pointCommitRollbackSentinel",
});

class PointCommitSqlFailureMarkerV1 {
  constructor(
    readonly operation: PointCommitSqlOperationV1,
    readonly cause: unknown,
  ) {}
}

export function createPointCommitRollbackProofPortV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointCommitTransactionProofOptionsV1 = {},
): PointCommitRollbackProofPortV1 {
  const prove: PointCommitRollbackProofPortV1["prove"] = Effect.fn(
    "PointCommitTransaction.proveRollback",
  )(function* (input) {
    const command = yield* Effect.tryPromise({
      try: () => preparePointCommitCommand(input),
      catch: mapCommandPreparationFailure,
    });
    const located = yield* Effect.tryPromise({
      try: () => resolveLocatedTrustedScopeAuthority(
        command.authorityPins.deploymentId,
        {
          scopeMetadata: ports.scopeMetadata,
          provisioningReceipts: ports.provisioningReceipts,
          scopeClockTargets: ports.scopeSessionTargets,
        },
      ),
      catch: mapAuthorityResolutionFailure,
    });
    const preliminaryFailure = preliminaryAuthorityFailure(
      command,
      located.authority,
    );
    if (preliminaryFailure !== null) {
      return yield* Effect.fail(preliminaryFailure);
    }
    const target = isLocatedReadCommittedAttemptTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(corruption(
        "readCommittedCapabilityMissing",
      ));
    }
    return yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => runRollbackProof(
        target,
        located.authority,
        command,
        options,
      ),
      catch: mapTransactionFailure,
    }));
  });

  return Object.freeze({ prove });
}

async function preparePointCommitCommand(
  input: PointCommitTransactionCommandV1,
): Promise<PreparedPointCommitTransactionCommandV1> {
  const captured = capturePointCommitCommand(input);
  if (captured.rowIntent === null) {
    return Object.freeze({ ...captured, rowIntent: null });
  }
  if (captured.rowIntent.kind === "deleted") {
    return Object.freeze({
      ...captured,
      rowIntent: captured.rowIntent,
    });
  }
  const rowIntent = captured.rowIntent;
  const document = await canonicalizeFlarexValueV1(
    rowIntent.value,
    "appDocument",
  );
  if (
    !bytesEqual(document.canonicalBytes, rowIntent.canonicalBytes) ||
    document.semanticSizeBytes !== rowIntent.semanticSizeBytes ||
    !isCanonicalDocumentForIntent(document, rowIntent)
  ) {
    throw corruption("commandInvalid");
  }
  return Object.freeze({
    ...captured,
    rowIntent: Object.freeze({
      documentId: rowIntent.documentId,
      tableId: rowIntent.tableId,
      rowId: rowIntent.rowId,
      dependency: rowIntent.dependency,
      kind: "live",
      creationTime: rowIntent.creationTime,
      document,
    } satisfies PreparedLivePointCommitRowIntentV1),
  });
}

function capturePointCommitCommand(
  input: PointCommitTransactionCommandV1,
): PointCommitTransactionCommandV1 {
  if (
    input.session.lifecycle !== "finishing" ||
    input.sealIdentity.lifecycle !== "finishing"
  ) {
    throw stale("lifecycleChanged");
  }
  const authorityPins = captureAuthorityPins(input.authorityPins);
  const session = captureSessionScalars(input.session);
  const sealIdentity = captureSealIdentity(input.sealIdentity);
  requireCommandAuthorityConsistency(authorityPins, session, sealIdentity);

  if (
    !Array.isArray(input.dependencies) ||
    input.dependencies.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 ||
    input.dependencies.length !== sealIdentity.pointDependencyCount
  ) {
    throw corruption("commandInvalid");
  }
  const dependencies = Object.freeze(input.dependencies.map(
    capturePointDependency,
  ));
  requireCanonicalDependencyOrder(dependencies);
  const rowIntent = input.rowIntent === null
    ? null
    : captureRowIntent(input.rowIntent);
  if (rowIntent !== null && !dependencies.some(
    (dependency) => pointDependenciesEqual(dependency, rowIntent),
  )) {
    throw corruption("commandInvalid");
  }

  return Object.freeze({
    authorityPins,
    session,
    sealIdentity,
    dependencies,
    rowIntent,
  });
}

function captureAuthorityPins(
  input: PointCommitAuthorityPinsV1,
): Readonly<PointCommitAuthorityPinsV1> {
  if (
    input.storageGeneration !== "flarexdb_v1" ||
    input.storageGenerationFence < 1n ||
    input.snapshotToken.scopeId !== input.scopeId ||
    input.snapshotToken.commitSeq < 0n ||
    input.functionKind !== "mutation"
  ) {
    throw corruption("commandInvalid");
  }
  return Object.freeze({
    ...input,
    snapshotToken: Object.freeze({ ...input.snapshotToken }),
  });
}

function captureSessionScalars(
  input: PointCommitSessionScalarsV1,
): Readonly<PointCommitSessionScalarsV1> {
  if (
    input.storageGeneration !== "flarexdb_v1" ||
    input.storageGenerationFence < 1n ||
    input.validatedArgsValueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
    input.authorizationGrantValueCodecVersion !==
      FLAREX_VALUE_CODEC_VERSION_V1 ||
    input.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
    !isPositiveSafeInteger(input.validatedArgsCanonicalByteLength) ||
    !isPositiveSafeInteger(input.authorizationGrantCanonicalByteLength) ||
    !validHash(input.identityAccessPolicySha256) ||
    !validHash(input.validatedArgsSha256) ||
    !validHash(input.authorizationGrantSha256) ||
    !validHash(input.requestSha256) ||
    !validEpochMilliseconds(input.authorizationGrantExpiresAtMilliseconds) ||
    !validEpochMilliseconds(input.hardExpiresAtMilliseconds) ||
    !validEpochMilliseconds(input.createdAtMilliseconds) ||
    !validEpochMilliseconds(input.updatedAtMilliseconds) ||
    input.updatedAtMilliseconds < input.createdAtMilliseconds ||
    input.hardExpiresAtMilliseconds !==
      input.authorizationGrantExpiresAtMilliseconds
  ) {
    throw corruption("commandInvalid");
  }
  return Object.freeze({
    ...input,
    identityAccessPolicySha256:
      new Uint8Array(input.identityAccessPolicySha256),
    validatedArgsSha256: new Uint8Array(input.validatedArgsSha256),
    authorizationGrantSha256:
      new Uint8Array(input.authorizationGrantSha256),
    requestSha256: new Uint8Array(input.requestSha256),
  });
}

function captureSealIdentity(
  input: PointCommitSealIdentityV1,
): Readonly<PointCommitSealIdentityV1> {
  let creationTimeSeed: AppCreationTimeV1;
  let nextCreationTime: AppCreationTimeV1;
  try {
    creationTimeSeed = decodeAppCreationTimeV1(input.creationTimeSeed);
    nextCreationTime = decodeAppCreationTimeV1(input.nextCreationTime);
  } catch {
    throw corruption("commandInvalid");
  }
  if (
    input.journalFormat !== SESSION_JOURNAL_FORMAT_V1 ||
    input.journalProtocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
    input.journalValueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
    input.resultValueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
    input.finalSyscallSequence < 0n ||
    nextCreationTime < creationTimeSeed ||
    !isPositiveSafeInteger(input.journalByteLength) ||
    !isPositiveSafeInteger(input.resultByteLength) ||
    !isNonNegativeSafeInteger(input.resultSemanticBytes) ||
    !isNonNegativeSafeInteger(input.readDocuments) ||
    !isNonNegativeSafeInteger(input.readSemanticBytes) ||
    !isNonNegativeSafeInteger(input.pointDependencyCount) ||
    !isNonNegativeSafeInteger(input.writeOperations) ||
    !isNonNegativeSafeInteger(input.writeSemanticBytes) ||
    !isNonNegativeSafeInteger(input.materialWriteEventEvidenceBytes) ||
    !validHash(input.journalSha256) ||
    !validHash(input.resultSha256) ||
    !validEpochMilliseconds(input.sessionUpdatedAtMilliseconds) ||
    !validEpochMilliseconds(input.leaseExpiresAtMilliseconds) ||
    !validEpochMilliseconds(input.rootCreatedAtMilliseconds) ||
    !validEpochMilliseconds(input.rootUpdatedAtMilliseconds) ||
    !validEpochMilliseconds(input.sealedAtMilliseconds) ||
    input.rootUpdatedAtMilliseconds < input.rootCreatedAtMilliseconds ||
    input.sealedAtMilliseconds < input.rootCreatedAtMilliseconds
  ) {
    throw corruption("commandInvalid");
  }
  return Object.freeze({
    ...input,
    creationTimeSeed,
    nextCreationTime,
    journalSha256: new Uint8Array(input.journalSha256),
    resultSha256: new Uint8Array(input.resultSha256),
  });
}

function requireCommandAuthorityConsistency(
  pins: Readonly<PointCommitAuthorityPinsV1>,
  session: Readonly<PointCommitSessionScalarsV1>,
  seal: Readonly<PointCommitSealIdentityV1>,
): void {
  let projectedScopeUuid: ScopeUuidV1;
  try {
    projectedScopeUuid = projectScopeIdUuidV1(pins.scopeId).scopeUuid;
  } catch {
    throw corruption("commandInvalid");
  }
  if (
    seal.scopeUuid !== projectedScopeUuid ||
    seal.sessionUpdatedAtMilliseconds !== session.updatedAtMilliseconds ||
    seal.leaseExpiresAtMilliseconds > session.hardExpiresAtMilliseconds ||
    pins.storageGeneration !== session.storageGeneration ||
    pins.storageGenerationFence !== session.storageGenerationFence ||
    pins.packageId !== session.packageId ||
    pins.artifactRuntime !== session.artifactRuntime ||
    pins.artifactId !== session.artifactId ||
    pins.sourcePackageHash !== session.sourcePackageHash ||
    pins.executionModule !== session.executionModule ||
    pins.functionPath !== session.functionPath ||
    pins.functionKind !== session.functionKind ||
    pins.schemaVersionId !== session.schemaVersionId ||
    pins.policyVersion !== session.policyVersion ||
    pins.authorizationRevocationEpoch !==
      session.authorizationRevocationEpoch ||
    pins.requestKey !== session.requestKey
  ) {
    throw corruption("commandInvalid");
  }
}

function capturePointDependency(
  input: PointCommitDependencyV1,
): Readonly<PointCommitDependencyV1> {
  try {
    const tableId = decodeCatalogTableId(input.tableId);
    const rowId = decodeAppRowIdHexV1(input.rowId);
    const identity = decodeAppDocumentIdentityV1(input.documentId);
    if (
      identity.tableId !== tableId ||
      identity.rowId !== rowId ||
      input.dependency.kind !== "appRowPoint" ||
      input.dependency.documentId !== identity.id
    ) {
      throw corruption("commandInvalid");
    }
    const dependency = captureLogicalDependency(input.dependency);
    return Object.freeze({
      documentId: identity.id,
      tableId,
      rowId,
      dependency,
    });
  } catch (cause) {
    if (cause instanceof PointCommitCorruptionV1Error) throw cause;
    throw corruption("commandInvalid");
  }
}

function captureLogicalDependency(
  input: LogicalReadDependencyV1,
): LogicalReadDependencyV1 {
  switch (input.observed.kind) {
    case "present":
      return Object.freeze({
        kind: "appRowPoint",
        documentId: input.documentId,
        observed: Object.freeze({
          kind: "present",
          revisionCommitSeq: input.observed.revisionCommitSeq,
        }),
      });
    case "missing":
      switch (input.observed.basis.kind) {
        case "noVisibleRevision":
          return Object.freeze({
            kind: "appRowPoint",
            documentId: input.documentId,
            observed: Object.freeze({
              kind: "missing",
              basis: Object.freeze({ kind: "noVisibleRevision" }),
            }),
          });
        case "tombstone":
          return Object.freeze({
            kind: "appRowPoint",
            documentId: input.documentId,
            observed: Object.freeze({
              kind: "missing",
              basis: Object.freeze({
                kind: "tombstone",
                revisionCommitSeq:
                  input.observed.basis.revisionCommitSeq,
              }),
            }),
          });
      }
  }
}

function captureRowIntent(
  input: PointCommitRowIntentV1,
): Readonly<PointCommitRowIntentV1> {
  const dependency = capturePointDependency(input);
  if (input.kind === "deleted") {
    return Object.freeze({ ...dependency, kind: "deleted" });
  }
  let creationTime: AppCreationTimeV1;
  try {
    creationTime = decodeAppCreationTimeV1(input.creationTime);
  } catch {
    throw corruption("commandInvalid");
  }
  if (
    !(input.canonicalBytes instanceof Uint8Array) ||
    input.canonicalBytes.byteLength === 0 ||
    !isPositiveSafeInteger(input.semanticSizeBytes)
  ) {
    throw corruption("commandInvalid");
  }
  return Object.freeze({
    ...dependency,
    kind: "live",
    creationTime,
    value: structuredClone(input.value),
    canonicalBytes: new Uint8Array(input.canonicalBytes),
    semanticSizeBytes: input.semanticSizeBytes,
  });
}

function requireCanonicalDependencyOrder(
  dependencies: ReadonlyArray<Readonly<PointCommitDependencyV1>>,
): void {
  for (let index = 1; index < dependencies.length; index += 1) {
    const previous = dependencies[index - 1];
    const current = dependencies[index];
    if (previous === undefined || current === undefined) {
      throw corruption("commandInvalid");
    }
    const tableDifference = previous.tableId - current.tableId;
    const rowDifference = compareRowIds(previous.rowId, current.rowId);
    if (tableDifference > 0 || (tableDifference === 0 && rowDifference >= 0)) {
      throw corruption("commandInvalid");
    }
  }
}

function compareRowIds(left: AppRowIdHexV1, right: AppRowIdHexV1): number {
  const leftBytes = appRowIdHexV1ToBytes(left);
  const rightBytes = appRowIdHexV1ToBytes(right);
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function pointDependenciesEqual(
  left: PointCommitDependencyV1,
  right: PointCommitDependencyV1,
): boolean {
  if (
    left.documentId !== right.documentId ||
    left.tableId !== right.tableId ||
    left.rowId !== right.rowId ||
    left.dependency.observed.kind !== right.dependency.observed.kind
  ) {
    return false;
  }
  if (
    left.dependency.observed.kind === "present" &&
    right.dependency.observed.kind === "present"
  ) {
    return left.dependency.observed.revisionCommitSeq ===
      right.dependency.observed.revisionCommitSeq;
  }
  if (
    left.dependency.observed.kind !== "missing" ||
    right.dependency.observed.kind !== "missing" ||
    left.dependency.observed.basis.kind !==
      right.dependency.observed.basis.kind
  ) {
    return false;
  }
  return left.dependency.observed.basis.kind === "noVisibleRevision" ||
    (
      right.dependency.observed.basis.kind === "tombstone" &&
      left.dependency.observed.basis.revisionCommitSeq ===
        right.dependency.observed.basis.revisionCommitSeq
    );
}

function isCanonicalDocumentForIntent(
  document: CanonicalFlarexValueV1,
  intent: Extract<PointCommitRowIntentV1, { readonly kind: "live" }>,
): boolean {
  const value = document.value;
  if (!isCanonicalFlarexRuntimeObjectV1(value)) return false;
  return value._id === intent.documentId &&
    value._creationTime === intent.creationTime;
}

interface LockedPointCommitClockV1 {
  readonly record: ReturnType<typeof decodeScopeClockRecord>;
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ReturnType<typeof decodeScopeEpochUuidV1>;
  readonly authorizationRevocationEpoch: TransactionAuthorizationRevocationEpoch;
}

interface LockedPointCommitSessionV1 {
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
}

interface LockedPointCommitLeaseV1 {
  readonly expiresAtMilliseconds: number;
}

interface LoadedPointCommitHeadV1 {
  readonly head: AppRowPointHeadObservationV1;
  readonly creationTime: AppCreationTimeV1 | null;
}

interface PointCommitKernelResultV1 {
  readonly tentativeCommitSeq: CommitSeq | null;
}

async function runRollbackProof(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<PointCommitWouldCommitV1> {
  try {
    await target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
      await runPointCommitTransactionKernel(
        tx,
        preliminaryAuthority,
        command,
        options,
      );
      await emitTransactionStep(options, command, "beforeRollback");
      throw ROLLBACK_SENTINEL;
    });
  } catch (cause) {
    if (cause === ROLLBACK_SENTINEL) return WOULD_COMMIT;
    throw cause;
  }
  throw corruption("rollbackSentinelMissing");
}

/**
 * The reusable O06 transaction body. O07 will add publication atoms around
 * this exact locked validation/lowering path and will be the first caller
 * allowed to return normally from the transaction.
 */
async function runPointCommitTransactionKernel(
  tx: AppRowTransaction,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<PointCommitKernelResultV1> {
  const clock = await lockPointCommitClock(tx, command, options);
  await emitTransactionStep(options, command, "clockLocked");
  requireLockedClockAuthority(clock, preliminaryAuthority, command);

  const session = await lockPointCommitSession(tx, command, options);
  await emitTransactionStep(options, command, "sessionLocked");
  const lease = await lockPointCommitLease(tx, command, options);
  await emitTransactionStep(options, command, "leaseLocked");
  await lockPointCommitJournalRoot(tx, command, options);
  await emitTransactionStep(options, command, "journalRootLocked");

  const databaseNowMilliseconds = await readPointCommitDatabaseTime(
    tx,
    command.authorityPins.scopeId,
    options,
  );
  requireAttemptIsLive(session, lease, databaseNowMilliseconds);

  const loadedHeads = await loadPointCommitHeads(
    tx,
    clock,
    command,
    options,
  );
  validatePointCommitDependencies(command, loadedHeads);
  await emitTransactionStep(options, command, "dependenciesValidated");

  if (command.rowIntent === null) {
    return Object.freeze({ tentativeCommitSeq: null });
  }
  const preWriteDatabaseNowMilliseconds = await readPointCommitDatabaseTime(
    tx,
    command.authorityPins.scopeId,
    options,
  );
  requireAttemptIsLive(session, lease, preWriteDatabaseNowMilliseconds);
  if (clock.record.lastCommitSeq >= MAX_SIGNED_COMMIT_SEQ) {
    throw new PointCommitResourceExhaustionV1Error({
      dimension: "commitSequence",
      maximum: MAX_SIGNED_COMMIT_SEQ,
    });
  }
  const tentativeCommitSeq = CommitSeqSchema.make(
    clock.record.lastCommitSeq + 1n,
  );
  await lowerTentativePointCommitRow(
    tx,
    clock.record.epoch,
    tentativeCommitSeq,
    command,
    loadedHeads,
  );
  await emitTransactionStep(options, command, "tentativeRowWritten");
  return Object.freeze({ tentativeCommitSeq });
}

async function lockPointCommitClock(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<LockedPointCommitClockV1> {
  const query = tx
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(
      fxSystemScopeClocks.scopeId,
      command.authorityPins.scopeId,
    ))
    .limit(2)
    .for("update");
  observeDrizzleQuery("lockScopeClock", query, options);
  const rows = await sqlCall("lockScopeClock", () => query);
  if (rows.length === 0) {
    throw stale("scopeChanged");
  }
  if (rows.length !== 1) throw corruption("scopeClockInvalid");
  const row = rows[0];
  if (row === undefined) throw corruption("scopeClockInvalid");
  try {
    const record = decodeScopeClockRecord(row);
    const scopeUuid = decodeScopeUuidV1(row.scopeUuid);
    const epochUuid = decodeScopeEpochUuidV1(row.epochUuid);
    if (
      scopeUuid !== projectScopeIdUuidV1(record.scopeId).scopeUuid ||
      epochUuid !== projectScopeEpochUuidV1(record.epoch).epochUuid
    ) {
      throw new Error("Native scope-clock projection mismatch.");
    }
    return Object.freeze({
      record,
      scopeUuid,
      epochUuid,
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(
          row.authorizationRevocationEpoch,
        ),
    });
  } catch {
    throw corruption("scopeClockInvalid");
  }
}

function requireLockedClockAuthority(
  clock: LockedPointCommitClockV1,
  preliminary: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
): void {
  const pins = command.authorityPins;
  if (
    clock.record.scopeId !== pins.scopeId ||
    preliminary.scopeId !== pins.scopeId ||
    preliminary.deploymentId !== pins.deploymentId ||
    clock.scopeUuid !== command.sealIdentity.scopeUuid
  ) {
    throw stale("scopeChanged");
  }
  if (
    clock.record.storageGeneration !== "flarexdb_v1" ||
    preliminary.storageGeneration !== "flarexdb_v1" ||
    clock.record.storageGeneration !== pins.storageGeneration ||
    preliminary.storageGeneration !== pins.storageGeneration ||
    clock.record.storageGenerationFence !== pins.storageGenerationFence ||
    preliminary.storageGenerationFence !== pins.storageGenerationFence
  ) {
    throw stale("generationChanged");
  }
  if (
    clock.record.epoch !== pins.snapshotToken.epoch ||
    preliminary.epoch !== pins.snapshotToken.epoch
  ) {
    throw stale("epochChanged");
  }
  if (
    clock.authorizationRevocationEpoch !==
      pins.authorizationRevocationEpoch
  ) {
    throw stale("revocationEpochChanged");
  }
  if (pins.snapshotToken.commitSeq > clock.record.lastCommitSeq) {
    throw corruption("scopeClockInvalid");
  }
}

async function lockPointCommitSession(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<LockedPointCommitSessionV1> {
  const query = tx
    .select({
      scopeUuid: fxSystemTransactionSessions.scopeUuid,
      sessionId: fxSystemTransactionSessions.sessionId,
      storageGeneration: fxSystemTransactionSessions.storageGeneration,
      storageGenerationFence:
        fxSystemTransactionSessions.storageGenerationFence,
      packageId: fxSystemTransactionSessions.packageId,
      artifactRuntime: fxSystemTransactionSessions.artifactRuntime,
      artifactId: fxSystemTransactionSessions.artifactId,
      sourcePackageHash: fxSystemTransactionSessions.sourcePackageHash,
      executionModule: fxSystemTransactionSessions.executionModule,
      functionPath: fxSystemTransactionSessions.functionPath,
      functionKind: fxSystemTransactionSessions.functionKind,
      schemaVersionId: fxSystemTransactionSessions.schemaVersionId,
      policyVersion: fxSystemTransactionSessions.policyVersion,
      identityAccessPolicySha256:
        fxSystemTransactionSessions.identityAccessPolicySha256,
      validatedArgsValueCodecVersion:
        fxSystemTransactionSessions.validatedArgsValueCodecVersion,
      validatedArgsCanonicalByteLength: sql<number>`
        octet_length(${fxSystemTransactionSessions.validatedArgsCanonicalBytes})
      `,
      validatedArgsSha256: fxSystemTransactionSessions.validatedArgsSha256,
      authorizationGrantId:
        fxSystemTransactionSessions.authorizationGrantId,
      authorizationGrantValueCodecVersion:
        fxSystemTransactionSessions.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalByteLength: sql<number>`
        octet_length(${fxSystemTransactionSessions.authorizationGrantCanonicalBytes})
      `,
      authorizationGrantSha256:
        fxSystemTransactionSessions.authorizationGrantSha256,
      authorizationRevocationEpoch:
        fxSystemTransactionSessions.authorizationRevocationEpoch,
      authorizationGrantExpiresAt:
        fxSystemTransactionSessions.authorizationGrantExpiresAt,
      requestKey: fxSystemTransactionSessions.requestKey,
      requestSha256: fxSystemTransactionSessions.requestSha256,
      lifecycle: fxSystemTransactionSessions.lifecycle,
      attemptFence: fxSystemTransactionSessions.attemptFence,
      protocolVersion: fxSystemTransactionSessions.protocolVersion,
      hardExpiresAt: fxSystemTransactionSessions.hardExpiresAt,
      createdAt: fxSystemTransactionSessions.createdAt,
      updatedAt: fxSystemTransactionSessions.updatedAt,
    })
    .from(fxSystemTransactionSessions)
    .where(and(
      eq(
        fxSystemTransactionSessions.scopeUuid,
        command.sealIdentity.scopeUuid,
      ),
      eq(
        fxSystemTransactionSessions.sessionId,
        command.authorityPins.sessionId,
      ),
    ))
    .limit(2)
    .for("update");
  observeDrizzleQuery("lockSession", query, options);
  const rows = await sqlCall("lockSession", () => query);
  if (rows.length === 0) throw stale("attemptMissing");
  if (rows.length !== 1) throw corruption("sessionDuplicate");
  const row = rows[0];
  if (row === undefined) throw corruption("sessionDuplicate");
  if (row.attemptFence !== command.authorityPins.attemptFence) {
    throw stale("attemptReplaced");
  }
  if (row.lifecycle !== "finishing") throw stale("lifecycleChanged");
  const expected = command.session;
  if (
    row.scopeUuid !== command.sealIdentity.scopeUuid ||
    row.sessionId !== command.authorityPins.sessionId ||
    row.storageGeneration !== expected.storageGeneration ||
    row.storageGenerationFence !== expected.storageGenerationFence ||
    row.packageId !== expected.packageId ||
    row.artifactRuntime !== expected.artifactRuntime ||
    row.artifactId !== expected.artifactId ||
    row.sourcePackageHash !== expected.sourcePackageHash ||
    row.executionModule !== expected.executionModule ||
    row.functionPath !== expected.functionPath ||
    row.functionKind !== expected.functionKind ||
    row.schemaVersionId !== expected.schemaVersionId ||
    row.policyVersion !== expected.policyVersion ||
    !bytesEqual(
      row.identityAccessPolicySha256,
      expected.identityAccessPolicySha256,
    ) ||
    row.validatedArgsValueCodecVersion !==
      expected.validatedArgsValueCodecVersion ||
    row.validatedArgsCanonicalByteLength !==
      expected.validatedArgsCanonicalByteLength ||
    !bytesEqual(row.validatedArgsSha256, expected.validatedArgsSha256) ||
    row.authorizationGrantId !== expected.authorizationGrantId ||
    row.authorizationGrantValueCodecVersion !==
      expected.authorizationGrantValueCodecVersion ||
    row.authorizationGrantCanonicalByteLength !==
      expected.authorizationGrantCanonicalByteLength ||
    !bytesEqual(
      row.authorizationGrantSha256,
      expected.authorizationGrantSha256,
    ) ||
    row.authorizationRevocationEpoch !==
      expected.authorizationRevocationEpoch ||
    row.requestKey !== expected.requestKey ||
    !bytesEqual(row.requestSha256, expected.requestSha256) ||
    row.protocolVersion !== expected.protocolVersion ||
    !validDate(row.authorizationGrantExpiresAt) ||
    !validDate(row.hardExpiresAt) ||
    !validDate(row.createdAt) ||
    !validDate(row.updatedAt) ||
    row.authorizationGrantExpiresAt.getTime() !==
      expected.authorizationGrantExpiresAtMilliseconds ||
    row.hardExpiresAt.getTime() !== expected.hardExpiresAtMilliseconds ||
    row.createdAt.getTime() !== expected.createdAtMilliseconds ||
    row.updatedAt.getTime() !== expected.updatedAtMilliseconds
  ) {
    throw corruption("sessionInvalid");
  }
  return Object.freeze({
    authorizationGrantExpiresAtMilliseconds:
      row.authorizationGrantExpiresAt.getTime(),
    hardExpiresAtMilliseconds: row.hardExpiresAt.getTime(),
  });
}

async function lockPointCommitLease(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<LockedPointCommitLeaseV1> {
  const query = tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, command.sealIdentity.scopeUuid),
      eq(
        fxSystemSnapshotLeases.sessionId,
        command.authorityPins.sessionId,
      ),
    ))
    .limit(2)
    .for("update");
  observeDrizzleQuery("lockLease", query, options);
  const rows = await sqlCall("lockLease", () => query);
  if (rows.length === 0) throw stale("leaseMissing");
  if (rows.length !== 1) throw corruption("leaseDuplicate");
  const row = rows[0];
  if (row === undefined) throw corruption("leaseDuplicate");
  if (row.attemptFence !== command.authorityPins.attemptFence) {
    throw stale("leaseReplaced");
  }
  let snapshotEpoch: ScopeEpoch;
  try {
    snapshotEpoch = replacementScopeEpochV1FromUuid(row.snapshotEpochUuid);
  } catch {
    throw corruption("leaseInvalid");
  }
  if (
    row.scopeUuid !== command.sealIdentity.scopeUuid ||
    row.sessionId !== command.authorityPins.sessionId ||
    snapshotEpoch !== command.authorityPins.snapshotToken.epoch ||
    row.snapshotCommitSeq !== command.authorityPins.snapshotToken.commitSeq ||
    !validDate(row.leaseExpiresAt) ||
    row.leaseExpiresAt.getTime() !==
      command.sealIdentity.leaseExpiresAtMilliseconds ||
    row.leaseExpiresAt.getTime() > command.session.hardExpiresAtMilliseconds
  ) {
    throw corruption("leaseInvalid");
  }
  return Object.freeze({
    expiresAtMilliseconds: row.leaseExpiresAt.getTime(),
  });
}

async function lockPointCommitJournalRoot(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<void> {
  const query = tx
    .select({
      scopeUuid: fxSystemTransactionJournals.scopeUuid,
      sessionId: fxSystemTransactionJournals.sessionId,
      attemptFence: fxSystemTransactionJournals.attemptFence,
      state: fxSystemTransactionJournals.state,
      lastSyscallSequence:
        fxSystemTransactionJournals.lastSyscallSequence,
      creationTimeSeed: fxSystemTransactionJournals.creationTimeSeed,
      nextCreationTime: fxSystemTransactionJournals.nextCreationTime,
      readDocuments: fxSystemTransactionJournals.readDocuments,
      readSemanticBytes: fxSystemTransactionJournals.readSemanticBytes,
      pointDependencyCount:
        fxSystemTransactionJournals.pointDependencyCount,
      writeOperations: fxSystemTransactionJournals.writeOperations,
      writeSemanticBytes: fxSystemTransactionJournals.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        fxSystemTransactionJournals.materialWriteEventEvidenceBytes,
      failureDimension: fxSystemTransactionJournals.failureDimension,
      sealedFinalSyscallSequence:
        fxSystemTransactionJournals.sealedFinalSyscallSequence,
      sealedJournalByteLength: sql<number | null>`
        octet_length(${fxSystemTransactionJournals.sealedJournalBytes})
      `,
      sealedJournalSha256:
        fxSystemTransactionJournals.sealedJournalSha256,
      sealedResultValueCodecVersion:
        fxSystemTransactionJournals.sealedResultValueCodecVersion,
      sealedResultSemanticBytes:
        fxSystemTransactionJournals.sealedResultSemanticBytes,
      sealedResultByteLength: sql<number | null>`
        octet_length(${fxSystemTransactionJournals.sealedResultBytes})
      `,
      sealedResultSha256:
        fxSystemTransactionJournals.sealedResultSha256,
      sealedAt: fxSystemTransactionJournals.sealedAt,
      createdAt: fxSystemTransactionJournals.createdAt,
      updatedAt: fxSystemTransactionJournals.updatedAt,
    })
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(
        fxSystemTransactionJournals.scopeUuid,
        command.sealIdentity.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournals.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionJournals.attemptFence,
        command.authorityPins.attemptFence,
      ),
    ))
    .limit(2)
    .for("update");
  observeDrizzleQuery("lockJournalRoot", query, options);
  const rows = await sqlCall("lockJournalRoot", () => query);
  if (rows.length !== 1) {
    throw corruption("journalRootMissingOrDuplicate");
  }
  const row = rows[0];
  if (row === undefined) {
    throw corruption("journalRootMissingOrDuplicate");
  }
  const expected = command.sealIdentity;
  if (
    row.scopeUuid !== expected.scopeUuid ||
    row.sessionId !== command.authorityPins.sessionId ||
    row.attemptFence !== command.authorityPins.attemptFence ||
    row.state !== "sealed" ||
    row.failureDimension !== null ||
    row.sealedFinalSyscallSequence === null ||
    row.sealedJournalByteLength === null ||
    row.sealedJournalSha256 === null ||
    row.sealedResultValueCodecVersion === null ||
    row.sealedResultSemanticBytes === null ||
    row.sealedResultByteLength === null ||
    row.sealedResultSha256 === null ||
    row.sealedAt === null ||
    row.lastSyscallSequence !== expected.finalSyscallSequence ||
    row.sealedFinalSyscallSequence !== expected.finalSyscallSequence ||
    row.creationTimeSeed !== expected.creationTimeSeed ||
    row.nextCreationTime !== expected.nextCreationTime ||
    row.readDocuments !== expected.readDocuments ||
    row.readSemanticBytes !== expected.readSemanticBytes ||
    row.pointDependencyCount !== expected.pointDependencyCount ||
    row.writeOperations !== expected.writeOperations ||
    row.writeSemanticBytes !== expected.writeSemanticBytes ||
    row.materialWriteEventEvidenceBytes !==
      expected.materialWriteEventEvidenceBytes ||
    row.sealedJournalByteLength !== expected.journalByteLength ||
    !bytesEqual(row.sealedJournalSha256, expected.journalSha256) ||
    row.sealedResultValueCodecVersion !== expected.resultValueCodecVersion ||
    row.sealedResultSemanticBytes !== expected.resultSemanticBytes ||
    row.sealedResultByteLength !== expected.resultByteLength ||
    !bytesEqual(row.sealedResultSha256, expected.resultSha256) ||
    !validDate(row.createdAt) ||
    !validDate(row.updatedAt) ||
    !validDate(row.sealedAt) ||
    row.createdAt.getTime() !== expected.rootCreatedAtMilliseconds ||
    row.updatedAt.getTime() !== expected.rootUpdatedAtMilliseconds ||
    row.sealedAt.getTime() !== expected.sealedAtMilliseconds
  ) {
    throw corruption("journalRootInvalid");
  }
}

async function readPointCommitDatabaseTime(
  tx: AppRowTransaction,
  scopeId: ReplacementScopeIdV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<number> {
  const query = tx
    .select({
      milliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  observeDrizzleQuery("readDatabaseTime", query, options);
  const rows = await sqlCall("readDatabaseTime", () => query);
  const text = rows[0]?.milliseconds;
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text)) {
    throw corruption("scopeClockInvalid");
  }
  const value = Number(text);
  if (!isPositiveSafeInteger(value)) {
    throw corruption("scopeClockInvalid");
  }
  return value;
}

function requireAttemptIsLive(
  session: LockedPointCommitSessionV1,
  lease: LockedPointCommitLeaseV1,
  databaseNowMilliseconds: number,
): void {
  if (
    session.authorizationGrantExpiresAtMilliseconds <=
      databaseNowMilliseconds ||
    session.hardExpiresAtMilliseconds <= databaseNowMilliseconds ||
    lease.expiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    throw stale("expired");
  }
}

async function loadPointCommitHeads(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitTransactionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<ReadonlyArray<LoadedPointCommitHeadV1>> {
  if (command.dependencies.length === 0) return Object.freeze([]);
  const values = sql.join(
    command.dependencies.map((dependency, ordinal) => sql`
      (
        ${ordinal}::integer,
        ${dependency.tableId}::integer,
        ${appRowIdHexV1ToBytes(dependency.rowId)}::bytea
      )
    `),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, table_id, row_id) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_row.commit_seq::text as "pointerCommitSeqText",
      latest.commit_seq::text as "latestCommitSeqText",
      latest.is_tombstone as "latestIsTombstone",
      latest.creation_time::text as "latestCreationTimeText"
    from requested
    left join fx_app_row_current as current_row
      on current_row.scope_uuid = ${clock.scopeUuid}
      and current_row.table_id = requested.table_id
      and current_row.row_id = requested.row_id
    left join lateral (
      select revision.commit_seq, revision.is_tombstone, revision.creation_time
      from fx_app_row_rev as revision
      where revision.scope_uuid = ${clock.scopeUuid}
        and revision.table_id = requested.table_id
        and revision.row_id = requested.row_id
      order by revision.commit_seq desc
      limit 1
    ) as latest on true
    order by requested.ordinal asc
  `;
  options.observeQuery?.(Object.freeze({
    name: "loadRowHeads",
    sql: "bounded VALUES with current-pointer and latest-revision correlation",
    params: Object.freeze([]),
  }));
  const result = await sqlCall(
    "loadRowHeads",
    () => tx.execute(statement),
  );
  const rows = rowsFromExecuteResult(result);
  if (rows.length !== command.dependencies.length) {
    throw corruption("rowHeadInvalid");
  }
  return Object.freeze(rows.map((raw, ordinal) => decodePointCommitHead(
    raw,
    ordinal,
    command.dependencies[ordinal],
    command.authorityPins.scopeId,
    clock.record.lastCommitSeq,
  )));
}

function decodePointCommitHead(
  raw: unknown,
  expectedOrdinal: number,
  dependency: PointCommitDependencyV1 | undefined,
  scopeId: ReplacementScopeIdV1,
  lastCommitSeq: CommitSeq,
): LoadedPointCommitHeadV1 {
  if (dependency === undefined || !isNonArrayRecord(raw)) {
    throw corruption("rowHeadInvalid");
  }
  const ordinal = parseNonNegativeIntegerText(raw.ordinalText);
  const pointerCommitSeq = parseNullableCommitSeqText(
    raw.pointerCommitSeqText,
  );
  const latestCommitSeq = parseNullableCommitSeqText(
    raw.latestCommitSeqText,
  );
  if (
    ordinal !== expectedOrdinal ||
    (pointerCommitSeq === null) !== (latestCommitSeq === null) ||
    pointerCommitSeq !== latestCommitSeq
  ) {
    throw corruption("rowHeadInvalid");
  }
  const identity = freezeRowIdentity(dependency, scopeId);
  if (latestCommitSeq === null) {
    if (
      raw.latestIsTombstone !== null ||
      raw.latestCreationTimeText !== null
    ) {
      throw corruption("rowHeadInvalid");
    }
    return Object.freeze({
      head: Object.freeze({ kind: "missing", identity }),
      creationTime: null,
    });
  }
  if (
    latestCommitSeq > lastCommitSeq ||
    typeof raw.latestIsTombstone !== "boolean" ||
    typeof raw.latestCreationTimeText !== "string"
  ) {
    throw corruption("rowHeadInvalid");
  }
  let creationTime: AppCreationTimeV1;
  try {
    creationTime = decodeAppCreationTimeV1(
      Number(raw.latestCreationTimeText),
    );
  } catch {
    throw corruption("rowHeadInvalid");
  }
  return Object.freeze({
    head: Object.freeze({
      kind: raw.latestIsTombstone ? "tombstone" : "live",
      identity,
      revisionCommitSeq: latestCommitSeq,
    }),
    creationTime,
  });
}

function validatePointCommitDependencies(
  command: PreparedPointCommitTransactionCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): void {
  if (heads.length !== command.dependencies.length) {
    throw corruption("dependencySetInvalid");
  }
  for (let index = 0; index < command.dependencies.length; index += 1) {
    const dependency = command.dependencies[index];
    const loaded = heads[index];
    if (dependency === undefined || loaded === undefined) {
      throw corruption("dependencySetInvalid");
    }
    const validation = validateAppRowPointOccV1({
      snapshotToken: command.authorityPins.snapshotToken,
      dependency: adaptPointDependency(
        command.authorityPins.scopeId,
        dependency,
      ),
      head: loaded.head,
    });
    switch (validation.kind) {
      case "valid":
        break;
      case "conflict":
        throw new PointCommitConflictV1Error({
          documentId: dependency.documentId,
          snapshotCommitSeq: validation.conflict.snapshotCommitSeq,
          currentCommitSeq: validation.conflict.currentState.revisionCommitSeq,
        });
      case "invalidEvidence":
        throw corruption("occEvidenceInvalid");
    }
  }
}

function adaptPointDependency(
  scopeId: ReplacementScopeIdV1,
  input: PointCommitDependencyV1,
): AppRowPointDependencyV1 {
  const identity = freezeRowIdentity(input, scopeId);
  switch (input.dependency.observed.kind) {
    case "present":
      return Object.freeze({
        kind: "present",
        identity,
        revisionCommitSeq:
          input.dependency.observed.revisionCommitSeq,
      });
    case "missing":
      switch (input.dependency.observed.basis.kind) {
        case "noVisibleRevision":
          return Object.freeze({
            kind: "missing",
            identity,
            basis: Object.freeze({ kind: "noVisibleRevision" }),
          });
        case "tombstone":
          return Object.freeze({
            kind: "missing",
            identity,
            basis: Object.freeze({
              kind: "tombstone",
              revisionCommitSeq:
                input.dependency.observed.basis.revisionCommitSeq,
            }),
          });
      }
  }
}

async function lowerTentativePointCommitRow(
  tx: AppRowTransaction,
  writeEpoch: ScopeEpoch,
  tentativeCommitSeq: CommitSeq,
  command: PreparedPointCommitTransactionCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): Promise<void> {
  const intent = command.rowIntent;
  if (intent === null) throw corruption("rowTransitionInvalid");
  const index = command.dependencies.findIndex(
    (dependency) => pointDependenciesEqual(dependency, intent),
  );
  const loaded = heads[index];
  if (index < 0 || loaded === undefined) {
    throw corruption("rowTransitionInvalid");
  }
  const observed = intent.dependency.observed;
  if (intent.kind === "deleted") {
    if (
      observed.kind !== "present" ||
      loaded.head.kind !== "live" ||
      loaded.creationTime === null
    ) {
      throw corruption("rowTransitionInvalid");
    }
    const predecessorCommitSeq = loaded.head.revisionCommitSeq;
    const creationTime = loaded.creationTime;
    await sqlCall("writeTentativeRow", () =>
      appendPreparedAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "tombstone",
        scopeId: command.authorityPins.scopeId,
        tableId: intent.tableId,
        rowId: intent.rowId,
        writeEpoch,
        commitSeq: tentativeCommitSeq,
        prevCommitSeq: predecessorCommitSeq,
        schemaVersionId: command.authorityPins.schemaVersionId,
        creationTime,
      }));
    return;
  }

  let prevCommitSeq: CommitSeq | null;
  if (
    observed.kind === "missing" &&
    observed.basis.kind === "noVisibleRevision" &&
    loaded.head.kind === "missing"
  ) {
    prevCommitSeq = null;
  } else if (
    observed.kind === "present" &&
    loaded.head.kind === "live"
  ) {
    prevCommitSeq = loaded.head.revisionCommitSeq;
  } else {
    throw corruption("rowTransitionInvalid");
  }
  await sqlCall("writeTentativeRow", () =>
    appendPreparedAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
      rowId: intent.rowId,
      writeEpoch,
      commitSeq: tentativeCommitSeq,
      prevCommitSeq,
      schemaVersionId: command.authorityPins.schemaVersionId,
      creationTime: intent.creationTime,
      document: intent.document,
    }));
}

function freezeRowIdentity(
  input: Pick<PointCommitDependencyV1, "tableId" | "rowId">,
  scopeId: ReplacementScopeIdV1,
): Readonly<AppRowIdentityV1> {
  return Object.freeze({
    scopeId,
    tableId: input.tableId,
    rowId: input.rowId,
  });
}

async function emitTransactionStep(
  options: PointCommitTransactionProofOptionsV1,
  command: PreparedPointCommitTransactionCommandV1,
  step: PointCommitTransactionProofStepV1,
): Promise<void> {
  await options.afterTransactionStep?.(Object.freeze({
    scopeId: command.authorityPins.scopeId,
    step,
  }));
}

function preliminaryAuthorityFailure(
  command: PreparedPointCommitTransactionCommandV1,
  preliminary: TrustedScopeAuthority,
): PointCommitStaleAuthorityV1Error | null {
  const pins = command.authorityPins;
  if (
    preliminary.deploymentId !== pins.deploymentId ||
    preliminary.scopeId !== pins.scopeId
  ) {
    return stale("scopeChanged");
  }
  if (
    preliminary.storageGeneration !== pins.storageGeneration ||
    preliminary.storageGenerationFence !== pins.storageGenerationFence
  ) {
    return stale("generationChanged");
  }
  if (preliminary.epoch !== pins.snapshotToken.epoch) {
    return stale("epochChanged");
  }
  return null;
}

function observeDrizzleQuery(
  name: PointCommitSqlOperationV1,
  query: Readonly<{
    toSQL: () => Readonly<{
      sql: string;
      params: ReadonlyArray<unknown>;
    }>;
  }>,
  options: PointCommitTransactionProofOptionsV1,
): void {
  if (options.observeQuery === undefined) return;
  const compiled = query.toSQL();
  options.observeQuery(Object.freeze({
    name,
    sql: compiled.sql,
    params: Object.freeze(structuredClone(compiled.params)),
  }));
}

async function sqlCall<Value>(
  operation: PointCommitSqlOperationV1,
  call: () => PromiseLike<Value>,
): Promise<Value> {
  try {
    return await call();
  } catch (cause) {
    if (
      cause instanceof PointCommitConflictV1Error ||
      cause instanceof PointCommitStaleAuthorityV1Error ||
      cause instanceof PointCommitCorruptionV1Error ||
      cause instanceof PointCommitResourceExhaustionV1Error ||
      isAppRowInvariantFailure(cause)
    ) {
      throw cause;
    }
    throw new PointCommitSqlFailureMarkerV1(operation, cause);
  }
}

function rowsFromExecuteResult(result: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(result)) return result;
  if (isNonArrayRecord(result) && Array.isArray(result.rows)) {
    return result.rows;
  }
  throw corruption("rowHeadInvalid");
}

function parseNonNegativeIntegerText(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw corruption("rowHeadInvalid");
  }
  const parsed = Number(value);
  if (!isNonNegativeSafeInteger(parsed)) {
    throw corruption("rowHeadInvalid");
  }
  return parsed;
}

function parseNullableCommitSeqText(value: unknown): CommitSeq | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw corruption("rowHeadInvalid");
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SIGNED_COMMIT_SEQ) {
    throw corruption("rowHeadInvalid");
  }
  return CommitSeqSchema.make(parsed);
}

function mapCommandPreparationFailure(
  cause: unknown,
): PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error {
  if (
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitStaleAuthorityV1Error
  ) {
    return cause;
  }
  if (cause instanceof FlarexValueCodecV1Error) {
    return corruption("commandInvalid");
  }
  throw cause;
}

function mapAuthorityResolutionFailure(
  cause: unknown,
):
  | PointCommitStaleAuthorityV1Error
  | PointCommitCorruptionV1Error
  | PointCommitSqlErrorV1 {
  if (cause instanceof TrustedScopeAuthorityResolutionError) {
    const failure = cause.failure;
    switch (failure.reason) {
      case "scopeClockTargetResolutionFailed":
        return sqlError("resolveAuthority", failure.resolutionCause);
      case "scopeClockTargetInvalid":
      case "scopeClockScopeMismatch":
        return corruption("scopeClockInvalid");
      case "scopeMetadataMissing":
      case "scopeDeploymentMismatch":
      case "splitProvisioningReceiptMissing":
      case "splitProvisioningReceiptScopeMismatch":
      case "splitProvisioningReceiptNotReady":
      case "splitProvisioningReceiptPlacementMismatch":
      case "scopeClockTargetPlacementMismatch":
      case "scopeClockMissing":
        return stale("placementChanged");
      default:
        return unexpectedAuthorityResolutionFailure(failure);
    }
  }
  const sqlState = findSqlState(cause);
  if (sqlState !== undefined) {
    return sqlError("resolveAuthority", cause);
  }
  throw cause;
}

function unexpectedAuthorityResolutionFailure(failure: never): never {
  throw failure;
}

function mapTransactionFailure(
  cause: unknown,
): PointCommitRollbackProofV1Error {
  if (
    cause instanceof PointCommitConflictV1Error ||
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitResourceExhaustionV1Error ||
    cause instanceof PointCommitSqlErrorV1
  ) {
    return cause;
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    return sqlError("beginOrRollback", cause);
  }
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    return sqlError(cause.operation, cause.cause);
  }
  if (isAppRowInvariantFailure(cause)) {
    return corruption("rowWriteInvalid");
  }
  if (
    cause instanceof ScopeClockCorruptionError ||
    cause instanceof ScopeClockNotFoundError
  ) {
    return corruption("scopeClockInvalid");
  }
  const sqlState = findSqlState(cause);
  if (sqlState !== undefined) {
    return sqlError("beginOrRollback", cause);
  }
  throw cause;
}

function isAppRowInvariantFailure(cause: unknown): boolean {
  return cause instanceof InvalidAppRowRevisionV1InputError ||
    cause instanceof AppRowScopeAuthorityUnavailableError ||
    cause instanceof AppRowRevisionAlreadyExistsError ||
    cause instanceof AppRowRevisionChainConflictError ||
    cause instanceof AppRowCreationTimeConflictError ||
    cause instanceof AppRowStorageCorruptionError;
}

function sqlError(
  operation: PointCommitSqlOperationV1,
  cause: unknown,
): PointCommitSqlErrorV1 {
  const sqlState = findSqlState(cause);
  return new PointCommitSqlErrorV1({
    operation,
    retryable: sqlState === "40001" || sqlState === "40P01",
    cause,
    ...(sqlState === undefined ? {} : { sqlState }),
  });
}

function findSqlState(cause: unknown, depth = 0): string | undefined {
  if (depth > 4 || !isNonArrayRecord(cause)) return undefined;
  const code = cause.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    return code;
  }
  const nested = cause.cause;
  return nested === cause ? undefined : findSqlState(nested, depth + 1);
}

function validHash(value: unknown): value is Uint8Array {
  return isUint8ArrayWithByteLength(value, HASH_BYTE_LENGTH);
}

function validEpochMilliseconds(value: unknown): value is number {
  return isPositiveSafeInteger(value);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function corruption(
  reason: PointCommitCorruptionReasonV1,
): PointCommitCorruptionV1Error {
  return new PointCommitCorruptionV1Error({ reason });
}

function stale(
  reason: PointCommitStaleAuthorityReasonV1,
): PointCommitStaleAuthorityV1Error {
  return new PointCommitStaleAuthorityV1Error({ reason });
}
