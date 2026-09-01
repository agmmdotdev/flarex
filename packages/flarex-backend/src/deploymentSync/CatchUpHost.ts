import {
  makeNamespaceCatchUp,
  type CatchUpTurnBudget,
  type NamespaceQuerySyncPolicy,
} from "@flarex/query-sync/internal/orchestration";
import { Effect } from "effect";

import type { ExecutorHttpEnv } from "../executorHttp";
import {
  type DeploymentQuerySyncBinding,
  type DeploymentQuerySyncFreshInitializationCapability,
} from "./Binding";
import { makeFlarexPostgresAdmittedChangeSourceV1 } from "./QuerySyncSource";
import { makeDeploymentQuerySyncStateFromBinding } from "./Store";
import type { DeploymentQuerySyncStorage } from "./StorageContract";

const RETRY_DELAYS_MILLISECONDS: readonly [number, number] =
  Object.freeze([50, 250]);

export const DEPLOYMENT_SYNC_CATCH_UP_POLICY: NamespaceQuerySyncPolicy =
  Object.freeze({
    stateAttemptsPerOperation: 3,
    sourceAttemptsPerRead: 3,
    retryDelayMilliseconds: RETRY_DELAYS_MILLISECONDS,
    settlementReserveMilliseconds: 1_000,
  });

export interface DeploymentSyncCatchUpTurnRequest {
  readonly binding: DeploymentQuerySyncBinding;
  readonly budget: CatchUpTurnBudget;
  readonly freshInitializationCapability?:
    DeploymentQuerySyncFreshInitializationCapability;
}

export interface DeploymentSyncCatchUpTurnInput {
  readonly env: ExecutorHttpEnv;
  readonly storage: DeploymentQuerySyncStorage;
  readonly request: DeploymentSyncCatchUpTurnRequest;
}

export const runDeploymentSyncCatchUpTurn = Effect.fn(
  "DeploymentSyncCatchUpHost.runTurn",
)(function* (
  input: DeploymentSyncCatchUpTurnInput,
) {
  const binding = input.request.binding;
  const source = yield* Effect.fromResult(
    makeFlarexPostgresAdmittedChangeSourceV1(input.env),
  );
  const state = yield* makeDeploymentQuerySyncStateFromBinding({
    binding,
    storage: input.storage,
    ...(input.request.freshInitializationCapability === undefined
      ? {}
      : {
        freshInitializationCapability:
          input.request.freshInitializationCapability,
      }),
  });
  const catchUp = yield* Effect.fromResult(makeNamespaceCatchUp({
    bootstrapCursor: binding.bootstrapCursor,
    source,
    state,
    policy: DEPLOYMENT_SYNC_CATCH_UP_POLICY,
  }));
  return yield* catchUp.catchUp(input.request.budget);
});

export type DeploymentSyncCatchUpTurnError = Effect.Error<
  ReturnType<typeof runDeploymentSyncCatchUpTurn>
>;
