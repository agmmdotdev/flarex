import { Effect, Schema } from "effect";
import { hasApplicationBindingComposition } from "../applicationActivation";
import { hasFrameworkSchemaTargetDatabase } from "../frameworkSchema/target";
import { hasRelationalSessionDatabase } from "../relationalTransaction/session";
import { captureTrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../scopeAuthorityResolution";
import { captureCommerceJsonData } from "../commerceTransaction/request";
import type { CommerceHostConfiguration } from "../commerceTransaction/hostConfiguration";
import { commerceError, commerceLimits, type CommerceTransactionError } from "../commerceTransaction/model";
import type { RequestLimits } from "../boundedRequestLifetime";
import { CommerceCallLimit, defaultCommerceResources } from "../commerceTransaction/resources";
import { logicalMaterializationBatchBudget } from "../logicalDocuments/materialization";
import { getAtomicCommerceCommand, type AtomicCommerceCommand } from "./commands";
import {
  prepareAtomicCommerceParticipants,
  captureAtomicCommerceParticipants,
  isCommerceDefinitionName,
  type AtomicCommerceParticipantInput,
} from "./participants";
import { admitParticipantEvents, captureAtomicCommerceEvents, isCommerceDerivedIdEventContract,
  prepareAtomicCommerceEvents, type AtomicCommerceEvents } from "./events";
import { TransactionIdentityAccessPolicySha256V1Schema } from "flarex-protocol/transaction-session";
import { commerceIdentityEvidence } from "../commerceTransaction/request";
import { hashAtomicCommerceBytes } from "./request";
import { chargeHostPreparation } from "../preparedHostRuntime";
import { commitEventLimits } from "../commitEvents/model";

export interface AtomicCommerceHostInput<Failure> extends CommerceHostConfiguration<Failure> {
  readonly participants: readonly AtomicCommerceParticipantInput[];
  readonly commands: readonly AtomicCommerceCommand[];
  readonly events?: AtomicCommerceEvents;
  /** Trusted root selection, capped by installed physical participant profiles. Omission selects 64
   * calls and remains identity-distinct from an explicit limit. */
  readonly requestCallLimit?: number;
  /** Trusted root event selection. Omission keeps the ordinary 64-message
   * budget; physical participants retain their installed profile ceiling. */
  readonly requestEventLimit?: number;
}

const decodeCallLimit = Schema.decodeUnknownEffect(CommerceCallLimit);
const decodeEventLimit = Schema.decodeUnknownEffect(Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: commitEventLimits.messages })));

/** Captured host configuration, with no request-local state or settlement capability. */
export interface PreparedAtomicCommerceConfiguration<Failure> extends Omit<
  CommerceHostConfiguration<Failure>,
  "identityAndAccessPolicy" | "hostRuntime"
> {
  readonly allowed: ReadonlySet<AtomicCommerceCommand>;
  readonly members: Effect.Success<ReturnType<typeof prepareAtomicCommerceParticipants>>;
  readonly eventPolicy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>> | undefined;
  readonly identityDigest: typeof TransactionIdentityAccessPolicySha256V1Schema.Type;
  readonly limits: RequestLimits;
  readonly eventLimit: number;
  readonly factLimit: number;
  readonly owner: object;
}

/** Prepare one deployment selection; request state is constructed only at run. */
export const prepareAtomicCommerceConfiguration = Effect.fn("AtomicCommerce.prepareConfiguration")(function* <
  Failure,
>(
  input: AtomicCommerceHostInput<Failure>,
): Effect.fn.Return<PreparedAtomicCommerceConfiguration<Failure>, CommerceTransactionError> {
  const { database, session, target, deploymentId, application } = input;
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
  const policyInput = captureCommerceJsonData(input.identityAndAccessPolicy, commerceLimits.rowBytes);
  const authority = captureTrustedScopeAuthorityResolutionPorts(input.authority);
  const selectedCallLimit = input.requestCallLimit;
  const selectedEventLimit = input.requestEventLimit;
  const callLimit = yield* decodeCallLimit(
    selectedCallLimit === undefined ? commerceLimits.calls : selectedCallLimit,
  ).pipe(Effect.mapError((cause) => commerceError("unsupportedProfile", cause)));
  const eventLimit = yield* decodeEventLimit(
    selectedEventLimit === undefined ? defaultCommerceResources.eventMessages : selectedEventLimit,
  ).pipe(Effect.mapError((cause) => commerceError("unsupportedProfile", cause)));
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
  const policy = yield* Effect.fromResult(policyInput);
  const capturedMembers = yield* Effect.fromResult(participantInput);
  const logicalLocation = capturedMembers.some(member => member.kind === "logical")
    ? yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authority).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)))
    : undefined;
  const members = yield* prepareAtomicCommerceParticipants(database, target, capturedMembers,
    logicalLocation === undefined ? undefined : { deploymentId, scopeId: logicalLocation.authority.scopeId });
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
    ...(members.some(member => member.validateLogicalCall !== undefined) ? {
      logicalCallValidation: members.filter(member => member.validateLogicalCall !== undefined).map(member => member.name),
    } : {}),
    ...(selectedEventLimit === undefined ? {} : { requestEventLimit: eventLimit }),
  }, commerceLimits.commandBytes);
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(
    yield* hashAtomicCommerceBytes(identity.canonicalBytes),
  );
  const limits = {
    ...commerceLimits,
    // A logical source has no installed resource profile. Its synthetic
    // descriptor carries ordinary defaults, not a cap on the trusted root's
    // explicit, identity-bound call allowance. Physical profiles do cap it.
    calls: Math.min(callLimit, ...members.filter(member => member.kind === "physical")
      .map(member => member.descriptor.resources.calls)),
    commandBytes: Math.min(
      commerceLimits.commandBytes,
      ...members.map((member) => member.descriptor.resources.commandBytes),
    ),
  };
  const transitionFacts = members.every(member => member.kind === "logical") &&
    members.some(member => member.kind === "logical" &&
      (member.allowSetNull === true || member.allowReferenceReplacement === true))
    ? logicalMaterializationBatchBudget.rows : defaultCommerceResources.facts;
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
  };
});
