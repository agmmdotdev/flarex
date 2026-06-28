import {
  parseCreateDeploymentRequest,
  RegistryRoute,
} from "flarex-protocol/registry";
import { readJson } from "../http";

export async function registryApiRequestForRoute(request: Request): Promise<Request | null> {
  const url = new URL(request.url);
  if (isRegistryApiReadRoute(request, url)) {
    return request;
  }
  if (url.pathname === RegistryRoute.deployments && request.method === "POST") {
    return jsonRequest(url, parseCreateDeploymentRequest(await readJson(request)));
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

function isRegistryApiReadRoute(request: Request, url: URL): boolean {
  return request.method === "GET" && (
    url.pathname === RegistryRoute.health
      || url.pathname === RegistryRoute.deployments
  );
}
