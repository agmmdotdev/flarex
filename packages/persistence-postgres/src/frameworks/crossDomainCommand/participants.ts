import { Clock, Effect, Option } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { projectBoundedRequestLifetime, type BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { makeSourceApplicationInsertParticipant, ApplicationCommandError,
  applicationCommandError } from "../../storage/materialization/insertParticipant";
import { makeSourceCmsDocuments, consumeSourceCmsDocumentClosure } from "../cmsTransaction/documents";
import { makeCmsCommandContext } from "../cmsTransaction/context";
import type { CmsCommandContext } from "../cmsTransaction/commands";
import { cmsError, CmsTransactionError } from "../cmsTransaction/model";
import { makeLogicalCommerceParticipant, consumeLogicalCommerceClosure } from "../commerceTransaction/logicalParticipant";
import { makeCommerceCommandContext } from "../commerceTransaction/context";
import type { CommerceCommandContext } from "../commerceTransaction/commands";
import { commerceError, CommerceTransactionError } from "../commerceTransaction/model";
import type { LogicalApplicationSourceAdmission } from "../../storage/documents/logicalDocuments/applicationAdmission";
import type { LogicalDocumentSourceAdmission } from "../../storage/documents/logicalDocuments/documentAdmission";
import type { LogicalRelationalAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../scope/scopeClock";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import type { ApplicationDocumentMaterializationOptions } from "../../storage/materialization/model";
import { prepareJointLogicalMaterialization } from "./materialization";
import { compositeError, type CompositeFailure } from "./model";
import type { CurrencyAnnouncementArguments } from "./request";
import type { CurrencyAnnouncementTestHooks } from "./testSupport";
import type { getCommerceCommand } from "../commerceTransaction/commands";
import type { getCmsCommand } from "../cmsTransaction/commands";

interface LogicalParticipantInput {
  readonly tx: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly application: LogicalApplicationSourceAdmission;
  readonly payload: LogicalDocumentSourceAdmission;
  readonly currency: LogicalRelationalAdmission;
  readonly lifetime: BoundedRequestLifetime<CompositeFailure>;
  readonly transactionId: string;
  readonly applicationTable: string;
  readonly currencyCommand: NonNullable<ReturnType<typeof getCommerceCommand>>;
  readonly cmsCommand: NonNullable<ReturnType<typeof getCmsCommand>>;
  readonly materialization: Pick<ApplicationDocumentMaterializationOptions, "afterTransactionStep" | "observeQuery">;
}

/** Framework callbacks borrow one root lifetime; the root alone prepares the
 * combined delta after all three admitted contributions are closed. */
export const makeCurrencyAnnouncementParticipants = Effect.fn("CurrencyAnnouncement.makeParticipants")(
  function* (input: LogicalParticipantInput, hooks?: CurrencyAnnouncementTestHooks) {
    const { tx, authority, application, payload, currency, lifetime, transactionId,
      applicationTable, currencyCommand, cmsCommand, materialization } = input;
    const testHooks = hooks === undefined ? undefined : Object.freeze({ ...hooks });
    const cmsLifetime = projectBoundedRequestLifetime(lifetime, error => error instanceof CmsTransactionError
      ? error : cmsError("rollbackOnly", error));
    const commerceLifetime = projectBoundedRequestLifetime(lifetime, error => error instanceof CommerceTransactionError
      ? error : commerceError("rollbackOnly", error));
    const appLifetime = projectBoundedRequestLifetime(lifetime, error => error instanceof ApplicationCommandError
      ? error : applicationCommandError("rollbackOnly", error));
    const documents = yield* makeSourceCmsDocuments(payload, tx, cmsLifetime,
      AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis));
    const commerce = yield* makeLogicalCommerceParticipant(currency, tx, commerceLifetime,
      commerceLifetime.context, transactionId);
    const app = yield* makeSourceApplicationInsertParticipant(application, tx, appLifetime,
      transactionId, applicationTable);
    const cmsContext = (context: CmsCommandContext["context"]) => makeCmsCommandContext(cmsLifetime,
      transactionId, context, { documents: documents.documents,
        relations: { incoming: (manager, id) => cmsLifetime.operation(manager, id, "read",
          Effect.fail(cmsError("unsupportedProfile"))) },
        preferences: { deleteForPendingDocument: (manager, id) => cmsLifetime.operation(manager, id, "write",
          Effect.fail(cmsError("unsupportedProfile"))) } }, false,
      () => Effect.fail(cmsError("invalidAuthority")));
    const commerceContext = (manager: CommerceCommandContext["manager"]) => makeCommerceCommandContext(
      commerceLifetime, commerce, transactionId, manager,
      () => Effect.fail(commerceError("invalidAuthority")),
      context => commerceLifetime.operation(context, transactionId, "write",
        Effect.fail(commerceError("unadmittedEvent"))));

    const execute = Effect.fn("CurrencyAnnouncement.executeLogical")(function* (args: CurrencyAnnouncementArguments) {
      const currencyResult = yield* commerceLifetime.nested(lifetime.context, transactionId,
        manager => currencyCommand.run(commerceContext(manager), args.currency));
      const cmsResult = yield* cmsLifetime.nested(lifetime.context, transactionId,
        context => cmsCommand.run(cmsContext(context), args.cms));
      if (testHooks?.beforeApplication !== undefined) yield* testHooks.beforeApplication();
      const applicationId = yield* app.insert(lifetime.context, args.application);
      const pending = yield* app.readPending(lifetime.context);
      if (Option.isNone(pending) || pending.value._id !== applicationId)
        return yield* Effect.fail(compositeError("storedCorruption"));
      if (testHooks?.afterSteps !== undefined) yield* testHooks.afterSteps();
      return yield* canonicalizeSuccessfulResultV1Effect({ currency: currencyResult, cms: cmsResult, applicationId });
    });

    const close = Effect.fn("CurrencyAnnouncement.closeLogicalParticipants")(function* () {
      const cmsClosure = yield* documents.close();
      const commerceClosure = yield* commerce.close();
      const appClosure = yield* app.close();
      const expected = Object.freeze([cmsClosure, commerceClosure, appClosure]);
      const presented = testHooks?.receipts?.(expected) ?? expected;
      if (presented.length !== expected.length || presented.some((receipt, index) => receipt !== expected[index]))
        return yield* Effect.fail(compositeError("invalidAuthority"));
      const payloadClosure = yield* consumeSourceCmsDocumentClosure(cmsClosure, payload, tx, cmsLifetime);
      if (payloadClosure.preferenceIntents.length !== 0) return yield* Effect.fail(compositeError("unsupportedProfile"));
      const payloadChanges = payloadClosure.changes;
      const currencyChanges = (yield* consumeLogicalCommerceClosure(commerceClosure, commerceLifetime)).changes;
      const applicationChanges = yield* app.consume(appClosure);
      const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, authority.scopeId);
      const delta = yield* prepareJointLogicalMaterialization({ tx, clock, application, payload, currency,
        applicationChanges, payloadChanges, currencyChanges, options: materialization });
      return Object.freeze({ changes: delta.changes, relationalFacts: Object.freeze([]), delta, clock });
    });
    return Object.freeze({ execute, close });
  });
