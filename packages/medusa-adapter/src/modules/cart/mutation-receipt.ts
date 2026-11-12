import { Cause, Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName, mapObjectTo } from "@medusajs/framework/utils/portable";
import { buildModelsNameToLinkableKeysMap } from "@medusajs/utils/modules-sdk/build-models-name-to-linkable-keys-map";
import { prepareUpdateMetadata } from "@medusajs/utils/modules-sdk/prepare-update-metadata";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { cartStaticResources } from "@medusajs/cart/static-manifest";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlatePhysicalGraphReceipt } from "../../repository/physical-graph-receipt";
import { correlateLifecycleGraphReceipt } from "../../repository/lifecycle-graph-receipt";
import { correlateScalarCreateWrites } from "../../repository/scalar-create-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { moduleEventDecoder } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import { captureExactNumericRow } from "../../value/exact-numeric";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { captureCommerceInput } from "../../value/input";
import { captureGraph } from "../../write/create";
import { assembleCommerceRelations, commerceRelationReadQuery } from "../../query/relations";
import { cartPaymentReadPolicy } from "./payment-receipt";
import { decodeCartMutationUpdates, decodeCartMutationAddressUpdates, decodeCartMutationLineCreates,
  decodeCartMutationLineUpdate, decodeCartMutationIds } from "./mutation-input";
import { CartLineHistoryIds, decodeCartMutationTaxLines } from "./mutation-input";
import { hasChangedFields } from "@medusajs/drizzle/mutation-plan";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import type { prepareCartMutationRepository } from "./mutation-repository";
import { captureCartMutationLine } from "./mutation-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareCartMutationRepository>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeIds = commerceDecoder(Schema.Array(Id), "receiptMismatch");
const eventMetadata = { source: Schema.Literal(Modules.CART), action: Schema.Literals(["created", "updated", "deleted", "restored"]) };
const decode = moduleEventDecoder(Schema.Union([
  Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ ...eventMetadata, object: Schema.Literals(["cart", "address", "line_item"]) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 8))]) }) }),
  Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ ...eventMetadata, object: Schema.Literals(["line_item_tax_line", "line_item_adjustment"]) }),
    data: Schema.Struct({ id: Schema.Union([Id, CartLineHistoryIds]) }) }),
]), defaultCommerceResources);
export const captureCartMutationEvent = Effect.fn("CartMutation.captureEvent")(function* (input: unknown) {
  const event = yield* decode(input);
  if (event.name !== buildModuleResourceEventName({ prefix: Modules.CART, objectName: event.metadata.object, action: event.metadata.action }))
    return yield* commerceError("unadmittedEvent");
  return event;
});
const mismatch = (phase: string) => commerceError("receiptMismatch", { phase });
const same = (left: Json | undefined, right: Json | undefined) => left === undefined || right === undefined ? left === right : jsonEqual(left, right);
const receiptBoundary = <A, R>(work: Effect.Effect<A, CommerceTransactionError, R>) => work.pipe(Effect.catchCause(cause =>
  Effect.failCause(Cause.map(cause, failure => failure.reason === "receiptMismatch" ? failure : commerceError("receiptMismatch", failure)))));

/** Authenticate new native Cart commands against their complete Core facts.
 * Existing read, graph creation and lifecycle correlation remain shared owners. */
export function cartMutationPolicy(prepared: Prepared) {
  const { mutation } = prepared;
  const readPolicy = cartPaymentReadPolicy(prepared, "completion", { query: mutation.query });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("CartMutation.validateCall")(function* (call, activity) {
    if (["cartLineItemsCountForCheckout", "cartListLinesForMutations", "cartAddressesForMutations"].includes(call.commandName))
      return yield* readPolicy.validateLogicalCall(call, activity);
    if (call.mode !== "write" || activity.setNull.length || activity.referenceReplacements.length)
      return yield* mismatch("mode");
    const lifecycleNames = ["cartDeleteLinesForMutations", "cartSoftDeleteLinesForMutations", "cartRestoreLinesForMutations"];
    const lifecycle = lifecycleNames.includes(call.commandName);
    const byTable = new Map(prepared.entities.map(entity => [entity.table.name, entity]));
    const before = new Map<string, Map<string, JsonObject>>(), final = new Map<string, Map<string, JsonObject>>();
    const record = (target: typeof before, table: string, row: JsonObject) => Result.gen(function* () {
      const entity = byTable.get(table);
      if (entity === undefined) return yield* Result.fail(mismatch("table"));
      const checked = yield* entity.complete(projectNativeRow(row));
      if (typeof checked.id !== "string") return yield* Result.fail(mismatch("id"));
      const rows = target.get(table) ?? new Map<string, JsonObject>(), previous = rows.get(checked.id);
      if (previous !== undefined && !jsonEqual(previous, checked)) return yield* Result.fail(mismatch("observation"));
      rows.set(checked.id, checked); target.set(table, rows);
      if (rows.size > (lifecycle ? mutation.lifecycleMaximum(table) : table === mutation.address.table.name ? 8 : 4))
        return yield* Result.fail(mismatch("cohort"));
    });
    for (const observation of activity.observedRows) yield* Effect.fromResult(record(final, observation.table, observation.row));
    for (const [table, rows] of final) before.set(table, new Map(rows));
    for (const [ordinal, change] of activity.mutations.entries()) {
      if (change.ordinal !== ordinal) return yield* mismatch("ordinal");
      if (change.after !== null) {
        const checked = byTable.get(change.table);
        if (checked === undefined) return yield* mismatch("table");
        yield* Effect.fromResult(checked.complete(projectNativeRow(change.after)));
      }
    }
    for (const change of [...activity.mutations].reverse()) {
      const id = change.before?.id ?? change.after?.id;
      if (typeof id !== "string") return yield* mismatch("id");
      const rows = before.get(change.table) ?? new Map<string, JsonObject>();
      if (change.before === null) rows.delete(id);
      else {
        const entity = byTable.get(change.table);
        if (entity === undefined) return yield* mismatch("table");
        rows.set(id, yield* Effect.fromResult(entity.complete(projectNativeRow(change.before))));
      }
      before.set(change.table, rows);
    }
    const latestChanges = new Map(activity.mutations.flatMap(change => {
      const id = change.after?.id ?? change.before?.id;
      return typeof id === "string" ? [[change.table + ":" + id, change] as const] : [];
    }));
    for (const change of latestChanges.values()) if (change.after !== null) {
      if (typeof change.after.id !== "string") return yield* mismatch("managedIdentity");
      const observed = final.get(change.table)?.get(change.after.id);
      if (observed === undefined || !jsonEqual(observed, projectNativeRow(change.after)))
        return yield* mismatch("managedAfterimage");
    }
    const expectedEvents: Array<{ object: string; action: string; id: string }> = [];
    const entities = prepared.entities.map(entity => ({ ...entity, maximum: mutation.lifecycleMaximum(entity.table.name),
      decodeRow: entity.complete, linkableKey: entity.model }));
    if (call.commandName === "cartUpsertEmptyShippingTaxForMutations") {
      if (!jsonEqual(call.input, []) || !jsonEqual(call.result, []) || activity.mutations.length || activity.relationalReads.length || activity.observedRows.length || activity.lifecycle.length || call.events.length)
        return yield* mismatch("emptyShippingTax");
      return;
    } else if (call.commandName === "cartUpsertItemTaxForMutations") {
      const input = yield* Effect.fromResult(decodeCartMutationTaxLines(call.input)), tax = prepared.refresh.tax;
      if (activity.lifecycle.length || activity.mutations.some(change => change.table !== tax.table.name || change.after === null || change.operation !== "insert" && change.operation !== "patch"))
        return yield* mismatch("taxUpsertShape");
      const explicit = input.flatMap(row => row.id === undefined ? [] : [row.id]);
      const existing = [...before.get(tax.table.name)?.values() ?? []].filter(row => typeof row.id === "string" && explicit.includes(row.id) && row.deleted_at === null);
      const existingIds = yield* Effect.fromResult(decodeIds(existing.map(row => row.id)));
      const expectedReads = explicit.length ? [{ table: tax.table.name, query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "and", children: [{ kind: "in", column: "id", values: explicit }, { kind: "isNull", column: "deleted_at" }] }, "id", { includeIdentities: true }),
        total: existing.length, returned: existing.length, orderedIdentities: orderNativeIdRows(existingIds.map(id => ({ id })), {}) }] : [];
      if (!jsonEqual(activity.relationalReads, expectedReads)) return yield* mismatch("taxUpsertReads");
      const byId = new Map(existing.map(row => [row.id, row]));
      const creates = input.filter(row => row.id === undefined || !byId.has(row.id));
      const updates = input.filter(row => row.id !== undefined && byId.has(row.id));
      const inserted: Array<JsonObject & { readonly id: string }> = [];
      for (const change of activity.mutations) if (change.operation === "insert") {
        if (change.after === null || typeof change.after.id !== "string") return yield* mismatch("taxUpsertId");
        inserted.push({ ...projectNativeRow(change.after), id: change.after.id });
      }
      const normalizedCreates: JsonObject[] = [];
      for (const row of creates) normalizedCreates.push(yield* captureExactNumericRow(row, tax.numbers, false, "nativeRaw"));
      const correlated = yield* Effect.fromResult(correlateScalarCreateWrites(normalizedCreates, inserted));
      const target = prepared.entities.find(entity => entity.table.name === tax.table.name);
      if (target === undefined) return yield* mismatch("taxUpsertTable");
      const graph = yield* captureGraph({ catalog: prepared.creationCatalog, root: { entity: target.graph, steps: [], omitRelations: [] },
        rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }) }, correlated.inputs, defaultCommerceResources);
      const expected = graph.rows.get(tax.table.name) ?? [];
      if (inserted.length !== expected.length) return yield* mismatch("taxUpsertInsertCount");
      for (const [index, row] of inserted.entries()) {
        const supplied = expected[index];
        if (supplied === undefined || row.created_at !== row.updated_at || row.deleted_at !== null) return yield* mismatch("taxUpsertManaged");
        for (const column of tax.table.columns) if (!["created_at", "updated_at", "deleted_at"].includes(column.name) &&
          !same(row[column.name] ?? null, supplied[column.name] ?? column.defaultValue ?? null)) return yield* mismatch("taxUpsertInsertField");
        expectedEvents.push({ object: "line_item_tax_line", action: "created", id: row.id });
      }
      const merged = new Map<string, JsonObject>();
      for (const row of updates) {
        if (row.id === undefined) return yield* mismatch("taxUpsertId");
        merged.set(row.id, { ...merged.get(row.id), ...row });
      }
      const changes = activity.mutations.filter(change => change.operation === "patch");
      const changedIds = new Set<string>();
      for (const [id, row] of merged) {
        const previous = byId.get(id);
        if (previous === undefined) return yield* mismatch("taxUpsertBefore");
        if (!hasChangedFields(previous, row, ["id"])) continue;
        const change = changes[changedIds.size];
        if (change?.before === null || change?.before === undefined || change.after === null || change.after.id !== id) return yield* mismatch("taxUpsertPatch");
        const { updated_at: _time, ...after } = projectNativeRow(change.after), { updated_at: _oldTime, ...before } = previous;
        if (!jsonEqual(after, { ...before, ...row })) return yield* mismatch("taxUpsertPatchField");
        changedIds.add(id); expectedEvents.push({ object: "line_item_tax_line", action: "updated", id });
      }
      if (changes.length !== changedIds.size) return yield* mismatch("taxUpsertPatchCount");
      const latest = new Map([...existing, ...changes.flatMap(change => change.after === null ? [] : [projectNativeRow(change.after)])].map(row => [row.id, row]));
      const returned: JsonObject[] = correlated.positions.map(position => correlated.results[position]!);
      for (const row of updates) {
        const value = latest.get(row.id);
        if (value === undefined) return yield* mismatch("taxUpsertResultRow");
        returned.push(value);
      }
      const observed = new Map([...inserted, ...latest.values()].map(row => [row.id, row]));
      for (const observation of activity.observedRows) {
        const row = observed.get(observation.row.id);
        if (observation.table !== tax.table.name || row === undefined || !jsonEqual(row, projectNativeRow(observation.row))) return yield* mismatch("taxUpsertObservation");
      }
      if (!jsonEqual(call.result, yield* prepared.present(returned, tax.table.name))) return yield* mismatch("taxUpsertResult");
    } else if (lifecycleNames.includes(call.commandName)) {
      const requested = yield* Effect.fromResult(decodeCartMutationIds(call.input));
      if (call.commandName === "cartDeleteLinesForMutations") {
        if (activity.lifecycle.length) return yield* mismatch("physicalLifecycle");
        const ids = yield* Effect.fromResult(correlatePhysicalGraphReceipt({ tables: mutation.lifecycleTables,
          entities: entities.filter(entity => mutation.lifecycleTables.includes(entity.table)),
          root: mutation.line.table, requestedIds: requested, activity }));
        if (call.result !== null) return yield* mismatch("deleteResult");
        expectedEvents.push(...ids.map(id => ({ object: "line_item", action: "deleted", id })));
      } else {
        const operation = call.commandName === "cartSoftDeleteLinesForMutations" ? "softDelete" : "restore";
        const evidence = before;
        const selected = new Map<string, Set<string>>();
        const roots = [...before.get(mutation.line.table.name)?.values() ?? []].filter(row => typeof row.id === "string" && requested.includes(row.id) &&
          (operation === "restore" || row.deleted_at === null));
        const expectedReads: JsonObject[] = [];
        if (requested.length) expectedReads.push({ table: mutation.line.table.name,
          query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: requested }),
          total: before.get(mutation.line.table.name)?.size ?? 0, returned: before.get(mutation.line.table.name)?.size ?? 0 });
        const visit = (entity: typeof mutation.line, row: JsonObject): Result.Result<void, ReturnType<typeof commerceError>> => Result.gen(function* () {
          if (typeof row.id !== "string") return yield* Result.fail(mismatch("lifecycleId"));
          const ids = selected.get(entity.table.name) ?? new Set<string>();
          if (ids.has(row.id)) return;
          ids.add(row.id); selected.set(entity.table.name, ids);
          for (const relation of entity.table.relationships.filter(relation => relation.cascadeDelete)) {
            const child = prepared.entities.find(candidate => candidate.table.name === relation.targetTable);
            const key = child?.table.foreignKeys.find(key => key.referencedTable === entity.table.name);
            if (child === undefined || key?.columns.length !== 1 || key.columns[0] === undefined) return yield* Result.fail(mismatch("lifecycleEdge"));
            const column = key.columns[0], rows = [...before.get(child.table.name)?.values() ?? []].filter(child => child[column] === row.id);
            expectedReads.push({ table: child.table.name, query: commerceRelationReadQuery(defaultCommerceResources,
              { kind: "in", column, values: [row.id] }), total: rows.length, returned: rows.length });
            for (const member of rows) yield* visit(child, member);
          }
        });
        for (const row of roots) yield* Effect.fromResult(visit(mutation.line, row));
        if (!jsonEqual(expectedReads, activity.relationalReads)) return yield* mismatch("lifecycleReads");
        const nativeMap: Record<string, string[]> = {};
        for (const transition of activity.lifecycle) {
          const entity = byTable.get(transition.table), id = transition.key.id;
          if (entity === undefined || typeof id !== "string") return yield* mismatch("lifecycleIdentity");
          const ids = nativeMap[entity.model] ?? []; ids.push(id); nativeMap[entity.model] = ids;
        }
        const proof = yield* Effect.fromResult(correlateLifecycleGraphReceipt({ entities, rootTable: mutation.line.table.name,
          selectedRootIds: new Set(roots.flatMap(row => typeof row.id === "string" ? [row.id] : [])), operation, activity, evidence, selected, result: nativeMap }));
        const joiner = cartStaticResources.joinerConfig;
        if (joiner === undefined) return yield* mismatch("joiner");
        const dtoMap = Object.fromEntries([...proof.ordered].flatMap(([table, ids]) => {
          const entity = byTable.get(table);
          return entity === undefined ? [] : [[entity.model, ids.map(id => ({ id }))]];
        }));
        const expected = mapObjectTo(dtoMap, buildModelsNameToLinkableKeysMap(joiner.linkableKeys ?? {}));
        if (!jsonEqual(call.result, expected)) return yield* mismatch("lifecycleResult");
        if (operation === "softDelete") for (const event of proof.events) {
          const original = before.get(event.object)?.get(event.id);
          if (original === undefined) return yield* mismatch("lifecycleEventPreimage");
          expectedEvents.push({ object: event.object.replace(/^cart_/, ""), action: original.deleted_at === null ? "deleted" : "updated", id: event.id });
        }
      }
    } else if (call.commandName === "cartAddLinesForMutations") {
      const input = yield* Effect.fromResult(decodeCartMutationLineCreates(call.input));
      if (activity.lifecycle.length || activity.relationalReads.length || activity.mutations.some(change => change.operation !== "insert" || change.table !== mutation.line.table.name || change.after === null))
        return yield* mismatch("createShape");
      const normalized: JsonObject[] = [];
      for (const row of input) normalized.push(yield* captureExactNumericRow(row, mutation.line.numbers, false, "nativeRaw"));
      const written: Array<JsonObject & { readonly id: string }> = [];
      for (const change of activity.mutations) {
        if (change.after === null || typeof change.after.id !== "string") return yield* mismatch("createIdentity");
        written.push({ ...projectNativeRow(change.after), id: change.after.id });
      }
      const correlated = yield* Effect.fromResult(correlateScalarCreateWrites(normalized, written));
      const graph = yield* captureGraph({ catalog: prepared.creationCatalog, root: prepared.lineNode,
        rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }) }, correlated.inputs, defaultCommerceResources);
      const expected = graph.rows.get(mutation.line.table.name) ?? [];
      if (expected.length !== written.length) return yield* mismatch("createCount");
      for (const [index, row] of written.entries()) {
        const supplied = expected[index];
        if (supplied === undefined || row.deleted_at !== null || row.created_at !== row.updated_at) return yield* mismatch("createManaged");
        for (const column of mutation.line.table.columns) if (!["created_at", "updated_at", "deleted_at"].includes(column.name) &&
          !jsonEqual(row[column.name] ?? null, supplied[column.name] ?? column.defaultValue ?? null)) return yield* mismatch("createField");
        if (typeof row.id !== "string") return yield* mismatch("createId");
        expectedEvents.push({ object: "line_item", action: "created", id: row.id });
      }
      const observed = new Set<string>();
      for (const observation of activity.observedRows) {
        const row = written.find(row => row.id === observation.row.id);
        if (observation.table !== mutation.line.table.name || row === undefined || !jsonEqual(row, projectNativeRow(observation.row)))
          return yield* mismatch("createObservation");
        observed.add(row.id);
      }
      if (written.some(row => !observed.has(row.id))) return yield* mismatch("missingCreateObservation");
      const rows = correlated.positions.map(position => correlated.results[position]!);
      fillEmptyToManyRelations(rows, new Map(mutation.line.table.relationships.map(relationship => [relationship.name, { relationship }])));
      const result = yield* prepared.present(rows, mutation.line.table.name);
      if (!jsonEqual(call.result, yield* Effect.fromResult(captureNativeNumericDto(result)))) return yield* mismatch("createResult");
    } else {
      if (activity.lifecycle.length) return yield* mismatch("updateLifecycle");
      const table = call.commandName === "cartUpdateForMutations" ? mutation.cart : call.commandName === "cartUpdateAddressesForMutations" ? mutation.address :
        call.commandName === "cartUpdateLinesForMutations" ? mutation.line : undefined;
      if (table === undefined) return yield* mismatch("command");
      const patches: JsonObject[] = [];
      const nativeFilters: JsonObject[] = [];
      const bulkIds: string[] = [];
      let singleResult = false;
      if (table === mutation.cart) patches.push(...yield* Effect.fromResult(decodeCartMutationUpdates(call.input)));
      else if (table === mutation.address) patches.push(...yield* Effect.fromResult(decodeCartMutationAddressUpdates(call.input)));
      else {
        const input = yield* Effect.fromResult(decodeCartMutationLineUpdate(call.input));
        singleResult = typeof input.target === "string";
        const entries = Array.isArray(input.target) ? input.target : [{ selector: typeof input.target === "string" ? { id: input.target } : input.target, data: input.data ?? {} }];
        for (const entry of entries) {
          if ("selector" in entry) {
            nativeFilters.push(entry.selector);
            for (const row of before.get(table.table.name)?.values() ?? []) if (row.deleted_at === null &&
              Object.entries(entry.selector).every(([name, value]) => Array.isArray(value) ? value.some(item => same(item, row[name])) : same(value, row[name]))) {
              if (typeof row.id !== "string") return yield* mismatch("selectorId");
              patches.push({ ...entry.data, id: row.id });
            }
          } else { patches.push(entry); bulkIds.push(entry.id); }
        }
        if (!Array.isArray(input.target)) for (const row of patches) if (typeof row.id === "string") bulkIds.push(row.id);
      }
      if (table !== mutation.line) for (const row of patches) if (typeof row.id === "string") bulkIds.push(row.id);
      if (bulkIds.length) nativeFilters.push({ id: [...new Set(bulkIds)] });
      const authorized = new Map<string, JsonObject>();
      for (const input of patches) {
        if (typeof input.id !== "string") return yield* mismatch("updateId");
        const retained = before.get(table.table.name)?.get(input.id);
        if (retained === undefined || retained.deleted_at !== null) return yield* mismatch("updatePreimage");
        const update = structuredClone(input);
        prepareUpdateMetadata([{ entity: structuredClone(retained), update }]);
        authorized.set(input.id, table === mutation.line ? yield* captureCartMutationLine(update, table.numbers) : update);
      }
      const createdAddresses = new Set<string>();
      const addressSlots = table === mutation.cart ? patches.flatMap(patch => [patch.shipping_address, patch.billing_address])
        .filter((value): value is JsonObject => value !== undefined && isJsonObject(value) && value.id === undefined) : [];
      const consumedAddressSlots = new Set<number>();
      for (const change of activity.mutations) {
        if (change.after === null || typeof change.after.id !== "string") return yield* mismatch("updateAfter");
        const after = projectNativeRow(change.after);
        if (change.table === mutation.address.table.name && change.operation === "insert" && table === mutation.cart) {
          let matched = false;
          for (const [index, candidate] of addressSlots.entries()) {
            if (consumedAddressSlots.has(index)) continue;
            const graph = yield* captureGraph({ catalog: mutation.catalog, root: { entity: mutation.address.graph, steps: [], omitRelations: [] },
              rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }) }, [{ ...candidate, id: change.after.id }], defaultCommerceResources);
            const supplied = graph.rows.get(mutation.address.table.name)?.[0];
            if (supplied === undefined || mutation.address.table.columns.some(column => !["created_at", "updated_at", "deleted_at"].includes(column.name) &&
              !same(after[column.name] ?? null, supplied[column.name] ?? column.defaultValue ?? null))) continue;
            consumedAddressSlots.add(index); matched = true; break;
          }
          if (!matched || after.created_at !== after.updated_at || after.deleted_at !== null) return yield* mismatch("createdAddress");
          createdAddresses.add(change.after.id); expectedEvents.push({ object: "address", action: "created", id: change.after.id }); continue;
        }
        if (change.operation !== "patch" || change.before === null) return yield* mismatch("updateOperation");
        const previous = projectNativeRow(change.before), input = authorized.get(change.after.id);
        if (change.table !== table.table.name || input === undefined) return yield* mismatch("updateTarget");
        const expected = { ...previous, ...input };
        for (const name of ["shipping_address", "billing_address"]) if (input[name] !== undefined) {
          const reference = input[name];
          const id = reference === null || typeof reference === "string" ? reference : isJsonObject(reference) ? reference.id : undefined;
          const actual = after[name + "_id"];
          if (actual === undefined) return yield* mismatch("addressReference");
          if (id === undefined ? typeof actual !== "string" || !createdAddresses.has(actual) : actual !== id) return yield* mismatch("addressReference");
          delete expected[name]; expected[name + "_id"] = actual;
        }
        delete expected.updated_at;
        const { updated_at: _managed, ...retainedAfter } = after;
        if (!jsonEqual(retainedAfter, expected)) return yield* mismatch("updateFields");
        expectedEvents.push({ object: table.table.name.replace(/^cart_/, ""), action: "updated", id: change.after.id });
      }
      if (consumedAddressSlots.size !== addressSlots.length) return yield* mismatch("missingCreatedAddress");
      const allowedRows = new Map<string, Set<string>>([[table.table.name, new Set(authorized.keys())],
        [mutation.address.table.name, new Set([...createdAddresses, ...patches.flatMap(patch => [patch.shipping_address, patch.billing_address])
          .flatMap(value => typeof value === "string" ? [value] : value !== undefined && isJsonObject(value) && typeof value.id === "string" ? [value.id] : [])])]]);
      if (table === mutation.address) allowedRows.set(table.table.name, new Set(authorized.keys()));
      for (const observation of activity.observedRows) if (typeof observation.row.id !== "string" || !allowedRows.get(observation.table)?.has(observation.row.id))
        return yield* mismatch("updateObservation");
      const permittedQueries = new Set<string>(), requiredQueries = new Set<string>();
      for (const filters of nativeFilters) {
        const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(filters, {})).pipe(Result.flatMap(input => mutation.query(table.table.name, input))));
        const key = JSON.stringify([table.table.name, commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate)]);
        permittedQueries.add(key); requiredQueries.add(key);
      }
      for (const [name, ids] of allowedRows) for (const id of ids)
        permittedQueries.add(JSON.stringify([name, commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: [id] })]));
      for (const read of activity.relationalReads) {
        const key = JSON.stringify([read.table, read.query]);
        if (!permittedQueries.has(key) || read.total !== read.returned || read.total > (read.table === mutation.address.table.name ? 8 : 4))
          return yield* mismatch("updateRead");
        requiredQueries.delete(key);
      }
      if (requiredQueries.size) return yield* mismatch("missingUpdateRead");
      const returned = [];
      for (const id of authorized.keys()) {
        const after = activity.mutations.findLast(change => change.table === table.table.name && change.after?.id === id)?.after;
        const retained = after == null ? before.get(table.table.name)?.get(id) : projectNativeRow(after);
        if (retained === undefined) return yield* mismatch("updateResultRow");
        returned.push(retained);
      }
      const paths = table === mutation.cart ? ["shipping_address", "billing_address"].filter(name => patches.some(row => row[name] !== undefined)) : [];
      const rowsByTable = new Map<string, readonly JsonObject[]>([[table.table.name, returned]]);
      if (paths.length) {
        const addresses = new Map(before.get(mutation.address.table.name));
        for (const change of activity.mutations) if (change.table === mutation.address.table.name && change.after !== null && typeof change.after.id === "string")
          addresses.set(change.after.id, projectNativeRow(change.after));
        rowsByTable.set(mutation.address.table.name, [...addresses.values()]);
      }
      const assembled = yield* Effect.fromResult(assembleCommerceRelations(table.table.name, rowsByTable, paths, prepared.relations));
      const output = yield* prepared.present(assembled, table.table.name);
      const expected = singleResult && Array.isArray(output) ? output[0] : output;
      if (expected === undefined || !jsonEqual(call.result, yield* Effect.fromResult(captureNativeNumericDto(expected)))) return yield* mismatch("updateResult");
    }
    const pending = new Set(expectedEvents.map(event => JSON.stringify([event.object, event.action, event.id])));
    if (pending.size !== expectedEvents.length) return yield* mismatch("duplicateEvent");
    for (const event of call.events) {
      const message = yield* captureCartMutationEvent(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!pending.delete(JSON.stringify([message.metadata.object, message.metadata.action, id]))) return yield* mismatch("event");
    }
    if (pending.size) return yield* mismatch("missingEvent");
  }, receiptBoundary);
  return { capture: captureCartMutationEvent, validateLogicalCall };
}
