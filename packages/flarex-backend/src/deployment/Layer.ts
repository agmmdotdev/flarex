import { Layer } from "effect";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "./Runtime";
import { DeploymentService } from "./Service";
import {
  DeploymentPushStore,
  type DeploymentSqlStorage,
  type DeploymentTransactionStorage,
} from "./Store";

export function makeDeploymentLayer(
  storage: DeploymentTransactionStorage,
  sql: DeploymentSqlStorage,
) {
  return DeploymentService.layer.pipe(
    Layer.provide(DeploymentPushStore.layer(storage, sql)),
    Layer.provide(DeploymentArtifacts.layer),
    Layer.provide(DeploymentClock.layer),
    Layer.provide(DeploymentIds.layer),
  );
}
