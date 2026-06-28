import { describe, expect, it } from "vitest";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { HttpApiGroup } from "effect/unstable/httpapi";
import {
  parseRegistryStorageErrorResponse,
  RegistryApi,
  RegistryStorageErrorResponse,
  type DeploymentRecord,
} from "flarex-protocol/registry";
import {
  mapRegistryStorageFailure,
  RegistryApiHandlers,
} from "../src/registry/HttpApiHandlers";
import { RegistryClock, RegistryIds } from "../src/registry/Runtime";
import { RegistryService } from "../src/registry/Service";
import {
  RegistrySqlError,
  RegistryStore,
  type CreateDeploymentStoreInput,
} from "../src/registry/Store";

describe("RegistryApiHandlers", () => {
  it("registers handlers for the current RegistryApi endpoints", async () => {
    const runtime = ManagedRuntime.make(
      RegistryApiHandlers.pipe(
        Layer.provide(registryTestLayer({
          now: 1_700_000,
          generatedId: "generated-deployment",
          store: {
            createDeployment: input => Effect.succeed(deploymentFromStoreInput(input)),
            listDeployments: Effect.succeed([]),
          },
        })),
      ),
    );
    try {
      const group = await runtime.runPromise(RegistryApiGroupContext);

      expect(Array.from(group.handlers.keys()).sort()).toEqual([
        "createDeployment",
        "health",
        "listDeployments",
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("maps registry storage failures to the declared HttpApi 500 error body", async () => {
    const failure = new RegistrySqlError({
      operation: "listDeployments",
      cause: new Error("list failed"),
    });

    const error = await Effect.runPromise(
      mapRegistryStorageFailure(Effect.fail(failure)).pipe(
        Effect.match({
          onFailure: value => value,
          onSuccess: () => undefined,
        }),
      ),
    );

    expect(error).toBeInstanceOf(RegistryStorageErrorResponse);
    expect(parseRegistryStorageErrorResponse(error)).toEqual({
      error: "Registry storage error.",
    });
  });
});

type RegistryApiGroupId = HttpApiGroup.ApiGroup<"flarex-registry", "registry">;

const RegistryApiGroupContext = Context.Service<RegistryApiGroupId, {
  readonly handlers: ReadonlyMap<string, unknown>;
}>(RegistryApi.groups.registry.key);

interface RegistryTestStore {
  createDeployment(input: CreateDeploymentStoreInput): Effect.Effect<DeploymentRecord, RegistrySqlError>;
  readonly listDeployments: Effect.Effect<ReadonlyArray<DeploymentRecord>, RegistrySqlError>;
}

interface RegistryTestLayerOptions {
  readonly now: number;
  readonly generatedId: string;
  readonly store: RegistryTestStore;
}

function registryTestLayer(options: RegistryTestLayerOptions) {
  return RegistryService.layer.pipe(
    Layer.provide(
      Layer.succeed(
        RegistryStore,
        RegistryStore.of({
          createDeployment: options.store.createDeployment,
          listDeployments: options.store.listDeployments,
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        RegistryClock,
        RegistryClock.of({
          currentTimeMillis: Effect.succeed(options.now),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        RegistryIds,
        RegistryIds.of({
          deploymentId: Effect.succeed(options.generatedId),
        }),
      ),
    ),
  );
}

function deploymentFromStoreInput(input: CreateDeploymentStoreInput): DeploymentRecord {
  return {
    deploymentId: input.deploymentId,
    ...(input.slug === undefined ? {} : { slug: input.slug }),
    createdAt: input.now,
    updatedAt: input.now,
    schemaVersion: 0,
  };
}
