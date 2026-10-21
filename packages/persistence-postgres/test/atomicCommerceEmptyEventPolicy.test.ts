import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { makeBoundedRequestLifetime } from "../src/execution/preparation/boundedRequestLifetime";
import { commerceError } from "../src/frameworks/commerceTransaction/model";
import { admitCommercePendingEventCancellation, admitParticipantEvents, captureAtomicCommerceEvents,
  consumeCommerceEvents, defineCommerceEventContract, makeAtomicEventCapture, prepareAdmittedCommerceEventIntents,
  prepareAtomicCommerceEvents, validateAdmittedCommerceEventIntents, validateAdmittedOperationEventIntents,
  type AtomicCommerceEvents, type CommerceEventContract } from "../src/frameworks/atomicCommerce/events";
import { commitEventLimits, type CommittedEvent } from "../src/commit/events/model";

const revision = "a".repeat(64), subscribers = [{ id: "empty-policy", revision }], group = "empty-policy-root";
const input = (): AtomicCommerceEvents => ({ producerRevision: revision, contracts: [], subscribers, validate: () => Effect.void });
const prepare = (definition: AtomicCommerceEvents = input()) =>
  Effect.fromResult(captureAtomicCommerceEvents(definition)).pipe(Effect.flatMap(prepareAtomicCommerceEvents));
const internal = () => defineCommerceEventContract({ name: "neutral.internal", revision, internal: true,
  decode: () => Effect.succeed(null) });
const lifetime = () => makeBoundedRequestLifetime(commerceError,
  { calls: 64, commandBytes: 65_536, commandMs: 10_000 }, {}, {}, "empty-policy", "read");
const refusal = (reason: string) => ({ _tag: "Failure", failure: { reason } });
const invalidInputs: [string, Partial<AtomicCommerceEvents>][] = [
  ["producer revision", { producerRevision: "invalid" }],
  ["missing subscribers", { subscribers: [] }],
  ["duplicate subscribers", { subscribers: [subscribers[0]!, subscribers[0]!] }],
  ["subscriber revision", { subscribers: [{ id: "empty-policy", revision: "invalid" }] }],
  ["subscriber ceiling", { subscribers: Array.from({ length: commitEventLimits.subscribers + 1 }, (_, index) => ({ id: `subscriber${index}`, revision })) }],
];

describe("closed empty atomic event policy", () => {
  it("retains the empty contract identity and original validator after capture", () => Effect.runPromise(Effect.gen(function* () {
    const tokens: CommerceEventContract[] = [];
    const definition = { ...input(), contracts: tokens };
    const captured = Result.getOrThrow(captureAtomicCommerceEvents(definition));
    tokens.push(internal());
    const policy = yield* prepareAtomicCommerceEvents(captured);
    expect(Object.isFrozen(captured.definitions)).toBe(true);
    expect(policy.allowed.size).toBe(0);
    expect(policy.validate).toBe(definition.validate);
    expect(policy.identity).toEqual({ producerRevision: revision, contracts: [], subscribers });
    const admitted = yield* prepare({ ...input(), contracts: tokens });
    expect(admitted.identity).not.toEqual(policy.identity);
  })));

  it("runs admission and the validator on an empty closure, then publishes no events exactly once", () => Effect.runPromise(Effect.gen(function* () {
    let validations = 0, admissions = 0;
    const policy = yield* prepare({ ...input(), validate: (events, calls) => Effect.sync(() => {
      validations++;
      expect(events).toEqual([]); expect(calls).toEqual([]);
      expect(Object.isFrozen(events)).toBe(true); expect(Object.isFrozen(calls)).toBe(true);
    }) });
    const owner = yield* lifetime();
    return yield* Effect.gen(function* () {
      const capture = makeAtomicEventCapture(Effect.sync(() => { admissions++; }), owner, group, policy, 4);
      yield* owner.seal;
      const closure = yield* capture.close([]);
      expect(validations).toBe(1); expect(admissions).toBe(1);
      const publication = yield* consumeCommerceEvents(closure, owner);
      expect(publication).toEqual({ values: [], ordinals: [], capturedCount: 0, sha256: null });
      expect(admissions).toBe(2);
      expect(yield* Effect.result(consumeCommerceEvents(closure, owner))).toMatchObject(refusal("invalidAuthority"));
      expect(yield* Effect.result(capture.close([]))).toMatchObject(refusal("invalidAuthority"));
      expect(validations).toBe(1);
    }).pipe(Effect.ensuring(owner.close));
  })));

  it("preserves a failing validator even when no event was captured", () => Effect.runPromise(Effect.gen(function* () {
    let validations = 0;
    const denied = commerceError("invalidInput");
    const policy = yield* prepare({ ...input(), validate: () => Effect.sync(() => { validations++; }).pipe(Effect.andThen(Effect.fail(denied))) });
    const owner = yield* lifetime();
    return yield* Effect.gen(function* () {
      const capture = makeAtomicEventCapture(Effect.void, owner, group, policy, 4);
      yield* owner.seal;
      const outcome = yield* Effect.result(capture.close([]));
      expect(outcome).toMatchObject(refusal("invalidInput"));
      if (Result.isFailure(outcome)) expect(outcome.failure).toBe(denied);
      expect(validations).toBe(1);
    }).pipe(Effect.ensuring(owner.close));
  })));

  it("admits an empty selected family but refuses native messages and persisted event intents", () => Effect.runPromise(Effect.gen(function* () {
    let selections = 0;
    const token = internal(), policy = yield* prepare();
    const selection = { contracts: [], select: () => Effect.sync(() => { selections++; return token; }) };
    expect(Result.getOrThrow(admitParticipantEvents(selection, policy))).toEqual([]);
    expect(yield* prepareAdmittedCommerceEventIntents(policy, selection, [], group)).toEqual([]);
    expect(selections).toBe(0);
    expect(yield* Effect.result(prepareAdmittedCommerceEventIntents(policy, selection, [null], group)))
      .toMatchObject(refusal("unadmittedEvent"));
    expect(selections).toBe(1);
    const event: CommittedEvent = { contract: "neutral.internal", contractRevision: revision,
      producerRevision: revision, internal: true, group, message: null, subscribers };
    for (const validate of [validateAdmittedCommerceEventIntents, validateAdmittedOperationEventIntents]) {
      yield* validate(policy, selection, [], group);
      expect(yield* Effect.result(validate(policy, selection, [event], group))).toMatchObject(refusal("unadmittedEvent"));
    }
    expect(admitParticipantEvents({ contracts: [token], select: () => Effect.succeed(token) }, policy))
      .toMatchObject(refusal("invalidAuthority"));
  })));

  it("grants no direct, selected, queued or cancellation rights to registered or forged tokens", () => Effect.runPromise(Effect.gen(function* () {
    const policy = yield* prepare(), owner = yield* lifetime();
    const registered = internal();
    // An intentionally unregistered lookalike tests registry authority at the boundary.
    const forged = Object.freeze({}) as CommerceEventContract;
    expect(yield* Effect.result(prepare({ ...input(), contracts: [forged] }))).toMatchObject(refusal("invalidAuthority"));
    return yield* Effect.gen(function* () {
      const capture = makeAtomicEventCapture(Effect.void, owner, group, policy, 4);
      const remaining = owner.remainingBytes();
      for (const token of [registered, forged]) {
        expect(yield* Effect.result(capture.capture(token, null))).toMatchObject(refusal("unadmittedEvent"));
        expect(yield* Effect.result(capture.capturePrecharged(token, null, 4))).toMatchObject(refusal("unadmittedEvent"));
        expect(yield* Effect.result(capture.captureSelected({ contracts: [token], select: () => Effect.succeed(token) }, null)))
          .toMatchObject(refusal("unadmittedEvent"));
        expect(admitCommercePendingEventCancellation(policy, token)).toMatchObject(refusal("unadmittedEvent"));
        expect(yield* Effect.result(capture.clearPending(token))).toMatchObject(refusal("unadmittedEvent"));
      }
      expect(owner.remainingBytes()).toBe(remaining);
    }).pipe(Effect.ensuring(owner.close));
  })));

  it("still requires closing lifetime and admission before invoking an empty-policy validator", () => Effect.runPromise(Effect.gen(function* () {
    let validations = 0;
    const policy = yield* prepare({ ...input(), validate: () => Effect.sync(() => { validations++; }) });
    const owner = yield* lifetime();
    return yield* Effect.gen(function* () {
      const capture = makeAtomicEventCapture(Effect.fail(commerceError("invalidAuthority")), owner, group, policy, 4);
      expect(yield* Effect.result(capture.close([]))).toMatchObject(refusal("invalidAuthority"));
      yield* owner.seal;
      expect(yield* Effect.result(capture.close([]))).toMatchObject(refusal("invalidAuthority"));
      expect(validations).toBe(0);
    }).pipe(Effect.ensuring(owner.close));
  })));

  it.each(invalidInputs)("keeps %s validation for an empty contract set", (_name, invalid) => Effect.runPromise(Effect.gen(function* () {
    expect(yield* Effect.result(prepare({ ...input(), ...invalid }))).toMatchObject(refusal("invalidAuthority"));
  })));

  it("keeps the contract ceiling at both capture and preparation", () => Effect.runPromise(Effect.gen(function* () {
    const token = internal();
    expect(captureAtomicCommerceEvents({ ...input(), contracts: Array.from({ length: commitEventLimits.messages + 1 }, () => token) }))
      .toMatchObject(refusal("invalidAuthority"));
    const captured = Result.getOrThrow(captureAtomicCommerceEvents({ ...input(), contracts: [token] }));
    expect(yield* Effect.result(prepareAtomicCommerceEvents({ ...captured,
      definitions: Array.from({ length: commitEventLimits.messages + 1 }, () => captured.definitions).flat() })))
      .toMatchObject(refusal("invalidAuthority"));
  })));
});
