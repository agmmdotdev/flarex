import { Effect, Result } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { isNonArrayRecord } from "@flarex/utils/records";
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
import { chargeHostPreparation } from "../preparedHostRuntime";
import { prepareLogicalRelationalAdmission } from "../logicalDocuments/relationalAdmission";
import { captureLogicalCommerceSelection, prepareLogicalCommerceContract, type LogicalCommerceSelectionInput } from "../commerceTransaction/logicalSelection";
import { defaultCommerceResources } from "../commerceTransaction/resources";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FrameworkSchemaTarget } from "../frameworkSchema/target";
import { getAtomicCommerceParticipant, type AtomicCommerceParticipant } from "./commands";
import { captureParticipantEvents, type ParticipantEventSelection } from "./events";
import type { LogicalCommerceLifecycleObservation, LogicalCommerceMutation,
  LogicalCommerceObservedRow, LogicalCommerceSetNull } from "../commerceTransaction/logicalParticipant";
import type { Json } from "flarex-protocol/json";

export interface LogicalCommerceCallObservation {
  readonly commandName: string;
  readonly mode: "read" | "write";
  readonly input: Json;
  readonly result: Json;
  readonly events: readonly Json[];
  readonly fromAttempt: number;
  readonly toAttempt: number;
  readonly fromLifecycle: number;
  readonly toLifecycle: number;
}
export type LogicalCommerceEventValidation = (calls: readonly LogicalCommerceCallObservation[],
  mutations: readonly LogicalCommerceMutation[],
  lifecycle: readonly LogicalCommerceLifecycleObservation[],
  observedRows: readonly LogicalCommerceObservedRow[],
  setNull: readonly LogicalCommerceSetNull[])
  => Effect.Effect<void, ReturnType<typeof commerceError>>;

interface AtomicCommerceParticipantBase {
  readonly participant: AtomicCommerceParticipant;
  readonly commands: readonly CommerceCommand[];
  /** Required for local profiles; all captured messages must match real facts. */
  readonly validate?: LocalCommerceEventPolicy["validate"];
  readonly validateLogical?: LogicalCommerceEventValidation;
  readonly allowSetNull?: true;
  readonly events?: ParticipantEventSelection;
}
export type AtomicCommerceParticipantInput = AtomicCommerceParticipantBase & (
  Readonly<{ profile: CommerceProfile; installation: InstallationBindingReference; logicalStorage?: never }> |
  Readonly<{ logicalStorage: LogicalCommerceSelectionInput; profile?: never; installation?: never }>
);
export const isCommerceDefinitionName = (name: string) => /^[a-z][a-zA-Z0-9_-]{0,63}$/.test(name) && name !== "initialize";

function captureParticipant(member: AtomicCommerceParticipantInput) {
  return Object.freeze({ participant: member.participant,
    commands: Object.freeze([...member.commands]), validate: member.validate, validateLogical: member.validateLogical,
    allowSetNull: member.allowSetNull,
    events: captureParticipantEvents(member.events),
    ...(member.logicalStorage === undefined
      ? { kind: "physical" as const, profile: member.profile,
        reference: capturePrivateJsonData(member.installation, commerceLimits.rowBytes, commerceError) }
      : { kind: "logical" as const, logical: captureLogicalCommerceSelection(member.logicalStorage) }),
  });
}
export type CapturedAtomicCommerceParticipants = readonly ReturnType<typeof captureParticipant>[];

/** The host takes ownership of every caller selection before any preparation
 * can yield to authority or catalog I/O. */
export function captureAtomicCommerceParticipants(input: readonly AtomicCommerceParticipantInput[]): Result.Result<CapturedAtomicCommerceParticipants, ReturnType<typeof commerceError>> {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_COMMERCE_BINDINGS)
    return Result.fail(commerceError("unsupportedProfile"));
  return Result.succeed(Object.freeze(input.map(captureParticipant)));
}

export const prepareAtomicCommerceParticipants = Effect.fn("AtomicCommerce.prepareParticipants")(function* (
  database: FlarexMetadataDatabase, target: FrameworkSchemaTarget, captured: CapturedAtomicCommerceParticipants,
  location?: Readonly<{ deploymentId: string; scopeId: ScopeId }>,
) {
  const names = new Set<string>();
  const installations = new Map<string, { reference: InstallationBindingReference; descriptors: readonly CommerceProfileState[] }>();
  const logicalSources = new Set<string>();
  const members = [];
  let definitions = 0;
  for (const member of captured) {
    const events = yield* Effect.fromResult(member.events);
    const name = getAtomicCommerceParticipant(member.participant);
    if (name === undefined || !isCommerceDefinitionName(name) || names.has(name)) return yield* Effect.fail(commerceError("invalidAuthority"));
    names.add(name);
    const commands = new Set(member.commands);
    const commandNames = new Set<string>();
    for (const command of commands) {
      const definition = getCommerceCommand(command);
      if (definition === undefined || !isCommerceDefinitionName(definition.name) || commandNames.has(definition.name)) return yield* Effect.fail(commerceError("invalidAuthority"));
      commandNames.add(definition.name);
    }
    definitions += commands.size;
    if (commands.size === 0 || definitions > commerceLimits.commandDefinitions) return yield* Effect.fail(commerceError("limitExceeded"));
    yield* chargeHostPreparation({ name, commandNames: [...commandNames], eventContracts: events?.contracts ?? [] })
      .pipe(Effect.mapError(projectCommerceRequestFailure));
    const common = { participant: member.participant, name, commands,
      commandNames: [...commandNames].toSorted(compareUtf16Strings), validate: member.validate,
      validateLogical: member.validateLogical, allowSetNull: member.allowSetNull, events };
    if (member.kind === "logical") {
      if (location === undefined || member.validate !== undefined || (events !== undefined && member.validateLogical === undefined)
        || (member.allowSetNull === true && member.validateLogical === undefined))
        return yield* Effect.fail(commerceError("unsupportedProfile"));
      const selection = yield* Effect.fromResult(member.logical);
      const sourceKey = isNonArrayRecord(selection.source) ? selection.source.sourceKey : undefined;
      if (typeof sourceKey !== "string" || logicalSources.has(sourceKey)) return yield* Effect.fail(commerceError("invalidAuthority"));
      logicalSources.add(sourceKey);
      const contract = yield* prepareLogicalCommerceContract(selection);
      const prepared = yield* prepareLogicalRelationalAdmission(selection.ports, selection.unique, {
        ...location, schemaVersionId: selection.schemaVersionId,
      }, selection.source).pipe(Effect.mapError(projectCommerceRequestFailure));
      yield* chargeHostPreparation({ sourceKey, contractSha256: contract.sha256Hex })
        .pipe(Effect.mapError(projectCommerceRequestFailure));
      members.push({ ...common, kind: "logical" as const, sourceKey, contractSha256: contract.sha256Hex,
        descriptor: { resources: defaultCommerceResources, contractSha256: contract.sha256Hex,
          initialization: selection.initialization }, prepared });
      continue;
    }
    const capturedReference = yield* Effect.fromResult(member.reference);
    if (!isSyntheticBindingReference(capturedReference.value)) return yield* Effect.fail(commerceError("invalidInput"));
    const reference = capturedReference.value;
    yield* chargeHostPreparation(reference).pipe(Effect.mapError(projectCommerceRequestFailure));
    const descriptor = yield* requireCommerceProfile(member.profile);
    if (member.validateLogical !== undefined || member.allowSetNull === true)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    if (descriptor.localOnly !== (member.validate !== undefined)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    if (!sameBindingValue({ ...descriptor.artifact.identity }, reference.installation.artifact))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const installation = installations.get(reference.installation.installationSha256);
    if (installation !== undefined && !sameBindingValue(installation.reference, reference))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const descriptors = [...installation?.descriptors ?? [], descriptor];
    yield* validateCommerceProfileSet(descriptors).pipe(Effect.mapError(projectCommerceRequestFailure));
    installations.set(reference.installation.installationSha256, { reference, descriptors });
    members.push({ ...common, kind: "physical" as const, profile: member.profile, reference, descriptor });
  }
  // Logical structural admission precedes physical installation publication
  // locks. Physical members retain the binding owner's installation order.
  const ordered = members.toSorted((a, b) => compareUtf16Strings(
    a.kind === "logical" ? `0:${a.contractSha256}` : `1:${a.reference.installation.installationSha256}`,
    b.kind === "logical" ? `0:${b.contractSha256}` : `1:${b.reference.installation.installationSha256}`) ||
    compareUtf16Strings(a.name, b.name));
  const prepared = new Map<string, PreparedInstallationRuntime>();
  return yield* Effect.forEach(ordered, Effect.fn(function* (member) {
    if (member.kind === "logical") return member;
    const digest = member.reference.installation.installationSha256;
    let installation = prepared.get(digest);
    if (installation === undefined) {
      installation = yield* prepareInstallationRuntime(database, target, member.reference).pipe(Effect.mapError(projectCommerceRequestFailure));
      prepared.set(digest, installation);
    }
    return { ...member, prepared: installation };
  }));
});
