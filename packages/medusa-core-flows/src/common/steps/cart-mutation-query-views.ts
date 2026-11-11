import { Result, Schema } from "effect";
import { createStep, StepResponse, WorkflowDefinitionError, type StepOutput, type WorkflowContainer } from "@medusajs/workflows-sdk";
import { queryWorkflowGraph, type WorkflowGraphResource } from "./use-query-graph";
import { NativeCartShippingMethodView } from "./cart-mutation-shipping-query-views";

const Json = Schema.Record(Schema.String, Schema.Json), Text = Schema.NullOr(Schema.String);
const Row = Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Json]);
const Raw = Schema.Struct({ value: Schema.String, precision: Schema.Finite });
const Address = Schema.StructWithRest(Schema.Struct({ id: Schema.optionalKey(Schema.String),
  country_code: Schema.optionalKey(Text), city: Schema.optionalKey(Text), province: Schema.optionalKey(Text), postal_code: Schema.optionalKey(Text),
}), [Json]);
export const CartMutationRegionView = Schema.StructWithRest(Schema.Struct({ id: Schema.String, name: Schema.String,
  currency_code: Schema.String, countries: Schema.Array(Schema.StructWithRest(Schema.Struct({ iso_2: Schema.String }), [Json])).pipe(Schema.mutable),
}), [Json]);
const Customer = Schema.StructWithRest(Schema.Struct({ id: Schema.String,
  groups: Schema.optionalKey(Schema.Array(Row).pipe(Schema.mutable)),
}), [Json]);
export const CartMutationUpdateView = Schema.StructWithRest(Schema.Struct({ id: Schema.String,
  email: Text, customer_id: Text, sales_channel_id: Text, locale: Text,
  completed_at: Schema.optionalKey(Text), shipping_address: Schema.optionalKey(Schema.NullOr(Address)),
  region: Schema.optionalKey(Schema.NullOr(CartMutationRegionView)),
}), [Json]);
export type CartMutationUpdateView = typeof CartMutationUpdateView.Type;
const pricingFields = { id: Schema.String, currency_code: Schema.String,
  region_id: Text, sales_channel_id: Text, email: Text, locale: Text, total: Schema.Finite, item_total: Schema.Finite,
  completed_at: Schema.optionalKey(Text), customer_id: Schema.optionalKey(Text),
  shipping_address: Schema.optionalKey(Schema.NullOr(Address)), customer: Schema.optionalKey(Schema.NullOr(Customer)),
};
export const CartMutationPricingView = Schema.StructWithRest(Schema.Struct(pricingFields), [Json]);
export type CartMutationPricingView = typeof CartMutationPricingView.Type;
export const CartMutationItemView = Schema.StructWithRest(Schema.Struct({ id: Schema.String, cart_id: Schema.String,
  title: Schema.String, quantity: Schema.Finite, unit_price: Schema.Finite, variant_id: Text,
  is_custom_price: Schema.Boolean, is_tax_inclusive: Schema.Boolean, metadata: Schema.NullOr(Schema.JsonObject),
}), [Json]);
const itemCartFields = { ...pricingFields,
  items: Schema.Array(CartMutationItemView).pipe(Schema.mutable),
};
export const CartMutationItemCartView = Schema.StructWithRest(Schema.Struct(itemCartFields), [Json]);
export type CartMutationItemCartView = typeof CartMutationItemCartView.Type;
const Collection = Schema.StructWithRest(Schema.Struct({ id: Schema.String, amount: Schema.Finite, raw_amount: Raw,
  currency_code: Schema.String, payment_sessions: Schema.Array(Row).pipe(Schema.mutable),
}), [Json]);
export const CartMutationRefreshView = Schema.StructWithRest(Schema.Struct({ ...itemCartFields,
  completed_at: Text, raw_total: Raw, region: Schema.optionalKey(Schema.NullOr(Schema.StructWithRest(Schema.Struct({ id: Schema.String,
    currency_code: Schema.String,
  }), [Json]))),
  promotions: Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String, code: Text }), [Json])).pipe(Schema.mutable),
  shipping_methods: Schema.Array(NativeCartShippingMethodView).pipe(Schema.mutable),
  payment_collection: Schema.optionalKey(Schema.NullOr(Collection)),
}), [Json]);
export type CartMutationRefreshView = typeof CartMutationRefreshView.Type;
const Variant = Schema.StructWithRest(Schema.Struct({ id: Schema.String,
  calculated_price: Schema.optionalKey(Schema.NullOr(Schema.StructWithRest(Schema.Struct({ calculated_amount: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
    is_calculated_price_tax_inclusive: Schema.optionalKey(Schema.Boolean),
  }), [Json]))),
}), [Json]);
const ShippingCart = Schema.StructWithRest(Schema.Struct({ id: Schema.String, sales_channel_id: Text, currency_code: Schema.String,
  region_id: Text, total: Schema.Finite, shipping_address: Schema.optionalKey(Schema.NullOr(Address)),
  shipping_methods: Schema.Array(NativeCartShippingMethodView).pipe(Schema.mutable),
}), [Json]);
const Location = Schema.StructWithRest(Schema.Struct({ id: Schema.String, name: Schema.String,
  address: Schema.optionalKey(Schema.NullOr(Address)), fulfillment_sets: Schema.Array(Row).pipe(Schema.mutable),
}), [Json]);
const Channel = Schema.StructWithRest(Schema.Struct({ stock_locations: Schema.Array(Location).pipe(Schema.mutable) }), [Json]);
const Option = Schema.StructWithRest(Schema.Struct({ id: Schema.String, price_type: Schema.String }), [Json]);
const malformed = () => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native Cart mutation graph projection" });
const decodeEntity = Schema.decodeUnknownResult(Schema.Struct({ entity: Schema.String }));
const decodeUpdate = Schema.decodeUnknownResult(CartMutationUpdateView), decodeRegion = Schema.decodeUnknownResult(CartMutationRegionView);
const decodeIds = Schema.decodeUnknownResult(Schema.Array(Row).pipe(Schema.mutable));
const decodePricing = Schema.decodeUnknownResult(CartMutationPricingView), decodeItems = Schema.decodeUnknownResult(CartMutationItemCartView);
const decodeVariants = Schema.decodeUnknownResult(Schema.Array(Variant).pipe(Schema.mutable));
const decodeRefresh = Schema.decodeUnknownResult(Schema.UndefinedOr(CartMutationRefreshView));
const decodeShipping = Schema.decodeUnknownResult(Schema.UndefinedOr(ShippingCart));
const decodeShippingCarts = Schema.decodeUnknownResult(Schema.Array(CartMutationPricingView).pipe(Schema.mutable));
const decodeChannels = Schema.decodeUnknownResult(Schema.Array(Channel).pipe(Schema.mutable));
const decodeOptions = Schema.decodeUnknownResult(Schema.Array(Option).pipe(Schema.mutable));

/** Query's existing owner admits the full native selection and validates DML.
 * These callback views check only consumed projected data; they grant no query,
 * module, storage or complete DTO authority. Unknown input enters that owner's
 * existing decoder before these successful-output projections are examined. */
const read = async (input: unknown, container: WorkflowContainer) => {
  const entity = Result.getOrThrow(decodeEntity(input).pipe(Result.mapError(malformed))).entity;
  const result = await queryWorkflowGraph(input, container.resolve<WorkflowGraphResource>("query"));
  return { entity, result };
};
const decode = <A>(decoder: (value: unknown) => Result.Result<A, unknown>, value: unknown) =>
  Result.getOrThrow(decoder(value).pipe(Result.mapError(malformed)));
const update = createStep("use-query-graph-step", async (input: unknown, { container }) => {
  const { entity, result } = await read(input, container);
  const data = entity === "cart" ? decode(decodeUpdate, result.data) : entity === "region" ? decode(decodeRegion, result.data)
    : entity === "line_items" ? decode(decodeIds, result.data) : Result.getOrThrow(Result.fail(malformed()));
  return new StepResponse({ ...result, data });
});
const add = createStep("use-query-graph-step", async (input: unknown, { container }) => {
  const { entity, result } = await read(input, container);
  const data = entity === "cart" ? decode(decodePricing, result.data) : entity === "variants" ? decode(decodeVariants, result.data)
    : Result.getOrThrow(Result.fail(malformed()));
  return new StepResponse({ ...result, data });
});
const item = createStep("use-query-graph-step", async (input: unknown, { container }) => {
  const { entity, result } = await read(input, container);
  const data = entity === "cart" ? decode(decodeItems, result.data) : entity === "variants" ? decode(decodeVariants, result.data)
    : Result.getOrThrow(Result.fail(malformed()));
  return new StepResponse({ ...result, data });
});
const refresh = createStep("use-query-graph-step", async (input: unknown, { container }) => {
  const { result } = await read(input, container);
  return new StepResponse({ ...result, data: decode(decodeRefresh, result.data) });
});
const shipping = createStep("use-query-graph-step", async (input: unknown, { container }) => {
  const { result } = await read(input, container);
  return new StepResponse({ ...result, data: decode(decodeShipping, result.data) });
});
const options = createStep("use-query-graph-step", async (input: unknown, { container }) => {
  const { entity, result } = await read(input, container);
  const data = entity === "cart" ? decode(decodeShippingCarts, result.data) : entity === "sales_channels" ? decode(decodeChannels, result.data)
    : entity === "shipping_options" ? decode(decodeOptions, result.data) : Result.getOrThrow(Result.fail(malformed()));
  return new StepResponse({ ...result, data });
});
type Metadata = { readonly count: number; readonly skip: number; readonly take: number };
type Selected<A> = StepOutput<{ readonly data: A; readonly metadata: Metadata }>;
export function useCartUpdateQueryGraphStep(input: { readonly entity: "cart"; readonly [key: string]: unknown }): Selected<CartMutationUpdateView>;
export function useCartUpdateQueryGraphStep(input: { readonly entity: "region"; readonly [key: string]: unknown }): Selected<typeof CartMutationRegionView.Type>;
export function useCartUpdateQueryGraphStep(input: { readonly entity: "line_items"; readonly [key: string]: unknown }): Selected<(typeof Row.Type)[]>;
export function useCartUpdateQueryGraphStep(input: unknown): unknown { return update(input); }
export function useAddToCartQueryGraphStep(input: { readonly entity: "cart"; readonly [key: string]: unknown }): Selected<CartMutationPricingView>;
export function useAddToCartQueryGraphStep(input: { readonly entity: "variants"; readonly [key: string]: unknown }): Selected<(typeof Variant.Type)[]>;
export function useAddToCartQueryGraphStep(input: unknown): unknown { return add(input); }
export function useItemUpdateQueryGraphStep(input: { readonly entity: "cart"; readonly [key: string]: unknown }): Selected<CartMutationItemCartView>;
export function useItemUpdateQueryGraphStep(input: { readonly entity: "variants"; readonly [key: string]: unknown }): Selected<(typeof Variant.Type)[]>;
export function useItemUpdateQueryGraphStep(input: unknown): unknown { return item(input); }
export function useCartRefreshQueryGraphStep(input: unknown) { return refresh(input); }
export function useCartShippingQueryGraphStep(input: unknown) { return shipping(input); }
export function useCartShippingOptionsQueryGraphStep(input: { readonly entity: "cart"; readonly [key: string]: unknown }): Selected<CartMutationPricingView[]>;
export function useCartShippingOptionsQueryGraphStep(input: { readonly entity: "sales_channels"; readonly [key: string]: unknown }): Selected<(typeof Channel.Type)[]>;
export function useCartShippingOptionsQueryGraphStep(input: { readonly entity: "shipping_options"; readonly [key: string]: unknown }): Selected<(typeof Option.Type)[]>;
export function useCartShippingOptionsQueryGraphStep(input: unknown): unknown { return options(input); }
