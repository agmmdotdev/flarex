import type { PreparedFiniteMetadataProjection } from "../finiteMetadataDependencies";
import type { CapturedFiniteAttemptAnchor } from "../finiteAttemptAnchor";
import type { AdmittedSourceBinding, CanonicalSuccessfulResultV1, LogicalAppWriteV1,
  LogicalReadDependencyV1, LogicalIndexRangeReadDependencyV1,
  LogicalApplicationRelationIncomingReadDependencyV1 } from "flarex-protocol/commit-protocol";
import type { Json } from "flarex-protocol/json";
import type {
  LogicalParticipantAdmissionBundle,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import type { LogicalDocumentChanges } from "../../storage/documents/logicalDocuments/workingSet";
import { detachLogicalDocumentChanges } from "../../storage/documents/logicalDocuments/detachChanges";
import type {
  PointCommitRowIntentV1,
  PreparedPointCommitRowIntentV1,
} from "../../storage/materialization/model";
import type { CapturedFiniteMetadataReservation } from "../finiteMetadataReservation";
import type { SessionJournalAttempt } from "./contracts";
import type { SessionJournalAttemptStateV1, ResolvedJournalTargetV1 } from "./state";
import type {
  AppSchemaCandidateWriteGuardPlanningHead,
} from "../../storage/catalog/appSchemaCandidateValidation";
import type {
  getFiniteApplicationPublicationDefinitions,
} from "../../storage/documents/logicalDocuments/sourceAdmission";
import type { Result } from "effect";
import type { OriginalFiniteExecutionEntry } from "./finiteEntry";
import type { LiveAppRowRevisionV1 } from "../../storage/documents/appRows";
import { readIssuedCanonicalSuccessfulResultV1 } from "flarex-protocol/commit-protocol";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";
import { createOwnedCanonicalFlarexRuntimeValueReaderV1 } from "flarex-protocol/internal/value-runtime-core";

const frozenFiniteAttemptBrand: unique symbol = Symbol("Flarex/FrozenFiniteAttempt");
export interface FrozenFiniteAttempt { readonly [frozenFiniteAttemptBrand]: true }

export type FrozenFiniteOperation = Readonly<{
  payloadPreferenceCleanups?: readonly import("../../frameworks/payloadPreferences/cleanup").PayloadPreferenceDeletionIntent[];
  kind: "participant";
  sequence: bigint;
  admission: LogicalParticipantAdmissionBundle;
  participant: string;
  method: string;
  profileRevision: string;
  sourceRefs: readonly AdmittedSourceBinding[];
  attemptStart: number;
  attemptEnd: number;
  result: Json;
  eventIntents: readonly Readonly<{ sourceKey: string | null; intent: Json }>[];
  workBytes: number;
  workCalls: number;
}> | Readonly<{
  kind: "point" | "index" | "relation";
  sequence: bigint;
  request: Json;
  outcome: Json;
  write?: LogicalAppWriteV1;
}>;

export interface FrozenFiniteAttemptData {
  readonly attempt: SessionJournalAttempt;
  readonly originalEntry: OriginalFiniteExecutionEntry;
  readonly resolvedTarget: ResolvedJournalTargetV1;
  readonly applicationMetadataProjection: PreparedFiniteMetadataProjection;
  readonly applicationPublicationDefinitions: Result.Result.Success<ReturnType<typeof getFiniteApplicationPublicationDefinitions>>;
  readonly candidatePlanningHead: AppSchemaCandidateWriteGuardPlanningHead;
  readonly anchorCapture: CapturedFiniteAttemptAnchor;
  readonly attemptState: SessionJournalAttemptStateV1;
  readonly graph: LogicalDocumentChanges;
  readonly originalRows: readonly LiveAppRowRevisionV1[];
  readonly successfulResult: CanonicalSuccessfulResultV1;
  readonly rowIntents: readonly PointCommitRowIntentV1[];
  readonly dependencies: readonly LogicalReadDependencyV1[];
  readonly applicationIndexRanges: readonly LogicalIndexRangeReadDependencyV1[];
  readonly applicationRelationDependencies: readonly LogicalApplicationRelationIncomingReadDependencyV1[];
  readonly operations: readonly FrozenFiniteOperation[];
  readonly metadataReservation?: CapturedFiniteMetadataReservation;
}

export type OwnedFrozenFiniteAttemptData = Omit<FrozenFiniteAttemptData, "rowIntents"> &
  Readonly<{ rowIntents: readonly PreparedPointCommitRowIntentV1[];
    successfulResultValue: CanonicalFlarexRuntimeValueV1;
    commitValidationValues: FrozenFiniteCommitValidationValues }>;
const frozenAttempts = new WeakMap<FrozenFiniteAttempt, OwnedFrozenFiniteAttemptData>();

/** Source-internal handoff from freezeClosedRoot only; omitted from the consumer API. */
export function registerOwnedFrozenFiniteAttempt(
  data: Omit<OwnedFrozenFiniteAttemptData, "successfulResultValue" | "commitValidationValues">,
): FrozenFiniteAttempt {
  const issuedResult = readIssuedCanonicalSuccessfulResultV1(data.successfulResult);
  if (issuedResult === undefined) throw new Error("Frozen finite result must have canonical issuer provenance");
  const commitValidationValues: FrozenFiniteCommitValidationValues = Object.freeze({
    rowIntents: Object.freeze(data.rowIntents.map(row => {
      if (row.kind === "deleted") return Object.freeze({ kind: "deleted" as const,
        documentId: row.documentId, tableId: row.tableId });
      let readRuntimeValue: (() => CanonicalFlarexRuntimeValueV1) | undefined;
      return Object.freeze({ kind: "live" as const, documentId: row.documentId,
        tableId: row.tableId, creationTime: row.creationTime,
        get value(): CanonicalFlarexRuntimeValueV1 {
          // Shape capture above never reads the body. The executor selects the
          // Application table and kind before this first runtime loan.
          readRuntimeValue ??= createOwnedCanonicalFlarexRuntimeValueReaderV1(row.document.value);
          return readRuntimeValue();
        },
      });
    })),
    successfulResult: Object.freeze({
      get value(): CanonicalFlarexRuntimeValueV1 { return issuedResult.value; },
    }),
  });
  const handle = Object.freeze({ [frozenFiniteAttemptBrand]: true as const });
  frozenAttempts.set(handle, Object.freeze({ ...data, commitValidationValues,
    // Publication reads this projection only after accepting the exact origin,
    // authority/session/snapshot and claim. Inspection never evaluates it.
    get successfulResultValue(): CanonicalFlarexRuntimeValueV1 { return issuedResult.value; },
  }));
  return handle;
}


/** Exact replay routing needs only issued origin identity. It must not clone or
 * validate the provisional graph before observing a possibly committed outcome. */
export function readFrozenFiniteAttemptOrigin(handle: FrozenFiniteAttempt) {
  const data = typeof handle === "object" && handle !== null ? frozenAttempts.get(handle) : undefined;
  return data === undefined ? undefined : Object.freeze({ resolvedTarget: data.resolvedTarget,
    originalEntry: data.originalEntry,
    selector: Object.freeze({ ...data.attemptState.selector }) });
}

/** Only the publication owner borrows this evidence. It performs complete
 * origin and dependency acceptance before materialization and never exposes these bytes.
 * Public/validator projections below always detach from registry ownership. */
export function readOwnedFrozenFiniteAttempt(handle: FrozenFiniteAttempt): OwnedFrozenFiniteAttemptData | undefined {
  return typeof handle === "object" && handle !== null ? frozenAttempts.get(handle) : undefined;
}

/** Trusted executor validation borrows the already closed root values. This
 * projection never escapes into a business callback; public projections below
 * retain detachment. It conveys no additional publication authority. */
export interface FrozenFiniteCommitValidationValues {
  readonly rowIntents: readonly (Readonly<{ kind: "deleted"; documentId: PointCommitRowIntentV1["documentId"]; tableId: PointCommitRowIntentV1["tableId"] }> |
    Readonly<{ kind: "live"; documentId: PointCommitRowIntentV1["documentId"]; tableId: PointCommitRowIntentV1["tableId"];
      creationTime: Extract<PointCommitRowIntentV1, { kind: "live" }>["creationTime"];
      value: CanonicalFlarexRuntimeValueV1 }>)[];
  readonly successfulResult: Readonly<{ value: CanonicalFlarexRuntimeValueV1 }>;
}

export function borrowFrozenFiniteCommitValues(handle: FrozenFiniteAttempt): FrozenFiniteCommitValidationValues | undefined {
  const data = typeof handle === "object" && handle !== null ? frozenAttempts.get(handle) : undefined;
  return data?.commitValidationValues;
}

/** The pre-settlement value validator needs no graph, receipts or target
 * reconstruction. Its exact canonical bytes still detach from the issuer. */
export function readFrozenFiniteCommitValues(handle: FrozenFiniteAttempt):
  Readonly<{ rowIntents: readonly PointCommitRowIntentV1[]; successfulResult: CanonicalSuccessfulResultV1 }> | undefined {
  const data = typeof handle === "object" && handle !== null ? frozenAttempts.get(handle) : undefined;
  return data === undefined ? undefined : Object.freeze(structuredClone({
    rowIntents: projectRawRowIntents(data.rowIntents), successfulResult: data.successfulResult,
  }));
}

/** Capability lookup plus detachment protects private mutable canonical bytes.
 * Issued admission/reservation handles retain identity across the boundary. */
export function readFrozenFiniteAttempt(handle: FrozenFiniteAttempt): FrozenFiniteAttemptData | undefined {
  const data = typeof handle === "object" && handle !== null ? frozenAttempts.get(handle) : undefined;
  if (data === undefined) return undefined;
  return detachFrozenFiniteAttemptData(data);
}

function detachFrozenFiniteAttemptData(data: OwnedFrozenFiniteAttemptData): FrozenFiniteAttemptData {
  const { attempt, originalEntry, resolvedTarget, applicationMetadataProjection, applicationPublicationDefinitions, candidatePlanningHead, anchorCapture, metadataReservation, operations, graph, rowIntents } = data;
  // Project public fields explicitly: rest destructuring would evaluate the
  // private runtime getter and copy a value that inspection does not need.
  const values = { attemptState: data.attemptState, successfulResult: data.successfulResult,
    dependencies: data.dependencies, originalRows: data.originalRows,
    applicationIndexRanges: data.applicationIndexRanges,
    applicationRelationDependencies: data.applicationRelationDependencies };
  return Object.freeze({ ...structuredClone({ ...values, rowIntents: projectRawRowIntents(rowIntents) }), graph: detachLogicalDocumentChanges(graph), attempt, originalEntry, resolvedTarget, applicationMetadataProjection,
    applicationPublicationDefinitions, candidatePlanningHead, anchorCapture,
    ...(metadataReservation === undefined ? {} : { metadataReservation }),
    operations: detachOperations(operations) });
}

function projectRawRowIntents(rows: readonly PreparedPointCommitRowIntentV1[]): readonly PointCommitRowIntentV1[] {
  return rows.map(row => row.kind === "deleted" ? row : {
    documentId: row.documentId, tableId: row.tableId, rowId: row.rowId, dependency: row.dependency, kind: "live" as const,
    creationTime: row.creationTime, value: row.document.value, canonicalBytes: row.document.canonicalBytes,
    semanticSizeBytes: row.document.semanticSizeBytes });
}

function detachOperations(operations: readonly FrozenFiniteOperation[]): readonly FrozenFiniteOperation[] {
  return Object.freeze(operations.map(operation => operation.kind === "participant"
      ? Object.freeze({ ...structuredClone({ ...operation, admission: undefined }), admission: operation.admission })
      : structuredClone(operation)));
}
