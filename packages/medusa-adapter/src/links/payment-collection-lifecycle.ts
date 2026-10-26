import { Effect, Result, Schema } from "effect";
import { commerceServiceCommands, commerceCommandPreparation } from "../module/commands";
import { commerceDecoder } from "../value/decoder";
import { ScalarId } from "../repository/scalar-id-read";
import { defineWorkflowMethod, defineWorkflowModule, workflowModuleDefinition } from "../workflow/module";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureCommerceInput } from "../value/input";
import { compileCompleteRow } from "../value/complete-row";
import { projectNativeRow } from "../repository/result";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { linkLogicalEventPolicy } from "./events";
import { prepareCartPaymentCollectionLinkRead } from "./cart-payment-collection-service";
import { prepareOrderPaymentCollectionLinkRead } from "./order-payment-collection-service";

/** Two explicitly admitted native Link families share the existing create/
 * dismiss owner. Read and mutation receipts retain separate responsibilities. */
export const preparePaymentCollectionLinkLifecycle = Effect.fn("PaymentCollectionLink.prepareLifecycle")(function* (kind: "cart" | "order") {
  const read = yield* kind === "cart" ? prepareCartPaymentCollectionLinkRead() : prepareOrderPaymentCollectionLinkRead();
  const definition = workflowModuleDefinition(read.workflow);
  if (definition === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const endpoint = kind + "_id";
  const Link = Schema.Struct({ [kind]: Schema.Struct({ [endpoint]: ScalarId }), payment: Schema.Struct({ payment_collection_id: ScalarId }) });
  const Links = Schema.Array(Link).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 1));
  const decode = commerceDecoder(Links, "invalidInput"), argumentsDecoder = commerceDecoder(Schema.Tuple([Links]), "invalidInput");
  const output = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, 1)), "storedCorruption");
  const dismissOutput = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(1)), "storedCorruption");
  const commands = commerceServiceCommands(read.prepared.use), prepare = commerceCommandPreparation("PaymentCollectionLink.prepareInput")(decode);
  const create = commands.write("paymentCollectionLinkCreate", prepare, ({ link, context }, input) => link.create(input, context));
  const dismiss = commands.write("paymentCollectionLinkDismiss", prepare, ({ link, context }, input) => link.dismiss(input, context));
  const events = (action: string) => [read.prepared.entityName + "." + action];
  const createMethod = yield* Effect.fromResult(defineWorkflowMethod({ command: create, arguments: argumentsDecoder,
    encode: ([input]) => input, output, moduleEvents: events("attached") }));
  const dismissMethod = yield* Effect.fromResult(defineWorkflowMethod({ command: dismiss, arguments: argumentsDecoder,
    encode: ([input]) => input, output: dismissOutput, moduleEvents: events("detached") }));
  const mutation = linkLogicalEventPolicy(kind + "_payment_collection", read.prepared.serviceName,
    read.prepared.entityName, [endpoint, "payment_collection_id"], ["paymentCollectionLinkCreate"], ["paymentCollectionLinkDismiss"]);
  const complete = yield* Effect.fromResult(compileCompleteRow(read.metadata.frame));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PaymentCollectionLink.validateCall")(function* (call, activity) {
    if (call.mode === "read") return yield* read.logicalEventPolicy().validateLogicalCall(call, activity);
    yield* mutation.validateLogicalCall(call, activity);
    const [requested] = yield* Effect.fromResult(decode(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const owner = requested?.[kind];
    const primary: unknown = owner === undefined ? undefined : Reflect.get(owner, endpoint);
    const foreign = requested?.payment.payment_collection_id;
    if (typeof primary !== "string" || typeof foreign !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
    const matches = (row: Record<string, unknown>) => row[endpoint] === primary && row.payment_collection_id === foreign;
    const creating = call.commandName === "paymentCollectionLinkCreate";
    if (activity.mutations.length > 1 || creating && activity.mutations.length !== 1)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const changed = activity.mutations[0];
    const after = changed?.after === undefined || changed.after === null ? undefined :
      yield* Effect.fromResult(complete(projectNativeRow(changed.after)));
    if (changed !== undefined && (changed.table !== read.prepared.prepared.table.name || after === undefined || !matches(after) ||
      changed.before !== null && !matches(changed.before))) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (!jsonEqual(call.result, after === undefined ? [] : [after])) return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const observation of activity.observedRows) {
      if (observation.table !== read.prepared.prepared.table.name) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(complete(projectNativeRow(observation.row)));
      if (!matches(row) || (changed === undefined ? row.deleted_at === null :
        !jsonEqual(row, after!) && (changed.before === null || !jsonEqual(row, projectNativeRow(changed.before)))))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (creating) {
      const query = yield* Effect.fromResult(captureCommerceInput(buildQuery({
        $or: [{ [endpoint]: { $ne: primary }, payment_collection_id: foreign }],
      }, { take: 1 })));
      const plan = yield* Effect.fromResult(read.prepared.prepared.readPlan(query, defaultCommerceResources.queryRows));
      if (activity.relationalReads.length !== 1 || activity.relationalReads.some(observed =>
        observed.table !== read.prepared.prepared.table.name || !jsonEqual(observed.query, plan.query) ||
        observed.total !== 0 || observed.returned !== 0)) return yield* Effect.fail(commerceError("receiptMismatch"));
    } else {
      const plan = yield* Effect.fromResult(read.prepared.prepared.lifecycleReadPlan("softDelete", {
        $or: [{ $and: [{ [endpoint]: primary }, { payment_collection_id: foreign }] }],
      }, defaultCommerceResources.queryRows));
      if (activity.relationalReads.length !== 1 || activity.relationalReads.some(observed =>
        observed.table !== read.prepared.prepared.table.name || !jsonEqual(observed.query, plan.query) ||
        observed.total !== activity.mutations.length || observed.returned !== activity.mutations.length))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
  });
  const policy = { capture: mutation.capture, validateLogicalCall };
  const admitted = [...read.commands, create, dismiss];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "link",
    source: { name: read.prepared.serviceName, profile: kind + "-payment-collection-lifecycle" },
    methods: { create: createMethod, dismiss: dismissMethod }, graph: definition.graph, logical: { ...policy, commands: admitted } }));
  return { ...read, readWorkflow: read.workflow, workflow, create, dismiss, commands: admitted, logicalEventPolicy: () => policy };
});
