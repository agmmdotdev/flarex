import { describe, expect, it } from "vitest";
import { DeploymentProtocolValidationError } from "flarex-protocol/deployment";
import { HttpError } from "../src/http";
import {
  deploymentProtocolValidationErrorResponse,
  parsePublicFinishPushRequest,
  readPublicAbandonPushRequest,
  readPublicAnalyzedStartPushRequest,
  readPublicFinishPushRequest,
} from "../src/deployment/PublicPushRouteBoundary";

describe("public deployment push route boundary", () => {
  it("decodes public analyzed start-push bodies with the deployment protocol parser", async () => {
    await expect(readPublicAnalyzedStartPushRequest(jsonRequest({
      sourcePackage: { modules: [], functions: [], execution: "__execution.js" },
      error: "analysis failed",
    }))).resolves.toEqual({
      sourcePackage: { modules: [], functions: [], execution: "__execution.js" },
      error: "analysis failed",
    });

    await expect(readPublicAnalyzedStartPushRequest(jsonRequest({
      error: "missing source package",
    }))).rejects.toThrow("Analyzed start push request must include sourcePackage.");
  });

  it("decodes public finish and abandon bodies with deployment protocol parsers", async () => {
    await expect(readPublicFinishPushRequest(jsonRequest({ activate: true })))
      .resolves
      .toEqual({ activate: true });
    expect(parsePublicFinishPushRequest({ activate: false })).toEqual({ activate: false });
    await expect(readPublicAbandonPushRequest(jsonRequest({ reason: "typecheck failed" })))
      .resolves
      .toEqual({ reason: "typecheck failed" });

    await expect(readPublicFinishPushRequest(jsonRequest({ activate: "yes" })))
      .rejects
      .toThrow("Finish push activate flag must be a boolean.");
    await expect(readPublicAbandonPushRequest(jsonRequest({ reason: 123 })))
      .rejects
      .toThrow("Abandon push reason must be a string.");
  });

  it("keeps malformed JSON as the shared HttpError boundary", async () => {
    await expect(readPublicFinishPushRequest(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    } satisfies Partial<HttpError>);
  });

  it("maps deployment protocol parser failures to the existing 400 error envelope", async () => {
    let failure: unknown;
    try {
      await readPublicAbandonPushRequest(jsonRequest(null));
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DeploymentProtocolValidationError);
    const response = deploymentProtocolValidationErrorResponse(failure);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "Abandon push request must be an object.",
    });

    expect(deploymentProtocolValidationErrorResponse(new Error("not protocol"))).toBeUndefined();
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
