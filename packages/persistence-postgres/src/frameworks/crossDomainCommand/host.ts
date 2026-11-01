import { Cause, Effect, Exit, Schema } from "effect";
import { decodeDocumentId } from "flarex-protocol/document-id";
import type { Json } from "flarex-protocol/json";
import type { CoreDatabase, CoreNativeBinding, CoreNativeRootBinding, CoreNativeRootBindingMetadata, CoreRequestClaim } from "../../core/api";
import { CoreNativeBudgetError, isCoreDefinitiveCommitRefusal } from "../../core/api";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { makeBoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { chargeHostPreparation, retainPreparedHost, PreparedHostRuntimeError, type PreparedHostRuntime } from "../../execution/preparation/preparedHostRuntime";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import type { CmsContentIdentity } from "../cmsTransaction/construction";
import { getCmsCommand, type CmsCommand } from "../cmsTransaction/commands";
import { cmsLimits } from "../cmsTransaction/model";
import { getCommerceCommand, type CommerceCommand } from "../commerceTransaction/commands";
import type { CommerceInitialization } from "../commerceTransaction/initializationContract";
import { makeNativeCommerceInitialization } from "../commerceTransaction/nativeInitialization";
import { makeNativeCurrencyAnnouncementParticipants } from "./nativeParticipants";
import { compositeError, type CompositeFailure } from "./model";
import { projectCoreCompositeFailure } from "./nativeFailure";
import { captureCurrencyAnnouncementRequest, type CurrencyAnnouncementArguments } from "./request";
import type { CurrencyAnnouncementTestHooks } from "./testSupport";

export interface CurrencyAnnouncementHostInput {
  readonly hostRuntime: PreparedHostRuntime;
  readonly database: CoreDatabase;
  readonly rootBinding: CoreNativeRootBinding;
  readonly currencyBinding: CoreNativeBinding;
  readonly payloadBinding: CoreNativeBinding;
  readonly currencyCommand: CommerceCommand;
  readonly cmsCommand: CmsCommand;
  readonly currencyInitialization: CommerceInitialization;
  readonly expectedContentIdentity: CmsContentIdentity;
  readonly identityAndAccessPolicy: Json;
}
const RootResult = Schema.Struct({ currency: Schema.Json, cms: Schema.Json, applicationId: Schema.String })
  .annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeResult = Schema.decodeUnknownEffect(RootResult);
const coreResult = <A>(work: Effect.Effect<A, Parameters<typeof projectCoreCompositeFailure>[0]>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCoreCompositeFailure))));
const projectRetentionFailure = (failure: CompositeFailure | PreparedHostRuntimeError): CompositeFailure => failure instanceof PreparedHostRuntimeError
  ? compositeError(failure.reason === "closed" ? "closed" : "resourceFailure", failure) : failure;

/** The trusted outer owner holds the only claim, lifetime and finalizer. */
export const makeCurrencyAnnouncementHost = Effect.fn("CurrencyAnnouncement.makeNative")(function* (
  input: CurrencyAnnouncementHostInput,
  hooks?: Pick<CurrencyAnnouncementTestHooks, "beforeApplication" | "afterSteps">,
) {
  const retained = yield* retainPreparedHost(input.hostRuntime, compose(input, hooks)).pipe(
    Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetentionFailure))));
  return Object.freeze({ close: retained.close, newRequestKey: () => `composite/${crypto.randomUUID()}`,
    run: (key: string, args: Json) => retained.use(host => host.run(key, args)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetentionFailure)))) });
});

const compose = Effect.fn("CurrencyAnnouncement.composeNative")(function* (
  input: CurrencyAnnouncementHostInput,
  hooks?: Pick<CurrencyAnnouncementTestHooks, "beforeApplication" | "afterSteps">,
) {
  const { database, rootBinding, currencyBinding, payloadBinding } = input;
  const currencyCommand = getCommerceCommand(input.currencyCommand);
  const cmsCommand = getCmsCommand(input.cmsCommand);
  if (currencyCommand?.name !== "currencyAnnouncementWrite" || currencyCommand.mode !== "write"
    || cmsCommand?.name !== "payload-create" || cmsCommand.mode !== "write") return yield* compositeError("invalidAuthority");
  const access = yield* Effect.fromResult(capturePrivateJsonData(input.identityAndAccessPolicy, 65_536, compositeError));
  const content = Object.freeze({ ...input.expectedContentIdentity });
  const initialization = yield* makeNativeCommerceInitialization(database, currencyBinding, input.currencyInitialization);
  const readBinding = Effect.fn("CurrencyAnnouncement.readNativeBinding")(function* () {
    const root = yield* coreResult(database.readNativeRootBinding(rootBinding));
    const currency = yield* coreResult(database.readNativeBinding(currencyBinding));
    const payload = yield* coreResult(database.readNativeBinding(payloadBinding));
    const currencyChild = root.participants.find(participant => participant.binding === currencyBinding);
    const payloadChild = root.participants.find(participant => participant.binding === payloadBinding);
    if (root.participants.length !== 2 || root.applicationInsert === undefined || currencyChild === undefined || payloadChild === undefined
      || root.limits.maxIdentities !== 385 || root.limits.maxDocumentBytes !== 65_536 || root.maxFinalUserDocuments !== 128
      || root.applicationInsert.limits.maxIdentities !== 1 || root.applicationInsert.limits.maxDocumentBytes !== 65_536
      || currencyChild.limits.maxIdentities !== 128 || payloadChild.limits.maxIdentities !== 256
      || currencyChild.limits.maxDocumentBytes !== 65_536 || payloadChild.limits.maxDocumentBytes !== 65_536
      || !currencyChild.commands.some(command => command.name === currencyCommand.name && command.mode === "write")
      || !payloadChild.commands.some(command => command.name === cmsCommand.name && command.mode === "write")
      || payload.definition.identity.configSha256 !== content.configSha256
      || payload.definition.identity.provenanceSha256 !== content.provenanceSha256)
      return yield* compositeError("invalidAuthority");
    return { root, currency, payload };
  });
  const initial = yield* readBinding();
  yield* chargeHostPreparation({ root: initial.root.identity, currency: currencyCommand.name, cms: cmsCommand.name,
    policy: access.value, content }).pipe(Effect.mapError(projectRetentionFailure));
  const owner = Object.freeze({ hostId: Symbol("currencyAnnouncement.native") });
  const replayResult = Effect.fn("CurrencyAnnouncement.replayNativeResult")(function* (value: unknown, root: CoreNativeRootBindingMetadata) {
    const captured = yield* Effect.fromResult(capturePrivateJsonData(value, cmsLimits.commandBytes,
      (_reason, cause) => compositeError("storedCorruption", cause)));
    const result = yield* decodeResult(captured.value).pipe(Effect.mapError(cause => compositeError("storedCorruption", cause)));
    const id = yield* Effect.fromResult(decodeDocumentId(result.applicationId)).pipe(Effect.mapError(cause => compositeError("storedCorruption", cause)));
    if (id.tableNumber !== root.applicationInsert?.table.number) return yield* compositeError("storedCorruption");
    return result;
  });
  const execute = Effect.fn("CurrencyAnnouncement.executeNativeRoot")(function* (
    args: CurrencyAnnouncementArguments,
    inputBytes: number, claim: CoreRequestClaim,
  ) {
    const selected = yield* readBinding();
    const id = crypto.randomUUID();
    const lifetime = yield* makeBoundedRequestLifetime<CompositeFailure, object, object>(compositeError, cmsLimits, owner,
      Object.freeze({ requestId: Symbol("currencyAnnouncement.request") }), id, "write");
    const chargeRetained = (bytes: number) => lifetime.fromResult(lifetime.charge(bytes)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, failure => new CoreNativeBudgetError({
        reason: failure.reason === "limitExceeded" || failure.reason === "closed" || failure.reason === "rollbackOnly"
          ? failure.reason : "unexpectedFailure", cause: failure,
      })))));
    return yield* Effect.acquireUseRelease(coreResult(database.beginNativeRoot(rootBinding, { claim, chargeRetained })),
      operation => Effect.gen(function* () {
        const result = yield* Effect.gen(function* () {
          yield* lifetime.fromResult(lifetime.charge(inputBytes));
          const participants = yield* makeNativeCurrencyAnnouncementParticipants({ operation, root: selected.root,
            currencyBinding, currency: selected.currency, payloadBinding, lifetime, transactionId: id, currencyCommand, cmsCommand }, hooks);
          return yield* participants.execute(args);
        }).pipe(lifetime.withinDeadline);
        yield* lifetime.fromResult(lifetime.charge(result.canonicalBytes.byteLength));
        yield* lifetime.seal;
        yield* lifetime.close;
        yield* readBinding();
        return { value: result.valueJson, finalized: yield* coreResult(operation.finalize()), deadline: lifetime.deadlineUnixMilliseconds };
      }), operation => operation.abort()).pipe(Effect.ensuring(lifetime.close));
  });
  const abortWithCause = <Failure>(claim: CoreRequestClaim, cause: Cause.Cause<Failure>) => coreResult(database.abortRequest(claim)).pipe(
    Effect.exit, Effect.flatMap(aborted => Effect.failCause(Exit.isFailure(aborted) ? Cause.combine(cause, aborted.cause) : cause)));
  const run = Effect.fn("CurrencyAnnouncement.runNative")(function* (key: string, args: Json) {
    const selected = yield* readBinding();
    yield* initialization.requireReady;
    const request = yield* captureCurrencyAnnouncementRequest(key, args);
    const evidence = yield* capturePrivateCanonicalValue({ root: { ...selected.root.identity }, arguments: request.argumentsValue, policy: access.value },
      cmsLimits.commandBytes, { invalidInput: () => compositeError("invalidInput"), hashFailure: cause => compositeError("resourceFailure", cause) });
    const identity = { kind: "nativeRoot" as const, root: selected.root.identity, key: request.key, requestHash: evidence.sha256Hex };
    return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const observed = yield* coreResult(database.claimRequest(identity, rootBinding));
      const acquired = observed.kind === "busy" ? yield* coreResult(database.recoverRequest(identity)) : observed;
      if (acquired.kind === "committed") return yield* replayResult(acquired.result, (yield* readBinding()).root);
      if (acquired.kind !== "claimed") return yield* compositeError(acquired.kind === "busy" ? "overlappingOperation" : "requestConflict");
      const executed = yield* Effect.exit(restore(execute(request.argumentsValue, request.captured.bytes + evidence.canonicalByteLength, acquired.claim)));
      if (Exit.isFailure(executed)) return yield* abortWithCause(acquired.claim, executed.cause);
      const committed = yield* Effect.exit(database.commit(executed.value.finalized, { claim: acquired.claim, result: executed.value.value,
        admissionDeadlineUnixMilliseconds: executed.value.deadline }));
      if (Exit.isFailure(committed)) {
        const reason = committed.cause.reasons.length === 1 ? committed.cause.reasons[0] : undefined;
        const mapped = Cause.map(committed.cause, projectCoreCompositeFailure);
        return reason !== undefined && Cause.isFailReason(reason) && isCoreDefinitiveCommitRefusal(reason.error)
          ? yield* abortWithCause(acquired.claim, mapped) : yield* Effect.failCause(mapped);
      }
      yield* readBinding();
      return executed.value.value;
    }));
  });
  return Object.freeze({ run });
});
