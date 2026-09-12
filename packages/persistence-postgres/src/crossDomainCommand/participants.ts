import { Clock, Effect, Option } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import {
  projectBoundedRequestLifetime,
  type BoundedRequestLifetime,
} from "../boundedRequestLifetime";
import type {
  CmsAdmission,
  CmsAdmissionState,
} from "../cmsTransaction/admission";
import { makeCmsCommandContext } from "../cmsTransaction/context";
import { getCmsCommand, type CmsCommandContext } from "../cmsTransaction/host";
import {
  makeCmsDocuments,
  consumeCmsDocumentClosure,
} from "../cmsTransaction/documents";
import { validateCmsDocumentContribution } from "../cmsTransaction/contribution";
import { makeCmsRelations } from "../cmsTransaction/relations";
import { cmsError, CmsTransactionError } from "../cmsTransaction/model";
import type { CommerceAdmission } from "../commerceTransaction/admission";
import { makeCommerceCommandContext } from "../commerceTransaction/context";
import {
  getCommerceCommand,
  type CommerceCommandContext,
} from "../commerceTransaction/commands";
import { makeCommerceStore } from "../commerceTransaction/store";
import { consumeCommerceContribution } from "../commerceTransaction/publication";
import {
  commerceError,
  CommerceTransactionError,
} from "../commerceTransaction/model";
import {
  makePayloadPreferenceCleanup,
  consumePayloadPreferenceCleanup,
} from "../payloadPreferences/cleanup";
import {
  makeApplicationInsertParticipant,
  ApplicationCommandError,
  applicationCommandError,
} from "../applicationDocumentMaterialization/insertParticipant";
import type { enterApplicationDocumentParticipant } from "../applicationDocumentMaterialization/participant";
import { compositeError, type CompositeFailure } from "./model";
import type { CurrencyAnnouncementArguments } from "./request";
import type { CurrencyAnnouncementTestHooks } from "./testSupport";

interface ParticipantInput {
  readonly cmsAdmission: CmsAdmission;
  readonly cmsState: CmsAdmissionState;
  readonly commerceAdmission: CommerceAdmission;
  readonly lifetime: BoundedRequestLifetime<CompositeFailure>;
  readonly transactionId: string;
  readonly applicationTable: string;
  readonly lowering: Effect.Success<
    ReturnType<typeof enterApplicationDocumentParticipant>
  >;
  readonly currency: NonNullable<ReturnType<typeof getCommerceCommand>>;
  readonly cms: NonNullable<ReturnType<typeof getCmsCommand>>;
}

/** Fixed borrowed participants. The host retains the root lifetime and settlement. */
export const makeCurrencyAnnouncementParticipants = Effect.fn(
  "CurrencyAnnouncement.prepareParticipants",
)(function* (input: ParticipantInput, hooks?: CurrencyAnnouncementTestHooks) {
  const {
    cmsAdmission,
    cmsState,
    commerceAdmission,
    lifetime,
    transactionId,
    lowering,
  } = input;
  const cmsLifetime = projectBoundedRequestLifetime(lifetime, (error) =>
    error instanceof CmsTransactionError
      ? error
      : cmsError("rollbackOnly", error),
  );
  const commerceLifetime = projectBoundedRequestLifetime(lifetime, (error) =>
    error instanceof CommerceTransactionError
      ? error
      : commerceError("rollbackOnly", error),
  );
  const appLifetime = projectBoundedRequestLifetime(lifetime, (error) =>
    error instanceof ApplicationCommandError
      ? error
      : applicationCommandError("rollbackOnly", error),
  );

  const documents = yield* makeCmsDocuments(
    cmsAdmission,
    cmsLifetime,
    AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis),
    lowering.uniqueDefinitions,
  );
  const relations = yield* makeCmsRelations(
    Option.none(),
    cmsAdmission,
    cmsLifetime,
    documents.documents,
    false,
  );
  const preferences = yield* makePayloadPreferenceCleanup(
    cmsAdmission,
    cmsLifetime,
    documents.pendingDeletions,
  );
  const commerce = yield* makeCommerceStore(
    commerceAdmission,
    commerceLifetime,
    transactionId,
  );
  const application = yield* makeApplicationInsertParticipant(
    cmsState,
    appLifetime,
    transactionId,
    input.applicationTable,
  );

  const commerceContext = (manager: CommerceCommandContext["manager"]) =>
    makeCommerceCommandContext(
      commerceLifetime,
      commerce,
      transactionId,
      manager,
      () => Effect.fail(commerceError("invalidAuthority")),
      (context) =>
        commerceLifetime.operation(
          context,
          transactionId,
          "write",
          Effect.fail(commerceError("unadmittedEvent")),
        ),
    );
  const cmsContext = (context: CmsCommandContext["context"]) =>
    makeCmsCommandContext(
      cmsLifetime,
      transactionId,
      context,
      {
        documents: documents.documents,
        relations,
        preferences: preferences.cleanup,
      },
      false,
      () => Effect.fail(cmsError("invalidAuthority")),
    );

  const execute = Effect.fn("CurrencyAnnouncement.execute")(function* (
    args: CurrencyAnnouncementArguments,
  ) {
    const currency = yield* commerceLifetime.nested(
      lifetime.context,
      transactionId,
      (context) => input.currency.run(commerceContext(context), args.currency),
    );
    const cms = yield* cmsLifetime.nested(
      lifetime.context,
      transactionId,
      (context) => input.cms.run(cmsContext(context), args.cms),
    );
    if (hooks?.beforeApplication !== undefined)
      yield* hooks.beforeApplication();
    const applicationId = yield* application.insert(
      lifetime.context,
      args.application,
    );
    const pending = yield* application.readPending(lifetime.context);
    if (Option.isNone(pending) || pending.value._id !== applicationId) {
      return yield* Effect.fail(compositeError("storedCorruption"));
    }
    if (hooks?.afterSteps !== undefined) yield* hooks.afterSteps();
    return yield* canonicalizeSuccessfulResultV1Effect({
      currency,
      cms,
      applicationId,
    });
  });

  const close = Effect.fn("CurrencyAnnouncement.closeParticipants")(
    function* () {
      const cmsClosure = yield* documents.close();
      const commerceClosure = yield* commerce.close();
      const appClosure = yield* application.close();
      const expected = Object.freeze([cmsClosure, commerceClosure, appClosure]);
      const presented = hooks?.receipts?.(expected) ?? expected;
      if (
        presented.length !== 3 ||
        presented.some((receipt, index) => receipt !== expected[index])
      ) {
        return yield* Effect.fail(compositeError("invalidAuthority"));
      }
      const closed = yield* consumeCmsDocumentClosure(
        cmsClosure,
        cmsAdmission,
        cmsLifetime,
      );
      const cmsContribution = yield* validateCmsDocumentContribution(
        cmsAdmission,
        closed,
      );
      const preferenceFacts = yield* consumePayloadPreferenceCleanup(
        yield* preferences.close(),
        cmsAdmission,
        cmsLifetime,
        closed.pendingDeletions,
      );
      if (preferenceFacts.length !== 0) {
        return yield* Effect.fail(compositeError("unsupportedProfile"));
      }
      const relationalFacts = yield* consumeCommerceContribution(
        commerceAdmission,
        commerceLifetime,
        commerceClosure,
      );
      const appChanges = yield* application.consume(appClosure);
      const changes = [...cmsContribution.changes, ...appChanges].toSorted(
        (a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId),
      );
      const dependencies = [
        ...cmsContribution.dependencies,
        ...appChanges,
      ].toSorted(
        (a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId),
      );
      // CMS and Application must lower one combined delta, including cross-table uniqueness.
      const delta = yield* lowering.prepareDelta(changes, dependencies);
      return { changes, relationalFacts, delta };
    },
  );

  return { execute, close };
});
