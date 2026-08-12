import {
  TaskComputeProfileRefV1Schema,
  type TaskComputeProfileRefV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  copyBytes,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Result, Schema } from "effect";
import {
  isSourceArtifactV2ModuleRolesV1,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";

import {
  InvalidTaskRuntimePublicationV1Error,
  type TaskRuntimePublicationOperationV1,
  type TaskRuntimePublicationReasonV1,
} from "./RuntimePublicationErrors.js";
import {
  MAX_TASK_CATALOG_ENTRIES_V1,
  MAX_TASK_RUNTIME_COMPATIBILITY_FLAGS_V1,
  MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1,
  MAX_TASK_RUNTIME_MODULES_V1,
  MAX_TASK_RUNTIME_MODULE_SOURCE_BYTES_V1,
  MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_TEXT_UTF8_BYTES_V1,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  TASK_RUNTIME_RESERVED_MODULE_PATH_PREFIX_V1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeGroupManifestFrameV1,
  type TaskRuntimeEntryFrameV1,
  type TaskRuntimeMaterializationSpecV1,
  type TaskRuntimeProjectionFrameV1,
  type TaskRuntimeProjectionModuleFrameV1,
} from "./Model.js";
import { decodeTaskRuntimeEntryFrameV1 } from "./Schema.js";

const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const COMPATIBILITY_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;

const decodeComputeProfile = Schema.decodeUnknownResult(
  TaskComputeProfileRefV1Schema,
  STRICT_PARSE_OPTIONS,
);

export function decodeTaskRuntimeProjectionModuleFrameV1(
  input: unknown,
): Result.Result<
  TaskRuntimeProjectionModuleFrameV1,
  InvalidTaskRuntimePublicationV1Error<"decode_projection_module">
> {
  return decodeProjectionModule(input, "decode_projection_module");
}

export function decodeTaskRuntimeProjectionModuleFramesV1(
  input: unknown,
): Result.Result<
  ReadonlyArray<TaskRuntimeProjectionModuleFrameV1>,
  InvalidTaskRuntimePublicationV1Error<"decode_projection_modules">
> {
  const operation = "decode_projection_modules" as const;
  const values = captureDenseArray(input, MAX_TASK_RUNTIME_MODULES_V1);
  if (values === undefined || values.length === 0) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return Result.gen(function* () {
    const modules: TaskRuntimeProjectionModuleFrameV1[] = [];
    let previousPath: string | undefined;
    for (let index = 0; index < values.length; index += 1) {
      const module = yield* decodeProjectionModule(
        values[index],
        operation,
        `[${index}]`,
      );
      if (module.moduleOrdinal !== BigInt(index)) {
        return yield* Result.fail(invalid(
          operation,
          "invalid_ordinal",
          `[${index}].moduleOrdinal`,
        ));
      }
      if (previousPath !== undefined) {
        const order = compareUtf8(previousPath, module.artifactModulePath);
        if (order === 0) {
          return yield* Result.fail(invalid(
            operation,
            "duplicate_module_path",
            `[${index}].artifactModulePath`,
          ));
        }
        if (order > 0) {
          return yield* Result.fail(invalid(
            operation,
            "unordered_modules",
            `[${index}].artifactModulePath`,
          ));
        }
      }
      previousPath = module.artifactModulePath;
      modules.push(module);
    }
    return Object.freeze(modules);
  });
}

export function decodeTaskRuntimeEntryFramesForRootV1(
  input: unknown,
): Result.Result<
  ReadonlyArray<TaskRuntimeEntryFrameV1>,
  InvalidTaskRuntimePublicationV1Error<"decode_entry_root">
> {
  const operation = "decode_entry_root" as const;
  const values = captureDenseArray(input, MAX_TASK_CATALOG_ENTRIES_V1);
  if (values === undefined) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return Result.gen(function* () {
    const entries: TaskRuntimeEntryFrameV1[] = [];
    let previousTaskId: string | undefined;
    for (let index = 0; index < values.length; index += 1) {
      const entry = yield* decodeTaskRuntimeEntryFrameV1(values[index]).pipe(
        Result.mapError((failure) => invalid(
          operation,
          failure.reason === "invalid_digest" ? "invalid_digest" : "invalid_shape",
          `[${index}]${failure.path === undefined ? "" : `.${failure.path}`}`,
        )),
      );
      if (entry.taskOrdinal !== BigInt(index)) {
        return yield* Result.fail(invalid(
          operation,
          "invalid_ordinal",
          `[${index}].taskOrdinal`,
        ));
      }
      if (
        previousTaskId !== undefined &&
        compareUtf8(previousTaskId, entry.taskId) >= 0
      ) {
        return yield* Result.fail(invalid(
          operation,
          "invalid_root",
          `[${index}].taskId`,
        ));
      }
      previousTaskId = entry.taskId;
      entries.push(entry);
    }
    return Object.freeze(entries);
  });
}

export function decodeTaskRuntimeProjectionFrameV1(
  input: unknown,
): Result.Result<
  TaskRuntimeProjectionFrameV1,
  InvalidTaskRuntimePublicationV1Error<"decode_projection">
> {
  const operation = "decode_projection" as const;
  const outer = captureExactDataRecord(input, [
    "kind",
    "group",
    "executionModule",
    "moduleCount",
    "rawByteLength",
    "moduleRootSha256",
  ]);
  if (
    outer === undefined || outer.kind !== "task_runtime_projection" ||
    outer.group !== "durable_task"
  ) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return Result.gen(function* () {
    const executionModule = yield* decodeModulePath(
      outer.executionModule,
      operation,
      "executionModule",
      false,
    );
    const moduleCount = yield* decodeBoundedBigInt(
      outer.moduleCount,
      1n,
      BigInt(MAX_TASK_RUNTIME_MODULES_V1),
      operation,
      "invalid_count",
      "moduleCount",
    );
    const rawByteLength = yield* decodeBoundedBigInt(
      outer.rawByteLength,
      0n,
      BigInt(MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1),
      operation,
      "invalid_byte_length",
      "rawByteLength",
    );
    const moduleRootSha256 = yield* decodeDigest(
      outer.moduleRootSha256,
      operation,
      "moduleRootSha256",
    );
    return Object.freeze({
      kind: "task_runtime_projection" as const,
      group: "durable_task" as const,
      executionModule,
      moduleCount,
      rawByteLength,
      moduleRootSha256,
    });
  });
}

export function decodeTaskRuntimeGroupManifestFrameV1(
  input: unknown,
): Result.Result<
  TaskRuntimeGroupManifestFrameV1,
  InvalidTaskRuntimePublicationV1Error<"decode_group_manifest">
> {
  const operation = "decode_group_manifest" as const;
  const outer = captureExactDataRecord(input, [
    "kind",
    "taskCatalogSha256",
    "taskCount",
    "taskEntryRootSha256",
    "taskRuntimeProjectionSha256",
    "taskRuntimeMaterializationSpecSha256",
  ]);
  if (outer === undefined || outer.kind !== "task_runtime_group_manifest") {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return Result.gen(function* () {
    const taskCatalogSha256 = yield* decodeDigest(
      outer.taskCatalogSha256,
      operation,
      "taskCatalogSha256",
    );
    const taskCount = yield* decodeBoundedBigInt(
      outer.taskCount,
      1n,
      BigInt(MAX_TASK_CATALOG_ENTRIES_V1),
      operation,
      "invalid_count",
      "taskCount",
    );
    const taskEntryRootSha256 = yield* decodeDigest(
      outer.taskEntryRootSha256,
      operation,
      "taskEntryRootSha256",
    );
    const taskRuntimeProjectionSha256 = yield* decodeDigest(
      outer.taskRuntimeProjectionSha256,
      operation,
      "taskRuntimeProjectionSha256",
    );
    const taskRuntimeMaterializationSpecSha256 = yield* decodeDigest(
      outer.taskRuntimeMaterializationSpecSha256,
      operation,
      "taskRuntimeMaterializationSpecSha256",
    );
    return Object.freeze({
      kind: "task_runtime_group_manifest" as const,
      taskCatalogSha256,
      taskCount,
      taskEntryRootSha256,
      taskRuntimeProjectionSha256,
      taskRuntimeMaterializationSpecSha256,
    });
  });
}

export function decodeTaskRuntimeMaterializationSpecV1(
  input: unknown,
): Result.Result<
  TaskRuntimeMaterializationSpecV1,
  InvalidTaskRuntimePublicationV1Error<"decode_materialization_spec">
> {
  const operation = "decode_materialization_spec" as const;
  const outer = captureExactDataRecord(input, [
    "kind",
    "runtimeContractIdentity",
    "bridgeAbiIdentity",
    "compatibilityDate",
    "compatibilityFlags",
    "runtimeProfileIdentity",
    "runtimeImplementationVersion",
    "supportedComputeProfiles",
    "moduleEntryPolicyIdentity",
  ]);
  if (
    outer === undefined || outer.kind !== "task_runtime_materialization_spec" ||
    outer.runtimeContractIdentity !== TASK_RUNTIME_CONTRACT_IDENTITY_V1 ||
    outer.bridgeAbiIdentity !== TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1 ||
    outer.runtimeProfileIdentity !== TASK_RUNTIME_PROFILE_IDENTITY_V1 ||
    outer.moduleEntryPolicyIdentity
      !== TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1
  ) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return Result.gen(function* () {
    if (!isCanonicalDate(outer.compatibilityDate)) {
      return yield* Result.fail(invalid(
        operation,
        "invalid_compatibility",
        "compatibilityDate",
      ));
    }
    const compatibilityFlags = yield* decodeOrderedTextSet(
      outer.compatibilityFlags,
      MAX_TASK_RUNTIME_COMPATIBILITY_FLAGS_V1,
      operation,
      "invalid_compatibility",
      "compatibilityFlags",
      true,
    );
    const runtimeImplementationVersion = yield* decodeBoundedText(
      outer.runtimeImplementationVersion,
      operation,
      "invalid_implementation_version",
      "runtimeImplementationVersion",
      MAX_TASK_RUNTIME_PUBLICATION_TEXT_UTF8_BYTES_V1,
      true,
    );
    const supportedComputeProfiles = yield* decodeComputeProfiles(
      outer.supportedComputeProfiles,
      operation,
    );
    return Object.freeze({
      kind: "task_runtime_materialization_spec" as const,
      runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
      bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
      compatibilityDate: outer.compatibilityDate,
      compatibilityFlags,
      runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
      runtimeImplementationVersion,
      supportedComputeProfiles,
      moduleEntryPolicyIdentity: TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
    });
  });
}

function decodeProjectionModule<
  Operation extends "decode_projection_module" | "decode_projection_modules",
>(
  input: unknown,
  operation: Operation,
  prefix = "",
): Result.Result<
  TaskRuntimeProjectionModuleFrameV1,
  InvalidTaskRuntimePublicationV1Error<Operation>
> {
  const outer = captureExactDataRecord(input, [
    "kind",
    "group",
    "moduleOrdinal",
    "artifactModulePath",
    "sourceRoles",
    "sourceEnvironment",
    "moduleFormat",
    "rawByteLength",
    "sourceSha256",
    "sourceBytes",
  ]);
  if (
    outer === undefined || outer.kind !== "runtime_projection_module" ||
    outer.group !== "durable_task" || outer.sourceEnvironment !== "isolate" ||
    outer.moduleFormat !== "es_module"
  ) {
    return Result.fail(invalid(operation, "invalid_shape", prefix || undefined));
  }
  const path = (field: string) => prefix === "" ? field : `${prefix}.${field}`;
  return Result.gen(function* () {
    const moduleOrdinal = yield* decodeBoundedBigInt(
      outer.moduleOrdinal,
      0n,
      BigInt(MAX_TASK_RUNTIME_MODULES_V1 - 1),
      operation,
      "invalid_ordinal",
      path("moduleOrdinal"),
    );
    const artifactModulePath = yield* decodeModulePath(
      outer.artifactModulePath,
      operation,
      path("artifactModulePath"),
      true,
    );
    if (!isSourceArtifactV2ModuleRolesV1(outer.sourceRoles)) {
      return yield* Result.fail(invalid(
        operation,
        "invalid_source_roles",
        path("sourceRoles"),
      ));
    }
    const rawByteLength = yield* decodeBoundedBigInt(
      outer.rawByteLength,
      0n,
      BigInt(MAX_TASK_RUNTIME_MODULE_SOURCE_BYTES_V1),
      operation,
      "invalid_byte_length",
      path("rawByteLength"),
    );
    const sourceSha256 = yield* decodeDigest(
      outer.sourceSha256,
      operation,
      path("sourceSha256"),
    );
    const sourceBytes = yield* captureSourceBytes(
      outer.sourceBytes,
      operation,
      path("sourceBytes"),
    );
    if (BigInt(sourceBytes.byteLength) !== rawByteLength) {
      return yield* Result.fail(invalid(
        operation,
        "source_length_mismatch",
        path("rawByteLength"),
      ));
    }
    return Object.freeze({
      kind: "runtime_projection_module" as const,
      group: "durable_task" as const,
      moduleOrdinal,
      artifactModulePath,
      sourceRoles: outer.sourceRoles,
      sourceEnvironment: "isolate" as const,
      moduleFormat: "es_module" as const,
      rawByteLength,
      sourceSha256,
      sourceBytes,
    });
  });
}

function captureSourceBytes<Operation extends TaskRuntimePublicationOperationV1>(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<
  Uint8Array,
  InvalidTaskRuntimePublicationV1Error<Operation>
> {
  const byteLength = uint8ArrayByteLength(input);
  if (
    byteLength === undefined || byteLength > MAX_TASK_RUNTIME_MODULE_SOURCE_BYTES_V1
  ) {
    return Result.fail(invalid(
      operation,
      "invalid_source_bytes",
      path,
      byteLength,
      MAX_TASK_RUNTIME_MODULE_SOURCE_BYTES_V1,
    ));
  }
  return Result.gen(function* () {
    const sourceBytes = yield* Result.try({
      try: () => copyBytes(input as Uint8Array),
      catch: () => invalid(operation, "invalid_source_bytes", path),
    });
    yield* Result.try({
      try: () => FATAL_UTF8.decode(sourceBytes),
      catch: () => invalid(operation, "invalid_source_bytes", path),
    });
    return sourceBytes;
  });
}

function decodeComputeProfiles(
  input: unknown,
  operation: "decode_materialization_spec",
): Result.Result<
  ReadonlyArray<TaskComputeProfileRefV1>,
  InvalidTaskRuntimePublicationV1Error<"decode_materialization_spec">
> {
  const values = captureDenseArray(input, MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1);
  if (values === undefined || values.length === 0) {
    return Result.fail(invalid(
      operation,
      "invalid_compute_profile",
      "supportedComputeProfiles",
    ));
  }
  return Result.gen(function* () {
    const profiles: TaskComputeProfileRefV1[] = [];
    let previous: string | undefined;
    for (let index = 0; index < values.length; index += 1) {
      const profile = yield* decodeComputeProfile(values[index]).pipe(
        Result.mapError(() => invalid(
          operation,
          "invalid_compute_profile",
          `supportedComputeProfiles[${index}]`,
        )),
        Result.filterOrFail(
          (value) => validScalarText(value),
          () => invalid(
            operation,
            "invalid_compute_profile",
            `supportedComputeProfiles[${index}]`,
          ),
        ),
      );
      if (previous !== undefined) {
        const order = compareUtf8(previous, profile);
        if (order === 0) {
          return yield* Result.fail(invalid(
            operation,
            "duplicate_compute_profile",
            `supportedComputeProfiles[${index}]`,
          ));
        }
        if (order > 0) {
          return yield* Result.fail(invalid(
            operation,
            "unordered_compute_profiles",
            `supportedComputeProfiles[${index}]`,
          ));
        }
      }
      previous = profile;
      profiles.push(profile);
    }
    return Object.freeze(profiles);
  });
}

function decodeOrderedTextSet<Operation extends TaskRuntimePublicationOperationV1>(
  input: unknown,
  maximum: number,
  operation: Operation,
  reason: TaskRuntimePublicationReasonV1,
  path: string,
  rejectControls: boolean,
): Result.Result<
  ReadonlyArray<string>,
  InvalidTaskRuntimePublicationV1Error<Operation>
> {
  const values = captureDenseArray(input, maximum);
  if (values === undefined) {
    return Result.fail(invalid(operation, reason, path));
  }
  return Result.gen(function* () {
    const decoded: string[] = [];
    let previous: string | undefined;
    for (let index = 0; index < values.length; index += 1) {
      const value = yield* decodeBoundedText(
        values[index],
        operation,
        reason,
        `${path}[${index}]`,
        MAX_TASK_RUNTIME_PUBLICATION_TEXT_UTF8_BYTES_V1,
        rejectControls,
      );
      if (previous !== undefined && compareUtf8(previous, value) >= 0) {
        return yield* Result.fail(invalid(operation, reason, `${path}[${index}]`));
      }
      previous = value;
      decoded.push(value);
    }
    return Object.freeze(decoded);
  });
}

function decodeModulePath<Operation extends TaskRuntimePublicationOperationV1>(
  input: unknown,
  operation: Operation,
  path: string,
  rejectReserved: boolean,
): Result.Result<string, InvalidTaskRuntimePublicationV1Error<Operation>> {
  return decodeBoundedText(
    input,
    operation,
    "invalid_module_path",
    path,
    MAX_TASK_RUNTIME_PUBLICATION_TEXT_UTF8_BYTES_V1,
    true,
  ).pipe(Result.flatMap((value) => {
    const segments = value.split("/");
    if (
      value.startsWith("/") || value.endsWith("/") || value.includes("\\") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      return Result.fail(invalid(operation, "invalid_module_path", path));
    }
    return rejectReserved && value.startsWith(
      TASK_RUNTIME_RESERVED_MODULE_PATH_PREFIX_V1,
    )
      ? Result.fail(invalid(operation, "reserved_module_path", path))
      : Result.succeed(value);
  }));
}

function decodeBoundedText<Operation extends TaskRuntimePublicationOperationV1>(
  input: unknown,
  operation: Operation,
  reason: TaskRuntimePublicationReasonV1,
  path: string,
  maximumBytes: number,
  rejectControls: boolean,
): Result.Result<string, InvalidTaskRuntimePublicationV1Error<Operation>> {
  return typeof input === "string" && input.length > 0 &&
      validScalarText(input) && UTF8.encode(input).byteLength <= maximumBytes &&
      input.trimStart() === input && input.trimEnd() === input &&
      (!rejectControls || !CONTROL_CHARACTERS.test(input))
    ? Result.succeed(input)
    : Result.fail(invalid(operation, reason, path));
}

function decodeBoundedBigInt<Operation extends TaskRuntimePublicationOperationV1>(
  input: unknown,
  minimum: bigint,
  maximum: bigint,
  operation: Operation,
  reason: TaskRuntimePublicationReasonV1,
  path: string,
): Result.Result<bigint, InvalidTaskRuntimePublicationV1Error<Operation>> {
  return typeof input === "bigint" && input >= minimum && input <= maximum &&
      input <= POSTGRES_SIGNED_BIGINT_MAX
    ? Result.succeed(input)
    : Result.fail(invalid(operation, reason, path));
}

function decodeDigest<Operation extends TaskRuntimePublicationOperationV1>(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<
  TaskDefinitionSha256V1,
  InvalidTaskRuntimePublicationV1Error<Operation>
> {
  if (!isUint8ArrayWithByteLength(input, 32)) {
    return Result.fail(invalid(operation, "invalid_digest", path));
  }
  return Result.try({
    try: () => copyBytes(input) as TaskDefinitionSha256V1,
    catch: () => invalid(operation, "invalid_digest", path),
  });
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = COMPATIBILITY_DATE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function validScalarText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) return false;
      index += 1;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function compareTaskRuntimeUtf8V1(left: string, right: string): number {
  return compareUtf8(left, right);
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = UTF8.encode(left);
  const rightBytes = UTF8.encode(right);
  const length = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.byteLength - rightBytes.byteLength;
}

function captureExactDataRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return undefined;
    }
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    ) {
      return undefined;
    }
    const captured: Record<string, unknown> = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
      Object.defineProperty(captured, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      });
    }
    return captured;
  } catch {
    return undefined;
  }
}

function captureDenseArray(
  input: unknown,
  maximum: number,
): ReadonlyArray<unknown> | undefined {
  try {
    if (!Array.isArray(input) || input.length > maximum) return undefined;
    const values: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return undefined;
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return undefined;
  }
}

function invalid<Operation extends TaskRuntimePublicationOperationV1>(
  operation: Operation,
  reason: TaskRuntimePublicationReasonV1,
  path?: string,
  observed?: number,
  maximum?: number,
): InvalidTaskRuntimePublicationV1Error<Operation> {
  return new InvalidTaskRuntimePublicationV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}
