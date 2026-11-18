import {
  validateApplicationExecutableActiveSelectionInTransaction,
} from "../../application/activation/bindingAcceptance";
import type { ApplicationActiveSelection } from "../../application/activation/contracts";
import type { ApplicationActivationError } from "../../application/activation/errors";
import { runPointCommitPromiseEffect } from "../../commit/point/promiseBoundary";
import type {
  LocatedReadCommittedAttemptTargetV1,
} from "../../database/locatedTransactionIdentity";
import { defineScopedWriteOperation } from "../../scope/execution/ScopedTransaction";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type LocatedTrustedScopeAuthority,
  type TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import { lockPointMutationSessionClock, requireStableAuthority } from "./attemptAuthority";
import {
  ACTIVATE_APPLICATION_MUTATION_SESSION_EFFECT_V1,
  ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1,
  requireActivationTarget,
  type LocatedPointMutationSessionActivationInputV1,
  type PointMutationSessionActivationPersistenceOptionsV1,
  type PointMutationSessionActivationResolutionPortsV1,
  type PointMutationSessionActivationWriteStepV1,
} from "./constructionContracts";
import type {
  ApplicationMutationSessionActivationPersistenceV1,
  PointMutationSessionActivationPersistenceV1,
  PointMutationSessionActivationResultV1,
  PreparedApplicationMutationSessionActivationV1,
  PreparedPointMutationSessionActivationV1,
} from "./contracts";
import {
  activateAfterLockedClock,
  activateInTransaction,
  replayApplicationSessionIfPresent,
} from "./durableActivation";
import {
  activationError,
  type PointMutationSessionActivationEffectErrorV1,
} from "./errors";
import {
  mapActivationAuthorityError,
  mapActivationTransactionError,
} from "./errorProjections";
import { createFiniteApplicationMutationSessionActivationOperation } from "./finiteActivation";
import {
  capturePreparedActivation,
  capturePreparedApplicationActivation,
  generateExecutionClaimOwnerEffect,
  generateSessionIdEffect,
  requireActivationExecutionClaimDuration,
  requireLeaseDuration,
} from "./inputCapture";
import { Effect } from "effect";
import type {
  ApplicationMutationExecutionAuthorityV1Error,
} from "flarex-protocol/internal/application-mutation-authority-v1";

export function createPointMutationSessionActivationPersistenceV1(
  ports: PointMutationSessionActivationResolutionPortsV1,
  options: PointMutationSessionActivationPersistenceOptionsV1,
): PointMutationSessionActivationPersistenceV1 {
  const leaseDurationMilliseconds = requireLeaseDuration(
    options.leaseDurationMilliseconds,
  );
  const executionClaimDurationMilliseconds = requireActivationExecutionClaimDuration(
    options.executionClaimDurationMilliseconds ?? leaseDurationMilliseconds,
  );
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const randomExecutionClaimOwner = options.randomExecutionClaimOwner ??
    (() => crypto.randomUUID());

  const activateEffect = Effect.fn(
    function* (
      input: PreparedPointMutationSessionActivationV1,
    ): Effect.fn.Return<
      PointMutationSessionActivationResultV1,
      PointMutationSessionActivationEffectErrorV1
    > {
      const prepared = yield* Effect.fromResult(
        capturePreparedActivation(input),
      );
      const candidateSessionId = yield* generateSessionIdEffect(randomUuid);
      const executionClaimOwner = yield* generateExecutionClaimOwnerEffect(
        randomExecutionClaimOwner,
      );
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        { deploymentId: prepared.deploymentId, scopeId: prepared.scopeId },
        {
          scopeMetadata: ports.scopeMetadata,
          provisioningReceipts: ports.provisioningReceipts,
          scopeClockTargets: ports.scopeSessionTargets,
        },
      ).pipe(Effect.mapError(mapActivationAuthorityError));
      if (located.authority.scopeId !== prepared.scopeId) {
        return yield* Effect.fail(activationError({ reason: "scopeMismatch" }));
      }
      const target = yield* Effect.fromResult(requireActivationTarget(
        located.target,
        prepared.scopeId,
      ));
      return yield* target[ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1]({
        prepared,
        preliminaryAuthority: located.authority,
        candidateSessionId,
        leaseDurationMilliseconds,
        executionClaimDurationMilliseconds,
        executionClaimOwner,
      });
    },
  );

  return Object.freeze({ activateEffect });
}

/**
 * Inert Application-authority admission. This deliberately shares the
 * transaction-session creation kernel while retaining a distinct input
 * contract and an in-transaction active-selection check.
 */
export function createApplicationMutationSessionActivationPersistenceV1(
  ports: PointMutationSessionActivationResolutionPortsV1,
  options: PointMutationSessionActivationPersistenceOptionsV1,
): ApplicationMutationSessionActivationPersistenceV1 {
  const leaseDurationMilliseconds = requireLeaseDuration(
    options.leaseDurationMilliseconds,
  );
  const executionClaimDurationMilliseconds =
    requireActivationExecutionClaimDuration(
      options.executionClaimDurationMilliseconds ?? leaseDurationMilliseconds,
    );
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const randomExecutionClaimOwner = options.randomExecutionClaimOwner ??
    (() => crypto.randomUUID());

  const activateEffect = Effect.fn(function* (
    input: PreparedApplicationMutationSessionActivationV1,
  ): Effect.fn.Return<
    PointMutationSessionActivationResultV1,
    | PointMutationSessionActivationEffectErrorV1
    | ApplicationActivationError
    | ApplicationMutationExecutionAuthorityV1Error
  > {
    const prepared = yield* capturePreparedApplicationActivation(input);
    const candidateSessionId = yield* generateSessionIdEffect(randomUuid);
    const executionClaimOwner = yield* generateExecutionClaimOwnerEffect(
      randomExecutionClaimOwner,
    );
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
      { deploymentId: prepared.activation.deploymentId, scopeId: prepared.activation.scopeId },
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(Effect.mapError(mapActivationAuthorityError));
    if (located.authority.scopeId !== prepared.activation.scopeId) {
      return yield* Effect.fail(activationError({ reason: "scopeMismatch" }));
    }
    const target = yield* Effect.fromResult(requireActivationTarget(
      located.target,
      prepared.activation.scopeId,
    ));
    return yield* target[ACTIVATE_APPLICATION_MUTATION_SESSION_EFFECT_V1](
      {
        prepared: prepared.activation,
        preliminaryAuthority: located.authority,
        candidateSessionId,
        leaseDurationMilliseconds,
        executionClaimDurationMilliseconds,
        executionClaimOwner,
      },
      prepared.selection,
    );
  });

  const activateFiniteEffect = createFiniteApplicationMutationSessionActivationOperation(
    ports,
    leaseDurationMilliseconds,
    executionClaimDurationMilliseconds,
    randomUuid,
    randomExecutionClaimOwner,
  );
  return Object.freeze({ activateEffect, activateFiniteEffect });
}

export const legacyActivationScopedOperation = defineScopedWriteOperation(
  (
    tx,
    _scoped,
    operationInput: Readonly<{
      readonly input: LocatedPointMutationSessionActivationInputV1;
      readonly afterWrite?: (
        step: PointMutationSessionActivationWriteStepV1,
      ) => void | Promise<void>;
    }>,
  ) => runPointCommitPromiseEffect(() => activateInTransaction(
      tx,
      operationInput.input,
      operationInput.afterWrite,
    ), mapActivationTransactionError),
);

export const applicationActivationScopedOperation = defineScopedWriteOperation(
  Effect.fn(
    function* (
      tx: AppRowTransaction,
      _scoped,
      operationInput: Readonly<{
        readonly input: LocatedPointMutationSessionActivationInputV1;
        readonly selection: ApplicationActiveSelection;
      }>,
    ) {
      const { input, selection } = operationInput;
      const clock = yield* runPointCommitPromiseEffect(
        () => lockPointMutationSessionClock(tx, input.prepared.scopeId), mapActivationTransactionError);
      yield* Effect.fromResult(requireStableAuthority(clock, input));
      const replay = yield* runPointCommitPromiseEffect(
        () => replayApplicationSessionIfPresent(tx, input, clock), mapActivationTransactionError);
      if (replay !== null) return replay;
      yield* validateApplicationExecutableActiveSelectionInTransaction(
        selection,
        tx,
        clock.record,
      );
      return yield* runPointCommitPromiseEffect(
        () => activateAfterLockedClock(tx, input, clock, undefined), mapActivationTransactionError);
    },
  ),
);

export function locatedActivationAuthority(
  target: LocatedReadCommittedAttemptTargetV1,
  authority: TrustedScopeAuthority,
): LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1> {
  return Object.freeze({ authority, target });
}
