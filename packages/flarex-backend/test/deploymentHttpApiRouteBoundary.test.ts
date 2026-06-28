import { describe, expect, it } from "vitest";
import {
  DeploymentPushAction,
  DeploymentRoute,
  parseAnalyzedStartPushRequest,
} from "flarex-protocol/deployment";
import {
  deploymentApiRequestForRoute,
  parseDeploymentAbandonPushRouteRequest,
  readDeploymentAbandonPushRouteRequest,
} from "../src/deployment/HttpApiRouteBoundary";

describe("deploymentApiRequestForRoute", () => {
  it("forwards all read routes to the generated DeploymentApi handler", async () => {
    await expectApiRequest(DeploymentRoute.health, { method: "GET" });
    await expectApiRequest(DeploymentRoute.activeDeployment, { method: "GET" });
    await expectApiRequest(`${DeploymentRoute.push}/push-read`, { method: "GET" });
  });

  it("canonicalizes analyzed start-push requests after compatibility parsing", async () => {
    const body = {
      sourcePackage: sourcePackage(),
      analysis: { schema: {}, functions: {} },
      diagnostics: [{ level: "warn", message: "generated warning" }],
    };
    const apiRequest = await expectApiRequest(DeploymentRoute.startAnalyzedPush, {
      method: "POST",
      body,
    });

    const parsedBody: unknown = await apiRequest.json();
    expect(parseAnalyzedStartPushRequest(parsedBody)).toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: body.analysis,
      diagnostics: body.diagnostics,
    });
  });

  it("canonicalizes finish and abandon mutation requests after compatibility parsing", async () => {
    const finish = await expectApiRequest(
      `${DeploymentRoute.push}/push-finish/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: { activate: true },
      },
    );
    await expect(finish.json()).resolves.toEqual({ activate: true });

    const abandon = await expectApiRequest(
      `${DeploymentRoute.push}/push-abandon/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: { reason: "generated output failed" },
      },
    );
    await expect(abandon.json()).resolves.toEqual({ reason: "generated output failed" });

    await expect(
      readDeploymentAbandonPushRouteRequest(jsonRequest(
        `${DeploymentRoute.push}/push-abandon-helper/${DeploymentPushAction.abandon}`,
        {
          method: "POST",
          body: { reason: "helper parsed reason" },
        },
      )),
    ).resolves.toEqual({ reason: "helper parsed reason" });
    expect(parseDeploymentAbandonPushRouteRequest({
      reason: "pure parser reason",
    })).toEqual({ reason: "pure parser reason" });
  });

  it("preserves compatibility parser failures before generated handler routing", async () => {
    await expect(deploymentApiRequestForRoute(jsonRequest(DeploymentRoute.startAnalyzedPush, {
      method: "POST",
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    await expect(deploymentApiRequestForRoute(jsonRequest(
      `${DeploymentRoute.push}/push-finish/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: { activate: "yes" },
      },
    ))).rejects.toMatchObject({
      message: "Finish push activate flag must be a boolean.",
    });

    await expect(deploymentApiRequestForRoute(jsonRequest(
      `${DeploymentRoute.push}/push-abandon/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: { reason: 123 },
      },
    ))).rejects.toMatchObject({
      message: "Abandon push reason must be a string.",
    });
  });

  it("leaves non-API routes and fallback health methods on DeploymentDO", async () => {
    await expect(deploymentApiRequestForRoute(jsonRequest(DeploymentRoute.health, {
      method: "POST",
      body: {},
    }))).resolves.toBeNull();
    await expect(deploymentApiRequestForRoute(jsonRequest(`${DeploymentRoute.push}/push-read`, {
      method: "POST",
      body: {},
    }))).resolves.toBeNull();
    await expect(deploymentApiRequestForRoute(jsonRequest("/not-found", {
      method: "GET",
    }))).resolves.toBeNull();
  });
});

interface RequestOptions {
  readonly method: "GET" | "POST";
  readonly body?: unknown;
}

async function expectApiRequest(path: string, options: RequestOptions): Promise<Request> {
  const apiRequest = await deploymentApiRequestForRoute(jsonRequest(path, options));
  if (apiRequest === null) {
    throw new Error(`Expected ${options.method} ${path} to route to DeploymentApi.`);
  }
  expect(apiRequest.url).toBe(`https://deployment.test${path}`);
  expect(apiRequest.method).toBe(options.method);
  return apiRequest;
}

function jsonRequest(path: string, options: RequestOptions): Request {
  return new Request(`https://deployment.test${path}`, {
    method: options.method,
    headers: { "content-type": "application/json" },
    ...(options.body === undefined
      ? {}
      : { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) }),
  });
}

function sourcePackage() {
  return {
    modules: [{
      path: "__execution.ts",
      environment: "isolate" as const,
      sha256: "a".repeat(64),
    }],
    functions: [],
    execution: "__execution.ts",
  };
}
