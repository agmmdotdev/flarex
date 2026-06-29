import { Data, Effect } from "effect";
import type { PushDiagnostic } from "./types";

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

function readBackendAnalyzerResponseJson(response: AnalyzerHttpResponse): Effect.Effect<unknown> {
  return Effect.promise(() => response.json().catch(() => null));
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
