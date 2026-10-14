import { Effect, Schema } from "effect";
import type { IEventBusModuleService } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type CommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import type { CommercePromiseOwner } from "./promise-owner";

/** Native module event-bus envelope, decoded after private JSON capture. */
export const decodeLocalEventOptions = commerceDecoder(Schema.Struct({ internal: Schema.Literal(true) }), "unadmittedEvent");
export const decodeLocalEventBatch = commerceDecoder(Schema.Array(Schema.Json), "unadmittedEvent");

/** Compile each module's own event grammar once. Byte-safe capture precedes
 * strict decoding; native naming and row/event correlation remain with policy. */
export function moduleEventDecoder<S extends Schema.ConstraintDecoder<unknown>>(schema: S, resources: CommerceResources) {
  const decode = Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" });
  return Effect.fn(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input, resources));
    return yield* decode(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
  });
}

/** The caller owns capture policy and the exact refusal context. Applying check
 * at emit invocation preserves a snapshot check as well as deferred checks. */
export function commerceModuleEventBus(input: {
  readonly owner: CommercePromiseOwner;
  readonly resources: CommerceCommandContext["resources"];
  readonly capture: (message: Json) => Effect.Effect<void, CommerceTransactionError>;
  readonly check: (work: Effect.Effect<void, CommerceTransactionError>) => Effect.Effect<void, CommerceTransactionError>;
  readonly refuse: () => Promise<never>;
}): IEventBusModuleService {
  const { owner, resources, capture, check, refuse } = input;
  return {
    emit: (messages, options) => owner.run(check(Effect.gen(function* () {
      yield* Effect.fromResult(decodeLocalEventOptions(yield* Effect.fromResult(captureCommerceInput(options))));
      const captured = yield* Effect.fromResult(captureCommerceInput(messages, resources));
      const batch = yield* Effect.fromResult(decodeLocalEventBatch(captured));
      for (const message of batch) yield* capture(message);
    }))),
    subscribe: () => owner.reject(commerceError("unsupportedProfile")),
    unsubscribe: () => owner.reject(commerceError("unsupportedProfile")),
    releaseGroupedEvents: refuse, clearGroupedEvents: refuse,
  };
}
