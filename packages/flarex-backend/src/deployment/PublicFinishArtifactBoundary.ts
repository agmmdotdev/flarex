import { Effect } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { parsePushStatus } from "flarex-protocol/deployment";
import type { BackendExecutionArtifactStore } from "../artifactStore";
import { json } from "../http";
import { rejectedFinishPushResponse } from "../pushResponses.ts";
import type { PushStatus } from "../types";
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

  const status = yield* Effect.tryPromise({
    try: async () => parsePushStatus(await response.json()) as PushStatus,
    catch: error => publicWorkerDispatchError("deployment-finish-push-artifact", error),
  });
  if (status.state !== "analyzed") return undefined;

  const ref = yield* Effect.tryPromise({
    try: () => executionArtifactRefForSourcePackage(status.sourcePackage),
    catch: error => publicWorkerDispatchError("deployment-finish-push-artifact", error),
  });
  const artifactAvailable = yield* Effect.tryPromise({
    try: async () => {
      await artifactStore.get(ref);
      return true;
    },
    catch: error => publicWorkerDispatchError("deployment-finish-push-artifact", error),
  }).pipe(
    Effect.catchTag("PublicWorkerDispatchError", () => Effect.succeed(false)),
  );
  if (artifactAvailable) return undefined;

  const error = `Execution artifact ${ref.artifactId} is not available in durable storage.`;
  return json(rejectedFinishPushResponse(status, "missing_artifact", error), { status: 409 });
});
