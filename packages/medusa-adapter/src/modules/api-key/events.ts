import { Effect } from "effect";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { scalarLogicalEventPolicy } from "../../repository/scalar-events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { matchesPublicRow } from "../../repository/result";
import { commerceDecoder } from "../../value/decoder";
import { ApiKeyCreateRows, ApiKeyIds, type compileApiKeyContracts } from "./contracts";
import type { Result } from "effect";

type Contracts = Result.Result.Success<ReturnType<typeof compileApiKeyContracts>>;
const decodeInputs = commerceDecoder(ApiKeyCreateRows, "receiptMismatch");
const decodeDeletedIds = commerceDecoder(ApiKeyIds, "receiptMismatch");

export function apiKeyCreationEventPolicy(contracts: Contracts) {
  const create = scalarLogicalEventPolicy(Modules.API_KEY, "api_key", { insert: "apiKeyCreate" });
  const inverse = scalarLogicalEventPolicy(Modules.API_KEY, "api_key", { insert: "apiKeyCreate", delete: "apiKeyRevertCreation" });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ApiKey.validateCreationCall")(function* (call, activity) {
    if (call.commandName === "apiKeyCreate") {
      yield* create.validateLogicalCall(call, activity);
      const input = yield* Effect.fromResult(decodeInputs(call.input));
      const output = yield* Effect.fromResult(contracts.output(call.result));
      if (output.length !== input.length || activity.mutations.length !== input.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const remaining = new Map(activity.mutations.map(mutation => [mutation.after?.id, mutation]));
      for (const [index, row] of output.entries()) {
        const supplied = input[index], mutation = remaining.get(row.id);
        if (supplied === undefined || mutation?.after === null || mutation?.after === undefined || mutation.after.salt !== "" ||
          row.title !== supplied.title || row.created_by !== supplied.created_by || row.type !== supplied.type)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const { salt: _salt, ...publicStored } = mutation.after;
        if (!matchesPublicRow(publicStored, row)) return yield* Effect.fail(commerceError("receiptMismatch"));
        remaining.delete(row.id);
      }
      if (remaining.size) return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    if (call.commandName !== "apiKeyRevertCreation") return yield* Effect.fail(commerceError("receiptMismatch"));
    yield* inverse.validateLogicalCall(call, activity);
    const ids = yield* Effect.fromResult(decodeDeletedIds(call.input));
    if (call.result !== null || activity.mutations.some(mutation => typeof mutation.before?.id !== "string" || !ids.includes(mutation.before.id)))
      return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture: create.capture, validateLogicalCall };
}
