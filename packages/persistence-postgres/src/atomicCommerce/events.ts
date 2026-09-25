import { Effect, Result, Schema } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { isJsonObject, jsonEqual, type Json } from "flarex-protocol/json";
import type { CommerceCommand } from "../commerceTransaction/commands";
import type { AtomicCommerceParticipant } from "./commands";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import { capturePrivateJsonData } from "../privateJsonData";
import { commitEventLimits, EventEnvelope, EventName, EventRevision, EventSubscriber, type CommittedEvent, type CommitEventSubscriber } from "../commitEvents/model";
import type { BoundedRequestLifetime } from "../boundedRequestLifetime";
import { commitEventsDigest } from "../commitEvents/digest";
import { CommitEventError } from "../commitEvents/model";
import { chargeHostPreparation } from "../preparedHostRuntime";

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
const derivedIdContracts = new WeakMap<object, Json>();
const isEventContract = (value: unknown): value is CommerceEventContract => typeof value === "object" && value !== null && contracts.has(value);
export const isCommerceDerivedIdEventContract = (token: CommerceEventContract): boolean =>
  derivedIdContracts.has(token);
/** Trusted definitions describe semantics; only explicit host admission authorizes capture. */
export function defineCommerceEventContract(definition: EventContract): CommerceEventContract {
  // SAFETY: the registry, not the brand, authenticates a definition.
  const token = Object.freeze({}) as CommerceEventContract;
  contracts.set(token, Object.freeze({ ...definition }));
  return token;
}
/** A core-owned exact ID-only message contract. Its decoder accepts precisely
 * the messages the locked derived-event writer can construct. */
const isJson = Schema.is(Schema.Json);
export function defineCommerceDerivedIdEventContract(definition: Readonly<{
  name: string; revision: string; internal: true; metadata: Json;
}>): Result.Result<CommerceEventContract, CommerceTransactionError> {
  const { name, revision } = definition;
  return capturePrivateJsonData(definition.metadata, commitEventLimits.bytes, commerceError).pipe(
    Result.flatMap(captured => {
      if (!isJsonObject(captured.value)) return Result.fail(commerceError("invalidAuthority"));
      const expectedMetadata = captured.value;
      const token = defineCommerceEventContract({ name, revision, internal: true,
        decode: value => {
          if (!isJson(value) || !isJsonObject(value) ||
            Object.keys(value).length !== 3 || value.name !== name)
            return Effect.fail(commerceError("unadmittedEvent"));
          const metadata = value.metadata, data = value.data;
          if (metadata === undefined || !isJsonObject(metadata) || !jsonEqual(metadata, expectedMetadata) ||
            data === undefined || !isJsonObject(data) || Object.keys(data).length !== 1 ||
            typeof data.id !== "string" || data.id.length < 1 || data.id.length > 256)
            return Effect.fail(commerceError("unadmittedEvent"));
          return Effect.succeed({ name, metadata: expectedMetadata, data: { id: data.id } });
        } });
      derivedIdContracts.set(token, expectedMetadata);
      return Result.succeed(token);
    }));
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
  /** Explicitly scopes validate to captured events when a trusted participant
   * admits core-derived ID events. The core validates that static family. */
  readonly derivedIdValidation?: "capturedOnly";
}
const decodeName = Schema.decodeUnknownEffect(EventName);
const decodeRevision = Schema.decodeUnknownEffect(EventRevision);
const decodeSubscribers = Schema.decodeUnknownEffect(Schema.Array(EventSubscriber).check(Schema.isMinLength(1), Schema.isMaxLength(commitEventLimits.subscribers)), { onExcessProperty: "error" });
const decodeEnvelope = Schema.decodeUnknownEffect(EventEnvelope, { onExcessProperty: "error" });
const isEnvelope = Schema.is(EventEnvelope);

/** Capture policy bytes and registered tokens before host construction yields. */
export interface CapturedAtomicCommerceEvents {
  readonly definitions: readonly Readonly<{ token: CommerceEventContract; definition: EventContract | undefined }>[];
  readonly subscribers: Json;
  readonly producerRevision: string;
  readonly validate: AtomicCommerceEvents["validate"];
  readonly derivedIdValidation: AtomicCommerceEvents["derivedIdValidation"];
}
export function captureAtomicCommerceEvents(input: AtomicCommerceEvents): Result.Result<CapturedAtomicCommerceEvents, CommerceTransactionError> {
  if (!Array.isArray(input.contracts) || input.contracts.length < 1 || input.contracts.length > commitEventLimits.messages)
    return Result.fail(commerceError("invalidAuthority"));
  const definitions = Object.freeze([...input.contracts].map(token => Object.freeze({ token, definition: contracts.get(token) })));
  return capturePrivateJsonData(input.subscribers, commitEventLimits.bytes, commerceError).pipe(Result.map(subscriberInput =>
    Object.freeze({ definitions, subscribers: subscriberInput.value, producerRevision: input.producerRevision,
      validate: input.validate, derivedIdValidation: input.derivedIdValidation })));
}

export const prepareAtomicCommerceEvents = Effect.fn("AtomicEvents.prepare")(function* (input: CapturedAtomicCommerceEvents) {
  const { definitions } = input;
  const producerRevision = yield* decodeRevision(input.producerRevision).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
  const subscribers = yield* decodeSubscribers(input.subscribers).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
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
  const identity = { producerRevision, contracts: [...allowed.entries()].map(([token, { name, revision, internal }]) =>
    ({ name, revision, internal, ...(derivedIdContracts.has(token)
      ? { derivedIdMetadata: derivedIdContracts.get(token) ?? null } : {}) })), subscribers,
    ...(input.derivedIdValidation === undefined ? {} : { derivedIdValidation: input.derivedIdValidation }) } satisfies Json;
  yield* chargeHostPreparation({ identity, producerRevision, subscribers,
    contracts: [...allowed.values()].map(({ name, revision, internal }) => ({ name, revision, internal })),
  }).pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
  if (input.derivedIdValidation !== undefined && input.derivedIdValidation !== "capturedOnly")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  return { allowed, identity, validate, derivedIdValidation: input.derivedIdValidation, producerRevision, subscribers };
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
/** Static native metadata for a core-owned ID-only event contract. */
export interface CommerceDerivedIdEvent {
  readonly contract: CommerceEventContract;
}
interface PreparedDerivedIdEvent {
  readonly name: string; readonly revision: string; readonly metadata: Json;
  readonly producerRevision: string; readonly subscribers: readonly CommitEventSubscriber[];
  readonly group: string;
}
const closures = new WeakMap<object, { requireAdmission: Effect.Effect<void, CommerceTransactionError>;
  lifetime: BoundedRequestLifetime<CommerceTransactionError>; events: CommittedEvent[];
  maximum: number; derived: PreparedDerivedIdEvent | undefined; derivedApplied: boolean }>();

/** One request owns this buffer; it cannot publish, clear another root, or deliver. */
export function makeAtomicEventCapture(
  requireAdmission: Effect.Effect<void, CommerceTransactionError>, lifetime: BoundedRequestLifetime<CommerceTransactionError>, group: string,
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
  const close = Effect.fn("AtomicEvents.close")(function* (
    calls: readonly AtomicCommerceCallObservation[], derived?: CommerceDerivedIdEvent,
  ) {
    if (sealed || !lifetime.isClosing()) return yield* Effect.fail(commerceError("invalidAuthority"));
    yield* requireAdmission;
    if (derived !== undefined && policy.derivedIdValidation !== "capturedOnly")
      return yield* Effect.fail(commerceError("invalidAuthority"));
    yield* policy.validate(Object.freeze([...events]), Object.freeze([...calls]));
    let prepared: PreparedDerivedIdEvent | undefined;
    if (derived !== undefined) {
      const definition = policy.allowed.get(derived.contract);
      const expectedMetadata = derivedIdContracts.get(derived.contract);
      if (definition === undefined || !definition.internal || expectedMetadata === undefined)
        return yield* Effect.fail(commerceError("unadmittedEvent"));
      prepared = Object.freeze({ name: definition.name, revision: definition.revision,
        metadata: expectedMetadata, producerRevision: policy.producerRevision,
        subscribers: policy.subscribers, group });
    }
    sealed = true;
    // SAFETY: the single-use registry authenticates admission and lifetime.
    const token = Object.freeze({}) as CommerceEventClosure;
    closures.set(token, { requireAdmission, lifetime, events: [...events], maximum,
      derived: prepared, derivedApplied: false });
    return token;
  });
  return { capture, captureSelected, close };
}
/** Only trusted settlement supplies identities selected from committed rows.
 * Static metadata was checked before the publication lock; this path performs
 * no framework callback or contract decoder. */
export const appendDerivedCommerceIdEvents = Effect.fn("AtomicEvents.appendDerivedIds")(function* (
  closure: CommerceEventClosure, lifetime: BoundedRequestLifetime<CommerceTransactionError>, ids: readonly string[],
) {
  const state = closures.get(closure);
  if (state === undefined || state.lifetime !== lifetime || !lifetime.isClosing() ||
    state.derived === undefined || state.derivedApplied || new Set(ids).size !== ids.length)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  yield* state.requireAdmission;
  if (state.events.length + ids.length > Math.min(state.maximum, commitEventLimits.messages))
    return yield* Effect.fail(commerceError("limitExceeded"));
  const { derived } = state;
  for (const id of ids) {
    if (id.length < 1 || id.length > 256) return yield* Effect.fail(commerceError("unadmittedEvent"));
    const envelope = { contract: derived.name, contractRevision: derived.revision, internal: true,
      producerRevision: derived.producerRevision, group: derived.group,
      message: { name: derived.name, metadata: derived.metadata, data: { id } },
      subscribers: derived.subscribers } satisfies CommittedEvent;
    const captured = yield* Effect.fromResult(capturePrivateJsonData(envelope,
      Math.min(commitEventLimits.bytes, lifetime.remainingBytes()), commerceError));
    yield* Effect.fromResult(lifetime.charge(captured.bytes));
    if (!isEnvelope(captured.value)) return yield* Effect.fail(commerceError("unadmittedEvent"));
    state.events.push(captured.value);
  }
  state.derivedApplied = true;
});
export const consumeCommerceEvents = Effect.fn("AtomicEvents.consume")(function* (
  closure: CommerceEventClosure, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
) {
  const state = closures.get(closure);
  if (state === undefined || state.lifetime !== lifetime || !lifetime.isClosing()) return yield* Effect.fail(commerceError("invalidAuthority"));
  yield* state.requireAdmission;
  closures.delete(closure);
  if (state.derived !== undefined && !state.derivedApplied) return yield* Effect.fail(commerceError("invalidAuthority"));
  const values = Object.freeze([...state.events]);
  return { values, sha256: values.length === 0 ? null : yield* commitEventsDigest(values).pipe(Effect.mapError(cause =>
    commerceError(cause instanceof CommitEventError && cause.reason === "invalidInput" ? "limitExceeded" : "resourceFailure", cause))) };
});
