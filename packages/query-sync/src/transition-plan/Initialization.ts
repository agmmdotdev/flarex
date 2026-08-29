import { Result } from "effect";

import { initialQuerySyncWorkRevision } from "../kernel/CanonicalValue.js";
import type {
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
} from "../kernel/CanonicalValue.js";
import type { NamespaceCursor } from "../kernel/Model.js";
import {
  calculateQuerySyncStateMetrics,
} from "./Accounting.js";
import { QuerySyncInitializationPolicyError } from "./Errors.js";
import {
  freezeScopeFacts,
} from "./Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionPlan,
} from "./Model.js";
import {
  epochReplacedReceipt,
  initializedNamespaceReceipt,
  modelReplacedReceipt,
} from "./Receipts.js";
import type { InitializeNamespaceReceipt } from "./Receipts.js";

export interface InitializeNamespaceBinding {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
}

export type InitializeNamespacePresence =
  | Readonly<{ readonly _tag: "authorizedFreshAbsence" }>
  | Readonly<{ readonly _tag: "previouslyInitializedAbsence" }>
  | Readonly<{
    readonly _tag: "present";
    readonly scope: QuerySyncScopeFacts;
  }>;

export type InitializeNamespaceExpectation = InitializeNamespacePresence;

export type InitializeNamespaceChange = Readonly<{
  readonly _tag: "initializeNamespace";
  readonly durableInitializedHistory: true;
}>;

export type InitializeNamespacePlan = TransitionPlan<
  InitializeNamespaceReceipt,
  InitializeNamespaceExpectation,
  InitializeNamespaceChange
>;

function policyError(
  reason: QuerySyncInitializationPolicyError["reason"],
): QuerySyncInitializationPolicyError {
  return new QuerySyncInitializationPolicyError({
    operation: "initializeOrInspectNamespace",
    reason,
  });
}

function bootstrapMatchesBinding(
  binding: InitializeNamespaceBinding,
  bootstrapCursor: NamespaceCursor,
): boolean {
  return bootstrapCursor.namespaceId === binding.namespaceId
    && bootstrapCursor.syncModelId === binding.syncModelId
    && bootstrapCursor.sourceEpoch === binding.sourceEpoch;
}

function makeEmptyScope(
  cursor: NamespaceCursor,
): QuerySyncScopeFacts {
  const evaluationWork = Object.freeze({
    revision: initialQuerySyncWorkRevision(),
    fairnessAnchor: null,
  });
  const publicationWork = Object.freeze({
    pending: Object.freeze([]),
    inFlight: null,
    latestDelivered: null,
    precedingAttemptOutcome: null,
  });
  return freezeScopeFacts({
    cursor,
    evaluationWork,
    metrics: calculateQuerySyncStateMetrics({
      cursor,
      queries: [],
      evaluationWork,
      publicationWork,
    }),
  });
}

export function planInitializeOrInspectNamespace(input: {
  readonly binding: InitializeNamespaceBinding;
  readonly bootstrapCursor: NamespaceCursor;
  readonly presence: InitializeNamespacePresence;
}): Result.Result<
  InitializeNamespacePlan,
  QuerySyncInitializationPolicyError
> {
  if (!bootstrapMatchesBinding(input.binding, input.bootstrapCursor)) {
    return Result.fail(policyError("bootstrapBindingMismatch"));
  }
  if (input.presence._tag === "previouslyInitializedAbsence") {
    return Result.fail(policyError("aggregateMissing"));
  }
  if (input.presence._tag === "authorizedFreshAbsence") {
    const nextScope = makeEmptyScope(input.bootstrapCursor);
    return Result.succeed(Object.freeze({
      _tag: "write",
      receipt: initializedNamespaceReceipt(
        "initialized",
        nextScope.cursor,
        nextScope.metrics,
      ),
      expected: Object.freeze({ _tag: "authorizedFreshAbsence" }),
      nextScope,
      change: Object.freeze({
        _tag: "initializeNamespace",
        durableInitializedHistory: true,
      }),
    }));
  }
  const scope = freezeScopeFacts(input.presence.scope);
  if (scope.cursor.namespaceId !== input.binding.namespaceId) {
    return Result.fail(policyError("namespaceBindingMismatch"));
  }
  if (scope.cursor.syncModelId !== input.binding.syncModelId) {
    return Result.succeed(Object.freeze({
      _tag: "noWrite",
      receipt: modelReplacedReceipt(
        scope.cursor,
        input.binding.syncModelId,
      ),
    }));
  }
  if (scope.cursor.sourceEpoch !== input.binding.sourceEpoch) {
    return Result.succeed(Object.freeze({
      _tag: "noWrite",
      receipt: epochReplacedReceipt(
        scope.cursor,
        input.binding.sourceEpoch,
      ),
    }));
  }
  return Result.succeed(Object.freeze({
    _tag: "noWrite",
    receipt: initializedNamespaceReceipt(
      "existing",
      scope.cursor,
      scope.metrics,
    ),
  }));
}
