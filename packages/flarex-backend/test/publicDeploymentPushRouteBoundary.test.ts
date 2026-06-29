import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DeploymentProtocolValidationError } from "flarex-protocol/deployment";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodePublicAbandonPushRequest,
  decodePublicAnalyzedStartPushRequest,
  decodePublicFinishPushRequest,
  decodePublicStartPushRequest,
  deploymentProtocolValidationErrorResponse,
  publicDeploymentRouteErrorToHttpError,
  parsePublicAbandonPushRequest,
  parsePublicAbandonPushRequestEffect,
  parsePublicAnalyzedStartPushRequest,
  parsePublicAnalyzedStartPushRequestEffect,
  parsePublicFinishPushRequest,
  parsePublicFinishPushRequestEffect,
  parsePublicStartPushRequest,
  parsePublicStartPushRequestEffect,
  readPublicAbandonPushRequest,
  readPublicAnalyzedStartPushRequest,
  readPublicFinishPushJson,
  readPublicFinishPushRequest,
  readPublicStartPushRequest,
  readPublicStartPushJson,
} from "../src/deployment/PublicPushRouteBoundary";

describe("public deployment push route boundary", () => {
  const analyzedStartBody = {
    sourcePackage: { modules: [], functions: [], execution: "__execution.js" },
    error: "analysis failed",
  };

  it("reads source-only start-push JSON separately from protocol parsing", async () => {
    const body = {
      sourcePackage: { modules: [], functions: [], execution: "__execution.js" },
    };

    await expect(readPublicStartPushJson(jsonRequest(body))).resolves.toEqual(body);
    await expect(readPublicStartPushRequest(jsonRequest(body))).resolves.toEqual(body);
    await expect(Effect.runPromise(decodePublicStartPushRequest(jsonRequest(body))))
      .resolves
      .toEqual(body);
    expect(parsePublicStartPushRequest(body)).toEqual(body);
    await expect(Effect.runPromise(parsePublicStartPushRequestEffect(body)))
      .resolves
      .toEqual(body);
    expect(() => parsePublicStartPushRequest({}))
      .toThrow("Start push request must include sourcePackage.");
    await expect(Effect.runPromise(decodePublicStartPushRequest(jsonRequest({}))))
      .rejects
      .toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(parsePublicStartPushRequestEffect({})))
      .rejects
      .toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("decodes public analyzed start-push bodies with the deployment protocol parser", async () => {
    await expect(readPublicAnalyzedStartPushRequest(jsonRequest(analyzedStartBody)))
      .resolves
      .toEqual(analyzedStartBody);
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRequest(jsonRequest(analyzedStartBody))))
      .resolves
      .toEqual(analyzedStartBody);
    expect(parsePublicAnalyzedStartPushRequest(analyzedStartBody)).toEqual(analyzedStartBody);
    await expect(Effect.runPromise(parsePublicAnalyzedStartPushRequestEffect(analyzedStartBody)))
      .resolves
      .toEqual(analyzedStartBody);

    await expect(readPublicAnalyzedStartPushRequest(jsonRequest({
      error: "missing source package",
    }))).rejects.toThrow("Analyzed start push request must include sourcePackage.");
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRequest(jsonRequest({
      error: "missing source package",
    })))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(parsePublicAnalyzedStartPushRequestEffect({
      error: "missing source package",
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("decodes public finish and abandon bodies with deployment protocol parsers", async () => {
    await expect(readPublicFinishPushJson(jsonRequest({ activate: true })))
      .resolves
      .toEqual({ activate: true });
    await expect(readPublicFinishPushRequest(jsonRequest({ activate: true })))
      .resolves
      .toEqual({ activate: true });
    await expect(Effect.runPromise(decodePublicFinishPushRequest(jsonRequest({
      activate: false,
    })))).resolves.toEqual({ activate: false });
    expect(parsePublicFinishPushRequest({ activate: false })).toEqual({ activate: false });
    await expect(Effect.runPromise(parsePublicFinishPushRequestEffect({
      activate: true,
    }))).resolves.toEqual({ activate: true });
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
    await expect(Effect.runPromise(decodePublicFinishPushRequest(jsonRequest({
      activate: "yes",
    })))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(parsePublicFinishPushRequestEffect({
      activate: "yes",
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
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
    await expect(readPublicStartPushJson(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    } satisfies Partial<HttpError>);
    await expect(readPublicStartPushRequest(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    } satisfies Partial<HttpError>);
    await expect(Effect.runPromise(decodePublicStartPushRequest(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(readPublicFinishPushRequest(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    } satisfies Partial<HttpError>);
    await expect(readPublicFinishPushJson(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    } satisfies Partial<HttpError>);
    await expect(Effect.runPromise(decodePublicFinishPushRequest(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(readPublicAnalyzedStartPushRequest(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    } satisfies Partial<HttpError>);
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRequest(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
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

  it("maps typed public route JSON errors while preserving protocol errors for the worker adapter", () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(publicDeploymentRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    } satisfies Partial<HttpError>);

    const protocolError = new DeploymentProtocolValidationError({
      schema: "AbandonPushRequest",
      message: "Abandon push request must be an object.",
      cause: null,
    });
    expect(publicDeploymentRouteErrorToHttpError(protocolError)).toBe(protocolError);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
