import { getCmsCommand, type CmsCommand } from "./commands";
import { projectCmsRequestFailure } from "./failure";
import type { CmsHostConfiguration } from "./hostConfiguration";
import type { CmsHostTestHooks } from "./testSupport";
import type { FlarexMetadataDatabase } from "../deployments";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";
import { makeCmsCommandContext } from "./context";
import { decodeCmsRequestBudget, defaultCmsRequestBudget, type CmsRequestBudget } from "../frameworkExecutionPolicy";
import { runWithRequestRecovery } from "../relationalTransaction/requestRecovery";
import { prepareCmsRelations, makeCmsRelations, type CmsRelations } from "./relations";
import { hasApplicationRelationReadPortAuthorityForControlDb, hasApplicationRelationReadPortAuthorityForPointCommit, type ApplicationRelationReadPort } from "../applicationRelationRead";
import { hasFrameworkSchemaTargetDatabase, type FrameworkSchemaTarget } from "../frameworkSchema/target";
import { Clock, Cause, Effect, Option, Schema } from "effect";
import { sql } from "drizzle-orm";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { canonicalizeSuccessfulResultV1Effect, type CanonicalSuccessfulResultV1 } from "flarex-protocol/commit-protocol";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { Json } from "flarex-protocol/json";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema, TransactionFunctionPathV1Schema, TransactionIdentityAccessPolicySha256V1Schema, TransactionRequestSha256V1Schema } from "flarex-protocol/transaction-session";
import { capturePrivateJsonData } from "../privateJsonData";
import { prepareApplicationBindingSelection } from "../applicationActivation";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES } from "flarex-protocol/internal/logical-schema-candidate";
import { prepareLogicalDocumentSourceAdmission, requireLogicalDocumentSourceAdmission,
  type LogicalDocumentSourceAdmission } from "../logicalDocuments/documentAdmission";
import { captureExactTrustedScopeAuthorityResolutionPorts, resolveLocatedTrustedScopeAuthorityByIdEffect } from "../scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../transactionSessionAttemptKernel";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../scopeClock";
import { hasRelationalSessionDatabase, runRelationalSession } from "../relationalTransaction/session";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { createCommittedPointOutcomeResolverV1 } from "../committedPointOutcome";
import { prepareCmsApplicationCommit, enterCmsApplicationCommit, enterSourceCmsCommit, type CmsMaterializationOptions } from "./publication";
import { prepareCmsApplication, prepareCmsPreferences, withCmsAdmission, requireCmsAdmission, type CmsAdmission } from "./admission";
import { makeCmsRequestLifetime } from "./lifetime";
import { makeCmsDocuments, makeSourceCmsDocuments } from "./documents";
import { makePayloadPreferenceCleanup, type PayloadPreferenceCleanup } from "../payloadPreferences/cleanup";
import { cmsError, cmsLimits, type CmsTransactionError, type CmsRequestContext, type CmsPresentedTransactionId } from "./model";
import { chargeHostPreparation, retainPreparedHost } from "../preparedHostRuntime";

const contentDigest = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{64}$/.test(value) ? undefined : "Expected SHA-256"));
const decodeContentIdentity = Schema.decodeUnknownEffect(Schema.Struct({ configSha256: contentDigest, provenanceSha256: contentDigest }));
const decodeRequestKey = Schema.decodeUnknownResult(TransactionRequestKeyV1Schema);

export interface CmsHostInput<Failure> extends CmsHostConfiguration<Failure> {
  readonly controlDatabase: FlarexMetadataDatabase;
  readonly pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1;
  readonly materialization: CmsMaterializationOptions;
  readonly relationReads?: ApplicationRelationReadPort;
  /** Exact preference binding required by the operation-specific cleanup port. */
  readonly payloadPreferenceTarget?: FrameworkSchemaTarget;
  readonly logicalStorage?: never;
}
/** Selected Payload source; the displaced host contract has named callers and a removal gate. */
export type SourceCmsHostInput<Failure> = Omit<CmsHostInput<Failure>, "pointCommitAuthority" | "logicalStorage"> &
  Readonly<{ pointCommitAuthority?: never; logicalStorage: Readonly<{
    ports: AppUniqueConstraintSetBuildPortsV1; unique: AppUniqueConstraintSetEligibilityPortV1;
    schemaVersionId: CatalogSchemaVersionId; source: unknown;
  }> }>;
export interface CmsHost {
  readonly requestBudget: CmsRequestBudget;
  readonly close: Effect.Effect<void>;
  readonly newRequestKey: () => string;
  readonly run: (requestKey: string, command: CmsCommand, args: Json) => Effect.Effect<Json, CmsTransactionError>;
  readonly read: (command: CmsCommand, args: Json) => Effect.Effect<Json, CmsTransactionError>;
}
const digestBytes = makeLivePrivateSha256V1({
  invalidBudget: () => cmsError("limitExceeded"), invalidBytes: () => cmsError("invalidInput"),
  inputBytesExceeded: () => cmsError("limitExceeded"), unavailable: () => cmsError("resourceFailure"),
  nativeRejected: cause => cmsError("resourceFailure", cause), invalidDigestOutput: () => new Error("Invalid CMS SHA-256 output"),
});
const sha256 = Effect.fn("CmsHost.sha256")((bytes: Uint8Array) => digestBytes(bytes, { maximumInputBytes: cmsLimits.commandBytes }));

const projectFailure = projectCmsRequestFailure;

export const makeCmsHost = Effect.fn("CmsHost.make")(function* <Failure>(
  input: CmsHostInput<Failure> | SourceCmsHostInput<Failure>, hooks?: CmsHostTestHooks,
): Effect.fn.Return<CmsHost, CmsTransactionError> {
  const selectedBudget = input.requestBudget;
  const requestBudget = Object.freeze(yield* Effect.fromResult(decodeCmsRequestBudget(selectedBudget === undefined ? defaultCmsRequestBudget : selectedBudget))
    .pipe(Effect.mapError(cause => cmsError("unsupportedProfile", cause))));
  const retained = yield* retainPreparedHost(input.hostRuntime,
    composeCmsHost(input, requestBudget, selectedBudget !== undefined, hooks))
    .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
  return Object.freeze({ requestBudget, close: retained.close, newRequestKey: () => `cms/${crypto.randomUUID()}`,
    run: (key, command, args) => retained.use(host => host.run(key, command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure)))),
    read: (command, args) => retained.use(host => host.read(command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure)))),
  } satisfies CmsHost);
});

const composeCmsHost = Effect.fn("CmsHost.compose")(function* <Failure>(
  input: CmsHostInput<Failure> | SourceCmsHostInput<Failure>,
  requestBudget: CmsRequestBudget, explicitBudget: boolean,
  hooks?: CmsHostTestHooks,
): Effect.fn.Return<Omit<CmsHost, "close" | "requestBudget">, CmsTransactionError> {
  const { database, session, deploymentId, scopeId, controlDatabase, application } = input;
  const pointCommitAuthority = "pointCommitAuthority" in input ? input.pointCommitAuthority : undefined;
  const logicalSelectionInput = input.logicalStorage;
  const logicalSelection = logicalSelectionInput === undefined ? undefined : Object.freeze({
    ports: Object.freeze({ controlDb: logicalSelectionInput.ports.controlDb,
      authority: logicalSelectionInput.ports.authority }),
    unique: logicalSelectionInput.unique, schemaVersionId: logicalSelectionInput.schemaVersionId,
    source: capturePrivateJsonData(logicalSelectionInput.source, MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES, cmsError),
  });
  const relationReads = input.relationReads;
  if (relationReads !== undefined && (pointCommitAuthority === undefined ||
    !hasApplicationRelationReadPortAuthorityForControlDb(relationReads, controlDatabase) ||
    !hasApplicationRelationReadPortAuthorityForPointCommit(relationReads, pointCommitAuthority))) return yield* Effect.fail(cmsError("invalidAuthority"));
  const compositionAuthority = input.authority;
  const preferenceTarget = input.payloadPreferenceTarget;
  if (preferenceTarget !== undefined && !hasFrameworkSchemaTargetDatabase(preferenceTarget, database)) return yield* Effect.fail(cmsError("invalidAuthority"));
  if (logicalSelection !== undefined && (preferenceTarget !== undefined || relationReads !== undefined))
    return yield* Effect.fail(cmsError("unsupportedProfile"));
  if (logicalSelection === undefined && pointCommitAuthority === undefined)
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const authority = captureExactTrustedScopeAuthorityResolutionPorts(input.authority);
  const expectedContentIdentity = input.expectedContentIdentity === undefined ? undefined :
    yield* decodeContentIdentity(input.expectedContentIdentity).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
  if (preferenceTarget !== undefined && expectedContentIdentity === undefined) {
    return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  const allowed = new Set(input.commands);
  const names = new Set<string>();
  if (!hasRelationalSessionDatabase(session, database) || allowed.size === 0 || allowed.size > cmsLimits.calls) {
    return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  for (const token of allowed) {
    const definition = getCmsCommand(token);
    if (definition === undefined || !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(definition.name) || names.has(definition.name)) {
      return yield* Effect.fail(cmsError("invalidAuthority"));
    }
    names.add(definition.name);
  }
  const identity = yield* Effect.fromResult(capturePrivateJsonData(input.identityAndAccessPolicy, cmsLimits.documentBytes, cmsError));
  const canonicalIdentity = yield* canonicalizeSuccessfulResultV1Effect(!explicitBudget ? identity.value :
    { policy: identity.value, requestBudget }).pipe(Effect.mapError(projectFailure));
  // A byte prefix distinguishes selected budgets from every old arbitrary JSON
  // policy, including an object with the same field names.
  const prefix = explicitBudget ? new TextEncoder().encode("flarex.cms.request-budget\0") : new Uint8Array();
  const identityBytes = new Uint8Array(prefix.byteLength + canonicalIdentity.canonicalBytes.byteLength);
  identityBytes.set(prefix);
  identityBytes.set(canonicalIdentity.canonicalBytes, prefix.byteLength);
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(yield* sha256(identityBytes));
  yield* chargeHostPreparation({ deploymentId, commands: [...names], identityDigest, requestBudget, expectedContentIdentity: expectedContentIdentity ?? null })
    .pipe(Effect.mapError(projectFailure));
  const preparedPreferences = preferenceTarget === undefined ? undefined : yield* prepareCmsPreferences(database, session, authority,
    deploymentId, scopeId, preferenceTarget).pipe(Effect.mapError(projectFailure));
  // A host owns one revision's immutable preparation. Every attempt still accepts
  // its live evidence below; a different revision requires a new host.
  const prepared = logicalSelection === undefined ? yield* prepareCmsApplication(application, compositionAuthority, controlDatabase, deploymentId, scopeId)
    .pipe(Effect.mapError(projectFailure)) : undefined;
  const logicalLocation = logicalSelection === undefined ? undefined :
    yield* resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId, scopeId }, authority).pipe(Effect.mapError(projectFailure));
  const preparedLogical = logicalSelection === undefined || logicalLocation === undefined ? undefined :
    yield* prepareLogicalDocumentSourceAdmission(logicalSelection.ports, logicalSelection.unique,
      { deploymentId, scopeId: logicalLocation.authority.scopeId, schemaVersionId: logicalSelection.schemaVersionId },
      (yield* Effect.fromResult(logicalSelection.source)).value, { kind: "standalone" }).pipe(Effect.mapError(projectFailure));
  const owner = Object.freeze({ hostId: Symbol("cms.host") });
  const materialization = Object.freeze({ ...input.materialization });
  const testHooks = hooks === undefined ? undefined : Object.freeze({ ...hooks });
  const execute = Effect.fn("CmsHost.execute")(function* (requestKey: string | null, token: CmsCommand, args: Json) {
    const root = getCmsCommand(token);
    if (root === undefined || !allowed.has(token) || (requestKey === null && root.mode !== "read")) return yield* Effect.fail(cmsError("invalidAuthority"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(args, requestBudget.commandBytes, cmsError));
    const key = requestKey === null ? null : yield* Effect.fromResult(decodeRequestKey(requestKey))
      .pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    if (key !== null && !/^cms\/[0-9a-f-]{36}$/.test(key)) return yield* Effect.fail(cmsError("invalidInput"));
    const transactionId = crypto.randomUUID();
    const requestIdentity = Object.freeze({ requestId: Symbol("cms.request") });
    const attempt = Effect.fn("CmsHost.attempt")(function* (recoverOnly: boolean) {
      // Both first entry and uncertain-decision recovery re-authenticate the target.
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId, scopeId }, authority);
      if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database)) return yield* Effect.fail(cmsError("invalidAuthority"));
      const commit = requestKey === null || prepared === undefined || pointCommitAuthority === undefined ? null :
        yield* prepareCmsApplicationCommit(prepared, controlDatabase, located.authority, pointCommitAuthority, materialization);
      const active = preparedLogical === undefined ? undefined : yield* prepareApplicationBindingSelection(application);
      return yield* runRelationalSession(session, requestKey === null ? "snapshotRead" : "command", tx => Effect.scoped(Effect.gen(function* () {
        yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', ${`${cmsLimits.statementMs}ms`}, true), set_config('lock_timeout', ${`${cmsLimits.lockMs}ms`}, true)`),
          cause => cmsError("statementFailure", cause));
        // Exclusion is scoped to the exact request, before admission or callbacks.
        // The hash is only a lock address; durable evidence still authenticates identity.
        if (key !== null) yield* runDrizzleStatementEffect(tx.execute(sql`select pg_advisory_xact_lock(
          hashtextextended(${JSON.stringify(["flarex.cms.request", located.authority.scopeId, key])}, 0))`),
          cause => cmsError("statementFailure", cause));
        const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, located.authority.scopeId);
        const runAdmitted = Effect.fn("CmsHost.runAdmitted")(function* (member:
          Readonly<{ kind: "application"; admission: CmsAdmission }> |
          Readonly<{ kind: "source"; admission: LogicalDocumentSourceAdmission }>) {
          const state = member.kind === "source"
            ? yield* requireLogicalDocumentSourceAdmission(member.admission, tx).pipe(Effect.mapError(projectFailure))
            : yield* requireCmsAdmission(member.admission);
          // Native join capabilities borrow this acceptance; no extra readiness transaction.
          const relations = member.kind === "application" && requestKey === null
            ? yield* prepareCmsRelations(member.admission, relationReads) : Option.none();
          const contentIdentity = "contentIdentity" in state ? state.contentIdentity : state.frame.payloadContent;
          if (expectedContentIdentity !== undefined && (contentIdentity?.configSha256 !== expectedContentIdentity.configSha256 ||
            contentIdentity.provenanceSha256 !== expectedContentIdentity.provenanceSha256)) return yield* Effect.fail(cmsError("invalidAuthority"));
          if (testHooks?.afterAdmission !== undefined) yield* testHooks.afterAdmission(tx);
          const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(located.authority.scopeId));
          // Source reads have no durable replay identity; avoid projecting the
          // entire binding frame solely to charge a nonexistent journal input.
          const evidence = member.kind === "source" && key === null ? undefined : yield* canonicalizeSuccessfulResultV1Effect({ domain: "flarex.private.cms-command", version: 1,
            deploymentId, scopeId: located.authority.scopeId, epoch: clock.epoch, storageGeneration: clock.storageGeneration,
            fence: clock.storageGenerationFence.toString(), binding: state.frame, head: { sequence: state.head.sequence.toString(), sha256: state.head.sha256 },
            operation: root.name, args: captured.value });
          const lookup = key === null || evidence === undefined ? null : {
            scopeUuid: scope.scopeUuid, requestKey: key, expectedIdentityAccessPolicySha256: identityDigest,
            expectedFunctionPath: TransactionFunctionPathV1Schema.make(`__flarex_private_cms/${root.name}`),
            expectedRequestSha256: TransactionRequestSha256V1Schema.make(yield* sha256(evidence.canonicalBytes)),
          };
          if (lookup !== null) {
            const outcome = yield* createCommittedPointOutcomeResolverV1(tx).resolve(lookup);
            if (outcome.kind === "available") return outcome.successfulResult.valueJson;
            if (outcome.kind === "expired") return yield* Effect.fail(cmsError("resultUnavailable"));
            // Absence after COMMIT ambiguity is never permission to rerun callbacks.
            if (recoverOnly) return yield* Effect.fail(cmsError("decisionUncertain"));
          }
          const lifetime = yield* makeCmsRequestLifetime(owner, requestIdentity, transactionId, key === null ? "read" : root.mode, requestBudget);
          return yield* Effect.gen(function* () {
            yield* Effect.fromResult(lifetime.charge(captured.bytes + (evidence?.canonicalBytes.byteLength ?? 0)));
            const creationTime = AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis);
            const bundle = member.kind === "source" ? yield* Effect.gen(function* () {
              const participant = key === null ? null : yield* enterSourceCmsCommit(member.admission, tx, lifetime, materialization);
              const working = yield* makeSourceCmsDocuments(member.admission, tx, lifetime, creationTime, testHooks?.documentReads);
              const incoming: CmsRelations = Object.freeze({ incoming: (context: CmsRequestContext, id: CmsPresentedTransactionId) =>
                lifetime.operation(context, id, "read", Effect.fail(cmsError("unsupportedProfile"))) });
              const preferences: PayloadPreferenceCleanup = Object.freeze({ deleteForPendingDocument: (context: CmsRequestContext, id: CmsPresentedTransactionId) =>
                lifetime.operation(context, id, "write", Effect.fail(cmsError("unsupportedProfile"))) });
              const finalize = (actualLookup: NonNullable<typeof lookup>, value: CanonicalSuccessfulResultV1, digest: Uint8Array) =>
                participant === null ? Effect.fail(cmsError("invalidAuthority")) :
                  working.close().pipe(Effect.flatMap(closure => participant.finalize(closure, actualLookup, value, digest, testHooks)), Effect.asVoid);
              return Object.freeze({ documents: working.documents, incoming, preferences, finalize });
            }) : yield* Effect.gen(function* () {
              if (prepared === undefined || (key !== null && commit === null)) return yield* Effect.fail(cmsError("invalidAuthority"));
              const participant = commit === null ? null : yield* enterCmsApplicationCommit(commit, member.admission, lifetime);
              const working = yield* makeCmsDocuments(member.admission, lifetime, creationTime,
                participant?.uniqueDefinitions ?? prepared.uniqueDefinitions,
                participant?.indexDefinitions ?? prepared.indexDefinitions, testHooks?.documentReads);
              const incoming = yield* makeCmsRelations(relations, member.admission, lifetime, working.documents,
                key === null, testHooks?.observeIncomingQuery);
              const preferences = yield* makePayloadPreferenceCleanup(member.admission, lifetime, working.pendingDeletions);
              const finalize = (actualLookup: NonNullable<typeof lookup>, value: CanonicalSuccessfulResultV1, digest: Uint8Array) =>
                participant === null ? Effect.fail(cmsError("invalidAuthority")) :
                  working.close().pipe(Effect.flatMap(closure => preferences.close().pipe(Effect.flatMap(preferenceClosure =>
                    participant.finalize(closure, preferenceClosure, actualLookup, value, digest, testHooks)))), Effect.asVoid);
              return Object.freeze({ documents: working.documents, incoming, preferences: preferences.cleanup, finalize });
            });
            const invoke = Effect.fn("CmsHost.invoke")(function* (context: CmsRequestContext, child: CmsCommand, childArgs: Json): Effect.fn.Return<Json, CmsTransactionError> {
              const definition = getCmsCommand(child);
              if (definition === undefined || !allowed.has(child) || (key === null && definition.mode !== "read")) return yield* Effect.fail(cmsError("invalidAuthority"));
              const childInput = yield* Effect.fromResult(capturePrivateJsonData(childArgs, lifetime.remainingBytes(), cmsError));
              yield* Effect.fromResult(lifetime.charge(childInput.bytes));
              const commandContext = makeCmsCommandContext(lifetime, transactionId, context,
                { documents: bundle.documents, relations: bundle.incoming, preferences: bundle.preferences },
                key === null && context === lifetime.context, invoke);
              const value = yield* Effect.suspend(() => definition.run(commandContext, childInput.value));
              const output = yield* Effect.fromResult(capturePrivateJsonData(value, lifetime.remainingBytes(), cmsError));
              yield* Effect.fromResult(lifetime.charge(output.bytes));
              return output.value;
            });
            const value = yield* invoke(lifetime.context, token, captured.value);
            const result = yield* canonicalizeSuccessfulResultV1Effect(value);
            yield* Effect.fromResult(lifetime.charge(result.canonicalBytes.byteLength));
            const digest = member.kind === "source" && lookup === null ? undefined : yield* sha256(result.canonicalBytes);
            yield* lifetime.seal;
            if (lookup !== null && digest !== undefined) yield* bundle.finalize(lookup, result, digest);
            return result.valueJson;
          }).pipe(Effect.ensuring(lifetime.close));
        });
        if (prepared !== undefined) return yield* withCmsAdmission(prepared, tx, located.authority, clock,
          admission => runAdmitted({ kind: "application", admission }), preparedPreferences);
        if (preparedLogical !== undefined && active !== undefined) return yield* (key === null
          ? preparedLogical.withReadAdmission(active, tx, located.authority, clock,
            admission => runAdmitted({ kind: "source", admission }))
          : preparedLogical.withAdmission(active, tx, located.authority, clock,
            admission => runAdmitted({ kind: "source", admission })));
        return yield* Effect.fail(cmsError("invalidAuthority"));
      })));
    });
    return yield* runWithRequestRecovery(attempt, {
      hasRequestKey: key !== null,
      projectFailure,
      isDecisionUncertain: error => error.reason === "decisionUncertain",
    });
  });
  return Object.freeze({ newRequestKey: () => `cms/${crypto.randomUUID()}`,
    run: (key, command, args) => execute(key, command, args), read: (command, args) => execute(null, command, args) } satisfies Omit<CmsHost, "close" | "requestBudget">);
});
