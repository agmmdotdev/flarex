import { Context, DateTime, Effect, Layer } from "effect";

export class RegistryClock extends Context.Service<RegistryClock, {
  readonly currentTimeMillis: Effect.Effect<number>;
}>()("flarex-backend/registry/RegistryClock") {
  static readonly layer = Layer.succeed(
    RegistryClock,
    RegistryClock.of({
      currentTimeMillis: DateTime.now.pipe(Effect.map(DateTime.toEpochMillis)),
    }),
  );
}

export class RegistryIds extends Context.Service<RegistryIds, {
  readonly deploymentId: Effect.Effect<string>;
}>()("flarex-backend/registry/RegistryIds") {
  static readonly layer = Layer.succeed(
    RegistryIds,
    RegistryIds.of({
      deploymentId: Effect.sync(() => crypto.randomUUID()),
    }),
  );
}
