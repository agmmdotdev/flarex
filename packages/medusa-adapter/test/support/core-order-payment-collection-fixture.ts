import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { compileOrderPaymentCollectionLinkCoreDefinition } from "../../src/links/order-payment-collection-schema";
import { prepareOrderPaymentCollectionLinkRead } from "../../src/links/order-payment-collection-service";
import { createCoreNativeWorkflowFixture } from "./core-native-workflow-fixture";

const stamp = "2020-01-02T03:04:05.000Z";
const paymentLinkRows: readonly JsonObject[] = [
  ...Array.from({ length: 4 }, (_, index) => ({ id: `ordpay-normal-${index}`, order_id: "order-links",
    payment_collection_id: `paycol-normal-${index}`, created_at: stamp, updated_at: stamp, deleted_at: null })),
  ...Array.from({ length: 5 }, (_, index) => ({ id: `ordpay-overflow-${index}`, order_id: "order-overflow",
    payment_collection_id: `paycol-overflow-${index}`, created_at: stamp, updated_at: stamp, deleted_at: null })),
  { id: "ordpay-history", order_id: "order-history", payment_collection_id: "paycol-normal-0",
    created_at: stamp, updated_at: stamp, deleted_at: stamp },
];

/** Stored native Link read proof only. These explicit existing rows grant no
 * endpoint creation, cascade, dismissal or financial mutation capability. */
export async function prepareCoreOrderPaymentCollections(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const { definition, runtime } = await Effect.runPromise(Effect.all({
    definition: compileOrderPaymentCollectionLinkCoreDefinition(target),
    runtime: prepareOrderPaymentCollectionLinkRead(),
  }));
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources: [{
    name: "order_payment_collection_links", definition, initialCommands: runtime.commands,
    rows: paymentLinkRows.map(row => ({ table: "order_payment_collection", row })),
  }] });
  close(fixture.close);
  const participant = defineAtomicCommerceParticipant("orderPaymentCollectionReadProbe");
  const read = defineAtomicCommerceCommand("nativeOrderPaymentCollectionRead", (ctx, input) => ctx.call(participant, runtime.count, input));
  const nativeStorage = fixture.source("order_payment_collection_links");
  const prepare = async (small = false) => {
    const host = await Effect.runPromise(fixture.execution.prepare({
      identityAndAccessPolicy: { profile: "native-order-payment-collection-read" + (small ? ".four" : "") }, commands: [read],
      participants: [{ participant, nativeStorage, commands: runtime.commands, validateLogicalCall: runtime.logicalEventPolicy().validateLogicalCall,
        ...(small ? { logicalResources: { ...defaultCommerceResources, catalogRows: 4, queryRows: 4, writeBatchRows: 4 } } : {}) }] }));
    close(() => Effect.runPromise(host.close));
    return { host, run: (input: JsonObject, request = host.newRequestKey()) => host.run(request, read, input) };
  };
  return { fixture, ...await prepare(), snapshot: fixture.snapshot, prepareSmall: () => prepare(true) };
}
