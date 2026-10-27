import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../value/input";
import { commerceDecoder } from "../value/decoder";
import { compileCompleteRow } from "../value/complete-row";
import { ScalarId } from "../repository/scalar-id-read";
import { projectNativeRow } from "../repository/result";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { projectRows } from "../query/projection";
import { defineWorkflowModule, workflowModuleDefinition } from "../workflow/module";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { linkLogicalEventPolicy } from "./events";
import { prepareLinkWorkflowService } from "./workflow-service";
import { prepareOrderCartLinkRead } from "./order-cart-service";
import { prepareOrderPaymentCollectionLinkRead } from "./order-payment-collection-service";

const decodePairs = commerceDecoder(Schema.Array(Schema.Tuple([ScalarId, ScalarId])).check(Schema.isLengthBetween(1, 1)), "receiptMismatch");
const decodeList = commerceDecoder(Schema.Struct({ filters: Schema.JsonObject, config: Schema.JsonObject }), "receiptMismatch");

/** The native multi-family Link router receives the genuine generated bulk
 * services. Each family keeps its own storage, read and mutation receipts. */
export const prepareCheckoutNativeLinkLifecycle = Effect.fn("CheckoutLink.prepareNativeLifecycle")(function* (kind: "order-cart" | "order-payment") {
  const read = yield* kind === "order-cart" ? prepareOrderCartLinkRead() : prepareOrderPaymentCollectionLinkRead();
  const definition = workflowModuleDefinition(read.workflow);
  if (definition === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const native = yield* Effect.fromResult(prepareLinkWorkflowService(read.prepared, kind === "order-cart" ? "checkoutOrderCart" : "checkoutOrderPayment", "dismiss"));
  if (native.dismiss === undefined || native.dismissName === undefined || native.dismissMethod === undefined)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const [primary, foreign] = read.prepared.joiner.relationships ?? [];
  if (primary === undefined || foreign === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const first = primary.foreignKey, second = foreign.foreignKey;
  const listName = commerceCommandIdentity(native.list)?.name;
  if (listName === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const mutation = linkLogicalEventPolicy(read.metadata.frame.name, read.prepared.serviceName, read.prepared.entityName,
    [first, second], [native.createName], [native.dismissName]);
  const complete = yield* Effect.fromResult(compileCompleteRow(read.metadata.frame));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("CheckoutNativeLink.validateCall")(function* (call, activity) {
    if (call.mode === "read" && call.commandName !== listName)
      return yield* read.logicalEventPolicy().validateLogicalCall(call, activity);
    yield* mutation.validateLogicalCall(call, activity);
    if (call.mode === "read") {
      const input = yield* Effect.fromResult(decodeList(call.input));
      const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, input.config))
        .pipe(Result.flatMap(value => read.prepared.prepared.readPlan(value, defaultCommerceResources.queryRows))));
      const rows: JsonObject[] = [];
      for (const observation of activity.observedRows) {
        if (observation.table !== read.metadata.frame.name) return yield* Effect.fail(commerceError("receiptMismatch"));
        rows.push(yield* Effect.fromResult(complete(projectNativeRow(observation.row))));
      }
      const expected = yield* Effect.fromResult(projectRows(rows, plan.projection.node));
      if (activity.relationalReads.length !== 1 || activity.relationalReads.some(value => value.table !== read.metadata.frame.name ||
        !jsonEqual(value.query, plan.query) || value.total !== rows.length || value.returned !== rows.length) || !jsonEqual(call.result, expected))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    const pairs = yield* Effect.fromResult(decodePairs(call.input)), pair = pairs[0];
    if (pair === undefined || call.commandName !== native.createName && call.commandName !== native.dismissName)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const matches = (row: JsonObject) => row[first] === pair[0] && row[second] === pair[1];
    const creating = call.commandName === native.createName;
    if (activity.mutations.length > 1 || creating && activity.mutations.length !== 1) return yield* Effect.fail(commerceError("receiptMismatch"));
    const output: JsonObject[] = [];
    for (const changed of activity.mutations) {
      if (changed.table !== read.metadata.frame.name || changed.after === null || !matches(changed.after) ||
        changed.before !== null && !matches(changed.before)) return yield* Effect.fail(commerceError("receiptMismatch"));
      output.push(yield* Effect.fromResult(complete(projectNativeRow(changed.after))));
    }
    if (!jsonEqual(call.result, output)) return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const observation of activity.observedRows) {
      if (observation.table !== read.metadata.frame.name) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(complete(projectNativeRow(observation.row)));
      if (!matches(row) || !activity.mutations.some(changed => changed.after !== null && jsonEqual(projectNativeRow(changed.after), row) ||
        changed.before !== null && jsonEqual(projectNativeRow(changed.before), row))) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (creating) {
      if (activity.relationalReads.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    } else {
      const plan = yield* Effect.fromResult(read.prepared.prepared.lifecycleReadPlan("softDelete", {
        $or: [{ $and: [{ [first]: pair[0] }, { [second]: pair[1] }] }],
      }, defaultCommerceResources.queryRows));
      if (activity.relationalReads.length !== 1 || activity.relationalReads.some(value => value.table !== read.metadata.frame.name ||
        !jsonEqual(value.query, plan.query) || value.total !== activity.mutations.length || value.returned !== activity.mutations.length))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
  });
  const policy = { capture: mutation.capture, validateLogicalCall }, commands = [...read.commands, native.create, native.list, native.dismiss];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: kind === "order-cart" ? "order_cart_links" : "order_payment_collection_links", source: {
    name: definition.source.name, profile: kind + ".checkout-native-links" },
    methods: { nativeCreate: native.createMethod, nativeList: native.listMethod, nativeDismiss: native.dismissMethod },
    graph: definition.graph, logical: { ...policy, commands } }));
  return { ...read, workflow, commands, native, logicalEventPolicy: () => policy };
});
