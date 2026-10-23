import { Effect, type Result, type Scope } from "effect";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { encodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { PointMutationJournalV1, PointMutationJournalAttemptV1 } from "@flarex/executor/point-mutation-journal";
import type { PointMutationOccBoundJournalV1 } from "@flarex/executor/internal/application-point-mutation-runner";
import type { SessionJournalAttempt, SessionJournalStorePersistence, PrivateReadPrincipal,
  PrivateReverseReadSelection, PrivateReverseReadTarget } from "@flarex/persistence-postgres/internal/session-journal";
import type { ApplicationRevisionSyscallValidatorV1 } from "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import { cmsError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { makePayloadReferencePagesRuntime } from "@flarex/payload-adapter/internal/runtime";
import type { CompiledPayloadCollections } from "@flarex/payload-adapter/internal/collections";

type ReadJournal = Pick<SessionJournalStorePersistence, "readPrivateReverseReferencePermissionsEffect" | "preparePrivateReverseReferencePagesEffect">;
interface ReverseReadConsumerInput {
  readonly store: ReadJournal;
  readonly attempt: SessionJournalAttempt;
  readonly principal: PrivateReadPrincipal;
  readonly validator: ApplicationRevisionSyscallValidatorV1;
  readonly owner: PointMutationJournalV1;
  readonly journalAttempt: PointMutationJournalAttemptV1;
  readonly journal: PointMutationOccBoundJournalV1;
  readonly policy: Readonly<{ tableName: string; documentId: AppDocumentIdV1 }>;
  readonly selection: PrivateReverseReadSelection;
  readonly target: Readonly<{ participant: string; access: PrivateReverseReadTarget["access"] }>;
}
export interface PrivatePayloadReverseReadConsumer {
  readonly journal: PointMutationOccBoundJournalV1;
  readonly initialSyscallSequence: bigint;
  readonly profileRevision: string;
}
type ReadConsumerFailure = Effect.Error<ReturnType<ReadJournal["readPrivateReverseReferencePermissionsEffect"]>> |
  Effect.Error<ReturnType<ReadJournal["preparePrivateReverseReferencePagesEffect"]>> |
  Effect.Error<ReturnType<typeof makePayloadReferencePagesRuntime>> |
  Effect.Error<ReturnType<NonNullable<PointMutationJournalV1["bindPrivateReverseReferenceRead"]>>> |
  Result.Result.Failure<ReturnType<typeof encodeAdmittedFrameworkOperationV1Result>>;

/** Source-private construction seam for native lifecycle witnesses. It is not
 * exported by the package; ordinary construction always selects the real runtime. */
export const makePrivatePayloadReverseReadConsumerWithRuntime: (
  compiled: CompiledPayloadCollections, input: ReverseReadConsumerInput, makeNative: typeof makePayloadReferencePagesRuntime,
) => Effect.Effect<PrivatePayloadReverseReadConsumer, ReadConsumerFailure, Scope.Scope> =
  Effect.fn("PrivatePayloadReverseReadConsumer.construct")(function* (compiled, input, makeNative) {
    const bind = input.owner.bindPrivateReverseReferenceRead;
    const retrieve = input.owner.runAdmittedOperation;
    if (bind === undefined || retrieve === undefined) return yield* Effect.fail(cmsError("unsupportedProfile"));
    const evidence = yield* input.store.readPrivateReverseReferencePermissionsEffect(input.attempt, {
      ...input.policy, principal: input.principal, syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
    }, input.validator);
    const targetSequence = CommitSyscallSequenceV1Schema.make(2n);
    const request = yield* Effect.fromResult(encodeAdmittedFrameworkOperationV1Result({
      format: "flarex.admitted-framework-operation", version: 1, participant: input.target.participant,
      operation: "retrieve", args: { id: input.selection.productId },
    }));
    const requestSha256 = yield* Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(request.bytes)),
      catch: cause => cmsError("resourceFailure", cause) });
    yield* retrieve(input.journalAttempt, { syscallSequence: targetSequence, operation: request.operation,
      requestBytes: request.bytes, requestSha256: new Uint8Array(requestSha256) });
    const access = yield* input.store.preparePrivateReverseReferencePagesEffect(input.attempt, evidence, input.selection,
      { access: input.target.access, syscallSequence: targetSequence });
    const native = yield* makeNative(compiled, input.attempt, access);
    const selected = yield* bind(input.journalAttempt, input.selection.participant, access, native.borrowParticipant);
    return Object.freeze({ journal: Object.freeze({ ...input.journal, runAdmittedOperation: selected.runAdmittedOperation }),
      initialSyscallSequence: 2n, profileRevision: selected.profileRevision });
  });

/** Selected private serving composition, once per pristine finite root. The
 * Worker receives only Application operations and the authorized page method.
 * Native target receipt, issued policy evidence and root capabilities stay trusted. */
export const makePrivatePayloadReverseReadConsumer: (compiled: CompiledPayloadCollections, input: ReverseReadConsumerInput) =>
  Effect.Effect<PrivatePayloadReverseReadConsumer, ReadConsumerFailure, Scope.Scope> =
  Effect.fn("PrivatePayloadReverseReadConsumer.make")(function* (compiled, input) {
    return yield* makePrivatePayloadReverseReadConsumerWithRuntime(compiled, input, makePayloadReferencePagesRuntime);
  });
