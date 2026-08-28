import { Deferred, Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  admitChangeSourceRead,
  ChangeProjectionLimitError,
  ChangeSourceCorruptionError,
  ChangeSourceCursorAheadError,
  ChangeSourceIncompatibleError,
  ChangeSourceLimitError,
  ChangeSourceSequenceExhaustedError,
  CommittedChangeInvalidError,
  makeAdmittedChangeSource,
  MAX_MODEL_SEMANTIC_BYTES,
  MAX_MODEL_SEMANTIC_WORK_UNITS,
  MAX_PROJECTED_CANONICAL_BYTES,
  MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  MAX_SOURCE_PAGE_BATCHES,
  MAX_SOURCE_TRANSPORT_BYTES,
} from "@flarex/query-sync/internal/change";
import type {
  ChangeReadBudget,
  ChangeSourcePage,
  ChangeSourceReadRequest,
  InvalidationProjector,
  ReplayableChangeSource,
} from "@flarex/query-sync/internal/change";
import { MAX_SYNC_SEQUENCE } from "@flarex/query-sync/internal/kernel";
import type {
  NamespaceCursor,
  SyncSequence,
} from "@flarex/query-sync/internal/kernel";
import {
  captureGraphAuthorityObservation,
  captureGraphCommittedPayload,
  captureGraphEdgeDependencyKey,
  captureGraphNodeDependencyKey,
  captureKeyValueAuthorityObservation,
  captureKeyValueChangeDependencyKey,
  captureKeyValueCommittedPayload,
  makeGraphInvalidationProjector,
  makeKeyValueInvalidationProjector,
  makeReferenceReplayableChangeSource,
  ReferenceChangeSourceAppendError,
  ReferenceChangeSourceConstructionError,
} from "@flarex/query-sync/testing/conformance";
import type {
  GraphAuthorityObservation,
  GraphCommittedPayload,
  KeyValueAuthorityObservation,
  KeyValueCommittedPayload,
  ReferenceChangeSourceSnapshot,
} from "@flarex/query-sync/testing/conformance";

import { cursor, getSuccess } from "./fixtures.js";
import { runEffect, runEffectFailure } from "./effectBoundary.js";

const HARD_BUDGET: ChangeReadBudget = Object.freeze({
  committedBatches: MAX_SOURCE_PAGE_BATCHES,
  sourceTransportBytes: MAX_SOURCE_TRANSPORT_BYTES,
  modelSemanticWorkUnits: MAX_MODEL_SEMANTIC_WORK_UNITS,
  modelSemanticBytes: MAX_MODEL_SEMANTIC_BYTES,
  dependencyKeyExaminations: MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  canonicalDependencyBytes: MAX_PROJECTED_CANONICAL_BYTES,
});

function budget(
  overrides: Partial<ChangeReadBudget> = {},
): ChangeReadBudget {
  return Object.freeze({ ...HARD_BUDGET, ...overrides });
}

function request(
  binding: NamespaceCursor,
  requestedAfterSequenceExclusive = binding.appliedThroughSequence,
): ChangeSourceReadRequest {
  return Object.freeze({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    requestedAfterSequenceExclusive,
  });
}

function sequence(value: bigint): SyncSequence {
  return cursor({ sequence: value }).appliedThroughSequence;
}

function keyValueSnapshot(input: {
  readonly binding?: NamespaceCursor;
  readonly replayableAfter?: bigint;
  readonly batches?: readonly Readonly<{
    readonly sequence: bigint;
    readonly payload: KeyValueCommittedPayload;
    readonly transportBytes?: number;
  }>[];
  readonly authority?: KeyValueAuthorityObservation;
  readonly authorityTransportBytes?: number;
} = {}): ReferenceChangeSourceSnapshot<
  KeyValueCommittedPayload,
  KeyValueAuthorityObservation
> {
  const binding = input.binding ?? cursor();
  const replayableAfter = sequence(input.replayableAfter ?? 0n);
  const batches = input.batches ?? [];
  return {
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    replayableAfterSequenceExclusive: replayableAfter,
    observedLatestSequence:
      sequence(batches.at(-1)?.sequence ?? input.replayableAfter ?? 0n),
    batches: batches.map((batch) => ({
      sourceSequence: sequence(batch.sequence),
      payload: batch.payload,
      transportBytes: batch.transportBytes ?? 8,
    })),
    authorityObservation: input.authority ?? {
      revision: Number(batches.at(-1)?.sequence ?? 0n),
      partitions: ["primary"],
    },
    authorityTransportBytes: input.authorityTransportBytes ?? 4,
  };
}

function keyValueCapture() {
  return Object.freeze({
    capturePayload: captureKeyValueCommittedPayload,
    captureAuthorityObservation: captureKeyValueAuthorityObservation,
  });
}

function graphCapture() {
  return Object.freeze({
    capturePayload: captureGraphCommittedPayload,
    captureAuthorityObservation: captureGraphAuthorityObservation,
  });
}

function expectResultFailure<E>(
  result: Result.Result<unknown, E>,
): E {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isSuccess(result)) throw new Error("Expected failed Result.");
  return result.failure;
}

describe("query-sync change-source admission", () => {
  it("captures only declared fact and envelope fields", () => {
    const binding = cursor();
    let extraGetterReads = 0;
    const change = Object.defineProperty(
      { key: "stable", kind: "set" as const },
      "unmeasured",
      {
        enumerable: true,
        get: () => {
          extraGetterReads += 1;
          throw new Error("Unmeasured fact property was traversed.");
        },
      },
    );
    const changes = Object.defineProperty([change], "slice", {
      get: () => {
        extraGetterReads += 1;
        throw new Error("Caller-owned collection method was accessed.");
      },
    });
    const payload = captureKeyValueCommittedPayload({ changes });
    expect(extraGetterReads).toBe(0);
    expect(Object.keys(payload.changes[0] ?? {})).toEqual(["key", "kind"]);

    const batch = Object.defineProperty(
      {
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        sourceSequence: sequence(1n),
        payload,
      },
      "unmeasured",
      {
        enumerable: true,
        get: () => {
          extraGetterReads += 1;
          throw new Error("Unmeasured envelope property was traversed.");
        },
      },
    );
    const page: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = Object.freeze({
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: sequence(1n),
      observedLatestSequence: sequence(1n),
      batches: Object.freeze([batch]),
      readThroughSequence: sequence(1n),
      hasMore: false,
      authorityObservation: { revision: 1, partitions: [] },
      sourceTransportBytes: 1,
    });

    const admitted = getSuccess(admitChangeSourceRead(
      request(binding),
      budget(),
      page,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    ));
    expect(admitted._tag).toBe("page");
    expect(extraGetterReads).toBe(0);
  });

  it("returns exact reset and budget receipts without adapter extras", async () => {
    const binding = cursor();
    const replacement = cursor({ sourceEpoch: "replacement-epoch" });
    let extraGetterReads = 0;
    const poison = <A extends object>(value: A): A => Object.defineProperty(
      value,
      "unmeasured",
      {
        enumerable: true,
        get: () => {
          extraGetterReads += 1;
          throw new Error("Undeclared adapter field was traversed.");
        },
      },
    );
    const requestedCursor = () => ({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      appliedThroughSequence: sequence(0n),
    });
    const cases = [
      {
        expectedTag: "historyUnavailable",
        readBudget: budget(),
        decision: poison({
          _tag: "historyUnavailable" as const,
          requestedCursor: poison(requestedCursor()),
          currentSourceEpoch: binding.sourceEpoch,
          observedLatestSequence: sequence(2n),
          replayableAfterSequenceExclusive: sequence(1n),
          retainedFromSequenceInclusive: sequence(2n),
          reason: "requestedCursorBeforeReplayableHistory" as const,
        }),
      },
      {
        expectedTag: "epochReplaced",
        readBudget: budget(),
        decision: poison({
          _tag: "epochReplaced" as const,
          requestedCursor: poison(requestedCursor()),
          currentSourceEpoch: replacement.sourceEpoch,
          observedLatestSequence: sequence(0n),
          replayableAfterSequenceExclusive: sequence(0n),
          retainedFromSequenceInclusive: null,
          reason: "sourceEpochChanged" as const,
        }),
      },
      {
        expectedTag: "budgetInsufficient",
        readBudget: budget({ sourceTransportBytes: 4 }),
        decision: poison({
          _tag: "budgetInsufficient" as const,
          requestedCursor: poison(requestedCursor()),
          dimension: "sourceTransportBytes" as const,
          provided: 4,
          requiredAtLeast: 5,
          reason: "nextIndivisibleUnitExceedsBudget" as const,
        }),
      },
    ] as const;

    for (const testCase of cases) {
      const rawSource = Object.freeze({
        readAfter: () => Effect.succeed(testCase.decision),
      }) satisfies ReplayableChangeSource<
        KeyValueCommittedPayload,
        KeyValueAuthorityObservation
      >;
      const admitted = makeAdmittedChangeSource(
        rawSource,
        makeKeyValueInvalidationProjector(binding.syncModelId),
      );
      const read = await runEffect(admitted.readAfter(
        request(binding),
        testCase.readBudget,
      ));

      expect(read._tag).toBe(testCase.expectedTag);
      if (read._tag === "page") {
        throw new Error("Expected a reset or budget decision.");
      }
      expect(Object.keys(read)).not.toContain("unmeasured");
      expect(Object.keys(read.requestedCursor)).not.toContain("unmeasured");
    }
    expect(extraGetterReads).toBe(0);
  });

  it("projects unrelated key/value and graph changes without sharing model semantics", async () => {
    const keyValueBinding = cursor({ syncModelId: "key-value" });
    const keyValueSource = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({
        binding: keyValueBinding,
        batches: [{
          sequence: 1n,
          payload: { changes: [{ key: "node-a", kind: "set" }] },
        }],
      }),
      keyValueCapture(),
    ));
    const admittedKeyValue = makeAdmittedChangeSource(
      keyValueSource,
      makeKeyValueInvalidationProjector(keyValueBinding.syncModelId),
    );
    const keyValueRead = await runEffect(admittedKeyValue.readAfter(
      request(keyValueBinding),
      budget(),
    ));
    expect(keyValueRead._tag).toBe("page");
    if (keyValueRead._tag !== "page") return;

    const graphBinding = cursor({ syncModelId: "graph" });
    const graphSnapshot: ReferenceChangeSourceSnapshot<
      GraphCommittedPayload,
      GraphAuthorityObservation
    > = {
      namespaceId: graphBinding.namespaceId,
      syncModelId: graphBinding.syncModelId,
      sourceEpoch: graphBinding.sourceEpoch,
      replayableAfterSequenceExclusive: sequence(0n),
      observedLatestSequence: sequence(1n),
      batches: [{
        sourceSequence: sequence(1n),
        payload: {
          edges: [{
            from: "node-a",
            label: "knows",
            to: "node-b",
            kind: "upsert",
          }],
        },
        transportBytes: 12,
      }],
      authorityObservation: {
        head: "graph-head-1",
        vertices: ["node-a", "node-b"],
      },
      authorityTransportBytes: 5,
    };
    const graphSource = await runEffect(makeReferenceReplayableChangeSource(
      graphSnapshot,
      graphCapture(),
    ));
    const admittedGraph = makeAdmittedChangeSource(
      graphSource,
      makeGraphInvalidationProjector(graphBinding.syncModelId),
    );
    const graphRead = await runEffect(admittedGraph.readAfter(
      request(graphBinding),
      budget(),
    ));
    expect(graphRead._tag).toBe("page");
    if (graphRead._tag !== "page") return;

    const keyValueKey = getSuccess(captureKeyValueChangeDependencyKey(
      "node-a",
    ));
    const graphKeys = new Set([
      getSuccess(captureGraphEdgeDependencyKey(
        "node-a",
        "knows",
        "node-b",
      )),
      getSuccess(captureGraphNodeDependencyKey("node-a")),
      getSuccess(captureGraphNodeDependencyKey("node-b")),
    ]);
    expect(keyValueRead.batches[0]?.dependencyKeys).toEqual([keyValueKey]);
    expect(new Set(graphRead.batches[0]?.dependencyKeys)).toEqual(graphKeys);
    expect(graphKeys.has(keyValueKey)).toBe(false);
  });

  it("does not inspect dependency text beyond the semantic byte cutoff", async () => {
    const keyValueBinding = cursor({ syncModelId: "bounded-key-value" });
    const makeKeyValueSource = async (key: string) => {
      const source = await runEffect(makeReferenceReplayableChangeSource(
        keyValueSnapshot({
          binding: keyValueBinding,
          batches: [{
            sequence: 1n,
            payload: { changes: [{ key, kind: "set" }] },
          }],
        }),
        keyValueCapture(),
      ));
      return makeAdmittedChangeSource(
        source,
        makeKeyValueInvalidationProjector(keyValueBinding.syncModelId),
      );
    };

    const graphBinding = cursor({ syncModelId: "bounded-graph" });
    const makeGraphSource = async (from: string) => {
      const snapshot: ReferenceChangeSourceSnapshot<
        GraphCommittedPayload,
        GraphAuthorityObservation
      > = {
        namespaceId: graphBinding.namespaceId,
        syncModelId: graphBinding.syncModelId,
        sourceEpoch: graphBinding.sourceEpoch,
        replayableAfterSequenceExclusive: sequence(0n),
        observedLatestSequence: sequence(1n),
        batches: [{
          sourceSequence: sequence(1n),
          payload: {
            edges: [{
              from,
              label: "edge",
              to: "target",
              kind: "upsert",
            }],
          },
          transportBytes: 4,
        }],
        authorityObservation: {
          head: "head",
          vertices: [],
        },
        authorityTransportBytes: 2,
      };
      const source = await runEffect(makeReferenceReplayableChangeSource(
        snapshot,
        graphCapture(),
      ));
      return makeAdmittedChangeSource(
        source,
        makeGraphInvalidationProjector(graphBinding.syncModelId),
      );
    };

    const lateNullReads = await Promise.all([
      makeKeyValueSource("ab\0"),
      makeGraphSource("ab\0"),
    ]);
    for (const [index, admitted] of lateNullReads.entries()) {
      const binding = index === 0 ? keyValueBinding : graphBinding;
      const read = await runEffect(admitted.readAfter(
        request(binding),
        budget({ modelSemanticBytes: 1 }),
      ));
      expect(read).toMatchObject({
        _tag: "budgetInsufficient",
        dimension: "modelSemanticBytes",
        provided: 1,
        requiredAtLeast: 2,
      });
    }

    const earlyNullReads = await Promise.all([
      makeKeyValueSource("\0ab"),
      makeGraphSource("\0ab"),
    ]);
    for (const [index, admitted] of earlyNullReads.entries()) {
      const binding = index === 0 ? keyValueBinding : graphBinding;
      const failure = await runEffectFailure(admitted.readAfter(
        request(binding),
        budget({ modelSemanticBytes: 1 }),
      ));
      expect(failure).toBeInstanceOf(CommittedChangeInvalidError);
      expect(failure).toMatchObject({
        operation: "projectCommittedBatch",
        reason: "invalidPayload",
        sourceSequence: 1n,
      });
    }
  });

  it("paginates exactly and mints caught-up authority only at the observed head", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({
        binding,
        batches: [
          {
            sequence: 1n,
            payload: { changes: [{ key: "one", kind: "set" }] },
          },
          {
            sequence: 2n,
            payload: { changes: [{ key: "two", kind: "delete" }] },
          },
        ],
      }),
      keyValueCapture(),
    ));
    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );

    const first = await runEffect(admitted.readAfter(
      request(binding),
      budget({ committedBatches: 1 }),
    ));
    expect(first).toMatchObject({
      _tag: "page",
      requestedAfterSequenceExclusive: 0n,
      replayableAfterSequenceExclusive: 0n,
      retainedFromSequenceInclusive: 1n,
      observedLatestSequence: 2n,
      readThroughSequence: 1n,
      hasMore: true,
      caughtUpAuthority: null,
    });
    if (first._tag !== "page") return;
    expect(first.batches.map((batch) => batch.sourceSequence)).toEqual([1n]);

    const second = await runEffect(admitted.readAfter(
      request(binding, sequence(1n)),
      budget({ committedBatches: 1 }),
    ));
    expect(second).toMatchObject({
      _tag: "page",
      requestedAfterSequenceExclusive: 1n,
      observedLatestSequence: 2n,
      readThroughSequence: 2n,
      hasMore: false,
    });
    if (second._tag !== "page") return;
    expect(second.batches.map((batch) => batch.sourceSequence)).toEqual([2n]);
    expect(second.caughtUpAuthority).toMatchObject({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      readThroughSequence: 2n,
    });
    expect(Object.isFrozen(second.caughtUpAuthority)).toBe(true);
  });

  it("supports an empty caught-up epoch while retaining exact authority", async () => {
    const binding = cursor({ sequence: 7n });
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({
        binding,
        replayableAfter: 7n,
        authority: { revision: 7, partitions: ["empty-epoch"] },
      }),
      keyValueCapture(),
    ));
    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );
    const read = await runEffect(admitted.readAfter(
      request(binding),
      budget(),
    ));

    expect(read).toMatchObject({
      _tag: "page",
      batches: [],
      retainedFromSequenceInclusive: null,
      readThroughSequence: 7n,
      hasMore: false,
    });
    if (read._tag === "page") {
      expect(read.caughtUpAuthority?.readThroughSequence).toBe(7n);
    }
  });

  it("uses an injective bounded witness for distinct authority observations", () => {
    const binding = cursor();
    const projector = makeKeyValueInvalidationProjector(binding.syncModelId);
    const authorityBudget = Object.freeze({
      modelSemanticWorkUnits: MAX_MODEL_SEMANTIC_WORK_UNITS,
      modelSemanticBytes: MAX_MODEL_SEMANTIC_BYTES,
    });
    const common = Object.freeze({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      observedThroughSequence: binding.appliedThroughSequence,
    });
    const lowByte = getSuccess(projector.projectAuthorityObservation({
      ...common,
      observation: { revision: 7, partitions: ["\u0001"] },
    }, authorityBudget));
    const highByte = getSuccess(projector.projectAuthorityObservation({
      ...common,
      observation: { revision: 7, partitions: ["\u0100"] },
    }, authorityBudget));

    expect(lowByte.authorityWitness).not.toBe(highByte.authorityWitness);
  });

  it("returns complete history and epoch reset receipts and rejects a cursor ahead of authority", async () => {
    const binding = cursor({ sequence: 4n });
    const snapshot = keyValueSnapshot({
      binding,
      replayableAfter: 5n,
      batches: [
        {
          sequence: 6n,
          payload: { changes: [{ key: "six", kind: "set" }] },
        },
        {
          sequence: 7n,
          payload: { changes: [{ key: "seven", kind: "set" }] },
        },
      ],
    });
    const source = await runEffect(makeReferenceReplayableChangeSource(
      snapshot,
      keyValueCapture(),
    ));
    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );

    const unavailable = await runEffect(admitted.readAfter(
      request(binding, sequence(4n)),
      budget(),
    ));
    expect(unavailable).toMatchObject({
      _tag: "historyUnavailable",
      currentSourceEpoch: binding.sourceEpoch,
      observedLatestSequence: 7n,
      replayableAfterSequenceExclusive: 5n,
      retainedFromSequenceInclusive: 6n,
      reason: "requestedCursorBeforeReplayableHistory",
      requestedCursor: {
        appliedThroughSequence: 4n,
      },
    });

    const oldEpoch = cursor({ sourceEpoch: "old-epoch", sequence: 7n });
    const replaced = await runEffect(admitted.readAfter(
      request(oldEpoch),
      budget(),
    ));
    expect(replaced).toMatchObject({
      _tag: "epochReplaced",
      currentSourceEpoch: binding.sourceEpoch,
      observedLatestSequence: 7n,
      replayableAfterSequenceExclusive: 5n,
      retainedFromSequenceInclusive: 6n,
      reason: "sourceEpochChanged",
      requestedCursor: {
        sourceEpoch: oldEpoch.sourceEpoch,
        appliedThroughSequence: 7n,
      },
    });

    const ahead = await runEffectFailure(admitted.readAfter(
      request(binding, sequence(8n)),
      budget(),
    ));
    expect(ahead).toBeInstanceOf(ChangeSourceCursorAheadError);
    expect(ahead).toMatchObject({
      requestedAfterSequenceExclusive: 8n,
      observedLatestSequence: 7n,
    });
  });

  it("reports an indivisible transport or semantic unit as budget-insufficient", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({
        binding,
        batches: [
          {
            sequence: 1n,
            payload: { changes: [{ key: "one", kind: "set" }] },
            transportBytes: 10,
          },
          {
            sequence: 2n,
            payload: { changes: [{ key: "two", kind: "set" }] },
            transportBytes: 10,
          },
        ],
      }),
      keyValueCapture(),
    ));
    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );

    const transport = await runEffect(admitted.readAfter(
      request(binding),
      budget({ sourceTransportBytes: 9 }),
    ));
    expect(transport).toMatchObject({
      _tag: "budgetInsufficient",
      dimension: "sourceTransportBytes",
      provided: 9,
      requiredAtLeast: 10,
      reason: "nextIndivisibleUnitExceedsBudget",
    });

    const semantic = await runEffect(admitted.readAfter(
      request(binding),
      budget({
        committedBatches: 1,
        modelSemanticWorkUnits: 1,
      }),
    ));
    expect(semantic).toMatchObject({
      _tag: "budgetInsufficient",
      dimension: "modelSemanticWorkUnits",
      provided: 1,
      requiredAtLeast: 2,
      reason: "nextIndivisibleUnitExceedsBudget",
    });
  });

  it("accounts for the fixed-width key/value authority revision budget", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({
        binding,
        authority: { revision: 0, partitions: [] },
      }),
      keyValueCapture(),
    ));
    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );

    const belowFixedWidth = await runEffect(admitted.readAfter(
      request(binding),
      budget({ modelSemanticBytes: 7 }),
    ));
    expect(belowFixedWidth).toMatchObject({
      _tag: "budgetInsufficient",
      dimension: "modelSemanticBytes",
      provided: 7,
      requiredAtLeast: 8,
      reason: "nextIndivisibleUnitExceedsBudget",
    });

    const exactFixedWidth = await runEffect(admitted.readAfter(
      request(binding),
      budget({ modelSemanticBytes: 8 }),
    ));
    expect(exactFixedWidth).toMatchObject({
      _tag: "page",
      readThroughSequence: 0n,
      hasMore: false,
      projectionMetrics: { modelSemanticBytes: 8 },
    });
    if (exactFixedWidth._tag === "page") {
      expect(exactFixedWidth.caughtUpAuthority).not.toBeNull();
    }
  });

  it("projects each semantic envelope once and returns the admitted prefix", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({
        binding,
        batches: [
          {
            sequence: 1n,
            payload: { changes: [{ key: "one", kind: "set" }] },
          },
          {
            sequence: 2n,
            payload: { changes: [{ key: "two", kind: "set" }] },
          },
        ],
      }),
      keyValueCapture(),
    ));
    const baseProjector = makeKeyValueInvalidationProjector(
      binding.syncModelId,
    );
    let batchProjectionCalls = 0;
    let authorityProjectionCalls = 0;
    const projector = Object.freeze({
      syncModelId: baseProjector.syncModelId,
      projectCommittedBatch: (batch, projectionBudget) => {
        batchProjectionCalls += 1;
        return baseProjector.projectCommittedBatch(batch, projectionBudget);
      },
      projectAuthorityObservation: (
        input: Parameters<
          typeof baseProjector.projectAuthorityObservation
        >[0],
        projectionBudget: Parameters<
          typeof baseProjector.projectAuthorityObservation
        >[1],
      ) => {
        authorityProjectionCalls += 1;
        return baseProjector.projectAuthorityObservation(
          input,
          projectionBudget,
        );
      },
    } satisfies InvalidationProjector<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    >);
    const admitted = makeAdmittedChangeSource(source, projector);

    const read = await runEffect(admitted.readAfter(
      request(binding),
      budget({ modelSemanticWorkUnits: 2 }),
    ));

    expect(read).toMatchObject({
      _tag: "page",
      readThroughSequence: 1n,
      hasMore: true,
      caughtUpAuthority: null,
      projectionMetrics: { modelSemanticWorkUnits: 2 },
    });
    if (read._tag === "page") {
      expect(read.batches.map((batch) => batch.sourceSequence)).toEqual([1n]);
    }
    expect(batchProjectionCalls).toBe(2);
    expect(authorityProjectionCalls).toBe(0);
  });

  it("keeps prefix progress monotonic across the authority budget boundary", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({
        binding,
        batches: [
          {
            sequence: 1n,
            payload: { changes: [] },
            transportBytes: 2,
          },
          {
            sequence: 2n,
            payload: { changes: [] },
            transportBytes: 3,
          },
        ],
        authority: { revision: 2, partitions: [] },
        authorityTransportBytes: 5,
      }),
      keyValueCapture(),
    ));
    const baseProjector = makeKeyValueInvalidationProjector(
      binding.syncModelId,
    );
    const projectionCalls: string[] = [];
    const projector = Object.freeze({
      syncModelId: baseProjector.syncModelId,
      projectCommittedBatch: (batch, projectionBudget) => {
        projectionCalls.push(`batch:${batch.sourceSequence}`);
        return baseProjector.projectCommittedBatch(batch, projectionBudget);
      },
      projectAuthorityObservation: (
        input: Parameters<
          typeof baseProjector.projectAuthorityObservation
        >[0],
        projectionBudget: Parameters<
          typeof baseProjector.projectAuthorityObservation
        >[1],
      ) => {
        projectionCalls.push("authority");
        return baseProjector.projectAuthorityObservation(
          input,
          projectionBudget,
        );
      },
    } satisfies InvalidationProjector<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    >);
    const admitted = makeAdmittedChangeSource(source, projector);

    const readAt = async (modelSemanticWorkUnits: number) => {
      projectionCalls.length = 0;
      const read = await runEffect(admitted.readAfter(
        request(binding),
        budget({ modelSemanticWorkUnits }),
      ));
      return Object.freeze({
        read,
        calls: Object.freeze([...projectionCalls]),
      });
    };

    const atOne = await readAt(1);
    const atTwo = await readAt(2);
    const atThree = await readAt(3);

    for (const result of [atOne, atTwo]) {
      expect(result.read).toMatchObject({
        _tag: "page",
        readThroughSequence: 1n,
        hasMore: true,
        caughtUpAuthority: null,
        sourceTransportBytes: 10,
        projectionMetrics: { modelSemanticWorkUnits: 1 },
      });
      if (result.read._tag === "page") {
        expect(result.read.batches.map((batch) => batch.sourceSequence))
          .toEqual([1n]);
      }
    }
    expect(atOne.calls).toEqual(["batch:1", "batch:2"]);
    expect(atTwo.calls).toEqual(["batch:1", "batch:2", "authority"]);

    expect(atThree.read).toMatchObject({
      _tag: "page",
      readThroughSequence: 2n,
      hasMore: false,
      sourceTransportBytes: 10,
      projectionMetrics: { modelSemanticWorkUnits: 3 },
    });
    if (atThree.read._tag === "page") {
      expect(atThree.read.batches.map((batch) => batch.sourceSequence))
        .toEqual([1n, 2n]);
      expect(atThree.read.caughtUpAuthority).not.toBeNull();
    }
    expect(atThree.calls).toEqual(["batch:1", "batch:2", "authority"]);
  });

  it("keeps malformed projector limit proofs terminal", () => {
    const binding = cursor();
    const baseProjector = makeKeyValueInvalidationProjector(
      binding.syncModelId,
    );
    const oneBatchPage: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = Object.freeze({
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: sequence(1n),
      observedLatestSequence: sequence(1n),
      batches: Object.freeze([{
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        sourceSequence: sequence(1n),
        payload: { changes: [] },
      }]),
      readThroughSequence: sequence(1n),
      hasMore: false,
      authorityObservation: { revision: 1, partitions: [] },
      sourceTransportBytes: 1,
    });
    const malformedBatchProofs = [
      new ChangeProjectionLimitError({
        operation: "projectCommittedBatch",
        dimension: "modelSemanticWorkUnits",
        maximum: 2,
        observed: 2,
      }),
      new ChangeProjectionLimitError({
        operation: "projectCommittedBatch",
        dimension: "modelSemanticWorkUnits",
        maximum: 2,
        observed: Number.NaN,
      }),
      new ChangeProjectionLimitError({
        operation: "projectAuthorityObservation",
        dimension: "modelSemanticWorkUnits",
        maximum: 2,
        observed: 3,
      }),
    ];
    for (const malformed of malformedBatchProofs) {
      const projector = Object.freeze({
        syncModelId: baseProjector.syncModelId,
        projectCommittedBatch: () => Result.fail(malformed),
        projectAuthorityObservation:
          baseProjector.projectAuthorityObservation,
      }) satisfies InvalidationProjector<
        KeyValueCommittedPayload,
        KeyValueAuthorityObservation
      >;
      const failure = expectResultFailure(admitChangeSourceRead(
        request(binding),
        budget({ modelSemanticWorkUnits: 2 }),
        oneBatchPage,
        projector,
      ));
      expect(failure).toBe(malformed);
    }

    const forbiddenAuthorityDimension = new ChangeProjectionLimitError({
      operation: "projectAuthorityObservation",
      dimension: "dependencyKeyExaminations",
      maximum: 2,
      observed: 3,
    });
    const authorityProjector = Object.freeze({
      syncModelId: baseProjector.syncModelId,
      projectCommittedBatch: baseProjector.projectCommittedBatch,
      projectAuthorityObservation: () => Result.fail(
        forbiddenAuthorityDimension,
      ),
    }) satisfies InvalidationProjector<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    >;
    const emptyPage: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = Object.freeze({
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: null,
      observedLatestSequence: sequence(0n),
      batches: Object.freeze([]),
      readThroughSequence: sequence(0n),
      hasMore: false,
      authorityObservation: { revision: 0, partitions: [] },
      sourceTransportBytes: 0,
    });
    const authorityFailure = expectResultFailure(admitChangeSourceRead(
      request(binding),
      budget({ dependencyKeyExaminations: 2 }),
      emptyPage,
      authorityProjector,
    ));
    expect(authorityFailure).toBe(forbiddenAuthorityDimension);
  });

  it("keeps successful over-budget projector receipts terminal", () => {
    const binding = cursor();
    const baseProjector = makeKeyValueInvalidationProjector(
      binding.syncModelId,
    );
    const batch = Object.freeze({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      sourceSequence: sequence(1n),
      payload: Object.freeze({ changes: Object.freeze([]) }),
    });
    const oneBatchPage: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = Object.freeze({
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: sequence(1n),
      observedLatestSequence: sequence(1n),
      batches: Object.freeze([batch]),
      readThroughSequence: sequence(1n),
      hasMore: false,
      authorityObservation: Object.freeze({
        revision: 1,
        partitions: Object.freeze([]),
      }),
      sourceTransportBytes: 1,
    });
    const batchProjector = Object.freeze({
      syncModelId: baseProjector.syncModelId,
      projectCommittedBatch: () => {
        const base = getSuccess(baseProjector.projectCommittedBatch(
          batch,
          HARD_BUDGET,
        ));
        return Result.succeed(Object.freeze({
          admittedBatch: base.admittedBatch,
          metrics: Object.freeze({
            modelSemanticWorkUnits: 2,
            modelSemanticBytes: base.metrics.modelSemanticBytes,
            dependencyKeyExaminations:
              base.metrics.dependencyKeyExaminations,
            canonicalDependencyBytes:
              base.metrics.canonicalDependencyBytes,
          }),
        }));
      },
      projectAuthorityObservation:
        baseProjector.projectAuthorityObservation,
    }) satisfies InvalidationProjector<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    >;
    const batchFailure = expectResultFailure(admitChangeSourceRead(
      request(binding),
      budget({ modelSemanticWorkUnits: 1 }),
      oneBatchPage,
      batchProjector,
    ));
    expect(batchFailure).toBeInstanceOf(CommittedChangeInvalidError);
    expect(batchFailure).toMatchObject({
      operation: "projectCommittedBatch",
      reason: "invalidProjectionMetrics",
      sourceSequence: 1n,
    });

    const emptyPage: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = Object.freeze({
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: null,
      observedLatestSequence: sequence(0n),
      batches: Object.freeze([]),
      readThroughSequence: sequence(0n),
      hasMore: false,
      authorityObservation: Object.freeze({
        revision: 0,
        partitions: Object.freeze([]),
      }),
      sourceTransportBytes: 0,
    });
    const authorityProjector = Object.freeze({
      syncModelId: baseProjector.syncModelId,
      projectCommittedBatch: baseProjector.projectCommittedBatch,
      projectAuthorityObservation: (
        input: Parameters<
          typeof baseProjector.projectAuthorityObservation
        >[0],
      ) => {
        const base = getSuccess(baseProjector.projectAuthorityObservation(
          input,
          HARD_BUDGET,
        ));
        return Result.succeed(Object.freeze({
          authorityWitness: base.authorityWitness,
          metrics: Object.freeze({
            modelSemanticWorkUnits: 2,
            modelSemanticBytes: base.metrics.modelSemanticBytes,
          }),
        }));
      },
    }) satisfies InvalidationProjector<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    >;
    const authorityFailure = expectResultFailure(admitChangeSourceRead(
      request(binding),
      budget({ modelSemanticWorkUnits: 1 }),
      emptyPage,
      authorityProjector,
    ));
    expect(authorityFailure).toBeInstanceOf(CommittedChangeInvalidError);
    expect(authorityFailure).toMatchObject({
      operation: "projectAuthorityObservation",
      reason: "invalidProjectionMetrics",
      sourceSequence: 0n,
    });
  });

  it("captures authority projection metrics once and by exact fields", () => {
    const binding = cursor();
    const baseProjector = makeKeyValueInvalidationProjector(
      binding.syncModelId,
    );
    let metricsReads = 0;
    let extraGetterReads = 0;
    const projector = Object.freeze({
      syncModelId: baseProjector.syncModelId,
      projectCommittedBatch: baseProjector.projectCommittedBatch,
      projectAuthorityObservation: (
        input: Parameters<
          typeof baseProjector.projectAuthorityObservation
        >[0],
        projectionBudget: Parameters<
          typeof baseProjector.projectAuthorityObservation
        >[1],
      ) => {
        const base = getSuccess(baseProjector.projectAuthorityObservation(
          input,
          projectionBudget,
        ));
        const metrics = Object.defineProperty(
          {
            modelSemanticWorkUnits: base.metrics.modelSemanticWorkUnits,
            modelSemanticBytes: base.metrics.modelSemanticBytes,
          },
          "unmeasured",
          {
            enumerable: true,
            get: () => {
              extraGetterReads += 1;
              throw new Error("Unmeasured authority metric was traversed.");
            },
          },
        );
        const output = {
          authorityWitness: base.authorityWitness,
          metrics,
        };
        Object.defineProperty(output, "metrics", {
          enumerable: true,
          get: () => {
            metricsReads += 1;
            return metrics;
          },
        });
        return Result.succeed(output);
      },
    }) satisfies InvalidationProjector<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    >;
    const page: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = Object.freeze({
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: null,
      observedLatestSequence: sequence(0n),
      batches: Object.freeze([]),
      readThroughSequence: sequence(0n),
      hasMore: false,
      authorityObservation: { revision: 0, partitions: [] },
      sourceTransportBytes: 0,
    });

    const read = getSuccess(admitChangeSourceRead(
      request(binding),
      budget(),
      page,
      projector,
    ));
    expect(read._tag).toBe("page");
    if (read._tag === "page") {
      expect(Object.keys(read.projectionMetrics)).toEqual([
        "modelSemanticWorkUnits",
        "modelSemanticBytes",
        "dependencyKeyExaminations",
        "canonicalDependencyBytes",
      ]);
    }
    expect(metricsReads).toBe(1);
    expect(extraGetterReads).toBe(0);
  });

  it("rejects invalid and above-hard-limit budgets before reading", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({ binding }),
      keyValueCapture(),
    ));
    let sourceReadCalls = 0;
    const countedSource = Object.freeze({
      readAfter: (readRequest, readBudget) => {
        sourceReadCalls += 1;
        return source.readAfter(readRequest, readBudget);
      },
    } satisfies ReplayableChangeSource<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    >);
    const admitted = makeAdmittedChangeSource(
      countedSource,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );

    const invalid = await runEffectFailure(admitted.readAfter(
      request(binding),
      budget({ committedBatches: 0 }),
    ));
    expect(invalid).toBeInstanceOf(ChangeSourceIncompatibleError);
    expect(invalid).toMatchObject({ reason: "invalidBudget" });

    const excessive = await runEffectFailure(admitted.readAfter(
      request(binding),
      budget({ committedBatches: MAX_SOURCE_PAGE_BATCHES + 1 }),
    ));
    expect(excessive).toBeInstanceOf(ChangeSourceLimitError);
    expect(excessive).toMatchObject({
      dimension: "committedBatches",
      maximum: MAX_SOURCE_PAGE_BATCHES,
      observed: MAX_SOURCE_PAGE_BATCHES + 1,
    });
    expect(sourceReadCalls).toBe(0);
  });

  it("distinguishes malformed transport measurements from hard-limit overflow", () => {
    const binding = cursor();
    const page = (sourceTransportBytes: number): ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > => Object.freeze({
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: null,
      observedLatestSequence: sequence(0n),
      batches: Object.freeze([]),
      readThroughSequence: sequence(0n),
      hasMore: false,
      authorityObservation: { revision: 0, partitions: [] },
      sourceTransportBytes,
    });

    for (const malformed of [-1, Number.NaN, 1.5]) {
      const failure = expectResultFailure(admitChangeSourceRead(
        request(binding),
        budget(),
        page(malformed),
        makeKeyValueInvalidationProjector(binding.syncModelId),
      ));
      expect(failure).toBeInstanceOf(ChangeSourceCorruptionError);
      expect(failure).toMatchObject({
        reason: "invalidTransportMeasurement",
      });
    }

    const excessive = expectResultFailure(admitChangeSourceRead(
      request(binding),
      budget(),
      page(MAX_SOURCE_TRANSPORT_BYTES + 1),
      makeKeyValueInvalidationProjector(binding.syncModelId),
    ));
    expect(excessive).toBeInstanceOf(ChangeSourceLimitError);
    expect(excessive).toMatchObject({
      dimension: "sourceTransportBytes",
      maximum: MAX_SOURCE_TRANSPORT_BYTES,
      observed: MAX_SOURCE_TRANSPORT_BYTES + 1,
    });
  });

  it("captures request and budget ownership before a source read suspends", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({ binding }),
      keyValueCapture(),
    ));
    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    const gatedSource = Object.freeze({
      readAfter: (readRequest, readBudget) => Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return yield* source.readAfter(readRequest, readBudget);
      }),
    } satisfies ReplayableChangeSource<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    >);
    const admitted = makeAdmittedChangeSource(
      gatedSource,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );
    const callerRequest = {
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: binding.appliedThroughSequence,
    };
    const callerBudget = { ...HARD_BUDGET };

    const pending = runEffect(admitted.readAfter(
      callerRequest,
      callerBudget,
    ));
    await runEffect(Deferred.await(entered));
    callerRequest.namespaceId = cursor({
      namespaceId: "mutated-namespace",
    }).namespaceId;
    callerRequest.sourceEpoch = cursor({
      sourceEpoch: "mutated-epoch",
    }).sourceEpoch;
    callerBudget.committedBatches = 0;
    await runEffect(Deferred.succeed(release, undefined));

    const read = await pending;
    expect(read).toMatchObject({
      _tag: "page",
      namespaceId: binding.namespaceId,
      sourceEpoch: binding.sourceEpoch,
      readThroughSequence: binding.appliedThroughSequence,
    });
  });

  it("binds source and projector capabilities across suspended and later reads", async () => {
    const binding = cursor();
    const referenceSource = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({
        binding,
        batches: [{
          sequence: 1n,
          payload: { changes: [{ key: "stable", kind: "set" }] },
        }],
      }),
      keyValueCapture(),
    ));
    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    type SourceReadAfter = ReplayableChangeSource<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    >["readAfter"];
    type SourceBundle = {
      readAfter: SourceReadAfter;
      delegate: typeof referenceSource;
    };
    let sourceCapabilityReads = 0;
    let sourceReadAfter: SourceReadAfter = function(
      this: SourceBundle,
      readRequest: Parameters<SourceReadAfter>[0],
      readBudget: Parameters<SourceReadAfter>[1],
    ): ReturnType<SourceReadAfter> {
      const delegate = this.delegate;
      return Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return yield* delegate.readAfter(readRequest, readBudget);
      });
    };
    const sourceBundle = Object.defineProperty(
      { delegate: referenceSource } as SourceBundle,
      "readAfter",
      {
        enumerable: true,
        get: () => {
          sourceCapabilityReads += 1;
          return sourceReadAfter;
        },
        set: (value: SourceReadAfter) => {
          sourceReadAfter = value;
        },
      },
    );
    const baseProjector = makeKeyValueInvalidationProjector(
      binding.syncModelId,
    );
    type ProjectorBundle = {
      delegate: typeof baseProjector;
      syncModelId: typeof baseProjector.syncModelId;
      projectCommittedBatch: typeof baseProjector.projectCommittedBatch;
      projectAuthorityObservation:
        typeof baseProjector.projectAuthorityObservation;
    };
    const projectorCapabilityReads = {
      syncModelId: 0,
      projectCommittedBatch: 0,
      projectAuthorityObservation: 0,
    };
    let syncModelId = baseProjector.syncModelId;
    let projectCommittedBatch: ProjectorBundle["projectCommittedBatch"] =
      function(
        this: ProjectorBundle,
        batch: Parameters<ProjectorBundle["projectCommittedBatch"]>[0],
        projectionBudget: Parameters<
          ProjectorBundle["projectCommittedBatch"]
        >[1],
      ): ReturnType<ProjectorBundle["projectCommittedBatch"]> {
        return this.delegate.projectCommittedBatch(
          batch,
          projectionBudget,
        );
      };
    let projectAuthorityObservation:
      ProjectorBundle["projectAuthorityObservation"] = function(
        this: ProjectorBundle,
        input: Parameters<
          ProjectorBundle["projectAuthorityObservation"]
        >[0],
        projectionBudget: Parameters<
          ProjectorBundle["projectAuthorityObservation"]
        >[1],
      ): ReturnType<ProjectorBundle["projectAuthorityObservation"]> {
        return this.delegate.projectAuthorityObservation(
          input,
          projectionBudget,
        );
      };
    const projectorBundle = Object.defineProperties(
      { delegate: baseProjector } as ProjectorBundle,
      {
        syncModelId: {
          enumerable: true,
          get: () => {
            projectorCapabilityReads.syncModelId += 1;
            return syncModelId;
          },
          set: (value: ProjectorBundle["syncModelId"]) => {
            syncModelId = value;
          },
        },
        projectCommittedBatch: {
          enumerable: true,
          get: () => {
            projectorCapabilityReads.projectCommittedBatch += 1;
            return projectCommittedBatch;
          },
          set: (value: ProjectorBundle["projectCommittedBatch"]) => {
            projectCommittedBatch = value;
          },
        },
        projectAuthorityObservation: {
          enumerable: true,
          get: () => {
            projectorCapabilityReads.projectAuthorityObservation += 1;
            return projectAuthorityObservation;
          },
          set: (
            value: ProjectorBundle["projectAuthorityObservation"],
          ) => {
            projectAuthorityObservation = value;
          },
        },
      },
    );
    const admitted = makeAdmittedChangeSource(
      sourceBundle,
      projectorBundle,
    );
    expect(sourceCapabilityReads).toBe(1);
    expect(projectorCapabilityReads).toEqual({
      syncModelId: 1,
      projectCommittedBatch: 1,
      projectAuthorityObservation: 1,
    });

    const pending = runEffect(admitted.readAfter(
      request(binding),
      budget(),
    ));
    await runEffect(Deferred.await(entered));
    sourceBundle.readAfter = () => Effect.die(
      new Error("Mutated source capability was invoked."),
    );
    projectorBundle.projectCommittedBatch = () => {
      throw new Error("Mutated batch projector was invoked.");
    };
    projectorBundle.projectAuthorityObservation = () => {
      throw new Error("Mutated authority projector was invoked.");
    };
    await runEffect(Deferred.succeed(release, undefined));

    const first = await pending;
    expect(first).toMatchObject({
      _tag: "page",
      readThroughSequence: 1n,
      hasMore: false,
    });

    projectorBundle.syncModelId = cursor({
      syncModelId: "mutated-model",
    }).syncModelId;
    const second = await runEffect(admitted.readAfter(
      request(binding, sequence(1n)),
      budget(),
    ));
    expect(second).toMatchObject({
      _tag: "page",
      syncModelId: binding.syncModelId,
      readThroughSequence: 1n,
      hasMore: false,
    });
    expect(sourceCapabilityReads).toBe(1);
    expect(projectorCapabilityReads).toEqual({
      syncModelId: 1,
      projectCommittedBatch: 1,
      projectAuthorityObservation: 1,
    });
  });

  it("rejects gaps, duplicate sequence positions, and empty progress pages", () => {
    const binding = cursor();
    const readRequest = request(binding);
    const projector = makeKeyValueInvalidationProjector(binding.syncModelId);
    const payload: KeyValueCommittedPayload = {
      changes: [{ key: "one", kind: "set" }],
    };
    const malformedPages: readonly ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    >[] = [
      {
        _tag: "page",
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        requestedAfterSequenceExclusive: sequence(0n),
        replayableAfterSequenceExclusive: sequence(0n),
        retainedFromSequenceInclusive: sequence(1n),
        observedLatestSequence: sequence(2n),
        batches: [{
          namespaceId: binding.namespaceId,
          syncModelId: binding.syncModelId,
          sourceEpoch: binding.sourceEpoch,
          sourceSequence: sequence(2n),
          payload,
        }],
        readThroughSequence: sequence(2n),
        hasMore: false,
        authorityObservation: { revision: 2, partitions: [] },
        sourceTransportBytes: 1,
      },
      {
        _tag: "page",
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        requestedAfterSequenceExclusive: sequence(0n),
        replayableAfterSequenceExclusive: sequence(0n),
        retainedFromSequenceInclusive: sequence(1n),
        observedLatestSequence: sequence(1n),
        batches: [
          {
            namespaceId: binding.namespaceId,
            syncModelId: binding.syncModelId,
            sourceEpoch: binding.sourceEpoch,
            sourceSequence: sequence(1n),
            payload,
          },
          {
            namespaceId: binding.namespaceId,
            syncModelId: binding.syncModelId,
            sourceEpoch: binding.sourceEpoch,
            sourceSequence: sequence(1n),
            payload,
          },
        ],
        readThroughSequence: sequence(1n),
        hasMore: false,
        authorityObservation: { revision: 1, partitions: [] },
        sourceTransportBytes: 2,
      },
      {
        _tag: "page",
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        requestedAfterSequenceExclusive: sequence(0n),
        replayableAfterSequenceExclusive: sequence(0n),
        retainedFromSequenceInclusive: sequence(1n),
        observedLatestSequence: sequence(1n),
        batches: [],
        readThroughSequence: sequence(0n),
        hasMore: true,
        authorityObservation: null,
        sourceTransportBytes: 0,
      },
    ];

    for (const malformed of malformedPages) {
      const failure = expectResultFailure(admitChangeSourceRead(
        readRequest,
        budget(),
        malformed,
        projector,
      ));
      expect(failure).toBeInstanceOf(ChangeSourceCorruptionError);
      expect(failure).toMatchObject({
        reason: malformed.batches.length === 0
          ? "invalidPagePosition"
          : "nonContiguousPage",
      });
    }
  });

  it("classifies portable sequence exhaustion before attempting progress", () => {
    const binding = cursor({ sequence: MAX_SYNC_SEQUENCE });
    const readRequest = request(binding);
    const page: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = {
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: binding.appliedThroughSequence,
      replayableAfterSequenceExclusive: binding.appliedThroughSequence,
      retainedFromSequenceInclusive: null,
      observedLatestSequence: binding.appliedThroughSequence,
      batches: [{
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        sourceSequence: binding.appliedThroughSequence,
        payload: { changes: [{ key: "impossible", kind: "set" }] },
      }],
      readThroughSequence: binding.appliedThroughSequence,
      hasMore: false,
      authorityObservation: { revision: 1, partitions: [] },
      sourceTransportBytes: 1,
    };

    const failure = expectResultFailure(admitChangeSourceRead(
      readRequest,
      budget(),
      page,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    ));
    expect(failure).toBeInstanceOf(ChangeSourceSequenceExhaustedError);
  });

  it("stops a projector at the first hard semantic work unit beyond the limit", () => {
    const binding = cursor();
    const repeatedChange = { key: "x", kind: "set" } as const;
    const page: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = {
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: sequence(1n),
      observedLatestSequence: sequence(1n),
      batches: [{
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        sourceSequence: sequence(1n),
        payload: {
          changes: Array.from(
            { length: MAX_MODEL_SEMANTIC_WORK_UNITS },
            () => repeatedChange,
          ),
        },
      }],
      readThroughSequence: sequence(1n),
      hasMore: false,
      authorityObservation: { revision: 1, partitions: [] },
      sourceTransportBytes: 1,
    };

    const failure = expectResultFailure(admitChangeSourceRead(
      request(binding),
      budget(),
      page,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    ));
    expect(failure).toBeInstanceOf(ChangeProjectionLimitError);
    expect(failure).toMatchObject({
      operation: "projectCommittedBatch",
      dimension: "modelSemanticWorkUnits",
      maximum: MAX_MODEL_SEMANTIC_WORK_UNITS,
      observed: MAX_MODEL_SEMANTIC_WORK_UNITS + 1,
    });
  });

  it("rejects malformed payload and authority observations", () => {
    const binding = cursor();
    const basePage = {
      _tag: "page" as const,
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: sequence(1n),
      observedLatestSequence: sequence(1n),
      readThroughSequence: sequence(1n),
      hasMore: false as const,
      sourceTransportBytes: 1,
    };
    const malformedPayload: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = {
      ...basePage,
      batches: [{
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        sourceSequence: sequence(1n),
        payload: { changes: [{ key: "", kind: "set" }] },
      }],
      authorityObservation: { revision: 1, partitions: [] },
    };
    const malformedAuthority: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = {
      ...basePage,
      batches: [{
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        sourceSequence: sequence(1n),
        payload: { changes: [{ key: "valid", kind: "set" }] },
      }],
      authorityObservation: { revision: -1, partitions: [] },
    };

    for (const [page, reason] of [
      [malformedPayload, "invalidPayload"],
      [malformedAuthority, "invalidAuthorityObservation"],
    ] as const) {
      const failure = expectResultFailure(admitChangeSourceRead(
        request(binding),
        budget(),
        page,
        makeKeyValueInvalidationProjector(binding.syncModelId),
      ));
      expect(failure).toBeInstanceOf(CommittedChangeInvalidError);
      expect(failure).toMatchObject({ reason });
    }
  });

  it("rejects absent authority observations for empty and nonempty caught-up pages", () => {
    const binding = cursor();
    const projector = makeKeyValueInvalidationProjector(binding.syncModelId);
    const empty: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = {
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: null,
      observedLatestSequence: sequence(0n),
      batches: [],
      readThroughSequence: sequence(0n),
      hasMore: false,
      authorityObservation: { revision: 0, partitions: [] },
      sourceTransportBytes: 0,
    };
    const nonempty: ChangeSourcePage<
      KeyValueCommittedPayload,
      KeyValueAuthorityObservation
    > = {
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
      replayableAfterSequenceExclusive: sequence(0n),
      retainedFromSequenceInclusive: sequence(1n),
      observedLatestSequence: sequence(1n),
      batches: [{
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        sourceSequence: sequence(1n),
        payload: { changes: [] },
      }],
      readThroughSequence: sequence(1n),
      hasMore: false,
      authorityObservation: { revision: 1, partitions: [] },
      sourceTransportBytes: 1,
    };

    for (const page of [empty, nonempty]) {
      expect(Reflect.set(page, "authorityObservation", undefined)).toBe(true);
      const failure = expectResultFailure(admitChangeSourceRead(
        request(binding),
        budget(),
        page,
        projector,
      ));
      expect(failure).toBeInstanceOf(ChangeSourceCorruptionError);
      expect(failure).toMatchObject({
        reason: "invalidCaughtUpObservation",
      });
    }
  });

  it("captures caller-owned payload and authority values before later mutation", async () => {
    const binding = cursor();
    const callerChange = { key: "stable", kind: "set" as const };
    const callerChanges: Array<{
      key: string;
      kind: "set" | "delete";
    }> = [callerChange];
    const callerPartitions = ["primary"];
    const source = await runEffect(makeReferenceReplayableChangeSource({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      replayableAfterSequenceExclusive: sequence(0n),
      observedLatestSequence: sequence(1n),
      batches: [{
        sourceSequence: sequence(1n),
        payload: { changes: callerChanges },
        transportBytes: 3,
      }],
      authorityObservation: {
        revision: 1,
        partitions: callerPartitions,
      },
      authorityTransportBytes: 2,
    }, keyValueCapture()));

    callerChange.key = "mutated";
    callerChanges.push({ key: "late", kind: "delete" });
    callerPartitions.push("late-partition");

    const read = await runEffect(source.readAfter(request(binding), budget()));
    expect(read._tag).toBe("page");
    if (read._tag !== "page") return;
    expect(read.batches[0]?.payload.changes).toEqual([
      { key: "stable", kind: "set" },
    ]);
    expect(read.authorityObservation).toEqual({
      revision: 1,
      partitions: ["primary"],
    });
    expect(Object.isFrozen(read.batches[0]?.payload.changes)).toBe(true);
    expect(Object.isFrozen(read.authorityObservation)).toBe(true);
  });

  it("captures initial source identity before capture callbacks can mutate it", async () => {
    const binding = cursor();
    const mutated = cursor({
      namespaceId: "mutated-namespace",
      syncModelId: "mutated-model",
      sourceEpoch: "mutated-epoch",
    });
    const snapshotInput = {
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      replayableAfterSequenceExclusive: sequence(0n),
      observedLatestSequence: sequence(1n),
      batches: [{
        sourceSequence: sequence(1n),
        payload: { changes: [{ key: "owned", kind: "set" as const }] },
        transportBytes: 3,
      }],
      authorityObservation: { revision: 1, partitions: ["primary"] },
      authorityTransportBytes: 2,
    };
    const captureBundle: {
      capturePayload: (
        payload: KeyValueCommittedPayload,
      ) => KeyValueCommittedPayload;
      captureAuthorityObservation: (
        observation: KeyValueAuthorityObservation,
      ) => KeyValueAuthorityObservation;
    } = {
      capturePayload: (payload) => {
        snapshotInput.namespaceId = mutated.namespaceId;
        snapshotInput.syncModelId = mutated.syncModelId;
        snapshotInput.sourceEpoch = mutated.sourceEpoch;
        snapshotInput.replayableAfterSequenceExclusive = sequence(9n);
        snapshotInput.observedLatestSequence = sequence(9n);
        const first = snapshotInput.batches[0];
        if (first !== undefined) {
          first.sourceSequence = sequence(2n);
          first.transportBytes = Number.NaN;
        }
        snapshotInput.batches.push({
          sourceSequence: sequence(3n),
          payload: { changes: [] },
          transportBytes: Number.NaN,
        });
        snapshotInput.authorityTransportBytes = Number.NaN;
        captureBundle.captureAuthorityObservation = () => ({
          revision: 999,
          partitions: ["mutated"],
        });
        return captureKeyValueCommittedPayload(payload);
      },
      captureAuthorityObservation: captureKeyValueAuthorityObservation,
    };

    const source = await runEffect(makeReferenceReplayableChangeSource(
      snapshotInput,
      captureBundle,
    ));
    const read = await runEffect(source.readAfter(request(binding), budget()));

    expect(read).toMatchObject({
      _tag: "page",
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      replayableAfterSequenceExclusive: 0n,
      observedLatestSequence: 1n,
      readThroughSequence: 1n,
      sourceTransportBytes: 5,
      authorityObservation: { revision: 1, partitions: ["primary"] },
    });
    if (read._tag === "page") {
      expect(read.batches).toHaveLength(1);
      expect(read.batches[0]?.sourceSequence).toBe(1n);
    }
  });

  it("captures append identity before payload capture can mutate its input", async () => {
    const binding = cursor();
    const appendInput = {
      sourceSequence: sequence(1n),
      payload: { changes: [{ key: "owned", kind: "set" as const }] },
      transportBytes: 1,
    };
    let mutateDuringCapture = false;
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({ binding }),
      Object.freeze({
        capturePayload: (payload: KeyValueCommittedPayload) => {
          if (mutateDuringCapture) {
            appendInput.sourceSequence = sequence(2n);
            appendInput.transportBytes = MAX_SOURCE_TRANSPORT_BYTES + 1;
          }
          return captureKeyValueCommittedPayload(payload);
        },
        captureAuthorityObservation: captureKeyValueAuthorityObservation,
      }),
    ));
    mutateDuringCapture = true;

    await runEffect(source.appendCommittedBatch(
      appendInput,
      { revision: 1, partitions: [] },
      1,
    ));
    const read = await runEffect(source.readAfter(
      request(binding),
      budget(),
    ));

    expect(read._tag).toBe("page");
    if (read._tag === "page") {
      expect(read.batches[0]?.sourceSequence).toBe(1n);
      expect(read.batches[0]?.payload.changes[0]?.key).toBe("owned");
    }
  });

  it("retains the construction capture policy for later appends", async () => {
    const binding = cursor();
    const captureBundle: {
      capturePayload: (
        payload: KeyValueCommittedPayload,
      ) => KeyValueCommittedPayload;
      captureAuthorityObservation: (
        observation: KeyValueAuthorityObservation,
      ) => KeyValueAuthorityObservation;
    } = {
      capturePayload: captureKeyValueCommittedPayload,
      captureAuthorityObservation: captureKeyValueAuthorityObservation,
    };
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({ binding }),
      captureBundle,
    ));
    captureBundle.capturePayload = (payload) => payload;
    captureBundle.captureAuthorityObservation = (observation) => observation;

    const callerChange = { key: "stable", kind: "set" as const };
    const callerChanges = [callerChange];
    const callerPartitions = ["primary"];
    await runEffect(source.appendCommittedBatch({
      sourceSequence: sequence(1n),
      payload: { changes: callerChanges },
      transportBytes: 2,
    }, {
      revision: 1,
      partitions: callerPartitions,
    }, 1));

    callerChange.key = "mutated";
    callerChanges.push({ key: "late", kind: "set" });
    callerPartitions.push("late");

    const read = await runEffect(source.readAfter(request(binding), budget()));
    expect(read._tag).toBe("page");
    if (read._tag === "page") {
      expect(read.batches[0]?.payload.changes).toEqual([
        { key: "stable", kind: "set" },
      ]);
      expect(read.authorityObservation).toEqual({
        revision: 1,
        partitions: ["primary"],
      });
      expect(Object.isFrozen(read.batches[0]?.payload.changes)).toBe(true);
      expect(Object.isFrozen(read.authorityObservation)).toBe(true);
    }
  });

  it("preserves the capture policy receiver for construction and append", async () => {
    const binding = cursor();
    type ReceiverCapture = {
      capturePayload: (
        this: ReceiverCapture | undefined,
        payload: KeyValueCommittedPayload,
      ) => KeyValueCommittedPayload;
      captureAuthorityObservation: (
        this: ReceiverCapture | undefined,
        observation: KeyValueAuthorityObservation,
      ) => KeyValueAuthorityObservation;
    };
    const captureBundle: ReceiverCapture = {
      capturePayload(payload) {
        const prefix = this === captureBundle ? "owned:" : "wrong:";
        return captureKeyValueCommittedPayload({
          changes: payload.changes.map((change) => ({
            key: `${prefix}${change.key}`,
            kind: change.kind,
          })),
        });
      },
      captureAuthorityObservation(observation) {
        const prefix = this === captureBundle ? "owned:" : "wrong:";
        return captureKeyValueAuthorityObservation({
          revision: observation.revision,
          partitions: observation.partitions.map(
            (partition) => `${prefix}${partition}`,
          ),
        });
      },
    };
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({
        binding,
        batches: [{
          sequence: 1n,
          payload: { changes: [{ key: "initial", kind: "set" }] },
        }],
        authority: { revision: 1, partitions: ["initial"] },
      }),
      captureBundle,
    ));
    captureBundle.capturePayload = (payload) => payload;
    captureBundle.captureAuthorityObservation = (observation) => observation;

    await runEffect(source.appendCommittedBatch({
      sourceSequence: sequence(2n),
      payload: { changes: [{ key: "appended", kind: "delete" }] },
      transportBytes: 2,
    }, {
      revision: 2,
      partitions: ["next"],
    }, 1));

    const read = await runEffect(source.readAfter(request(binding), budget()));
    expect(read._tag).toBe("page");
    if (read._tag === "page") {
      expect(read.batches.map((batch) =>
        batch.payload.changes[0]?.key)).toEqual([
        "owned:initial",
        "owned:appended",
      ]);
      expect(read.authorityObservation).toEqual({
        revision: 2,
        partitions: ["owned:next"],
      });
    }
  });

  it("rejects a conflicting append without changing the retained source", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({
        binding,
        batches: [{
          sequence: 1n,
          payload: { changes: [{ key: "original", kind: "set" }] },
        }],
      }),
      keyValueCapture(),
    ));
    const failure = await runEffectFailure(source.appendCommittedBatch({
      sourceSequence: sequence(1n),
      payload: { changes: [{ key: "conflict", kind: "set" }] },
      transportBytes: 1,
    }, { revision: 1, partitions: [] }, 1));
    expect(failure).toBeInstanceOf(ReferenceChangeSourceAppendError);
    expect(failure).toMatchObject({
      operation: "appendCommittedBatch",
      reason: "conflictingCommittedBatch",
    });

    const read = await runEffect(source.readAfter(request(binding), budget()));
    expect(read._tag).toBe("page");
    if (read._tag === "page") {
      expect(read.batches[0]?.payload.changes[0]?.key).toBe("original");
    }
  });

  it("classifies malformed and excessive reference transport measurements", async () => {
    const binding = cursor();
    const malformedInitial = await runEffectFailure(
      makeReferenceReplayableChangeSource(
        keyValueSnapshot({
          binding,
          authorityTransportBytes: Number.NaN,
        }),
        keyValueCapture(),
      ),
    );
    expect(malformedInitial).toBeInstanceOf(
      ReferenceChangeSourceConstructionError,
    );
    expect(malformedInitial).toMatchObject({
      operation: "makeReferenceReplayableChangeSource",
      reason: "invalidTransportMeasurement",
    });

    const excessiveInitial = await runEffectFailure(
      makeReferenceReplayableChangeSource(
        keyValueSnapshot({
          binding,
          authorityTransportBytes: MAX_SOURCE_TRANSPORT_BYTES + 1,
        }),
        keyValueCapture(),
      ),
    );
    expect(excessiveInitial).toBeInstanceOf(
      ReferenceChangeSourceConstructionError,
    );
    expect(excessiveInitial).toMatchObject({
      operation: "makeReferenceReplayableChangeSource",
      reason: "sourceTransportLimitExceeded",
      observed: MAX_SOURCE_TRANSPORT_BYTES + 1,
    });

    const source = await runEffect(makeReferenceReplayableChangeSource(
      keyValueSnapshot({ binding }),
      keyValueCapture(),
    ));
    for (const malformed of [-1, Number.NaN, 1.5]) {
      const failure = await runEffectFailure(source.appendCommittedBatch({
        sourceSequence: sequence(1n),
        payload: { changes: [] },
        transportBytes: malformed,
      }, { revision: 1, partitions: [] }, 0));
      expect(failure).toBeInstanceOf(ReferenceChangeSourceAppendError);
      expect(failure).toMatchObject({
        operation: "appendCommittedBatch",
        reason: "invalidTransportMeasurement",
      });
    }

    const excessive = await runEffectFailure(source.appendCommittedBatch({
      sourceSequence: sequence(1n),
      payload: { changes: [] },
      transportBytes: MAX_SOURCE_TRANSPORT_BYTES + 1,
    }, { revision: 1, partitions: [] }, 0));
    expect(excessive).toBeInstanceOf(ReferenceChangeSourceAppendError);
    expect(excessive).toMatchObject({
      operation: "appendCommittedBatch",
      reason: "sourceTransportLimitExceeded",
      observed: MAX_SOURCE_TRANSPORT_BYTES + 1,
    });
  });
});
