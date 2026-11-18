import { Effect, Result, Schema } from "effect";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { moduleEventDecoder } from "../../module/events";
import { scalarLifecycleReceipt } from "../../repository/scalar-lifecycle-receipt";
import type { compileSalesChannelDeletionContracts } from "./delete-input";
import { decodeSalesChannelDeletionIds } from "./delete-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileSalesChannelDeletionContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.SALES_CHANNEL), object: Schema.Literal("sales_channel"),
    action: Schema.Literals([CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(4))]) }),
}), defaultCommerceResources);

/** Authenticate lifecycle results and native module messages against the actual
 * complete rows and managed transitions. Active restores are real operations
 * with events even though they create no mutation attempt. */
export function salesChannelDeletionPolicy(contracts: Contracts) {
  const capture = Effect.fn("SalesChannelEvents.captureLifecycle")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateReceipt = scalarLifecycleReceipt({ table: "sales_channel", softDeleteCommand: "salesChannelSoftDeleteForWorkflow",
    restoreCommand: "salesChannelRestoreForWorkflow", maximumRoots: 4, decodeIds: decodeSalesChannelDeletionIds,
    decodeRow: contracts.decodeRow, decodeResult: input => contracts.decodeOutput(input).pipe(Result.map(result => ({
      empty: Object.keys(result).length === 0, ids: result.sales_channel_id ?? [],
    }))) });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("SalesChannelEvents.validateLifecycleCall")(function* (call, activity) {
    const { operation, ids: ordered } = yield* validateReceipt(call, activity);
    const action = operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED;
    let emitted = 0;
    for (const input of call.events) {
      const message = yield* capture(input);
      if (message.metadata.action !== action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (id !== ordered[emitted++]) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (emitted !== ordered.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}
