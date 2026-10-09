import { freezeOwnedProtocolProjection } from "flarex-protocol/internal/owned-protocol-projection";
import { projectLogicalPointExpectation } from "../../storage/documents/logicalDocuments/pointEvidence";
import type { PreparedPointCommitRowIntentV1 } from "../../storage/materialization/model";
import { borrowClosedLogicalDocumentRoot, consumeClosedLogicalDocumentRoot, type ClosedLogicalDocumentRoot,
  type LogicalDocumentRootEvaluator } from "../../storage/documents/logicalDocuments/rootEvaluator";
import {
  registerOwnedFrozenFiniteAttempt,
  type FrozenFiniteAttempt,
  type FrozenFiniteAttemptData,
} from "./frozenAttempt";

/** Adopt only the selected, closed root. Complete codec values stay with their
 * owned graph; no parallel raw intent can be promoted as canonical evidence. */
export function issueFrozenFiniteAttempt(root: ClosedLogicalDocumentRoot, evaluator: LogicalDocumentRootEvaluator,
  input: Omit<FrozenFiniteAttemptData, "graph" | "originalRows" | "rowIntents">): FrozenFiniteAttempt | undefined {
  const closed = borrowClosedLogicalDocumentRoot(root, evaluator, input.attempt);
  if (closed === undefined || closed.pins.scopeId !== input.attemptState.selector.scopeId ||
    closed.pins.snapshotCommitSeq !== input.attemptState.snapshotToken.commitSeq ||
    closed.pins.attemptFence !== String(input.attemptState.selector.attemptFence)) return undefined;
  const { attempt, originalEntry, resolvedTarget, applicationMetadataProjection, applicationPublicationDefinitions,
    candidatePlanningHead, anchorCapture, metadataReservation, operations, ...values } = input;
  // Canonical final changes already satisfy materialization intents. Preserve
  // their exact dependency/document identities through the trusted handoff.
  const rowIntents: readonly PreparedPointCommitRowIntentV1[] = closed.graph.changes.map(change => {
    // Closing detached this projection from the working set. Restore immutable
    // JSON ownership once, before the trusted validator borrows any values.
    if (change.kind === "live") freezeOwnedProtocolProjection(change.document.valueJson);
    return { ...change, ...projectLogicalPointExpectation(change) };
  });
  const handle = registerOwnedFrozenFiniteAttempt(Object.freeze({ ...values, attemptState: structuredClone(values.attemptState),
    dependencies: Object.freeze([...values.dependencies]),
    applicationIndexRanges: Object.freeze([...values.applicationIndexRanges]),
    applicationRelationDependencies: Object.freeze([...values.applicationRelationDependencies]),
    graph: closed.graph, originalRows: closed.originalRows,
    rowIntents, attempt, originalEntry, resolvedTarget, applicationMetadataProjection, applicationPublicationDefinitions,
    candidatePlanningHead, anchorCapture, ...(metadataReservation === undefined ? {} : { metadataReservation }),
    operations: Object.freeze([...operations]) }));
  consumeClosedLogicalDocumentRoot(root, evaluator, input.attempt);
  return handle;
}
