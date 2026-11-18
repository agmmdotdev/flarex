import { Effect, Result, Schema } from "effect";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlateLifecycleGraphReceipt } from "../../repository/lifecycle-graph-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import type { compileOrderChangeDeletionContracts } from "./change-deletion-input";
import { decodeOrderChangeDeletionIds } from "./change-deletion-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileOrderChangeDeletionContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.ORDER),
    object: Schema.Literals(["order_change", "order_change_action"]),
    action: Schema.Literals([CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(8))]) }),
}), defaultCommerceResources);

/** Authenticate the complete native Change/Action lifecycle, its result maps
 * and events. Restoration follows native historical cascade semantics. */
export function orderChangeDeletionPolicy(contracts: Contracts) {
  const capture = Effect.fn("OrderChangeEvents.captureDeletion")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.ORDER,
      objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const byTable = new Map(contracts.entities.map(entity => [entity.table.name, entity]));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("OrderChangeEvents.validateDeletionCall")(function* (call, activity) {
    const operation = call.commandName === "orderChangeSoftDeleteForWorkflow" ? "softDelete"
      : call.commandName === "orderChangeRestoreForWorkflow" ? "restore" : undefined;
    if (operation === undefined || call.mode !== "write" || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const requestedIds = yield* Effect.fromResult(decodeOrderChangeDeletionIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const requested = new Set(requestedIds);
    const result = yield* Effect.fromResult(contracts.decodeOutput(call.result))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const evidence = new Map<string, Map<string, JsonObject & { readonly id: string }>>();
    const parents = new Map<string, JsonObject>();
    const observations: Array<{ table: string; row: JsonObject }> = [];
    const record = Effect.fn("OrderChangeEvents.observeDeletionRow")(function* (table: string, value: JsonObject) {
      const entity = byTable.get(table);
      if (entity === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult<JsonObject & { readonly id: string }, CommerceTransactionError>(entity.decodeRow(projectNativeRow(value)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string" || entity.table === contracts.change && !requested.has(row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const rows = evidence.get(table) ?? new Map<string, JsonObject & { readonly id: string }>();
      rows.set(row.id, row); evidence.set(table, rows);
      return row;
    });
    for (const observation of activity.observedRows) {
      if (observation.table === contracts.order.name) {
        const row = yield* Effect.fromResult(contracts.decodeOrderRow(projectNativeRow(observation.row))), prior = parents.get(row.id);
        if (operation !== "softDelete" || prior !== undefined && !jsonEqual(prior, row))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        parents.set(row.id, row);
      } else observations.push({ table: observation.table, row: yield* record(observation.table, observation.row) });
    }
    for (const transition of activity.lifecycle) if (transition.rowAtOperation !== null)
      yield* record(transition.table, transition.rowAtOperation);
    // Pending observations may be final values. The first mutation preimage
    // retains the actual lifecycle state at the beginning of this call.
    const preimages = new Set<string>();
    for (const mutation of activity.mutations) {
      if (mutation.before === null || typeof mutation.before.id !== "string" || mutation.realNormalization !== undefined)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const identity = JSON.stringify([mutation.table, mutation.before.id]);
      if (!preimages.has(identity)) {
        preimages.add(identity); yield* record(mutation.table, mutation.before);
      }
    }
    for (const observation of observations) {
      const id = observation.row.id;
      if (typeof id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
      const before = evidence.get(observation.table)?.get(id);
      if (before === undefined || !jsonEqual(before, observation.row) && !activity.mutations.some(mutation =>
        mutation.table === observation.table && mutation.after !== null &&
        mutation.after.id === observation.row.id && jsonEqual(projectNativeRow(mutation.after), observation.row)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    // Observation order follows opaque storage identities. Complete native
    // lifecycle selections instead use their explicit public ID ordering.
    const roots = orderNativeIdRows([...(evidence.get(contracts.change.name)?.values() ?? [])], {});
    if (roots.length > 4) return yield* Effect.fail(commerceError("receiptMismatch"));
    const candidates = operation === "restore" ? roots : roots.filter(row => row.deleted_at === null);
    // The indexed candidate anchor is observed before the active-row residual.
    // Historical parents remain authenticated evidence, not eligible results.
    const activeParents = [...parents.values()].filter(row => row.deleted_at === null);
    const eligible = operation === "restore" ? candidates
      : yield* Effect.fromResult(contracts.filterActiveOrderChanges(candidates, activeParents));
    const selected = new Set(eligible.map(row => row.id));
    const parentIds = new Set(candidates.map(row => row.order_id));
    if ([...parents.keys()].some(id => !parentIds.has(id))) return yield* Effect.fail(commerceError("receiptMismatch"));
    const pending = new Map<string, Set<string>>();
    for (const entity of contracts.entities) {
      const ids = new Set<string>();
      for (const [id, row] of evidence.get(entity.table.name) ?? []) {
        if (entity.table === contracts.change ? selected.has(id)
          : typeof row.order_change_id === "string" && selected.has(row.order_change_id)) ids.add(id);
        else if (entity.table !== contracts.change) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (ids.size > entity.maximum) return yield* Effect.fail(commerceError("receiptMismatch"));
      pending.set(entity.table.name, ids);
    }
    // Authenticate each complete read, including empty historical selections.
    // Forward follows PostgreSQL's required active Order reference; restoration
    // uses native withDeleted semantics and performs no parent eligibility read.
    const reads = [];
    if (requestedIds.length) reads.push({ table: contracts.change.name,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: requestedIds }),
      total: roots.length, returned: roots.length });
    if (operation === "softDelete" && candidates.length) reads.push({ table: contracts.order.name,
      query: commerceRelationReadQuery(defaultCommerceResources, yield* Effect.fromResult(contracts.orderPredicate(candidates))),
      total: activeParents.length, returned: activeParents.length });
    for (const root of eligible) {
      const members = [...(evidence.get(contracts.action.name)?.values() ?? [])].filter(row => row.order_change_id === root.id);
      reads.push({ table: contracts.action.name,
        query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "order_change_id", values: [root.id] }),
        total: members.length, returned: members.length });
    }
    if (!jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(commerceError("receiptMismatch"));
    // Correlate an identity-only proof without changing the native returned
    // map. The unmapped Action group also retains its complete row contract.
    const identities = {
      ...(result.order_change_id === undefined ? {} : { order_change_id: result.order_change_id }),
      ...(result.OrderChangeAction === undefined ? {} : { OrderChangeAction: result.OrderChangeAction.map(row => row.id) }),
    };
    const { events: expectedEvents } = yield* Effect.fromResult(correlateLifecycleGraphReceipt({ entities: contracts.entities,
      rootTable: contracts.change.name, operation, activity, evidence, selectedRootIds: selected, selected: pending, result: identities }));
    for (const row of result.OrderChangeAction ?? []) {
      const transition = activity.lifecycle.find(value => value.table === contracts.action.name && value.key.id === row.id);
      const retained = transition?.attemptOrdinal === null ? transition.rowAtOperation
        : transition === undefined ? undefined : activity.mutations[transition.attemptOrdinal]?.after;
      if (retained === undefined || retained === null || !jsonEqual(projectNativeRow(retained), row))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    const action = operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED;
    let emitted = 0;
    for (const input of call.events) {
      const message = yield* capture(input);
      if (message.metadata.action !== action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = expectedEvents[emitted++];
        if (expected === undefined || expected.object !== message.metadata.object || expected.id !== id)
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall };
}
