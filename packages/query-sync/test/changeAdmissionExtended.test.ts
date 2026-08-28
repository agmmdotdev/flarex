import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  admitChangeSourceRead,
  ChangeProjectionLimitError,
  ChangeSourceCorruptionError,
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
} from "@flarex/query-sync/internal/change";
import type {
  NamespaceCursor,
  SyncSequence,
} from "@flarex/query-sync/internal/kernel";
import {
  captureKeyValueAuthorityObservation,
  captureKeyValueCommittedPayload,
  makeKeyValueInvalidationProjector,
  makeReferenceReplayableChangeSource,
} from "@flarex/query-sync/testing/conformance";
import type {
  KeyValueAuthorityObservation,
  KeyValueCommittedPayload,
  ReferenceChangeSourceSnapshot,
} from "@flarex/query-sync/testing/conformance";

import { runEffect, runEffectFailure } from "./effectBoundary.js";
import { cursor } from "./fixtures.js";

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

function sequence(value: bigint): SyncSequence {
  return cursor({ sequence: value }).appliedThroughSequence;
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

function captureBundle() {
  return Object.freeze({
    capturePayload: captureKeyValueCommittedPayload,
    captureAuthorityObservation: captureKeyValueAuthorityObservation,
  });
}

function snapshot(input: {
  readonly binding: NamespaceCursor;
  readonly replayableAfter?: bigint;
  readonly batches?: readonly Readonly<{
    readonly sequence: bigint;
    readonly payload: KeyValueCommittedPayload;
  }>[];
  readonly authority?: KeyValueAuthorityObservation;
}): ReferenceChangeSourceSnapshot<
  KeyValueCommittedPayload,
  KeyValueAuthorityObservation
> {
  const batches = input.batches ?? [];
  const replayableAfter = input.replayableAfter
    ?? input.binding.appliedThroughSequence;
  const observedLatest = batches.at(-1)?.sequence ?? replayableAfter;
  return Object.freeze({
    namespaceId: input.binding.namespaceId,
    syncModelId: input.binding.syncModelId,
    sourceEpoch: input.binding.sourceEpoch,
    replayableAfterSequenceExclusive: sequence(replayableAfter),
    observedLatestSequence: sequence(observedLatest),
    batches: Object.freeze(batches.map((batch) => Object.freeze({
      sourceSequence: sequence(batch.sequence),
      payload: batch.payload,
      transportBytes: 1,
    }))),
    authorityObservation: input.authority ?? {
      revision: Number(observedLatest),
      partitions: [],
    },
    authorityTransportBytes: 1,
  });
}

function resultFailure<E>(result: Result.Result<unknown, E>): E {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isSuccess(result)) throw new Error("Expected failed Result.");
  return result.failure;
}

describe("query-sync extended change-source evidence", () => {
  it.each([
    { label: "sequence zero", baseline: 0n },
    { label: "a nonzero scope-lifetime baseline", baseline: 17n },
  ])("admits empty bound-epoch history at $label", async ({ baseline }) => {
    const binding = cursor({ sequence: baseline });
    const source = await runEffect(makeReferenceReplayableChangeSource(
      snapshot({ binding, replayableAfter: baseline }),
      captureBundle(),
    ));
    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );

    const read = await runEffect(admitted.readAfter(
      request(binding),
      HARD_BUDGET,
    ));

    expect(read).toMatchObject({
      _tag: "page",
      retainedFromSequenceInclusive: null,
      observedLatestSequence: baseline,
      batches: [],
      readThroughSequence: baseline,
      hasMore: false,
    });
    if (read._tag === "page") {
      expect(read.caughtUpAuthority).toMatchObject({
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        readThroughSequence: baseline,
      });
    }
  });

  it("advances across a committed payload that projects no dependency keys", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      snapshot({
        binding,
        replayableAfter: 0n,
        batches: [{ sequence: 1n, payload: { changes: [] } }],
      }),
      captureBundle(),
    ));
    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );

    const read = await runEffect(admitted.readAfter(
      request(binding),
      HARD_BUDGET,
    ));

    expect(read).toMatchObject({
      _tag: "page",
      observedLatestSequence: 1n,
      readThroughSequence: 1n,
      hasMore: false,
    });
    if (read._tag !== "page") return;
    expect(read.batches).toHaveLength(1);
    expect(read.batches[0]).toMatchObject({
      sourceSequence: 1n,
      dependencyKeys: [],
    });
    expect(read.caughtUpAuthority?.readThroughSequence).toBe(1n);
  });

  it("does not mint caught-up authority when the head advances between pages", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      snapshot({
        binding,
        replayableAfter: 0n,
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
      captureBundle(),
    ));
    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );
    const oneBatch = budget({ committedBatches: 1 });

    const first = await runEffect(admitted.readAfter(
      request(binding),
      oneBatch,
    ));
    expect(first).toMatchObject({
      _tag: "page",
      observedLatestSequence: 2n,
      readThroughSequence: 1n,
      hasMore: true,
      caughtUpAuthority: null,
    });

    await runEffect(source.appendCommittedBatch({
      sourceSequence: sequence(3n),
      payload: { changes: [{ key: "three", kind: "set" }] },
      transportBytes: 1,
    }, { revision: 3, partitions: [] }, 1));

    const second = await runEffect(admitted.readAfter(
      request(binding, sequence(1n)),
      oneBatch,
    ));
    expect(second).toMatchObject({
      _tag: "page",
      observedLatestSequence: 3n,
      readThroughSequence: 2n,
      hasMore: true,
      caughtUpAuthority: null,
    });

    const caughtUp = await runEffect(admitted.readAfter(
      request(binding, sequence(2n)),
      oneBatch,
    ));
    expect(caughtUp).toMatchObject({
      _tag: "page",
      observedLatestSequence: 3n,
      readThroughSequence: 3n,
      hasMore: false,
    });
    if (caughtUp._tag === "page") {
      expect(caughtUp.caughtUpAuthority?.readThroughSequence).toBe(3n);
    }
  });

  it("replays one immutable epoch and sequence deterministically", async () => {
    const binding = cursor();
    const source = await runEffect(makeReferenceReplayableChangeSource(
      snapshot({
        binding,
        replayableAfter: 0n,
        batches: [{
          sequence: 1n,
          payload: { changes: [{ key: "stable", kind: "delete" }] },
        }],
        authority: { revision: 1, partitions: ["primary"] },
      }),
      captureBundle(),
    ));
    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );

    const first = await runEffect(admitted.readAfter(
      request(binding),
      HARD_BUDGET,
    ));
    const replay = await runEffect(admitted.readAfter(
      request(binding),
      HARD_BUDGET,
    ));

    expect(replay).toEqual(first);
    expect(replay).not.toBe(first);
    if (first._tag === "page" && replay._tag === "page") {
      expect(replay.batches).not.toBe(first.batches);
      expect(replay.caughtUpAuthority?.authorityWitness).toBe(
        first.caughtUpAuthority?.authorityWitness,
      );
    }
  });

  it("refuses a portable page whose batch mixes namespace, model, or epoch authority", () => {
    const binding = cursor();
    const otherNamespace = cursor({ namespaceId: "tenant-b" });
    const otherModel = cursor({ syncModelId: "other-model" });
    const otherEpoch = cursor({ sourceEpoch: "epoch-b" });
    const mismatches = [
      {
        namespaceId: otherNamespace.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
      },
      {
        namespaceId: binding.namespaceId,
        syncModelId: otherModel.syncModelId,
        sourceEpoch: binding.sourceEpoch,
      },
      {
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: otherEpoch.sourceEpoch,
      },
    ] as const;

    for (const mismatch of mismatches) {
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
          ...mismatch,
          sourceSequence: sequence(1n),
          payload: { changes: [] },
        }],
        readThroughSequence: sequence(1n),
        hasMore: false,
        authorityObservation: { revision: 1, partitions: [] },
        sourceTransportBytes: 1,
      };

      const failure = resultFailure(admitChangeSourceRead(
        request(binding),
        HARD_BUDGET,
        page,
        makeKeyValueInvalidationProjector(binding.syncModelId),
      ));
      expect(failure).toBeInstanceOf(ChangeSourceCorruptionError);
      expect(failure).toMatchObject({ reason: "mixedAuthority" });
    }
  });

  it("stops authority traversal at the semantic limit-plus-one proof", () => {
    const binding = cursor();
    let indexedReads = 0;
    let highestRead = -1;
    const partitions = new Proxy(
      new Array<string>(MAX_MODEL_SEMANTIC_WORK_UNITS + 100),
      {
        get: (target, property, receiver) => {
          if (
            typeof property === "string"
            && /^(0|[1-9][0-9]*)$/.test(property)
          ) {
            const index = Number(property);
            indexedReads += 1;
            highestRead = Math.max(highestRead, index);
            return "partition";
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const projector = makeKeyValueInvalidationProjector(
      binding.syncModelId,
    );

    const failure = resultFailure(projector.projectAuthorityObservation({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      observedThroughSequence: binding.appliedThroughSequence,
      observation: { revision: 0, partitions },
    }, {
      modelSemanticWorkUnits: MAX_MODEL_SEMANTIC_WORK_UNITS,
      modelSemanticBytes: MAX_MODEL_SEMANTIC_BYTES,
    }));

    expect(failure).toBeInstanceOf(ChangeProjectionLimitError);
    expect(failure).toMatchObject({
      operation: "projectAuthorityObservation",
      dimension: "modelSemanticWorkUnits",
      maximum: MAX_MODEL_SEMANTIC_WORK_UNITS,
      observed: MAX_MODEL_SEMANTIC_WORK_UNITS + 1,
    });
    expect(indexedReads).toBe(MAX_MODEL_SEMANTIC_WORK_UNITS);
    expect(highestRead).toBe(MAX_MODEL_SEMANTIC_WORK_UNITS - 1);
  });

  it("bounds source payload capture at the semantic hard-limit proof prefix", async () => {
    const binding = cursor();
    let indexedReads = 0;
    let highestRead = -1;
    const change = Object.freeze({ key: "same", kind: "set" as const });
    const changes = new Proxy(
      new Array(MAX_MODEL_SEMANTIC_WORK_UNITS + 100).fill(change),
      {
        get: (target, property, receiver) => {
          if (
            typeof property === "string"
            && /^(0|[1-9][0-9]*)$/.test(property)
          ) {
            const index = Number(property);
            indexedReads += 1;
            highestRead = Math.max(highestRead, index);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const source = await runEffect(makeReferenceReplayableChangeSource(
      snapshot({
        binding,
        batches: [{
          sequence: 1n,
          payload: { changes },
        }],
      }),
      captureBundle(),
    ));

    expect(indexedReads).toBe(MAX_MODEL_SEMANTIC_WORK_UNITS);
    expect(highestRead).toBe(MAX_MODEL_SEMANTIC_WORK_UNITS - 1);

    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );
    const failure = await runEffectFailure(admitted.readAfter(
      request(binding),
      HARD_BUDGET,
    ));
    expect(failure).toBeInstanceOf(ChangeProjectionLimitError);
    expect(failure).toMatchObject({
      operation: "projectCommittedBatch",
      dimension: "modelSemanticWorkUnits",
      maximum: MAX_MODEL_SEMANTIC_WORK_UNITS,
      observed: MAX_MODEL_SEMANTIC_WORK_UNITS + 1,
    });
  });

  it("bounds source authority capture at the semantic hard-limit proof prefix", async () => {
    const binding = cursor();
    let indexedReads = 0;
    let highestRead = -1;
    const partitions = new Proxy(
      new Array(MAX_MODEL_SEMANTIC_WORK_UNITS + 100).fill("partition"),
      {
        get: (target, property, receiver) => {
          if (
            typeof property === "string"
            && /^(0|[1-9][0-9]*)$/.test(property)
          ) {
            const index = Number(property);
            indexedReads += 1;
            highestRead = Math.max(highestRead, index);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const source = await runEffect(makeReferenceReplayableChangeSource(
      snapshot({
        binding,
        authority: { revision: 0, partitions },
      }),
      captureBundle(),
    ));

    expect(indexedReads).toBe(MAX_MODEL_SEMANTIC_WORK_UNITS);
    expect(highestRead).toBe(MAX_MODEL_SEMANTIC_WORK_UNITS - 1);

    const admitted = makeAdmittedChangeSource(
      source,
      makeKeyValueInvalidationProjector(binding.syncModelId),
    );
    const failure = await runEffectFailure(admitted.readAfter(
      request(binding),
      HARD_BUDGET,
    ));
    expect(failure).toBeInstanceOf(ChangeProjectionLimitError);
    expect(failure).toMatchObject({
      operation: "projectAuthorityObservation",
      dimension: "modelSemanticWorkUnits",
      maximum: MAX_MODEL_SEMANTIC_WORK_UNITS,
      observed: MAX_MODEL_SEMANTIC_WORK_UNITS + 1,
    });
  });
});
