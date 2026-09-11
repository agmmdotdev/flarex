import { Effect, Schema } from "effect";
import { hasApplicationBindingComposition } from "../applicationActivation";
import { hasFrameworkMigrationTargetDatabase } from "../migrationCoordination/targetSession";
import { hasRelationalSessionDatabase } from "../relationalTransaction/session";
import { captureTrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import { capturePrivateJsonData } from "../privateJsonData";
import type { CommerceHostConfiguration } from "../commerceTransaction/hostConfiguration";
import { commerceError, commerceLimits, type CommerceTransactionError } from "../commerceTransaction/model";
import type { RequestLimits } from "../boundedRequestLifetime";
import { CommerceCallLimit, defaultCommerceResources } from "../commerceTransaction/resources";
import { getAtomicCommerceCommand, type AtomicCommerceCommand } from "./commands";
import {
  prepareAtomicCommerceParticipants,
  isCommerceDefinitionName,
  type AtomicCommerceParticipantInput,
} from "./participants";
import { admitParticipantEvents, prepareAtomicCommerceEvents, type AtomicCommerceEvents } from "./events";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { TransactionIdentityAccessPolicySha256V1Schema } from "flarex-protocol/transaction-session";
import { projectCommerceRequestFailure } from "../commerceTransaction/request";
import { hashAtomicCommerceBytes } from "./request";

export interface AtomicCommerceHostInput<Failure> extends CommerceHostConfiguration<Failure> {
  readonly participants: readonly AtomicCommerceParticipantInput[];
  readonly commands: readonly AtomicCommerceCommand[];
  readonly events?: AtomicCommerceEvents;
  /** Trusted root selection, capped by every participant. Omission preserves 64
   * calls and existing request identity; children never receive a fresh budget. */
  readonly requestCallLimit?: number;
}

const decodeCallLimit = Schema.decodeUnknownEffect(CommerceCallLimit);
// A non-JSON preimage prefix cannot collide with an omitted host's arbitrary
// canonical JSON policy, even if that policy resembles our explicit wrapper.
const callPolicyDomain = new TextEncoder().encode("flarex.atomic-commerce.request-call-policy\0");

/** Captured host configuration, with no request-local state or settlement capability. */
export interface PreparedAtomicCommerceConfiguration<Failure> extends Omit<
  CommerceHostConfiguration<Failure>,
  "identityAndAccessPolicy"
> {
  readonly allowed: ReadonlySet<AtomicCommerceCommand>;
  readonly members: Effect.Success<ReturnType<typeof prepareAtomicCommerceParticipants>>;
  readonly eventPolicy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>> | undefined;
  readonly identityDigest: typeof TransactionIdentityAccessPolicySha256V1Schema.Type;
  readonly limits: RequestLimits;
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
    !hasFrameworkMigrationTargetDatabase(target, database) ||
    !hasApplicationBindingComposition(application, input.authority)
  )
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const selectedCallLimit = input.requestCallLimit;
  const callLimit = yield* decodeCallLimit(
    selectedCallLimit === undefined ? commerceLimits.calls : selectedCallLimit,
  ).pipe(Effect.mapError((cause) => commerceError("unsupportedProfile", cause)));
  const authority = captureTrustedScopeAuthorityResolutionPorts(input.authority);
  const allowed = new Set(input.commands);
  const names = new Set<string>();
  if (allowed.size === 0 || allowed.size > commerceLimits.commandDefinitions)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const command of allowed) {
    const definition = getAtomicCommerceCommand(command);
    if (definition === undefined || !isCommerceDefinitionName(definition.name) || names.has(definition.name))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    names.add(definition.name);
  }
  const policy = yield* Effect.fromResult(
    capturePrivateJsonData(input.identityAndAccessPolicy, commerceLimits.rowBytes, commerceError),
  );
  const members = yield* prepareAtomicCommerceParticipants(database, target, input.participants);
  const eventPolicy =
    input.events === undefined ? undefined : yield* prepareAtomicCommerceEvents(input.events);
  const participantEvents = [];
  for (const member of members) {
    if (member.events !== undefined && member.validate === undefined)
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const contracts = yield* Effect.fromResult(admitParticipantEvents(member.events, eventPolicy));
    participantEvents.push({
      participant: member.name,
      installation: member.reference.installation.installationSha256,
      contracts,
    });
  }
  const eventIdentity =
    eventPolicy === undefined
      ? policy.value
      : {
          policy: policy.value,
          events: eventPolicy.identity,
          participantEvents,
        };
  const identity = yield* canonicalizeSuccessfulResultV1Effect(
    selectedCallLimit === undefined
      ? eventIdentity
      : {
          policy: eventIdentity,
          requestCallLimit: callLimit,
        },
  ).pipe(Effect.mapError(projectCommerceRequestFailure));
  let identityBytes: Uint8Array = identity.canonicalBytes;
  if (selectedCallLimit !== undefined) {
    const tagged = new Uint8Array(callPolicyDomain.byteLength + identityBytes.byteLength);
    tagged.set(callPolicyDomain);
    tagged.set(identityBytes, callPolicyDomain.byteLength);
    identityBytes = tagged;
  }
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(
    yield* hashAtomicCommerceBytes(identityBytes),
  );
  const limits = {
    ...commerceLimits,
    calls: Math.min(callLimit, ...members.map((member) => member.descriptor.resources.calls)),
    commandBytes: Math.min(
      commerceLimits.commandBytes,
      ...members.map((member) => member.descriptor.resources.commandBytes),
    ),
  };
  const factLimit = Math.min(
    defaultCommerceResources.facts,
    ...members.map((member) => member.descriptor.resources.facts),
  );
  const owner = Object.freeze({ hostId: Symbol("atomic.commerce.host") });
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
    factLimit,
    owner,
  };
});
