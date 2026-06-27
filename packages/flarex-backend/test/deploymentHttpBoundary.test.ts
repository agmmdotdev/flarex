import { describe, expect, it } from "vitest";
import {
  DeploymentActiveDeploymentNotFoundError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
} from "../src/deployment/Errors";
import {
  deploymentFailureToHttpError,
  finishPushHttpStatus,
} from "../src/deployment/HttpBoundary";
import { DeploymentSqlError } from "../src/deployment/Store";
import { HttpError } from "../src/http";
import type { PushStatus } from "../src/types";

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

  it("maps finish push responses to preserved HTTP statuses", () => {
    expect(finishPushHttpStatus({
      result: "activated",
      push: pushStatus("push-activated", "activated"),
    })).toBe(200);

    expect(finishPushHttpStatus({
      result: "rejected",
      push: pushStatus("push-rejected", "failed"),
      code: "invalid_state",
      error: "Cannot finish push push-rejected in state failed.",
    })).toBe(409);
  });
});

function expectHttpError(error: HttpError, status: number, message: string): void {
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
  expect(error.message).toBe(message);
}

function pushStatus(pushId: string, state: PushStatus["state"]): PushStatus {
  return {
    pushId,
    state,
    sourcePackage: {
      modules: [
        {
          path: "__execution.ts",
          environment: "isolate",
          sha256: "a".repeat(64),
        },
      ],
      functions: [],
      execution: "__execution.ts",
    },
    createdAt: 1,
    updatedAt: 2,
  };
}
