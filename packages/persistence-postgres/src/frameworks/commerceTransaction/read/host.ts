import { Cause, Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import {
  hasApplicationBindingComposition,
  prepareStandaloneApplicationBindingSelection,
} from "../../../application/activation/repositoryIdentity";
import {
  makeBoundedRequestLifetime,
  type BoundedRequestContext,
} from "../../../execution/preparation/boundedRequestLifetime";
import { hasFrameworkSchemaTargetDatabase } from "../../../installation/frameworkSchema/target";
import { canonicalizeJsonOutcome } from "../../../values/jsonOutcome";
import {
  prepareLogicalRelationalReadAdmission,
} from "../../../storage/documents/logicalDocuments/relationalAdmission";
import {
  chargeHostPreparation,
  retainPreparedHost,
} from "../../../execution/preparation/preparedHostRuntime";
import {
  hasRelationalSessionDatabase,
  runCoLocatedRelationalReadSession,
} from "../../../database/relationalTransaction/session";
import { prepareStandaloneReadTransaction } from "../../../storage/documents/standaloneReadTransaction";
import {
  captureExactTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
} from "../../../scope/scopeAuthorityResolution";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
} from "../../../database/locatedTransactionIdentity";
import { getCommerceCommand, type CommerceCommand } from "../commands";
import { makeCommerceCommandContext } from "../context";
import { makeLogicalCommerceReadParticipant } from "../logicalParticipant";
import { requireLogicalCommerceReadInitialization } from "../logicalInitialization";
import {
  decodeCommerceInitialization,
  decodeCommerceReadInitializationDigest,
} from "../initializationContract";
import { commerceError, commerceLimits, type CommerceTransactionError } from "../model";
import { captureCommerceJsonData, projectCommerceRequestFailure } from "../request";
import { captureCommerceResources, defaultCommerceResources } from "../resources";

import type { CommerceReadHostInput } from "./configuration";
export type { CommerceReadHostInput } from "./configuration";

/** A direct reader has no mutation, initialization or request-key capability. */
export interface CommerceReadHost {
  readonly read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
  readonly close: Effect.Effect<void>;
}

export const makeCommerceReadHost = Effect.fn("CommerceReadHost.make")(function* <Failure>(
  input: CommerceReadHostInput<Failure>,
): Effect.fn.Return<CommerceReadHost, CommerceTransactionError> {
  const retained = yield* retainPreparedHost(input.hostRuntime, composeCommerceReadHost(input))
    .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
  return Object.freeze({ close: retained.close,
    read: (command, args) => retained.use(host => host.read(command, args))
      .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure)))),
  } satisfies CommerceReadHost);
});

const composeCommerceReadHost = Effect.fn("CommerceReadHost.compose")(function* <Failure>(
  input: CommerceReadHostInput<Failure>,
): Effect.fn.Return<Omit<CommerceReadHost, "close">, CommerceTransactionError> {
  const { database, session, target, deploymentId, scopeId, application, installation, authority: authorityInput } = input;
  if (!hasRelationalSessionDatabase(session, database) || !hasFrameworkSchemaTargetDatabase(target, database) ||
    !hasApplicationBindingComposition(application, authorityInput)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const authority = captureExactTrustedScopeAuthorityResolutionPorts(authorityInput);
  const allowed = new Set(input.commands);
  const names = new Set<string>();
  if (allowed.size === 0 || allowed.size > commerceLimits.commandDefinitions) return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const token of allowed) {
    const command = getCommerceCommand(token);
    if (command === undefined || command.mode !== "read" || !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(command.name) ||
      names.has(command.name)) return yield* Effect.fail(commerceError("invalidAuthority"));
    names.add(command.name);
  }
  const capturedResources = input.logicalResources === undefined ? undefined : captureCommerceResources(input.logicalResources);
  const selection = input.logicalStorage;
  const capturedInitialization = decodeCommerceInitialization(selection.initialization);
  const contractSha256 = yield* Effect.fromResult(decodeCommerceReadInitializationDigest(selection.initialization.contractSha256))
    .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  const source = Object.freeze({ sourceKey: selection.source.sourceKey,
    sourceSha256: selection.source.sourceSha256, writeProfile: selection.source.writeProfile });
  const schemaVersionId = selection.schemaVersionId;
  const capturedPolicy = captureCommerceJsonData(input.identityAndAccessPolicy, commerceLimits.rowBytes);
  const resources = capturedResources === undefined ? defaultCommerceResources : yield* Effect.fromResult(capturedResources);
  const initialization = yield* Effect.fromResult(capturedInitialization)
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const policy = yield* Effect.fromResult(capturedPolicy);
  yield* chargeHostPreparation({ deploymentId, scopeId, commands: [...names], policy: policy.value, resources, source,
    initialization, contractSha256 })
    .pipe(Effect.mapError(projectCommerceRequestFailure));
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId, scopeId }, authority)
    .pipe(Effect.mapError(projectCommerceRequestFailure));
  if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const transaction = yield* prepareStandaloneReadTransaction({ database, installation, deploymentId, scopeId,
    physicalLocator: located.authority.physicalLocator, sourceInitialization: { sourceKey: source.sourceKey,
      stepId: initialization.stepId } }).pipe(Effect.mapError(projectCommerceRequestFailure));
  const ports = Object.freeze({ controlDb: database,
    controlInstallation: transaction.references.controlInstallation });
  const prepared = yield* prepareLogicalRelationalReadAdmission(ports,
    { deploymentId, scopeId: located.authority.scopeId, schemaVersionId }, source).pipe(Effect.mapError(projectCommerceRequestFailure));
  const binding = yield* prepareStandaloneApplicationBindingSelection(application).pipe(Effect.mapError(projectCommerceRequestFailure));
  const owner = Object.freeze({ hostId: Symbol("commerce.readHost") });
  const read = Effect.fn("CommerceReadHost.read")(function* (token: CommerceCommand, args: Json) {
    if (!allowed.has(token)) return yield* Effect.fail(commerceError("invalidAuthority"));
    const captured = yield* Effect.fromResult(captureCommerceJsonData(args, resources.commandBytes));
    return yield* runCoLocatedRelationalReadSession(session, installation, transaction.enter, (tx, current) =>
      transaction.withSnapshot(tx, current, () => Effect.scoped(Effect.gen(function* () {
      return yield* prepared.withReadAdmission(binding, tx, current.authority, current.clock, admission => Effect.gen(function* () {
        yield* requireLogicalCommerceReadInitialization(admission, tx, initialization, contractSha256);
        const id = crypto.randomUUID();
        const lifetime = yield* makeBoundedRequestLifetime(commerceError, { ...commerceLimits, ...resources },
          owner, Object.freeze({ requestId: Symbol("commerce.readRequest") }), id, "read");
        return yield* Effect.gen(function* () {
          yield* lifetime.fromResult(lifetime.charge(captured.bytes));
          const working = yield* makeLogicalCommerceReadParticipant(admission, tx, lifetime, id, resources);
          const refuseEvent = (context: BoundedRequestContext) =>
            lifetime.operation(context, id, "write", Effect.fail(commerceError("unadmittedEvent")));
          const invoke = Effect.fn("CommerceReadHost.invoke")(function* (
            context: BoundedRequestContext, command: CommerceCommand, inputArgs: Json,
          ): Effect.fn.Return<Json, CommerceTransactionError> {
            const definition = getCommerceCommand(command);
            if (definition === undefined || definition.mode !== "read" || !allowed.has(command))
              return yield* Effect.fail(commerceError("invalidAuthority"));
            const commandInput = yield* Effect.fromResult(captureCommerceJsonData(inputArgs, lifetime.remainingBytes()));
            yield* lifetime.fromResult(lifetime.charge(commandInput.bytes));
            const output = yield* definition.run(makeCommerceCommandContext(lifetime, working, id, context, invoke, refuseEvent), commandInput.value);
            const result = yield* Effect.fromResult(captureCommerceJsonData(output, lifetime.remainingBytes()));
            yield* lifetime.fromResult(lifetime.charge(result.bytes));
            return result.value;
          });
          const value = yield* invoke(lifetime.context, token, captured.value);
          const result = yield* Effect.fromResult(canonicalizeJsonOutcome(value, resources.commandBytes)).pipe(Effect.mapError(projectCommerceRequestFailure));
          return result.valueJson;
        }).pipe(lifetime.withinDeadline, Effect.tap(() => lifetime.seal), Effect.ensuring(lifetime.close));
      }));
    }))));
  });
  return Object.freeze({
    read: (command, args) => read(command, args).pipe(Effect.mapError(projectCommerceRequestFailure)),
  });
});
