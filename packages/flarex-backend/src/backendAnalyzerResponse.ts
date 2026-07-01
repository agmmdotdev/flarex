import { Data, Effect } from "effect";
import { readResponseJsonOrNullEffect } from "./http";
import { decodeDeploymentAnalyzedStartPushPayload } from "./deployment/Requests";
import { decodeAnalyzedStartPushRequest } from "./deployment/Validation";
import {
  publicWorkerDispatchError,
  type PublicWorkerDispatchError,
} from "./worker/PublicRouteDispatchError";
import type {
  AnalyzedStartPushRequest,
  PushDiagnostic,
  StartPushRequest,
} from "./types";

export type RawAnalyzerSuccessResponse = {
  analysis: unknown;
  codegenAnalysis: unknown;
  diagnostics?: unknown;
};

type AnalyzerHttpResponse = Pick<Response, "json" | "ok" | "status">;

export class BackendAnalyzerResponseError extends Data.TaggedError("BackendAnalyzerResponseError")<{
  readonly status: number;
  readonly message: string;
  readonly diagnostics: PushDiagnostic[] | undefined;
  readonly body: unknown;
}> {}

export const decodeBackendAnalyzerResponse = Effect.fn("Worker.decodeBackendAnalyzerResponse")(
  function* (response: AnalyzerHttpResponse) {
    const body = yield* readBackendAnalyzerResponseJson(response);
    if (response.ok && isAnalyzerSuccessResponse(body)) {
      return body;
    }
    return yield* Effect.fail(new BackendAnalyzerResponseError({
      status: response.status,
      message: backendAnalyzerResponseErrorMessage(body, response),
      diagnostics: analyzerDiagnostics(body),
      body,
    }));
  },
);

export const analyzeSourcePackageEffect = Effect.fn("Worker.analyzeSourcePackage")(
  function* (
    analyzer: Fetcher,
    deploymentId: string,
    request: StartPushRequest,
  ): Effect.fn.Return<AnalyzedStartPushRequest, PublicWorkerDispatchError> {
    const response = yield* Effect.tryPromise({
      try: () => analyzer.fetch("https://flarex-analyzer.internal/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deploymentId, sourcePackage: request.sourcePackage }),
      }),
      catch: error => publicWorkerDispatchError("deployment-start-push-analyze", error),
    });
    const decoded = yield* decodeBackendAnalyzerStartPushResponse(
      response,
      request.sourcePackage,
    ).pipe(
      Effect.match({
        onFailure: error => ({ ok: false, error } as const),
        onSuccess: analyzed => ({ ok: true, analyzed } as const),
      }),
    );
    if (decoded.ok) {
      return decoded.analyzed;
    }
    return {
      sourcePackage: request.sourcePackage,
      error: decoded.error.message,
      ...(decoded.error.diagnostics === undefined ? {} : { diagnostics: decoded.error.diagnostics }),
    };
  },
);

export const decodeBackendAnalyzerStartPushResponse = Effect.fn(
  "Worker.decodeBackendAnalyzerStartPushResponse",
)(function* (
  response: AnalyzerHttpResponse,
  sourcePackage: StartPushRequest["sourcePackage"],
): Effect.fn.Return<AnalyzedStartPushRequest, BackendAnalyzerResponseError> {
  const body = yield* decodeBackendAnalyzerResponse(response);
  const diagnostics = analyzerDiagnostics(body);
  const analyzed: AnalyzedStartPushRequest = {
    sourcePackage,
    analysis: body.analysis,
    codegenAnalysis: body.codegenAnalysis,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
  const protocolPayload = yield* decodeDeploymentAnalyzedStartPushPayload(analyzed).pipe(
    Effect.mapError(error => new BackendAnalyzerResponseError({
      status: response.status,
      message: error.message,
      diagnostics,
      body,
    })),
  );
  return yield* decodeAnalyzedStartPushRequest(protocolPayload).pipe(
    Effect.mapError(error => new BackendAnalyzerResponseError({
      status: response.status,
      message: error.message,
      diagnostics,
      body,
    })),
  );
});

function readBackendAnalyzerResponseJson(response: AnalyzerHttpResponse): Effect.Effect<unknown> {
  return readResponseJsonOrNullEffect(response);
}

function backendAnalyzerResponseErrorMessage(
  body: unknown,
  response: AnalyzerHttpResponse,
): string {
  if (body !== null && typeof body === "object" && "error" in body) {
    return String(body.error);
  }
  if (
    response.ok &&
    body !== null &&
    typeof body === "object" &&
    "analysis" in body &&
    !("codegenAnalysis" in body)
  ) {
    return "Backend analyzer response did not include codegenAnalysis.";
  }
  return `Analyzer request failed with status ${response.status}`;
}

export function analyzerDiagnostics(body: unknown): PushDiagnostic[] | undefined {
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !("diagnostics" in body) ||
    body.diagnostics === undefined
  ) {
    return undefined;
  }
  if (!Array.isArray(body.diagnostics)) return undefined;
  return body.diagnostics.slice(-100).flatMap((diagnostic): PushDiagnostic[] => {
    if (diagnostic === null || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
      return [];
    }
    if (!("level" in diagnostic) || !("message" in diagnostic)) return [];
    const level = diagnostic.level;
    const message = diagnostic.message;
    if (level !== "log" && level !== "warn" && level !== "error") return [];
    if (typeof message !== "string") return [];
    return [{ level, message }];
  });
}

function isAnalyzerSuccessResponse(body: unknown): body is RawAnalyzerSuccessResponse {
  return (
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "analysis" in body &&
    body.analysis !== undefined &&
    "codegenAnalysis" in body &&
    body.codegenAnalysis !== undefined &&
    body.codegenAnalysis !== null &&
    !("error" in body)
  );
}
