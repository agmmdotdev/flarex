import { Cause, Effect, Schema, Scope } from "effect";
import { inspectPrivateReverseReadAccess, PRIVATE_REFERENCE_PAGE,
  type LogicalParticipantBorrow, type PrivateReverseReadAccess, type SessionJournalAttempt } from "@flarex/persistence-postgres/internal/session-journal";
import { cmsError, cmsLimits } from "@flarex/persistence-postgres/internal/cms-adapter";
import { defineCmsCommand, makeBorrowedCmsInvocation, runCmsReadCommand, type BorrowedCmsAttemptInput } from "@flarex/persistence-postgres/internal/cms-execution";
import { inspectLogicalParticipantAdmissionBundle } from "@flarex/persistence-postgres/internal/logical-participant-admission";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { requireCompiledPayloadCollections, type CompiledPayloadCollections } from "../collections";
import { projectPayloadParticipantFailure } from "../participant/binding";
import { makePayloadNative, type PayloadNativeInstrumentation } from "./native";
import { inspectNativeReferencePagesAccess, readNativeReferencePage, makeBorrowedNativeCmsInvocation,
  type NativeReferencePagesAccess, type CmsRequestLifetime, type CoreNativeOperations } from "@flarex/persistence-postgres/internal/cms-execution";

const Page = Schema.Struct({ limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: cmsLimits.pageRows })), cursor: Schema.optionalKey(Schema.NonEmptyString) });
const decodePage = Schema.decodeUnknownEffect(Page, { onExcessProperty: "error" });
function referencePageCommand(findByID: Parameters<typeof runCmsReadCommand>[0], collection: string,
  requireOpen: Effect.Effect<void, ReturnType<typeof cmsError>>) {
  return defineCmsCommand({ name: PRIVATE_REFERENCE_PAGE, mode: "read", run: Effect.fn("PayloadReferencePages.run")(function* (context, args) {
    yield* requireOpen;
    if (context.privateReferencePage === undefined) return yield* cmsError("closed");
    const page = yield* decodePage(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    const members = yield* context.privateReferencePage(page);
    const docs: Json[] = [];
    for (const id of [...members.ids, ...(members.lookahead === null ? [] : [members.lookahead])]) {
      const document = yield* runCmsReadCommand(findByID, context, { collection, id, depth: 0 });
      if (!isJsonObject(document) || document.id !== id) return yield* cmsError("storedCorruption");
      if (docs.length < members.ids.length) docs.push(document);
    }
    return { docs, hasMore: members.hasMore, cursor: members.cursor };
  }) });
}
export interface PayloadReferencePagesInstrumentation extends PayloadNativeInstrumentation {
  readonly documentReads?: NonNullable<BorrowedCmsAttemptInput["documentReadTestHooks"]>;
}

/** Source-private instrumentation cannot supply policy, identities or cursor positions. */
export const makePayloadReferencePages = Effect.fn("PayloadReferencePages.make")(function* (
  compiled: CompiledPayloadCollections, attempt: SessionJournalAttempt, access: PrivateReverseReadAccess,
  instrumentation?: PayloadReferencePagesInstrumentation,
) {
  yield* requireCompiledPayloadCollections(compiled);
  const selected = inspectPrivateReverseReadAccess(access, attempt);
  if (selected === undefined || selected.method !== PRIVATE_REFERENCE_PAGE || selected.configSha256 !== compiled.contentIdentity.configSha256 ||
    selected.provenanceSha256 !== compiled.contentIdentity.provenanceSha256 ||
    !compiled.configuration.tables.some(table => table.collectionSlug === selected.collection && table.logicalTableName === selected.tableName))
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const token = Object.freeze({}), contextKey = "flarexPrivateReverseRead";
  const allowed: ReadonlySet<string> = new Set(selected.articleIds);
  let live = true;
  yield* Effect.addFinalizer(() => Effect.sync(() => { live = false; }));
  const native = yield* makePayloadNative(compiled, instrumentation, {
    create: () => false, update: () => false, delete: () => false,
    read: ({ id, req }) => live && inspectPrivateReverseReadAccess(access, attempt) !== undefined && req.context[contextKey] === token && typeof id === "string" && allowed.has(id),
  });
  const findByID = native.makeCommands({ ...instrumentation, requestContext: { [contextKey]: token } }).findByID;
  const command = referencePageCommand(findByID, selected.collection, Effect.suspend(() =>
    live && native.isLive() && inspectPrivateReverseReadAccess(access, attempt) !== undefined ? Effect.void : Effect.fail(cmsError("closed"))));
  const ownership = yield* native.makeAttemptOwnership();
  const borrowParticipant: LogicalParticipantBorrow = Effect.fn("PayloadReferencePages.borrow")(function* (input) {
    if (!live || !native.isLive() || input.attempt !== attempt || input.bundle !== selected.admission || input.method !== PRIVATE_REFERENCE_PAGE ||
      inspectPrivateReverseReadAccess(access, attempt) === undefined)
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const bundle = inspectLogicalParticipantAdmissionBundle(input.bundle, attempt, selected.participant, input.method, selected.profileRevision);
    const admission = input.admissions[0];
    if (bundle === null || bundle.admissions.length !== 1 || input.admissions.length !== 1 || admission === undefined || bundle.admissions[0] !== admission)
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const borrowed = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const cms = yield* restore(makeBorrowedCmsInvocation({ ...input, admission, privateReverseRead: access,
        ...(instrumentation?.documentReads === undefined ? {} : { documentReadTestHooks: instrumentation.documentReads }) }));
      yield* Scope.addFinalizer(ownership.scope, cms.abort);
      return cms;
    }));
    return { abort: borrowed.abort, currentUsage: borrowed.currentUsage, invoke: Effect.fn("PayloadReferencePages.invoke")(function* (method, args) {
      if (method !== PRIVATE_REFERENCE_PAGE || !live || inspectPrivateReverseReadAccess(access, attempt) === undefined)
        return yield* Effect.fail(cmsError("invalidAuthority"));
      return yield* borrowed.invoke(command, args);
    }, Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectPayloadParticipantFailure)))) };
  }, Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectPayloadParticipantFailure))));
  return Object.freeze({ borrowParticipant, profileRevision: selected.profileRevision });
});

/** Private backend construction only; no Worker/public entry or borrowed find/count. */
export const makePayloadReferencePagesRuntime = Effect.fn("PayloadReferencePages.makeRuntime")(function* (
  compiled: CompiledPayloadCollections, attempt: SessionJournalAttempt, access: PrivateReverseReadAccess,
) { return yield* makePayloadReferencePages(compiled, attempt, access); });

/** Same native per-document access and visible lookahead behavior over the
 * translated membership page owner. Cursor positions never leave that owner. */
export const makePayloadNativeReferencePages = Effect.fn("PayloadReferencePages.makeNative")(function* (
  compiled: CompiledPayloadCollections,
  input: Readonly<{ operations: CoreNativeOperations; lifetime: CmsRequestLifetime; transactionId: string; access: NativeReferencePagesAccess }>,
  instrumentation?: PayloadNativeInstrumentation,
) {
  yield* requireCompiledPayloadCollections(compiled);
  const selected = inspectNativeReferencePagesAccess(input.access, input.lifetime);
  if (selected === undefined || selected.configSha256 !== compiled.contentIdentity.configSha256
    || selected.provenanceSha256 !== compiled.contentIdentity.provenanceSha256
    || !compiled.configuration.tables.some(table => table.collectionSlug === selected.collection && table.logicalTableName === selected.table))
    return yield* cmsError("invalidAuthority");
  const token = Object.freeze({}), contextKey = "flarexPrivateReverseRead", allowed = new Set(selected.articleIds);
  const native = yield* makePayloadNative(compiled, instrumentation, { create: () => false, update: () => false, delete: () => false,
    read: ({ id, req }) => inspectNativeReferencePagesAccess(input.access, input.lifetime) !== undefined
      && req.context[contextKey] === token && typeof id === "string" && allowed.has(id) });
  const findByID = native.makeCommands({ ...instrumentation, requestContext: { [contextKey]: token } }).findByID;
  const command = referencePageCommand(findByID, selected.collection, Effect.suspend(() => native.isLive()
    && inspectNativeReferencePagesAccess(input.access, input.lifetime) !== undefined ? Effect.void : Effect.fail(cmsError("closed"))));
  const borrowed = makeBorrowedNativeCmsInvocation({ operations: input.operations, lifetime: input.lifetime,
    transactionId: input.transactionId, commands: [command],
    privateReferencePage: page => readNativeReferencePage(input.access, input.lifetime, page) });
  const page = Effect.fn("PayloadReferencePages.pageNative")((args: Json) => borrowed.invoke(command, args),
    Effect.catchCause(cause => Effect.fromResult(input.lifetime.recordFailure(input.lifetime.context, cause)).pipe(
      Effect.flatMap(recorded => Effect.failCause(recorded)))));
  return Object.freeze({ page });
});
