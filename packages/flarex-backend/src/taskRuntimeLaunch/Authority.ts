import {
  APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1,
  APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1,
  APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1,
} from "@flarex/analysis/application-analysis";
import {
  makeLivePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
} from "@flarex/analysis/internal/private-sha256-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import {
  decodeCurrentTaskComputePreparedExecutionV1,
  type ApplicationTaskComputePreparedExecutionV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-evidence-v1";
import { validateTaskComputeDispatchRequestV1 } from
  "@flarex/durable-task/internal/compute-provider-v1";
import { decodeTaskExecutionPrincipalReferenceV1 } from
  "@flarex/durable-task/internal/run-creation-v1";
import {
  encodeApplicationTaskRuntimeTargetPreimageV1,
  type ApplicationTaskRunCreationAuthorityV1,
  type ApplicationTaskRuntimeTargetV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
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
  decodeCanonicalFlarexValueEvidenceV1,
  decodeCanonicalFlarexValueEvidenceV1Effect,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
} from "flarex-protocol/value";
import {
  decodeTaskExecutionPrincipalObjectV1,
} from "../taskExecutionPrincipal/TaskExecutionPrincipalStore.js";

import {
  TaskRuntimeLaunchConfigurationError,
  type ApplicationTaskRuntimeLaunchSubject,
  type TaskRuntimeLaunchAuthorityError,
  type TaskRuntimeLaunchDirectory,
  type CurrentTaskRuntimeLaunchEvidence,
  TaskRuntimeLaunchHashError,
  TaskRuntimeLaunchHashInvariantDefect,
  type TaskRuntimeLaunchLocatedSource,
  type TaskRuntimeLaunchPortError,
  type TaskRuntimeLaunchObject,
  type TaskRuntimeLaunchObjectValidator,
  type TaskRuntimeLaunchSha256,
  type CurrentTaskRuntimeLaunchSubject,
  type TaskRuntimeLaunchSubject,
  TaskRuntimeLaunchValidationError,
  decodeTaskRuntimeInputReference,
  decodeTaskRuntimeLaunchRequest,
  type TaskRuntimeInputSource,
} from "./Model.js";
import type { ApplicationAnalysisSourceBundle } from
  "../sourceArtifactV2/ApplicationAnalysisReader.js";

export interface TaskRuntimeLaunchAuthorityShape {
  readonly resolve: (
    input: unknown,
  ) => Effect.Effect<
    CurrentTaskRuntimeLaunchSubject,
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
  readonly readApplicationSource:
    | TaskRuntimeLaunchLocatedSource["readApplicationSource"]
    | undefined;
  readonly readPrincipal:
    | TaskRuntimeLaunchLocatedSource["readPrincipal"]
    | undefined;
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

class TaskRuntimeInputCodecForeignError extends Data.TaggedError(
  "TaskRuntimeInputCodecForeignError",
)<{ readonly cause: unknown }> {}

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
      decodeCurrentTaskComputePreparedExecutionV1(
        evidence.preparedExecution,
      ).pipe(
        Result.mapError((cause) => validation(
          "invalid_evidence",
          "preparedExecution",
          cause,
        )),
      ),
    );
    if (prepared.generation === "application_v1") {
      if (evidence.generation !== "application_v1") {
        return yield* validationFailure(
          "invalid_evidence",
          "evidence.generation",
        );
      }
    } else if (evidence.generation === "application_v1") {
      return yield* validationFailure(
        "invalid_evidence",
        "evidence.generation",
      );
    }
    if (!dispatchRequestsEqual(prepared.dispatchRequest, request)) {
      return yield* validationFailure(
        "request_mismatch",
        "preparedExecution.dispatchRequest",
      );
    }
    if (prepared.generation === "application_v1") {
      if (!("applicationTaskRuntimeTargetSha256" in request)) {
        return yield* validationFailure(
          "request_mismatch",
          "preparedExecution.dispatchRequest",
        );
      }
      return yield* resolveApplicationLaunchSubject(
        request,
        prepared,
        source,
        configuration,
      );
    }
    const legacyRequest = yield* Effect.fromResult(
      validateTaskComputeDispatchRequestV1(request).pipe(
        Result.mapError(cause => validation(
          "request_mismatch",
          "preparedExecution.dispatchRequest",
          cause,
        )),
      ),
    );

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
      request: legacyRequest,
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
    const canonical = yield* Effect.tryPromise({
      try: () => decodeCanonicalFlarexValueEvidenceV1({
        canonicalBytes: bytes,
        sha256: reference.sha256,
      }),
      catch: (cause) => new TaskRuntimeInputCodecForeignError({ cause }),
    }).pipe(
      Effect.catchTag("TaskRuntimeInputCodecForeignError", (failure) =>
        failure.cause instanceof FlarexValueEvidenceV1Error
          || failure.cause instanceof FlarexValueCodecV1Error
          ? Effect.fail(
            new TaskRuntimeLaunchValidationError<"read_input">({
              operation: "read_input",
              reason: "input_invalid",
              path: "input.canonicalBytes",
              cause: failure.cause,
            }),
          )
          : Effect.die(failure.cause)
      ),
    );
    return copyBytes(canonical.canonicalBytes);
  });
  return Object.freeze({ reference, read });
}

const resolveApplicationLaunchSubject = Effect.fn(
  "TaskRuntimeLaunchAuthority.resolveApplication",
)(function* (
  suppliedRequest: CurrentTaskRuntimeLaunchSubject["request"],
  prepared: ApplicationTaskComputePreparedExecutionV1,
  source: CapturedLocatedSource,
  configuration: CapturedConfiguration,
): Effect.fn.Return<
  ApplicationTaskRuntimeLaunchSubject,
  TaskRuntimeLaunchAuthorityError
> {
  if (
    !("applicationTaskRuntimeTargetSha256" in suppliedRequest) ||
    prepared.runtimeTarget.scopeId !== suppliedRequest.identity.scopeId ||
    prepared.creationAuthority.scopeId !== suppliedRequest.identity.scopeId ||
    prepared.creationAuthority.runtimeTarget.scopeId !==
      suppliedRequest.identity.scopeId ||
    prepared.runtimeTarget.taskId !== prepared.manifest.taskId ||
    prepared.runtimeTarget.handler.logicalModulePath !==
      prepared.manifest.handler.logicalModulePath ||
    prepared.runtimeTarget.handler.sourceModulePath !==
      prepared.manifest.handler.artifactModulePath ||
    prepared.runtimeTarget.handler.exportName !==
      prepared.manifest.handler.exportName ||
    prepared.runtimeTarget.runtimeHostIdentity.length === 0 ||
    prepared.runtimeTarget.compatibilityDate.length === 0 ||
    prepared.manifest.computeProfile !== suppliedRequest.computeProfile ||
    suppliedRequest.maximumDurationMs >
      prepared.manifest.maximumDurationInSeconds * 1_000
  ) return yield* validationFailure(
    "application_authority_mismatch",
    "preparedExecution",
  );

  const targetBytes = yield* Effect.fromResult(
    encodeApplicationTaskRuntimeTargetPreimageV1(prepared.runtimeTarget).pipe(
      Result.mapError(cause => validation(
        "application_authority_mismatch",
        "preparedExecution.runtimeTarget",
        cause,
      )),
    ),
  );
  const targetSha256 = yield* digestBytes(
    configuration.sha256,
    targetBytes,
    targetBytes.byteLength,
  );
  const manifestBytes = yield* Effect.fromResult(
    encodeCanonicalTaskManifestPreimageV1(prepared.manifest).pipe(
      Result.mapError(cause => validation(
        "application_authority_mismatch",
        "preparedExecution.manifest",
        cause,
      )),
    ),
  );
  const manifestSha256 = yield* digestBytes(
    configuration.sha256,
    manifestBytes,
    manifestBytes.byteLength,
  );
  if (
    !bytesEqualFullScan(
      targetSha256,
      suppliedRequest.applicationTaskRuntimeTargetSha256,
    ) ||
    !bytesEqualFullScan(
      targetSha256,
      prepared.creationAuthority.applicationTaskRuntimeTargetSha256,
    ) ||
    !bytesEqualFullScan(
      prepared.creationAuthority.applicationTaskRuntimeTargetSha256,
      prepared.dispatchRequest.applicationTaskRuntimeTargetSha256,
    ) ||
    !bytesEqualFullScan(
      manifestSha256,
      prepared.runtimeTarget.canonicalTaskManifestSha256,
    ) ||
    !applicationRuntimeTargetsEqual(
      prepared.runtimeTarget,
      prepared.creationAuthority.runtimeTarget,
    )
  ) return yield* validationFailure(
    "application_authority_mismatch",
    "preparedExecution",
  );

  const executionIdentity = yield* readTaskExecutionPrincipal(
    prepared,
    source,
  );

  const readApplicationSource = source.readApplicationSource;
  if (readApplicationSource === undefined) {
    return yield* validationFailure(
      "application_source_invalid",
      "source.readApplicationSource",
    );
  }
  const suppliedSource = yield* readApplicationSource(
    prepared.runtimeTarget.sourceArtifactRootSha256,
  );
  const sourceBundle = yield* captureApplicationSource(
    suppliedSource,
    prepared.runtimeTarget.sourceArtifactRootSha256,
    configuration.sha256,
  );
  if (!sourceBundle.modules.some(module =>
    module.path === prepared.runtimeTarget.handler.sourceModulePath
  )) return yield* validationFailure(
    "application_source_invalid",
    "source.applicationSource.modules",
  );
  const input = makeTaskRuntimeInputSource(prepared.inputReference, source);
  return Object.freeze({
    generation: "application_v1" as const,
    request: prepared.dispatchRequest,
    runtimeTarget: prepared.runtimeTarget,
    manifest: prepared.manifest,
    creationAuthority: prepared.creationAuthority,
    executionIdentity,
    source: sourceBundle,
    input,
  });
});

const readTaskExecutionPrincipal = Effect.fn(
  "TaskRuntimeLaunchAuthority.readTaskExecutionPrincipal",
)(function* (
  prepared: ApplicationTaskComputePreparedExecutionV1,
  source: CapturedLocatedSource,
): Effect.fn.Return<
  ApplicationTaskRuntimeLaunchSubject["executionIdentity"],
  | TaskRuntimeLaunchPortError<"read_principal">
  | TaskRuntimeLaunchValidationError<"resolve">
> {
  const readPrincipal = source.readPrincipal;
  if (readPrincipal === undefined) {
    return yield* validationFailure(
      "principal_invalid",
      "source.readPrincipal",
    );
  }
  const authoritativeReference = yield* Effect.fromResult(
    decodeTaskExecutionPrincipalReferenceV1(prepared.principalReference),
  ).pipe(Effect.mapError(cause => validation(
    "principal_invalid",
    "principal.reference",
    cause,
  )));
  const expectedByteLength = authoritativeReference.byteLength;
  const expectedSha256 = copyBytes(authoritativeReference.sha256);
  const readerReference = yield* Effect.fromResult(
    decodeTaskExecutionPrincipalReferenceV1(authoritativeReference),
  ).pipe(Effect.mapError(cause => validation(
    "principal_invalid",
    "principal.reference",
    cause,
  )));
  const suppliedBytes = yield* readPrincipal(readerReference);
  if (
    uint8ArrayByteLength(suppliedBytes) !== expectedByteLength
  ) {
    return yield* validationFailure(
      "principal_invalid",
      "principal.byteLength",
    );
  }
  const bytes = copyBytes(suppliedBytes as Uint8Array);
  const canonical = yield* decodeCanonicalFlarexValueEvidenceV1Effect({
    canonicalBytes: bytes,
    sha256: expectedSha256,
  }).pipe(Effect.mapError((cause:
    | FlarexValueCodecV1Error
    | FlarexValueEvidenceV1Error) => validation(
      "principal_invalid",
      "principal.canonicalBytes",
      cause,
    )));
  const principal = yield* Effect.fromResult(
    decodeTaskExecutionPrincipalObjectV1(canonical.value),
  ).pipe(Effect.mapError(cause => validation(
    "principal_invalid",
    "principal.object",
    cause,
  )));
  if (principal.scopeId !== prepared.dispatchRequest.identity.scopeId) {
    return yield* validationFailure(
      "principal_invalid",
      "principal.scopeId",
    );
  }
  return principal.executionIdentity;
});

function applicationRuntimeTargetsEqual(
  left: ApplicationTaskRuntimeTargetV1,
  right: ApplicationTaskRuntimeTargetV1,
): boolean {
  return Result.all([
    encodeApplicationTaskRuntimeTargetPreimageV1(left),
    encodeApplicationTaskRuntimeTargetPreimageV1(right),
  ]).pipe(
    Result.map(([leftBytes, rightBytes]) =>
      bytesEqualFullScan(leftBytes, rightBytes)
    ),
    Result.getOrElse(() => false),
  );
}

const captureApplicationSource = Effect.fn(
  "TaskRuntimeLaunchAuthority.captureApplicationSource",
)(function* (
  input: unknown,
  expectedRootSha256: string,
  sha256: TaskRuntimeLaunchSha256,
): Effect.fn.Return<
  ApplicationAnalysisSourceBundle,
  TaskRuntimeLaunchValidationError<"resolve"> | TaskRuntimeLaunchHashError
> {
  const captured = yield* Effect.fromResult(Result.try({
    try: () => {
      const source = captureExactDataRecord(input, [
        "sourceArtifact",
        "modules",
      ]);
      const sourceArtifact = captureExactDataRecord(source?.sourceArtifact, [
        "rootSha256",
        "executionModulePath",
        "schemaModulePath",
        "modules",
      ]);
      const identities = captureDenseDataArray(sourceArtifact?.modules);
      const bodies = captureDenseDataArray(source?.modules);
      if (
        source === undefined || sourceArtifact === undefined ||
        sourceArtifact.rootSha256 !== expectedRootSha256 ||
        typeof sourceArtifact.executionModulePath !== "string" ||
        sourceArtifact.executionModulePath.length === 0 ||
        sourceArtifact.schemaModulePath !== null &&
          typeof sourceArtifact.schemaModulePath !== "string" ||
        identities === undefined || bodies === undefined ||
        identities.length !== bodies.length
      ) throw new Error("Invalid Application source authority.");
      return Object.freeze({
        rootSha256: sourceArtifact.rootSha256,
        executionModulePath: sourceArtifact.executionModulePath,
        schemaModulePath: sourceArtifact.schemaModulePath,
        identities,
        bodies,
      });
    },
    catch: cause => validation(
      "application_source_invalid",
      "source.applicationSource",
      cause,
    ),
  }));
  const capturedIdentities = [];
  const capturedBodies = [];
  let totalSourceBytes = 0;
  for (let index = 0; index < captured.identities.length; index += 1) {
    const pair = yield* Effect.fromResult(Result.try({
      try: () => {
        const identity = captureSourceIdentity(captured.identities[index]);
        totalSourceBytes += identity.sourceByteLength;
        if (totalSourceBytes > APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1) {
          throw new Error("Application source byte budget exceeded.");
        }
        const body = captureSourceBody(captured.bodies[index]);
        if (
          identity.path !== body.path || identity.roles !== body.roles ||
          identity.sourceSha256 !== body.sourceSha256 ||
          identity.sourceByteLength !== body.sourceByteLength
        ) throw new Error("Application source module identity mismatch.");
        return Object.freeze({ identity, body });
      },
      catch: cause => validation(
        "application_source_invalid",
        "source.applicationSource",
        cause,
      ),
    }));
    const sourceBytes = new TextEncoder().encode(pair.body.source);
    const actualDigest = yield* digestBytes(
      sha256,
      sourceBytes,
      APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1,
    );
    if (encodeBytesToLowercaseHex(actualDigest) !== pair.identity.sourceSha256) {
      return yield* validationFailure(
        "application_source_invalid",
        "source.applicationSource.modules.sourceSha256",
      );
    }
    capturedIdentities.push(pair.identity);
    capturedBodies.push(pair.body);
  }
  return Object.freeze({
    sourceArtifact: Object.freeze({
      rootSha256: captured.rootSha256,
      executionModulePath: captured.executionModulePath,
      schemaModulePath: captured.schemaModulePath,
      modules: Object.freeze(capturedIdentities),
    }),
    modules: Object.freeze(capturedBodies),
  });
});

function captureSourceIdentity(input: unknown) {
  const value = captureExactDataRecord(input, [
    "path",
    "roles",
    "sourceSha256",
    "sourceByteLength",
  ]);
  if (!validSourceIdentity(value)) {
    throw new Error("Invalid Application source module identity.");
  }
  return Object.freeze({
    path: value.path,
    roles: value.roles,
    sourceSha256: value.sourceSha256,
    sourceByteLength: value.sourceByteLength,
  });
}

function captureSourceBody(input: unknown) {
  const value = captureExactDataRecord(input, [
    "path",
    "roles",
    "sourceSha256",
    "sourceByteLength",
    "source",
  ]);
  if (!validSourceIdentity(value) || typeof value.source !== "string") {
    throw new Error("Invalid Application source module body.");
  }
  const actualSourceByteLength = boundedUtf8ByteLength(
    value.source,
    APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1,
  );
  if (
    actualSourceByteLength === undefined ||
    actualSourceByteLength !== value.sourceByteLength
  ) throw new Error("Invalid Application source module byte length.");
  return Object.freeze({
    path: value.path,
    roles: value.roles,
    sourceSha256: value.sourceSha256,
    sourceByteLength: value.sourceByteLength,
    source: value.source,
  });
}

function boundedUtf8ByteLength(
  value: string,
  maximum: number,
): number | undefined {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (
      codeUnit >= 0xd800 && codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > maximum) return undefined;
  }
  return bytes;
}

function validSourceIdentity(
  value: Readonly<Record<string, unknown>> | undefined,
): value is Readonly<{
  path: string;
  roles: number;
  sourceSha256: string;
  sourceByteLength: number;
  source?: unknown;
}> {
  return value !== undefined && typeof value.path === "string" &&
    value.path.length > 0 && Number.isSafeInteger(value.roles) &&
    (value.roles as number) >= 0 && typeof value.sourceSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.sourceSha256) &&
    Number.isSafeInteger(value.sourceByteLength) &&
    (value.sourceByteLength as number) >= 0 &&
    (value.sourceByteLength as number) <=
      APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1;
}

function captureDenseDataArray(input: unknown): ReadonlyArray<unknown> | undefined {
  if (!Array.isArray(input)) return undefined;
  const length = Object.getOwnPropertyDescriptor(input, "length");
  if (
    length === undefined || !("value" in length) ||
    !Number.isSafeInteger(length.value) || length.value < 0 ||
    length.value > APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1
  ) return undefined;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== length.value + 1 || !keys.includes("length")) {
    return undefined;
  }
  const output: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (
      descriptor === undefined || !("value" in descriptor) ||
      !descriptor.enumerable
    ) return undefined;
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function captureExactDataRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== expectedKeys.length ||
    keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))
  ) return undefined;
  const output: Record<string, unknown> = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined || !("value" in descriptor) ||
      !descriptor.enumerable
    ) return undefined;
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
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
          readApplicationSource: input.readApplicationSource,
          readPrincipal: input.readPrincipal,
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
      readApplicationSource,
      readPrincipal,
    } = captured;
      if (
        typeof readEvidence !== "function"
        || typeof readRuntimeObject !== "function"
        || typeof readInput !== "function"
        || readApplicationSource !== undefined &&
          typeof readApplicationSource !== "function"
        || readPrincipal !== undefined && typeof readPrincipal !== "function"
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
      const capturedReadApplicationSource = readApplicationSource === undefined
        ? undefined
        : (rootSha256: string) =>
          readApplicationSource.call(sourceOwner, rootSha256);
      const capturedReadPrincipal = readPrincipal === undefined
        ? undefined
        : (reference: Parameters<NonNullable<
          TaskRuntimeLaunchLocatedSource["readPrincipal"]
        >>[0]) => readPrincipal.call(sourceOwner, reference);
      return Object.freeze({
        scopeId: decodedScopeId,
        readEvidence: capturedReadEvidence,
        readRuntimeObject: capturedReadRuntimeObject,
        readInput: capturedReadInput,
        readApplicationSource: capturedReadApplicationSource,
        readPrincipal: capturedReadPrincipal,
      });
  });
}

function captureEvidence(
  input: unknown,
): Result.Result<
  CurrentTaskRuntimeLaunchEvidence,
  TaskRuntimeLaunchValidationError<"resolve">
> {
  return Result.try({
    try: () => {
      const application = captureExactDataRecord(input, [
        "generation",
        "preparedExecution",
      ]);
      if (application !== undefined) {
        if (application.generation !== "application_v1") {
          throw new Error("invalid Application evidence generation");
        }
        return Object.freeze({
          generation: "application_v1" as const,
          preparedExecution: application.preparedExecution,
        });
      }
      const legacy = captureExactDataRecord(input, [
        "preparedExecution",
        "runtimeBinding",
        "runtimeBindingCanonicalBytes",
      ]);
      if (legacy === undefined) {
        throw new Error("invalid launch evidence shape");
      }
      return Object.freeze({
        preparedExecution: legacy.preparedExecution,
        runtimeBinding: legacy.runtimeBinding,
        runtimeBindingCanonicalBytes: legacy.runtimeBindingCanonicalBytes,
      });
    },
    catch: (cause) => validation(
      "invalid_evidence",
      "evidence",
      cause,
    ),
  });
}

function dispatchRequestsEqual(
  left: CurrentTaskRuntimeLaunchSubject["request"],
  right: CurrentTaskRuntimeLaunchSubject["request"],
): boolean {
  return left.version === right.version
    && left.identity.version === right.identity.version
    && left.identity.scopeId === right.identity.scopeId
    && left.identity.runId === right.identity.runId
    && left.identity.requestedEffectSequence
      === right.identity.requestedEffectSequence
    && left.identity.attemptId === right.identity.attemptId
    && left.identity.executionFence === right.identity.executionFence
    && ("taskDefinitionRevisionId" in left
      ? "taskDefinitionRevisionId" in right &&
        left.taskDefinitionRevisionId === right.taskDefinitionRevisionId
      : "applicationTaskRuntimeTargetSha256" in right &&
        bytesEqualFullScan(
          left.applicationTaskRuntimeTargetSha256,
          right.applicationTaskRuntimeTargetSha256,
        ))
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
