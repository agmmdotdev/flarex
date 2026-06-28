import {
  ExecutionProtocolValidationError,
  parseExecutionFinishRequest,
  type ExecutionFinishRequest as ProtocolExecutionFinishRequest,
} from "flarex-protocol/execution";
import { HttpError, readJson } from "../http";
import type { ExecutionFinishRequest } from "../types";
import { backendJson } from "./JsonRouteBoundary";

export async function readExecutionFinishRequest(
  request: Request,
): Promise<ExecutionFinishRequest> {
  return parseExecutionFinishRouteRequest(await readJson(request));
}

export function parseExecutionFinishRouteRequest(
  value: unknown,
): ExecutionFinishRequest {
  try {
    return backendExecutionFinishRequest(parseExecutionFinishRequest(value));
  } catch (error) {
    if (error instanceof ExecutionProtocolValidationError) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
}

function backendExecutionFinishRequest(
  request: ProtocolExecutionFinishRequest,
): ExecutionFinishRequest {
  return {
    value: backendJson(request.value),
  };
}
