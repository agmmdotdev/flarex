// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/statuses.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
// Copyright (c) 2023 Trigger.dev.
import type { ExecutionStatus } from "./model.js";

export function isFinishedOrPendingFinished(status: ExecutionStatus): boolean {
  const finishedStatuses: ExecutionStatus[] = ["FINISHED", "PENDING_CANCEL"];
  return finishedStatuses.includes(status);
}
