import { bytesEqualFullScan, copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger, isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Cause, Clock, Data, Effect, Result } from "effect";
import type {
  DeploymentProjectScopeAuthorizerV1,
  DeploymentProjectScopeWitnessV1,
  DeploymentProjectScopeWitnessV1Error,
} from "../deploymentProjectScopeAuthorization";
import { deploymentObjectName } from "../routing";
import type { Env } from "../types";
import { readBackendBoundedBody } from "../boundedBody";
import {
  sourceArtifactV2CheckpointReadResourceCause,
  SourceArtifactV2CheckpointReadBudgetError,
  SourceArtifactV2CheckpointReadCorruptionError,
  SourceArtifactV2CheckpointReadResourceError,
  type SourceArtifactV2CheckpointReader,
} from "./CheckpointReader";
import { sourceArtifactV2DigestBytesFromLowerHex } from "./Digest";
import {
  captureSourceArtifactV2FinalizedAttemptReadBudgetV1,
  decodeSourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1,
  decodeSourceArtifactV2FinalizedAttemptReadResponseV1,
  decodeSourceArtifactV2FinalizedAttemptReadUsageHeaderV1,
  encodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1,
  encodeSourceArtifactV2FinalizedAttemptReadRequestV1,
  sourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1,
  sourceArtifactV2FinalizedAttemptReadBudgetFitsV1,
  sourceArtifactV2FinalizedAttemptReadBudgetHeaderV1,
  sourceArtifactV2FinalizedAttemptReadMediaTypeV1,
  sourceArtifactV2FinalizedAttemptReadPathV1,
  sourceArtifactV2FinalizedAttemptReadUsageHeaderV1,
  type SourceArtifactV2FinalizedAttemptReadBudgetFieldV1,
  type SourceArtifactV2FinalizedAttemptReadBudgetV1,
  type SourceArtifactV2FinalizedAttemptReadResponseV1,
  type SourceArtifactV2FinalizedAttemptReadUsageV1,
} from "./FinalizedAttemptReadProtocol";
import {
  SourceArtifactV2FrameBudgetError,
  sourceArtifactV2UploadSelectorFrame,
  sourceArtifactV2UploadSelectorFrameProjection,
} from "./Framing";
import {
  SourceArtifactV2Sha256ResourceError,
  type SourceArtifactV2Sha256,
} from "./Sha256";

export interface SourceArtifactV2FinalizedAttemptReadComposerBudgetV1 {
  readonly cumulative: SourceArtifactV2FinalizedAttemptReadBudgetV1;
  readonly command: SourceArtifactV2FinalizedAttemptReadBudgetV1;
}

export interface SourceArtifactV2FinalizedAttemptReadComposerInputV1 {
  readonly deploymentId: string;
  readonly uploadId: string;
  readonly expectedGeneration: number;
  readonly expectedMutationFence: number;
  readonly budget: SourceArtifactV2FinalizedAttemptReadComposerBudgetV1;
}

export interface SourceArtifactV2FinalizedAttemptReadEvidenceV1 {
  readonly requestId: string;
  readonly deploymentId: string;
  readonly projectId: string;
  readonly deploymentCreatedAt: string;
  readonly uploadId: string;
  readonly generation: number;
  readonly mutationFence: number;
  readonly completedRootDigest: string;
  readonly completedSelectorDigest: string;
  readonly usage: SourceArtifactV2FinalizedAttemptReadUsageV1;
}

export class SourceArtifactV2FinalizedAttemptReadInputV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadInputV1Error",
)<{
  readonly field:
    | "deploymentId"
    | "uploadId"
    | "expectedGeneration"
    | "expectedMutationFence"
    | "cumulativeBudget"
    | "commandBudget";
}> {}

export class SourceArtifactV2FinalizedAttemptReadNotFoundV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadNotFoundV1Error",
)<{ readonly uploadId: string }> {}

export class SourceArtifactV2FinalizedAttemptReadStaleV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadStaleV1Error",
)<{
  readonly uploadId: string;
  readonly reason: "generation" | "mutationFence";
}> {}

export class SourceArtifactV2FinalizedAttemptReadLifecycleV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadLifecycleV1Error",
)<{ readonly uploadId: string }> {}

export class SourceArtifactV2FinalizedAttemptReadResourceV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadResourceV1Error",
)<{ readonly operation: "fetch" | "readBody" | "durableObject" }> {}

export class SourceArtifactV2FinalizedAttemptReadCorruptionV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadCorruptionV1Error",
)<{
  readonly reason:
    | "invalidContentType"
    | "invalidContentLength"
    | "malformedResponse"
    | "statusMismatch"
    | "identityMismatch"
    | "storedEvidence";
}> {}

export class SourceArtifactV2FinalizedAttemptReadBudgetV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadBudgetV1Error",
)<{ readonly field: SourceArtifactV2FinalizedAttemptReadBudgetFieldV1 }> {}

export class SourceArtifactV2FinalizedAttemptReadStoredBytesV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadStoredBytesV1Error",
)<{
  readonly uploadId: string;
  readonly observed: number;
  readonly maximum: number;
}> {}

export class SourceArtifactV2SameIsolateFinalizedAttemptReadConfigurationV1Error
  extends Data.TaggedError(
    "SourceArtifactV2SameIsolateFinalizedAttemptReadConfigurationV1Error",
  )<{ readonly reason: "invalidMaximumStoredBytes" }> {}

export type SourceArtifactV2FinalizedAttemptReadComposerV1Error =
  | DeploymentProjectScopeWitnessV1Error
  | SourceArtifactV2FinalizedAttemptReadInputV1Error
  | SourceArtifactV2FinalizedAttemptReadNotFoundV1Error
  | SourceArtifactV2FinalizedAttemptReadStaleV1Error
  | SourceArtifactV2FinalizedAttemptReadLifecycleV1Error
  | SourceArtifactV2FinalizedAttemptReadResourceV1Error
  | SourceArtifactV2FinalizedAttemptReadCorruptionV1Error
  | SourceArtifactV2FinalizedAttemptReadBudgetV1Error
  | SourceArtifactV2FinalizedAttemptReadStoredBytesV1Error;

export interface SourceArtifactV2FinalizedAttemptReadComposerV1 {
  readonly read: (
    request: Request,
    witness: DeploymentProjectScopeWitnessV1,
    input: SourceArtifactV2FinalizedAttemptReadComposerInputV1,
  ) => Effect.Effect<
    SourceArtifactV2FinalizedAttemptReadEvidenceV1,
    SourceArtifactV2FinalizedAttemptReadComposerV1Error,
    never
  >;
}

const resourceCause = new WeakMap<SourceArtifactV2FinalizedAttemptReadResourceV1Error, unknown>();

export function sourceArtifactV2FinalizedAttemptReadResourceCauseV1(
  error: SourceArtifactV2FinalizedAttemptReadResourceV1Error,
): unknown {
  return resourceCause.get(error);
}

export function makeSourceArtifactV2FinalizedAttemptReadComposerV1(options: {
  readonly env: Pick<Env, "DEPLOYMENTS">;
  readonly authorizer: DeploymentProjectScopeAuthorizerV1;
  readonly makeRequestId?: () => string;
}): SourceArtifactV2FinalizedAttemptReadComposerV1 {
  const deployments = options.env.DEPLOYMENTS;
  const authorizer = options.authorizer;
  const makeRequestId = options.makeRequestId ?? liveRequestId;
  const read = Effect.fn("SourceArtifactV2FinalizedAttemptReadComposer.read")(
    (
      request: Request,
      witness: DeploymentProjectScopeWitnessV1,
      input: SourceArtifactV2FinalizedAttemptReadComposerInputV1,
    ): Effect.Effect<
      SourceArtifactV2FinalizedAttemptReadEvidenceV1,
      SourceArtifactV2FinalizedAttemptReadComposerV1Error,
      never
    > => Effect.suspend<
      SourceArtifactV2FinalizedAttemptReadEvidenceV1,
      SourceArtifactV2FinalizedAttemptReadComposerV1Error,
      never
    >(() => Effect.gen(function* () {
      const captured = yield* Effect.fromResult(captureInput(input));
      const claimed = yield* Effect.fromResult(authorizer.claim(
        witness,
        request,
        captured.deploymentId,
      ));
      const requestId = makeRequestId();
      if (!isNonEmptyString(requestId)) {
        return yield* Effect.die(
          new Error(
            "Finalized-attempt read request ID factory returned invalid data.",
          ),
        );
      }
      const stub = deployments.getByName(
        deploymentObjectName(claimed.deploymentId),
      );
      return yield* executeRead(
        stub,
        requestId,
        claimed,
        captured,
      );
    })),
  );
  return Object.freeze({ read });
}

export function makeSourceArtifactV2SameIsolateFinalizedAttemptReadComposerV1(
  options: {
    readonly authorizer: DeploymentProjectScopeAuthorizerV1;
    readonly checkpointReader: SourceArtifactV2CheckpointReader;
    readonly sha256: SourceArtifactV2Sha256;
    readonly maximumStoredBytes: number;
    readonly makeRequestId?: () => string;
  },
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadComposerV1,
  SourceArtifactV2SameIsolateFinalizedAttemptReadConfigurationV1Error
> {
  if (!isPositiveSafeInteger(options.maximumStoredBytes)) {
    return Result.fail(
      new SourceArtifactV2SameIsolateFinalizedAttemptReadConfigurationV1Error({
        reason: "invalidMaximumStoredBytes",
      }),
    );
  }
  const authorizer = options.authorizer;
  const checkpointReader = options.checkpointReader;
  const sha256 = options.sha256;
  const maximumStoredBytes = options.maximumStoredBytes;
  const makeRequestId = options.makeRequestId ?? liveRequestId;
  const read = Effect.fn(
    "SourceArtifactV2SameIsolateFinalizedAttemptReadComposer.read",
  )(
    (
      request: Request,
      witness: DeploymentProjectScopeWitnessV1,
      input: SourceArtifactV2FinalizedAttemptReadComposerInputV1,
    ): Effect.Effect<
      SourceArtifactV2FinalizedAttemptReadEvidenceV1,
      SourceArtifactV2FinalizedAttemptReadComposerV1Error,
      never
    > => Effect.suspend<
      SourceArtifactV2FinalizedAttemptReadEvidenceV1,
      SourceArtifactV2FinalizedAttemptReadComposerV1Error,
      never
    >(() => Effect.gen(function* () {
      const captured = yield* Effect.fromResult(captureInput(input));
      const claimed = yield* Effect.fromResult(authorizer.claim(
        witness,
        request,
        captured.deploymentId,
      ));
      const requestId = makeRequestId();
      if (!isNonEmptyString(requestId)) {
        return yield* Effect.die(
          new Error(
            "Same-isolate finalized-attempt read request ID factory returned invalid data.",
          ),
        );
      }
      return yield* executeSameIsolateRead(
        checkpointReader,
        sha256,
        maximumStoredBytes,
        requestId,
        claimed,
        captured,
      );
    })),
  );
  return Result.succeed(Object.freeze({ read }));
}

const executeSameIsolateRead = Effect.fn(
  "SourceArtifactV2SameIsolateFinalizedAttemptReadComposer.execute",
)(
  function* (
    checkpointReader: SourceArtifactV2CheckpointReader,
    sha256: SourceArtifactV2Sha256,
    maximumStoredBytes: number,
    requestId: string,
    claimed: Readonly<{
      readonly deploymentId: string;
      readonly projectId: string;
      readonly deploymentCreatedAt: string;
    }>,
    input: Readonly<SourceArtifactV2FinalizedAttemptReadComposerInputV1>,
  ): Effect.fn.Return<
    SourceArtifactV2FinalizedAttemptReadEvidenceV1,
    Exclude<
      SourceArtifactV2FinalizedAttemptReadComposerV1Error,
      DeploymentProjectScopeWitnessV1Error
    >
  > {
    const startedAt = yield* Clock.currentTimeNanos;
    yield* remainingElapsed(startedAt, input.budget.command);
    const checkpoint = yield* checkpointReader.read(input.uploadId, {
      maximumCalls: input.budget.command.maximumCalls,
      maximumStoredBytes,
    }).pipe(
      Effect.mapError(error => sameIsolateCheckpointError(error)),
    );
    yield* remainingElapsed(startedAt, input.budget.command);
    if (checkpoint === null) {
      return yield* new SourceArtifactV2FinalizedAttemptReadNotFoundV1Error({
        uploadId: input.uploadId,
      });
    }
    if (checkpoint.uploadId !== input.uploadId) {
      return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
        reason: "identityMismatch",
      });
    }
    if (checkpoint.generation !== input.expectedGeneration) {
      return yield* new SourceArtifactV2FinalizedAttemptReadStaleV1Error({
        uploadId: input.uploadId,
        reason: "generation",
      });
    }
    if (checkpoint.mutationFence !== input.expectedMutationFence) {
      return yield* new SourceArtifactV2FinalizedAttemptReadStaleV1Error({
        uploadId: input.uploadId,
        reason: "mutationFence",
      });
    }
    if (
      checkpoint.state !== "finalized" ||
      checkpoint.currentModule !== null
    ) {
      return yield* new SourceArtifactV2FinalizedAttemptReadLifecycleV1Error({
        uploadId: input.uploadId,
      });
    }
    if (
      checkpoint.completedRootDigest === null ||
      checkpoint.completedSelectorDigest === null
    ) {
      return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
        reason: "storedEvidence",
      });
    }
    yield* remainingElapsed(startedAt, input.budget.command);
    const selectorInput = Object.freeze({
      deploymentId: input.deploymentId,
      uploadId: checkpoint.uploadId,
      generation: BigInt(checkpoint.generation),
      rootDigest: sourceArtifactV2DigestBytesFromLowerHex(
        checkpoint.completedRootDigest,
      ),
    });
    const frameBudget = {
      maximumFrameBytesMaterialized:
        input.budget.command.maximumFrameBytes,
    };
    const projectionResult = sourceArtifactV2UploadSelectorFrameProjection(
      selectorInput,
      frameBudget,
    );
    if (Result.isFailure(projectionResult)) {
      if (
        projectionResult.failure instanceof SourceArtifactV2FrameBudgetError
      ) {
        return yield* new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
          field: "frameBytes",
        });
      }
      return yield* Effect.die(projectionResult.failure);
    }
    const projection = projectionResult.success;
    let usage = addUsage(zeroUsage(), {
      calls: 3,
      canonicalBytes: projection.canonicalBytesMaterialized,
      frameBytes: projection.frameBytesMaterialized,
      hashBytes: projection.frameBytesMaterialized,
    });
    usage = Object.freeze({
      ...usage,
      elapsedMilliseconds: elapsed(startedAt, yield* Clock.currentTimeNanos),
    });
    if (
      !usageFits(usage, input.budget.command) ||
      !usageFits(usage, input.budget.cumulative)
    ) {
      const limitingBudget = usageFits(usage, input.budget.command)
        ? input.budget.cumulative
        : input.budget.command;
      return yield* new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
        field: firstExceeded(usage, limitingBudget),
      });
    }
    const frameResult = sourceArtifactV2UploadSelectorFrame(
      selectorInput,
      frameBudget,
    );
    if (Result.isFailure(frameResult)) {
      return yield* Effect.die(frameResult.failure);
    }
    const frame = frameResult.success;
    if (
      frame.canonicalBytesMaterialized !==
        projection.canonicalBytesMaterialized ||
      frame.frameBytesMaterialized !== projection.frameBytesMaterialized
    ) {
      return yield* Effect.die(
        new Error(
          "Source-artifact selector projection disagreed with materialization.",
        ),
      );
    }
    const hashDeadline = yield* remainingElapsed(
      startedAt,
      input.budget.command,
    );
    const digest = yield* sha256(frame.bytes, {
      maximumInputBytes: frame.frameBytesMaterialized,
    }).pipe(
      Effect.timeout(`${hashDeadline} millis`),
      Effect.mapError(error => Cause.isTimeoutError(error)
        ? new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
            field: "elapsedMilliseconds",
          })
        : error instanceof SourceArtifactV2Sha256ResourceError
          ? resourceFailure("durableObject", error)
          : error),
      Effect.catchTag(
        "SourceArtifactV2Sha256InputError",
        error => Effect.die(error),
      ),
    );
    usage = Object.freeze({
      ...usage,
      elapsedMilliseconds: elapsed(startedAt, yield* Clock.currentTimeNanos),
    });
    if (
      !usageFits(usage, input.budget.command) ||
      !usageFits(usage, input.budget.cumulative)
    ) {
      const limitingBudget = usageFits(usage, input.budget.command)
        ? input.budget.cumulative
        : input.budget.command;
      return yield* new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
        field: firstExceeded(usage, limitingBudget),
      });
    }
    if (!bytesEqualFullScan(
      digest,
      sourceArtifactV2DigestBytesFromLowerHex(
        checkpoint.completedSelectorDigest,
      ),
    )) {
      return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
        reason: "storedEvidence",
      });
    }
    return Object.freeze({
      requestId,
      deploymentId: claimed.deploymentId,
      projectId: claimed.projectId,
      deploymentCreatedAt: claimed.deploymentCreatedAt,
      uploadId: checkpoint.uploadId,
      generation: checkpoint.generation,
      mutationFence: checkpoint.mutationFence,
      completedRootDigest: checkpoint.completedRootDigest,
      completedSelectorDigest: checkpoint.completedSelectorDigest,
      usage,
    });
  },
);

const executeRead = Effect.fn("SourceArtifactV2FinalizedAttemptReadComposer.execute")(
  function* (
    stub: DurableObjectStub,
    requestId: string,
    claimed: Readonly<{
      readonly deploymentId: string;
      readonly projectId: string;
      readonly deploymentCreatedAt: string;
    }>,
    input: Readonly<SourceArtifactV2FinalizedAttemptReadComposerInputV1>,
  ): Effect.fn.Return<
    SourceArtifactV2FinalizedAttemptReadEvidenceV1,
    Exclude<SourceArtifactV2FinalizedAttemptReadComposerV1Error, DeploymentProjectScopeWitnessV1Error>
  > {
    const startedAt = yield* Clock.currentTimeNanos;
    const encodedResult = encodeSourceArtifactV2FinalizedAttemptReadRequestV1({
      codecVersion: 1,
      sourceArtifactCodecVersion: 1,
      requestId,
      deploymentId: input.deploymentId,
      uploadId: input.uploadId,
      expectedGeneration: input.expectedGeneration,
      expectedMutationFence: input.expectedMutationFence,
    }, input.budget.command);
    const encoded = Result.isSuccess(encodedResult)
      ? encodedResult.success
      : encodedResult.failure.reason === "budgetExhausted"
        ? yield* new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
            field: codecBudgetField(encodedResult.failure.field),
          })
        : yield* Effect.die(encodedResult.failure);
    let usage = addUsage(encoded.usage, { calls: 1 });
    usage = Object.freeze({
      ...usage,
      elapsedMilliseconds: elapsed(startedAt, yield* Clock.currentTimeNanos),
    });
    const remainingForDo = yield* Effect.fromResult(
      remainingBudgetAfter(input.budget.command, usage),
    ).pipe(Effect.mapError(field => new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({ field })));
    const budgetHeaderResult = encodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1(
      remainingForDo,
    );
    const budgetHeader = Result.isSuccess(budgetHeaderResult)
      ? budgetHeaderResult.success
      : yield* Effect.die(budgetHeaderResult.failure);
    const outgoing = new Request(`https://flarex.internal${sourceArtifactV2FinalizedAttemptReadPathV1}`, {
      method: "POST",
      headers: {
        "content-type": sourceArtifactV2FinalizedAttemptReadMediaTypeV1,
        [sourceArtifactV2FinalizedAttemptReadBudgetHeaderV1]: budgetHeader,
      },
      body: copyBytesToArrayBuffer(encoded.bytes),
    });
    const fetchDeadline = yield* remainingElapsed(startedAt, input.budget.command);
    const response = yield* Effect.tryPromise({
      try: signal => stub.fetch(new Request(outgoing, { signal })),
      catch: cause => resourceFailure("fetch", cause),
    }).pipe(
      Effect.timeout(`${fetchDeadline} millis`),
      Effect.mapError(error => Cause.isTimeoutError(error)
        ? new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
            field: "elapsedMilliseconds",
          })
        : error),
    );
    if (response.status === 422) {
      const exhausted = decodeSourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1(
        response.headers.get(sourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1),
      );
      return yield* Result.isSuccess(exhausted)
        ? new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({ field: exhausted.success })
        : new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
            reason: "malformedResponse",
          });
    }
    if (response.status === 400 || response.status === 405) {
      return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
        reason: "malformedResponse",
      });
    }
    if (
      response.status === 502 || response.status === 504 ||
      response.status === 503 &&
        response.headers.get("content-type") !== sourceArtifactV2FinalizedAttemptReadMediaTypeV1
    ) {
      return yield* resourceFailure("durableObject", response.status);
    }
    if (response.headers.get("content-type") !== sourceArtifactV2FinalizedAttemptReadMediaTypeV1) {
      return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
        reason: "invalidContentType",
      });
    }
    const serverUsageResult = decodeSourceArtifactV2FinalizedAttemptReadUsageHeaderV1(
      response.headers.get(sourceArtifactV2FinalizedAttemptReadUsageHeaderV1),
    );
    if (Result.isFailure(serverUsageResult)) {
      return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
        reason: "malformedResponse",
      });
    }
    if (!usageFits(serverUsageResult.success, remainingForDo)) {
      return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
        reason: "malformedResponse",
      });
    }
    usage = addUsageIgnoringElapsed(usage, serverUsageResult.success);
    const remainingForResponse = yield* Effect.fromResult(
      remainingBudgetAfter(input.budget.command, usage),
    ).pipe(Effect.mapError(field => new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({ field })));
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
        return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
          reason: "invalidContentLength",
        });
      }
      const parsed = Number(contentLength);
      if (!Number.isSafeInteger(parsed) || parsed > remainingForResponse.maximumBodyBytes) {
        return yield* new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({ field: "bodyBytes" });
      }
    }
    const bodyDeadline = yield* remainingElapsed(startedAt, input.budget.command);
    const body = yield* readBackendBoundedBody(
      response.body,
      remainingForResponse.maximumBodyBytes,
      {
        limitExceeded: () => new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
          field: "bodyBytes",
        }),
        resourceFailure: cause => resourceFailure("readBody", cause),
      },
    ).pipe(
      Effect.timeout(`${bodyDeadline} millis`),
      Effect.mapError(error => Cause.isTimeoutError(error)
        ? new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
            field: "elapsedMilliseconds",
          })
        : error),
    );
    const decoded = yield* Effect.fromResult(
      decodeSourceArtifactV2FinalizedAttemptReadResponseV1(body, remainingForResponse),
    ).pipe(Effect.mapError(error => error.reason === "budgetExhausted"
      ? codecToComposerError(error.field)
      : new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
          reason: "malformedResponse",
        })));
    usage = addUsage(usage, decoded.usage);
    usage = Object.freeze({
      ...usage,
      elapsedMilliseconds: elapsed(startedAt, yield* Clock.currentTimeNanos),
    });
    if (!usageFits(usage, input.budget.command) || !usageFits(usage, input.budget.cumulative)) {
      return yield* new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
        field: firstExceeded(usage, usageFits(usage, input.budget.command)
          ? input.budget.cumulative
          : input.budget.command),
      });
    }
    const value = decoded.value;
    if (
      value.requestId !== requestId || value.deploymentId !== input.deploymentId ||
      value.uploadId !== input.uploadId ||
      value.expectedGeneration !== input.expectedGeneration ||
      value.expectedMutationFence !== input.expectedMutationFence
    ) {
      return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
        reason: "identityMismatch",
      });
    }
    yield* requireStatus(response.status, value.kind);
    switch (value.kind) {
      case "notFound":
        return yield* new SourceArtifactV2FinalizedAttemptReadNotFoundV1Error({
          uploadId: input.uploadId,
        });
      case "staleGeneration":
        return yield* new SourceArtifactV2FinalizedAttemptReadStaleV1Error({
          uploadId: input.uploadId,
          reason: "generation",
        });
      case "staleFence":
        return yield* new SourceArtifactV2FinalizedAttemptReadStaleV1Error({
          uploadId: input.uploadId,
          reason: "mutationFence",
        });
      case "lifecycleMismatch":
        return yield* new SourceArtifactV2FinalizedAttemptReadLifecycleV1Error({
          uploadId: input.uploadId,
        });
      case "resourceFailure":
        return yield* resourceFailure("durableObject", value.kind);
      case "corruption":
        return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
          reason: "storedEvidence",
        });
      case "finalized":
        if (
          value.generation !== input.expectedGeneration ||
          value.mutationFence !== input.expectedMutationFence
        ) {
          return yield* new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
            reason: "identityMismatch",
          });
        }
        return Object.freeze({
          requestId,
          deploymentId: claimed.deploymentId,
          projectId: claimed.projectId,
          deploymentCreatedAt: claimed.deploymentCreatedAt,
          uploadId: value.uploadId,
          generation: value.generation,
          mutationFence: value.mutationFence,
          completedRootDigest: value.completedRootDigest,
          completedSelectorDigest: value.completedSelectorDigest,
          usage,
        });
    }
  },
);

function captureInput(
  value: unknown,
): Result.Result<
  Readonly<SourceArtifactV2FinalizedAttemptReadComposerInputV1>,
  SourceArtifactV2FinalizedAttemptReadInputV1Error
> {
  if (!isNonArrayRecord(value) || !hasExactKeys(value, [
    "budget",
    "deploymentId",
    "expectedGeneration",
    "expectedMutationFence",
    "uploadId",
  ])) return Result.fail(inputFailure("deploymentId"));
  const deploymentId = value.deploymentId;
  const uploadId = value.uploadId;
  const expectedGeneration = value.expectedGeneration;
  const expectedMutationFence = value.expectedMutationFence;
  const budgetValue = value.budget;
  if (!isNonEmptyString(deploymentId)) return Result.fail(inputFailure("deploymentId"));
  if (!isNonEmptyString(uploadId)) return Result.fail(inputFailure("uploadId"));
  if (!isPositiveSafeInteger(expectedGeneration)) {
    return Result.fail(inputFailure("expectedGeneration"));
  }
  if (!isPositiveSafeInteger(expectedMutationFence)) {
    return Result.fail(inputFailure("expectedMutationFence"));
  }
  if (!isNonArrayRecord(budgetValue) || !hasExactKeys(budgetValue, ["command", "cumulative"])) {
    return Result.fail(inputFailure("cumulativeBudget"));
  }
  return Result.gen(function* () {
    const cumulative = yield* captureSourceArtifactV2FinalizedAttemptReadBudgetV1(
      budgetValue.cumulative,
    ).pipe(Result.mapError(() => inputFailure("cumulativeBudget")));
    const command = yield* captureSourceArtifactV2FinalizedAttemptReadBudgetV1(
      budgetValue.command,
    ).pipe(Result.mapError(() => inputFailure("commandBudget")));
    if (!sourceArtifactV2FinalizedAttemptReadBudgetFitsV1(command, cumulative)) {
      return yield* Result.fail(inputFailure("commandBudget"));
    }
    return Object.freeze({
      deploymentId,
      uploadId,
      expectedGeneration,
      expectedMutationFence,
      budget: Object.freeze({ cumulative, command }),
    });
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
  return Result.mapError(captureSourceArtifactV2FinalizedAttemptReadBudgetV1({
    maximumCalls: budget.maximumCalls - usage.calls,
    maximumInputBytes: budget.maximumInputBytes - usage.inputBytes,
    maximumBodyBytes: budget.maximumBodyBytes - usage.bodyBytes,
    maximumCanonicalBytes: budget.maximumCanonicalBytes - usage.canonicalBytes,
    maximumFrameBytes: budget.maximumFrameBytes - usage.frameBytes,
    maximumHashBytes: budget.maximumHashBytes - usage.hashBytes,
    maximumElapsedMilliseconds:
      budget.maximumElapsedMilliseconds - usage.elapsedMilliseconds,
  }), () => firstExceeded(usage, budget));
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

function addUsageIgnoringElapsed(
  left: SourceArtifactV2FinalizedAttemptReadUsageV1,
  right: SourceArtifactV2FinalizedAttemptReadUsageV1,
): SourceArtifactV2FinalizedAttemptReadUsageV1 {
  return addUsage(left, { ...right, elapsedMilliseconds: 0 });
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

function requireStatus(
  status: number,
  kind: SourceArtifactV2FinalizedAttemptReadResponseV1["kind"],
): Effect.Effect<void, SourceArtifactV2FinalizedAttemptReadCorruptionV1Error> {
  const expected = kind === "finalized" ? 200
    : kind === "notFound" ? 404
      : kind === "staleGeneration" || kind === "staleFence" || kind === "lifecycleMismatch"
        ? 409
        : kind === "resourceFailure" ? 503 : 500;
  return status === expected
    ? Effect.succeed(undefined)
    : Effect.fail(new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
        reason: "statusMismatch",
      }));
}

function remainingElapsed(
  startedAt: bigint,
  budget: SourceArtifactV2FinalizedAttemptReadBudgetV1,
): Effect.Effect<number, SourceArtifactV2FinalizedAttemptReadBudgetV1Error> {
  return Effect.gen(function* () {
    const remaining = budget.maximumElapsedMilliseconds - elapsed(
      startedAt,
      yield* Clock.currentTimeNanos,
    );
    if (remaining < 1) {
      return yield* new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
        field: "elapsedMilliseconds",
      });
    }
    return remaining;
  });
}

function elapsed(startedAt: bigint, endedAt: bigint): number {
  const difference = endedAt - startedAt;
  if (difference <= 0n) return 0;
  const milliseconds = difference / 1_000_000n;
  return milliseconds > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(milliseconds);
}

function checkedAdd(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error("Finalized-attempt read usage overflowed.");
  return sum;
}

function codecToComposerError(field: string): SourceArtifactV2FinalizedAttemptReadBudgetV1Error {
  return new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
    field: codecBudgetField(field),
  });
}

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

function inputFailure(
  field: SourceArtifactV2FinalizedAttemptReadInputV1Error["field"],
): SourceArtifactV2FinalizedAttemptReadInputV1Error {
  return new SourceArtifactV2FinalizedAttemptReadInputV1Error({ field });
}

function sameIsolateCheckpointError(
  error:
    | SourceArtifactV2CheckpointReadBudgetError
    | SourceArtifactV2CheckpointReadCorruptionError
    | SourceArtifactV2CheckpointReadResourceError,
):
  | SourceArtifactV2FinalizedAttemptReadBudgetV1Error
  | SourceArtifactV2FinalizedAttemptReadStoredBytesV1Error
  | SourceArtifactV2FinalizedAttemptReadCorruptionV1Error
  | SourceArtifactV2FinalizedAttemptReadResourceV1Error {
  if (error instanceof SourceArtifactV2CheckpointReadBudgetError) {
    return error.dimension === "calls"
      ? new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
          field: "calls",
        })
      : new SourceArtifactV2FinalizedAttemptReadStoredBytesV1Error({
          uploadId: error.uploadId,
          observed: error.observed,
          maximum: error.maximum,
        });
  }
  if (error instanceof SourceArtifactV2CheckpointReadCorruptionError) {
    return new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
      reason: "storedEvidence",
    });
  }
  return resourceFailure(
    "durableObject",
    sourceArtifactV2CheckpointReadResourceCause(error),
  );
}

function zeroUsage(): SourceArtifactV2FinalizedAttemptReadUsageV1 {
  return Object.freeze({
    calls: 0,
    inputBytes: 0,
    bodyBytes: 0,
    canonicalBytes: 0,
    frameBytes: 0,
    hashBytes: 0,
    elapsedMilliseconds: 0,
  });
}

function resourceFailure(
  operation: SourceArtifactV2FinalizedAttemptReadResourceV1Error["operation"],
  cause: unknown,
): SourceArtifactV2FinalizedAttemptReadResourceV1Error {
  const error = new SourceArtifactV2FinalizedAttemptReadResourceV1Error({ operation });
  resourceCause.set(error, cause);
  return error;
}

function liveRequestId(): string {
  const cryptoValue: unknown = globalThis.crypto;
  if (!isNonArrayRecord(cryptoValue) || typeof cryptoValue.randomUUID !== "function") {
    throw new Error("Web Crypto randomUUID is unavailable.");
  }
  return Reflect.apply(cryptoValue.randomUUID, cryptoValue, []) as string;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]);
}
