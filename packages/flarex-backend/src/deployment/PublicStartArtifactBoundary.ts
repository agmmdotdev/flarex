import { Effect } from "effect";
import { validateExecutionArtifactRef } from "flarex/artifacts";
import type { BackendExecutionArtifactStore } from "../artifactStore";
import type { AnalyzedStartPushRequest, ExecutionArtifactRef } from "../types";
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

  const ref = yield* Effect.tryPromise({
    try: () => artifactStore.put(analyzed.sourcePackage),
    catch: error => publicWorkerDispatchError("deployment-start-push-store-artifact", error),
  });
  yield* decodePublicStartArtifactRef(ref);
});

export const decodePublicStartArtifactRef = Effect.fn(
  "Worker.decodePublicStartArtifactRef",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionArtifactRef, PublicWorkerDispatchError> {
  return yield* Effect.try({
    try: () => validateExecutionArtifactRef(value),
    catch: error => publicWorkerDispatchError("deployment-start-push-store-artifact", error),
  });
});
