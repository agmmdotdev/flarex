import { Cause, Effect, Result, Schema } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { isNonArrayRecord } from "@flarex/utils/records";
import { getCommerceCommand, type CommerceCommand } from "../commerceTransaction/commands";
import type { LocalCommerceEventPolicy } from "../commerceTransaction/host";
import { requireCommerceProfile, type CommerceProfile, type CommerceProfileState } from "../commerceTransaction/profile";
import { commerceError, commerceLimits } from "../commerceTransaction/model";
import { projectCommerceRequestFailure } from "../commerceTransaction/request";
import { MAX_COMMERCE_BINDINGS, type InstallationBindingReference } from "../../installation/frameworkSchema/binding/model";
import { isSyntheticBindingReference, sameBindingValue } from "../../installation/frameworkSchema/binding/canonical";
import { validateCommerceProfileSet } from "../../installation/frameworkSchema/binding/commerceBinding";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { prepareInstallationRuntime, type PreparedInstallationRuntime } from "../../installation/frameworkSchema/installation/runtime";
import { chargeHostPreparation, captureHostPreparationLifetime, registerHostPreparationDisposal } from "../../execution/preparation/preparedHostRuntime";
import { prepareLogicalRelationalAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { prepareLogicalStorageReadiness, type PreparedLogicalStorageCatalog } from "../../storage/catalog/logicalStorageReadiness";
import type { LogicalSourceConstruction } from "../../storage/documents/logicalDocuments/sourceAdmission";
import { captureLogicalCommerceSelection, prepareLogicalCommerceContract, type LogicalCommerceSelectionInput } from "../commerceTransaction/logicalSelection";
import { captureCommerceResources, defaultCommerceResources, type CommerceResources } from "../commerceTransaction/resources";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FrameworkSchemaTarget } from "../../installation/frameworkSchema/target";
import { getAtomicCommerceParticipant, type AtomicCommerceParticipant } from "./commands";
import { captureParticipantEvents, type CommerceDerivedIdEvent, type ParticipantEventSelection } from "./events";
import type { LogicalCommerceLifecycleObservation, LogicalCommerceMutation,
  LogicalCommerceObservedRow, LogicalCommerceSetNull,
  LogicalCommerceReferenceReplacement, LogicalCommerceActivity } from "../commerceTransaction/logicalParticipant";
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
  setNull: readonly LogicalCommerceSetNull[],
  referenceReplacements?: readonly LogicalCommerceReferenceReplacement[])
  => Effect.Effect<void, ReturnType<typeof commerceError>>;

/** Immediate evidence for exactly one successful outer command. Ordinals start
 * at zero; observed rows are bodies used by this command, including cached
 * rereads, in their pending view at completion. Whole-root evidence remains
 * available separately through aggregate validation and settlement. Executed
 * complete relational selections retain exact query/count evidence even empty. */
export type LogicalCommerceCallValidation = (call: LogicalCommerceCallObservation,
  activity: LogicalCommerceActivity,
  /** Core supplies the executed authentic token, independently of its name. */
  command: CommerceCommand)
  => Effect.Effect<void, ReturnType<typeof commerceError>>;

interface AtomicCommerceParticipantBase {
  readonly participant: AtomicCommerceParticipant;
  readonly commands: readonly CommerceCommand[];
  /** Required for local profiles; all captured messages must match real facts. */
  readonly validate?: LocalCommerceEventPolicy["validate"];
  /** Validates the complete closed participant after all successful calls. If
   * per-call validation is also selected, both policies must accept. */
  readonly validateLogical?: LogicalCommerceEventValidation;
  /** Validates each successful outer call before it becomes aggregate evidence.
   * A refusal prevents aggregate validation and publication. */
  readonly validateLogicalCall?: LogicalCommerceCallValidation;
  readonly allowSetNull?: true;
  readonly allowReferenceReplacement?: true;
  readonly allowReconstitution?: true;
  /** Explicit logical conflict merge, retaining omitted deletion fields and
   * refreshing managed update time. Receipt validation is mandatory. */
  readonly allowPreservingDeletionUpsert?: true;
  /** Restore also updates already-active rows; logical receipt validation is mandatory. */
  readonly allowActiveRestoreUpdate?: true;
  /** Complete indexed selections may order by protected physical insertion generation. */
  readonly allowStorageInsertionOrder?: true;
  readonly derivedIdEvent?: CommerceDerivedIdEvent;
  readonly events?: ParticipantEventSelection;
}
export type AtomicCommerceParticipantInput = AtomicCommerceParticipantBase & (
  Readonly<{ profile: CommerceProfile; installation: InstallationBindingReference; logicalStorage?: never; logicalResources?: never; logicalPublication?: never }> |
  Readonly<{ logicalStorage: LogicalCommerceSelectionInput; logicalResources?: CommerceResources;
    /** Trusted mixed-packet publication within this source's existing identity budget. */
    logicalPublication?: "mixed" | undefined; profile?: never; installation?: never }>
);
export const isCommerceDefinitionName = (name: string) => /^[a-z][a-zA-Z0-9_-]{0,63}$/.test(name) && name !== "initialize";

function captureParticipant(member: AtomicCommerceParticipantInput, logicalPublication: "mixed" | undefined,
  allowReconstitution: true | undefined, allowPreservingDeletionUpsert: true | undefined, allowActiveRestoreUpdate: true | undefined, allowStorageInsertionOrder: true | undefined) {
  const logicalStorage = member.logicalStorage;
  if ((logicalPublication !== undefined || allowReconstitution === true || allowPreservingDeletionUpsert === true || allowActiveRestoreUpdate === true || allowStorageInsertionOrder === true) && logicalStorage === undefined)
    return Result.fail(commerceError("unsupportedProfile"));
  const derived = member.derivedIdEvent;
  return Result.succeed(Object.freeze({ factoryInput: member, participant: member.participant,
    commands: Object.freeze([...member.commands]), validate: member.validate, validateLogical: member.validateLogical,
    validateLogicalCall: member.validateLogicalCall,
    allowSetNull: member.allowSetNull, allowReferenceReplacement: member.allowReferenceReplacement, allowReconstitution, allowPreservingDeletionUpsert, allowActiveRestoreUpdate, allowStorageInsertionOrder,
    derivedIdEvent: derived === undefined ? undefined : Object.freeze({ contract: derived.contract }),
    events: captureParticipantEvents(member.events),
    ...(logicalStorage === undefined
      ? { kind: "physical" as const, profile: member.profile,
        reference: capturePrivateJsonData(member.installation, commerceLimits.rowBytes, commerceError) }
      : { kind: "logical" as const, logicalPublication, logical: captureLogicalCommerceSelection(logicalStorage),
        resources: member.logicalResources === undefined ? undefined : captureCommerceResources(member.logicalResources) }),
  }));
}
export type CapturedAtomicCommerceParticipants = readonly Result.Result.Success<ReturnType<typeof captureParticipant>>[];
const decodeLogicalPublication = Schema.decodeUnknownResult(Schema.UndefinedOr(Schema.Literal("mixed")));
const decodeReconstitution = Schema.decodeUnknownResult(Schema.UndefinedOr(Schema.Literal(true)));
const decodePreservingDeletionUpsert = Schema.decodeUnknownResult(Schema.UndefinedOr(Schema.Literal(true)));
const decodeActiveRestoreUpdate = Schema.decodeUnknownResult(Schema.UndefinedOr(Schema.Literal(true)));
const decodeStorageInsertionOrder = Schema.decodeUnknownResult(Schema.UndefinedOr(Schema.Literal(true)));
const preparedLogicalMembers = new WeakMap<object, Readonly<{ factory: AtomicCommerceParticipantInput;
  commands: readonly CommerceCommand[]; lifetime: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>> }>>();

/** The host takes ownership of every caller selection before any preparation
 * can yield to authority or catalog I/O. */
export function captureAtomicCommerceParticipants(input: readonly AtomicCommerceParticipantInput[]): Result.Result<CapturedAtomicCommerceParticipants, ReturnType<typeof commerceError>> {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_COMMERCE_BINDINGS)
    return Result.fail(commerceError("unsupportedProfile"));
  return Result.gen(function* () {
    const captured = [];
    for (const member of input) {
      const publication = yield* decodeLogicalPublication(member.logicalPublication)
        .pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
      const reconstitution = yield* decodeReconstitution(member.allowReconstitution)
        .pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
      const preservingDeletionUpsert = yield* decodePreservingDeletionUpsert(member.allowPreservingDeletionUpsert)
        .pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
      const activeRestoreUpdate = yield* decodeActiveRestoreUpdate(member.allowActiveRestoreUpdate)
        .pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
      const storageInsertionOrder = yield* decodeStorageInsertionOrder(member.allowStorageInsertionOrder)
        .pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
      captured.push(yield* captureParticipant(member, publication, reconstitution, preservingDeletionUpsert, activeRestoreUpdate, storageInsertionOrder));
    }
    return Object.freeze(captured);
  });
}

export const prepareAtomicCommerceParticipants = Effect.fn("AtomicCommerce.prepareParticipants")(function* (
  database: FlarexMetadataDatabase, target: FrameworkSchemaTarget, captured: CapturedAtomicCommerceParticipants,
  location: Readonly<{ deploymentId: string; scopeId: ScopeId }> | undefined,
  construction: LogicalSourceConstruction,
) {
  const lifetime = yield* captureHostPreparationLifetime();
  const names = new Set<string>();
  const installations = new Map<string, { reference: InstallationBindingReference; descriptors: readonly CommerceProfileState[] }>();
  const logicalSources = new Set<string>();
  const members = [];
  let definitions = 0;
  let catalog: PreparedLogicalStorageCatalog | undefined = construction.kind === "prepared" ? construction.catalog : undefined;
  for (const member of captured) {
    const events = yield* Effect.fromResult(member.events);
    const derivedIdEvent = member.derivedIdEvent;
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
      validateLogical: member.validateLogical, validateLogicalCall: member.validateLogicalCall, allowSetNull: member.allowSetNull,
      allowReferenceReplacement: member.allowReferenceReplacement, allowReconstitution: member.allowReconstitution,
      allowPreservingDeletionUpsert: member.allowPreservingDeletionUpsert, allowActiveRestoreUpdate: member.allowActiveRestoreUpdate, allowStorageInsertionOrder: member.allowStorageInsertionOrder, derivedIdEvent, events };
    if (member.kind === "logical") {
      const validated = member.validateLogical !== undefined || member.validateLogicalCall !== undefined;
      if (location === undefined || member.validate !== undefined ||
        (events !== undefined && !validated)
        || (member.allowSetNull === true && !validated)
        || (member.allowReconstitution === true && !validated)
        || (member.allowPreservingDeletionUpsert === true && !validated)
        || (member.allowActiveRestoreUpdate === true && !validated)
        || (member.allowStorageInsertionOrder === true && !validated)
        || (member.allowReferenceReplacement === true && (!validated ||
          derivedIdEvent === undefined || events === undefined ||
          !events.contracts.includes(derivedIdEvent.contract))) ||
        (derivedIdEvent !== undefined && member.allowReferenceReplacement !== true))
        return yield* Effect.fail(commerceError("unsupportedProfile"));
      const selection = yield* Effect.fromResult(member.logical);
      const resources = member.resources === undefined ? defaultCommerceResources :
        yield* Effect.fromResult(member.resources);
      if (resources.catalogRows > 2048 || resources.facts > 2048 || resources.writeBatchRows > 2048)
        return yield* Effect.fail(commerceError("unsupportedProfile"));
      const sourceKey = isNonArrayRecord(selection.source) ? selection.source.sourceKey : undefined;
      if (typeof sourceKey !== "string" || logicalSources.has(sourceKey)) return yield* Effect.fail(commerceError("invalidAuthority"));
      logicalSources.add(sourceKey);
      const contract = yield* prepareLogicalCommerceContract(selection);
      if (catalog === undefined) {
        const preparedCatalog = yield* prepareLogicalStorageReadiness(selection.ports, selection.unique, {
          ...location, schemaVersionId: selection.schemaVersionId,
        }, construction.kind === "standalone" ? construction.application : undefined).pipe(
          Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
        if (preparedCatalog.status !== "prepared") return yield* Effect.fail(commerceError("invalidAuthority"));
        catalog = preparedCatalog;
      }
      const prepared = yield* prepareLogicalRelationalAdmission(selection.ports, selection.unique, {
        ...location, schemaVersionId: selection.schemaVersionId,
      }, selection.source, { kind: "prepared", catalog }).pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
      yield* chargeHostPreparation({ sourceKey, contractSha256: contract.sha256Hex })
        .pipe(Effect.mapError(projectCommerceRequestFailure));
      const preparedMember = { ...common, kind: "logical" as const, sourceKey, contractSha256: contract.sha256Hex,
        logicalPublication: member.logicalPublication,
        descriptor: Object.freeze({ resources, contractSha256: contract.sha256Hex,
          initialization: selection.initialization }), prepared,
        selectedResources: member.resources === undefined ? undefined : resources };
      preparedLogicalMembers.set(preparedMember, { factory: member.factoryInput, commands: Object.freeze([...commands]), lifetime });
      yield* registerHostPreparationDisposal(() => { preparedLogicalMembers.delete(preparedMember); }).pipe(
        Effect.mapError(projectCommerceRequestFailure));
      members.push(preparedMember);
      continue;
    }
    const capturedReference = yield* Effect.fromResult(member.reference);
    if (!isSyntheticBindingReference(capturedReference.value)) return yield* Effect.fail(commerceError("invalidInput"));
    const reference = capturedReference.value;
    yield* chargeHostPreparation(reference).pipe(Effect.mapError(projectCommerceRequestFailure));
    if (member.profile === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
    const descriptor = yield* requireCommerceProfile(member.profile);
    if (member.validateLogical !== undefined || member.validateLogicalCall !== undefined || member.allowSetNull === true ||
      member.allowReferenceReplacement === true || member.allowReconstitution === true || member.allowPreservingDeletionUpsert === true || member.allowActiveRestoreUpdate === true || member.allowStorageInsertionOrder === true || derivedIdEvent !== undefined)
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
    if (member.kind === "logical") {
      return Object.freeze(member);
    }
    const digest = member.reference.installation.installationSha256;
    let installation = prepared.get(digest);
    if (installation === undefined) {
      installation = yield* prepareInstallationRuntime(database, target, member.reference).pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
      prepared.set(digest, installation);
    }
    return { ...member, prepared: installation };
  }));
});

export type PreparedAtomicCommerceLogicalParticipant = Extract<Effect.Success<ReturnType<typeof prepareAtomicCommerceParticipants>>[number],
  { readonly kind: "logical" }>;

/** Workflow borrowing consumes this factory's exact members, including source
 * descriptors; source-key or hash equality cannot reconstruct provenance. */
export const requirePreparedAtomicCommerceLogicalParticipant = (member: PreparedAtomicCommerceLogicalParticipant,
  expectedFactory: AtomicCommerceParticipantInput | undefined) => {
  const issued = preparedLogicalMembers.get(member);
  if (issued?.lifetime !== undefined && Result.isFailure(issued.lifetime.checkOpen())) return Result.fail(commerceError("invalidAuthority"));
  return issued !== undefined && (expectedFactory === undefined || issued.factory === expectedFactory) &&
    member.commands.size === issued.commands.length && issued.commands.every(command => member.commands.has(command))
    ? Result.succeed(member) : Result.fail(commerceError("invalidAuthority"));
};
