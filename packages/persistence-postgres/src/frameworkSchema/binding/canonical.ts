import { Effect, Result, Schema } from "effect";
import {
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { encodeCanonicalJson, type JsonObject } from "flarex-protocol/json";
import {
  isExactPrivateValueRecord as record,
  isPrivateValueSha256 as sha,
  isBoundedPrivateValueIdentityText as identity,
  isCanonicalPrivateValueNonNegativeInt64 as uint,
  isCanonicalPrivateValuePositiveInt64 as positive,
  isCanonicalPrivateValueInstant as instant,
} from "../privateStoredValueShape";
import { isStoredPhysicalLocator, isStoredArtifactIdentity } from "../../migrationCoordination/storedValidation";
import { isStoredInstallationIdentity } from "../installation/storedValidation";
import { capturePrivateJsonData } from "../../privateJsonData";
import { isBindingCoverage as isCoverage, isCommerceBinding } from "./commerceBindingSchema";
import {
  capturePrivateCanonicalValue,
  verifyStoredPrivateCanonicalValue,
  PrivateCanonicalValueInvariantDefect,
  type PrivateCanonicalValueSnapshot,
} from "../privateCanonicalValue";
import { bindingError, type DataBindingError } from "./errors";
import {
  MAX_BINDING_BYTES,
  MAX_BINDING_REQUIREMENTS,
  MAX_COMMERCE_BINDINGS,
  type ApplicationBindingReference,
  type BindingProfileReference,
  type PhysicalDataBinding,
  type PayloadContentBinding,
  type InstallationBindingReference,
  type DataBindingSetFrame,
  type DataBindingHeadToken,
  type DataBindingActivationRequest,
  type DataBindingActivationFrame,
  type DataBindingHeadFrame,
} from "./model";

export function sameBindingValue(left: JsonObject, right: JsonObject): boolean {
  return (
    encodeCanonicalJson(left, invalidCanonical) ===
    encodeCanonicalJson(right, invalidCanonical)
  );
}
function invalidCanonical(): never {
  throw new PrivateCanonicalValueInvariantDefect("canonicalFrameInvalid");
}
const isScopeEpoch = Schema.is(ScopeEpochSchema);
const isScopeId = Schema.is(ScopeIdSchema);

function arrayOf<T>(
  input: unknown,
  maximum: number,
  guard: (input: unknown) => input is T,
): input is readonly T[] {
  if (
    !Array.isArray(input) ||
    input.length > maximum ||
    Reflect.ownKeys(input).length !== input.length + 1
  )
    return false;
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !guard(descriptor.value)
    )
      return false;
  }
  return true;
}

export function isApplicationBindingReference(
  input: unknown,
): input is ApplicationBindingReference {
  if (
    !record(input, [
      "deploymentId",
      "scopeId",
      "physicalLocator",
      "storageGeneration",
      "storageGenerationFence",
      "epoch",
      "authorizationRevocationEpoch",
      "activationSequence",
      "headSha256",
      "activationSha256",
      "revisionId",
      "schemaVersionId",
      "applicationSchemaSha256",
      "schemaManifestSha256",
      "readinessSha256",
      "readiness",
    ])
  )
    return false;
  if (
    !identity(input.deploymentId) ||
    !isScopeId(input.scopeId) ||
    !identity(input.revisionId) ||
    !identity(input.schemaVersionId) ||
    !isStoredPhysicalLocator(input.physicalLocator) ||
    input.storageGeneration !== "flarexdb_v1" ||
    !uint(input.storageGenerationFence) ||
    !isScopeEpoch(input.epoch) ||
    !uint(input.authorizationRevocationEpoch) ||
    !positive(input.activationSequence) ||
    !sha(input.headSha256) ||
    !sha(input.activationSha256) ||
    !sha(input.applicationSchemaSha256) ||
    !sha(input.schemaManifestSha256) ||
    !sha(input.readinessSha256)
  )
    return false;
  const readiness = input.readiness;
  if (record(readiness, ["kind", "manifestSchemaBindingSha256", "boundPublicationSha256",
    "relationFrontierCommitSeq", "relationSetReadinessSha256", "relationCount",
    "writePolicySetSha256", "writeOwnershipSha256"])) {
    return readiness.kind === "policy" && sha(readiness.writePolicySetSha256) && sha(readiness.writeOwnershipSha256) &&
      sha(readiness.manifestSchemaBindingSha256) && sha(readiness.boundPublicationSha256) &&
      uint(readiness.relationFrontierCommitSeq) && sha(readiness.relationSetReadinessSha256) &&
      typeof readiness.relationCount === "number" && Number.isSafeInteger(readiness.relationCount) && readiness.relationCount >= 0;
  }
  return record(readiness, ["kind", "schemaBindingSha256"])
    ? readiness.kind === "legacy" && sha(readiness.schemaBindingSha256)
    : record(readiness, [
        "kind",
        "manifestSchemaBindingSha256",
        "boundPublicationSha256",
        "relationFrontierCommitSeq",
        "relationSetReadinessSha256",
        "relationCount",
      ]) &&
        readiness.kind === "relation" &&
        sha(readiness.manifestSchemaBindingSha256) &&
        sha(readiness.boundPublicationSha256) &&
        uint(readiness.relationFrontierCommitSeq) &&
        sha(readiness.relationSetReadinessSha256) &&
        typeof readiness.relationCount === "number" &&
        Number.isSafeInteger(readiness.relationCount) &&
        readiness.relationCount >= 0;
}

export function isBindingProfileReference(
  input: unknown,
): input is BindingProfileReference {
  return (
    record(input, ["kind", "profileId", "contractSha256", "coverage"]) &&
    (input.kind === "adapter" ||
      input.kind === "query" ||
      input.kind === "store") &&
    identity(input.profileId) &&
    sha(input.contractSha256) &&
    arrayOf(input.coverage, MAX_BINDING_REQUIREMENTS, isCoverage)
  );
}
export function isPhysicalDataBinding(
  input: unknown,
): input is PhysicalDataBinding {
  if (
    !record(input, [
      "installation",
      "installationReceiptSha256",
      "readinessSha256",
      "availabilitySequence",
      "availabilityHistorySha256",
      "status",
      "profiles",
    ]) ||
    !isStoredInstallationIdentity(input.installation) ||
    !sha(input.installationReceiptSha256) ||
    !sha(input.readinessSha256) ||
    !positive(input.availabilitySequence) ||
    !sha(input.availabilityHistorySha256) ||
    input.status !== "ready" ||
    !arrayOf(input.profiles, 3, isBindingProfileReference)
  )
    return false;
  const kinds = input.profiles.map((profile) => profile.kind);
  const coverage = input.profiles.flatMap((profile) => profile.coverage);
  return (
    ((isStoredArtifactIdentity(input.installation.artifact) && input.installation.artifact.owner === "payload" && kinds.join(",") === "adapter") ||
      kinds.join(",") === "adapter,store" ||
      kinds.join(",") === "adapter,query,store") &&
    coverage.length <= MAX_BINDING_REQUIREMENTS &&
    new Set(
      coverage.map(
        (value) =>
          `${value.requirement.capability.owner}/${value.requirement.capability.lineageId}/${value.requirement.capability.capabilityId}`,
      ),
    ).size === coverage.length
  );
}
export function isSyntheticBindingReference(
  input: unknown,
): input is InstallationBindingReference {
  return (
    record(input, [
      "installation",
      "installationReceiptSha256",
      "readinessSha256",
      "availabilitySequence",
      "availabilityHistorySha256",
      "status",
    ]) &&
    isStoredInstallationIdentity(input.installation) &&
    sha(input.installationReceiptSha256) &&
    sha(input.readinessSha256) &&
    positive(input.availabilitySequence) &&
    sha(input.availabilityHistorySha256) &&
    input.status === "ready"
  );
}
function isContent(input: unknown): input is PayloadContentBinding {
  return (
    record(input, [
      "configSha256",
      "provenanceSha256",
      "application",
      "tables",
    ]) &&
    sha(input.configSha256) &&
    sha(input.provenanceSha256) &&
    isApplicationBindingReference(input.application) &&
    arrayOf(
      input.tables,
      MAX_BINDING_REQUIREMENTS,
      (table): table is PayloadContentBinding["tables"][number] =>
        record(table, ["tableId", "writePolicySha256"]) &&
        identity(table.tableId) &&
        sha(table.writePolicySha256),
    ) &&
    new Set(input.tables.map((table) => table.tableId)).size ===
      input.tables.length
  );
}
export function isDataBindingSetFrame(
  input: unknown,
): input is DataBindingSetFrame {
  if (
    !record(input, [
      "format",
      "application",
      "payloadContent",
      "payloadLifecycle",
      "commerce",
      "crossDomainReferences",
    ]) ||
    input.format !== "flarex.data-binding-set" ||
    !isApplicationBindingReference(input.application) ||
    !arrayOf(input.crossDomainReferences, 0, (_value): _value is never => false)
  )
    return false;
  if (
    input.payloadContent !== null &&
    (!isContent(input.payloadContent) ||
      !sameBindingValue(input.payloadContent.application, input.application))
  )
    return false;
  if (
    input.payloadLifecycle !== null &&
    (!isPhysicalDataBinding(input.payloadLifecycle) ||
      input.payloadLifecycle.installation.artifact.owner !== "payload")
  )
    return false;
  if (!arrayOf(input.commerce, MAX_COMMERCE_BINDINGS, isCommerceBinding)) return false;
  let previous = "";
  let profileCount = 0;
  for (const binding of input.commerce) {
    if (binding.installation.artifact.owner !== "medusa" || binding.installation.installationSha256 <= previous) return false;
    previous = binding.installation.installationSha256;
    profileCount += binding.profiles.length;
  }
  return profileCount <= MAX_COMMERCE_BINDINGS;
}
export function isDataBindingHeadToken(
  input: unknown,
): input is DataBindingHeadToken {
  return (
    record(input, ["sequence", "sha256"]) &&
    positive(input.sequence) &&
    sha(input.sha256)
  );
}
export function isDataBindingActivationRequest(
  input: unknown,
): input is DataBindingActivationRequest {
  return (
    record(input, [
      "format",
      "version",
      "scopeId",
      "storageGeneration",
      "requestId",
      "candidateSha256",
      "expectedHead",
    ]) &&
    input.format === "flarex.data-binding-activation-request" &&
    input.version === 1 &&
    identity(input.scopeId) &&
    input.storageGeneration === "flarexdb_v1" &&
    identity(input.requestId) &&
    sha(input.candidateSha256) &&
    (input.expectedHead === null || isDataBindingHeadToken(input.expectedHead))
  );
}
export function isDataBindingActivationFrame(
  input: unknown,
): input is DataBindingActivationFrame {
  return (
    record(input, [
      "format",
      "version",
      "request",
      "sequence",
      "activatedAt",
    ]) &&
    input.format === "flarex.data-binding-activation" &&
    input.version === 1 &&
    isDataBindingActivationRequest(input.request) &&
    positive(input.sequence) &&
    instant(input.activatedAt) &&
    BigInt(input.sequence) ===
      (input.request.expectedHead === null
        ? 1n
        : BigInt(input.request.expectedHead.sequence) + 1n)
  );
}
export function isDataBindingHeadFrame(
  input: unknown,
): input is DataBindingHeadFrame {
  return (
    record(input, [
      "format",
      "version",
      "scopeId",
      "storageGeneration",
      "sequence",
      "activationSha256",
      "candidateSha256",
    ]) &&
    input.format === "flarex.data-binding-head" &&
    input.version === 1 &&
    identity(input.scopeId) &&
    input.storageGeneration === "flarexdb_v1" &&
    positive(input.sequence) &&
    sha(input.activationSha256) &&
    sha(input.candidateSha256)
  );
}

/** Capture at the wire boundary; round-trip verification owns and freezes input. */
export const captureBindingValue = Effect.fn("DataBinding.captureValue")(
  function* <Frame extends JsonObject>(
    input: unknown,
    guard: (value: unknown) => value is Frame,
  ): Effect.fn.Return<PrivateCanonicalValueSnapshot<Frame>, DataBindingError> {
    const owned = yield* Effect.fromResult(capturePrivateJsonData(input, MAX_BINDING_BYTES, () => bindingError("invalidInput")));
    const decoded = yield* Effect.fromResult(decodeBindingFrame(owned.value, guard));
    const format = decoded.format;
    const captured = yield* capturePrivateCanonicalValue(
      decoded,
      MAX_BINDING_BYTES,
      {
        invalidInput: () => bindingError("invalidInput"),
        hashFailure: (cause) => bindingError("resourceFailure", cause),
      },
    );
    const frame = yield* restoreBindingValue(
      captured.copyCanonicalBytes(),
      captured.sha256Hex,
      format,
      guard,
    );
    return Object.freeze({ ...captured, frame });
  },
);
function decodeBindingFrame<Frame>(
  input: unknown,
  guard: (value: unknown) => value is Frame,
): Result.Result<Frame, DataBindingError> {
  try {
    return guard(input)
      ? Result.succeed(input)
      : Result.fail(bindingError("invalidInput"));
  } catch {
    // Reflection on unknown input may invoke throwing Proxy traps.
    return Result.fail(bindingError("invalidInput"));
  }
}
export const restoreBindingValue = Effect.fn("DataBinding.restoreValue")(
  function* <Frame extends JsonObject>(
    bytes: unknown,
    digest: unknown,
    format: unknown,
    guard: (value: unknown) => value is Frame,
  ): Effect.fn.Return<Frame, DataBindingError> {
    if (typeof format !== "string")
      return yield* Effect.fail(bindingError("storedCorruption"));
    const frame = yield* verifyStoredPrivateCanonicalValue(
      {
        canonicalBytes: bytes,
        sha256Hex: digest,
        expectedFormat: format,
        expectedVersion: format === "flarex.data-binding-set" ? null : 1,
        maximumCanonicalBytes: MAX_BINDING_BYTES,
        expectedKeys: undefined,
        validateFrame: guard,
      },
      {
        storedCorruption: () => bindingError("storedCorruption"),
        hashFailure: (cause) => bindingError("resourceFailure", cause),
      },
    );
    return guard(frame)
      ? frame
      : yield* Effect.fail(bindingError("storedCorruption"));
  },
);
