import { Effect, Schema } from "effect";
import { LinkOperationRequestSchema, LinkOperationHandleSchema, LinkOperationResultSchema,
  LinkOperationCompensationSchema, LinkOperationRecordSchema, LinkPairRevisionRecordSchema,
  linkPairRevisionId, linkOperationRequestKey } from "@medusajs/link-modules";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { moduleEventDecoder } from "../module/events";
import { projectNativeRow } from "../repository/result";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { linkLogicalEventPolicy } from "./events";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Mutation = Activity["mutations"][number];
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeRequest = commerceDecoder(LinkOperationRequestSchema, "receiptMismatch");
const decodeHandle = commerceDecoder(LinkOperationHandleSchema, "receiptMismatch");
const decodeResult = commerceDecoder(LinkOperationResultSchema, "receiptMismatch");
const decodeCompensation = commerceDecoder(LinkOperationCompensationSchema, "receiptMismatch");
const decodeOperation = commerceDecoder(LinkOperationRecordSchema, "receiptMismatch");
const decodeRevision = commerceDecoder(LinkPairRevisionRecordSchema, "receiptMismatch");
const decodePairs = commerceDecoder(Schema.Array(Schema.Union([Schema.Tuple([Id, Id]), Schema.Tuple([Id, Id, Schema.JsonObject])]))
  .check(Schema.isMaxLength(8)), "receiptMismatch");
const decodeDeletion = commerceDecoder(Schema.Struct({ selector: Schema.Union([
  Schema.Struct({ publishable_key_id: Schema.Array(Id).check(Schema.isMaxLength(4)) }),
  Schema.Struct({ sales_channel_id: Schema.Array(Id).check(Schema.isMaxLength(4)) }),
]), config: Schema.JsonObject }), "receiptMismatch");
const pairKey = (primary: string, foreign: string) => JSON.stringify([primary, foreign]);
const sameExcept = (before: JsonObject, after: JsonObject, ignored: readonly string[]) => {
  const left = projectNativeRow(before), right = projectNativeRow(after);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => ignored.includes(key) || left[key] !== undefined && right[key] !== undefined && jsonEqual(left[key], right[key]));
};

/** Authenticate the added native protocol records alongside the existing rich
 * Link evidence. This inspects closed facts; it performs no reads or writes and
 * does not choose replay, mutation or compensation behavior. */
export function apiKeyLinkEventPolicy(input: { readonly tableName: string; readonly serviceName: string; readonly entityName: string;
  readonly createName: string; readonly softDeleteName: string; readonly applyName?: string; readonly compensateName?: string }) {
  const { tableName, serviceName, entityName } = input;
  const base = linkLogicalEventPolicy(tableName, serviceName, entityName, ["publishable_key_id", "sales_channel_id"],
    [input.createName], [], [input.softDeleteName]);
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(serviceName), object: Schema.Literal(entityName), action: Schema.Literals(["attached", "detached"]) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 8))]) }),
    options: Schema.optionalKey(Schema.Struct({ event_id: Id })),
  }), defaultCommerceResources);
  const capture = Effect.fn("ApiKeyLinkEvents.capture")(function* (value: unknown) {
    const event = yield* decode(value);
    if (event.name !== entityName + "." + event.metadata.action) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return event;
  });
  const project = Effect.fn("ApiKeyLinkEvents.projectLinkActivity")(function* (activity: Activity, action?: "attached" | "detached") {
    const mutations = activity.mutations.filter(mutation => mutation.table === tableName &&
      (action === undefined || (mutation.after?.deleted_at === null ? "attached" : "detached") === action));
    const ordinals = new Map(mutations.map((mutation, ordinal) => [mutation.ordinal, ordinal]));
    const lifecycle = [];
    for (const change of activity.lifecycle) {
      if (change.table !== tableName) return yield* Effect.fail(commerceError("receiptMismatch"));
      if (action !== undefined && (change.operation === "restore" ? "attached" : "detached") !== action) continue;
      const ordinal = change.attemptOrdinal === null ? null : ordinals.get(change.attemptOrdinal);
      if (ordinal === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      lifecycle.push({ ...change, attemptOrdinal: ordinal });
    }
    return { ...activity, mutations: mutations.map((mutation, ordinal) => ({ ...mutation, ordinal })), lifecycle,
      observedRows: activity.observedRows.filter(row => row.table === tableName),
      relationalReads: activity.relationalReads.filter(read => read.table === tableName) };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ApiKeyLinkEvents.validateCall")(function* (call, activity) {
    const allowedTables = [tableName, "link_workflow_operation", "link_pair_revision"];
    if (activity.setNull.length || activity.referenceReplacements.length ||
      activity.mutations.some((mutation, ordinal) => mutation.ordinal !== ordinal || !allowedTables.includes(mutation.table)) ||
      activity.observedRows.some(row => !allowedTables.includes(row.table)) ||
      activity.relationalReads.some(read => !allowedTables.includes(read.table)))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const applying = call.commandName === input.applyName && input.applyName !== undefined;
    const compensating = call.commandName === input.compensateName && input.compensateName !== undefined;
    const operations = activity.mutations.filter(mutation => mutation.table === "link_workflow_operation");
    const heads = new Map<string, { first: Mutation; last: Mutation; primary: string; foreign: string; revision: string }>();
    for (const mutation of activity.mutations.filter(mutation => mutation.table === "link_pair_revision")) {
      if (mutation.after === null || mutation.operation !== (mutation.before === null ? "insert" : "patch"))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(decodeRevision(projectNativeRow(mutation.after)));
      const id = yield* Effect.tryPromise({ try: () => linkPairRevisionId(serviceName, { primary: row.primary_value, foreign: row.foreign_value }),
        catch: cause => commerceError("adapterFailure", cause) });
      if (row.service_name !== serviceName || row.id !== id) return yield* Effect.fail(commerceError("receiptMismatch"));
      if (mutation.before !== null) {
        const before = yield* Effect.fromResult(decodeRevision(projectNativeRow(mutation.before)));
        if (before.revision === row.revision || !sameExcept(mutation.before, mutation.after, ["revision", "updated_at"]))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      const key = pairKey(row.primary_value, row.foreign_value), previous = heads.get(key);
      heads.set(key, { first: previous?.first ?? mutation, last: mutation,
        primary: row.primary_value, foreign: row.foreign_value, revision: row.revision });
    }
    const linkMutations = activity.mutations.filter(mutation => mutation.table === tableName);
    const links = new Map<string, { beforeActive: boolean; afterActive: boolean }>();
    for (const mutation of linkMutations) {
      const row = mutation.after, primary = row?.publishable_key_id, foreign = row?.sales_channel_id;
      if (row === null || typeof primary !== "string" || typeof foreign !== "string")
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const key = pairKey(primary, foreign), head = heads.get(key), previous = links.get(key);
      if (head === undefined || head.first.ordinal >= mutation.ordinal) return yield* Effect.fail(commerceError("receiptMismatch"));
      links.set(key, { beforeActive: previous?.beforeActive ?? mutation.before?.deleted_at === null, afterActive: row.deleted_at === null });
    }
    if (!applying && !compensating) {
      if (operations.length || activity.observedRows.some(row => row.table === "link_workflow_operation") ||
        call.mode === "read" && (heads.size !== 0 || activity.observedRows.some(row => row.table !== tableName)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.mode === "write") {
        if (call.commandName === input.createName) {
          const pairs = yield* Effect.fromResult(decodePairs(call.input));
          const expected = new Set(pairs.map(pair => pairKey(pair[0], pair[1])));
          if (heads.size !== expected.size || [...heads.keys()].some(key => !expected.has(key)))
            return yield* Effect.fail(commerceError("receiptMismatch"));
        } else if (call.commandName === input.softDeleteName) {
          const { selector } = yield* Effect.fromResult(decodeDeletion(call.input));
          for (const head of heads.values()) {
            if ("publishable_key_id" in selector ? !selector.publishable_key_id.includes(head.primary) : !selector.sales_channel_id.includes(head.foreign))
              return yield* Effect.fail(commerceError("receiptMismatch"));
          }
        } else return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      for (const event of call.events) if ((yield* capture(event)).options !== undefined)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* base.validateLogicalCall(call, yield* project(activity));
      return;
    }
    if (call.mode !== "write" || operations.length > 1) return yield* Effect.fail(commerceError("receiptMismatch"));
    const handle = compensating ? yield* Effect.fromResult(decodeHandle(call.input)) : undefined;
    const request = handle?.request ?? (yield* Effect.fromResult(decodeRequest(call.input)));
    if (handle !== undefined && handle.serviceName !== serviceName) return yield* Effect.fail(commerceError("receiptMismatch"));
    const mutation = operations[0];
    if (mutation !== undefined && mutation.after === null) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (activity.observedRows.some(row => row.table === "link_workflow_operation" && row.row.id !== request.operationId))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const observed = activity.observedRows.filter(row => row.table === "link_workflow_operation" && row.row.id === request.operationId);
    const stored = mutation?.after ?? observed[observed.length - 1]?.row;
    if (stored === undefined || stored === null) return yield* Effect.fail(commerceError("receiptMismatch"));
    const record = yield* Effect.fromResult(decodeOperation(projectNativeRow(stored)));
    if (record.id !== request.operationId || record.service_name !== serviceName ||
      linkOperationRequestKey(record.request) !== linkOperationRequestKey(request))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    if (compensating && record.state === "applied") return yield* Effect.fail(commerceError("receiptMismatch"));
    if (mutation !== undefined) {
      if (mutation.before === null) {
        if (mutation.operation !== "insert" || record.state !== (applying ? "applied" : "cancelled"))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      } else {
        const before = yield* Effect.fromResult(decodeOperation(projectNativeRow(mutation.before)));
        if (!compensating || mutation.operation !== "patch" || before.state !== "applied" || record.state !== "compensated" ||
          !sameExcept(mutation.before, mutation.after ?? {}, ["state", "compensation_events", "updated_at"]))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    } else if (heads.size || links.size || call.events.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const expectedHeads = new Set((applying ? [...request.add, ...request.remove] : record.changes)
      .map(pair => pairKey(pair.primary, pair.foreign)));
    if (mutation !== undefined && (record.state === "applied" || record.state === "compensated") &&
      (heads.size !== expectedHeads.size || [...heads.keys()].some(key => !expectedHeads.has(key))))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    if (record.state === "cancelled" && (heads.size || links.size)) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (mutation !== undefined && record.state === "applied") {
      const changed = new Map([...links].filter(([, value]) => value.beforeActive !== value.afterActive));
      if (changed.size !== record.changes.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const change of record.changes) {
        const key = pairKey(change.primary, change.foreign), actual = changed.get(key);
        if (actual === undefined || actual.beforeActive !== change.beforeActive || actual.afterActive !== change.afterActive ||
          heads.get(key)?.revision !== change.afterRevision) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (mutation !== undefined && record.state === "compensated") {
      if (links.size !== record.changes.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const change of record.changes) {
        const key = pairKey(change.primary, change.foreign), actual = links.get(key), head = heads.get(key);
        if (actual === undefined || actual.beforeActive !== change.afterActive || actual.afterActive !== change.beforeActive ||
          head?.first.before?.revision !== change.afterRevision) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    const intents = mutation === undefined ? [] : applying ? record.events : record.compensation_events;
    if (call.events.length !== intents.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const messages = [];
    for (const [index, value] of call.events.entries()) {
      const message = yield* capture(value), intent = intents[index];
      if (intent === undefined || !jsonEqual(message.data.id, intent.id) || message.metadata.action !== intent.action ||
        message.options?.event_id !== intent.event_id) return yield* Effect.fail(commerceError("receiptMismatch"));
      messages.push(message);
    }
    for (const action of ["attached", "detached"] as const) {
      const events = messages.filter(message => message.metadata.action === action).map(({ options: _options, ...message }) => message);
      yield* base.validateLogicalCall({ ...call, commandName: action === "attached" ? compensating ? "linkRestore" : "linkCreate" : "linkDismiss", events },
        yield* project(activity, action));
    }
    if (applying) {
      const result = yield* Effect.fromResult(decodeResult(call.result));
      if (result.operationId !== record.id || result.serviceName !== serviceName || result.state !== record.state ||
        result.changedPairs !== record.changes.length || result.replayed !== (mutation === undefined))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    } else {
      const result = yield* Effect.fromResult(decodeCompensation(call.result));
      const status = record.state === "cancelled" ? "notApplied" : mutation === undefined ? "alreadyCompensated" : "compensated";
      if (result.operationId !== record.id || result.serviceName !== serviceName || result.status !== status ||
        result.changedPairs !== record.changes.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
  });
  return { capture, validateLogicalCall };
}
