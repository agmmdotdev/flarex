import { Context, DateTime, Effect, Layer } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import type { ExecutionArtifactRef, PushSourcePackage } from "../types";

export class DeploymentClock extends Context.Service<DeploymentClock, {
  readonly currentTimeMillis: Effect.Effect<number>;
}>()("flarex-backend/deployment/DeploymentClock") {
  static readonly layer = Layer.succeed(
    DeploymentClock,
    DeploymentClock.of({
      currentTimeMillis: DateTime.now.pipe(Effect.map(DateTime.toEpochMillis)),
    }),
  );
}

export class DeploymentIds extends Context.Service<DeploymentIds, {
  readonly pushId: Effect.Effect<string>;
}>()("flarex-backend/deployment/DeploymentIds") {
  static readonly layer = Layer.succeed(
    DeploymentIds,
    DeploymentIds.of({
      pushId: Effect.sync(() => crypto.randomUUID()),
    }),
  );
}

export class DeploymentArtifacts extends Context.Service<DeploymentArtifacts, {
  executionArtifactRefForSourcePackage(
    sourcePackage: PushSourcePackage,
  ): Effect.Effect<ExecutionArtifactRef>;
}>()("flarex-backend/deployment/DeploymentArtifacts") {
  static readonly layer = Layer.succeed(
    DeploymentArtifacts,
    DeploymentArtifacts.of({
      executionArtifactRefForSourcePackage: sourcePackage =>
        Effect.promise(() => executionArtifactRefForSourcePackage(sourcePackage)),
    }),
  );
}
