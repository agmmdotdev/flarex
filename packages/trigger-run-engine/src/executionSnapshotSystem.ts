// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/systems/executionSnapshotSystem.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
// Copyright (c) 2023 Trigger.dev.
import { Effect, Schema } from "effect";
import type { BorrowedAttemptStart } from "./borrowedAttemptStart.js";
import {
  HeartbeatTimeoutsSchema,
  type CreateExecutionSnapshotInput, type ExecutionSnapshot, type ExecutionStatus,
  type HeartbeatTimeouts,
} from "./model.js";

export interface ExecutionSnapshotSystemOptions {
  readonly heartbeatTimeouts: HeartbeatTimeouts;
}

export class ExecutionSnapshotSystem {
  readonly createExecutionSnapshot: <StoreError, StoreEnvironment>(
    operation: BorrowedAttemptStart<StoreError, StoreEnvironment>,
    input: CreateExecutionSnapshotInput,
  ) => Effect.Effect<ExecutionSnapshot, StoreError, StoreEnvironment>;

  constructor(options: ExecutionSnapshotSystemOptions) {
    // Deliberate synchronous trusted-startup boundary; operation data is decoded
    // by the future core issuer, never authenticated by this configuration.
    const heartbeatTimeouts = Object.freeze(
      Schema.decodeUnknownSync(HeartbeatTimeoutsSchema)(options.heartbeatTimeouts),
    );

    this.createExecutionSnapshot = Effect.fn("ExecutionSnapshotSystem.createExecutionSnapshot")(
      function* <StoreError, StoreEnvironment>(
        operation: BorrowedAttemptStart<StoreError, StoreEnvironment>,
        input: CreateExecutionSnapshotInput,
      ): Effect.fn.Return<ExecutionSnapshot, StoreError, StoreEnvironment> {
        const { run, completedWaitpoints, error } = input;
        const newSnapshot = yield* operation.createExecutionSnapshot(input);

        if (!error) {
          const intervalMs = getHeartbeatIntervalMs(newSnapshot.executionStatus, heartbeatTimeouts);
          if (intervalMs !== null) {
            yield* operation.recordIntent({
              kind: "heartbeatDue", runId: run.id, snapshotId: newSnapshot.id,
              availableAtMs: operation.databaseTimeMs + intervalMs,
            });
          }
        }

        yield* operation.recordIntent({
          kind: "executionSnapshotCreated", atMs: newSnapshot.createdAtMs,
          runId: newSnapshot.runId, snapshot: newSnapshot,
          completedWaitpointIds: completedWaitpoints?.map(waitpoint => waitpoint.id) ?? [],
        });

        // Friendly product IDs are not execution authority or part of this
        // private data projection. No notification is delivered before settlement.
        return newSnapshot;
      },
    );
  }
}

/** The pinned heartbeat status dispatch; time/storage are injected owners. */
function getHeartbeatIntervalMs(status: ExecutionStatus, timeouts: HeartbeatTimeouts): number | null {
  switch (status) {
    case "PENDING_EXECUTING": return timeouts.PENDING_EXECUTING;
    case "PENDING_CANCEL": return timeouts.PENDING_CANCEL;
    case "EXECUTING": return timeouts.EXECUTING;
    case "EXECUTING_WITH_WAITPOINTS": return timeouts.EXECUTING_WITH_WAITPOINTS;
    case "SUSPENDED": return timeouts.SUSPENDED;
    default: return null;
  }
}
