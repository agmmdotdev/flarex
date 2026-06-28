import {
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
  parseAnalyzedStartPushRequest,
  parseFinishPushRequest,
  type AbandonPushRequest,
  type AnalyzedStartPushRequest,
  type FinishPushRequest,
} from "flarex-protocol/deployment";
import { json, readJson } from "../http";

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
