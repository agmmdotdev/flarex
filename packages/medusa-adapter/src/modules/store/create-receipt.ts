import { Effect, Result, Schema } from "effect";
import { StoreModuleService } from "@medusajs/store/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { matchesPublicRow, projectNativeRow } from "../../repository/result";
import { moduleEventDecoder } from "../../module/events";
import { decodeStoreCreates, decodeStorePhysicalDeletionIds, type compileStoreCreationContracts } from "./create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileStoreCreationContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.STORE), object: Schema.Literals(["store", "store_currency", "store_locale"]),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);

/** Native invocation owns validation. Receipts reuse its exact pure normalization
 * and checked DML defaults to authenticate complete ordered Store/child DTOs.
 * The retained physical inverse deletes full history and emits Store roots only. */
export function storeCreationPolicy(contracts: Contracts) {
  const { lifecycle } = contracts;
  const byTable = new Map(lifecycle.entities.map(entity => [entity.table.name, entity]));
  const capture = Effect.fn("StoreCreate.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.STORE, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("StoreCreate.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    const creating = call.commandName === "storeCreateForWorkflow";
    if (!creating && call.commandName !== "storePhysicalDeleteForWorkflow" || call.mode !== "write" ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const orderedEvents: Array<Readonly<{ object: string; id: string }>> = [];
    if (creating) {
      const raw = yield* Effect.fromResult(decodeStoreCreates(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      // The only native fork seam changes this existing method's visibility.
      // Its method body and successful Store invocation remain genuine Medusa.
      const inputs = StoreModuleService.normalizeInput(raw);
      const results = yield* Effect.fromResult(contracts.decodeRows(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (inputs.length !== results.length) return yield* Effect.fail(mismatch());
      const inserted = new Map<string, JsonObject[]>();
      const identities = new Set<string>();
      let previousTable = -1;
      for (const [ordinal, mutation] of activity.mutations.entries()) {
        const entity = byTable.get(mutation.table), row = mutation.after;
        const tableOrder = lifecycle.entities.findIndex(entity => entity.table.name === mutation.table);
        if (entity === undefined || mutation.ordinal !== ordinal || mutation.operation !== "insert" || mutation.before !== null || row === null ||
          typeof row.id !== "string" || row.deleted_at !== null || tableOrder < previousTable)
          return yield* Effect.fail(mismatch());
        previousTable = tableOrder;
        const decoded = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(row))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const identity = JSON.stringify([mutation.table, row.id]);
        if (identities.has(identity) || decoded.created_at !== decoded.updated_at) return yield* Effect.fail(mismatch());
        identities.add(identity);
        const rows = inserted.get(mutation.table) ?? []; rows.push(row); inserted.set(mutation.table, rows);
        if (rows.length > entity.maximum) return yield* Effect.fail(mismatch());
        orderedEvents.push({ object: mutation.table, id: row.id });
      }
      for (const observation of activity.observedRows) {
        const rows = inserted.get(observation.table), id = observation.row.id;
        const selected = rows?.find(row => row.id === id);
        if (selected === undefined || !jsonEqual(projectNativeRow(observation.row), projectNativeRow(selected)))
          return yield* Effect.fail(mismatch());
      }
      const roots = inserted.get(lifecycle.store.name) ?? [];
      if (roots.length !== inputs.length) return yield* Effect.fail(mismatch());
      const matchedChildren = new Set<string>();
      for (const [index, input] of inputs.entries()) {
        const result = results[index], root = roots[index];
        if (result === undefined || root === undefined || typeof root.id !== "string") return yield* Effect.fail(mismatch());
        const { supported_currencies, supported_locales, ...scalars } = result;
        const { supported_currencies: inputCurrencies, supported_locales: inputLocales, ...supplied } = input;
        if (!matchesPublicRow(root, scalars)) return yield* Effect.fail(mismatch());
        const expected: JsonObject = { ...contracts.defaults.get(lifecycle.store.name), ...supplied };
        for (const [field, value] of Object.entries(expected)) if (root[field] === undefined || !jsonEqual(root[field], value))
          return yield* Effect.fail(mismatch());
        for (const [entity, wanted, returned] of [[lifecycle.currency, inputCurrencies ?? [], supported_currencies],
          [lifecycle.locale, inputLocales ?? [], supported_locales]] as const) {
          const children = (inserted.get(entity.name) ?? []).filter(row => row.store_id === root.id);
          if (!Array.isArray(returned) || returned.length !== wanted.length || children.length !== wanted.length)
            return yield* Effect.fail(mismatch());
          for (const [childIndex, request] of wanted.entries()) {
            const row = children[childIndex], dto = returned[childIndex];
            if (row === undefined || dto === undefined || typeof row.id !== "string" || !matchesPublicRow(row, dto))
              return yield* Effect.fail(mismatch());
            const expected: JsonObject = { ...contracts.defaults.get(entity.name), ...request, store_id: root.id };
            for (const [field, value] of Object.entries(expected)) if (row[field] === undefined || !jsonEqual(row[field], value))
              return yield* Effect.fail(mismatch());
            matchedChildren.add(JSON.stringify([entity.name, row.id]));
          }
        }
      }
      if ((inserted.get(lifecycle.currency.name)?.length ?? 0) + (inserted.get(lifecycle.locale.name)?.length ?? 0) !== matchedChildren.size)
        return yield* Effect.fail(mismatch());
    } else {
      if (call.result !== null) return yield* Effect.fail(mismatch());
      const requested = new Set(yield* Effect.fromResult(decodeStorePhysicalDeletionIds(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))));
      const observed = new Map<string, Map<string, JsonObject>>();
      const record = Effect.fn("StoreCreate.observePhysicalInverse")(function* (table: string, value: JsonObject) {
        const entity = byTable.get(table);
        if (entity === undefined) return yield* Effect.fail(mismatch());
        const row = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(value))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (typeof row.id !== "string") return yield* Effect.fail(mismatch());
        const rows = observed.get(table) ?? new Map<string, JsonObject>(), prior = rows.get(row.id);
        if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
        rows.set(row.id, row); observed.set(table, rows);
      });
      for (const observation of activity.observedRows) yield* record(observation.table, observation.row);
      for (const mutation of activity.mutations) {
        if (mutation.before === null) return yield* Effect.fail(mismatch());
        yield* record(mutation.table, mutation.before);
      }
      const rootIds = new Set<string>();
      for (const row of observed.get(lifecycle.store.name)?.values() ?? []) {
        if (typeof row.id !== "string" || !requested.has(row.id)) return yield* Effect.fail(mismatch());
        rootIds.add(row.id);
      }
      const pending = new Set<string>();
      for (const entity of lifecycle.entities) {
        const rows = observed.get(entity.table.name) ?? new Map<string, JsonObject>();
        if (rows.size > entity.maximum) return yield* Effect.fail(mismatch());
        for (const [id, row] of rows) {
          if (entity.table !== lifecycle.store && (typeof row.store_id !== "string" || !rootIds.has(row.store_id)))
            return yield* Effect.fail(mismatch());
          pending.add(JSON.stringify([entity.table.name, id]));
        }
      }
      for (const [ordinal, mutation] of activity.mutations.entries()) {
        const row = mutation.before, id = row?.id;
        if (mutation.ordinal !== ordinal || mutation.operation !== "delete" || mutation.after !== null || row === null ||
          typeof id !== "string" || !pending.delete(JSON.stringify([mutation.table, id]))) return yield* Effect.fail(mismatch());
        if (mutation.table === lifecycle.store.name) {
          for (const child of [lifecycle.currency, lifecycle.locale]) for (const row of observed.get(child.name)?.values() ?? [])
            if (row.store_id === id && pending.has(JSON.stringify([child.name, row.id]))) return yield* Effect.fail(mismatch());
          orderedEvents.push({ object: lifecycle.store.name, id });
        }
      }
      if (pending.size) return yield* Effect.fail(mismatch());
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== (creating ? "created" : "deleted")) return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = orderedEvents[emitted++];
        if (expected === undefined || expected.object !== message.metadata.object || expected.id !== id)
          return yield* Effect.fail(mismatch());
      }
    }
    if (emitted !== orderedEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}
