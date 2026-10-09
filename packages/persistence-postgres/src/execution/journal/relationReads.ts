import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import type { SessionJournalStorePersistence } from "./contracts";
import {
  InvalidSessionJournalCapabilityV1Error,
  SessionJournalTargetUnavailableV1Error,
} from "./errors";
import type { SessionJournalRunApplicationRelationReadError } from "./errors";
import type {
  SessionJournalAttemptStateV1,
  PinnedApplicationRelationReadState,
} from "./state";
import { observeExecution } from "../diagnostics/operation";
import {
  bytesEqualFullScan as bytesEqual,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, asc, eq, ne } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogEdgeDefinitionId } from "flarex-protocol/catalog";
import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
  MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
} from "flarex-protocol/commit-protocol";
import type {
  ApplicationActivationSequenceV1,
  LogicalApplicationRelationIncomingReadDependencyV1,
} from "flarex-protocol/commit-protocol";
import { RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 } from "flarex-protocol/internal/application-schema-binding";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { readIncomingAppRelationEdgePageInTransactionEffect } from "../../storage/relations";
import type { AppRelationEdgeIncomingPageItem } from "../../storage/relations";
import {
  ApplicationRelationReadUnavailableError,
  mergeApplicationRelationIncomingPageResult,
} from "../../application/relations/applicationRelationRead";
import type { ApplicationRelationReadPort } from "../../application/relations/applicationRelationRead";
import type { ApplicationRelationRowTransition } from "../../application/relations/applicationRelationCommit";
import { readLiveAppRowsAtSnapshotInTransactionEffect } from "../../storage/documents/appRows";
import type {
  AppRowPointDependencyV1,
  AppRowTransaction,
  LiveAppRowRevisionV1,
} from "../../storage/documents/appRows";
import {
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalPoints,
} from "../../database/schema";
import { ExactRunningAttemptTransactionV1Error } from "../transactionSessionAttemptKernel";
import type { ExactRunningAttemptKernelContextV1 } from "../transactionSessionAttemptKernel";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  isLocatedExactRunningAttemptReadSyscallKernelV1,
} from "../transactionSessionReadSyscallKernel";
import {
  decodeCommitFinalSyscallSequenceResult,
  nextCommitSyscallSequence,
  canonicalizeStoredRequestEffect,
  canonicalizeStoredOutcomeEffect,
} from "./codecs";
import type {
  SessionJournalStoredRequest,
  SessionJournalStoredOutcome,
} from "./codecs";
import { captureApplicationRelationIncomingRequestResult } from "./inputCapture";
import {
  ZERO_COUNTER_DELTAS,
  firstExceededLimit,
  decodeJournalCountersResult,
} from "./operationModel";
import type {
  SessionJournalIncrementalLimitIssueV1,
  AppliedSessionJournalOperationV1,
  SessionJournalCountersV1,
  SessionJournalCounterDeltasV1,
} from "./operationModel";
import {
  decodeStoredRelationIncomingDependenciesEffect,
  decodePointDependencyResult,
  validateReceiptCardinalityResult,
  decodeAndVerifyLatestReceiptEffect,
  relationIncomingPositionsCorrelate,
  isLimitOutcome,
  validateReceiptOutcomeMatchesJournalRootResult,
  projectApplicationRelationIncomingResult,
  decodeLivePointOverlayEvidenceEffect,
} from "./receiptEvidence";
import {
  loadLatestReceipt,
  loadReceiptAtSequence,
  persistAcceptedOperationEffect,
} from "./journalPersistence";
import {
  mapRunApplicationRelationFailure,
  fromApplicationRelationPromise,
  mapExactRunningApplicationRelationFailure,
  kernelContextMatchesAttempt,
  corruption,
} from "./journalFailures";
import type { SessionJournalStorePersistenceOptionsV1 } from "../sessionJournalStore";
import type { JournalAttemptOwner } from "./attemptOwner";
import { admitExactRunningAttemptEffect } from "./targetAdmission";
import type { JournalTargetResolver } from "./targetAdmission";

export type StoredApplicationRelationIncomingRequest = Extract<
  SessionJournalStoredRequest,
  { readonly kind: "relationIncoming" }
>;

const runApplicationRelationIncomingInTransactionEffect = Effect.fn(
  "SessionJournalStore.runApplicationRelationIncomingInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  relation: PinnedApplicationRelationReadState,
  request: StoredApplicationRelationIncomingRequest,
  requestEvidence: CanonicalFlarexValueV1,
  relationPort: ApplicationRelationReadPort,
  faultAfter: SessionJournalStorePersistenceOptionsV1["faultAfter"],
): Effect.fn.Return<
  AppliedSessionJournalOperationV1,
  SessionJournalRunApplicationRelationReadError
> {
  const attempt = relation.attempt;
  const resolved = relation.resolved;
  const definition = resolved.definition;
  if (!kernelContextMatchesAttempt(context, attempt)) {
    return yield* Effect.fail(corruption(attempt, "exactAttemptPinsChanged"));
  }
  if (
    request.relationId !== definition.binding.relationId ||
    request.edgeDefinitionId !== definition.edge.edgeDefinitionId ||
    request.sourceTableId !== definition.binding.sourceTableId ||
    request.targetTableId !== definition.binding.targetTableId
  ) {
    return yield* Effect.fail(
      corruption(attempt, "requestTableCapabilityMismatch"),
    );
  }
  if (
    resolved.storageGenerationFence !== context.anchor.storageGenerationFence ||
    resolved.storageGenerationFence !==
      context.scopeClock.storageGenerationFence ||
    resolved.epoch !== context.anchor.snapshotToken.epoch ||
    resolved.epoch !== context.scopeClock.epoch
  ) {
    return yield* Effect.fail(
      new ApplicationRelationReadUnavailableError({
        reason: "capabilityMismatch",
      }),
    );
  }

  const validated = yield* relationPort.validateInTransaction(
    relation.capability,
    {
      deploymentId: attempt.selector.deploymentId,
      scopeId: attempt.selector.scopeId,
      schemaVersionId: attempt.schemaVersionId,
    },
    tx,
    context.scopeClock,
  );
  const activationSequence = ApplicationActivationSequenceV1Schema.make(
    validated.activeSelection.activationSequence,
  );
  const activeHeadSha256Hex = ApplicationActiveHeadSha256HexV1Schema.make(
    encodeBytesToLowercaseHex(validated.activeSelection.activeHeadSha256),
  );

  const root = context.journalRoot;
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(attempt, root),
  );
  const currentDependencies =
    yield* loadRelationIncomingDependenciesForUpdateEffect(
      tx,
      context,
      attempt,
    );
  if (currentDependencies.length !== counters.relationDependencyCount) {
    return yield* Effect.fail(
      corruption(attempt, "relationDependencyCountMismatch"),
    );
  }
  if (
    currentDependencies.some(
      (dependency) =>
        dependency.activationSequence !== activationSequence ||
        dependency.activeHeadSha256Hex !== activeHeadSha256Hex,
    )
  ) {
    return yield* Effect.fail(
      new ApplicationRelationReadUnavailableError({
        reason: "capabilityMismatch",
      }),
    );
  }
  const receipt = yield* fromApplicationRelationPromise(() =>
    loadLatestReceipt(tx, context),
  );
  yield* Effect.fromResult(
    validateReceiptCardinalityResult(
      attempt,
      root.lastSyscallSequence,
      receipt,
    ),
  );
  const last = yield* Effect.fromResult(
    decodeCommitFinalSyscallSequenceResult(root.lastSyscallSequence).pipe(
      Result.mapError(mapRunApplicationRelationFailure),
    ),
  );
  const actual = request.syscallSequence;
  if (root.state === "sealed") {
    return Object.freeze({ kind: "stateRejected", reason: "journalSealed" });
  }
  if (actual < last) {
    const prior = yield* fromApplicationRelationPromise(() =>
      loadReceiptAtSequence(tx, context, actual),
    );
    if (prior === undefined) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptMissing"));
    }
    if (!bytesEqual(prior.requestBytes, requestEvidence.canonicalBytes)) {
      return Object.freeze({
        kind: "sequenceRejected",
        issue: Object.freeze({
          reason: "requestMismatch",
          syscallSequence: actual,
        }),
      });
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      attempt,
      prior,
      request,
    );
    if (
      replayed.kind !== "relationIncomingPage" &&
      replayed.kind !== "relationConflict" &&
      !isLimitOutcome(replayed)
    ) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptEvidenceInvalid"),
      );
    }
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }
  if (BigInt(actual) === BigInt(last)) {
    if (receipt === undefined) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptMissing"));
    }
    if (!bytesEqual(receipt.requestBytes, requestEvidence.canonicalBytes)) {
      return Object.freeze({
        kind: "sequenceRejected",
        issue: Object.freeze({
          reason: "requestMismatch",
          syscallSequence: actual,
        }),
      });
    }
    if (!bytesEqual(receipt.requestSha256, requestEvidence.sha256)) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptRequestDigestMismatch"),
      );
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      attempt,
      receipt,
      request,
    );
    if (
      replayed.kind !== "relationIncomingPage" &&
      replayed.kind !== "relationConflict" &&
      !isLimitOutcome(replayed)
    ) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptEvidenceInvalid"),
      );
    }
    if (
      replayed.kind === "relationIncomingPage" &&
      !relationIncomingPositionsCorrelate(
        definition.edge.physical,
        replayed.items,
      )
    ) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptEvidenceInvalid"),
      );
    }
    yield* Effect.fromResult(
      validateReceiptOutcomeMatchesJournalRootResult(attempt, root, replayed),
    );
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }
  const nextSequence = nextCommitSyscallSequence(last);
  if (Option.isNone(nextSequence)) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({ reason: "sequenceExhausted", lastAccepted: last }),
    });
  }
  const expectedNext = nextSequence.value;
  if (actual !== expectedNext) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({ reason: "sequenceGap", actual, expectedNext }),
    });
  }
  if (root.state === "operation_failed") {
    return Object.freeze({ kind: "stateRejected", reason: "journalFailed" });
  }
  if (root.state === "failed") {
    if (receipt === undefined) {
      return yield* Effect.fail(
        corruption(attempt, "failedJournalEvidenceInvalid"),
      );
    }
    const sticky = yield* decodeAndVerifyLatestReceiptEffect(
      attempt,
      receipt,
      undefined,
    );
    if (!isLimitOutcome(sticky)) {
      return yield* Effect.fail(
        corruption(attempt, "failedJournalReceiptInvalid"),
      );
    }
    yield* Effect.fromResult(
      validateReceiptOutcomeMatchesJournalRootResult(attempt, root, sticky),
    );
    return Object.freeze({
      kind: "outcome",
      delivery: "sticky",
      outcome: sticky,
    });
  }
  if (root.state === "relation_conflicted") {
    return Object.freeze({
      kind: "stateRejected",
      reason: "journalRelationConflicted",
    });
  }
  if (root.state !== "open") {
    return yield* Effect.fail(corruption(attempt, "journalStateInvalid"));
  }

  const existingDependency = currentDependencies.find(
    (dependency) =>
      dependency.edgeDefinitionId === request.edgeDefinitionId &&
      dependency.targetRowId === request.targetRowId,
  );
  const dependencyIsNew = existingDependency === undefined;
  const preflightLimit = firstExceededLimit(counters, {
    ...ZERO_COUNTER_DELTAS,
    relationReadSyscalls: 1,
    relationDependencyCount: dependencyIsNew ? 1 : 0,
  });
  if (preflightLimit !== undefined) {
    return yield* persistApplicationRelationLimitOutcomeEffect(
      tx,
      context,
      request,
      requestEvidence,
      counters,
      preflightLimit,
    );
  }
  const remainingBaseBudget =
    MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 - counters.relationBaseOccurrences;
  if (remainingBaseBudget < 2) {
    return yield* persistApplicationRelationLimitOutcomeEffect(
      tx,
      context,
      request,
      requestEvidence,
      counters,
      Object.freeze({
        dimension: "relationBaseOccurrences",
        observed: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 + 1,
        maximum: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
      }),
    );
  }

  const transitions = yield* loadApplicationRelationOverlayTransitionsEffect(
    tx,
    context,
    relation,
  );
  const overlay = yield* Effect.fromResult(
    relationPort.lowerOverlay(
      relation.capability,
      {
        deploymentId: attempt.selector.deploymentId,
        scopeId: attempt.selector.scopeId,
        schemaVersionId: attempt.schemaVersionId,
      },
      transitions,
    ),
  );

  const baseItems: AppRelationEdgeIncomingPageItem[] = [];
  let baseExhausted = false;
  let frontier:
    | Readonly<{
        sourceRowId: AppRowIdHexV1;
        duplicateOrdinal: 0;
      }>
    | undefined;
  let stableVersion: CommitSeq | undefined;
  let inspectedBaseOccurrences = 0;
  while (true) {
    const available = remainingBaseBudget - inspectedBaseOccurrences;
    if (available < 2) {
      return yield* persistApplicationRelationLimitOutcomeEffect(
        tx,
        context,
        request,
        requestEvidence,
        counters,
        Object.freeze({
          dimension: "relationBaseOccurrences",
          observed: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 + 1,
          maximum: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
        }),
      );
    }
    const physicalPageSize = Math.min(
      RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1,
      available - 1,
    );
    const page = yield* readIncomingAppRelationEdgePageInTransactionEffect(tx, {
      scopeId: attempt.selector.scopeId,
      definition: definition.edge,
      targetRowId: request.targetRowId,
      maximumIdentities: physicalPageSize,
      ...(frontier === undefined ? {} : { after: frontier }),
    }).pipe(Effect.mapError(mapRunApplicationRelationFailure));
    inspectedBaseOccurrences += page.inspectedBaseOccurrenceCount;
    if (
      page.versionAfter < page.versionBefore ||
      page.versionBefore > context.scopeClock.lastCommitSeq ||
      page.versionAfter > context.scopeClock.lastCommitSeq
    ) {
      return yield* Effect.fail(
        corruption(attempt, "relationAdjacencyVersionInvalid"),
      );
    }
    const expectedVersion =
      existingDependency?.observedAdjacencyVersion ??
      stableVersion ??
      attempt.snapshotToken.commitSeq;
    const actualVersion = page.versionAfter;
    if (
      page.versionBefore !== page.versionAfter ||
      page.versionBefore > attempt.snapshotToken.commitSeq ||
      (stableVersion !== undefined && page.versionBefore !== stableVersion) ||
      (existingDependency !== undefined &&
        page.versionBefore !== existingDependency.observedAdjacencyVersion)
    ) {
      if (actualVersion <= attempt.snapshotToken.commitSeq) {
        return yield* Effect.fail(
          corruption(attempt, "relationAdjacencyVersionInvalid"),
        );
      }
      return yield* persistApplicationRelationConflictOutcomeEffect(
        tx,
        context,
        request,
        requestEvidence,
        counters,
        inspectedBaseOccurrences,
        Object.freeze({
          expectedAdjacencyVersion: expectedVersion,
          actualAdjacencyVersion: actualVersion,
        }),
        dependencyIsNew,
        Object.freeze({
          edgeDefinitionId: request.edgeDefinitionId,
          targetRowId: request.targetRowId,
          observedAdjacencyVersion: expectedVersion,
          activationSequence,
          activeHeadSha256: validated.activeSelection.activeHeadSha256,
        }),
        faultAfter,
      );
    }
    stableVersion ??= page.versionBefore;
    baseItems.push(...page.items);
    baseExhausted = page.exhausted;
    const merged = yield* Effect.fromResult(
      mergeApplicationRelationIncomingPageResult({
        sourceTableId: request.sourceTableId,
        targetRowId: request.targetRowId,
        maximumIdentities: request.limit,
        baseItems,
        baseExhausted,
        actions: overlay.actions,
      }),
    );
    if (merged.status === "complete") {
      const observedAdjacencyVersion = stableVersion;
      if (observedAdjacencyVersion === undefined) {
        return yield* Effect.fail(
          corruption(attempt, "relationAdjacencyVersionInvalid"),
        );
      }
      const outcome = Object.freeze({
        kind: "relationIncomingPage",
        items: merged.items,
        exhausted: merged.exhausted,
      } satisfies SessionJournalStoredOutcome);
      const outcomeEvidence = yield* canonicalizeStoredOutcomeEffect(
        outcome,
      ).pipe(Effect.mapError(mapRunApplicationRelationFailure));
      const deltas = Object.freeze({
        ...ZERO_COUNTER_DELTAS,
        relationReadSyscalls: 1,
        relationDependencyCount: dependencyIsNew ? 1 : 0,
        relationBaseOccurrences: inspectedBaseOccurrences,
        receiptEvidenceBytes:
          requestEvidence.canonicalBytes.byteLength +
          outcomeEvidence.canonicalBytes.byteLength,
      } satisfies SessionJournalCounterDeltasV1);
      const limitIssue = firstExceededLimit(counters, deltas);
      if (limitIssue !== undefined) {
        return yield* persistApplicationRelationLimitOutcomeEffect(
          tx,
          context,
          request,
          requestEvidence,
          counters,
          limitIssue,
        );
      }
      yield* Effect.gen(function* () {
        if (dependencyIsNew) {
          yield* runDrizzleStatementEffect(
            insertApplicationRelationIncomingDependency(tx, context, {
              edgeDefinitionId: request.edgeDefinitionId,
              targetRowId: request.targetRowId,
              observedAdjacencyVersion,
              activationSequence,
              activeHeadSha256: validated.activeSelection.activeHeadSha256,
            }),
            mapRunApplicationRelationFailure,
          );
        }
        yield* Effect.tryPromise({
          try: async () => faultAfter?.("relationReadEvidenceWritten"),
          catch: mapRunApplicationRelationFailure,
        });
        yield* persistAcceptedOperationEffect(
          tx,
          context,
          request,
          requestEvidence,
          outcome,
          counters,
          deltas,
          { state: "open", failureDimension: null },
          mapRunApplicationRelationFailure,
        );
      });
      return Object.freeze({ kind: "outcome", delivery: "executed", outcome });
    }
    const nextFrontier = page.nextFrontier;
    if (baseExhausted || nextFrontier === null) {
      return yield* Effect.fail(
        corruption(attempt, "relationPageFrontierInvalid"),
      );
    }
    frontier = nextFrontier;
  }
});

const loadRelationIncomingDependenciesForUpdateEffect = Effect.fn(
  "SessionJournalStore.loadRelationIncomingDependenciesForUpdate",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attempt: SessionJournalAttemptStateV1,
): Effect.fn.Return<
  ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>,
  SessionJournalRunApplicationRelationReadError
> {
  const rows = yield* fromApplicationRelationPromise(() =>
    tx
      .select()
      .from(fxSystemTransactionJournalRelationIncomingDependencies)
      .where(
        and(
          eq(
            fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid,
            context.scopeUuid,
          ),
          eq(
            fxSystemTransactionJournalRelationIncomingDependencies.sessionId,
            context.anchor.sessionId,
          ),
          eq(
            fxSystemTransactionJournalRelationIncomingDependencies.attemptFence,
            context.anchor.attemptFence,
          ),
        ),
      )
      .orderBy(
        asc(
          fxSystemTransactionJournalRelationIncomingDependencies.edgeDefinitionId,
        ),
        asc(fxSystemTransactionJournalRelationIncomingDependencies.targetRowId),
      )
      .limit(MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 + 1)
      .for("update"),
  );
  return yield* decodeStoredRelationIncomingDependenciesEffect(attempt, rows);
});

const loadApplicationRelationOverlayTransitionsEffect = Effect.fn(
  "SessionJournalStore.loadApplicationRelationOverlayTransitions",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  relation: PinnedApplicationRelationReadState,
): Effect.fn.Return<
  ReadonlyArray<ApplicationRelationRowTransition>,
  SessionJournalRunApplicationRelationReadError
> {
  const attempt = relation.attempt;
  const sourceTableId = relation.resolved.definition.binding.sourceTableId;
  const rows = yield* fromApplicationRelationPromise(() =>
    tx
      .select()
      .from(fxSystemTransactionJournalPoints)
      .where(
        and(
          eq(fxSystemTransactionJournalPoints.scopeUuid, context.scopeUuid),
          eq(
            fxSystemTransactionJournalPoints.sessionId,
            context.anchor.sessionId,
          ),
          eq(
            fxSystemTransactionJournalPoints.attemptFence,
            context.anchor.attemptFence,
          ),
          eq(fxSystemTransactionJournalPoints.tableId, sourceTableId),
          ne(fxSystemTransactionJournalPoints.overlayKind, "none"),
        ),
      )
      .orderBy(asc(fxSystemTransactionJournalPoints.rowId))
      .limit(MAX_POINT_COMMIT_MATERIAL_ROWS_V1 + 1)
      .for("update"),
  );
  if (rows.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1) {
    return yield* Effect.fail(
      corruption(attempt, "pointDependencyCountMismatch"),
    );
  }
  const decoded: Array<
    Readonly<{
      row: typeof fxSystemTransactionJournalPoints.$inferSelect;
      rowId: AppRowIdHexV1;
      dependency: AppRowPointDependencyV1;
    }>
  > = [];
  const presentRowIds: AppRowIdHexV1[] = [];
  for (const row of rows) {
    const rowId = yield* Effect.try({
      try: () => appRowIdHexV1FromBytes(row.rowId),
      catch: (cause) =>
        corruption(attempt, "pointDependencyCountMismatch", cause),
    });
    const dependency = yield* Effect.fromResult(
      decodePointDependencyResult(attempt, row),
    );
    if (
      dependency.identity.tableId !== sourceTableId ||
      dependency.identity.rowId !== rowId
    ) {
      return yield* Effect.fail(
        corruption(attempt, "pointDependencyCountMismatch"),
      );
    }
    if (dependency.kind === "present") presentRowIds.push(rowId);
    decoded.push(Object.freeze({ row, rowId, dependency }));
  }
  const priorRevisions =
    presentRowIds.length === 0
      ? Object.freeze([])
      : yield* readLiveAppRowsAtSnapshotInTransactionEffect(tx, {
          scopeId: attempt.selector.scopeId,
          tableId: sourceTableId,
          rowIds: Object.freeze(presentRowIds),
          snapshotCommitSeq: attempt.snapshotToken.commitSeq,
        }).pipe(Effect.mapError(mapRunApplicationRelationFailure));
  const priorByRowId = new Map<AppRowIdHexV1, LiveAppRowRevisionV1>();
  for (const revision of priorRevisions) {
    if (priorByRowId.has(revision.rowId)) {
      return yield* Effect.fail(
        corruption(attempt, "pointDependencyChangedAtSnapshot"),
      );
    }
    priorByRowId.set(revision.rowId, revision);
  }
  const transitions: ApplicationRelationRowTransition[] = [];
  for (const item of decoded) {
    const priorRevision =
      item.dependency.kind === "present"
        ? priorByRowId.get(item.rowId)
        : undefined;
    if (
      item.dependency.kind === "present" &&
      (priorRevision === undefined ||
        priorRevision.commitSeq !== item.dependency.revisionCommitSeq)
    ) {
      return yield* Effect.fail(
        corruption(attempt, "pointDependencyChangedAtSnapshot"),
      );
    }
    const final =
      item.row.overlayKind === "deleted"
        ? null
        : item.row.overlayKind === "live"
          ? yield* decodeLivePointOverlayEvidenceEffect(attempt, item.row)
          : yield* Effect.fail(
              corruption(attempt, "liveOverlayEvidenceMissing"),
            );
    transitions.push(
      Object.freeze({
        documentId: appDocumentIdV1FromRowIdentity({
          tableId: sourceTableId,
          rowId: item.rowId,
        }),
        tableId: sourceTableId,
        rowId: item.rowId,
        prior: priorRevision?.document ?? null,
        final,
      }),
    );
  }
  return Object.freeze(transitions);
});

interface ApplicationRelationIncomingJournalDependency {
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly targetRowId: AppRowIdHexV1;
  readonly observedAdjacencyVersion: CommitSeq;
  readonly activationSequence: ApplicationActivationSequenceV1;
  readonly activeHeadSha256: Uint8Array;
}

async function insertApplicationRelationIncomingDependency(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  dependency: ApplicationRelationIncomingJournalDependency,
): Promise<void> {
  await tx
    .insert(fxSystemTransactionJournalRelationIncomingDependencies)
    .values({
      scopeUuid: context.scopeUuid,
      sessionId: context.anchor.sessionId,
      attemptFence: context.anchor.attemptFence,
      edgeDefinitionId: dependency.edgeDefinitionId,
      targetRowId: appRowIdHexV1ToBytes(dependency.targetRowId),
      observedAdjacencyVersion: dependency.observedAdjacencyVersion,
      activationSequence: dependency.activationSequence,
      activeHeadSha256: new Uint8Array(dependency.activeHeadSha256),
      createdAt: context.databaseNow,
      updatedAt: context.databaseNow,
    });
}

const persistApplicationRelationLimitOutcomeEffect = Effect.fn(
  "SessionJournalStore.persistApplicationRelationLimitOutcome",
)(function (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  request: StoredApplicationRelationIncomingRequest,
  requestEvidence: CanonicalFlarexValueV1,
  counters: SessionJournalCountersV1,
  issue: SessionJournalIncrementalLimitIssueV1,
) {
  const outcome = Object.freeze({
    kind: "error",
    reason: "limitExceeded",
    ...issue,
  } satisfies SessionJournalStoredOutcome);
  return persistAcceptedOperationEffect(
    tx,
    context,
    request,
    requestEvidence,
    outcome,
    counters,
    ZERO_COUNTER_DELTAS,
    { state: "failed", failureDimension: issue.dimension },
    mapRunApplicationRelationFailure,
  ).pipe(
    Effect.map(() =>
      Object.freeze({
        kind: "outcome",
        delivery: "executed",
        outcome,
      } as const),
    ),
  );
});

const persistApplicationRelationConflictOutcomeEffect = Effect.fn(
  "SessionJournalStore.persistApplicationRelationConflictOutcome",
)(function (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  request: StoredApplicationRelationIncomingRequest,
  requestEvidence: CanonicalFlarexValueV1,
  counters: SessionJournalCountersV1,
  inspectedBaseOccurrences: number,
  conflict: Readonly<{
    expectedAdjacencyVersion: CommitSeq;
    actualAdjacencyVersion: CommitSeq;
  }>,
  dependencyIsNew: boolean,
  dependency: ApplicationRelationIncomingJournalDependency,
  faultAfter: SessionJournalStorePersistenceOptionsV1["faultAfter"],
) {
  const outcome = Object.freeze({
    kind: "relationConflict",
    edgeDefinitionId: request.edgeDefinitionId,
    targetRowId: request.targetRowId,
    expectedAdjacencyVersion: conflict.expectedAdjacencyVersion,
    actualAdjacencyVersion: conflict.actualAdjacencyVersion,
    snapshotCommitSeq: context.anchor.snapshotToken.commitSeq,
  } satisfies SessionJournalStoredOutcome);
  const deltas = Object.freeze({
    ...ZERO_COUNTER_DELTAS,
    relationReadSyscalls: 1,
    relationDependencyCount: dependencyIsNew ? 1 : 0,
    relationBaseOccurrences: inspectedBaseOccurrences,
  } satisfies SessionJournalCounterDeltasV1);
  return Effect.gen(function* () {
    if (dependencyIsNew) {
      yield* runDrizzleStatementEffect(
        insertApplicationRelationIncomingDependency(tx, context, dependency),
        mapRunApplicationRelationFailure,
      );
    }
    yield* persistAcceptedOperationEffect(
      tx,
      context,
      request,
      requestEvidence,
      outcome,
      counters,
      deltas,
      { state: "relation_conflicted", failureDimension: null },
      mapRunApplicationRelationFailure,
    );
    yield* Effect.tryPromise({
      try: async () => faultAfter?.("relationConflictEvidenceWritten"),
      catch: mapRunApplicationRelationFailure,
    });
  }).pipe(
    Effect.map(() =>
      Object.freeze({
        kind: "outcome",
        delivery: "executed",
        outcome,
      } as const),
    ),
  );
});

export function makeRelationReads(
  owner: JournalAttemptOwner,
  resolveJournalTargetEffect: JournalTargetResolver,
  applicationRelationPort: ApplicationRelationReadPort | undefined,
  applicationRelationCompositionIsExact: boolean,
  faultAfter: SessionJournalStorePersistenceOptionsV1["faultAfter"],
) {
  const resolveApplicationRelationReadEffect: SessionJournalStorePersistence["resolveApplicationRelationReadEffect"] =
    Effect.fnUntraced(
      function* (attempt, capability) {
        const attemptState =
          typeof attempt === "object" && attempt !== null
            ? owner.readAttempt(attempt)
            : undefined;
        if (attemptState === undefined) {
          return yield* Effect.fail(
            new InvalidSessionJournalCapabilityV1Error({
              capability: "attempt",
            }),
          );
        }
        if (owner.readFiniteRoot(attemptState)?.reservation !== undefined)
          return yield* Effect.fail(
            new ApplicationRelationReadUnavailableError({
              reason: "capabilityMismatch",
            }),
          );
        if (
          applicationRelationPort === undefined ||
          !applicationRelationCompositionIsExact
        ) {
          return yield* Effect.fail(
            new ApplicationRelationReadUnavailableError({
              reason: "invalidComposition",
            }),
          );
        }
        const resolved = yield* Effect.fromResult(
          applicationRelationPort.resolve(capability, {
            deploymentId: attemptState.selector.deploymentId,
            scopeId: attemptState.selector.scopeId,
            schemaVersionId: attemptState.schemaVersionId,
          }),
        );
        if (resolved.epoch !== attemptState.snapshotToken.epoch) {
          return yield* Effect.fail(
            new ApplicationRelationReadUnavailableError({
              reason: "capabilityMismatch",
            }),
          );
        }
        const resolvedTarget = yield* resolveJournalTargetEffect(attemptState);
        yield* admitExactRunningAttemptEffect(
          resolvedTarget,
          attemptState,
          "resolveApplicationRelation",
        );
        const state = Object.freeze({
          attempt: attemptState,
          capability,
          resolved,
        } satisfies PinnedApplicationRelationReadState);
        return owner.issueRelationRead(state);
      },
      (work) =>
        observeExecution(
          "SessionJournalStore.resolveApplicationRelationRead",
          work,
        ),
    );

  const runApplicationRelationIncomingReadEffect: SessionJournalStorePersistence["runApplicationRelationIncomingReadEffect"] =
    Effect.fnUntraced(
      function* (relation, operation) {
        const state =
          typeof relation === "object" && relation !== null
            ? owner.readRelationRead(relation)
            : undefined;
        if (state === undefined) {
          return yield* Effect.fail(
            new InvalidSessionJournalCapabilityV1Error({
              capability: "applicationRelation",
            }),
          );
        }
        const relationPort = applicationRelationPort;
        if (
          relationPort === undefined ||
          !applicationRelationCompositionIsExact
        ) {
          return yield* Effect.fail(
            new ApplicationRelationReadUnavailableError({
              reason: "invalidComposition",
            }),
          );
        }
        const request = yield* Effect.fromResult(
          captureApplicationRelationIncomingRequestResult(state, operation),
        );
        const requestEvidence = yield* canonicalizeStoredRequestEffect(request);
        const resolved = yield* resolveJournalTargetEffect(state.attempt);
        if (!isLocatedExactRunningAttemptReadSyscallKernelV1(resolved.target)) {
          return yield* Effect.fail(
            new SessionJournalTargetUnavailableV1Error({
              scopeId: state.attempt.selector.scopeId,
            }),
          );
        }
        const checked = resolved.target[
          RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
        ](
          {
            selector: state.attempt.selector,
            preliminaryAuthority: resolved.authority,
            executionClaim: state.attempt.executionClaim,
          },
          (tx, context) =>
            runApplicationRelationIncomingInTransactionEffect(
              tx,
              context,
              state,
              request,
              requestEvidence,
              relationPort,
              faultAfter,
            ),
        );
        const applied = yield* checked.pipe(
          Effect.mapError((error) =>
            error instanceof ExactRunningAttemptTransactionV1Error
              ? mapExactRunningApplicationRelationFailure(error)
              : error,
          ),
        );
        return projectApplicationRelationIncomingResult(applied, request);
      },
      (work) =>
        observeExecution(
          "SessionJournalStore.runApplicationRelationIncomingRead",
          work,
        ),
    );
  return Object.freeze({
    resolveApplicationRelationReadEffect,
    runApplicationRelationIncomingReadEffect,
  });
}
