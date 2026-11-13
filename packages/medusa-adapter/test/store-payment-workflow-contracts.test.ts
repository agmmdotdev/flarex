import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceNativeSource, atomicCommerceNativeSourceIdentity } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { compileCartCoreDefinition } from "../src/modules/cart/creation-schema";
import { compileCustomerCoreDefinition } from "../src/modules/customer/schema";
import { compilePaymentCoreDefinition } from "../src/modules/payment/schema";
import { compileCartPaymentCollectionLinkCoreDefinition } from "../src/links/cart-payment-collection-schema";
import { compileCustomerAccountHolderLinkCoreDefinition } from "../src/links/customer-account-holder-schema";
import { makePaymentLifecycleCommands } from "../src/modules/payment/lifecycle-service";
import { CustomerPaymentSessionInput } from "../src/modules/payment/account-input";
import { makeCartCreationWorkflowCommands } from "../src/modules/cart/refresh-service";
import { makeStorePaymentRuntimes, prepareStorePaymentWorkflows, type StorePaymentWorkflowOptions } from "../src/workflows/payment/store";
import { workflowModuleDefinition } from "../src/workflow/module";
import type { AtomicWorkflowExecution } from "../src/workflow/host";
import { makePaymentFixtureLogger } from "./support/payment-fixture-data";

let options: StorePaymentWorkflowOptions;
let captures: Parameters<AtomicWorkflowExecution["prepare"]>[0][];
const Frame = Schema.Struct({ nodes: Schema.Array(Schema.JsonObject), references: Schema.Array(Schema.Struct({ kind: Schema.String })) });
const frame = Schema.decodeUnknownSync(Frame);
/** Observe the issued finite identity, including inactive branches and each
 * child's own transform cache; this executes no native callback. */
function construction(input: unknown) {
  const count = { nodes: 0, operations: 2 };
  const visit = (input: unknown): void => {
    const identity = frame(input);
    count.operations += identity.references.filter(reference => reference.kind === "transform").length * 2;
    for (const node of identity.nodes) {
      count.nodes++;
      count.operations += node.kind === "condition" ? 1 : node.kind === "branchResult" ? 0 : 2;
      if (node.kind === "workflow") visit(node.workflow);
      else if (Array.isArray(node.invokedWorkflows)) for (const child of node.invokedWorkflows) { count.operations += 2; visit(child); }
    }
  };
  visit(input); return count;
}
beforeAll(async () => {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() }, logger = makePaymentFixtureLogger().logger;
  const runtimes = await Effect.runPromise(makeStorePaymentRuntimes()), payment = await Effect.runPromise(makePaymentLifecycleCommands(logger));
  const definitions = await Effect.runPromise(Effect.all({ cart: compileCartCoreDefinition(target), payment: compilePaymentCoreDefinition(target),
    customer: compileCustomerCoreDefinition(target), cart_payment_collection_links: compileCartPaymentCollectionLinkCoreDefinition(target),
    customer_account_holder_links: compileCustomerAccountHolderLinkCoreDefinition(target) }));
  const source = (name: keyof typeof definitions) => Result.getOrThrow(defineAtomicCommerceNativeSource(name, definitions[name]));
  options = { modules: { cart: { module: runtimes.cart.workflow, nativeStorage: source("cart") }, payment: { module: payment.workflow, nativeStorage: source("payment") },
    customer: { module: runtimes.customer.workflow, nativeStorage: source("customer") },
    cart_payment_collection_links: { module: runtimes.cartPaymentCollection.workflow, nativeStorage: source("cart_payment_collection_links") },
    customer_account_holder_links: { module: runtimes.customerAccountHolder.workflow, nativeStorage: source("customer_account_holder_links") } },
    logger: payment.loggerResource, customerAccountLink: runtimes.customerAccountLink, revision: "c".repeat(64), subscribers: [],
    execution: { identityAndAccessPolicy: { profile: "store-payment-construction" }, prepare: composition => {
      captures.push(composition);
      // Construction-only port: all native graphs, resources and identities
      // prepare normally. No database execution is supplied or modeled here.
      return Effect.succeed({ newRequestKey: () => "unexecuted-construction", close: Effect.void,
        run: () => Effect.die(new Error("Construction proof must not execute a workflow")) });
    } } };
});

it("prepares exactly two bounded native roots with original source tokens and no finance overgrant", async () => {
  captures = [];
  const workflows = await Effect.runPromise(prepareStorePaymentWorkflows(options));
  try {
    expect(captures).toHaveLength(2);
    expect(captures.map(composition => composition.participants.length)).toEqual([3, 3]);
    expect(captures.map(composition => composition.participants.map(participant => {
      if (participant.nativeStorage === undefined) throw new Error("Expected an authenticated native source");
      return atomicCommerceNativeSourceIdentity(participant.nativeStorage)?.name;
    }).sort())).toEqual([
      ["cart", "cart_payment_collection_links", "payment"], ["customer", "customer_account_holder_links", "payment"],
    ]);
    const identity = Schema.decodeUnknownSync(Schema.Struct({ workflow: Schema.Struct({ definition: Frame,
      identityEncoding: Schema.Literal("resourceDigest"), executionIsolation: Schema.Literal("scopeExclusive"),
      operationScheduling: Schema.Literal("queued"), borrowedOperationScheduling: Schema.Literal("queued") }) }));
    for (const composition of captures) {
      expect(composition.requestCallLimit).toBe(512);
      expect(composition.requestParticipantLimit).toBeUndefined();
      expect(composition.requestByteLimit).toBeUndefined();
      expect(composition.requestEventLimit).toBeUndefined();
      expect(Buffer.byteLength(JSON.stringify(composition.identityAndAccessPolicy))).toBeLessThanOrEqual(65_536);
      const policy = identity(composition.identityAndAccessPolicy);
      const counts = construction(policy.workflow.definition);
      expect(counts.nodes).toBeLessThanOrEqual(64);
      expect(composition.participants.length * 64 + counts.operations).toBeLessThanOrEqual(512);
      console.info("Store Payment construction", { ...counts, bytes: Buffer.byteLength(JSON.stringify(composition.identityAndAccessPolicy)) });
      for (const participant of composition.participants) {
        expect(participant.logicalResources).toBeUndefined();
        expect(participant.commands.some(command => {
          const identity = commerceCommandIdentity(command);
          return identity?.mode === "write" && /capture|refund|authorize|cancel|Addresses(Create|Update|Delete)/i.test(identity.name);
        })).toBe(false);
      }
    }
    const guest = { payment_collection_id: "collection", provider_id: "pp_system_default" };
    expect(Result.isSuccess(workflows.createSessions.decodeInput(guest))).toBe(true);
    expect(Result.isSuccess(workflows.createSessions.decodeInput({ ...guest, customer_id: "customer" }))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(CustomerPaymentSessionInput)(guest))).toBe(true);
    expect(Result.isFailure(workflows.createSessions.decodeInput({ ...guest, customer_id: null }))).toBe(true);
  } finally { await Effect.runPromise(Effect.all([workflows.createCollection.close, workflows.createSessions.close])); }
});

it("keeps the ordinary twelve-model Cart read profile separate from Shipping's Sales Channel gate", async () => {
  const cart = workflowModuleDefinition(options.modules.cart.module);
  expect(cart?.source.profile).toBe("cart.creation-workflow");
  expect(cart?.graph.directPaths).toBeUndefined();
  const shipping = await Effect.runPromise(makeCartCreationWorkflowCommands("cart-shipping"));
  captures = [];
  expect(await Effect.runPromise(Effect.result(prepareStorePaymentWorkflows({ ...options,
    modules: { ...options.modules, cart: { ...options.modules.cart, module: shipping.workflow } } }))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(captures).toEqual([]);
});

it("refuses mismatched source slots and forged account routers before preparing an execution host", async () => {
  captures = [];
  expect(await Effect.runPromise(Effect.result(prepareStorePaymentWorkflows({ ...options,
    modules: { ...options.modules, customer_account_holder_links: { ...options.modules.customer_account_holder_links,
      nativeStorage: options.modules.cart_payment_collection_links.nativeStorage } } }))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(captures).toEqual([]);
  const result = await Effect.runPromise(Effect.result(prepareStorePaymentWorkflows({ ...options,
    customerAccountLink: { ...options.customerAccountLink } })));
  expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(captures).toEqual([]);
});
