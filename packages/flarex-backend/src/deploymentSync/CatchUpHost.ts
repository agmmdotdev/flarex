import { runCheckpointTurn, type CheckpointBudget } from "@flarex/query-sync/internal/checkpoint";
import { Effect } from "effect";
import type { CoreApplicationRouteIdentity } from "flarex-protocol/internal/core-application";
import type { ExecutorHttpEnv } from "../executorHttp";
import { makeDeploymentCheckpointSource } from "./CheckpointSource";
import { makeDeploymentCheckpointStore, type DeploymentCheckpointStorage } from "./CheckpointStore";

export interface DeploymentSyncCatchUpTurnInput {
  readonly env: ExecutorHttpEnv;
  readonly storage: DeploymentCheckpointStorage;
  readonly request: Readonly<{ route: CoreApplicationRouteIdentity; budget: CheckpointBudget;
    authorizeFreshInitialization: boolean }>;
}

export const runDeploymentSyncCatchUpTurn = Effect.fn("DeploymentSyncCatchUpHost.runTurn")(function* (
  input: DeploymentSyncCatchUpTurnInput,
) {
  return yield* runCheckpointTurn({ namespaceId: input.request.route.scopeUuid,
    source: makeDeploymentCheckpointSource(input.env, input.request.route),
    store: makeDeploymentCheckpointStore(input.storage, input.request.route),
    budget: input.request.budget, authorizeFreshInitialization: input.request.authorizeFreshInitialization });
});