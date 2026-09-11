import type { JsonObject } from "flarex-protocol/json";
import type {
  FrameworkSchemaInstallationIdentity,
  RelationalResidualRequirement,
} from "../installation/model";
import type { RelationalPhysicalCapabilityEvidence } from "../../relationalSchema/physical/model";
import type { PrivateCanonicalValueSnapshot } from "../privateCanonicalValue";

export const MAX_BINDING_BYTES = 1_048_576;
export const MAX_BINDING_REQUIREMENTS = 64;
export const MAX_COMMERCE_BINDINGS = 8;

import type { ApplicationBindingReference } from "../../applicationBindingProjection";
export type { ApplicationBindingReference } from "../../applicationBindingProjection";

export type BindingProfileReference = Readonly<{
  kind: "adapter" | "query" | "store";
  profileId: string;
  contractSha256: string;
  coverage: readonly Readonly<{
    requirement: RelationalResidualRequirement;
    physical: RelationalPhysicalCapabilityEvidence;
  }>[];
}> &
  JsonObject;

export type InstallationBindingReference = Readonly<{
  installation: FrameworkSchemaInstallationIdentity;
  installationReceiptSha256: string;
  readinessSha256: string;
  availabilitySequence: string;
  availabilityHistorySha256: string;
  status: "ready";
}> &
  JsonObject;
export type PhysicalDataBinding = InstallationBindingReference &
  Readonly<{ profiles: readonly BindingProfileReference[] }>;
export type { CommerceBinding } from "./commerceBindingSchema";
import type { CommerceBinding } from "./commerceBindingSchema";

export type PayloadContentBinding = Readonly<{
  configSha256: string;
  provenanceSha256: string;
  application: ApplicationBindingReference;
  tables: readonly Readonly<{ tableId: string; writePolicySha256: string }>[];
}> &
  JsonObject;

type DataBindingSetBase = Readonly<{
  format: "flarex.data-binding-set";
  application: ApplicationBindingReference;
  payloadContent: PayloadContentBinding | null;
  payloadLifecycle: PhysicalDataBinding | null;
  crossDomainReferences: readonly [];
}> &
  JsonObject;

/** Development-only predecessor encodings are deliberately not retained. */
export type DataBindingSetFrame = DataBindingSetBase & Readonly<{ commerce: readonly CommerceBinding[] }>;

export function commerceBindings(frame: DataBindingSetFrame): readonly CommerceBinding[] {
  return frame.commerce;
}

/** Select only installation evidence, never execution grants or coverage. */
export function bindingInstallationReference(binding: InstallationBindingReference): InstallationBindingReference {
  return { installation: binding.installation, installationReceiptSha256: binding.installationReceiptSha256,
    readinessSha256: binding.readinessSha256, availabilitySequence: binding.availabilitySequence,
    availabilityHistorySha256: binding.availabilityHistorySha256, status: binding.status };
}

export type DataBindingHeadToken = Readonly<{
  sequence: string;
  sha256: string;
}> &
  JsonObject;
export type DataBindingActivationRequest = Readonly<{
  format: "flarex.data-binding-activation-request";
  version: 1;
  scopeId: string;
  storageGeneration: string;
  requestId: string;
  candidateSha256: string;
  expectedHead: DataBindingHeadToken | null;
}> &
  JsonObject;
export type DataBindingActivationFrame = Readonly<{
  format: "flarex.data-binding-activation";
  version: 1;
  request: DataBindingActivationRequest;
  sequence: string;
  activatedAt: string;
}> &
  JsonObject;
export type DataBindingHeadFrame = Readonly<{
  format: "flarex.data-binding-head";
  version: 1;
  scopeId: string;
  storageGeneration: string;
  sequence: string;
  activationSha256: string;
  candidateSha256: string;
}> &
  JsonObject;
export type DataBindingCandidate =
  PrivateCanonicalValueSnapshot<DataBindingSetFrame>;
export type PhysicalBindingSlot = "payloadLifecycle" | "commerce";

export function physicalBindings(
  frame: DataBindingSetFrame,
): readonly (Readonly<{ slot: "payloadLifecycle"; binding: PhysicalDataBinding }> |
  Readonly<{ slot: "commerce"; binding: CommerceBinding }>)[] {
  return [
    ...(frame.payloadLifecycle === null
      ? []
      : [
          {
            slot: "payloadLifecycle" as const,
            binding: frame.payloadLifecycle,
          },
        ]),
    ...commerceBindings(frame).map(binding => ({ slot: "commerce" as const, binding })),
  ].toSorted((left, right) => {
    const a = left.binding.installation;
    const b = right.binding.installation;
    const keyA = `${a.targetNamespace.physicalDatabaseIdentity}/${a.targetNamespace.schemaName}/${a.artifact.owner}/${a.installationSha256}`;
    const keyB = `${b.targetNamespace.physicalDatabaseIdentity}/${b.targetNamespace.schemaName}/${b.artifact.owner}/${b.installationSha256}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
}
