import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Effect, Encoding, Result, Schema } from "effect";

import type { PointMutationSessionAttemptSelectorV1 } from
  "@flarex/persistence-postgres/transaction-session-activation";

import {
  AppDocumentSystemFieldV1Error,
  canonicalizeAppDocumentV1,
  verifyAppDocumentEvidenceV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  AppDocumentIdV1Error,
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
  decodeAppDocumentIdentityV1,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  decodeCanonicalSessionJournalV1Effect,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result,
  verifySuccessfulResultEvidenceV1Effect,
  type CanonicalSuccessfulResultV1,
  type LogicalAppWriteV1,
  type LogicalPatchFieldV1,
  type LogicalReadDependencyV1,
  type SessionJournalV1,
  type StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import {
  encodeCanonicalJson,
  type Json,
} from "flarex-protocol/json";
import { CatalogSchemaVersionIdSchema } from
  "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ReplacementScopeIdV1Schema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import {
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueJsonV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  type FlarexValueCodecVersion,
} from "flarex-protocol/value";

import type { PointMutationExecutionScopeV1 } from
  "../pointMutationExecutionClaim";
import type {
  AuthenticatedStoredAttemptStateV1,
  StoredAttemptAuthorityStateV1,
  StoredAttemptEvidenceAuthorityPortV1,
  StoredAttemptEvidencePortV1,
  StoredAttemptPointEvidencePortV1,
  StoredAttemptStorageCorruptionReasonV1,
} from "../storedAttemptAuthentication";
import {
  StoredAttemptAuthorityMismatchV1Error,
  StoredAttemptEnvelopeMismatchV1Error,
  StoredAttemptNotPlannableV1Error,
  StoredAttemptStorageCorruptionV1Error,
} from "./authenticationErrors";
import { serializePrivateCapabilityStateForTestV1 } from
  "./capabilityState";

const decodeFlarexDbV1StorageGeneration = Schema.decodeUnknownSync(
  FlarexDbV1StorageGenerationSchema,
);

export const captureRecoveredAuthorityEffect = Effect.fn(
  "StoredAttemptAuthentication.captureRecoveredAuthority",
)(function* (
  selector: PointMutationSessionAttemptSelectorV1,
  evidence: StoredAttemptEvidencePortV1,
): Effect.fn.Return<
  StoredAttemptAuthorityStateV1,
  | StoredAttemptNotPlannableV1Error
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
> {
  if (evidence.deploymentId !== selector.deploymentId) {
    return yield* Effect.fail(authorityMismatchError("placementChanged"));
  }
  if (evidence.scopeId !== selector.scopeId) {
    return yield* Effect.fail(authorityMismatchError("scopeChanged"));
  }
  if (evidence.sessionId !== selector.sessionId) {
    return yield* Effect.fail(authorityMismatchError("attemptMissing"));
  }
  if (evidence.attemptFence !== selector.attemptFence) {
    return yield* Effect.fail(authorityMismatchError("attemptReplaced"));
  }
  if (evidence.session.lifecycle !== "finishing") {
    return yield* Effect.fail(new StoredAttemptNotPlannableV1Error({
      reason: "lifecycle",
      lifecycle: evidence.session.lifecycle,
    }));
  }
  return yield* Effect.try({
    try: () => Object.freeze({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(
        evidence.deploymentId,
      ),
      scopeId: ReplacementScopeIdV1Schema.make(evidence.scopeId),
      sessionId: TransactionSessionIdV1Schema.make(evidence.sessionId),
      attemptFence: TransactionAttemptFenceSchema.make(evidence.attemptFence),
      storageGeneration: decodeFlarexDbV1StorageGeneration(
        evidence.session.storageGeneration,
      ),
      storageGenerationFence: StorageGenerationFenceSchema.make(
        evidence.session.storageGenerationFence,
      ),
      snapshotToken: SnapshotTokenSchema.make({
        ...evidence.lease.snapshotToken,
      }),
      schemaVersionId: CatalogSchemaVersionIdSchema.make(
        evidence.session.schemaVersionId,
      ),
    } satisfies StoredAttemptAuthorityStateV1),
    catch: mapSynchronousStorageFailure,
  });
});

export const verifyCanonicalStoredEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.verifyCanonicalStoredEvidence",
)(function* (
  authority: StoredAttemptAuthorityStateV1,
  evidence: StoredAttemptEvidencePortV1,
  executionScope?: PointMutationExecutionScopeV1,
): Effect.fn.Return<
  AuthenticatedStoredAttemptStateV1,
  | StoredAttemptAuthorityMismatchV1Error
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
    canonicalBytes: copyBytes(evidence.root.journalBytes),
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
  const counterMismatch = journalCounterMismatch(evidence, journal.journal);
  if (counterMismatch !== undefined) {
    return yield* Effect.fail(counterMismatch);
  }
  const points = yield* verifyPointCorrelationEffect(
    evidence.points,
    journal.journal,
  );
  const successfulResultValue = yield* normalizeAuthenticatedResultValueEffect(
    successfulResult.valueJson,
  );
  return yield* Effect.try({
    try: () => captureAuthenticatedState(
      authority,
      evidence,
      journal.journal,
      successfulResult,
      successfulResultValue,
      points,
      executionScope,
    ),
    catch: mapSynchronousStorageFailure,
  });
});

export const compareCallerEnvelopeWithVerifiedState = Effect.fn(
  "StoredAttemptAuthentication.compareCallerEnvelopeWithVerifiedState",
)((
  envelope: StoredForSessionAttemptCommitEnvelopeV1,
  evidence: StoredAttemptEvidencePortV1,
  verified: AuthenticatedStoredAttemptStateV1,
): Effect.Effect<
  StoredAttemptEnvelopeMismatchV1Error | undefined,
  StoredAttemptStorageCorruptionV1Error
> =>
  Effect.try({
    try: () => storedEnvelopeMismatch(
      envelope,
      evidence,
      bytesToLowercaseHex(
        verified.sealIdentity.journalSha256,
        "journalDigestInvalid",
      ),
      Object.freeze({
        valueCodecVersion:
          verified.sealIdentity.resultValueCodecVersion,
        canonicalValueBase64Url: base64UrlFromBytes(
          verified.successfulResult.canonicalBytes,
        ),
        sha256Hex: verified.successfulResult.sha256Hex,
      }),
    ),
    catch: mapSynchronousStorageFailure,
  }));

const normalizeAuthenticatedResultValueEffect = Effect.fn(
  "StoredAttemptAuthentication.normalizeAuthenticatedResultValue",
)((valueJson: Json): Effect.Effect<
  CanonicalFlarexRuntimeValueV1,
  StoredAttemptStorageCorruptionV1Error
> =>
  Effect.try({
    try: () => normalizeFlarexValueJsonV1(valueJson).value,
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause: unknown) =>
      cause instanceof FlarexValueCodecV1Error
        ? Effect.fail(new StoredAttemptStorageCorruptionV1Error({
            reason: "successfulResultEvidenceInvalid",
            cause,
          }))
        : Effect.die(cause)
    ),
  ));

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
  let pointDependencyCount = 0;
  const indexedDependencies = journal.readDependencies.filter(
    (dependency) => dependency.kind === "appIndexRange",
  );
  for (const dependency of journal.readDependencies) {
    if (dependency.kind === "appRowPoint") {
      pointDependencyCount += 1;
    }
  }
  const indexRangeDependencyEvidenceBytes = Result.all(
    indexedDependencies.map(
      measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result,
    ),
  ).pipe(
    Result.map((measurements) =>
      measurements.reduce((total, bytes) => total + bytes, 0)
    ),
  );
  for (const write of journal.writes) {
    if (write.kind !== "delete") {
      writeSemanticBytes += write.resultingDocumentSemanticBytes;
    }
  }
  return Result.match(indexRangeDependencyEvidenceBytes, {
    onFailure: () => new StoredAttemptStorageCorruptionV1Error({
      reason: "journalCounterMismatch",
    }),
    onSuccess: (measuredIndexRangeEvidenceBytes) =>
      journal.protocolVersion !== evidence.session.protocolVersion ||
        journal.finalSyscallSequence !==
          evidence.root.sealedFinalSyscallSequence ||
        evidence.root.lastSyscallSequence !==
          evidence.root.sealedFinalSyscallSequence ||
        journal.readUsage.documentsRead !== evidence.root.readDocuments ||
        journal.readUsage.semanticBytesRead !==
          evidence.root.readSemanticBytes ||
        pointDependencyCount !== evidence.root.pointDependencyCount ||
        indexedDependencies.length !==
          evidence.root.indexRangeDependencyCount ||
        measuredIndexRangeEvidenceBytes !==
          evidence.root.indexRangeDependencyEvidenceBytes ||
        evidence.root.indexedQuerySyscalls < indexedDependencies.length ||
        evidence.root.indexedQuerySyscalls >
          MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1 ||
        journal.writes.length !== evidence.root.writeOperations ||
        writeSemanticBytes !== evidence.root.writeSemanticBytes ||
        evidence.points.length !== evidence.root.pointDependencyCount
        ? new StoredAttemptStorageCorruptionV1Error({
            reason: "journalCounterMismatch",
          })
        : undefined,
  });
}

export interface AuthenticatedStoredAttemptPointV1 {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly dependency: Extract<
    LogicalReadDependencyV1,
    { readonly kind: "appRowPoint" }
  >;
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
): Effect.fn.Return<
  ReadonlyArray<AuthenticatedStoredAttemptPointV1>,
  StoredAttemptStorageCorruptionV1Error
> {
  const dependencies = new Map<
    AppDocumentIdV1,
    Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>
  >();
  for (const dependency of journal.readDependencies) {
    if (dependency.kind === "appRowPoint") {
      dependencies.set(dependency.documentId, dependency);
    }
  }
  const points = new Map<
    AppDocumentIdV1,
    AuthenticatedStoredAttemptPointV1
  >();
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
  return Object.freeze([...points.values()]);
});

const verifyPointEffect = Effect.fn(function* (
  row: StoredAttemptPointEvidencePortV1,
): Effect.fn.Return<
  AuthenticatedStoredAttemptPointV1,
  StoredAttemptStorageCorruptionV1Error
> {
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
      tableId: row.tableId,
      rowId: identity.rowId,
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
    tableId: row.tableId,
    rowId: identity.rowId,
    dependency,
    overlayKind: "live",
    overlayCreationTime,
    overlayValue: document.value,
    overlayBytes: copyBytes(document.canonicalBytes),
    overlaySemanticBytes: row.overlaySemanticBytes,
  });
});

const dependencyFromPointEffect = Effect.fn(function* (
  row: StoredAttemptPointEvidencePortV1,
  documentId: AppDocumentIdV1,
): Effect.fn.Return<
  Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>,
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
  point: AuthenticatedStoredAttemptPointV1,
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
        return canonicalPointEvidenceJson(
          normalizeFlarexValueV1(actual).valueJson,
        ) === canonicalPointEvidenceJson(
          normalizeFlarexValueV1(expected).valueJson,
        );
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
  if (!isCanonicalFlarexRuntimeObjectV1(value)) {
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

export function dependenciesEqual(
  left: Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>,
  right: Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>,
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
  successfulResult: CanonicalSuccessfulResultV1,
  successfulResultValue: CanonicalFlarexRuntimeValueV1,
  points: ReadonlyArray<AuthenticatedStoredAttemptPointV1>,
  executionScope?: PointMutationExecutionScopeV1,
): AuthenticatedStoredAttemptStateV1 {
  const root = evidence.root;
  return Object.freeze({
    authority: Object.freeze({
      ...authority,
      snapshotToken: Object.freeze({ ...authority.snapshotToken }),
    }),
    ...(executionScope === undefined ? {} : { executionScope }),
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
      journalSha256: copyBytes(root.journalSha256),
      resultValueCodecVersion: root.resultValueCodecVersion,
      resultSemanticBytes: root.resultSemanticBytes,
      resultByteLength: root.resultBytes.byteLength,
      resultSha256: copyBytes(root.resultSha256),
      readDocuments: root.readDocuments,
      readSemanticBytes: root.readSemanticBytes,
      pointDependencyCount: root.pointDependencyCount,
      indexedQuerySyscalls: root.indexedQuerySyscalls,
      indexRangeDependencyCount: root.indexRangeDependencyCount,
      indexRangeDependencyEvidenceBytes:
        root.indexRangeDependencyEvidenceBytes,
      writeOperations: root.writeOperations,
      writeSemanticBytes: root.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        root.materialWriteEventEvidenceBytes,
    }),
    journal: structuredClone(journal),
    successfulResult: Object.freeze({
      value: successfulResultValue,
      valueJson: structuredClone(successfulResult.valueJson),
      canonicalBytes: copyBytes(successfulResult.canonicalBytes),
      semanticSizeBytes: successfulResult.semanticSizeBytes,
      sha256Hex: successfulResult.evidence.sha256Hex,
    }),
    points: Object.freeze(points.map(detachAuthenticatedPoint)),
  });
}

function detachAuthenticatedPoint(
  point: AuthenticatedStoredAttemptPointV1,
): AuthenticatedStoredAttemptPointV1 {
  return Object.freeze({
    documentId: point.documentId,
    tableId: point.tableId,
    rowId: point.rowId,
    dependency: Object.freeze(structuredClone(point.dependency)),
    overlayKind: point.overlayKind,
    overlayCreationTime: point.overlayCreationTime,
    overlayValue: point.overlayValue,
    overlayBytes: point.overlayBytes === null
      ? null
      : copyBytes(point.overlayBytes),
    overlaySemanticBytes: point.overlaySemanticBytes,
  });
}

export function serializeAuthenticatedStateForTest(
  state: AuthenticatedStoredAttemptStateV1,
): string {
  return serializePrivateCapabilityStateForTestV1(
    state,
    () => corruption("storedEvidenceInvalid"),
  );
}

export function captureAuthorityPort(
  authority: StoredAttemptAuthorityStateV1,
): StoredAttemptEvidenceAuthorityPortV1 {
  return Object.freeze({
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    sessionId: authority.sessionId,
    attemptFence: authority.attemptFence,
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: authority.storageGenerationFence,
    snapshotToken: Object.freeze({ ...authority.snapshotToken }),
    schemaVersionId: authority.schemaVersionId,
    ...(authority.executionClaim === undefined
      ? {}
      : { executionClaim: Object.freeze({ ...authority.executionClaim }) }),
  });
}

function bytesToLowercaseHex(
  bytes: Uint8Array,
  reason: StoredAttemptStorageCorruptionReasonV1,
): string {
  if (!isUint8ArrayWithByteLength(bytes, 32)) {
    throw corruption(reason);
  }
  return encodeBytesToLowercaseHex(bytes);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw corruption("resultBytesInvalid");
  }
  return Encoding.encodeBase64Url(bytes);
}

function canonicalPointEvidenceJson(value: Json): string {
  return encodeCanonicalJson(value, () => {
    throw corruption("jsonPropertyMissing");
  });
}

function mapSynchronousStorageFailure(
  cause: unknown,
): StoredAttemptStorageCorruptionV1Error {
  if (cause instanceof StoredAttemptStorageCorruptionV1Error) {
    return cause;
  }
  if (Schema.isSchemaError(cause)) {
    return new StoredAttemptStorageCorruptionV1Error({
      reason: "storedEvidenceInvalid",
      cause,
    });
  }
  throw cause;
}

function mapPointEvidenceFailure(
  cause: unknown,
): StoredAttemptStorageCorruptionV1Error {
  if (cause instanceof StoredAttemptStorageCorruptionV1Error) {
    return cause;
  }
  if (
    cause instanceof AppDocumentIdV1Error ||
    cause instanceof AppDocumentSystemFieldV1Error ||
    cause instanceof FlarexValueCodecV1Error ||
    cause instanceof FlarexValueEvidenceV1Error ||
    Schema.isSchemaError(cause)
  ) {
    return new StoredAttemptStorageCorruptionV1Error({
      reason: "pointEvidenceInvalid",
      cause,
    });
  }
  throw cause;
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
