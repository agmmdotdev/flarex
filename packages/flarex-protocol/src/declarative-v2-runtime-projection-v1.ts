import {
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Data, Result } from "effect";
import type {
  DeclarativeV2RuntimeExecutionGroupV1,
} from "./declarative-v2-physical-v1";

export const DECLARATIVE_V2_RUNTIME_PROJECTION_CODEC_IDENTITY_V1 =
  "flarex.declarative-v2/runtime-projection/v1" as const;
export const DECLARATIVE_V2_FUNCTION_GROUP_MANIFEST_CODEC_IDENTITY_V1 =
  "flarex.declarative-v2/function-group-manifest/v1" as const;
export const DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1 =
  "flarex.declarative-v2/cold-materialization-receipt/v1" as const;
export const DECLARATIVE_V2_RUNTIME_READINESS_POLICY_IDENTITY_V1 =
  "flarex.readiness/runtime-projection-cold-materialization/v1" as const;
export const DECLARATIVE_V2_RUNTIME_ARTIFACT_STORE_IDENTITY_V1 =
  "flarex.r2/declarative-v2-runtime-artifact/v1" as const;

export type DeclarativeV2RuntimeArtifactObjectKindV1 =
  | "runtime-projection-module"
  | "runtime-projection"
  | "runtime-projection-set"
  | "function-group-entry"
  | "function-group-manifest";

export type DeclarativeV2RuntimeArtifactCodecIdentityV1 =
  | typeof DECLARATIVE_V2_RUNTIME_PROJECTION_CODEC_IDENTITY_V1
  | typeof DECLARATIVE_V2_FUNCTION_GROUP_MANIFEST_CODEC_IDENTITY_V1;

export interface DeclarativeV2RuntimeArtifactObjectReferenceV1 {
  readonly storeIdentity:
    typeof DECLARATIVE_V2_RUNTIME_ARTIFACT_STORE_IDENTITY_V1;
  readonly kind: DeclarativeV2RuntimeArtifactObjectKindV1;
  readonly codecIdentity: DeclarativeV2RuntimeArtifactCodecIdentityV1;
  readonly objectKey: string;
  readonly byteLength: bigint;
  readonly sha256: Uint8Array;
}

const DIGEST_BYTES = 32;
const UTF8 = new TextEncoder();
const ROOT_DOMAINS = Object.freeze({
  runtimeProjectionModules:
    "flarex.declarative-v2/runtime-projection-module-root/v1\0",
  functionGroupEntries:
    "flarex.declarative-v2/function-group-entry-root/v1\0",
} as const);

export type DeclarativeV2RuntimeRootKindV1 =
  keyof typeof ROOT_DOMAINS;

export class DeclarativeV2RuntimeProjectionIdentityV1Error
  extends Data.TaggedError("DeclarativeV2RuntimeProjectionIdentityV1Error")<{
    readonly reason:
      | "invalidInput"
      | "invalidDigest"
      | "invalidByteLength"
      | "invalidBudget"
      | "budgetExceeded";
    readonly path?: string;
    readonly observed?: number;
    readonly maximum?: number;
}> {}

export function declarativeV2RuntimeArtifactCodecIdentityV1(
  kind: DeclarativeV2RuntimeArtifactObjectKindV1,
): DeclarativeV2RuntimeArtifactCodecIdentityV1 {
  return kind === "function-group-entry" ||
      kind === "function-group-manifest"
    ? DECLARATIVE_V2_FUNCTION_GROUP_MANIFEST_CODEC_IDENTITY_V1
    : DECLARATIVE_V2_RUNTIME_PROJECTION_CODEC_IDENTITY_V1;
}

export function declarativeV2RuntimeArtifactObjectKeyV1(
  kind: DeclarativeV2RuntimeArtifactObjectKindV1,
  digest: unknown,
): Result.Result<string, DeclarativeV2RuntimeProjectionIdentityV1Error> {
  if (!isRuntimeArtifactObjectKind(kind)) {
    return fail("invalidInput", "kind");
  }
  if (!isUint8ArrayWithByteLength(digest, DIGEST_BYTES)) {
    return fail("invalidDigest", "digest");
  }
  return Result.succeed(
    `declarative-v2-runtime-artifact/v1/${kind}/${
      encodeBytesToLowercaseHex(digest)
    }`,
  );
}

export function makeDeclarativeV2RuntimeArtifactObjectReferenceV1(
  kind: DeclarativeV2RuntimeArtifactObjectKindV1,
  digest: unknown,
  byteLength: unknown,
): Result.Result<
  DeclarativeV2RuntimeArtifactObjectReferenceV1,
  DeclarativeV2RuntimeProjectionIdentityV1Error
> {
  return Result.gen(function* () {
    const objectKey = yield* declarativeV2RuntimeArtifactObjectKeyV1(
      kind,
      digest,
    );
    if (
      typeof byteLength !== "number" ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 1
    ) {
      return yield* fail("invalidByteLength", "byteLength");
    }
    return Object.freeze({
      storeIdentity: DECLARATIVE_V2_RUNTIME_ARTIFACT_STORE_IDENTITY_V1,
      kind,
      codecIdentity: declarativeV2RuntimeArtifactCodecIdentityV1(kind),
      objectKey,
      byteLength: BigInt(byteLength),
      // SAFETY: the object-key derivation above validated digest as a
      // 32-byte SHA-256 value.
      sha256: copyBytes(digest as Uint8Array),
    });
  });
}

function isRuntimeArtifactObjectKind(
  value: unknown,
): value is DeclarativeV2RuntimeArtifactObjectKindV1 {
  return value === "runtime-projection-module" ||
    value === "runtime-projection" ||
    value === "runtime-projection-set" ||
    value === "function-group-entry" ||
    value === "function-group-manifest";
}

export interface DeclarativeV2RuntimeProjectionIdentityBudgetV1 {
  readonly maximumDigests: number;
  readonly maximumPreimageBytes: number;
}

/**
 * Canonical preimage for an ordered collection of already-canonical frame
 * digests. The order is semantic: runtime modules use ascending module ordinal
 * and manifest entries use ascending function ordinal.
 */
export function frameDeclarativeV2RuntimeRootSha256PreimageV1(
  kind: DeclarativeV2RuntimeRootKindV1,
  group: DeclarativeV2RuntimeExecutionGroupV1 | null,
  digests: ReadonlyArray<Uint8Array>,
  budget: unknown,
): Result.Result<
  Uint8Array,
  DeclarativeV2RuntimeProjectionIdentityV1Error
> {
  return Result.gen(function* () {
    const limits = yield* decodeBudget(budget);
    if (
      kind !== "runtimeProjectionModules" &&
      kind !== "functionGroupEntries"
    ) {
      return yield* fail("invalidInput", "kind");
    }
    if (
      group !== null &&
      group !== "transaction" &&
      group !== "edge_action"
    ) {
      return yield* fail("invalidInput", "group");
    }
    if (
      (kind === "runtimeProjectionModules" && group === null) ||
      (kind === "functionGroupEntries" && group !== null)
    ) {
      return yield* fail("invalidInput", "group");
    }
    if (!Array.isArray(digests) || digests.length > limits.maximumDigests) {
      return yield* Result.fail(new DeclarativeV2RuntimeProjectionIdentityV1Error({
        reason: "budgetExceeded",
        path: "digests",
        observed: Array.isArray(digests) ? digests.length : 0,
        maximum: limits.maximumDigests,
      }));
    }
    const domain = UTF8.encode(ROOT_DOMAINS[kind]);
    const groupBytes = UTF8.encode(group ?? "");
    const byteLength = domain.byteLength + 4 + groupBytes.byteLength + 4 +
      digests.length * DIGEST_BYTES;
    if (byteLength > limits.maximumPreimageBytes) {
      return yield* Result.fail(new DeclarativeV2RuntimeProjectionIdentityV1Error({
        reason: "budgetExceeded",
        path: "preimage",
        observed: byteLength,
        maximum: limits.maximumPreimageBytes,
      }));
    }
    const output = new Uint8Array(byteLength);
    let offset = 0;
    output.set(domain, offset);
    offset += domain.byteLength;
    writeU32(output, offset, groupBytes.byteLength);
    offset += 4;
    output.set(groupBytes, offset);
    offset += groupBytes.byteLength;
    writeU32(output, offset, digests.length);
    offset += 4;
    for (let index = 0; index < digests.length; index += 1) {
      const digest = digests[index];
      if (!isUint8ArrayWithByteLength(digest, DIGEST_BYTES)) {
        return yield* fail("invalidDigest", `digests[${index}]`);
      }
      output.set(digest, offset);
      offset += DIGEST_BYTES;
    }
    return output;
  });
}

function decodeBudget(
  value: unknown,
): Result.Result<
  DeclarativeV2RuntimeProjectionIdentityBudgetV1,
  DeclarativeV2RuntimeProjectionIdentityV1Error
> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return fail("invalidBudget", "budget");
  }
  const maximumDigests = Reflect.get(value, "maximumDigests");
  const maximumPreimageBytes = Reflect.get(value, "maximumPreimageBytes");
  return isNonNegativeSafeInteger(maximumDigests) &&
      isNonNegativeSafeInteger(maximumPreimageBytes)
    ? Result.succeed(Object.freeze({
      maximumDigests,
      maximumPreimageBytes,
    }))
    : fail("invalidBudget", "budget");
}

function fail(
  reason: DeclarativeV2RuntimeProjectionIdentityV1Error["reason"],
  path: string,
): Result.Result<never, DeclarativeV2RuntimeProjectionIdentityV1Error> {
  return Result.fail(new DeclarativeV2RuntimeProjectionIdentityV1Error({
    reason,
    path,
  }));
}

function writeU32(output: Uint8Array, offset: number, value: number): void {
  new DataView(
    output.buffer,
    output.byteOffset + offset,
    4,
  ).setUint32(0, value, false);
}
