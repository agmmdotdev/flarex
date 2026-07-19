import { Data, Result } from "effect";

import type { TransactionExecutionClaimObservationV1 } from
  "@flarex/persistence-postgres/transaction-execution-claim";
import type { PointMutationSessionAttemptSelectorV1 } from
  "@flarex/persistence-postgres/transaction-session-activation";

const pointMutationExecutionClaimBrand: unique symbol = Symbol(
  "FlarexExecutor/PointMutationExecutionClaimV1",
);
const pointMutationExecutionScopeBrand: unique symbol = Symbol(
  "FlarexExecutor/PointMutationExecutionScopeV1",
);

export type PointMutationExecutionClaimModeV1 = "execute" | "finishOnly";

export interface PointMutationExecutionClaimV1 {
  readonly [pointMutationExecutionClaimBrand]:
    typeof pointMutationExecutionClaimBrand;
}

export interface PointMutationExecutionScopeV1 {
  readonly [pointMutationExecutionScopeBrand]:
    typeof pointMutationExecutionScopeBrand;
}

export interface PointMutationExecutionClaimStateV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly observation: TransactionExecutionClaimObservationV1;
  readonly mode: PointMutationExecutionClaimModeV1;
}

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
    requiredMode?: PointMutationExecutionClaimModeV1,
  ) => Result.Result<
    PointMutationExecutionScopeV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
  readonly inspect: (
    scope: unknown,
    requiredMode?: PointMutationExecutionClaimModeV1,
  ) => Result.Result<
    PointMutationExecutionClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
  readonly consume: (
    scope: unknown,
    requiredMode?: PointMutationExecutionClaimModeV1,
  ) => Result.Result<
    PointMutationExecutionClaimStateV1,
    InvalidPointMutationExecutionClaimV1Error
  >;
}

export interface PointMutationExecutionClaimVaultV1 {
  readonly issuer: PointMutationExecutionClaimIssuerV1;
  readonly admission: PointMutationExecutionClaimAdmissionV1;
}

export function createPointMutationExecutionClaimVaultV1():
  PointMutationExecutionClaimVaultV1 {
  const states = new WeakMap<object, PointMutationExecutionClaimStateV1>();
  const claimed = new WeakSet<object>();
  const scopeStates = new WeakMap<object, PointMutationExecutionClaimStateV1>();
  const consumedScopes = new WeakSet<object>();

  const mint: PointMutationExecutionClaimIssuerV1["mint"] = (state) => {
    const handle = Object.freeze({
      [pointMutationExecutionClaimBrand]: pointMutationExecutionClaimBrand,
    } satisfies PointMutationExecutionClaimV1);
    states.set(handle, Object.freeze({
      selector: Object.freeze({ ...state.selector }),
      observation: Object.freeze({ ...state.observation }),
      mode: state.mode,
    }));
    return handle;
  };

  const claimState = (
    claim: unknown,
    requiredMode: PointMutationExecutionClaimModeV1 | undefined,
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
    if (requiredMode !== undefined && state.mode !== requiredMode) {
      return Result.fail(new InvalidPointMutationExecutionClaimV1Error({
        reason: "modeUnavailable",
      }));
    }
    return Result.succeed(state);
  };

  const inspectScope = (
    scope: unknown,
    requiredMode: PointMutationExecutionClaimModeV1 | undefined,
    consume: boolean,
  ): Result.Result<
    PointMutationExecutionClaimStateV1,
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

  const admission: PointMutationExecutionClaimAdmissionV1 = Object.freeze({
    admit: (
      claim: unknown,
      requiredMode?: PointMutationExecutionClaimModeV1,
    ) => Result.gen(function* () {
      const state = yield* claimState(claim, requiredMode);
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
      requiredMode?: PointMutationExecutionClaimModeV1,
    ) =>
      inspectScope(scope, requiredMode, false),
    consume: (
      scope: unknown,
      requiredMode?: PointMutationExecutionClaimModeV1,
    ) =>
      inspectScope(scope, requiredMode, true),
  });
  return Object.freeze({
    issuer: Object.freeze({ mint }),
    admission,
  });
}
