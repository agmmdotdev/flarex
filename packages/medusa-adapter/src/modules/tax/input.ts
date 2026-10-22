import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { decodeWorkflowCommandInput, type WorkflowIntermediateValue } from "../../workflow/value";
import { TaxId, taxLinesLimits } from "./query";

/** The method boundary already captures descriptors, cycles, depth and bytes.
 * This recursive value schema preserves arbitrary own undefined metadata. */
const Intermediate: Schema.Codec<WorkflowIntermediateValue> = Schema.suspend(() => Schema.Union([
  Schema.String, Schema.Number.check(Schema.isFinite()), Schema.Boolean, Schema.Null, Schema.Undefined,
  Schema.Array(Intermediate), Schema.Record(Schema.String, Intermediate),
]));
const Metadata = Schema.Record(Schema.String, Intermediate);
const Text = Schema.optionalKey(Schema.Union([Schema.String, Schema.Null, Schema.Undefined]));
const NumberInput = Schema.Union([Schema.Number.check(Schema.isFinite()), Schema.String,
  Schema.StructWithRest(Schema.Struct({ value: Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite())]) }), [Schema.Record(Schema.String, Intermediate)])]);
const OptionalNumber = Schema.optionalKey(Schema.Union([NumberInput, Schema.Null, Schema.Undefined]));
const Item = Schema.Struct({ id: TaxId, product_id: Schema.Union([TaxId, Schema.Null, Schema.Undefined]),
  product_type_id: Text, quantity: OptionalNumber, unit_price: OptionalNumber, currency_code: Text });
const Shipping = Schema.Struct({ id: TaxId, shipping_option_id: Schema.Union([TaxId, Schema.Null, Schema.Undefined]),
  unit_price: OptionalNumber, currency_code: Text });
export const TaxableLine = Schema.Union([Item, Shipping]);
export const TaxableLines = Schema.Array(TaxableLine).check(Schema.isMaxLength(taxLinesLimits.items + taxLinesLimits.shipping),
  Schema.makeFilter(lines => lines.filter(line => "shipping_option_id" in line).length <= taxLinesLimits.shipping &&
    lines.filter(line => !("shipping_option_id" in line)).length <= taxLinesLimits.items || "Expected at most four item and four shipping lines"));
export const TaxCalculationContext = Schema.Struct({
  address: Schema.Struct({ country_code: Schema.String.check(Schema.isMaxLength(256)), province_code: Text, address_1: Text,
    address_2: Text, city: Text, postal_code: Text,
    metadata: Schema.optionalKey(Schema.Union([Metadata, Schema.Null, Schema.Undefined])) }),
  customer: Schema.optionalKey(Schema.Union([Schema.Struct({ id: Schema.Union([TaxId, Schema.Undefined]), email: Schema.Union([Schema.String, Schema.Null, Schema.Undefined]),
    customer_groups: Schema.Array(TaxId), metadata: Schema.optionalKey(Schema.Union([Metadata, Schema.Null, Schema.Undefined])) }), Schema.Null, Schema.Undefined])),
  is_return: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Undefined])), locale: Text,
  shipping_methods: Schema.optionalKey(Schema.Union([Schema.Array(Schema.Struct({ id: TaxId, name: Schema.Union([Schema.String, Schema.Undefined]),
    shipping_option_id: Schema.Union([TaxId, Schema.Null, Schema.Undefined]), amount: NumberInput })).check(Schema.isMaxLength(taxLinesLimits.shipping)), Schema.Undefined])),
});
export const TaxLinesInput = Schema.Struct({ items: TaxableLines, context: TaxCalculationContext });
export const decodeTaxLinesInput = commerceDecoder(TaxLinesInput, "invalidInput");
export const decodeTaxLinesArguments = commerceDecoder(Schema.Tuple([TaxableLines, TaxCalculationContext]), "invalidInput");
export const decodeTaxLinesCommandInput = (input: unknown) => decodeWorkflowCommandInput(input, decodeTaxLinesInput);
const TaxLine = { rate_id: TaxId, rate: Schema.Number.check(Schema.isFinite()), name: Schema.String, code: Schema.String, provider_id: Schema.Literal("system") };
export const TaxLinesOutput = Schema.Array(Schema.Union([Schema.Struct({ ...TaxLine, line_item_id: TaxId }),
  Schema.Struct({ ...TaxLine, shipping_line_id: TaxId })])).check(Schema.isMaxLength(2 * (taxLinesLimits.items + taxLinesLimits.shipping)));
export const decodeTaxLinesOutput = commerceDecoder(TaxLinesOutput, "storedCorruption");
