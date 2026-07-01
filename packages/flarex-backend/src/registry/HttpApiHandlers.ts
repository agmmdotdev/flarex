import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  decodeDeploymentRecordEffect,
  decodeListDeploymentsResponseEffect,
  RegistryApi,
  RegistryHealthResponse,
  RegistryStorageErrorResponse,
  type CreateDeploymentRequest,
  type DeploymentRecord,
  type ListDeploymentsResponse,
  type ProtocolValidationError,
} from "flarex-protocol/registry";
import { RegistryService, type RegistryServiceApi } from "./Service";
import type { RegistrySqlError } from "./Store";

export const RegistryApiHandlers = HttpApiBuilder.group(
  RegistryApi,
  "registry",
  Effect.fn("RegistryApiHandlers")(function* (handlers) {
    const registry = yield* RegistryService;

    return handlers
      .handle("health", () => registryHealthHandler())
      .handle("listDeployments", () =>
        registryListDeploymentsHandler(registry)
      )
      .handle("createDeployment", ({ payload }) =>
        registryCreateDeploymentHandler(registry, payload)
      );
  }),
);

export const registryHealthHandler = Effect.fn(
  "RegistryApiHandlers.health",
)(function* (): Effect.fn.Return<RegistryHealthResponse> {
  return yield* Effect.succeed(RegistryHealthResponse.make({
    service: "flarex-registry",
    status: "ok",
  }));
});

export const registryListDeploymentsHandler = Effect.fn(
  "RegistryApiHandlers.listDeployments",
)(function* (
  registry: RegistryServiceApi,
): Effect.fn.Return<ListDeploymentsResponse, RegistryStorageErrorResponse> {
  return yield* mapRegistryStorageFailure(registry.listDeployments()).pipe(
    Effect.flatMap(decodeListDeploymentsResponseForHttpApi),
  );
});

export const registryCreateDeploymentHandler = Effect.fn(
  "RegistryApiHandlers.createDeployment",
)(function* (
  registry: RegistryServiceApi,
  payload: CreateDeploymentRequest,
): Effect.fn.Return<DeploymentRecord, RegistryStorageErrorResponse> {
  return yield* mapRegistryStorageFailure(registry.createDeployment(payload)).pipe(
    Effect.flatMap(decodeDeploymentRecordForHttpApi),
  );
});

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

export function mapRegistryProtocolResponseFailure<A>(
  effect: Effect.Effect<A, ProtocolValidationError>,
): Effect.Effect<A, RegistryStorageErrorResponse> {
  return effect.pipe(
    Effect.catchTag("ProtocolValidationError", () =>
      Effect.fail(new RegistryStorageErrorResponse({
        error: "Registry storage error.",
      }))
    ),
  );
}

const decodeDeploymentRecordForHttpApi = (value: unknown) =>
  mapRegistryProtocolResponseFailure(decodeDeploymentRecordEffect(value));

const decodeListDeploymentsResponseForHttpApi = (value: unknown) =>
  mapRegistryProtocolResponseFailure(decodeListDeploymentsResponseEffect(value));
