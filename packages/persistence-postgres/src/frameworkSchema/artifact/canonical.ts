import { copyBytes, copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Brand, Effect, Encoding, Result } from "effect";
import {
  encodeCanonicalJson,
  measureCanonicalJsonUtf8Bytes,
  type JsonObject,
} from "flarex-protocol/json";

import {
  FrameworkSchemaArtifactError,
  FrameworkSchemaArtifactInvariantDefect,
} from "./errors";
import {
  type FrameworkSchemaArtifact,
  type FrameworkSchemaArtifactCanonicalJson,
  type FrameworkSchemaArtifactFrame,
  type FrameworkSchemaArtifactSha256,
} from "./model";
import {
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES,
  normalizeFrameworkSchemaArtifact,
} from "./policy";

const SHA256_BYTE_LENGTH = 32;
const UTF8 = new TextEncoder();
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const brandArtifactSha256 = Brand.nominal<FrameworkSchemaArtifactSha256>();
const brandCanonicalJson =
  Brand.nominal<FrameworkSchemaArtifactCanonicalJson>();

interface CapturedFrameworkSchemaArtifactState {
  readonly artifactSha256Bytes: Uint8Array;
  readonly canonicalBytes: Uint8Array;
}

export interface CapturedFrameworkSchemaArtifactEvidence {
  readonly artifactSha256Bytes: Uint8Array;
  readonly canonicalBytes: Uint8Array;
}

interface FrameworkSchemaArtifactDigest {
  readonly artifactSha256: FrameworkSchemaArtifactSha256;
  readonly artifactSha256Bytes: Uint8Array;
}

const capturedFrameworkSchemaArtifactStates = new WeakMap<
  FrameworkSchemaArtifact,
  CapturedFrameworkSchemaArtifactState
>();

export const captureFrameworkSchemaArtifact = Effect.fn(
  "FrameworkSchemaArtifact.capture",
)(function* (
  input: unknown,
): Effect.fn.Return<FrameworkSchemaArtifact, FrameworkSchemaArtifactError> {
  const frame = yield* Effect.fromResult(
    normalizeFrameworkSchemaArtifact(input),
  );
  const frameJson = frameworkSchemaArtifactFrameJson(frame);
  const measurement = measureCanonicalJsonUtf8Bytes(
    frameJson,
    MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES,
  );
  if (measurement.kind === "invalid") {
    return yield* Effect.die(new FrameworkSchemaArtifactInvariantDefect({
      reason: "canonicalFrameInvalid",
    }));
  }
  if (measurement.kind === "exceeded") {
    return yield* Effect.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  const canonicalText = encodeCanonicalJson(frameJson, () => {
    throw new FrameworkSchemaArtifactInvariantDefect({
      reason: "canonicalFrameInvalid",
    });
  });
  const canonicalBytes = UTF8.encode(canonicalText);
  if (canonicalBytes.byteLength !== measurement.bytes) {
    return yield* Effect.die(new FrameworkSchemaArtifactInvariantDefect({
      reason: "canonicalByteLengthMismatch",
      observedByteLength: canonicalBytes.byteLength,
    }));
  }
  const {
    artifactSha256,
    artifactSha256Bytes,
  } = yield* hashFrameworkSchemaArtifact(canonicalBytes);
  const identity = Object.freeze({
    deploymentId: frame.deploymentId,
    owner: frame.owner,
    lineageId: frame.lineageId,
    artifactSha256,
  });
  const artifact = Object.freeze({
    identity,
    codec: frame.payloadCodec,
    provenance: frame.provenance,
    capabilities: frame.capabilities,
    dependencies: frame.dependencies,
    payload: frame.payload,
    canonicalJson: brandCanonicalJson(canonicalText),
  });
  capturedFrameworkSchemaArtifactStates.set(artifact, {
    artifactSha256Bytes: copyBytes(artifactSha256Bytes),
    canonicalBytes: copyBytes(canonicalBytes),
  });
  return artifact;
});

/** Package-private owned evidence for the exact artifact issued by capture. */
export function copyCapturedFrameworkSchemaArtifactEvidence(
  artifact: FrameworkSchemaArtifact,
): CapturedFrameworkSchemaArtifactEvidence | undefined {
  const captured = capturedFrameworkSchemaArtifactStates.get(artifact);
  return captured === undefined
    ? undefined
    : Object.freeze({
        artifactSha256Bytes: copyBytes(captured.artifactSha256Bytes),
        canonicalBytes: copyBytes(captured.canonicalBytes),
      });
}

const hashFrameworkSchemaArtifact = Effect.fn(
  "FrameworkSchemaArtifact.sha256",
)(function* (
  canonicalBytes: Uint8Array,
): Effect.fn.Return<FrameworkSchemaArtifactDigest, FrameworkSchemaArtifactError> {
  const ownedInput = copyBytesToArrayBuffer(canonicalBytes);
  const foreignOutput = yield* Effect.tryPromise({
    try: () => globalThis.crypto.subtle.digest("SHA-256", ownedInput),
    catch: cause => FrameworkSchemaArtifactError.hashFailure(cause),
  });
  const validatedOutput = yield* Result.match(
    validateSha256ArrayBuffer(foreignOutput),
    {
      onFailure: Effect.die,
      onSuccess: Effect.succeed,
    },
  );
  const ownedOutput = new Uint8Array(SHA256_BYTE_LENGTH);
  Uint8Array.prototype.set.call(ownedOutput, new Uint8Array(validatedOutput));
  return Object.freeze({
    artifactSha256: brandArtifactSha256(Encoding.encodeHex(ownedOutput)),
    artifactSha256Bytes: ownedOutput,
  });
});

function frameworkSchemaArtifactFrameJson(
  frame: FrameworkSchemaArtifactFrame,
): JsonObject {
  const payloadCodec = Object.freeze({
    format: frame.payloadCodec.format,
    version: frame.payloadCodec.version,
  } satisfies JsonObject);
  const dependencies = Object.freeze(frame.dependencies.map(dependency =>
    Object.freeze({
      deploymentId: dependency.deploymentId,
      owner: dependency.owner,
      lineageId: dependency.lineageId,
      artifactSha256: dependency.artifactSha256,
    } satisfies JsonObject)
  ));
  return Object.freeze({
    format: frame.format,
    version: frame.version,
    deploymentId: frame.deploymentId,
    owner: frame.owner,
    lineageId: frame.lineageId,
    payloadCodec,
    provenance: frame.provenance,
    capabilities: frame.capabilities,
    dependencies,
    payload: frame.payload,
  } satisfies JsonObject);
}

function validateSha256ArrayBuffer(
  input: unknown,
): Result.Result<ArrayBuffer, FrameworkSchemaArtifactInvariantDefect> {
  if (ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) {
    return Result.fail(new FrameworkSchemaArtifactInvariantDefect({
      reason: "invalidPlatformIntrinsic",
    }));
  }
  let observedByteLength: number | undefined;
  try {
    const byteLength: unknown = ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(input);
    if (typeof byteLength === "number") observedByteLength = byteLength;
  } catch {
    return Result.fail(new FrameworkSchemaArtifactInvariantDefect({
      reason: "invalidDigestOutput",
    }));
  }
  if (observedByteLength !== SHA256_BYTE_LENGTH) {
    return Result.fail(observedByteLength === undefined
      ? new FrameworkSchemaArtifactInvariantDefect({
          reason: "invalidDigestOutput",
        })
      : new FrameworkSchemaArtifactInvariantDefect({
          reason: "invalidDigestOutput",
          observedByteLength,
        }));
  }
  // SAFETY: The intrinsic getter above proves a cross-realm ArrayBuffer.
  return Result.succeed(input as ArrayBuffer);
}
