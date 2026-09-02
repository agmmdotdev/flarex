import {
  isCanonicalPrivateValueInstant,
  isCanonicalPrivateValuePositiveInt64,
  isExactPrivateValueRecord,
  isPrivateValueSha256,
} from "../privateStoredValueShape";
import {
  isStoredArtifactIdentity,
  isStoredPhysicalLocator,
  isStoredTargetNamespace,
} from "../../migrationCoordination/storedValidation";
import {
  isStoredRelationalPhysicalCapability,
} from "../../relationalSchema/physical/storedValidation";
import { MAX_RELATIONAL_SCHEMA_CAPABILITIES } from
  "../../relationalSchema/policy";
import {
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
  FRAMEWORK_SCHEMA_INSTALLATION_FORMAT,
  FRAMEWORK_SCHEMA_INSTALLATION_VERSION,
  FRAMEWORK_SCHEMA_READINESS_FORMAT,
  FRAMEWORK_SCHEMA_READINESS_VERSION,
} from "./model";

export type StoredInstallationFrameKind =
  | "installation"
  | "readiness"
  | "availabilityHistory"
  | "availabilityHead";

export function isStoredInstallationFrame(
  kind: StoredInstallationFrameKind,
  input: unknown,
): boolean {
  switch (kind) {
    case "installation":
      return isInstallation(input);
    case "readiness":
      return isReadiness(input);
    case "availabilityHistory":
      return isAvailabilityHistory(input);
    case "availabilityHead":
      return isAvailabilityHead(input);
  }
}

export function isStoredInstallationIdentity(input: unknown): input is Readonly<{
  readonly artifact: unknown;
  readonly physicalLocator: unknown;
  readonly targetNamespace: unknown;
  readonly migrationPlanSha256: string;
  readonly installationSha256: string;
}> {
  return isExactPrivateValueRecord(input, [
    "artifact",
    "physicalLocator",
    "targetNamespace",
    "migrationPlanSha256",
    "installationSha256",
  ]) &&
    isStoredArtifactIdentity(input.artifact) &&
    isStoredPhysicalLocator(input.physicalLocator) &&
    isStoredTargetNamespace(input.targetNamespace) &&
    isPrivateValueSha256(input.migrationPlanSha256) &&
    isPrivateValueSha256(input.installationSha256) &&
    input.artifact.deploymentId === input.targetNamespace.deploymentId &&
    input.physicalLocator.schemaName === input.targetNamespace.schemaName;
}

function isInstallation(input: unknown): boolean {
  return isExactPrivateValueRecord(input, [
    "format",
    "version",
    "identity",
    "planAdmissionSha256",
    "terminalAttemptSha256",
    "installedStructureSha256",
    "installedPhysicalCapabilities",
    "installedAt",
  ]) &&
    input.format === FRAMEWORK_SCHEMA_INSTALLATION_FORMAT &&
    input.version === FRAMEWORK_SCHEMA_INSTALLATION_VERSION &&
    isStoredInstallationIdentity(input.identity) &&
    isPrivateValueSha256(input.planAdmissionSha256) &&
    isPrivateValueSha256(input.terminalAttemptSha256) &&
    isPrivateValueSha256(input.installedStructureSha256) &&
    isCapabilitySet(
      input.installedPhysicalCapabilities,
      input.identity.artifact,
    ) &&
    isCanonicalPrivateValueInstant(input.installedAt);
}

function isReadiness(input: unknown): boolean {
  if (!isExactPrivateValueRecord(input, [
    "format",
    "version",
    "installation",
    "installationReceiptSha256",
    "validationPolicy",
    "validationSha256",
    "validatedStructureSha256",
    "validatedPhysicalCapabilities",
    "residualRequirements",
    "validatedAt",
  ]) ||
    input.format !== FRAMEWORK_SCHEMA_READINESS_FORMAT ||
    input.version !== FRAMEWORK_SCHEMA_READINESS_VERSION ||
    !isStoredInstallationIdentity(input.installation) ||
    !isPrivateValueSha256(input.installationReceiptSha256) ||
    input.validationPolicy !==
      "relational-postgres-exact-candidate-structure" ||
    !isPrivateValueSha256(input.validationSha256) ||
    !isPrivateValueSha256(input.validatedStructureSha256) ||
    !isCapabilitySet(
      input.validatedPhysicalCapabilities,
      input.installation.artifact,
    ) ||
    !Array.isArray(input.residualRequirements) ||
    !isCanonicalPrivateValueInstant(input.validatedAt)) return false;
  if (input.residualRequirements.length !==
    input.validatedPhysicalCapabilities.length) return false;
  for (let index = 0; index < input.validatedPhysicalCapabilities.length;
    index += 1) {
    const capability = input.validatedPhysicalCapabilities[index];
    const residual = input.residualRequirements[index];
    if (!isExactPrivateValueRecord(capability, [
      "identity",
      "kind",
      ...capabilityPayloadKeys(capability),
    ]) ||
      !isExactPrivateValueRecord(capability.identity, [
        "owner", "lineageId", "capabilityId",
      ]) ||
      !isExactPrivateValueRecord(residual, ["capability", "requirement"]) ||
      !isExactPrivateValueRecord(residual.capability, [
        "owner", "lineageId", "capabilityId",
      ]) ||
      residual.capability.owner !== capability.identity.owner ||
      residual.capability.lineageId !== capability.identity.lineageId ||
      residual.capability.capabilityId !== capability.identity.capabilityId ||
      residual.requirement !== capability.residualRequirement) return false;
  }
  return true;
}

function isAvailabilityHistory(input: unknown): boolean {
  if (!isExactPrivateValueRecord(input, [
    "format",
    "version",
    "installation",
    "readinessSha256",
    "availabilitySequence",
    "previousAvailability",
    "status",
    "reasonSha256",
    "recordedAt",
  ]) ||
    input.format !== FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT ||
    input.version !== FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION ||
    !isStoredInstallationIdentity(input.installation) ||
    !isPrivateValueSha256(input.readinessSha256) ||
    !isCanonicalPrivateValuePositiveInt64(input.availabilitySequence) ||
    !isAvailabilityStatus(input.status) ||
    !isCanonicalPrivateValueInstant(input.recordedAt)) return false;
  const first = input.availabilitySequence === "1";
  if (first) {
    return input.previousAvailability === null &&
      input.status === "ready" && input.reasonSha256 === null;
  }
  if (!isAvailabilityToken(input.previousAvailability) ||
    BigInt(input.previousAvailability.availabilitySequence) + 1n !==
      BigInt(input.availabilitySequence) ||
    input.previousAvailability.status === input.status) return false;
  return input.status === "ready"
    ? input.reasonSha256 === null
    : isPrivateValueSha256(input.reasonSha256);
}

function isAvailabilityHead(input: unknown): boolean {
  return isExactPrivateValueRecord(input, [
    "format",
    "version",
    "installation",
    "readinessSha256",
    "availabilitySequence",
    "historySha256",
    "status",
  ]) &&
    input.format === FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT &&
    input.version === FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION &&
    isStoredInstallationIdentity(input.installation) &&
    isPrivateValueSha256(input.readinessSha256) &&
    isCanonicalPrivateValuePositiveInt64(input.availabilitySequence) &&
    isPrivateValueSha256(input.historySha256) &&
    isAvailabilityStatus(input.status);
}

function isAvailabilityToken(input: unknown): input is Readonly<{
  readonly availabilitySequence: string;
  readonly status: string;
}> {
  return isExactPrivateValueRecord(input, [
    "availabilitySequence", "historySha256", "status",
  ]) &&
    isCanonicalPrivateValuePositiveInt64(input.availabilitySequence) &&
    isPrivateValueSha256(input.historySha256) &&
    isAvailabilityStatus(input.status);
}

function isCapabilitySet(
  input: unknown,
  artifact: unknown,
): input is readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(input) ||
    input.length > MAX_RELATIONAL_SCHEMA_CAPABILITIES ||
    !input.every(isStoredRelationalPhysicalCapability) ||
    !isStoredArtifactIdentity(artifact)) return false;
  let previous: string | undefined;
  for (const capability of input) {
    if (!isExactPrivateValueRecord(capability, [
      "identity",
      "kind",
      ...capabilityPayloadKeys(capability),
    ]) || !isExactPrivateValueRecord(capability.identity, [
      "owner", "lineageId", "capabilityId",
    ]) || typeof capability.identity.capabilityId !== "string" ||
      !embeddedCoordinatesMatch(capability, artifact.owner, artifact.lineageId) ||
      (previous !== undefined &&
        previous >= capability.identity.capabilityId)) return false;
    previous = capability.identity.capabilityId;
  }
  return true;
}

function embeddedCoordinatesMatch(
  input: unknown,
  owner: "system" | "medusa",
  lineageId: string,
): boolean {
  const pending: unknown[] = [input];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    try {
      const nestedOwner = Object.getOwnPropertyDescriptor(
        current,
        "owner",
      )?.value;
      const nestedLineage = Object.getOwnPropertyDescriptor(
        current,
        "lineageId",
      )?.value;
      if ((nestedOwner !== undefined || nestedLineage !== undefined) &&
        (nestedOwner !== owner || nestedLineage !== lineageId)) return false;
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string") return false;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !("value" in descriptor)) return false;
        pending.push(descriptor.value);
      }
    } catch {
      return false;
    }
  }
  return true;
}

function capabilityPayloadKeys(
  input: Readonly<Record<string, unknown>>,
): readonly string[] {
  switch (input.kind) {
    case "searchableText":
      return ["columns", "residualRequirement"];
    case "exactNumericCompanion":
      return [
        "numericColumn", "rawColumn", "matchingNullability",
        "numericDefault", "rawDefault", "residualRequirement",
      ];
    case "managedTimestamps":
      return [
        "createdAtColumn", "updatedAtColumn", "databaseCurrentDefaults",
        "residualRequirement",
      ];
    case "softDelete":
      return [
        "deletedAtColumn", "activeRowsIndex", "activeRowsIndexName",
        "residualRequirement",
      ];
    default:
      return [];
  }
}

function isAvailabilityStatus(input: unknown): input is string {
  return input === "ready" || input === "withdrawn" ||
    input === "superseded" || input === "quarantined";
}
