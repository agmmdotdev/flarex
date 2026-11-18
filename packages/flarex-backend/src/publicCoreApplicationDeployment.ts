import { Cause, Effect } from "effect";
import { CoreApplicationTransportError, readCoreApplicationJsonBody } from "@flarex/executor-http/internal/core-application";
import { decodeCoreApplicationStartPushRequestEffect, encodeDeploymentAnalysis, encodeDeploymentCodegenAnalysis, type CoreActiveDeploymentStatus } from "flarex-protocol/deployment";
import { lookupBackendCoreApplication, makeBackendCoreApplicationDeploymentClient,
  projectBackendCoreApplicationErrors } from "./coreApplicationRuntime";
import { decodePublicAbandonPushPayload, decodePublicFinishPushPayload } from "./deployment/Requests";
import { badRequestErrorToHttpError, HttpError, json } from "./http";
import { projectBackendCoreApplicationCandidate } from "./publicCoreApplicationMetadata";
import type { Env, PushStatus } from "./types";
import type { PublicDeploymentPushPath } from "./worker/PublicRoutePathBoundary";
import { publicWorkerDispatchError, type PublicWorkerDispatchSource } from "./worker/PublicRouteDispatchError";

/** Public authorization runs before this operation or any private routing lookup. */
export const routeBackendCoreApplicationPush = Effect.fn("BackendCoreApplication.routePush")(function* (
  request: Request, env: Env, deploymentId: string, path: PublicDeploymentPushPath,
) {
  const operation = pushOperation(path);
  return yield* projectBackendCoreApplicationErrors(Effect.gen(function* () {
    const control = yield* lookupBackendCoreApplication(env, deploymentId);
    if (control === undefined) return undefined;
    if (path.kind === "startAnalyzed")
      return yield* Effect.fail(new HttpError(409, "Core applications require source-only public analysis."));
    const client = yield* makeBackendCoreApplicationDeploymentClient(env, control);
    if (path.kind === "start") {
      const body = yield* readPublicCorePushBody(request, control.maximumPushRequestBytes);
      const input = yield* decodeCoreApplicationStartPushRequestEffect(body).pipe(Effect.mapError(badRequestErrorToHttpError));
      const candidate = yield* client.start(input.sourcePackage);
      return json(encodeCorePushStatus((yield* projectBackendCoreApplicationCandidate(candidate)).push));
    }
    const pushId = yield* Effect.try({ try: () => decodeURIComponent(path.encodedPushId),
      catch: () => new HttpError(400, "Invalid push identifier.") });
    if (path.action === undefined && request.method === "GET") {
      const candidate = yield* client.read(pushId);
      if (candidate === null) return yield* Effect.fail(new HttpError(404, "Push was not found."));
      return json(encodeCorePushStatus((yield* projectBackendCoreApplicationCandidate(candidate)).push));
    }
    if (path.action === "finish" && request.method === "POST") {
      const body = yield* readPublicCorePushBody(request, control.maximumPushRequestBytes);
      const input = yield* decodePublicFinishPushPayload(body).pipe(Effect.mapError(badRequestErrorToHttpError));
      const candidate = yield* client.finish(pushId, input.activate === undefined ? {} : { activate: input.activate });
      const push = encodeCorePushStatus((yield* projectBackendCoreApplicationCandidate(candidate)).push);
      return candidate.state === "active"
        ? json({ result: "activated", push })
        : json({ result: "rejected", push, code: "invalid_state", error: "The Core push remains inactive." }, { status: 409 });
    }
    if (path.action === "abandon" && request.method === "POST") {
      const body = yield* readPublicCorePushBody(request, control.maximumPushRequestBytes);
      const input = yield* decodePublicAbandonPushPayload(body).pipe(Effect.mapError(badRequestErrorToHttpError));
      const candidate = yield* client.abandon(pushId, input.reason === undefined ? {} : { reason: input.reason });
      return json(encodeCorePushStatus((yield* projectBackendCoreApplicationCandidate(candidate)).push));
    }
    return json({ error: "Push route not found." }, { status: 404 });
  })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => publicWorkerDispatchError(operation, error)))));
});

export const readBackendCoreApplicationActive = Effect.fn("BackendCoreApplication.readActive")(function* (
  env: Env, deploymentId: string,
) {
  return yield* projectBackendCoreApplicationErrors(Effect.gen(function* () {
    const control = yield* lookupBackendCoreApplication(env, deploymentId);
    if (control === undefined) return undefined;
    const client = yield* makeBackendCoreApplicationDeploymentClient(env, control);
    const candidate = yield* client.active();
    if (candidate === null) return yield* Effect.fail(new HttpError(404, "Deployment has no active Core push."));
    if (candidate.state !== "active" || !candidate.indexesReady)
      return yield* Effect.fail(new HttpError(503, "Core deployment is not active."));
    return yield* projectBackendCoreApplicationCandidate(candidate);
  })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
    error => publicWorkerDispatchError("deployment-active-read", error)))));
});

export function encodeCorePushStatus(push: PushStatus) {
  return { ...push,
    ...(push.analysis === undefined ? {} : { analysis: encodeDeploymentAnalysis(push.analysis) }),
    ...(push.codegenAnalysis === undefined ? {} : { codegenAnalysis: encodeDeploymentCodegenAnalysis(push.codegenAnalysis) }),
  };
}

export function encodeCoreActiveDeployment(active: CoreActiveDeploymentStatus) {
  return { ...active, analysis: encodeDeploymentAnalysis(active.analysis), codegenAnalysis: encodeDeploymentCodegenAnalysis(active.codegenAnalysis) };
}

const readPublicCorePushBody = Effect.fn("BackendCoreApplication.readPushBody")((request: Request, maximum: number) =>
  readCoreApplicationJsonBody(request, maximum).pipe(Effect.catchCause((cause): Effect.Effect<never, CoreApplicationTransportError | HttpError> => {
    const [reason] = cause.reasons;
    if (cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason)
      && reason.error instanceof CoreApplicationTransportError
      && (reason.error.reason === "invalidRequest" || reason.error.reason === "bodyTooLarge"))
      return Effect.fail(Object.assign(new HttpError(reason.error.reason === "bodyTooLarge" ? 413 : 400,
        reason.error.reason === "bodyTooLarge" ? "Push request body is too large." : "Push request body must be JSON."), { cause: reason.error }));
    return Effect.failCause(cause);
  })));

function pushOperation(path: PublicDeploymentPushPath): PublicWorkerDispatchSource {
  switch (path.kind) {
    case "start": return "deployment-start-push";
    case "startAnalyzed": return "deployment-start-analyzed-push";
    case "push": return path.action === "finish" ? "deployment-finish-push"
      : path.action === "abandon" ? "deployment-abandon-push" : "deployment-read-push";
  }
}
