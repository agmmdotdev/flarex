import { Data, Effect, Option } from "effect";
import type { BorrowedAttemptStart } from "../src/borrowedAttemptStart.js";
import type {
  AttemptRun,
  AttemptStartIntent,
  CreateExecutionSnapshotInput,
  ExecutionSnapshot,
  FailedRun,
  HeartbeatTimeouts,
  PermanentFailureWrite,
  StartedRun,
  StartAttemptWrite,
} from "../src/model.js";

export const DATABASE_TIME_MS = 1_700_000_000_000;
export const RUN_ID = "run_adopted_start";
export const heartbeatTimeouts: HeartbeatTimeouts = {
  PENDING_EXECUTING: 30_000,
  PENDING_CANCEL: 60_000,
  EXECUTING: 90_000,
  EXECUTING_WITH_WAITPOINTS: 120_000,
  SUSPENDED: 150_000,
};

export const latestSnapshot: ExecutionSnapshot = {
  id: "snapshot_pending",
  runId: RUN_ID,
  executionStatus: "PENDING_EXECUTING",
  attemptNumber: null,
  createdAtMs: DATABASE_TIME_MS - 100,
  updatedAtMs: DATABASE_TIME_MS - 50,
  completedWaitpoints: [{ id: "wait_completed", index: 2 }],
};

export const attemptRun: AttemptRun = {
  id: RUN_ID,
  attemptNumber: null,
  lockedById: "locked_task_definition",
  ttl: "1h",
};

export const startedRun: StartedRun = {
  id: RUN_ID,
  status: "EXECUTING",
  attemptNumber: 1,
  executedAtMs: DATABASE_TIME_MS,
};

export const executingSnapshot: ExecutionSnapshot = {
  id: "snapshot_executing",
  runId: RUN_ID,
  executionStatus: "EXECUTING",
  attemptNumber: 1,
  createdAtMs: DATABASE_TIME_MS,
  updatedAtMs: DATABASE_TIME_MS,
  completedWaitpoints: latestSnapshot.completedWaitpoints,
};

export const failedRun: FailedRun = {
  id: RUN_ID,
  status: "CRASHED",
  attemptNumber: 250,
  completedAtMs: DATABASE_TIME_MS,
  associatedWaitpointId: "wait_associated",
};

export const terminalSnapshot: ExecutionSnapshot = {
  id: "snapshot_finished",
  runId: RUN_ID,
  executionStatus: "FINISHED",
  attemptNumber: 250,
  createdAtMs: DATABASE_TIME_MS,
  updatedAtMs: DATABASE_TIME_MS,
  completedWaitpoints: [],
};

export class PrimitiveFailure extends Data.TaggedError("PrimitiveFailure")<{
  readonly primitive: string;
}> {}

export type PrimitiveRequest =
  | { readonly kind: "readLatestSnapshot" }
  | { readonly kind: "findRun" }
  | { readonly kind: "startAttempt"; readonly input: StartAttemptWrite }
  | { readonly kind: "clearBlockingWaitpoints" }
  | { readonly kind: "failRunPermanently"; readonly input: PermanentFailureWrite }
  | { readonly kind: "createExecutionSnapshot"; readonly input: CreateExecutionSnapshotInput }
  | { readonly kind: "recordIntent"; readonly intent: AttemptStartIntent };

interface Script {
  readonly snapshots?: readonly ExecutionSnapshot[];
  readonly run?: Option.Option<AttemptRun>;
  readonly started?: StartedRun;
  readonly failed?: FailedRun;
  readonly created?: ExecutionSnapshot;
  /** One-based primitive request index, including reads and intent records. */
  readonly failAt?: number;
  readonly failure?: Effect.Effect<never, PrimitiveFailure>;
}

/**
 * Scripted facts and request capture only. This does not implement persistence,
 * transactions, rollback, lock/claim authority, or engine lifecycle decisions.
 */
export function scriptedAttemptStart(script: Script = {}) {
  const requests: PrimitiveRequest[] = [];
  const snapshots = script.snapshots ?? [latestSnapshot];
  let snapshotRead = 0;

  const respond = <A>(request: PrimitiveRequest, value: () => A): Effect.Effect<A, PrimitiveFailure> =>
    Effect.suspend(() => {
      requests.push(request);
      if (script.failAt === requests.length) {
        return script.failure ?? Effect.fail(new PrimitiveFailure({ primitive: request.kind }));
      }
      return Effect.sync(value);
    });

  const operation: BorrowedAttemptStart<PrimitiveFailure> = {
    runId: RUN_ID,
    databaseTimeMs: DATABASE_TIME_MS,
    readLatestSnapshot: () => respond({ kind: "readLatestSnapshot" }, () => {
      const snapshot = snapshots[snapshotRead++];
      if (snapshot === undefined) {
        throw new Error("Scripted snapshot responses exhausted");
      }
      return snapshot;
    }),
    findRun: () => respond({ kind: "findRun" }, () => script.run ?? Option.some(attemptRun)),
    startAttempt: (input) => respond({ kind: "startAttempt", input }, () => script.started ?? startedRun),
    clearBlockingWaitpoints: () => respond({ kind: "clearBlockingWaitpoints" }, () => undefined),
    failRunPermanently: (input) => respond({ kind: "failRunPermanently", input }, () => script.failed ?? failedRun),
    createExecutionSnapshot: (input) => respond({ kind: "createExecutionSnapshot", input }, () => script.created ?? executingSnapshot),
    recordIntent: (intent) => respond({ kind: "recordIntent", intent }, () => undefined),
  };

  return { operation, requests };
}
