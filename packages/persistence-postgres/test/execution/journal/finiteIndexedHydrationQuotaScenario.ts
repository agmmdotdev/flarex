import { Effect } from "effect";
import { expect, vi } from "vitest";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { decodeOrderedIndexBoundHexV1 } from "flarex-protocol/ordered-index";
import * as rootOwner from "../../../src/storage/documents/logicalDocuments/rootEvaluator";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import { inventory, makeFiniteIndexedQueriesHarness } from "./finiteIndexedQueriesScenario";

type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;

/** Capture the real constructor's result without substituting a root or an
 * admission. Spend its actual local budget to reach selected-body hydration. */
export const finiteIndexedHydrationQuotaScenario = Effect.fn("FiniteIndexedQueries.hydrationQuota")(
  function* (native: Fixture) {
    return yield* Effect.scoped(Effect.gen(function* () {
      const harness = yield* makeFiniteIndexedQueriesHarness(native);
      const actualConstructor = rootOwner.makeLogicalDocumentRootEvaluator;
      const captured: Readonly<{ evaluator: rootOwner.LogicalDocumentRootEvaluator; pins: rootOwner.LogicalDocumentRootPins }>[] = [];
      yield* Effect.acquireRelease(Effect.sync(() => vi.spyOn(rootOwner, "makeLogicalDocumentRootEvaluator")
        .mockImplementation((pins, limits) => {
          const evaluator = actualConstructor(pins, limits);
          captured.push({ evaluator, pins });
          return evaluator;
        })), spy => Effect.sync(() => { spy.mockRestore(); }));
      const before = yield* Effect.tryPromise(() => inventory(native));
      const entry = yield* harness.open();
      const absentId = appDocumentIdV1FromRowIdentity({ tableId: harness.tableId,
        rowId: decodeAppRowIdHexV1("8f000000000000000000000000000001") });
      expect(yield* harness.store.runPointOperationEffect(entry.table, { kind: "get",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n), documentId: absentId }, entry.validator))
        .toMatchObject({ kind: "completed", outcome: { kind: "missing" } });
      expect(yield* harness.store.runIndexedQueryEffect(entry.index, { kind: "indexRange",
        syscallSequence: CommitSyscallSequenceV1Schema.make(2n), bounds: { endExclusive: decodeOrderedIndexBoundHexV1("00") }, limit: 1 }))
        .toMatchObject({ kind: "completed", outcome: { documents: [], isDone: true } });
      const owned = captured.find(candidate => candidate.pins.attempt === entry.attempt);
      if (owned === undefined) throw new Error("Missing genuinely constructed finite root");
      const state = rootOwner.attachLogicalDocumentRootEvaluator(owned.evaluator, owned.pins);
      if (state === null) throw new Error("Missing actual open finite root state");
      const maximum = state.limits.workingBytes;
      yield* Effect.fromResult(rootOwner.reserveLogicalDocumentRootBytes(owned.evaluator, owned.pins,
        maximum - state.workingBytes));
      expect(state.workingBytes).toBe(maximum);

      // Definition/read metadata and the empty pending tree were already
      // admitted above. This range must fail when it retains Alpha's body.
      const failure = yield* Effect.flip(harness.store.runIndexedQueryEffect(entry.index, { kind: "indexRange",
        syscallSequence: CommitSyscallSequenceV1Schema.make(3n), bounds: {}, limit: 1 }));
      expect(failure).toBeInstanceOf(rootOwner.LogicalDocumentRootLimitError);
      expect(failure).toMatchObject({ resource: "workingBytes", observed: expect.any(Number), maximum });
      expect(yield* Effect.tryPromise(() => inventory(native))).toEqual(before);
      yield* harness.store.discardFiniteRootEffect(entry.attempt);
    }));
  },
);
