import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DeploymentProtocolValidationError } from "flarex-protocol/deployment";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodePublicAbandonPushRequest,
  deploymentProtocolValidationErrorResponse,
  parsePublicAbandonPushRequest,
  parsePublicAbandonPushRequestEffect,
  parsePublicFinishPushRequest,
  parsePublicStartPushRequest,
  readPublicAbandonPushRequest,
  readPublicAnalyzedStartPushRequest,
  readPublicFinishPushJson,
  readPublicFinishPushRequest,
  readPublicStartPushJson,
} from "../src/deployment/PublicPushRouteBoundary";

describe("public deployment push route boundary", () => {
  it("reads source-only start-push JSON separately from protocol parsing", async () => {
    const body = {
      sourcePackage: { modules: [], functions: [], execution: "__execution.js" },
    };

    await expect(readPublicStartPushJson(jsonRequest(body))).resolves.toEqual(body);
    expect(parsePublicStartPushRequest(body)).toEqual(body);
    expect(() => parsePublicStartPushRequest({}))
      .toThrow("Start push request must include sourcePackage.");
  });

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
    await expect(readPublicFinishPushJson(jsonRequest({ activate: true })))
      .resolves
      .toEqual({ activate: true });
    await expect(readPublicFinishPushRequest(jsonRequest({ activate: true })))
      .resolves
      .toEqual({ activate: true });
    expect(parsePublicFinishPushRequest({ activate: false })).toEqual({ activate: false });
    await expect(readPublicAbandonPushRequest(jsonRequest({ reason: "typecheck failed" })))
      .resolves
      .toEqual({ reason: "typecheck failed" });
    await expect(Effect.runPromise(decodePublicAbandonPushRequest(jsonRequest({
      reason: "typed boundary",
    })))).resolves.toEqual({ reason: "typed boundary" });
    expect(parsePublicAbandonPushRequest({ reason: "pure parser" })).toEqual({ reason: "pure parser" });
    await expect(Effect.runPromise(parsePublicAbandonPushRequestEffect({
      reason: "typed parser",
    }))).resolves.toEqual({ reason: "typed parser" });

    await expect(readPublicFinishPushRequest(jsonRequest({ activate: "yes" })))
      .rejects
      .toThrow("Finish push activate flag must be a boolean.");
    await expect(readPublicAbandonPushRequest(jsonRequest({ reason: 123 })))
      .rejects
      .toThrow("Abandon push reason must be a string.");
    await expect(Effect.runPromise(decodePublicAbandonPushRequest(jsonRequest({
      reason: 123,
    })))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(parsePublicAbandonPushRequestEffect({
      reason: 123,
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
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
    await expect(Effect.runPromise(decodePublicAbandonPushRequest(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
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
