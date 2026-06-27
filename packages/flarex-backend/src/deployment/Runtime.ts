import { Context, DateTime, Effect, Layer } from "effect";

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
