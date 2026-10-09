import { makeCommerceCommandContext } from "./context";
import { runWithRequestRecovery } from "../relationalTransaction/requestRecovery";
import { getCommerceCommand, type CommerceCommand, type CommerceCommandContext, type CommerceHost } from "./commands";
export { defineCommerceCommand } from "./commands";
export type { CommerceCommand, CommerceCommandContext, CommerceHost } from "./commands";
import { Cause, Effect, Exit, Schema } from "effect";
import { chargeHostPreparation, retainPreparedHost } from "../preparedHostRuntime";
import { sql } from "drizzle-orm";
import type { Json } from "flarex-protocol/json";
import { canonicalizeJsonOutcome } from "../jsonOutcome";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema, TransactionFunctionPathV1Schema, TransactionIdentityAccessPolicySha256V1Schema, TransactionRequestSha256V1Schema } from "flarex-protocol/transaction-session";
import { capturePrivateCanonicalValue } from "../frameworkSchema/privateCanonicalValue";
import { isSyntheticBindingReference } from "../frameworkSchema/binding/canonical";
import type { InstallationBindingReference } from "../frameworkSchema/binding/model";
import { captureCommerceJsonData, lockCommerceRequest } from "./request";
import { makeBoundedRequestLifetime, type BoundedRequestContext } from "../boundedRequestLifetime";
import { hasApplicationBindingComposition, prepareCurrentApplicationBinding, invalidateAcceptedApplicationBindingInTransaction } from "../applicationActivation";
import { captureExactTrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import { hasFrameworkSchemaTargetDatabase } from "../frameworkSchema/target";
import { hasRelationalSessionDatabase, runRelationalSession, readRelationalSessionCoLocatedInstallation,
  startRelationalRequestDeadline, boundRelationalRequestDeadline } from "../relationalTransaction/session";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { createCommittedJsonOutcomeResolver } from "../committedPointOutcome";
import { finalizeCommerceCommit } from "./publication";
import { withCommerceAdmission, requireCommerceAdmission, enterCommercePublication, type CommerceAdmission } from "./admission";
import { prepareInstallationRuntime } from "../frameworkSchema/installation/runtime";
import { makeCommerceStore, type RelationalRowFact, type CommerceLifecycleObservation, type CommerceRowObservation } from "./store";
import { makeLogicalCommerceParticipant } from "./logicalParticipant";
import { hasLiveLogicalCommerceRows, requireLogicalCommerceInitialization } from "./logicalInitialization";
import { prepareLogicalRelationalAdmission, requireLogicalRelationalAdmission, type LogicalRelationalAdmission } from "../logicalDocuments/relationalAdmission";
import { requireCommerceProfile, type CommerceProfile } from "./profile";
import { captureCommerceResources, defaultCommerceResources, type CommerceResources } from "./resources";
import { captureLogicalCommerceSelection, prepareLogicalCommerceContract, type LogicalCommerceSelectionInput } from "./logicalSelection";
import { commerceError, commerceLimits, type CommerceTransactionError } from "./model";
import { commerceIdentityEvidence, commerceRequestHash as hash, projectCommerceRequestFailure } from "./request";
import { PhysicalSessionDeadlineIssue } from "../physicalSession/errors";

import type { CommerceHostConfiguration } from "./hostConfiguration";

export type PhysicalCommerceHostInput<Failure> = CommerceHostConfiguration<Failure> & Readonly<{
  commands: readonly CommerceCommand[];
  profile: CommerceProfile;
  installation: InstallationBindingReference;
  logicalStorage?: never;
  logicalResources?: never;
}>;
export type LogicalCommerceHostInput<Failure> = CommerceHostConfiguration<Failure> & Readonly<{
  commands: readonly CommerceCommand[];
  profile?: never;
  installation?: never;
  logicalStorage: LogicalCommerceSelectionInput;
  /** Trusted bounded logical request profile, included in host identity. */
  logicalResources?: CommerceResources;
}>;
export type CommerceHostInput<Failure> = PhysicalCommerceHostInput<Failure> | LogicalCommerceHostInput<Failure>;
const decodeKey = Schema.decodeUnknownResult(TransactionRequestKeyV1Schema);
const projectFailure = (cause: unknown) => cause instanceof PhysicalSessionDeadlineIssue ? commerceError("deadlineExceeded", cause) :
  projectCommerceRequestFailure(cause);

export const makeCommerceHost = Effect.fn("CommerceHost.make")(<Failure>(input: CommerceHostInput<Failure>) => makeHost(input));

/** Source-private conformance composition; never exported by the commerce facade. */
export interface LocalCommerceEventPolicy {
  readonly capture: (event: unknown) => Effect.Effect<Json, CommerceTransactionError>;
  readonly validate: (events: readonly Json[], rows: readonly RelationalRowFact[], commandName: string, lifecycle?: readonly CommerceLifecycleObservation[], observations?: readonly CommerceRowObservation[]) => Effect.Effect<void, CommerceTransactionError>;
  readonly deliver: (events: readonly Json[]) => Effect.Effect<void, CommerceTransactionError>;
}
export interface LocalCommerceDelivery {
  readonly requestKey: string;
  readonly outcome: Exit.Exit<void, CommerceTransactionError>;
}
interface LocalComposition extends LocalCommerceEventPolicy {
  readonly record: (delivery: LocalCommerceDelivery) => void;
}
export const makeLocalCommerceHost = Effect.fn("CommerceHost.makeLocal")(function* <Failure>(
  input: CommerceHostInput<Failure>, policy: LocalCommerceEventPolicy,
) {
  const results: LocalCommerceDelivery[] = [];
  const host = yield* makeHost(input, { capture: policy.capture, validate: policy.validate, deliver: policy.deliver,
    record: result => { if (results.length === 64) results.shift(); results.push(Object.freeze(result)); } });
  return Object.freeze({ host, takeDeliveries: () => Object.freeze(results.splice(0)) });
});

const makeHost = Effect.fn("CommerceHost.retain")(function* <Failure>(input: CommerceHostInput<Failure>, local?: LocalComposition): Effect.fn.Return<CommerceHost, CommerceTransactionError> {
  const retained = yield* retainPreparedHost(input.hostRuntime, composeCommerceHost(input, local)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
  return Object.freeze({ close: retained.close, newRequestKey: () => `commerce/${crypto.randomUUID()}`,
    run: (key, command, args) => retained.use(host => host.run(key, command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure)))),
    read: (command, args) => retained.use(host => host.read(command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure)))),
    initialize: rows => retained.use(host => host.initialize(rows)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure)))),
  } satisfies CommerceHost);
});

const composeCommerceHost = Effect.fn("CommerceHost.compose")(function* <Failure>(input: PhysicalCommerceHostInput<Failure> | LogicalCommerceHostInput<Failure>, local?: LocalComposition): Effect.fn.Return<Omit<CommerceHost, "close">, CommerceTransactionError> {
  const { database, session, target, deploymentId, scopeId, application } = input;
  if (!hasRelationalSessionDatabase(session, database) || !hasFrameworkSchemaTargetDatabase(target, database) ||
    !hasApplicationBindingComposition(application, input.authority)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const logicalResult = input.logicalStorage === undefined ? undefined : captureLogicalCommerceSelection(input.logicalStorage);
  const logicalSelection = logicalResult === undefined ? undefined : yield* Effect.fromResult(logicalResult);
  const logicalContract = logicalSelection === undefined ? undefined : yield* prepareLogicalCommerceContract(logicalSelection);
  const selectedLogicalResources = input.logicalResources === undefined ? undefined :
    yield* Effect.fromResult(captureCommerceResources(input.logicalResources));
  const physicalDescriptor = input.profile === undefined ? undefined : yield* requireCommerceProfile(input.profile);
  const descriptor = physicalDescriptor ?? (logicalContract === undefined || logicalSelection === undefined
    ? yield* Effect.fail(commerceError("invalidAuthority"))
    : Object.freeze({ contractSha256: logicalContract.sha256Hex, resources: selectedLogicalResources ?? defaultCommerceResources,
      localOnly: false, initialization: logicalSelection.initialization }));
  const resources = descriptor.resources;
  const sha = (bytes: Uint8Array) => hash(bytes, { maximumInputBytes: resources.commandBytes });
  if (descriptor.localOnly !== (local !== undefined)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const capturedReference = input.installation === undefined ? undefined : yield* Effect.fromResult(captureCommerceJsonData(input.installation, commerceLimits.rowBytes));
  const reference = capturedReference === undefined ? undefined : isSyntheticBindingReference(capturedReference.value)
    ? capturedReference.value : yield* Effect.fail(commerceError("invalidInput"));
  if (reference !== undefined) yield* chargeHostPreparation(reference).pipe(Effect.mapError(projectFailure));
  const authority = captureExactTrustedScopeAuthorityResolutionPorts(input.authority);
  const allowed = new Set(input.commands);
  const names = new Set<string>();
  for (const token of allowed) {
    const command = getCommerceCommand(token);
    if (command === undefined || !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(command.name) || command.name === "initialize" || names.has(command.name) || allowed.size > commerceLimits.commandDefinitions) return yield* Effect.fail(commerceError("invalidAuthority"));
    names.add(command.name);
  }
  const policy = yield* Effect.fromResult(captureCommerceJsonData(input.identityAndAccessPolicy, commerceLimits.rowBytes));
  const identityBytes = yield* commerceIdentityEvidence("policy", selectedLogicalResources === undefined ? policy.value :
    { policy: policy.value, logicalResources: selectedLogicalResources }, resources.commandBytes);
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(yield* sha(identityBytes.canonicalBytes));
  const installationRuntime = reference === undefined ? undefined : yield* prepareInstallationRuntime(database, target, reference).pipe(Effect.mapError(projectFailure));
  const owner = Object.freeze({ hostId: Symbol("commerce.host") });
  const preparation = yield* prepareCurrentApplicationBinding(application, database, (binding, context) => Effect.gen(function* () {
    if (logicalSelection === undefined) return undefined;
    return yield* prepareLogicalRelationalAdmission(logicalSelection.ports, logicalSelection.unique, {
      deploymentId, scopeId: context.authority.scopeId, schemaVersionId: logicalSelection.schemaVersionId,
    }, logicalSelection.source, { kind: "standalone", application: binding }).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
  }), {
    installation: yield* Effect.fromResult(readRelationalSessionCoLocatedInstallation(session, database)).pipe(Effect.mapError(projectFailure)) })
    .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
  const execute = Effect.fn("CommerceHost.execute")(function* (requestKey: string | null, token: CommerceCommand | null, args: Json) {
    const root = token === null ? undefined : getCommerceCommand(token);
    const bootstrap = token === null;
    if (!bootstrap && (root === undefined || !allowed.has(token) || (requestKey === null ? root.mode !== "read" : root.mode !== "write"))) return yield* Effect.fail(commerceError("invalidAuthority"));
    const captured = yield* Effect.fromResult(captureCommerceJsonData(args, resources.commandBytes));
    const key = requestKey === null ? null : yield* Effect.fromResult(decodeKey(requestKey)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    if (key !== null && !/^commerce\/[a-zA-Z0-9/-]{1,110}$/.test(key)) return yield* Effect.fail(commerceError("invalidInput"));
    if (bootstrap) {
      if (descriptor.initialization === null) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const data = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: captured.value }, resources.commandBytes,
        { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
      if (!Array.isArray(captured.value) || captured.value.length !== descriptor.initialization.expectedRowCount || data.sha256Hex !== descriptor.initialization.datasetSha256) return yield* Effect.fail(commerceError("seedMismatch"));
    }
    let pendingEvents: readonly Json[] = [];
    const deadline = yield* startRelationalRequestDeadline(commerceLimits.commandMs).pipe(Effect.mapError(projectFailure));
    const attempt = Effect.fn("CommerceHost.attempt")(function* (recoverOnly: boolean) {
      return yield* preparation.withEntry(({ binding: active, payload: preparedLogical }, enter) => runRelationalSession(session, key === null ? "snapshotRead" : "command", {
        enter: (tx, requireInstallation) => enter(tx, requireInstallation, Effect.gen(function* () {
        yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', ${`${commerceLimits.statementMs}ms`}, true), set_config('lock_timeout', ${`${commerceLimits.lockMs}ms`}, true)`), cause => commerceError("statementFailure", cause));
        // One exact request may be replayed through either retained storage
        // representation. Exclusion precedes admission and callback execution.
        if (key !== null) yield* lockCommerceRequest(tx, scopeId, key);
        }), ({ clock, authority: entryAuthority, checked }) => Effect.scoped(Effect.gen(function* () {
        const runAdmitted = Effect.fn("CommerceHost.runAdmitted")(function* (member:
          Readonly<{ kind: "physical"; admission: CommerceAdmission }> | Readonly<{ kind: "logical"; admission: LogicalRelationalAdmission }>) {
          const admitted = member.kind === "physical"
            ? { kind: "physical" as const, state: yield* requireCommerceAdmission(member.admission) }
            : { kind: "logical" as const, state: yield* requireLogicalRelationalAdmission(member.admission, tx).pipe(Effect.mapError(projectFailure)) };
          if (bootstrap && admitted.kind === "logical" && admitted.state.tables.length > 1 &&
            descriptor.initialization !== null && descriptor.initialization.expectedRowCount > 0)
            return yield* Effect.fail(commerceError("unsupportedProfile"));
          const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(entryAuthority.scopeId)).pipe(Effect.mapError(projectFailure));
          if (member.kind === "logical" && !bootstrap) {
            const initialization = descriptor.initialization;
            if (initialization === null) return yield* Effect.fail(commerceError("unsupportedProfile"));
            yield* requireLogicalCommerceInitialization(member.admission, tx, initialization);
          }
          // Standalone reads have no durable replay identity. Fresh admission
          // owns authority; only durable requests construct command evidence.
          const evidence = member.kind === "logical" && key === null ? undefined : yield* commerceIdentityEvidence("command", {
            deploymentId, scopeId: entryAuthority.scopeId, epoch: clock.epoch, generation: clock.storageGeneration,
            fence: clock.storageGenerationFence.toString(),
            ...(reference === undefined ? { logicalSource: logicalContract?.sha256Hex } : { installation: reference }),
            bindingHead: admitted.state.head,
            contractSha256: descriptor.contractSha256, operation: root?.name ?? "initialize", args: captured.value }, resources.commandBytes);
          const lookup = key === null || evidence === undefined ? null : { scopeUuid: scope.scopeUuid, requestKey: key, expectedIdentityAccessPolicySha256: identityDigest,
            expectedFunctionPath: TransactionFunctionPathV1Schema.make(`__flarex_private_commerce/${root?.name ?? "initialize"}`),
            expectedRequestSha256: TransactionRequestSha256V1Schema.make(yield* sha(evidence.canonicalBytes)) };
          if (lookup !== null) {
            if (member.kind === "physical") yield* enterCommercePublication([member.admission]);
            const retained = yield* createCommittedJsonOutcomeResolver(tx).resolve(lookup);
            if (retained.kind === "available") return retained.successfulResult.valueJson;
            if (retained.kind === "expired") return yield* Effect.fail(commerceError("resultUnavailable"));
            if (recoverOnly) return yield* Effect.fail(commerceError("decisionUncertain"));
          }
          const id = crypto.randomUUID();
          const lifetime = yield* makeBoundedRequestLifetime(commerceError, { ...commerceLimits, ...resources }, owner, Object.freeze({ requestId: Symbol("commerce.request") }), id, bootstrap ? "write" : root?.mode ?? "read");
          return yield* Effect.gen(function* () {
            yield* Effect.fromResult(lifetime.charge(evidence?.canonicalBytes.byteLength ?? captured.bytes));
            const selected = member.kind === "physical"
              ? { kind: "physical" as const, admission: member.admission, working: yield* makeCommerceStore(member.admission, lifetime, id) }
              : { kind: "logical" as const, working: yield* makeLogicalCommerceParticipant(member.admission, tx, lifetime, lifetime.context, id,
                false, selectedLogicalResources) };
            const working = selected.working;
            const events: Json[] = [];
            const captureEvent = (manager: BoundedRequestContext, event: unknown) => lifetime.operation(manager, id, "write", Effect.gen(function* () {
              if (local === undefined) return yield* Effect.fail(commerceError("unadmittedEvent"));
              if (events.length >= resources.eventMessages) return yield* Effect.fail(commerceError("limitExceeded"));
              const message = yield* local.capture(event);
              const capturedEvent = yield* Effect.fromResult(captureCommerceJsonData(message, commerceLimits.rowBytes));
              yield* Effect.fromResult(lifetime.charge(capturedEvent.bytes));
              events.push(capturedEvent.value);
            }));
            const invoke = Effect.fn("CommerceHost.invoke")(function* (context: BoundedRequestContext, command: CommerceCommand, inputArgs: Json,
              rootInvocation = false): Effect.fn.Return<Json, CommerceTransactionError> {
              const definition = getCommerceCommand(command);
              if (definition === undefined || !allowed.has(command) || (key === null && definition.mode !== "read")) return yield* Effect.fail(commerceError("invalidAuthority"));
              const contextFor = (manager: BoundedRequestContext) => makeCommerceCommandContext(lifetime, working, id, manager, invoke, captureEvent);
              const commandInput = yield* Effect.fromResult(captureCommerceJsonData(inputArgs, lifetime.remainingBytes()));
              yield* Effect.fromResult(lifetime.charge(commandInput.bytes));
              const output = yield* definition.run(contextFor(context), commandInput.value);
              if (rootInvocation) yield* lifetime.seal;
              const result = yield* Effect.fromResult(captureCommerceJsonData(output, lifetime.remainingBytes()));
              yield* Effect.fromResult(lifetime.charge(result.bytes));
              return result.value;
            });
            let value: Json;
            if (bootstrap) {
              if (descriptor.initialization === null) return yield* Effect.fail(commerceError("unsupportedProfile"));
              if (member.kind === "logical") {
                if (yield* hasLiveLogicalCommerceRows(member.admission, tx)) return yield* Effect.fail(commerceError("seedMismatch"));
              } else {
                const keyColumnId = physicalDescriptor?.layout.frame.tables[0]?.columns.find(column => column.name ===
                  physicalDescriptor.layout.frame.tables[0]?.keys.find(candidate => candidate.kind === "primary")?.columns.find(name => name !== "scope_uuid"))?.identity.columnId;
                if (keyColumnId === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
                if ((yield* working.store.count(lifetime.context, { order: { column: keyColumnId, direction: "asc" } })) !== 0)
                  return yield* Effect.fail(commerceError("seedMismatch"));
              }
              const rows = yield* working.store.write(lifetime.context, "insert", captured.value);
              value = { rowCount: rows.length };
            } else {
              if (token === null) return yield* Effect.fail(commerceError("invalidAuthority"));
              value = yield* invoke(lifetime.context, token, captured.value, true);
            }
            const result = yield* Effect.fromResult(canonicalizeJsonOutcome(value, resources.commandBytes)).pipe(Effect.mapError(projectFailure));
            yield* Effect.fromResult(lifetime.charge(bootstrap ? result.canonicalBytes.byteLength : 0));
            if (bootstrap) yield* lifetime.seal;
            if (local !== undefined && selected.kind === "physical") yield* local.validate(Object.freeze(events.slice()), selected.working.snapshot(), root?.name ?? "initialize", selected.working.lifecycleSnapshot(), selected.working.observationSnapshot());
            if (lookup !== null) {
              const resultHash = yield* sha(result.canonicalBytes);
              invalidateAcceptedApplicationBindingInTransaction(tx);
              if (selected.kind === "physical") yield* finalizeCommerceCommit({ kind: "physical", admission: selected.admission,
                closure: yield* selected.working.close(), additional: [] }, lifetime, lookup, result, resultHash);
              else yield* finalizeCommerceCommit({ kind: "logical", closure: yield* selected.working.close(),
                ...(bootstrap && descriptor.initialization !== null ? { initialization: { ...descriptor.initialization,
                  contractSha256: descriptor.contractSha256 } } : {}) }, lifetime, lookup, result, resultHash);
            }
            pendingEvents = Object.freeze(events.slice());
            return result.valueJson;
          }).pipe(Effect.timeoutOrElse({ duration: commerceLimits.commandMs, orElse: () => Effect.fail(commerceError("deadlineExceeded")) }), Effect.ensuring(lifetime.close));
        });
        if (reference !== undefined && input.profile !== undefined)
          return yield* withCommerceAdmission(input.profile, target, reference, active, tx, entryAuthority, clock, bootstrap,
            installationRuntime, admission => runAdmitted({ kind: "physical", admission }), checked);
        if (preparedLogical !== undefined)
          return yield* (key === null
            ? preparedLogical.withReadAdmission(active, tx, entryAuthority, clock,
              admission => runAdmitted({ kind: "logical", admission }), checked)
            : preparedLogical.withAdmission(active, tx, entryAuthority, clock,
              admission => runAdmitted({ kind: "logical", admission }), checked));
        return yield* Effect.fail(commerceError("invalidAuthority"));
      })), bootstrap ? "update" : "snapshotRead"),
      }, deadline));
    });
    const value = yield* boundRelationalRequestDeadline(deadline, runWithRequestRecovery(attempt, {
      hasRequestKey: key !== null,
      projectFailure,
      isDecisionUncertain: error => error.reason === "decisionUncertain",
      beforeRecovery: error => {
        // A competing identical request may supply the retained outcome. Its
        // result cannot authenticate this attempt's local delivery buffer.
        if (local !== undefined && key !== null && pendingEvents.length > 0) {
          pendingEvents = [];
          local.record({ requestKey: key, outcome: Exit.fail(error) });
        }
      },
    })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
    if (local !== undefined && key !== null && pendingEvents.length > 0) {
      const outcome = yield* Effect.exit(Effect.suspend(() => local.deliver(pendingEvents)).pipe(Effect.timeoutOrElse({ duration: commerceLimits.cleanupMs,
        orElse: () => Effect.fail(commerceError("deadlineExceeded")) })));
      local.record({ requestKey: key, outcome });
    }
    return value;
  });
  const logicalSourceSha256 = logicalContract?.sha256Hex;
  const initializationIdentity = reference !== undefined
    ? { installationSha256: reference.installation.installationSha256, contractSha256: descriptor.contractSha256 }
    : logicalSourceSha256 === undefined ? yield* Effect.fail(commerceError("invalidAuthority"))
      : { logicalSourceSha256, contractSha256: descriptor.contractSha256 };
  const initializationKeySha256 = (yield* capturePrivateCanonicalValue(initializationIdentity,
    4096, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) })).sha256Hex;
  yield* chargeHostPreparation({ deploymentId, commands: [...names], identityDigest, initializationKeySha256 })
    .pipe(Effect.mapError(projectFailure));
  return Object.freeze({ newRequestKey: () => `commerce/${crypto.randomUUID()}`,
    read: (command, args) => execute(null, command, args), run: (key, command, args) => execute(key, command, args),
    initialize: rows => execute(`commerce/init/${initializationKeySha256}`, null, rows),
  } satisfies Omit<CommerceHost, "close">);
});
