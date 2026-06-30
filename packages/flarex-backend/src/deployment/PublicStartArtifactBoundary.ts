import { Effect } from "effect";
import type { BackendExecutionArtifactStore } from "../artifactStore";
import type { AnalyzedStartPushRequest } from "../types";
import {
  publicWorkerDispatchError,
  type PublicWorkerDispatchError,
} from "../worker/PublicRouteDispatchError";

export const persistAnalyzedSourcePackageEffect = Effect.fn(
  "Worker.persistAnalyzedSourcePackage",
)(function* (
  artifactStore: BackendExecutionArtifactStore | undefined,
  analyzed: AnalyzedStartPushRequest,
): Effect.fn.Return<void, PublicWorkerDispatchError> {
  if (artifactStore === undefined || analyzed.analysis === undefined) return;

  yield* Effect.tryPromise({
    try: () => artifactStore.put(analyzed.sourcePackage),
    catch: error => publicWorkerDispatchError("deployment-start-push-store-artifact", error),
  });
});
