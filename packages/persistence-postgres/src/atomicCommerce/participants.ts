import { Effect } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { getCommerceCommand, type CommerceCommand } from "../commerceTransaction/commands";
import type { LocalCommerceEventPolicy } from "../commerceTransaction/host";
import { requireCommerceProfile, type CommerceProfile, type CommerceProfileState } from "../commerceTransaction/profile";
import { commerceError, commerceLimits } from "../commerceTransaction/model";
import { projectCommerceRequestFailure } from "../commerceTransaction/request";
import { MAX_COMMERCE_BINDINGS, type InstallationBindingReference } from "../frameworkSchema/binding/model";
import { isSyntheticBindingReference, sameBindingValue } from "../frameworkSchema/binding/canonical";
import { validateCommerceProfileSet } from "../frameworkSchema/binding/commerceBinding";
import { capturePrivateJsonData } from "../privateJsonData";
import { prepareInstallationRuntime, type PreparedInstallationRuntime } from "../frameworkSchema/installation/runtime";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FrameworkMigrationTarget } from "../migrationCoordination/targetSession";
import { getAtomicCommerceParticipant, type AtomicCommerceParticipant } from "./commands";
import { captureParticipantEvents, type ParticipantEventSelection } from "./events";

export interface AtomicCommerceParticipantInput {
  readonly participant: AtomicCommerceParticipant;
  readonly profile: CommerceProfile;
  readonly installation: InstallationBindingReference;
  readonly commands: readonly CommerceCommand[];
  /** Required for local profiles; all captured messages must match real facts. */
  readonly validate?: LocalCommerceEventPolicy["validate"];
  readonly events?: ParticipantEventSelection;
}
export const isCommerceDefinitionName = (name: string) => /^[a-z][a-zA-Z0-9_-]{0,63}$/.test(name) && name !== "initialize";

export const prepareAtomicCommerceParticipants = Effect.fn("AtomicCommerce.prepareParticipants")(function* (
  database: FlarexMetadataDatabase, target: FrameworkMigrationTarget, input: readonly AtomicCommerceParticipantInput[],
) {
  // Capture all configuration before the first asynchronous suspension.
  const captured = input.map(member => ({ ...member, commands: [...member.commands], events: captureParticipantEvents(member.events),
    reference: capturePrivateJsonData(member.installation, commerceLimits.rowBytes, commerceError) }));
  if (captured.length < 1 || captured.length > MAX_COMMERCE_BINDINGS) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const names = new Set<string>();
  const installations = new Map<string, { reference: InstallationBindingReference; descriptors: readonly CommerceProfileState[] }>();
  const members = [];
  let definitions = 0;
  for (const member of captured) {
    const events = yield* Effect.fromResult(member.events);
    const name = getAtomicCommerceParticipant(member.participant);
    if (name === undefined || !isCommerceDefinitionName(name) || names.has(name)) return yield* Effect.fail(commerceError("invalidAuthority"));
    names.add(name);
    const capturedReference = yield* Effect.fromResult(member.reference);
    if (!isSyntheticBindingReference(capturedReference.value)) return yield* Effect.fail(commerceError("invalidInput"));
    const reference = capturedReference.value;
    const descriptor = yield* requireCommerceProfile(member.profile);
    if (descriptor.localOnly !== (member.validate !== undefined)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    if (!sameBindingValue({ ...descriptor.artifact.identity }, reference.installation.artifact))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const installation = installations.get(reference.installation.installationSha256);
    if (installation !== undefined && !sameBindingValue(installation.reference, reference))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const descriptors = [...installation?.descriptors ?? [], descriptor];
    yield* validateCommerceProfileSet(descriptors).pipe(Effect.mapError(projectCommerceRequestFailure));
    installations.set(reference.installation.installationSha256, { reference, descriptors });
    const commands = new Set(member.commands);
    const commandNames = new Set<string>();
    for (const command of commands) {
      const definition = getCommerceCommand(command);
      if (definition === undefined || !isCommerceDefinitionName(definition.name) || commandNames.has(definition.name)) return yield* Effect.fail(commerceError("invalidAuthority"));
      commandNames.add(definition.name);
    }
    definitions += commands.size;
    if (commands.size === 0 || definitions > commerceLimits.commandDefinitions) return yield* Effect.fail(commerceError("limitExceeded"));
    members.push({ participant: member.participant, name, profile: member.profile, reference, descriptor, commands,
      commandNames: [...commandNames].toSorted(compareUtf16Strings), validate: member.validate, events });
  }
  // Admission proves one exact target namespace. Within that placement, this is
  // the same installation order as the binding owner's physical lane locks.
  const ordered = members.toSorted((a, b) => compareUtf16Strings(a.reference.installation.installationSha256, b.reference.installation.installationSha256) ||
    compareUtf16Strings(a.name, b.name));
  const prepared = new Map<string, PreparedInstallationRuntime>();
  return yield* Effect.forEach(ordered, Effect.fn(function* (member) {
    const digest = member.reference.installation.installationSha256;
    let installation = prepared.get(digest);
    if (installation === undefined) {
      installation = yield* prepareInstallationRuntime(database, target, member.reference).pipe(Effect.mapError(projectCommerceRequestFailure));
      prepared.set(digest, installation);
    }
    return { ...member, prepared: installation };
  }));
});
