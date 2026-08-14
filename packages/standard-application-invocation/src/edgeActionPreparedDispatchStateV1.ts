import type {
  AuthenticatedActiveApplicationRevisionSelectionV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-activation-v1";
import type { ClaimedApplicationActionExecutionV1 } from
  "@flarex/persistence-postgres/internal/application-action-authority-v1";
import type { PreparedCandidateBoundEdgeActionRuntimeTargetV1 } from
  "flarex-backend/internal/candidate-bound-edge-action-runtime-target-v1";
import type { EdgeActionExactRuntimeRequestV1 } from
  "flarex-protocol/edge-action-exact-runtime";

declare const preparedEdgeActionDispatchBrand: unique symbol;
export interface PreparedActiveApplicationEdgeActionDispatchV1 {
  readonly [preparedEdgeActionDispatchBrand]: true;
}

export interface PreparedActiveApplicationEdgeActionDispatchStateV1 {
  readonly selection: AuthenticatedActiveApplicationRevisionSelectionV1;
  readonly execution: ClaimedApplicationActionExecutionV1;
  readonly runtimeTarget: PreparedCandidateBoundEdgeActionRuntimeTargetV1;
  readonly request: EdgeActionExactRuntimeRequestV1;
}

const states = new WeakMap<
  object,
  PreparedActiveApplicationEdgeActionDispatchStateV1
>();

export function issuePreparedActiveApplicationEdgeActionDispatchV1(
  state: PreparedActiveApplicationEdgeActionDispatchStateV1,
): PreparedActiveApplicationEdgeActionDispatchV1 {
  const prepared = Object.freeze({}) as
    PreparedActiveApplicationEdgeActionDispatchV1;
  states.set(prepared, state);
  return prepared;
}

export function revokePreparedActiveApplicationEdgeActionDispatchV1(
  prepared: PreparedActiveApplicationEdgeActionDispatchV1,
): void {
  states.delete(prepared);
}

export function claimPreparedActiveApplicationEdgeActionDispatchV1(
  prepared: unknown,
): PreparedActiveApplicationEdgeActionDispatchStateV1 | undefined {
  if (prepared === null || typeof prepared !== "object") return undefined;
  const state = states.get(prepared);
  if (state !== undefined) states.delete(prepared);
  return state;
}
