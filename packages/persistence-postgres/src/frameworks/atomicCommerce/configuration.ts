import { Effect, Result, Schema } from "effect";
import {
  hasApplicationBindingComposition,
} from "../../application/activation/repositoryIdentity";
import {
  type ApplicationBindingInput,
} from "../../application/activation/contracts";
import { hasFrameworkSchemaTargetDatabase } from "../../installation/frameworkSchema/target";
import { hasRelationalSessionDatabase } from "../../database/relationalTransaction/session";
import { captureExactTrustedScopeAuthorityResolutionPorts } from "../../scope/scopeAuthorityResolution";
import type {
  ExactTrustedScopeAuthorityResolutionPorts,
  TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import type {
  LocatedReadCommittedAttemptTargetV1,
} from "../../database/locatedTransactionIdentity";
import { captureCommerceJsonData } from "../commerceTransaction/request";
import type { CommerceHostConfiguration } from "../commerceTransaction/hostConfiguration";
import { commerceError, commerceLimits, type CommerceTransactionError } from "../commerceTransaction/model";
import type { RequestLimits } from "../../execution/preparation/boundedRequestLifetime";
import { defaultCommerceResources } from "../commerceTransaction/resources";
import {
  CommerceCallLimit,
  CommerceCommandByteLimit,
  FrameworkCommandMilliseconds,
} from "../../execution/preparation/frameworkExecutionPolicy";
import {
  logicalMaterializationBatchBudget,
} from "../../storage/documents/logicalDocuments/materialization";
import { getAtomicCommerceCommand, type AtomicCommerceCommand } from "./commands";
import {
  prepareAtomicCommerceParticipants,
  captureAtomicCommerceParticipants,
  isCommerceDefinitionName,
  type AtomicCommerceParticipantInput,
  type CapturedAtomicCommerceParticipants,
} from "./participants";
import { admitParticipantEvents, captureAtomicCommerceEvents, isCommerceDerivedIdEventContract,
  prepareAtomicCommerceEvents, type AtomicCommerceEvents } from "./events";
import { TransactionIdentityAccessPolicySha256V1Schema } from "flarex-protocol/transaction-session";
import { commerceIdentityEvidence, projectCommerceRequestFailure } from "../commerceTransaction/request";
import { hashAtomicCommerceBytes } from "./request";
import { chargeHostPreparation } from "../../execution/preparation/preparedHostRuntime";
import { commitEventLimits } from "../../commit/events/model";
import { inspectTrustedWorkflowTaskBinding, type TrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";

export interface AtomicCommerceHostInput<Failure> extends CommerceHostConfiguration<Failure> {
  readonly participants: readonly AtomicCommerceParticipantInput[];
  readonly commands: readonly AtomicCommerceCommand[];
  readonly events?: AtomicCommerceEvents;
  /** Trusted root selection, capped by installed physical participant profiles. Omission selects 64
   * calls and remains identity-distinct from an explicit limit. */
  readonly requestCallLimit?: number;
  /** Trusted root byte allowance, capped by every participant's resource
   * selection and included in the request identity. */
  readonly requestByteLimit?: number;
  /** Trusted root event selection. Omission keeps the ordinary 64-message
   * budget; physical participants retain their installed profile ceiling. */
  readonly requestEventLimit?: number;
  /** Trusted command plus settlement deadline, identity-bound. Omission is 10 seconds. */
  readonly requestCommandMs?: number;
  /** Trusted, identity-bound exclusion before callbacks. Omission retains OCC. */
  readonly executionIsolation?: "scopeExclusive";
  /** Trusted scheduling for concurrent native module calls on one borrowed
   * transaction. Omission retains immediate dispatch; explicit selection is
   * included in the request identity. This does not change OCC isolation. */
  readonly operationScheduling?: "queued";
  /** Additional identity-bound FIFO for individual DAL operations within one
   * command or borrowed manager. Requires the queued root profile. */
  readonly borrowedOperationScheduling?: "queued";
  /** Explicit authentic Task definition admission. Omission refuses all Task
   * children, while preserving ordinary atomic command behavior and identity. */
  readonly taskBinding?: TrustedWorkflowTaskBinding;
  /** Explicit cleanup-only command selection for authentic control attempts.
   * Omission grants no control child. The selection is policy-bound. */
  readonly taskControlCommands?: readonly AtomicCommerceCommand[];
}

const decodeCallLimit = Schema.decodeUnknownEffect(CommerceCallLimit);
const decodeByteLimit = Schema.decodeUnknownEffect(CommerceCommandByteLimit);
const decodeEventLimit = Schema.decodeUnknownEffect(Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: commitEventLimits.messages })));
const decodeCommandMs = Schema.decodeUnknownEffect(FrameworkCommandMilliseconds);
const decodeIsolation = Schema.decodeUnknownEffect(Schema.UndefinedOr(Schema.Literal("scopeExclusive")));
const decodeOperationScheduling = Schema.decodeUnknownEffect(Schema.UndefinedOr(Schema.Literal("queued")));

/** Captured host configuration, with no request-local state or settlement capability. */
export interface PreparedAtomicCommerceConfiguration<Failure> extends Omit<
  CommerceHostConfiguration<Failure>,
  "identityAndAccessPolicy" | "hostRuntime" | "authority"
> {
  readonly authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly allowed: ReadonlySet<AtomicCommerceCommand>;
  readonly members: Effect.Success<ReturnType<typeof prepareAtomicCommerceParticipants>>;
  readonly eventPolicy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>> | undefined;
  readonly identityDigest: typeof TransactionIdentityAccessPolicySha256V1Schema.Type;
  readonly limits: RequestLimits;
  readonly eventLimit: number;
  readonly factLimit: number;
  readonly owner: object;
  readonly executionIsolation: "scopeExclusive" | undefined;
  readonly operationScheduling: "queued" | undefined;
  readonly borrowedOperationScheduling: "queued" | undefined;
  readonly taskBindingSha256: string | undefined;
  readonly taskControlAllowed: ReadonlySet<AtomicCommerceCommand>;
}

/** Input ownership precedes the original generation's authority or catalog I/O.
 * These command and resource selections carry no prepared storage authority. */
export interface CapturedAtomicCommerceConfiguration<Failure> extends Omit<CommerceHostConfiguration<Failure>,
  "identityAndAccessPolicy" | "hostRuntime" | "authority"> {
  readonly authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly allowed: ReadonlySet<AtomicCommerceCommand>;
  readonly names: readonly string[];
  readonly capturedMembers: CapturedAtomicCommerceParticipants;
  readonly eventInput: ReturnType<typeof captureAtomicCommerceEvents> | undefined;
  readonly policy: Result.Result.Success<ReturnType<typeof captureCommerceJsonData>>;
  readonly selectedCallLimit: number | undefined;
  readonly selectedByteLimit: number | undefined;
  readonly selectedEventLimit: number | undefined;
  readonly selectedCommandMs: number | undefined;
  readonly callLimit: number;
  readonly byteLimit: number;
  readonly eventLimit: number;
  readonly commandMs: number;
  readonly executionIsolation: "scopeExclusive" | undefined;
  readonly operationScheduling: "queued" | undefined;
  readonly borrowedOperationScheduling: "queued" | undefined;
  readonly taskBindingSha256: string | undefined;
  readonly taskControlAllowed: ReadonlySet<AtomicCommerceCommand>;
  readonly taskControlNames: readonly string[] | undefined;
}

export const captureAtomicCommerceConfiguration = Effect.fn("AtomicCommerce.captureConfiguration")(function* <
  Failure,
>(
  input: AtomicCommerceHostInput<Failure>,
): Effect.fn.Return<CapturedAtomicCommerceConfiguration<Failure>, CommerceTransactionError> {
  const { database, session, target, deploymentId, scopeId, application } = input;
  if (
    !hasRelationalSessionDatabase(session, database) ||
    !hasFrameworkSchemaTargetDatabase(target, database) ||
    !hasApplicationBindingComposition(application, input.authority)
  )
    return yield* Effect.fail(commerceError("invalidAuthority"));
  // No authority lookup or schema preparation may read caller-owned selection.
  const participantInput = captureAtomicCommerceParticipants(input.participants);
  const eventInput = input.events === undefined ? undefined : captureAtomicCommerceEvents(input.events);
  const selectedCommands = [...input.commands];
  const selectedControlCommands = input.taskControlCommands === undefined ? undefined : [...input.taskControlCommands];
  const policyInput = captureCommerceJsonData(input.identityAndAccessPolicy, commerceLimits.rowBytes);
  const authority = captureExactTrustedScopeAuthorityResolutionPorts(input.authority);
  const selectedCallLimit = input.requestCallLimit;
  const selectedByteLimit = input.requestByteLimit;
  const selectedEventLimit = input.requestEventLimit;
  const selectedCommandMs = input.requestCommandMs;
  const executionIsolation = yield* decodeIsolation(input.executionIsolation)
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const operationScheduling = yield* decodeOperationScheduling(input.operationScheduling)
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const borrowedOperationScheduling = yield* decodeOperationScheduling(input.borrowedOperationScheduling)
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  if (borrowedOperationScheduling !== undefined && operationScheduling !== "queued")
    return yield* commerceError("unsupportedProfile");
  const taskBinding = input.taskBinding === undefined ? undefined :
    yield* Effect.fromResult(inspectTrustedWorkflowTaskBinding(input.taskBinding))
      .pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
  if (taskBinding !== undefined && taskBinding.definition.scopeId !== scopeId)
    return yield* commerceError("invalidAuthority");
  const taskBindingSha256 = taskBinding === undefined ? undefined : encodeBytesToLowercaseHex(taskBinding.sha256);
  const callLimit = yield* decodeCallLimit(
    selectedCallLimit === undefined ? commerceLimits.calls : selectedCallLimit,
  ).pipe(Effect.mapError((cause) => commerceError("unsupportedProfile", cause)));
  const byteLimit = yield* decodeByteLimit(
    selectedByteLimit === undefined ? commerceLimits.commandBytes : selectedByteLimit,
  ).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const eventLimit = yield* decodeEventLimit(
    selectedEventLimit === undefined ? defaultCommerceResources.eventMessages : selectedEventLimit,
  ).pipe(Effect.mapError((cause) => commerceError("unsupportedProfile", cause)));
  const commandMs = yield* decodeCommandMs(selectedCommandMs ?? commerceLimits.commandMs)
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const allowed = new Set(selectedCommands);
  const names = new Set<string>();
  if (allowed.size === 0 || allowed.size > commerceLimits.commandDefinitions)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const command of allowed) {
    const definition = getAtomicCommerceCommand(command);
    if (definition === undefined || !isCommerceDefinitionName(definition.name) || names.has(definition.name))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    names.add(definition.name);
  }
  const taskControlAllowed = new Set(selectedControlCommands);
  const taskControlNames: string[] | undefined = selectedControlCommands === undefined ? undefined : [];
  if (selectedControlCommands !== undefined && (taskBinding === undefined || executionIsolation !== "scopeExclusive" ||
    taskControlAllowed.size === 0 || taskControlAllowed.size !== selectedControlCommands.length)) return yield* commerceError("unsupportedProfile");
  for (const command of taskControlAllowed) {
    const definition = getAtomicCommerceCommand(command);
    if (!allowed.has(command) || definition === undefined) return yield* commerceError("invalidAuthority");
    taskControlNames?.push(definition.name);
  }
  const policy = yield* Effect.fromResult(policyInput);
  const capturedMembers = yield* Effect.fromResult(participantInput);
  yield* chargeHostPreparation({ names: [...names], policy: policy.value,
    requestSelection: { selectedCallLimit: selectedCallLimit ?? null, selectedByteLimit: selectedByteLimit ?? null,
      selectedEventLimit: selectedEventLimit ?? null, selectedCommandMs: selectedCommandMs ?? null, executionIsolation: executionIsolation ?? null,
      ...(operationScheduling === undefined ? {} : { operationScheduling }),
    ...(borrowedOperationScheduling === undefined ? {} : { borrowedOperationScheduling }),
      ...(taskBindingSha256 === undefined ? {} : { taskBindingSha256 }),
      ...(taskControlNames === undefined ? {} : { taskControlCommands: taskControlNames }) },
    participants: capturedMembers.map(member => ({
      commandCount: member.commands.length, derivedIdEvent: member.derivedIdEvent ?? null,
      ...(member.allowReconstitution === true ? { allowReconstitution: true } : {}),
      events: Result.isSuccess(member.events) ? { contracts: member.events.success?.contracts.length ?? 0 } : null,
      ...(member.kind === "logical" ? {
        logical: Result.isSuccess(member.logical) ? { schemaVersionId: member.logical.success.schemaVersionId,
          source: member.logical.success.source, initialization: member.logical.success.initialization } : null,
        resources: member.resources !== undefined && Result.isSuccess(member.resources) ? member.resources.success : null,
        ...(member.logicalPublication === undefined ? {} : { logicalPublication: member.logicalPublication }),
      } : { installation: Result.isSuccess(member.reference) ? member.reference.success.value : null }),
    })),
    events: eventInput !== undefined && Result.isSuccess(eventInput) ? {
      subscribers: eventInput.success.subscribers, producerRevision: eventInput.success.producerRevision,
      definitionCount: eventInput.success.definitions.length,
    } : null }).pipe(Effect.mapError(projectCommerceRequestFailure));
  return Object.freeze({ database, session, target, deploymentId, scopeId, application, authority, allowed,
    names: Object.freeze([...names]), capturedMembers, eventInput, policy,
    selectedCallLimit, selectedByteLimit, selectedEventLimit, selectedCommandMs, callLimit, byteLimit, eventLimit, commandMs, executionIsolation, operationScheduling, borrowedOperationScheduling, taskBindingSha256,
    taskControlAllowed, taskControlNames: taskControlNames === undefined ? undefined : Object.freeze(taskControlNames) });
});

/** All storage preparations belong to the original current generation. */
export const prepareAtomicCommerceConfiguration = Effect.fn("AtomicCommerce.prepareConfiguration")(function* <Failure>(
  captured: CapturedAtomicCommerceConfiguration<Failure>, binding: ApplicationBindingInput,
  currentAuthority: TrustedScopeAuthority,
): Effect.fn.Return<PreparedAtomicCommerceConfiguration<Failure>, CommerceTransactionError> {
  const { database, session, target, deploymentId, scopeId, application, authority, allowed, names,
    capturedMembers, eventInput, policy, selectedCallLimit, selectedByteLimit, selectedEventLimit, selectedCommandMs,
    callLimit, byteLimit, eventLimit, commandMs, executionIsolation, operationScheduling, borrowedOperationScheduling, taskBindingSha256, taskControlAllowed, taskControlNames } = captured;
  if (currentAuthority.deploymentId !== deploymentId || currentAuthority.scopeId !== scopeId)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const members = yield* prepareAtomicCommerceParticipants(database, target, capturedMembers,
    { deploymentId, scopeId: currentAuthority.scopeId }, { kind: "standalone", application: binding });
  if (commandMs > commerceLimits.commandMs && members.some(member => member.kind !== "logical"))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const eventPolicy = eventInput === undefined ? undefined : yield* prepareAtomicCommerceEvents(yield* Effect.fromResult(eventInput));
  const hasDerivedIdEvents = members.some(member => member.derivedIdEvent !== undefined);
  if (hasDerivedIdEvents !== (eventPolicy?.derivedIdValidation === "capturedOnly"))
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const participantEvents = [];
  for (const member of members) {
    if (member.kind === "physical" && member.events !== undefined && member.validate === undefined)
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const contracts = yield* Effect.fromResult(admitParticipantEvents(member.events, eventPolicy));
    const derived = member.derivedIdEvent === undefined ? undefined :
      eventPolicy?.allowed.get(member.derivedIdEvent.contract);
    if (member.derivedIdEvent !== undefined && (derived === undefined || !derived.internal ||
      !isCommerceDerivedIdEventContract(member.derivedIdEvent.contract)))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    participantEvents.push({
      participant: member.name,
      ...(member.kind === "physical" ? { installation: member.reference.installation.installationSha256 }
        : { logicalSource: member.contractSha256 }),
      contracts,
      ...(derived === undefined ? {} : { derivedIdEvent: {
        contract: derived.name, revision: derived.revision } }),
    });
  }
  const identity = yield* commerceIdentityEvidence("atomic-policy", {
    policy: policy.value,
    events: eventPolicy?.identity ?? null,
    participantEvents: eventPolicy === undefined ? [] : participantEvents,
    requestCallLimit: selectedCallLimit === undefined ? null : callLimit,
    ...(selectedByteLimit === undefined ? {} : { requestByteLimit: byteLimit }),
    ...(members.some(member => member.kind === "logical" && member.selectedResources !== undefined) ? {
      logicalResources: members.flatMap(member => member.kind === "logical" && member.selectedResources !== undefined
        ? [{ participant: member.name, resources: member.selectedResources }] : []),
    } : {}),
    ...(members.some(member => member.kind === "logical" && member.logicalPublication !== undefined) ? {
      logicalPublication: members.flatMap(member => member.kind === "logical" && member.logicalPublication !== undefined
        ? [{ participant: member.name, profile: member.logicalPublication }] : []),
    } : {}),
    ...(members.some(member => member.validateLogicalCall !== undefined) ? {
      logicalCallValidation: members.filter(member => member.validateLogicalCall !== undefined).map(member => member.name),
    } : {}),
    ...(members.some(member => member.allowReconstitution === true) ? {
      reconstitution: members.filter(member => member.allowReconstitution === true).map(member => member.name),
    } : {}),
    // Conjunction is a newly admitted policy shape. Preserve existing single-
    // validator identities while preventing replay from skipping an added guard.
    ...(members.some(member => member.validateLogicalCall !== undefined && member.validateLogical !== undefined) ? {
      logicalAggregateValidation: members.filter(member => member.validateLogicalCall !== undefined && member.validateLogical !== undefined).map(member => member.name),
    } : {}),
    ...(selectedEventLimit === undefined ? {} : { requestEventLimit: eventLimit }),
    ...(selectedCommandMs === undefined ? {} : { requestCommandMs: commandMs }),
    ...(executionIsolation === undefined ? {} : { executionIsolation }),
    ...(operationScheduling === undefined ? {} : { operationScheduling }),
    ...(borrowedOperationScheduling === undefined ? {} : { borrowedOperationScheduling }),
    ...(taskBindingSha256 === undefined ? {} : { taskBindingSha256 }),
    ...(taskControlNames === undefined ? {} : { taskControlCommands: taskControlNames }),
  }, commerceLimits.commandBytes);
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(
    yield* hashAtomicCommerceBytes(identity.canonicalBytes),
  );
  const limits = Object.freeze({
    ...commerceLimits,
    // A logical source has no installed resource profile. Its synthetic
    // descriptor carries ordinary defaults, not a cap on the trusted root's
    // explicit, identity-bound call allowance. Physical profiles do cap it.
    calls: Math.min(callLimit, ...members.filter(member => member.kind === "physical")
      .map(member => member.descriptor.resources.calls)),
    commandBytes: Math.min(byteLimit,
      ...members.map((member) => member.descriptor.resources.commandBytes)),
    commandMs,
  });
  const transitionFacts = members.every(member => member.kind === "logical")
    ? Math.min(logicalMaterializationBatchBudget.rows,
      Math.max(defaultCommerceResources.facts, ...members.map(member => member.descriptor.resources.facts),
        members.some(member => member.kind === "logical" &&
          (member.allowSetNull === true || member.allowReferenceReplacement === true))
          ? logicalMaterializationBatchBudget.rows : 0))
    : defaultCommerceResources.facts;
  const factLimit = Math.min(transitionFacts,
    ...members.filter(member => member.kind === "physical").map(member => member.descriptor.resources.facts));
  const admittedEventLimit = Math.min(eventLimit,
    ...members.filter(member => member.kind === "physical").map(member => member.descriptor.resources.eventMessages));
  const owner = Object.freeze({ hostId: Symbol("atomic.commerce.host") });
  yield* chargeHostPreparation({ deploymentId, commands: [...names], identityDigest, limits, factLimit,
    eventLimit: admittedEventLimit })
    .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
  return {
    database,
    session,
    target,
    deploymentId,
    scopeId,
    application,
    authority,
    allowed,
    members,
    eventPolicy,
    identityDigest,
    limits,
    eventLimit: admittedEventLimit,
    factLimit,
    owner,
    executionIsolation,
    operationScheduling,
    borrowedOperationScheduling,
    taskBindingSha256,
    taskControlAllowed,
  };
});
