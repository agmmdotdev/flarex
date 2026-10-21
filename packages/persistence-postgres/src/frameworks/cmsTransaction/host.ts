import { prepareCmsPreferences } from "../payloadPreferences/admission";
import { observeExecution, withExecutionDiagnosticDefaults } from "../../execution/diagnostics/operation";
import { getCmsCommand, type CmsCommand } from "./commands";
import { projectCmsRequestFailure } from "./failure";
import type { CmsHostConfiguration } from "./hostConfiguration";
import type { CmsHostTestHooks } from "./testSupport";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type {
  PointMutationSessionAuthorityResolutionPortsV1,
} from "../../execution/session/constructionContracts";
import { makeCmsCommandContext } from "./context";
import {
  decodeCmsRequestBudget,
  defaultCmsRequestBudget,
  type CmsRequestBudget,
} from "../../execution/preparation/frameworkExecutionPolicy";
import { runWithRequestRecovery } from "../../database/relationalTransaction/requestRecovery";
import { prepareCmsRelations, makeCmsRelations, type CmsRelations } from "./relations";
import {
  hasApplicationRelationReadPortAuthorityForControlDb,
  hasApplicationRelationReadPortAuthorityForPointCommit,
  type ApplicationRelationReadPort,
} from "../../application/relations/applicationRelationRead";
import {
  hasFrameworkSchemaTargetDatabase,
  type FrameworkSchemaTarget,
} from "../../installation/frameworkSchema/target";
import { Clock, Cause, Effect, Option, Schema } from "effect";
import { sql } from "drizzle-orm";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import {
  canonicalizeSuccessfulResultV1Effect,
  type CanonicalSuccessfulResultV1,
} from "flarex-protocol/commit-protocol";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { Json } from "flarex-protocol/json";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import {
  TransactionRequestKeyV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestSha256V1Schema,
} from "flarex-protocol/transaction-session";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import {
  prepareCurrentApplicationBinding,
} from "../../application/activation/currentBinding";
import {
  invalidateAcceptedApplicationBindingInTransaction,
} from "../../application/activation/acceptedBinding";
import {
  hasApplicationBindingComposition,
} from "../../application/activation/repositoryIdentity";
import type {
  AppUniqueConstraintSetBuildPortsV1,
  AppUniqueConstraintSetEligibilityPortV1,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES } from "flarex-protocol/internal/logical-schema-candidate";
import { prepareLogicalDocumentSourceAdmission, requireLogicalDocumentSourceAdmission,
  type LogicalDocumentSourceAdmission } from "../../storage/documents/logicalDocuments/documentAdmission";
import { captureExactTrustedScopeAuthorityResolutionPorts } from "../../scope/scopeAuthorityResolution";
import {
  hasRelationalSessionDatabase,
  runRelationalSession,
  readRelationalSessionCoLocatedInstallation,
  startRelationalRequestDeadline,
  boundRelationalRequestDeadline,
} from "../../database/relationalTransaction/session";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { createCommittedPointOutcomeResolverV1 } from "../../commit/committedPointOutcome";
import {
  prepareCmsApplicationCommit,
  enterCmsApplicationCommit,
  enterSourceCmsCommit,
  type CmsMaterializationOptions,
} from "./publication";
import {
  prepareCmsApplicationFromBinding,
  withCmsAdmission,
  requireCmsAdmission,
  type CmsAdmission,
} from "./admission";
import { makeCmsRequestLifetime } from "./lifetime";
import { makeCmsDocuments, makeSourceCmsDocuments } from "./documents";
import { makePayloadPreferenceCleanup, makePayloadPreferenceCleanupRecorder } from "../payloadPreferences/cleanup";
import {
  cmsError,
  cmsLimits,
  type CmsTransactionError,
  type CmsRequestContext,
  type CmsPresentedTransactionId,
} from "./model";
import { chargeHostPreparation, retainPreparedHost } from "../../execution/preparation/preparedHostRuntime";
import { prepareSourceCmsDocumentMaterialization } from "./contribution";
import { PhysicalSessionDeadlineIssue } from "../../database/physicalSession/errors";

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
const sha256 = Effect.fnUntraced(function* (bytes: Uint8Array) {
  return yield* digestBytes(bytes, { maximumInputBytes: cmsLimits.commandBytes });
}, work => observeExecution("CmsHost.sha256", work, "caller"));

const projectFailure = (cause: unknown) => cause instanceof PhysicalSessionDeadlineIssue ? cmsError("deadlineExceeded", cause) :
  projectCmsRequestFailure(cause);

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
    run: (key, command, args) => withExecutionDiagnosticDefaults(retained.use(host => host.run(key, command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))))),
    read: (command, args) => withExecutionDiagnosticDefaults(retained.use(host => host.read(command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))))),
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
  if (logicalSelection !== undefined && relationReads !== undefined)
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
  if (!hasApplicationBindingComposition(application, compositionAuthority)) return yield* Effect.fail(cmsError("invalidAuthority"));
  const owner = Object.freeze({ hostId: Symbol("cms.host") });
  const materialization = Object.freeze({ ...input.materialization });
  const currentPreparation = yield* prepareCurrentApplicationBinding(application, database, (binding, context) => Effect.gen(function* () {
    // Preference restoration belongs to this same replaceable generation. Its
    // availability head and complete evidence remain fresh at each admission.
    const preferences = preferenceTarget === undefined ? undefined : yield* prepareCmsPreferences(database, session, authority,
      deploymentId, scopeId, preferenceTarget).pipe(Effect.mapError(projectFailure));
    if (logicalSelection !== undefined) {
      const source = yield* prepareLogicalDocumentSourceAdmission(logicalSelection.ports, logicalSelection.unique,
        { deploymentId, scopeId: context.authority.scopeId, schemaVersionId: logicalSelection.schemaVersionId },
        (yield* Effect.fromResult(logicalSelection.source)).value, { kind: "standalone", application: binding }, preferences).pipe(
          Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
      const sourceTemplate = yield* prepareSourceCmsDocumentMaterialization(
        yield* source.lendPreparation().pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure)))), materialization).pipe(
          Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
      return Object.freeze({ kind: "source" as const, source, sourceTemplate });
    }
    if (pointCommitAuthority === undefined || context.planningHead === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
    const prepared = yield* prepareCmsApplicationFromBinding(binding, controlDatabase, deploymentId, scopeId);
    const commit = yield* prepareCmsApplicationCommit(prepared, controlDatabase, context.authority, pointCommitAuthority,
      materialization, context.planningHead);
    return Object.freeze({ kind: "application" as const, application: prepared, commit, preferences });
  }), { selection: { deploymentId, scopeId },
    installation: yield* Effect.fromResult(readRelationalSessionCoLocatedInstallation(session, database)).pipe(Effect.mapError(projectFailure)),
    ...(pointCommitAuthority === undefined ? {} : { candidateIssuer: pointCommitAuthority }) })
    .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
  const testHooks = hooks === undefined ? undefined : Object.freeze({ ...hooks });
  const execute = Effect.fnUntraced(function* (requestKey: string | null, token: CmsCommand, args: Json) {
    const root = getCmsCommand(token);
    if (root === undefined || !allowed.has(token) || (requestKey === null && root.mode !== "read")) return yield* Effect.fail(cmsError("invalidAuthority"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(args, requestBudget.commandBytes, cmsError));
    const key = requestKey === null ? null : yield* Effect.fromResult(decodeRequestKey(requestKey))
      .pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    if (key !== null && !/^cms\/[0-9a-f-]{36}$/.test(key)) return yield* Effect.fail(cmsError("invalidInput"));
    const transactionId = crypto.randomUUID();
    const requestIdentity = Object.freeze({ requestId: Symbol("cms.request") });
    const deadline = yield* startRelationalRequestDeadline(cmsLimits.commandMs).pipe(Effect.mapError(projectFailure));
    const attempt = Effect.fnUntraced(function* (recoverOnly: boolean) {
      return yield* currentPreparation.withEntry(({ binding: active, payload }, enter) => runRelationalSession(session,
        requestKey === null ? "snapshotRead" : "command", { enter: (tx, requireInstallation) =>
          enter(tx, requireInstallation, Effect.gen(function* () {
        yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', ${`${cmsLimits.statementMs}ms`}, true), set_config('lock_timeout', ${`${cmsLimits.lockMs}ms`}, true)`),
          cause => cmsError("statementFailure", cause));
        // Exclusion is scoped to the exact request, before admission or callbacks.
        // The hash is only a lock address; durable evidence still authenticates identity.
        if (key !== null) yield* runDrizzleStatementEffect(tx.execute(sql`select pg_advisory_xact_lock(
          hashtextextended(${JSON.stringify(["flarex.cms.request", scopeId, key])}, 0))`),
          cause => cmsError("statementFailure", cause));
        }), ({ clock, authority: entryAuthority, checked }) => Effect.scoped(Effect.gen(function* () {
        const runAdmitted = Effect.fnUntraced(function* (member:
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
          const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(entryAuthority.scopeId));
          // Source reads have no durable replay identity; avoid projecting the
          // entire binding frame solely to charge a nonexistent journal input.
          const evidence = member.kind === "source" && key === null ? undefined : yield* canonicalizeSuccessfulResultV1Effect({ domain: "flarex.private.cms-command", version: 1,
            deploymentId, scopeId: entryAuthority.scopeId, epoch: clock.epoch, storageGeneration: clock.storageGeneration,
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
            yield* lifetime.fromResult(lifetime.charge(captured.bytes + (evidence?.canonicalBytes.byteLength ?? 0)));
            const creationTime = AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis);
            const bundle = member.kind === "source" ? yield* Effect.gen(function* () {
              if (payload.kind !== "source") return yield* Effect.fail(cmsError("invalidAuthority"));
              const participant = key === null ? null : yield* enterSourceCmsCommit(member.admission, tx, lifetime, materialization, payload.sourceTemplate);
              const working = yield* makeSourceCmsDocuments(member.admission, tx, lifetime, creationTime, testHooks?.documentReads);
              const incoming: CmsRelations = Object.freeze({ incoming: (context: CmsRequestContext, id: CmsPresentedTransactionId) =>
                lifetime.operation(context, id, "read", Effect.fail(cmsError("unsupportedProfile"))) });
              const sourceState = yield* requireLogicalDocumentSourceAdmission(member.admission, tx).pipe(Effect.mapError(projectFailure));
              const preferences = makePayloadPreferenceCleanupRecorder(lifetime, {
                available: sourceState.preferenceCleanup !== undefined,
                collections: sourceState.configuration.tables.map(table => table.collectionSlug),
                requireOpen: requireLogicalDocumentSourceAdmission(member.admission, tx).pipe(Effect.asVoid, Effect.mapError(projectFailure)),
                requireDeletion: documentId => working.requirePendingDeletion(documentId).pipe(Effect.flatMap(row => {
                  const collection = sourceState.configuration.tables.find(table => table.logicalTableName === row.tableName);
                  return collection === undefined ? Effect.fail(cmsError("invalidAuthority")) :
                    Effect.succeed({ documentId: row.documentId, collectionSlug: collection.collectionSlug });
                })),
              });
              const finalize = (actualLookup: NonNullable<typeof lookup>, value: CanonicalSuccessfulResultV1, digest: Uint8Array) =>
                participant === null ? Effect.fail(cmsError("invalidAuthority")) :
                  preferences.close.pipe(Effect.flatMap(intents => working.close(intents)),
                    Effect.flatMap(closure => participant.finalize(closure, actualLookup, value, digest, testHooks)), Effect.asVoid);
              return Object.freeze({ documents: working.documents, incoming, preferences: preferences.cleanup, finalize });
            }) : yield* Effect.gen(function* () {
              if (payload.kind !== "application") return yield* Effect.fail(cmsError("invalidAuthority"));
              const participant = key === null ? null : yield* enterCmsApplicationCommit(payload.commit, member.admission, lifetime);
              const working = yield* makeCmsDocuments(member.admission, lifetime, creationTime, testHooks?.documentReads);
              const incoming = yield* makeCmsRelations(relations, member.admission, lifetime, working.documents,
                key === null, testHooks?.observeIncomingQuery);
              const preferences = yield* makePayloadPreferenceCleanup(member.admission, lifetime, working.pendingDeletions);
              const finalize = (actualLookup: NonNullable<typeof lookup>, value: CanonicalSuccessfulResultV1, digest: Uint8Array) =>
                participant === null ? Effect.fail(cmsError("invalidAuthority")) :
                  working.close().pipe(Effect.flatMap(closure => preferences.close().pipe(Effect.flatMap(preferenceClosure =>
                    participant.finalize(closure, preferenceClosure, actualLookup, value, digest, testHooks)))), Effect.asVoid);
              return Object.freeze({ documents: working.documents, incoming, preferences: preferences.cleanup, finalize });
            });
            const invoke = Effect.fnUntraced(function* (context: CmsRequestContext, child: CmsCommand, childArgs: Json): Effect.fn.Return<Json, CmsTransactionError> {
              const definition = getCmsCommand(child);
              if (definition === undefined || !allowed.has(child) || (key === null && definition.mode !== "read")) return yield* Effect.fail(cmsError("invalidAuthority"));
              const childInput = yield* Effect.fromResult(capturePrivateJsonData(childArgs, lifetime.remainingBytes(), cmsError));
              yield* lifetime.fromResult(lifetime.charge(childInput.bytes));
              const commandContext = makeCmsCommandContext(lifetime, transactionId, context,
                { documents: bundle.documents, relations: bundle.incoming, preferences: bundle.preferences },
                key === null && context === lifetime.context, invoke);
              const value = yield* Effect.suspend(() => definition.run(commandContext, childInput.value));
              const output = yield* Effect.fromResult(capturePrivateJsonData(value, lifetime.remainingBytes(), cmsError));
              yield* lifetime.fromResult(lifetime.charge(output.bytes));
              return output.value;
            }, work => observeExecution("CmsHost.invoke", work, "caller"));
            const value = yield* invoke(lifetime.context, token, captured.value);
            const result = yield* canonicalizeSuccessfulResultV1Effect(value);
            yield* lifetime.fromResult(lifetime.charge(result.canonicalBytes.byteLength));
            const digest = member.kind === "source" && lookup === null ? undefined : yield* sha256(result.canonicalBytes);
            yield* lifetime.seal;
            if (lookup !== null && digest !== undefined) {
              invalidateAcceptedApplicationBindingInTransaction(tx);
              yield* bundle.finalize(lookup, result, digest);
            }
            return result.valueJson;
          }).pipe(Effect.ensuring(lifetime.close));
        }, work => observeExecution("CmsHost.runAdmitted", work, "caller"));
        if (payload.kind === "application") return yield* withCmsAdmission(payload.application, tx, entryAuthority, clock,
          admission => runAdmitted({ kind: "application", admission }), payload.preferences, checked);
        return yield* (key === null
          ? payload.source.withReadAdmission(active, tx, entryAuthority, clock,
            admission => runAdmitted({ kind: "source", admission }), checked)
          : payload.source.withAdmission(active, tx, entryAuthority, clock,
            admission => runAdmitted({ kind: "source", admission }), checked));
      }))) }, deadline));
    }, work => observeExecution("CmsHost.attempt", work, "caller"));
    return yield* boundRelationalRequestDeadline(deadline, runWithRequestRecovery(attempt, {
      hasRequestKey: key !== null,
      projectFailure,
      isDecisionUncertain: error => error.reason === "decisionUncertain",
    })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
  }, work => observeExecution("CmsHost.execute", work, "caller"));
  return Object.freeze({ newRequestKey: () => `cms/${crypto.randomUUID()}`,
    run: (key, command, args) => execute(key, command, args), read: (command, args) => execute(null, command, args) } satisfies Omit<CmsHost, "close" | "requestBudget">);
});
