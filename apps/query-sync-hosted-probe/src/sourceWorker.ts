import { Cause, Data, Effect, Exit, Result, Schema } from "effect";
import { CORE_QUERY_CHECKPOINT_MAXIMUM_REQUEST_BYTES, coreQueryCheckpointPath, decodeCoreQueryCheckpointRequest,
  encodeCoreQueryCheckpointResponse, type CoreQueryCheckpointRequest } from "flarex-protocol/internal/core-query-checkpoint";
import { readCoreApplicationBodyBytes, type CoreApplicationTransportError } from "@flarex/executor-http/internal/core-application";
import { hasExactBearerCapability, isConfiguredSecret } from "./authentication";
import { FX02B_PROBE_ROUTE, FX02B_PROBE_SOURCE_ID } from "./fixture";

interface Fx02bSourceEnv { readonly FLAREX_EXECUTOR_TOKEN?: string }
const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));
class HostedCheckpointSourceBodyError extends Data.TaggedError("HostedCheckpointSourceBodyError")<{
  readonly cause: Cause.Cause<CoreApplicationTransportError>;
}> {}

/** Synthetic source has retained snapshots 1 and 2; initialization selects 1,
 * and the resumed reader selects 2 after the fixture's intervening publication. */
export const fx02bSourceWorker = {
  async fetch(request: Request, env: Fx02bSourceEnv): Promise<Response> {
    const token = env.FLAREX_EXECUTOR_TOKEN;
    if (!isConfiguredSecret(token)) return privateText("Misconfigured", 500);
    if (!(await hasExactBearerCapability(request, token))) return privateText("Unauthorized", 401);
    if (new URL(request.url).pathname !== coreQueryCheckpointPath(FX02B_PROBE_ROUTE.deploymentId)) return privateText("Not Found", 404);
    if (request.method !== "POST") return privateText("Method Not Allowed", 405);
    if (request.headers.get("content-type") !== "application/json") return privateText("Unsupported Media Type", 415);
    const captured = await Effect.runPromiseExit(readCoreApplicationBodyBytes(request,
      CORE_QUERY_CHECKPOINT_MAXIMUM_REQUEST_BYTES), { signal: request.signal });
    if (Exit.isFailure(captured)) {
      const reason = captured.cause.reasons[0];
      if (captured.cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason))
        return privateText("Invalid Request", reason.error.reason === "bodyTooLarge" ? 413 : 400);
      throw new HostedCheckpointSourceBodyError({ cause: captured.cause });
    }
    const decodedText = new TextDecoder().decode(captured.value);
    return Result.match(decodeJson(decodedText).pipe(Result.flatMap(decodeCoreQueryCheckpointRequest)), {
      onFailure: () => privateText("Invalid Request", 400), onSuccess: sourceResponse,
    });
  },
} satisfies ExportedHandler<Fx02bSourceEnv>;
export default fx02bSourceWorker;
function sourceResponse(value: CoreQueryCheckpointRequest): Response {
  if (value.route.deploymentId !== FX02B_PROBE_ROUTE.deploymentId || value.route.scopeUuid !== FX02B_PROBE_ROUTE.scopeUuid)
    return privateText("Not Found", 404);
  const through = value.after === null ? "1" : "2";
  if (value.after !== null && BigInt(value.after) > BigInt(through)) return Response.json({
    format: "flarex.core-application.failure", version: 1, error: { code: "invalid_checkpoint", message: "Invalid fixture checkpoint" },
  }, { status: 409 });
  return Result.match(encodeCoreQueryCheckpointResponse({ format: "flarex.core-query-checkpoint.response", version: 1,
    kind: value.route.epochUuid !== FX02B_PROBE_ROUTE.epochUuid || value.sourceId !== null && value.sourceId !== FX02B_PROBE_SOURCE_ID
      ? "sourceReplaced" : "certified", route: FX02B_PROBE_ROUTE, sourceId: FX02B_PROBE_SOURCE_ID,
    after: value.after, retainedFrom: "0", through,
  }), { onFailure: () => privateText("Invalid Fixture", 500),
    onSuccess: certificate => Response.json(certificate, { headers: { "cache-control": "no-store" } }) });
}
function privateText(body: string, status: number): Response {
  return new Response(body, { status, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
}
