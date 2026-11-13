import { expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { capturePaymentMetadata } from "../src/modules/payment/schema";
import { preparePaymentSessionRepository } from "../src/modules/payment/repository";
import { makePaymentLifecycleCommands } from "../src/modules/payment/lifecycle-service";
import { workflowModuleDefinition } from "../src/workflow/module";
import { graphNativeConfiguration } from "../src/local-graph/native-metadata";
import { makeNativeQueryBridge } from "../src/local-graph/native-bridge";
import { captureCommerceInput } from "../src/value/input";
import { makePaymentFixtureLogger, paymentCollectionSeed } from "./support/payment-fixture-data";
import { executeCountedRemoteFetchRequest } from "@medusajs/modules-sdk/remote-query";

it("admits the actual native Collection fields and wildcard Session descriptor at the Payment DAL", async () => {
  const metadata = await Effect.runPromise(capturePaymentMetadata());
  const repository = Result.getOrThrow(preparePaymentSessionRepository(metadata.frame));
  const runtime = await Effect.runPromise(makePaymentLifecycleCommands(makePaymentFixtureLogger().logger));
  const graph = workflowModuleDefinition(runtime.workflow)?.graph;
  if (graph?.native === undefined) throw new Error("Missing genuine Payment native metadata");
  const row = await Effect.runPromise(runtime.contracts.present({ ...paymentCollectionSeed().row,
    payment_sessions: [], payments: [] }, repository.contracts.collection.name));
  const descriptors: unknown[] = [];
  const bridge = makeNativeQueryBridge({ ...Result.getOrThrow(graphNativeConfiguration(graph.native)), read: request => Effect.promise(() =>
    executeCountedRemoteFetchRequest(request, async (filters, options) => {
    const descriptor = buildQuery(filters, options);
    descriptors.push(descriptor);
    const plan = repository.query(repository.contracts.collection, Result.getOrThrow(captureCommerceInput(descriptor)));
    expect(Result.isSuccess(plan), JSON.stringify(descriptor)).toBe(true);
    const selected = Result.getOrThrow(plan);
    expect(selected.projection.storageFields).not.toContain("payment_sessions_id");
    expect(selected.paths).toEqual(["payment_sessions"]);
    return [[row], 1];
  })) });
  for (const fields of [["id", "currency_code", "amount", "payment_sessions.*"],
    ["id", "amount", "raw_amount", "currency_code", "payment_sessions.*"]]) {
    await Effect.runPromise(bridge.query({ entryPoint: "payment_collection", fields,
      variables: { id: paymentCollectionSeed().row.id } }, { throwIfKeyNotFound: false }));
  }
  expect(descriptors).toHaveLength(2);
  expect(repository.contracts.collection.columns.map(column => column.name)).not.toContain("payment_sessions_id");
  expect(descriptors).toMatchObject([
    { where: { id: [paymentCollectionSeed().row.id] }, options: { populate: ["payment_sessions"], fields: ["id", "currency_code", "amount", "payment_sessions_id"] } },
    { where: { id: [paymentCollectionSeed().row.id] }, options: { populate: ["payment_sessions"], fields: ["id", "amount", "raw_amount", "currency_code", "payment_sessions_id"] } },
  ]);
  for (const fields of [["payment_sessions_id.bad"], ["constructor"], ["__proto__"], ["unknown.path"]]) {
    expect(Result.isFailure(repository.query(repository.contracts.collection,
      Result.getOrThrow(captureCommerceInput(buildQuery({}, { select: fields })))))).toBe(true);
  }
});
