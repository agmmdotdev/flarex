import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Encoding, Result } from "effect";
import { encodeCanonicalJson } from "flarex-protocol/json";

import {
  ApplicationTaskBindingCanonicalEncodingV1Defect,
  InvalidApplicationTaskBindingV1Error,
  type ApplicationTaskBindingOperationV1,
  type ApplicationTaskBindingReasonV1,
} from "./Errors.js";
import {
  APPLICATION_TASK_CATALOG_BINDING_CODEC_V1,
  APPLICATION_TASK_DEFINITION_BINDING_CODEC_V1,
  APPLICATION_TASK_RUNTIME_TARGET_CODEC_V1,
  APPLICATION_TASK_RUN_CREATION_AUTHORITY_CODEC_V1,
  MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1,
  type ApplicationTaskBindingAuthorityV1,
  type ApplicationTaskCatalogBindingV1,
  type ApplicationTaskDefinitionBindingV1,
  type ApplicationTaskHandlerBindingV1,
  type ApplicationTaskRuntimeHostPolicyV1,
  type ApplicationTaskRuntimeTargetV1,
  type ApplicationTaskRunCreationAuthorityV1,
} from "./Model.js";
import { MAX_APPLICATION_RUNTIME_HOST_IDENTITY_CODE_UNITS_V1 } from
  "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import {
  MAX_TASK_CATALOG_ENTRIES_V1,
  MAX_TASK_HANDLER_FIELD_UTF8_BYTES_V1,
  type TaskDefinitionSha256V1,
  type TaskIdV1,
} from "../taskDefinition/Model.js";
import { decodeTaskIdV1 } from "../taskDefinition/Schema.js";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const AUTHORITY_KEYS = [
  "analysisId",
  "candidateId",
  "publicationSha256",
  "revisionId",
  "scopeId",
  "sourceArtifactRootSha256",
] as const;
const POLICY_KEYS = ["compatibilityDate", "runtimeHostIdentity"] as const;

export function decodeApplicationTaskCatalogBindingV1(
  input: unknown,
): Result.Result<
  ApplicationTaskCatalogBindingV1,
  InvalidApplicationTaskBindingV1Error
> {
  const operation = "decode_catalog_binding" as const;
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      ...AUTHORITY_KEYS,
      ...POLICY_KEYS,
      "taskCatalogSha256",
      "taskCount",
      "version",
    ], operation);
    if (value.version !== 1) {
      return yield* failure(operation, "invalidShape", "version");
    }
    const authority = yield* decodeAuthority(value, operation);
    const policy = yield* decodePolicy(value, operation);
    const taskCatalogSha256 = yield* digest(
      value.taskCatalogSha256,
      operation,
      "taskCatalogSha256",
    );
    if (
      !Number.isSafeInteger(value.taskCount) || Number(value.taskCount) < 0 ||
      Number(value.taskCount) > MAX_TASK_CATALOG_ENTRIES_V1
    ) return yield* failure(operation, "invalidCatalog", "taskCount");
    return Object.freeze({
      version: 1,
      ...authority,
      ...policy,
      taskCatalogSha256,
      taskCount: Number(value.taskCount),
    });
  });
}

export function decodeApplicationTaskDefinitionBindingV1(
  input: unknown,
): Result.Result<
  ApplicationTaskDefinitionBindingV1,
  InvalidApplicationTaskBindingV1Error
> {
  const operation = "decode_definition_binding" as const;
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      "applicationTaskCatalogBindingSha256",
      "canonicalTaskManifestSha256",
      "handler",
      "taskId",
      "version",
    ], operation);
    if (value.version !== 1) {
      return yield* failure(operation, "invalidShape", "version");
    }
    const applicationTaskCatalogBindingSha256 = yield* digest(
      value.applicationTaskCatalogBindingSha256,
      operation,
      "applicationTaskCatalogBindingSha256",
    );
    const canonicalTaskManifestSha256 = yield* digest(
      value.canonicalTaskManifestSha256,
      operation,
      "canonicalTaskManifestSha256",
    );
    const taskId = yield* decodeTaskIdV1(value.taskId).pipe(
      Result.mapError(() => invalid(operation, "invalidShape", "taskId")),
    );
    const handler = yield* decodeHandler(value.handler, operation);
    return Object.freeze({
      version: 1,
      applicationTaskCatalogBindingSha256,
      taskId,
      canonicalTaskManifestSha256,
      handler,
    });
  });
}

export function encodeApplicationTaskCatalogBindingPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidApplicationTaskBindingV1Error> {
  const operation = "encode_catalog_binding" as const;
  return decodeApplicationTaskCatalogBindingV1(input).pipe(
    Result.mapError(error => reoperation(error, operation)),
    Result.flatMap(binding => canonicalBytes({
      binding: {
        analysisId: binding.analysisId,
        candidateId: binding.candidateId,
        compatibilityDate: binding.compatibilityDate,
        publicationSha256: binding.publicationSha256,
        revisionId: binding.revisionId,
        runtimeHostIdentity: binding.runtimeHostIdentity,
        scopeId: binding.scopeId,
        sourceArtifactRootSha256: binding.sourceArtifactRootSha256,
        taskCatalogSha256: encodeBytesToLowercaseHex(binding.taskCatalogSha256),
        taskCount: binding.taskCount,
        version: 1,
      },
      codec: APPLICATION_TASK_CATALOG_BINDING_CODEC_V1,
    }, operation)),
  );
}

export function encodeApplicationTaskDefinitionBindingPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidApplicationTaskBindingV1Error> {
  const operation = "encode_definition_binding" as const;
  return decodeApplicationTaskDefinitionBindingV1(input).pipe(
    Result.mapError(error => reoperation(error, operation)),
    Result.flatMap(binding => canonicalBytes({
      binding: {
        applicationTaskCatalogBindingSha256: encodeBytesToLowercaseHex(
          binding.applicationTaskCatalogBindingSha256,
        ),
        canonicalTaskManifestSha256: encodeBytesToLowercaseHex(
          binding.canonicalTaskManifestSha256,
        ),
        handler: {
          exportName: binding.handler.exportName,
          logicalModulePath: binding.handler.logicalModulePath,
          sourceModulePath: binding.handler.sourceModulePath,
        },
        taskId: binding.taskId,
        version: 1,
      },
      codec: APPLICATION_TASK_DEFINITION_BINDING_CODEC_V1,
    }, operation)),
  );
}

export function decodeApplicationTaskRuntimeTargetV1(
  input: unknown,
): Result.Result<
  ApplicationTaskRuntimeTargetV1,
  InvalidApplicationTaskBindingV1Error
> {
  const operation = "decode_runtime_target" as const;
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      ...AUTHORITY_KEYS,
      ...POLICY_KEYS,
      "applicationTaskCatalogBindingSha256",
      "applicationTaskDefinitionBindingSha256",
      "canonicalTaskManifestSha256",
      "handler",
      "taskCatalogSha256",
      "taskId",
      "version",
    ], operation);
    if (value.version !== 1) {
      return yield* failure(operation, "invalidShape", "version");
    }
    const authority = yield* decodeAuthority(value, operation);
    const policy = yield* decodePolicy(value, operation);
    const applicationTaskCatalogBindingSha256 = yield* digest(
      value.applicationTaskCatalogBindingSha256,
      operation,
      "applicationTaskCatalogBindingSha256",
    );
    const applicationTaskDefinitionBindingSha256 = yield* digest(
      value.applicationTaskDefinitionBindingSha256,
      operation,
      "applicationTaskDefinitionBindingSha256",
    );
    const taskCatalogSha256 = yield* digest(
      value.taskCatalogSha256,
      operation,
      "taskCatalogSha256",
    );
    const canonicalTaskManifestSha256 = yield* digest(
      value.canonicalTaskManifestSha256,
      operation,
      "canonicalTaskManifestSha256",
    );
    const taskId = yield* decodeTaskIdV1(value.taskId).pipe(
      Result.mapError(() => invalid(operation, "invalidShape", "taskId")),
    );
    const handler = yield* decodeHandler(value.handler, operation);
    return Object.freeze({
      version: 1,
      ...authority,
      ...policy,
      applicationTaskCatalogBindingSha256,
      applicationTaskDefinitionBindingSha256,
      taskCatalogSha256,
      taskId,
      canonicalTaskManifestSha256,
      handler,
    });
  });
}

export function encodeApplicationTaskRuntimeTargetPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidApplicationTaskBindingV1Error> {
  const operation = "encode_runtime_target" as const;
  return decodeApplicationTaskRuntimeTargetV1(input).pipe(
    Result.mapError(error => reoperation(error, operation)),
    Result.flatMap(target => canonicalBytes({
      codec: APPLICATION_TASK_RUNTIME_TARGET_CODEC_V1,
      target: {
        analysisId: target.analysisId,
        applicationTaskCatalogBindingSha256: encodeBytesToLowercaseHex(
          target.applicationTaskCatalogBindingSha256,
        ),
        applicationTaskDefinitionBindingSha256: encodeBytesToLowercaseHex(
          target.applicationTaskDefinitionBindingSha256,
        ),
        candidateId: target.candidateId,
        canonicalTaskManifestSha256: encodeBytesToLowercaseHex(
          target.canonicalTaskManifestSha256,
        ),
        compatibilityDate: target.compatibilityDate,
        handler: {
          exportName: target.handler.exportName,
          logicalModulePath: target.handler.logicalModulePath,
          sourceModulePath: target.handler.sourceModulePath,
        },
        publicationSha256: target.publicationSha256,
        revisionId: target.revisionId,
        runtimeHostIdentity: target.runtimeHostIdentity,
        scopeId: target.scopeId,
        sourceArtifactRootSha256: target.sourceArtifactRootSha256,
        taskCatalogSha256: encodeBytesToLowercaseHex(
          target.taskCatalogSha256,
        ),
        taskId: target.taskId,
        version: 1,
      },
    }, operation)),
  );
}

export function decodeApplicationTaskRunCreationAuthorityV1(
  input: unknown,
): Result.Result<
  ApplicationTaskRunCreationAuthorityV1,
  InvalidApplicationTaskBindingV1Error
> {
  const operation = "decode_creation_authority" as const;
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      "activationSequence",
      "activeHeadSha256",
      "applicationTaskRuntimeTargetSha256",
      "readinessSha256",
      "runtimeTarget",
      "scopeId",
      "version",
    ], operation);
    if (value.version !== 1 || typeof value.activationSequence !== "bigint"
      || value.activationSequence < 1n
      || value.activationSequence > 9_223_372_036_854_775_807n) {
      return yield* failure(operation, "invalidShape", "activationSequence");
    }
    const scopeId = yield* boundedText(
      value.scopeId,
      operation,
      "scopeId",
    );
    const runtimeTarget = yield* decodeApplicationTaskRuntimeTargetV1(
      value.runtimeTarget,
    ).pipe(Result.mapError(() => invalid(
      operation,
      "invalidShape",
      "runtimeTarget",
    )));
    const runtimeTargetSha256 = yield* digest(
      value.applicationTaskRuntimeTargetSha256,
      operation,
      "applicationTaskRuntimeTargetSha256",
    );
    return Object.freeze({
      version: 1,
      scopeId,
      activationSequence: value.activationSequence,
      activeHeadSha256: yield* digest(
        value.activeHeadSha256,
        operation,
        "activeHeadSha256",
      ),
      readinessSha256: yield* digest(
        value.readinessSha256,
        operation,
        "readinessSha256",
      ),
      runtimeTarget,
      applicationTaskRuntimeTargetSha256: runtimeTargetSha256,
    });
  });
}

export function encodeApplicationTaskRunCreationAuthorityPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidApplicationTaskBindingV1Error> {
  const operation = "encode_creation_authority" as const;
  return decodeApplicationTaskRunCreationAuthorityV1(input).pipe(
    Result.mapError(error => reoperation(error, operation)),
    Result.flatMap(authority => canonicalBytes({
      authority: {
        activationSequence: authority.activationSequence.toString(10),
        activeHeadSha256: encodeBytesToLowercaseHex(authority.activeHeadSha256),
        applicationTaskRuntimeTargetSha256: encodeBytesToLowercaseHex(
          authority.applicationTaskRuntimeTargetSha256,
        ),
        readinessSha256: encodeBytesToLowercaseHex(authority.readinessSha256),
        runtimeTarget: runtimeTargetJson(authority.runtimeTarget),
        scopeId: authority.scopeId,
        version: 1,
      },
      codec: APPLICATION_TASK_RUN_CREATION_AUTHORITY_CODEC_V1,
    }, operation)),
  );
}

export function decodeApplicationTaskRunCreationAuthorityPreimageV1(
  input: unknown,
): Result.Result<
  ApplicationTaskRunCreationAuthorityV1,
  InvalidApplicationTaskBindingV1Error
> {
  const operation = "decode_creation_authority_preimage" as const;
  const byteLength = uint8ArrayByteLength(input);
  if (byteLength === undefined
    || byteLength > MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1) {
    return Result.fail(invalid(operation, "invalidShape"));
  }
  let bytes: Uint8Array;
  try {
    bytes = copyBytes(input as Uint8Array);
  } catch {
    return Result.fail(invalid(operation, "invalidShape"));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(UTF8_FATAL.decode(bytes));
  } catch {
    return Result.fail(invalid(operation, "invalidShape"));
  }
  const outer = isNonArrayRecord(parsed)
      && Reflect.ownKeys(parsed).length === 2
      && Object.hasOwn(parsed, "authority")
      && Object.hasOwn(parsed, "codec")
    ? parsed
    : undefined;
  const authority = outer !== undefined && outer.codec ===
      APPLICATION_TASK_RUN_CREATION_AUTHORITY_CODEC_V1
    && isNonArrayRecord(outer.authority)
    && Reflect.ownKeys(outer.authority).length === 7
    ? outer.authority
    : undefined;
  if (outer === undefined || authority === undefined
    || typeof authority.activationSequence !== "string"
    || authority.activationSequence.length > 19
    || !/^[1-9][0-9]*$/.test(authority.activationSequence)) {
    return Result.fail(invalid(operation, "invalidShape"));
  }
  let activationSequence: bigint;
  try {
    activationSequence = BigInt(authority.activationSequence);
  } catch {
    return Result.fail(invalid(operation, "invalidShape"));
  }
  const decoded = decodeCanonicalRuntimeTargetJson(
    authority.runtimeTarget,
    operation,
  ).pipe(Result.flatMap(runtimeTarget =>
    decodeApplicationTaskRunCreationAuthorityV1({
      ...authority,
      activationSequence,
      activeHeadSha256: decodeCanonicalDigest(authority.activeHeadSha256),
      readinessSha256: decodeCanonicalDigest(authority.readinessSha256),
      runtimeTarget,
      applicationTaskRuntimeTargetSha256: decodeCanonicalDigest(
        authority.applicationTaskRuntimeTargetSha256,
      ),
    }).pipe(Result.mapError(error => reoperation(error, operation)))
  ));
  return decoded.pipe(Result.flatMap(value =>
    encodeApplicationTaskRunCreationAuthorityPreimageV1(value).pipe(
      Result.mapError(error => reoperation(error, operation)),
      Result.flatMap(canonical => bytesEqualFullScan(canonical, bytes)
        ? Result.succeed(value)
        : Result.fail(invalid(operation, "invalidShape"))),
    )
  ));
}

function runtimeTargetJson(target: ApplicationTaskRuntimeTargetV1) {
  return {
    analysisId: target.analysisId,
    applicationTaskCatalogBindingSha256: encodeBytesToLowercaseHex(
      target.applicationTaskCatalogBindingSha256,
    ),
    applicationTaskDefinitionBindingSha256: encodeBytesToLowercaseHex(
      target.applicationTaskDefinitionBindingSha256,
    ),
    candidateId: target.candidateId,
    canonicalTaskManifestSha256: encodeBytesToLowercaseHex(
      target.canonicalTaskManifestSha256,
    ),
    compatibilityDate: target.compatibilityDate,
    handler: {
      exportName: target.handler.exportName,
      logicalModulePath: target.handler.logicalModulePath,
      sourceModulePath: target.handler.sourceModulePath,
    },
    publicationSha256: target.publicationSha256,
    revisionId: target.revisionId,
    runtimeHostIdentity: target.runtimeHostIdentity,
    scopeId: target.scopeId,
    sourceArtifactRootSha256: target.sourceArtifactRootSha256,
    taskCatalogSha256: encodeBytesToLowercaseHex(target.taskCatalogSha256),
    taskId: target.taskId,
    version: 1,
  };
}

function decodeCanonicalRuntimeTargetJson(
  input: unknown,
  operation: ApplicationTaskBindingOperationV1,
): Result.Result<
  ApplicationTaskRuntimeTargetV1,
  InvalidApplicationTaskBindingV1Error
> {
  return exactRecord(input, [
    ...AUTHORITY_KEYS,
    ...POLICY_KEYS,
    "applicationTaskCatalogBindingSha256",
    "applicationTaskDefinitionBindingSha256",
    "canonicalTaskManifestSha256",
    "handler",
    "taskCatalogSha256",
    "taskId",
    "version",
  ], operation, "runtimeTarget").pipe(
    Result.flatMap(target => decodeApplicationTaskRuntimeTargetV1({
      ...target,
      applicationTaskCatalogBindingSha256: decodeCanonicalDigest(
        target.applicationTaskCatalogBindingSha256,
      ),
      applicationTaskDefinitionBindingSha256: decodeCanonicalDigest(
        target.applicationTaskDefinitionBindingSha256,
      ),
      canonicalTaskManifestSha256: decodeCanonicalDigest(
        target.canonicalTaskManifestSha256,
      ),
      taskCatalogSha256: decodeCanonicalDigest(target.taskCatalogSha256),
    })),
    Result.mapError(error => reoperation(error, operation)),
  );
}

function decodeAuthority(
  value: Readonly<Record<string, unknown>>,
  operation: ApplicationTaskBindingOperationV1,
): Result.Result<
  ApplicationTaskBindingAuthorityV1,
  InvalidApplicationTaskBindingV1Error
> {
  return Result.gen(function* () {
    const scopeId = yield* identity(value.scopeId, operation, "scopeId");
    const revisionId = yield* identity(value.revisionId, operation, "revisionId");
    const candidateId = yield* identity(value.candidateId, operation, "candidateId");
    const analysisId = yield* identity(value.analysisId, operation, "analysisId");
    const publicationSha256 = yield* lowercaseSha256(
      value.publicationSha256,
      operation,
      "publicationSha256",
    );
    const sourceArtifactRootSha256 = yield* lowercaseSha256(
      value.sourceArtifactRootSha256,
      operation,
      "sourceArtifactRootSha256",
    );
    return Object.freeze({
      scopeId,
      revisionId,
      candidateId,
      analysisId,
      publicationSha256,
      sourceArtifactRootSha256,
    });
  });
}

function decodePolicy(
  value: Readonly<Record<string, unknown>>,
  operation: ApplicationTaskBindingOperationV1,
): Result.Result<
  ApplicationTaskRuntimeHostPolicyV1,
  InvalidApplicationTaskBindingV1Error
> {
  return Result.gen(function* () {
    if (!isRuntimeHostIdentity(value.runtimeHostIdentity)) {
      return yield* failure(
        operation,
        "invalidRuntimePolicy",
        "runtimeHostIdentity",
      );
    }
    if (!isCompatibilityDate(value.compatibilityDate)) {
      return yield* failure(
        operation,
        "invalidRuntimePolicy",
        "compatibilityDate",
      );
    }
    return Object.freeze({
      runtimeHostIdentity: value.runtimeHostIdentity,
      compatibilityDate: value.compatibilityDate,
    });
  });
}

function decodeHandler(
  input: unknown,
  operation: ApplicationTaskBindingOperationV1,
): Result.Result<
  ApplicationTaskHandlerBindingV1,
  InvalidApplicationTaskBindingV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      "exportName",
      "logicalModulePath",
      "sourceModulePath",
    ], operation, "handler");
    const logicalModulePath = yield* boundedText(
      value.logicalModulePath,
      operation,
      "handler.logicalModulePath",
    );
    const sourceModulePath = yield* boundedText(
      value.sourceModulePath,
      operation,
      "handler.sourceModulePath",
    );
    const exportName = yield* boundedText(
      value.exportName,
      operation,
      "handler.exportName",
    );
    return Object.freeze({ logicalModulePath, sourceModulePath, exportName });
  });
}

function exactRecord(
  input: unknown,
  keys: ReadonlyArray<string>,
  operation: ApplicationTaskBindingOperationV1,
  path?: string,
): Result.Result<
  Readonly<Record<string, unknown>>,
  InvalidApplicationTaskBindingV1Error
> {
  try {
    if (!isNonArrayRecord(input)) {
      return failure(operation, "invalidShape", path);
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some(key => typeof key !== "string")) {
      return failure(operation, "invalidShape", path);
    }
    const observed = (ownKeys as string[]).sort();
    const expected = [...keys].sort();
    if (
      observed.length !== expected.length ||
      !observed.every((key, index) => key === expected[index])
    ) return failure(operation, "invalidShape", path);
    const captured: Record<string, unknown> = Object.create(null);
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return failure(operation, "invalidShape", path);
      captured[key] = descriptor.value;
    }
    return Result.succeed(captured);
  } catch {
    return failure(operation, "invalidShape", path);
  }
}

function identity(
  input: unknown,
  operation: ApplicationTaskBindingOperationV1,
  path: string,
): Result.Result<string, InvalidApplicationTaskBindingV1Error> {
  return typeof input === "string" && input.length > 0 && input.length <= 256 &&
      isNulFreeScalarText(input)
    ? Result.succeed(input)
    : failure(operation, "invalidAuthority", path);
}

function boundedText(
  input: unknown,
  operation: ApplicationTaskBindingOperationV1,
  path: string,
): Result.Result<string, InvalidApplicationTaskBindingV1Error> {
  return typeof input === "string" && input.length > 0 &&
      isNulFreeScalarText(input) &&
      UTF8.encode(input).byteLength <= MAX_TASK_HANDLER_FIELD_UTF8_BYTES_V1
    ? Result.succeed(input)
    : failure(operation, "invalidShape", path);
}

function lowercaseSha256(
  input: unknown,
  operation: ApplicationTaskBindingOperationV1,
  path: string,
): Result.Result<string, InvalidApplicationTaskBindingV1Error> {
  return typeof input === "string" && /^[0-9a-f]{64}$/.test(input)
    ? Result.succeed(input)
    : failure(operation, "invalidAuthority", path);
}

function digest(
  input: unknown,
  operation: ApplicationTaskBindingOperationV1,
  path: string,
): Result.Result<
  TaskDefinitionSha256V1,
  InvalidApplicationTaskBindingV1Error
> {
  return isUint8ArrayWithByteLength(input, 32)
    ? Result.succeed(copyBytes(input) as TaskDefinitionSha256V1)
    : failure(operation, "invalidShape", path);
}

function decodeCanonicalDigest(input: unknown): Uint8Array | undefined {
  if (typeof input !== "string" || !/^[0-9a-f]{64}$/.test(input)) {
    return undefined;
  }
  return Result.getOrUndefined(Encoding.decodeHex(input));
}

function isCompatibilityDate(input: unknown): input is string {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return false;
  }
  const milliseconds = Date.parse(`${input}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 10) === input;
}

function isRuntimeHostIdentity(input: unknown): input is string {
  return typeof input === "string" && input.length > 0 &&
    input.length <= MAX_APPLICATION_RUNTIME_HOST_IDENTITY_CODE_UNITS_V1 &&
    isNulFreeScalarText(input);
}

function isNulFreeScalarText(value: string): boolean {
  if (value.includes("\0")) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

function canonicalBytes(
  value: Parameters<typeof encodeCanonicalJson>[0],
  operation: ApplicationTaskBindingOperationV1,
): Result.Result<Uint8Array, InvalidApplicationTaskBindingV1Error> {
  const text = encodeCanonicalJson(value, issue => {
    throw new ApplicationTaskBindingCanonicalEncodingV1Defect({
      operation,
      issue,
    });
  });
  const bytes = UTF8.encode(text);
  return bytes.byteLength <= MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1
    ? Result.succeed(bytes)
    : failure(operation, "canonicalBytesExceeded");
}

function reoperation(
  error: InvalidApplicationTaskBindingV1Error,
  operation: ApplicationTaskBindingOperationV1,
): InvalidApplicationTaskBindingV1Error {
  return invalid(operation, error.reason, error.path);
}

function failure(
  operation: ApplicationTaskBindingOperationV1,
  reason: ApplicationTaskBindingReasonV1,
  path?: string,
): Result.Result<never, InvalidApplicationTaskBindingV1Error> {
  return Result.fail(invalid(operation, reason, path));
}

function invalid(
  operation: ApplicationTaskBindingOperationV1,
  reason: ApplicationTaskBindingReasonV1,
  path?: string,
): InvalidApplicationTaskBindingV1Error {
  return new InvalidApplicationTaskBindingV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
  });
}
