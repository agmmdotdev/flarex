import { bytesEqualFullScan, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { compareUtf16Strings, isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";
import {
  decodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
  type DeclarativeV2RegistrationFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  encodeCanonicalJson,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";

import {
  encodeFunctionMetadataSetV1,
  type CanonicalFunctionMetadataSetV1,
  type FunctionMetadataCodecV1Error,
  type FunctionMetadataOperationBudgetV1,
} from "./functionMetadataCodec";
import {
  hashFunctionMetadataSha256V1,
  type FunctionMetadataSha256V1Error,
} from "./functionMetadataSha256";
import {
  makeLiveDeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1Error,
} from "./declarativeV2Sha256";

export const SYSTEM_SOURCE_CODEC_IDENTITY_V1 =
  "flarex.source-artifact-v2/codec-v1" as const;
export const SYSTEM_ARTIFACT_RUNTIME_IDENTITY_V1 = "dynamic-worker" as const;

const SOURCE_PACKAGE_DOMAIN =
  "flarex.declarative-v2/system-source-package/v1\0";
const EXECUTION_ARTIFACT_DOMAIN =
  "flarex.declarative-v2/system-execution-artifact/v1\0";
const HANDLER_SET_DOMAIN =
  "flarex.declarative-v2/declared-handler-set/v1\0";
const VALIDATOR_ROOT_DOMAIN =
  "flarex.declarative-v2/validator-root/v1\0";
const SCHEMA_BINDING_DOMAIN =
  "flarex.declarative-v2/application-schema-publication/v1\0";
const REGISTRATION_CLAIM_DOMAIN =
  "flarex.declarative-v2/application-revision-registration/v1\0";
const REGISTRATION_COMMAND_KIND = "registration_page";
const UTF8 = new TextEncoder();
const SHA256_BYTES = 32;
const U32_MAX = 0xffff_ffff;
const U64_MAX = 9_223_372_036_854_775_807n;
const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 1_048_576,
  maximumCanonicalBytes: 1_048_576,
});

declare const ApplicationRevisionRegistrationRequestKeyV1Brand: unique symbol;

export type ApplicationRevisionRegistrationRequestKeyV1 = string & {
  readonly [ApplicationRevisionRegistrationRequestKeyV1Brand]: true;
};

export class ApplicationRevisionRegistrationRequestKeyV1Error
  extends Data.TaggedError("ApplicationRevisionRegistrationRequestKeyV1Error")<{
    readonly reason: "invalidType" | "blank" | "nul" | "tooLong";
    readonly maximumUtf8Bytes?: number;
  }> {}

export class ApplicationRevisionRegistrationIdentityV1Error
  extends Data.TaggedError("ApplicationRevisionRegistrationIdentityV1Error")<{
    readonly operation:
      | "sourcePackage"
      | "executionArtifact"
      | "functionMetadata"
      | "handlerRoot"
      | "validatorRoot"
      | "schemaBinding"
      | "registrationClaim"
      | "registrationCorrelation";
    readonly reason:
      | "invalidInput"
      | "integerOutOfRange"
      | "duplicateBinding"
      | "missingBinding"
      | "frameMismatch"
      | "metadataMismatch";
    readonly path?: string;
  }> {}

export type ApplicationRevisionRegistrationIdentityErrorV1 =
  | ApplicationRevisionRegistrationIdentityV1Error
  | FunctionMetadataCodecV1Error
  | FunctionMetadataSha256V1Error
  | DeclarativeV2Sha256V1Error;

export interface SystemExecutionArtifactBindingV1 {
  readonly logicalModulePath: string;
  readonly artifactModulePath: string;
}

export interface SystemExecutionArtifactIdentityInputV1 {
  readonly packageSha256: Uint8Array;
  readonly executionPath: string;
  readonly moduleBindings: ReadonlyArray<SystemExecutionArtifactBindingV1>;
}

export interface SystemFunctionIdentityV1 {
  readonly metadata: CanonicalFunctionMetadataSetV1;
  readonly functionMetadataSha256: Uint8Array;
  readonly declaredHandlerSetSha256: Uint8Array;
  readonly validatorRootSha256: Uint8Array;
}

export interface SchemaBindingIdentityInputV1 {
  readonly deploymentId: string;
  readonly schemaVersionId: string;
  readonly version: number;
  readonly manifestCodecVersion: number;
  readonly manifestByteLength: bigint;
  readonly schemaArtifactSha256: Uint8Array;
}

export interface ApplicationRevisionRegistrationClaimInputV1 {
  readonly scopeId: string;
  readonly candidateSha256: Uint8Array;
  readonly attemptSha256: Uint8Array;
  readonly semanticAttemptIdentitySha256: Uint8Array;
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  readonly producerRequestSha256: Uint8Array;
  readonly canonicalCommandByteLength: bigint;
  readonly freshAuthenticatedInputSha256: Uint8Array;
  readonly commandInputSha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly outputManifestSha256: Uint8Array;
  readonly receiptSha256: Uint8Array;
  readonly nextProgressSha256: Uint8Array;
  readonly registrationRootSha256: Uint8Array;
  readonly registrationFrameCount: bigint;
  readonly sourceCodecIdentity: string;
  readonly packageSha256: Uint8Array;
  readonly artifactRuntimeIdentity: string;
  readonly artifactSha256: Uint8Array;
  readonly schemaVersionId: string;
  readonly schemaVersion: number;
  readonly manifestCodecVersion: number;
  readonly manifestByteLength: bigint;
  readonly schemaArtifactSha256: Uint8Array;
  readonly schemaBindingSha256: Uint8Array;
  readonly functionMetadataCodecVersion: number;
  readonly functionMetadataByteLength: bigint;
  readonly functionMetadataSha256: Uint8Array;
  readonly validatorRootSha256: Uint8Array;
  readonly declaredHandlerSetSha256: Uint8Array;
}

export function decodeApplicationRevisionRegistrationRequestKeyV1(
  input: unknown,
): Result.Result<
  ApplicationRevisionRegistrationRequestKeyV1,
  ApplicationRevisionRegistrationRequestKeyV1Error
> {
  if (typeof input !== "string") {
    return Result.fail(new ApplicationRevisionRegistrationRequestKeyV1Error({
      reason: "invalidType",
    }));
  }
  if (!isNonBlankString(input)) {
    return Result.fail(new ApplicationRevisionRegistrationRequestKeyV1Error({
      reason: "blank",
    }));
  }
  if (input.includes("\0")) {
    return Result.fail(new ApplicationRevisionRegistrationRequestKeyV1Error({
      reason: "nul",
    }));
  }
  if (UTF8.encode(input).byteLength > 1_024) {
    return Result.fail(new ApplicationRevisionRegistrationRequestKeyV1Error({
      reason: "tooLong",
      maximumUtf8Bytes: 1_024,
    }));
  }
  return Result.succeed(input as ApplicationRevisionRegistrationRequestKeyV1);
}

export const deriveSystemSourcePackageSha256V1 = Effect.fn(
  "ApplicationRevisionRegistration.deriveSourcePackage",
)(function* (
  sourceRootSha256: Uint8Array,
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
): Effect.fn.Return<
  Uint8Array,
  ApplicationRevisionRegistrationIdentityV1Error | DeclarativeV2Sha256V1Error
> {
  yield* requireDigest("sourcePackage", sourceRootSha256, "sourceRootSha256");
  const bytes = concatBytes(
    UTF8.encode(SOURCE_PACKAGE_DOMAIN),
    u32(1),
    sourceRootSha256,
  );
  return yield* sha256(bytes, { maximumInputBytes: bytes.byteLength });
});

export const deriveSystemExecutionArtifactSha256V1 = Effect.fn(
  "ApplicationRevisionRegistration.deriveExecutionArtifact",
)(function* (
  input: SystemExecutionArtifactIdentityInputV1,
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
): Effect.fn.Return<
  Uint8Array,
  ApplicationRevisionRegistrationIdentityV1Error | DeclarativeV2Sha256V1Error
> {
  yield* requireDigest("executionArtifact", input.packageSha256, "packageSha256");
  if (!isNonBlankString(input.executionPath)) {
    return yield* identityFailure(
      "executionArtifact",
      "invalidInput",
      "executionPath",
    );
  }
  const bindings = [...input.moduleBindings].toSorted((left, right) =>
    compareUtf16Strings(left.logicalModulePath, right.logicalModulePath) ||
    compareUtf16Strings(left.artifactModulePath, right.artifactModulePath)
  );
  const seenLogical = new Set<string>();
  const seenArtifact = new Set<string>();
  const parts: Uint8Array[] = [
    UTF8.encode(EXECUTION_ARTIFACT_DOMAIN),
    u32(1),
    input.packageSha256,
    text(SYSTEM_ARTIFACT_RUNTIME_IDENTITY_V1),
    text(input.executionPath),
    u64(BigInt(bindings.length)),
  ];
  for (const binding of bindings) {
    if (
      !isNonBlankString(binding.logicalModulePath) ||
      !isNonBlankString(binding.artifactModulePath)
    ) {
      return yield* identityFailure(
        "executionArtifact",
        "invalidInput",
        "moduleBindings",
      );
    }
    if (
      seenLogical.has(binding.logicalModulePath) ||
      seenArtifact.has(binding.artifactModulePath)
    ) {
      return yield* identityFailure(
        "executionArtifact",
        "duplicateBinding",
        `${binding.logicalModulePath}:${binding.artifactModulePath}`,
      );
    }
    seenLogical.add(binding.logicalModulePath);
    seenArtifact.add(binding.artifactModulePath);
    parts.push(text(binding.logicalModulePath), text(binding.artifactModulePath));
  }
  const bytes = concatBytes(...parts);
  return yield* sha256(bytes, { maximumInputBytes: bytes.byteLength });
});

export const deriveSystemFunctionIdentityV1 = Effect.fn(
  "ApplicationRevisionRegistration.deriveFunctionIdentity",
)(function* (
  functionMetadataInput: unknown,
  budget: FunctionMetadataOperationBudgetV1,
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
): Effect.fn.Return<
  SystemFunctionIdentityV1,
  ApplicationRevisionRegistrationIdentityErrorV1
> {
  const metadata = yield* Effect.fromResult(
    encodeFunctionMetadataSetV1(functionMetadataInput, budget),
  );
  const functionMetadataSha256 = yield* hashFunctionMetadataSha256V1(
    metadata.canonicalBytes,
    { maximumInputBytes: metadata.canonicalBytes.byteLength },
  );
  const handlerProjection = Object.freeze({
    format: "flarex.declared-handler-set",
    version: 1,
    handlers: Object.freeze(metadata.functions.map(({ metadata: item }) =>
      Object.freeze({
        functionPath: item.functionPath,
        executionModule: item.executionModule,
        kind: item.kind,
        visibility: item.visibility,
        route: item.route as Json,
        partition: item.partition as Json,
      } satisfies JsonObject)
    )),
  } satisfies JsonObject);
  const validatorProjection = Object.freeze({
    format: "flarex.validator-root",
    version: 1,
    validators: Object.freeze(metadata.functions.map(({ metadata: item }) =>
      Object.freeze({
        functionPath: item.functionPath,
        argsValidator: item.argsValidator as Json,
        returnsValidator: item.returnsValidator as Json,
      } satisfies JsonObject)
    )),
  } satisfies JsonObject);
  const declaredHandlerSetSha256 = yield* hashCanonicalProjection(
    "handlerRoot",
    HANDLER_SET_DOMAIN,
    handlerProjection,
    sha256,
  );
  const validatorRootSha256 = yield* hashCanonicalProjection(
    "validatorRoot",
    VALIDATOR_ROOT_DOMAIN,
    validatorProjection,
    sha256,
  );
  return Object.freeze({
    metadata,
    functionMetadataSha256: new Uint8Array(functionMetadataSha256),
    declaredHandlerSetSha256: new Uint8Array(declaredHandlerSetSha256),
    validatorRootSha256: new Uint8Array(validatorRootSha256),
  });
});

export const deriveSchemaBindingSha256V1 = Effect.fn(
  "ApplicationRevisionRegistration.deriveSchemaBinding",
)(function* (
  input: SchemaBindingIdentityInputV1,
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
): Effect.fn.Return<
  Uint8Array,
  ApplicationRevisionRegistrationIdentityV1Error | DeclarativeV2Sha256V1Error
> {
  if (!isNonBlankString(input.schemaVersionId)) {
    return yield* identityFailure(
      "schemaBinding",
      "invalidInput",
      "schemaVersionId",
    );
  }
  if (!isNonBlankString(input.deploymentId)) {
    return yield* identityFailure(
      "schemaBinding",
      "invalidInput",
      "deploymentId",
    );
  }
  yield* requireU32("schemaBinding", input.version, "version");
  yield* requireU32(
    "schemaBinding",
    input.manifestCodecVersion,
    "manifestCodecVersion",
  );
  yield* requireU64(
    "schemaBinding",
    input.manifestByteLength,
    "manifestByteLength",
  );
  yield* requireDigest(
    "schemaBinding",
    input.schemaArtifactSha256,
    "schemaArtifactSha256",
  );
  const bytes = concatBytes(
    UTF8.encode(SCHEMA_BINDING_DOMAIN),
    text64(input.deploymentId),
    text64(input.schemaVersionId),
    u32(input.version),
    u32(input.manifestCodecVersion),
    u64(input.manifestByteLength),
    input.schemaArtifactSha256,
  );
  return yield* sha256(bytes, { maximumInputBytes: bytes.byteLength });
});

export const deriveApplicationRevisionRegistrationClaimSha256V1 = Effect.fn(
  "ApplicationRevisionRegistration.deriveClaim",
)(function* (
  input: ApplicationRevisionRegistrationClaimInputV1,
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
): Effect.fn.Return<
  Uint8Array,
  ApplicationRevisionRegistrationIdentityV1Error | DeclarativeV2Sha256V1Error
> {
  const digests: ReadonlyArray<readonly [string, Uint8Array]> = [
    ["candidateSha256", input.candidateSha256],
    ["attemptSha256", input.attemptSha256],
    ["semanticAttemptIdentitySha256", input.semanticAttemptIdentitySha256],
    ["reservationSha256", input.reservationSha256],
    ["producerRequestSha256", input.producerRequestSha256],
    ["freshAuthenticatedInputSha256", input.freshAuthenticatedInputSha256],
    ["commandInputSha256", input.commandInputSha256],
    ["rangeAndPredecessorTailsSha256", input.rangeAndPredecessorTailsSha256],
    ["analyzerIdentitySha256", input.analyzerIdentitySha256],
    ["verifierIdentitySha256", input.verifierIdentitySha256],
    ["outputManifestSha256", input.outputManifestSha256],
    ["receiptSha256", input.receiptSha256],
    ["nextProgressSha256", input.nextProgressSha256],
    ["registrationRootSha256", input.registrationRootSha256],
    ["packageSha256", input.packageSha256],
    ["artifactSha256", input.artifactSha256],
    ["schemaArtifactSha256", input.schemaArtifactSha256],
    ["schemaBindingSha256", input.schemaBindingSha256],
    ["functionMetadataSha256", input.functionMetadataSha256],
    ["validatorRootSha256", input.validatorRootSha256],
    ["declaredHandlerSetSha256", input.declaredHandlerSetSha256],
  ];
  if (!isNonBlankString(input.scopeId)) {
    return yield* identityFailure(
      "registrationClaim",
      "invalidInput",
      "scopeId",
    );
  }
  for (const [path, digest] of digests) {
    yield* requireDigest("registrationClaim", digest, path);
  }
  yield* requireU32(
    "registrationClaim",
    input.schemaVersion,
    "schemaVersion",
  );
  yield* requireU32(
    "registrationClaim",
    input.manifestCodecVersion,
    "manifestCodecVersion",
  );
  yield* requireU32(
    "registrationClaim",
    input.functionMetadataCodecVersion,
    "functionMetadataCodecVersion",
  );
  const bigintFields: ReadonlyArray<readonly [string, bigint]> = [
    ["sequence", input.sequence],
    ["canonicalCommandByteLength", input.canonicalCommandByteLength],
    ["registrationFrameCount", input.registrationFrameCount],
    ["manifestByteLength", input.manifestByteLength],
    ["functionMetadataByteLength", input.functionMetadataByteLength],
  ];
  for (const [path, value] of bigintFields) {
    yield* requireU64("registrationClaim", value, path);
  }
  const bytes = concatBytes(
    UTF8.encode(REGISTRATION_CLAIM_DOMAIN),
    u32(1),
    text(input.scopeId),
    input.candidateSha256,
    input.attemptSha256,
    input.semanticAttemptIdentitySha256,
    text(REGISTRATION_COMMAND_KIND),
    u64(input.sequence),
    input.reservationSha256,
    input.producerRequestSha256,
    u64(input.canonicalCommandByteLength),
    input.freshAuthenticatedInputSha256,
    input.commandInputSha256,
    input.rangeAndPredecessorTailsSha256,
    input.analyzerIdentitySha256,
    input.verifierIdentitySha256,
    input.outputManifestSha256,
    input.receiptSha256,
    input.nextProgressSha256,
    input.registrationRootSha256,
    u64(input.registrationFrameCount),
    text(input.sourceCodecIdentity),
    input.packageSha256,
    text(input.artifactRuntimeIdentity),
    input.artifactSha256,
    text(input.schemaVersionId),
    u32(input.schemaVersion),
    u32(input.manifestCodecVersion),
    u64(input.manifestByteLength),
    input.schemaArtifactSha256,
    input.schemaBindingSha256,
    u32(input.functionMetadataCodecVersion),
    u64(input.functionMetadataByteLength),
    input.functionMetadataSha256,
    input.validatorRootSha256,
    input.declaredHandlerSetSha256,
  );
  return yield* sha256(bytes, { maximumInputBytes: bytes.byteLength });
});

export function validateRegistrationFramesAgainstFunctionMetadataV1(
  candidate: DeclarativeV2CandidateFrameV1,
  attemptSha256: Uint8Array,
  registrationFrames: ReadonlyArray<Uint8Array>,
  functionIdentity: SystemFunctionIdentityV1,
  moduleOrdinalByFunctionPath: ReadonlyMap<string, bigint>,
): Result.Result<
  ReadonlyArray<DeclarativeV2RegistrationFrameV1>,
  ApplicationRevisionRegistrationIdentityV1Error
> {
  return Result.gen(function* () {
    const metadata = functionIdentity.metadata;
    if (
      !isUint8ArrayWithByteLength(attemptSha256, SHA256_BYTES) ||
      !bytesEqualFullScan(
        candidate.declaredHandlerSetSha256,
        functionIdentity.declaredHandlerSetSha256,
      ) ||
      !bytesEqualFullScan(
        candidate.validatorRootSha256,
        functionIdentity.validatorRootSha256,
      )
    ) {
      return yield* Result.fail(identityError(
        "registrationCorrelation",
        "invalidInput",
        "candidate",
      ));
    }
    if (registrationFrames.length !== metadata.functions.length) {
      return yield* Result.fail(identityError(
        "registrationCorrelation",
        "metadataMismatch",
        "registrationFrames.length",
      ));
    }
    const decoded: DeclarativeV2RegistrationFrameV1[] = [];
    for (let index = 0; index < registrationFrames.length; index += 1) {
      const frame = yield* decodeDeclarativeV2PhysicalFrameV1(
        registrationFrames[index],
        FRAME_BUDGET,
      ).pipe(Result.mapError(() =>
        identityError(
          "registrationCorrelation",
          "frameMismatch",
          `registrationFrames[${index}]`,
        )
      ));
      if (frame.frame.kind !== "registration") {
        return yield* Result.fail(identityError(
          "registrationCorrelation",
          "frameMismatch",
          `registrationFrames[${index}].kind`,
        ));
      }
      if (
        frame.frame.registrationOrdinal !== BigInt(index) ||
        !isUint8ArrayWithByteLength(
          frame.frame.handlerIdentitySha256,
          SHA256_BYTES,
        )
      ) {
        return yield* Result.fail(identityError(
          "registrationCorrelation",
          "frameMismatch",
          `registrationFrames[${index}].identity`,
        ));
      }
      decoded.push(frame.frame);
    }
    decoded.sort((left, right) =>
      compareUtf16Strings(left.functionPath, right.functionPath)
    );
    for (let index = 0; index < decoded.length; index += 1) {
      const frame = decoded[index]!;
      const item = metadata.functions[index]!.metadata;
      const separator = item.functionPath.lastIndexOf(":");
      const exportName = separator < 0
        ? ""
        : item.functionPath.slice(separator + 1);
      if (!bytesEqualFullScan(frame.attemptSha256, attemptSha256)) {
        return yield* Result.fail(identityError(
          "registrationCorrelation",
          "frameMismatch",
          `registrationFrames[${index}].attemptSha256`,
        ));
      }
      if (
        frame.functionPath !== item.functionPath ||
        frame.exportName !== exportName ||
        frame.handlerKind !== item.kind ||
        frame.visibility !== item.visibility ||
        frame.moduleOrdinal !==
          moduleOrdinalByFunctionPath.get(item.functionPath)
      ) {
        return yield* Result.fail(identityError(
          "registrationCorrelation",
          "metadataMismatch",
          `registrationFrames[${index}]`,
        ));
      }
    }
    return Object.freeze(decoded);
  });
}

function hashCanonicalProjection(
  operation: "handlerRoot" | "validatorRoot",
  domain: string,
  projection: JsonObject,
  sha256: DeclarativeV2Sha256V1,
): Effect.Effect<
  Uint8Array,
  ApplicationRevisionRegistrationIdentityV1Error | DeclarativeV2Sha256V1Error
> {
  return Effect.gen(function* () {
    const canonical = encodeCanonicalJson(projection, () => {
      throw identityError(operation, "invalidInput", "canonicalProjection");
    });
    const canonicalBytes = UTF8.encode(canonical);
    const bytes = concatBytes(
      UTF8.encode(domain),
      u32(canonicalBytes.byteLength),
      canonicalBytes,
    );
    return yield* sha256(bytes, { maximumInputBytes: bytes.byteLength });
  });
}

function requireDigest(
  operation: ApplicationRevisionRegistrationIdentityV1Error["operation"],
  value: unknown,
  path: string,
): Effect.Effect<void, ApplicationRevisionRegistrationIdentityV1Error> {
  return isUint8ArrayWithByteLength(value, SHA256_BYTES)
    ? Effect.void
    : identityFailure(operation, "invalidInput", path);
}

function requireU32(
  operation: ApplicationRevisionRegistrationIdentityV1Error["operation"],
  value: number,
  path: string,
): Effect.Effect<void, ApplicationRevisionRegistrationIdentityV1Error> {
  return Number.isSafeInteger(value) && value >= 0 && value <= U32_MAX
    ? Effect.void
    : identityFailure(operation, "integerOutOfRange", path);
}

function requireU64(
  operation: ApplicationRevisionRegistrationIdentityV1Error["operation"],
  value: bigint,
  path: string,
): Effect.Effect<void, ApplicationRevisionRegistrationIdentityV1Error> {
  return value >= 0n && value <= U64_MAX
    ? Effect.void
    : identityFailure(operation, "integerOutOfRange", path);
}

function identityFailure(
  operation: ApplicationRevisionRegistrationIdentityV1Error["operation"],
  reason: ApplicationRevisionRegistrationIdentityV1Error["reason"],
  path?: string,
): Effect.Effect<never, ApplicationRevisionRegistrationIdentityV1Error> {
  return Effect.fail(identityError(operation, reason, path));
}

function identityError(
  operation: ApplicationRevisionRegistrationIdentityV1Error["operation"],
  reason: ApplicationRevisionRegistrationIdentityV1Error["reason"],
  path?: string,
): ApplicationRevisionRegistrationIdentityV1Error {
  return new ApplicationRevisionRegistrationIdentityV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
  });
}

function text(value: string): Uint8Array {
  const bytes = UTF8.encode(value);
  return concatBytes(u32(bytes.byteLength), bytes);
}

function text64(value: string): Uint8Array {
  const bytes = UTF8.encode(value);
  return concatBytes(u64(BigInt(bytes.byteLength)), bytes);
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function concatBytes(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let byteLength = 0;
  for (const part of parts) byteLength += part.byteLength;
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
