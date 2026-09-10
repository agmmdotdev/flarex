import { Effect } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { getCommerceCommand, type CommerceCommand } from "../commerceTransaction/commands";
import type { LocalCommerceEventPolicy } from "../commerceTransaction/host";
import { requireCommerceProfile, type CommerceProfile } from "../commerceTransaction/profile";
import { commerceError, commerceLimits } from "../commerceTransaction/model";
import { projectCommerceRequestFailure } from "../commerceTransaction/request";
import { MAX_COMMERCE_BINDINGS, type InstallationBindingReference } from "../frameworkSchema/binding/model";
import { isSyntheticBindingReference } from "../frameworkSchema/binding/canonical";
import { capturePrivateJsonData } from "../privateJsonData";
import { prepareInstallationRuntime } from "../frameworkSchema/installation/runtime";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FrameworkMigrationTarget } from "../migrationCoordination/targetSession";
import { getAtomicCommerceParticipant, type AtomicCommerceParticipant } from "./commands";
import type { CommerceEventContract } from "./events";

export interface AtomicCommerceParticipantInput {
  readonly participant: AtomicCommerceParticipant;
  readonly profile: CommerceProfile;
  readonly installation: InstallationBindingReference;
  readonly commands: readonly CommerceCommand[];
  /** Required for local profiles; all captured messages must match real facts. */
  readonly validate?: LocalCommerceEventPolicy["validate"];
  readonly eventContract?: CommerceEventContract;
}
export const isCommerceDefinitionName = (name: string) => /^[a-z][a-zA-Z0-9_-]{0,63}$/.test(name) && name !== "initialize";

export const prepareAtomicCommerceParticipants = Effect.fn("AtomicCommerce.prepareParticipants")(function* (
  database: FlarexMetadataDatabase, target: FrameworkMigrationTarget, input: readonly AtomicCommerceParticipantInput[],
) {
  // Capture all configuration before the first asynchronous suspension.
  const captured = input.map(member => ({ ...member, commands: [...member.commands],
    reference: capturePrivateJsonData(member.installation, commerceLimits.rowBytes, commerceError) }));
  if (captured.length < 2 || captured.length > MAX_COMMERCE_BINDINGS) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const names = new Set<string>();
  const installations = new Set<string>();
  const members = [];
  let definitions = 0;
  for (const member of captured) {
    const name = getAtomicCommerceParticipant(member.participant);
    if (name === undefined || !isCommerceDefinitionName(name) || names.has(name)) return yield* Effect.fail(commerceError("invalidAuthority"));
    names.add(name);
    const capturedReference = yield* Effect.fromResult(member.reference);
    if (!isSyntheticBindingReference(capturedReference.value)) return yield* Effect.fail(commerceError("invalidInput"));
    const reference = capturedReference.value;
    if (installations.has(reference.installation.installationSha256)) return yield* Effect.fail(commerceError("invalidAuthority"));
    installations.add(reference.installation.installationSha256);
    const descriptor = yield* requireCommerceProfile(member.profile);
    if (descriptor.localOnly !== (member.validate !== undefined)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const commands = new Set(member.commands);
    const commandNames = new Set<string>();
    for (const command of commands) {
      const definition = getCommerceCommand(command);
      if (definition === undefined || !isCommerceDefinitionName(definition.name) || commandNames.has(definition.name)) return yield* Effect.fail(commerceError("invalidAuthority"));
      commandNames.add(definition.name);
    }
    definitions += commands.size;
    if (commands.size === 0 || definitions > commerceLimits.commandDefinitions) return yield* Effect.fail(commerceError("limitExceeded"));
    const prepared = yield* prepareInstallationRuntime(database, target, reference).pipe(Effect.mapError(projectCommerceRequestFailure));
    members.push({ participant: member.participant, name, profile: member.profile, reference, descriptor, commands,
      commandNames: [...commandNames].toSorted(compareUtf16Strings), prepared, validate: member.validate, eventContract: member.eventContract });
  }
  // Admission proves one exact target namespace. Within that placement, this is
  // the same installation order as the binding owner's physical lane locks.
  return members.toSorted((a, b) => compareUtf16Strings(a.reference.installation.installationSha256, b.reference.installation.installationSha256));
});
