import { Result, Schema } from "effect";
import { createStep, StepResponse, WorkflowDefinitionError, type StepOutput } from "@medusajs/workflows-sdk";
import { queryWorkflowGraph, type WorkflowGraphResource } from "./use-query-graph";
import { CartCollectionCreateQuery, CartCollectionCreateView, decodeCartCollectionCreateView } from "./payment-collection-query-views";

// Pinned Product lists retain the bounded graph seam. Named Fulfillment and
// Payment singleton profiles use the exact native callable Query ABI.
// Service queries, pagination variables and throwing relation options remain
// unadmitted at this deprecated step boundary.
const ListInput = Schema.Struct({
  entry_point: Schema.String,
  fields: Schema.Array(Schema.String),
  variables: Schema.optionalKey(Schema.Struct({ filters: Schema.optionalKey(Schema.JsonObject) })),
  list: Schema.optionalKey(Schema.Literal(true)),
});
const SingletonInput = Schema.Struct({
  entry_point: Schema.Literal("stock_location"),
  fields: Schema.Array(Schema.String),
  variables: Schema.Struct({ id: Schema.String }),
  list: Schema.Literal(false),
  throw_if_key_not_found: Schema.Literal(true),
});
const PaymentCollectionInput = Schema.Struct({ entry_point: Schema.Literal("payment_collection"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("amount"), Schema.Literal("raw_amount"), Schema.Literal("currency_code"), Schema.Literal("payment_sessions.*")]),
  variables: Schema.Struct({ id: Schema.String }), list: Schema.Literal(false) });
const PaymentCustomerInput = Schema.Struct({ entry_point: Schema.Literal("customer"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("email"), Schema.Literal("company_name"), Schema.Literal("first_name"),
    Schema.Literal("last_name"), Schema.Literal("phone"), Schema.Literal("addresses.*"), Schema.Literal("account_holders.*"), Schema.Literal("metadata")]),
  variables: Schema.Struct({ id: Schema.String }), list: Schema.Literal(false) });
const OrderPaymentInput = Schema.Struct({ entry_point: Schema.Literal("order_payment_collection"),
  fields: Schema.Tuple([Schema.Literal("order.id")]), variables: Schema.Struct({ payment_collection_id: Schema.String }),
  list: Schema.Literal(false), throw_if_key_not_found: Schema.optionalKey(Schema.Literal(true)) });
const RefundPaymentInput = Schema.Struct({ entry_point: Schema.Literal("payment"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("payment_collection_id"), Schema.Literal("currency_code"),
    Schema.Literal("amount"), Schema.Literal("raw_amount"), Schema.Literal("captures.raw_amount"), Schema.Literal("refunds.raw_amount")]),
  variables: Schema.Struct({ id: Schema.String }), list: Schema.Literal(false), throw_if_key_not_found: Schema.Literal(true) });
const RefundOrderInput = Schema.Struct({ entry_point: Schema.Literal("order"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("summary"), Schema.Literal("total"), Schema.Literal("currency_code"), Schema.Literal("region_id")]),
  variables: Schema.Struct({ id: Schema.String }), list: Schema.Literal(false), throw_if_key_not_found: Schema.Literal(true) });
const RefundReasonInput = Schema.Struct({ entry_point: Schema.Literal("refund_reason"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("label"), Schema.Literal("code")]),
  variables: Schema.Struct({ id: Schema.String }), list: Schema.Literal(false), throw_if_key_not_found: Schema.Literal(true) });
const Input = Schema.Union([ListInput, SingletonInput, PaymentCollectionInput, PaymentCustomerInput, OrderPaymentInput, CartCollectionCreateQuery,
  RefundPaymentInput, RefundOrderInput, RefundReasonInput]);
const retainedProjection = { parseOptions: { onExcessProperty: "preserve" as const } };
const RawAmount = Schema.Struct({ value: Schema.String, precision: Schema.Finite });
const PaymentCollectionView = Schema.Struct({ id: Schema.String, amount: Schema.Number.check(Schema.isFinite()), raw_amount: RawAmount, currency_code: Schema.String,
  payment_sessions: Schema.Array(Schema.Struct({ id: Schema.String, authorized_at: Schema.NullOr(Schema.String) }).annotate(retainedProjection)) }).annotate(retainedProjection);
const PaymentCustomerView = Schema.Struct({ id: Schema.String, email: Schema.String, company_name: Schema.NullOr(Schema.String),
  first_name: Schema.NullOr(Schema.String), last_name: Schema.NullOr(Schema.String), phone: Schema.NullOr(Schema.String),
  addresses: Schema.Array(Schema.JsonObject), account_holders: Schema.Array(Schema.Struct({ id: Schema.String, provider_id: Schema.String,
    data: Schema.JsonObject }).annotate(retainedProjection)), metadata: Schema.NullOr(Schema.JsonObject) }).annotate(retainedProjection);
const decodeCollectionView = Schema.decodeUnknownResult(Schema.UndefinedOr(PaymentCollectionView));
const decodeCustomerView = Schema.decodeUnknownResult(Schema.UndefinedOr(PaymentCustomerView));
const OrderPaymentView = Schema.Struct({ order: Schema.NullOr(Schema.Struct({ id: Schema.String })) });
const decodeOrderPaymentView = Schema.decodeUnknownResult(Schema.UndefinedOr(OrderPaymentView), { onExcessProperty: "error" });
const decodeRequiredOrderPaymentView = Schema.decodeUnknownResult(OrderPaymentView, { onExcessProperty: "error" });
// These contracts describe the exact selected JSON projections. Native DML and
// the numeric owner validate stored quantities before the Query ABI returns them.
const RefundPaymentView = Schema.Struct({ id: Schema.String, payment_collection_id: Schema.String, currency_code: Schema.String,
  amount: Schema.Finite, raw_amount: RawAmount,
  captures: Schema.Array(Schema.Struct({ raw_amount: RawAmount })),
  refunds: Schema.Array(Schema.Struct({ raw_amount: RawAmount })) });
const RefundOrderView = Schema.Struct({ id: Schema.String, total: Schema.Finite, currency_code: Schema.String,
  region_id: Schema.NullOr(Schema.String), summary: Schema.optionalKey(Schema.NullOr(Schema.Struct({
    pending_difference: Schema.optionalKey(Schema.Finite), raw_pending_difference: Schema.optionalKey(RawAmount),
  }).annotate(retainedProjection))) });
const RefundReasonView = Schema.Struct({ id: Schema.String, label: Schema.String, code: Schema.String });
export type RefundPaymentQueryView = typeof RefundPaymentView.Type;
const decodeRefundPaymentView = Schema.decodeUnknownResult(RefundPaymentView, { onExcessProperty: "error" });
const decodeRefundOrderView = Schema.decodeUnknownResult(RefundOrderView, { onExcessProperty: "error" });
const decodeRefundReasonView = Schema.decodeUnknownResult(RefundReasonView, { onExcessProperty: "error" });
// Native selectors enter as foreign values; the decoder below owns their JSON
// contract before the Query resource receives them.
type ListStepInput = Omit<typeof ListInput.Type, "variables"> & {
  readonly variables?: { readonly filters?: unknown };
};
type SingletonStepInput = typeof SingletonInput.Type;
export type EntryStepInput = ListStepInput | SingletonStepInput | typeof PaymentCollectionInput.Type | typeof PaymentCustomerInput.Type | typeof OrderPaymentInput.Type
  | typeof RefundPaymentInput.Type | typeof RefundOrderInput.Type | typeof RefundReasonInput.Type | typeof CartCollectionCreateQuery.Type;
type Row = typeof Schema.JsonObject.Type;
interface SingletonQueryResource {
  (input: { readonly entryPoint: "stock_location" | "payment_collection" | "customer" | "payment" | "order" | "refund_reason" | "cart"; readonly fields: readonly string[]; readonly variables: { readonly id: string } }
    | { readonly entryPoint: "order_payment_collection"; readonly fields: readonly string[]; readonly variables: { readonly payment_collection_id: string } },
    options: { readonly throwIfKeyNotFound: boolean; readonly throwIfRelationNotFound: undefined }): Promise<readonly Row[]>;
}
const decode = Schema.decodeUnknownResult(Input, { onExcessProperty: "error" });
export const useRemoteQueryStepId = "use-remote-query";
const step = createStep<EntryStepInput, Row | readonly Row[] | undefined>(useRemoteQueryStepId, async (input, { container }) => {
  // Deliberate Promise/throw boundary matching the native step contract.
  const data = Result.getOrThrow(decode(input).pipe(Result.mapError(() => new WorkflowDefinitionError({
    reason: "unsupportedProfile", detail: "Unsupported native remote query step options",
  }))));
  if (data.list === false) {
    const query = container.resolve<SingletonQueryResource>("query");
    if (data.entry_point === "order_payment_collection") {
      const entities = await query({ entryPoint: data.entry_point, fields: data.fields, variables: data.variables },
        { throwIfKeyNotFound: data.throw_if_key_not_found === true, throwIfRelationNotFound: undefined });
      const decoded = data.throw_if_key_not_found === true ? decodeRequiredOrderPaymentView(entities[0]) : decodeOrderPaymentView(entities[0]);
      return new StepResponse(Result.getOrThrow(decoded.pipe(Result.mapError(() =>
        new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native Order payment association projection" })))));
    }
    const entities = await query({ entryPoint: data.entry_point, fields: data.fields, variables: data.variables },
      { throwIfKeyNotFound: data.entry_point !== "payment_collection" && data.entry_point !== "customer", throwIfRelationNotFound: undefined });
    const result = entities[0];
    if (data.entry_point === "cart") return new StepResponse(Result.getOrThrow(decodeCartCollectionCreateView(result)
      .pipe(Result.mapError(() => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native Cart payment projection" })))));
    if (data.entry_point === "payment_collection") return new StepResponse(Result.getOrThrow(decodeCollectionView(result)
      .pipe(Result.mapError(() => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native Payment collection projection" })))));
    if (data.entry_point === "customer") return new StepResponse(Result.getOrThrow(decodeCustomerView(result)
      .pipe(Result.mapError(() => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native Payment Customer projection" })))));
    if (data.entry_point === "payment") return new StepResponse(Result.getOrThrow(decodeRefundPaymentView(result)
      .pipe(Result.mapError(() => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native refund Payment projection" })))));
    if (data.entry_point === "order") return new StepResponse(Result.getOrThrow(decodeRefundOrderView(result)
      .pipe(Result.mapError(() => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native refund Order projection" })))));
    if (data.entry_point === "refund_reason") return new StepResponse(Result.getOrThrow(decodeRefundReasonView(result)
      .pipe(Result.mapError(() => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native refund reason projection" })))));
    return new StepResponse(result);
  }
  const result = await queryWorkflowGraph({ entity: data.entry_point, fields: data.fields,
    ...(data.variables?.filters === undefined ? {} : { filters: data.variables.filters }),
  }, container.resolve<WorkflowGraphResource>("query"));
  return new StepResponse(result.data);
});

// Dynamic selection exposes partial records, never a caller-chosen module DTO.
export function useRemoteQueryStep(input: typeof CartCollectionCreateQuery.Type): StepOutput<typeof CartCollectionCreateView.Type>;
export function useRemoteQueryStep(input: SingletonStepInput): StepOutput<Row | undefined>;
export function useRemoteQueryStep(input: typeof PaymentCollectionInput.Type): StepOutput<typeof PaymentCollectionView.Type | undefined>;
export function useRemoteQueryStep(input: typeof PaymentCustomerInput.Type): StepOutput<typeof PaymentCustomerView.Type | undefined>;
export function useRemoteQueryStep(input: typeof OrderPaymentInput.Type & { readonly throw_if_key_not_found: true }): StepOutput<typeof OrderPaymentView.Type>;
export function useRemoteQueryStep(input: typeof OrderPaymentInput.Type): StepOutput<typeof OrderPaymentView.Type | undefined>;
export function useRemoteQueryStep(input: typeof RefundPaymentInput.Type): StepOutput<typeof RefundPaymentView.Type>;
export function useRemoteQueryStep(input: typeof RefundOrderInput.Type): StepOutput<typeof RefundOrderView.Type>;
export function useRemoteQueryStep(input: typeof RefundReasonInput.Type): StepOutput<typeof RefundReasonView.Type>;
export function useRemoteQueryStep(input: ListStepInput): StepOutput<readonly Row[]>;
export function useRemoteQueryStep(input: EntryStepInput): StepOutput<Row | readonly Row[] | undefined>;
export function useRemoteQueryStep(input: EntryStepInput): unknown { return step(input); }
