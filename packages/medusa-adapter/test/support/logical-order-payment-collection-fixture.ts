import { Effect } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { compileOrderPaymentCollectionLinkDefinition } from "../../src/links/order-payment-collection-schema";
import { prepareOrderPaymentCollectionLinkRead } from "../../src/links/order-payment-collection-service";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const stamp = "2020-01-02T03:04:05.000Z";
export const paymentLinkRows: readonly JsonObject[] = [
  ...Array.from({ length: 4 }, (_, index) => ({ id: `ordpay-normal-${index}`, order_id: "order-links",
    payment_collection_id: `paycol-normal-${index}`, created_at: stamp, updated_at: stamp, deleted_at: null })),
  ...Array.from({ length: 5 }, (_, index) => ({ id: `ordpay-overflow-${index}`, order_id: "order-overflow",
    payment_collection_id: `paycol-overflow-${index}`, created_at: stamp, updated_at: stamp, deleted_at: null })),
  { id: "ordpay-history", order_id: "order-history", payment_collection_id: "paycol-normal-0",
    created_at: stamp, updated_at: stamp, deleted_at: stamp },
];

/** Stored native Link read proof only. These explicit existing rows grant no
 * endpoint creation, cascade, dismissal or financial mutation capability. */
export async function prepareLogicalOrderPaymentCollections(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const definition = await Effect.runPromise(compileOrderPaymentCollectionLinkDefinition());
  const key = "medusa.link.orderPaymentCollection";
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key, owner: "medusa", writeProfile: key,
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })) }));
  const fixture = await logicalCurrencyFixture(driver, close, { additionalSources: [source] });
  const runtime = await Effect.runPromise(prepareOrderPaymentCollectionLinkRead());
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: paymentLinkRows }, 1_048_576,
    { invalidInput: () => new Error("Invalid existing Payment Link rows"), hashFailure: cause => new Error("Payment Link seed hash", { cause }) }));
  const logicalStorage = { ...fixture.hostInput.logicalStorage,
    source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
    initialization: { stepId: "order-payment-collection-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: paymentLinkRows.length } };
  const initializer = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands: runtime.commands,
    identityAndAccessPolicy: { profile: "payment-links-existing-initialization" } }));
  try { await Effect.runPromise(initializer.initialize(paymentLinkRows)); } finally { await Effect.runPromise(initializer.close); }
  const participant = defineAtomicCommerceParticipant("orderPaymentCollectionReadProbe");
  const read = defineAtomicCommerceCommand("nativeOrderPaymentCollectionRead", (ctx, input) => ctx.call(participant, runtime.count, input));
  const prepare = async (small = false) => {
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "native-order-payment-collection-read" + (small ? ".four" : "") }, commands: [read],
      participants: [{ participant, logicalStorage, commands: runtime.commands, validateLogicalCall: runtime.logicalEventPolicy().validateLogicalCall,
        ...(small ? { logicalResources: { ...defaultCommerceResources, catalogRows: 4, queryRows: 4, writeBatchRows: 4 } } : {}) }] }));
    close(() => Effect.runPromise(host.close));
    return { host, run: (input: JsonObject, request = host.newRequestKey()) => host.run(request, read, input) };
  };
  return { fixture, runtime, ...await prepare(), read, snapshot: () => logicalCurrencyInventory(fixture), prepareSmall: () => prepare(true) };
}
