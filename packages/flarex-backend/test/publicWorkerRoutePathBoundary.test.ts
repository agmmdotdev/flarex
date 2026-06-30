import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deploymentPushActionFromPath,
  MissingDeploymentPushIdError,
  MissingPublicDeploymentIdError,
  MissingPublicPartitionKeyError,
  publicDeploymentIdFromPartsEffect,
  publicDeploymentPushPathFromPartsEffect,
  publicPartitionKeyFromPartsEffect,
  publicRoutePathErrorToHttpError,
} from "../src/worker/PublicRoutePathBoundary";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

let harness: BackendHarness;

beforeAll(async () => {
  harness = await createBackendHarness();
});

afterAll(async () => {
  await harness.dispose();
});

describe("public Worker route path boundary", () => {
  it("keeps deployment, push, and partition path parsing typed before HTTP mapping", async () => {
    await expect(Effect.runPromise(publicDeploymentIdFromPartsEffect([
      "deployments",
      "deployment-a",
    ]))).resolves.toBe("deployment-a");
    await expect(Effect.runPromise(publicDeploymentIdFromPartsEffect(["deployments"])))
      .rejects.toBeInstanceOf(MissingPublicDeploymentIdError);

    await expect(Effect.runPromise(publicPartitionKeyFromPartsEffect([
      "deployments",
      "deployment-a",
      "partitions",
      "user%3Aada",
    ]))).resolves.toBe("user%3Aada");
    await expect(Effect.runPromise(publicPartitionKeyFromPartsEffect([
      "deployments",
      "deployment-a",
      "partitions",
    ]))).rejects.toBeInstanceOf(MissingPublicPartitionKeyError);

    await expect(Effect.runPromise(publicDeploymentPushPathFromPartsEffect(["start"], "POST")))
      .resolves.toEqual({ kind: "start" });
    await expect(Effect.runPromise(publicDeploymentPushPathFromPartsEffect(["start-analyzed"], "POST")))
      .resolves.toEqual({ kind: "startAnalyzed" });
    await expect(Effect.runPromise(publicDeploymentPushPathFromPartsEffect(["start"], "GET")))
      .resolves.toEqual({ kind: "push", encodedPushId: "start" });
    await expect(Effect.runPromise(publicDeploymentPushPathFromPartsEffect([
      "push%3A1",
      "finish",
    ], "POST"))).resolves.toEqual({
      kind: "push",
      encodedPushId: "push%3A1",
      action: "finish",
    });
    await expect(Effect.runPromise(publicDeploymentPushPathFromPartsEffect([], "POST")))
      .rejects.toBeInstanceOf(MissingDeploymentPushIdError);

    expect(deploymentPushActionFromPath("finish")).toBe("finish");
    expect(deploymentPushActionFromPath("abandon")).toBe("abandon");
    expect(deploymentPushActionFromPath("unknown")).toBeUndefined();

    expect(publicRoutePathErrorToHttpError(new MissingPublicDeploymentIdError()))
      .toMatchObject({ status: 400, message: "Missing deployment id." });
    expect(publicRoutePathErrorToHttpError(new MissingPublicPartitionKeyError()))
      .toMatchObject({ status: 400, message: "Missing partition key." });
    expect(publicRoutePathErrorToHttpError(new MissingDeploymentPushIdError()))
      .toMatchObject({ status: 400, message: "Missing push id." });
  });

  it("maps missing public Worker path segments at the HTTP adapter edge", async () => {
    const missingPush = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/deployment-a/push",
      { method: "POST" },
    );
    expect(missingPush.status).toBe(400);
    await expect(missingPush.json()).resolves.toEqual({
      error: "Missing push id.",
    });

    const missingPartition = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/deployment-a/partitions",
      { method: "POST" },
    );
    expect(missingPartition.status).toBe(400);
    await expect(missingPartition.json()).resolves.toEqual({
      error: "Missing partition key.",
    });

    const unknownPushAction = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/deployment-a/push/push%3A1/unknown",
      { method: "POST" },
    );
    expect(unknownPushAction.status).toBe(404);
    await expect(unknownPushAction.json()).resolves.toEqual({
      error: "Push route not found.",
    });

    const startAsPushId = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/deployment-a/push/start",
      { method: "GET" },
    );
    expect(startAsPushId.status).toBe(404);
    await expect(startAsPushId.json()).resolves.toEqual({
      error: "Unknown push: start",
    });
  });
});
