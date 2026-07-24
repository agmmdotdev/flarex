import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DeploymentProtocolValidationError } from "flarex-protocol/deployment";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodePublicAbandonPushRouteInput,
  decodePublicAbandonPushRoutePayload,
  decodePublicAnalyzedStartPushRouteInput,
  decodePublicAnalyzedStartPushRoutePayload,
  decodePublicFinishPushRouteInput,
  decodePublicFinishPushRoutePayload,
  decodePublicStartPushRouteInput,
  decodePublicStartPushRoutePayload,
  publicFinishPushDispatchRouteInputFromRouteInput,
  publicStartPushRequestFromRouteInput,
  publicDeploymentRouteErrorToHttpError,
  publicDeploymentRouteErrorToHttpErrorEffect,
} from "../src/deployment/PublicPushRouteBoundary";

describe("public deployment push route boundary", () => {
  const analyzedStartBody = {
    sourcePackage: {
      sourceModuleDigestFormat: "sha256-framed-v1",
      modules: [],
      functions: [],
      execution: "__execution.js",
    },
    error: "analysis failed",
  };

  it("decodes source-only start-push requests to raw route input before protocol parsing", async () => {
    const body = {
      sourcePackage: {
        sourceModuleDigestFormat: "sha256-framed-v1",
        modules: [],
        functions: [],
        execution: "__execution.js",
      },
    };

    const routeInput = await Effect.runPromise(decodePublicStartPushRouteInput(jsonRequest(body)));
    expect(routeInput).toEqual({
      _tag: "PublicDeploymentStartPushRouteInput",
      rawBody: body,
    });
    await expect(Effect.runPromise(publicStartPushRequestFromRouteInput(routeInput)))
      .resolves
      .toEqual(body);
    await expect(Effect.runPromise(decodePublicStartPushRoutePayload(body)))
      .resolves
      .toEqual(body);
    const invalidRouteInput = await Effect.runPromise(decodePublicStartPushRouteInput(jsonRequest({})));
    await expect(Effect.runPromise(publicStartPushRequestFromRouteInput(invalidRouteInput)))
      .rejects
      .toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodePublicStartPushRoutePayload({})))
      .rejects
      .toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("decodes public analyzed start-push bodies with the deployment protocol parser", async () => {
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRouteInput(jsonRequest(analyzedStartBody))))
      .resolves
      .toEqual({
        _tag: "PublicDeploymentAnalyzedStartPushRouteInput",
        body: analyzedStartBody,
      });
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRoutePayload(analyzedStartBody)))
      .resolves
      .toEqual(analyzedStartBody);

    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRouteInput(jsonRequest({
      error: "missing source package",
    })))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRoutePayload({
      error: "missing source package",
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("decodes public finish and abandon bodies with deployment protocol parsers", async () => {
    const finishRouteInput = await Effect.runPromise(
      decodePublicFinishPushRouteInput(jsonRequest({ activate: false }), "push-1"),
    );
    expect(finishRouteInput).toEqual({
      _tag: "PublicDeploymentFinishPushRouteInput",
      pushId: "push-1",
      rawBody: { activate: false },
    });
    await expect(Effect.runPromise(publicFinishPushDispatchRouteInputFromRouteInput(finishRouteInput)))
      .resolves
      .toEqual({
        _tag: "PublicDeploymentFinishPushDispatchRouteInput",
        pushId: "push-1",
        body: { activate: false },
      });
    await expect(Effect.runPromise(decodePublicFinishPushRoutePayload({
      activate: true,
    }))).resolves.toEqual({ activate: true });
    await expect(Effect.runPromise(decodePublicAbandonPushRouteInput(jsonRequest({
      reason: "typed boundary",
    }), "push-2"))).resolves.toEqual({
      _tag: "PublicDeploymentAbandonPushRouteInput",
      pushId: "push-2",
      body: { reason: "typed boundary" },
    });
    await expect(Effect.runPromise(decodePublicAbandonPushRoutePayload({
      reason: "typed parser",
    }))).resolves.toEqual({ reason: "typed parser" });

    const invalidFinishRouteInput = await Effect.runPromise(
      decodePublicFinishPushRouteInput(jsonRequest({ activate: "yes" }), "push-3"),
    );
    await expect(Effect.runPromise(publicFinishPushDispatchRouteInputFromRouteInput(invalidFinishRouteInput)))
      .rejects
      .toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodePublicFinishPushRoutePayload({
      activate: "yes",
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodePublicAbandonPushRouteInput(jsonRequest({
      reason: 123,
    }), "push-4"))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodePublicAbandonPushRoutePayload({
      reason: 123,
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("keeps malformed JSON in the typed RequestJsonError channel", async () => {
    await expect(Effect.runPromise(decodePublicStartPushRouteInput(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodePublicFinishPushRouteInput(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }), "push-1"))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushRouteInput(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodePublicAbandonPushRouteInput(new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }), "push-2"))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("keeps deployment protocol parser failures typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicAbandonPushRouteInput(jsonRequest(null), "push-1")))
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
