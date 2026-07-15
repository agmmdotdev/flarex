import { Data, Effect } from "effect";

import {
  canonicalizeAppDocumentV1,
  verifyAppDocumentEvidenceV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
  decodeAppDocumentIdentityV1,
  type AppDocumentIdV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  decodeCanonicalSessionJournalV1Effect,
  decodeCommitEnvelopeV1Effect,
  requireStoredForSessionAttemptCommitEnvelopeV1Effect,
  verifySuccessfulResultEvidenceV1Effect,
  type CommitFinalSyscallSequenceV1,
  type CommitMaterialWriteEventEvidenceBytesV1,
  type CommitProtocolV1Error,
  type LogicalAppWriteV1,
  type LogicalPatchFieldV1,
  type LogicalReadDependencyV1,
  type SessionJournalV1,
  type StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import type { Json, JsonObject } from "flarex-protocol/json";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  FlarexDbV1StorageGeneration,
  ReplacementScopeIdV1,
  ScopeUuidV1,
  SnapshotToken,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import type {
  TransactionAttemptFence,
  TransactionSessionIdV1,
  TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import {
  normalizeFlarexValueJsonV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
  type FlarexValueCodecVersion,
} from "flarex-protocol/value";

import {
  inspectLoadedPointMutationSessionAttemptV1,
  type LoadedPointMutationSessionAttemptV1,
} from "./pointMutationSessionActivation";

const trustedStoredAttemptAuthorityBrand: unique symbol = Symbol(
  "FlarexExecutor/TrustedStoredAttemptAuthorityV1",
);

export interface TrustedStoredAttemptAuthorityV1 {
  readonly [trustedStoredAttemptAuthorityBrand]: true;
}

const authenticatedStoredAttemptBrand: unique symbol = Symbol(
  "FlarexExecutor/AuthenticatedStoredAttemptV1",
);

const PROCESS_LOCAL_CAPABILITY: true = true;

export interface AuthenticatedStoredAttemptV1 {
  readonly [authenticatedStoredAttemptBrand]: true;
}

export class InvalidStoredAttemptAuthorityV1Error extends Data.TaggedError(
  "InvalidStoredAttemptAuthorityV1Error",
)<{
  readonly reason: "notProcessLocal" | "invalidLoadedAttempt";
}> {}

export class StoredAttemptAlreadyCommittedV1Error extends Data.TaggedError(
  "StoredAttemptAlreadyCommittedV1Error",
)<{
  readonly updatedAtMilliseconds: number;
}> {}

export class StoredAttemptNotPlannableV1Error extends Data.TaggedError(
  "StoredAttemptNotPlannableV1Error",
)<{
  readonly reason: "lifecycle" | "rootNotSealed" | "expired";
  readonly lifecycle?: TransactionSessionLifecycleV1;
  readonly rootState?: "open" | "sealed" | "failed";
}> {}

export class StoredAttemptAuthorityMismatchV1Error extends Data.TaggedError(
  "StoredAttemptAuthorityMismatchV1Error",
)<{
  readonly reason:
    | "placementChanged"
    | "scopeChanged"
    | "attemptMissing"
    | "attemptReplaced"
    | "generationChanged"
    | "epochChanged"
    | "snapshotChanged"
    | "schemaChanged"
    | "revocationEpochChanged";
}> {}

export class StoredAttemptEnvelopeMismatchV1Error extends Data.TaggedError(
  "StoredAttemptEnvelopeMismatchV1Error",
)<{
  readonly reason:
    | "attempt"
    | "protocol"
    | "sequence"
    | "journalDigest"
    | "successfulResult";
}> {}

export type StoredAttemptStorageCorruptionReasonV1 =
  | "repeatableReadCapabilityMissing"
  | "scopeClockMissingOrDuplicate"
  | "databaseClockInvalid"
  | "sessionRecordDuplicate"
  | "sessionRecordInvalid"
  | "snapshotLeaseMissingOrDuplicate"
  | "snapshotLeaseInvalid"
  | "journalRootMissingOrDuplicate"
  | "journalRootInvalid"
  | "pointEvidenceOverflow"
  | "pointEvidenceInvalid"
  | "journalEvidenceInvalid"
  | "successfulResultEvidenceInvalid"
  | "journalDigestInvalid"
  | "resultDigestInvalid"
  | "resultBytesInvalid"
  | "resultSemanticBytesMismatch"
  | "journalCounterMismatch"
  | "duplicatePointEvidence"
  | "pointDependencyMismatch"
  | "pointDependencySetMismatch"
  | "writeWithoutPointEvidence"
  | "nonLiveOverlayCarriesEvidence"
  | "liveOverlayEvidenceMissing"
  | "liveOverlaySemanticBytesMismatch"
  | "presentDependencyRevisionMissing"
  | "missingDependencyUnexpectedRevision"
  | "tombstoneDependencyRevisionMissing"
  | "readOnlyPointHasOverlay"
  | "tombstoneDependencyHasWrite"
  | "invalidInsertTransition"
  | "deleteNotTerminal"
  | "writeChainEmpty"
  | "deleteOverlayMismatch"
  | "liveWriteOverlayMismatch"
  | "insertCreationTimeMismatch"
  | "completeWriteMissing"
  | "unexpectedWriteAfterCompleteValue"
  | "completeWriteOverlayMismatch"
  | "patchRemoveOverlayMismatch"
  | "patchSetOverlayMissing"
  | "patchSetOverlayMismatch"
  | "overlayDocumentNotObject"
  | "jsonPropertyMissing"
  | "storedEvidenceInvalid";

export class StoredAttemptStorageCorruptionV1Error extends Data.TaggedError(
  "StoredAttemptStorageCorruptionV1Error",
)<{
  readonly reason: StoredAttemptStorageCorruptionReasonV1;
  readonly cause?: unknown;
}> {}

export class StoredAttemptPersistenceV1Error extends Data.TaggedError(
  "StoredAttemptPersistenceV1Error",
)<{
  readonly cause: unknown;
}> {}

export type StoredAttemptAuthenticationV1Error =
  | CommitProtocolV1Error
  | InvalidStoredAttemptAuthorityV1Error
  | StoredAttemptAlreadyCommittedV1Error
  | StoredAttemptNotPlannableV1Error
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptEnvelopeMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
  | StoredAttemptPersistenceV1Error;

interface StoredAttemptAuthorityStateV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export type StoredAttemptEvidenceAuthorityPortV1 = Readonly<
  StoredAttemptAuthorityStateV1
>;

interface StoredAttemptSessionScalarsPortV1 {
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
  readonly authorizationGrantId: string;
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

interface StoredAttemptSealedRootPortV1 {
  readonly lastSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly creationTimeSeed: AppCreationTimeV1;
  readonly nextCreationTime: AppCreationTimeV1;
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointDependencyCount: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes:
    CommitMaterialWriteEventEvidenceBytesV1;
  readonly sealedFinalSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly journalBytes: Uint8Array;
  readonly journalSha256: Uint8Array;
  readonly resultValueCodecVersion: FlarexValueCodecVersion;
  readonly resultSemanticBytes: number;
  readonly resultBytes: Uint8Array;
  readonly resultSha256: Uint8Array;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
  readonly sealedAtMilliseconds: number;
}

interface StoredAttemptPointEvidencePortV1 {
  readonly tableId: CatalogTableId;
  readonly rowId: Uint8Array;
  readonly dependencyKind:
    | "present"
    | "missing_no_visible_revision"
    | "missing_tombstone";
  readonly dependencyRevisionCommitSeq: bigint | null;
  readonly overlayKind: "none" | "live" | "deleted";
  readonly overlayCreationTime: AppCreationTimeV1 | null;
  readonly overlayValueCodecVersion: FlarexValueCodecVersion | null;
  readonly overlayValueJson: JsonObject | null;
  readonly overlayValueBytes: Uint8Array | null;
  readonly overlayValueSha256: Uint8Array | null;
  readonly overlaySemanticBytes: number | null;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}

export interface StoredAttemptEvidencePortV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly databaseNowMilliseconds: number;
  readonly session: StoredAttemptSessionScalarsPortV1;
  readonly lease: Readonly<{
    readonly snapshotToken: SnapshotToken;
    readonly leaseExpiresAtMilliseconds: number;
  }>;
  readonly root: StoredAttemptSealedRootPortV1;
  readonly points: ReadonlyArray<StoredAttemptPointEvidencePortV1>;
}

export type StoredAttemptEvidenceLoadResultPortV1 =
  | Readonly<{
      readonly kind: "loaded";
      readonly evidence: StoredAttemptEvidencePortV1;
    }>
  | Readonly<{
      readonly kind: "alreadyCommitted";
      readonly updatedAtMilliseconds: number;
    }>
  | Readonly<{
      readonly kind: "notPlannable";
      readonly reason: "lifecycle" | "rootNotSealed" | "expired";
      readonly lifecycle?: TransactionSessionLifecycleV1;
      readonly rootState?: "open" | "sealed" | "failed";
    }>
  | Readonly<{
      readonly kind: "authorityMismatch";
      readonly reason:
        | "placementChanged"
        | "scopeChanged"
        | "attemptMissing"
        | "attemptReplaced"
        | "generationChanged"
        | "epochChanged"
        | "snapshotChanged"
        | "schemaChanged"
        | "revocationEpochChanged";
    }>
  | Readonly<{
      readonly kind: "corrupt";
      readonly reason: StoredAttemptStorageCorruptionReasonV1;
      readonly cause?: unknown;
    }>;

export interface StoredAttemptEvidenceLoaderPortV1 {
  readonly load: (
    authority: StoredAttemptEvidenceAuthorityPortV1,
  ) => Promise<StoredAttemptEvidenceLoadResultPortV1>;
}

export interface StoredAttemptAuthenticationV1 {
  readonly deriveAuthority: (
    attempt: LoadedPointMutationSessionAttemptV1,
  ) => Effect.Effect<
    TrustedStoredAttemptAuthorityV1,
    InvalidStoredAttemptAuthorityV1Error
  >;
  readonly authenticate: (
    authority: TrustedStoredAttemptAuthorityV1,
    envelope: unknown,
  ) => Effect.Effect<
    AuthenticatedStoredAttemptV1,
    StoredAttemptAuthenticationV1Error
  >;
  readonly isAuthenticated: (value: unknown) => boolean;
  /** Internal test seam: compares private state without exposing evidence. */
  readonly remainsAuthenticatedStateUnchangedForTest: (
    value: AuthenticatedStoredAttemptV1,
    action: () => void,
  ) => boolean;
}

interface AuthenticatedStoredAttemptStateV1 {
  readonly authority: StoredAttemptAuthorityStateV1;
  readonly session: StoredAttemptSessionScalarsPortV1;
  readonly sealIdentity: Readonly<{
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
    readonly journalFormat: SessionJournalV1["format"];
    readonly journalProtocolVersion: SessionJournalV1["protocolVersion"];
    readonly journalValueCodecVersion: SessionJournalV1["valueCodecVersion"];
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
  }>;
  readonly journal: SessionJournalV1;
  readonly successfulResultValueJson: Json;
  readonly points: ReadonlyArray<StoredAttemptPointEvidencePortV1>;
}

export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
): StoredAttemptAuthenticationV1 {
  const authorityStates = new WeakMap<object, StoredAttemptAuthorityStateV1>();
  const authenticatedStates = new WeakMap<
    object,
    AuthenticatedStoredAttemptStateV1
  >();

  const deriveAuthority: StoredAttemptAuthenticationV1["deriveAuthority"] =
    Effect.fn("StoredAttemptAuthentication.deriveAuthority")(
      function* (attempt) {
        const inspection = yield* Effect.try({
          try: () => inspectLoadedPointMutationSessionAttemptV1(attempt),
          catch: () => new InvalidStoredAttemptAuthorityV1Error({
            reason: "invalidLoadedAttempt",
          }),
        });
        const state = Object.freeze({
          deploymentId: inspection.selector.deploymentId,
          scopeId: inspection.selector.scopeId,
          sessionId: inspection.selector.sessionId,
          attemptFence: inspection.selector.attemptFence,
          storageGeneration: inspection.storageGeneration,
          storageGenerationFence: inspection.storageGenerationFence,
          snapshotToken: Object.freeze({ ...inspection.snapshotToken }),
          schemaVersionId: inspection.schemaVersionId,
        } satisfies StoredAttemptAuthorityStateV1);
        const handle: TrustedStoredAttemptAuthorityV1 = Object.freeze({
          [trustedStoredAttemptAuthorityBrand]: PROCESS_LOCAL_CAPABILITY,
        });
        authorityStates.set(handle, state);
        return handle;
      },
    );

  const authenticate: StoredAttemptAuthenticationV1["authenticate"] =
    Effect.fn("StoredAttemptAuthentication.authenticate")(
      function* (authority, input) {
        const decodedEnvelope = yield* decodeCommitEnvelopeV1Effect(input);
        const envelope = yield*
          requireStoredForSessionAttemptCommitEnvelopeV1Effect(
            decodedEnvelope,
          );
        const authorityState = lookupAuthority(authorityStates, authority);
        if (authorityState === undefined) {
          return yield* Effect.fail(
            new InvalidStoredAttemptAuthorityV1Error({
              reason: "notProcessLocal",
            }),
          );
        }
        const result = yield* Effect.tryPromise({
          try: () => loader.load(captureAuthorityPort(authorityState)),
          catch: (cause) => new StoredAttemptPersistenceV1Error({ cause }),
        });
        const evidence = yield* requireLoadedEvidenceEffect(result);
        const verified = yield* verifyStoredEvidenceEffect(
          authorityState,
          envelope,
          evidence,
        );
        const handle: AuthenticatedStoredAttemptV1 = Object.freeze({
          [authenticatedStoredAttemptBrand]: PROCESS_LOCAL_CAPABILITY,
        });
        authenticatedStates.set(handle, verified);
        return handle;
      },
    );

  return Object.freeze({
    deriveAuthority,
    authenticate,
    isAuthenticated: (value: unknown): boolean =>
      typeof value === "object" &&
      value !== null &&
      authenticatedStates.has(value),
    remainsAuthenticatedStateUnchangedForTest: (
      value: AuthenticatedStoredAttemptV1,
      action: () => void,
    ): boolean => {
      const state = requireAuthenticatedState(authenticatedStates, value);
      const before = serializeAuthenticatedStateForTest(state);
      action();
      return before === serializeAuthenticatedStateForTest(state);
    },
  });
}

const requireLoadedEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.requireLoadedEvidence",
)(function* (
  result: StoredAttemptEvidenceLoadResultPortV1,
): Effect.fn.Return<
  StoredAttemptEvidencePortV1,
  | StoredAttemptAlreadyCommittedV1Error
  | StoredAttemptNotPlannableV1Error
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
> {
  switch (result.kind) {
    case "loaded":
      return result.evidence;
    case "alreadyCommitted":
      return yield* Effect.fail(new StoredAttemptAlreadyCommittedV1Error({
        updatedAtMilliseconds: result.updatedAtMilliseconds,
      }));
    case "notPlannable":
      return yield* Effect.fail(new StoredAttemptNotPlannableV1Error({
        reason: result.reason,
        ...(result.lifecycle === undefined
          ? {}
          : { lifecycle: result.lifecycle }),
        ...(result.rootState === undefined
          ? {}
          : { rootState: result.rootState }),
      }));
    case "authorityMismatch":
      return yield* Effect.fail(new StoredAttemptAuthorityMismatchV1Error({
        reason: result.reason,
      }));
    case "corrupt":
      return yield* Effect.fail(new StoredAttemptStorageCorruptionV1Error({
        reason: result.reason,
        ...(result.cause === undefined ? {} : { cause: result.cause }),
      }));
  }
});

const verifyStoredEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.verifyStoredEvidence",
)(function* (
  authority: StoredAttemptAuthorityStateV1,
  envelope: StoredForSessionAttemptCommitEnvelopeV1,
  evidence: StoredAttemptEvidencePortV1,
): Effect.fn.Return<
  AuthenticatedStoredAttemptStateV1,
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptEnvelopeMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
> {
  const scalarEvidence = yield* Effect.try({
    try: () => {
      return Object.freeze({
        journalSha256Hex: bytesToLowercaseHex(
          evidence.root.journalSha256,
          "journalDigestInvalid",
        ),
        successfulResultEvidence: Object.freeze({
          valueCodecVersion: evidence.root.resultValueCodecVersion,
          canonicalValueBase64Url: base64UrlFromBytes(
            evidence.root.resultBytes,
          ),
          sha256Hex: bytesToLowercaseHex(
            evidence.root.resultSha256,
            "resultDigestInvalid",
          ),
        }),
      });
    },
    catch: mapSynchronousStorageFailure,
  });
  const authorityMismatch = evidenceAuthorityMismatch(authority, evidence);
  if (authorityMismatch !== undefined) {
    return yield* Effect.fail(authorityMismatch);
  }
  const journal = yield* decodeCanonicalSessionJournalV1Effect({
    canonicalBytes: new Uint8Array(evidence.root.journalBytes),
    expectedSha256Hex: scalarEvidence.journalSha256Hex,
  }).pipe(
    Effect.mapError((cause) => new StoredAttemptStorageCorruptionV1Error({
      reason: "journalEvidenceInvalid",
      cause,
    })),
  );
  const successfulResult = yield* verifySuccessfulResultEvidenceV1Effect(
    scalarEvidence.successfulResultEvidence,
  ).pipe(
    Effect.mapError((cause) => new StoredAttemptStorageCorruptionV1Error({
      reason: "successfulResultEvidenceInvalid",
      cause,
    })),
  );
  if (
    successfulResult.semanticSizeBytes !== evidence.root.resultSemanticBytes
  ) {
    return yield* corruptionEffect("resultSemanticBytesMismatch");
  }
  const envelopeMismatch = storedEnvelopeMismatch(
    envelope,
    evidence,
    scalarEvidence.journalSha256Hex,
    successfulResult.evidence,
  );
  if (envelopeMismatch !== undefined) {
    return yield* Effect.fail(envelopeMismatch);
  }
  const counterMismatch = journalCounterMismatch(evidence, journal.journal);
  if (counterMismatch !== undefined) {
    return yield* Effect.fail(counterMismatch);
  }
  yield* verifyPointCorrelationEffect(evidence.points, journal.journal);
  return yield* Effect.try({
    try: () => captureAuthenticatedState(
      authority,
      evidence,
      journal.journal,
      successfulResult.valueJson,
    ),
    catch: mapSynchronousStorageFailure,
  });
});

function evidenceAuthorityMismatch(
  expected: StoredAttemptAuthorityStateV1,
  evidence: StoredAttemptEvidencePortV1,
): StoredAttemptAuthorityMismatchV1Error | undefined {
  if (evidence.deploymentId !== expected.deploymentId) {
    return authorityMismatchError("placementChanged");
  }
  if (evidence.scopeId !== expected.scopeId) {
    return authorityMismatchError("scopeChanged");
  }
  if (evidence.sessionId !== expected.sessionId) {
    return authorityMismatchError("attemptMissing");
  }
  if (evidence.attemptFence !== expected.attemptFence) {
    return authorityMismatchError("attemptReplaced");
  }
  if (
    evidence.session.storageGeneration !== expected.storageGeneration ||
    evidence.session.storageGenerationFence !== expected.storageGenerationFence
  ) {
    return authorityMismatchError("generationChanged");
  }
  if (evidence.session.schemaVersionId !== expected.schemaVersionId) {
    return authorityMismatchError("schemaChanged");
  }
  if (evidence.lease.snapshotToken.scopeId !== expected.snapshotToken.scopeId) {
    return authorityMismatchError("snapshotChanged");
  }
  if (evidence.lease.snapshotToken.epoch !== expected.snapshotToken.epoch) {
    return authorityMismatchError("epochChanged");
  }
  if (
    evidence.lease.snapshotToken.commitSeq !== expected.snapshotToken.commitSeq
  ) {
    return authorityMismatchError("snapshotChanged");
  }
  return undefined;
}

function storedEnvelopeMismatch(
  envelope: StoredForSessionAttemptCommitEnvelopeV1,
  evidence: StoredAttemptEvidencePortV1,
  journalSha256Hex: string,
  successfulResult: Readonly<{
    readonly valueCodecVersion: FlarexValueCodecVersion;
    readonly canonicalValueBase64Url: string;
    readonly sha256Hex: string;
  }>,
): StoredAttemptEnvelopeMismatchV1Error | undefined {
  if (
    envelope.sessionId !== evidence.sessionId ||
    envelope.attemptFence !== evidence.attemptFence
  ) {
    return new StoredAttemptEnvelopeMismatchV1Error({ reason: "attempt" });
  }
  if (envelope.protocolVersion !== evidence.session.protocolVersion) {
    return new StoredAttemptEnvelopeMismatchV1Error({ reason: "protocol" });
  }
  if (
    envelope.finalSyscallSequence !==
      evidence.root.sealedFinalSyscallSequence
  ) {
    return new StoredAttemptEnvelopeMismatchV1Error({ reason: "sequence" });
  }
  if (envelope.journalSha256Hex !== journalSha256Hex) {
    return new StoredAttemptEnvelopeMismatchV1Error({
      reason: "journalDigest",
    });
  }
  if (
    envelope.successfulResult.valueCodecVersion !==
      successfulResult.valueCodecVersion ||
    envelope.successfulResult.canonicalValueBase64Url !==
      successfulResult.canonicalValueBase64Url ||
    envelope.successfulResult.sha256Hex !== successfulResult.sha256Hex
  ) {
    return new StoredAttemptEnvelopeMismatchV1Error({
      reason: "successfulResult",
    });
  }
  return undefined;
}

function journalCounterMismatch(
  evidence: StoredAttemptEvidencePortV1,
  journal: SessionJournalV1,
): StoredAttemptStorageCorruptionV1Error | undefined {
  let writeSemanticBytes = 0;
  for (const write of journal.writes) {
    if (write.kind !== "delete") {
      writeSemanticBytes += write.resultingDocumentSemanticBytes;
    }
  }
  if (
    journal.protocolVersion !== evidence.session.protocolVersion ||
    journal.finalSyscallSequence !==
      evidence.root.sealedFinalSyscallSequence ||
    evidence.root.lastSyscallSequence !==
      evidence.root.sealedFinalSyscallSequence ||
    journal.readUsage.documentsRead !== evidence.root.readDocuments ||
    journal.readUsage.semanticBytesRead !==
      evidence.root.readSemanticBytes ||
    journal.readDependencies.length !==
      evidence.root.pointDependencyCount ||
    journal.writes.length !== evidence.root.writeOperations ||
    writeSemanticBytes !== evidence.root.writeSemanticBytes ||
    evidence.points.length !== evidence.root.pointDependencyCount
  ) {
    return new StoredAttemptStorageCorruptionV1Error({
      reason: "journalCounterMismatch",
    });
  }
  return undefined;
}

interface VerifiedPointV1 {
  readonly documentId: AppDocumentIdV1;
  readonly dependency: LogicalReadDependencyV1;
  readonly overlayKind: "none" | "live" | "deleted";
  readonly overlayCreationTime: AppCreationTimeV1 | null;
  readonly overlayValue: CanonicalFlarexRuntimeValueV1 | null;
  readonly overlayBytes: Uint8Array | null;
  readonly overlaySemanticBytes: number | null;
}

const verifyPointCorrelationEffect = Effect.fn(
  "StoredAttemptAuthentication.verifyPointCorrelation",
)(function* (
  rows: ReadonlyArray<StoredAttemptPointEvidencePortV1>,
  journal: SessionJournalV1,
): Effect.fn.Return<void, StoredAttemptStorageCorruptionV1Error> {
  const dependencies = new Map<AppDocumentIdV1, LogicalReadDependencyV1>();
  for (const dependency of journal.readDependencies) {
    dependencies.set(dependency.documentId, dependency);
  }
  const points = new Map<AppDocumentIdV1, VerifiedPointV1>();
  for (const row of rows) {
    const point = yield* verifyPointEffect(row);
    if (points.has(point.documentId)) {
      return yield* corruptionEffect("duplicatePointEvidence");
    }
    const dependency = dependencies.get(point.documentId);
    if (
      dependency === undefined ||
      !dependenciesEqual(dependency, point.dependency)
    ) {
      return yield* corruptionEffect("pointDependencyMismatch");
    }
    points.set(point.documentId, point);
  }
  if (points.size !== dependencies.size) {
    return yield* corruptionEffect("pointDependencySetMismatch");
  }

  const writesByDocument = new Map<
    AppDocumentIdV1,
    LogicalAppWriteV1[]
  >();
  for (const write of journal.writes) {
    if (!points.has(write.documentId)) {
      return yield* corruptionEffect("writeWithoutPointEvidence");
    }
    const writes = writesByDocument.get(write.documentId) ?? [];
    writes.push(write);
    writesByDocument.set(write.documentId, writes);
  }
  for (const point of points.values()) {
    yield* verifyPointWriteChainEffect(
      point,
      writesByDocument.get(point.documentId) ?? [],
    );
  }
});

const verifyPointEffect = Effect.fn(function* (
  row: StoredAttemptPointEvidencePortV1,
): Effect.fn.Return<VerifiedPointV1, StoredAttemptStorageCorruptionV1Error> {
  const identity = yield* Effect.try({
    try: () => {
      const rowId = appRowIdHexV1FromBytes(row.rowId);
      return Object.freeze({
        rowId,
        documentId: appDocumentIdV1FromRowIdentity({
          tableId: row.tableId,
          rowId,
        }),
      });
    },
    catch: mapPointEvidenceFailure,
  });
  const dependency = yield* dependencyFromPointEffect(
    row,
    identity.documentId,
  );
  if (row.overlayKind !== "live") {
    if (
      row.overlayCreationTime !== null ||
      row.overlayValueCodecVersion !== null ||
      row.overlayValueJson !== null ||
      row.overlayValueBytes !== null ||
      row.overlayValueSha256 !== null ||
      row.overlaySemanticBytes !== null
    ) {
      return yield* corruptionEffect("nonLiveOverlayCarriesEvidence");
    }
    return Object.freeze({
      documentId: identity.documentId,
      dependency,
      overlayKind: row.overlayKind,
      overlayCreationTime: null,
      overlayValue: null,
      overlayBytes: null,
      overlaySemanticBytes: null,
    });
  }
  if (
    row.overlayCreationTime === null ||
    row.overlayValueCodecVersion === null ||
    row.overlayValueJson === null ||
    row.overlayValueBytes === null ||
    row.overlayValueSha256 === null ||
    row.overlaySemanticBytes === null
  ) {
    return yield* corruptionEffect("liveOverlayEvidenceMissing");
  }
  const overlayCreationTime = row.overlayCreationTime;
  const overlayValueCodecVersion = row.overlayValueCodecVersion;
  const overlayValueJson = row.overlayValueJson;
  const overlayValueBytes = row.overlayValueBytes;
  const overlayValueSha256 = row.overlayValueSha256;
  const document = yield* Effect.tryPromise({
    try: () => verifyAppDocumentEvidenceV1({
      tableId: row.tableId,
      rowId: identity.rowId,
      creationTime: overlayCreationTime,
      codecVersion: overlayValueCodecVersion,
      valueJson: overlayValueJson,
      canonicalBytes: overlayValueBytes,
      sha256: overlayValueSha256,
    }),
    catch: mapPointEvidenceFailure,
  });
  if (document.semanticSizeBytes !== row.overlaySemanticBytes) {
    return yield* corruptionEffect("liveOverlaySemanticBytesMismatch");
  }
  return Object.freeze({
    documentId: identity.documentId,
    dependency,
    overlayKind: "live",
    overlayCreationTime,
    overlayValue: document.value,
    overlayBytes: new Uint8Array(document.canonicalBytes),
    overlaySemanticBytes: row.overlaySemanticBytes,
  });
});

const dependencyFromPointEffect = Effect.fn(function* (
  row: StoredAttemptPointEvidencePortV1,
  documentId: AppDocumentIdV1,
): Effect.fn.Return<
  LogicalReadDependencyV1,
  StoredAttemptStorageCorruptionV1Error
> {
  switch (row.dependencyKind) {
    case "present":
      if (row.dependencyRevisionCommitSeq === null) {
        return yield* corruptionEffect("presentDependencyRevisionMissing");
      }
      const presentRevisionValue = row.dependencyRevisionCommitSeq;
      const presentRevision = yield* Effect.try({
        try: () => CommitSeqSchema.make(presentRevisionValue),
        catch: mapPointEvidenceFailure,
      });
      return Object.freeze({
        kind: "appRowPoint",
        documentId,
        observed: Object.freeze({
          kind: "present",
          revisionCommitSeq: presentRevision,
        }),
      } satisfies LogicalReadDependencyV1);
    case "missing_no_visible_revision":
      if (row.dependencyRevisionCommitSeq !== null) {
        return yield* corruptionEffect("missingDependencyUnexpectedRevision");
      }
      return Object.freeze({
        kind: "appRowPoint",
        documentId,
        observed: Object.freeze({
          kind: "missing",
          basis: Object.freeze({ kind: "noVisibleRevision" }),
        }),
      } satisfies LogicalReadDependencyV1);
    case "missing_tombstone":
      if (row.dependencyRevisionCommitSeq === null) {
        return yield* corruptionEffect("tombstoneDependencyRevisionMissing");
      }
      const tombstoneRevisionValue = row.dependencyRevisionCommitSeq;
      const tombstoneRevision = yield* Effect.try({
        try: () => CommitSeqSchema.make(tombstoneRevisionValue),
        catch: mapPointEvidenceFailure,
      });
      return Object.freeze({
        kind: "appRowPoint",
        documentId,
        observed: Object.freeze({
          kind: "missing",
          basis: Object.freeze({
            kind: "tombstone",
            revisionCommitSeq: tombstoneRevision,
          }),
        }),
      } satisfies LogicalReadDependencyV1);
  }
});

const verifyPointWriteChainEffect = Effect.fn(function* (
  point: VerifiedPointV1,
  writes: ReadonlyArray<LogicalAppWriteV1>,
): Effect.fn.Return<void, StoredAttemptStorageCorruptionV1Error> {
  if (writes.length === 0) {
    if (point.overlayKind !== "none") {
      return yield* corruptionEffect("readOnlyPointHasOverlay");
    }
    return;
  }
  if (
    point.dependency.observed.kind === "missing" &&
    point.dependency.observed.basis.kind === "tombstone"
  ) {
    return yield* corruptionEffect("tombstoneDependencyHasWrite");
  }
  const insertIndexes = writes
    .map((write, index) => write.kind === "insert" ? index : -1)
    .filter((index) => index >= 0);
  if (
    insertIndexes.length > 1 ||
    (insertIndexes.length === 1 && insertIndexes[0] !== 0) ||
    (point.dependency.observed.kind === "present" &&
      insertIndexes.length !== 0) ||
    (point.dependency.observed.kind === "missing" &&
      insertIndexes.length !== 1)
  ) {
    return yield* corruptionEffect("invalidInsertTransition");
  }
  const deleteIndex = writes.findIndex((write) => write.kind === "delete");
  if (deleteIndex >= 0 && deleteIndex !== writes.length - 1) {
    return yield* corruptionEffect("deleteNotTerminal");
  }
  const last = writes.at(-1);
  if (last === undefined) {
    return yield* corruptionEffect("writeChainEmpty");
  }
  if (last.kind === "delete") {
    if (point.overlayKind !== "deleted") {
      return yield* corruptionEffect("deleteOverlayMismatch");
    }
    return;
  }
  if (
    point.overlayKind !== "live" ||
    point.overlayCreationTime === null ||
    point.overlayValue === null ||
    point.overlayBytes === null ||
    point.overlaySemanticBytes === null ||
    last.resultingDocumentSemanticBytes !== point.overlaySemanticBytes
  ) {
    return yield* corruptionEffect("liveWriteOverlayMismatch");
  }
  const insert = writes[0]?.kind === "insert" ? writes[0] : undefined;
  if (
    insert !== undefined &&
    insert.creationTime !== point.overlayCreationTime
  ) {
    return yield* corruptionEffect("insertCreationTimeMismatch");
  }

  const completeIndex = findLastCompleteWriteIndex(writes);
  if (completeIndex >= 0) {
    const complete = writes[completeIndex];
    if (
      complete === undefined ||
      (complete.kind !== "insert" && complete.kind !== "replace")
    ) {
      return yield* corruptionEffect("completeWriteMissing");
    }
    const normalized = yield* Effect.try({
      try: () => normalizeFlarexValueJsonV1(
        complete.fieldsValueJson,
        "appDocument",
      ).value,
      catch: mapPointEvidenceFailure,
    });
    const fields = yield* copyRuntimeDocumentEffect(normalized);
    for (const write of writes.slice(completeIndex + 1)) {
      if (write.kind !== "patch") {
        return yield* corruptionEffect("unexpectedWriteAfterCompleteValue");
      }
      yield* applyPatchEffect(fields, write.changes);
    }
    const identity = yield* Effect.try({
      try: () => decodeAppDocumentIdentityV1(point.documentId),
      catch: mapPointEvidenceFailure,
    });
    const overlayCreationTime = point.overlayCreationTime;
    const rebuilt = yield* Effect.tryPromise({
      try: () => canonicalizeAppDocumentV1({
        tableId: identity.tableId,
        rowId: identity.rowId,
        creationTime: overlayCreationTime,
        fields,
      }),
      catch: mapPointEvidenceFailure,
    });
    if (!bytesEqual(rebuilt.canonicalBytes, point.overlayBytes)) {
      return yield* corruptionEffect("completeWriteOverlayMismatch");
    }
    return;
  }
  const finalFields = yield* copyRuntimeDocumentEffect(point.overlayValue);
  const lastChanges = lastPatchChangeByField(writes);
  for (const change of lastChanges.values()) {
    if (change.kind === "remove") {
      if (Object.hasOwn(finalFields, change.field)) {
        return yield* corruptionEffect("patchRemoveOverlayMismatch");
      }
      continue;
    }
    const actual = finalFields[change.field];
    if (actual === undefined) {
      return yield* corruptionEffect("patchSetOverlayMissing");
    }
    const valuesMatch = yield* Effect.try({
      try: () => {
        const expected = normalizeFlarexValueJsonV1(change.valueJson).value;
        return canonicalJson(normalizeFlarexValueV1(actual).valueJson) ===
          canonicalJson(normalizeFlarexValueV1(expected).valueJson);
      },
      catch: mapPointEvidenceFailure,
    });
    if (!valuesMatch) {
      return yield* corruptionEffect("patchSetOverlayMismatch");
    }
  }
});

function findLastCompleteWriteIndex(
  writes: ReadonlyArray<LogicalAppWriteV1>,
): number {
  for (let index = writes.length - 1; index >= 0; index -= 1) {
    const write = writes[index];
    if (write?.kind === "insert" || write?.kind === "replace") return index;
  }
  return -1;
}

function lastPatchChangeByField(
  writes: ReadonlyArray<LogicalAppWriteV1>,
): ReadonlyMap<string, LogicalPatchFieldV1> {
  const changes = new Map<string, LogicalPatchFieldV1>();
  for (const write of writes) {
    if (write.kind !== "patch") continue;
    for (const change of write.changes) changes.set(change.field, change);
  }
  return changes;
}

const applyPatchEffect = Effect.fn(function* (
  fields: Record<string, CanonicalFlarexRuntimeValueV1>,
  changes: ReadonlyArray<LogicalPatchFieldV1>,
): Effect.fn.Return<void, StoredAttemptStorageCorruptionV1Error> {
  for (const change of changes) {
    if (change.kind === "remove") {
      Reflect.deleteProperty(fields, change.field);
    } else {
      const value = yield* Effect.try({
        try: () => normalizeFlarexValueJsonV1(change.valueJson).value,
        catch: mapPointEvidenceFailure,
      });
      Object.defineProperty(fields, change.field, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
});

const copyRuntimeDocumentEffect = Effect.fn(function* (
  value: CanonicalFlarexRuntimeValueV1,
): Effect.fn.Return<
  Record<string, CanonicalFlarexRuntimeValueV1>,
  StoredAttemptStorageCorruptionV1Error
> {
  if (
    typeof value !== "object" ||
    value === null ||
    value instanceof ArrayBuffer ||
    Array.isArray(value)
  ) {
    return yield* corruptionEffect("overlayDocumentNotObject");
  }
  const fields: Record<string, CanonicalFlarexRuntimeValueV1> = {};
  for (const [field, item] of Object.entries(value)) {
    if (field === "_id" || field === "_creationTime") continue;
    Object.defineProperty(fields, field, {
      value: item,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return fields;
});

function dependenciesEqual(
  left: LogicalReadDependencyV1,
  right: LogicalReadDependencyV1,
): boolean {
  if (
    left.documentId !== right.documentId ||
    left.observed.kind !== right.observed.kind
  ) {
    return false;
  }
  if (left.observed.kind === "present" && right.observed.kind === "present") {
    return left.observed.revisionCommitSeq ===
      right.observed.revisionCommitSeq;
  }
  if (left.observed.kind === "missing" && right.observed.kind === "missing") {
    if (left.observed.basis.kind !== right.observed.basis.kind) return false;
    return left.observed.basis.kind === "noVisibleRevision" ||
      (right.observed.basis.kind === "tombstone" &&
        left.observed.basis.revisionCommitSeq ===
          right.observed.basis.revisionCommitSeq);
  }
  return false;
}

function captureAuthenticatedState(
  authority: StoredAttemptAuthorityStateV1,
  evidence: StoredAttemptEvidencePortV1,
  journal: SessionJournalV1,
  successfulResultValueJson: Json,
): AuthenticatedStoredAttemptStateV1 {
  const root = evidence.root;
  return Object.freeze({
    authority: Object.freeze({
      ...authority,
      snapshotToken: Object.freeze({ ...authority.snapshotToken }),
    }),
    session: structuredClone(evidence.session),
    sealIdentity: Object.freeze({
      scopeUuid: evidence.scopeUuid,
      lifecycle: evidence.session.lifecycle,
      sessionUpdatedAtMilliseconds: evidence.session.updatedAtMilliseconds,
      leaseExpiresAtMilliseconds: evidence.lease.leaseExpiresAtMilliseconds,
      rootCreatedAtMilliseconds: root.createdAtMilliseconds,
      rootUpdatedAtMilliseconds: root.updatedAtMilliseconds,
      sealedAtMilliseconds: root.sealedAtMilliseconds,
      finalSyscallSequence: root.sealedFinalSyscallSequence,
      creationTimeSeed: root.creationTimeSeed,
      nextCreationTime: root.nextCreationTime,
      journalFormat: journal.format,
      journalProtocolVersion: journal.protocolVersion,
      journalValueCodecVersion: journal.valueCodecVersion,
      journalByteLength: root.journalBytes.byteLength,
      journalSha256: new Uint8Array(root.journalSha256),
      resultValueCodecVersion: root.resultValueCodecVersion,
      resultSemanticBytes: root.resultSemanticBytes,
      resultByteLength: root.resultBytes.byteLength,
      resultSha256: new Uint8Array(root.resultSha256),
      readDocuments: root.readDocuments,
      readSemanticBytes: root.readSemanticBytes,
      pointDependencyCount: root.pointDependencyCount,
      writeOperations: root.writeOperations,
      writeSemanticBytes: root.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        root.materialWriteEventEvidenceBytes,
    }),
    journal: structuredClone(journal),
    successfulResultValueJson: structuredClone(successfulResultValueJson),
    points: Object.freeze(structuredClone(evidence.points)),
  });
}

function lookupAuthority(
  states: WeakMap<object, StoredAttemptAuthorityStateV1>,
  authority: TrustedStoredAttemptAuthorityV1,
): StoredAttemptAuthorityStateV1 | undefined {
  return typeof authority === "object" && authority !== null
    ? states.get(authority)
    : undefined;
}

function requireAuthenticatedState(
  states: WeakMap<object, AuthenticatedStoredAttemptStateV1>,
  value: AuthenticatedStoredAttemptV1,
): AuthenticatedStoredAttemptStateV1 {
  const state = typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
  if (state === undefined) {
    throw new InvalidStoredAttemptAuthorityV1Error({
      reason: "notProcessLocal",
    });
  }
  return state;
}

function serializeAuthenticatedStateForTest(
  state: AuthenticatedStoredAttemptStateV1,
): string {
  const serialized = JSON.stringify(
    state,
    (_key: string, value: unknown): unknown => {
      if (typeof value === "bigint") {
        return Object.freeze({ bigint: value.toString() });
      }
      if (value instanceof Uint8Array) {
        return Object.freeze({ bytes: base64UrlFromBytes(value) });
      }
      return value;
    },
  );
  if (serialized === undefined) {
    throw corruption("storedEvidenceInvalid");
  }
  return serialized;
}

function captureAuthorityPort(
  authority: StoredAttemptAuthorityStateV1,
): StoredAttemptEvidenceAuthorityPortV1 {
  return Object.freeze({
    ...authority,
    snapshotToken: Object.freeze({ ...authority.snapshotToken }),
  });
}

function bytesToLowercaseHex(
  bytes: Uint8Array,
  reason: StoredAttemptStorageCorruptionReasonV1,
): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
    throw corruption(reason);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw corruption("resultBytesInvalid");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + chunkSize, bytes.byteLength),
    );
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function canonicalJson(value: Json): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort(compareStrings)
      .map((key) => {
        const item = value[key];
        if (item === undefined) throw corruption("jsonPropertyMissing");
        return `${JSON.stringify(key)}:${canonicalJson(item)}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isJsonObject(value: Json): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapSynchronousStorageFailure(
  cause: unknown,
): StoredAttemptStorageCorruptionV1Error {
  if (cause instanceof StoredAttemptStorageCorruptionV1Error) {
    return cause;
  }
  return new StoredAttemptStorageCorruptionV1Error({
    reason: "storedEvidenceInvalid",
    cause,
  });
}

function mapPointEvidenceFailure(
  cause: unknown,
): StoredAttemptStorageCorruptionV1Error {
  if (cause instanceof StoredAttemptStorageCorruptionV1Error) {
    return cause;
  }
  return new StoredAttemptStorageCorruptionV1Error({
    reason: "pointEvidenceInvalid",
    cause,
  });
}

function authorityMismatchError(
  reason: StoredAttemptAuthorityMismatchV1Error["reason"],
): StoredAttemptAuthorityMismatchV1Error {
  return new StoredAttemptAuthorityMismatchV1Error({ reason });
}

function corruption(
  reason: StoredAttemptStorageCorruptionReasonV1,
): StoredAttemptStorageCorruptionV1Error {
  return new StoredAttemptStorageCorruptionV1Error({ reason });
}

function corruptionEffect(
  reason: StoredAttemptStorageCorruptionReasonV1,
): Effect.Effect<never, StoredAttemptStorageCorruptionV1Error> {
  return Effect.fail(corruption(reason));
}
