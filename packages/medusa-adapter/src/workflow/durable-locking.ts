import { Clock, Effect, Result, Schema, type Cause } from "effect";
import { asValue } from "@medusajs/deps/awilix";
import { createMedusaContainer } from "@medusajs/utils/common/medusa-container";
import { LockingModuleService, LockingProviderService } from "@medusajs/locking/services";
import loadStaticProviders from "@medusajs/locking/loaders/static-providers";
import { InMemoryLockingProvider } from "@medusajs/locking/providers/in-memory";
import { LockingDefaultProvider, LockingProviderRegistrationPrefix } from "@medusajs/locking/types";
import { inspectTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { makeTrustedWorkflowCallbackJournal, TrustedWorkflowCallbackDefinitionSchema,
  type TrustedWorkflowCallbackOutcome } from "@flarex/persistence-postgres/internal/trusted-workflow-callback";
import { inspectTrustedWorkflowInterpreterSubject, type TrustedWorkflowInterpreterSubject } from "@flarex/persistence-postgres/internal/trusted-workflow-execution-subject";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { captureWorkflowRecord } from "./configuration";
import { isDurableNativeBoundaryFailure, type DurableNativeEffectBoundary } from "./durable-native-storage";

type TaskOptions = Omit<Parameters<typeof makeTrustedWorkflowCallbackJournal>[0], "definition">;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Nonce = Schema.String.check(Schema.isLengthBetween(1, 128));
const acquireInput = commerceDecoder(Schema.Tuple([Id, Schema.Struct({ expire: Schema.Literal(10), ownerId: Id })]), "unsupportedProfile");
const releaseInput = commerceDecoder(Schema.Tuple([Schema.Array(Id).check(Schema.isLengthBetween(1, 1)), Schema.Struct({ ownerId: Id })]), "unsupportedProfile");
const decodeId = commerceDecoder(Id, "unsupportedProfile");
const decodeAcquired = commerceDecoder(Schema.Struct({ lifecycleNonce: Nonce, acquisitionNonce: Nonce }), "storedCorruption");
const decodeReleased = commerceDecoder(Schema.Struct({ lifecycleNonce: Nonce, released: Schema.Boolean }), "storedCorruption");
const decodeFailure = commerceDecoder(Schema.Struct({ lifecycleNonce: Nonce, message: Schema.String.check(Schema.isMaxLength(1024)) }), "storedCorruption");
const callbackBudget = commerceDecoder(TrustedWorkflowCallbackDefinitionSchema.fields.maximumCallbackMs, "unsupportedProfile");

/** The native callback sequence supplies stable effect identities. Both native
 * release bodies pass an array; argument shape does not identify their phase. */
export const fulfillmentDeliveryLockingPolicy = Object.freeze({
  provider: "in-memory", ttlSeconds: 10, acquireOrdinals: "1-8", ordinaryReleaseOrdinals: "9-10", controlReleaseOrdinal: "10",
  observation: "same-host-conservative-monotonic-age", acquisitionRestart: "refuse", releaseReplay: "completed-effect-only",
});
interface AcquisitionObservation {
  readonly subject: TrustedWorkflowInterpreterSubject;
  readonly id: string;
  readonly ownerId: string;
  readonly lifecycleNonce: string;
  readonly acquisitionNonce: string;
  readonly deadlineNanos: bigint;
}
interface CallbackSequence { acquire: number; release: number; acquired: boolean }
export interface FulfillmentDeliveryLockingService {
  readonly acquire: (...args: unknown[]) => Promise<void>;
  readonly release: (...args: unknown[]) => Promise<boolean>;
}

/** Selected native in-memory module lifecycle. Journal SQL ends before each
 * genuine native callback. Receipt age is a conservative private profile gate,
 * not provider ownership, wall-clock expiry, resource fencing or a distributed
 * lease. Native provider arbitration is never reimplemented here. */
export const makeFulfillmentDeliveryLocking = Effect.fn("FulfillmentDelivery.makeLocking")(function* (input: {
  readonly task: TaskOptions;
  readonly revision: string;
  readonly maximumCallbackMs?: number;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input)), task = yield* Effect.fromResult(captureWorkflowRecord(options.task));
  if (Object.keys(options).some(key => !["task", "revision", "maximumCallbackMs"].includes(key)) || !/^[0-9a-f]{64}$/.test(options.revision))
    return yield* commerceError("unsupportedProfile");
  const binding = yield* Effect.fromResult(inspectTrustedWorkflowTaskBinding(task.binding)),
    maximumCallbackMs = yield* Effect.fromResult(callbackBudget(options.maximumCallbackMs ?? 1000)), clock = yield* Clock.Clock;
  const lifecycleNonce = yield* Effect.sync(() => globalThis.crypto.randomUUID()), container = createMedusaContainer();
  yield* Effect.tryPromise({ try: () => loadStaticProviders({ container, options: {} }), catch: cause => commerceError("adapterFailure", cause) });
  // Awilix throws for an unregistered optional dependency. An explicit absent
  // logger preserves the genuine service's own console fallback.
  container.register({ logger: asValue(undefined) });
  const provider = container.resolve<unknown>(LockingProviderRegistrationPrefix + InMemoryLockingProvider.identifier),
    defaultProvider = container.resolve<unknown>(LockingDefaultProvider);
  if (!(provider instanceof InMemoryLockingProvider) || defaultProvider !== InMemoryLockingProvider.identifier)
    return yield* commerceError("unsupportedProfile");
  const providerService = new LockingProviderService(container.cradle);
  container.register({ lockingProviderService: asValue(providerService) });
  const native = new LockingModuleService({ lockingProviderService: providerService, [LockingDefaultProvider]: InMemoryLockingProvider.identifier });
  let closed = false;
  const sticky = new WeakMap<TrustedWorkflowInterpreterSubject, Cause.Cause<unknown>>(),
    sequences = new WeakMap<TrustedWorkflowInterpreterSubject, CallbackSequence>(), observations = new Map<string, AcquisitionObservation>(), pending = new Set<Promise<unknown>>();
  const healthy = <A, E>(subject: TrustedWorkflowInterpreterSubject, work: Effect.Effect<A, E>) => Effect.suspend(() => {
    const previous = sticky.get(subject);
    return previous !== undefined ? Effect.failCause(previous) : closed ? Effect.fail(commerceError("closed")) : work;
  }).pipe(Effect.tapCause(cause => Effect.sync(() => { if (!sticky.has(subject)) sticky.set(subject, cause); })));
  const pinsFor = (subject: TrustedWorkflowInterpreterSubject) => Result.gen(function* () {
    const pins = yield* inspectTrustedWorkflowInterpreterSubject(subject);
    if (!bytesEqualFullScan(pins.bindingSha256, binding.sha256)) return yield* Result.fail(commerceError("invalidAuthority"));
    return pins;
  });
  const assertAcquisitionObservation = Effect.fn("FulfillmentDelivery.assertAcquisitionObservation")((subject: TrustedWorkflowInterpreterSubject, id: string) =>
    healthy(subject, Effect.gen(function* () {
      const pins = yield* Effect.fromResult(pinsFor(subject)), capturedId = yield* Effect.fromResult(decodeId(id)), current = observations.get(pins.runId);
      if (pins.executionMode !== "workflow" || current === undefined || current.subject !== subject || current.id !== capturedId || current.ownerId !== `fulfillment-delivery:${pins.runId}` ||
        current.lifecycleNonce !== lifecycleNonce || clock.monotonicTimeNanosUnsafe() >= current.deadlineNanos)
        return yield* commerceError("invalidAuthority", { profile: "fulfillment-delivery", reason: "acquisitionObservationUnavailable" });
    })));
  const serviceFor = ({ subject, id, boundary }: {
    readonly subject: TrustedWorkflowInterpreterSubject; readonly id: string; readonly boundary: DurableNativeEffectBoundary;
  }): FulfillmentDeliveryLockingService => {
    const run = <A, E>(work: Effect.Effect<A, E>): Promise<A> => {
      const promise = boundary(healthy(subject, work));
      pending.add(promise);
      void promise.then(() => { pending.delete(promise); }, () => { pending.delete(promise); });
      return promise;
    };
    const prepare = () => Effect.gen(function* () {
      const pins = yield* Effect.fromResult(pinsFor(subject)), capturedId = yield* Effect.fromResult(decodeId(id));
      const sequence = sequences.get(subject) ?? { acquire: 0, release: 0, acquired: false };
      sequences.set(subject, sequence);
      return { pins, id: capturedId, ownerId: `fulfillment-delivery:${pins.runId}`, sequence };
    });
    const journal = (allowControl: boolean, invoke: () => Effect.Effect<TrustedWorkflowCallbackOutcome, unknown>) =>
      makeTrustedWorkflowCallbackJournal({ ...task, definition: { id: "medusa.fulfillment.delivery.locking", revision: options.revision,
        allowControl, inputCodecRevision: "medusa.fulfillment.delivery.lock-input.v1", outcomeCodecRevision: "medusa.fulfillment.delivery.lock-outcome.v1", maximumCallbackMs } }, invoke);
    return Object.freeze({
      acquire: async (...args: unknown[]) => {
        const outcome = await run(Effect.gen(function* () {
          const current = yield* prepare(), [key, options] = yield* Effect.fromResult(captureCommerceInput(args).pipe(Result.flatMap(acquireInput)));
          if (current.pins.executionMode !== "workflow" || key !== current.id || options.ownerId !== current.ownerId || current.sequence.acquired || ++current.sequence.acquire > 8)
            return yield* commerceError("invalidAuthority");
          const ordinal = BigInt(current.sequence.acquire), expectedFailure = `Failed to acquire lock for key "${current.id}"`;
          const callback = yield* journal(false, () => Effect.gen(function* () {
            const started = clock.monotonicTimeNanosUnsafe();
            const result = yield* Effect.tryPromise({ try: () => native.acquire(key, options), catch: (cause): unknown => cause }).pipe(
              Effect.map(() => ({ kind: "returned" as const })),
              // Only the actual pinned in-memory contention Error is retryable
              // native business data. Every core/unknown rejection stays a Cause.
              Effect.catch(cause => {
                if (isDurableNativeBoundaryFailure(cause) || !(cause instanceof Error) || Object.getPrototypeOf(cause) !== Error.prototype)
                  return Effect.fail(cause);
                const message = Object.getOwnPropertyDescriptor(cause, "message");
                return message !== undefined && "value" in message && message.value === expectedFailure
                  ? Effect.succeed({ kind: "failed" as const, error: { lifecycleNonce, message: expectedFailure } }) : Effect.fail(cause);
              }),
            );
            if (result.kind === "failed") return result;
            const acquisitionNonce = globalThis.crypto.randomUUID();
            observations.set(current.pins.runId, { subject, id: current.id, ownerId: current.ownerId, lifecycleNonce, acquisitionNonce,
              deadlineNanos: started + 10_000_000_000n });
            return { kind: "returned", value: { lifecycleNonce, acquisitionNonce } };
          }));
          const recorded = yield* callback.run(subject, ordinal, { kind: "acquire", key, options });
          if (recorded.kind === "failed") {
            const failure = yield* Effect.fromResult(decodeFailure(recorded.error));
            if (failure.lifecycleNonce !== lifecycleNonce || failure.message !== expectedFailure) return yield* commerceError("invalidAuthority");
            return { kind: "failed" as const, message: failure.message };
          }
          const result = yield* Effect.fromResult(decodeAcquired(recorded.value)), observed = observations.get(current.pins.runId);
          if (result.lifecycleNonce !== lifecycleNonce || observed === undefined || observed.acquisitionNonce !== result.acquisitionNonce)
            return yield* commerceError("invalidAuthority", { profile: "fulfillment-delivery", reason: "acquisitionReceiptIsNotObservation" });
          yield* assertAcquisitionObservation(subject, current.id);
          current.sequence.acquired = true;
          return { kind: "returned" as const };
        }));
        // Rejection occurs outside the sticky Effect boundary so the genuine
        // native retry loop can retry this exact provider contention failure.
        if (outcome.kind === "failed") throw new Error(outcome.message);
      },
      release: async (...args: unknown[]) => await run(Effect.gen(function* () {
        const current = yield* prepare(), [keys, options] = yield* Effect.fromResult(captureCommerceInput(args).pipe(Result.flatMap(releaseInput)));
        if (keys[0] !== current.id || options.ownerId !== current.ownerId || ++current.sequence.release > (current.pins.executionMode === "control" ? 1 : 2))
          return yield* commerceError("invalidAuthority");
        const ordinal = current.pins.executionMode === "control" ? 10n : BigInt(8 + current.sequence.release);
        const callback = yield* journal(true, () => Effect.gen(function* () {
          const released = yield* Effect.tryPromise({ try: () => native.release([...keys], options), catch: (cause): unknown => cause });
          const result = yield* Effect.fromResult(decodeReleased({ lifecycleNonce, released }));
          observations.delete(current.pins.runId);
          return { kind: "returned", value: result };
        }));
        const recorded = yield* callback.run(subject, ordinal, { kind: "release", keys, options });
        if (recorded.kind !== "returned") return yield* commerceError("storedCorruption");
        const result = yield* Effect.fromResult(decodeReleased(recorded.value));
        // A completed release may replay after restart. It confers no current
        // ownership or acquisition observation on this provider instance.
        observations.delete(current.pins.runId);
        return result.released;
      })),
    });
  };
  let disposal: Promise<void> | undefined;
  const close = Effect.tryPromise({ try: () => disposal ??= (async () => {
      closed = true;
      while (pending.size) await Promise.allSettled([...pending]);
      observations.clear();
      await native.__hooks.onApplicationPrepareShutdown();
      await native.releaseAll();
      await native.__hooks.onApplicationShutdown();
      await container.dispose();
    })(), catch: cause => commerceError("adapterFailure", cause) });
  return Object.freeze({ serviceFor, assertAcquisitionObservation, close });
});
