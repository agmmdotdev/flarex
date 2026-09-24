import { Effect, Schema } from "effect";
import type { CommerceProfileState, LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceEventValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";

/** The selected Link receipt binds native events to attempted rows or an
 * authenticated unchanged-restore observation, never a final-row reread. */
export function linkLogicalEventPolicy(tableName: string, serviceName: string, entityName: string,
  endpoints: readonly [string, string]) {
  const [primary, foreign] = endpoints;
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(serviceName), object: Schema.Literal(entityName), action: Schema.Literals(["attached", "detached"]) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1),
      Schema.isMaxLength(defaultCommerceResources.eventIds))]) }),
  }), { onExcessProperty: "error" });
  const capture = Effect.fn("LinkEvents.captureLogical")(function* (input: unknown) {
    const message = yield* decode(yield* Effect.fromResult(captureCommerceInput(input, defaultCommerceResources)))
      .pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    if (message.name !== entityName + "." + message.metadata.action)
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message satisfies Json;
  });
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("LinkEvents.validateLogical")(
    function* (calls, mutations, lifecycle) {
      if (mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      let cursor = 0;
      let lifecycleCursor = 0;
      for (const call of calls) {
        if (call.fromAttempt !== cursor || call.fromLifecycle !== lifecycleCursor ||
          call.toAttempt < cursor || call.toAttempt > mutations.length ||
          call.toLifecycle < lifecycleCursor || call.toLifecycle > lifecycle.length)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (call.mode === "read") {
          if (call.toAttempt !== cursor || call.toLifecycle !== lifecycleCursor || call.events.length !== 0)
            return yield* Effect.fail(commerceError("receiptMismatch"));
          continue;
        }
        if (call.commandName !== "linkCreate" && call.commandName !== "linkDismiss"
          && call.commandName !== "linkDelete" && call.commandName !== "linkRestore")
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const command = call.commandName;
        const expected: string[] = [];
        const expectedAction = command === "linkDismiss" || command === "linkDelete" ? "detached" : "attached";
        for (const mutation of mutations.slice(cursor, call.toAttempt)) {
          const row = mutation.after;
          const id = row?.id;
          if (mutation.table !== tableName ||
            (command === "linkCreate" ? mutation.operation !== "insert" && mutation.operation !== "patch"
              : mutation.operation !== "patch") ||
            (mutation.operation === "insert" ? mutation.before !== null : mutation.before === null) ||
            row === null || typeof id !== "string" || typeof row[primary] !== "string" || typeof row[foreign] !== "string" ||
            (command === "linkDismiss" || command === "linkDelete" ? typeof row.deleted_at !== "string" : row.deleted_at !== null) ||
            (mutation.before !== null && (mutation.before[primary] !== row[primary] || mutation.before[foreign] !== row[foreign])))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          expected.push(id);
        }
        if (command === "linkCreate" && call.toLifecycle !== lifecycleCursor)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const seen = new Set<number>();
        for (const change of lifecycle.slice(lifecycleCursor, call.toLifecycle)) {
          if (change.table !== tableName || change.operation !== (command === "linkDismiss" || command === "linkDelete" ? "softDelete" : "restore") ||
            typeof change.key[primary] !== "string" || typeof change.key[foreign] !== "string" ||
            Object.keys(change.key).length !== 2 ||
            (command === "linkDismiss" || command === "linkDelete" ? change.beforeDeletedAt !== null || typeof change.afterDeletedAt !== "string"
              : change.afterDeletedAt !== null || (change.attemptOrdinal !== null && typeof change.beforeDeletedAt !== "string")))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          if (change.attemptOrdinal === null) {
            if (command !== "linkRestore" || change.beforeDeletedAt !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
            const row = change.rowAtOperation;
            const id = row?.id;
            if (row === null || row[primary] !== change.key[primary] || row[foreign] !== change.key[foreign] ||
              row.deleted_at !== null || typeof id !== "string")
              return yield* Effect.fail(commerceError("receiptMismatch"));
            expected.push(id);
            continue;
          }
          const mutation = mutations[change.attemptOrdinal];
          if (change.attemptOrdinal < cursor || change.attemptOrdinal >= call.toAttempt ||
            mutation === undefined || seen.has(change.attemptOrdinal) || mutation.after === null || mutation.before === null ||
            mutation.after[primary] !== change.key[primary] || mutation.after[foreign] !== change.key[foreign] ||
            mutation.before.deleted_at !== change.beforeDeletedAt || mutation.after.deleted_at !== change.afterDeletedAt)
            return yield* Effect.fail(commerceError("receiptMismatch"));
          seen.add(change.attemptOrdinal);
        }
        if (command !== "linkCreate" && seen.size !== call.toAttempt - cursor)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const event of call.events) {
          const message = yield* capture(event);
          if (message.metadata.action !== expectedAction) return yield* Effect.fail(commerceError("receiptMismatch"));
          for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
            const index = expected.indexOf(id);
            if (index === -1) return yield* Effect.fail(commerceError("receiptMismatch"));
            expected.splice(index, 1);
          }
        }
        if (expected.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
        cursor = call.toAttempt;
        lifecycleCursor = call.toLifecycle;
      }
      if (cursor !== mutations.length || lifecycleCursor !== lifecycle.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
    });
  return { capture, validateLogical };
}

/** One native router may touch several admitted Link tables, but each borrowed
 * call must remain in one family. Project its ordered evidence into the exact
 * single-Link receipts without dropping or reordering a mutation or event. */
export function selectedLinkLogicalEventPolicy(definitions: readonly {
  readonly tableName: string; readonly serviceName: string; readonly entityName: string;
  readonly endpoints: readonly [string, string];
}[]) {
  const selected = definitions.map(definition => ({ ...definition,
    policy: linkLogicalEventPolicy(definition.tableName, definition.serviceName,
      definition.entityName, definition.endpoints) }));
  const valid = selected.length > 0 && new Set(selected.map(item => item.tableName)).size === selected.length
    && new Set(selected.map(item => item.serviceName)).size === selected.length
    && new Set(selected.map(item => item.entityName)).size === selected.length;
  const decodeIdentity = Schema.decodeUnknownEffect(Schema.Struct({
    name: Schema.String, metadata: Schema.Struct({ source: Schema.String, object: Schema.String, action: Schema.String }),
    data: Schema.Unknown,
  }));
  const identify = Effect.fn("LinkEvents.identifyLogical")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input, defaultCommerceResources));
    const identity = yield* decodeIdentity(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    const member = selected.find(item => item.serviceName === identity.metadata.source
      && item.entityName === identity.metadata.object);
    if (!valid || member === undefined) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { member, message: yield* member.policy.capture(value) };
  });
  const capture = Effect.fn("LinkEvents.captureSelectedLogical")((input: unknown) =>
    identify(input).pipe(Effect.map(value => value.message)));
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("LinkEvents.validateSelectedLogical")(
    function* (calls, mutations, lifecycle, observedRows) {
      if (!valid || mutations.some((mutation, ordinal) => mutation.ordinal !== ordinal
        || !selected.some(item => item.tableName === mutation.table))
        || lifecycle.some(change => !selected.some(item => item.tableName === change.table))
        || observedRows.some(row => !selected.some(item => item.tableName === row.table)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      let attemptCursor = 0, lifecycleCursor = 0;
      const eventsByCall: Array<Map<string, Json[]>> = [];
      for (const call of calls) {
        if (call.fromAttempt !== attemptCursor || call.fromLifecycle !== lifecycleCursor
          || call.toAttempt < attemptCursor || call.toAttempt > mutations.length
          || call.toLifecycle < lifecycleCursor || call.toLifecycle > lifecycle.length)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const touched = new Set([...mutations.slice(attemptCursor, call.toAttempt).map(item => item.table),
          ...lifecycle.slice(lifecycleCursor, call.toLifecycle).map(item => item.table)]);
        const messages = new Map<string, Json[]>();
        for (const event of call.events) {
          const { member, message } = yield* identify(event);
          touched.add(member.tableName);
          const events = messages.get(member.tableName) ?? [];
          events.push(message); messages.set(member.tableName, events);
        }
        if (touched.size > 1 || (call.mode === "read" && touched.size !== 0))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        eventsByCall.push(messages);
        attemptCursor = call.toAttempt; lifecycleCursor = call.toLifecycle;
      }
      if (attemptCursor !== mutations.length || lifecycleCursor !== lifecycle.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const member of selected) {
        const tableName = member.tableName;
        const ordinals = new Map(mutations.filter(item => item.table === tableName)
          .map((item, ordinal) => [item.ordinal, ordinal]));
        const projectedMutations = mutations.filter(item => item.table === tableName)
          .map((item, ordinal) => ({ ...item, ordinal }));
        const projectedLifecycle = [];
        for (const change of lifecycle.filter(item => item.table === tableName)) {
          const ordinal = change.attemptOrdinal === null ? null : ordinals.get(change.attemptOrdinal);
          if (ordinal === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
          projectedLifecycle.push({ ...change, attemptOrdinal: ordinal });
        }
        const countAttempts = (until: number) => mutations.slice(0, until).filter(item => item.table === tableName).length;
        const countLifecycle = (until: number) => lifecycle.slice(0, until).filter(item => item.table === tableName).length;
        const projectedCalls = calls.map((call, index) => ({ ...call,
          fromAttempt: countAttempts(call.fromAttempt), toAttempt: countAttempts(call.toAttempt),
          fromLifecycle: countLifecycle(call.fromLifecycle), toLifecycle: countLifecycle(call.toLifecycle),
          events: eventsByCall[index]?.get(tableName) ?? [],
        }));
        yield* member.policy.validateLogical(projectedCalls, projectedMutations, projectedLifecycle,
          observedRows.filter(item => item.table === tableName), []);
      }
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
