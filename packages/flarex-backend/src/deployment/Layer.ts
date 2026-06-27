import { Layer } from "effect";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "./Runtime";
import { DeploymentService } from "./Service";
import {
  DeploymentPushStore,
  type DeploymentSqlStorage,
  type DeploymentTransactionStorage,
} from "./Store";
import type { DeploymentFunctions, DeploymentSchema } from "../types";

export function makeDeploymentLayer(
  storage: DeploymentTransactionStorage,
  sql: DeploymentSqlStorage,
  applySchema: (schema: DeploymentSchema) => DeploymentSchema,
  applyFunctions: (functions: DeploymentFunctions) => DeploymentFunctions,
  setMeta: (key: string, value: string) => void,
  getMeta: (key: string) => string | null,
) {
  return DeploymentService.layer.pipe(
    Layer.provide(DeploymentPushStore.layer(storage, sql, applySchema, applyFunctions, setMeta, getMeta)),
    Layer.provide(DeploymentArtifacts.layer),
    Layer.provide(DeploymentClock.layer),
    Layer.provide(DeploymentIds.layer),
  );
}
