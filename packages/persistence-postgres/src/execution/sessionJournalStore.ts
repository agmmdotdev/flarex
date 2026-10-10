import type {
  SessionJournalAttempt,
  SessionJournalParticipantSelection,
  SessionJournalStorePersistence,
} from "./journal/contracts";
import {
  InvalidSessionJournalCapabilityV1Error,
  SessionJournalPersistenceV1Error,
} from "./journal/errors";
import { inspectAppDeveloperIndexQueryPortV1 } from "./journal/indexQueryPort";
import type { AppDeveloperIndexQueryPortV1 } from "./journal/indexQueryPort";
import type { StoredCommitAuthorityEvidenceLoaderPortsV1 } from "../commit/authority/postgresLoader";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { GrantRetentionPolicyV1 } from "flarex-protocol/grant-retention-policy";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import {
  hasApplicationRelationReadPortAuthorityForPointCommit,
} from "../application/relations/applicationRelationRead";
import type { ApplicationRelationReadPort } from "../application/relations/applicationRelationRead";
import { LogicalParticipantAdmissionError } from "../storage/documents/logicalDocuments/participantErrors";
import {
  issueLogicalParticipantAdmissionBundle,
} from "../storage/documents/logicalDocuments/participantAdmission";
import type {
  LogicalParticipantSelection,
} from "../storage/documents/logicalDocuments/participantAdmission";
import type {
  ApplicationBindingInput,
} from "../application/activation/contracts";
import {
  withSharedLogicalSourceBindingChecks,
} from "../storage/documents/logicalDocuments/sourceAdmission";
import { fxSystemTransactionSessions } from "../database/schema";
import { ExactRunningAttemptTransactionV1Error } from "./transactionSessionAttemptKernel";
import { claimConfirmedFiniteEntryAttempt } from "./journal/finiteEntry";
import { captureAttemptStateResult } from "./journal/inputCapture";
import { createJournalAttemptOwner } from "./journal/attemptOwner";
import {
  makeJournalTargetResolver,
  admitExactRunningAttemptEffect,
  makeAttemptReadTransaction,
} from "./journal/targetAdmission";
import {
  captureFiniteEntrySelections,
  prepareFiniteRootInTransactionEffect,
  makeFiniteRootLifecycle,
} from "./journal/finiteRoot";
import { makeParticipantOperationRunner } from "./journal/participantOperations";
import { makePointOperations } from "./journal/pointOperations";
import { makeIndexedQueries } from "./journal/indexedQueries";
import { makeRelationReads } from "./journal/relationReads";
import { makeJournalSeal } from "./journal/seal";

const sameParticipantSelection = (
  left: SessionJournalParticipantSelection,
  right: SessionJournalParticipantSelection,
): boolean =>
  left.participant === right.participant &&
  left.profileRevision === right.profileRevision &&
  left.operationMethods.length === right.operationMethods.length &&
  left.operationMethods.every(
    (method, ordinal) => method === right.operationMethods[ordinal],
  ) &&
  left.sources.length === right.sources.length &&
  left.sources.every((source, ordinal) => {
    const other = right.sources[ordinal];
    return (
      other !== undefined &&
      source.selection === other.selection &&
      source.application === other.application &&
      source.methods.length === other.methods.length &&
      source.methods.every(
        (method, position) => method === other.methods[position],
      )
    );
  });

export interface SessionJournalStorePersistenceOptionsV1 {
  /** Trusted deployment configuration; never derived from request evidence. */
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
  /** Construction-bound server randomness; exposed only for deterministic tests. */
  readonly randomUuid?: () => string;
  readonly indexedQueries?: AppDeveloperIndexQueryPortV1;
  readonly applicationRelations?: ApplicationRelationReadPort;
  /** Package-internal deterministic fault seam used by the persistence proof. */
  readonly faultAfter?: (
    point:
      | "indexedQueryEvidenceWritten"
      | "relationReadEvidenceWritten"
      | "relationConflictEvidenceWritten",
  ) => void | Promise<void>;
}

export function createSessionJournalStorePersistence(
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  options: SessionJournalStorePersistenceOptionsV1,
): SessionJournalStorePersistence {
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const indexedQueryPort = options.indexedQueries;
  const applicationRelationPort = options.applicationRelations;
  const faultAfter = options.faultAfter;
  const indexedQueryPortState =
    indexedQueryPort === undefined
      ? undefined
      : inspectAppDeveloperIndexQueryPortV1(indexedQueryPort);
  const applicationRelationCompositionIsExact =
    applicationRelationPort !== undefined &&
    hasApplicationRelationReadPortAuthorityForPointCommit(
      applicationRelationPort,
      ports,
    );
  const maximumLiveSnapshotRetentionMilliseconds =
    options.grantRetentionPolicy.maximumLiveSnapshotRetentionMilliseconds;
  const owner = createJournalAttemptOwner();
  const resolveJournalTargetEffect = makeJournalTargetResolver(ports, owner);
  const { runAdmittedOperationEffect } = makeParticipantOperationRunner(
    owner,
    resolveJournalTargetEffect,
  );
  const { resolvePointTableEffect, runPointOperationEffect } =
    makePointOperations(owner, resolveJournalTargetEffect, randomUuid);
  const { resolveDeveloperIndexEffect, runIndexedQueryEffect } =
    makeIndexedQueries(
      owner,
      resolveJournalTargetEffect,
      ports,
      indexedQueryPortState,
      faultAfter,
    );
  const {
    resolveApplicationRelationReadEffect,
    runApplicationRelationIncomingReadEffect,
  } = makeRelationReads(
    owner,
    resolveJournalTargetEffect,
    applicationRelationPort,
    applicationRelationCompositionIsExact,
    faultAfter,
  );
  const { prepareSealEffect, completeSealEffect } = makeJournalSeal(
    owner,
    resolveJournalTargetEffect,
    maximumLiveSnapshotRetentionMilliseconds,
  );
  const { freezeFiniteRootEffect, discardFiniteRootEffect } =
    makeFiniteRootLifecycle(owner);
  const prepareFiniteEntryEffect: SessionJournalStorePersistence["prepareFiniteEntryEffect"] =
    Effect.fn("SessionJournalStore.prepareFiniteEntry")(
      function* (participants) {
        if (
          participants.length > 3 ||
          new Set(participants.map((participant) => participant.participant))
            .size !== participants.length ||
          participants.some(
            (participant) =>
              participant.sources.length === 0 ||
              participant.sources.length > 3,
          )
        )
          return yield* Effect.fail(
            new LogicalParticipantAdmissionError({
              reason: "unsupportedProfile",
            }),
          );
        if (!owner.hasFiniteCapacity())
          yield* owner
            .retireFinishedFiniteRootsEffect(resolveJournalTargetEffect)
            .pipe(
              Effect.mapError((error) =>
                error instanceof ExactRunningAttemptTransactionV1Error
                  ? new SessionJournalPersistenceV1Error({
                      operation: "openAttempt",
                      cause: error,
                    })
                  : error,
              ),
            );
        const selections = captureFiniteEntrySelections(participants);
        const handle = owner.createAttemptHandle();
        return yield* owner.reserveFiniteEntryEffect(
          ports,
          handle,
          (
            preparation,
            tx,
            context,
            resolved,
            application,
            binding,
            control,
            canonicalExecutionAuthority,
            verifyFinalRows,
            observation,
          ) =>
            withSharedLogicalSourceBindingChecks(tx, () =>
              prepareFiniteRootInTransactionEffect(
                handle,
                selections,
                preparation,
                tx,
                context,
                resolved,
                application,
                binding,
                control,
                canonicalExecutionAuthority,
                verifyFinalRows,
                observation,
              ),
            ),
        );
      },
    );
  const confirmedFiniteEntryAttempt: SessionJournalStorePersistence["confirmedFiniteEntryAttempt"] =
    (capture, preparation) =>
      claimConfirmedFiniteEntryAttempt(capture, preparation, ports);

  const openAttemptEffect: SessionJournalStorePersistence["openAttemptEffect"] =
    Effect.fn("SessionJournalStore.openAttempt")(function* (input) {
      const state = yield* Effect.fromResult(captureAttemptStateResult(input));
      if (state.executionProfile === "finiteRoot")
        return yield* Effect.fail(
          new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
        );
      const resolved = yield* resolveJournalTargetEffect(state);
      const handle = owner.createAttemptHandle();
      yield* admitExactRunningAttemptEffect(resolved, state, "openAttempt");
      owner.registerAttempt(handle, state);
      return handle;
    });

  const admitSourceEffect = Effect.fn("SessionJournalStore.admitSource")(
    function* (
      attempt: SessionJournalAttempt,
      input: Readonly<{
        selection: LogicalParticipantSelection;
        application: ApplicationBindingInput;
        methods: readonly string[];
      }>,
    ) {
      const attemptState =
        typeof attempt === "object" && attempt !== null
          ? owner.readAttempt(attempt)
          : undefined;
      if (attemptState === undefined) {
        return yield* Effect.fail(
          new InvalidSessionJournalCapabilityV1Error({
            capability: "attempt",
          }),
        );
      }
      const resolved = yield* resolveJournalTargetEffect(attemptState);
      const readTransaction = makeAttemptReadTransaction(
        attemptState,
        resolved,
      );
      const principalRows = yield* readTransaction((tx) =>
        Effect.tryPromise({
          try: () =>
            tx
              .select({
                digest: fxSystemTransactionSessions.identityAccessPolicySha256,
              })
              .from(fxSystemTransactionSessions)
              .where(
                and(
                  eq(
                    fxSystemTransactionSessions.scopeUuid,
                    projectScopeIdUuidV1(attemptState.selector.scopeId)
                      .scopeUuid,
                  ),
                  eq(
                    fxSystemTransactionSessions.sessionId,
                    attemptState.selector.sessionId,
                  ),
                  eq(
                    fxSystemTransactionSessions.attemptFence,
                    attemptState.selector.attemptFence,
                  ),
                ),
              )
              .limit(2),
          catch: (cause) =>
            new SessionJournalPersistenceV1Error({
              operation: "admitLogicalParticipant",
              cause,
            }),
        }),
      );
      if (
        principalRows.length !== 1 ||
        principalRows[0]?.digest.byteLength !== 32
      ) {
        return yield* Effect.fail(
          new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
        );
      }
      const principalDigest = encodeBytesToLowercaseHex(
        principalRows[0].digest,
      );
      return yield* input.selection.bindAttemptEffect(
        input.application,
        attempt,
        {
          scopeId: attemptState.selector.scopeId,
          sessionId: attemptState.selector.sessionId,
          attemptFence: attemptState.selector.attemptFence,
          principalDigest,
          executionProfile: attemptState.executionProfile,
          snapshotCommitSeq: attemptState.snapshotToken.commitSeq,
          schemaVersionId: attemptState.schemaVersionId,
        },
        readTransaction,
        input.methods,
      );
    },
  );

  const admitLogicalParticipantsEffect: SessionJournalStorePersistence["admitLogicalParticipantsEffect"] =
    Effect.fn("SessionJournalStore.admitLogicalParticipants")(
      function* (attempt, input) {
        const state = owner.readAttempt(attempt);
        if (state?.executionProfile === "finiteRoot") {
          const finite = owner.readFiniteRoot(state);
          const issued = finite?.admissions.get(input.participant);
          if (
            finite?.status !== "open" ||
            issued === undefined ||
            !sameParticipantSelection(issued.selection, input)
          )
            return yield* Effect.fail(
              new LogicalParticipantAdmissionError({
                reason: "invalidAuthority",
              }),
            );
          return issued.bundle;
        }
        if (input.sources.length === 0 || input.sources.length > 3) {
          return yield* Effect.fail(
            new LogicalParticipantAdmissionError({
              reason: "unsupportedProfile",
            }),
          );
        }
        const sources = [];
        for (const source of input.sources) {
          const admission = yield* admitSourceEffect(attempt, source);
          sources.push(Object.freeze({ admission, methods: source.methods }));
        }
        return yield* Effect.fromResult(
          issueLogicalParticipantAdmissionBundle(attempt, {
            participant: input.participant,
            operationMethods: input.operationMethods,
            profileRevision: input.profileRevision,
            sources,
          }),
        );
      },
    );
  return Object.freeze({
    prepareFiniteEntryEffect,
    confirmedFiniteEntryAttempt,
    admitLogicalParticipantsEffect,
    runAdmittedOperationEffect,
    openAttemptEffect,
    resolvePointTableEffect,
    runPointOperationEffect,
    resolveDeveloperIndexEffect,
    runIndexedQueryEffect,
    resolveApplicationRelationReadEffect,
    runApplicationRelationIncomingReadEffect,
    prepareSealEffect,
    completeSealEffect,
    freezeFiniteRootEffect,
    discardFiniteRootEffect,
  });
}
