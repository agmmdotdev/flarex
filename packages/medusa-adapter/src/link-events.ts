import { Effect, Schema } from "effect";
import type { CommerceProfileState, LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceEventValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";

/** Selected new-attach Link receipt. The non-key event ID comes from each
 * attempted row, never from a final-row reread. Replacement needs its own gate. */
export function linkLogicalAttachEventPolicy(tableName: string, serviceName: string, entityName: string) {
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.Literal(entityName + ".attached"),
    metadata: Schema.Struct({ source: Schema.Literal(serviceName), object: Schema.Literal(entityName), action: Schema.Literal("attached") }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1),
      Schema.isMaxLength(defaultCommerceResources.eventIds))]) }),
  }), { onExcessProperty: "error" });
  const capture = Effect.fn("LinkEvents.captureLogicalAttach")(function* (input: unknown) {
    return (yield* decode(yield* Effect.fromResult(captureCommerceInput(input, defaultCommerceResources)))
      .pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)))) satisfies Json;
  });
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("LinkEvents.validateLogicalAttach")(
    function* (calls, mutations, lifecycle) {
      if (lifecycle.length !== 0 || mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      let cursor = 0;
      let writes = 0;
      let emitted: readonly Json[] = [];
      for (const call of calls) {
        if (call.fromAttempt !== cursor) return yield* Effect.fail(commerceError("receiptMismatch"));
        if (call.mode === "read") {
          if (call.toAttempt !== cursor || call.events.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
          continue;
        }
        if (++writes !== 1 || call.commandName !== "linkCreate" || call.toAttempt !== mutations.length)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        cursor = call.toAttempt;
        emitted = call.events;
      }
      if (cursor !== mutations.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      const expected = new Set<string>();
      for (const mutation of mutations) {
        const row = mutation.after;
        const id = row?.id;
        if (mutation.table !== tableName || mutation.operation !== "insert" || mutation.before !== null ||
          row === null || typeof id !== "string" || typeof row.variant_id !== "string" || typeof row.price_set_id !== "string" ||
          row.deleted_at !== null || expected.has(id))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        expected.add(id);
      }
      for (const event of emitted) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (!expected.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
  return { capture, validateLogical };
}

/** Authenticate native non-key event IDs from operation-local storage evidence,
 * never from a final-row reread: a later attach may already have replaced ID. */
export function linkEventPolicy(tableName: string, serviceName: string, entityName: string, descriptor: CommerceProfileState,
  deliver: LocalCommerceEventPolicy["deliver"]): LocalCommerceEventPolicy {
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = Schema.decodeUnknownEffect(Schema.Struct({
    name: Schema.String, metadata: Schema.Struct({ source: Schema.Literal(serviceName), object: Schema.Literal(entityName),
      action: Schema.Literals(["attached", "detached"]) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(descriptor.resources.eventIds))]) }),
  }), { onExcessProperty: "error" });
  const capture = Effect.fn("LinkEvents.capture")(function* (input: unknown) {
    const message = yield* decode(yield* Effect.fromResult(captureCommerceInput(input, descriptor.resources)))
      .pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    if (message.name !== entityName + "." + message.metadata.action) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message satisfies Json;
  });
  const sameKey = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((byte, index) => byte === right[index]);
  return { capture, deliver, validate: Effect.fn("LinkEvents.validate")(function* (events, facts, command, lifecycle = [], observations = []) {
    const remainingFacts = [...facts], remainingLifecycle = [...lifecycle];
    const expected: string[] = [];
    for (const observation of observations) {
      const operation = observation.operation;
      const admitted = command === "linkCreate" ? operation === "insert" || operation === "update"
        : command === "linkRestore" ? operation === "restore"
          : (command === "linkDismiss" || command === "linkDelete") && operation === "softDelete";
      const id = observation.row.id;
      if (!admitted || observation.tableId !== tableName || typeof id !== "string"
        || (operation === "softDelete" ? typeof observation.row.deleted_at !== "string" : observation.row.deleted_at !== null)) {
        return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      const transition = operation === "softDelete" || operation === "restore";
      if (transition) {
        const index = remainingLifecycle.findIndex(item => item.tableId === observation.tableId && item.operation === operation && sameKey(item.keyBytes, observation.keyBytes));
        const item = remainingLifecycle[index];
        if (item === undefined || item.afterDeletedAt !== observation.row.deleted_at
          || observation.changed !== (operation === "softDelete" || item.beforeDeletedAt !== null)) return yield* Effect.fail(commerceError("receiptMismatch"));
        remainingLifecycle.splice(index, 1);
      } else if (!observation.changed) return yield* Effect.fail(commerceError("receiptMismatch"));
      if (observation.changed) {
        const index = remainingFacts.findIndex(item => item.tableId === observation.tableId
          && item.operation === (transition ? "update" : operation) && sameKey(item.keyBytes, observation.keyBytes));
        if (index === -1) return yield* Effect.fail(commerceError("receiptMismatch"));
        remainingFacts.splice(index, 1);
      }
      expected.push((operation === "softDelete" ? "detached" : "attached") + ":" + id);
    }
    for (const event of events) {
      const message = yield* capture(event);
      for (const id of typeof message.data.id === "string" ? [message.data.id] : message.data.id) {
        const index = expected.indexOf(message.metadata.action + ":" + id);
        if (index === -1) return yield* Effect.fail(commerceError("receiptMismatch"));
        expected.splice(index, 1);
      }
    }
    if (remainingFacts.length || remainingLifecycle.length || expected.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  }) };
}

/** Finite installation-selected Link identities, not request-selected routing.
 * Every evidence item must belong to exactly one selected definition. */
export function selectedLinkEventPolicy(definitions: readonly {
  readonly tableName: string; readonly serviceName: string; readonly entityName: string;
}[], descriptor: CommerceProfileState, deliver: LocalCommerceEventPolicy["deliver"]): LocalCommerceEventPolicy {
  const selected = definitions.map(definition => ({ ...definition,
    policy: linkEventPolicy(definition.tableName, definition.serviceName, definition.entityName, descriptor, deliver) }));
  const valid = new Set(selected.map(item => item.tableName)).size === selected.length
    && new Set(selected.map(item => item.serviceName)).size === selected.length
    && new Set(selected.map(item => item.entityName)).size === selected.length;
  const decode = Schema.decodeUnknownEffect(Schema.Struct({
    name: Schema.String, metadata: Schema.Struct({ source: Schema.String, object: Schema.String, action: Schema.String }),
    data: Schema.JsonObject,
  }), { onExcessProperty: "error" });
  const identify = Effect.fn("LinkEvents.identify")(function* (event: unknown) {
    const message = yield* decode(yield* Effect.fromResult(captureCommerceInput(event, descriptor.resources)))
      .pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    const definition = selected.find(item => item.serviceName === message.metadata.source && item.entityName === message.metadata.object);
    if (!valid || definition === undefined) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { definition, message: yield* definition.policy.capture(message) };
  });
  return { deliver, capture: Effect.fn("LinkEvents.captureSelected")(input => identify(input).pipe(Effect.map(value => value.message))),
    validate: Effect.fn("LinkEvents.validateSelected")(function* (events, facts, command, lifecycle = [], observations = []) {
      if (!valid || [...facts, ...lifecycle, ...observations].some(item => !selected.some(definition => definition.tableName === item.tableId))) {
        return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      const partitioned = new Map<typeof selected[number], Json[]>();
      for (const event of events) {
        const { definition, message } = yield* identify(event);
        const partition = partitioned.get(definition) ?? [];
        partition.push(message); partitioned.set(definition, partition);
      }
      for (const definition of selected) yield* definition.policy.validate(partitioned.get(definition) ?? [],
        facts.filter(item => item.tableId === definition.tableName), command,
        lifecycle.filter(item => item.tableId === definition.tableName), observations.filter(item => item.tableId === definition.tableName));
    }),
  };
}
