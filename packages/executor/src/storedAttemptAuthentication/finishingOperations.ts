import { Effect, Result } from "effect";

import {
  PointCommitCorruptionV1Error,
  type PointCommitFinishingTransitionCommandV1,
  type PointCommitFinishingTransitionPortV1,
  type PointCommitFinishingTransitionResultV1,
  type PointCommitPublicationCommandV1,
  type PointCommitPublicationResultV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type { PointMutationSessionAttemptSelectorV1 } from
  "@flarex/persistence-postgres/transaction-session-activation";

import type { PointMutationExecutionClaimVaultV1 } from
  "../pointMutationExecutionClaim";
import {
  decodePointMutationSessionAttemptSelectorV1Result,
  type InvalidPointMutationSessionAttemptSelectorV1Error,
} from "../pointMutationSessionAttemptSelector";
import type {
  AuthenticatedStoredAttemptStateV1,
  PointCommitFinishingPublicationExecutionV1Error,
  PointCommitFinishingRecoveryV1Error,
  StoredAttemptFinishingEvidenceLoaderPortV1,
  StoredPointCommitExecutorV1,
  StoredPointCommitFinishingTransitionV1,
  StoredPointCommitPlanningV1,
  StoredPointCommitPublisherV1,
} from "../storedAttemptAuthentication";
import {
  StoredAttemptPersistenceV1Error,
} from "./authenticationErrors";
import {
  requireLoadedStoredAttemptEvidenceEffect,
  type AuthenticatedStoredAttemptV1,
} from "./authenticationOperations";
import {
  captureRecoveredAuthorityEffect,
  verifyCanonicalStoredEvidenceEffect,
} from "./authenticationVerification";
import type {
  PreparedPointCommitCapabilityStateV1,
  StoredPointMutationCapabilityVaultV1,
} from "./capabilityState";
import {
  InvalidPreparedPointCommitV1Error,
  makeFinishingPreparedPointCommitHandleV1,
  type FinishingPreparedPointCommitV1,
  type PreparedPointCommitV1,
} from "./planningOperations";

export interface CapturedFinishingPreparedPointCommitV1 {
  readonly finishing: FinishingPreparedPointCommitV1;
  readonly prepared: PreparedPointCommitCapabilityStateV1;
}

export type PublishCapturedFinishingPointCommitV1 = (
  finishing: FinishingPreparedPointCommitV1,
  prepared: PreparedPointCommitCapabilityStateV1,
  command: PointCommitPublicationCommandV1,
) => Effect.Effect<
  PointCommitPublicationResultV1,
  PointCommitFinishingPublicationExecutionV1Error,
  never
>;

export interface StoredPointCommitFinishingTransitionOperationDependenciesV1 {
  readonly base: StoredPointCommitPublisherV1;
  readonly pointCommitFinishing: PointCommitFinishingTransitionPortV1;
  readonly executionClaims: Readonly<{
    readonly admission: Pick<
      PointMutationExecutionClaimVaultV1["admission"],
      "inspectStoredAttempt" | "consumeStoredAttempt"
    >;
  }>;
  readonly preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ];
  readonly finishingPreparedPointCommitStates:
    StoredPointMutationCapabilityVaultV1[
      "finishingPreparedPointCommitStates"
    ];
  readonly captureTransitionCommand: (
    state: PreparedPointCommitCapabilityStateV1,
  ) => PointCommitFinishingTransitionCommandV1;
  readonly rebaseFinishingState: (
    state: PreparedPointCommitCapabilityStateV1,
    result: PointCommitFinishingTransitionResultV1,
  ) => Result.Result<
    PreparedPointCommitCapabilityStateV1,
    PointCommitCorruptionV1Error
  >;
  readonly capturePublicationCommand: (
    state: PreparedPointCommitCapabilityStateV1,
  ) => PointCommitPublicationCommandV1;
  readonly publishCapturedFinishingPointCommit:
    PublishCapturedFinishingPointCommitV1;
}

export interface StoredPointCommitFinishingTransitionOperationsV1 {
  readonly facade: StoredPointCommitFinishingTransitionV1;
  readonly lookupFinishingPreparedPointCommit: (
    input: unknown,
  ) => Result.Result<
    CapturedFinishingPreparedPointCommitV1,
    InvalidPreparedPointCommitV1Error
  >;
}

export function makeStoredPointCommitFinishingTransitionOperationsV1(
  dependencies: StoredPointCommitFinishingTransitionOperationDependenciesV1,
): StoredPointCommitFinishingTransitionOperationsV1 {
  const {
    base,
    pointCommitFinishing,
    executionClaims,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
    captureTransitionCommand,
    rebaseFinishingState,
    capturePublicationCommand,
    publishCapturedFinishingPointCommit,
  } = dependencies;

  const enterPointCommitFinishing:
    StoredPointCommitFinishingTransitionV1[
      "enterPointCommitFinishing"
    ] = Effect.fn(
      "StoredAttemptAuthentication.enterPointCommitFinishing",
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
      if (finishingPreparedPointCommitStates.has(input)) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "alreadyFinishing",
        }));
      }
      if (
        state.provenance.session.lifecycle !== "running" ||
        state.plan.sealIdentity.lifecycle !== "running"
      ) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notRunning",
        }));
      }
      const executionClaim = state.provenance.executionClaim;
      if (executionClaim === null) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "executionClaimUnavailable",
        }));
      }
      yield* Effect.fromResult(
        executionClaims.admission.inspectStoredAttempt(executionClaim).pipe(
          Result.mapError(() => new InvalidPreparedPointCommitV1Error({
            reason: "executionClaimUnavailable",
          })),
        ),
      );
      const result = yield* Effect.uninterruptible(
        pointCommitFinishing.enterFinishing(
          captureTransitionCommand(state),
        ).pipe(
          Effect.tap(() => Effect.fromResult(
            executionClaims.admission.consumeStoredAttempt(executionClaim).pipe(
              Result.mapError(() => new PointCommitCorruptionV1Error({
                reason: "finishingTransitionInvalid",
              })),
            ),
          )),
        ),
      );
      const continuedState = yield* Effect.fromResult(
        rebaseFinishingState(state, result),
      );
      return yield* Effect.fromResult(
        mintFinishingPreparedPointCommit(
          preparedPointCommitStates,
          finishingPreparedPointCommitStates,
          continuedState,
        ),
      );
    });

  const lookupFinishingPreparedPointCommit = (
    input: unknown,
  ): Result.Result<
    CapturedFinishingPreparedPointCommitV1,
    InvalidPreparedPointCommitV1Error
  > => {
    if (typeof input !== "object" || input === null) {
      return Result.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notSameFactory",
      }));
    }
    const prepared = preparedPointCommitStates.get(input);
    if (prepared === undefined) {
      return Result.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notSameFactory",
      }));
    }
    if (!finishingPreparedPointCommitStates.has(input)) {
      return Result.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notFinishing",
      }));
    }
    return Result.succeed(Object.freeze({
      finishing: input as FinishingPreparedPointCommitV1,
      prepared,
    }));
  };

  const publishPointCommit:
    StoredPointCommitFinishingTransitionV1["publishPointCommit"] = Effect.fn(
      "StoredAttemptAuthentication.publishFinishingPointCommitOnce",
    )(function* (input) {
      const captured = yield* Effect.fromResult(
        lookupFinishingPreparedPointCommit(input),
      );
      return yield* publishCapturedFinishingPointCommit(
        captured.finishing,
        captured.prepared,
        capturePublicationCommand(captured.prepared),
      );
    });

  return Object.freeze({
    facade: Object.freeze({
      ...base,
      enterPointCommitFinishing,
      publishPointCommit,
    } satisfies StoredPointCommitFinishingTransitionV1),
    lookupFinishingPreparedPointCommit,
  });
}

export interface StoredPointCommitFinishingRecoveryOperationDependenciesV1 {
  readonly finishingEvidenceLoader: StoredAttemptFinishingEvidenceLoaderPortV1;
  readonly mintAuthenticatedStoredAttempt: (
    state: AuthenticatedStoredAttemptStateV1,
  ) => AuthenticatedStoredAttemptV1;
  readonly authenticateCommitAuthority:
    StoredPointCommitPlanningV1["authenticateCommitAuthority"];
  readonly verifyCommitInput: StoredPointCommitPlanningV1["verifyCommitInput"];
  readonly planPointCommit: StoredPointCommitPlanningV1["planPointCommit"];
  readonly preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ];
  readonly finishingPreparedPointCommitStates:
    StoredPointMutationCapabilityVaultV1[
      "finishingPreparedPointCommitStates"
    ];
}

export interface StoredPointCommitFinishingRecoveryOperationsV1 {
  readonly reconstructPointCommitFinishing:
    StoredPointCommitExecutorV1["reconstructPointCommitFinishing"];
  readonly reconstructPointCommitFinishingFromSelector: (
    selector: PointMutationSessionAttemptSelectorV1,
  ) => Effect.Effect<
    FinishingPreparedPointCommitV1,
    Exclude<
      PointCommitFinishingRecoveryV1Error,
      InvalidPointMutationSessionAttemptSelectorV1Error
    >,
    never
  >;
}

export function makeStoredPointCommitFinishingRecoveryOperationsV1(
  dependencies: StoredPointCommitFinishingRecoveryOperationDependenciesV1,
): StoredPointCommitFinishingRecoveryOperationsV1 {
  const {
    finishingEvidenceLoader,
    mintAuthenticatedStoredAttempt,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
  } = dependencies;

  const reconstructPointCommitFinishingFromSelector = Effect.fn(
    "StoredAttemptAuthentication.reconstructPointCommitFinishingFromSelector",
  )(function* (selector: PointMutationSessionAttemptSelectorV1) {
    const loadResult = yield* finishingEvidenceLoader.loadFinishingEffect(
      selector,
    ).pipe(Effect.mapError((error) =>
      new StoredAttemptPersistenceV1Error({ cause: error.cause })
    ));
    const evidence = yield*
      requireLoadedStoredAttemptEvidenceEffect(loadResult);
    const authority = yield* captureRecoveredAuthorityEffect(
      selector,
      evidence,
    );
    const storedAttemptState = yield* verifyCanonicalStoredEvidenceEffect(
      authority,
      evidence,
    );
    const storedAttempt = mintAuthenticatedStoredAttempt(storedAttemptState);
    const authenticatedAuthority = yield* authenticateCommitAuthority(
      storedAttempt,
    );
    const verifiedInput = yield* verifyCommitInput(authenticatedAuthority);
    const prepared = yield* planPointCommit(verifiedInput);
    const preparedState = lookupPreparedPointCommitState(
      preparedPointCommitStates,
      prepared,
    );
    if (preparedState === undefined) {
      return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notSameFactory",
      }));
    }
    return yield* Effect.fromResult(
      mintFinishingPreparedPointCommit(
        preparedPointCommitStates,
        finishingPreparedPointCommitStates,
        preparedState,
      ),
    );
  });

  const reconstructPointCommitFinishing:
    StoredPointCommitExecutorV1["reconstructPointCommitFinishing"] = Effect.fn(
      "StoredAttemptAuthentication.reconstructPointCommitFinishing",
    )(function* (input) {
      const selector = yield* Effect.fromResult(
        decodePointMutationSessionAttemptSelectorV1Result(input),
      );
      return yield* reconstructPointCommitFinishingFromSelector(selector);
    });

  return Object.freeze({
    reconstructPointCommitFinishing,
    reconstructPointCommitFinishingFromSelector,
  });
}

export interface StoredPointCommitExecutorOperationDependenciesV1 {
  readonly base: StoredPointCommitFinishingTransitionV1;
  readonly publishPointCommit: StoredPointCommitExecutorV1[
    "publishPointCommit"
  ];
  readonly reconstructPointCommitFinishing: StoredPointCommitExecutorV1[
    "reconstructPointCommitFinishing"
  ];
}

export function makeStoredPointCommitExecutorOperationsV1(
  dependencies: StoredPointCommitExecutorOperationDependenciesV1,
): StoredPointCommitExecutorV1 {
  const {
    base,
    publishPointCommit,
    reconstructPointCommitFinishing,
  } = dependencies;

  const finishPointCommit: StoredPointCommitExecutorV1["finishPointCommit"] =
    Effect.fn("StoredAttemptAuthentication.finishPointCommit")(
      function* (input) {
        const finishing = yield* base.enterPointCommitFinishing(input);
        return yield* publishPointCommit(finishing);
      },
    );

  const resumePointCommit: StoredPointCommitExecutorV1["resumePointCommit"] =
    Effect.fn("StoredAttemptAuthentication.resumePointCommit")(
      function* (selector) {
        const finishing = yield* reconstructPointCommitFinishing(selector);
        return yield* publishPointCommit(finishing);
      },
    );

  return Object.freeze({
    ...base,
    publishPointCommit,
    reconstructPointCommitFinishing,
    finishPointCommit,
    resumePointCommit,
  } satisfies StoredPointCommitExecutorV1);
}

function mintFinishingPreparedPointCommit(
  preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ],
  finishingPreparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "finishingPreparedPointCommitStates"
  ],
  state: PreparedPointCommitCapabilityStateV1,
): Result.Result<
  FinishingPreparedPointCommitV1,
  InvalidPreparedPointCommitV1Error
> {
  if (
    state.provenance.session.lifecycle !== "finishing" ||
    state.plan.sealIdentity.lifecycle !== "finishing"
  ) {
    return Result.fail(new InvalidPreparedPointCommitV1Error({
      reason: "notFinishing",
    }));
  }
  const handle = makeFinishingPreparedPointCommitHandleV1();
  preparedPointCommitStates.set(handle, state);
  finishingPreparedPointCommitStates.add(handle);
  return Result.succeed(handle);
}

function lookupPreparedPointCommitState(
  states: WeakMap<object, PreparedPointCommitCapabilityStateV1>,
  value: PreparedPointCommitV1,
): PreparedPointCommitCapabilityStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}
