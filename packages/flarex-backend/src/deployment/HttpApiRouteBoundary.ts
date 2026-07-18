import { Effect } from "effect";
import {
  type AbandonPushRequest,
  type AnalyzedStartPushRequest,
  DeploymentPushAction,
  DeploymentProtocolValidationError,
  DeploymentRoute,
  type FinishPushRequest,
} from "flarex-protocol/deployment";
import {
  badRequestErrorToHttpError,
  type HttpError,
  readJsonEffect,
  RequestJsonError,
} from "../http";
import {
  decodeDeploymentAbandonPushPayload,
  decodeDeploymentAnalyzedStartPushPayload,
  decodeDeploymentFinishPushPayload,
} from "./Requests";

const deploymentPushRoutePattern = new RegExp(`^${DeploymentRoute.push}/([^/]+)(?:/([^/]+))?$`);

export type DeploymentRouteError = RequestJsonError | DeploymentProtocolValidationError;

export type DeploymentApiRouteInput =
  | {
    readonly _tag: "DeploymentApiHealthRoute";
    readonly request: Request;
  }
  | {
    readonly _tag: "DeploymentApiActiveDeploymentRoute";
    readonly request: Request;
  }
  | {
    readonly _tag: "DeploymentApiGetPushRoute";
    readonly request: Request;
    readonly pushId: string;
  }
  | {
    readonly _tag: "DeploymentApiStartAnalyzedPushRoute";
    readonly url: URL;
    readonly body: AnalyzedStartPushRequest;
  }
  | {
    readonly _tag: "DeploymentApiFinishPushRoute";
    readonly url: URL;
    readonly pushId: string;
    readonly body: FinishPushRequest;
  }
  | {
    readonly _tag: "DeploymentApiAbandonPushRoute";
    readonly url: URL;
    readonly pushId: string;
    readonly body: AbandonPushRequest;
  };

export const decodeDeploymentApiRouteInput = Effect.fn("DeploymentDO.decodeApiRouteInput")(
  function* (request: Request): Effect.fn.Return<DeploymentApiRouteInput | null, DeploymentRouteError> {
    const url = new URL(request.url);
    if (url.pathname === DeploymentRoute.health && request.method === "GET") {
      return {
        _tag: "DeploymentApiHealthRoute",
        request,
      };
    }
    if (url.pathname === DeploymentRoute.activeDeployment && request.method === "GET") {
      return {
        _tag: "DeploymentApiActiveDeploymentRoute",
        request,
      };
    }
    if (url.pathname === DeploymentRoute.startAnalyzedPush && request.method === "POST") {
      const body = yield* decodeDeploymentAnalyzedStartPushRouteRequest(request);
      return {
        _tag: "DeploymentApiStartAnalyzedPushRoute",
        url,
        body,
      };
    }

    const pushMatch = url.pathname.match(deploymentPushRoutePattern);
    if (pushMatch === null) {
      return null;
    }
    const pushId = pushMatch[1];
    if (pushId === undefined) {
      return null;
    }
    const action = pushMatch[2];
    if (action === undefined && request.method === "GET") {
      return {
        _tag: "DeploymentApiGetPushRoute",
        request,
        pushId,
      };
    }
    if (action === DeploymentPushAction.finish && request.method === "POST") {
      const body = yield* decodeDeploymentFinishPushRouteRequest(request);
      return {
        _tag: "DeploymentApiFinishPushRoute",
        url,
        pushId,
        body,
      };
    }
    if (action === DeploymentPushAction.abandon && request.method === "POST") {
      const body = yield* decodeDeploymentAbandonPushRouteRequest(request);
      return {
        _tag: "DeploymentApiAbandonPushRoute",
        url,
        pushId,
        body,
      };
    }
    return null;
  },
);

export function decodeDeploymentAnalyzedStartPushRouteRequest(
  request: Request,
): Effect.Effect<AnalyzedStartPushRequest, DeploymentRouteError> {
  return decodeDeploymentRouteRequest(request, decodeDeploymentAnalyzedStartPushRoutePayload);
}

export function decodeDeploymentAnalyzedStartPushRoutePayload(
  value: unknown,
): Effect.Effect<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  return decodeDeploymentAnalyzedStartPushPayload(value);
}

export function decodeDeploymentFinishPushRouteRequest(
  request: Request,
): Effect.Effect<FinishPushRequest, DeploymentRouteError> {
  return decodeDeploymentRouteRequest(request, decodeDeploymentFinishPushRoutePayload);
}

export function decodeDeploymentFinishPushRoutePayload(
  value: unknown,
): Effect.Effect<FinishPushRequest, DeploymentProtocolValidationError> {
  return decodeDeploymentFinishPushPayload(value);
}

export function deploymentRouteErrorToHttpError(
  error: DeploymentRouteError,
): HttpError {
  return badRequestErrorToHttpError(error);
}

export const deploymentRouteErrorToHttpErrorEffect = Effect.fn(
  "DeploymentHttpApiRouteBoundary.deploymentRouteErrorToHttpError",
)(function* (
  error: DeploymentRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(deploymentRouteErrorToHttpError(error));
});

export function decodeDeploymentAbandonPushRouteRequest(
  request: Request,
): Effect.Effect<AbandonPushRequest, DeploymentRouteError> {
  return decodeDeploymentRouteRequest(request, decodeDeploymentAbandonPushRoutePayload);
}

export function decodeDeploymentAbandonPushRoutePayload(
  value: unknown,
): Effect.Effect<AbandonPushRequest, DeploymentProtocolValidationError> {
  return decodeDeploymentAbandonPushPayload(value);
}

function decodeDeploymentRouteRequest<A>(
  request: Request,
  parse: (value: unknown) => Effect.Effect<A, DeploymentProtocolValidationError>,
): Effect.Effect<A, DeploymentRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parse),
  );
}
