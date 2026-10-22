import { createHash } from "node:crypto";
import { Effect, Exit, Scope, type Result } from "effect";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { encodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import type { Json } from "flarex-protocol/json";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { PrivateReferencePermissions } from "../../../persistence-postgres/src/execution/journal/privatePermissionEvidence";
import { inspectPrivateReferenceSaveAccess } from "../../../persistence-postgres/src/execution/journal/privateSaveAccess";
import { makePayloadReferenceSave } from "../../../payload-adapter/src/runtime/referenceSave";
import type { PayloadNativeInstrumentation } from "../../../payload-adapter/src/runtime/native";
import type { CmsTransactionError } from "../../../persistence-postgres/src/frameworks/cmsTransaction/model";
import type { PrivatePayloadSaveFixture, PrivatePayloadSaveRoot } from "./privatePayloadSaveFixture";

export type PrivateSavePolicyInput = Pick<typeof PrivateReferencePermissions.Type, "source" | "assign" | "retain">;
const sequence = (value: bigint) => CommitSyscallSequenceV1Schema.make(value);
type Store = PrivatePayloadSaveFixture["fixture"]["store"];
export interface BoundPrivatePayloadSave {
  readonly facts: Effect.Success<ReturnType<Store["readPrivateReferencePermissionsEffect"]>>;
  readonly access: Effect.Success<ReturnType<Store["preparePrivateReferenceSaveEffect"]>>;
  readonly selected: NonNullable<ReturnType<typeof inspectPrivateReferenceSaveAccess>>;
  readonly invoke: (method: "create" | "update" | "delete", args: Json, ordinal?: bigint) => Effect.Effect<
    Effect.Success<ReturnType<Store["runAdmittedOperationEffect"]>>,
    Effect.Error<ReturnType<Store["runAdmittedOperationEffect"]>> | Result.Result.Failure<ReturnType<typeof encodeAdmittedFrameworkOperationV1Result>>>;
  readonly close: () => Promise<void>;
  readonly closeEffect: Effect.Effect<void>;
}
type SaveOptions = Readonly<{ instrumentation?: PayloadNativeInstrumentation; policySequence?: bigint; afterNative?: Effect.Effect<void> }>;
type SaveRoot = Pick<PrivatePayloadSaveRoot, "attempt" | "principal" | "validator">;
type SaveFailure = Effect.Error<ReturnType<Store["readPrivateReferencePermissionsEffect"]>> |
  Effect.Error<ReturnType<Store["preparePrivateReferenceSaveEffect"]>> | CmsTransactionError;

/** Arrange policy data through its genuine protected command; callers choose
 * when to publish so PostgreSQL tests can schedule the two real publishers. */
export async function preparePrivateSavePolicy(fixture: PrivatePayloadSaveFixture, input: PrivateSavePolicyInput,
  documentId?: AppDocumentIdV1): Promise<{ readonly root: Awaited<ReturnType<PrivatePayloadSaveFixture["fixture"]["open"]>>;
    readonly documentId: AppDocumentIdV1 }> {
  const root = await fixture.fixture.open();
  const writer = await Effect.runPromise(fixture.fixture.store.preparePrivateApplicationCommandEffect(root.attempt, "audit"));
  const fields = { policy: { format: "flarex.private-reference-permissions", version: 1, principal: root.principal,
    collection: "posts", relation: "featuredProduct", ...input } };
  const result = await Effect.runPromise(writer.run(documentId === undefined ? { kind: "insert", syscallSequence: sequence(1n), fields } :
    { kind: "replace", syscallSequence: sequence(1n), documentId, fields }, root.validator));
  if (result.kind !== "completed") throw new Error("Permission setup was refused");
  const id = result.outcome.kind === "inserted" ? result.outcome.documentId : documentId;
  if (id === undefined) throw new Error("Missing protected policy identity");
  return { root, documentId: id };
}

/** Genuine permission acquisition and native invocation only. This helper
 * contains no permission classifier, retry, recovery or publication logic. */
export const bindPrivatePayloadSaveEffect: (fixture: PrivatePayloadSaveFixture, root: SaveRoot,
  policyId: AppDocumentIdV1, options?: SaveOptions) => Effect.Effect<BoundPrivatePayloadSave, SaveFailure> =
  Effect.fn("PrivatePayloadSaveFixture.bind")(function* (fixture, root, policyId, options = {}) {
  const { store } = fixture.fixture;
  const at = options.policySequence ?? 1n;
  const facts = yield* store.readPrivateReferencePermissionsEffect(root.attempt,
    { tableName: "audit", documentId: policyId, syscallSequence: sequence(at), principal: root.principal }, root.validator);
  const access = yield* store.preparePrivateReferenceSaveEffect(root.attempt, facts,
    { participant: "payload", collection: "posts", relation: "featuredProduct", nativeProfileRevision: "1".repeat(64) });
  const selected = inspectPrivateReferenceSaveAccess(access, root.attempt);
  if (selected === undefined) throw new Error("Missing genuine private save selection");
  const scope = yield* Scope.make();
  const closeEffect = Scope.close(scope, Exit.void);
  const native = yield* Scope.provide(scope)(makePayloadReferenceSave(fixture.compiled, root.attempt, access, options.instrumentation)).pipe(
    Effect.onError(() => closeEffect));
  const afterNative = options.afterNative;
  const borrow: typeof native.borrowParticipant = afterNative === undefined ? native.borrowParticipant : input =>
    native.borrowParticipant(input).pipe(Effect.map(borrowed => ({ ...borrowed,
      invoke: (method, args) => borrowed.invoke(method, args).pipe(Effect.tap(() => afterNative)) })));
  let next = at + 1n;
  const invoke = (method: "create" | "update" | "delete", args: Json, ordinal = next++) => Effect.gen(function* () {
    const frame = yield* Effect.fromResult(encodeAdmittedFrameworkOperationV1Result({ format: "flarex.admitted-framework-operation", version: 1,
      participant: "payload", operation: `payload-${method}`, args }));
    return yield* store.runAdmittedOperationEffect(root.attempt, selected.admission,
      { syscallSequence: sequence(ordinal), requestBytes: frame.bytes, requestSha256: createHash("sha256").update(frame.bytes).digest(),
        participant: "payload", method: `payload-${method}`, profileRevision: selected.profileRevision }, borrow);
  });
  return { facts, access, selected, invoke, closeEffect, close: () => Effect.runPromise(closeEffect) };
});
export const bindPrivatePayloadSave = (fixture: PrivatePayloadSaveFixture, root: SaveRoot,
  policyId: AppDocumentIdV1, options?: SaveOptions): Promise<BoundPrivatePayloadSave> =>
  Effect.runPromise(bindPrivatePayloadSaveEffect(fixture, root, policyId, options));
