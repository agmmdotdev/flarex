import { Data, Result } from "effect";

import type { TransactionExecutionClaimObservationV1 } from
  "@flarex/persistence-postgres/transaction-execution-claim";
import type {
  PointMutationExecutionClaimAbortReasonV1,
  PointMutationSessionAttemptSelectorV1,
} from "@flarex/persistence-postgres/transaction-session-activation";

const pointMutationExecutionClaimBrand: unique symbol = Symbol(
  "FlarexExecutor/PointMutationExecutionClaimV1",
);
const pointMutationExecutionScopeBrand: unique symbol = Symbol(
  "FlarexExecutor/PointMutationExecutionScopeV1",
);
const pointMutationAbortOnlyScopeBrand: unique symbol = Symbol(
  "FlarexExecutor/PointMutationAbortOnlyScopeV1",
);

export type PointMutationExecutionWorkModeV1 =
  | "execute"
  | "finishOnly"
  | "replaceRelationConflict";

export interface PointMutationExecutionClaimV1 {
  readonly [pointMutationExecutionClaimBrand]:
    typeof pointMutationExecutionClaimBrand;
}

export interface PointMutationExecutionScopeV1 {
  readonly [pointMutationExecutionScopeBrand]:
    typeof pointMutationExecutionScopeBrand;
}

export interface PointMutationAbortOnlyScopeV1 {
  readonly [pointMutationAbortOnlyScopeBrand]:
    typeof pointMutationAbortOnlyScopeBrand;
}

interface PointMutationExecutionClaimStateBaseV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly observation: TransactionExecutionClaimObservationV1;
}

export type PointMutationExecutionWorkClaimStateV1 = Readonly<
  PointMutationExecutionClaimStateBaseV1 & {
    readonly mode: PointMutationExecutionWorkModeV1;
  }
>;

export type PointMutationAbortOnlyClaimStateV1 = Readonly<
  PointMutationExecutionClaimStateBaseV1 & {
    readonly mode: "abortOnly";
    readonly reason: PointMutationExecutionClaimAbortReasonV1;
  }
>;

export type PointMutationExecutionClaimStateV1 =
  | PointMutationExecutionWorkClaimStateV1
  | PointMutationAbortOnlyClaimStateV1;

export class InvalidPointMutationExecutionClaimV1Error
  extends Data.TaggedError("InvalidPointMutationExecutionClaimV1Error")<{
    readonly reason: "notSameFactory" | "modeUnavailable" | "consumed";
  }> {}

/**
 * Factory-local runtime authority. Persistence observations remain inert until
 * the trusted composition root mints one of these opaque handles immediately
 * after the owning transaction has settled.
 */
export interface PointMutationExecutionClaimIssuerV1 {
  readonly mint: (
    state: PointMutationExecutionClaimStateV1,
  ) => PointMutationExecutionClaimV1;
}

export interface PointMutationExecutionClaimAdmissionV1 {
  /** Synchronously consumes one dispatch claim and opens one execution scope. */
  readonly admit: (
    claim: unknown,
    requiredMode: PointMutationExecutionWorkModeV1,
  ) => Result.Result<
    PointMutationExecutionScopeV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
  readonly inspect: (
    scope: unknown,
    requiredMode: PointMutationExecutionWorkModeV1,
  ) => Result.Result<
    PointMutationExecutionWorkClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
  readonly consume: (
    scope: unknown,
    requiredMode: PointMutationExecutionWorkModeV1,
  ) => Result.Result<
    PointMutationExecutionWorkClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
  /** Accepts any stored-attempt work mode, but never abort-only. */
  readonly inspectStoredAttempt: (
    scope: unknown,
  ) => Result.Result<
    PointMutationExecutionWorkClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
  readonly consumeStoredAttempt: (
    scope: unknown,
  ) => Result.Result<
    PointMutationExecutionWorkClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
}

export interface PointMutationAbortOnlyClaimAdmissionV1 {
  /** Synchronously consumes one abort-only claim into its confined scope. */
  readonly admit: (
    claim: unknown,
  ) => Result.Result<
    PointMutationAbortOnlyScopeV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
  readonly inspect: (
    scope: unknown,
  ) => Result.Result<
    PointMutationAbortOnlyClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
  readonly consume: (
    scope: unknown,
  ) => Result.Result<
    PointMutationAbortOnlyClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
}

export interface PointMutationExecutionClaimVaultV1 {
  readonly issuer: PointMutationExecutionClaimIssuerV1;
  readonly admission: PointMutationExecutionClaimAdmissionV1;
  readonly abortOnlyAdmission: PointMutationAbortOnlyClaimAdmissionV1;
}

export function createPointMutationExecutionClaimVaultV1():
  PointMutationExecutionClaimVaultV1 {
  const states = new WeakMap<object, PointMutationExecutionClaimStateV1>();
  const claimed = new WeakSet<object>();
  const scopeStates = new WeakMap<
    object,
    PointMutationExecutionWorkClaimStateV1
  >();
  const abortOnlyScopeStates = new WeakMap<
    object,
    PointMutationAbortOnlyClaimStateV1
  >();
  const consumedScopes = new WeakSet<object>();
  const consumedAbortOnlyScopes = new WeakSet<object>();

  const mint: PointMutationExecutionClaimIssuerV1["mint"] = (state) => {
    const handle = Object.freeze({
      [pointMutationExecutionClaimBrand]: pointMutationExecutionClaimBrand,
    } satisfies PointMutationExecutionClaimV1);
    const selector = Object.freeze({ ...state.selector });
    const observation = Object.freeze({ ...state.observation });
    const captured: PointMutationExecutionClaimStateV1 =
      state.mode === "abortOnly"
        ? Object.freeze({
            selector,
            observation,
            mode: state.mode,
            reason: state.reason,
          })
        : Object.freeze({ selector, observation, mode: state.mode });
    states.set(handle, captured);
    return handle;
  };

  const readClaimState = (
    claim: unknown,
  ): Result.Result<
    PointMutationExecutionClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  > => {
    if (typeof claim !== "object" || claim === null) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "notSameFactory",
      }));
    }
    const state = states.get(claim);
    if (state === undefined) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "notSameFactory",
      }));
    }
    if (claimed.has(claim)) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "consumed",
      }));
    }
    return Result.succeed(state);
  };

  const claimWorkState = (
    claim: unknown,
    requiredMode: PointMutationExecutionWorkModeV1,
  ): Result.Result<
    PointMutationExecutionWorkClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  > =>
    readClaimState(claim).pipe(
      Result.flatMap((state) =>
        state.mode === requiredMode
          ? Result.succeed(state)
          : Result.fail(new InvalidPointMutationExecutionClaimV1Error({
              reason: "modeUnavailable",
            }))
      ),
    );

  const claimAbortOnlyState = (
    claim: unknown,
  ): Result.Result<
    PointMutationAbortOnlyClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  > =>
    readClaimState(claim).pipe(
      Result.flatMap((state) =>
        state.mode === "abortOnly"
          ? Result.succeed(state)
          : Result.fail(new InvalidPointMutationExecutionClaimV1Error({
              reason: "modeUnavailable",
            }))
      ),
    );

  const inspectScope = (
    scope: unknown,
    requiredMode: PointMutationExecutionWorkModeV1 | undefined,
    consume: boolean,
  ): Result.Result<
    PointMutationExecutionWorkClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  > => {
    if (typeof scope !== "object" || scope === null) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "notSameFactory",
      }));
    }
    const state = scopeStates.get(scope);
    if (state === undefined) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "notSameFactory",
      }));
    }
    if (consumedScopes.has(scope)) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "consumed",
      }));
    }
    if (requiredMode !== undefined && state.mode !== requiredMode) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "modeUnavailable",
      }));
    }
    if (consume) consumedScopes.add(scope);
    return Result.succeed(state);
  };

  const inspectAbortOnlyScope = (
    scope: unknown,
    consume: boolean,
  ): Result.Result<
    PointMutationAbortOnlyClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  > => {
    if (typeof scope !== "object" || scope === null) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "notSameFactory",
      }));
    }
    const state = abortOnlyScopeStates.get(scope);
    if (state === undefined) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "notSameFactory",
      }));
    }
    if (consumedAbortOnlyScopes.has(scope)) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "consumed",
      }));
    }
    if (consume) consumedAbortOnlyScopes.add(scope);
    return Result.succeed(state);
  };

  const admission: PointMutationExecutionClaimAdmissionV1 = Object.freeze({
    admit: (
      claim: unknown,
      requiredMode: PointMutationExecutionWorkModeV1,
    ) => Result.gen(function* () {
      const state = yield* claimWorkState(claim, requiredMode);
      if (typeof claim !== "object" || claim === null) {
        return yield* Result.fail(
          new InvalidPointMutationExecutionClaimV1Error({
            reason: "notSameFactory",
          }),
        );
      }
      claimed.add(claim);
      const scope = Object.freeze({
        [pointMutationExecutionScopeBrand]: pointMutationExecutionScopeBrand,
      } satisfies PointMutationExecutionScopeV1);
      scopeStates.set(scope, state);
      return scope;
    }),
    inspect: (
      scope: unknown,
      requiredMode: PointMutationExecutionWorkModeV1,
    ) =>
      inspectScope(scope, requiredMode, false),
    consume: (
      scope: unknown,
      requiredMode: PointMutationExecutionWorkModeV1,
    ) =>
      inspectScope(scope, requiredMode, true),
    inspectStoredAttempt: (scope: unknown) =>
      inspectScope(scope, undefined, false),
    consumeStoredAttempt: (scope: unknown) =>
      inspectScope(scope, undefined, true),
  });
  const abortOnlyAdmission: PointMutationAbortOnlyClaimAdmissionV1 =
    Object.freeze({
      admit: (claim: unknown) =>
        Result.gen(function* () {
          const state = yield* claimAbortOnlyState(claim);
          if (typeof claim !== "object" || claim === null) {
            return yield* Result.fail(
              new InvalidPointMutationExecutionClaimV1Error({
                reason: "notSameFactory",
              }),
            );
          }
          claimed.add(claim);
          const scope = Object.freeze({
            [pointMutationAbortOnlyScopeBrand]: pointMutationAbortOnlyScopeBrand,
          } satisfies PointMutationAbortOnlyScopeV1);
          abortOnlyScopeStates.set(scope, state);
          return scope;
        }),
      inspect: (scope: unknown) => inspectAbortOnlyScope(scope, false),
      consume: (scope: unknown) => inspectAbortOnlyScope(scope, true),
    });
  return Object.freeze({
    issuer: Object.freeze({ mint }),
    admission,
    abortOnlyAdmission,
  });
}
