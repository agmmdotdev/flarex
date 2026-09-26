import type { LogicalCallReceiptValidation } from "./logical-call-receipt";
import { Effect, Schema } from "effect";
import type { CommerceProfileState, LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { scalarEventPolicy } from "./scalar-events";
import { captureCommerceInput } from "./commerce-input";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";

/** Reuse scalar fact authentication for each member of the native create graph. */
export function pricingEventPolicy(descriptor: CommerceProfileState, deliver: LocalCommerceEventPolicy["deliver"]): LocalCommerceEventPolicy {
  const tables = ["price_set", "price", "price_rule"];
  const policies = new Map(tables.map(table => [table, scalarEventPolicy("pricing", table, { insert: "pricingCreate" }, descriptor, deliver)]));
  const decode = Schema.decodeUnknownEffect(Schema.Struct({ metadata: Schema.Struct({ object: Schema.String }) }));
  const capture = Effect.fn("PricingEvents.capture")(function* (input: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(input, descriptor.resources));
    const value = yield* decode(captured).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    const policy = policies.get(value.metadata.object);
    if (!policy) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return yield* policy.capture(captured);
  });
  return { capture, deliver, validate: Effect.fn("PricingEvents.validate")(function* (events, rows, command, lifecycle = []) {
    if (lifecycle.length || rows.some(row => !policies.has(row.tableId))) return yield* Effect.fail(commerceError("receiptMismatch"));
    const groups = new Map<string, typeof events[number][]>();
    for (const event of events) {
      yield* capture(event);
      const value = yield* decode(event).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
      const group = groups.get(value.metadata.object) ?? []; group.push(event); groups.set(value.metadata.object, group);
    }
    for (const [table, policy] of policies) yield* policy.validate(groups.get(table) ?? [], rows.filter(row => row.tableId === table), command);
  }) };
}

/** Core owns FK/unique settlement; this receipt authenticates the exact native
 * create events for each admitted Pricing graph. */
export function pricingLogicalCreateEventPolicy() {
  const profiles = new Map<string, ReadonlySet<string>>([
    ["pricingCreate", new Set(["price_set", "price", "price_rule"])],
    ["pricingCreateList", new Set(["price_list", "price", "price_list_rule"])],
  ]);
  const tables = new Set([...profiles.values()].flatMap(profile => [...profile]));
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING), object: Schema.String,
      action: Schema.Literal(CommonEvents.CREATED) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1),
      Schema.isMaxLength(defaultCommerceResources.eventIds))]) }),
  }), { onExcessProperty: "error" });
  const capture = Effect.fn("PricingEvents.captureLogical")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input, defaultCommerceResources));
    const message = yield* decode(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    if (!tables.has(message.metadata.object) || message.name !== buildModuleResourceEventName({
      prefix: Modules.PRICING, objectName: message.metadata.object, action: CommonEvents.CREATED,
    })) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingEvents.validateLogicalCreate")(
    function* (call: Parameters<LogicalCommerceCallValidation>[0], activity: Parameters<LogicalCommerceCallValidation>[1]) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      if (lifecycle.length || setNull.length || referenceReplacements.length ||
        mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.mode === "read") {
        if (mutations.length || call.events.length) return yield* Effect.fail(commerceError("receiptMismatch"));
        return;
      }
      const allowed = profiles.get(call.commandName);
      if (allowed === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
      const expected = new Set<string>();
      let listRoots = 0;
      for (const mutation of mutations) {
        const id = mutation.after?.id;
        const identity = mutation.table + ":" + id;
        if (!allowed.has(mutation.table) || mutation.operation !== "insert" || mutation.before !== null ||
          typeof id !== "string" || mutation.after?.deleted_at !== null || expected.has(identity))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (call.commandName === "pricingCreateList" && mutation.table === "price_list") listRoots++;
        expected.add(identity);
      }
      if (call.commandName === "pricingCreateList" && listRoots !== 1)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const event of emitted) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          if (!expected.delete(message.metadata.object + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
  return { capture, validateLogicalCall };
}
