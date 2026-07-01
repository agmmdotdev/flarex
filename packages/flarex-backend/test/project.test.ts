import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  projectIdFromRequestOrEnvEffect,
  projectRequiredParameterErrorToHttpError,
  ProjectRequiredParameterError,
  requireProjectIdEffect,
} from "../src/project";
import type { Env } from "../src/types";

describe("project required parameter helpers", () => {
  it("resolves configured executor project ids through typed Effect helpers", async () => {
    await expect(Effect.runPromise(requireProjectIdEffect({
      FLAREX_PROJECT_ID: "project-a",
    } as Env))).resolves.toBe("project-a");

    await expect(Effect.runPromise(projectIdFromRequestOrEnvEffect(undefined, {
      FLAREX_PROJECT_ID: "project-default",
    } as Env))).resolves.toBe("project-default");

    await expect(Effect.runPromise(projectIdFromRequestOrEnvEffect("project-explicit", {} as Env)))
      .resolves
      .toBe("project-explicit");
  });

  it("keeps missing or invalid project ids typed before HTTP mapping", async () => {
    const missingExecutorProject = await Effect.runPromise(Effect.flip(
      requireProjectIdEffect({ FLAREX_PROJECT_ID: "" } as Env),
    ));
    expect(missingExecutorProject).toBeInstanceOf(ProjectRequiredParameterError);
    expect(missingExecutorProject).toMatchObject({
      _tag: "ProjectRequiredParameterError",
      parameter: "FLAREX_PROJECT_ID",
      reason: "missingExecutorProjectId",
      message: "FLAREX_PROJECT_ID is required when FLAREX_EXECUTOR is configured.",
    });
    expect(missingExecutorProject).not.toHaveProperty("status");
    expect(projectRequiredParameterErrorToHttpError(missingExecutorProject)).toMatchObject({
      status: 500,
      message: "FLAREX_PROJECT_ID is required when FLAREX_EXECUTOR is configured.",
    });

    const invalidRequestProject = await Effect.runPromise(Effect.flip(
      projectIdFromRequestOrEnvEffect("", { FLAREX_PROJECT_ID: "project-default" } as Env),
    ));
    expect(invalidRequestProject).toMatchObject({
      _tag: "ProjectRequiredParameterError",
      parameter: "projectId",
      reason: "invalidRequestProjectId",
      message: "projectId must be a non-empty string.",
    });
    expect(invalidRequestProject).not.toHaveProperty("status");
    expect(projectRequiredParameterErrorToHttpError(invalidRequestProject)).toMatchObject({
      status: 400,
      message: "projectId must be a non-empty string.",
    });

    const missingRequestProject = await Effect.runPromise(Effect.flip(
      projectIdFromRequestOrEnvEffect(undefined, {} as Env),
    ));
    expect(missingRequestProject).toMatchObject({
      _tag: "ProjectRequiredParameterError",
      parameter: "projectId",
      reason: "missingRequestProjectId",
      message: "projectId is required when FLAREX_PROJECT_ID is not configured.",
    });
    expect(missingRequestProject).not.toHaveProperty("status");
    expect(projectRequiredParameterErrorToHttpError(missingRequestProject)).toMatchObject({
      status: 400,
      message: "projectId is required when FLAREX_PROJECT_ID is not configured.",
    });
  });
});
