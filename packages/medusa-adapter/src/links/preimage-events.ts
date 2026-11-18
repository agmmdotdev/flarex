import { Effect, Result, Schema } from "effect";
import { LinkPreimageOperationRequestSchema, LinkPreimageOperationHandleSchema, LinkPreimageOperationRecordSchema,
  LinkOperationResultSchema, LinkOperationCompensationSchema, LinkPairRevisionRecordSchema,
  linkPairRevisionId, linkPreimageRequestKey, linkPreimageRowKey, LinkPreimageRowSchema } from "@medusajs/link-modules";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { projectNativeRow } from "../repository/result";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { linkLogicalEventPolicy } from "./events";
import { commerceRelationReadQuery } from "../query/relations";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Mutation = Activity["mutations"][number];
type Row = typeof LinkPreimageRowSchema.Type;
const decodeRequest = commerceDecoder(LinkPreimageOperationRequestSchema, "receiptMismatch");
const decodeHandle = commerceDecoder(LinkPreimageOperationHandleSchema, "receiptMismatch");
const decodeRecord = commerceDecoder(LinkPreimageOperationRecordSchema, "receiptMismatch");
const decodeRevision = commerceDecoder(LinkPairRevisionRecordSchema, "receiptMismatch");
const decodeResult = commerceDecoder(LinkOperationResultSchema, "receiptMismatch");
const decodeCompensation = commerceDecoder(LinkOperationCompensationSchema, "receiptMismatch");
const decodeRow = commerceDecoder(LinkPreimageRowSchema, "receiptMismatch");
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodePairs = commerceDecoder(Schema.Array(Schema.Union([Schema.Tuple([Id, Id]), Schema.Tuple([Id, Id, Schema.Struct({})])]))
  .check(Schema.isMaxLength(4)), "receiptMismatch");
const key = (pair: { readonly primary: string; readonly foreign: string }) => JSON.stringify([pair.primary, pair.foreign]);
const mismatch = () => commerceError("receiptMismatch");
const sameExcept = (left: JsonObject, right: JsonObject, ignored: readonly string[]) => {
  const a = projectNativeRow(left), b = projectNativeRow(right);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(name => ignored.includes(name) ||
    a[name] !== undefined && b[name] !== undefined && jsonEqual(a[name], b[name]));
};

/** Validate closed native preimage facts, not an inverse implementation.
 * Exact history admission remains in storage replay; generation comparison,
 * native action order and event construction remain in the native service. */
export function linkPreimageEventPolicy(input: { readonly tableName: string; readonly serviceName: string; readonly entityName: string;
  readonly endpoints: readonly [string, string]; readonly applyName: string; readonly compensateName: string;
  readonly createName: string; readonly dismissName: string }) {
  const { tableName, serviceName, entityName, endpoints: [primary, foreign] } = input;
  const base = linkLogicalEventPolicy(tableName, serviceName, entityName, input.endpoints, [input.createName], [input.dismissName]);
  const normalize = (row: JsonObject | null) => row === null ? Result.succeed(null) : decodeRow({
    id: row.id, primary: row[primary], foreign: row[foreign],
    created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at,
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("LinkPreimages.validateCall")(function* (call, activity) {
    const allowed = [tableName, "link_workflow_operation", "link_pair_revision"];
    if (activity.setNull.length || activity.referenceReplacements.length ||
      activity.mutations.some((mutation, ordinal) => mutation.ordinal !== ordinal || !allowed.includes(mutation.table)) ||
      activity.lifecycle.some(change => change.table !== tableName || change.operation !== "softDelete") ||
      activity.observedRows.some(observation => !allowed.includes(observation.table)) ||
      activity.relationalReads.some(read => !allowed.includes(read.table))) return yield* Effect.fail(mismatch());
    const applying = call.commandName === input.applyName, compensating = call.commandName === input.compensateName;
    if (!applying && !compensating) {
      // Ordinary admitted native writers still rotate heads. The existing
      // Link receipt validates their real mutation/event association below.
      if (call.mode !== "write" || call.commandName !== input.createName && call.commandName !== input.dismissName)
        return yield* Effect.fail(mismatch());
    } else if (call.mode !== "write") return yield* Effect.fail(mismatch());
    const operationMutations = activity.mutations.filter(mutation => mutation.table === "link_workflow_operation");
    const heads = new Map<string, { first: Mutation; last: Mutation; revision: string }>();
    for (const mutation of activity.mutations.filter(mutation => mutation.table === "link_pair_revision")) {
      if (mutation.after === null || mutation.operation !== (mutation.before === null ? "insert" : "patch")) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(decodeRevision(projectNativeRow(mutation.after)));
      const pair = { primary: row.primary_value, foreign: row.foreign_value };
      const id = yield* Effect.tryPromise({ try: () => linkPairRevisionId(serviceName, pair), catch: cause => commerceError("adapterFailure", cause) });
      if (row.id !== id || row.service_name !== serviceName) return yield* Effect.fail(mismatch());
      if (mutation.before !== null) {
        const before = yield* Effect.fromResult(decodeRevision(projectNativeRow(mutation.before)));
        if (before.revision === row.revision || !sameExcept(mutation.before, mutation.after, ["revision", "updated_at"]))
          return yield* Effect.fail(mismatch());
      }
      const previous = heads.get(key(pair)); heads.set(key(pair), { first: previous?.first ?? mutation, last: mutation, revision: row.revision });
    }
    const links = new Map<string, { first: Mutation; last: Mutation }>();
    const expectedEvents: { action: "attached" | "detached"; ids: string[] }[] = [];
    let group: { action: "attached" | "detached"; ids: string[] } | undefined;
    const endGroup = () => { if (group !== undefined) expectedEvents.push(group); group = undefined; };
    for (const mutation of activity.mutations) {
      if (mutation.table !== tableName) { endGroup(); continue; }
      const row = yield* Effect.fromResult(normalize(mutation.after)), before = yield* Effect.fromResult(normalize(mutation.before));
      if (row === null || mutation.operation !== "insert" && mutation.operation !== "patch" && mutation.operation !== "replace" ||
        mutation.operation === "insert" && before !== null || mutation.operation !== "insert" && before === null ||
        before !== null && (before.primary !== row.primary || before.foreign !== row.foreign)) return yield* Effect.fail(mismatch());
      if (mutation.operation === "replace" && !compensating || mutation.operation !== "replace" && before !== null &&
        !sameExcept(mutation.before ?? {}, mutation.after ?? {}, row.deleted_at === null ? ["id", "updated_at", "deleted_at"] : ["updated_at", "deleted_at"]))
        return yield* Effect.fail(mismatch());
      const head = heads.get(key(row));
      if (head === undefined || head.first.ordinal >= mutation.ordinal) return yield* Effect.fail(mismatch());
      const previous = links.get(key(row)); links.set(key(row), { first: previous?.first ?? mutation, last: mutation });
      const action = row.deleted_at === null ? "attached" : mutation.operation === "replace" ? undefined : "detached";
      if (action === undefined) continue;
      if (group?.action !== action) { endGroup(); group = { action, ids: [] }; }
      group?.ids.push(row.id);
    }
    endGroup();
    const deleted = new Set<number>();
    for (const change of activity.lifecycle) {
      const ordinal = change.attemptOrdinal, mutation = ordinal === null ? undefined : activity.mutations[ordinal];
      if (ordinal === null || deleted.has(ordinal) || mutation?.table !== tableName || mutation.before === null || mutation.after === null ||
        mutation.operation !== "patch" || change.beforeDeletedAt !== null || typeof change.afterDeletedAt !== "string" ||
        mutation.before.deleted_at !== change.beforeDeletedAt || mutation.after.deleted_at !== change.afterDeletedAt ||
        Object.keys(change.key).length !== 2 || change.key[primary] !== mutation.after[primary] || change.key[foreign] !== mutation.after[foreign])
        return yield* Effect.fail(mismatch());
      deleted.add(ordinal);
    }
    if (activity.mutations.some(mutation => mutation.table === tableName && mutation.operation !== "replace" &&
      mutation.after?.deleted_at !== null && !deleted.has(mutation.ordinal))) return yield* Effect.fail(mismatch());
    if (!applying && !compensating) {
      if (operationMutations.length || activity.observedRows.some(observation => observation.table === "link_workflow_operation"))
        return yield* Effect.fail(mismatch());
      const pairs = yield* Effect.fromResult(decodePairs(call.input)), targets = new Set(pairs.map(([primary, foreign]) => key({ primary, foreign })));
      if (heads.size !== targets.size || [...heads.keys()].some(pair => !targets.has(pair))) return yield* Effect.fail(mismatch());
      const mutations = activity.mutations.filter(mutation => mutation.table === tableName);
      const ordinals = new Map(mutations.map((mutation, ordinal) => [mutation.ordinal, ordinal]));
      const lifecycle = [];
      for (const change of activity.lifecycle) {
        const ordinal = change.attemptOrdinal === null ? undefined : ordinals.get(change.attemptOrdinal);
        if (ordinal === undefined) return yield* Effect.fail(mismatch()); lifecycle.push({ ...change, attemptOrdinal: ordinal });
      }
      yield* base.validateLogicalCall(call, { ...activity, mutations: mutations.map((mutation, ordinal) => ({ ...mutation, ordinal })), lifecycle });
      return;
    }
    const handle = compensating ? yield* Effect.fromResult(decodeHandle(call.input)) : undefined;
    const request = handle?.request ?? (yield* Effect.fromResult(decodeRequest(call.input)));
    if (handle !== undefined && handle.serviceName !== serviceName || operationMutations.length > 1) return yield* Effect.fail(mismatch());
    const operation = operationMutations[0];
    const observed = activity.observedRows.filter(observation => observation.table === "link_workflow_operation");
    if (observed.some(observation => observation.row.id !== request.operationId)) return yield* Effect.fail(mismatch());
    const stored = operation?.after ?? observed.at(-1)?.row;
    if (stored === undefined || stored === null) return yield* Effect.fail(mismatch());
    const record = yield* Effect.fromResult(decodeRecord(projectNativeRow(stored)));
    if (record.id !== request.operationId || record.service_name !== serviceName ||
      linkPreimageRequestKey(record.request) !== linkPreimageRequestKey(request) || compensating && record.state === "applied")
      return yield* Effect.fail(mismatch());
    if (record.state !== "cancelled" && record.changes.length && (compensating || operation !== undefined)) {
      const query = commerceRelationReadQuery(defaultCommerceResources, { kind: "or", children: record.changes.map(pair => ({ kind: "and", children: [
        { kind: "in", column: primary, values: [pair.primary] }, { kind: "in", column: foreign, values: [pair.foreign] },
      ] })) }, primary);
      const captures = activity.relationalReads.filter(read => read.table === tableName && jsonEqual(read.query, query));
      const first = captures[0], last = captures.at(-1);
      const beforeCount = record.changes.filter(change => (compensating ? change.after : change.before) !== null).length;
      const afterCount = record.state === "compensated" ? record.changes.filter(change => change.compensated !== null).length
        : record.changes.filter(change => change.after !== null).length;
      if (first === undefined || last === undefined || first.total !== (operation === undefined ? afterCount : beforeCount) || last.total !== afterCount ||
        captures.some(read => read.returned !== read.total || read.total > record.changes.length)) return yield* Effect.fail(mismatch());
    }
    if (applying && operation === undefined && activity.relationalReads.some(read => read.table !== "link_workflow_operation"))
      return yield* Effect.fail(mismatch());
    if (operation !== undefined) {
      if (operation.before === null) {
        if (operation.operation !== "insert" || record.state !== (applying ? "applied" : "cancelled")) return yield* Effect.fail(mismatch());
      } else {
        const before = yield* Effect.fromResult(decodeRecord(projectNativeRow(operation.before)));
        if (!compensating || before.state !== "applied" || record.state !== "compensated" || operation.operation !== "patch" ||
          !sameExcept(operation.before, operation.after ?? {}, ["state", "changes", "updated_at"]) ||
          !jsonEqual(before.changes, record.changes.map(({ compensated: _row, compensatedRevision: _revision, ...change }) => change)))
          return yield* Effect.fail(mismatch());
      }
    } else if (heads.size || links.size || call.events.length || activity.lifecycle.length) return yield* Effect.fail(mismatch());
    const targets = new Set(request.mutations.flatMap(mutation => mutation.pairs.map(key)));
    const observedLinks: Row[] = [];
    for (const observation of activity.observedRows.filter(observation => observation.table === tableName)) {
      const row = yield* Effect.fromResult(normalize(observation.row));
      if (row === null || !targets.has(key(row))) return yield* Effect.fail(mismatch()); observedLinks.push(row);
    }
    const observedHeads = new Map<string, string>();
    for (const observation of activity.observedRows.filter(observation => observation.table === "link_pair_revision")) {
      const row = yield* Effect.fromResult(decodeRevision(projectNativeRow(observation.row))), pair = { primary: row.primary_value, foreign: row.foreign_value };
      if (row.service_name !== serviceName || !targets.has(key(pair))) return yield* Effect.fail(mismatch()); observedHeads.set(key(pair), row.revision);
    }
    if (operation === undefined && record.state === "compensated") for (const change of record.changes) {
      const current = observedLinks.filter(row => key(row) === key(change)).at(-1) ?? null;
      if (linkPreimageRowKey(current) !== linkPreimageRowKey(change.compensated) || observedHeads.get(key(change)) !== change.compensatedRevision)
        return yield* Effect.fail(mismatch());
    }
    if (operation !== undefined && record.state !== "cancelled") {
      if (heads.size !== targets.size || [...heads.keys(), ...links.keys()].some(pair => !targets.has(pair))) return yield* Effect.fail(mismatch());
      for (const change of record.changes) {
        const actual = links.get(key(change)), head = heads.get(key(change));
        const observations = observedLinks.filter(row => key(row) === key(change));
        const first = actual === undefined ? observations[0] ?? null : yield* Effect.fromResult(normalize(actual.first.before));
        const last = actual === undefined ? observations.at(-1) ?? null : yield* Effect.fromResult(normalize(actual.last.after));
        if (record.state === "applied") {
          if (linkPreimageRowKey(first) !== linkPreimageRowKey(change.before) || linkPreimageRowKey(last) !== linkPreimageRowKey(change.after) ||
            head?.revision !== change.afterRevision) return yield* Effect.fail(mismatch());
        } else if ("compensatedRevision" in change) {
          if (linkPreimageRowKey(first) !== linkPreimageRowKey(change.after) || linkPreimageRowKey(last) !== linkPreimageRowKey(change.compensated) ||
            head?.first.before?.revision !== change.afterRevision || head.revision !== change.compensatedRevision) return yield* Effect.fail(mismatch());
        }
      }
    } else if (record.state === "cancelled" && (heads.size || links.size || activity.lifecycle.length)) return yield* Effect.fail(mismatch());
    if (call.events.length !== expectedEvents.length) return yield* Effect.fail(mismatch());
    for (const [index, value] of call.events.entries()) {
      const message = yield* base.capture(value), expected = expectedEvents[index];
      if (expected === undefined || message.metadata.action !== expected.action ||
        !jsonEqual(message.data.id, expected.ids.length === 1 ? expected.ids[0] ?? null : expected.ids)) return yield* Effect.fail(mismatch());
    }
    const changed = record.changes.filter(change => linkPreimageRowKey(change.before) !== linkPreimageRowKey(change.after)).length;
    if (applying) {
      const result = yield* Effect.fromResult(decodeResult(call.result));
      if (result.operationId !== record.id || result.serviceName !== serviceName || result.state !== record.state ||
        result.changedPairs !== changed || result.replayed !== (operation === undefined)) return yield* Effect.fail(mismatch());
    } else {
      const result = yield* Effect.fromResult(decodeCompensation(call.result));
      const status = record.state === "cancelled" ? "notApplied" : operation === undefined ? "alreadyCompensated" : "compensated";
      if (result.operationId !== record.id || result.serviceName !== serviceName || result.status !== status || result.changedPairs !== changed)
        return yield* Effect.fail(mismatch());
    }
  });
  return { capture: base.capture, validateLogicalCall, allowRecordedRowReplay: true as const };
}
