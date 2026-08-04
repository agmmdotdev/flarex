import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decideCompleteAttemptV1 } from "../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import type {
  PersistedTaskRequestedEffectV1,
  TaskRunAttemptAggregateV1,
} from "../src/runAttempt/Model.js";
import {
  decodePersistedTaskRequestedEffectJsonV1,
  decodePersistedTaskRunAttemptAggregateJsonV1,
  encodePersistedTaskRequestedEffectJsonV1,
  encodePersistedTaskRunAttemptAggregateJsonV1,
  MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1,
  MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1,
  MAX_TASK_PERSISTED_JSON_NESTING_DEPTH_V1,
  TASK_PERSISTED_UINT8ARRAY_TAG_V1,
  TASK_REQUESTED_EFFECT_PERSISTED_JSON_CODEC_V1,
  TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
  type TaskPersistenceCodecErrorV1,
} from "../src/runAttempt/PersistenceCodec.js";
import {
  ATTEMPT_ID,
  FENCE_1,
  RUN_ID,
  committedDecision,
  duration,
  effectSequence,
  executingAggregate,
} from "./support.js";

function codecFailure(
  result: Result.Result<unknown, TaskPersistenceCodecErrorV1>,
): TaskPersistenceCodecErrorV1 {
  if (Result.isSuccess(result)) throw new Error("expected persistence codec failure");
  return result.failure;
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findByteWrapper(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findByteWrapper(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isMutableRecord(value)) return null;
  if (Object.hasOwn(value, TASK_PERSISTED_UINT8ARRAY_TAG_V1)) return value;
  for (const item of Object.values(value)) {
    const found = findByteWrapper(item);
    if (found !== null) return found;
  }
  return null;
}

function succeededAggregateWithResult(): TaskRunAttemptAggregateV1 {
  const sha256 = new Uint8Array(32);
  sha256[0] = 0x7f;
  return committedDecision(decideCompleteAttemptV1({
    type: "complete_attempt",
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    executionFence: FENCE_1,
    completion: {
      kind: "succeeded",
      result: {
        codec: "flarex.task-result.v1",
        byteLength: 123,
        sha256,
      },
      executionDurationMs: null,
    },
  }, {
    databaseNowMs: executingAggregate().createdAtMs,
    current: executingAggregate({ effectCursor: 8n }),
    attemptGrantCandidate: null,
  })).next;
}

function notifyCurrentStateEffect(): PersistedTaskRequestedEffectV1 {
  return {
    sequence: effectSequence(1n),
    effect: {
      version: "flarex.task-requested-effect.v1",
      runId: RUN_ID,
      acceptedRunVersion: executingAggregate().runVersion,
      kind: "notify_current_state",
    },
  };
}

describe("DTE04-A1 persisted JSON codecs", () => {
  it("round-trips the aggregate with exact bigint and Schema-owned byte encodings", () => {
    const aggregate = succeededAggregateWithResult();
    const encoded = Result.getOrThrow(
      encodePersistedTaskRunAttemptAggregateJsonV1(aggregate),
    );
    const wrapper = findByteWrapper(encoded.aggregate);
    expect(encoded.codec).toBe(TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1);
    expect(wrapper?.[TASK_PERSISTED_UINT8ARRAY_TAG_V1]).toBeTypeOf("string");
    expect(encoded.aggregate.runVersion).toBe(aggregate.runVersion.toString());
    expect(Object.isFrozen(encoded)).toBe(true);
    expect(Object.isFrozen(encoded.aggregate)).toBe(true);

    const decoded = Result.getOrThrow(
      decodePersistedTaskRunAttemptAggregateJsonV1(encoded),
    );
    expect(decoded.runVersion).toBe(aggregate.runVersion);
    expect(decoded.phase).toBe("terminal");
    if (decoded.phase !== "terminal" || decoded.terminal.kind !== "succeeded" ||
      decoded.terminal.result === null) {
      throw new Error("expected succeeded aggregate result");
    }
    expect(Array.from(decoded.terminal.result.sha256)).toEqual([
      0x7f,
      ...new Array<number>(31).fill(0),
    ]);
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it("owns the encoded byte spelling and each decoded byte array", () => {
    const aggregate = succeededAggregateWithResult();
    if (aggregate.phase !== "terminal" || aggregate.terminal.kind !== "succeeded" ||
      aggregate.terminal.result === null) {
      throw new Error("expected succeeded aggregate result");
    }
    const encoded = Result.getOrThrow(
      encodePersistedTaskRunAttemptAggregateJsonV1(aggregate),
    );
    const wrapper = findByteWrapper(encoded.aggregate);
    const spelling = wrapper?.[TASK_PERSISTED_UINT8ARRAY_TAG_V1];
    aggregate.terminal.result.sha256[0] = 0;
    expect(wrapper?.[TASK_PERSISTED_UINT8ARRAY_TAG_V1]).toBe(spelling);

    const first = Result.getOrThrow(
      decodePersistedTaskRunAttemptAggregateJsonV1(encoded),
    );
    const second = Result.getOrThrow(
      decodePersistedTaskRunAttemptAggregateJsonV1(encoded),
    );
    if (first.phase !== "terminal" || second.phase !== "terminal" ||
      first.terminal.kind !== "succeeded" || second.terminal.kind !== "succeeded" ||
      first.terminal.result === null || second.terminal.result === null) {
      throw new Error("expected decoded succeeded results");
    }
    expect(first.terminal.result.sha256).not.toBe(second.terminal.result.sha256);
    first.terminal.result.sha256[0] = 0;
    expect(second.terminal.result.sha256[0]).toBe(0x7f);
  });

  it("round-trips one persisted requested effect independently", () => {
    const effect = notifyCurrentStateEffect();
    const encoded = Result.getOrThrow(
      encodePersistedTaskRequestedEffectJsonV1(effect),
    );
    expect(encoded.codec).toBe(TASK_REQUESTED_EFFECT_PERSISTED_JSON_CODEC_V1);
    expect(encoded.effect.sequence).toBe("1");
    expect(Result.getOrThrow(
      decodePersistedTaskRequestedEffectJsonV1(encoded),
    )).toEqual(effect);
  });

  it("fails closed on unsupported versions, envelope keys, and malformed domain payloads", () => {
    const encoded = Result.getOrThrow(
      encodePersistedTaskRunAttemptAggregateJsonV1(succeededAggregateWithResult()),
    );
    expect(codecFailure(decodePersistedTaskRunAttemptAggregateJsonV1({
      ...encoded,
      codec: "flarex.task-run-attempt-persisted-json.v2",
    })).issue).toEqual({
      kind: "unsupported_codec",
      observed: "flarex.task-run-attempt-persisted-json.v2",
    });
    expect(codecFailure(decodePersistedTaskRunAttemptAggregateJsonV1({
      ...encoded,
      extra: true,
    })).issue.kind).toBe("invalid_envelope");
    expect(codecFailure(decodePersistedTaskRunAttemptAggregateJsonV1({
      codec: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
      aggregate: { phase: "future" },
    })).issue.kind).toBe("domain_value_invalid");
  });

  it("rejects malformed, padded, and misplaced byte wrappers", () => {
    const encoded = Result.getOrThrow(
      encodePersistedTaskRunAttemptAggregateJsonV1(succeededAggregateWithResult()),
    );
    const malformed = structuredClone(encoded);
    const malformedWrapper = findByteWrapper(malformed.aggregate);
    if (malformedWrapper === null) throw new Error("missing encoded byte wrapper");
    malformedWrapper[TASK_PERSISTED_UINT8ARRAY_TAG_V1] = "not-base64url";
    expect(codecFailure(
      decodePersistedTaskRunAttemptAggregateJsonV1(malformed),
    ).issue.kind).toBe("invalid_byte_encoding");

    const padded = structuredClone(encoded);
    const paddedWrapper = findByteWrapper(padded.aggregate);
    if (paddedWrapper === null ||
      typeof paddedWrapper[TASK_PERSISTED_UINT8ARRAY_TAG_V1] !== "string") {
      throw new Error("missing encoded byte spelling");
    }
    paddedWrapper[TASK_PERSISTED_UINT8ARRAY_TAG_V1] =
      `${paddedWrapper[TASK_PERSISTED_UINT8ARRAY_TAG_V1]}=`;
    expect(codecFailure(
      decodePersistedTaskRunAttemptAggregateJsonV1(padded),
    ).issue.kind).toBe("invalid_byte_encoding");

    const misplaced = structuredClone(Result.getOrThrow(
      encodePersistedTaskRequestedEffectJsonV1(notifyCurrentStateEffect()),
    ));
    const misplacedEffect: Record<string, unknown> = { ...misplaced.effect };
    misplacedEffect.sequence = {
      [TASK_PERSISTED_UINT8ARRAY_TAG_V1]:
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    expect(codecFailure(
      decodePersistedTaskRequestedEffectJsonV1({
        ...misplaced,
        effect: misplacedEffect,
      }),
    ).issue.kind).toBe("invalid_extended_json_tag");
  });

  it("rejects hostile JSON shapes before domain decoding", () => {
    const cyclicAggregate: Record<string, unknown> = {};
    cyclicAggregate.self = cyclicAggregate;
    expect(codecFailure(decodePersistedTaskRunAttemptAggregateJsonV1({
      codec: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
      aggregate: cyclicAggregate,
    })).issue.kind).toBe("invalid_envelope");

    const accessorAggregate: Record<string, unknown> = {};
    Object.defineProperty(accessorAggregate, "phase", {
      enumerable: true,
      get: () => {
        throw new Error("getter must not run");
      },
    });
    expect(codecFailure(decodePersistedTaskRunAttemptAggregateJsonV1({
      codec: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
      aggregate: accessorAggregate,
    })).issue.kind).toBe("invalid_envelope");

    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(codecFailure(decodePersistedTaskRunAttemptAggregateJsonV1({
      codec: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
      aggregate: { sparse },
    })).issue.kind).toBe("invalid_envelope");
    expect(codecFailure(decodePersistedTaskRunAttemptAggregateJsonV1({
      codec: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
      aggregate: { nonFinite: Number.POSITIVE_INFINITY },
    })).issue.kind).toBe("invalid_envelope");
    expect(codecFailure(decodePersistedTaskRunAttemptAggregateJsonV1({
      codec: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
      aggregate: { unsupported: new Date(0) },
    })).issue.kind).toBe("invalid_envelope");
  });

  it("captures stateful proxies once before measuring or domain decoding", () => {
    let aggregateReads = 0;
    const statefulEnvelope = new Proxy<Record<string, unknown>>({}, {
      ownKeys: () => ["codec", "aggregate"],
      getOwnPropertyDescriptor: (_target, key) => {
        if (key === "codec") {
          return {
            configurable: true,
            enumerable: true,
            value: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
            writable: true,
          };
        }
        aggregateReads += 1;
        if (aggregateReads > 1) throw new Error("payload was reread");
        return {
          configurable: true,
          enumerable: true,
          value: { phase: "future" },
          writable: true,
        };
      },
    });
    expect(codecFailure(
      decodePersistedTaskRunAttemptAggregateJsonV1(statefulEnvelope),
    ).issue.kind).toBe("domain_value_invalid");
    expect(aggregateReads).toBe(1);

    const oversizedEnvelope = new Proxy<Record<string, unknown>>({}, {
      ownKeys: () => ["codec", "aggregate"],
      getOwnPropertyDescriptor: (_target, key) => ({
        configurable: true,
        enumerable: true,
        value: key === "codec"
          ? TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1
          : { oversized: "x".repeat(MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1) },
        writable: true,
      }),
    });
    expect(codecFailure(
      decodePersistedTaskRunAttemptAggregateJsonV1(oversizedEnvelope),
    ).issue.kind).toBe("canonical_json_too_large");

    const throwingEnvelope = new Proxy<Record<string, unknown>>({}, {
      ownKeys: () => ["codec", "aggregate"],
      getOwnPropertyDescriptor: () => {
        throw new Error("hostile descriptor trap");
      },
    });
    expect(codecFailure(
      decodePersistedTaskRunAttemptAggregateJsonV1(throwingEnvelope),
    ).issue.kind).toBe("invalid_envelope");
  });

  it("rejects deeply nested objects and arrays through the typed boundary", () => {
    let nestedObject: unknown = "leaf";
    let nestedArray: unknown = "leaf";
    for (
      let depth = 0;
      depth < MAX_TASK_PERSISTED_JSON_NESTING_DEPTH_V1 + 1_000;
      depth += 1
    ) {
      nestedObject = { child: nestedObject };
      nestedArray = [nestedArray];
    }
    expect(codecFailure(decodePersistedTaskRunAttemptAggregateJsonV1({
      codec: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
      aggregate: { nestedObject },
    })).issue.kind).toBe("invalid_envelope");
    expect(codecFailure(decodePersistedTaskRunAttemptAggregateJsonV1({
      codec: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
      aggregate: { nestedArray },
    })).issue.kind).toBe("invalid_envelope");
  });

  it("enforces separate aggregate and effect canonical JSON ceilings", () => {
    const aggregateFailure = codecFailure(
      decodePersistedTaskRunAttemptAggregateJsonV1({
        codec: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
        aggregate: { oversized: "x".repeat(MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1) },
      }),
    );
    expect(aggregateFailure.issue).toMatchObject({
      kind: "canonical_json_too_large",
      maximumBytes: MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1,
    });

    const effectFailure = codecFailure(
      decodePersistedTaskRequestedEffectJsonV1({
        codec: TASK_REQUESTED_EFFECT_PERSISTED_JSON_CODEC_V1,
        effect: { oversized: "x".repeat(MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1) },
      }),
    );
    expect(effectFailure.issue).toMatchObject({
      kind: "canonical_json_too_large",
      maximumBytes: MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1,
    });

    const globallyOversizedEffect = codecFailure(
      decodePersistedTaskRequestedEffectJsonV1({
        codec: TASK_REQUESTED_EFFECT_PERSISTED_JSON_CODEC_V1,
        effect: {
          nested: Array.from({ length: 30_000 }, () => ({})),
        },
      }),
    );
    expect(globallyOversizedEffect.issue).toMatchObject({
      kind: "canonical_json_too_large",
      maximumBytes: MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1,
    });
  });

  it("rejects forged typed aggregate input through the existing domain Schema", () => {
    const forged = {
      ...executingAggregate(),
      runVersion: 0n,
    } as TaskRunAttemptAggregateV1;
    expect(codecFailure(
      encodePersistedTaskRunAttemptAggregateJsonV1(forged),
    ).issue.kind).toBe("domain_value_invalid");
  });
});
