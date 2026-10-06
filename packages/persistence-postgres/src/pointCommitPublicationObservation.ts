import { Effect } from "effect";

export type PointCommitPublicationPhase = "publisher" | "commandPreparation" | "authorityResolution" |
  "initialOutcome" | "definitionPreparation" | "intrinsicDefinition" | "mixedDefinitions" | "transaction" | "lifecycleAcceptance" |
  "lockedAttemptAcceptance" | "participantProof" | "occProof" | "lowering" |
  "durablePublication" | "finalReferences" | "clockAdvance" | "finalOutcome" |
  "priorDocuments" | "developerIndexPreparation" | "uniquePreparation" | "relationPreparation" |
  "intrinsicMembership" | "rowWrites" | "indexWrites" | "uniqueWrites" | "coverage" |
  "searchWrites" | "materializationWrites" | "relationWrites";

export type PointCommitPublicationOwner = "plan" | "definitions" | "participant" |
  "rowRevisions" | "rowCreates" | "rowUpdates" | "indexRevisions" | "indexCreates" | "indexCoverage" | "indexValidation" |
  "indexDeletes" | "uniqueReleases" | "uniqueClaims" | "uniqueCoverage" | "searchDeletes" | "searchInserts" |
  "searchBuilds" | "rowFacts" | "relationFacts" | "relationalFacts" | "events" |
  "deliveries" | "references" | "commitHeaders" | "outcomes" | "wakes" |
  "journalDeletes" | "leaseDeletes" | "sessionCommits" | "clockAdvances";

export type PointCommitPublicationMetric = "rows" | "liveRows" | "tombstones" |
  "tables" | "canonicalBytes" | "semanticBytes" | "journalBytes" | "resultBytes" |
  "pointDependencies" | "rangeDependencies" | "relationDependencies" | "writeOperations" |
  "participantOperations" | "sourceContributions" | "effectOccurrences" | "eventIntents" |
  "intrinsicDefinitions" | "developerDefinitions" | "uniqueDefinitions" | "indexes" |
  "constraints" | "ranges" | "pages" | "uniqueReads" | "entries" | "textBytes" |
  "endpoints" | "affectedRows";

/** Diagnostic scalars only. This is neither a persistence input nor authority. */
export type PointCommitPublicationEvent = Readonly<{
  kind: "phase"; phase: PointCommitPublicationPhase; edge: "begin" | "end";
}> | Readonly<{
  kind: "counts" | "batch"; owner: PointCommitPublicationOwner;
  counts: Readonly<Partial<Record<PointCommitPublicationMetric, number>>>;
}>;

/** One test observation. Delivery faults are diagnosed after the real owner
 * settles, so an observer cannot change business failure, interruption or COMMIT. */
export class PointCommitPublicationObservation {
  readonly detail: boolean;
  private readonly deliver: (event: PointCommitPublicationEvent) => void;
  private failureCount = 0;
  private firstFailure: unknown;

  constructor(input: Readonly<{ detail: boolean; record: (event: PointCommitPublicationEvent) => void }>) {
    this.detail = input.detail;
    this.deliver = input.record;
  }

  record(event: PointCommitPublicationEvent): void {
    if (event.kind !== "phase" && !this.detail) return;
    const detached: PointCommitPublicationEvent = event.kind === "phase"
      ? Object.freeze({ ...event })
      : Object.freeze({ ...event, counts: Object.freeze({ ...event.counts }) });
    // The catch encloses only the foreign diagnostic callback. Business and
    // observation construction remain outside this rejection boundary.
    try { this.deliver(detached); }
    catch (cause) {
      if (this.failureCount === 0) this.firstFailure = cause;
      this.failureCount = Math.min(Number.MAX_SAFE_INTEGER, this.failureCount + 1);
    }
  }

  status(): Readonly<{ failureCount: number }> {
    return Object.freeze({ failureCount: this.failureCount });
  }

  assertHealthy(): void {
    if (this.failureCount !== 0)
      throw new Error("Point-commit publication observation failed", { cause: this.firstFailure });
  }
}

export function observePointCommitPublicationEffect<Value, Failure, Requirements>(
  observation: PointCommitPublicationObservation | undefined, phase: PointCommitPublicationPhase,
  work: Effect.Effect<Value, Failure, Requirements>,
): Effect.Effect<Value, Failure, Requirements> {
  if (observation === undefined) return work;
  return Effect.sync(() => observation.record({ kind: "phase", phase, edge: "begin" })).pipe(
    Effect.andThen(work),
    Effect.ensuring(Effect.sync(() => observation.record({ kind: "phase", phase, edge: "end" }))),
  );
}

export function observePointCommitPublicationPromise<Value>(
  observation: PointCommitPublicationObservation | undefined, phase: PointCommitPublicationPhase,
  work: () => Promise<Value>,
): Promise<Value> {
  if (observation === undefined) return work();
  observation.record({ kind: "phase", phase, edge: "begin" });
  return (async () => {
    try { return await work(); }
    finally { observation.record({ kind: "phase", phase, edge: "end" }); }
  })();
}
