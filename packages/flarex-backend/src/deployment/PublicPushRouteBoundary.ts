import { Effect } from "effect";
import {
  DeploymentProtocolValidationError,
  type AbandonPushRequest,
  type AnalyzedStartPushRequest,
  type FinishPushRequest,
} from "flarex-protocol/deployment";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { StartPushRequest } from "../types";
import {
  decodePublicAbandonPushPayload,
  decodePublicAnalyzedStartPushPayload,
  decodePublicFinishPushPayload,
  decodePublicStartPushPayload,
} from "./Requests";

export type PublicDeploymentRouteError =
  | RequestJsonError
  | DeploymentProtocolValidationError;

export type PublicDeploymentReadPushRouteInput = {
  readonly _tag: "PublicDeploymentReadPushRouteInput";
  readonly pushId: string;
};

export type PublicDeploymentStartPushRouteInput = {
  readonly _tag: "PublicDeploymentStartPushRouteInput";
  readonly rawBody: unknown;
};

export type PublicDeploymentAnalyzedStartPushRouteInput = {
  readonly _tag: "PublicDeploymentAnalyzedStartPushRouteInput";
  readonly body: AnalyzedStartPushRequest;
};

export type PublicDeploymentFinishPushRouteInput = {
  readonly _tag: "PublicDeploymentFinishPushRouteInput";
  readonly pushId: string;
  readonly rawBody: unknown;
};

export type PublicDeploymentFinishPushDispatchRouteInput = {
  readonly _tag: "PublicDeploymentFinishPushDispatchRouteInput";
  readonly pushId: string;
  readonly body: FinishPushRequest;
};

export type PublicDeploymentAbandonPushRouteInput = {
  readonly _tag: "PublicDeploymentAbandonPushRouteInput";
  readonly pushId: string;
  readonly body: AbandonPushRequest;
};

export type PublicDeploymentPushRouteInput =
  | PublicDeploymentReadPushRouteInput
  | PublicDeploymentStartPushRouteInput
  | PublicDeploymentAnalyzedStartPushRouteInput
  | PublicDeploymentFinishPushRouteInput
  | PublicDeploymentAbandonPushRouteInput;

export function publicDeploymentReadPushRouteInput(
  pushId: string,
): PublicDeploymentReadPushRouteInput {
  return {
    _tag: "PublicDeploymentReadPushRouteInput",
    pushId,
  };
}

export function publicDeploymentAnalyzedStartPushRouteInput(
  body: AnalyzedStartPushRequest,
): PublicDeploymentAnalyzedStartPushRouteInput {
  return {
    _tag: "PublicDeploymentAnalyzedStartPushRouteInput",
    body,
  };
}

export const decodePublicStartPushRouteInput = Effect.fn(
  "PublicPushRouteBoundary.decodeStartPushRouteInput",
)(function* (
  request: Request,
): Effect.fn.Return<PublicDeploymentStartPushRouteInput, RequestJsonError> {
  const rawBody = yield* readJsonEffect(request);
  return {
    _tag: "PublicDeploymentStartPushRouteInput",
    rawBody,
  };
});

export const decodePublicAnalyzedStartPushRouteInput = Effect.fn(
  "PublicPushRouteBoundary.decodeAnalyzedStartPushRouteInput",
)(function* (
  request: Request,
): Effect.fn.Return<
  PublicDeploymentAnalyzedStartPushRouteInput,
  RequestJsonError | DeploymentProtocolValidationError
> {
  const rawBody = yield* readJsonEffect(request);
  const body = yield* decodePublicAnalyzedStartPushRoutePayload(rawBody);
  return publicDeploymentAnalyzedStartPushRouteInput(body);
});

export const decodePublicFinishPushRouteInput = Effect.fn(
  "PublicPushRouteBoundary.decodeFinishPushRouteInput",
)(function* (
  request: Request,
  pushId: string,
): Effect.fn.Return<PublicDeploymentFinishPushRouteInput, RequestJsonError> {
  const rawBody = yield* readJsonEffect(request);
  return {
    _tag: "PublicDeploymentFinishPushRouteInput",
    pushId,
    rawBody,
  };
});

export const decodePublicAbandonPushRouteInput = Effect.fn(
  "PublicPushRouteBoundary.decodeAbandonPushRouteInput",
)(function* (
  request: Request,
  pushId: string,
): Effect.fn.Return<
  PublicDeploymentAbandonPushRouteInput,
  RequestJsonError | DeploymentProtocolValidationError
> {
  const rawBody = yield* readJsonEffect(request);
  const body = yield* decodePublicAbandonPushRoutePayload(rawBody);
  return {
    _tag: "PublicDeploymentAbandonPushRouteInput",
    pushId,
    body,
  };
});

export const publicStartPushRequestFromRouteInput = Effect.fn(
  "PublicPushRouteBoundary.startPushRequestFromRouteInput",
)(function* (
  input: PublicDeploymentStartPushRouteInput,
): Effect.fn.Return<StartPushRequest, DeploymentProtocolValidationError> {
  return yield* decodePublicStartPushRoutePayload(input.rawBody);
});

export const publicFinishPushDispatchRouteInputFromRouteInput = Effect.fn(
  "PublicPushRouteBoundary.finishPushDispatchRouteInputFromRouteInput",
)(function* (
  input: PublicDeploymentFinishPushRouteInput,
): Effect.fn.Return<PublicDeploymentFinishPushDispatchRouteInput, DeploymentProtocolValidationError> {
  const body = yield* decodePublicFinishPushRoutePayload(input.rawBody);
  return {
    _tag: "PublicDeploymentFinishPushDispatchRouteInput",
    pushId: input.pushId,
    body,
  };
});

export function decodePublicStartPushRoutePayload(
  body: unknown,
): Effect.Effect<StartPushRequest, DeploymentProtocolValidationError> {
  return decodePublicStartPushPayload(body);
}

export function decodePublicAnalyzedStartPushRoutePayload(
  body: unknown,
): Effect.Effect<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  return decodePublicAnalyzedStartPushPayload(body);
}

export function decodePublicFinishPushRoutePayload(
  body: unknown,
): Effect.Effect<FinishPushRequest, DeploymentProtocolValidationError> {
  return decodePublicFinishPushPayload(body);
}

export function decodePublicAbandonPushRoutePayload(
  body: unknown,
): Effect.Effect<AbandonPushRequest, DeploymentProtocolValidationError> {
  return decodePublicAbandonPushPayload(body);
}

export function publicDeploymentRouteErrorToHttpError(
  error: PublicDeploymentRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

export const publicDeploymentRouteErrorToHttpErrorEffect = Effect.fn(
  "PublicPushRouteBoundary.publicDeploymentRouteErrorToHttpError",
)(function* (
  error: PublicDeploymentRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(publicDeploymentRouteErrorToHttpError(error));
});
