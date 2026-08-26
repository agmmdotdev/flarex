import {
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result, Schema } from "effect";

import {
  decodeUserIdentityEffect,
  type UserIdentity,
} from "./auth";
import type { Json } from "./json";
import {
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
} from "./edge-action-host-policy-v1";
import { snapshotDecodedProtocolPlainData } from
  "./decoded-protocol-snapshot";
import {
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
} from "./value";
import {
  TransactionRequestKeyV1Schema,
  type TransactionRequestKeyV1,
} from "./transaction-session";
import {
  validatorJsonAdmissionIssueV1,
  type ValidatorJsonV1,
} from "./validator-json";

export const EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1 =
  "flarex.edge-action-exact-runtime" as const;
export const EDGE_ACTION_EXACT_RUNTIME_VERSION_V1 = 1 as const;
export const EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1 =
  "flarex.edge-action-exact-runtime-result" as const;
export const EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1 = 1 as const;
export const EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1 =
  "FlarexEdgeActionExactRuntimeV1" as const;
export const EDGE_ACTION_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1 = 32;
export const EDGE_ACTION_EXACT_RUNTIME_DIGEST_BYTES_V1 = 32;
export const MAX_EDGE_ACTION_EXACT_RUNTIME_TEXT_BYTES_V1 = 4_096;
export const MAX_EDGE_ACTION_EXACT_RUNTIME_AUTH_BYTES_V1 = 64 * 1_024;
export const EDGE_ACTION_CHILD_MUTATION_REQUEST_KEY_PREFIX_V1 =
  "edge-action-mutation:v1:" as const;

const UTF8 = new TextEncoder();
const decodeTransactionRequestKeyV1 = Schema.decodeUnknownResult(
  TransactionRequestKeyV1Schema,
);

export type EdgeActionExactRuntimeAuthV1 =
  | Readonly<{ readonly kind: "anonymous" }>
  | Readonly<{ readonly kind: "user"; readonly user: UserIdentity }>;

export interface EdgeActionExactRuntimeArtifactRefV1 {
  readonly runtime: "dynamic-worker";
  readonly artifactId: string;
  readonly sourcePackageHash: string;
  readonly executionModule: string;
}

export interface EdgeActionExactRuntimeFunctionV1 {
  readonly path: string;
  readonly executionModule: string;
  readonly kind: "action";
  readonly visibility: "public";
  readonly argsValidator: ValidatorJsonV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
}

export interface EdgeActionExactRuntimeContextV1 {
  readonly executionId: string;
  readonly invocationId: string;
  readonly executionGeneration: bigint;
  readonly executionTime: number;
  readonly executionDeadline: number;
  readonly randomSeed: Uint8Array;
  readonly runtimeTargetSha256: Uint8Array;
  readonly hostPolicySha256: Uint8Array;
}

export interface EdgeActionExactRuntimeRequestV1 {
  readonly format: typeof EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1;
  readonly version: typeof EDGE_ACTION_EXACT_RUNTIME_VERSION_V1;
  readonly exactRuntimeProfile: typeof EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1;
  readonly syscallAbiIdentity: typeof EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1;
  readonly artifact: EdgeActionExactRuntimeArtifactRefV1;
  readonly function: EdgeActionExactRuntimeFunctionV1;
  readonly auth: EdgeActionExactRuntimeAuthV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly argumentSemanticBytes: number;
  readonly context: EdgeActionExactRuntimeContextV1;
}

export interface EdgeActionExactRuntimeResultV1 {
  readonly format: typeof EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1;
  readonly version: typeof EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1;
  readonly value: CanonicalFlarexRuntimeValueV1;
}

export class EdgeActionExactRuntimeProtocolV1Error extends Data.TaggedError(
  "EdgeActionExactRuntimeProtocolV1Error",
)<{
  readonly boundary: "request" | "result";
  readonly reason:
    | "invalidShape"
    | "invalidAuth"
    | "invalidArguments"
    | "argumentSizeMismatch"
    | "invalidResult";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export class EdgeActionChildMutationRequestKeyV1Error extends Data.TaggedError(
  "EdgeActionChildMutationRequestKeyV1Error",
)<{
  readonly reason: "invalidDigest" | "invalidProjection";
}> {}

export function edgeActionChildMutationRequestKeyV1FromDigest(
  input: unknown,
): Result.Result<
  TransactionRequestKeyV1,
  EdgeActionChildMutationRequestKeyV1Error
> {
  if (!isUint8ArrayWithByteLength(input, EDGE_ACTION_EXACT_RUNTIME_DIGEST_BYTES_V1)) {
    return Result.fail(new EdgeActionChildMutationRequestKeyV1Error({
      reason: "invalidDigest",
    }));
  }
  let ownedDigest: Uint8Array;
  try {
    ownedDigest = copyBytes(input);
  } catch {
    return Result.fail(new EdgeActionChildMutationRequestKeyV1Error({
      reason: "invalidDigest",
    }));
  }
  const requestKey =
    `${EDGE_ACTION_CHILD_MUTATION_REQUEST_KEY_PREFIX_V1}${
      encodeBytesToLowercaseHex(ownedDigest)
    }`;
  return decodeTransactionRequestKeyV1(requestKey).pipe(
    Result.mapError(() => new EdgeActionChildMutationRequestKeyV1Error({
      reason: "invalidProjection",
    })),
  );
}

export const decodeEdgeActionExactRuntimeRequestV1Effect = Effect.fn(
  "EdgeActionExactRuntimeProtocol.decodeRequestV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  EdgeActionExactRuntimeRequestV1,
  EdgeActionExactRuntimeProtocolV1Error
> {
  if (
    !isNonArrayRecord(input) ||
    Reflect.ownKeys(input).length !== 10 ||
    input.format !== EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1 ||
    input.version !== EDGE_ACTION_EXACT_RUNTIME_VERSION_V1 ||
    input.exactRuntimeProfile !== EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1 ||
    input.syscallAbiIdentity !== EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1
  ) return yield* invalidRequest("$");
  const artifact = yield* captureArtifact(input.artifact);
  const fn = yield* captureFunction(input.function);
  if (artifact.executionModule !== fn.executionModule) {
    return yield* invalidRequest("function.executionModule");
  }
  const auth = yield* captureAuth(input.auth);
  const normalizedArguments = yield* Effect.try({
    try: () => normalizeFlarexValueV1(input.arguments),
    catch: cause => new EdgeActionExactRuntimeProtocolV1Error({
      boundary: "request",
      reason: "invalidArguments",
      cause,
    }),
  });
  if (!isCanonicalFlarexRuntimeObjectV1(normalizedArguments.value)) {
    return yield* new EdgeActionExactRuntimeProtocolV1Error({
      boundary: "request",
      reason: "invalidArguments",
    });
  }
  if (
    typeof input.argumentSemanticBytes !== "number" ||
    !Number.isSafeInteger(input.argumentSemanticBytes) ||
    input.argumentSemanticBytes < 1 ||
    input.argumentSemanticBytes !== normalizedArguments.semanticSizeBytes
  ) return yield* new EdgeActionExactRuntimeProtocolV1Error({
    boundary: "request",
    reason: "argumentSizeMismatch",
  });
  const context = yield* captureContext(input.context);
  return Object.freeze({
    format: EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1,
    version: EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    artifact,
    function: fn,
    auth,
    arguments: normalizedArguments.value,
    argumentSemanticBytes: normalizedArguments.semanticSizeBytes,
    context,
  });
});

export const decodeEdgeActionExactRuntimeAuthV1Effect = Effect.fn(
  "EdgeActionExactRuntimeProtocol.decodeAuthV1",
)(function (
  input: unknown,
): Effect.Effect<
  EdgeActionExactRuntimeAuthV1,
  EdgeActionExactRuntimeProtocolV1Error
> {
  return captureAuth(input);
});

export const decodeEdgeActionExactRuntimeResultV1Effect = Effect.fn(
  "EdgeActionExactRuntimeProtocol.decodeResultV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  EdgeActionExactRuntimeResultV1,
  EdgeActionExactRuntimeProtocolV1Error
> {
  if (
    !isNonArrayRecord(input) ||
    Reflect.ownKeys(input).length !== 3 ||
    input.format !== EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1 ||
    input.version !== EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1
  ) return yield* new EdgeActionExactRuntimeProtocolV1Error({
    boundary: "result",
    reason: "invalidShape",
  });
  const normalized = yield* Effect.try({
    try: () => normalizeFlarexValueV1(input.value),
    catch: cause => new EdgeActionExactRuntimeProtocolV1Error({
      boundary: "result",
      reason: "invalidResult",
      cause,
    }),
  });
  return Object.freeze({
    format: EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
    version: EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
    value: normalized.value,
  });
});

function captureArtifact(
  input: unknown,
): Effect.Effect<
  EdgeActionExactRuntimeArtifactRefV1,
  EdgeActionExactRuntimeProtocolV1Error
> {
  if (
    !isNonArrayRecord(input) ||
    Reflect.ownKeys(input).length !== 4 ||
    input.runtime !== "dynamic-worker" ||
    !isBoundedText(input.artifactId) ||
    typeof input.sourcePackageHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.sourcePackageHash) ||
    !isBoundedText(input.executionModule)
  ) return invalidRequest("artifact");
  return Effect.succeed(Object.freeze({
    runtime: "dynamic-worker",
    artifactId: input.artifactId,
    sourcePackageHash: input.sourcePackageHash,
    executionModule: input.executionModule,
  }));
}

function captureFunction(
  input: unknown,
): Effect.Effect<
  EdgeActionExactRuntimeFunctionV1,
  EdgeActionExactRuntimeProtocolV1Error
> {
  if (
    !isNonArrayRecord(input) ||
    Reflect.ownKeys(input).length !== 6 ||
    !isBoundedText(input.path) ||
    !isBoundedText(input.executionModule) ||
    input.kind !== "action" ||
    input.visibility !== "public" ||
    !isValidatorJsonV1(input.argsValidator) ||
    (
      input.returnsValidator !== null &&
      !isValidatorJsonV1(input.returnsValidator)
    )
  ) return invalidRequest("function");
  return Effect.succeed(Object.freeze({
    path: input.path,
    executionModule: input.executionModule,
    kind: "action",
    visibility: "public",
    argsValidator: snapshotDecodedProtocolPlainData(input.argsValidator),
    returnsValidator: snapshotDecodedProtocolPlainData(input.returnsValidator),
  }));
}

function captureAuth(
  input: unknown,
): Effect.Effect<
  EdgeActionExactRuntimeAuthV1,
  EdgeActionExactRuntimeProtocolV1Error
> {
  return Effect.gen(function* () {
    const captured = yield* Effect.try({
      try: () => structuredClone(input),
      catch: cause => new EdgeActionExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidAuth",
        cause,
      }),
    });
    if (!isNonArrayRecord(captured)) return yield* invalidRequest("auth");
    if (
      captured.kind === "anonymous" &&
      Reflect.ownKeys(captured).length === 1
    ) return Object.freeze({ kind: "anonymous" as const });
    if (
      captured.kind !== "user" ||
      Reflect.ownKeys(captured).length !== 2
    ) return yield* invalidRequest("auth");
    const normalized = yield* Effect.try({
      try: () => normalizeFlarexValueV1(captured.user),
      catch: cause => new EdgeActionExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidAuth",
        cause,
      }),
    });
    if (normalized.semanticSizeBytes > MAX_EDGE_ACTION_EXACT_RUNTIME_AUTH_BYTES_V1) {
      return yield* new EdgeActionExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidAuth",
      });
    }
    const user = yield* decodeUserIdentityEffect(captured.user).pipe(
      Effect.mapError(cause => new EdgeActionExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidAuth",
        cause,
      })),
    );
    freezeUserIdentity(user);
    return Object.freeze({ kind: "user" as const, user });
  });
}

function isValidatorJsonV1(input: unknown): input is ValidatorJsonV1 {
  return validatorJsonAdmissionIssueV1(input) === undefined &&
    isNonArrayRecord(input) &&
    typeof input.type === "string";
}

function freezeUserIdentity(user: UserIdentity): void {
  for (const value of Object.values(user)) {
    if (value !== undefined) freezeJsonValue(value);
  }
  Object.freeze(user);
}

function freezeJsonValue(value: Json): void {
  if (Array.isArray(value)) {
    for (const item of value) freezeJsonValue(item);
    Object.freeze(value);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freezeJsonValue(item);
    Object.freeze(value);
  }
}

function captureContext(
  input: unknown,
): Effect.Effect<
  EdgeActionExactRuntimeContextV1,
  EdgeActionExactRuntimeProtocolV1Error
> {
  if (
    !isNonArrayRecord(input) ||
    Reflect.ownKeys(input).length !== 8 ||
    !isBoundedText(input.executionId) ||
    !isBoundedText(input.invocationId) ||
    typeof input.executionGeneration !== "bigint" ||
    input.executionGeneration < 1n ||
    typeof input.executionTime !== "number" ||
    !Number.isFinite(input.executionTime) ||
    typeof input.executionDeadline !== "number" ||
    !Number.isFinite(input.executionDeadline) ||
    input.executionDeadline < input.executionTime ||
    !isUint8ArrayWithByteLength(
      input.randomSeed,
      EDGE_ACTION_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1,
    ) ||
    !isUint8ArrayWithByteLength(
      input.runtimeTargetSha256,
      EDGE_ACTION_EXACT_RUNTIME_DIGEST_BYTES_V1,
    ) ||
    !isUint8ArrayWithByteLength(
      input.hostPolicySha256,
      EDGE_ACTION_EXACT_RUNTIME_DIGEST_BYTES_V1,
    )
  ) return invalidRequest("context");
  return Effect.succeed(Object.freeze({
    executionId: input.executionId,
    invocationId: input.invocationId,
    executionGeneration: input.executionGeneration,
    executionTime: input.executionTime,
    executionDeadline: input.executionDeadline,
    randomSeed: copyBytes(input.randomSeed),
    runtimeTargetSha256: copyBytes(input.runtimeTargetSha256),
    hostPolicySha256: copyBytes(input.hostPolicySha256),
  }));
}

function isBoundedText(input: unknown): input is string {
  return typeof input === "string" &&
    isNonBlankString(input) &&
    !input.includes("\0") &&
    UTF8.encode(input).byteLength <= MAX_EDGE_ACTION_EXACT_RUNTIME_TEXT_BYTES_V1;
}

function invalidRequest(
  path: string,
): Effect.Effect<never, EdgeActionExactRuntimeProtocolV1Error> {
  return Effect.fail(new EdgeActionExactRuntimeProtocolV1Error({
    boundary: "request",
    reason: "invalidShape",
    path,
  }));
}
