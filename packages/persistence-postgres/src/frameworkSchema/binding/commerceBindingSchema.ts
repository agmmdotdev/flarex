import { Result, Schema } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { isStoredInstallationIdentity } from "../installation/storedValidation";
import { isStoredRelationalPhysicalCapability } from "../../relationalSchema/physical/storedValidation";
import { isExactPrivateValueRecord as record, isCanonicalPrivateValuePositiveInt64 } from "../privateStoredValueShape";
import { capturePrivateJsonData } from "../../privateJsonData";
import { MAX_BINDING_BYTES, MAX_BINDING_REQUIREMENTS, MAX_COMMERCE_BINDINGS, type BindingProfileReference, type InstallationBindingReference } from "./model";

export type BindingCoverage = BindingProfileReference["coverage"];

/** Reuse physical evidence's exact stored grammar, including its capability identity. */
export function isBindingCoverage(input: unknown): input is BindingCoverage[number] {
  if (!record(input, ["requirement", "physical"]) || !isStoredRelationalPhysicalCapability(input.physical) ||
    !record(input.requirement, ["capability", "requirement"])) return false;
  return input.requirement.requirement === input.physical.residualRequirement &&
    record(input.requirement.capability, ["owner", "lineageId", "capabilityId"]) &&
    input.requirement.capability.owner === input.physical.identity.owner &&
    input.requirement.capability.lineageId === input.physical.identity.lineageId &&
    input.requirement.capability.capabilityId === input.physical.identity.capabilityId;
}

export function compareBindingCoverage(left: BindingCoverage[number], right: BindingCoverage[number]): number {
  const a = left.requirement.capability;
  const b = right.requirement.capability;
  return compareUtf16Strings(a.owner, b.owner) || compareUtf16Strings(a.lineageId, b.lineageId) ||
    compareUtf16Strings(a.capabilityId, b.capabilityId);
}

const digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const profile = Schema.Struct({
  profileId: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_.-]{0,127}$/)),
  contractSha256: digest,
});
const CommerceBindingSchema = Schema.Struct({
  // The stored owner validates every nested identity and canonical digest; this is value data, not authority.
  installation: Schema.declare((input): input is InstallationBindingReference["installation"] => isStoredInstallationIdentity(input)),
  installationReceiptSha256: digest,
  readinessSha256: digest,
  availabilitySequence: Schema.String.check(Schema.makeFilter(isCanonicalPrivateValuePositiveInt64)),
  availabilityHistorySha256: digest,
  status: Schema.Literal("ready"),
  coverage: Schema.Array(Schema.declare(isBindingCoverage)).check(Schema.isMaxLength(MAX_BINDING_REQUIREMENTS)),
  profiles: Schema.Array(profile).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_COMMERCE_BINDINGS)),
}).check(Schema.makeFilter(binding => binding.profiles.every((item, index) =>
  index === 0 || compareUtf16Strings(binding.profiles[index - 1]?.profileId ?? "", item.profileId) < 0) &&
  binding.coverage.every((item, index) => {
    const previous = binding.coverage[index - 1];
    return previous === undefined || compareBindingCoverage(previous, item) < 0;
  })));

export type CommerceBinding = typeof CommerceBindingSchema.Type;
const decode = Schema.decodeUnknownResult(CommerceBindingSchema, { onExcessProperty: "error" });

/** The binding boundary first performs bounded no-getter capture; stored JSON is owned too. */
export function isCommerceBinding(input: unknown): input is CommerceBinding {
  return capturePrivateJsonData(input, MAX_BINDING_BYTES, () => false).pipe(
    Result.flatMap(captured => decode(captured.value)),
    Result.isSuccess,
  );
}
