import { Layer } from "effect";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "./Runtime";
import { DeploymentService } from "./Service";
import {
  DeploymentPushStore,
  type DeploymentSqlStorage,
  type DeploymentTransactionStorage,
} from "./Store";
import type { DeploymentFunctions, DeploymentSchema, PushStatus } from "../types";

export function makeDeploymentLayer(
  storage: DeploymentTransactionStorage,
  sql: DeploymentSqlStorage,
  readPush: (pushId: string) => PushStatus | null,
  applySchema: (schema: DeploymentSchema) => DeploymentSchema,
  applyFunctions: (functions: DeploymentFunctions) => DeploymentFunctions,
  setMeta: (key: string, value: string) => void,
) {
  return DeploymentService.layer.pipe(
    Layer.provide(DeploymentPushStore.layer(storage, sql, readPush, applySchema, applyFunctions, setMeta)),
    Layer.provide(DeploymentArtifacts.layer),
    Layer.provide(DeploymentClock.layer),
    Layer.provide(DeploymentIds.layer),
  );
}
