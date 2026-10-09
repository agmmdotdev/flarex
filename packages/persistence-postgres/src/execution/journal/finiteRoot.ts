import type {
  SessionJournalAttempt,
  SessionJournalParticipantSelection,
  SessionJournalStorePersistence,
  AdmittedCompletion,
} from "./contracts";
import {
  InvalidSessionJournalCapabilityV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalSealV1Error,
} from "./errors";
import type {
  SessionJournalAttemptStateV1,
  ResolvedJournalTargetV1,
} from "./state";
import { observeExecution } from "../diagnostics/operation";
import {
  captureFiniteStorageEffect,
  FiniteStorageCaptureError,
} from "../finiteStorageCapture";
import type { CapturedFiniteAttemptAnchor } from "../finiteAttemptAnchor";
import { materializeFiniteApplicationExecutionEvidence } from "../../commit/authority/materialization";
import type { AppSchemaCandidateWriteGuardPlanningHead } from "../../storage/catalog/appSchemaCandidateValidation";
import { bytesEqualFullScan as bytesEqual } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity } from "flarex-protocol/app-document-id";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type {
  CatalogIndexDefinitionId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import {
  MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  verifySuccessfulResultEvidenceV1Effect,
  readIssuedCanonicalSuccessfulResultV1,
} from "flarex-protocol/commit-protocol";
import type {
  LogicalIndexRangeReadDependencyV1,
  LogicalApplicationRelationIncomingReadDependencyV1,
} from "flarex-protocol/commit-protocol";
import { jsonEqual } from "flarex-protocol/json";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type {
  AppRowPointDependencyV1,
  AppRowTransaction,
} from "../../storage/documents/appRows";
import { LogicalParticipantAdmissionError } from "../../storage/documents/logicalDocuments/participantErrors";
import {
  inspectLogicalParticipantAttemptAdmission,
  issueLogicalParticipantAdmissionBundle,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import type { LogicalParticipantAdmissionBundle } from "../../storage/documents/logicalDocuments/participantAdmission";
import {
  inspectFiniteAttemptMetadata,
  captureFiniteApplicationAttemptMetadata,
  prepareFiniteAttemptMetadataProjection,
  getFiniteAttemptMetadataProjection,
  getFiniteApplicationWriteMetadataProjection,
  getFiniteApplicationPublicationDefinitions,
  getFiniteApplicationDemandMetadataKeys,
} from "../../storage/documents/logicalDocuments/sourceAdmission";
import type { FiniteAttemptMetadata } from "../../storage/documents/logicalDocuments/sourceAdmission";
import {
  APPLICATION_EXECUTION_METADATA_OWNER,
  captureFiniteMetadataDependency,
  finiteMetadataContractKey,
} from "../finiteMetadataDependencies";
import { captureFiniteMetadataReservation } from "../finiteMetadataReservation";
import type { CapturedFiniteMetadataReservation } from "../finiteMetadataReservation";
import { projectLogicalPointExpectation } from "../../storage/documents/logicalDocuments/pointEvidence";
import type { LogicalDocumentPointEvidence } from "../../storage/documents/logicalDocuments/pointEvidence";
import type { PendingDocument } from "../../storage/documents/logicalDocuments/workingSet";
import type { LogicalFiniteStorageCapture } from "../../storage/documents/logicalDocuments/model";
import {
  makeLogicalDocumentRootEvaluator,
  attachLogicalDocumentRootEvaluator,
  recordLogicalDocumentRootMetadataDependency,
  takeLogicalDocumentRootSnapshot,
  borrowClosedLogicalDocumentRoot,
} from "../../storage/documents/logicalDocuments/rootEvaluator";
import type { LogicalDocumentRootEvaluator } from "../../storage/documents/logicalDocuments/rootEvaluator";
import type { FiniteEntryAttemptKernelContext } from "../transactionSessionAttemptKernel";
import { captureFiniteAttemptReservationInTransaction } from "../transactionSessionActivation";
import { readPreparedFiniteSessionJournalEntrySchema } from "./finiteEntryActivation";
import { issueFrozenFiniteAttempt } from "./freezeClosedRoot";
import type { FrozenFiniteOperation } from "./frozenAttempt";
import type {
  SessionJournalStoredRequest,
  SessionJournalStoredPointRequest,
  SessionJournalStoredOutcome,
} from "./codecs";
import { captureAttemptStateResult } from "./inputCapture";
import { ZERO_FINITE_COUNTERS } from "./operationModel";
import type {
  SessionJournalCountersV1,
  JournalPointOverlayV1,
  JournalPointMutationV1,
  SessionJournalOperationPlanV1,
  PreparedLogicalWriteEventV1,
  LogicalPointReadV1,
} from "./operationModel";
import { kernelContextMatchesAttempt, corruption } from "./journalFailures";
import type { JournalAttemptOwner } from "./attemptOwner";
import type {
  FiniteEntryRun,
  FiniteEntryTransactionCapture,
  FiniteEntryFailure,
  PreparedFiniteSessionJournalEntry,
} from "./finiteEntry";
import { makeAttemptReadTransaction } from "./targetAdmission";

/** Tentative child evidence for one fenced, effect-free root. A child result is
 * never an independently durable acknowledgement in this profile. */
interface FiniteRootAdmittedRecord {
  readonly kind: "admitted";
  /** Issuer-owned capability stays local and is never cloned or serialized. */
  readonly admission: LogicalParticipantAdmissionBundle;
  readonly request: Extract<
    SessionJournalStoredRequest,
    {
      readonly kind: "admittedLogicalOperation";
    }
  >;
  readonly requestEvidence: CanonicalFlarexValueV1;
  readonly bindingDigest: Uint8Array;
  readonly completed: Pick<
    AdmittedCompletion,
    "result" | "eventIntents" | "workBytes" | "workCalls"
  >;
  readonly outcome: Extract<
    SessionJournalStoredOutcome,
    {
      readonly kind: "admittedLogicalResult";
    }
  >;
  readonly outcomeEvidence: CanonicalFlarexValueV1;
  readonly attemptStart: number;
  readonly attemptEnd: number;
}

interface FiniteRootPointRecord {
  readonly kind: "point";
  readonly request: SessionJournalStoredPointRequest;
  readonly requestEvidence: CanonicalFlarexValueV1;
  readonly outcome: SessionJournalStoredOutcome;
  readonly outcomeEvidence: CanonicalFlarexValueV1;
  readonly plan: SessionJournalOperationPlanV1;
  readonly writeEvent?: PreparedLogicalWriteEventV1;
}

interface FiniteRootIndexRecord {
  readonly kind: "index";
  readonly request: Extract<
    SessionJournalStoredRequest,
    { readonly kind: "indexRange" }
  >;
  readonly requestEvidence: CanonicalFlarexValueV1;
  readonly outcome: SessionJournalStoredOutcome;
  readonly outcomeEvidence: CanonicalFlarexValueV1;
}

interface FiniteRootRelationRecord {
  readonly kind: "relation";
  readonly request: Extract<
    SessionJournalStoredRequest,
    { readonly kind: "relationIncoming" }
  >;
  readonly requestEvidence: CanonicalFlarexValueV1;
  readonly outcome: SessionJournalStoredOutcome;
  readonly outcomeEvidence: CanonicalFlarexValueV1;
}

type FiniteRootRecord =
  | FiniteRootAdmittedRecord
  | FiniteRootPointRecord
  | FiniteRootIndexRecord
  | FiniteRootRelationRecord;

interface FiniteRootAttemptData {
  originalEntry?: import("./finiteEntry").OriginalFiniteExecutionEntry;
  readonly handle: SessionJournalAttempt;
  readonly resolvedTarget: ResolvedJournalTargetV1;
  initialContext: FiniteEntryAttemptKernelContext;
  readonly applicationSchema: import("flarex-protocol/schema-manifest").SchemaManifestAppSchemaV1;
  readonly writableTables: Set<CatalogTableId>;
  candidatePlanningHead?: AppSchemaCandidateWriteGuardPlanningHead;
  readonly admissions: Map<
    string,
    Readonly<{
      selection: SessionJournalParticipantSelection;
      bundle: LogicalParticipantAdmissionBundle;
    }>
  >;
  readonly evaluator: LogicalDocumentRootEvaluator;
  readonly receipts: Map<bigint, FiniteRootRecord>;
  indexRanges: LogicalIndexRangeReadDependencyV1[];
  relationDependencies: LogicalApplicationRelationIncomingReadDependencyV1[];
  status: "open" | "aborted" | "freezing" | "frozen";
  inFlightOperations: number;
  lastSequence: bigint;
  nextCreationTime: AppCreationTimeV1;
  counters: SessionJournalCountersV1;
  participantWorkBytes: number;
  participantWorkCalls: number;
}

export interface FiniteRootAttemptState extends FiniteRootAttemptData {
  readonly metadata: FiniteAttemptMetadata;
  readonly reservation: CapturedFiniteMetadataReservation;
  readonly anchorCapture: CapturedFiniteAttemptAnchor;
}

/** Keep an inert exact-claim tombstone after abort or uncertain seal while
 * releasing provisional documents and receipts. Only a durable terminal or
 * fenced observation permits removing its strong registry entry. */
export function finiteApplicationCapture(
  finite: FiniteRootAttemptState,
  attempt: SessionJournalAttemptStateV1,
): LogicalFiniteStorageCapture<FiniteStorageCaptureError> {
  return (operation, demand) =>
    Effect.suspend(() =>
      finite.status !== "open"
        ? Effect.fail(
            new FiniteStorageCaptureError({ reason: "invalidAuthority" }),
          )
        : captureFiniteStorageEffect(
            finite.resolvedTarget.target,
            {
              selector: attempt.selector,
              preliminaryAuthority: finite.resolvedTarget.authority,
              executionClaim: attempt.executionClaim,
              finiteAnchor: finite.anchorCapture,
              finiteApplicationReadDemand: {
                metadata: finite.metadata,
                root: finite.handle,
                demand,
              },
            },
            operation,
          ),
    );
}

export function discardFiniteRootEvidence(
  finite: FiniteRootAttemptState,
): void {
  finite.evaluator.close();
  finite.admissions.clear();
  finite.receipts.clear();
  finite.writableTables.clear();
  finite.indexRanges.length = 0;
  finite.relationDependencies.length = 0;
}

/** The journal borrows the same authenticated pending owner as native views.
 * These values never escape a syscall: public/replay outcomes detach on return. */
export function finiteRootState(finite: FiniteRootAttemptState) {
  return attachLogicalDocumentRootEvaluator(finite.evaluator, {
    attempt: finite.handle,
    scopeId: finite.initialContext.anchor.scopeId,
    snapshotCommitSeq: finite.initialContext.anchor.snapshotToken.commitSeq,
    attemptFence: String(finite.initialContext.anchor.attemptFence),
  });
}

function projectFinitePoint(
  scopeId: ScopeId,
  evidence: LogicalDocumentPointEvidence,
  row: PendingDocument | undefined,
): JournalPointMutationV1 {
  const observation = projectLogicalPointExpectation(evidence);
  const { tableId, rowId } = observation;
  const observed = observation.dependency.observed;
  const identity = Object.freeze({ scopeId, tableId, rowId });
  const dependency: AppRowPointDependencyV1 =
    observed.kind === "present"
      ? Object.freeze({
          kind: "present",
          identity,
          revisionCommitSeq: observed.revisionCommitSeq,
        })
      : Object.freeze({ kind: "missing", identity, basis: observed.basis });
  const overlay: JournalPointOverlayV1 =
    (row?.attempts.length ?? 0) === 0
      ? Object.freeze({ kind: "none" })
      : row?.current == null
        ? Object.freeze({ kind: "deleted" })
        : Object.freeze({
            kind: "live",
            creationTime: row.creationTime,
            document: row.current,
          });
  return Object.freeze({ mode: "insert", tableId, rowId, dependency, overlay });
}

export function finitePoint(
  finite: FiniteRootAttemptState,
  tableId: CatalogTableId,
  rowId: AppRowIdHexV1,
): JournalPointMutationV1 | undefined {
  const root = finiteRootState(finite);
  if (root === null) return undefined;
  const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
  const observation = root.dependencies.get(documentId);
  return observation === undefined
    ? undefined
    : projectFinitePoint(
        root.pins.scopeId,
        observation,
        root.rows.get(documentId),
      );
}

export function readKnownFinitePoint(
  finite: FiniteRootAttemptState,
  tableId: CatalogTableId,
  rowId: AppRowIdHexV1,
): LogicalPointReadV1 | undefined {
  const root = finiteRootState(finite);
  if (root === null) return undefined;
  const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
  const observation = root.dependencies.get(documentId);
  if (observation === undefined) return undefined;
  const pending = root.rows.get(documentId);
  const staged = projectFinitePoint(root.pins.scopeId, observation, pending);
  const dependency = staged.dependency;
  return Object.freeze({
    dependencyIsNew: false,
    pointMutation: staged,
    result:
      pending?.current == null
        ? Object.freeze({ kind: "missing", document: null, dependency })
        : Object.freeze({
            kind: "present",
            document: pending.current,
            dependency,
          }),
  });
}

export function finitePoints(
  finite: FiniteRootAttemptState,
  tableId: CatalogTableId,
): readonly JournalPointMutationV1[] {
  const root = finiteRootState(finite);
  if (root === null) return [];
  const points: JournalPointMutationV1[] = [];
  for (const observation of root.dependencies.values())
    if (observation.tableId === tableId)
      points.push(
        projectFinitePoint(
          root.pins.scopeId,
          observation,
          root.rows.get(observation.documentId),
        ),
      );
  return points;
}

export function finitePointObservation(
  finite: FiniteRootAttemptState,
  point: JournalPointMutationV1,
) {
  const documentId = appDocumentIdV1FromRowIdentity(point);
  const observed =
    point.dependency.kind === "present"
      ? Object.freeze({
          kind: "present" as const,
          revisionCommitSeq: point.dependency.revisionCommitSeq,
        })
      : Object.freeze({
          kind: "missing" as const,
          basis: point.dependency.basis,
        });
  return Object.freeze({
    documentId,
    tableId: point.tableId,
    rowId: point.rowId,
    readAt: finite.initialContext.anchor.snapshotToken.commitSeq,
    dependency: Object.freeze({
      kind: "appRowPoint" as const,
      documentId,
      observed,
    }),
  });
}

const captureFiniteMetadataReservationForEntryEffect = Effect.fn(
  "SessionJournal.captureFiniteMetadataReservation",
)(function* (
  tx: AppRowTransaction,
  handle: SessionJournalAttempt,
  state: SessionJournalAttemptStateV1,
  context: FiniteEntryAttemptKernelContext,
  metadata: FiniteAttemptMetadata,
) {
  const selected = inspectFiniteAttemptMetadata(metadata, handle);
  if (
    selected?.application === null ||
    selected?.application === undefined ||
    selected.metadataWatermark !== context.scopeClock.lastMetadataSequence ||
    selected.owner.scopeId !== state.selector.scopeId ||
    selected.owner.sessionId !== state.selector.sessionId ||
    selected.owner.attemptFence !== state.selector.attemptFence ||
    selected.owner.snapshotCommitSeq !== state.snapshotToken.commitSeq ||
    selected.owner.schemaVersionId !== state.schemaVersionId
  )
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
    );
  const binding = selected.binding;
  if (
    binding !== undefined &&
    (binding.candidateSha256 === undefined ||
      binding.activationSha256 === undefined)
  )
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
    );
  const reservation = yield* captureFiniteMetadataReservation({
    ...state.selector,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: context.anchor.storageGenerationFence,
    snapshotToken: state.snapshotToken,
    schemaVersionId: state.schemaVersionId,
    metadataWatermark: selected.metadataWatermark,
    application: selected.application,
    binding:
      binding === undefined
        ? null
        : {
            sequence: binding.sequence,
            sha256: binding.sha256,
            candidateSha256: binding.candidateSha256!,
            activationSha256: binding.activationSha256!,
          },
  }).pipe(
    Effect.mapError(
      (cause) =>
        new LogicalParticipantAdmissionError({
          reason: "invalidAuthority",
          cause,
        }),
    ),
  );
  const updated = yield* captureFiniteAttemptReservationInTransaction(
    tx,
    state.selector,
    reservation,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new LogicalParticipantAdmissionError({
          reason: "invalidAuthority",
          cause,
        }),
    ),
  );
  const finalContext = Object.freeze({
    ...context,
    session: updated.context.session,
    finiteAttempt: updated.context,
  });
  return Object.freeze({
    reservation,
    anchorCapture: updated.anchor,
    context: finalContext,
  });
});

const recordFiniteExecutionMetadataEffect = Effect.fn(
  "SessionJournal.recordFiniteExecutionMetadata",
)(function* (
  handle: SessionJournalAttempt,
  attempt: SessionJournalAttemptStateV1,
  finite: FiniteRootAttemptState,
  context: FiniteEntryAttemptKernelContext,
) {
  const projection = getFiniteAttemptMetadataProjection(
    finite.metadata,
    handle,
  );
  const root = attachLogicalDocumentRootEvaluator(finite.evaluator, {
    attempt: handle,
    scopeId: attempt.selector.scopeId,
    snapshotCommitSeq: attempt.snapshotToken.commitSeq,
    attemptFence: String(attempt.selector.attemptFence),
    metadataWatermark: context.scopeClock.lastMetadataSequence,
  });
  if (projection === null || root === null)
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
    );
  for (const contractKey of [
    finiteMetadataContractKey("function", context.executionPin.functionPath),
    finiteMetadataContractKey("executionGroup", "legacy_dynamic_worker_v1"),
  ]) {
    const dependency = yield* Effect.fromResult(
      captureFiniteMetadataDependency(
        projection,
        { ...APPLICATION_EXECUTION_METADATA_OWNER, contractKey },
        context.scopeClock.lastMetadataSequence,
      ).pipe(
        Result.mapError(
          (cause) =>
            new LogicalParticipantAdmissionError({
              reason: "invalidAuthority",
              cause,
            }),
        ),
      ),
    );
    if (
      dependency.observed.kind !== "present" ||
      !recordLogicalDocumentRootMetadataDependency(root, dependency)
    )
      return yield* Effect.fail(
        new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
      );
  }
});

// Repeated demand bookkeeping belongs to its public journal operation. Keep
// exact dependency/failure order without a private diagnostic caller stack.
export const recordFiniteApplicationDemandMetadataEffect = Effect.fnUntraced(
  function* (
    attempt: SessionJournalAttemptStateV1,
    finite: FiniteRootAttemptState,
    tableId: CatalogTableId,
    write: boolean,
    indexDefinitionId?: CatalogIndexDefinitionId,
  ) {
    const projection = getFiniteAttemptMetadataProjection(
      finite.metadata,
      finite.handle,
    );
    const watermark = finite.initialContext.scopeClock.lastMetadataSequence;
    const root = attachLogicalDocumentRootEvaluator(finite.evaluator, {
      attempt: finite.handle,
      scopeId: attempt.selector.scopeId,
      snapshotCommitSeq: attempt.snapshotToken.commitSeq,
      attemptFence: String(attempt.selector.attemptFence),
      metadataWatermark: watermark,
    });
    if (projection === null || root === null)
      return yield* Effect.fail(corruption(attempt, "exactAttemptPinsChanged"));
    const keys = yield* Effect.fromResult(
      getFiniteApplicationDemandMetadataKeys(
        finite.metadata,
        finite.handle,
        tableId,
        write ? "write" : "read",
        indexDefinitionId,
      ).pipe(
        Result.mapError((cause) =>
          corruption(attempt, "requestTableCapabilityMismatch", cause),
        ),
      ),
    );
    for (const key of keys) {
      const dependency = yield* Effect.fromResult(
        captureFiniteMetadataDependency(projection, key, watermark).pipe(
          Result.mapError((cause) =>
            corruption(attempt, "exactAttemptPinsChanged", cause),
          ),
        ),
      );
      if (
        dependency.observed.kind !== "present" ||
        !recordLogicalDocumentRootMetadataDependency(root, dependency)
      )
        return yield* Effect.fail(
          corruption(attempt, "exactAttemptPinsChanged"),
        );
    }
  },
);

export const captureFiniteEntrySelections = (
  participants: Parameters<
    SessionJournalStorePersistence["prepareFiniteEntryEffect"]
  >[0],
) =>
  participants.map((participant) =>
    Object.freeze({
      participant: participant.participant,
      profileRevision: participant.profileRevision,
      operationMethods: Object.freeze([...participant.operationMethods]),
      sources: Object.freeze(
        participant.sources.map((source) =>
          Object.freeze({
            selection: source.selection,
            methods: Object.freeze([...source.methods]),
            bindAttemptEffect: source.selection.bindAttemptEffect.bind(
              source.selection,
            ),
          }),
        ),
      ),
    }),
  );

export const prepareFiniteRootInTransactionEffect = Effect.fnUntraced(
  function* (
    handle: SessionJournalAttempt,
    selections: ReturnType<typeof captureFiniteEntrySelections>,
    preparation: PreparedFiniteSessionJournalEntry,
    tx: Parameters<FiniteEntryRun>[0],
    context: Parameters<FiniteEntryRun>[1],
    resolved: Parameters<FiniteEntryRun>[2],
    application: Parameters<FiniteEntryRun>[3],
    binding: Parameters<FiniteEntryRun>[4],
    control: Parameters<FiniteEntryRun>[5],
    canonicalExecutionAuthority: Parameters<FiniteEntryRun>[6],
    verifyFinalRows: Parameters<FiniteEntryRun>[7],
    observation: Parameters<FiniteEntryRun>[8],
  ): Effect.fn.Return<FiniteEntryTransactionCapture, FiniteEntryFailure> {
    const state = yield* Effect.fromResult(
      captureAttemptStateResult({
        selector: context.anchor,
        snapshotToken: context.anchor.snapshotToken,
        schemaVersionId: context.executionPin.schemaVersionId,
        executionClaim: context.executionClaim,
        executionProfile: "finiteRoot",
      }),
    );
    if (
      !kernelContextMatchesAttempt(context, state) ||
      context.anchor.executionProfile !== "finiteRoot" ||
      context.session.lifecycle !== "running" ||
      context.finiteAttempt.reservation !== null
    )
      return yield* Effect.fail(corruption(state, "journalStateInvalid"));
    const admissions = new Map<
      string,
      Readonly<{
        selection: SessionJournalParticipantSelection;
        bundle: LogicalParticipantAdmissionBundle;
      }>
    >();
    const readTransaction = makeAttemptReadTransaction(state, resolved);
    let metadata: FiniteAttemptMetadata | undefined;
    for (const selection of selections) {
      const sources = [];
      for (const source of selection.sources) {
        const admission = yield* source.bindAttemptEffect(
          application,
          handle,
          {
            scopeId: state.selector.scopeId,
            sessionId: state.selector.sessionId,
            attemptFence: state.selector.attemptFence,
            principalDigest: context.principalDigest,
            executionProfile: state.executionProfile,
            snapshotCommitSeq: state.snapshotToken.commitSeq,
            schemaVersionId: state.schemaVersionId,
          },
          readTransaction,
          source.methods,
          {
            tx,
            authority: resolved.authority,
            clock: context.scopeClock,
            applicationBinding: { selection: source.selection, binding },
            finiteMetadata:
              metadata === undefined
                ? {
                    kind: "capture",
                    metadataWatermark: context.scopeClock.lastMetadataSequence,
                    borrowedApplicationBinding: binding,
                    ...(observation === undefined ? {} : { observation }),
                  }
                : { kind: "derive", metadata },
          },
        );
        const issued = inspectLogicalParticipantAttemptAdmission(
          admission,
          handle,
          source.methods[0]!,
        );
        if (
          issued?.metadata === undefined ||
          (metadata !== undefined && issued.metadata !== metadata)
        )
          return yield* Effect.fail(
            new LogicalParticipantAdmissionError({
              reason: "invalidAuthority",
            }),
          );
        metadata = issued.metadata;
        sources.push(Object.freeze({ admission, methods: source.methods }));
      }
      const acceptedSelection = Object.freeze({
        ...selection,
        sources: selection.sources.map((source) =>
          Object.freeze({ ...source, application }),
        ),
      });
      const bundle = yield* Effect.fromResult(
        issueLogicalParticipantAdmissionBundle(handle, {
          ...selection,
          sources,
        }),
      );
      admissions.set(
        selection.participant,
        Object.freeze({ selection: acceptedSelection, bundle }),
      );
    }
    metadata ??= yield* Effect.fromResult(
      captureFiniteApplicationAttemptMetadata(
        binding,
        application,
        handle,
        tx,
        context.scopeClock,
        resolved.authority,
        {
          scopeId: state.selector.scopeId,
          sessionId: state.selector.sessionId,
          attemptFence: state.selector.attemptFence,
          principalDigest: context.principalDigest,
          executionProfile: state.executionProfile,
          snapshotCommitSeq: state.snapshotToken.commitSeq,
          schemaVersionId: state.schemaVersionId,
        },
        context.scopeClock.lastMetadataSequence,
      ).pipe(
        Result.mapError(
          (cause) =>
            new LogicalParticipantAdmissionError({
              reason: "invalidAuthority",
              cause,
            }),
        ),
      ),
    );
    yield* verifyFinalRows;
    yield* prepareFiniteAttemptMetadataProjection(metadata, handle, tx).pipe(
      Effect.mapError(
        (cause) =>
          new LogicalParticipantAdmissionError({
            reason: "invalidAuthority",
            cause,
          }),
      ),
    );
    if (control === undefined)
      return yield* Effect.fail(
        new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
      );
    const schema = yield* Effect.fromResult(
      readPreparedFiniteSessionJournalEntrySchema(
        preparation,
        application,
        control,
      ),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new SessionJournalPersistenceV1Error({
            operation: "openAttempt",
            cause,
          }),
      ),
    );
    const applicationEvidence =
      yield* materializeFiniteApplicationExecutionEvidence(
        application,
        context.session,
        canonicalExecutionAuthority,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SessionJournalPersistenceV1Error({
              operation: "openAttempt",
              cause,
            }),
        ),
      );
    const metadataEntry = yield* captureFiniteMetadataReservationForEntryEffect(
      tx,
      handle,
      state,
      context,
      metadata,
    );
    const confirmedContext = metadataEntry.context;
    const finite: FiniteRootAttemptState = {
      handle,
      resolvedTarget: resolved,
      admissions,
      metadata,
      reservation: metadataEntry.reservation,
      anchorCapture: metadataEntry.anchorCapture,
      initialContext: confirmedContext,
      applicationSchema: schema.schemaManifest,
      writableTables: new Set(),
      evaluator: makeLogicalDocumentRootEvaluator(
        {
          attempt: handle,
          scopeId: state.selector.scopeId,
          snapshotCommitSeq: state.snapshotToken.commitSeq,
          attemptFence: String(state.selector.attemptFence),
          metadataWatermark: context.scopeClock.lastMetadataSequence,
        },
        {
          identities: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
          workingBytes: MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1,
        },
      ),
      receipts: new Map(),
      indexRanges: [],
      relationDependencies: [],
      status: "open",
      lastSequence: 0n,
      inFlightOperations: 0,
      counters: { ...ZERO_FINITE_COUNTERS },
      participantWorkBytes: 0,
      participantWorkCalls: 0,
      nextCreationTime: decodeAppCreationTimeV1(context.databaseNow.getTime()),
    };
    yield* recordFiniteExecutionMetadataEffect(
      handle,
      state,
      finite,
      confirmedContext,
    );
    const finiteKey = JSON.stringify([
      state.selector.deploymentId,
      state.selector.scopeId,
      state.selector.sessionId,
      String(state.selector.attemptFence),
      state.executionClaim.claimOwner,
      String(state.executionClaim.claimFence),
    ]);
    const issuedAdmissions = new Map(
      [...admissions].map(([key, value]) => [key, value.bundle]),
    );
    return Object.freeze({
      state,
      preliminaryAuthority: structuredClone(resolved.authority),
      context: confirmedContext,
      ...schema,
      applicationEvidence,
      canonicalExecutionAuthority,
      finite,
      finiteKey,
      issuedAdmissions,
      applicationSelection: application,
    });
  },
);

export function makeFiniteRootLifecycle(owner: JournalAttemptOwner) {
  const freezeFiniteRootEffect: SessionJournalStorePersistence["freezeFiniteRootEffect"] =
    Effect.fnUntraced(
      function* (attempt, successfulResult) {
        const attemptState =
          typeof attempt === "object" && attempt !== null
            ? owner.readAttempt(attempt)
            : undefined;
        if (attemptState === undefined)
          return yield* Effect.fail(
            new InvalidSessionJournalCapabilityV1Error({
              capability: "attempt",
            }),
          );
        const finite = owner.readFiniteRoot(attemptState);
        if (
          attemptState.executionProfile !== "finiteRoot" ||
          finite === undefined
        )
          return yield* Effect.fail(
            corruption(attemptState, "journalStateInvalid"),
          );
        const inFlightKey = `${attemptState.selector.scopeId}/${attemptState.selector.sessionId}/${attemptState.selector.attemptFence}`;
        if (
          finite.status !== "open" ||
          finite.inFlightOperations !== 0 ||
          owner.isAdmittedOperationInFlight(inFlightKey) ||
          finite.receipts.size !== Number(finite.lastSequence)
        ) {
          finite.status = "aborted";
          discardFiniteRootEvidence(finite);
          return yield* Effect.fail(
            new SessionJournalSealV1Error({ reason: "journalFailed" }),
          );
        }
        finite.status = "freezing";
        return yield* Effect.gen(function* () {
          const issuedResult =
            readIssuedCanonicalSuccessfulResultV1(successfulResult);
          const verifiedResult =
            issuedResult ??
            (yield* verifySuccessfulResultEvidenceV1Effect(
              successfulResult.evidence,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new SessionJournalSealV1Error({
                    reason: "canonicalResultMismatch",
                    cause,
                  }),
              ),
            ));
          if (
            issuedResult === undefined &&
            (!bytesEqual(
              verifiedResult.canonicalBytes,
              successfulResult.canonicalBytes,
            ) ||
              !jsonEqual(
                verifiedResult.valueJson,
                successfulResult.valueJson,
              ) ||
              verifiedResult.canonicalText !== successfulResult.canonicalText ||
              verifiedResult.semanticSizeBytes !==
                successfulResult.semanticSizeBytes)
          )
            return yield* Effect.fail(
              new SessionJournalSealV1Error({
                reason: "canonicalResultMismatch",
              }),
            );
          const closedRoot = yield* Effect.fromResult(
            takeLogicalDocumentRootSnapshot(finite.evaluator),
          ).pipe(
            Effect.mapError((cause) =>
              corruption(
                attemptState,
                "pointDependencyChangedAtSnapshot",
                cause,
              ),
            ),
          );
          const closed = borrowClosedLogicalDocumentRoot(
            closedRoot,
            finite.evaluator,
            attempt,
          );
          if (closed === undefined)
            return yield* Effect.fail(
              corruption(attemptState, "exactAttemptPinsChanged"),
            );
          const { graph } = closed;
          if (
            graph.setNull.length > 0 ||
            graph.referenceReplacements.length > 0
          )
            return yield* Effect.fail(
              new SessionJournalSealV1Error({ reason: "journalFailed" }),
            );
          const operations: FrozenFiniteOperation[] = [
            ...finite.receipts.entries(),
          ]
            .toSorted(([left], [right]) =>
              left < right ? -1 : left > right ? 1 : 0,
            )
            .map(([sequence, receipt]) =>
              receipt.kind === "admitted"
                ? Object.freeze({
                    kind: "participant" as const,
                    sequence,
                    admission: receipt.admission,
                    participant: receipt.request.participant,
                    method: receipt.request.method,
                    profileRevision: receipt.request.profileRevision,
                    sourceRefs: receipt.request.sources,
                    attemptStart: receipt.attemptStart,
                    attemptEnd: receipt.attemptEnd,
                    result: receipt.completed.result,
                    eventIntents: receipt.completed.eventIntents,
                    workBytes: receipt.completed.workBytes,
                    workCalls: receipt.completed.workCalls,
                  })
                : Object.freeze({
                    kind: receipt.kind,
                    sequence,
                    request: receipt.requestEvidence.valueJson,
                    outcome: receipt.outcomeEvidence.valueJson,
                    ...(receipt.kind === "point" &&
                    receipt.plan.write !== undefined
                      ? { write: receipt.plan.write }
                      : {}),
                  }),
            );
          const applicationMetadataProjection =
            getFiniteApplicationWriteMetadataProjection(
              finite.metadata,
              attempt,
            );
          if (applicationMetadataProjection === null)
            return yield* Effect.fail(
              corruption(attemptState, "exactAttemptPinsChanged"),
            );
          const applicationPublicationDefinitions = yield* Effect.fromResult(
            getFiniteApplicationPublicationDefinitions(
              finite.metadata,
              attempt,
            ),
          ).pipe(
            Effect.mapError(
              (cause) =>
                new SessionJournalPersistenceV1Error({
                  operation: "prepareSealSnapshot",
                  cause,
                }),
            ),
          );
          const candidatePlanningHead = finite.candidatePlanningHead;
          const originalEntry = finite.originalEntry;
          if (
            candidatePlanningHead === undefined ||
            originalEntry === undefined
          )
            return yield* Effect.fail(
              corruption(attemptState, "exactAttemptPinsChanged"),
            );
          // Receipts, pins and captured dependencies already belong to this closed
          // finite root. Registry ingress detaches them once; no exposed return or
          // caller input shares those retained values.
          const frozen = issueFrozenFiniteAttempt(
            closedRoot,
            finite.evaluator,
            {
              attempt,
              originalEntry,
              resolvedTarget: finite.resolvedTarget,
              applicationMetadataProjection,
              applicationPublicationDefinitions,
              candidatePlanningHead,
              anchorCapture: finite.anchorCapture,
              attemptState,
              successfulResult: verifiedResult,
              operations,
              dependencies: Object.freeze([
                ...graph.dependencies.flatMap((observation) =>
                  observation.dependency.kind === "appRowPoint"
                    ? [observation.dependency]
                    : [],
                ),
                ...finite.indexRanges,
                ...finite.relationDependencies,
                ...(graph.metadataDependencies ?? []),
              ]),
              applicationIndexRanges: finite.indexRanges,
              applicationRelationDependencies: finite.relationDependencies,
              metadataReservation: finite.reservation,
            },
          );
          if (frozen === undefined)
            return yield* Effect.fail(
              corruption(attemptState, "exactAttemptPinsChanged"),
            );
          finite.status = "frozen";
          discardFiniteRootEvidence(finite);
          return frozen;
        }).pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              finite.status = "aborted";
              discardFiniteRootEvidence(finite);
            }),
          ),
        );
      },
      (work) => observeExecution("SessionJournalStore.freezeFiniteRoot", work),
    );

  const discardFiniteRootEffect: SessionJournalStorePersistence["discardFiniteRootEffect"] =
    Effect.fnUntraced(
      function* (attempt) {
        const state =
          typeof attempt === "object" && attempt !== null
            ? owner.readAttempt(attempt)
            : undefined;
        const finite =
          state === undefined ? undefined : owner.readFiniteRoot(state);
        if (state?.executionProfile !== "finiteRoot" || finite === undefined) {
          return yield* Effect.fail(
            new InvalidSessionJournalCapabilityV1Error({
              capability: "attempt",
            }),
          );
        }
        finite.status = "aborted";
        discardFiniteRootEvidence(finite);
      },
      (work) => observeExecution("SessionJournalStore.discardFiniteRoot", work),
    );
  return Object.freeze({ freezeFiniteRootEffect, discardFiniteRootEffect });
}
