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
const decodeAccountArguments = commerceDecoder(Schema.Tuple([Schema.Array(Schema.Struct({ customer: Schema.Struct({ customer_id: ScalarId }),
  payment: Schema.Struct({ account_holder_id: ScalarId }) })).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 1))]), "invalidInput");
type Native = Result.Result.Success<ReturnType<typeof prepareLinkWorkflowService>>;
type Definition = NonNullable<ReturnType<typeof linkWorkflowServiceDefinition>>;

/** One genuine native router owns cross-family creation and retained dismissal.
 * Its loaded services invoke only the two authenticated participant owners. */
function prepareNativeLinkResource(services: readonly Native[], profile: "checkout" | "customer-account") {
  return Result.gen(function* () {
    const selected: Array<Definition & { readonly dismissMethod: NonNullable<Definition["dismissMethod"]> }> = [];
    for (const service of services) {
      const definition = linkWorkflowServiceDefinition(service);
      if (definition?.dismissMethod === undefined || definition.admission !== "dismiss") return yield* Result.fail(commerceError("invalidAuthority"));
      selected.push({ ...definition, dismissMethod: definition.dismissMethod });
    }
    const names = selected.map(service => service.routing.__joinerConfig.serviceName);
    if (profile === "checkout" ? selected.length !== 2 || new Set(names).size !== 2 || !names.includes(OrderCart.serviceName) || !names.includes(OrderPaymentCollection.serviceName)
      : selected.length !== 1 || names[0] !== CustomerAccountHolder.serviceName)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const argumentsDecoder = profile === "checkout" ? decodeArguments : decodeAccountArguments;
    return yield* defineComposedWorkflowResource({ identity: { format: profile === "checkout" ? "medusa.checkout.native-links" : "medusa.customer-account.native-links", services: selected.map(service => service.routing) },
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
  });
}
export const prepareCheckoutNativeLinkResource = (services: readonly Native[]) => prepareNativeLinkResource(services, "checkout");
export const prepareCustomerAccountNativeLinkResource = (service: Native) => prepareNativeLinkResource([service], "customer-account");
