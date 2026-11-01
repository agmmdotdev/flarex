import { Cause, Effect, Option } from "effect";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import type { CoreError, CoreNativeBinding, CoreNativeBindingMetadata, CoreNativeRootBindingMetadata, CoreNativeRootOperation } from "../../core/api";
import { ApplicationCommandError, applicationCommandError } from "../../application/commandError";
import { projectBoundedRequestLifetime, type BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { makeCmsCommandContext } from "../cmsTransaction/context";
import { makeNativeCmsDocuments } from "../cmsTransaction/nativeDocuments";
import { makeNativeCmsRelations } from "../cmsTransaction/nativeRelations";
import { cmsError, CmsTransactionError } from "../cmsTransaction/model";
import type { CmsCommandContext, getCmsCommand } from "../cmsTransaction/commands";
import { makeCommerceCommandContext } from "../commerceTransaction/context";
import { makeNativeCommerceParticipant } from "../commerceTransaction/nativeStore";
import { commerceError, CommerceTransactionError } from "../commerceTransaction/model";
import type { CommerceCommandContext, getCommerceCommand } from "../commerceTransaction/commands";
import { projectCoreCommerceFailure } from "../commerceTransaction/nativeFailure";
import { projectCoreCmsFailure } from "../cmsTransaction/nativeFailure";
import { compositeError, type CompositeFailure } from "./model";
import { projectCoreApplicationInsertFailure } from "./nativeFailure";
import type { CurrencyAnnouncementArguments } from "./request";
import type { CurrencyAnnouncementTestHooks } from "./testSupport";

interface NativeParticipantInput {
  readonly operation: CoreNativeRootOperation;
  readonly root: CoreNativeRootBindingMetadata;
  readonly currencyBinding: CoreNativeBinding;
  readonly currency: CoreNativeBindingMetadata;
  readonly payloadBinding: CoreNativeBinding;
  readonly lifetime: BoundedRequestLifetime<CompositeFailure>;
  readonly transactionId: string;
  readonly currencyCommand: NonNullable<ReturnType<typeof getCommerceCommand>>;
  readonly cmsCommand: NonNullable<ReturnType<typeof getCmsCommand>>;
}
const coreResult = <A, Failure>(work: Effect.Effect<A, CoreError>, project: (error: CoreError) => Failure) =>
  work.pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, project))));

/** Three confined child views share one kernel and lifetime. There are no
 * contributions, SQL transactions or per-child finalization capabilities. */
export const makeNativeCurrencyAnnouncementParticipants = Effect.fn("CurrencyAnnouncement.makeNativeParticipants")(function* (
  input: NativeParticipantInput,
  hooks?: Pick<CurrencyAnnouncementTestHooks, "beforeApplication" | "afterSteps">,
) {
  const { operation, root, currencyBinding, currency, payloadBinding, lifetime, transactionId, currencyCommand, cmsCommand } = input;
  const grant = root.applicationInsert?.binding;
  if (grant === undefined) return yield* compositeError("invalidAuthority");
  const cmsLifetime = projectBoundedRequestLifetime(lifetime, error => error instanceof CmsTransactionError ? error : cmsError("rollbackOnly", error));
  const commerceLifetime = projectBoundedRequestLifetime(lifetime, error => error instanceof CommerceTransactionError ? error : commerceError("rollbackOnly", error));
  const appLifetime = projectBoundedRequestLifetime(lifetime, error => error instanceof ApplicationCommandError ? error : applicationCommandError("rollbackOnly", error));
  const currencyOperations = yield* coreResult(operation.native(currencyBinding), projectCoreCommerceFailure);
  const payloadOperations = yield* coreResult(operation.native(payloadBinding), projectCoreCmsFailure);
  const application = yield* coreResult(operation.applicationInsert(grant), projectCoreApplicationInsertFailure);
  const documents = makeNativeCmsDocuments(payloadOperations, cmsLifetime);
  const commerce = yield* makeNativeCommerceParticipant(currencyOperations, currency, commerceLifetime,
    commerceLifetime.context, transactionId, operation.unixTime);
  const cmsContext = (context: CmsCommandContext["context"]) => makeCmsCommandContext(cmsLifetime, transactionId, context, {
    documents, relations: makeNativeCmsRelations(payloadOperations, cmsLifetime, new Map(), false),
    preferences: { deleteForPendingDocument: (manager, id) => cmsLifetime.operation(manager, id, "write", Effect.fail(cmsError("unsupportedProfile"))) },
  }, false, () => Effect.fail(cmsError("invalidAuthority")));
  const commerceContext = (context: CommerceCommandContext["manager"]) => makeCommerceCommandContext(commerceLifetime,
    commerce, transactionId, context, () => Effect.fail(commerceError("invalidAuthority")),
    manager => commerceLifetime.operation(manager, transactionId, "write", Effect.fail(commerceError("unadmittedEvent"))));
  const execute = Effect.fn("CurrencyAnnouncement.executeNative")(function* (args: CurrencyAnnouncementArguments) {
    const currencyResult = yield* commerceLifetime.nested(lifetime.context, transactionId,
      context => currencyCommand.run(commerceContext(context), args.currency));
    const cmsResult = yield* cmsLifetime.nested(lifetime.context, transactionId, context => cmsCommand.run(cmsContext(context), args.cms));
    if (hooks?.beforeApplication !== undefined) yield* hooks.beforeApplication();
    const applicationId = yield* appLifetime.operation(lifetime.context, transactionId, "write", Effect.gen(function* () {
      const captured = yield* appLifetime.fromResult(capturePrivateJsonData(args.application, appLifetime.remainingBytes(), applicationCommandError));
      yield* appLifetime.fromResult(appLifetime.charge(captured.bytes));
      return yield* coreResult(application.insert(captured.value), projectCoreApplicationInsertFailure);
    }));
    const pending = yield* appLifetime.operation(lifetime.context, transactionId, "read", Effect.gen(function* () {
      const observed = yield* coreResult(application.readPending(applicationId), projectCoreApplicationInsertFailure);
      if (Option.isSome(observed)) {
        const captured = yield* appLifetime.fromResult(capturePrivateJsonData(observed.value, appLifetime.remainingBytes(), applicationCommandError));
        yield* appLifetime.fromResult(appLifetime.charge(captured.bytes));
      }
      return observed;
    }));
    if (Option.isNone(pending) || pending.value._id !== applicationId) return yield* compositeError("storedCorruption");
    if (hooks?.afterSteps !== undefined) yield* hooks.afterSteps();
    return yield* canonicalizeSuccessfulResultV1Effect({ currency: currencyResult, cms: cmsResult, applicationId })
      .pipe(Effect.mapError(cause => compositeError("invalidInput", cause)));
  });
  return Object.freeze({ execute });
});
