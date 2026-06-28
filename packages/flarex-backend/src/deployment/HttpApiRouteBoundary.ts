import {
  DeploymentPushAction,
  DeploymentRoute,
  parseAbandonPushRequest,
  parseAnalyzedStartPushRequest,
  parseFinishPushRequest,
} from "flarex-protocol/deployment";
import { readJson } from "../http";

const deploymentPushRoutePattern = new RegExp(`^${DeploymentRoute.push}/([^/]+)(?:/([^/]+))?$`);

export async function deploymentApiRequestForRoute(request: Request): Promise<Request | null> {
  const url = new URL(request.url);
  if (isDeploymentApiReadRoute(request, url)) {
    return request;
  }
  if (url.pathname === DeploymentRoute.startAnalyzedPush && request.method === "POST") {
    return jsonRequest(url, parseAnalyzedStartPushRequest(await readJson(request)));
  }

  const pushMatch = url.pathname.match(deploymentPushRoutePattern);
  if (pushMatch === null) {
    return null;
  }
  const action = pushMatch[2];
  if (action === DeploymentPushAction.finish && request.method === "POST") {
    return jsonRequest(url, parseFinishPushRequest(await readJson(request)));
  }
  if (action === DeploymentPushAction.abandon && request.method === "POST") {
    return jsonRequest(url, parseAbandonPushRequest(await readJson(request)));
  }
  return null;
}

function jsonRequest(url: URL, body: unknown): Request {
  return new Request(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function isDeploymentApiReadRoute(request: Request, url: URL): boolean {
  if (request.method !== "GET") return false;
  if (url.pathname === DeploymentRoute.health || url.pathname === DeploymentRoute.activeDeployment) {
    return true;
  }
  const pushMatch = url.pathname.match(deploymentPushRoutePattern);
  return pushMatch !== null && pushMatch[2] === undefined;
}
