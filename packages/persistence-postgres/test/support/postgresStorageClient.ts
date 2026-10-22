import { Data, Effect, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { decodeStorageRequest, storageResponseSchema, type PostgresStorageSessionEndpoint } from "./postgresStorageProtocol";

export class PostgresStorageSessionError extends Data.TaggedError("PostgresStorageSessionError")<{
  readonly reason: "responseTooLarge" | "refused";
  readonly status?: number;
  readonly detail?: string;
}> {}

const decodeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(storageResponseSchema));

/** The fetch-backed RC client does not bound .json/.arrayBuffer through
 * MaxBodySize. Fold its stream into a fixed-size buffer before decoding. */
export const postgresStorageRequest = Effect.fn("PostgresStorage.request")(function* (
  endpoint: PostgresStorageSessionEndpoint, command: ReturnType<typeof decodeStorageRequest>,
) {
  const request = yield* HttpClientRequest.bodyJson(HttpClientRequest.post(endpoint.url).pipe(
    HttpClientRequest.setHeader("authorization", `Bearer ${endpoint.token}`),
  ), command);
  const response = yield* HttpClient.execute(request);
  const bytes = new Uint8Array(8192);
  const length = yield* Stream.runFoldEffect(response.stream, () => 0, (offset, chunk) => {
    if (offset + chunk.byteLength > bytes.byteLength) return Effect.fail(new PostgresStorageSessionError({ reason: "responseTooLarge" }));
    return Effect.sync(() => { bytes.set(chunk, offset); return offset + chunk.byteLength; });
  });
  const result = yield* decodeResponse(new TextDecoder().decode(bytes.subarray(0, length)));
  if (!result.ok) return yield* Effect.fail(new PostgresStorageSessionError({ reason: "refused", status: response.status, detail: result.error }));
  yield* HttpClientResponse.filterStatusOk(response);
  return result;
});
