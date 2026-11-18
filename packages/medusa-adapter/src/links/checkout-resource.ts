import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { OrderCart, OrderPaymentCollection, CustomerAccountHolder } from "@medusajs/link-modules";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { ScalarId } from "../repository/scalar-id-read";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { linkWorkflowServiceDefinition, type prepareLinkWorkflowService } from "./workflow-service";

const Order = Schema.Struct({ order_id: ScalarId });
const Batch = Schema.Array(Schema.Union([
  Schema.Struct({ order: Order, cart: Schema.Struct({ cart_id: ScalarId }) }),
  Schema.Struct({ order: Order, payment: Schema.Struct({ payment_collection_id: ScalarId }) }),
])).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 2));
const decodeArguments = commerceDecoder(Schema.Tuple([Batch]), "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)), "storedCorruption");
const AccountBatch = Schema.Array(Schema.Struct({ customer: Schema.Struct({ customer_id: ScalarId }),
  payment: Schema.Struct({ account_holder_id: ScalarId }) })).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 1));
const decodeAccountArguments = commerceDecoder(Schema.Tuple([AccountBatch]), "invalidInput");
const decodeCustomerCheckoutArguments = commerceDecoder(Schema.Union([Schema.Tuple([Batch]), Schema.Tuple([AccountBatch])]), "invalidInput");
type Native = Result.Result.Success<ReturnType<typeof prepareLinkWorkflowService>>;
type Definition = NonNullable<ReturnType<typeof linkWorkflowServiceDefinition>>;
type NativeLinkProfile = "checkout" | "customer-account" | "customer-checkout";
const nativeLinkProfiles = new WeakMap<object, NativeLinkProfile>();
export const nativeLinkResourceProfile = (resource: object): NativeLinkProfile | undefined => nativeLinkProfiles.get(resource);

/** One genuine native router owns cross-family creation and retained dismissal.
 * Its loaded services invoke only the two authenticated participant owners. */
function prepareNativeLinkResource(services: readonly Native[], profile: NativeLinkProfile) {
  return Result.gen(function* () {
    const selected: Array<Definition & { readonly dismissMethod: NonNullable<Definition["dismissMethod"]> }> = [];
    for (const service of services) {
      const definition = linkWorkflowServiceDefinition(service);
      if (definition?.dismissMethod === undefined || definition.admission !== "dismiss") return yield* Result.fail(commerceError("invalidAuthority"));
      selected.push({ ...definition, dismissMethod: definition.dismissMethod });
    }
    const names = selected.map(service => service.routing.__joinerConfig.serviceName);
    const expected = profile === "customer-account" ? [CustomerAccountHolder.serviceName]
      : profile === "checkout" ? [OrderCart.serviceName, OrderPaymentCollection.serviceName]
      : [OrderCart.serviceName, OrderPaymentCollection.serviceName, CustomerAccountHolder.serviceName];
    if (selected.length !== expected.length || new Set(names).size !== expected.length || expected.some(name => !names.includes(name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const argumentsDecoder = profile === "checkout" ? decodeArguments : profile === "customer-account" ? decodeAccountArguments : decodeCustomerCheckoutArguments;
    const resource = yield* defineComposedWorkflowResource({ identity: { format: profile === "checkout" ? "medusa.checkout.native-links"
      : profile === "customer-account" ? "medusa.customer-account.native-links" : "medusa.customer-checkout.native-links", services: selected.map(service => service.routing) },
      dependencies: selected.flatMap(service => [service.createMethod, service.listMethod, service.dismissMethod]),
      methods: { create: { arguments: argumentsDecoder, output: decodeRows }, dismiss: { arguments: argumentsDecoder, output: decodeRows } },
      bind: invoke => {
        const loaded = selected.map(service => ({ ...structuredClone(service.routing),
          list: async (filters: unknown = {}, config: unknown = {}) => [...await invoke(service.listMethod, filters, config)],
          create: async (bulk: unknown) => [...await invoke(service.createMethod, bulk)],
          dismiss: async (bulk: unknown) => [...await invoke(service.dismissMethod, bulk)],
        }));
        const native = new Link(loaded);
        type Arguments = Result.Result.Success<ReturnType<typeof argumentsDecoder>>;
        return { create: async (...[links]: Arguments) => native.create(links), dismiss: async (...[links]: Arguments) => native.dismiss(links) };
      },
    });
    nativeLinkProfiles.set(resource, profile);
    return resource;
  });
}
export const prepareCheckoutNativeLinkResource = (services: readonly Native[]) => prepareNativeLinkResource(services, "checkout");
export const prepareCustomerAccountNativeLinkResource = (service: Native) => prepareNativeLinkResource([service], "customer-account");
export const prepareCustomerCheckoutNativeLinkResource = (services: readonly Native[]) => prepareNativeLinkResource(services, "customer-checkout");
