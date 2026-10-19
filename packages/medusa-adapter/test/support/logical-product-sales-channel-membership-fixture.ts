import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { linkProductsToSalesChannelWorkflow } from "@medusajs/core-flows/sales-channel/link-products";
import { defineCommerceCommand, defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { prepareProductSalesChannelWorkflow } from "../../src/workflows/product/sales-channel";
import { ProductSalesChannelMembershipInput, prepareProductSalesChannelMembershipWorkflow } from "../../src/workflows/product/sales-channel-membership";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import { prepareLogicalSalesChannelHost } from "./logical-sales-channel-fixture";
import { prepareLogicalProductSalesChannelLinkHost } from "./logical-product-sales-channel-link-fixture";

const native = Result.getOrThrow(linkProductsToSalesChannelWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine Product membership retained callback " + name);
  return node.compensate;
}
const undo = { add: retained("associate-products-with-channels"), remove: retained("detach-products-from-sales-channels-step") };
const revision = "8".repeat(64);
type MembershipHost = Effect.Success<ReturnType<typeof prepareProductSalesChannelMembershipWorkflow>>;
interface MembershipProbe {
  readonly retained?: () => readonly unknown[];
  readonly repeat?: boolean;
  readonly lateFailure?: boolean;
  readonly caughtRefusal?: boolean;
  readonly calls?: number;
  readonly eventMessages?: number;
  readonly inspectResources?: (resources: unknown) => void;
  readonly escape?: (create: () => Promise<unknown>) => void;
}
interface LogicalProductSalesChannelMembershipFixture {
  readonly fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  readonly product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  readonly sales: Awaited<ReturnType<typeof prepareLogicalSalesChannelHost>>;
  readonly link: Awaited<ReturnType<typeof prepareLogicalProductSalesChannelLinkHost>>;
  readonly options: Parameters<typeof prepareProductSalesChannelMembershipWorkflow>[0];
  readonly prepare: () => Promise<MembershipHost>;
  readonly seed: (prefix: string, count?: number) => Promise<{ readonly id: string; readonly products: string[];
    readonly links: readonly { readonly id: string; readonly product_id: string; readonly sales_channel_id: string }[] }>;
  readonly read: (filters: JsonObject, withDeleted?: boolean) => Promise<readonly JsonObject[]>;
  readonly readEndpoints: () => Promise<{ readonly products: Json; readonly channels: Json }>;
  readonly prepareWrapped: (configuration?: MembershipProbe) => Promise<MembershipHost>;
  readonly softDeleteEndpoint: (table: "product" | "sales_channel", id: string) => Promise<void>;
  readonly snapshot: () => ReturnType<typeof logicalCurrencyInventory>;
  readonly closeCaseHosts: () => Promise<void>;
}

/** Endpoint creation is fixture setup only. The membership root borrows the
 * existing Link constructor, one source and its create/dismiss methods. */
export async function prepareLogicalProductSalesChannelMembership(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void): Promise<LogicalProductSalesChannelMembershipFixture> {
  const fixture = await logicalCurrencyFixture(driver, close, {
    includeProduct: true, includeSalesChannel: true, includeProductSalesChannelLink: true,
  });
  const product = await prepareLogicalProductHost(fixture), sales = await prepareLogicalSalesChannelHost(fixture);
  const link = await prepareLogicalProductSalesChannelLinkHost(fixture);
  for (const member of [product, sales]) {
    close(() => Effect.runPromise(member.host.close));
    await Effect.runPromise(member.host.initialize([]));
  }
  close(() => Effect.runPromise(link.host.close));
  await Effect.runPromise(link.host.initialize([]));
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const installed = { module: link.runtime.workflow, logicalStorage: link.hostInput.logicalStorage };
  const options = { execution, link: installed, revision, subscribers: [{ id: "native-product-membership", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ link: {
    module: installed.module, methods: ["create", "dismiss"], graph: false,
  } }, true));
  const caseHosts: Array<() => Promise<void>> = [];
  const own = <Host extends { readonly close: Effect.Effect<void> }>(host: Host) => {
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareProductSalesChannelMembershipWorkflow(options)));
  const seed = async (prefix: string, count = 4) => {
    const host = await Effect.runPromise(prepareProductSalesChannelWorkflow({ execution, revision,
      subscribers: [{ id: "product-membership-endpoint-seed", revision }], modules: {
        product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage },
        sales_channel: { module: sales.runtime.workflow, logicalStorage: sales.hostInput.logicalStorage }, link: installed,
      } }));
    try {
      const result = await Effect.runPromise(host.run(host.newRequestKey(), {
        salesChannel: { id: prefix + "-channel", name: prefix },
        products: Array.from({ length: count }, (_, index) => ({ id: prefix + "-product-" + index, title: prefix + index })),
      }));
      const channel = result.salesChannels[0]; if (channel === undefined) throw new Error("Missing seeded Sales Channel");
      return { id: channel.id, products: result.products.map(row => row.id), links: result.links };
    } finally { await Effect.runPromise(host.close); }
  };
  const read = async (filters: JsonObject, withDeleted = false) => Effect.runPromise(link.host.read(link.runtime.list,
    { filters, config: { withDeleted, take: 32 } }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject)))));
  const readEndpoints = async () => ({
    products: await Effect.runPromise(product.host.read(product.runtime.commands.internalProductList,
      { filters: {}, config: { withDeleted: true, take: 128 } })),
    channels: await Effect.runPromise(sales.host.read(sales.runtime.list, { filters: {}, config: { withDeleted: true, take: 128 } })),
  });
  const prepareWrapped = async (configuration: MembershipProbe = {}) => {
    const after = createStep("probe148-native-membership-parent", resources.callback(async (_input: null, context) => {
      configuration.inspectResources?.(context.resources);
      configuration.escape?.(() => context.resources.link.create([]));
      if (configuration.caughtRefusal) {
        // An application callback catches the actual resource decoder's refusal;
        // the outer authority must still retain rollback-only state.
        try { await Reflect.apply(context.resources.link.create, undefined, [[{
          product: { product_id: "caught148" }, sales_channel: { sales_channel_id: "caught148" }, unexpected: true,
        }]]); } catch {}
      }
      if (configuration.retained !== undefined) {
        const retained = configuration.retained();
        if (retained.length !== 2) throw new Error("Expected two actual native membership retained values");
        await undo.remove(retained[1], context); await undo.add(retained[0], context);
        if (configuration.repeat) { await undo.remove(retained[1], context); await undo.add(retained[0], context); }
      }
      if (configuration.lateFailure) throw new Error("Late native Product membership parent failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe148-native-membership-wrapper", (input: WorkflowData<typeof ProductSalesChannelMembershipInput.Type>) => {
      const membership = linkProductsToSalesChannelWorkflow.runAsStep({ input });
      return new WorkflowResponse(after(transform({ membership }, () => null)));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ execution, revision, subscribers: options.subscribers,
      modules: { link: installed }, ...(configuration.calls === undefined ? {} : { requestCallLimit: configuration.calls }),
      ...(configuration.eventMessages === undefined ? {} : { requestEventLimit: configuration.eventMessages }),
      workflow: { name: "probe148NativeMembership", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ProductSalesChannelMembershipInput, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  /** Arrange endpoint history with scoped core lifecycle operations. This grants
   * no endpoint capability to the actual native membership workflow. */
  const softDeleteEndpoint = async (table: "product" | "sales_channel", id: string) => {
    const command = defineCommerceCommand("membershipEndpointHistory", "write", Effect.fn(function* (context) {
      const store = yield* context.table(table); yield* store.lifecycle(context.manager, "softDelete", [{ id }]); return null;
    }));
    const participant = defineAtomicCommerceParticipant("membership_endpoint_history");
    const root = defineAtomicCommerceCommand("membershipEndpointHistoryRoot", context => context.call(participant, command, null));
    const source = table === "product" ? product.hostInput.logicalStorage : sales.hostInput.logicalStorage;
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, commands: [root],
      participants: [{ participant, logicalStorage: source, commands: [command] }] }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, null)); } finally { await Effect.runPromise(host.close); }
  };
  return { fixture, product, sales, link, options, prepare, seed, read, readEndpoints, prepareWrapped,
    softDeleteEndpoint, snapshot: () => logicalCurrencyInventory(fixture), closeCaseHosts };
}
