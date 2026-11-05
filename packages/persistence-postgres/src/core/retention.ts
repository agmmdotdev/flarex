/**
 * Leader validation translated from Convex crates/database/src/retention.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect } from "effect";
import { CorePersistenceError, type CoreRetentionBounds, type CoreRetentionValidator } from "./contracts";

/** Retain-all serving mode has no floor writer. Maintenance must reconstruct
 * the fenced owner before serving again; this value never infers GC progress. */
export function makeCoreLeaderRetention(bounds: CoreRetentionBounds): CoreRetentionValidator {
  const { indexMinimumTimestamp, documentMinimumTimestamp } = bounds;
  // Constant-time floor comparisons on every page: no span or suspension per call.
  return Object.freeze({
    validateIndex: (at: bigint) => at < indexMinimumTimestamp
      ? Effect.fail(new CorePersistenceError({ reason: "outOfRetention" })) : Effect.void,
    validateDocument: (at: bigint) => at < documentMinimumTimestamp
      ? Effect.fail(new CorePersistenceError({ reason: "outOfRetention" })) : Effect.void,
  });
}
