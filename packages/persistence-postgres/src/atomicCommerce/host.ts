import { Cause, Effect, Exit, Schema } from "effect";
import { sql } from "drizzle-orm";
import type { Json } from "flarex-protocol/json";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema, TransactionFunctionPathV1Schema, TransactionIdentityAccessPolicySha256V1Schema, TransactionRequestSha256V1Schema } from "flarex-protocol/transaction-session";
import { hasApplicationBindingComposition, prepareApplicationBindingSelection } from "../applicationActivation";
import { hasFrameworkMigrationTargetDatabase } from "../migrationCoordination/targetSession";
import { hasRelationalSessionDatabase, runRelationalSession } from "../relationalTransaction/session";
import { runWithRequestRecovery } from "../relationalTransaction/requestRecovery";
import { captureTrustedScopeAuthorityResolutionPorts, resolveLocatedTrustedScopeAuthorityEffect } from "../scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../transactionSessionAttemptKernel";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { lockScopeClockForUpdateInTransactionEffect } from "../scopeClock";
import { createCommittedPointOutcomeResolverV1 } from "../committedPointOutcome";
import { capturePrivateJsonData } from "../privateJsonData";
import { makeBoundedRequestLifetime, type BoundedRequestContext } from "../boundedRequestLifetime";
import type { CommerceHostInput } from "../commerceTransaction/host";
import { commerceError, commerceLimits, type CommerceTransactionError } from "../commerceTransaction/model";
import { commerceRequestHash, projectCommerceRequestFailure } from "../commerceTransaction/request";
import { requireCommerceAdmission } from "../commerceTransaction/admission";
import { makeCommerceStore } from "../commerceTransaction/store";
import { makeCommerceCommandContext } from "../commerceTransaction/context";
import { getCommerceCommand, type CommerceCommand } from "../commerceTransaction/commands";
import { finalizeCommerceCommit } from "../commerceTransaction/publication";
import { defaultCommerceResources } from "../commerceTransaction/resources";
import { getAtomicCommerceCommand, type AtomicCommerceCommand, type AtomicCommerceHost, type AtomicCommerceContext } from "./commands";
import { withAtomicCommerceAdmissions } from "./admission";
import { prepareAtomicCommerceParticipants, isCommerceDefinitionName, type AtomicCommerceParticipantInput } from "./participants";
import { makeAtomicEventCapture, prepareAtomicCommerceEvents, type AtomicCommerceEvents, type AtomicCommerceCallObservation } from "./events";

export type AtomicCommerceHostInput<Failure> = Pick<CommerceHostInput<Failure>,
  "database" | "session" | "target" | "deploymentId" | "authority" | "application" | "identityAndAccessPolicy"> & {
  readonly participants: readonly AtomicCommerceParticipantInput[];
  readonly commands: readonly AtomicCommerceCommand[];
  readonly events?: AtomicCommerceEvents;
};
const decodeKey = Schema.decodeUnknownEffect(TransactionRequestKeyV1Schema);
const sha = (bytes: Uint8Array) => commerceRequestHash(bytes, { maximumInputBytes: commerceLimits.commandBytes });

/** A dynamic deployment/binding composition. Owns no pool, scheduler or singleton
 * service. Each invocation enters the existing bounded relational owner once. */
export const makeAtomicCommerceHost = Effect.fn("AtomicCommerce.makeHost")(function* <Failure>(
  input: AtomicCommerceHostInput<Failure>,
): Effect.fn.Return<AtomicCommerceHost, CommerceTransactionError> {
  const { database, session, target, deploymentId, application } = input;
  if (!hasRelationalSessionDatabase(session, database) || !hasFrameworkMigrationTargetDatabase(target, database) ||
    !hasApplicationBindingComposition(application, input.authority)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const authority = captureTrustedScopeAuthorityResolutionPorts(input.authority);
  const allowed = new Set(input.commands);
  const names = new Set<string>();
  if (allowed.size === 0 || allowed.size > commerceLimits.commandDefinitions) return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const command of allowed) {
    const definition = getAtomicCommerceCommand(command);
    if (definition === undefined || !isCommerceDefinitionName(definition.name) || names.has(definition.name)) return yield* Effect.fail(commerceError("invalidAuthority"));
    names.add(definition.name);
  }
  const policy = yield* Effect.fromResult(capturePrivateJsonData(input.identityAndAccessPolicy, commerceLimits.rowBytes, commerceError));
  const members = yield* prepareAtomicCommerceParticipants(database, target, input.participants);
  const eventPolicy = input.events === undefined ? undefined : yield* prepareAtomicCommerceEvents(input.events);
  if (members.some(member => member.eventContract !== undefined && (member.validate === undefined || !eventPolicy?.allowed.has(member.eventContract)))) return yield* Effect.fail(commerceError("invalidAuthority"));
  const identity = yield* canonicalizeSuccessfulResultV1Effect(eventPolicy === undefined ? policy.value : { policy: policy.value, events: eventPolicy.identity }).pipe(Effect.mapError(projectCommerceRequestFailure));
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(yield* sha(identity.canonicalBytes));
  const limits = { ...commerceLimits,
    calls: Math.min(commerceLimits.calls, ...members.map(member => member.descriptor.resources.calls)),
    commandBytes: Math.min(commerceLimits.commandBytes, ...members.map(member => member.descriptor.resources.commandBytes)),
  };
  const factLimit = Math.min(defaultCommerceResources.facts, ...members.map(member => member.descriptor.resources.facts));
  const owner = Object.freeze({ hostId: Symbol("atomic.commerce.host") });
  const run = Effect.fn("AtomicCommerce.run")(function* (requestKey: string, token: AtomicCommerceCommand, args: Json) {
    const definition = getAtomicCommerceCommand(token);
    if (definition === undefined || !allowed.has(token)) return yield* Effect.fail(commerceError("invalidAuthority"));
    const key = yield* decodeKey(requestKey).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    if (!/^commerce\/atomic\/[a-zA-Z0-9/-]{1,100}$/.test(key)) return yield* Effect.fail(commerceError("invalidInput"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(args, limits.commandBytes, commerceError));
    const attempt = Effect.fn("AtomicCommerce.attempt")(function* (recoverOnly: boolean) {
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authority);
      if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database)) return yield* Effect.fail(commerceError("invalidAuthority"));
      const active = yield* prepareApplicationBindingSelection(application);
      return yield* runRelationalSession(session, tx => Effect.scoped(Effect.gen(function* () {
        yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`), cause => commerceError("statementFailure", cause));
        const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, located.authority.scopeId);
        return yield* withAtomicCommerceAdmissions(members, target, active, tx, located.authority, clock, admissions => Effect.gen(function* () {
          const first = admissions[0];
          if (first === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
          const admitted = yield* requireCommerceAdmission(first);
          const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(located.authority.scopeId)).pipe(Effect.mapError(projectCommerceRequestFailure));
          const evidence = yield* canonicalizeSuccessfulResultV1Effect({ domain: "flarex.private.atomic-commerce-command", version: 1,
            deploymentId, scopeId: located.authority.scopeId, epoch: clock.epoch, generation: clock.storageGeneration,
            fence: clock.storageGenerationFence.toString(), bindingHead: admitted.head, operation: definition.name, args: captured.value,
            participants: members.map(member => ({ name: member.name, installation: member.reference,
              contractSha256: member.descriptor.contractSha256, commands: member.commandNames })),
          }).pipe(Effect.mapError(projectCommerceRequestFailure));
          const lookup = { scopeUuid: scope.scopeUuid, requestKey: key, expectedIdentityAccessPolicySha256: identityDigest,
            expectedFunctionPath: TransactionFunctionPathV1Schema.make(`__flarex_private_atomic_commerce/${definition.name}`),
            expectedRequestSha256: TransactionRequestSha256V1Schema.make(yield* sha(evidence.canonicalBytes)) };
          const retained = yield* createCommittedPointOutcomeResolverV1(tx).resolve(lookup).pipe(Effect.mapError(projectCommerceRequestFailure));
          if (retained.kind === "available") return retained.successfulResult.valueJson;
          if (retained.kind === "expired") return yield* Effect.fail(commerceError("resultUnavailable"));
          if (recoverOnly) return yield* Effect.fail(commerceError("decisionUncertain"));
          const id = crypto.randomUUID();
          const lifetime = yield* makeBoundedRequestLifetime(commerceError, limits, owner, Object.freeze({ requestId: Symbol("atomic.commerce.request") }), id, "write");
          const eventCapture = eventPolicy === undefined ? undefined : makeAtomicEventCapture(first, lifetime, key, eventPolicy,
            Math.min(defaultCommerceResources.eventMessages, ...members.map(member => member.descriptor.resources.eventMessages)));
          return yield* Effect.gen(function* () {
            yield* Effect.fromResult(lifetime.charge(evidence.canonicalBytes.byteLength));
            const contributions: Array<{ admission: typeof first; working: Effect.Success<ReturnType<typeof makeCommerceStore>> }> = [];
            let facts = 0;
            const observations: AtomicCommerceCallObservation[] = [];
            const context = Object.freeze<AtomicCommerceContext>({
              eventGroupId: key,
              checkpoint: lifetime.operation(lifetime.context, id, "read", Effect.void),
              capture: value => lifetime.operation(lifetime.context, id, "read", Effect.gen(function* () {
                const intermediate = yield* Effect.fromResult(capturePrivateJsonData(value, lifetime.remainingBytes(), commerceError));
                yield* Effect.fromResult(lifetime.charge(intermediate.bytes));
                return intermediate.value;
              })),
              emit: (contract, message) => lifetime.operation(lifetime.context, id, "write", eventCapture === undefined
                ? Effect.fail(commerceError("unadmittedEvent")) : eventCapture.capture(contract, message).pipe(Effect.asVoid)),
              refuse: error => lifetime.operation(lifetime.context, id, "write", Effect.fail(error)),
              call: (participant, command, inputArgs) => lifetime.nested(lifetime.context, id, child => Effect.gen(function* () {
                const index = members.findIndex(member => member.participant === participant);
                const member = members[index];
                const admission = admissions[index];
                const root = getCommerceCommand(command);
                if (member === undefined || admission === undefined || root === undefined || !member.commands.has(command)) return yield* Effect.fail(commerceError("invalidAuthority"));
                const working = yield* makeCommerceStore(admission, lifetime, id);
                contributions.push({ admission, working });
                const events: Json[] = [];
                const invoke = Effect.fn("AtomicCommerce.invokeParticipant")(function* (
                  manager: BoundedRequestContext, nested: CommerceCommand, nestedArgs: Json,
                ): Effect.fn.Return<Pick<AtomicCommerceCallObservation, "input" | "result">, CommerceTransactionError> {
                  const operation = getCommerceCommand(nested);
                  if (operation === undefined || !member.commands.has(nested)) return yield* Effect.fail(commerceError("invalidAuthority"));
                  const value = yield* Effect.fromResult(capturePrivateJsonData(nestedArgs, lifetime.remainingBytes(), commerceError));
                  yield* Effect.fromResult(lifetime.charge(value.bytes));
                  const commandContext = makeCommerceCommandContext(lifetime, working, id, manager,
                    (current, nestedCommand, nestedInput) => invoke(current, nestedCommand, nestedInput).pipe(Effect.map(call => call.result)),
                    (current, event) => lifetime.operation(current, id, "write", Effect.gen(function* () {
                      if (eventCapture === undefined || member.eventContract === undefined) return yield* Effect.fail(commerceError("unadmittedEvent"));
                      events.push(yield* eventCapture.capture(member.eventContract, event));
                    })));
                  const output = yield* operation.run(commandContext, value.value);
                  const result = yield* Effect.fromResult(capturePrivateJsonData(output, lifetime.remainingBytes(), commerceError));
                  yield* Effect.fromResult(lifetime.charge(result.bytes));
                  return Object.freeze({ input: value.value, result: result.value });
                });
                const call = yield* invoke(child, command, inputArgs);
                const rows = working.snapshot();
                facts += rows.length;
                if (facts > factLimit) return yield* Effect.fail(commerceError("limitExceeded"));
                if (member.validate !== undefined) yield* member.validate(events, rows, root.name, working.lifecycleSnapshot());
                // Inputs/results are the already charged, recursively frozen
                // captures. Only the validated outer call becomes evidence.
                if (eventCapture !== undefined) observations.push(Object.freeze({ participant, command, ...call }));
                return call.result;
              }), getCommerceCommand(command)?.mode),
            });
            const value = yield* definition.run(context, captured.value).pipe(Effect.catchCause(cause => Effect.gen(function* () {
              // Preserve any earlier participant refusal alongside a later
              // failure, including failures swallowed by trusted command code.
              const sealed = yield* Effect.exit(lifetime.seal);
              return yield* Effect.failCause(Exit.isFailure(sealed) ? Cause.combine(cause, sealed.cause) : cause);
            })));
            // Check rollback-only before result accounting can report a closed
            // budget and obscure the participant's original failure.
            yield* lifetime.seal;
            const capturedResult = yield* Effect.fromResult(capturePrivateJsonData(value, lifetime.remainingBytes(), commerceError));
            yield* Effect.fromResult(lifetime.charge(capturedResult.bytes));
            const result = yield* canonicalizeSuccessfulResultV1Effect(capturedResult.value).pipe(Effect.mapError(projectCommerceRequestFailure));
            // Empty stores authenticate even participants with no calls. Called
            // stores are consumed in execution order, preserving global ordinals.
            for (const admission of admissions) {
              if (!contributions.some(member => member.admission === admission)) contributions.push({ admission, working: yield* makeCommerceStore(admission, lifetime, id) });
            }
            const closed = [];
            for (const contribution of contributions) closed.push({ admission: contribution.admission, closure: yield* contribution.working.close() });
            const root = closed[0];
            if (root === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
            const eventClosure = eventCapture === undefined ? undefined : yield* eventCapture.close(observations);
            yield* finalizeCommerceCommit(root.admission, lifetime, root.closure, lookup, result, yield* sha(result.canonicalBytes), closed.slice(1),
              eventClosure === undefined ? undefined : { admission: first, closure: eventClosure });
            return result.valueJson;
          }).pipe(Effect.timeoutOrElse({ duration: commerceLimits.commandMs, orElse: () => Effect.fail(commerceError("deadlineExceeded")) }), Effect.ensuring(lifetime.close));
        }));
      })));
    });
    return yield* runWithRequestRecovery(attempt, { hasRequestKey: true, projectFailure: projectCommerceRequestFailure,
      isDecisionUncertain: error => error.reason === "decisionUncertain" });
  });
  return Object.freeze({ newRequestKey: () => `commerce/atomic/${crypto.randomUUID()}`, run });
});
