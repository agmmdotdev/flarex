import type { PreparedFiniteMetadataProjection } from "./finiteMetadataDependencies";
import type { CapturedFiniteAttemptAnchor } from "./finiteAttemptAnchor";
import type { AdmittedSourceBinding, CanonicalSuccessfulResultV1, LogicalAppWriteV1,
  LogicalReadDependencyV1, LogicalIndexRangeReadDependencyV1,
  LogicalApplicationRelationIncomingReadDependencyV1 } from "flarex-protocol/commit-protocol";
import type { Json } from "flarex-protocol/json";
import type { LogicalParticipantAdmissionBundle } from "./logicalDocuments/participantAdmission";
import type { LogicalDocumentChanges } from "./logicalDocuments/workingSet";
import { detachLogicalDocumentChanges } from "./logicalDocuments/detachChanges";
import type { PointCommitRowIntentV1 } from "./applicationDocumentMaterialization/model";
import type { CapturedFiniteMetadataReservation } from "./finiteMetadataReservation";
import type { SessionJournalAttempt, SessionJournalAttemptStateV1, ResolvedJournalTargetV1 } from "./sessionJournalStore";
import type { AppSchemaCandidateWriteGuardPlanningHead } from "./appSchemaCandidateValidation";
import type { getFiniteApplicationPublicationDefinitions } from "./logicalDocuments/sourceAdmission";
import type { Result } from "effect";
import type { OriginalFiniteExecutionEntry } from "./sessionJournalFiniteEntry";
import type { LiveAppRowRevisionV1 } from "./appRows";

const frozenFiniteAttemptBrand: unique symbol = Symbol("Flarex/FrozenFiniteAttempt");
export interface FrozenFiniteAttempt { readonly [frozenFiniteAttemptBrand]: true }

export type FrozenFiniteOperation = Readonly<{
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

const frozenAttempts = new WeakMap<FrozenFiniteAttempt, FrozenFiniteAttemptData>();

/** Exact replay routing needs only issued origin identity. It must not clone or
 * validate the provisional graph before observing a possibly committed outcome. */
export function readFrozenFiniteAttemptOrigin(handle: FrozenFiniteAttempt) {
  const data = typeof handle === "object" && handle !== null ? frozenAttempts.get(handle) : undefined;
  return data === undefined ? undefined : Object.freeze({ resolvedTarget: data.resolvedTarget,
    originalEntry: data.originalEntry,
    selector: Object.freeze({ ...data.attemptState.selector }) });
}

/** Package-internal issuance after the exact local root is irrevocably frozen. */
export function issueFrozenFiniteAttempt(data: FrozenFiniteAttemptData): FrozenFiniteAttempt {
  const handle = Object.freeze({ [frozenFiniteAttemptBrand]: true as const });
  frozenAttempts.set(handle, detachFrozenFiniteAttemptData(data));
  return handle;
}

/** Only the publication owner borrows this evidence. It performs full foreign
 * canonical acceptance before materialization and never exposes these bytes.
 * Public/validator projections below always detach from registry ownership. */
export function readOwnedFrozenFiniteAttempt(handle: FrozenFiniteAttempt): FrozenFiniteAttemptData | undefined {
  return typeof handle === "object" && handle !== null ? frozenAttempts.get(handle) : undefined;
}

/** The pre-settlement value validator needs no graph, receipts or target
 * reconstruction. Its exact canonical bytes still detach from the issuer. */
export function readFrozenFiniteCommitValues(handle: FrozenFiniteAttempt):
  Pick<FrozenFiniteAttemptData, "rowIntents" | "successfulResult"> | undefined {
  const data = typeof handle === "object" && handle !== null ? frozenAttempts.get(handle) : undefined;
  return data === undefined ? undefined : Object.freeze(structuredClone({
    rowIntents: data.rowIntents, successfulResult: data.successfulResult,
  }));
}

/** Capability lookup plus detachment protects private mutable canonical bytes.
 * Issued admission/reservation handles retain identity across the boundary. */
export function readFrozenFiniteAttempt(handle: FrozenFiniteAttempt): FrozenFiniteAttemptData | undefined {
  const data = typeof handle === "object" && handle !== null ? frozenAttempts.get(handle) : undefined;
  if (data === undefined) return undefined;
  return detachFrozenFiniteAttemptData(data);
}

function detachFrozenFiniteAttemptData(data: FrozenFiniteAttemptData): FrozenFiniteAttemptData {
  const { attempt, originalEntry, resolvedTarget, applicationMetadataProjection, applicationPublicationDefinitions, candidatePlanningHead, anchorCapture, metadataReservation, operations, graph, ...values } = data;
  return Object.freeze({ ...structuredClone(values), graph: detachLogicalDocumentChanges(graph), attempt, originalEntry, resolvedTarget, applicationMetadataProjection,
    applicationPublicationDefinitions, candidatePlanningHead, anchorCapture,
    ...(metadataReservation === undefined ? {} : { metadataReservation }),
    operations: Object.freeze(operations.map(operation => operation.kind === "participant"
      ? Object.freeze({ ...structuredClone({ ...operation, admission: undefined }), admission: operation.admission })
      : structuredClone(operation))) });
}
