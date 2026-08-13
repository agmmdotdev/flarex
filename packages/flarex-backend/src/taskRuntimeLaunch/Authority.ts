import {
  makeLivePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
} from "@flarex/analysis/internal/private-sha256-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import {
  decodeTaskComputePreparedExecutionV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-evidence-v1";
import {
  decodeTaskDefinitionRuntimeBindingCommitmentV1,
  decodeTaskDefinitionRuntimeBindingV1,
  encodeTaskDefinitionRuntimeBindingPreimageV1,
  encodeCanonicalTaskManifestPreimageV1,
  encodeTaskDefinitionRuntimeBindingCommitmentPreimageV1,
  encodeTaskRuntimeEntryPreimageV1,
  type TaskDefinitionRuntimeBindingCommitmentV1,
  type TaskDefinitionRuntimeBindingV1,
  type TaskRuntimeObjectReferenceV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Context, Data, Effect, Layer, Result, Schema } from "effect";
import {
  ReplacementScopeIdV1Schema,
} from "flarex-protocol/storage-authority";
import {
  decodeCanonicalFlarexValueEvidenceV1Effect,
} from "flarex-protocol/value";

import {
  TaskRuntimeLaunchConfigurationError,
  type TaskRuntimeLaunchAuthorityError,
  type TaskRuntimeLaunchDirectory,
  type TaskRuntimeLaunchEvidence,
  TaskRuntimeLaunchHashError,
  TaskRuntimeLaunchHashInvariantDefect,
  type TaskRuntimeLaunchLocatedSource,
  type TaskRuntimeLaunchObject,
  type TaskRuntimeLaunchObjectValidator,
  type TaskRuntimeLaunchSha256,
  type TaskRuntimeLaunchSubject,
  TaskRuntimeLaunchValidationError,
  decodeTaskRuntimeInputReference,
  decodeTaskRuntimeLaunchRequest,
  type TaskRuntimeInputSource,
} from "./Model.js";

export interface TaskRuntimeLaunchAuthorityShape {
  readonly resolve: (
    input: unknown,
  ) => Effect.Effect<
    TaskRuntimeLaunchSubject,
    TaskRuntimeLaunchAuthorityError
  >;
}

export class TaskRuntimeLaunchAuthority extends Context.Service<
  TaskRuntimeLaunchAuthority,
  TaskRuntimeLaunchAuthorityShape
>()("flarex-backend/taskRuntimeLaunch/Authority") {}

export interface TaskRuntimeLaunchAuthorityOptions {
  readonly maximumRuntimeObjectBytes: number;
  readonly maximumTotalRuntimeObjectBytes: number;
  readonly validateRuntimeObject: TaskRuntimeLaunchObjectValidator;
  readonly sha256?: TaskRuntimeLaunchSha256;
}

interface CapturedConfiguration {
  readonly resolveSource: TaskRuntimeLaunchDirectory["resolve"];
  readonly sha256: TaskRuntimeLaunchSha256;
  readonly validateRuntimeObject: TaskRuntimeLaunchObjectValidator;
  readonly maximumRuntimeObjectBytes: number;
  readonly maximumTotalRuntimeObjectBytes: number;
}

interface CapturedLocatedSource {
  readonly scopeId: TaskRuntimeLaunchLocatedSource["scopeId"];
  readonly readEvidence: TaskRuntimeLaunchLocatedSource["readEvidence"];
  readonly readRuntimeObject:
    TaskRuntimeLaunchLocatedSource["readRuntimeObject"];
  readonly readInput: TaskRuntimeLaunchLocatedSource["readInput"];
}

const decodeReplacementScopeId = Schema.decodeUnknownResult(
  ReplacementScopeIdV1Schema,
);
type CapturedConfigurationInput = Readonly<{
  directoryOwner: TaskRuntimeLaunchDirectory;
  resolveSource: unknown;
  optionsOwner: TaskRuntimeLaunchAuthorityOptions;
  maximumRuntimeObjectBytes: unknown;
  maximumTotalRuntimeObjectBytes: unknown;
  suppliedSha256: unknown;
  validateRuntimeObject: unknown;
}>;

export function makeTaskRuntimeLaunchAuthorityLayer(
  directory: TaskRuntimeLaunchDirectory,
  options: TaskRuntimeLaunchAuthorityOptions,
): Layer.Layer<
  TaskRuntimeLaunchAuthority,
  TaskRuntimeLaunchConfigurationError
> {
  return Layer.effect(
    TaskRuntimeLaunchAuthority,
    Effect.fromResult(captureConfiguration(directory, options)).pipe(
      Effect.map((configuration) =>
        TaskRuntimeLaunchAuthority.of(
          makeTaskRuntimeLaunchAuthority(configuration),
        )
      ),
    ),
  );
}

export function makeLiveTaskRuntimeLaunchSha256():
  TaskRuntimeLaunchSha256 {
  return makeLivePrivateSha256V1(hashPolicy);
}

function makeTaskRuntimeLaunchAuthority(
  configuration: CapturedConfiguration,
): TaskRuntimeLaunchAuthorityShape {
  const resolve: TaskRuntimeLaunchAuthorityShape["resolve"] = Effect.fn(
    "TaskRuntimeLaunchAuthority.resolve",
  )(function* (suppliedRequest) {
    const request = yield* Effect.fromResult(
      decodeTaskRuntimeLaunchRequest(suppliedRequest),
    );
    const suppliedSource = yield* configuration.resolveSource(
      request.identity.scopeId,
    );
    const source = yield* Effect.fromResult(
      captureLocatedSource(suppliedSource),
    );
    if (source.scopeId !== request.identity.scopeId) {
      return yield* validationFailure(
        "scope_mismatch",
        "source.scopeId",
      );
    }

    const suppliedEvidence = yield* source.readEvidence(request);
    const evidence = yield* Effect.fromResult(
      captureEvidence(suppliedEvidence),
    );
    const prepared = yield* Effect.fromResult(
      decodeTaskComputePreparedExecutionV1(
        evidence.preparedExecution,
      ).pipe(
        Result.mapError((cause) => validation(
          "invalid_evidence",
          "preparedExecution",
          cause,
        )),
      ),
    );
    if (!dispatchRequestsEqual(prepared.dispatchRequest, request)) {
      return yield* validationFailure(
        "request_mismatch",
        "preparedExecution.dispatchRequest",
      );
    }

    const runtimeBinding = yield* Effect.fromResult(
      decodeTaskDefinitionRuntimeBindingV1(evidence.runtimeBinding).pipe(
        Result.mapError((cause) => validation(
          "invalid_runtime_binding",
          "runtimeBinding",
          cause,
        )),
      ),
    );
    const canonicalBindingBytes = yield* Effect.fromResult(
      encodeTaskDefinitionRuntimeBindingPreimageV1(runtimeBinding).pipe(
        Result.mapError((cause) => validation(
          "invalid_runtime_binding",
          "runtimeBinding",
          cause,
        )),
      ),
    );
    if (
      uint8ArrayByteLength(evidence.runtimeBindingCanonicalBytes)
        !== canonicalBindingBytes.byteLength
      || !bytesEqualFullScan(
        evidence.runtimeBindingCanonicalBytes as Uint8Array,
        canonicalBindingBytes,
      )
    ) {
      return yield* validationFailure(
        "invalid_runtime_binding",
        "runtimeBindingCanonicalBytes",
      );
    }
    yield* validateRuntimeBindingContent(
      runtimeBinding,
      configuration.sha256,
    );
    yield* Effect.fromResult(correlateRuntimeBinding(
      runtimeBinding,
      prepared.runtimeBindingCommitment,
    ));
    if (
      runtimeBinding.manifest.computeProfile !== request.computeProfile
      || runtimeBinding.manifest.maximumDurationInSeconds * 1_000
        !== request.maximumDurationMs
    ) {
      return yield* validationFailure(
        "runtime_policy_mismatch",
        "runtimeBinding.manifest",
      );
    }

    yield* Effect.fromResult(validateRuntimeObjectBudget(
      runtimeBinding.runtimeObjects,
      configuration,
    ));
    const runtimeObjects: TaskRuntimeLaunchObject[] = [];
    for (const reference of runtimeBinding.runtimeObjects) {
      const suppliedBytes = yield* source.readRuntimeObject(reference);
      const bytes = yield* Effect.fromResult(captureRuntimeObjectBytes(
        suppliedBytes,
        reference,
      ));
      const observedSha256 = yield* digestBytes(
        configuration.sha256,
        bytes,
        configuration.maximumRuntimeObjectBytes,
      );
      if (!bytesEqualFullScan(observedSha256, reference.sha256)) {
        return yield* validationFailure(
          "runtime_object_invalid",
          `runtimeObjects.${reference.role}.sha256`,
        );
      }
      yield* configuration.validateRuntimeObject(
        reference,
        copyBytes(bytes),
      ).pipe(
        Effect.mapError((cause) => validation(
          "runtime_object_invalid",
          `runtimeObjects.${reference.role}.codec`,
          cause,
        )),
      );
      runtimeObjects.push(Object.freeze({ reference, bytes }));
    }

    const inputReference = yield* Effect.fromResult(
      decodeTaskRuntimeInputReference(prepared.inputReference),
    ).pipe(
      Effect.mapError((cause) => validation(
        "invalid_evidence",
        "preparedExecution.inputReference",
        cause,
      )),
    );
    const inputSource = makeTaskRuntimeInputSource(
      inputReference,
      source,
    );
    return Object.freeze({
      request,
      runtimeBinding,
      runtimeObjects: Object.freeze(runtimeObjects),
      input: inputSource,
    });
  });

  return Object.freeze({ resolve });
}

function makeTaskRuntimeInputSource(
  reference: TaskRuntimeInputSource["reference"],
  source: CapturedLocatedSource,
): TaskRuntimeInputSource {
  const read: TaskRuntimeInputSource["read"] = Effect.fn(
    "TaskRuntimeInputSource.read",
  )(function* () {
    const suppliedBytes = yield* source.readInput(reference);
    const observedLength = uint8ArrayByteLength(suppliedBytes);
    if (observedLength !== reference.byteLength) {
      return yield* Effect.fail(
        new TaskRuntimeLaunchValidationError<"read_input">({
          operation: "read_input",
          reason: "input_invalid",
          path: "input.byteLength",
        }),
      );
    }
    const bytes = copyBytes(suppliedBytes as Uint8Array);
    const canonical = yield* decodeCanonicalFlarexValueEvidenceV1Effect({
        canonicalBytes: bytes,
        sha256: reference.sha256,
      }).pipe(Effect.mapError(cause =>
        new TaskRuntimeLaunchValidationError<"read_input">({
          operation: "read_input",
          reason: "input_invalid",
          path: "input.canonicalBytes",
          cause,
        })
      ));
    return copyBytes(canonical.canonicalBytes);
  });
  return Object.freeze({ reference, read });
}

const validateRuntimeBindingContent: (
  binding: TaskDefinitionRuntimeBindingV1,
  sha256: TaskRuntimeLaunchSha256,
) => Effect.Effect<
  void,
  TaskRuntimeLaunchValidationError<"resolve"> | TaskRuntimeLaunchHashError
> = Effect.fn(
  "TaskRuntimeLaunchAuthority.validateRuntimeBindingContent",
)(function* (
  binding: TaskDefinitionRuntimeBindingV1,
  sha256: TaskRuntimeLaunchSha256,
) {
    const manifestBytes = yield* Effect.fromResult(
      encodeCanonicalTaskManifestPreimageV1(binding.manifest).pipe(
        Result.mapError((cause) => validation(
          "invalid_runtime_binding",
          "runtimeBinding.manifest",
          cause,
        )),
      ),
    );
    const manifestSha256 = yield* digestBytes(
      sha256,
      manifestBytes,
      manifestBytes.byteLength,
    );
    if (!bytesEqualFullScan(
      manifestSha256,
      binding.canonicalTaskManifestSha256,
    )) {
      return yield* validationFailure(
        "invalid_runtime_binding",
        "runtimeBinding.canonicalTaskManifestSha256",
      );
    }
    const entryBytes = yield* Effect.fromResult(
      encodeTaskRuntimeEntryPreimageV1(binding.taskRuntimeEntry).pipe(
        Result.mapError((cause) => validation(
          "invalid_runtime_binding",
          "runtimeBinding.taskRuntimeEntry",
          cause,
        )),
      ),
    );
    const entrySha256 = yield* digestBytes(
      sha256,
      entryBytes,
      entryBytes.byteLength,
    );
    if (!bytesEqualFullScan(entrySha256, binding.taskRuntimeEntrySha256)) {
      return yield* validationFailure(
        "invalid_runtime_binding",
        "runtimeBinding.taskRuntimeEntrySha256",
      );
    }
});

function correlateRuntimeBinding(
  binding: TaskDefinitionRuntimeBindingV1,
  expected: TaskDefinitionRuntimeBindingCommitmentV1,
): Result.Result<void, TaskRuntimeLaunchValidationError<"resolve">> {
  const { manifest: _manifest, ...commitmentInput } = binding;
  return Result.gen(function* () {
    const observed = yield* decodeTaskDefinitionRuntimeBindingCommitmentV1(
      commitmentInput,
    ).pipe(
      Result.mapError((cause) => validation(
        "invalid_runtime_binding",
        "runtimeBinding",
        cause,
      )),
    );
    const expectedBytes = yield*
      encodeTaskDefinitionRuntimeBindingCommitmentPreimageV1(expected).pipe(
        Result.mapError((cause) => validation(
          "invalid_evidence",
          "preparedExecution.runtimeBindingCommitment",
          cause,
        )),
      );
    const observedBytes = yield*
      encodeTaskDefinitionRuntimeBindingCommitmentPreimageV1(observed).pipe(
        Result.mapError((cause) => validation(
          "invalid_runtime_binding",
          "runtimeBinding",
          cause,
        )),
      );
    if (!bytesEqualFullScan(expectedBytes, observedBytes)) {
      return yield* Result.fail(validation(
        "runtime_binding_mismatch",
        "runtimeBinding",
      ));
    }
  });
}

function validateRuntimeObjectBudget(
  references: ReadonlyArray<TaskRuntimeObjectReferenceV1>,
  configuration: Pick<
    CapturedConfiguration,
    "maximumRuntimeObjectBytes" | "maximumTotalRuntimeObjectBytes"
  >,
): Result.Result<void, TaskRuntimeLaunchValidationError<"resolve">> {
  const maximumObject = BigInt(configuration.maximumRuntimeObjectBytes);
  const maximumTotal = BigInt(configuration.maximumTotalRuntimeObjectBytes);
  let total = 0n;
  for (const reference of references) {
    if (reference.byteLength > maximumObject) {
      return Result.fail(validation(
        "runtime_object_budget_exceeded",
        `runtimeObjects.${reference.role}.byteLength`,
      ));
    }
    total += reference.byteLength;
    if (total > maximumTotal) {
      return Result.fail(validation(
        "runtime_object_budget_exceeded",
        "runtimeObjects.totalByteLength",
      ));
    }
  }
  return Result.succeed(undefined);
}

function captureRuntimeObjectBytes(
  input: unknown,
  reference: TaskRuntimeObjectReferenceV1,
): Result.Result<
  Uint8Array,
  TaskRuntimeLaunchValidationError<"resolve">
> {
  const observedLength = uint8ArrayByteLength(input);
  return observedLength === Number(reference.byteLength)
    ? Result.succeed(copyBytes(input as Uint8Array))
    : Result.fail(validation(
      "runtime_object_invalid",
      `runtimeObjects.${reference.role}.byteLength`,
    ));
}

const digestBytes: (
  sha256: TaskRuntimeLaunchSha256,
  bytes: Uint8Array,
  maximumInputBytes: number,
) => Effect.Effect<Uint8Array, TaskRuntimeLaunchHashError> = Effect.fn(
  "TaskRuntimeLaunchAuthority.digestBytes",
)(function* (
  sha256: TaskRuntimeLaunchSha256,
  bytes: Uint8Array,
  maximumInputBytes: number,
) {
  const suppliedDigest = yield* sha256(bytes, { maximumInputBytes });
  const byteLength = uint8ArrayByteLength(suppliedDigest);
  return byteLength === 32
    ? copyBytes(suppliedDigest)
    : yield* Effect.die(new TaskRuntimeLaunchHashInvariantDefect({
      ...(byteLength === undefined ? {} : {
        observedByteLength: byteLength,
      }),
    }));
});

function captureConfiguration(
  directory: TaskRuntimeLaunchDirectory,
  options: TaskRuntimeLaunchAuthorityOptions,
): Result.Result<
  CapturedConfiguration,
  TaskRuntimeLaunchConfigurationError
> {
  return Result.gen(function* () {
    const captured = yield* Result.try({
      try: (): CapturedConfigurationInput => {
        const directoryOwner = directory;
        const optionsOwner = options;
        return Object.freeze({
          directoryOwner,
          resolveSource: directoryOwner.resolve,
          optionsOwner,
          maximumRuntimeObjectBytes: optionsOwner.maximumRuntimeObjectBytes,
          maximumTotalRuntimeObjectBytes:
            optionsOwner.maximumTotalRuntimeObjectBytes,
          suppliedSha256: optionsOwner.sha256,
          validateRuntimeObject: optionsOwner.validateRuntimeObject,
        });
      },
      catch: (cause) => new TaskRuntimeLaunchConfigurationError({
        reason: "invalid_options",
        cause,
      }),
    });
    const {
      directoryOwner,
      resolveSource,
      optionsOwner,
      maximumRuntimeObjectBytes,
      maximumTotalRuntimeObjectBytes,
      suppliedSha256,
      validateRuntimeObject,
    } = captured;
      if (
        typeof resolveSource !== "function"
        || !isPositiveSafeInteger(maximumRuntimeObjectBytes)
        || !isPositiveSafeInteger(maximumTotalRuntimeObjectBytes)
        || maximumTotalRuntimeObjectBytes < maximumRuntimeObjectBytes
        || typeof validateRuntimeObject !== "function"
        || suppliedSha256 !== undefined && typeof suppliedSha256 !== "function"
      ) {
        return yield* Result.fail(new TaskRuntimeLaunchConfigurationError({
          reason: "invalid_options",
        }));
      }
      const sha256Owner = optionsOwner;
      const customSha256 = suppliedSha256 as
        | TaskRuntimeLaunchSha256
        | undefined;
      const objectValidator = validateRuntimeObject as
        TaskRuntimeLaunchObjectValidator;
      const sha256: TaskRuntimeLaunchSha256 = customSha256 === undefined
        ? makeLiveTaskRuntimeLaunchSha256()
        : customSha256;
      const capturedResolveSource: TaskRuntimeLaunchDirectory["resolve"] =
        (scopeId) => resolveSource.call(directoryOwner, scopeId);
      const capturedSha256: TaskRuntimeLaunchSha256 =
        customSha256 === undefined
          ? sha256
          : (input, budget) => sha256.call(sha256Owner, input, budget);
      const capturedValidateRuntimeObject: TaskRuntimeLaunchObjectValidator =
        (reference, ownedBytes) =>
          objectValidator.call(optionsOwner, reference, ownedBytes);
      return Object.freeze({
        resolveSource: capturedResolveSource,
        sha256: capturedSha256,
        validateRuntimeObject: capturedValidateRuntimeObject,
        maximumRuntimeObjectBytes,
        maximumTotalRuntimeObjectBytes,
      });
  });
}

function captureLocatedSource(
  input: TaskRuntimeLaunchLocatedSource,
): Result.Result<
  CapturedLocatedSource,
  TaskRuntimeLaunchValidationError<"resolve">
> {
  return Result.gen(function* () {
    const captured = yield* Result.try({
      try: () => {
      const sourceOwner = input;
        return Object.freeze({
          sourceOwner,
          scopeId: input.scopeId,
          readEvidence: input.readEvidence,
          readRuntimeObject: input.readRuntimeObject,
          readInput: input.readInput,
        });
      },
      catch: (cause) => validation("invalid_source", "source", cause),
    });
    const {
      sourceOwner,
      scopeId,
      readEvidence,
      readRuntimeObject,
      readInput,
    } = captured;
      if (
        typeof readEvidence !== "function"
        || typeof readRuntimeObject !== "function"
        || typeof readInput !== "function"
      ) {
        return yield* Result.fail(validation("invalid_source", "source"));
      }
      const decodedScopeId = yield* decodeReplacementScopeId(scopeId).pipe(
        Result.mapError((cause) => validation(
          "invalid_source",
          "source.scopeId",
          cause,
        )),
      );
      const capturedReadEvidence:
        TaskRuntimeLaunchLocatedSource["readEvidence"] =
          (request) => readEvidence.call(sourceOwner, request);
      const capturedReadRuntimeObject:
        TaskRuntimeLaunchLocatedSource["readRuntimeObject"] =
          (reference) => readRuntimeObject.call(sourceOwner, reference);
      const capturedReadInput: TaskRuntimeLaunchLocatedSource["readInput"] =
        (reference) => readInput.call(sourceOwner, reference);
      return Object.freeze({
        scopeId: decodedScopeId,
        readEvidence: capturedReadEvidence,
        readRuntimeObject: capturedReadRuntimeObject,
        readInput: capturedReadInput,
      });
  });
}

function captureEvidence(
  input: TaskRuntimeLaunchEvidence,
): Result.Result<
  TaskRuntimeLaunchEvidence,
  TaskRuntimeLaunchValidationError<"resolve">
> {
  return Result.try({
    try: () => Object.freeze({
      preparedExecution: input.preparedExecution,
      runtimeBinding: input.runtimeBinding,
      runtimeBindingCanonicalBytes: input.runtimeBindingCanonicalBytes,
    }),
    catch: (cause) => validation(
      "invalid_evidence",
      "evidence",
      cause,
    ),
  });
}

function dispatchRequestsEqual(
  left: TaskRuntimeLaunchSubject["request"],
  right: TaskRuntimeLaunchSubject["request"],
): boolean {
  return left.version === right.version
    && left.identity.version === right.identity.version
    && left.identity.scopeId === right.identity.scopeId
    && left.identity.runId === right.identity.runId
    && left.identity.requestedEffectSequence
      === right.identity.requestedEffectSequence
    && left.identity.attemptId === right.identity.attemptId
    && left.identity.executionFence === right.identity.executionFence
    && left.taskDefinitionRevisionId === right.taskDefinitionRevisionId
    && left.attemptNumber === right.attemptNumber
    && left.leaseVersion === right.leaseVersion
    && left.computeProfile === right.computeProfile
    && left.cancellation.kind === right.cancellation.kind
    && left.cancellation.generation === right.cancellation.generation
    && left.maximumDurationMs === right.maximumDurationMs;
}

function validation(
  reason: TaskRuntimeLaunchValidationError<"resolve">["reason"],
  path?: string,
  cause?: unknown,
): TaskRuntimeLaunchValidationError<"resolve"> {
  return new TaskRuntimeLaunchValidationError<"resolve">({
    operation: "resolve",
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function validationFailure(
  reason: TaskRuntimeLaunchValidationError<"resolve">["reason"],
  path?: string,
): Effect.Effect<never, TaskRuntimeLaunchValidationError<"resolve">> {
  return Effect.fail(validation(reason, path));
}

const hashPolicy: PrivateSha256V1ErrorPolicy<TaskRuntimeLaunchHashError> = {
  invalidBudget: () =>
    new TaskRuntimeLaunchHashError({ reason: "invalid_budget" }),
  invalidBytes: () =>
    new TaskRuntimeLaunchHashError({ reason: "invalid_bytes" }),
  inputBytesExceeded: (observed, maximum) =>
    new TaskRuntimeLaunchHashError({
      reason: "input_bytes_exceeded",
      observed,
      maximum,
    }),
  unavailable: () =>
    new TaskRuntimeLaunchHashError({ reason: "unavailable" }),
  nativeRejected: () =>
    new TaskRuntimeLaunchHashError({ reason: "native_rejected" }),
  invalidDigestOutput: (observedByteLength) =>
    new TaskRuntimeLaunchHashInvariantDefect({
      ...(observedByteLength === undefined ? {} : { observedByteLength }),
    }),
};
