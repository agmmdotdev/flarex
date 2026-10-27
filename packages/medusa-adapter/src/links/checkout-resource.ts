import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { OrderCart, OrderPaymentCollection } from "@medusajs/link-modules";
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
type Native = Result.Result.Success<ReturnType<typeof prepareLinkWorkflowService>>;
type Definition = NonNullable<ReturnType<typeof linkWorkflowServiceDefinition>>;

/** One genuine native router owns cross-family creation and retained dismissal.
 * Its loaded services invoke only the two authenticated participant owners. */
export function prepareCheckoutNativeLinkResource(services: readonly Native[]) {
  return Result.gen(function* () {
    const selected: Array<Definition & { readonly dismissMethod: NonNullable<Definition["dismissMethod"]> }> = [];
    for (const service of services) {
      const definition = linkWorkflowServiceDefinition(service);
      if (definition?.dismissMethod === undefined || definition.admission !== "dismiss") return yield* Result.fail(commerceError("invalidAuthority"));
      selected.push({ ...definition, dismissMethod: definition.dismissMethod });
    }
    const names = selected.map(service => service.routing.__joinerConfig.serviceName);
    if (selected.length !== 2 || new Set(names).size !== 2 || !names.includes(OrderCart.serviceName) || !names.includes(OrderPaymentCollection.serviceName))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.checkout.native-links", services: selected.map(service => service.routing) },
      dependencies: selected.flatMap(service => [service.createMethod, service.listMethod, service.dismissMethod]),
      methods: { create: { arguments: decodeArguments, output: decodeRows }, dismiss: { arguments: decodeArguments, output: decodeRows } },
      bind: invoke => {
        const loaded = selected.map(service => ({ ...structuredClone(service.routing),
          list: async (filters: unknown = {}, config: unknown = {}) => [...await invoke(service.listMethod, filters, config)],
          create: async (bulk: unknown) => [...await invoke(service.createMethod, bulk)],
          dismiss: async (bulk: unknown) => [...await invoke(service.dismissMethod, bulk)],
        }));
        const native = new Link(loaded);
        return { create: native.create.bind(native), dismiss: native.dismiss.bind(native) };
      },
    });
  });
}
