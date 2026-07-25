import type {
  PointMutationSessionActivationResultV1,
  PreparedPointMutationSessionActivationV1,
} from "@flarex/persistence-postgres/transaction-session-activation";

import type {
  PointMutationExecutionClaimV1,
} from "./pointMutationExecutionClaim";

export interface ActivatedPointMutationSessionStateV1 {
  readonly inspection: PointMutationSessionActivationResultV1;
  readonly prepared: PreparedPointMutationSessionActivationV1;
  readonly executionClaim?: PointMutationExecutionClaimV1;
}

const activatedSessionStateByHandle = new WeakMap<
  object,
  ActivatedPointMutationSessionStateV1
>();

export function registerActivatedPointMutationSessionStateV1(
  handle: object,
  state: ActivatedPointMutationSessionStateV1,
): void {
  activatedSessionStateByHandle.set(handle, state);
}

export function getActivatedPointMutationSessionStateV1(
  value: object,
): ActivatedPointMutationSessionStateV1 | undefined {
  return activatedSessionStateByHandle.get(value);
}
