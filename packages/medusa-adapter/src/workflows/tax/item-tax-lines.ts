import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { getItemTaxLinesStep } from "@medusajs/core-flows/tax/get-item-tax-lines";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makeTaxLinesCommands } from "../../modules/tax/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Numeric = Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite())]);
const OptionalText = Schema.optionalKey(Schema.NullOr(Schema.String));
const Address = Schema.StructWithRest(Schema.Struct({ country_code: OptionalText, province: OptionalText,
  address_1: OptionalText, address_2: OptionalText, city: OptionalText, postal_code: OptionalText,
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
}), [Schema.Record(Schema.String, Schema.Json)]);
const Shipping = Schema.StructWithRest(Schema.Struct({ id: Id, name: Schema.optionalKey(Schema.String),
  shipping_option_id: OptionalText, amount: Numeric,
}), [Schema.Record(Schema.String, Schema.Json)]);
const ShippingMethods = Schema.Array(Shipping).check(Schema.isMaxLength(4));
const Item = Schema.StructWithRest(Schema.Struct({ id: Id, product_id: OptionalText, product_type_id: OptionalText,
  quantity: Numeric, unit_price: Numeric, is_giftcard: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
}), [Schema.Record(Schema.String, Schema.Json)]);
const Customer = Schema.StructWithRest(Schema.Struct({ id: Schema.optionalKey(Id), email: OptionalText,
  groups: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }),
    [Schema.Record(Schema.String, Schema.Json)])))), metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
}), [Schema.Record(Schema.String, Schema.Json)]);
const OrderOrCart = Schema.StructWithRest(Schema.Struct({ currency_code: Schema.String,
  region: Schema.optionalKey(Schema.NullOr(Schema.StructWithRest(Schema.Struct({
    automatic_taxes: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  }), [Schema.Record(Schema.String, Schema.Json)]))),
  shipping_address: Schema.optionalKey(Schema.NullOr(Address)), customer: Schema.optionalKey(Schema.NullOr(Customer)),
  locale: OptionalText, shipping_methods: Schema.optionalKey(Schema.NullOr(ShippingMethods)),
}), [Schema.Record(Schema.String, Schema.Json)]);

/** Supplied native values grant no Cart, Order or Product read authority. The
 * finite JSON rest preserves unused DTO fields; native code owns projection,
 * address fallback, context construction and gift-card filtering. */
export const ItemTaxLinesInput = Schema.Struct({ orderOrCart: OrderOrCart,
  items: Schema.optionalKey(Schema.Array(Item).check(Schema.isMaxLength(4))),
  shipping_methods: Schema.optionalKey(ShippingMethods),
  force_tax_calculation: Schema.optionalKey(Schema.Boolean), is_return: Schema.optionalKey(Schema.Boolean),
  shipping_address: Schema.optionalKey(Schema.NullOr(Address)),
});
const TaxLine = { rate_id: Id, rate: Schema.Number.check(Schema.isFinite()), name: Schema.String,
  code: Schema.String, provider_id: Schema.Literal("system") };
export const ItemTaxLinesOutput = Schema.Struct({
  lineItemTaxLines: Schema.Array(Schema.Struct({ ...TaxLine, line_item_id: Id })).check(Schema.isMaxLength(8)),
  shippingMethodsTaxLines: Schema.Array(Schema.Struct({ ...TaxLine, shipping_line_id: Id })).check(Schema.isMaxLength(8)),
});
const itemTaxLinesWorkflow = createWorkflow("native-item-tax-lines", (input: WorkflowData<typeof ItemTaxLinesInput.Type>) => {
  // Native authoring DTOs require complete mutable Cart/Order objects. This
  // private read child validates only the supplied fields the genuine step
  // consumes, retaining every other supplied field as bounded JSON.
  const output = getItemTaxLinesStep(input as unknown as Parameters<typeof getItemTaxLinesStep>[0]);
  return new WorkflowResponse(output);
});
type Tax = Effect.Success<ReturnType<typeof makeTaxLinesCommands>>["workflow"];

/** One read-only native step borrows one Tax participant and its local provider.
 * There is no remote provider, Tax write, event or compensator in this root. */
export const prepareItemTaxLinesWorkflow = Effect.fn("Tax.prepareItemTaxLines")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly tax: InstalledWorkflowModule<Tax> };
  readonly revision: string;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["tax"]));
  const source = workflowModuleDefinition(modules.tax.module)?.source;
  if (source?.name !== "flarex-tax-item-lines" || source.profile !== "tax.itemTaxLines")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.tax.logicalResources !== undefined || modules.tax.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ tax: {
    module: modules.tax.module, methods: ["getTaxLines"], graph: false,
  } }, false));
  const prepared = yield* Effect.fromResult(itemTaxLinesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "nativeItemTaxLines", resources, prepared, input: ItemTaxLinesInput, output: ItemTaxLinesOutput } });
});
