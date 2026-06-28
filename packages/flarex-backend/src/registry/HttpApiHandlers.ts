import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  RegistryApi,
  RegistryHealthResponse,
  RegistryStorageErrorResponse,
} from "flarex-protocol/registry";
import { RegistryService } from "./Service";
import type { RegistrySqlError } from "./Store";

export const RegistryApiHandlers = HttpApiBuilder.group(
  RegistryApi,
  "registry",
  Effect.fn("RegistryApiHandlers")(function* (handlers) {
    const registry = yield* RegistryService;

    return handlers
      .handle("health", () =>
        Effect.succeed(RegistryHealthResponse.make({
          service: "flarex-registry",
          status: "ok",
        }))
      )
      .handle("listDeployments", () =>
        mapRegistryStorageFailure(registry.listDeployments())
      )
      .handle("createDeployment", ({ payload }) =>
        mapRegistryStorageFailure(registry.createDeployment(payload))
      );
  }),
);

export function mapRegistryStorageFailure<A>(
  effect: Effect.Effect<A, RegistrySqlError>,
): Effect.Effect<A, RegistryStorageErrorResponse> {
  return effect.pipe(
    Effect.catchTag("RegistrySqlError", () =>
      Effect.fail(new RegistryStorageErrorResponse({
        error: "Registry storage error.",
      }))
    ),
  );
}
