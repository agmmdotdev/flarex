import { Effect, Schema } from "effect";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { scalarLogicalEventPolicy } from "../../repository/scalar-events";
import { decodeNotificationLocalProvider } from "./contracts";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";

/** Genuine native subscriber payloads; configuration and delivery retain their
 * separate row/command owners inside the same two-model source. */
export function notificationLogicalEventPolicy() {
  const notifications = scalarLogicalEventPolicy(Modules.NOTIFICATION, "notification", {
    insert: "notificationPrepare", update: "notificationFinalize",
  });
  const object = commerceDecoder(Schema.StructWithRest(Schema.Struct({ metadata: Schema.StructWithRest(
    Schema.Struct({ object: Schema.Literals(["notification", "notification_provider"]) }), [Schema.Record(Schema.String, Schema.Json)],
  ) }), [Schema.Record(Schema.String, Schema.Json)]), "unadmittedEvent");
  const capture = Effect.fn("Notification.captureEvent")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input));
    const envelope = yield* Effect.fromResult(object(value));
    if (envelope.metadata.object !== "notification") return yield* Effect.fail(commerceError("unadmittedEvent"));
    return yield* notifications.capture(value);
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("Notification.validateCall")(function* (call, activity) {
    const providerCall = call.commandName === "notificationRegisterLocalProvider";
    if (activity.mutations.some(mutation => mutation.table !== (providerCall ? "notification_provider" : "notification")))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    if (!providerCall) return yield* notifications.validateLogicalCall(call, activity);
    // Native provider startup uses its internal service without an outer
    // EmitEvents context. This explicit fixed registration follows that rule.
    const input = yield* Effect.fromResult(decodeNotificationLocalProvider(call.input));
    if (call.mode !== "write" || call.events.length !== 0 || activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0 || activity.mutations.length !== 1)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const mutation = activity.mutations[0];
    if (mutation?.operation !== "insert" || mutation.before !== null || mutation.after?.id !== "local" ||
      mutation.after.deleted_at !== null || mutation.after.handle !== input.handle || mutation.after.name !== input.name ||
      mutation.after.is_enabled !== input.is_enabled || !Array.isArray(mutation.after.channels) ||
      mutation.after.channels.length !== 1 || mutation.after.channels[0] !== input.channels[0])
      return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}
