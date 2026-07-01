import { Effect } from "effect";
import { readJsonEffect, RequestJsonError } from "../http";
import type { ExecutionArtifactInvokePayload } from "../artifactRuntime";
import {
  decodeExecutionArtifactInvokePayloadBody,
  ExecutionArtifactInvokePayloadError,
} from "./Requests";

export {
  decodeExecutionArtifactInvokePayloadBody,
  ExecutionArtifactInvokePayloadError,
} from "./Requests";

export type ExecutionArtifactInvokeRouteError =
  | RequestJsonError
  | ExecutionArtifactInvokePayloadError;

export const decodeExecutionArtifactInvokePayload = Effect.fn(
  "ArtifactRuntimeRouteBoundary.decodeInvokePayloadRequest",
)(function* (
  request: Request,
): Effect.fn.Return<ExecutionArtifactInvokePayload, ExecutionArtifactInvokeRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeExecutionArtifactInvokeRoutePayload),
  );
});

export const decodeExecutionArtifactInvokeRoutePayload = Effect.fn(
  "ArtifactRuntimeRouteBoundary.decodeInvokePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionArtifactInvokePayload, ExecutionArtifactInvokePayloadError> {
  return yield* decodeExecutionArtifactInvokePayloadBody(value);
});
