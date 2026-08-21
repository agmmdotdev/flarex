import { copyBytes, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect } from "effect";

import {
  decodeUserIdentityEffect,
  type UserIdentity,
} from "./auth";
import type { CatalogTableId } from "./catalog";
import type { Json } from "./json";
import {
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
} from "./value";
import {
  validatorJsonAdmissionIssueV1,
  type ObjectValidatorJsonV1,
  type ValidatorJsonV1,
} from "./validator-json";
import { snapshotDecodedProtocolPlainData } from "./decoded-protocol-snapshot";

export const POINT_QUERY_EXACT_RUNTIME_FORMAT_V1 =
  "flarex.point-query-exact-runtime" as const;
export const POINT_QUERY_EXACT_RUNTIME_VERSION_V1 = 1 as const;
export const POINT_QUERY_EXACT_RUNTIME_RESULT_FORMAT_V1 =
  "flarex.point-query-exact-runtime-result" as const;
export const POINT_QUERY_EXACT_RUNTIME_RESULT_VERSION_V1 = 1 as const;
export const POINT_QUERY_EXACT_RUNTIME_PROFILE_V1 =
  "point-query-exact-runtime-v1" as const;
export const POINT_QUERY_EXACT_RUNTIME_SYSCALL_ABI_V1 =
  "flarex.system/point-query-syscall-abi/v1" as const;
export const POINT_QUERY_EXACT_RUNTIME_ENTRYPOINT_V1 =
  "FlarexPointQueryExactRuntimeV1" as const;
export const POINT_QUERY_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1 = 32;
export const MAX_POINT_QUERY_EXACT_RUNTIME_ARGUMENT_BYTES_V1 = 1 << 20;
export const MAX_POINT_QUERY_EXACT_RUNTIME_AUTH_BYTES_V1 = 1 << 16;

export interface PointQueryExactRuntimeArtifactRefV1 {
  readonly runtime: "dynamic-worker";
  readonly artifactId: string;
  readonly sourcePackageHash: string;
  readonly executionModule: string;
}

export interface PointQueryExactRuntimeFunctionV1 {
  readonly path: string;
  readonly executionModule: string;
  readonly kind: "query";
  readonly visibility: "public";
  readonly argsValidator:
    | ObjectValidatorJsonV1
    | Readonly<{ readonly type: "any" }>;
  readonly returnsValidator: ValidatorJsonV1 | null;
}

export type PointQueryExactRuntimeAuthV1 =
  | Readonly<{ readonly kind: "anonymous" }>
  | Readonly<{ readonly kind: "user"; readonly user: UserIdentity }>;

export interface PointQueryExactRuntimeTableV1 {
  readonly tableId: CatalogTableId;
  readonly logicalName: string;
}

export interface PointQueryExactRuntimeRequestV1 {
  readonly format: typeof POINT_QUERY_EXACT_RUNTIME_FORMAT_V1;
  readonly version: typeof POINT_QUERY_EXACT_RUNTIME_VERSION_V1;
  readonly runtimeTargetSha256: Uint8Array;
  readonly artifact: PointQueryExactRuntimeArtifactRefV1;
  readonly function: PointQueryExactRuntimeFunctionV1;
  readonly auth: PointQueryExactRuntimeAuthV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly argumentSemanticBytes: number;
  readonly tables: ReadonlyArray<PointQueryExactRuntimeTableV1>;
  readonly context: Readonly<{
    readonly executionId: string;
    readonly randomSeed: Uint8Array;
    readonly executionTime: number;
    readonly snapshotCommitSeq: bigint;
  }>;
}

export interface PointQueryExactRuntimeResultV1 {
  readonly format: typeof POINT_QUERY_EXACT_RUNTIME_RESULT_FORMAT_V1;
  readonly version: typeof POINT_QUERY_EXACT_RUNTIME_RESULT_VERSION_V1;
  readonly value: CanonicalFlarexRuntimeValueV1;
}

export class PointQueryExactRuntimeProtocolV1Error extends Data.TaggedError(
  "PointQueryExactRuntimeProtocolV1Error",
)<{
  readonly boundary: "request" | "result";
  readonly reason:
    | "invalidShape"
    | "invalidAuth"
    | "invalidArguments"
    | "invalidResult";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export const decodePointQueryExactRuntimeRequestV1Effect = Effect.fn(
  "PointQueryExactRuntimeProtocol.decodeRequestV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  PointQueryExactRuntimeRequestV1,
  PointQueryExactRuntimeProtocolV1Error
> {
  if (!isNonArrayRecord(input) || Reflect.ownKeys(input).length !== 10) {
    return yield* invalidRequest("$");
  }
  const argumentSemanticBytes = input.argumentSemanticBytes;
  if (
    input.format !== POINT_QUERY_EXACT_RUNTIME_FORMAT_V1 ||
    input.version !== POINT_QUERY_EXACT_RUNTIME_VERSION_V1 ||
    !isUint8ArrayWithByteLength(input.runtimeTargetSha256, 32) ||
    !isExactArtifact(input.artifact) || !isExactFunction(input.function) ||
    !isExactAuth(input.auth) || !Array.isArray(input.tables) ||
    input.tables.length > 1_024 || !isExactContext(input.context) ||
    !Number.isSafeInteger(argumentSemanticBytes) ||
    typeof argumentSemanticBytes !== "number" || argumentSemanticBytes < 0 ||
    argumentSemanticBytes > MAX_POINT_QUERY_EXACT_RUNTIME_ARGUMENT_BYTES_V1
  ) return yield* invalidRequest("$");
  const auth = yield* decodeOwnedQueryAuthV1(input.auth);
  const normalized = yield* Effect.try({
    try: () => normalizeFlarexValueV1(input.arguments),
    catch: cause => new PointQueryExactRuntimeProtocolV1Error({
      boundary: "request",
      reason: "invalidArguments",
      cause,
    }),
  });
  if (
    !isNonArrayRecord(normalized.value) ||
    normalized.semanticSizeBytes !== argumentSemanticBytes
  ) {
    return yield* new PointQueryExactRuntimeProtocolV1Error({
      boundary: "request",
      reason: "invalidArguments",
    });
  }
  const tables: PointQueryExactRuntimeTableV1[] = [];
  const ids = new Set<number>();
  const names = new Set<string>();
  for (let index = 0; index < input.tables.length; index += 1) {
    const table = input.tables[index];
    if (!isNonArrayRecord(table) || Reflect.ownKeys(table).length !== 2 ||
      !Number.isSafeInteger(table.tableId) || Number(table.tableId) < 1 ||
      !isBoundedText(table.logicalName) || ids.has(Number(table.tableId)) ||
      names.has(String(table.logicalName))) {
      return yield* invalidRequest(`tables[${index}]`);
    }
    ids.add(Number(table.tableId));
    names.add(String(table.logicalName));
    tables.push(Object.freeze({
      // SAFETY: the guard above validated tableId as a positive safe
      // integer.
      tableId: table.tableId as CatalogTableId,
      // SAFETY: the guard above validated logicalName as bounded text.
      logicalName: table.logicalName as string,
    }));
  }
  return Object.freeze({
    format: POINT_QUERY_EXACT_RUNTIME_FORMAT_V1,
    version: POINT_QUERY_EXACT_RUNTIME_VERSION_V1,
    runtimeTargetSha256: copyBytes(input.runtimeTargetSha256),
    artifact: Object.freeze({ ...input.artifact }),
    function: Object.freeze({
      ...input.function,
      argsValidator: snapshotDecodedProtocolPlainData(
        input.function.argsValidator,
      ),
      returnsValidator: snapshotDecodedProtocolPlainData(
        input.function.returnsValidator,
      ),
    }),
    auth,
    arguments: normalized.value,
    argumentSemanticBytes,
    tables: Object.freeze(tables),
    context: Object.freeze({
      ...input.context,
      randomSeed: copyBytes(input.context.randomSeed),
    }),
  });
});

export const decodePointQueryExactRuntimeResultV1Effect = Effect.fn(
  "PointQueryExactRuntimeProtocol.decodeResultV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  PointQueryExactRuntimeResultV1,
  PointQueryExactRuntimeProtocolV1Error
> {
  if (!isNonArrayRecord(input) || Reflect.ownKeys(input).length !== 3 ||
    input.format !== POINT_QUERY_EXACT_RUNTIME_RESULT_FORMAT_V1 ||
    input.version !== POINT_QUERY_EXACT_RUNTIME_RESULT_VERSION_V1) {
    return yield* new PointQueryExactRuntimeProtocolV1Error({
      boundary: "result",
      reason: "invalidShape",
    });
  }
  const normalized = yield* Effect.try({
    try: () => normalizeFlarexValueV1(input.value),
    catch: cause => new PointQueryExactRuntimeProtocolV1Error({
      boundary: "result",
      reason: "invalidResult",
      cause,
    }),
  });
  return Object.freeze({
    format: POINT_QUERY_EXACT_RUNTIME_RESULT_FORMAT_V1,
    version: POINT_QUERY_EXACT_RUNTIME_RESULT_VERSION_V1,
    value: normalized.value,
  });
});

function isExactArtifact(value: unknown): value is PointQueryExactRuntimeArtifactRefV1 {
  return isNonArrayRecord(value) && Reflect.ownKeys(value).length === 4 &&
    value.runtime === "dynamic-worker" && isBoundedText(value.artifactId) &&
    typeof value.sourcePackageHash === "string" &&
    /^[0-9a-f]{64}$/.test(value.sourcePackageHash) &&
    value.artifactId === `artifact_${value.sourcePackageHash.slice(0, 32)}` &&
    isBoundedText(value.executionModule);
}

function isExactFunction(value: unknown): value is PointQueryExactRuntimeFunctionV1 {
  return isNonArrayRecord(value) && Reflect.ownKeys(value).length === 6 &&
    isBoundedText(value.path) && isBoundedText(value.executionModule) &&
    value.kind === "query" && value.visibility === "public" &&
    isPointQueryArgsValidator(value.argsValidator) &&
    (value.returnsValidator === null ||
      validatorJsonAdmissionIssueV1(value.returnsValidator) === undefined);
}

function isPointQueryArgsValidator(
  value: unknown,
): value is PointQueryExactRuntimeFunctionV1["argsValidator"] {
  return validatorJsonAdmissionIssueV1(value) === undefined &&
    isNonArrayRecord(value) &&
    (value.type === "any" || value.type === "object");
}

function isExactAuth(value: unknown): value is PointQueryExactRuntimeAuthV1 {
  if (!isNonArrayRecord(value)) return false;
  return value.kind === "anonymous"
    ? Reflect.ownKeys(value).length === 1
    : value.kind === "user" && Reflect.ownKeys(value).length === 2 &&
      isNonArrayRecord(value.user);
}

const decodeOwnedQueryAuthV1 = Effect.fn(
  "PointQueryExactRuntimeProtocol.decodeAuthV1",
)(function* (
  value: PointQueryExactRuntimeAuthV1,
): Effect.fn.Return<
  PointQueryExactRuntimeAuthV1,
  PointQueryExactRuntimeProtocolV1Error
> {
  if (value.kind === "anonymous") return Object.freeze({ kind: "anonymous" });
  const normalized = yield* Effect.try({
    try: () => normalizeFlarexValueV1(value.user),
    catch: cause => new PointQueryExactRuntimeProtocolV1Error({
      boundary: "request",
      reason: "invalidAuth",
      cause,
    }),
  });
  if (normalized.semanticSizeBytes > MAX_POINT_QUERY_EXACT_RUNTIME_AUTH_BYTES_V1) {
    return yield* new PointQueryExactRuntimeProtocolV1Error({
      boundary: "request",
      reason: "invalidAuth",
      cause: new Error("Exact point-query user identity exceeds its byte limit."),
    });
  }
  const user = yield* decodeUserIdentityEffect(structuredClone(value.user)).pipe(
    Effect.mapError(cause => new PointQueryExactRuntimeProtocolV1Error({
      boundary: "request",
      reason: "invalidAuth",
      cause,
    })),
  );
  for (const member of Object.values(user)) {
    if (member !== undefined) freezeJson(member);
  }
  Object.freeze(user);
  return Object.freeze({ kind: "user", user });
});

function freezeJson(value: Json): void {
  if (Array.isArray(value)) {
    for (const member of value) freezeJson(member);
    Object.freeze(value);
  } else if (value !== null && typeof value === "object") {
    for (const member of Object.values(value)) freezeJson(member);
    Object.freeze(value);
  }
}

function isExactContext(value: unknown): value is PointQueryExactRuntimeRequestV1["context"] {
  return isNonArrayRecord(value) && Reflect.ownKeys(value).length === 4 &&
    isBoundedText(value.executionId) &&
    isUint8ArrayWithByteLength(value.randomSeed, 32) &&
    typeof value.executionTime === "number" && Number.isFinite(value.executionTime) &&
    typeof value.snapshotCommitSeq === "bigint" && value.snapshotCommitSeq >= 0n;
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && isNonBlankString(value) &&
    !value.includes("\0") && new TextEncoder().encode(value).byteLength <= 4_096;
}

function invalidRequest(path: string) {
  return Effect.fail(new PointQueryExactRuntimeProtocolV1Error({
    boundary: "request",
    reason: "invalidShape",
    path,
  }));
}
