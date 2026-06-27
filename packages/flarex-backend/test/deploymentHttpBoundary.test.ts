import { describe, expect, it } from "vitest";
import {
  DeploymentActiveDeploymentNotFoundError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
} from "../src/deployment/Errors";
import { deploymentFailureToHttpError } from "../src/deployment/HttpBoundary";
import { DeploymentSqlError } from "../src/deployment/Store";
import { HttpError } from "../src/http";

describe("deployment HTTP boundary", () => {
  it("maps typed service failures to preserved HTTP errors", () => {
    expectHttpError(
      deploymentFailureToHttpError(new DeploymentActiveDeploymentNotFoundError()),
      404,
      "No active deployment.",
    );

    expectHttpError(
      deploymentFailureToHttpError(new DeploymentPushNotFoundError({ pushId: "push-missing" })),
      404,
      "Unknown push: push-missing",
    );

    expectHttpError(
      deploymentFailureToHttpError(new DeploymentPushInvalidStateError({
        action: "abandon",
        pushId: "push-active",
        state: "activated",
      })),
      409,
      "Cannot abandon push push-active in state activated.",
    );
  });

  it("passes through existing HttpError failures", () => {
    const failure = new HttpError(400, "Deployment analysis must be an object.");

    expect(deploymentFailureToHttpError(failure)).toBe(failure);
  });

  it("maps deployment storage failures to the preserved generic 500", () => {
    const failure = new DeploymentSqlError({
      operation: "getPush",
      cause: new Error("read failed"),
    });

    expectHttpError(
      deploymentFailureToHttpError(failure),
      500,
      "Deployment storage error.",
    );
  });
});

function expectHttpError(error: HttpError, status: number, message: string): void {
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
  expect(error.message).toBe(message);
}
