import { getCommerceCommand, type CommerceCommand, type CommerceCommandContext, type CommerceHost } from "./commands";
export { defineCommerceCommand } from "./commands";
export type { CommerceCommand, CommerceCommandContext, CommerceHost } from "./commands";
import { Cause, Effect, Exit, Schema } from "effect";
import { sql } from "drizzle-orm";
import type { Json } from "flarex-protocol/json";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema, TransactionFunctionPathV1Schema, TransactionIdentityAccessPolicySha256V1Schema, TransactionRequestSha256V1Schema } from "flarex-protocol/transaction-session";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { capturePrivateCanonicalValue } from "../frameworkSchema/privateCanonicalValue";
import { isSyntheticBindingReference } from "../frameworkSchema/binding/canonical";
import type { InstallationBindingReference } from "../frameworkSchema/binding/model";
import { capturePrivateJsonData } from "../privateJsonData";
import { makeBoundedRequestLifetime, type BoundedRequestContext } from "../boundedRequestLifetime";
import { hasApplicationBindingComposition, type ApplicationBindingSelectionReader } from "../applicationActivation";
import type { FlarexMetadataDatabase } from "../deployments";
import { captureTrustedScopeAuthorityResolutionPorts, resolveLocatedTrustedScopeAuthorityEffect, type TrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1, type LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";
import { hasFrameworkMigrationTargetDatabase, type FrameworkMigrationTarget } from "../migrationCoordination/targetSession";
import { lockScopeClockForShareInTransactionEffect, lockScopeClockForUpdateInTransactionEffect } from "../scopeClock";
import { hasRelationalSessionDatabase, runRelationalSession, type RelationalSession } from "../relationalTransaction/session";
import { RelationalSessionError } from "../relationalTransaction/model";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { createCommittedPointOutcomeResolverV1, CommittedPointOutcomeRequestKeyReuseErrorV1, CommittedPointOutcomeCorruptionErrorV1 } from "../committedPointOutcome";
import { finalizeCommerceCommit } from "../pointCommitTransaction";
import { withCommerceAdmission, requireCommerceAdmission } from "./admission";
import { makeCommerceStore, type RelationalRowFact, type CommerceLifecycleObservation } from "./store";
import { requireCommerceProfile, type CommerceProfile } from "./profile";
import { commerceError, commerceLimits, CommerceTransactionError } from "./model";

export interface CommerceHostInput<Failure> {
  readonly database: FlarexMetadataDatabase;
  readonly session: RelationalSession;
  readonly target: FrameworkMigrationTarget;
  readonly deploymentId: string;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly application: ApplicationBindingSelectionReader<Failure>;
  readonly profile: CommerceProfile;
  readonly installation: InstallationBindingReference;
  readonly identityAndAccessPolicy: Json;
  readonly commands: readonly CommerceCommand[];
}
const hash = makeLivePrivateSha256V1({ invalidBudget: () => commerceError("limitExceeded"), invalidBytes: () => commerceError("invalidInput"),
  inputBytesExceeded: () => commerceError("limitExceeded"), unavailable: () => commerceError("resourceFailure"),
  nativeRejected: cause => commerceError("resourceFailure", cause), invalidDigestOutput: () => new Error("Invalid commerce digest") });
const sha = (bytes: Uint8Array) => hash(bytes, { maximumInputBytes: commerceLimits.commandBytes });
const decodeKey = Schema.decodeUnknownResult(TransactionRequestKeyV1Schema);
const projectFailure = (cause: unknown): CommerceTransactionError => {
  if (cause instanceof CommerceTransactionError) return cause;
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1) return commerceError("requestConflict", cause);
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1) return commerceError("storedCorruption", cause);
  if (cause instanceof RelationalSessionError) return commerceError(cause.reason === "decisionUncertain" ? "decisionUncertain" : "resourceFailure", cause);
  return commerceError("invalidAuthority", cause);
};

export const makeCommerceHost = Effect.fn("CommerceHost.make")(<Failure>(input: CommerceHostInput<Failure>) => makeHost(input));

/** Source-private conformance composition; never exported by the commerce facade. */
export interface LocalCommerceEventPolicy {
  readonly capture: (event: unknown) => Effect.Effect<Json, CommerceTransactionError>;
  readonly validate: (events: readonly Json[], rows: readonly RelationalRowFact[], commandName: string, lifecycle?: readonly CommerceLifecycleObservation[]) => Effect.Effect<void, CommerceTransactionError>;
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

const makeHost = Effect.fn("CommerceHost.compose")(function* <Failure>(input: CommerceHostInput<Failure>, local?: LocalComposition): Effect.fn.Return<CommerceHost, CommerceTransactionError> {
  const { database, session, target, deploymentId, application, profile } = input;
  if (!hasRelationalSessionDatabase(session, database) || !hasFrameworkMigrationTargetDatabase(target, database) ||
    !hasApplicationBindingComposition(application, input.authority)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const descriptor = yield* requireCommerceProfile(profile);
  if (descriptor.localOnly !== (local !== undefined)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const capturedReference = yield* Effect.fromResult(capturePrivateJsonData(input.installation, commerceLimits.rowBytes, commerceError));
  if (!isSyntheticBindingReference(capturedReference.value)) return yield* Effect.fail(commerceError("invalidInput"));
  const reference = capturedReference.value;
  const authority = captureTrustedScopeAuthorityResolutionPorts(input.authority);
  const allowed = new Set(input.commands);
  const names = new Set<string>();
  for (const token of allowed) {
    const command = getCommerceCommand(token);
    if (command === undefined || !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(command.name) || command.name === "initialize" || names.has(command.name) || allowed.size > commerceLimits.calls) return yield* Effect.fail(commerceError("invalidAuthority"));
    names.add(command.name);
  }
  const policy = yield* Effect.fromResult(capturePrivateJsonData(input.identityAndAccessPolicy, commerceLimits.rowBytes, commerceError));
  const identityBytes = yield* canonicalizeSuccessfulResultV1Effect(policy.value).pipe(Effect.mapError(projectFailure));
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(yield* sha(identityBytes.canonicalBytes));
  const owner = Object.freeze({ hostId: Symbol("commerce.host") });
  const execute = Effect.fn("CommerceHost.execute")(function* (requestKey: string | null, token: CommerceCommand | null, args: Json) {
    const root = token === null ? undefined : getCommerceCommand(token);
    const bootstrap = token === null;
    if (!bootstrap && (root === undefined || !allowed.has(token) || (requestKey === null ? root.mode !== "read" : root.mode !== "write"))) return yield* Effect.fail(commerceError("invalidAuthority"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(args, commerceLimits.commandBytes, commerceError));
    const key = requestKey === null ? null : yield* Effect.fromResult(decodeKey(requestKey)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    if (key !== null && !/^commerce\/[a-zA-Z0-9/-]{1,110}$/.test(key)) return yield* Effect.fail(commerceError("invalidInput"));
    if (bootstrap) {
      if (descriptor.initialization === null) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const data = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: captured.value }, commerceLimits.commandBytes,
        { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
      if (!Array.isArray(captured.value) || captured.value.length !== descriptor.initialization.expectedRowCount || data.sha256Hex !== descriptor.initialization.datasetSha256) return yield* Effect.fail(commerceError("seedMismatch"));
    }
    let pendingEvents: readonly Json[] = [];
    const attempt = Effect.fn("CommerceHost.attempt")(function* (recoverOnly: boolean) {
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authority);
      if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database)) return yield* Effect.fail(commerceError("invalidAuthority"));
      const active = yield* application.readActive();
      return yield* runRelationalSession(session, tx => Effect.scoped(Effect.gen(function* () {
        yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`), cause => commerceError("statementFailure", cause));
        const clock = yield* (key === null ? lockScopeClockForShareInTransactionEffect(tx, located.authority.scopeId) : lockScopeClockForUpdateInTransactionEffect(tx, located.authority.scopeId));
        return yield* withCommerceAdmission(profile, target, reference, active.selection, tx, located.authority, clock, bootstrap, admission => Effect.gen(function* () {
          const admitted = yield* requireCommerceAdmission(admission);
          const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(located.authority.scopeId)).pipe(Effect.mapError(projectFailure));
          const evidence = yield* canonicalizeSuccessfulResultV1Effect({ domain: "flarex.private.commerce-command", version: 1,
            deploymentId, scopeId: located.authority.scopeId, epoch: clock.epoch, generation: clock.storageGeneration,
            fence: clock.storageGenerationFence.toString(), installation: reference, bindingHead: admitted.head,
            contractSha256: descriptor.contractSha256, operation: root?.name ?? "initialize", args: captured.value });
          const lookup = key === null ? null : { scopeUuid: scope.scopeUuid, requestKey: key, expectedIdentityAccessPolicySha256: identityDigest,
            expectedFunctionPath: TransactionFunctionPathV1Schema.make(`__flarex_private_commerce/${root?.name ?? "initialize"}`),
            expectedRequestSha256: TransactionRequestSha256V1Schema.make(yield* sha(evidence.canonicalBytes)) };
          if (lookup !== null) {
            const retained = yield* createCommittedPointOutcomeResolverV1(tx).resolve(lookup);
            if (retained.kind === "available") return retained.successfulResult.valueJson;
            if (retained.kind === "expired") return yield* Effect.fail(commerceError("resultUnavailable"));
            if (recoverOnly) return yield* Effect.fail(commerceError("decisionUncertain"));
          }
          const id = crypto.randomUUID();
          const lifetime = yield* makeBoundedRequestLifetime(commerceError, commerceLimits, owner, Object.freeze({ requestId: Symbol("commerce.request") }), id, bootstrap ? "write" : root?.mode ?? "read");
          return yield* Effect.gen(function* () {
            yield* Effect.fromResult(lifetime.charge(evidence.canonicalBytes.byteLength));
            const working = yield* makeCommerceStore(admission, lifetime, id);
            const events: Json[] = [];
            const captureEvent = (manager: BoundedRequestContext, event: unknown) => lifetime.operation(manager, id, "write", Effect.gen(function* () {
              if (local === undefined) return yield* Effect.fail(commerceError("unadmittedEvent"));
              if (events.length >= commerceLimits.calls) return yield* Effect.fail(commerceError("limitExceeded"));
              const message = yield* local.capture(event);
              const capturedEvent = yield* Effect.fromResult(capturePrivateJsonData(message, commerceLimits.rowBytes, commerceError));
              yield* Effect.fromResult(lifetime.charge(capturedEvent.bytes));
              events.push(capturedEvent.value);
            }));
            const invoke = Effect.fn("CommerceHost.invoke")(function* (context: BoundedRequestContext, command: CommerceCommand, inputArgs: Json): Effect.fn.Return<Json, CommerceTransactionError> {
              const definition = getCommerceCommand(command);
              if (definition === undefined || !allowed.has(command) || (key === null && definition.mode !== "read")) return yield* Effect.fail(commerceError("invalidAuthority"));
              const contextFor = (manager: BoundedRequestContext): CommerceCommandContext => Object.freeze({ manager, store: working.store,
                table: (tableId: string) => working.table(manager, tableId),
                captureLocalEvent: (event: unknown) => captureEvent(manager, event),
                nested: (child: CommerceCommand, childArgs: Json) => lifetime.nested(manager, id, next => invoke(next, child, childArgs), getCommerceCommand(child)?.mode),
                rejectEvent: lifetime.operation(manager, id, "write", Effect.fail(commerceError("unadmittedEvent"))),
                refuse: (error: CommerceTransactionError) => lifetime.operation(manager, id, "read", Effect.fail(error)),
                borrow: <Value>(work: (context: CommerceCommandContext) => Effect.Effect<Value, CommerceTransactionError>) => lifetime.nested(manager, id, child => work(contextFor(child))),
              });
              const commandInput = yield* Effect.fromResult(capturePrivateJsonData(inputArgs, lifetime.remainingBytes(), commerceError));
              yield* Effect.fromResult(lifetime.charge(commandInput.bytes));
              const output = yield* definition.run(contextFor(context), commandInput.value);
              const result = yield* Effect.fromResult(capturePrivateJsonData(output, lifetime.remainingBytes(), commerceError));
              yield* Effect.fromResult(lifetime.charge(result.bytes));
              return result.value;
            });
            let value: Json;
            if (bootstrap) {
              if (descriptor.initialization === null) return yield* Effect.fail(commerceError("unsupportedProfile"));
              const table = descriptor.layout.frame.tables[0];
              const firstKey = table?.keys.find(candidate => candidate.kind === "primary")?.columns.find(name => name !== "scope_uuid");
              const keyColumn = table?.columns.find(column => column.name === firstKey);
              if (keyColumn === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
              const existing = yield* working.store.count(lifetime.context, { order: { column: keyColumn.identity.columnId, direction: "asc" } });
              if (existing !== 0) return yield* Effect.fail(commerceError("seedMismatch"));
              const rows = yield* working.store.write(lifetime.context, "insert", captured.value);
              value = { rowCount: rows.length };
            } else {
              if (token === null) return yield* Effect.fail(commerceError("invalidAuthority"));
              value = yield* invoke(lifetime.context, token, captured.value);
            }
            const result = yield* canonicalizeSuccessfulResultV1Effect(value);
            yield* Effect.fromResult(lifetime.charge(bootstrap ? result.canonicalBytes.byteLength : 0));
            yield* lifetime.seal;
            if (local !== undefined) yield* local.validate(Object.freeze(events.slice()), working.snapshot(), root?.name ?? "initialize", working.lifecycleSnapshot());
            if (lookup !== null) yield* finalizeCommerceCommit(admission, lifetime, yield* working.close(), lookup, result, yield* sha(result.canonicalBytes));
            pendingEvents = Object.freeze(events.slice());
            return result.valueJson;
          }).pipe(Effect.timeoutOrElse({ duration: commerceLimits.commandMs, orElse: () => Effect.fail(commerceError("deadlineExceeded")) }), Effect.ensuring(lifetime.close));
        }));
      })));
    });
    const value = yield* attempt(false).pipe(Effect.catchCause(foreign => {
      const cause = Cause.map(foreign, projectFailure);
      const reason = cause.reasons[0];
      if (key !== null && cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason) && reason.error.reason === "decisionUncertain") {
        // Request identity and a reusable tentative commit sequence cannot prove
        // that a recovered outcome belongs to this buffer's attempt. A competing
        // identical request may have committed after this attempt rolled back.
        if (local !== undefined && pendingEvents.length > 0) {
          pendingEvents = [];
          local.record({ requestKey: key, outcome: Exit.fail(reason.error) });
        }
        return attempt(true).pipe(Effect.catchCause(recovery => Effect.failCause(Cause.combine(cause, Cause.map(recovery, projectFailure)))));
      }
      return Effect.failCause(cause);
    }));
    if (local !== undefined && key !== null && pendingEvents.length > 0) {
      const outcome = yield* Effect.exit(Effect.suspend(() => local.deliver(pendingEvents)).pipe(Effect.timeoutOrElse({ duration: commerceLimits.cleanupMs,
        orElse: () => Effect.fail(commerceError("deadlineExceeded")) })));
      local.record({ requestKey: key, outcome });
    }
    return value;
  });
  const initializationKey = yield* capturePrivateCanonicalValue({ installationSha256: reference.installation.installationSha256,
    contractSha256: descriptor.contractSha256 }, 4096, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  return Object.freeze({ newRequestKey: () => `commerce/${crypto.randomUUID()}`,
    read: (command, args) => execute(null, command, args), run: (key, command, args) => execute(key, command, args),
    initialize: rows => execute(`commerce/init/${initializationKey.sha256Hex}`, null, rows),
  } satisfies CommerceHost);
});
