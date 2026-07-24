import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect } from "effect";

import type {
  PointMutationAttemptReplacementCommandV1,
  PointMutationAttemptReplacementPortV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import {
  TransactionAttemptFenceSchema,
  type TransactionAttemptFence,
} from "flarex-protocol/transaction-session";

import type { PointMutationExecutionClaimVaultV1 } from
  "../pointMutationExecutionClaim";
import type {
  PointMutationSessionAttemptLoadingExecutionV1Error,
  PointMutationSessionAttemptLoadingV1,
} from "../pointMutationSessionActivation";
import {
  getLoadedPointMutationSessionAttemptOccRerunInspectionV1,
  type LoadedPointMutationSessionAttemptOccRerunInspectionV1,
} from "../pointMutationSessionAttemptState";
import type {
  AuthorizedPointMutationOccRerunInspectionV1,
  PointMutationAttemptReplacementExecutionV1Error,
  PointMutationOccRerunAuthorizationResultV1,
  StoredPointCommitExecutorV1,
  StoredPointMutationAttemptReplacementV1,
} from "../storedAttemptAuthentication";
import type {
  CapturedPointMutationOccConflictV1,
  PreparedPointCommitCapabilityStateV1,
  StoredPointMutationCapabilityVaultV1,
} from "./capabilityState";
import {
  InvalidPreparedPointCommitV1Error,
  type FinishingPreparedPointCommitV1,
} from "./planningOperations";

const authorizedPointMutationOccRerunBrand: unique symbol = Symbol(
  "FlarexExecutor/AuthorizedPointMutationOccRerunV1",
);

/**
 * Private O08-B1 authority. It is process-local and must be synchronously
 * consumed by the later B2 gate immediately before execution revalidation.
 */
export interface AuthorizedPointMutationOccRerunV1 {
  readonly [authorizedPointMutationOccRerunBrand]: true;
}

export class PointMutationOccRerunOwnershipLostV1Error
  extends Data.TaggedError("PointMutationOccRerunOwnershipLostV1Error")<{
    readonly reason: "alreadyReplaced";
  }> {}

export type PointMutationOccRerunFreshAttemptMismatchV1 =
  | "deployment"
  | "scope"
  | "session"
  | "attemptFence"
  | "storageGeneration"
  | "storageGenerationFence"
  | "epoch"
  | "schema"
  | "requestKey"
  | "snapshotNotAdvanced"
  | "conflictingCommitNotVisible"
  | "attemptNotPristine";

export class PointMutationOccRerunFreshAttemptV1Error
  extends Data.TaggedError("PointMutationOccRerunFreshAttemptV1Error")<{
    readonly reason: PointMutationOccRerunFreshAttemptMismatchV1;
  }> {}

export class PointMutationOccRerunAuthorityCorruptionV1Error
  extends Data.TaggedError(
    "PointMutationOccRerunAuthorityCorruptionV1Error",
  )<{
    readonly reason:
      | "outcomeObservationInvalid"
      | "replacementObservationInvalid"
      | "loadedAttemptStateUnavailable";
  }> {}

export interface StoredPointMutationAttemptReplacementOperationDependenciesV1 {
  readonly base: StoredPointCommitExecutorV1;
  readonly pointMutationAttemptReplacement:
    PointMutationAttemptReplacementPortV1;
  readonly preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ];
  readonly finishingPreparedPointCommitStates:
    StoredPointMutationCapabilityVaultV1[
      "finishingPreparedPointCommitStates"
    ];
  readonly captureReplacementCommand: (
    state: PreparedPointCommitCapabilityStateV1,
  ) => PointMutationAttemptReplacementCommandV1;
}

export function makeStoredPointMutationAttemptReplacementOperationsV1(
  dependencies: StoredPointMutationAttemptReplacementOperationDependenciesV1,
): StoredPointMutationAttemptReplacementV1 {
  const {
    base,
    pointMutationAttemptReplacement,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
    captureReplacementCommand,
  } = dependencies;

  const replaceConflictedPointMutationAttempt:
    StoredPointMutationAttemptReplacementV1[
      "replaceConflictedPointMutationAttempt"
    ] = Effect.fn(
      "StoredAttemptAuthentication.replaceConflictedPointMutationAttempt",
    )(function* (input) {
      const state = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        input,
      );
      if (state === undefined) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      if (!finishingPreparedPointCommitStates.has(input)) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notFinishing",
        }));
      }
      return yield* pointMutationAttemptReplacement.replace(
        captureReplacementCommand(state),
      );
    });

  return Object.freeze({
    ...base,
    replaceConflictedPointMutationAttempt,
  } satisfies StoredPointMutationAttemptReplacementV1);
}

export interface PointMutationFreshAttemptHandoffInputV1 {
  readonly finishing: FinishingPreparedPointCommitV1;
  readonly prepared: PreparedPointCommitCapabilityStateV1;
  readonly conflict: CapturedPointMutationOccConflictV1;
  readonly backoffUpperBoundMilliseconds: number;
  readonly backoffMilliseconds: number;
}

export type PointMutationFreshAttemptHandoffV1Error =
  | PointMutationAttemptReplacementExecutionV1Error
  | PointMutationOccRerunOwnershipLostV1Error
  | PointMutationOccRerunFreshAttemptV1Error
  | PointMutationOccRerunAuthorityCorruptionV1Error
  | PointMutationSessionAttemptLoadingExecutionV1Error;

export type HandoffFreshPointMutationAttemptV1 = (
  input: PointMutationFreshAttemptHandoffInputV1,
) => Effect.Effect<
  Extract<
    PointMutationOccRerunAuthorizationResultV1,
    { readonly kind: "authorized" }
  >,
  PointMutationFreshAttemptHandoffV1Error,
  never
>;

export interface StoredPointMutationFreshAttemptHandoffOperationDependenciesV1 {
  readonly replaceConflictedPointMutationAttempt:
    StoredPointMutationAttemptReplacementV1[
      "replaceConflictedPointMutationAttempt"
    ];
  readonly pointMutationOccAttemptLoading:
    PointMutationSessionAttemptLoadingV1;
  readonly executionClaimIssuer: Pick<
    PointMutationExecutionClaimVaultV1["issuer"],
    "mint"
  >;
  readonly authorizedOccRerunStates: StoredPointMutationCapabilityVaultV1[
    "authorizedOccRerunStates"
  ];
  readonly mintedAuthorizedOccReruns: StoredPointMutationCapabilityVaultV1[
    "mintedAuthorizedOccReruns"
  ];
}

export function makeStoredPointMutationFreshAttemptHandoffOperationsV1(
  dependencies: StoredPointMutationFreshAttemptHandoffOperationDependenciesV1,
): HandoffFreshPointMutationAttemptV1 {
  const {
    replaceConflictedPointMutationAttempt,
    pointMutationOccAttemptLoading,
    executionClaimIssuer,
    authorizedOccRerunStates,
    mintedAuthorizedOccReruns,
  } = dependencies;

  return Effect.fn(
    "StoredAttemptAuthentication.handoffFreshPointMutationAttempt",
  )(function* (input) {
    const {
      finishing,
      prepared,
      conflict,
      backoffUpperBoundMilliseconds,
      backoffMilliseconds,
    } = input;
    const pins = prepared.plan.authorityPins;
    const previousSnapshot = pins.snapshotToken;
    const previousAttemptFence = pins.attemptFence;
    const replacementObservation =
      yield* replaceConflictedPointMutationAttempt(finishing);
    if (!isNonArrayRecord(replacementObservation)) {
      return yield* Effect.fail(
        new PointMutationOccRerunAuthorityCorruptionV1Error({
          reason: "replacementObservationInvalid",
        }),
      );
    }
    const replacementKind = replacementObservation.kind;
    if (
      replacementKind !== "replaced" &&
      replacementKind !== "alreadyReplaced"
    ) {
      return yield* Effect.fail(
        new PointMutationOccRerunAuthorityCorruptionV1Error({
          reason: "replacementObservationInvalid",
        }),
      );
    }
    const attemptFence = TransactionAttemptFenceSchema.make(
      previousAttemptFence + 1n,
    );
    if (
      replacementObservation.scopeUuid !==
        prepared.plan.sealIdentity.scopeUuid ||
      replacementObservation.sessionId !== pins.sessionId ||
      replacementObservation.previousAttemptFence !== previousAttemptFence ||
      replacementObservation.attemptFence !== attemptFence
    ) {
      return yield* Effect.fail(
        new PointMutationOccRerunAuthorityCorruptionV1Error({
          reason: "replacementObservationInvalid",
        }),
      );
    }
    if (replacementKind === "alreadyReplaced") {
      return yield* Effect.fail(
        new PointMutationOccRerunOwnershipLostV1Error({
          reason: "alreadyReplaced",
        }),
      );
    }
    const executionClaim = executionClaimIssuer.mint({
      selector: Object.freeze({
        deploymentId: pins.deploymentId,
        scopeId: pins.scopeId,
        sessionId: pins.sessionId,
        attemptFence,
      }),
      observation: replacementObservation.executionClaim,
      mode: "execute",
    });

    // Once O08-A settles, cancellation intentionally leaves the durable
    // pristine attempt without returned process-local execution authority.
    yield* Effect.yieldNow;
    const loadedAttempt = yield* pointMutationOccAttemptLoading.load({
      deploymentId: pins.deploymentId,
      scopeId: pins.scopeId,
      sessionId: pins.sessionId,
      attemptFence: attemptFence.toString(),
    });
    const loaded =
      getLoadedPointMutationSessionAttemptOccRerunInspectionV1(
        loadedAttempt,
      );
    if (loaded === undefined) {
      return yield* Effect.fail(
        new PointMutationOccRerunAuthorityCorruptionV1Error({
          reason: "loadedAttemptStateUnavailable",
        }),
      );
    }
    const freshMismatch = pointMutationOccFreshAttemptMismatch(
      prepared,
      conflict,
      attemptFence,
      loaded,
    );
    if (freshMismatch !== undefined) {
      return yield* Effect.fail(
        new PointMutationOccRerunFreshAttemptV1Error({
          reason: freshMismatch,
        }),
      );
    }

    // B2 must still recheck the outcome and liveness immediately before use.
    yield* Effect.yieldNow;
    const inspection = Object.freeze({
      deploymentId: pins.deploymentId,
      scopeId: pins.scopeId,
      sessionId: pins.sessionId,
      requestKey: pins.requestKey,
      previousAttemptFence,
      attemptFence,
      previousSnapshotToken: Object.freeze({ ...previousSnapshot }),
      snapshotToken: Object.freeze({ ...loaded.snapshotToken }),
      conflictDocumentId: conflict.documentId,
      conflictingCommitSeq: conflict.currentCommitSeq,
    } satisfies AuthorizedPointMutationOccRerunInspectionV1);
    const rerun: AuthorizedPointMutationOccRerunV1 = Object.freeze({
      [authorizedPointMutationOccRerunBrand]: true as const,
    });
    authorizedOccRerunStates.set(
      rerun,
      Object.freeze({
        loadedAttempt,
        executionClaim,
        prepared,
        conflict,
        inspection,
      }),
    );
    mintedAuthorizedOccReruns.add(rerun);
    return Object.freeze({
      kind: "authorized",
      rerun,
      backoffUpperBoundMilliseconds,
      backoffMilliseconds,
    });
  });
}

function lookupPreparedPointCommitState(
  states: WeakMap<object, PreparedPointCommitCapabilityStateV1>,
  input: FinishingPreparedPointCommitV1,
): PreparedPointCommitCapabilityStateV1 | undefined {
  return typeof input === "object" && input !== null
    ? states.get(input)
    : undefined;
}

export function pointMutationOccFreshAttemptMismatch(
  prepared: PreparedPointCommitCapabilityStateV1,
  conflict: CapturedPointMutationOccConflictV1,
  expectedAttemptFence: TransactionAttemptFence,
  loaded: LoadedPointMutationSessionAttemptOccRerunInspectionV1,
): PointMutationOccRerunFreshAttemptMismatchV1 | undefined {
  const pins = prepared.plan.authorityPins;
  const previousSnapshot = pins.snapshotToken;
  if (loaded.selector.deploymentId !== pins.deploymentId) return "deployment";
  if (loaded.selector.scopeId !== pins.scopeId) return "scope";
  if (loaded.selector.sessionId !== pins.sessionId) return "session";
  if (loaded.selector.attemptFence !== expectedAttemptFence) {
    return "attemptFence";
  }
  if (loaded.storageGeneration !== pins.storageGeneration) {
    return "storageGeneration";
  }
  if (loaded.storageGenerationFence !== pins.storageGenerationFence) {
    return "storageGenerationFence";
  }
  if (loaded.snapshotToken.epoch !== previousSnapshot.epoch) return "epoch";
  if (loaded.schemaVersionId !== pins.schemaVersionId) return "schema";
  if (loaded.requestKey !== pins.requestKey) return "requestKey";
  if (loaded.snapshotToken.commitSeq <= previousSnapshot.commitSeq) {
    return "snapshotNotAdvanced";
  }
  if (loaded.snapshotToken.commitSeq < conflict.currentCommitSeq) {
    return "conflictingCommitNotVisible";
  }
  if (loaded.attemptFacet.kind !== "pristineOpen") {
    return "attemptNotPristine";
  }
  return undefined;
}
