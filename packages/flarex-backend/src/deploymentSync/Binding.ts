import type {
  NamespaceCursor,
  QuerySyncCanonicalValueError,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "@flarex/query-sync/internal/kernel";
import { Data, Result, Schema } from "effect";

import type {
  ScopeSyncActiveHeadObservationV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  ScopeUuidV1Schema,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import {
  captureScopeSyncNamespaceCursorV1Result,
} from "./QuerySyncModel";

const DEPLOYMENT_SYNC_OBJECT_NAME_PREFIX = "deployment-sync:";
const CANONICAL_SCOPE_UUID_TEXT_LENGTH = 36;
const DEPLOYMENT_SYNC_OBJECT_NAME_LENGTH =
  DEPLOYMENT_SYNC_OBJECT_NAME_PREFIX.length + CANONICAL_SCOPE_UUID_TEXT_LENGTH;
const EXPECTED_DEPLOYMENT_SYNC_OBJECT_NAME =
  `${DEPLOYMENT_SYNC_OBJECT_NAME_PREFIX}<canonical-lowercase-scope-uuid>`;

export type DeploymentQuerySyncBindingFailureReason =
  | "objectNameMissing"
  | "objectNameInvalid"
  | "routeScopeMismatch"
  | "portableProjectionRejected";

export class DeploymentQuerySyncBindingError extends Data.TaggedError(
  "DeploymentQuerySyncBindingError",
)<{
  readonly reason: DeploymentQuerySyncBindingFailureReason;
  readonly expected: string | null;
  readonly observed: string | null;
  readonly cause: unknown | null;
}> {}

export interface DeploymentQuerySyncBinding {
  readonly objectName: string;
  readonly scopeUuid: ScopeUuidV1;
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly sourceEpoch: SyncEpoch;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly observedAtCommitSeq: CommitSeq;
  readonly observedThroughSequence: SyncSequence;
  readonly bootstrapCursor: NamespaceCursor;
  readonly activationSequence: ScopeSyncActiveHeadObservationV1[
    "activationSequence"
  ];
  readonly activeHeadSha256Hex: ScopeSyncActiveHeadObservationV1[
    "activeHeadSha256Hex"
  ];
}

export interface DeploymentQuerySyncBindingInput {
  readonly objectId: Pick<DurableObjectId, "name">;
  readonly observation: ScopeSyncActiveHeadObservationV1;
}

const decodeScopeUuidResult = Schema.decodeUnknownResult(ScopeUuidV1Schema);

interface DeploymentSyncObjectRoute {
  readonly objectName: string;
  readonly scopeUuid: ScopeUuidV1;
}

function bindingError(
  reason: DeploymentQuerySyncBindingFailureReason,
  expected: string | null,
  observed: string | null,
  cause: unknown | null = null,
): DeploymentQuerySyncBindingError {
  return new DeploymentQuerySyncBindingError({
    reason,
    expected,
    observed,
    cause,
  });
}

function parseDeploymentSyncObjectName(
  objectName: string | undefined,
): Result.Result<DeploymentSyncObjectRoute, DeploymentQuerySyncBindingError> {
  if (objectName === undefined) {
    return Result.fail(bindingError(
      "objectNameMissing",
      EXPECTED_DEPLOYMENT_SYNC_OBJECT_NAME,
      null,
    ));
  }
  if (
    objectName.length !== DEPLOYMENT_SYNC_OBJECT_NAME_LENGTH
    || !objectName.startsWith(DEPLOYMENT_SYNC_OBJECT_NAME_PREFIX)
  ) {
    return Result.fail(bindingError(
      "objectNameInvalid",
      EXPECTED_DEPLOYMENT_SYNC_OBJECT_NAME,
      objectName,
    ));
  }
  const encodedScope = objectName.slice(
    DEPLOYMENT_SYNC_OBJECT_NAME_PREFIX.length,
  );
  return decodeScopeUuidResult(encodedScope).pipe(
    Result.map(scopeUuid => Object.freeze({ objectName, scopeUuid })),
    Result.mapError(cause => bindingError(
      "objectNameInvalid",
      EXPECTED_DEPLOYMENT_SYNC_OBJECT_NAME,
      objectName,
      cause,
    )),
  );
}

export function captureDeploymentQuerySyncBinding(
  input: DeploymentQuerySyncBindingInput,
): Result.Result<
  DeploymentQuerySyncBinding,
  DeploymentQuerySyncBindingError
> {
  return Result.gen(function* () {
    const route = yield* parseDeploymentSyncObjectName(input.objectId.name);
    if (route.scopeUuid !== input.observation.scopeUuid) {
      return yield* Result.fail(bindingError(
        "routeScopeMismatch",
        input.observation.scopeUuid,
        route.scopeUuid,
      ));
    }
    const bootstrapCursor = yield* captureScopeSyncNamespaceCursorV1Result(
      input.observation,
    ).pipe(Result.mapError((cause: QuerySyncCanonicalValueError) =>
      bindingError(
        "portableProjectionRejected",
        null,
        null,
        cause,
      )
    ));
    return Object.freeze({
      objectName: route.objectName,
      scopeUuid: route.scopeUuid,
      namespaceId: bootstrapCursor.namespaceId,
      syncModelId: bootstrapCursor.syncModelId,
      epochUuid: input.observation.epochUuid,
      sourceEpoch: bootstrapCursor.sourceEpoch,
      storageGeneration: input.observation.storageGeneration,
      storageGenerationFence: input.observation.storageGenerationFence,
      observedAtCommitSeq: input.observation.observedAtCommitSeq,
      observedThroughSequence: bootstrapCursor.appliedThroughSequence,
      bootstrapCursor,
      activationSequence: input.observation.activationSequence,
      activeHeadSha256Hex: input.observation.activeHeadSha256Hex,
    });
  });
}

function bindingsEqual(
  left: DeploymentQuerySyncBinding,
  right: DeploymentQuerySyncBinding,
): boolean {
  return left.objectName === right.objectName
    && left.scopeUuid === right.scopeUuid
    && left.namespaceId === right.namespaceId
    && left.syncModelId === right.syncModelId
    && left.epochUuid === right.epochUuid
    && left.sourceEpoch === right.sourceEpoch
    && left.storageGeneration === right.storageGeneration
    && left.storageGenerationFence === right.storageGenerationFence
    && left.observedAtCommitSeq === right.observedAtCommitSeq
    && left.observedThroughSequence === right.observedThroughSequence
    && left.bootstrapCursor.namespaceId === right.bootstrapCursor.namespaceId
    && left.bootstrapCursor.syncModelId === right.bootstrapCursor.syncModelId
    && left.bootstrapCursor.sourceEpoch === right.bootstrapCursor.sourceEpoch
    && left.bootstrapCursor.appliedThroughSequence
      === right.bootstrapCursor.appliedThroughSequence
    && left.activationSequence === right.activationSequence
    && left.activeHeadSha256Hex === right.activeHeadSha256Hex;
}

class IssuedDeploymentQuerySyncFreshInitializationCapability {
  declare private readonly deploymentQuerySyncFreshInitialization: void;

  constructor() {
    Object.freeze(this);
  }
}

export type DeploymentQuerySyncFreshInitializationCapability =
  IssuedDeploymentQuerySyncFreshInitializationCapability;

class IssuedDeploymentQuerySyncFreshInitializationReservation {
  declare private readonly deploymentQuerySyncFreshReservation: void;

  constructor() {
    Object.freeze(this);
  }
}

export type DeploymentQuerySyncFreshInitializationReservation =
  IssuedDeploymentQuerySyncFreshInitializationReservation;

type FreshCapabilityStatus =
  | Readonly<{ readonly _tag: "available" }>
  | Readonly<{ readonly _tag: "consumed" }>
  | Readonly<{
      readonly _tag: "reserved";
      readonly reservation: DeploymentQuerySyncFreshInitializationReservation;
    }>;

interface FreshCapabilityState {
  readonly binding: DeploymentQuerySyncBinding;
  status: FreshCapabilityStatus;
}

const freshCapabilities = new WeakMap<
  DeploymentQuerySyncFreshInitializationCapability,
  FreshCapabilityState
>();
const freshReservations = new WeakMap<
  DeploymentQuerySyncFreshInitializationReservation,
  FreshCapabilityState
>();

export function makeDeploymentQuerySyncFreshInitializationCapabilityForTest(
  binding: DeploymentQuerySyncBinding,
): DeploymentQuerySyncFreshInitializationCapability {
  const capability =
    new IssuedDeploymentQuerySyncFreshInitializationCapability();
  freshCapabilities.set(capability, {
    binding,
    status: Object.freeze({ _tag: "available" }),
  });
  return capability;
}

export type DeploymentQuerySyncFreshReservationAttempt =
  | Readonly<{ readonly _tag: "absent" | "consumed" }>
  | Readonly<{ readonly _tag: "invalid" }>
  | Readonly<{
      readonly _tag: "reserved";
      readonly reservation: DeploymentQuerySyncFreshInitializationReservation;
    }>;

export function reserveDeploymentQuerySyncFreshInitialization(
  capability: DeploymentQuerySyncFreshInitializationCapability | undefined,
  binding: DeploymentQuerySyncBinding,
): DeploymentQuerySyncFreshReservationAttempt {
  if (capability === undefined) {
    return Object.freeze({ _tag: "absent" });
  }
  const state = freshCapabilities.get(capability);
  if (state === undefined || !bindingsEqual(state.binding, binding)) {
    return Object.freeze({ _tag: "invalid" });
  }
  if (state.status._tag === "consumed") {
    return Object.freeze({ _tag: "consumed" });
  }
  if (state.status._tag === "reserved") {
    return Object.freeze({ _tag: "invalid" });
  }
  const reservation =
    new IssuedDeploymentQuerySyncFreshInitializationReservation();
  freshReservations.set(reservation, state);
  state.status = Object.freeze({ _tag: "reserved", reservation });
  return Object.freeze({
    _tag: "reserved",
    reservation,
  });
}

function requireFreshReservation(
  reservation: DeploymentQuerySyncFreshInitializationReservation,
): FreshCapabilityState {
  const state = freshReservations.get(reservation);
  if (
    state === undefined
    || state.status._tag !== "reserved"
    || state.status.reservation !== reservation
  ) {
    throw new Error("Invalid deployment query-sync fresh reservation.");
  }
  return state;
}

export function consumeDeploymentQuerySyncFreshInitialization(
  reservation: DeploymentQuerySyncFreshInitializationReservation,
): void {
  const state = requireFreshReservation(reservation);
  freshReservations.delete(reservation);
  state.status = Object.freeze({ _tag: "consumed" });
}

export function releaseDeploymentQuerySyncFreshInitialization(
  reservation: DeploymentQuerySyncFreshInitializationReservation,
): void {
  const state = requireFreshReservation(reservation);
  freshReservations.delete(reservation);
  state.status = Object.freeze({ _tag: "available" });
}
