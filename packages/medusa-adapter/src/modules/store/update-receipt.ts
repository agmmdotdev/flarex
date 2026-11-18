import { Effect, Result, Schema } from "effect";
import { StoreModuleService } from "@medusajs/store/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { hasChangedFields } from "@medusajs/drizzle/mutation-plan";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { projectRows } from "../../query/projection";
import { assembleCommerceRelations } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { StoreUpdateReadInput, decodeStoreUpdateInput, decodeStoreUpdateUpserts } from "./update-input";
import { storeUpdatePreimageSelection } from "./update-query";
import type { prepareStoreUpdateRepository } from "./update-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareStoreUpdateRepository>>;
type IdentifiedRow = JsonObject & Readonly<{ id: string }>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeRead = commerceDecoder(StoreUpdateReadInput, "receiptMismatch");
const decodeChildren = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)), "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.STORE), object: Schema.Literals(["store", "store_currency", "store_locale"]),
    action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);
const key = (table: string, id: string) => JSON.stringify([table, id]);
const withoutManaged = (row: JsonObject): Record<string, Json> => Object.fromEntries(Object.entries(row).filter(([field]) =>
  !["created_at", "updated_at", "deleted_at", "supported_currencies", "supported_locales"].includes(field)));

/** Correlates the actual complete historical cohort, exact replacement effects,
 * returned graph/projection and native performed-action events. Core alone
 * authenticates deletion history and managed-field reconstitution; this receipt
 * checks the resulting business/owner fields against the native DTO. */
export function storeUpdatePolicy(prepared: Prepared) {
  const { contracts, graph } = prepared, { creation } = contracts, { lifecycle } = creation;
  const byTable = new Map(lifecycle.entities.map(entity => [entity.table.name, entity]));
  const capture = Effect.fn("StoreUpdate.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.STORE, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("StoreUpdate.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const initial = new Map<string, Map<string, IdentifiedRow>>();
    const decodeRow = Effect.fn("StoreUpdate.decodeReceiptRow")(function* (table: string, value: JsonObject) {
      const entity = byTable.get(table);
      if (entity === undefined) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(value)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string") return yield* Effect.fail(mismatch());
      const identified: IdentifiedRow = { ...row, id: row.id };
      return identified;
    });
    for (const observation of activity.observedRows) {
      const row = yield* decodeRow(observation.table, observation.row), rows = initial.get(observation.table) ?? new Map<string, IdentifiedRow>();
      rows.set(row.id, row); initial.set(observation.table, rows);
    }
    const changed = new Map<string, typeof activity.mutations[number]>(), first = new Set<string>();
    let priorPhase = -1;
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      if (mutation.ordinal !== ordinal || mutation.operation === "replace" || mutation.before === null && mutation.after === null)
        return yield* Effect.fail(mismatch());
      const value = mutation.after ?? mutation.before;
      if (value === null) return yield* Effect.fail(mismatch());
      const row = yield* decodeRow(mutation.table, value);
      const tableOrder = lifecycle.entities.findIndex(entity => entity.table.name === mutation.table);
      const phase = mutation.operation === "delete" ? 2 - tableOrder : mutation.operation === "insert" ? 3 + tableOrder : 6 + tableOrder;
      if (phase < priorPhase || mutation.operation === "delete" && mutation.table === lifecycle.store.name ||
        mutation.operation === "insert" && mutation.table === lifecycle.store.name) return yield* Effect.fail(mismatch());
      priorPhase = phase;
      const token = key(mutation.table, row.id);
      if (changed.has(token)) return yield* Effect.fail(mismatch());
      changed.set(token, mutation);
      const rows = initial.get(mutation.table) ?? new Map<string, IdentifiedRow>();
      if (mutation.operation === "insert") {
        if (mutation.before !== null || mutation.after === null) return yield* Effect.fail(mismatch());
        rows.delete(row.id);
      } else {
        if (mutation.before === null || mutation.operation === "delete" && mutation.after !== null || mutation.operation === "patch" && mutation.after === null)
          return yield* Effect.fail(mismatch());
        const before = yield* decodeRow(mutation.table, mutation.before);
        if (before.id !== row.id) return yield* Effect.fail(mismatch());
        if (!first.has(token)) rows.set(row.id, before);
      }
      first.add(token); initial.set(mutation.table, rows);
    }
    for (const entity of lifecycle.entities) if ((initial.get(entity.table.name)?.size ?? 0) > entity.maximum)
      return yield* Effect.fail(mismatch());
    const roots = [...initial.get(lifecycle.store.name)?.values() ?? []].flatMap((row): Array<JsonObject & { readonly id: string }> =>
      typeof row.id === "string" ? [{ ...row, id: row.id }] : []);
    const rootIds = new Set(roots.map(row => row.id));
    const activeRoots = roots.filter(row => row.deleted_at === null), activeRootIds = new Set(activeRoots.map(row => row.id));
    for (const child of [lifecycle.currency, lifecycle.locale]) for (const row of initial.get(child.name)?.values() ?? [])
      if (typeof row.store_id !== "string" || !rootIds.has(row.store_id)) return yield* Effect.fail(mismatch());
    if (call.commandName === "storeListForUpdate") {
      if (call.mode !== "read" || activity.mutations.length || call.events.length)
        return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeRead(call.input));
      const requested = typeof input.filters.id === "string" ? [input.filters.id] : input.filters.id;
      if (roots.some(row => !requested.includes(row.id))) return yield* Effect.fail(mismatch());
      const config = yield* Effect.fromResult(storeUpdatePreimageSelection(input.config ?? {}, prepared.read))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const envelope = yield* Effect.fromResult(captureCommerceInput({ where: input.filters, options: {
        fields: config.select, populate: config.relations,
      } }));
      const plan = yield* Effect.fromResult(prepared.query(envelope)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const state = new Map<string, readonly JsonObject[]>();
      state.set(lifecycle.store.name, orderNativeIdRows(activeRoots, input.filters));
      for (const child of [lifecycle.currency, lifecycle.locale]) {
        // Core observes complete indexed candidate bodies, including older
        // tombstones, before native visibility/projection. Retain that evidence
        // above; only active rows populate the expected native DTO.
        const rows = [...initial.get(child.name)?.values() ?? []].filter(row => row.deleted_at === null &&
          typeof row.store_id === "string" && activeRootIds.has(row.store_id));
        if (activeRoots.some(root => rows.filter(row => row.store_id === root.id).length > 2))
          return yield* Effect.fail(mismatch());
        const identified: Array<JsonObject & { readonly id: string }> = [];
        for (const row of rows) {
          if (typeof row.id !== "string") return yield* Effect.fail(mismatch());
          identified.push({ ...row, id: row.id });
        }
        // Activity order is internal document identity order. Native relation
        // population instead requests ascending public id before grouping.
        state.set(child.name, orderNativeIdRows(identified, {}));
      }
      const assembled = (yield* Effect.fromResult(assembleCommerceRelations(lifecycle.store.name, state, plan.paths, graph.catalog.queryRelations)));
      const expected = yield* Effect.fromResult(projectRows(assembled, plan.fields.node)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const output = yield* Effect.fromResult(contracts.decodePreimages(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (!jsonEqual(expected, output)) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "write" || call.commandName !== "storeUpdateForWorkflow" && call.commandName !== "storeUpsertForUpdateInverse")
      return yield* Effect.fail(mismatch());
    const raw = call.commandName === "storeUpdateForWorkflow"
      ? yield* Effect.fromResult(decodeStoreUpdateInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)), Effect.map(input => {
        const requested = typeof input.selector.id === "string" ? [input.selector.id] : input.selector.id;
        return { rows: orderNativeIdRows(activeRoots, input.selector).map(row => ({ id: row.id, ...input.update })), requested };
      }))
      : yield* Effect.fromResult(decodeStoreUpdateUpserts(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)),
        Effect.map(rows => ({ rows, requested: rows.map(row => row.id) })));
    if (roots.some(row => !raw.requested.includes(row.id)) ||
      call.commandName === "storeUpsertForUpdateInverse" && roots.some(row => row.deleted_at !== null) ||
      new Set(raw.rows.map(row => row.id)).size !== raw.rows.length)
      return yield* Effect.fail(mismatch());
    // The inverse DTO decoder requires the same child fields consumed by the
    // native normalizer. Read-only partial projections remain separate. Native
    // normalization runs unchanged on a structurally compatible typed input.
    const normalized = StoreModuleService.normalizeInput(raw.rows);
    const inputs = yield* Effect.fromResult(decodeStoreUpdateUpserts(normalized)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const output = yield* Effect.fromResult(creation.decodeRows(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    if (output.length !== inputs.length || activeRoots.length !== inputs.length) return yield* Effect.fail(mismatch());
    const final = new Map<string, Map<string, JsonObject>>([...initial].map(([table, rows]) => [table, new Map(rows)]));
    for (const [field, child] of [["supported_currencies", lifecycle.currency], ["supported_locales", lifecycle.locale]] as const) {
      const omitted = new Set(inputs.filter(input => input[field] === undefined).map(input => input.id));
      if (!omitted.size) continue;
      const before = [...initial.get(child.name)?.values() ?? []];
      const retained = (row: IdentifiedRow) => typeof row.store_id === "string" && omitted.has(row.store_id);
      // Replacement hydrates an omitted family through its ordered core load;
      // no child plans/writes reorder those roots' members. Keep provided
      // families in their existing order and replay write mutations below.
      const ordered = [...before.filter(row => !retained(row)), ...orderNativeIdRows(before.filter(retained), {})];
      final.set(child.name, new Map(ordered.map(row => [row.id, row])));
    }
    for (const mutation of activity.mutations) {
      const value = mutation.after ?? mutation.before;
      if (value === null || typeof value.id !== "string") return yield* Effect.fail(mismatch());
      const rows = final.get(mutation.table) ?? new Map<string, JsonObject>();
      rows.delete(value.id);
      if (mutation.after !== null) rows.set(value.id, projectNativeRow(mutation.after));
      final.set(mutation.table, rows);
    }
    const pending = new Set(changed.keys());
    const consume = (table: string, id: string, operation: "insert" | "patch" | "delete") => {
      const token = key(table, id), mutation = changed.get(token);
      if (mutation?.operation !== operation || !pending.delete(token)) return Result.fail(mismatch());
      return Result.succeed(mutation);
    };
    for (const [index, supplied] of inputs.entries()) {
      const id = supplied.id, dto = output[index];
      if (typeof id !== "string" || dto?.id !== id) return yield* Effect.fail(mismatch());
      const before = initial.get(lifecycle.store.name)?.get(id), after = final.get(lifecycle.store.name)?.get(id);
      if (before === undefined || after === undefined || typeof after.updated_at !== "string") return yield* Effect.fail(mismatch());
      yield* Effect.fromResult(consume(lifecycle.store.name, id, "patch"));
      for (const field of ["created_at", "updated_at", "deleted_at"] as const) if (supplied[field] !== undefined && supplied[field] !== before[field])
        return yield* Effect.fail(mismatch());
      if (!jsonEqual(after, { ...before, ...withoutManaged(supplied), updated_at: after.updated_at })) return yield* Effect.fail(mismatch());
      for (const [field, child] of [["supported_currencies", lifecycle.currency], ["supported_locales", lifecycle.locale]] as const) {
        const wanted = supplied[field], prior = [...initial.get(child.name)?.values() ?? []].filter(row => row.store_id === id);
        const returned = yield* Effect.fromResult(decodeChildren(dto[field]));
        const members = [...final.get(child.name)?.values() ?? []].filter(row => row.store_id === id && row.deleted_at === null);
        if (members.length > 2 || !jsonEqual(members, returned)) return yield* Effect.fail(mismatch());
        if (wanted === undefined) {
          if (!jsonEqual(members, orderNativeIdRows(prior.filter(row => row.deleted_at === null), {}))) return yield* Effect.fail(mismatch());
          continue;
        }
        const selected = new Set<string>();
        for (const request of wanted) {
          const captured = yield* Effect.fromResult(captureCommerceInput(request));
          if (!isJsonObject(captured)) return yield* Effect.fail(mismatch());
          if (captured.store_id !== undefined && captured.store_id !== id) return yield* Effect.fail(mismatch());
          const before = typeof captured.id === "string" ? prior.find(row => row.id === captured.id) : undefined;
          const row = typeof captured.id === "string" ? members.find(row => row.id === captured.id) : members.find(row =>
            typeof row.id === "string" && !selected.has(row.id) && changed.get(key(child.name, row.id))?.operation === "insert" &&
            Object.entries(withoutManaged(captured)).every(([name, value]) => name === "id" || row[name] !== undefined && jsonEqual(row[name], value)));
          if (row === undefined || typeof row.id !== "string" || typeof row.created_at !== "string" || typeof row.updated_at !== "string" ||
            selected.has(row.id) || row.store_id !== id || row.deleted_at !== null)
            return yield* Effect.fail(mismatch());
          selected.add(row.id);
          if (before === undefined) {
            yield* Effect.fromResult(consume(child.name, row.id, "insert"));
            const expected: JsonObject = { ...creation.defaults.get(child.name), ...captured, id: row.id, store_id: id,
              created_at: captured.created_at ?? row.created_at, updated_at: row.updated_at, deleted_at: null };
            if (!jsonEqual(row, expected) || captured.created_at === undefined && row.created_at !== row.updated_at)
              return yield* Effect.fail(mismatch());
          } else {
            if (before.deleted_at !== null) return yield* Effect.fail(mismatch());
            for (const field of ["created_at", "updated_at", "deleted_at"]) if (captured[field] !== undefined && captured[field] !== before[field])
              return yield* Effect.fail(mismatch());
            const scalar: Record<string, Json> = { ...withoutManaged(captured), id: row.id };
            delete scalar.store_id;
            const changedFields = hasChangedFields(before, scalar, ["id"]);
            if (changedFields) yield* Effect.fromResult(consume(child.name, row.id, "patch"));
            if (!jsonEqual(row, { ...before, ...scalar, ...(changedFields ? { updated_at: row.updated_at } : {}) })) return yield* Effect.fail(mismatch());
          }
        }
        if (members.length !== selected.size) return yield* Effect.fail(mismatch());
        for (const row of prior) if (typeof row.id === "string" && !selected.has(row.id)) yield* Effect.fromResult(consume(child.name, row.id, "delete"));
      }
    }
    if (pending.size) return yield* Effect.fail(mismatch());
    const state = new Map([...final].map(([table, rows]) => [table, [...rows.values()].filter(row => row.deleted_at === null)]));
    const finalRoots: JsonObject[] = [];
    for (const row of output) {
      const root = typeof row.id === "string" ? final.get(lifecycle.store.name)?.get(row.id) : undefined;
      if (root === undefined) return yield* Effect.fail(mismatch());
      finalRoots.push(root);
    }
    state.set(lifecycle.store.name, finalRoots);
    const expected = (yield* Effect.fromResult(assembleCommerceRelations(lifecycle.store.name, state, ["supported_currencies", "supported_locales"], graph.catalog.queryRelations)));
    if (!jsonEqual(expected, output)) return yield* Effect.fail(mismatch());
    const expectedEvents = (["insert", "patch", "delete"] as const).flatMap(operation => activity.mutations.filter(mutation => mutation.operation === operation).map(mutation => ({
      object: mutation.table, action: operation === "insert" ? "created" : operation === "patch" ? "updated" : "deleted", id: (mutation.after ?? mutation.before)?.id,
    })));
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = expectedEvents[emitted++];
        if (expected === undefined || expected.object !== message.metadata.object || expected.action !== message.metadata.action || expected.id !== id)
          return yield* Effect.fail(mismatch());
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}
