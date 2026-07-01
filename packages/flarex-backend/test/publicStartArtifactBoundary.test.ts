import { Effect } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { describe, expect, it } from "vitest";
import type { BackendExecutionArtifactStore } from "../src/artifactStore";
import {
  decodePublicStartArtifactRef,
  persistAnalyzedSourcePackageEffect,
} from "../src/deployment/PublicStartArtifactBoundary";
import type {
  ExecutionArtifactRef,
  AnalyzedStartPushRequest,
  PushSourcePackage,
} from "../src/types";

describe("public start artifact boundary", () => {
  it("skips persistence when durable artifact storage is not configured", async () => {
    const request = analyzedStartPushRequest();

    await expect(Effect.runPromise(
      persistAnalyzedSourcePackageEffect(undefined, request),
    )).resolves.toBeUndefined();
  });

  it("skips persistence for failed analyzer results", async () => {
    const stored: PushSourcePackage[] = [];
    const request = failedStartPushRequest();

    await expect(Effect.runPromise(
      persistAnalyzedSourcePackageEffect(artifactStore(stored), request),
    )).resolves.toBeUndefined();

    expect(stored).toEqual([]);
  });

  it("persists successful analyzed source packages", async () => {
    const stored: PushSourcePackage[] = [];
    const request = analyzedStartPushRequest();

    await expect(Effect.runPromise(
      persistAnalyzedSourcePackageEffect(artifactStore(stored), request),
    )).resolves.toBeUndefined();

    expect(stored).toEqual([request.sourcePackage]);
  });

  it("maps artifact store failures into the public worker dispatch error channel", async () => {
    const failure = await Effect.runPromise(Effect.flip(
      persistAnalyzedSourcePackageEffect(failingArtifactStore(), analyzedStartPushRequest()),
    ));

    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-start-push-store-artifact",
      status: 500,
      message: "artifact write failed",
    });
  });

  it("schema-checks artifact refs returned from public start artifact storage", async () => {
    const validRef = await executionArtifactRefForSourcePackage(sourcePackage());
    await expect(Effect.runPromise(decodePublicStartArtifactRef(validRef)))
      .resolves
      .toEqual(validRef);

    const invalidRef = await Effect.runPromise(Effect.flip(
      decodePublicStartArtifactRef({ ...validRef, artifactId: "not-an-artifact" }),
    ));
    expect(invalidRef).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-start-push-store-artifact",
      status: 500,
      message: "Stored execution artifact reference has an invalid artifact ID.",
    });
  });

  it("keeps invalid artifact store write responses in the public worker dispatch channel", async () => {
    const failure = await Effect.runPromise(Effect.flip(
      persistAnalyzedSourcePackageEffect(invalidRefArtifactStore(), analyzedStartPushRequest()),
    ));

    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-start-push-store-artifact",
      status: 500,
      message: "Stored execution artifact reference has an invalid source package hash.",
    });
  });
});

function artifactStore(stored: PushSourcePackage[]): BackendExecutionArtifactStore {
  return {
    put: async sourcePackage => {
      stored.push(sourcePackage);
      return executionArtifactRefForSourcePackage(sourcePackage);
    },
    get: async () => {
      throw new Error("unused");
    },
  };
}

function failingArtifactStore(): BackendExecutionArtifactStore {
  return {
    put: async () => {
      throw new Error("artifact write failed");
    },
    get: async () => {
      throw new Error("unused");
    },
  };
}

function invalidRefArtifactStore(): BackendExecutionArtifactStore {
  return {
    put: async sourcePackage => {
      const ref = await executionArtifactRefForSourcePackage(sourcePackage);
      return {
        ...ref,
        sourcePackageHash: "not-a-hash",
      } as ExecutionArtifactRef;
    },
    get: async () => {
      throw new Error("unused");
    },
  };
}

function analyzedStartPushRequest(): AnalyzedStartPushRequest {
  return {
    sourcePackage: sourcePackage(),
    analysis: {
      schema: { version: 1, tables: [], indexes: [] },
      functions: { functions: [] },
    },
    codegenAnalysis: {
      schema: { version: 1, tables: [], indexes: [] },
      functions: [],
    },
  };
}

function failedStartPushRequest(): AnalyzedStartPushRequest {
  return {
    sourcePackage: sourcePackage(),
    error: "analysis failed",
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
