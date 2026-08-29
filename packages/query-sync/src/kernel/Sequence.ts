import { Result } from "effect";

import { successorSyncSequence } from "./CanonicalValue.js";
import type {
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "./CanonicalValue.js";
import type {
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
} from "./Errors.js";
import type { NamespaceCursor, SequenceDecision } from "./Model.js";
import { modelMismatch, namespaceMismatch } from "./Authority.js";

export type SequenceClassificationOperation =
  | "classifySequence"
  | "applyAdmittedInvalidations";

function freezeSequenceDecision(
  decision: SequenceDecision,
): SequenceDecision {
  return Object.freeze(decision);
}

export function classifySequenceForOperation<
  Operation extends SequenceClassificationOperation,
>(
  operation: Operation,
  cursor: NamespaceCursor,
  position: {
    readonly namespaceId: SyncNamespaceId;
    readonly syncModelId: SyncModelId;
    readonly sourceEpoch: SyncEpoch;
    readonly sourceSequence: SyncSequence;
  },
): Result.Result<
  SequenceDecision,
  | QuerySyncNamespaceMismatchError<Operation>
  | QuerySyncModelMismatchError<Operation>
> {
  if (position.namespaceId !== cursor.namespaceId) {
    return Result.fail(namespaceMismatch(
      operation,
      cursor,
      position.namespaceId,
    ));
  }
  if (position.syncModelId !== cursor.syncModelId) {
    return Result.fail(modelMismatch(
      operation,
      cursor,
      position.syncModelId,
    ));
  }
  if (position.sourceEpoch !== cursor.sourceEpoch) {
    return Result.succeed(freezeSequenceDecision({
      _tag: "resetRequired",
      expectedSourceEpoch: cursor.sourceEpoch,
      observedSourceEpoch: position.sourceEpoch,
    }));
  }
  if (position.sourceSequence <= cursor.appliedThroughSequence) {
    return Result.succeed(freezeSequenceDecision({
      _tag: "duplicate",
      observedSequence: position.sourceSequence,
    }));
  }
  const expectedSequence = successorSyncSequence(
    cursor.appliedThroughSequence,
  );
  if (expectedSequence === null) {
    return Result.succeed(freezeSequenceDecision({
      _tag: "duplicate",
      observedSequence: position.sourceSequence,
    }));
  }
  if (position.sourceSequence === expectedSequence) {
    return Result.succeed(freezeSequenceDecision({
      _tag: "exactNext",
      nextSequence: expectedSequence,
    }));
  }
  return Result.succeed(freezeSequenceDecision({
    _tag: "gap",
    expectedSequence,
    observedSequence: position.sourceSequence,
  }));
}
