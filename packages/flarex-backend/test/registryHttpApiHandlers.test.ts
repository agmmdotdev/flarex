import { describe, expect, it } from "vitest";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { HttpApiGroup } from "effect/unstable/httpapi";
import {
  decodeDeploymentRecordEffect,
  decodeListDeploymentsResponseEffect,
  decodeRegistryHealthResponseEffect,
  decodeRegistryStorageErrorResponseEffect,
  ProtocolValidationError,
  RegistryApi,
  RegistryRoute,
  RegistryStorageErrorResponse,
  type DeploymentRecord,
} from "flarex-protocol/registry";
import {
  mapRegistryProtocolResponseFailure,
  mapRegistryStorageFailure,
  RegistryApiHandlers,
} from "../src/registry/HttpApiHandlers";
import { makeRegistryApiWebHandler } from "../src/registry/HttpApiWebHandler";
import { RegistryClock, RegistryIds } from "../src/registry/Runtime";
import { RegistryService } from "../src/registry/Service";
import {
  RegistrySqlError,
  RegistryStore,
  type CreateDeploymentStoreInput,
} from "../src/registry/Store";

async function decodeDeploymentRecordForTest(value: unknown) {
  return await Effect.runPromise(decodeDeploymentRecordEffect(value));
}

async function decodeListDeploymentsResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeListDeploymentsResponseEffect(value));
}

async function decodeRegistryHealthResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeRegistryHealthResponseEffect(value));
}

async function decodeRegistryStorageErrorResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeRegistryStorageErrorResponseEffect(value));
}

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
    expect(await decodeRegistryStorageErrorResponseForTest(error)).toEqual({
      error: "Registry storage error.",
    });
  });

  it("maps registry protocol response validation failures to the declared HttpApi error body", async () => {
    const protocolError = new ProtocolValidationError({
      schema: "DeploymentRecord",
      message: "Deployment record response did not match the registry protocol.",
      cause: new Error("bad generated response"),
    });

    const error = await Effect.runPromise(
      mapRegistryProtocolResponseFailure(Effect.fail(protocolError)).pipe(
        Effect.match({
          onFailure: value => value,
          onSuccess: () => undefined,
        }),
      ),
    );

    expect(error).toBeInstanceOf(RegistryStorageErrorResponse);
    expect(await decodeRegistryStorageErrorResponseForTest(error)).toEqual({
      error: "Registry storage error.",
    });
  });

  it("creates a Worker-compatible web handler for current RegistryApi routes", async () => {
    const { handler, dispose } = makeRegistryApiWebHandler(registryTestLayer({
      now: 1_700_000,
      generatedId: "generated-deployment",
      store: {
        createDeployment: input => Effect.succeed(deploymentFromStoreInput(input)),
        listDeployments: Effect.succeed([
          deploymentFromStoreInput({
            deploymentId: "listed-deployment",
            slug: "listed-slug",
            now: 1_700_001,
          }),
        ]),
      },
    }));
    try {
      const health = await handler(new Request(`https://registry.test${RegistryRoute.health}`));
      expect(health.status).toBe(200);
      expect(await decodeRegistryHealthResponseForTest(await health.json())).toEqual({
        service: "flarex-registry",
        status: "ok",
      });

      const created = await handler(new Request(
        `https://registry.test${RegistryRoute.deployments}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "created-slug" }),
        },
      ));
      expect(created.status).toBe(200);
      expect(await decodeDeploymentRecordForTest(await created.json())).toEqual({
        deploymentId: "generated-deployment",
        slug: "created-slug",
        createdAt: 1_700_000,
        updatedAt: 1_700_000,
        schemaVersion: 0,
      });

      const listed = await handler(new Request(`https://registry.test${RegistryRoute.deployments}`));
      expect(listed.status).toBe(200);
      expect(await decodeListDeploymentsResponseForTest(await listed.json())).toEqual({
        deployments: [{
          deploymentId: "listed-deployment",
          slug: "listed-slug",
          createdAt: 1_700_001,
          updatedAt: 1_700_001,
          schemaVersion: 0,
        }],
      });
    } finally {
      await dispose();
    }
  });

  it("maps service response protocol mismatches to the declared registry storage error", async () => {
    const { handler, dispose } = makeRegistryApiWebHandler(registryTestLayer({
      now: 1_700_000,
      generatedId: "generated-deployment",
      store: {
        createDeployment: input => {
          const malformedRecord = {
            ...deploymentFromStoreInput(input),
            schemaVersion: "bad-version",
          };
          return Effect.succeed(malformedRecord as unknown as DeploymentRecord);
        },
        listDeployments: Effect.succeed([]),
      },
    }));
    try {
      const response = await handler(new Request(
        `https://registry.test${RegistryRoute.deployments}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deploymentId: "malformed-record" }),
        },
      ));

      expect(response.status).toBe(500);
      expect(await decodeRegistryStorageErrorResponseForTest(await response.json())).toEqual({
        error: "Registry storage error.",
      });
    } finally {
      await dispose();
    }
  });

  it("maps malformed list response payloads through the protocol Effect decoder", async () => {
    const { handler, dispose } = makeRegistryApiWebHandler(registryTestLayer({
      now: 1_700_000,
      generatedId: "generated-deployment",
      store: {
        createDeployment: input => Effect.succeed(deploymentFromStoreInput(input)),
        listDeployments: Effect.succeed([{
          deploymentId: "malformed-listed-record",
          createdAt: 1_700_001,
          updatedAt: 1_700_001,
          schemaVersion: "bad-version",
        } as unknown as DeploymentRecord]),
      },
    }));
    try {
      const response = await handler(new Request(`https://registry.test${RegistryRoute.deployments}`));

      expect(response.status).toBe(500);
      expect(await decodeRegistryStorageErrorResponseForTest(await response.json())).toEqual({
        error: "Registry storage error.",
      });
    } finally {
      await dispose();
    }
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
