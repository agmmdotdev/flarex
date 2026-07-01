import { Effect, Schema } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { PushStatus as ProtocolPushStatus } from "flarex-protocol/deployment";
import type { BackendExecutionArtifactStore } from "../artifactStore";
import { json } from "../http";
import { rejectedFinishPushResponse } from "../pushResponses.ts";
import type { ExecutionArtifactRef, PushSourcePackage, PushStatus } from "../types";
import {
  publicWorkerDispatchError,
  type PublicWorkerDispatchError,
} from "../worker/PublicRouteDispatchError";

export const verifyStoredPushArtifactEffect = Effect.fn(
  "Worker.verifyStoredPushArtifact",
)(function* (
  artifactStore: BackendExecutionArtifactStore | undefined,
  fetchPush: Effect.Effect<Response, PublicWorkerDispatchError>,
): Effect.fn.Return<Response | undefined, PublicWorkerDispatchError> {
  if (artifactStore === undefined) return undefined;

  const response = yield* fetchPush;
  if (!response.ok) return undefined;

  const rawStatus = yield* readFinishArtifactPushStatusJson(response);
  const status = yield* decodeFinishArtifactPushStatus(rawStatus);
  if (status.state !== "analyzed") return undefined;

  const ref = yield* executionArtifactRefForFinishArtifactEffect(status.sourcePackage);
  const artifactAvailable = yield* readFinishArtifactAvailabilityEffect(artifactStore, ref).pipe(
    Effect.catchTag("PublicWorkerDispatchError", () => Effect.succeed(false)),
  );
  if (artifactAvailable) return undefined;

  const error = `Execution artifact ${ref.artifactId} is not available in durable storage.`;
  return json(rejectedFinishPushResponse(status, "missing_artifact", error), { status: 409 });
});

export const executionArtifactRefForFinishArtifactEffect = Effect.fn(
  "Worker.executionArtifactRefForFinishArtifact",
)(function* (
  sourcePackage: PushSourcePackage,
): Effect.fn.Return<ExecutionArtifactRef, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => executionArtifactRefForSourcePackage(sourcePackage),
    catch: error => publicWorkerDispatchError("deployment-finish-push-artifact", error),
  });
});

export const readFinishArtifactAvailabilityEffect = Effect.fn(
  "Worker.readFinishArtifactAvailability",
)(function* (
  artifactStore: BackendExecutionArtifactStore,
  ref: ExecutionArtifactRef,
): Effect.fn.Return<boolean, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: async () => {
      await artifactStore.get(ref);
      return true;
    },
    catch: error => publicWorkerDispatchError("deployment-finish-push-artifact", error),
  });
});

export const readFinishArtifactPushStatusJson = Effect.fn(
  "Worker.readFinishArtifactPushStatusJson",
)(function* (
  response: Response,
): Effect.fn.Return<unknown, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: error => publicWorkerDispatchError("deployment-finish-push-artifact", error),
  });
});

export const decodeFinishArtifactPushStatus = Effect.fn(
  "Worker.decodeFinishArtifactPushStatus",
)(function* (
  value: unknown,
): Effect.fn.Return<PushStatus, PublicWorkerDispatchError> {
  const status = yield* Schema.decodeUnknownEffect(ProtocolPushStatus)(value).pipe(
    Effect.mapError(error => publicWorkerDispatchError("deployment-finish-push-artifact", error)),
  );
  return status as PushStatus;
});
