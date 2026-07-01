import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DeploymentProtocolValidationError } from "flarex-protocol/deployment";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodePublicAbandonPushRequest,
  decodePublicAbandonPushRoutePayload,
  decodePublicAnalyzedStartPushRequest,
  decodePublicAnalyzedStartPushRoutePayload,
  decodePublicFinishPushRequest,
  decodePublicFinishPushJson,
  decodePublicFinishPushRoutePayload,
  decodePublicStartPushRequest,
  decodePublicStartPushJson,
  decodePublicStartPushRoutePayload,
  publicDeploymentRouteErrorToHttpError,
  publicDeploymentRouteErrorToHttpErrorEffect,
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

    await expect(Effect.runPromise(decodePublicStartPushJson(jsonRequest(body))))
      .resolves
      .toEqual(body);
    await expect(Effect.runPromise(decodePublicStartPushRequest(jsonRequest(body))))
      .resolves
      .toEqual(body);
    await expect(Effect.runPromise(decodePublicStartPushRoutePayload(body)))
      .resolves
      .toEqual(body);
    await expect(Effect.runPromise(decodePublicStartPushRequest(jsonRequest({}))))
      .rejects
      .toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodePublicStartPushRoutePayload({})))
      .rejects
      .toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("decodes public analyzed start-push bodies with the deployment protocol parser", async () => {
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRequest(jsonRequest(analyzedStartBody))))
      .resolves
      .toEqual(analyzedStartBody);
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRoutePayload(analyzedStartBody)))
      .resolves
      .toEqual(analyzedStartBody);

    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRequest(jsonRequest({
      error: "missing source package",
    })))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRoutePayload({
      error: "missing source package",
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("decodes public finish and abandon bodies with deployment protocol parsers", async () => {
    await expect(Effect.runPromise(decodePublicFinishPushJson(jsonRequest({ activate: true }))))
      .resolves
      .toEqual({ activate: true });
    await expect(Effect.runPromise(decodePublicFinishPushRequest(jsonRequest({
      activate: false,
    })))).resolves.toEqual({ activate: false });
    await expect(Effect.runPromise(decodePublicFinishPushRoutePayload({
      activate: true,
    }))).resolves.toEqual({ activate: true });
    await expect(Effect.runPromise(decodePublicAbandonPushRequest(jsonRequest({
      reason: "typed boundary",
    })))).resolves.toEqual({ reason: "typed boundary" });
    await expect(Effect.runPromise(decodePublicAbandonPushRoutePayload({
      reason: "typed parser",
    }))).resolves.toEqual({ reason: "typed parser" });

    await expect(Effect.runPromise(decodePublicFinishPushRequest(jsonRequest({
      activate: "yes",
    })))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodePublicFinishPushRoutePayload({
      activate: "yes",
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodePublicAbandonPushRequest(jsonRequest({
      reason: 123,
    })))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodePublicAbandonPushRoutePayload({
      reason: 123,
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("keeps malformed JSON in the typed RequestJsonError channel", async () => {
    await expect(Effect.runPromise(decodePublicStartPushJson(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodePublicStartPushRequest(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodePublicFinishPushJson(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodePublicFinishPushRequest(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
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

  it("keeps deployment protocol parser failures typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicAbandonPushRequest(jsonRequest(null))))
      .rejects
      .toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("maps typed public route errors to HttpError at the adapter edge", () => {
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
    expect(publicDeploymentRouteErrorToHttpError(protocolError)).toMatchObject({
      status: 400,
      message: "Abandon push request must be an object.",
    } satisfies Partial<HttpError>);
  });

  it("maps typed public route errors through named adapter effects", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    const mappedJson = await Effect.runPromise(Effect.flip(
      publicDeploymentRouteErrorToHttpErrorEffect(jsonError),
    ));
    expect(mappedJson).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    } satisfies Partial<HttpError>);

    const protocolError = new DeploymentProtocolValidationError({
      schema: "FinishPushRequest",
      message: "Finish push activate flag must be a boolean.",
      cause: {},
    });
    const mappedProtocol = await Effect.runPromise(Effect.flip(
      publicDeploymentRouteErrorToHttpErrorEffect(protocolError),
    ));
    expect(mappedProtocol).toMatchObject({
      status: 400,
      message: "Finish push activate flag must be a boolean.",
    } satisfies Partial<HttpError>);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
