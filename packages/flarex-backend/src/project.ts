import { Data, Effect } from "effect";
import { HttpError } from "./http";
import type { Env } from "./types";

export class ProjectRequiredParameterError
  extends Data.TaggedError("ProjectRequiredParameterError")<{
    readonly parameter: "FLAREX_PROJECT_ID" | "projectId";
    readonly reason:
      | "missingExecutorProjectId"
      | "invalidRequestProjectId"
      | "missingRequestProjectId";
    readonly message: string;
  }> {}

export const requireProjectIdEffect = Effect.fn("Project.requireProjectId")(
  function* (env: Env): Effect.fn.Return<string, ProjectRequiredParameterError> {
    if (env.FLAREX_PROJECT_ID !== undefined && env.FLAREX_PROJECT_ID.length > 0) {
      return env.FLAREX_PROJECT_ID;
    }
    return yield* Effect.fail(new ProjectRequiredParameterError({
      parameter: "FLAREX_PROJECT_ID",
      reason: "missingExecutorProjectId",
      message: "FLAREX_PROJECT_ID is required when FLAREX_EXECUTOR is configured.",
    }));
  },
);

export const projectIdFromRequestOrEnvEffect = Effect.fn("Project.projectIdFromRequestOrEnv")(
  function* (
    value: unknown,
    env: Env,
  ): Effect.fn.Return<string, ProjectRequiredParameterError> {
    if (typeof value === "string" && value.length > 0) return value;
    if (value !== undefined) {
      return yield* Effect.fail(new ProjectRequiredParameterError({
        parameter: "projectId",
        reason: "invalidRequestProjectId",
        message: "projectId must be a non-empty string.",
      }));
    }
    if (env.FLAREX_PROJECT_ID !== undefined && env.FLAREX_PROJECT_ID.length > 0) {
      return env.FLAREX_PROJECT_ID;
    }
    return yield* Effect.fail(new ProjectRequiredParameterError({
      parameter: "projectId",
      reason: "missingRequestProjectId",
      message: "projectId is required when FLAREX_PROJECT_ID is not configured.",
    }));
  },
);

export function projectRequiredParameterErrorToHttpError(
  error: ProjectRequiredParameterError,
): HttpError {
  return new HttpError(projectRequiredParameterErrorHttpStatus(error), error.message);
}

function projectRequiredParameterErrorHttpStatus(
  error: ProjectRequiredParameterError,
): 400 | 500 {
  switch (error.reason) {
    case "missingExecutorProjectId":
      return 500;
    case "invalidRequestProjectId":
    case "missingRequestProjectId":
      return 400;
  }
}
