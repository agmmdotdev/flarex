import { makeCommerceCommandContext } from "../commerceTransaction/context";
import { makeCmsCommandContext } from "../cmsTransaction/context";
import { Clock, Effect, Option, Schema } from "effect";
import { sql } from "drizzle-orm";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { projectScopeIdUuidV1Result, projectScopeEpochUuidV1Result } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema, TransactionFunctionPathV1Schema, TransactionRequestSha256V1Schema, TransactionIdentityAccessPolicySha256V1Schema } from "flarex-protocol/transaction-session";
import { capturePrivateJsonData } from "../privateJsonData";
import { isSyntheticBindingReference } from "../frameworkSchema/binding/canonical";
import { makeBoundedRequestLifetime, projectBoundedRequestLifetime } from "../boundedRequestLifetime";
import { prepareCmsApplication, requireCmsAdmission, withCmsAdmission } from "../cmsTransaction/admission";
import { getCmsCommand, type CmsHostInput, type CmsCommandContext } from "../cmsTransaction/host";
import { cmsError, cmsLimits, CmsTransactionError } from "../cmsTransaction/model";
import { makeCmsDocuments, consumeCmsDocumentClosure } from "../cmsTransaction/documents";
import { validateCmsDocumentContribution } from "../cmsTransaction/contribution";
import { makeCmsRelations } from "../cmsTransaction/relations";
import { makePayloadPreferenceCleanup, consumePayloadPreferenceCleanup } from "../payloadPreferences/cleanup";
import { type CommerceHostInput } from "../commerceTransaction/host";
import { getCommerceCommand, type CommerceCommandContext } from "../commerceTransaction/commands";
import { requireCommerceProfile } from "../commerceTransaction/profile";
import { withCommerceAdmission } from "../commerceTransaction/admission";
import { makeCommerceStore } from "../commerceTransaction/store";
import { consumeCommerceContribution } from "../commerceTransaction/publication";
import { commerceError, CommerceTransactionError } from "../commerceTransaction/model";
import { prepareApplicationDocumentParticipant, enterApplicationDocumentParticipant } from "../applicationDocumentMaterialization/participant";
import { makeApplicationInsertParticipant, ApplicationCommandError, applicationCommandError } from "../applicationDocumentMaterialization/insertParticipant";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../transactionSessionAttemptKernel";
import { hasFrameworkMigrationTargetDatabase } from "../migrationCoordination/targetSession";
import { captureTrustedScopeAuthorityResolutionPorts, resolveLocatedTrustedScopeAuthorityEffect } from "../scopeAuthorityResolution";
import { hasRelationalSessionDatabase, runRelationalSession } from "../relationalTransaction/session";
import { runWithRequestRecovery } from "../relationalTransaction/requestRecovery";
import { lockScopeClockForUpdateInTransactionEffect } from "../scopeClock";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { createCommittedPointOutcomeResolverV1 } from "../committedPointOutcome";
import { allocateScopePublicationResult, readScopePublicationDatabaseTime, writeScopePublicationPrefix, advanceScopePublicationClock } from "../commitPublication/publication";
import type { ScopePublicationContribution, ScopePublicationKernel } from "../commitPublication/scopePublicationModel";
import { runOwnedPromise } from "../ownedPromise";
import { withCompositeBinding, type CompositeBinding } from "./binding";
import { compositeError, projectCompositeFailure, projectCompositePublicationFailure, type CompositeFailure } from "./model";

export interface CompositeCommandInput<Failure> extends Omit<CmsHostInput<Failure>, "commands" | "payloadPreferenceTarget" | "relationReads"> {
  readonly commerce: Pick<CommerceHostInput<Failure>, "target" | "profile" | "installation">;
  readonly currencyCommand: CommerceHostInput<Failure>["commands"][number];
  readonly cmsCommand: CmsHostInput<Failure>["commands"][number];
  readonly applicationTable: string;
}
/** Source-private fault injection; never part of the returned command facade. */
export interface CompositeCommandTestHooks {
  readonly afterSteps?: () => Effect.Effect<void, CompositeFailure>;
  readonly beforeApplication?: () => Effect.Effect<void, CompositeFailure>;
  readonly receipts?: (receipts: readonly object[]) => readonly object[];
  readonly bindingProof?: (binding: CompositeBinding) => CompositeBinding;
}
const decodeKey = Schema.decodeUnknownResult(TransactionRequestKeyV1Schema);
const hash = makeLivePrivateSha256V1({ invalidBudget: () => compositeError("limitExceeded"), invalidBytes: () => compositeError("invalidInput"), inputBytesExceeded: () => compositeError("limitExceeded"), unavailable: () => compositeError("resourceFailure"), nativeRejected: cause => compositeError("resourceFailure", cause), invalidDigestOutput: () => new Error("Invalid composite command digest") });
const sha = (bytes: Uint8Array) => hash(bytes, { maximumInputBytes: cmsLimits.commandBytes });
const publication = <A>(work: (signal: AbortSignal) => Promise<A>) => runOwnedPromise(work, projectCompositePublicationFailure);

/** Dynamic, trusted host instance; no framework callback or SQL handle is exposed. */
export const makeCurrencyAnnouncementHost = Effect.fn("CurrencyAnnouncement.make")(function* <Failure>(
  input: CompositeCommandInput<Failure>, hooks?: CompositeCommandTestHooks,
) {
  const { database, controlDatabase, session, deploymentId, application, pointCommitAuthority, applicationTable } = input;
  const capturedInstallation = yield* Effect.fromResult(capturePrivateJsonData(input.commerce.installation, 65_536, compositeError));
  if (!isSyntheticBindingReference(capturedInstallation.value)) return yield* Effect.fail(compositeError("invalidInput"));
  const commerce = Object.freeze({ target: input.commerce.target, profile: input.commerce.profile, installation: capturedInstallation.value });
  const currency = getCommerceCommand(input.currencyCommand);
  const cms = getCmsCommand(input.cmsCommand);
  if (currency?.name !== "currencyAnnouncementWrite" || currency.mode !== "write" || cms?.name !== "payload-create" || cms.mode !== "write" ||
      !hasRelationalSessionDatabase(session, database) || !hasFrameworkMigrationTargetDatabase(commerce.target, database)) return yield* Effect.fail(compositeError("invalidAuthority"));
  const descriptor = yield* requireCommerceProfile(commerce.profile);
  if (descriptor.profileId !== "medusa.currency" || descriptor.localOnly || descriptor.initialization === null) return yield* Effect.fail(compositeError("unsupportedProfile"));
  const compositionAuthority = input.authority;
  const authority = captureTrustedScopeAuthorityResolutionPorts(input.authority);
  const materialization = Object.freeze({ ...input.materialization });
  const expectedContent = input.expectedContentIdentity === undefined ? undefined : Object.freeze({ ...input.expectedContentIdentity });
  const accessPolicy = yield* Effect.fromResult(capturePrivateJsonData(input.identityAndAccessPolicy, 65_536, compositeError));
  const identity = yield* canonicalizeSuccessfulResultV1Effect(accessPolicy.value);
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(yield* sha(identity.canonicalBytes));
  const owner = Object.freeze({});
  const run = Effect.fn("CurrencyAnnouncement.run")(function* (requestKey: string, args: Json): Effect.fn.Return<Json, CompositeFailure> {
    const captured = yield* Effect.fromResult(capturePrivateJsonData(args, cmsLimits.commandBytes, compositeError));
    if (!isJsonObject(captured.value)) return yield* Effect.fail(compositeError("invalidInput"));
    const { currency: currencyArgs, cms: cmsArgs, application: appArgs } = captured.value;
    if (currencyArgs === undefined || cmsArgs === undefined || appArgs === undefined || !isJsonObject(currencyArgs) || !isJsonObject(cmsArgs) || !isJsonObject(appArgs) ||
      Object.keys(captured.value).toSorted().join() !== "application,cms,currency") return yield* Effect.fail(compositeError("invalidInput"));
    const argumentsValue = { currency: currencyArgs, cms: cmsArgs, application: appArgs };
    const key = yield* Effect.fromResult(decodeKey(requestKey)).pipe(Effect.mapError(cause => compositeError("invalidInput", cause)));
    if (!/^composite\/[0-9a-f-]{36}$/.test(key)) return yield* Effect.fail(compositeError("invalidInput"));
    const attempt = Effect.fn("CurrencyAnnouncement.attempt")(function* (recoverOnly: boolean) {
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authority);
      if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database)) return yield* Effect.fail(compositeError("invalidAuthority"));
      const prepared = yield* prepareCmsApplication(application, compositionAuthority, controlDatabase, deploymentId);
      if (prepared.schema.relations.length !== 0) return yield* Effect.fail(compositeError("unsupportedProfile"));
      const appTable = prepared.schema.tables.find(table => table.logicalName === applicationTable);
      if (appTable === undefined || !prepared.schema.writePolicy?.writePolicies.some(policy => policy.tableId === appTable.tableId && policy.owner === "application")) return yield* Effect.fail(compositeError("invalidAuthority"));
      const tableIds = [...prepared.schema.writePolicy.writePolicies.filter(policy => policy.owner === "payload").map(policy => policy.tableId), appTable.tableId];
      const documents = yield* prepareApplicationDocumentParticipant(prepared.schema, located.authority, pointCommitAuthority, materialization, tableIds);
      return yield* runRelationalSession(session, tx => Effect.scoped(Effect.gen(function* () {
        yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`), cause => compositeError("resourceFailure", cause));
        const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, located.authority.scopeId);
        return yield* withCommerceAdmission(commerce.profile, commerce.target, commerce.installation, prepared.selection, tx, located.authority, clock, false, commerceAdmission =>
          withCompositeBinding(commerceAdmission, binding => withCmsAdmission(prepared, tx, located.authority, clock, cmsAdmission => Effect.gen(function* () {
            const admitted = yield* requireCmsAdmission(cmsAdmission);
            if (expectedContent === undefined || admitted.frame.payloadContent?.configSha256 !== expectedContent.configSha256 || admitted.frame.payloadContent.provenanceSha256 !== expectedContent.provenanceSha256)
              return yield* Effect.fail(compositeError("invalidAuthority"));
            const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(located.authority.scopeId));
            const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(clock.epoch));
            const evidence = yield* canonicalizeSuccessfulResultV1Effect({ domain: "flarex.private.currency-announcement", version: 1, deploymentId,
              scopeId: located.authority.scopeId, epoch: clock.epoch, generation: clock.storageGeneration, fence: clock.storageGenerationFence.toString(),
              binding: admitted.frame, head: admitted.head, applicationTable, args: captured.value });
            const lookup = { scopeUuid: scope.scopeUuid, requestKey: key, expectedIdentityAccessPolicySha256: identityDigest,
              expectedFunctionPath: TransactionFunctionPathV1Schema.make("__flarex_private_composite/publishCurrencyAnnouncement"), expectedRequestSha256: TransactionRequestSha256V1Schema.make(yield* sha(evidence.canonicalBytes)) };
            const outcome = yield* createCommittedPointOutcomeResolverV1(tx).resolve(lookup);
            if (outcome.kind === "available") return outcome.successfulResult.valueJson;
            if (outcome.kind === "expired") return yield* Effect.fail(compositeError("resultUnavailable"));
            if (recoverOnly) return yield* Effect.fail(compositeError("decisionUncertain"));
            const id = crypto.randomUUID();
            const lifetime = yield* makeBoundedRequestLifetime<CompositeFailure, object, object>(compositeError, cmsLimits, owner, Object.freeze({}), id, "write");
            const cmsLifetime = projectBoundedRequestLifetime(lifetime, error => error instanceof CmsTransactionError ? error : cmsError("rollbackOnly", error));
            const commerceLifetime = projectBoundedRequestLifetime(lifetime, error => error instanceof CommerceTransactionError ? error : commerceError("rollbackOnly", error));
            const appLifetime = projectBoundedRequestLifetime(lifetime, error => error instanceof ApplicationCommandError ? error : applicationCommandError("rollbackOnly", error));
            return yield* Effect.gen(function* () {
              yield* Effect.fromResult(lifetime.charge(captured.bytes + evidence.canonicalBytes.byteLength));
              const lowering = yield* enterApplicationDocumentParticipant(documents, tx, located.authority, clock, prepared.schema);
              const working = yield* makeCmsDocuments(cmsAdmission, cmsLifetime, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis), lowering.uniqueDefinitions);
              const relations = yield* makeCmsRelations(Option.none(), cmsAdmission, cmsLifetime, working.documents, false);
              const preferences = yield* makePayloadPreferenceCleanup(cmsAdmission, cmsLifetime, working.pendingDeletions);
              const commerceWorking = yield* makeCommerceStore(commerceAdmission, commerceLifetime, id);
              const app = yield* makeApplicationInsertParticipant(admitted, appLifetime, id, applicationTable);
              const commerceContext = (manager: CommerceCommandContext["manager"]) => makeCommerceCommandContext(commerceLifetime, commerceWorking, id, manager,
                () => Effect.fail(commerceError("invalidAuthority")), context => commerceLifetime.operation(context, id, "write", Effect.fail(commerceError("unadmittedEvent"))));
              const cmsContext = (context: CmsCommandContext["context"]) => makeCmsCommandContext(cmsLifetime, id, context,
                { documents: working.documents, relations, preferences: preferences.cleanup }, false, () => Effect.fail(cmsError("invalidAuthority")));
              const currencyValue = yield* commerceLifetime.nested(lifetime.context, id, context => currency.run(commerceContext(context), argumentsValue.currency));
              const cmsValue = yield* cmsLifetime.nested(lifetime.context, id, context => cms.run(cmsContext(context), argumentsValue.cms));
              if (hooks?.beforeApplication !== undefined) yield* hooks.beforeApplication();
              const appId = yield* app.insert(lifetime.context, argumentsValue.application);
              const pending = yield* app.readPending(lifetime.context);
              if (Option.isNone(pending) || pending.value._id !== appId) return yield* Effect.fail(compositeError("storedCorruption"));
              if (hooks?.afterSteps !== undefined) yield* hooks.afterSteps();
              const result = yield* canonicalizeSuccessfulResultV1Effect({ currency: currencyValue, cms: cmsValue, applicationId: appId });
              yield* Effect.fromResult(lifetime.charge(result.canonicalBytes.byteLength));
              const resultSha256 = yield* sha(result.canonicalBytes);
              yield* lifetime.seal;
              const cmsClosure = yield* working.close();
              const commerceClosure = yield* commerceWorking.close();
              const appClosure = yield* app.close();
              const expected = Object.freeze([cmsClosure, commerceClosure, appClosure]);
              const presented = hooks?.receipts?.(expected) ?? expected;
              if (presented.length !== 3 || presented.some((receipt, index) => receipt !== expected[index])) return yield* Effect.fail(compositeError("invalidAuthority"));
              const closed = yield* consumeCmsDocumentClosure(cmsClosure, cmsAdmission, cmsLifetime);
              const cmsContribution = yield* validateCmsDocumentContribution(cmsAdmission, closed);
              const preferenceFacts = yield* consumePayloadPreferenceCleanup(yield* preferences.close(), cmsAdmission, cmsLifetime, closed.pendingDeletions);
              if (preferenceFacts.length !== 0) return yield* Effect.fail(compositeError("unsupportedProfile"));
              const relationalFacts = yield* consumeCommerceContribution(commerceAdmission, commerceLifetime, commerceClosure);
              const appChanges = yield* app.consume(appClosure);
              const changes = [...cmsContribution.changes, ...appChanges].toSorted((a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId));
              const dependencies = [...cmsContribution.dependencies, ...appChanges].toSorted((a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId));
              const delta = yield* lowering.prepareDelta(changes, dependencies);
              const publicationClock = { record: clock, scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid };
              const now = yield* publication(() => readScopePublicationDatabaseTime(tx, scope.scopeId, materialization));
              const allocation = yield* Effect.fromResult(allocateScopePublicationResult(publicationClock, "publish", now));
              if (allocation.outboxSeq === null) return yield* Effect.fail(compositeError("storedCorruption"));
              const adjacency = yield* delta.lower(allocation.commitSeq);
              const contribution: ScopePublicationContribution = { authorityPins: { scopeId: scope.scopeId, requestKey: key, functionPath: lookup.expectedFunctionPath },
                rowIntents: changes, relationalFacts, identityAccessPolicySha256: identityDigest, requestSha256: lookup.expectedRequestSha256, resultSha256, successfulResult: result };
              const kernel: ScopePublicationKernel = { clock: publicationClock, ...allocation, outboxSeq: allocation.outboxSeq, relationAdjacencyChanges: adjacency };
              yield* publication(signal => writeScopePublicationPrefix(tx, contribution, kernel, materialization, signal));
              yield* publication(() => advanceScopePublicationClock(tx, contribution, kernel, materialization));
              return result.valueJson;
            }).pipe(Effect.timeoutOrElse({ duration: cmsLimits.commandMs, orElse: () => Effect.fail(compositeError("deadlineExceeded")) }), Effect.ensuring(lifetime.close));
          }), undefined, hooks?.bindingProof?.(binding) ?? binding)));
      })));
    });
    return yield* runWithRequestRecovery(attempt, { hasRequestKey: true, projectFailure: projectCompositeFailure,
      isDecisionUncertain: error => error.reason === "decisionUncertain" });
  });
  return Object.freeze({ newRequestKey: () => `composite/${crypto.randomUUID()}`, run });
});
