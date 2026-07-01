import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { ExecutionArtifactInvokePayload } from "../artifactRuntime";
import {
  decodeExecutionArtifactInvokePayloadBody,
  ExecutionArtifactInvokePayloadError,
  parseExecutionArtifactInvokePayloadBody,
} from "./Requests";

export {
  decodeExecutionArtifactInvokePayloadBody,
  ExecutionArtifactInvokePayloadError,
  parseExecutionArtifactInvokePayloadBody,
} from "./Requests";

export type ExecutionArtifactInvokeRouteError =
  | RequestJsonError
  | ExecutionArtifactInvokePayloadError;

export async function readExecutionArtifactInvokePayload(
  request: Request,
): Promise<ExecutionArtifactInvokePayload> {
  return await runExecutionArtifactInvokeRouteEffect(decodeExecutionArtifactInvokePayload(request));
}

export function decodeExecutionArtifactInvokePayload(
  request: Request,
): Effect.Effect<ExecutionArtifactInvokePayload, ExecutionArtifactInvokeRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeExecutionArtifactInvokeRoutePayload),
  );
}

export function parseExecutionArtifactInvokePayload(
  value: unknown,
): ExecutionArtifactInvokePayload {
  return Effect.runSync(parseExecutionArtifactInvokePayloadEffect(value).pipe(
    Effect.catch(executionArtifactInvokeRouteErrorToHttpErrorEffect),
  ));
}

export function parseExecutionArtifactInvokePayloadEffect(
  value: unknown,
): Effect.Effect<ExecutionArtifactInvokePayload, ExecutionArtifactInvokePayloadError> {
  return decodeExecutionArtifactInvokeRoutePayload(value);
}

export function decodeExecutionArtifactInvokeRoutePayload(
  value: unknown,
): Effect.Effect<ExecutionArtifactInvokePayload, ExecutionArtifactInvokePayloadError> {
  return decodeExecutionArtifactInvokePayloadBody(value);
}

export function executionArtifactInvokeRouteErrorToHttpError(
  error: ExecutionArtifactInvokeRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

function runExecutionArtifactInvokeRouteEffect<A>(
  effect: Effect.Effect<A, ExecutionArtifactInvokeRouteError>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.catch(executionArtifactInvokeRouteErrorToHttpErrorEffect),
  ));
}

export const executionArtifactInvokeRouteErrorToHttpErrorEffect = Effect.fn(
  "ArtifactRuntimeRouteBoundary.executionArtifactInvokeRouteErrorToHttpError",
)(function* (
  error: ExecutionArtifactInvokeRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(executionArtifactInvokeRouteErrorToHttpError(error));
});
