import { Effect } from "effect";
import {
  sessionJournalAttemptBrand,
  pinnedPointTableBrand,
  pinnedDeveloperIndexBrand,
  pinnedApplicationRelationReadBrand,
  preparedSessionJournalSealBrand,
} from "./contracts";
import type {
  SessionJournalAttempt,
  PinnedPointTableV1,
  PinnedDeveloperIndexV1,
  PinnedApplicationRelationRead,
  PreparedSessionJournalSealV1,
} from "./contracts";
import type {
  SessionJournalAttemptStateV1,
  PinnedPointTableStateV1,
  PinnedDeveloperIndexStateV1,
  PinnedApplicationRelationReadState,
} from "./state";
import { SessionJournalPersistenceV1Error } from "./errors";
import type { StoredCommitAuthorityEvidenceLoaderPortsV1 } from "../../commit/authority/postgresLoader";
import {
  issuePreparedFiniteSessionJournalEntry,
  abandonPreparedFiniteSessionJournalEntry,
} from "./finiteEntry";
import type {
  PreparedFiniteSessionJournalEntry,
  FiniteEntryRun,
} from "./finiteEntry";
import { discardFiniteRootEvidence } from "./finiteRoot";
import type { FiniteRootAttemptState } from "./finiteRoot";
import type { PreparedSessionJournalSealStateV1 } from "./seal";
import { captureFiniteStorageEffect } from "../finiteStorageCapture";
import { LogicalParticipantAdmissionError } from "../../storage/documents/logicalDocuments/participantErrors";
import type { JournalTargetResolver } from "./targetAdmission";

const createAttemptHandle = (): SessionJournalAttempt =>
  Object.freeze({
    [sessionJournalAttemptBrand]: true as const,
  });

/** One concrete store owns every issued handle and exact local finite claim. */
export function createJournalAttemptOwner() {
  const attemptStates = new WeakMap<object, SessionJournalAttemptStateV1>();
  const finiteRootStates = new WeakMap<
    SessionJournalAttemptStateV1,
    FiniteRootAttemptState
  >();
  // GC must not permit a same-fence restart. Only authoritative retirement
  // removes ownership; abort and uncertainty retain an inert exact tombstone.
  const finiteClaims = new Map<
    string,
    Readonly<{
      handle: SessionJournalAttempt;
      state: FiniteRootAttemptState;
    }>
  >();
  let reservedFiniteEntries = 0;
  const tableStates = new WeakMap<object, PinnedPointTableStateV1>();
  const indexStates = new WeakMap<object, PinnedDeveloperIndexStateV1>();
  const relationStates = new WeakMap<
    object,
    PinnedApplicationRelationReadState
  >();
  const sealStates = new WeakMap<object, PreparedSessionJournalSealStateV1>();
  const admittedInFlight = new Set<string>();

  const hasFiniteCapacity = () =>
    finiteClaims.size + reservedFiniteEntries < 1_024;

  const reserveFiniteEntryEffect = (
    issuer: StoredCommitAuthorityEvidenceLoaderPortsV1,
    handle: SessionJournalAttempt,
    run: (
      preparation: PreparedFiniteSessionJournalEntry,
      ...inputs: Parameters<FiniteEntryRun>
    ) => ReturnType<FiniteEntryRun>,
  ) =>
    Effect.acquireRelease(
      Effect.suspend(() => {
        if (!hasFiniteCapacity())
          return Effect.fail(
            new SessionJournalPersistenceV1Error({
              operation: "openAttempt",
              cause: "finite root owner capacity exhausted",
            }),
          );
        reservedFiniteEntries += 1;
        let reserved = true;
        const release = () => {
          if (reserved) {
            reserved = false;
            reservedFiniteEntries -= 1;
          }
        };
        const preparation = issuePreparedFiniteSessionJournalEntry({
          issuer,
          attempt: handle,
          release,
          run: (...inputs) => run(preparation, ...inputs),
          install: (capture) => {
            attemptStates.set(handle, capture.state);
            finiteRootStates.set(capture.state, capture.finite);
            finiteClaims.set(
              capture.finiteKey,
              Object.freeze({ handle, state: capture.finite }),
            );
          },
          discard: (capture) => {
            capture.finite.status = "aborted";
            discardFiniteRootEvidence(capture.finite);
          },
        });
        return Effect.succeed(preparation);
      }),
      (entry) =>
        Effect.sync(() => abandonPreparedFiniteSessionJournalEntry(entry)),
    );

  const retireFinishedFiniteRootsEffect = Effect.fn(
    "SessionJournalStore.retireFinishedFiniteRoots",
  )(function* (resolveJournalTargetEffect: JournalTargetResolver) {
    for (const [key, owner] of finiteClaims) {
      if (owner.state.status === "freezing") continue;
      const prior = attemptStates.get(owner.handle);
      if (prior === undefined) continue;
      const resolved = yield* resolveJournalTargetEffect(prior);
      const { retired } = yield* captureFiniteStorageEffect(
        resolved.target,
        {
          selector: prior.selector,
          preliminaryAuthority: resolved.authority,
          executionClaim: prior.executionClaim,
          finiteAnchor: owner.state.anchorCapture,
          finiteApplicationReadDemand: {
            metadata: owner.state.metadata,
            root: owner.state.handle,
            demand: { kind: "clock" },
          },
        },
        {
          kind: "retirement",
          selector: prior.selector,
          executionClaim: prior.executionClaim,
        },
      ).pipe(
        Effect.mapError(
          (cause) =>
            new LogicalParticipantAdmissionError({
              reason: "invalidAuthority",
              cause,
            }),
        ),
      );
      if (retired) {
        owner.state.status = "aborted";
        discardFiniteRootEvidence(owner.state);
        finiteClaims.delete(key);
      }
    }
  });

  return Object.freeze({
    createAttemptHandle,
    registerAttempt(
      handle: SessionJournalAttempt,
      state: SessionJournalAttemptStateV1,
    ): void {
      attemptStates.set(handle, state);
    },
    readAttempt(handle: unknown): SessionJournalAttemptStateV1 | undefined {
      return typeof handle === "object" && handle !== null
        ? attemptStates.get(handle)
        : undefined;
    },
    readFiniteRoot(
      state: SessionJournalAttemptStateV1,
    ): FiniteRootAttemptState | undefined {
      return finiteRootStates.get(state);
    },
    hasFiniteCapacity,
    reserveFiniteEntryEffect,
    retireFinishedFiniteRootsEffect,
    issuePointTable(state: PinnedPointTableStateV1): PinnedPointTableV1 {
      const handle = Object.freeze({ [pinnedPointTableBrand]: true as const });
      tableStates.set(handle, state);
      return handle;
    },
    readPointTable(handle: unknown): PinnedPointTableStateV1 | undefined {
      return typeof handle === "object" && handle !== null
        ? tableStates.get(handle)
        : undefined;
    },
    issueDeveloperIndex(
      state: PinnedDeveloperIndexStateV1,
    ): PinnedDeveloperIndexV1 {
      const handle = Object.freeze({
        [pinnedDeveloperIndexBrand]: true as const,
      });
      indexStates.set(handle, state);
      return handle;
    },
    readDeveloperIndex(
      handle: unknown,
    ): PinnedDeveloperIndexStateV1 | undefined {
      return typeof handle === "object" && handle !== null
        ? indexStates.get(handle)
        : undefined;
    },
    issueRelationRead(
      state: PinnedApplicationRelationReadState,
    ): PinnedApplicationRelationRead {
      const handle = Object.freeze({
        [pinnedApplicationRelationReadBrand]: true as const,
      });
      relationStates.set(handle, state);
      return handle;
    },
    readRelationRead(
      handle: unknown,
    ): PinnedApplicationRelationReadState | undefined {
      return typeof handle === "object" && handle !== null
        ? relationStates.get(handle)
        : undefined;
    },
    issueSealPreparation(
      state: PreparedSessionJournalSealStateV1,
    ): PreparedSessionJournalSealV1 {
      const handle = Object.freeze({
        [preparedSessionJournalSealBrand]: true as const,
      });
      sealStates.set(handle, state);
      return handle;
    },
    readSealPreparation(
      handle: unknown,
    ): PreparedSessionJournalSealStateV1 | undefined {
      return typeof handle === "object" && handle !== null
        ? sealStates.get(handle)
        : undefined;
    },
    consumeSealPreparation(handle: PreparedSessionJournalSealV1): void {
      sealStates.delete(handle);
    },
    isAdmittedOperationInFlight(key: string): boolean {
      return admittedInFlight.has(key);
    },
    startAdmittedOperation(key: string): void {
      admittedInFlight.add(key);
    },
    finishAdmittedOperation(key: string): void {
      admittedInFlight.delete(key);
    },
  });
}

export type JournalAttemptOwner = ReturnType<typeof createJournalAttemptOwner>;
