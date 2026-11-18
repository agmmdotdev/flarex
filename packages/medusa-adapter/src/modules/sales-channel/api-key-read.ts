import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileRowProjection } from "../../value/complete-row";
import { commerceRelationReadQuery } from "../../query/relations";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { captureSalesChannelMetadata } from "./schema";
import { prepareSalesChannelRepository } from "./repository";
import { salesChannelLogicalEventPolicy } from "./events";
import { makeLocalSalesChannelCommands } from "./service";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Filters = Schema.Struct({ id: Schema.Array(Id).check(Schema.isMaxLength(4)) });
const Config = Schema.Struct({ select: Schema.Tuple([Schema.Literal("id")]) });
const Input = Schema.Struct({ filters: Filters, config: Config });
const decodeInput = commerceDecoder(Input, "receiptMismatch");
const decodeArguments = commerceDecoder(Schema.Tuple([Filters, Config]), "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)), "storedCorruption");

/** Reuse the existing native list command for the API Key workflow's exact
 * id-only read. Empty and duplicate IDs keep the native query semantics. */
export const prepareSalesChannelApiKeyRead = Effect.fn("SalesChannel.prepareApiKeyRead")(function* () {
  const runtime = yield* makeLocalSalesChannelCommands();
  const metadata = yield* captureSalesChannelMetadata();
  const table = metadata.frame.tables[0];
  if (table === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const prepared = yield* Effect.fromResult(prepareSalesChannelRepository(metadata.frame));
  const projection = yield* Effect.fromResult(compileRowProjection(table));
  const output = (value: unknown) => decodeRows(value).pipe(Result.flatMap(rows => Result.gen(function* () {
    for (const row of rows) yield* projection(row);
    return rows;
  })));
  const base = salesChannelLogicalEventPolicy();
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("SalesChannel.validateApiKeyRead")(function* (call, activity) {
    yield* base.validateLogicalCall(call, activity);
    if (call.commandName !== "salesChannelList" || call.mode !== "read" || activity.relationalReads.length !== 1)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const input = yield* Effect.fromResult(decodeInput(call.input));
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, { select: [...input.config.select] })).pipe(Result.flatMap(prepared.query)))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const rows = yield* Effect.fromResult(output(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    if (!jsonEqual(activity.relationalReads[0] ?? null, { table: table.name,
      query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate, "id"), total: rows.length, returned: rows.length }) ||
      activity.observedRows.length !== rows.length || new Set(rows.map(row => row.id)).size !== rows.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const ids = new Set(rows.map(row => row.id));
    for (const observation of activity.observedRows) {
      if (observation.table !== table.name || typeof observation.row.id !== "string" || observation.row.deleted_at !== null ||
        !input.filters.id.includes(observation.row.id) || !ids.delete(observation.row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (ids.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  const listSalesChannels = yield* Effect.fromResult(defineWorkflowMethod({ command: runtime.list, arguments: decodeArguments,
    encode: ([filters, config]) => ({ filters, config }), output }));
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: Modules.SALES_CHANNEL,
    source: { name: "flarex-sales-channel-local", profile: "sales-channel.api-key-read" },
    methods: { listSalesChannels }, graph: { aliases: [], reads: [] },
    logical: { capture: base.capture, validateLogicalCall, commands: [runtime.list] } }));
  return { workflow, commands: [runtime.list], logicalEventPolicy: () => ({ capture: base.capture, validateLogicalCall }) };
});
