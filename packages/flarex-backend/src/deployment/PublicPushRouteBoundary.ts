import {
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
  parseAnalyzedStartPushRequest,
  parseFinishPushRequest,
  parseStartPushRequest,
  type AbandonPushRequest,
  type AnalyzedStartPushRequest,
  type FinishPushRequest,
} from "flarex-protocol/deployment";
import { json, readJson } from "../http";
import type { StartPushRequest } from "../types";

export async function readPublicStartPushJson(request: Request): Promise<unknown> {
  return readJson(request);
}

export function parsePublicStartPushRequest(body: unknown): StartPushRequest {
  const request = parseStartPushRequest(body);
  return {
    sourcePackage: {
      modules: request.sourcePackage.modules.map(module => ({
        path: module.path,
        environment: module.environment,
        sha256: module.sha256,
        ...(module.source === undefined ? {} : { source: module.source }),
        ...(module.sourceMap === undefined ? {} : { sourceMap: module.sourceMap }),
      })),
      functions: [...request.sourcePackage.functions],
      ...(request.sourcePackage.schema === undefined ? {} : { schema: request.sourcePackage.schema }),
      execution: request.sourcePackage.execution,
    },
  };
}

export async function readPublicAnalyzedStartPushRequest(
  request: Request,
): Promise<AnalyzedStartPushRequest> {
  return parseAnalyzedStartPushRequest(await readJson(request));
}

export async function readPublicFinishPushRequest(
  request: Request,
): Promise<FinishPushRequest> {
  return parseFinishPushRequest(await readJson(request));
}

export async function readPublicFinishPushJson(request: Request): Promise<unknown> {
  return readJson(request);
}

export function parsePublicFinishPushRequest(
  body: unknown,
): FinishPushRequest {
  return parseFinishPushRequest(body);
}

export async function readPublicAbandonPushRequest(
  request: Request,
): Promise<AbandonPushRequest> {
  return parseAbandonPushRequest(await readJson(request));
}

export function deploymentProtocolValidationErrorResponse(
  error: unknown,
): Response | undefined {
  if (!(error instanceof DeploymentProtocolValidationError)) {
    return undefined;
  }
  return json({ error: error.message }, { status: 400 });
}
