export {
  captureGraphAuthorityObservation,
  captureGraphCommittedPayload,
  captureGraphEdgeDependencyKey,
  captureGraphNodeDependencyKey,
  captureKeyValueAuthorityObservation,
  captureKeyValueChangeDependencyKey,
  captureKeyValueCommittedPayload,
  makeGraphInvalidationProjector,
  makeKeyValueInvalidationProjector,
  makeReferenceReplayableChangeSource,
  ReferenceChangeSourceAppendError,
  ReferenceChangeSourceConstructionError,
} from "./ReferenceChangeSource.js";

export type {
  GraphAuthorityObservation,
  GraphCommittedEdgeChange,
  GraphCommittedPayload,
  KeyValueAuthorityObservation,
  KeyValueCommittedChange,
  KeyValueCommittedPayload,
  ReferenceChangeSourceCapture,
  ReferenceChangeSourceSnapshot,
  ReferenceCommittedBatchInput,
  ReferenceReplayableChangeSource,
} from "./ReferenceChangeSource.js";

export { makeReferenceQueryEvaluator } from "./ReferenceQueryEvaluator.js";

export type {
  MakeReferenceQueryEvaluator,
  ReferenceQueryEvaluator,
  ReferenceQueryEvaluatorCall,
  ReferenceQueryEvaluatorStep,
} from "./ReferenceQueryEvaluator.js";

export {
  makeReferenceResultPublisherHarness,
  ReferenceResultDestinationInvariantDefect,
} from "./ReferenceResultPublisher.js";

export type {
  ReferenceResultDestination,
  ReferenceResultDestinationAcceptance,
  ReferenceResultDestinationAccess,
  ReferenceResultDestinationInvariantReason,
  ReferenceResultDestinationSnapshot,
  ReferenceResultPublisher,
  ReferenceResultPublisherCall,
  ReferenceResultPublisherHarness,
  ReferenceResultPublisherStep,
} from "./ReferenceResultPublisher.js";

export {
  makeReferenceQuerySyncStateHarness,
  ReferenceStateSnapshotBindingError,
} from "./ReferenceStateStore.js";

export {
  makeAcceptedQueryPublicationEvidenceForTesting,
} from "../../kernel/PublicationWork.js";

export {
  makeQueryEvaluationAttempt as makeQueryEvaluationAttemptForTesting,
} from "../../kernel/Model.js";

export type {
  ReferenceQuerySyncStateHarness,
  ReferenceQuerySyncTransitionState,
  ReferenceStateBinding,
  ReferenceStateFault,
} from "./ReferenceStateStore.js";

export { runStateConformanceCommands } from "./StateConformance.js";

export type {
  QuerySyncStateConformanceTarget,
  StateConformanceBinding,
  StateConformanceCommand,
  StateConformanceError,
  StateConformanceReceipt,
  StateConformanceRun,
  StateConformanceStep,
} from "./StateConformance.js";
