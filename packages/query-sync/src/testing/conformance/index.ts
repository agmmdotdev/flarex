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

export {
  makeReferenceQuerySyncStateHarness,
  ReferenceStateSnapshotBindingError,
} from "./ReferenceStateStore.js";

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
