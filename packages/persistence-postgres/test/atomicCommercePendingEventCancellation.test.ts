import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { makeBoundedRequestLifetime } from "../src/execution/preparation/boundedRequestLifetime";
import { commerceError, type CommerceTransactionError } from "../src/frameworks/commerceTransaction/model";
import { captureAtomicCommerceEvents, defineCommerceEventContract, defineCommerceDerivedIdEventContract,
  makeAtomicEventCapture, prepareAtomicCommerceEvents, consumeCommerceEvents, appendDerivedCommerceIdEvents,
  type CommerceEventContract } from "../src/frameworks/atomicCommerce/events";
import type { CommittedEvent } from "../src/commit/events/model";
import { commitEventLimits } from "../src/commit/events/model";

const revision = "a".repeat(64), subscribers = [{ id: "pending-intents", revision }];
const cancellable = () => defineCommerceEventContract({ name: "pending.created", revision, internal: false, pendingCancellation: true,
  decode: input => input === null ? Effect.succeed(null) : Effect.fail(commerceError("unadmittedEvent")) });
const ordinary = (name: string, internal: boolean) => defineCommerceEventContract({ name, revision, internal,
  decode: input => input === null ? Effect.succeed(null) : Effect.fail(commerceError("unadmittedEvent")) });
const prepare = (contracts: readonly CommerceEventContract[], validate: (events: readonly CommittedEvent[]) => Effect.Effect<void, CommerceTransactionError> = () => Effect.void,
  derivedIdValidation?: "capturedOnly") => prepareAtomicCommerceEvents(Result.getOrThrow(captureAtomicCommerceEvents({
    producerRevision: revision, contracts, subscribers, validate,
    ...(derivedIdValidation === undefined ? {} : { derivedIdValidation }),
  })));
const fixture = Effect.fn(function* (maximum = 8) {
  const cancel = cancellable(), internal = ordinary("pending.module", true), sibling = ordinary("pending.other", false);
  let observed: readonly CommittedEvent[] = [];
  const policy = yield* prepare([cancel, internal, sibling], events => Effect.sync(() => { observed = events; }));
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 64, commandBytes: 65_536, commandMs: 10_000 }, {}, {}, "pending-cancellation", "write");
  const capture = makeAtomicEventCapture(Effect.void, lifetime, "current-root", policy, maximum);
  const close = Effect.gen(function* () {
    yield* lifetime.seal;
    const closure = yield* capture.close([]);
    const publication = yield* consumeCommerceEvents(closure, lifetime);
    return { publication, observed };
  });
  return { cancel, internal, sibling, policy, lifetime, capture, close };
});

describe("atomic pending external event cancellation", () => {
  it("pins cancellation authority only when selected and refuses internal cancellation contracts", () => Effect.runPromise(Effect.gen(function* () {
    const plain = ordinary("pending.created", false), selected = cancellable();
    const before = yield* prepare([plain]), after = yield* prepare([selected]);
    expect(before.identity).toEqual({ producerRevision: revision, contracts: [{ name: "pending.created", revision, internal: false }], subscribers });
    expect(after.identity).toEqual({ producerRevision: revision,
      contracts: [{ name: "pending.created", revision, internal: false, pendingCancellation: true }], subscribers });
    const invalid = defineCommerceEventContract({ name: "pending.internal", revision, internal: true, pendingCancellation: true,
      decode: () => Effect.succeed(null) });
    expect(yield* Effect.result(prepare([invalid]))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  })));

  it("cancels prior matching intents, preserves facts and sibling contracts, and retains future emissions", () => Effect.runPromise(Effect.gen(function* () {
    const owner = yield* fixture();
    return yield* Effect.gen(function* () {
      yield* owner.capture.capture(owner.cancel, null);
      yield* owner.capture.capture(owner.internal, null);
      yield* owner.capture.capture(owner.sibling, null);
      const charged = owner.lifetime.remainingBytes();
      yield* owner.capture.clearPending(owner.cancel);
      expect(owner.lifetime.remainingBytes()).toBe(charged);
      yield* owner.capture.capture(owner.cancel, null);
      const { publication, observed } = yield* owner.close;
      expect(observed.map(event => event.contract)).toEqual(["pending.created", "pending.module", "pending.other", "pending.created"]);
      expect(publication.values.map(event => event.contract)).toEqual(["pending.module", "pending.other", "pending.created"]);
      expect(publication.ordinals).toEqual([1, 2, 3]); expect(publication.capturedCount).toBe(4);
      expect(publication.values.every(event => event.group === "current-root")).toBe(true);
      expect(publication.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(yield* Effect.result(owner.capture.clearPending(owner.cancel))).toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
    }).pipe(Effect.ensuring(owner.lifetime.close));
  })));

  it("keeps complete validation history even when every publishable intent was canceled", () => Effect.runPromise(Effect.gen(function* () {
    const owner = yield* fixture();
    return yield* Effect.gen(function* () {
      yield* owner.capture.capture(owner.cancel, null); yield* owner.capture.clearPending(owner.cancel);
      const { publication, observed } = yield* owner.close;
      expect(observed).toHaveLength(1); expect(publication).toEqual({ values: [], ordinals: [], capturedCount: 1, sha256: null });
    }).pipe(Effect.ensuring(owner.lifetime.close));
  })));

  it("cannot clear by an unadmitted lookalike token or an ordinary/internal contract", () => Effect.runPromise(Effect.gen(function* () {
    const owner = yield* fixture();
    return yield* Effect.gen(function* () {
      yield* owner.capture.capture(owner.cancel, null);
      for (const token of [cancellable(), owner.internal, owner.sibling]) expect(yield* Effect.result(owner.capture.clearPending(token)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
      expect((yield* owner.close).publication.values).toHaveLength(1);
    }).pipe(Effect.ensuring(owner.lifetime.close));
  })));

  it("keeps canceled messages charged against the original message ceiling", () => Effect.runPromise(Effect.gen(function* () {
    const owner = yield* fixture(1);
    return yield* Effect.gen(function* () {
      yield* owner.capture.capture(owner.cancel, null); const charged = owner.lifetime.remainingBytes();
      yield* owner.capture.clearPending(owner.cancel); yield* owner.capture.clearPending(owner.cancel);
      expect(owner.lifetime.remainingBytes()).toBe(charged);
      expect(yield* Effect.result(owner.capture.capture(owner.cancel, null))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    }).pipe(Effect.ensuring(owner.lifetime.close));
  })));

  it("counts canceled captured envelopes when applying the later derived-ID append ceiling", () => Effect.runPromise(Effect.gen(function* () {
    const cancel = cancellable();
    const derived = yield* Effect.fromResult(defineCommerceDerivedIdEventContract({ name: "pending.derived", revision, internal: true,
      metadata: { source: "neutral", object: "record", action: "updated" } }));
    const policy = yield* prepare([cancel, derived], () => Effect.void, "capturedOnly");
    const lifetime = yield* makeBoundedRequestLifetime(commerceError,
      { calls: 64, commandBytes: 65_536, commandMs: 10_000 }, {}, {}, "pending-derived", "write");
    const capture = makeAtomicEventCapture(Effect.void, lifetime, "current-root", policy, 1);
    return yield* Effect.gen(function* () {
      yield* capture.capture(cancel, null); yield* capture.clearPending(cancel); yield* lifetime.seal;
      const closure = yield* capture.close([], { contract: derived });
      expect(yield* Effect.result(appendDerivedCommerceIdEvents(closure, lifetime, ["derived-row"])))
        .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    }).pipe(Effect.ensuring(lifetime.close));
  })));

  it("retains the aggregate canonical byte ceiling after all earlier event history is canceled", () => Effect.runPromise(Effect.gen(function* () {
    const cancel = defineCommerceEventContract({ name: "pending.large", revision, internal: false, pendingCancellation: true,
      decode: input => typeof input === "string" ? Effect.succeed(input) : Effect.fail(commerceError("unadmittedEvent")) });
    const policy = yield* prepare([cancel]);
    const lifetime = yield* makeBoundedRequestLifetime(commerceError,
      { calls: 1024, commandBytes: 16_777_216, commandMs: 30_000 }, {}, {}, "pending-large", "write");
    const capture = makeAtomicEventCapture(Effect.void, lifetime, "current-root", policy, 256);
    return yield* Effect.gen(function* () {
      const payload = "x".repeat(64_000);
      const result = yield* Effect.exit(Effect.gen(function* () {
        for (let index = 0; index < 132; index++) {
          yield* capture.capture(cancel, payload);
          yield* capture.clearPending(cancel);
        }
        yield* lifetime.seal;
        return yield* consumeCommerceEvents(yield* capture.close([]), lifetime);
      }));
      if (Exit.isSuccess(result)) throw new Error("Canceled event history escaped the aggregate byte ceiling");
      expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded")).toBe(true);
      expect(16_777_216 - lifetime.remainingBytes()).toBeGreaterThan(commitEventLimits.totalBytes);
    }).pipe(Effect.ensuring(lifetime.close));
  })));

  it("places derived events after all original capture ordinals, including canceled history", () => Effect.runPromise(Effect.gen(function* () {
    const cancel = cancellable(), internal = ordinary("pending.module", true);
    const derived = yield* Effect.fromResult(defineCommerceDerivedIdEventContract({ name: "pending.derived", revision, internal: true,
      metadata: { source: "neutral", object: "record", action: "updated" } }));
    const policy = yield* prepare([cancel, internal, derived], () => Effect.void, "capturedOnly");
    const lifetime = yield* makeBoundedRequestLifetime(commerceError,
      { calls: 64, commandBytes: 65_536, commandMs: 10_000 }, {}, {}, "pending-derived-success", "write");
    const capture = makeAtomicEventCapture(Effect.void, lifetime, "current-root", policy, 5);
    return yield* Effect.gen(function* () {
      yield* capture.capture(cancel, null); yield* capture.capture(internal, null);
      yield* capture.clearPending(cancel); yield* capture.capture(cancel, null);
      yield* lifetime.seal;
      const closure = yield* capture.close([], { contract: derived });
      yield* appendDerivedCommerceIdEvents(closure, lifetime, ["derived-first", "derived-second"]);
      const result = yield* consumeCommerceEvents(closure, lifetime);
      expect(result.values.map(event => event.contract)).toEqual(["pending.module", "pending.created", "pending.derived", "pending.derived"]);
      expect(result.ordinals).toEqual([1, 2, 3, 4]); expect(result.capturedCount).toBe(5);
      expect(result.values.slice(2).map(event => event.message)).toEqual([
        { name: "pending.derived", metadata: { source: "neutral", object: "record", action: "updated" }, data: { id: "derived-first" } },
        { name: "pending.derived", metadata: { source: "neutral", object: "record", action: "updated" }, data: { id: "derived-second" } },
      ]);
    }).pipe(Effect.ensuring(lifetime.close));
  })));

  it("includes canceled original byte admission when appending otherwise bounded derived events", () => Effect.runPromise(Effect.gen(function* () {
    const cancel = defineCommerceEventContract({ name: "pending.large", revision, internal: false, pendingCancellation: true,
      decode: input => typeof input === "string" ? Effect.succeed(input) : Effect.fail(commerceError("unadmittedEvent")) });
    const derived = yield* Effect.fromResult(defineCommerceDerivedIdEventContract({ name: "pending.derived", revision, internal: true,
      metadata: { source: "neutral", object: "record", action: "updated" } }));
    const policy = yield* prepare([cancel, derived], () => Effect.void, "capturedOnly");
    const lifetime = yield* makeBoundedRequestLifetime(commerceError,
      { calls: 1024, commandBytes: 16_777_216, commandMs: 30_000 }, {}, {}, "pending-large-derived", "write");
    const capture = makeAtomicEventCapture(Effect.void, lifetime, "current-root", policy, 512);
    return yield* Effect.gen(function* () {
      for (let index = 0; index < 130; index++) yield* capture.capture(cancel, "x".repeat(64_000));
      yield* capture.clearPending(cancel); yield* lifetime.seal;
      const closure = yield* capture.close([], { contract: derived });
      const ids = Array.from({ length: 256 }, (_, index) => ("derived-" + index).padEnd(256, "x"));
      expect(yield* Effect.result(appendDerivedCommerceIdEvents(closure, lifetime, ids)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
      expect(16_777_216 - lifetime.remainingBytes()).toBeGreaterThan(commitEventLimits.totalBytes);
    }).pipe(Effect.ensuring(lifetime.close));
  })));

  it("preserves failed validation of canceled history", () => Effect.runPromise(Effect.gen(function* () {
    const cancel = cancellable(), policy = yield* prepare([cancel], () => Effect.fail(commerceError("receiptMismatch")));
    const lifetime = yield* makeBoundedRequestLifetime(commerceError,
      { calls: 64, commandBytes: 65_536, commandMs: 10_000 }, {}, {}, "pending-validation", "write");
    const capture = makeAtomicEventCapture(Effect.void, lifetime, "current-root", policy, 4);
    return yield* Effect.gen(function* () {
      yield* capture.capture(cancel, null); yield* capture.clearPending(cancel); yield* lifetime.seal;
      expect(yield* Effect.result(capture.close([]))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    }).pipe(Effect.ensuring(lifetime.close));
  })));
});
