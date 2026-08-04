import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  ExecutionEvidenceBodyCorruptionV1Error,
  ExecutionEvidenceBodyInputV1Error,
  ExecutionEvidenceBodyNotFoundV1Error,
  makeExecutionEvidenceBodyStoreV1,
  type ExecutionEvidenceBodyR2BucketV1,
} from "../src/executionEvidence/ExecutionEvidenceBodyStoreV1";

class MemoryBucket implements ExecutionEvidenceBodyR2BucketV1 {
  readonly bodies = new Map<string, Uint8Array>();

  put(key: string, value: ArrayBuffer): PromiseLike<unknown> {
    if (this.bodies.has(key)) return Promise.reject(new Error("precondition"));
    this.bodies.set(key, new Uint8Array(value.slice(0)));
    return Promise.resolve({});
  }

  get(key: string): PromiseLike<unknown> {
    const bytes = this.bodies.get(key);
    if (bytes === undefined) return Promise.resolve(null);
    const snapshot = bytes.slice();
    return Promise.resolve({
      size: snapshot.byteLength,
      arrayBuffer: () => Promise.resolve(snapshot.buffer.slice(0)),
    });
  }
}

const budget = Object.freeze({ maximumBodyBytes: 1_024, maximumHashBytes: 1_024 });

function store(bucket = new MemoryBucket()) {
  return {
    bucket,
    store: makeExecutionEvidenceBodyStoreV1(
      bucket,
      {
        hash: bytes => Effect.promise(async () => {
          const input = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(input).set(bytes);
          return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
        }),
      },
      {
        verify: (_kind, bytes) =>
          bytes[0] === 0x7b ? Effect.void : Effect.fail("noncanonical"),
      },
    ),
  };
}

describe("AAV-A1 execution evidence R2 body store", () => {
  it("publishes, cold-reads, verifies, and exactly replays immutable bodies", async () => {
    const fixture = store();
    const body = new TextEncoder().encode('{"value":1}');
    const first = await Effect.runPromise(
      fixture.store.putImmutable("action_arguments", body, budget),
    );
    body.fill(0);
    const cold = await Effect.runPromise(
      fixture.store.readImmutable(first, budget),
    );
    expect(new TextDecoder().decode(cold.bytes)).toBe('{"value":1}');
    const replay = await Effect.runPromise(
      fixture.store.putImmutable(
        "action_arguments",
        new TextEncoder().encode('{"value":1}'),
        budget,
      ),
    );
    expect(replay.objectKey).toBe(first.objectKey);
    expect(fixture.bucket.bodies.size).toBe(1);
  });

  it("fails closed for missing, corrupt, noncanonical, and over-budget bodies", async () => {
    const fixture = store();
    const reference = await Effect.runPromise(
      fixture.store.putImmutable(
        "outbound_http_request",
        new TextEncoder().encode('{"method":"POST"}'),
        budget,
      ),
    );
    fixture.bucket.bodies.delete(reference.objectKey);
    await expect(Effect.runPromise(fixture.store.readImmutable(reference, budget)))
      .rejects.toBeInstanceOf(ExecutionEvidenceBodyNotFoundV1Error);

    await expect(Effect.runPromise(fixture.store.putImmutable(
      "action_result",
      new Uint8Array([1, 2, 3]),
      budget,
    ))).rejects.toBe("noncanonical");

    await expect(Effect.runPromise(fixture.store.putImmutable(
      "action_result",
      new TextEncoder().encode('{"tooLarge":true}'),
      { maximumBodyBytes: 2, maximumHashBytes: 2 },
    ))).rejects.toBeInstanceOf(ExecutionEvidenceBodyInputV1Error);

    const stored = await Effect.runPromise(fixture.store.putImmutable(
      "action_result",
      new TextEncoder().encode('{"ok":true}'),
      budget,
    ));
    fixture.bucket.bodies.set(
      stored.objectKey,
      new TextEncoder().encode('{"ok":false}'),
    );
    await expect(Effect.runPromise(fixture.store.readImmutable(stored, budget)))
      .rejects.toBeInstanceOf(ExecutionEvidenceBodyCorruptionV1Error);
  });

  it("rejects reference identity and codec mismatches before R2 access", async () => {
    const fixture = store();
    const reference = await Effect.runPromise(fixture.store.putImmutable(
      "outbound_http_response",
      new TextEncoder().encode('{"status":200}'),
      budget,
    ));
    await expect(Effect.runPromise(fixture.store.readImmutable({
      ...reference,
      codecIdentity: "flarex.codec/canonical-http-request/v1",
    }, budget))).rejects.toBeInstanceOf(ExecutionEvidenceBodyInputV1Error);
  });
});
