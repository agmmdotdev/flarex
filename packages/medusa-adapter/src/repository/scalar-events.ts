import { moduleEventDecoder } from "../module/events";
import type { LogicalCallReceiptValidation } from "./call-receipt";
import { Effect, Schema } from "effect";
import { CommonEvents, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";

function scalarCapture(source: string, tableName: string,
  resources: typeof defaultCommerceResources, spanName: string) {
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(source), object: Schema.Literal(tableName),
      action: Schema.Literals([CommonEvents.CREATED, CommonEvents.UPDATED, CommonEvents.DELETED]) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1),
      Schema.isMaxLength(resources.eventIds))]) }),
  }), resources);
  return Effect.fn(spanName)(function* (input: unknown) {
    const message = yield* decode(input);
    if (message.name !== buildModuleResourceEventName({ prefix: source, objectName: tableName,
      action: message.metadata.action })) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
}

/** Authenticate one native scalar command against its exact logical row
 * attempts and durable event capture. */
export function scalarLogicalEventPolicy(source: string, tableName: string,
  commands: Readonly<{ insert: string; update?: string; delete?: string }>) {
  const capture = scalarCapture(source, tableName, defaultCommerceResources, "ScalarEvents.captureLogical");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ScalarEvents.validateLogicalCall")(
    function* (call: Parameters<LogicalCommerceCallValidation>[0], { mutations, lifecycle, setNull, referenceReplacements }: Parameters<LogicalCommerceCallValidation>[1]) {
      if (lifecycle.length !== 0 || setNull.length !== 0 || referenceReplacements.length !== 0 ||
        mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.mode === "read") return;
      const command = call.commandName;
      if (!Object.values(commands).includes(command)) return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
      const expected = new Set<string>();
      for (const mutation of mutations) {
        const operation = mutation.operation;
        if (operation !== "insert" && operation !== "patch" && operation !== "delete")
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const action = operation === "insert" ? CommonEvents.CREATED
          : operation === "patch" ? CommonEvents.UPDATED : CommonEvents.DELETED;
        const expectedCommand = operation === "insert" ? commands.insert
          : operation === "patch" ? commands.update : commands.delete;
        const row = operation === "delete" ? mutation.before : mutation.after;
        const id = row?.id;
        const identity = action + ":" + id;
        if (mutation.table !== tableName || command !== expectedCommand || typeof id !== "string" || expected.has(identity) ||
          (operation === "insert" ? mutation.before !== null || mutation.after?.deleted_at !== null
            : operation === "patch" ? mutation.before === null || mutation.before.id !== id || mutation.after?.deleted_at !== null
              : mutation.after !== null || mutation.before === null))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        expected.add(identity);
      }
      for (const event of emitted) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          if (!expected.delete(message.metadata.action + ":" + id))
            return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
  return { capture, validateLogicalCall };
}
