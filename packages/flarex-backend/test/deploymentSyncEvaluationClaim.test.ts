import type {
  EvaluationWorkScanContinuation,
  QueryDescriptor,
  QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import {
  MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
  compareCanonicalBase64Url,
} from "@flarex/query-sync/internal/kernel";
import type {
  ClaimEvaluationWorkReceipt,
} from "@flarex/query-sync/internal/state";
import {
  createReferenceModel,
  reduceReferenceModel,
  type QuerySyncReferenceModel,
} from "@flarex/query-sync/testing/reference-model";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  DeploymentQuerySyncAdapterInvariantDefect,
} from "../src/deploymentSync/StateStorage";
import {
  CLAIM_COMMON_READ_STAGES,
  claimEvaluationWork,
  claimRequest,
  type ClaimSqlProbe,
  type ClaimSqlStage,
  makeClaimSqlProbe,
} from "./deploymentSyncClaimTestSupport";
import {
  applyCompletionBatch,
  captureCompletionBatch,
  completeEvaluation,
  makeCompletionEvidence,
} from "./deploymentSyncCompletionTestSupport";
import {
  recordEvaluationOutcome,
} from "./deploymentSyncEvaluationAttemptOutcomeTestSupport";
import {
  beginEvaluation,
  beginRequest,
  prepareEvaluationState,
  type PreparedEvaluationState,
  queryDescriptor,
  readEvaluationScope,
  snapshotEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

const FRESH_SCAN_TRACE = Object.freeze([
  ...CLAIM_COMMON_READ_STAGES,
  "scan-read",
] as const satisfies readonly ClaimSqlStage[]);

const ANCHORED_SCAN_TRACE = Object.freeze([
  ...CLAIM_COMMON_READ_STAGES,
  "anchor-read",
  "scan-read",
] as const satisfies readonly ClaimSqlStage[]);

const FRESH_READY_WRITE_TRACE = Object.freeze([
  ...FRESH_SCAN_TRACE,
  "selected-query-read",
  "scope-write",
] as const satisfies readonly ClaimSqlStage[]);

const ANCHORED_READY_WRITE_TRACE = Object.freeze([
  ...ANCHORED_SCAN_TRACE,
  "selected-query-read",
  "scope-write",
] as const satisfies readonly ClaimSqlStage[]);

const DIRTY_WRITE_TRACE = Object.freeze([
  ...ANCHORED_SCAN_TRACE,
  "selected-query-read",
  "selected-query-write",
  "scope-write",
] as const satisfies readonly ClaimSqlStage[]);

describe("deployment query-sync evaluation claiming", () => {
  it("authenticates a continuation after scope authority but before field access", async () => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      let fieldReads = 0;
      const fieldFailure = new Error("continuation fields must not be read");
      const unissued = new Proxy({}, {
        get: () => {
          fieldReads += 1;
          throw fieldFailure;
        },
      });
      const before = snapshotEvaluationState(prepared.database);
      probe.start();

      const exit = await Effect.runPromiseExit(
        prepared.state.claimEvaluationWork(claimRequest(
          1,
          // SAFETY: this deliberately unissued object crosses the nominal
          // boundary to prove authentication precedes every field read.
          unissued as unknown as EvaluationWorkScanContinuation,
        )),
      );

      expectTypedFailure(exit, {
        _tag: "InvalidEvaluationWorkContinuationError",
        operation: "claimEvaluationWork",
        reason: "notStateIssued",
      });
      expect(fieldReads).toBe(0);
      expect(probe.stop()).toEqual(CLAIM_COMMON_READ_STAGES);
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });

  it("returns empty stable none without scanning or writing", async () => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const before = snapshotEvaluationState(prepared.database);
      probe.start();

      const receipt = await claimEvaluationWork(prepared, claimRequest(1));

      expect(receipt).toEqual({ _tag: "none" });
      expect(Object.isFrozen(receipt)).toBe(true);
      expect(probe.stop()).toEqual(CLAIM_COMMON_READ_STAGES);
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });

  it("revalidates each bounded prefix through a full wrap and returns stable none", async () => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const [low, middle, high] = sortedDescriptorTriple(10, 20, 30);
      await completeCleanQuery(prepared, high, 230, "clean-high");
      await completeCleanQuery(prepared, low, 210, "clean-low");
      await completeCleanQuery(prepared, middle, 220, "clean-middle");
      expect(readEvaluationScope(prepared.database).fairnessAnchor).toBe(
        middle.queryKey,
      );
      const before = snapshotEvaluationState(prepared.database);

      probe.start();
      const first = await claimEvaluationWork(prepared, claimRequest(1));
      expect(first._tag).toBe("continued");
      if (first._tag !== "continued") throw new Error("Expected continuation.");
      expect(first.continuation).toMatchObject({
        lastInspectedQueryKey: high.queryKey,
        wrapped: false,
        lowestBlockedWork: null,
      });
      expect(Object.isFrozen(first.continuation)).toBe(true);
      expect(probe.stop()).toEqual(ANCHORED_SCAN_TRACE);

      probe.start();
      const second = await claimEvaluationWork(
        prepared,
        claimRequest(1, first.continuation),
      );
      expect(second._tag).toBe("continued");
      if (second._tag !== "continued") throw new Error("Expected continuation.");
      expect(second.continuation).toMatchObject({
        lastInspectedQueryKey: low.queryKey,
        wrapped: true,
        lowestBlockedWork: null,
      });
      expect(probe.stop()).toEqual([
        ...CLAIM_COMMON_READ_STAGES,
        "anchor-read",
        "scan-read",
        "scan-read",
      ]);

      probe.start();
      const final = await claimEvaluationWork(
        prepared,
        claimRequest(1, second.continuation),
      );
      expect(final).toEqual({ _tag: "none" });
      expect(probe.stop()).toEqual([
        ...CLAIM_COMMON_READ_STAGES,
        "anchor-read",
        "scan-read",
        "scan-read",
      ]);

      probe.start();
      await expect(claimEvaluationWork(
        prepared,
        claimRequest(MAX_EVALUATION_WORK_QUERY_INSPECTIONS),
      )).resolves.toEqual({ _tag: "none" });
      expect(probe.stop()).toEqual(ANCHORED_SCAN_TRACE);
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });

  it("prefers runnable work and reports the lowest block only after a stable wrap", async () => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const [low, high] = sortedDescriptorPair(40, 50);
      await beginEvaluation(prepared, low);
      await beginEvaluation(prepared, high);
      const first = requireClaimed(await claimEvaluationWork(
        prepared,
        claimRequest(MAX_EVALUATION_WORK_QUERY_INSPECTIONS),
      ));
      expect(first.attempt.descriptor.queryKey).toBe(low.queryKey);
      const firstBlock = await recordEvaluationOutcome(
        prepared,
        first.attempt,
        "terminalRefusal",
      );
      expect(firstBlock._tag).toBe("blocked");

      probe.start();
      const runnable = requireClaimed(await claimEvaluationWork(
        prepared,
        claimRequest(MAX_EVALUATION_WORK_QUERY_INSPECTIONS),
      ));
      expect(runnable.attempt.descriptor.queryKey).toBe(high.queryKey);
      expect(probe.stop()).toEqual(ANCHORED_READY_WRITE_TRACE);
      const secondBlock = await recordEvaluationOutcome(
        prepared,
        runnable.attempt,
        "terminalRefusal",
      );
      expect(secondBlock._tag).toBe("blocked");
      const beforeStableBlock = snapshotEvaluationState(prepared.database);

      probe.start();
      const stableBlock = await claimEvaluationWork(
        prepared,
        claimRequest(MAX_EVALUATION_WORK_QUERY_INSPECTIONS),
      );
      expect(stableBlock).toEqual({
        _tag: "blocked",
        blockedWork: {
          queryKey: low.queryKey,
          generation: first.attempt.generation,
          reason: "terminalEvaluatorRefusal",
          resetRequired: true,
        },
      });
      expect(stableBlock._tag).toBe("blocked");
      if (stableBlock._tag === "blocked") {
        expect(Object.isFrozen(stableBlock.blockedWork)).toBe(true);
      }
      expect(probe.stop()).toEqual(ANCHORED_SCAN_TRACE);
      expect(snapshotEvaluationState(prepared.database)).toEqual(
        beforeStableBlock,
      );
    } finally {
      prepared.database.close();
    }
  });

  it("restarts revision-stale continuations without scanning", async () => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      await completeCleanQuery(
        prepared,
        queryDescriptor(60),
        260,
        "revision-clean-60",
      );
      await completeCleanQuery(
        prepared,
        queryDescriptor(70),
        270,
        "revision-clean-70",
      );
      const partial = await claimEvaluationWork(prepared, claimRequest(1));
      if (partial._tag !== "continued") throw new Error("Expected continuation.");
      await beginEvaluation(prepared, queryDescriptor(55));
      const beforeRestart = snapshotEvaluationState(prepared.database);
      probe.start();

      const restarted = await claimEvaluationWork(
        prepared,
        claimRequest(1, partial.continuation),
      );

      expect(restarted._tag).toBe("scanRestarted");
      expect(probe.stop()).toEqual(CLAIM_COMMON_READ_STAGES);
      expect(snapshotEvaluationState(prepared.database)).toEqual(beforeRestart);
    } finally {
      prepared.database.close();
    }
  });

  it("restarts anchor-stale continuations without scanning", async () => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const [ready, middle, high] = sortedDescriptorTriple(10, 20, 30);
      await completeCleanQuery(prepared, high, 330, "anchor-clean-high");
      await completeCleanQuery(prepared, middle, 320, "anchor-clean-middle");
      await beginEvaluation(prepared, ready);
      const revision = readEvaluationScope(
        prepared.database,
      ).evaluationWorkRevision;

      probe.start();
      const partial = await claimEvaluationWork(prepared, claimRequest(1));
      if (partial._tag !== "continued") throw new Error("Expected continuation.");
      expect(probe.stop()).toEqual(ANCHORED_SCAN_TRACE);

      probe.start();
      const selected = requireClaimed(await claimEvaluationWork(
        prepared,
        claimRequest(MAX_EVALUATION_WORK_QUERY_INSPECTIONS),
      ));
      expect(selected.attempt.descriptor.queryKey).toBe(ready.queryKey);
      expect(probe.stop()).toEqual(ANCHORED_READY_WRITE_TRACE);
      const afterAnchorChange = readEvaluationScope(prepared.database);
      expect(afterAnchorChange.evaluationWorkRevision).toBe(revision);
      expect(afterAnchorChange.fairnessAnchor).toBe(ready.queryKey);
      const beforeRestart = snapshotEvaluationState(prepared.database);

      probe.start();
      const restarted = await claimEvaluationWork(
        prepared,
        claimRequest(1, partial.continuation),
      );
      expect(restarted._tag).toBe("scanRestarted");
      expect(probe.stop()).toEqual(CLAIM_COMMON_READ_STAGES);
      expect(snapshotEvaluationState(prepared.database)).toEqual(beforeRestart);
    } finally {
      prepared.database.close();
    }
  });

  it("matches the portable oracle for a fairness-only ready claim", async () => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const descriptor = queryDescriptor(80);
      let reference = success(createReferenceModel(
        prepared.binding.bootstrapCursor,
      ));
      const request = beginRequest(prepared.binding, descriptor);
      const referenceBegin = success(reduceReferenceModel(reference, {
        _tag: "beginQueryEvaluation",
        request,
      }));
      reference = referenceBegin.model;
      const attempt = await beginEvaluation(prepared, descriptor);
      if (referenceBegin.decision._tag !== "created") {
        throw new Error("Expected reference begin creation.");
      }
      expect(attempt).toEqual(referenceBegin.decision.attempt);
      const before = snapshotEvaluationState(prepared.database);
      const scanRequest = claimRequest(1);
      const referenceClaim = success(reduceReferenceModel(reference, {
        _tag: "claimEvaluationWork",
        request: scanRequest,
      }));
      probe.start();

      const claimed = requireClaimed(await claimEvaluationWork(
        prepared,
        scanRequest,
      ));

      expect(claimed).toEqual(receiptWithoutState(referenceClaim.decision));
      expect(claimed.attempt).toEqual(attempt);
      expect(Object.isFrozen(claimed)).toBe(true);
      expect(Object.isFrozen(claimed.attempt)).toBe(true);
      expect(Object.isFrozen(claimed.continuation)).toBe(true);
      expect(probe.stop()).toEqual(FRESH_READY_WRITE_TRACE);
      const after = snapshotEvaluationState(prepared.database);
      expect(after.queries).toEqual(before.queries);
      expect(after.dependencies).toEqual(before.dependencies);
      expect(after.pending).toEqual(before.pending);
      expectScopeMatchesReference(prepared, referenceClaim.model);

      const beforeSameAnchorClaim = snapshotEvaluationState(prepared.database);
      const sameAnchorReferenceClaim = success(reduceReferenceModel(
        referenceClaim.model,
        {
          _tag: "claimEvaluationWork",
          request: scanRequest,
        },
      ));
      probe.start();

      const sameAnchorClaim = requireClaimed(await claimEvaluationWork(
        prepared,
        scanRequest,
      ));

      expect(sameAnchorClaim).toEqual(
        receiptWithoutState(sameAnchorReferenceClaim.decision),
      );
      expect(sameAnchorClaim.attempt).toEqual(claimed.attempt);
      expect(probe.stop()).toEqual(ANCHORED_READY_WRITE_TRACE);
      expect(snapshotEvaluationState(prepared.database)).toEqual(
        beforeSameAnchorClaim,
      );
      expectScopeMatchesReference(prepared, sameAnchorReferenceClaim.model);
    } finally {
      prepared.database.close();
    }
  });

  it("matches the portable oracle for an atomic dirty-successor claim", async () => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const descriptor = queryDescriptor(90);
      let reference = success(createReferenceModel(
        prepared.binding.bootstrapCursor,
      ));
      const begin = beginRequest(prepared.binding, descriptor);
      const referenceBegin = success(reduceReferenceModel(reference, {
        _tag: "beginQueryEvaluation",
        request: begin,
      }));
      reference = referenceBegin.model;
      await beginEvaluation(prepared, descriptor);

      const initialClaimRequest = claimRequest(1);
      const referenceReadyClaim = success(reduceReferenceModel(reference, {
        _tag: "claimEvaluationWork",
        request: initialClaimRequest,
      }));
      reference = referenceReadyClaim.model;
      const readyClaim = requireClaimed(await claimEvaluationWork(
        prepared,
        initialClaimRequest,
      ));
      if (referenceReadyClaim.decision._tag !== "claimed") {
        throw new Error("Expected reference ready claim.");
      }
      expect(readyClaim).toEqual(
        receiptWithoutState(referenceReadyClaim.decision),
      );

      const completion = makeCompletionEvidence(prepared, readyClaim.attempt, {
        dependencyLabels: ["dirty-claim"],
        resultSeed: 390,
        publicationLabel: "dirty-claim-pending",
      });
      const referenceCompletion = success(reduceReferenceModel(reference, {
        _tag: "completeQueryEvaluation",
        attempt: readyClaim.attempt,
        ...completion,
      }));
      reference = referenceCompletion.model;
      await completeEvaluation(prepared, readyClaim.attempt, completion);

      const batch = captureCompletionBatch(
        prepared.binding,
        12n,
        ["dirty-claim"],
      );
      const referenceInvalidation = success(reduceReferenceModel(reference, {
        _tag: "applyAdmittedInvalidations",
        batch,
      }));
      reference = referenceInvalidation.model;
      await applyCompletionBatch(prepared, batch);
      const before = snapshotEvaluationState(prepared.database);
      const dirtyRequest = claimRequest(1);
      const referenceDirtyClaim = success(reduceReferenceModel(reference, {
        _tag: "claimEvaluationWork",
        request: dirtyRequest,
      }));
      probe.start();

      const dirtyClaim = requireClaimed(await claimEvaluationWork(
        prepared,
        dirtyRequest,
      ));

      expect(dirtyClaim).toEqual(
        receiptWithoutState(referenceDirtyClaim.decision),
      );
      expect(dirtyClaim.attempt).toMatchObject({
        descriptor,
        generation: 2n,
        expectedActiveGeneration: readyClaim.attempt.generation,
        requestedDirtyThroughSequence: batch.sourceSequence,
      });
      expect(probe.stop()).toEqual(DIRTY_WRITE_TRACE);
      const after = snapshotEvaluationState(prepared.database);
      const beforeQuery = before.queries[0];
      if (beforeQuery === undefined || before.queries.length !== 1) {
        throw new Error("Expected exactly one retained query row.");
      }
      expect(after.queries).toEqual([{
        ...beforeQuery,
        provisional_generation: "2",
        provisional_expected_active_generation: "1",
        provisional_registration_sequence: "12",
        provisional_requested_dirty_through_sequence: "12",
        provisional_disposition: "ready",
      }]);
      expect(after.dependencies).toEqual(before.dependencies);
      expect(after.pending).toEqual(before.pending);
      expectScopeMatchesReference(prepared, referenceDirtyClaim.model);
    } finally {
      prepared.database.close();
    }
  });

  it("recovers a lost ready-claim response by selecting new work", async () => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const [firstDescriptor, secondDescriptor] = sortedDescriptorPair(100, 110);
      await beginEvaluation(prepared, firstDescriptor);
      await beginEvaluation(prepared, secondDescriptor);
      const responseLoss = new Error("forced committed claim response loss");
      let lostReceipt: ClaimEvaluationWorkReceipt | undefined;
      probe.start();

      const lostExit = await Effect.runPromiseExit(
        prepared.state.claimEvaluationWork(claimRequest(1)).pipe(
          Effect.flatMap(receipt => {
            lostReceipt = receipt;
            return Effect.die(responseLoss);
          }),
        ),
      );

      expectDefect(lostExit, responseLoss);
      expect(probe.stop()).toEqual(FRESH_READY_WRITE_TRACE);
      if (lostReceipt?._tag !== "claimed") {
        throw new Error("Expected the lost response to contain a claim.");
      }
      expect(lostReceipt.attempt.descriptor.queryKey).toBe(
        firstDescriptor.queryKey,
      );
      const afterLostCommit = snapshotEvaluationState(prepared.database);

      probe.start();
      const recovered = requireClaimed(await claimEvaluationWork(
        prepared,
        claimRequest(1),
      ));
      expect(recovered.attempt.descriptor.queryKey).toBe(
        secondDescriptor.queryKey,
      );
      expect(recovered.attempt.descriptor.queryKey).not.toBe(
        lostReceipt.attempt.descriptor.queryKey,
      );
      expect(probe.stop()).toEqual(ANCHORED_READY_WRITE_TRACE);
      expect(snapshotEvaluationState(prepared.database)).not.toEqual(
        afterLostCommit,
      );
      expect(readEvaluationScope(prepared.database).fairnessAnchor).toBe(
        secondDescriptor.queryKey,
      );
    } finally {
      prepared.database.close();
    }
  });

  it.each([
    { name: "ready before scope CAS", kind: "ready", phase: "before",
      writeOrdinal: 1 },
    { name: "ready after scope CAS", kind: "ready", phase: "after",
      writeOrdinal: 1 },
    { name: "dirty before selected-query CAS", kind: "dirty", phase: "before",
      writeOrdinal: 1 },
    { name: "dirty after selected-query CAS", kind: "dirty", phase: "after",
      writeOrdinal: 1 },
    { name: "dirty before scope CAS", kind: "dirty", phase: "before",
      writeOrdinal: 2 },
    { name: "dirty after scope CAS", kind: "dirty", phase: "after",
      writeOrdinal: 2 },
  ] as const)(
    "rolls back a foreign defect $name and succeeds on retry",
    async ({ kind, phase, writeOrdinal }) => {
      const fixture = kind === "ready"
        ? await prepareReadyClaimFixture(120)
        : await prepareDirtyClaimFixture(130);
      try {
        const cause = new Error(`forced ${phase} write ${writeOrdinal}`);
        const before = snapshotEvaluationState(fixture.prepared.database);
        fixture.probe.start({ phase, writeOrdinal, cause });

        const exit = await Effect.runPromiseExit(
          fixture.prepared.state.claimEvaluationWork(claimRequest(
            MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
          )),
        );

        expectDefect(exit, cause);
        expect(fixture.probe.stop()).toEqual(
          expectedFaultTrace(kind, writeOrdinal),
        );
        expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
          before,
        );

        fixture.probe.start();
        await expect(claimEvaluationWork(
          fixture.prepared,
          claimRequest(MAX_EVALUATION_WORK_QUERY_INSPECTIONS),
        )).resolves.toMatchObject({ _tag: "claimed" });
        expect(fixture.probe.stop()).toEqual(
          kind === "ready" ? FRESH_READY_WRITE_TRACE : DIRTY_WRITE_TRACE,
        );
      } finally {
        fixture.prepared.database.close();
      }
    },
  );

  it.each([
    { name: "ready scope CAS", kind: "ready", writeOrdinal: 1,
      mode: "skip" },
    { name: "dirty selected-query CAS", kind: "dirty", writeOrdinal: 1,
      mode: "zeroRowsWritten" },
    { name: "dirty scope CAS", kind: "dirty", writeOrdinal: 2,
      mode: "skip" },
  ] as const)(
    "refuses affected-row evidence for the $name and succeeds on retry",
    async ({ kind, writeOrdinal, mode }) => {
      const fixture = kind === "ready"
        ? await prepareReadyClaimFixture(140)
        : await prepareDirtyClaimFixture(150);
      try {
        const before = snapshotEvaluationState(fixture.prepared.database);
        fixture.probe.startAffectedRowRefusal(writeOrdinal, mode);

        const exit = await Effect.runPromiseExit(
          fixture.prepared.state.claimEvaluationWork(claimRequest(
            MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
          )),
        );

        expectAdapterInvariantDefect(exit);
        expect(fixture.probe.stop()).toEqual(
          expectedFaultTrace(kind, writeOrdinal),
        );
        expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
          before,
        );

        fixture.probe.start();
        await expect(claimEvaluationWork(
          fixture.prepared,
          claimRequest(MAX_EVALUATION_WORK_QUERY_INSPECTIONS),
        )).resolves.toMatchObject({ _tag: "claimed" });
        expect(fixture.probe.stop()).toEqual(
          kind === "ready" ? FRESH_READY_WRITE_TRACE : DIRTY_WRITE_TRACE,
        );
      } finally {
        fixture.prepared.database.close();
      }
    },
  );
});

interface ClaimFixture {
  readonly prepared: PreparedEvaluationState;
  readonly probe: ClaimSqlProbe;
}

async function prepareReadyClaimFixture(seed: number): Promise<ClaimFixture> {
  const probe = makeClaimSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  await beginEvaluation(prepared, queryDescriptor(seed));
  return Object.freeze({ prepared, probe });
}

async function prepareDirtyClaimFixture(seed: number): Promise<ClaimFixture> {
  const probe = makeClaimSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const dependency = `dirty-fixture-${seed}`;
  await completeCleanQuery(
    prepared,
    queryDescriptor(seed),
    400 + seed,
    dependency,
  );
  await applyCompletionBatch(
    prepared,
    captureCompletionBatch(prepared.binding, 12n, [dependency]),
  );
  return Object.freeze({ prepared, probe });
}

async function completeCleanQuery(
  prepared: PreparedEvaluationState,
  descriptor: QueryDescriptor,
  resultSeed: number,
  dependencyLabel: string,
): Promise<QueryEvaluationAttempt> {
  await beginEvaluation(prepared, descriptor);
  const claim = requireClaimed(await claimEvaluationWork(
    prepared,
    claimRequest(MAX_EVALUATION_WORK_QUERY_INSPECTIONS),
  ));
  const completion = await completeEvaluation(
    prepared,
    claim.attempt,
    makeCompletionEvidence(prepared, claim.attempt, {
      dependencyLabels: [dependencyLabel],
      resultSeed,
      publicationLabel: `claim-${dependencyLabel}`,
    }),
  );
  if (
    completion._tag !== "completed"
    || completion.publicationDisposition._tag !== "pending"
  ) {
    throw new Error("Expected a completed clean query with pending content.");
  }
  return claim.attempt;
}

function requireClaimed(
  receipt: ClaimEvaluationWorkReceipt,
): Extract<ClaimEvaluationWorkReceipt, { readonly _tag: "claimed" }> {
  if (receipt._tag !== "claimed") {
    throw new Error(`Expected claimed work, received ${receipt._tag}.`);
  }
  return receipt;
}

function sortedDescriptorPair(
  firstSeed: number,
  secondSeed: number,
): readonly [QueryDescriptor, QueryDescriptor] {
  const descriptors = [firstSeed, secondSeed].map(queryDescriptor).toSorted(
    (left, right) => compareCanonicalBase64Url(
      left.queryKey,
      right.queryKey,
    ),
  );
  const first = descriptors[0];
  const second = descriptors[1];
  if (first === undefined || second === undefined) {
    throw new Error("Expected two query descriptors.");
  }
  return [first, second];
}

function sortedDescriptorTriple(
  firstSeed: number,
  secondSeed: number,
  thirdSeed: number,
): readonly [QueryDescriptor, QueryDescriptor, QueryDescriptor] {
  const descriptors = [firstSeed, secondSeed, thirdSeed]
    .map(queryDescriptor).toSorted((left, right) =>
    compareCanonicalBase64Url(left.queryKey, right.queryKey)
  );
  const first = descriptors[0];
  const second = descriptors[1];
  const third = descriptors[2];
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error("Expected three query descriptors.");
  }
  return [first, second, third];
}

function receiptWithoutState<Decision extends { readonly state: unknown }>(
  decision: Decision,
): Omit<Decision, "state"> {
  const { state: _state, ...receipt } = decision;
  return receipt;
}

function expectScopeMatchesReference(
  prepared: PreparedEvaluationState,
  reference: QuerySyncReferenceModel,
): void {
  expect(readEvaluationScope(prepared.database)).toEqual({
    appliedThroughSequence:
      reference.state.cursor.appliedThroughSequence.toString(),
    evaluationWorkRevision:
      reference.state.evaluationWork.revision.toString(),
    fairnessAnchor: reference.state.evaluationWork.fairnessAnchor,
    metrics: reference.state.metrics,
  });
}

function expectedFaultTrace(
  kind: "ready" | "dirty",
  writeOrdinal: number,
): readonly ClaimSqlStage[] {
  if (kind === "ready") return FRESH_READY_WRITE_TRACE;
  return writeOrdinal === 1
    ? DIRTY_WRITE_TRACE.slice(0, -1)
    : DIRTY_WRITE_TRACE;
}

function expectAdapterInvariantDefect<A, E>(exit: Exit.Exit<A, E>): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  const defect = success(Cause.findDefect(exit.cause));
  expect(defect).toBeInstanceOf(DeploymentQuerySyncAdapterInvariantDefect);
  expect(defect).toMatchObject({
    operation: "claimEvaluationWork",
    stage: "write",
  });
}

function expectTypedFailure<A, E>(
  exit: Exit.Exit<A, E>,
  shape: Readonly<Record<string, unknown>>,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected typed failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject(
    shape,
  );
}

function expectDefect<A, E>(
  exit: Exit.Exit<A, E>,
  expected: Error,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  expect(Cause.hasDies(exit.cause)).toBe(true);
  expect(success(Cause.findDefect(exit.cause))).toBe(expected);
}
