import { Cause, Effect } from "effect";
import { sql } from "drizzle-orm";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import type { Json } from "flarex-protocol/json";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES } from "flarex-protocol/internal/logical-schema-candidate";
import { projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { TransactionFunctionPathV1Schema, TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestSha256V1Schema } from "flarex-protocol/transaction-session";
import type { ApplicationBindingSelectionReader } from "../applicationActivation";
import { hasApplicationBindingComposition, prepareApplicationBindingSelection } from "../applicationActivation";
import type { ApplicationParticipantOptions } from "../applicationDocumentMaterialization/participant";
import { makeBoundedRequestLifetime } from "../boundedRequestLifetime";
import type { CmsCommand, CmsHostInput } from "../cmsTransaction/host";
import { getCmsCommand } from "../cmsTransaction/host";
import { cmsLimits } from "../cmsTransaction/model";
import type { CommerceCommand } from "../commerceTransaction/commands";
import { getCommerceCommand } from "../commerceTransaction/commands";
import { captureLogicalCommerceSelection, prepareLogicalCommerceContract,
  type LogicalCommerceSelectionInput } from "../commerceTransaction/logicalSelection";
import { requireLogicalCommerceInitialization } from "../commerceTransaction/logicalInitialization";
import { lockCommerceRequest } from "../commerceTransaction/request";
import { createCommittedPointOutcomeResolverV1 } from "../committedPointOutcome";
import type { FlarexMetadataDatabase } from "../deployments";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import { requireLogicalApplicationSourceAdmission, prepareLogicalApplicationSourceAdmission } from "../logicalDocuments/applicationAdmission";
import { requireLogicalDocumentSourceAdmission, prepareLogicalDocumentSourceAdmission } from "../logicalDocuments/documentAdmission";
import { requireLogicalRelationalAdmission, prepareLogicalRelationalAdmission } from "../logicalDocuments/relationalAdmission";
import { capturePrivateJsonData } from "../privateJsonData";
import { chargeHostPreparation, retainPreparedHost, type PreparedHostRuntime } from "../preparedHostRuntime";
import { hasRelationalSessionDatabase, runRelationalSession, type RelationalSession } from "../relationalTransaction/session";
import { runWithRequestRecovery } from "../relationalTransaction/requestRecovery";
import { captureTrustedScopeAuthorityResolutionPorts, resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../scopeClock";
import type { LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../transactionSessionAttemptKernel";
import { makeCurrencyAnnouncementParticipants } from "./participants";
import { compositeError, projectCompositeFailure, type CompositeFailure } from "./model";
import { publishCurrencyAnnouncement } from "./publication";
import { captureCurrencyAnnouncementRequest, hashCurrencyAnnouncement } from "./request";
import type { CurrencyAnnouncementTestHooks } from "./testSupport";

/** The fixed private command accepts three independently authenticated source
 * contracts on the same selected candidate. It owns only one request outcome. */
export interface CurrencyAnnouncementHostInput<Failure> {
  readonly hostRuntime: PreparedHostRuntime;
  readonly database: FlarexMetadataDatabase;
  readonly controlDatabase: FlarexMetadataDatabase;
  readonly session: RelationalSession;
  readonly deploymentId: string;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly application: ApplicationBindingSelectionReader<Failure>;
  readonly identityAndAccessPolicy: Json;
  readonly materialization: ApplicationParticipantOptions;
  readonly expectedContentIdentity: NonNullable<CmsHostInput<Failure>["expectedContentIdentity"]>;
  readonly currency: LogicalCommerceSelectionInput;
  readonly applicationSource: unknown;
  readonly payloadSource: unknown;
  readonly currencyCommand: CommerceCommand;
  readonly cmsCommand: CmsCommand;
  readonly applicationTable: string;
}

const captureLogicalHostInput = <Failure>(input: CurrencyAnnouncementHostInput<Failure>,
  hooks?: CurrencyAnnouncementTestHooks) => Object.freeze({
    hostRuntime: input.hostRuntime,
    database: input.database,
    controlDatabase: input.controlDatabase,
    session: input.session,
    deploymentId: input.deploymentId,
    application: input.application,
    applicationTable: input.applicationTable,
    bindingMatches: hasApplicationBindingComposition(input.application, input.authority),
    authority: captureTrustedScopeAuthorityResolutionPorts(input.authority),
    currencySelectionInput: captureLogicalCommerceSelection(input.currency),
    applicationSourceInput: capturePrivateJsonData(input.applicationSource,
      MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES, compositeError),
    payloadSourceInput: capturePrivateJsonData(input.payloadSource,
      MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES, compositeError),
    accessPolicyInput: capturePrivateJsonData(input.identityAndAccessPolicy, 65_536, compositeError),
    expectedContent: Object.freeze({ ...input.expectedContentIdentity }),
    materialization: Object.freeze({ ...input.materialization }),
    testHooks: hooks === undefined ? undefined : Object.freeze({ ...hooks }),
    currencyCommand: getCommerceCommand(input.currencyCommand),
    cmsCommand: getCmsCommand(input.cmsCommand),
  });

export const makeCurrencyAnnouncementHost = Effect.fn("CurrencyAnnouncement.make")(
  function* <Failure>(input: CurrencyAnnouncementHostInput<Failure>, hooks?: CurrencyAnnouncementTestHooks) {
    const captured = captureLogicalHostInput(input, hooks);
    const retained = yield* retainPreparedHost(captured.hostRuntime, composeLogicalCurrencyAnnouncementHost(captured))
      .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCompositeFailure))));
    return Object.freeze({ close: retained.close, newRequestKey: () => `composite/${crypto.randomUUID()}`,
      run: (requestKey: string, args: Json) => retained.use(host => host.run(requestKey, args))
        .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCompositeFailure)))) });
  });

const composeLogicalCurrencyAnnouncementHost = Effect.fn("CurrencyAnnouncement.composeLogical")(
  function* <Failure>(input: ReturnType<typeof captureLogicalHostInput<Failure>>) {
    const { database, controlDatabase, session, deploymentId, application, applicationTable } = input;
    const { authority, currencySelectionInput, applicationSourceInput, payloadSourceInput,
      accessPolicyInput, expectedContent, materialization, testHooks, currencyCommand, cmsCommand } = input;
    if (currencyCommand?.name !== "currencyAnnouncementWrite" || currencyCommand.mode !== "write" ||
      cmsCommand?.name !== "payload-create" || cmsCommand.mode !== "write" ||
      !hasRelationalSessionDatabase(session, database) ||
      !input.bindingMatches)
      return yield* Effect.fail(compositeError("invalidAuthority"));
    const selection = yield* Effect.fromResult(currencySelectionInput);
    if (selection.ports.controlDb !== controlDatabase)
      return yield* Effect.fail(compositeError("invalidAuthority"));
    const applicationSource = (yield* Effect.fromResult(applicationSourceInput)).value;
    const payloadSource = (yield* Effect.fromResult(payloadSourceInput)).value;
    const accessPolicy = (yield* Effect.fromResult(accessPolicyInput)).value;
    const contract = yield* prepareLogicalCommerceContract(selection);
    const identity = yield* canonicalizeSuccessfulResultV1Effect(accessPolicy);
    const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(
      yield* hashCurrencyAnnouncement(identity.canonicalBytes));
    const locatedAtPreparation = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authority);
    const coordinates = { deploymentId, scopeId: locatedAtPreparation.authority.scopeId,
      schemaVersionId: selection.schemaVersionId };
    const preparedApplication = yield* prepareLogicalApplicationSourceAdmission(selection.ports,
      selection.unique, coordinates, applicationSource);
    const preparedPayload = yield* prepareLogicalDocumentSourceAdmission(selection.ports,
      selection.unique, coordinates, payloadSource);
    const preparedCurrency = yield* prepareLogicalRelationalAdmission(selection.ports,
      selection.unique, coordinates, selection.source);
    const owner = Object.freeze({ hostId: Symbol("currency.announcement") });
    yield* chargeHostPreparation({ deploymentId, applicationTable, identityDigest,
      expectedContent, contractSha256: contract.sha256Hex });

    const run = Effect.fn("CurrencyAnnouncement.runLogical")(function* (requestKey: string, args: Json) {
      const request = yield* captureCurrencyAnnouncementRequest(requestKey, args);
      const attempt = Effect.fn("CurrencyAnnouncement.attemptLogical")(function* (recoverOnly: boolean) {
        const located = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authority);
        if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database))
          return yield* Effect.fail(compositeError("invalidAuthority"));
        const active = yield* prepareApplicationBindingSelection(application);
        return yield* runRelationalSession(session, "command", tx => Effect.scoped(Effect.gen(function* () {
          yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', '1000ms', true),
            set_config('lock_timeout', '500ms', true)`), cause => compositeError("resourceFailure", cause));
          yield* lockCommerceRequest(tx, located.authority.scopeId, request.key);
          const snapshot = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, located.authority.scopeId);
          return yield* preparedApplication.withAdmission(active, tx, located.authority, snapshot,
            applicationAdmission => preparedPayload.withAdmission(active, tx, located.authority, snapshot,
              payloadAdmission => preparedCurrency.withAdmission(active, tx, located.authority, snapshot,
                currencyAdmission => Effect.gen(function* () {
                  const app = yield* requireLogicalApplicationSourceAdmission(applicationAdmission, tx);
                  const payload = yield* requireLogicalDocumentSourceAdmission(payloadAdmission, tx);
                  const currency = yield* requireLogicalRelationalAdmission(currencyAdmission, tx);
                  if (app.tx !== payload.tx || app.tx !== currency.tx || app.clock !== payload.clock ||
                    app.clock !== currency.clock || app.schemaVersionId !== payload.schemaVersionId ||
                    app.schemaVersionId !== currency.schemaVersionId ||
                    !sameBindingValue(app.head, payload.head) || !sameBindingValue(app.head, currency.head) ||
                    payload.contentIdentity.configSha256 !== expectedContent.configSha256 ||
                    payload.contentIdentity.provenanceSha256 !== expectedContent.provenanceSha256)
                    return yield* Effect.fail(compositeError("invalidAuthority"));
                  yield* requireLogicalCommerceInitialization(currencyAdmission, tx,
                    selection.initialization, contract.sha256Hex);
                  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(located.authority.scopeId));
                  const evidence = yield* canonicalizeSuccessfulResultV1Effect({
                    domain: "flarex.private.currency-announcement", version: 2,
                    deploymentId, scopeId: located.authority.scopeId, epoch: snapshot.epoch,
                    generation: snapshot.storageGeneration, fence: snapshot.storageGenerationFence.toString(),
                    binding: payload.frame, head: payload.head, currencyContractSha256: contract.sha256Hex,
                    applicationTable, args: request.captured.value,
                  });
                  const lookup = { scopeUuid: scope.scopeUuid, requestKey: request.key,
                    expectedIdentityAccessPolicySha256: identityDigest,
                    expectedFunctionPath: TransactionFunctionPathV1Schema.make(
                      "__flarex_private_composite/publishCurrencyAnnouncement"),
                    expectedRequestSha256: TransactionRequestSha256V1Schema.make(
                      yield* hashCurrencyAnnouncement(evidence.canonicalBytes)) };
                  const outcome = yield* createCommittedPointOutcomeResolverV1(tx).resolve(lookup);
                  if (outcome.kind === "available") return outcome.successfulResult.valueJson;
                  if (outcome.kind === "expired") return yield* Effect.fail(compositeError("resultUnavailable"));
                  if (recoverOnly) return yield* Effect.fail(compositeError("decisionUncertain"));
                  const transactionId = crypto.randomUUID();
                  const lifetime = yield* makeBoundedRequestLifetime<CompositeFailure, object, object>(compositeError, cmsLimits, owner,
                    Object.freeze({}), transactionId, "write");
                  return yield* Effect.gen(function* () {
                    yield* Effect.fromResult(lifetime.charge(request.captured.bytes + evidence.canonicalBytes.byteLength));
                    const participants = yield* makeCurrencyAnnouncementParticipants({ tx,
                      authority: located.authority, application: applicationAdmission, payload: payloadAdmission,
                      currency: currencyAdmission, lifetime, transactionId, applicationTable,
                      currencyCommand, cmsCommand, materialization }, testHooks);
                    const result = yield* participants.execute(request.argumentsValue);
                    yield* Effect.fromResult(lifetime.charge(result.canonicalBytes.byteLength));
                    const resultSha256 = yield* hashCurrencyAnnouncement(result.canonicalBytes);
                    yield* lifetime.seal;
                    const closed = yield* participants.close();
                    const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(closed.clock.epoch));
                    return yield* publishCurrencyAnnouncement({ tx, scopeId: scope.scopeId,
                      clock: { record: closed.clock, scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid },
                      materialization, identity: lookup, closed, result, resultSha256 });
                  }).pipe(Effect.timeoutOrElse({ duration: cmsLimits.commandMs,
                    orElse: () => Effect.fail(compositeError("deadlineExceeded")) }), Effect.ensuring(lifetime.close));
                }))));
        })));
      });
      return yield* runWithRequestRecovery(attempt, { hasRequestKey: true,
        projectFailure: projectCompositeFailure,
        isDecisionUncertain: error => error.reason === "decisionUncertain" });
    });
    return Object.freeze({ run });
  });
