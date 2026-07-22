import { bytesEqualFullScan, copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Cause, Clock, Data, Effect, Result } from "effect";
import { deploymentObjectName } from "../routing";
import { readBackendBoundedBody } from "../boundedBody";
import {
  SourceArtifactV2AttemptStoreCorruptionError,
  SourceArtifactV2AttemptStoreResourceError,
  type SourceArtifactV2Attempt,
  type SourceArtifactV2AttemptReader,
} from "./AttemptStore";
import { sourceArtifactV2DigestBytesFromLowerHex } from "./Digest";
import {
  captureSourceArtifactV2FinalizedAttemptReadBudgetV1,
  decodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1,
  decodeSourceArtifactV2FinalizedAttemptReadRequestV1,
  encodeSourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1,
  encodeSourceArtifactV2FinalizedAttemptReadResponseV1,
  encodeSourceArtifactV2FinalizedAttemptReadUsageHeaderV1,
  sourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1,
  sourceArtifactV2FinalizedAttemptReadBudgetHeaderV1,
  sourceArtifactV2FinalizedAttemptReadMediaTypeV1,
  sourceArtifactV2FinalizedAttemptReadPathV1,
  sourceArtifactV2FinalizedAttemptReadUsageHeaderV1,
  type SourceArtifactV2FinalizedAttemptReadBudgetFieldV1,
  type SourceArtifactV2FinalizedAttemptReadBudgetV1,
  type SourceArtifactV2FinalizedAttemptReadRequestV1,
  type SourceArtifactV2FinalizedAttemptReadResponseV1,
  type SourceArtifactV2FinalizedAttemptReadUsageV1,
} from "./FinalizedAttemptReadProtocol";
import {
  SourceArtifactV2FrameBudgetError,
  sourceArtifactV2UploadSelectorFrame,
} from "./Framing";
import {
  SourceArtifactV2Sha256ResourceError,
  type SourceArtifactV2Sha256,
} from "./Sha256";

export interface SourceArtifactV2FinalizedAttemptReadRouteV1 {
  readonly route: (request: Request) => Effect.Effect<Response, never, never>;
}

export class SourceArtifactV2FinalizedAttemptReadBodyResourceV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadBodyResourceV1Error",
)<{}> {}

class SourceArtifactV2FinalizedAttemptReadBodyBudgetV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadBodyBudgetV1Error",
)<{}> {}

const bodyResourceCause = new WeakMap<
  SourceArtifactV2FinalizedAttemptReadBodyResourceV1Error,
  unknown
>();

export function sourceArtifactV2FinalizedAttemptReadBodyResourceCauseV1(
  error: SourceArtifactV2FinalizedAttemptReadBodyResourceV1Error,
): unknown {
  return bodyResourceCause.get(error);
}

export function isSourceArtifactV2FinalizedAttemptReadRequestV1(
  request: Request,
): boolean {
  return new URL(request.url).pathname === sourceArtifactV2FinalizedAttemptReadPathV1;
}

export function makeSourceArtifactV2FinalizedAttemptReadRouteV1(options: {
  readonly durableObjectName: string | undefined;
  readonly reader: SourceArtifactV2AttemptReader;
  readonly sha256: SourceArtifactV2Sha256;
}): SourceArtifactV2FinalizedAttemptReadRouteV1 {
  const durableObjectName = options.durableObjectName;
  const reader = options.reader;
  const sha256 = options.sha256;
  const route = Effect.fn("DeploymentDO.readFinalizedSourceArtifactV2Attempt")(
    function* (request: Request): Effect.fn.Return<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      if (request.headers.get("content-type") !== sourceArtifactV2FinalizedAttemptReadMediaTypeV1) {
        return new Response(null, { status: 400 });
      }
      const headerBudget = decodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1(
        request.headers.get(sourceArtifactV2FinalizedAttemptReadBudgetHeaderV1),
      );
      if (Result.isFailure(headerBudget)) return new Response(null, { status: 400 });
      const startedAt = yield* Clock.currentTimeNanos;
      const contentLength = request.headers.get("content-length");
      if (contentLength !== null) {
        if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
          return new Response(null, { status: 400 });
        }
        const parsed = Number(contentLength);
        if (!Number.isSafeInteger(parsed) || parsed > headerBudget.success.maximumBodyBytes) {
          return budgetFailureResponse("bodyBytes");
        }
      }
      const body = yield* readBackendBoundedBody(
        request.body,
        headerBudget.success.maximumBodyBytes,
        {
          limitExceeded: () => new SourceArtifactV2FinalizedAttemptReadBodyBudgetV1Error(),
          resourceFailure: cause => bodyResourceFailure(cause),
        },
      ).pipe(
        Effect.timeout(`${headerBudget.success.maximumElapsedMilliseconds} millis`),
        Effect.match({
          onFailure: error => Cause.isTimeoutError(error)
            ? budgetFailureResponse("elapsedMilliseconds")
            : error instanceof SourceArtifactV2FinalizedAttemptReadBodyBudgetV1Error
              ? budgetFailureResponse("bodyBytes")
            : new Response(null, { status: 503 }),
          onSuccess: bytes => bytes,
        }),
      );
      if (body instanceof Response) return body;
      const decoded = decodeSourceArtifactV2FinalizedAttemptReadRequestV1(
        body,
        headerBudget.success,
      );
      if (Result.isFailure(decoded)) {
        return decoded.failure.reason === "budgetExhausted"
          ? budgetFailureResponse(codecBudgetField(decoded.failure.field))
          : new Response(null, { status: 400 });
      }
      const input = decoded.success.value;
      if (
        durableObjectName === undefined ||
        durableObjectName !== deploymentObjectName(input.deploymentId)
      ) {
        return yield* encodeClosedResponse(
          input,
          "corruption",
          decoded.success.usage,
          startedAt,
          headerBudget.success,
        );
      }
      return yield* resolveAndEncode(
        input,
        decoded.success.usage,
        startedAt,
        headerBudget.success,
        reader,
        sha256,
      );
    },
  );
  return Object.freeze({ route });
}

const resolveAndEncode = Effect.fn("SourceArtifactV2FinalizedAttemptRead.resolveAndEncode")(
  function* (
    input: SourceArtifactV2FinalizedAttemptReadRequestV1,
    codecUsage: SourceArtifactV2FinalizedAttemptReadUsageV1,
    startedAt: bigint,
    budget: SourceArtifactV2FinalizedAttemptReadBudgetV1,
    reader: SourceArtifactV2AttemptReader,
    sha256: SourceArtifactV2Sha256,
  ): Effect.fn.Return<Response> {
    let usage = codecUsage;
    if (!(yield* elapsedFits(startedAt, budget))) {
      return budgetFailureResponse("elapsedMilliseconds");
    }
    const callUsage = addUsage(usage, { calls: 1 });
    if (!usageFits(callUsage, budget)) return budgetFailureResponse("calls");
    usage = callUsage;
    const read = yield* reader.read(input.uploadId).pipe(
      Effect.match({
        onFailure: (error): ReadOutcome => {
          if (error instanceof SourceArtifactV2AttemptStoreCorruptionError) {
            return { kind: "corruption" };
          }
          if (error instanceof SourceArtifactV2AttemptStoreResourceError) {
            return { kind: "resourceFailure" };
          }
          throw error;
        },
        onSuccess: (attempt): ReadOutcome => ({ kind: "attempt", attempt }),
      }),
    );
    if (read.kind !== "attempt") {
      return yield* encodeClosedResponse(input, read.kind, usage, startedAt, budget);
    }
    const attempt = read.attempt;
    if (attempt === null) {
      return yield* encodeClosedResponse(input, "notFound", usage, startedAt, budget);
    }
    if (attempt.generation !== input.expectedGeneration) {
      return yield* encodeClosedResponse(input, "staleGeneration", usage, startedAt, budget);
    }
    if (attempt.mutationFence !== input.expectedMutationFence) {
      return yield* encodeClosedResponse(input, "staleFence", usage, startedAt, budget);
    }
    if (
      attempt.state !== "finalized" || attempt.pendingCommand !== null ||
      attempt.currentModule !== null
    ) {
      return yield* encodeClosedResponse(
        input,
        "lifecycleMismatch",
        usage,
        startedAt,
        budget,
      );
    }
    if (attempt.completedRootDigest === null || attempt.completedSelectorDigest === null) {
      return yield* encodeClosedResponse(input, "corruption", usage, startedAt, budget);
    }
    const frameBudget = remaining(budget.maximumFrameBytes, usage.frameBytes);
    if (frameBudget === undefined) return budgetFailureResponse("frameBytes");
    if (!(yield* elapsedFits(startedAt, budget))) {
      return budgetFailureResponse("elapsedMilliseconds");
    }
    const frameResult = sourceArtifactV2UploadSelectorFrame({
      deploymentId: input.deploymentId,
      uploadId: attempt.uploadId,
      generation: BigInt(attempt.generation),
      rootDigest: sourceArtifactV2DigestBytesFromLowerHex(attempt.completedRootDigest),
    }, { maximumFrameBytesMaterialized: frameBudget });
    if (Result.isFailure(frameResult)) {
      if (frameResult.failure instanceof SourceArtifactV2FrameBudgetError) {
        return budgetFailureResponse("frameBytes");
      }
      return yield* Effect.die(frameResult.failure);
    }
    const frame = frameResult.success;
    const projected = addUsage(usage, {
      canonicalBytes: frame.canonicalBytesMaterialized,
      frameBytes: frame.frameBytesMaterialized,
      hashBytes: frame.frameBytesMaterialized,
      calls: 1,
    });
    if (!usageFits(projected, budget)) {
      return budgetFailureResponse(firstExceeded(projected, budget));
    }
    usage = projected;
    const hashDeadline = yield* remainingElapsed(startedAt, budget);
    if (hashDeadline < 1) return budgetFailureResponse("elapsedMilliseconds");
    const digest = yield* sha256(frame.bytes, {
      maximumInputBytes: frame.frameBytesMaterialized,
    }).pipe(
      Effect.timeout(`${hashDeadline} millis`),
      Effect.matchEffect({
        onFailure: error => Cause.isTimeoutError(error)
          ? Effect.succeed(budgetFailureResponse("elapsedMilliseconds"))
          : error instanceof SourceArtifactV2Sha256ResourceError
            ? encodeClosedResponse(
                input,
                "resourceFailure",
                usage,
                startedAt,
                budget,
              )
            : Effect.die(error),
        onSuccess: Effect.succeed,
      }),
    );
    if (digest instanceof Response) return digest;
    const storedSelector = sourceArtifactV2DigestBytesFromLowerHex(
      attempt.completedSelectorDigest,
    );
    if (!bytesEqualFullScan(digest, storedSelector)) {
      return yield* encodeClosedResponse(input, "corruption", usage, startedAt, budget);
    }
    return yield* encodeResponse(
      Object.freeze({
        codecVersion: 1,
        sourceArtifactCodecVersion: 1,
        kind: "finalized",
        requestId: input.requestId,
        deploymentId: input.deploymentId,
        uploadId: attempt.uploadId,
        expectedGeneration: input.expectedGeneration,
        expectedMutationFence: input.expectedMutationFence,
        generation: attempt.generation,
        mutationFence: attempt.mutationFence,
        completedRootDigest: attempt.completedRootDigest,
        completedSelectorDigest: attempt.completedSelectorDigest,
      }),
      usage,
      startedAt,
      budget,
    );
  },
);

function encodeClosedResponse(
  input: SourceArtifactV2FinalizedAttemptReadRequestV1,
  kind: Exclude<SourceArtifactV2FinalizedAttemptReadResponseV1["kind"], "finalized">,
  usage: SourceArtifactV2FinalizedAttemptReadUsageV1,
  startedAt: bigint,
  budget: SourceArtifactV2FinalizedAttemptReadBudgetV1,
): Effect.Effect<Response> {
  return encodeResponse(Object.freeze({
    codecVersion: 1,
    sourceArtifactCodecVersion: 1,
    kind,
    requestId: input.requestId,
    deploymentId: input.deploymentId,
    uploadId: input.uploadId,
    expectedGeneration: input.expectedGeneration,
    expectedMutationFence: input.expectedMutationFence,
  }), usage, startedAt, budget);
}

const encodeResponse = Effect.fn("SourceArtifactV2FinalizedAttemptRead.encodeResponse")(
  function* (
    value: SourceArtifactV2FinalizedAttemptReadResponseV1,
    usageBeforeResponse: SourceArtifactV2FinalizedAttemptReadUsageV1,
    startedAt: bigint,
    budget: SourceArtifactV2FinalizedAttemptReadBudgetV1,
  ): Effect.fn.Return<Response> {
    if (!(yield* elapsedFits(startedAt, budget))) {
      return budgetFailureResponse("elapsedMilliseconds");
    }
    const remainingBudget = remainingBudgetAfter(budget, usageBeforeResponse);
    if (Result.isFailure(remainingBudget)) {
      return budgetFailureResponse(remainingBudget.failure);
    }
    const encoded = encodeSourceArtifactV2FinalizedAttemptReadResponseV1(
      value,
      remainingBudget.success,
    );
    if (Result.isFailure(encoded)) {
      return encoded.failure.reason === "budgetExhausted"
        ? budgetFailureResponse(codecBudgetField(encoded.failure.field))
        : yield* Effect.die(encoded.failure);
    }
    const elapsedMilliseconds = elapsed(startedAt, yield* Clock.currentTimeNanos);
    const totalUsage = Object.freeze({
      ...addUsage(usageBeforeResponse, encoded.success.usage),
      elapsedMilliseconds,
    });
    if (!usageFits(totalUsage, budget)) {
      return budgetFailureResponse(firstExceeded(totalUsage, budget));
    }
    const usageHeader = encodeSourceArtifactV2FinalizedAttemptReadUsageHeaderV1(totalUsage);
    if (Result.isFailure(usageHeader)) return yield* Effect.die(usageHeader.failure);
    return new Response(copyBytesToArrayBuffer(encoded.success.bytes), {
      status: statusForKind(value.kind),
      headers: {
        "content-type": sourceArtifactV2FinalizedAttemptReadMediaTypeV1,
        [sourceArtifactV2FinalizedAttemptReadUsageHeaderV1]: usageHeader.success,
      },
    });
  },
);

function bodyResourceFailure(cause: unknown): SourceArtifactV2FinalizedAttemptReadBodyResourceV1Error {
  const error = new SourceArtifactV2FinalizedAttemptReadBodyResourceV1Error();
  bodyResourceCause.set(error, cause);
  return error;
}

function budgetFailureResponse(field: SourceArtifactV2FinalizedAttemptReadBudgetFieldV1): Response {
  const header = encodeSourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1(field);
  if (Result.isFailure(header)) throw header.failure;
  return new Response(null, {
    status: 422,
    headers: { [sourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1]: header.success },
  });
}

function addUsage(
  left: SourceArtifactV2FinalizedAttemptReadUsageV1,
  right: Partial<SourceArtifactV2FinalizedAttemptReadUsageV1>,
): SourceArtifactV2FinalizedAttemptReadUsageV1 {
  return Object.freeze({
    calls: checkedAdd(left.calls, right.calls ?? 0),
    inputBytes: checkedAdd(left.inputBytes, right.inputBytes ?? 0),
    bodyBytes: checkedAdd(left.bodyBytes, right.bodyBytes ?? 0),
    canonicalBytes: checkedAdd(left.canonicalBytes, right.canonicalBytes ?? 0),
    frameBytes: checkedAdd(left.frameBytes, right.frameBytes ?? 0),
    hashBytes: checkedAdd(left.hashBytes, right.hashBytes ?? 0),
    elapsedMilliseconds: checkedAdd(
      left.elapsedMilliseconds,
      right.elapsedMilliseconds ?? 0,
    ),
  });
}

function remainingBudgetAfter(
  budget: SourceArtifactV2FinalizedAttemptReadBudgetV1,
  usage: SourceArtifactV2FinalizedAttemptReadUsageV1,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadBudgetV1,
  SourceArtifactV2FinalizedAttemptReadBudgetFieldV1
> {
  if (!usageFits(usage, budget)) return Result.fail(firstExceeded(usage, budget));
  return captureSourceArtifactV2FinalizedAttemptReadBudgetV1({
    maximumCalls: budget.maximumCalls - usage.calls,
    maximumInputBytes: budget.maximumInputBytes - usage.inputBytes,
    maximumBodyBytes: budget.maximumBodyBytes - usage.bodyBytes,
    maximumCanonicalBytes: budget.maximumCanonicalBytes - usage.canonicalBytes,
    maximumFrameBytes: budget.maximumFrameBytes - usage.frameBytes,
    maximumHashBytes: budget.maximumHashBytes - usage.hashBytes,
    maximumElapsedMilliseconds:
      budget.maximumElapsedMilliseconds - usage.elapsedMilliseconds,
  }).pipe(Result.mapError(() => firstExceeded(usage, budget)));
}

function usageFits(
  usage: SourceArtifactV2FinalizedAttemptReadUsageV1,
  budget: SourceArtifactV2FinalizedAttemptReadBudgetV1,
): boolean {
  return usage.calls <= budget.maximumCalls &&
    usage.inputBytes <= budget.maximumInputBytes &&
    usage.bodyBytes <= budget.maximumBodyBytes &&
    usage.canonicalBytes <= budget.maximumCanonicalBytes &&
    usage.frameBytes <= budget.maximumFrameBytes &&
    usage.hashBytes <= budget.maximumHashBytes &&
    usage.elapsedMilliseconds <= budget.maximumElapsedMilliseconds;
}

function firstExceeded(
  usage: SourceArtifactV2FinalizedAttemptReadUsageV1,
  budget: SourceArtifactV2FinalizedAttemptReadBudgetV1,
): SourceArtifactV2FinalizedAttemptReadBudgetFieldV1 {
  if (usage.calls > budget.maximumCalls) return "calls";
  if (usage.inputBytes > budget.maximumInputBytes) return "inputBytes";
  if (usage.bodyBytes > budget.maximumBodyBytes) return "bodyBytes";
  if (usage.canonicalBytes > budget.maximumCanonicalBytes) return "canonicalBytes";
  if (usage.frameBytes > budget.maximumFrameBytes) return "frameBytes";
  if (usage.hashBytes > budget.maximumHashBytes) return "hashBytes";
  return "elapsedMilliseconds";
}

function remaining(maximum: number, used: number): number | undefined {
  const result = maximum - used;
  return Number.isSafeInteger(result) && result >= 0 ? result : undefined;
}

function elapsedFits(
  startedAt: bigint,
  budget: SourceArtifactV2FinalizedAttemptReadBudgetV1,
): Effect.Effect<boolean> {
  return Clock.currentTimeNanos.pipe(
    Effect.map(now => elapsed(startedAt, now) <= budget.maximumElapsedMilliseconds),
  );
}

function remainingElapsed(
  startedAt: bigint,
  budget: SourceArtifactV2FinalizedAttemptReadBudgetV1,
): Effect.Effect<number> {
  return Clock.currentTimeNanos.pipe(
    Effect.map(now => {
      const value = budget.maximumElapsedMilliseconds - elapsed(startedAt, now);
      return value >= 1 ? value : 0;
    }),
  );
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error("Finalized-attempt read usage overflowed.");
  }
  return result;
}

function elapsed(startedAt: bigint, endedAt: bigint): number {
  const difference = endedAt - startedAt;
  if (difference <= 0n) return 0;
  const milliseconds = difference / 1_000_000n;
  return milliseconds > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(milliseconds);
}

function statusForKind(kind: SourceArtifactV2FinalizedAttemptReadResponseV1["kind"]): number {
  switch (kind) {
    case "finalized": return 200;
    case "notFound": return 404;
    case "staleGeneration":
    case "staleFence":
    case "lifecycleMismatch": return 409;
    case "resourceFailure": return 503;
    case "corruption": return 500;
  }
}

type ReadOutcome =
  | Readonly<{ readonly kind: "corruption" }>
  | Readonly<{ readonly kind: "resourceFailure" }>
  | Readonly<{
      readonly kind: "attempt";
      readonly attempt: SourceArtifactV2Attempt | null;
    }>;

function codecBudgetField(field: string): SourceArtifactV2FinalizedAttemptReadBudgetFieldV1 {
  switch (field) {
    case "calls": return "calls";
    case "inputBytes": return "inputBytes";
    case "canonicalBytes": return "canonicalBytes";
    case "frameBytes": return "frameBytes";
    case "hashBytes": return "hashBytes";
    case "elapsedMilliseconds": return "elapsedMilliseconds";
    default: return "bodyBytes";
  }
}
