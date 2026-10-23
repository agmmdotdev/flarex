import { createHash } from "node:crypto";
import { Cause, Effect, Exit, Schema, Scope, type Result } from "effect";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { encodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import { AppDocumentIdV1Schema, type AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { Json } from "flarex-protocol/json";
import { preparePrivateParticipantReadAccess } from "../../../persistence-postgres/src/execution/journal/privateReadAccess";
import { PrivateReverseReadPermissions } from "../../../persistence-postgres/src/execution/journal/privateReverseReadEvidence";
import { inspectPrivateReverseReadAccess, PRIVATE_REFERENCE_PAGE } from "../../../persistence-postgres/src/execution/journal/privateReverseReadAccess";
import { LogicalParticipantInvocationError } from "../../../persistence-postgres/src/storage/documents/logicalDocuments/participantErrors";
import { makeBorrowedLogicalAttempt } from "../../../persistence-postgres/src/frameworks/commerceTransaction/borrowedLogicalAttempt";
import { bindPrivateProductAttempt, executePrivateProductAttemptOperation, preparePrivateProductAttemptEventPolicy } from "@flarex/medusa-adapter/internal/product-attempt";
import { makePayloadReferencePages, type PayloadReferencePagesInstrumentation } from "../../../payload-adapter/src/runtime/referencePages";
import type { PrivatePayloadSaveFixture, PrivatePayloadSaveRoot } from "./privatePayloadSaveFixture";

type Root = Pick<PrivatePayloadSaveRoot, "attempt" | "validator" | "principal" | "admissions">;
type Store = PrivatePayloadSaveFixture["fixture"]["store"];
type AdmissionResult = Effect.Success<ReturnType<Store["runAdmittedOperationEffect"]>>;
type InvocationFailure = Effect.Error<ReturnType<Store["runAdmittedOperationEffect"]>> |
  Result.Result.Failure<ReturnType<typeof encodeAdmittedFrameworkOperationV1Result>>;
type Derive = Store["preparePrivateReverseReferencePagesEffect"];
interface BoundReverseRead {
  readonly access: Effect.Success<ReturnType<Derive>>;
  readonly selection: NonNullable<ReturnType<typeof inspectPrivateReverseReadAccess>>;
  readonly scope: Scope.Closeable;
  readonly closeEffect: Effect.Effect<void>;
  readonly close: () => Promise<void>;
  readonly invoke: (args: Json, at?: bigint) => Effect.Effect<AdmissionResult, InvocationFailure>;
}
interface ReverseReadCommands {
  readonly retrieve: () => Effect.Effect<AdmissionResult, InvocationFailure | LogicalParticipantInvocationError>;
  readonly derive: () => ReturnType<Derive>;
  readonly bind: () => Effect.Effect<BoundReverseRead, Effect.Error<ReturnType<Derive>> | Effect.Error<ReturnType<typeof makePayloadReferencePages>>>;
}
type Policy = typeof PrivateReverseReadPermissions.Type;
const sequence = (value: bigint) => CommitSyscallSequenceV1Schema.make(value);

/** Arrange protected data through the genuine command-only Application owner. */
export async function preparePrivateReverseReadPolicy(fixture: PrivatePayloadSaveFixture,
  input: Pick<Policy, "enumerate" | "articles">, documentId?: AppDocumentIdV1): Promise<{ root: Awaited<ReturnType<PrivatePayloadSaveFixture["fixture"]["open"]>>; documentId: AppDocumentIdV1; policy: Policy }> {
  const root = await fixture.fixture.open();
  const writer = await Effect.runPromise(fixture.fixture.store.preparePrivateApplicationCommandEffect(root.attempt, "audit"));
  const policy: Policy = { format: "flarex.private-reference-read-permissions", version: 1, principal: root.principal,
    collection: "posts", relation: "featuredProduct", ...input };
  const result = await Effect.runPromise(writer.run(documentId === undefined ? { kind: "insert", fields: { policy }, syscallSequence: sequence(1n) } :
    { kind: "replace", documentId, fields: { policy }, syscallSequence: sequence(1n) }, root.validator));
  if (result.kind !== "completed") throw new Error("Protected reverse-read policy refused");
  const id = result.outcome.kind === "inserted" ? result.outcome.documentId : documentId;
  if (id === undefined) throw new Error("Missing protected reverse-read policy identity");
  return { root, documentId: id, policy };
}

/** One exact native point-read profile. This fixture lends no query, permission,
 * publication or retry algorithm; real owners authenticate every invocation. */
export const preparePrivateReverseReadProfile = Effect.fn("PrivateReverseReadFixture.profile")(function* (
  fixture: PrivatePayloadSaveFixture, principal: Root["principal"], productId: string, targetIds: readonly string[] = [productId],
) {
  const target = yield* preparePrivateParticipantReadAccess({ principal, participant: "medusa.product", sourceKey: "medusa.product",
    nativeProfileRevision: "2".repeat(64), method: "retrieve", ids: targetIds });
  const product = bindPrivateProductAttempt(fixture.productRuntime);
  const events = yield* preparePrivateProductAttemptEventPolicy(product, { producerRevision: "2".repeat(64), contractRevision: "2".repeat(64),
    subscribers: [{ id: "private-reverse-read-proof", revision: "2".repeat(64) }] });
  const withPreparation: PrivatePayloadSaveFixture["withPreparation"] = work => fixture.withPreparation(preparation => work({ ...preparation,
    participants: preparation.participants.map(selected => selected.participant === "medusa.product" ? { ...selected, profileRevision: target.profileRevision } : selected),
    profiles: preparation.profiles.map(selected => selected.participant === "medusa.product" ? { ...selected, profileRevision: target.profileRevision } : selected),
  }));
  const project = (cause: unknown) => cause instanceof LogicalParticipantInvocationError ? cause : new LogicalParticipantInvocationError({ kind: "rejection", cause });
  const borrow = target.bind(input => Effect.gen(function* () {
    const admission = input.admissions[0];
    if (admission === undefined) return yield* Effect.fail(project("Missing native Product source"));
    const borrowed = yield* makeBorrowedLogicalAttempt({ ...input, admission });
    return { abort: borrowed.abort, currentUsage: borrowed.currentUsage,
      invoke: (method: string, args: Json) => executePrivateProductAttemptOperation(product, borrowed, method, args, events).pipe(
        Effect.map(completed => ({ ...completed, eventIntents: completed.eventIntents.map(intent => ({ sourceKey: "medusa.product", intent })) })),
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, project)))) };
  }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, project)))));
  return { target, productId, withPreparation, borrow };
});
export type PrivateReverseReadProfile = Effect.Success<ReturnType<typeof preparePrivateReverseReadProfile>>;
const frame = (participant: string, operation: string, args: Json) => Effect.fromResult(encodeAdmittedFrameworkOperationV1Result(
  { format: "flarex.admitted-framework-operation", version: 1, participant, operation, args }));

type BindOptions = Readonly<{ instrumentation?: PayloadReferencePagesInstrumentation; afterNative?: Effect.Effect<void> }>;
/** Read the actual protected point; keep native target execution separate so
 * refusal witnesses can test missing, wrong and replayed receipts. */
export const preparePrivateReverseReadCommands: (fixture: PrivatePayloadSaveFixture, root: Root, profile: PrivateReverseReadProfile,
  policyId: AppDocumentIdV1, options?: BindOptions) => Effect.Effect<ReverseReadCommands, Effect.Error<ReturnType<Store["readPrivateReverseReferencePermissionsEffect"]>>> = Effect.fn("PrivateReverseReadFixture.commands")(function* (
  fixture: PrivatePayloadSaveFixture, root: Root, profile: PrivateReverseReadProfile, policyId: AppDocumentIdV1, options: BindOptions = {},
) {
  const { store } = fixture.fixture;
  const evidence = yield* store.readPrivateReverseReferencePermissionsEffect(root.attempt,
    { tableName: "audit", documentId: policyId, syscallSequence: sequence(1n), principal: root.principal }, root.validator);
  const retrieve = Effect.fn("PrivateReverseReadFixture.retrieve")(function* () {
    const admission = root.admissions.get("medusa.product");
    if (admission === undefined) return yield* Effect.fail(new LogicalParticipantInvocationError({ kind: "rejection", cause: "Missing native Product admission" }));
    const request = yield* frame("medusa.product", "retrieve", { id: profile.productId });
    return yield* store.runAdmittedOperationEffect(root.attempt, admission, { syscallSequence: sequence(2n), requestBytes: request.bytes,
      requestSha256: createHash("sha256").update(request.bytes).digest(), participant: "medusa.product", method: "retrieve", profileRevision: profile.target.profileRevision }, profile.borrow);
  });
  const derive = () => store.preparePrivateReverseReferencePagesEffect(root.attempt, evidence,
    { participant: "payload", collection: "posts", relation: "featuredProduct", productId: profile.productId, nativeProfileRevision: "1".repeat(64) },
    { access: profile.target, syscallSequence: 2n });
  const bind = Effect.fn("PrivateReverseReadFixture.bind")(function* () {
    const access = yield* derive();
    const selection = inspectPrivateReverseReadAccess(access, root.attempt);
    if (selection === undefined) return yield* Effect.die(new Error("Missing issued reverse-read selection"));
    const scope = yield* Scope.make();
    const closeEffect = Scope.close(scope, Exit.void);
    const runtime = yield* Scope.provide(scope)(makePayloadReferencePages(fixture.compiled, root.attempt, access, options.instrumentation)).pipe(Effect.onError(() => closeEffect));
    const afterNative = options.afterNative;
    const borrow: typeof runtime.borrowParticipant = afterNative === undefined ? runtime.borrowParticipant : input => runtime.borrowParticipant(input).pipe(
      Effect.map(borrowed => ({ ...borrowed, invoke: (method, args) => borrowed.invoke(method, args).pipe(Effect.tap(() => afterNative)) })));
    let ordinal = 3n;
    const invoke = Effect.fn("PrivateReverseReadFixture.invoke")(function* (args: Json, at = ordinal++) {
      const request = yield* frame("payload", PRIVATE_REFERENCE_PAGE, args);
      return yield* store.runAdmittedOperationEffect(root.attempt, selection.admission, { syscallSequence: sequence(at), requestBytes: request.bytes,
        requestSha256: createHash("sha256").update(request.bytes).digest(), participant: "payload", method: PRIVATE_REFERENCE_PAGE, profileRevision: selection.profileRevision }, borrow);
    });
    return { access, selection, scope, closeEffect, close: () => Effect.runPromise(closeEffect), invoke };
  });
  return { retrieve, derive, bind };
});

/** Plain test arrangement around the same Effect operations used by RR3's real
 * execution owner. It adds no acceptance or snapshot behavior. */
export async function openPrivateReverseRead(fixture: PrivatePayloadSaveFixture, policyId: AppDocumentIdV1,
  principal: Root["principal"], productId: string, options: BindOptions & Readonly<{ targetIds?: readonly string[] }> = {}): Promise<{
    root: PrivatePayloadSaveRoot; target: PrivateReverseReadProfile["target"]; retrieve: ReverseReadCommands["retrieve"];
    derive: ReverseReadCommands["derive"]; profiles: NonNullable<Parameters<PrivatePayloadSaveRoot["publish"]>[1]>;
    bind: () => Promise<BoundReverseRead & { read: (limit: number, cursor?: string) => Promise<ReturnType<typeof decodePage>>;
      prepare: PrivatePayloadSaveRoot["preparePublication"] }>;
  }> {
  const profile = await Effect.runPromise(preparePrivateReverseReadProfile(fixture, principal, productId, options.targetIds));
  const { root, profiles } = await Effect.runPromise(profile.withPreparation(preparation => Effect.gen(function* () {
    const opened = yield* fixture.fixture.openEffect({ preparedAdmission: preparation.preparedAdmission, currentEntry: preparation.currentEntry, participants: preparation.participants });
    return { root: { ...opened, payloadProfile: preparation.payloadProfile }, profiles: preparation.profiles };
  })));
  const commands = await Effect.runPromise(preparePrivateReverseReadCommands(fixture, root, profile, policyId, options));
  const bind = async () => {
    const bound = await Effect.runPromise(commands.bind());
    const read = async (limit: number, cursor?: string) => {
      const result = await Effect.runPromise(bound.invoke({ limit, ...(cursor === undefined ? {} : { cursor }) }));
      if (result.kind !== "completed") throw new Error("Reverse page refused");
      return decodePage(result.result);
    };
    const prepare = () => root.preparePublication(null, { logicalOperationProfiles: [...profiles.filter(selected => selected.participant !== "payload"), root.payloadProfile(bound.selection.profileRevision)] });
    return { ...bound, read, prepare };
  };
  return { root, target: profile.target, retrieve: commands.retrieve, derive: commands.derive, bind, profiles };
}
const decodePage = Schema.decodeUnknownSync(Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: AppDocumentIdV1Schema, title: Schema.String })),
  hasMore: Schema.Boolean, cursor: Schema.NullOr(Schema.String) }));
