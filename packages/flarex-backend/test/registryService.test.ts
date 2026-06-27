import { describe, expect, it } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { DeploymentRecord } from "flarex-protocol/registry";
import { RegistryClock, RegistryIds } from "../src/registry/Runtime";
import { RegistryService } from "../src/registry/Service";
import {
  RegistrySqlError,
  RegistryStore,
  type CreateDeploymentStoreInput,
} from "../src/registry/Store";

describe("RegistryService", () => {
  it("creates deployments with the controlled clock and explicit deployment id", async () => {
    const writes: CreateDeploymentStoreInput[] = [];
    const result = await runRegistry(
      RegistryService.use(service =>
        service.createDeployment({
          deploymentId: "explicit-deployment",
          slug: "explicit-slug",
        }),
      ),
      {
        now: 1_700_000,
        generatedId: "unused-generated-id",
        store: {
          createDeployment: input =>
            Effect.sync(() => {
              writes.push(input);
              return deploymentFromStoreInput(input);
            }),
          listDeployments: Effect.succeed([]),
        },
      },
    );

    expect(writes).toEqual([
      {
        deploymentId: "explicit-deployment",
        slug: "explicit-slug",
        now: 1_700_000,
      },
    ]);
    expect(result).toEqual({
      deploymentId: "explicit-deployment",
      slug: "explicit-slug",
      createdAt: 1_700_000,
      updatedAt: 1_700_000,
      schemaVersion: 0,
    });
  });

  it("uses the id service when create request omits deploymentId", async () => {
    const writes: CreateDeploymentStoreInput[] = [];
    const result = await runRegistry(
      RegistryService.use(service =>
        service.createDeployment({
          slug: "generated-slug",
        }),
      ),
      {
        now: 1_800_000,
        generatedId: "generated-deployment",
        store: {
          createDeployment: input =>
            Effect.sync(() => {
              writes.push(input);
              return deploymentFromStoreInput(input);
            }),
          listDeployments: Effect.succeed([]),
        },
      },
    );

    expect(writes).toEqual([
      {
        deploymentId: "generated-deployment",
        slug: "generated-slug",
        now: 1_800_000,
      },
    ]);
    expect(result.deploymentId).toBe("generated-deployment");
  });

  it("wraps store list results in the registry response contract", async () => {
    const deployments: ReadonlyArray<DeploymentRecord> = [
      {
        deploymentId: "listed-deployment",
        createdAt: 2_000_000,
        updatedAt: 2_000_100,
        schemaVersion: 0,
      },
    ];

    const result = await runRegistry(
      RegistryService.use(service => service.listDeployments()),
      {
        now: 2_000_000,
        generatedId: "unused-generated-id",
        store: {
          createDeployment: input => Effect.succeed(deploymentFromStoreInput(input)),
          listDeployments: Effect.succeed(deployments),
        },
      },
    );

    expect(result).toEqual({ deployments });
  });

  it("preserves typed RegistrySqlError failures from the store", async () => {
    const createFailure = new RegistrySqlError({
      operation: "createDeployment",
      cause: new Error("create failed"),
    });
    const listFailure = new RegistrySqlError({
      operation: "listDeployments",
      cause: new Error("list failed"),
    });
    const store = {
      createDeployment: (_input: CreateDeploymentStoreInput) => Effect.fail(createFailure),
      listDeployments: Effect.fail(listFailure),
    };

    const createError = await runRegistry(
      RegistryService.use(service => service.createDeployment({})).pipe(
        Effect.catchTag("RegistrySqlError", error => Effect.succeed(error)),
      ),
      {
        now: 3_000_000,
        generatedId: "generated-deployment",
        store,
      },
    );
    const listError = await runRegistry(
      RegistryService.use(service => service.listDeployments()).pipe(
        Effect.catchTag("RegistrySqlError", error => Effect.succeed(error)),
      ),
      {
        now: 3_000_000,
        generatedId: "generated-deployment",
        store,
      },
    );

    expect(createError).toBe(createFailure);
    expect(listError).toBe(listFailure);
  });
});

interface RegistryTestStore {
  createDeployment(input: CreateDeploymentStoreInput): Effect.Effect<DeploymentRecord, RegistrySqlError>;
  readonly listDeployments: Effect.Effect<ReadonlyArray<DeploymentRecord>, RegistrySqlError>;
}

interface RegistryTestLayerOptions {
  readonly now: number;
  readonly generatedId: string;
  readonly store: RegistryTestStore;
}

async function runRegistry<A, E>(
  effect: Effect.Effect<A, E, RegistryService>,
  options: RegistryTestLayerOptions,
): Promise<A> {
  const runtime = ManagedRuntime.make(registryTestLayer(options));
  try {
    return await runtime.runPromise(effect);
  } finally {
    await runtime.dispose();
  }
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
