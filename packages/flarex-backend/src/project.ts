import { HttpError } from "./http";
import type { Env } from "./types";

export function requireProjectId(env: Env): string {
  if (env.FLAREX_PROJECT_ID !== undefined && env.FLAREX_PROJECT_ID.length > 0) {
    return env.FLAREX_PROJECT_ID;
  }
  throw new Error("FLAREX_PROJECT_ID is required when FLAREX_EXECUTOR is configured.");
}

export function projectIdFromRequestOrEnv(
  value: unknown,
  env: Env,
): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value !== undefined) {
    throw new HttpError(400, "projectId must be a non-empty string.");
  }
  if (env.FLAREX_PROJECT_ID !== undefined && env.FLAREX_PROJECT_ID.length > 0) {
    return env.FLAREX_PROJECT_ID;
  }
  throw new HttpError(
    400,
    "projectId is required when FLAREX_PROJECT_ID is not configured.",
  );
}
