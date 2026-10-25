import { Effect, Result } from "effect";
import { Modules } from "@medusajs/framework/utils/portable";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { scalarLogicalEventPolicy } from "../../repository/scalar-events";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import type { prepareApiKeyRepository } from "./repository";
import { ApiKeyIds } from "./contracts";
import { ApiKeyPreimageInput, ApiKeyRetainedTitles, ApiKeyRevokeInput, ApiKeyUpdateInput } from "./lifecycle-input";

const decodeList = commerceDecoder(ApiKeyPreimageInput, "receiptMismatch");
const decodeUpdate = commerceDecoder(ApiKeyUpdateInput, "receiptMismatch");
const decodeRevoke = commerceDecoder(ApiKeyRevokeInput, "receiptMismatch");
const decodeRestore = commerceDecoder(ApiKeyRetainedTitles, "receiptMismatch");
const decodeIds = commerceDecoder(ApiKeyIds, "receiptMismatch");

/** Authenticate native results against complete observed rows and mutation
 * attempts. Native time generation stays in the service; no extra reads occur. */
export function apiKeyLifecycleEventPolicy(prepared: Result.Result.Success<ReturnType<typeof prepareApiKeyRepository>>) {
  const capture = scalarLogicalEventPolicy(Modules.API_KEY, "api_key", { insert: "unadmitted" }).capture;
  const policies = new Map(["apiKeyListPreimages", "apiKeyUpdate", "apiKeyRestoreTitles", "apiKeyRevoke", "apiKeyDelete"].map(command =>
    [command, scalarLogicalEventPolicy(Modules.API_KEY, "api_key", { insert: "unadmitted",
      update: command === "apiKeyUpdate" || command === "apiKeyRestoreTitles" || command === "apiKeyRevoke" ? command : "unadmitted",
      delete: "apiKeyDelete" })] as const));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ApiKey.validateLifecycleCall")(function* (call, activity) {
    const command = call.commandName;
    const policy = policies.get(command);
    if (policy === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
    yield* policy.validateLogicalCall(call, activity);
    const before = new Map<string, JsonObject>();
    for (const observed of activity.observedRows) {
      if (observed.table !== "api_key") return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(prepared.contracts.complete(projectNativeRow(observed.row)));
      if (typeof row.id !== "string" || row.type !== "publishable" || row.salt !== "")
        return yield* Effect.fail(commerceError("receiptMismatch"));
      before.set(row.id, row);
    }
    for (const mutation of activity.mutations) {
      if (mutation.before === null) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(prepared.contracts.complete(projectNativeRow(mutation.before)));
      if (typeof row.id !== "string" || row.type !== "publishable" || row.salt !== "")
        return yield* Effect.fail(commerceError("receiptMismatch"));
      before.set(row.id, row);
    }
    if (before.size > 4) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (command === "apiKeyListPreimages") {
      if (call.mode !== "read" || call.events.length || activity.mutations.length || activity.relationalReads.length !== 1)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const input = yield* Effect.fromResult(decodeList(call.input));
      const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, input.config)).pipe(Result.flatMap(prepared.query)));
      const ids = new Set(typeof input.filters.id === "string" ? [input.filters.id] : input.filters.id);
      if ([...before].some(([id, row]) => !ids.has(id) || row.deleted_at !== null))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const ordered = orderNativeIdRows([...before].map(([id, row]): JsonObject & { id: string } => ({ ...row, id })), buildQuery(input.filters, input.config).where);
      const expected = yield* Effect.fromResult(projectRows(ordered, plan.projection.node));
      if (!jsonEqual(call.result, expected) || !jsonEqual(activity.relationalReads, [{ table: "api_key",
        query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate, "id"), total: ordered.length, returned: ordered.length }]))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    if (call.mode !== "write") return yield* Effect.fail(commerceError("receiptMismatch"));
    const update = command === "apiKeyUpdate" ? yield* Effect.fromResult(decodeUpdate(call.input)) : undefined;
    const revoke = command === "apiKeyRevoke" ? yield* Effect.fromResult(decodeRevoke(call.input)) : undefined;
    const restore = command === "apiKeyRestoreTitles" ? yield* Effect.fromResult(decodeRestore(call.input)) : undefined;
    const selector = update?.selector ?? revoke?.selector;
    const ids = selector === undefined ? restore === undefined ? yield* Effect.fromResult(decodeIds(call.input)) : restore.map(row => row.id)
      : typeof selector.id === "string" ? [selector.id] : selector.id;
    if ([...before].some(([id, row]) => !ids.includes(id) || row.deleted_at !== null))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const ordered = orderNativeIdRows([...before].map(([id, row]): JsonObject & { id: string } => ({ ...row, id })), { id: ids });
    const titles = new Map(restore?.map(row => [row.id, row.title]));
    const expectedChanges = ordered.filter(row => command === "apiKeyDelete" || revoke !== undefined ||
      (restore === undefined ? update?.update.title : titles.get(row.id)) !== undefined &&
      row.title !== (restore === undefined ? update?.update.title : titles.get(row.id)));
    if (activity.mutations.length !== expectedChanges.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const after = new Map(ordered.map(row => [row.id, row]));
    // DAL mutation order is independent of the caller's selector order.
    const remaining = new Map(expectedChanges.map(row => [row.id, row]));
    for (const mutation of activity.mutations) {
      const id = mutation.before?.id;
      const prior = typeof id === "string" ? remaining.get(id) : undefined;
      if (prior === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      remaining.delete(prior.id);
      if (command === "apiKeyDelete") {
        if (mutation.operation !== "delete" || mutation.after !== null || typeof prior.revoked_at !== "string")
          return yield* Effect.fail(commerceError("receiptMismatch"));
        continue;
      }
      const row = mutation.after === null ? undefined : yield* Effect.fromResult(prepared.contracts.complete(projectNativeRow(mutation.after)));
      if (row === undefined || mutation.operation !== "patch") return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const [field, value] of Object.entries(prior)) {
        if (field === "updated_at") continue;
        if (revoke !== undefined && field === "revoked_at") {
          if (typeof row.revoked_at !== "string" || !Number.isFinite(Date.parse(row.revoked_at)))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          continue;
        }
        const expected = field === "title" && revoke === undefined
          ? (restore === undefined ? update?.update.title : titles.get(prior.id)) ?? value
          : field === "revoked_by" && revoke !== undefined ? revoke.revoke.revoked_by : value;
        if (row[field] === undefined || !jsonEqual(row[field], expected)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      after.set(prior.id, { ...row, id: prior.id });
    }
    if (remaining.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (command === "apiKeyDelete" || restore !== undefined) {
      if (call.result !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
    } else {
      const output = yield* Effect.fromResult(prepared.contracts.output(call.result));
      const expected = ordered.map(row => {
        const { salt: _salt, ...publicRow } = after.get(row.id) ?? row;
        return publicRow;
      });
      if (!jsonEqual(output, expected)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall };
}
