import { Cause, Effect, Result, Schema } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CoreDatabase, CoreNativeRootRecoveryInput } from "../../core/api";
import { CORE_TRANSACTION_REFERENCE_LIMITS } from "../../core/accounting";
import { requireCoreNativeDefinition, type CoreNativeDefinition } from "../../core/nativePolicy";
import type { CoreSchemaBundle } from "../../core/schemaBundle";
import type { PreparedHostRuntime } from "../../execution/preparation/preparedHostRuntime";
import { chargeHostPreparation } from "../../execution/preparation/preparedHostRuntime";
import { CommerceCallLimit, CommerceCommandByteLimit, FrameworkCommandMilliseconds } from "../../execution/preparation/frameworkExecutionPolicy";
import { captureCommerceJsonData } from "../commerceTransaction/json";
import { getCommerceCommand, type CommerceCommand } from "../commerceTransaction/commands";
import type { CommerceInitialization } from "../commerceTransaction/initializationContract";
import { commerceError, commerceLimits } from "../commerceTransaction/model";
import { projectCoreCommerceFailure } from "../commerceTransaction/nativeFailure";
import { captureCommerceResources, defaultCommerceResources } from "../commerceTransaction/resources";
import { getAtomicCommerceCommand, getAtomicCommerceParticipant, isCommerceDefinitionName } from "./commands";
import type { AtomicCommerceHostInput } from "./configuration";
import type { AtomicCommerceParticipantBase } from "./participants";
import { captureParticipantEvents, captureAtomicCommerceEvents, prepareAtomicCommerceEvents, admitParticipantEvents, isCommerceDerivedIdEventContract } from "./events";
import { atomicCommerceNativeSourceIdentity, type AtomicCommerceNativeSource } from "./nativeSelection";
import { coreNativeEventStorage } from "../../commit/events/coreDefinition";
import { CORE_NATIVE_EVENT_WRITE, coreNativeEventLimits } from "../../commit/events/coreDefinition";
import { commitEventLimits } from "../../commit/events/model";
import { LogicalInsertValidation, LogicalSetNullPolicy } from "../../storage/documents/logicalDocuments/model";

export interface AtomicCommerceNativeSourceInput {
  readonly source: AtomicCommerceNativeSource;
  readonly definition: CoreNativeDefinition;
  readonly initialization: CommerceInitialization;
}
export type AtomicCommerceNativeParticipantInput = AtomicCommerceParticipantBase & Readonly<{
  nativeStorage: AtomicCommerceNativeSource;
  logicalResources?: typeof defaultCommerceResources;
  logicalPublication?: "mixed";
}>;
export type AtomicCommerceNativeHostInput = Pick<AtomicCommerceHostInput<never>,
  "participants" | "commands" | "events" | "identityAndAccessPolicy" | "requestParticipantLimit" | "requestCallLimit"
  | "requestByteLimit" | "requestEventLimit" | "requestCommandMs" | "executionIsolation" | "operationScheduling"
  | "borrowedOperationScheduling" | "taskControlCommands"> & Readonly<{
  database: CoreDatabase;
  bundle: CoreSchemaBundle;
  hostRuntime: PreparedHostRuntime;
  sources: readonly AtomicCommerceNativeSourceInput[];
  eventStorage?: Readonly<{ definition: CoreNativeDefinition }>;
}>;
export type AtomicCommerceNativeProfileInput = Omit<AtomicCommerceNativeHostInput, "database" | "hostRuntime">;
export type AtomicCommerceNativeGenerationInput = Pick<AtomicCommerceNativeHostInput, "database" | "hostRuntime">;

const Limits = Schema.Struct({ calls: CommerceCallLimit, commandBytes: CommerceCommandByteLimit, commandMs: FrameworkCommandMilliseconds,
  eventLimit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: commitEventLimits.messages })),
  participantLimit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 19 })),
  operationScheduling: Schema.UndefinedOr(Schema.Literal("queued")), borrowedOperationScheduling: Schema.UndefinedOr(Schema.Literal("queued")),
});
const decodeLimits = Schema.decodeUnknownResult(Limits);
const Invocation = Schema.Struct({
  allowReferenceReplacement: Schema.UndefinedOr(Schema.Literal(true)),
  setNullPolicy: Schema.UndefinedOr(LogicalSetNullPolicy),
  allowActiveRestoreUpdate: Schema.UndefinedOr(Schema.Literal(true)),
  allowStorageInsertionOrder: Schema.UndefinedOr(Schema.Literal(true)),
  allowRecordedRowReplay: Schema.UndefinedOr(Schema.Literal(true)),
  allowPreservingDeletionUpsert: Schema.UndefinedOr(Schema.Literal("preserveTimestamps")),
  allowReferenceCheckpoints: Schema.UndefinedOr(Schema.Literal(true)),
  insertValidation: Schema.UndefinedOr(LogicalInsertValidation),
});
const decodeInvocation = Schema.decodeUnknownResult(Invocation, { onExcessProperty: "error" });
const decodePublication = Schema.decodeUnknownResult(Schema.UndefinedOr(Schema.Literal("mixed")));
const decodeIsolation = Schema.decodeUnknownResult(Schema.UndefinedOr(Schema.Literal("scopeExclusive")));
const invocationPolicy = (member: typeof Invocation.Type) => Object.freeze({
  ...(member.allowReferenceReplacement === true ? { allowReferenceReplacement: true as const } : {}),
  ...(member.setNullPolicy === undefined ? {} : { setNullPolicy: Object.freeze({ ...member.setNullPolicy }) }),
  ...(member.allowActiveRestoreUpdate === true ? { allowActiveRestoreUpdate: true as const } : {}),
  ...(member.allowStorageInsertionOrder === true ? { allowStorageInsertionOrder: true as const } : {}),
  ...(member.allowRecordedRowReplay === true ? { allowRecordedRowReplay: true as const } : {}),
  ...(member.allowPreservingDeletionUpsert === undefined ? {} : { allowPreservingDeletionUpsert: member.allowPreservingDeletionUpsert }),
  ...(member.allowReferenceCheckpoints === true ? { allowReferenceCheckpoints: true as const } : {}),
  ...(member.insertValidation === undefined ? {} : { insertValidation: member.insertValidation }),
});

/** Take ownership before authority or preparation can suspend. Sources are
 * semantic selectors; the local trusted whitelist supplies every live grant. */
export function captureAtomicCommerceNativeConfiguration(input: AtomicCommerceNativeProfileInput) {
  const sources = input.sources.map(source => Object.freeze({ ...source, initialization: Object.freeze({ ...source.initialization }) }));
  const participants = input.participants.map(member => Object.freeze({ ...member, commands: Object.freeze([...member.commands]),
    ...(member.logicalResources === undefined ? {} : { logicalResources: Object.freeze({ ...member.logicalResources }) }),
    ...(member.setNullPolicy === undefined ? {} : { setNullPolicy: Object.freeze({ ...member.setNullPolicy }) }),
    ...(member.derivedIdEvent === undefined ? {} : { derivedIdEvent: Object.freeze({ ...member.derivedIdEvent }) }),
    events: captureParticipantEvents(member.events) }));
  return Object.freeze({ bundle: input.bundle, sources: Object.freeze(sources), participants: Object.freeze(participants),
    commands: Object.freeze([...input.commands]), eventStorage: input.eventStorage === undefined ? undefined : Object.freeze({ ...input.eventStorage }),
    eventPolicy: input.events === undefined ? undefined : captureAtomicCommerceEvents(input.events),
    policy: captureCommerceJsonData(input.identityAndAccessPolicy, commerceLimits.commandBytes),
    selectedLimits: Object.freeze({ participants: input.requestParticipantLimit ?? null, calls: input.requestCallLimit ?? null,
      commandBytes: input.requestByteLimit ?? null, eventLimit: input.requestEventLimit ?? null, commandMs: input.requestCommandMs ?? null }),
    unsupported: input.taskControlCommands !== undefined,
    executionIsolation: decodeIsolation(input.executionIsolation),
    limits: decodeLimits({ calls: input.requestCallLimit ?? commerceLimits.calls,
      commandBytes: input.requestByteLimit ?? commerceLimits.commandBytes, commandMs: input.requestCommandMs ?? commerceLimits.commandMs,
      eventLimit: input.requestEventLimit ?? defaultCommerceResources.eventMessages, participantLimit: input.requestParticipantLimit ?? 8,
      operationScheduling: input.operationScheduling, borrowedOperationScheduling: input.borrowedOperationScheduling }),
  });
}

export const prepareAtomicCommerceNativeConfiguration = Effect.fn("AtomicCommerceNative.prepareConfiguration")(function* (
  captured: ReturnType<typeof captureAtomicCommerceNativeConfiguration> & AtomicCommerceNativeGenerationInput,
) {
  const limits = Object.freeze(yield* Effect.fromResult(captured.limits.pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)))));
  const executionIsolation = yield* Effect.fromResult(captured.executionIsolation.pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause))));
  if (captured.unsupported || limits.borrowedOperationScheduling !== undefined && limits.operationScheduling !== "queued"
    || captured.participants.length === 0 || captured.participants.length > limits.participantLimit)
    return yield* commerceError("unsupportedProfile");
  const policy = yield* Effect.fromResult(captured.policy);
  const eventPolicy = captured.eventPolicy === undefined ? undefined
    : yield* prepareAtomicCommerceEvents(yield* Effect.fromResult(captured.eventPolicy));
  if (eventPolicy !== undefined && captured.eventStorage === undefined) return yield* commerceError("invalidAuthority");
  if (captured.eventStorage !== undefined && (yield* Effect.fromResult(coreNativeEventStorage(captured.eventStorage.definition)
    .pipe(Result.mapError(cause => commerceError("invalidAuthority", cause))))).mode !== "rootBound")
    return yield* commerceError("invalidAuthority");
  const sourceNames = new Set<string>();
  for (const source of captured.sources) {
    yield* Effect.fromResult(requireCoreNativeDefinition(source.definition).pipe(Result.mapError(projectCoreCommerceFailure)));
    const selection = atomicCommerceNativeSourceIdentity(source.source);
    if (selection === undefined || sourceNames.has(selection.name)) return yield* commerceError("invalidAuthority");
    sourceNames.add(selection.name);
  }
  const names = new Set<string>(), tokens = new Set<object>(), selectedSources = new Set<string>();
  let commandDefinitions = 0;
  const members = [];
  for (const member of captured.participants) {
    const name = getAtomicCommerceParticipant(member.participant);
    const selection = member.nativeStorage === undefined ? undefined : atomicCommerceNativeSourceIdentity(member.nativeStorage);
    const source = selection === undefined ? undefined : captured.sources.find(candidate => atomicCommerceNativeSourceIdentity(candidate.source)?.name === selection.name);
    if (name === undefined || !isCommerceDefinitionName(name) || names.has(name) || tokens.has(member.participant) || source === undefined || selection === undefined
      || member.profile !== undefined || member.logicalStorage !== undefined || member.commands.length === 0
      || member.validate !== undefined || member.reconstitution !== undefined || member.detachDeletedReferences !== undefined
      || selectedSources.has(source.definition.identity.sourceKey)) return yield* commerceError("unsupportedProfile");
    const identity = source.definition.identity;
    if (selection.sourceKey !== identity.sourceKey || selection.sourceSha256 !== identity.sourceSha256
      || selection.configSha256 !== identity.configSha256 || selection.provenanceSha256 !== identity.provenanceSha256
      || selection.applicationRead !== source.definition.applicationRead) return yield* commerceError("invalidAuthority");
    names.add(name); tokens.add(member.participant); selectedSources.add(identity.sourceKey);
    yield* Effect.fromResult(decodePublication(member.logicalPublication).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause))));
    const invocation = yield* Effect.fromResult(decodeInvocation({ allowReferenceReplacement: member.allowReferenceReplacement,
      setNullPolicy: member.setNullPolicy, allowActiveRestoreUpdate: member.allowActiveRestoreUpdate,
      allowStorageInsertionOrder: member.allowStorageInsertionOrder, allowRecordedRowReplay: member.allowRecordedRowReplay,
      allowPreservingDeletionUpsert: member.allowPreservingDeletionUpsert, allowReferenceCheckpoints: member.allowReferenceCheckpoints,
      insertValidation: member.insertValidation }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause))));
    const resources = yield* Effect.fromResult(captureCommerceResources(member.logicalResources ?? defaultCommerceResources));
    if (limits.commandBytes > resources.commandBytes)
      return yield* commerceError("unsupportedProfile");
    const commands = new Set<CommerceCommand>();
    const registrations: Readonly<{ name: string; mode: "read" | "write" }>[] = [];
    for (const command of member.commands) {
      const definition = getCommerceCommand(command);
      if (definition === undefined || !isCommerceDefinitionName(definition.name) || commands.has(command) || registrations.some(item => item.name === definition.name))
        return yield* commerceError("invalidAuthority");
      commands.add(command); registrations.push(Object.freeze({ name: definition.name, mode: definition.mode }));
    }
    const events = yield* Effect.fromResult(member.events);
    const eventContracts = yield* Effect.fromResult(admitParticipantEvents(events, eventPolicy));
    const derived = member.derivedIdEvent === undefined ? undefined : eventPolicy?.allowed.get(member.derivedIdEvent.contract);
    if (member.derivedIdEvent !== undefined && (derived === undefined || !derived.internal
      || !isCommerceDerivedIdEventContract(member.derivedIdEvent.contract))) return yield* commerceError("invalidAuthority");
    commandDefinitions += commands.size;
    if (commandDefinitions > commerceLimits.commandDefinitions) return yield* commerceError("limitExceeded");
    const validated = member.validateLogical !== undefined || member.validateLogicalCall !== undefined;
    if (events !== undefined && !validated || invocation.setNullPolicy !== undefined && !validated
      || invocation.allowActiveRestoreUpdate === true && !validated || invocation.allowStorageInsertionOrder === true && !validated
      || invocation.allowRecordedRowReplay === true && member.validateLogicalCall === undefined
      || invocation.allowPreservingDeletionUpsert !== undefined && member.validateLogicalCall === undefined
      || invocation.allowReferenceCheckpoints === true && member.validateLogicalCall === undefined
      || invocation.insertValidation !== undefined && member.validateLogicalCall === undefined
      || invocation.allowReferenceReplacement === true && (!validated || member.derivedIdEvent === undefined
        || events === undefined || !events.contracts.includes(member.derivedIdEvent.contract))
      || member.derivedIdEvent !== undefined && invocation.allowReferenceReplacement !== true)
      return yield* commerceError("unsupportedProfile");
    members.push(Object.freeze({ participant: member.participant, name, source, commands, registrations: Object.freeze(registrations),
      resources, invocation: invocationPolicy(invocation), publication: member.logicalPublication, events, eventContracts,
      derivedContract: derived === undefined ? null : Object.freeze({ name: derived.name, revision: derived.revision }), validateLogicalCall: member.validateLogicalCall,
      validateLogical: member.validateLogical, derivedIdEvent: member.derivedIdEvent }));
  }
  const allowed = new Set(captured.commands), commandNames: string[] = [];
  for (const command of captured.commands) {
    const definition = getAtomicCommerceCommand(command);
    if (definition === undefined || !isCommerceDefinitionName(definition.name) || commandNames.includes(definition.name)) return yield* commerceError("invalidAuthority");
    commandNames.push(definition.name);
  }
  if (allowed.size === 0 || allowed.size > commerceLimits.commandDefinitions || allowed.size !== captured.commands.length)
    return yield* commerceError("invalidAuthority");
  if (members.some(member => member.derivedIdEvent !== undefined) !== (eventPolicy?.derivedIdValidation === "capturedOnly"))
    return yield* commerceError("invalidAuthority");
  const participants: CoreNativeRootRecoveryInput["participants"][number][] = members.map(member => ({ definition: member.source.definition, commands: member.registrations,
    limits: { maxIdentities: member.resources.catalogRows, maxDocumentBytes: commerceLimits.rowBytes } }));
  if (eventPolicy !== undefined && captured.eventStorage !== undefined) participants.push({ definition: captured.eventStorage.definition,
    commands: [{ name: CORE_NATIVE_EVENT_WRITE, mode: "write" }], limits: coreNativeEventLimits });
  const maxFinalUserDocuments = members.reduce((total, member) => total + member.resources.facts, 0);
  if (maxFinalUserDocuments > CORE_TRANSACTION_REFERENCE_LIMITS.documentsWritten) return yield* commerceError("limitExceeded");
  const contract = { format: "flarex.native-atomic-commerce", version: 1, policy: policy.value,
    commands: commandNames, events: eventPolicy?.identity ?? null, selectedLimits: captured.selectedLimits,
    limits: { calls: limits.calls, commandBytes: limits.commandBytes,
      commandMs: limits.commandMs, eventLimit: limits.eventLimit, participantLimit: limits.participantLimit,
      ...(limits.operationScheduling === undefined ? {} : { operationScheduling: limits.operationScheduling }),
      ...(limits.borrowedOperationScheduling === undefined ? {} : { borrowedOperationScheduling: limits.borrowedOperationScheduling }) },
    sources: members.map(member => ({ name: member.name, sourceKey: member.source.definition.identity.sourceKey,
      resources: { ...member.resources }, invocation: { ...member.invocation }, publication: member.publication ?? null,
      events: member.eventContracts, derivedIdEvent: member.derivedContract,
      validation: { call: member.validateLogicalCall !== undefined, aggregate: member.validateLogical !== undefined },
      initialization: { ...member.source.initialization } })) } satisfies Json;
  const rootInput: CoreNativeRootRecoveryInput = { bundle: captured.bundle, contract, participants,
    ...(executionIsolation === undefined ? {} : { executionIsolation }),
    maxFinalUserDocuments, protectedMetadata: true, retryProvenNoncommit: true };
  const recovery = yield* captured.database.bindNativeRootRecovery(rootInput).pipe(Effect.catchCause(cause =>
    Effect.failCause(Cause.map(cause, projectCoreCommerceFailure))));
  yield* chargeHostPreparation({ root: recovery.identity, contract }).pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
  return Object.freeze({ ...captured, allowed, members: Object.freeze(members), limits, policy: policy.value, eventPolicy, executionIsolation,
    rootInput, recovery });
});

export type PreparedAtomicCommerceNativeConfiguration = Effect.Success<ReturnType<typeof prepareAtomicCommerceNativeConfiguration>>;
