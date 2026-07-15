import type {
  CommitSeq,
  ScopeId,
  SnapshotToken,
} from "flarex-protocol/storage-authority";

import type {
  AppRowIdentityV1,
  AppRowPointDependencyV1,
} from "./appRows";

export interface MissingAppRowPointHeadObservationV1 {
  readonly kind: "missing";
  readonly identity: AppRowIdentityV1;
}

interface AppRowPointRevisionHeadObservationV1 {
  readonly identity: AppRowIdentityV1;
  readonly revisionCommitSeq: CommitSeq;
}

export interface LiveAppRowPointHeadObservationV1
  extends AppRowPointRevisionHeadObservationV1 {
  readonly kind: "live";
}

export interface TombstoneAppRowPointHeadObservationV1
  extends AppRowPointRevisionHeadObservationV1 {
  readonly kind: "tombstone";
}

export type AppRowPointHeadObservationV1 =
  | MissingAppRowPointHeadObservationV1
  | LiveAppRowPointHeadObservationV1
  | TombstoneAppRowPointHeadObservationV1;

export interface ValidateAppRowPointOccV1Input {
  readonly snapshotToken: SnapshotToken;
  readonly dependency: AppRowPointDependencyV1;
  readonly head: AppRowPointHeadObservationV1;
}

export type AppRowPointSnapshotStateV1 =
  | Readonly<{ readonly kind: "missing" }>
  | Readonly<{
      readonly kind: "live";
      readonly revisionCommitSeq: CommitSeq;
    }>
  | Readonly<{
      readonly kind: "tombstone";
      readonly revisionCommitSeq: CommitSeq;
    }>;

export interface ValidAppRowPointOccV1 {
  readonly kind: "valid";
}

export interface AppRowPointOccConflictV1 {
  readonly reason: "revisionAfterSnapshot";
  readonly identity: AppRowIdentityV1;
  readonly snapshotCommitSeq: CommitSeq;
  readonly observedState: AppRowPointSnapshotStateV1;
  readonly currentState: Exclude<
    AppRowPointSnapshotStateV1,
    Readonly<{ readonly kind: "missing" }>
  >;
}

export interface ConflictingAppRowPointOccV1 {
  readonly kind: "conflict";
  readonly conflict: AppRowPointOccConflictV1;
}

export type AppRowPointOccInvalidEvidenceIssueV1 =
  | Readonly<{
      readonly reason: "snapshotScopeMismatch";
      readonly snapshotScopeId: ScopeId;
      readonly dependencyScopeId: ScopeId;
    }>
  | Readonly<{
      readonly reason: "headIdentityMismatch";
      readonly expectedIdentity: AppRowIdentityV1;
      readonly actualIdentity: AppRowIdentityV1;
    }>
  | Readonly<{
      readonly reason: "nonPositiveDependencyRevision";
      readonly identity: AppRowIdentityV1;
      readonly revisionCommitSeq: CommitSeq;
    }>
  | Readonly<{
      readonly reason: "dependencyRevisionAfterSnapshot";
      readonly identity: AppRowIdentityV1;
      readonly revisionCommitSeq: CommitSeq;
      readonly snapshotCommitSeq: CommitSeq;
    }>
  | Readonly<{
      readonly reason: "nonPositiveHeadRevision";
      readonly identity: AppRowIdentityV1;
      readonly revisionCommitSeq: CommitSeq;
    }>
  | Readonly<{
      readonly reason: "snapshotEvidenceContradiction";
      readonly identity: AppRowIdentityV1;
      readonly snapshotCommitSeq: CommitSeq;
      readonly observedState: AppRowPointSnapshotStateV1;
      readonly currentState: AppRowPointSnapshotStateV1;
    }>;

export interface InvalidAppRowPointOccEvidenceV1 {
  readonly kind: "invalidEvidence";
  readonly issue: AppRowPointOccInvalidEvidenceIssueV1;
}

export type AppRowPointOccValidationV1 =
  | ValidAppRowPointOccV1
  | ConflictingAppRowPointOccV1
  | InvalidAppRowPointOccEvidenceV1;

const VALID_APP_ROW_POINT_OCC_V1 = Object.freeze({
  kind: "valid",
} satisfies ValidAppRowPointOccV1);

/**
 * Compares one exact O04 snapshot dependency with the authoritative row head
 * gathered by O06 under its short commit transaction. This kernel performs no
 * I/O and does not validate session, lease, epoch, or storage-generation
 * authority.
 */
export function validateAppRowPointOccV1(
  input: ValidateAppRowPointOccV1Input,
): AppRowPointOccValidationV1 {
  const dependencyIdentity = input.dependency.identity;
  if (dependencyIdentity.scopeId !== input.snapshotToken.scopeId) {
    return invalidEvidence({
      reason: "snapshotScopeMismatch",
      snapshotScopeId: input.snapshotToken.scopeId,
      dependencyScopeId: dependencyIdentity.scopeId,
    });
  }
  if (!identitiesEqual(dependencyIdentity, input.head.identity)) {
    return invalidEvidence({
      reason: "headIdentityMismatch",
      expectedIdentity: freezeIdentity(dependencyIdentity),
      actualIdentity: freezeIdentity(input.head.identity),
    });
  }

  const identity = freezeIdentity(dependencyIdentity);
  const observedState = observedStateFromDependency(input.dependency);
  if (
    observedState.kind !== "missing" &&
    observedState.revisionCommitSeq < 1n
  ) {
    return invalidEvidence({
      reason: "nonPositiveDependencyRevision",
      identity,
      revisionCommitSeq: observedState.revisionCommitSeq,
    });
  }
  if (
    observedState.kind !== "missing" &&
    observedState.revisionCommitSeq > input.snapshotToken.commitSeq
  ) {
    return invalidEvidence({
      reason: "dependencyRevisionAfterSnapshot",
      identity,
      revisionCommitSeq: observedState.revisionCommitSeq,
      snapshotCommitSeq: input.snapshotToken.commitSeq,
    });
  }

  const currentState = stateFromHead(input.head);
  if (currentState.kind !== "missing") {
    if (currentState.revisionCommitSeq < 1n) {
      return invalidEvidence({
        reason: "nonPositiveHeadRevision",
        identity,
        revisionCommitSeq: currentState.revisionCommitSeq,
      });
    }
    if (currentState.revisionCommitSeq > input.snapshotToken.commitSeq) {
      return Object.freeze({
        kind: "conflict",
        conflict: Object.freeze({
          reason: "revisionAfterSnapshot",
          identity,
          snapshotCommitSeq: input.snapshotToken.commitSeq,
          observedState,
          currentState,
        } satisfies AppRowPointOccConflictV1),
      } satisfies ConflictingAppRowPointOccV1);
    }
  }

  if (statesEqual(observedState, currentState)) {
    return VALID_APP_ROW_POINT_OCC_V1;
  }
  return invalidEvidence({
    reason: "snapshotEvidenceContradiction",
    identity,
    snapshotCommitSeq: input.snapshotToken.commitSeq,
    observedState,
    currentState,
  });
}

function observedStateFromDependency(
  dependency: AppRowPointDependencyV1,
): AppRowPointSnapshotStateV1 {
  if (dependency.kind === "present") {
    return freezeRevisionState("live", dependency.revisionCommitSeq);
  }
  switch (dependency.basis.kind) {
    case "noVisibleRevision":
      return Object.freeze({ kind: "missing" });
    case "tombstone":
      return freezeRevisionState(
        "tombstone",
        dependency.basis.revisionCommitSeq,
      );
    default:
      return assertNever(dependency.basis);
  }
}

function stateFromHead(
  head: AppRowPointHeadObservationV1,
): AppRowPointSnapshotStateV1 {
  return head.kind === "missing"
    ? Object.freeze({ kind: "missing" })
    : freezeRevisionState(head.kind, head.revisionCommitSeq);
}

function freezeRevisionState(
  kind: "live" | "tombstone",
  revisionCommitSeq: CommitSeq,
): Exclude<
  AppRowPointSnapshotStateV1,
  Readonly<{ readonly kind: "missing" }>
> {
  return Object.freeze({ kind, revisionCommitSeq });
}

function statesEqual(
  left: AppRowPointSnapshotStateV1,
  right: AppRowPointSnapshotStateV1,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "missing" || right.kind === "missing") return true;
  return left.revisionCommitSeq === right.revisionCommitSeq;
}

function identitiesEqual(
  left: AppRowIdentityV1,
  right: AppRowIdentityV1,
): boolean {
  return (
    left.scopeId === right.scopeId &&
    left.tableId === right.tableId &&
    left.rowId === right.rowId
  );
}

function freezeIdentity(identity: AppRowIdentityV1): AppRowIdentityV1 {
  return Object.freeze({ ...identity });
}

function invalidEvidence(
  issue: AppRowPointOccInvalidEvidenceIssueV1,
): InvalidAppRowPointOccEvidenceV1 {
  return Object.freeze({
    kind: "invalidEvidence",
    issue: Object.freeze(issue),
  });
}

function assertNever(_value: never): never {
  throw new Error("Unreachable app-row point dependency basis");
}
