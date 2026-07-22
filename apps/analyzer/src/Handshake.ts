import {
  canonicalPrivateAnalyzerHandshakeRequestV1,
  canonicalPrivateAnalyzerHandshakeResponseV1,
  capturePrivateAnalyzerReleaseTupleV1,
  decodePrivateAnalyzerHandshakeRequestV1,
  type PrivateAnalyzerReleaseTupleV1,
} from "@flarex/analysis/internal/private-analyzer-release-v1";
import { isUint8Array } from "@flarex/utils/bytes";
import { Cause, Data, Effect, Result } from "effect";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import {
  PrivateAnalyzerHostConfigurationV1Error,
  type PrivateAnalyzerHostConfigurationV1,
  validatePrivateAnalyzerHostConfigurationV1,
} from "./Configuration";

const UTF8_ENCODER = new TextEncoder();
export type PrivateAnalyzerIdentityTupleV1 = PrivateAnalyzerReleaseTupleV1;

export {
  canonicalPrivateAnalyzerHandshakeRequestV1,
  canonicalPrivateAnalyzerHandshakeResponseV1,
};

export class PrivateAnalyzerHandshakeRequestV1Error extends Data.TaggedError(
  "PrivateAnalyzerHandshakeRequestV1Error",
)<{
  readonly reason:
    | "notFound"
    | "methodNotAllowed"
    | "unsupportedMediaType"
    | "invalidContentLength"
    | "payloadTooLarge"
    | "bodyReadFailed"
    | "bodyReadTimedOut"
    | "malformed"
    | "identityMismatch";
}> {}

const bodyReadCause = new WeakMap<PrivateAnalyzerHandshakeRequestV1Error, unknown>();

export function privateAnalyzerHandshakeBodyReadCause(
  error: PrivateAnalyzerHandshakeRequestV1Error,
): unknown {
  return bodyReadCause.get(error);
}

export function decodePrivateAnalyzerHandshakeBytesV1(
  bytes: unknown,
  expected: PrivateAnalyzerIdentityTupleV1,
): Result.Result<PrivateAnalyzerIdentityTupleV1, PrivateAnalyzerHandshakeRequestV1Error> {
  return decodePrivateAnalyzerHandshakeRequestV1(bytes, expected).pipe(
    Result.mapError(error => new PrivateAnalyzerHandshakeRequestV1Error({ reason: error.reason })),
  );
}

export interface PrivateAnalyzerHandshakeHostV1 {
  readonly handle: (request: Request) => Effect.Effect<Response, never, never>;
  readonly maximumBodyBytes: number;
}

export function makePrivateAnalyzerHandshakeHostV1(options: {
  readonly configuration: unknown;
  readonly identity: PrivateAnalyzerIdentityTupleV1;
  readonly onCompatible?: () => Effect.Effect<void, never, never>;
}): Result.Result<PrivateAnalyzerHandshakeHostV1, PrivateAnalyzerHostConfigurationV1Error> {
  return validatePrivateAnalyzerHostConfigurationV1(options.configuration).pipe(
    Result.flatMap(configuration => {
      const capturedIdentity = capturePrivateAnalyzerReleaseTupleV1(options.identity);
      if (Result.isFailure(capturedIdentity)) {
        return Result.fail(new PrivateAnalyzerHostConfigurationV1Error({
          field: "identity",
          reason: "invalidIdentity",
        }));
      }
      const identity = capturedIdentity.success;
      if (
        identity.protocolIdentity !== configuration.protocolIdentity ||
        identity.protocolVersion !== configuration.protocolVersion
      ) {
        return Result.fail(new PrivateAnalyzerHostConfigurationV1Error({
          field: "identity",
          reason: "invalidIdentity",
        }));
      }
      const maximumBodyBytes = canonicalPrivateAnalyzerHandshakeRequestV1(identity).byteLength;
      const onCompatible = options.onCompatible ?? (() => Effect.void);

      const handleExpected = Effect.fn("PrivateAnalyzerHost.handleExpected")(
        function* (request: Request): Effect.fn.Return<Response, PrivateAnalyzerHandshakeRequestV1Error> {
          const url = new URL(request.url);
          if (url.pathname !== configuration.handshake.path) {
            return yield* new PrivateAnalyzerHandshakeRequestV1Error({ reason: "notFound" });
          }
          if (request.method !== configuration.handshake.method) {
            return yield* new PrivateAnalyzerHandshakeRequestV1Error({ reason: "methodNotAllowed" });
          }
          if (request.headers.get("content-type") !== configuration.handshake.contentType) {
            return yield* new PrivateAnalyzerHandshakeRequestV1Error({ reason: "unsupportedMediaType" });
          }
          const contentLength = request.headers.get("content-length");
          let declaredContentLength: number | undefined;
          if (contentLength !== null) {
            if (!/^(0|[1-9][0-9]*)$/u.test(contentLength)) {
              return yield* new PrivateAnalyzerHandshakeRequestV1Error({ reason: "invalidContentLength" });
            }
            const parsed = Number(contentLength);
            if (!Number.isSafeInteger(parsed)) {
              return yield* new PrivateAnalyzerHandshakeRequestV1Error({ reason: "payloadTooLarge" });
            }
            if (parsed > maximumBodyBytes) {
              return yield* new PrivateAnalyzerHandshakeRequestV1Error({ reason: "payloadTooLarge" });
            }
            declaredContentLength = parsed;
          }
          const bytes = yield* readPrivateAnalyzerHandshakeBodyV1(
            request,
            maximumBodyBytes,
            configuration.handshake.maximumBodyReadMilliseconds,
          );
          if (declaredContentLength !== undefined && bytes.byteLength !== declaredContentLength) {
            return yield* new PrivateAnalyzerHandshakeRequestV1Error({ reason: "invalidContentLength" });
          }
          yield* Effect.fromResult(decodePrivateAnalyzerHandshakeBytesV1(bytes, identity));
          yield* onCompatible();
          return bytesResponse(canonicalPrivateAnalyzerHandshakeResponseV1(identity), 200);
        },
      );

      const handle = Effect.fn("PrivateAnalyzerHost.handle")((request: Request) =>
        handleExpected(request).pipe(
          Effect.catch(error => Effect.succeed(errorResponse(error))),
        )
      );

      return Result.succeed(Object.freeze({ handle, maximumBodyBytes }));
    }),
  );
}

export const readPrivateAnalyzerHandshakeBodyV1: (
  request: Request,
  maximumBodyBytes: number,
  maximumBodyReadMilliseconds: number,
) => Effect.Effect<Uint8Array, PrivateAnalyzerHandshakeRequestV1Error, never> = Effect.fn(
  "PrivateAnalyzerHandshake.readBody",
)((request, maximumBodyBytes, maximumBodyReadMilliseconds) =>
  Effect.tryPromise({
    try: async signal => {
      const body = request.body;
      if (body === null) return { kind: "bytes" as const, bytes: new Uint8Array(0) };
      const reader = body.getReader();
      const onAbort = () => {
        void reader.cancel().catch(() => undefined);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        const chunks: Uint8Array[] = [];
        let total = 0;
        let reads = 0;
        while (true) {
          if (reads >= maximumBodyBytes + 1) {
            await cancelReaderBestEffort(reader);
            return { kind: "overflow" as const };
          }
          reads += 1;
          const next = await reader.read();
          if (next.done) break;
          if (!isUint8Array(next.value)) return { kind: "invalidChunk" as const };
          if (next.value.byteLength === 0) continue;
          const nextTotal = total + next.value.byteLength;
          if (!Number.isSafeInteger(nextTotal) || nextTotal > maximumBodyBytes) {
            await cancelReaderBestEffort(reader);
            return { kind: "overflow" as const };
          }
          chunks.push(new Uint8Array(next.value));
          total = nextTotal;
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return { kind: "bytes" as const, bytes };
      } finally {
        signal.removeEventListener("abort", onAbort);
        reader.releaseLock();
      }
    },
    catch: cause => {
      const error = new PrivateAnalyzerHandshakeRequestV1Error({ reason: "bodyReadFailed" });
      bodyReadCause.set(error, cause);
      return error;
    },
  }).pipe(
    Effect.flatMap(result => {
      switch (result.kind) {
        case "bytes":
          return Effect.succeed(result.bytes);
        case "overflow":
          return Effect.fail(new PrivateAnalyzerHandshakeRequestV1Error({ reason: "payloadTooLarge" }));
        case "invalidChunk":
          return Effect.die(new Error("Private analyzer request stream produced a non-byte chunk."));
      }
    }),
    Effect.timeout(`${maximumBodyReadMilliseconds} millis`),
    Effect.mapError(error => Cause.isTimeoutError(error)
      ? new PrivateAnalyzerHandshakeRequestV1Error({ reason: "bodyReadTimedOut" })
      : error),
  ));

async function cancelReaderBestEffort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The primary read-limit verdict is already known; cancellation is best-effort cleanup.
  }
}

function errorResponse(error: PrivateAnalyzerHandshakeRequestV1Error): Response {
  const status = statusForError(error.reason);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (error.reason === "methodNotAllowed") headers.allow = "POST";
  return bytesResponse(
    UTF8_ENCODER.encode(encodeCanonicalJson({ error: redactedCode(error.reason) }, handshakeInvariant)),
    status,
    headers,
  );
}

function statusForError(reason: PrivateAnalyzerHandshakeRequestV1Error["reason"]): number {
  switch (reason) {
    case "notFound": return 404;
    case "methodNotAllowed": return 405;
    case "identityMismatch": return 409;
    case "payloadTooLarge": return 413;
    case "unsupportedMediaType": return 415;
    case "bodyReadTimedOut": return 408;
    case "invalidContentLength":
    case "bodyReadFailed":
    case "malformed":
      return 400;
  }
}

function redactedCode(reason: PrivateAnalyzerHandshakeRequestV1Error["reason"]): string {
  switch (reason) {
    case "notFound": return "not_found";
    case "methodNotAllowed": return "method_not_allowed";
    case "identityMismatch": return "incompatible_identity";
    case "payloadTooLarge": return "payload_too_large";
    case "unsupportedMediaType": return "unsupported_media_type";
    case "bodyReadFailed": return "body_read_failed";
    case "bodyReadTimedOut": return "request_timeout";
    case "invalidContentLength":
    case "malformed":
      return "invalid_request";
  }
}

function bytesResponse(bytes: Uint8Array, status: number, headers: Record<string, string> = {
  "content-type": "application/json",
}): Response {
  return new Response(new Uint8Array(bytes), { status, headers });
}

function handshakeInvariant(): never {
  throw new Error("Private analyzer handshake lost its canonical JSON invariant.");
}
