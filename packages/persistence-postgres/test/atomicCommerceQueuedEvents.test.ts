import { describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import type { Json } from "flarex-protocol/json";
import { makeBoundedRequestLifetime } from "../src/execution/preparation/boundedRequestLifetime";
import { capturePrivateJsonData } from "../src/values/privateJsonData";
import { commerceError } from "../src/frameworks/commerceTransaction/model";
import { captureAtomicCommerceEvents, defineCommerceEventContract, makeAtomicEventCapture, prepareAtomicCommerceEvents } from "../src/frameworks/atomicCommerce/events";
import { commitEventLimits, type CommittedEvent } from "../src/commit/events/model";

const name = "queued-event-accounting";
const revision = "a".repeat(64), producerRevision = "b".repeat(64);
const subscribers = [{ id: "queued-event-subscriber", revision: "c".repeat(64) }];
const group = "queued-event-group";
const expectedEnvelope = (message: Json): CommittedEvent => ({ contract: name, contractRevision: revision,
  producerRevision, internal: false, group, message, subscribers });
const bytes = (value: unknown) => Result.getOrThrow(capturePrivateJsonData(value, 1_048_576, commerceError)).bytes;
const decodeMessage = Schema.decodeUnknownEffect(Schema.Struct({ text: Schema.String }), { onExcessProperty: "ignore" });

const prepare = Effect.fn(function* (maximumBytes: number) {
  let retained: readonly CommittedEvent[] = [];
  const contract = defineCommerceEventContract({ name, revision, internal: false,
    decode: value => decodeMessage(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause))),
  });
  const policy = yield* prepareAtomicCommerceEvents(yield* Effect.fromResult(captureAtomicCommerceEvents({
    producerRevision, contracts: [contract], subscribers,
    validate: events => Effect.sync(() => { retained = events; }),
  })));
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 64, commandBytes: maximumBytes, commandMs: 10_000 }, {}, {}, "queued-event-accounting", "write");
  const capture = makeAtomicEventCapture(Effect.void, lifetime, group, policy, 4);
  const close = Effect.gen(function* () {
    yield* lifetime.seal;
    yield* capture.close([]);
    return retained;
  });
  return { contract, lifetime, capture, close };
});

describe("queued atomic event byte credits", () => {
  it("credits the prepaid input while capturing an envelope that exactly fills the request budget", () => Effect.runPromise(Effect.gen(function* () {
    const input = { text: "x".repeat(600) }, envelope = expectedEnvelope(input);
    const rawBytes = bytes(input), envelopeBytes = bytes(envelope);
    const owner = yield* prepare(envelopeBytes);
    return yield* Effect.gen(function* () {
      const raw = yield* Effect.fromResult(capturePrivateJsonData(input, commitEventLimits.bytes, commerceError));
      yield* Effect.fromResult(owner.lifetime.charge(raw.bytes));
      expect(raw.bytes).toBe(rawBytes);
      expect(owner.lifetime.remainingBytes()).toBe(envelopeBytes - rawBytes);
      expect(owner.lifetime.remainingBytes()).toBeLessThan(envelopeBytes);
      expect(yield* owner.capture.capturePrecharged(owner.contract, raw.value, raw.bytes)).toEqual(input);
      expect(owner.lifetime.remainingBytes()).toBe(0);
      expect(yield* owner.close).toEqual([envelope]);
    }).pipe(Effect.ensuring(owner.lifetime.close));
  })));

  it("still refuses an envelope one byte beyond the request ceiling", () => Effect.runPromise(Effect.gen(function* () {
    const input = { text: "x".repeat(600) };
    const owner = yield* prepare(bytes(expectedEnvelope(input)) - 1);
    return yield* Effect.gen(function* () {
      const raw = yield* Effect.fromResult(capturePrivateJsonData(input, commitEventLimits.bytes, commerceError));
      yield* Effect.fromResult(owner.lifetime.charge(raw.bytes));
      expect(yield* Effect.result(owner.capture.capturePrecharged(owner.contract, raw.value, raw.bytes)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    }).pipe(Effect.ensuring(owner.lifetime.close));
  })));

  it("keeps monotone max(raw, envelope) accounting when the actual decoder shrinks a prepaid message", () => Effect.runPromise(Effect.gen(function* () {
    const input = { text: "kept", discarded: "x".repeat(4096) }, decoded = { text: "kept" };
    const rawBytes = bytes(input), envelopeBytes = bytes(expectedEnvelope(decoded));
    expect(rawBytes).toBeGreaterThan(envelopeBytes);
    const owner = yield* prepare(rawBytes);
    return yield* Effect.gen(function* () {
      const raw = yield* Effect.fromResult(capturePrivateJsonData(input, commitEventLimits.bytes, commerceError));
      yield* Effect.fromResult(owner.lifetime.charge(raw.bytes));
      expect(owner.lifetime.remainingBytes()).toBe(0);
      expect(yield* owner.capture.capturePrecharged(owner.contract, raw.value, raw.bytes)).toEqual(decoded);
      expect(owner.lifetime.remainingBytes()).toBe(rawBytes - Math.max(rawBytes, envelopeBytes));
      const retained = yield* owner.close;
      expect(retained).toEqual([expectedEnvelope(decoded)]);
      expect(Object.isFrozen(retained[0])).toBe(true);
      expect(retained[0]?.message).not.toHaveProperty("discarded");
    }).pipe(Effect.ensuring(owner.lifetime.close));
  })));

  it("keeps ordinary capture charging only the final decoded envelope", () => Effect.runPromise(Effect.gen(function* () {
    const input = { text: "kept", discarded: "x".repeat(4096) }, decoded = { text: "kept" };
    const rawBytes = bytes(input), envelopeBytes = bytes(expectedEnvelope(decoded));
    const owner = yield* prepare(rawBytes);
    return yield* Effect.gen(function* () {
      expect(yield* owner.capture.capture(owner.contract, input)).toEqual(decoded);
      expect(owner.lifetime.remainingBytes()).toBe(rawBytes - envelopeBytes);
      expect(yield* owner.close).toEqual([expectedEnvelope(decoded)]);
    }).pipe(Effect.ensuring(owner.lifetime.close));
  })));
});
