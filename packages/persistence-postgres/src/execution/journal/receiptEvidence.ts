import type {
  SessionJournalPersistedPointIssueV1,
  SessionJournalPointSuccessV1,
  RunSessionJournalPointOperationV1Result,
  RunSessionJournalIndexedQueryV1Result,
  RunSessionJournalRelationIncomingV1Result,
} from "./contracts";
import type { SessionJournalStorageCorruptionV1Error } from "./errors";
import type { SessionJournalAttemptStateV1 } from "./state";
import {
  bytesEqualFullScan as bytesEqual,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Effect, Result, Schema } from "effect";
import {
  AppDocumentSystemFieldV1Error,
  verifyAppDocumentEvidenceV1,
} from "flarex-protocol/app-document";
import {
  AppDocumentIdV1Error,
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
  decodeAppDocumentIdentityV1,
} from "flarex-protocol/app-document-id";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import {
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  normalizeLogicalIndexRangeReadDependenciesV1Result,
  canonicalizeAdmittedSourceBundleResult,
} from "flarex-protocol/commit-protocol";
import type {
  CommitFinalSyscallSequenceV1,
  LogicalAppWriteV1,
  LogicalReadDependencyV1,
  LogicalIndexRangeReadDependencyV1,
  LogicalApplicationRelationIncomingReadDependencyV1,
} from "flarex-protocol/commit-protocol";
import type { PhysicalEdgeDefinitionV1 } from "flarex-protocol/internal/application-schema-binding";
import { MAX_RELATION_MANY_ITEMS_V1 } from "flarex-protocol/internal/relation-declaration-v1";
import { appIndexPhysicalSpecSha256HexV1FromBytes } from "flarex-protocol/index-definition";
import {
  orderedIndexBoundHexV1FromBytes,
  orderedIndexKeyBytesHexV1FromBytes,
  orderedIndexRowIdHexV1FromBytesResult,
} from "flarex-protocol/ordered-index";
import { encodeCanonicalJson, jsonEqual } from "flarex-protocol/json";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import {
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  decodeCanonicalFlarexValueEvidenceV1Effect,
  normalizeFlarexValueJsonV1,
} from "flarex-protocol/value";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { AppRowPointDependencyV1 } from "../../storage/documents/appRows";
import type {
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
} from "../../database/schema";
import {
  TEXT_ENCODER,
  encodeStoredRequest,
  decodeStoredRequestResult,
  decodeStoredOutcomeResult,
  encodeIndexRangeDependency,
  decodeIndexRangeDependencyResult,
  decodeRelationIncomingDependencyResult,
  decodeLogicalAppWriteResult,
  requireJson,
  sha256,
} from "./codecs";
import type {
  SessionJournalStoredRequest,
  SessionJournalStoredOutcome,
} from "./codecs";
import { SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1 } from "./operationModel";
import type { AppliedSessionJournalOperationV1 } from "./operationModel";
import type { StoredApplicationRelationIncomingRequest } from "./relationReads";
import { corruption } from "./journalFailures";

export const decodeStoredRelationIncomingDependenciesEffect = Effect.fn(
  "SessionJournalStore.decodeStoredRelationIncomingDependencies",
)(function* (
  attempt: SessionJournalAttemptStateV1,
  rows: ReadonlyArray<
    typeof fxSystemTransactionJournalRelationIncomingDependencies.$inferSelect
  >,
): Effect.fn.Return<
  ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>,
  SessionJournalStorageCorruptionV1Error
> {
  if (rows.length > MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1) {
    return yield* Effect.fail(
      corruption(attempt, "relationDependencyCountMismatch"),
    );
  }
  const dependencies: LogicalApplicationRelationIncomingReadDependencyV1[] = [];
  for (const row of rows) {
    const candidate = yield* Effect.try({
      try: () => ({
        kind: "appRelationIncoming" as const,
        edgeDefinitionId: row.edgeDefinitionId,
        targetRowId: appRowIdHexV1FromBytes(row.targetRowId),
        observedAdjacencyVersion: row.observedAdjacencyVersion,
        activationSequence: row.activationSequence,
        activeHeadSha256Hex: encodeBytesToLowercaseHex(row.activeHeadSha256),
      }),
      catch: (cause) => corruption(attempt, "relationDependencyInvalid", cause),
    });
    const dependency = yield* Effect.fromResult(
      decodeRelationIncomingDependencyResult(candidate).pipe(
        Result.mapError((cause) =>
          corruption(attempt, "relationDependencyInvalid", cause),
        ),
      ),
    );
    const previous = dependencies.at(-1);
    if (
      dependency.observedAdjacencyVersion > attempt.snapshotToken.commitSeq ||
      (previous !== undefined &&
        (compareRelationIncomingDependencies(previous, dependency) >= 0 ||
          previous.activationSequence !== dependency.activationSequence ||
          previous.activeHeadSha256Hex !== dependency.activeHeadSha256Hex))
    ) {
      return yield* Effect.fail(
        corruption(attempt, "relationDependencyInvalid"),
      );
    }
    dependencies.push(dependency);
  }
  return Object.freeze(dependencies);
});

function compareRelationIncomingDependencies(
  left: LogicalApplicationRelationIncomingReadDependencyV1,
  right: LogicalApplicationRelationIncomingReadDependencyV1,
): number {
  return left.edgeDefinitionId !== right.edgeDefinitionId
    ? left.edgeDefinitionId - right.edgeDefinitionId
    : compareUtf16Strings(left.targetRowId, right.targetRowId);
}

export interface PreparedStoredIndexRangeV1 {
  readonly dependency: LogicalIndexRangeReadDependencyV1;
  readonly evidenceBytes: number;
}

export function prepareStoredIndexRanges(
  dependencies: ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
): ReadonlyArray<PreparedStoredIndexRangeV1> {
  return Object.freeze(
    dependencies.map((dependency) => {
      const encoded = requireJson(encodeIndexRangeDependency(dependency));
      const canonicalText = encodeCanonicalJson(encoded, () => {
        throw new Error(
          "Index-range dependency violated canonical JSON invariants.",
        );
      });
      return Object.freeze({
        dependency,
        evidenceBytes: TEXT_ENCODER.encode(canonicalText).byteLength,
      });
    }),
  );
}

export const decodeStoredIndexRangeRowsEffect = Effect.fn(
  "SessionJournalStore.decodeStoredIndexRangeRows",
)(function* (
  attempt: SessionJournalAttemptStateV1,
  rows: ReadonlyArray<
    typeof fxSystemTransactionJournalIndexRanges.$inferSelect
  >,
): Effect.fn.Return<
  ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  SessionJournalStorageCorruptionV1Error
> {
  if (rows.length > MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1) {
    return yield* Effect.fail(
      corruption(attempt, "indexRangeDependencyCountMismatch"),
    );
  }
  const dependencies: LogicalIndexRangeReadDependencyV1[] = [];
  for (let ordinal = 0; ordinal < rows.length; ordinal += 1) {
    const row = rows[ordinal]!;
    if (row.ordinal !== ordinal) {
      return yield* Effect.fail(
        corruption(attempt, "indexRangeDependencyInvalid"),
      );
    }
    const candidateResult = yield* Effect.try({
      try: () =>
        Result.gen(function* () {
          return {
            kind: "appIndexRange",
            tableId: row.tableId,
            indexDefinitionId: row.indexDefinitionId,
            keyCodecVersion: row.keyCodecVersion,
            physicalSpecSha256Hex: appIndexPhysicalSpecSha256HexV1FromBytes(
              row.physicalSpecSha256,
            ),
            direction: row.direction,
            lower:
              row.lowerKind === "unbounded"
                ? null
                : {
                    kind: "key",
                    encodedKey: orderedIndexBoundHexV1FromBytes(
                      row.lowerEncodedKey!,
                    ),
                    inclusive: true,
                  },
            upper:
              row.upperKind === "unbounded"
                ? null
                : row.upperKind === "key_exclusive"
                  ? {
                      kind: "key",
                      encodedKey: orderedIndexBoundHexV1FromBytes(
                        row.upperEncodedKey!,
                      ),
                      inclusive: false,
                    }
                  : {
                      kind: "position",
                      encodedKey: orderedIndexKeyBytesHexV1FromBytes(
                        row.upperEncodedKey!,
                      ),
                      rowId: yield* orderedIndexRowIdHexV1FromBytesResult(
                        row.upperRowId!,
                      ),
                      inclusive: true,
                    },
          };
        }),
      catch: (cause) =>
        corruption(attempt, "indexRangeDependencyInvalid", cause),
    });
    const candidate = yield* Effect.fromResult(candidateResult).pipe(
      Effect.mapError((cause) =>
        corruption(attempt, "indexRangeDependencyInvalid", cause),
      ),
    );
    const dependency = yield* Effect.fromResult(
      decodeIndexRangeDependencyResult(candidate).pipe(
        Result.mapError((cause) =>
          corruption(attempt, "indexRangeDependencyInvalid", cause),
        ),
      ),
    );
    const prepared = prepareStoredIndexRanges([dependency])[0]!;
    if (prepared.evidenceBytes !== row.evidenceBytes) {
      return yield* Effect.fail(
        corruption(attempt, "indexRangeDependencyEvidenceBytesMismatch"),
      );
    }
    dependencies.push(dependency);
  }
  const normalized = yield* Effect.fromResult(
    normalizeLogicalIndexRangeReadDependenciesV1Result(dependencies).pipe(
      Result.mapError((cause) =>
        corruption(attempt, "indexRangeDependencyInvalid", cause),
      ),
    ),
  );
  if (
    normalized.length !== dependencies.length ||
    normalized.some(
      (dependency, ordinal) =>
        !storedIndexRangeDependenciesEqual(dependency, dependencies[ordinal]!),
    )
  ) {
    return yield* Effect.fail(
      corruption(attempt, "indexRangeDependencyInvalid"),
    );
  }
  return normalized;
});

function storedIndexRangeDependenciesEqual(
  left: LogicalIndexRangeReadDependencyV1,
  right: LogicalIndexRangeReadDependencyV1,
): boolean {
  return jsonEqual(
    requireJson(encodeIndexRangeDependency(left)),
    requireJson(encodeIndexRangeDependency(right)),
  );
}

export function decodePointDependencyResult(
  attempt: SessionJournalAttemptStateV1,
  row: typeof fxSystemTransactionJournalPoints.$inferSelect,
): Result.Result<
  AppRowPointDependencyV1,
  SessionJournalStorageCorruptionV1Error
> {
  const rowId = appRowIdHexV1FromBytes(row.rowId);
  const identity = Object.freeze({
    scopeId: attempt.selector.scopeId,
    tableId: CatalogTableIdSchema.make(row.tableId),
    rowId,
  });
  switch (row.dependencyKind) {
    case "generated_insertion":
      return Result.fail(corruption(attempt, "pointDependencyCountMismatch"));
    case "present":
      if (row.dependencyRevisionCommitSeq === null) {
        return Result.fail(
          corruption(attempt, "presentDependencyRevisionMissing"),
        );
      }
      return Result.succeed(
        Object.freeze({
          kind: "present",
          identity,
          revisionCommitSeq: CommitSeqSchema.make(
            row.dependencyRevisionCommitSeq,
          ),
        }),
      );
    case "missing_no_visible_revision":
      if (row.dependencyRevisionCommitSeq !== null) {
        return Result.fail(
          corruption(attempt, "missingDependencyUnexpectedRevision"),
        );
      }
      return Result.succeed(
        Object.freeze({
          kind: "missing",
          identity,
          basis: Object.freeze({ kind: "noVisibleRevision" }),
        }),
      );
    case "missing_tombstone":
      if (row.dependencyRevisionCommitSeq === null) {
        return Result.fail(
          corruption(attempt, "tombstoneDependencyRevisionMissing"),
        );
      }
      return Result.succeed(
        Object.freeze({
          kind: "missing",
          identity,
          basis: Object.freeze({
            kind: "tombstone",
            revisionCommitSeq: CommitSeqSchema.make(
              row.dependencyRevisionCommitSeq,
            ),
          }),
        }),
      );
  }
}

export function dependenciesEqual(
  left: AppRowPointDependencyV1,
  right: AppRowPointDependencyV1,
): boolean {
  if (
    left.kind !== right.kind ||
    left.identity.scopeId !== right.identity.scopeId ||
    left.identity.tableId !== right.identity.tableId ||
    left.identity.rowId !== right.identity.rowId
  ) {
    return false;
  }
  if (left.kind === "present" && right.kind === "present") {
    return left.revisionCommitSeq === right.revisionCommitSeq;
  }
  if (left.kind === "missing" && right.kind === "missing") {
    if (left.basis.kind !== right.basis.kind) return false;
    return (
      left.basis.kind === "noVisibleRevision" ||
      (right.basis.kind === "tombstone" &&
        left.basis.revisionCommitSeq === right.basis.revisionCommitSeq)
    );
  }
  return false;
}

export function validateReceiptCardinalityResult(
  attempt: SessionJournalAttemptStateV1,
  lastSequence: CommitFinalSyscallSequenceV1,
  receipt: typeof fxSystemTransactionJournalReceipts.$inferSelect | undefined,
): Result.Result<void, SessionJournalStorageCorruptionV1Error> {
  if (lastSequence === 0n && receipt !== undefined) {
    return Result.fail(corruption(attempt, "zeroSequenceHasReceipt"));
  }
  if (lastSequence > 0n) {
    if (
      receipt === undefined ||
      BigInt(receipt.lastSyscallSequence) !== BigInt(lastSequence)
    ) {
      return Result.fail(corruption(attempt, "latestReceiptSequenceMismatch"));
    }
  }
  return Result.succeed(undefined);
}

export const decodeStoredEvidenceEffect = Effect.fn(
  (
    attempt: SessionJournalAttemptStateV1,
    reason: "latestReceiptEvidenceInvalid" | "logicalWriteEventInvalid",
    canonicalBytes: unknown,
    valueSha256: unknown,
  ): Effect.Effect<
    CanonicalFlarexValueV1,
    SessionJournalStorageCorruptionV1Error
  > =>
    decodeCanonicalFlarexValueEvidenceV1Effect({
      canonicalBytes,
      sha256: valueSha256,
    }).pipe(Effect.mapError((cause) => corruption(attempt, reason, cause))),
);

export const decodeAndVerifyReceiptRecordEffect = Effect.fn(function* (
  attempt: SessionJournalAttemptStateV1,
  receipt: typeof fxSystemTransactionJournalReceipts.$inferSelect,
  expectedRequest: SessionJournalStoredRequest | undefined,
): Effect.fn.Return<
  Readonly<{
    request: SessionJournalStoredRequest;
    outcome: SessionJournalStoredOutcome;
  }>,
  SessionJournalStorageCorruptionV1Error
> {
  const requestEvidence = yield* decodeStoredEvidenceEffect(
    attempt,
    "latestReceiptEvidenceInvalid",
    receipt.requestBytes,
    receipt.requestSha256,
  );
  const request = yield* Effect.fromResult(
    decodeStoredRequestResult(requestEvidence.valueJson).pipe(
      Result.mapError((cause) =>
        corruption(attempt, "latestReceiptEvidenceInvalid", cause),
      ),
    ),
  );
  if (
    request.kind !== receipt.operationKind ||
    BigInt(request.syscallSequence) !== BigInt(receipt.lastSyscallSequence) ||
    (expectedRequest !== undefined &&
      !storedRequestsEqual(request, expectedRequest))
  ) {
    return yield* Effect.fail(
      corruption(attempt, "latestReceiptEvidenceInvalid"),
    );
  }

  const outcomeEvidence = yield* decodeStoredEvidenceEffect(
    attempt,
    "latestReceiptEvidenceInvalid",
    receipt.outcomeBytes,
    receipt.outcomeSha256,
  );
  const outcome = yield* Effect.fromResult(
    decodeStoredOutcomeResult(outcomeEvidence.valueJson).pipe(
      Result.mapError((cause) =>
        corruption(attempt, "latestReceiptEvidenceInvalid", cause),
      ),
    ),
  );
  if (
    outcome.kind !== receipt.outcomeKind ||
    !requestOutcomeCorrelates(request, outcome, attempt.snapshotToken.commitSeq)
  ) {
    return yield* Effect.fail(
      corruption(attempt, "latestReceiptEvidenceInvalid"),
    );
  }
  if (request.kind === "admittedLogicalOperation") {
    const bundle = yield* Effect.fromResult(
      canonicalizeAdmittedSourceBundleResult({
        participant: request.participant,
        method: request.method,
        profileRevision: request.profileRevision,
        sources: request.sources,
      }).pipe(
        Result.mapError((cause) =>
          corruption(attempt, "latestReceiptEvidenceInvalid", cause),
        ),
      ),
    );
    const bundleDigest = yield* Effect.tryPromise({
      try: () => sha256(bundle.bytes),
      catch: (cause) =>
        corruption(attempt, "latestReceiptEvidenceInvalid", cause),
    });
    if (
      receipt.participantBindingSha256 === null ||
      encodeBytesToLowercaseHex(receipt.participantBindingSha256) !==
        request.admissionBundleSha256Hex ||
      !bytesEqual(bundleDigest, receipt.participantBindingSha256)
    ) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptEvidenceInvalid"),
      );
    }
  } else if (receipt.participantBindingSha256 !== null) {
    return yield* Effect.fail(
      corruption(attempt, "latestReceiptEvidenceInvalid"),
    );
  }
  return Object.freeze({ request, outcome });
});

export const decodeAndVerifyLatestReceiptEffect = Effect.fn(function* (
  attempt: SessionJournalAttemptStateV1,
  receipt: typeof fxSystemTransactionJournalReceipts.$inferSelect,
  expectedRequest: SessionJournalStoredRequest | undefined,
) {
  if (receipt.requestCodecVersion !== 2 || receipt.outcomeCodecVersion !== 2) {
    return yield* Effect.fail(
      corruption(attempt, "latestReceiptEvidenceInvalid"),
    );
  }
  return (yield* decodeAndVerifyReceiptRecordEffect(
    attempt,
    receipt,
    expectedRequest,
  )).outcome;
});

function storedRequestsEqual(
  left: SessionJournalStoredRequest,
  right: SessionJournalStoredRequest,
): boolean {
  const leftEncoded = requireJson(encodeStoredRequest(left));
  const rightEncoded = requireJson(encodeStoredRequest(right));
  return jsonEqual(leftEncoded, rightEncoded);
}

function requestOutcomeCorrelates(
  request: SessionJournalStoredRequest,
  outcome: SessionJournalStoredOutcome,
  snapshotCommitSeq: CommitSeq,
): boolean {
  switch (request.kind) {
    case "get":
      if (
        outcome.kind === "missing" ||
        outcome.kind === "present" ||
        isLimitOutcome(outcome)
      )
        return true;
      break;
    case "insert":
      if (
        outcome.kind === "inserted" ||
        (outcome.kind === "error" &&
          (outcome.reason === "documentIdCollision" ||
            outcome.reason === "invalidDocument" ||
            outcome.reason === "limitExceeded"))
      )
        return true;
      break;
    case "patch":
    case "replace":
    case "delete":
      if (
        (outcome.kind === "unit" && outcome.operation === request.kind) ||
        (outcome.kind === "error" &&
          ((outcome.reason === "documentNotFound" &&
            outcome.operation === request.kind) ||
            (outcome.reason === "invalidDocument" &&
              outcome.operation === request.kind) ||
            outcome.reason === "limitExceeded"))
      )
        return true;
      break;
    case "indexRange":
      return (
        isLimitOutcome(outcome) ||
        (outcome.kind === "indexRangePage" &&
          outcome.documentsValueJson.length <= request.limit &&
          (outcome.isDone ||
            outcome.documentsValueJson.length === request.limit))
      );
    case "relationIncoming":
      if (isLimitOutcome(outcome)) return true;
      if (outcome.kind === "relationConflict") {
        return (
          outcome.edgeDefinitionId === request.edgeDefinitionId &&
          outcome.targetRowId === request.targetRowId &&
          outcome.snapshotCommitSeq === snapshotCommitSeq &&
          outcome.expectedAdjacencyVersion <= snapshotCommitSeq &&
          outcome.actualAdjacencyVersion > outcome.snapshotCommitSeq
        );
      }
      return (
        outcome.kind === "relationIncomingPage" &&
        outcome.items.length <= request.limit &&
        (outcome.exhausted || outcome.items.length === request.limit) &&
        relationIncomingItemsCorrelate(request, outcome.items)
      );
    case "admittedLogicalOperation":
      return (
        outcome.kind === "admittedLogicalResult" ||
        outcome.kind === "admittedLogicalError" ||
        outcome.kind === "admittedLogicalInvoking"
      );
  }
  return false;
}

function relationIncomingItemsCorrelate(
  request: Extract<
    SessionJournalStoredRequest,
    { readonly kind: "relationIncoming" }
  >,
  items: ReadonlyArray<
    Extract<
      SessionJournalStoredOutcome,
      { readonly kind: "relationIncomingPage" }
    >["items"][number]
  >,
): boolean {
  let previous:
    | Readonly<{
        readonly sourceRowId: AppRowIdHexV1;
        readonly duplicateOrdinal: 0;
      }>
    | undefined;
  for (const item of items) {
    let identity: ReturnType<typeof decodeAppDocumentIdentityV1>;
    try {
      identity = decodeAppDocumentIdentityV1(item.sourceDocumentId);
    } catch {
      return false;
    }
    if (identity.tableId !== request.sourceTableId) return false;
    if (previous !== undefined) {
      const rowOrder = compareUtf16Strings(
        previous.sourceRowId,
        identity.rowId,
      );
      if (
        rowOrder > 0 ||
        (rowOrder === 0 && previous.duplicateOrdinal >= item.duplicateOrdinal)
      ) {
        return false;
      }
    }
    previous = Object.freeze({
      sourceRowId: identity.rowId,
      duplicateOrdinal: item.duplicateOrdinal,
    });
  }
  return true;
}

export function relationIncomingPositionsCorrelate(
  definition: PhysicalEdgeDefinitionV1,
  items: ReadonlyArray<
    Extract<
      SessionJournalStoredOutcome,
      { readonly kind: "relationIncomingPage" }
    >["items"][number]
  >,
): boolean {
  return items.every((item) =>
    definition.sourceValueExtraction === "scalar"
      ? item.position === null
      : item.position !== null && item.position < MAX_RELATION_MANY_ITEMS_V1,
  );
}

export function isLimitOutcome(
  outcome: SessionJournalStoredOutcome,
): outcome is Extract<
  SessionJournalStoredOutcome,
  { readonly kind: "error"; readonly reason: "limitExceeded" }
> {
  return outcome.kind === "error" && outcome.reason === "limitExceeded";
}

export function validateReceiptOutcomeMatchesJournalRootResult(
  attempt: SessionJournalAttemptStateV1,
  root: typeof fxSystemTransactionJournals.$inferSelect,
  outcome: SessionJournalStoredOutcome,
): Result.Result<void, SessionJournalStorageCorruptionV1Error> {
  if (root.state === "operation_invoking") {
    return outcome.kind === "admittedLogicalInvoking" &&
      root.failureDimension === null
      ? Result.succeed(undefined)
      : Result.fail(corruption(attempt, "journalReceiptStateMismatch"));
  }
  if (root.state === "operation_failed") {
    return outcome.kind === "admittedLogicalError" &&
      root.failureDimension === null
      ? Result.succeed(undefined)
      : Result.fail(corruption(attempt, "failedJournalReceiptInvalid"));
  }
  if (root.state === "failed") {
    if (root.failureDimension === null) {
      return Result.fail(corruption(attempt, "failedJournalEvidenceInvalid"));
    }
    const expectedMaximum =
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1[root.failureDimension];
    if (
      !isLimitOutcome(outcome) ||
      outcome.dimension !== root.failureDimension ||
      outcome.maximum !== expectedMaximum ||
      outcome.observed <= outcome.maximum
    ) {
      return Result.fail(corruption(attempt, "failedJournalReceiptInvalid"));
    }
    return Result.succeed(undefined);
  }
  if (root.state === "relation_conflicted") {
    if (outcome.kind !== "relationConflict" || root.failureDimension !== null) {
      return Result.fail(corruption(attempt, "journalReceiptStateMismatch"));
    }
    return Result.succeed(undefined);
  }
  if (
    outcome.kind === "admittedLogicalInvoking" ||
    outcome.kind === "relationConflict"
  ) {
    return Result.fail(corruption(attempt, "journalReceiptStateMismatch"));
  }
  if (isLimitOutcome(outcome)) {
    return Result.fail(corruption(attempt, "journalReceiptStateMismatch"));
  }
  return Result.succeed(undefined);
}

export function projectPointOperationResult(
  applied: AppliedSessionJournalOperationV1,
): RunSessionJournalPointOperationV1Result {
  switch (applied.kind) {
    case "sequenceRejected":
      return Object.freeze({
        kind: "sequenceRejected",
        issue: applied.issue,
      });
    case "stateRejected":
      return Object.freeze({
        kind: "stateRejected",
        issue: Object.freeze({ reason: applied.reason }),
      });
    case "outcome": {
      const outcome = applied.outcome;
      if (outcome.kind === "error") {
        return Object.freeze({
          kind: "rejected",
          delivery: applied.delivery,
          issue: issueFromStoredOutcome(outcome),
        });
      }
      const projected = projectSuccessfulStoredOutcome(outcome);
      return Object.freeze({
        kind: "completed",
        delivery: applied.delivery === "sticky" ? "replayed" : applied.delivery,
        outcome: projected,
      });
    }
  }
}

export function projectIndexedQueryResult(
  applied: AppliedSessionJournalOperationV1,
): RunSessionJournalIndexedQueryV1Result {
  switch (applied.kind) {
    case "sequenceRejected":
      return Object.freeze({ kind: "sequenceRejected", issue: applied.issue });
    case "stateRejected":
      return Object.freeze({
        kind: "stateRejected",
        issue: Object.freeze({ reason: applied.reason }),
      });
    case "outcome": {
      if (applied.outcome.kind === "error") {
        if (applied.outcome.reason !== "limitExceeded") {
          throw new Error("Indexed query receipt contains a point-only error.");
        }
        return Object.freeze({
          kind: "rejected",
          delivery: applied.delivery,
          issue: Object.freeze({
            reason: "limitExceeded",
            dimension: applied.outcome.dimension,
            observed: applied.outcome.observed,
            maximum: applied.outcome.maximum,
          }),
        });
      }
      if (applied.outcome.kind !== "indexRangePage") {
        throw new Error("Indexed query receipt contains a point-only success.");
      }
      return Object.freeze({
        kind: "completed",
        delivery: applied.delivery === "sticky" ? "replayed" : applied.delivery,
        outcome: Object.freeze({
          kind: "indexRangePage",
          documents: Object.freeze(
            applied.outcome.documentsValueJson.map(
              (document) =>
                normalizeFlarexValueJsonV1(document, "appDocument").value,
            ),
          ),
          isDone: applied.outcome.isDone,
        }),
      });
    }
  }
}

export function projectApplicationRelationIncomingResult(
  applied: AppliedSessionJournalOperationV1,
  request: StoredApplicationRelationIncomingRequest,
): RunSessionJournalRelationIncomingV1Result {
  switch (applied.kind) {
    case "sequenceRejected":
      return Object.freeze({ kind: "sequenceRejected", issue: applied.issue });
    case "stateRejected":
      return Object.freeze({
        kind: "stateRejected",
        issue: Object.freeze({ reason: applied.reason }),
      });
    case "outcome": {
      const outcome = applied.outcome;
      if (outcome.kind === "error") {
        if (outcome.reason !== "limitExceeded") {
          // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - relation request and receipt correlation rejects every non-limit point error before projection
          throw new Error("Relation receipt contains a point-only error.");
        }
        return Object.freeze({
          kind: "rejected",
          delivery: applied.delivery,
          issue: Object.freeze({
            reason: "limitExceeded",
            dimension: outcome.dimension,
            observed: outcome.observed,
            maximum: outcome.maximum,
          }),
        });
      }
      if (outcome.kind === "relationConflict") {
        return Object.freeze({
          kind: "conflicted",
          delivery:
            applied.delivery === "sticky" ? "replayed" : applied.delivery,
          request: Object.freeze({ ...request }),
          conflict: Object.freeze({ ...outcome }),
        });
      }
      if (outcome.kind !== "relationIncomingPage") {
        // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - relation request and receipt correlation permits only relation page or relation conflict successes
        throw new Error("Relation receipt contains an unrelated success.");
      }
      return Object.freeze({
        kind: "completed",
        delivery: applied.delivery === "sticky" ? "replayed" : applied.delivery,
        outcome: Object.freeze({
          kind: "relationIncomingPage",
          items: Object.freeze(
            outcome.items.map((item) => Object.freeze({ ...item })),
          ),
          exhausted: outcome.exhausted,
        }),
      });
    }
  }
}

function issueFromStoredOutcome(
  outcome: Extract<SessionJournalStoredOutcome, { readonly kind: "error" }>,
): SessionJournalPersistedPointIssueV1 {
  switch (outcome.reason) {
    case "documentNotFound":
      return Object.freeze({
        reason: outcome.reason,
        operation: outcome.operation,
        documentId: outcome.documentId,
      });
    case "documentIdCollision":
      return Object.freeze({
        reason: outcome.reason,
        documentId: outcome.documentId,
      });
    case "invalidDocument":
      return Object.freeze({
        reason: outcome.reason,
        operation: outcome.operation,
      });
    case "limitExceeded":
      return Object.freeze({
        reason: outcome.reason,
        dimension: outcome.dimension,
        observed: outcome.observed,
        maximum: outcome.maximum,
      });
  }
}

function projectSuccessfulStoredOutcome(
  outcome: Exclude<SessionJournalStoredOutcome, { readonly kind: "error" }>,
): SessionJournalPointSuccessV1 {
  switch (outcome.kind) {
    case "missing":
      return Object.freeze({ kind: "missing", document: null });
    case "present": {
      const document = normalizeFlarexValueJsonV1(
        outcome.documentValueJson,
        "appDocument",
      ).value;
      return Object.freeze({ kind: "present", document });
    }
    case "inserted": {
      const document = normalizeFlarexValueJsonV1(
        outcome.documentValueJson,
        "appDocument",
      ).value;
      return Object.freeze({
        kind: "inserted",
        documentId: outcome.documentId,
        document,
      });
    }
    case "unit":
      return Object.freeze({
        kind: "unit",
        operation: outcome.operation,
      });
    case "indexRangePage":
      throw new Error("Point operation received an indexed-query outcome.");
    case "relationIncomingPage":
    case "relationConflict":
      // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - point request and receipt correlation rejects relation outcomes before point projection
      throw new Error("Point operation received a relation-read outcome.");
    case "admittedLogicalResult":
    case "admittedLogicalError":
    case "admittedLogicalInvoking":
      // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - point request and receipt correlation excludes participant outcomes before this projection
      throw new Error("Point operation received an admitted logical outcome.");
  }
}

export const decodeLivePointOverlayEvidenceEffect = Effect.fn(
  "SessionJournalStore.decodeLivePointOverlayEvidence",
)(function* (
  attempt: SessionJournalAttemptStateV1,
  point: typeof fxSystemTransactionJournalPoints.$inferSelect,
): Effect.fn.Return<
  CanonicalFlarexValueV1,
  SessionJournalStorageCorruptionV1Error
> {
  if (point.overlayKind !== "live") {
    return yield* Effect.die(
      new Error("Live point-overlay decoder received a non-live row."),
    );
  }
  if (
    point.overlayCreationTime === null ||
    point.overlayValueCodecVersion === null ||
    point.overlayValueJson === null ||
    point.overlayValueBytes === null ||
    point.overlayValueSha256 === null ||
    point.overlaySemanticBytes === null
  ) {
    return yield* Effect.fail(
      corruption(attempt, "liveOverlayEvidenceMissing"),
    );
  }
  const overlayCreationTime = point.overlayCreationTime;
  const overlayValueCodecVersion = point.overlayValueCodecVersion;
  const overlayValueJson = point.overlayValueJson;
  const overlayValueBytes = point.overlayValueBytes;
  const overlayValueSha256 = point.overlayValueSha256;
  const document = yield* Effect.tryPromise({
    try: () =>
      verifyAppDocumentEvidenceV1({
        tableId: point.tableId,
        rowId: appRowIdHexV1FromBytes(point.rowId),
        creationTime: overlayCreationTime,
        codecVersion: overlayValueCodecVersion,
        valueJson: overlayValueJson,
        canonicalBytes: overlayValueBytes,
        sha256: overlayValueSha256,
      }),
    catch: (cause): unknown => cause,
  }).pipe(
    // oxlint-disable-next-line flarex/prefer-tagged-effect-recovery -- REVIEW: protocol - classify the stored overlay Promise once, retaining its JSON mirror and codec/ID/system-field/evidence/Schema checks and unexpected defects.
    Effect.catch((cause) =>
      cause instanceof AppDocumentIdV1Error ||
      cause instanceof AppDocumentSystemFieldV1Error ||
      cause instanceof FlarexValueCodecV1Error ||
      cause instanceof FlarexValueEvidenceV1Error ||
      Schema.isSchemaError(cause)
        ? Effect.fail(
            corruption(attempt, "liveOverlaySemanticBytesMismatch", cause),
          )
        : Effect.die(cause),
    ),
  );
  if (document.semanticSizeBytes !== point.overlaySemanticBytes) {
    return yield* Effect.fail(
      corruption(attempt, "liveOverlaySemanticBytesMismatch"),
    );
  }
  return document;
});

export const verifyPointOverlayEvidenceEffect = Effect.fn(function* (
  attempt: SessionJournalAttemptStateV1,
  point: typeof fxSystemTransactionJournalPoints.$inferSelect,
): Effect.fn.Return<void, SessionJournalStorageCorruptionV1Error> {
  if (point.overlayKind !== "live") return;
  yield* decodeLivePointOverlayEvidenceEffect(attempt, point);
});

export function logicalDependencyFromPoint(
  dependency: AppRowPointDependencyV1,
): Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }> {
  const documentId = appDocumentIdV1FromRowIdentity({
    tableId: dependency.identity.tableId,
    rowId: dependency.identity.rowId,
  });
  return dependency.kind === "present"
    ? Object.freeze({
        kind: "appRowPoint",
        documentId,
        observed: Object.freeze({
          kind: "present",
          revisionCommitSeq: dependency.revisionCommitSeq,
        }),
      })
    : Object.freeze({
        kind: "appRowPoint",
        documentId,
        observed: Object.freeze({
          kind: "missing",
          basis: dependency.basis,
        }),
      });
}

export const decodeAndVerifyLogicalWriteEventEffect = Effect.fn(function* (
  attempt: SessionJournalAttemptStateV1,
  event: typeof fxSystemTransactionJournalWriteEvents.$inferSelect,
): Effect.fn.Return<LogicalAppWriteV1, SessionJournalStorageCorruptionV1Error> {
  const evidence = yield* decodeStoredEvidenceEffect(
    attempt,
    "logicalWriteEventInvalid",
    event.eventBytes,
    event.eventSha256,
  );
  const write = yield* Effect.fromResult(
    decodeLogicalAppWriteResult(evidence.valueJson).pipe(
      Result.mapError((cause) =>
        corruption(attempt, "logicalWriteEventInvalid", cause),
      ),
    ),
  );
  if (
    write.kind !== event.writeKind ||
    write.syscallSequence !== event.syscallSequence
  ) {
    return yield* Effect.fail(corruption(attempt, "logicalWriteEventInvalid"));
  }
  return write;
});
