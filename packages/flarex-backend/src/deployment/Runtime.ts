import { Context, DateTime, Effect, Layer } from "effect";
import { executionArtifactRefForSourcePackage as buildExecutionArtifactRefForSourcePackage } from "flarex/artifacts";
import type { ExecutionArtifactRef, PushSourcePackage } from "../types";
import { DeploymentArtifactRefError } from "./Errors";

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

export const executionArtifactRefForSourcePackageEffect = Effect.fn(
  "DeploymentArtifacts.executionArtifactRefForSourcePackage",
)(function* (
  sourcePackage: PushSourcePackage,
): Effect.fn.Return<ExecutionArtifactRef, DeploymentArtifactRefError> {
  return yield* Effect.tryPromise({
    try: () => buildExecutionArtifactRefForSourcePackage(sourcePackage),
    catch: cause => new DeploymentArtifactRefError({
      operation: "executionArtifactRefForSourcePackage",
      message: cause instanceof Error
        ? cause.message
        : "Execution artifact ref generation failed.",
      cause,
    }),
  });
});

export class DeploymentArtifacts extends Context.Service<DeploymentArtifacts, {
  executionArtifactRefForSourcePackage(
    sourcePackage: PushSourcePackage,
  ): Effect.Effect<ExecutionArtifactRef, DeploymentArtifactRefError>;
}>()("flarex-backend/deployment/DeploymentArtifacts") {
  static readonly layer = Layer.succeed(
    DeploymentArtifacts,
    DeploymentArtifacts.of({
      executionArtifactRefForSourcePackage: sourcePackage =>
        executionArtifactRefForSourcePackageEffect(sourcePackage),
    }),
  );
}
