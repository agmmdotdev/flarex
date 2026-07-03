import { Effect } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { describe, expect, it } from "vitest";
import type { BackendExecutionArtifactStore } from "../src/artifactStore";
import {
  decodeFinishArtifactSourcePackage,
  decodeFinishArtifactPushStatus,
  executionArtifactRefForFinishArtifactEffect,
  readFinishArtifactAvailabilityEffect,
  readFinishArtifactPushStatusJson,
  verifyStoredPushArtifactEffect,
} from "../src/deployment/PublicFinishArtifactBoundary";
import { executionArtifactRefForSourcePackageEffect } from "../src/deployment/Runtime";
import type { ExecutionArtifactRef, PushSourcePackage, PushStatus } from "../src/types";
import { publicWorkerDispatchError } from "../src/worker/PublicRouteDispatchError";

describe("public finish artifact boundary", () => {
  it("decodes push-status responses through typed Effect helpers", async () => {
    const status = analyzedPushStatus();
    await expect(Effect.runPromise(readFinishArtifactPushStatusJson(Response.json(status))))
      .resolves
      .toEqual(status);
    await expect(Effect.runPromise(decodeFinishArtifactPushStatus(status)))
      .resolves
      .toEqual(status);
  });

  it("keeps push-status response decode failures in the dispatch error channel", async () => {
    const jsonFailure = await Effect.runPromise(Effect.flip(
      readFinishArtifactPushStatusJson(new Response("{", { status: 200 })),
    ));
    expect(jsonFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-finish-push-artifact",
      status: 500,
    });

    const semanticFailure = await Effect.runPromise(Effect.flip(decodeFinishArtifactPushStatus(null)));
    expect(semanticFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-finish-push-artifact",
      status: 500,
    });
  });

  it("skips artifact preflight when durable artifact storage is not configured", async () => {
    let fetchCalled = false;

    await expect(Effect.runPromise(verifyStoredPushArtifactEffect(undefined, Effect.sync(() => {
      fetchCalled = true;
      return Response.json(analyzedPushStatus());
    })))).resolves.toBeUndefined();
    expect(fetchCalled).toBe(false);
  });

  it("skips artifact preflight for missing or non-analyzed pushes", async () => {
    const store = artifactStore({ available: true });

    await expect(Effect.runPromise(verifyStoredPushArtifactEffect(
      store,
      Effect.succeed(Response.json({ error: "Unknown push." }, { status: 404 })),
    ))).resolves.toBeUndefined();
    await expect(Effect.runPromise(verifyStoredPushArtifactEffect(
      store,
      Effect.succeed(Response.json({ ...analyzedPushStatus(), state: "failed" })),
    ))).resolves.toBeUndefined();
  });

  it("returns the existing missing-artifact finish rejection response", async () => {
    const package_ = sourcePackage();
    const status = analyzedPushStatus(package_);
    const ref = await executionArtifactRefForSourcePackage(package_);

    const response = await Effect.runPromise(verifyStoredPushArtifactEffect(
      artifactStore({ available: false }),
      Effect.succeed(Response.json(status)),
    ));

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      result: "rejected",
      push: status,
      code: "missing_artifact",
      error: `Execution artifact ${ref.artifactId} is not available in durable storage.`,
    });
  });

  it("resolves finish artifact refs and availability through typed Effect sources", async () => {
    const package_ = sourcePackage();
    const ref = await Effect.runPromise(executionArtifactRefForFinishArtifactEffect(package_));

    expect(ref).toEqual(await executionArtifactRefForSourcePackage(package_));
    await expect(Effect.runPromise(executionArtifactRefForSourcePackageEffect(package_)))
      .resolves
      .toEqual(ref);
    await expect(Effect.runPromise(decodeFinishArtifactSourcePackage(package_)))
      .resolves
      .toEqual(package_);
    await expect(Effect.runPromise(readFinishArtifactAvailabilityEffect(
      artifactStore({ available: true }),
      ref,
    ))).resolves.toBe(true);
  });

  it("keeps finish artifact availability failures in the dispatch error channel before route policy", async () => {
    const availabilityFailure = await Effect.runPromise(Effect.flip(
      readFinishArtifactAvailabilityEffect(throwingArtifactStore(), executionArtifactRef()),
    ));
    expect(availabilityFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-finish-push-artifact",
      status: 500,
    });

    const invalidSourcePackageFailure = await Effect.runPromise(Effect.flip(
      decodeFinishArtifactSourcePackage({
        ...sourcePackage(),
        modules: "not-modules",
      }),
    ));
    expect(invalidSourcePackageFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-finish-push-artifact",
      status: 500,
    });

    const invalidStoreReadFailure = await Effect.runPromise(Effect.flip(
      readFinishArtifactAvailabilityEffect(
        invalidSourcePackageArtifactStore(),
        executionArtifactRef(),
      ),
    ));
    expect(invalidStoreReadFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-finish-push-artifact",
      status: 500,
    });
  });

  it("treats synchronous artifact lookup failures as missing artifacts", async () => {
    const package_ = sourcePackage();
    const status = analyzedPushStatus(package_);
    const ref = await executionArtifactRefForSourcePackage(package_);

    const response = await Effect.runPromise(verifyStoredPushArtifactEffect(
      throwingArtifactStore(),
      Effect.succeed(Response.json(status)),
    ));

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      result: "rejected",
      push: status,
      code: "missing_artifact",
      error: `Execution artifact ${ref.artifactId} is not available in durable storage.`,
    });
  });

  it("keeps fetch and push-status JSON failures in the dispatch error channel", async () => {
    const fetchFailure = await Effect.runPromise(Effect.flip(verifyStoredPushArtifactEffect(
      artifactStore({ available: true }),
      Effect.fail(publicWorkerDispatchError(
        "deployment-finish-push-artifact",
        new Error("deployment unavailable"),
      )),
    )));
    expect(fetchFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-finish-push-artifact",
      status: 500,
      message: "deployment unavailable",
    });

    const jsonFailure = await Effect.runPromise(Effect.flip(verifyStoredPushArtifactEffect(
      artifactStore({ available: true }),
      Effect.succeed(new Response("{", { status: 200 })),
    )));
    expect(jsonFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-finish-push-artifact",
      status: 500,
    });

    const semanticFailure = await Effect.runPromise(Effect.flip(verifyStoredPushArtifactEffect(
      artifactStore({ available: true }),
      Effect.succeed(Response.json(null)),
    )));
    expect(semanticFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-finish-push-artifact",
      status: 500,
    });
  });
});

function artifactStore(options: { readonly available: boolean }): BackendExecutionArtifactStore {
  return {
    put: async sourcePackage => executionArtifactRefForSourcePackage(sourcePackage),
    get: async ref => {
      if (!options.available) {
        throw new Error(`Unknown execution artifact: ${ref.artifactId}`);
      }
      return sourcePackage();
    },
  };
}

function throwingArtifactStore(): BackendExecutionArtifactStore {
  return {
    put: async sourcePackage => executionArtifactRefForSourcePackage(sourcePackage),
    get: () => {
      throw new Error("artifact store unavailable");
    },
  };
}

function invalidSourcePackageArtifactStore(): BackendExecutionArtifactStore {
  return {
    put: async sourcePackage => executionArtifactRefForSourcePackage(sourcePackage),
    get: async () => ({
      ...sourcePackage(),
      functions: "not-functions",
    } as unknown as PushSourcePackage),
  };
}

function analyzedPushStatus(source = sourcePackage()): PushStatus {
  return {
    pushId: "push-artifact",
    state: "analyzed",
    sourcePackage: source,
    analysis: {
      schema: { version: 1, tables: [], indexes: [] },
      functions: { functions: [] },
    },
    codegenAnalysis: {
      schema: { version: 1, tables: [], indexes: [] },
      functions: [],
    },
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function executionArtifactRef(): ExecutionArtifactRef {
  return {
    runtime: "dynamic-worker",
    artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourcePackageHash: "a".repeat(64),
    executionModule: "__execution.ts",
  };
}

function sourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "__execution.ts",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
    ],
    functions: [],
    execution: "__execution.ts",
  };
}
