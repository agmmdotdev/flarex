import { Layer } from "effect";
import { DeploymentClock, DeploymentIds } from "./Runtime";
import { DeploymentService } from "./Service";
import {
  DeploymentPushStore,
  type DeploymentSqlStorage,
  type DeploymentTransactionStorage,
} from "./Store";
import type { PushStatus } from "../types";

export function makeDeploymentLayer(
  storage: DeploymentTransactionStorage,
  sql: DeploymentSqlStorage,
  readPush: (pushId: string) => PushStatus | null,
) {
  return DeploymentService.layer.pipe(
    Layer.provide(DeploymentPushStore.layer(storage, sql, readPush)),
    Layer.provide(DeploymentClock.layer),
    Layer.provide(DeploymentIds.layer),
  );
}
