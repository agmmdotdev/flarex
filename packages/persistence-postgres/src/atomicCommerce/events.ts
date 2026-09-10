import { Effect, Result, Schema } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import type { Json } from "flarex-protocol/json";
import type { CommerceCommand } from "../commerceTransaction/commands";
import type { AtomicCommerceParticipant } from "./commands";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import { capturePrivateJsonData } from "../privateJsonData";
import { commitEventLimits, EventEnvelope, EventName, EventRevision, EventSubscriber, type CommittedEvent, type CommitEventSubscriber } from "../commitEvents/model";
import { requireCommerceAdmission, type CommerceAdmission } from "../commerceTransaction/admission";
import type { BoundedRequestLifetime } from "../boundedRequestLifetime";
import { commitEventsDigest } from "../commitEvents/digest";

declare const contractBrand: unique symbol;
export interface CommerceEventContract { readonly [contractBrand]: true }
export interface ParticipantEventSelection {
  readonly contracts: readonly CommerceEventContract[];
  readonly select: (message: Json) => Effect.Effect<CommerceEventContract, CommerceTransactionError>;
}
/** Capture before participant preparation can suspend. Tokens remain opaque;
 * global admission authenticates them after the complete policy is prepared. */
export function captureParticipantEvents(input: ParticipantEventSelection | undefined): Result.Result<ParticipantEventSelection | undefined, CommerceTransactionError> {
  if (input === undefined) return Result.succeed(undefined);
  if (input === null || typeof input !== "object") return Result.fail(commerceError("invalidAuthority"));
  const list = Object.getOwnPropertyDescriptor(input, "contracts");
  const selector = Object.getOwnPropertyDescriptor(input, "select");
  if (list === undefined || !("value" in list) || !Array.isArray(list.value) || list.value.length > commitEventLimits.messages
    || selector === undefined || !("value" in selector) || typeof selector.value !== "function") return Result.fail(commerceError("invalidAuthority"));
  const captured: CommerceEventContract[] = [];
  for (let index = 0; index < list.value.length; index++) {
    const item = Object.getOwnPropertyDescriptor(list.value, index);
    const token: unknown = item !== undefined && "value" in item ? item.value : undefined;
    if (!isEventContract(token) || captured.includes(token)) return Result.fail(commerceError("invalidAuthority"));
    captured.push(token);
  }
  // SAFETY: the callable boundary is supplied by a trusted adapter. Runtime
  // selection still independently authenticates its returned token.
  const select = selector.value as ParticipantEventSelection["select"];
  return Result.succeed(Object.freeze({ contracts: Object.freeze(captured), select }));
}
interface EventContract {
  readonly name: string;
  readonly revision: string;
  readonly internal: boolean;
  readonly decode: (value: unknown) => Effect.Effect<Json, CommerceTransactionError>;
}
const contracts = new WeakMap<object, EventContract>();
const isEventContract = (value: unknown): value is CommerceEventContract => typeof value === "object" && value !== null && contracts.has(value);
/** Trusted definitions describe semantics; only explicit host admission authorizes capture. */
export function defineCommerceEventContract(definition: EventContract): CommerceEventContract {
  // SAFETY: the registry, not the brand, authenticates a definition.
  const token = Object.freeze({}) as CommerceEventContract;
  contracts.set(token, Object.freeze({ ...definition }));
  return token;
}
export interface AtomicCommerceCallObservation {
  readonly participant: AtomicCommerceParticipant;
  readonly command: CommerceCommand;
  readonly input: Json;
  readonly result: Json;
}
export interface AtomicCommerceEvents {
  readonly producerRevision: string;
  readonly contracts: readonly CommerceEventContract[];
  readonly subscribers: readonly CommitEventSubscriber[];
  readonly validate: (events: readonly CommittedEvent[], calls: readonly AtomicCommerceCallObservation[]) => Effect.Effect<void, CommerceTransactionError>;
}
const decodeName = Schema.decodeUnknownEffect(EventName);
const decodeRevision = Schema.decodeUnknownEffect(EventRevision);
const decodeSubscribers = Schema.decodeUnknownEffect(Schema.Array(EventSubscriber).check(Schema.isMinLength(1), Schema.isMaxLength(commitEventLimits.subscribers)), { onExcessProperty: "error" });
const decodeEnvelope = Schema.decodeUnknownEffect(EventEnvelope, { onExcessProperty: "error" });
const isEnvelope = Schema.is(EventEnvelope);

export const prepareAtomicCommerceEvents = Effect.fn("AtomicEvents.prepare")(function* (input: AtomicCommerceEvents) {
  const definitions = [...input.contracts].map(token => ({ token, definition: contracts.get(token) }));
  const subscriberInput = yield* Effect.fromResult(capturePrivateJsonData(input.subscribers, commitEventLimits.bytes, commerceError));
  const producerRevision = yield* decodeRevision(input.producerRevision).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
  const subscribers = yield* decodeSubscribers(subscriberInput.value).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
  const validate = input.validate;
  if (definitions.length < 1 || definitions.length > commitEventLimits.messages || new Set(subscribers.map(value => value.id)).size !== subscribers.length) return yield* Effect.fail(commerceError("invalidAuthority"));
  const allowed = new Map<CommerceEventContract, EventContract>();
  const names = new Set<string>();
  for (const { token, definition } of definitions) {
    if (definition === undefined || typeof definition.internal !== "boolean" || typeof definition.decode !== "function" || names.has(definition.name)) return yield* Effect.fail(commerceError("invalidAuthority"));
    yield* decodeName(definition.name).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
    yield* decodeRevision(definition.revision).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
    allowed.set(token, definition);
    names.add(definition.name);
  }
  const identity = { producerRevision, contracts: [...allowed.values()].map(({ name, revision, internal }) => ({ name, revision, internal })), subscribers } satisfies Json;
  return { allowed, identity, validate, producerRevision, subscribers };
});

export function admitParticipantEvents(selection: ParticipantEventSelection | undefined,
  policy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>> | undefined,
): Result.Result<readonly { readonly name: string; readonly revision: string }[], CommerceTransactionError> {
  const identities = [];
  for (const token of selection?.contracts ?? []) {
    const definition = policy?.allowed.get(token);
    if (definition === undefined || !definition.internal) return Result.fail(commerceError("invalidAuthority"));
    identities.push(Object.freeze({ name: definition.name, revision: definition.revision }));
  }
  return Result.succeed(Object.freeze(identities.toSorted((a, b) => compareUtf16Strings(a.name, b.name))));
}

declare const closureBrand: unique symbol;
export interface CommerceEventClosure { readonly [closureBrand]: true }
const closures = new WeakMap<object, { admission: CommerceAdmission; lifetime: BoundedRequestLifetime<CommerceTransactionError>; events: readonly CommittedEvent[] }>();

/** One request owns this buffer; it cannot publish, clear another root, or deliver. */
export function makeAtomicEventCapture(
  admission: CommerceAdmission, lifetime: BoundedRequestLifetime<CommerceTransactionError>, group: string,
  policy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>>, maximum: number,
) {
  const events: CommittedEvent[] = [];
  let sealed = false;
  const retain = Effect.fn("AtomicEvents.retain")(function* (token: CommerceEventContract, input: Json) {
    const definition = policy.allowed.get(token);
    if (sealed || definition === undefined) return yield* Effect.fail(commerceError("unadmittedEvent"));
    if (events.length >= Math.min(maximum, commitEventLimits.messages)) return yield* Effect.fail(commerceError("limitExceeded"));
    const message = yield* definition.decode(input);
    const envelope = yield* decodeEnvelope({ contract: definition.name, contractRevision: definition.revision, internal: definition.internal,
      producerRevision: policy.producerRevision, group, message, subscribers: policy.subscribers,
    }).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(envelope, Math.min(commitEventLimits.bytes, lifetime.remainingBytes()), commerceError));
    yield* Effect.fromResult(lifetime.charge(captured.bytes));
    // The decoder establishes the shape; the captured value owns immutable data.
    const owned = captured.value;
    if (!isEnvelope(owned)) return yield* Effect.fail(commerceError("unadmittedEvent"));
    events.push(owned);
    return owned.message;
  });
  const capture = Effect.fn("AtomicEvents.capture")(function* (token: CommerceEventContract, input: unknown) {
    if (sealed || !policy.allowed.has(token)) return yield* Effect.fail(commerceError("unadmittedEvent"));
    if (events.length >= Math.min(maximum, commitEventLimits.messages)) return yield* Effect.fail(commerceError("limitExceeded"));
    const copied = yield* Effect.fromResult(capturePrivateJsonData(input, Math.min(commitEventLimits.bytes, lifetime.remainingBytes()), commerceError));
    return yield* retain(token, copied.value);
  });
  const captureSelected = Effect.fn("AtomicEvents.captureSelected")(function* (selection: ParticipantEventSelection, input: unknown) {
    if (sealed || selection.contracts.length === 0) return yield* Effect.fail(commerceError("unadmittedEvent"));
    if (events.length >= Math.min(maximum, commitEventLimits.messages)) return yield* Effect.fail(commerceError("limitExceeded"));
    const copied = yield* Effect.fromResult(capturePrivateJsonData(input, Math.min(commitEventLimits.bytes, lifetime.remainingBytes()), commerceError));
    const token = yield* selection.select(copied.value);
    if (!selection.contracts.includes(token) || policy.allowed.get(token)?.internal !== true) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return yield* retain(token, copied.value);
  });
  const close = Effect.fn("AtomicEvents.close")(function* (calls: readonly AtomicCommerceCallObservation[]) {
    if (sealed || !lifetime.isClosing()) return yield* Effect.fail(commerceError("invalidAuthority"));
    yield* requireCommerceAdmission(admission);
    yield* policy.validate(Object.freeze([...events]), Object.freeze([...calls]));
    sealed = true;
    // SAFETY: the single-use registry authenticates admission and lifetime.
    const token = Object.freeze({}) as CommerceEventClosure;
    closures.set(token, { admission, lifetime, events: Object.freeze([...events]) });
    return token;
  });
  return { capture, captureSelected, close };
}
export const consumeCommerceEvents = Effect.fn("AtomicEvents.consume")(function* (
  closure: CommerceEventClosure, admission: CommerceAdmission, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
) {
  const state = closures.get(closure);
  if (state === undefined || state.admission !== admission || state.lifetime !== lifetime || !lifetime.isClosing()) return yield* Effect.fail(commerceError("invalidAuthority"));
  yield* requireCommerceAdmission(admission);
  closures.delete(closure);
  return { values: state.events, sha256: state.events.length === 0 ? null : yield* commitEventsDigest(state.events).pipe(Effect.mapError(cause => commerceError("resourceFailure", cause))) };
});
