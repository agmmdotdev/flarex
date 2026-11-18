import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteShippingOptionsWorkflow } from "@medusajs/core-flows/fulfillment/delete-shipping-options";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeShippingOptionDeletionCommands } from "../../src/modules/fulfillment/shipping-option-delete-service";
import { prepareShippingOptionDeletionLinkResource } from "../../src/links/shipping-option-deletion";
import { prepareShippingOptionDeletionWorkflow, prepareShippingOptionDeletionResources, ShippingOptionDeletionInput,
  shippingOptionDeletionEvents } from "../../src/workflows/fulfillment/delete-shipping-options";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { shippingOptionCreationResources, shippingOptionDeletionResources, shippingOptionDeletionCommandMs } from "../../src/workflow/policy";
import { prepareLogicalShippingOptionCreation, shippingOptionCreationInput, shippingOptionRegionIds } from "./logical-shipping-option-creation-fixture";

const native = Result.getOrThrow(deleteShippingOptionsWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine Shipping Option deletion inverse: " + name);
  return node.compensate;
}
const undo = { option: retained("delete-shipping-options-step"), link: retained("remove-remote-links"), event: retained("emit-event-step") };
export type ShippingOptionDeletionRetained = { readonly option: unknown; readonly link: unknown; readonly event: unknown };
type Limits = Readonly<{ calls: number; eventMessages: number; commandBytes?: number }>;

/** Creation installs every real source and seeds through the executing native
 * workflow. Deletion borrows that kernel and never invents persistence, module
 * results, timestamps, Link cascades or retained inverse payloads. */
export async function prepareLogicalShippingOptionDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareLogicalShippingOptionCreation>[2]) {
  const base = await prepareLogicalShippingOptionCreation(driver, close, shared);
  const fulfillment = await Effect.runPromise(makeShippingOptionDeletionCommands());
  const modules = {
    fulfillment: { module: fulfillment.workflow, logicalStorage: base.modules.fulfillment.logicalStorage, logicalResources: shippingOptionDeletionResources },
    priceSetLinks: { ...base.modules.priceSetLinks, logicalResources: shippingOptionDeletionResources },
    pricing: { ...base.modules.pricing, logicalResources: shippingOptionDeletionResources, logicalPublication: "mixed" as const },
  };
  const link = Result.getOrThrow(prepareShippingOptionDeletionLinkResource({ fulfillment: fulfillment.workflow,
    priceSet: base.priceSetLinks.nativeService, pricing: base.pricing.workflow }));
  const resources = Result.getOrThrow(prepareShippingOptionDeletionResources({ fulfillment: fulfillment.workflow,
    priceSetLinks: base.priceSetLinks.workflow, pricing: base.pricing.workflow }, link));
  const options = { execution: base.execution, modules, link, revision: "0".repeat(64),
    subscribers: [{ id: "native-shipping-option-delete", revision: "0".repeat(64) }] };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareShippingOptionDeletionWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRoundtrip = async (actualRetained: () => ShippingOptionDeletionRetained,
    limits: Limits = shippingOptionDeletionResources, lateFailure = false) => {
    const inverse = createStep("probe-shipping-option-delete-native-inverses", resources.callback(async (_input: null, context) => {
      const actual = actualRetained();
      await undo.event(actual.event, context); await undo.link(actual.link, context); await undo.option(actual.option, context);
      if (lateFailure) throw new Error("Late genuine Shipping Option deletion inverse failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-shipping-option-delete-retained-inverses", (value: WorkflowData<typeof ShippingOptionDeletionInput.Type>) => {
      const root = deleteShippingOptionsWorkflow.runAsStep({ input: { ids: value.ids } });
      return new WorkflowResponse(inverse(transform(root, () => null)));
    });
    const selected = { ...shippingOptionDeletionResources, ...limits };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      modules: Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, { ...module, logicalResources: selected }])),
      requestCallLimit: selected.calls, requestEventLimit: selected.eventMessages, requestByteLimit: selected.commandBytes,
      requestCommandMs: shippingOptionDeletionCommandMs,
      workflow: { name: "probeShippingOptionDeleteRetainedInverses", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ShippingOptionDeletionInput, output: Schema.Null, events: shippingOptionDeletionEvents(fulfillment.workflow) } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const seed = async (prefix: string, count = 1, maximum = false) => {
    const host = await base.prepare();
    const input = shippingOptionCreationInput(prefix, count).map((option, index) => ({ ...option,
      ...(maximum ? { rules: [0, 1, 2, 3].map(rule => ({ attribute: "attribute" + rule, operator: "eq", value: "old" + rule })) } : {}),
      prices: (maximum ? [0, 1] : [0]).map(price => {
        const region = shippingOptionRegionIds[index * 2 + price];
        if (region === undefined) throw new Error("Missing Region for complete Shipping Option graph");
        return { region_id: region, amount: 100 + index + price, rules: [{ attribute: "cart_total", operator: "gte", value: 1 },
          { attribute: "cart_total", operator: "lt", value: 100 }] };
      }),
    }));
    return await Effect.runPromise(host.run(host.newRequestKey(), input));
  };
  /** Trusted fixture-only arrangements use the canonical scoped lifecycle. This
   * records real history/facts; it grants no adapter method or cascade shortcut.
   * Each independent table arrangement is explicit, as in the native witness. */
  const arrangeDeleted = async (source: keyof typeof modules,
    table: "shipping_option" | "shipping_option_rule" | "shipping_option_price_set" | "price_set" | "price" | "price_rule", keys: readonly JsonObject[]) => {
    const arrange = defineCommerceCommand("shippingOptionDeleteHistoricalArrangement", "write", Effect.fn(function* (ctx) {
      yield* (yield* ctx.table(table)).lifecycle(ctx.manager, "softDelete", keys); return null;
    }));
    const participant = defineAtomicCommerceParticipant("shipping_option_history_arrangement");
    const root = defineAtomicCommerceCommand("shippingOptionDeleteHistoricalArrangementRoot", ctx => ctx.call(participant, arrange, null));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...base.fixture.hostInput,
      participants: [{ participant, logicalStorage: modules[source].logicalStorage, commands: [arrange] }], commands: [root] }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, null)); } finally { await Effect.runPromise(host.close); }
  };
  /** Replacement histories are created by genuine module/Link commands through
   * the already admitted creation capabilities, rather than forged Link rows. */
  const replacePricing = async (pairs: readonly { readonly option: string; readonly priceSet: string }[], maximum = false) => {
    const Input = Schema.Array(Schema.Struct({ option: Schema.String, priceSet: Schema.String }));
    const replace = createStep("probe-shipping-option-pricing-history", base.resources.callback(async (value: typeof Input.Type, context) => {
      await context.resources.link.dismiss(value.map(pair => ({ fulfillment: { shipping_option_id: pair.option }, pricing: { price_set_id: pair.priceSet } })));
      const created = await context.resources.pricing.createPriceSets(value.map((_pair, index) => ({ prices: (maximum ? [0, 1] : [0]).map(price => {
        const region = shippingOptionRegionIds[index * 2 + price];
        if (region === undefined) throw new Error("Missing replacement Region");
        return { currency_code: "eur", amount: 200 + index + price, rules: { region_id: region,
          cart_total: [{ operator: "gte", value: 1 }, { operator: "lt", value: 100 }] },
        };
      }) })));
      await context.resources.link.create(value.map((pair, index) => {
        const set = created[index]; if (set === undefined || typeof set.id !== "string") throw new Error("Missing genuine replacement PriceSet");
        return { fulfillment: { shipping_option_id: pair.option }, pricing: { price_set_id: set.id } };
      }));
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-shipping-option-pricing-history", (value: WorkflowData<typeof Input.Type>) => new WorkflowResponse(replace(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...base.options, operationScheduling: "queued",
      requestCallLimit: shippingOptionCreationResources.calls, requestEventLimit: shippingOptionCreationResources.eventMessages,
      requestByteLimit: shippingOptionCreationResources.commandBytes,
      workflow: { name: "probeShippingOptionPricingHistory", resources: base.resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Input, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), pairs)); } finally { await Effect.runPromise(host.close); }
  };
  return { ...base, creation: base, fulfillment, modules, options, link, resources, prepare, prepareRoundtrip, seed, arrangeDeleted, replacePricing };
}
