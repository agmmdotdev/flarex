import { expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { commerceCommandIdentity, defineAtomicCommerceParticipant, runCommerceCommand, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, defaultCommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { makeStorePaymentRuntimes } from "../src/workflows/payment/store";
import { makePaymentLifecycleCommands } from "../src/modules/payment/lifecycle-service";
import { workflowModuleDefinition } from "../src/workflow/module";
import { prepareLocalGraph } from "../src/local-graph/query";
import type { GraphReadContext } from "../src/local-graph/model";
import { mockRelationalRead } from "./mock-relational-read";
import { makePaymentFixtureLogger } from "./support/payment-fixture-data";
import { promiseFailureObserver } from "./support/promise-failure-observer";
import { makeCustomerCheckoutReadCommands } from "../src/modules/customer/checkout-read-service";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureCommerceInput } from "../src/value/input";

it("admits genuine newly connected native selectors through their actual module decoders before storage", async () => {
  const runtimes = await Effect.runPromise(makeStorePaymentRuntimes());
  const payment = await Effect.runPromise(makePaymentLifecycleCommands(makePaymentFixtureLogger().logger));
  const modules = { cart: runtimes.cart.workflow, payment: payment.workflow, cartLink: runtimes.cartPaymentCollection.workflow,
    customer: runtimes.customer.workflow, customerLink: runtimes.customerAccountHolder.workflow };
  const graph = Result.getOrThrow(prepareLocalGraph(Object.entries(modules).map(([name, module]) => {
    const definition = workflowModuleDefinition(module);
    if (definition === undefined) throw new Error("Missing native module definition");
    return { participant: defineAtomicCommerceParticipant(`nativeSelect_${name}`), module: definition.graph };
  })));
  const profiles = [
    { entryPoint: "cart", fields: ["id", "completed_at", "currency_code", "total", "raw_total", "payment_collection.id"], variables: { id: "cart-probe" } },
    { entryPoint: "payment_collection", fields: ["id", "currency_code", "amount", "payment_sessions.*"], variables: { id: "collection-probe" } },
    { entryPoint: "payment_session", fields: ["id", "authorized_at", "provider_id", "data"], variables: { id: "session-probe" } },
    { entryPoint: "customer", fields: ["id", "email", "company_name", "first_name", "last_name", "phone", "addresses.*", "account_holders.*", "metadata"], variables: { id: "customer-probe" } },
    { entryPoint: "customer_address", fields: ["id", "customer_id", "is_default_billing", "address_1"], variables: { id: "address-probe" } },
    { entryPoint: "account_holder", fields: ["id", "provider_id", "data"], variables: { id: "holder-probe" } },
  ];
  for (const profile of profiles) {
    const calls: Array<{ command: string; input: Json }> = [], reached = new Error(`Selected ${profile.entryPoint} storage`);
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "native-select-probe", "read"), owner => owner.close);
      const unavailable = () => Effect.fail(commerceError("resourceFailure", reached));
      const store: CommerceCommandContext["store"] = { prepareRead(query) { return mockRelationalRead(this, query); }, findPage: unavailable,
        aggregate: unavailable, find: unavailable, count: unavailable, write: unavailable, delete: unavailable, lifecycle: unavailable };
      const context = makeCommerceCommandContext(lifetime, { store, resources: defaultCommerceResources, table: () => Effect.succeed(store) },
        "native-select-probe", lifetime.context, unavailable, unavailable);
      const nativeContext: GraphReadContext = { refuse: Effect.fail, recordFailure: promiseFailureObserver(), call: (_participant, command, input) => {
        calls.push({ command: commerceCommandIdentity(command)?.name ?? "unissued", input });
        return runCommerceCommand(command, context, input);
      } };
      return yield* graph.bind(nativeContext).remoteQuery(profile, { throwIfKeyNotFound: false });
    })));
    expect.soft(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect.soft(Cause.pretty(exit.cause), JSON.stringify({ profile, calls })).toContain(reached.message);
  }
});

it("keeps the base Customer scalar profile and admits only the declared Address population opt-in", async () => {
  const scalar = await Effect.runPromise(makeCustomerCheckoutReadCommands());
  const addresses = await Effect.runPromise(makeCustomerCheckoutReadCommands("addresses"));
  const query = (relations: string[]) => Result.getOrThrow(captureCommerceInput(buildQuery({ id: ["customer-probe"] },
    { select: ["id", "email"], relations })));
  expect(Result.isFailure(scalar.prepared.query(query(["addresses"])))).toBe(true);
  expect(Result.getOrThrow(addresses.prepared.query(query(["addresses"]))).paths).toEqual(["addresses"]);
  for (const paths of [["groups"], ["addresses", "groups"], ["addresses.customer"], ["unknown"]])
    expect(Result.isFailure(addresses.prepared.query(query(paths)))).toBe(true);
});
