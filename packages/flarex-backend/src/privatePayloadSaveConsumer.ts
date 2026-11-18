import { Effect, type Scope } from "effect";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { Json } from "flarex-protocol/json";
import type { PointMutationJournalV1, PointMutationJournalAttemptV1 } from "@flarex/executor/point-mutation-journal";
import type { PointMutationOccBoundJournalV1 } from "@flarex/executor/internal/application-point-mutation-runner";
import type { SessionJournalAttempt, SessionJournalStorePersistence, PrivateReadPrincipal,
  PrivateReferenceSaveSelection } from "@flarex/persistence-postgres/internal/session-journal";
import type { ApplicationRevisionSyscallValidatorV1 } from "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import { cmsError, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { makePayloadReferenceSaveRuntime, makePayloadNativeReferenceSave, type PayloadNativeInstrumentation } from "@flarex/payload-adapter/internal/runtime";
import type { CompiledPayloadCollections } from "@flarex/payload-adapter/internal/collections";
import type { CoreError, CoreNativeBinding, CoreNativeRootBindingMetadata,
  CoreNativeRootOperation } from "@flarex/persistence-postgres/internal/core";
import { prepareNativeReferenceSaveAccess } from "@flarex/persistence-postgres/internal/cms-native";
import type { CmsRequestLifetime } from "@flarex/persistence-postgres/internal/cms-execution";

type SaveJournal = Pick<SessionJournalStorePersistence, "readPrivateReferencePermissionsEffect" | "preparePrivateReferenceSaveEffect">;
interface SaveConsumerInput {
  readonly store: SaveJournal;
  readonly attempt: SessionJournalAttempt;
  readonly principal: PrivateReadPrincipal;
  readonly validator: ApplicationRevisionSyscallValidatorV1;
  readonly owner: PointMutationJournalV1;
  readonly journalAttempt: PointMutationJournalAttemptV1;
  readonly journal: PointMutationOccBoundJournalV1;
  readonly policy: Readonly<{ tableName: string; documentId: AppDocumentIdV1 }>;
  readonly selection: PrivateReferenceSaveSelection;
}
export interface PrivatePayloadSaveConsumer {
  readonly journal: PointMutationOccBoundJournalV1;
  readonly initialSyscallSequence: bigint;
  readonly profileRevision: string;
}
type SaveConsumerFailure = Effect.Error<ReturnType<SaveJournal["readPrivateReferencePermissionsEffect"]>> |
  Effect.Error<ReturnType<SaveJournal["preparePrivateReferenceSaveEffect"]>> |
  Effect.Error<ReturnType<typeof makePayloadReferenceSaveRuntime>> |
  Effect.Error<ReturnType<NonNullable<PointMutationJournalV1["bindPrivateReferenceSave"]>>>;

/** Selected private serving composition, once per pristine finite attempt.
 * Backend composition selects the policy point; the Worker receives only the
 * ordinary journal facade and operation cursor, never the policy or capability.
 * Scope owns the native instance; existing execution owners publish/retry. */
export const makePrivatePayloadSaveConsumer: (compiled: CompiledPayloadCollections, input: SaveConsumerInput) =>
  Effect.Effect<PrivatePayloadSaveConsumer, SaveConsumerFailure, Scope.Scope> =
  Effect.fn("PrivatePayloadSaveConsumer.make")(function* (compiled, input) {
    const bind = input.owner.bindPrivateReferenceSave;
    if (bind === undefined) return yield* Effect.fail(cmsError("unsupportedProfile"));
    const initialSyscallSequence = 1n;
    const facts = yield* input.store.readPrivateReferencePermissionsEffect(input.attempt, {
      ...input.policy, principal: input.principal, syscallSequence: CommitSyscallSequenceV1Schema.make(initialSyscallSequence),
    }, input.validator);
    const access = yield* input.store.preparePrivateReferenceSaveEffect(input.attempt, facts, input.selection);
    const native = yield* makePayloadReferenceSaveRuntime(compiled, input.attempt, access);
    const selected = yield* bind(input.journalAttempt, input.selection.participant, access, native.borrowParticipant);
    return Object.freeze({ journal: Object.freeze({ ...input.journal, runAdmittedOperation: selected.runAdmittedOperation }),
      initialSyscallSequence, profileRevision: selected.profileRevision });
  });

/** Selected translated-root save composition. The permission point, effective
 * native transitions and ordinary Application work retain the same root. The
 * Worker receives only the admitted invocation closure returned here. */
interface NativeSaveConsumerInput {
  readonly operation: CoreNativeRootOperation; readonly root: CoreNativeRootBindingMetadata;
  readonly binding: CoreNativeBinding; readonly lifetime: CmsRequestLifetime;
  readonly transactionId: string; readonly principal: PrivateReadPrincipal; readonly policyDocumentId: string;
  readonly collection: string; readonly relation: string;
}
interface NativeSaveConsumer { readonly invoke: (method: "create" | "update" | "delete", args: Json) => Effect.Effect<Json, CmsTransactionError> }
export const makePrivatePayloadNativeSaveConsumer: (compiled: CompiledPayloadCollections, input: NativeSaveConsumerInput, instrumentation?: PayloadNativeInstrumentation) =>
  Effect.Effect<NativeSaveConsumer, CoreError | CmsTransactionError, Scope.Scope> = Effect.fn("PrivatePayloadSaveConsumer.makeNative")(function* (
  compiled, input, instrumentation,
) {
  const grant = input.root.applicationRead?.binding;
  const table = compiled.configuration.tables.find(candidate => candidate.collectionSlug === input.collection);
  const participant = input.root.participants.find(candidate => candidate.binding === input.binding);
  if (grant === undefined || table === undefined || participant === undefined)
    return yield* cmsError("invalidAuthority");
  const application = yield* input.operation.applicationRead(grant);
  const access = yield* prepareNativeReferenceSaveAccess({ application, policyDocumentId: input.policyDocumentId,
    principal: input.principal, native: participant, collection: input.collection, table: table.logicalTableName,
    field: input.relation, lifetime: input.lifetime, transactionId: input.transactionId });
  return yield* makePayloadNativeReferenceSave(compiled, { operations: yield* input.operation.native(input.binding),
    lifetime: input.lifetime, transactionId: input.transactionId, access }, instrumentation);
});
