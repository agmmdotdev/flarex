import { Result, Schema } from "effect";
import { createStep, StepResponse, WorkflowDefinitionError, type StepOutput } from "@medusajs/workflows-sdk";
import { queryWorkflowGraph, type WorkflowGraphResource } from "./use-query-graph";

// Pinned Product lists retain the bounded graph seam. Fulfillment creation
// additionally uses the exact native Stock Location singleton callable ABI.
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
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("amount"), Schema.Literal("currency_code"), Schema.Literal("payment_sessions.*")]),
  variables: Schema.Struct({ id: Schema.String }), list: Schema.Literal(false) });
const PaymentCustomerInput = Schema.Struct({ entry_point: Schema.Literal("customer"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("email"), Schema.Literal("company_name"), Schema.Literal("first_name"),
    Schema.Literal("last_name"), Schema.Literal("phone"), Schema.Literal("addresses.*"), Schema.Literal("account_holders.*"), Schema.Literal("metadata")]),
  variables: Schema.Struct({ id: Schema.String }), list: Schema.Literal(false) });
const Input = Schema.Union([ListInput, SingletonInput, PaymentCollectionInput, PaymentCustomerInput]);
const retainedProjection = { parseOptions: { onExcessProperty: "preserve" as const } };
const PaymentCollectionView = Schema.Struct({ id: Schema.String, amount: Schema.Number.check(Schema.isFinite()), currency_code: Schema.String,
  payment_sessions: Schema.Array(Schema.Struct({ id: Schema.String }).annotate(retainedProjection)) }).annotate(retainedProjection);
const PaymentCustomerView = Schema.Struct({ id: Schema.String, email: Schema.String, company_name: Schema.NullOr(Schema.String),
  first_name: Schema.NullOr(Schema.String), last_name: Schema.NullOr(Schema.String), phone: Schema.NullOr(Schema.String),
  addresses: Schema.Array(Schema.JsonObject), account_holders: Schema.Array(Schema.Struct({ id: Schema.String, provider_id: Schema.String,
    data: Schema.JsonObject }).annotate(retainedProjection)), metadata: Schema.NullOr(Schema.JsonObject) }).annotate(retainedProjection);
const decodeCollectionView = Schema.decodeUnknownResult(Schema.UndefinedOr(PaymentCollectionView));
const decodeCustomerView = Schema.decodeUnknownResult(Schema.UndefinedOr(PaymentCustomerView));
// Native selectors enter as foreign values; the decoder below owns their JSON
// contract before the Query resource receives them.
type ListStepInput = Omit<typeof ListInput.Type, "variables"> & {
  readonly variables?: { readonly filters?: unknown };
};
type SingletonStepInput = typeof SingletonInput.Type;
export type EntryStepInput = ListStepInput | SingletonStepInput | typeof PaymentCollectionInput.Type | typeof PaymentCustomerInput.Type;
type Row = typeof Schema.JsonObject.Type;
interface SingletonQueryResource {
  (input: { readonly entryPoint: "stock_location" | "payment_collection" | "customer"; readonly fields: readonly string[]; readonly variables: { readonly id: string } },
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
    const entities = await query({ entryPoint: data.entry_point, fields: data.fields, variables: data.variables },
      { throwIfKeyNotFound: data.entry_point === "stock_location", throwIfRelationNotFound: undefined });
    const result = entities[0];
    if (data.entry_point === "payment_collection") return new StepResponse(Result.getOrThrow(decodeCollectionView(result)
      .pipe(Result.mapError(() => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native Payment collection projection" })))));
    if (data.entry_point === "customer") return new StepResponse(Result.getOrThrow(decodeCustomerView(result)
      .pipe(Result.mapError(() => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native Payment Customer projection" })))));
    return new StepResponse(result);
  }
  const result = await queryWorkflowGraph({ entity: data.entry_point, fields: data.fields,
    ...(data.variables?.filters === undefined ? {} : { filters: data.variables.filters }),
  }, container.resolve<WorkflowGraphResource>("query"));
  return new StepResponse(result.data);
});

// Dynamic selection exposes partial records, never a caller-chosen module DTO.
export function useRemoteQueryStep(input: SingletonStepInput): StepOutput<Row | undefined>;
export function useRemoteQueryStep(input: typeof PaymentCollectionInput.Type): StepOutput<typeof PaymentCollectionView.Type | undefined>;
export function useRemoteQueryStep(input: typeof PaymentCustomerInput.Type): StepOutput<typeof PaymentCustomerView.Type | undefined>;
export function useRemoteQueryStep(input: ListStepInput): StepOutput<readonly Row[]>;
export function useRemoteQueryStep(input: EntryStepInput): StepOutput<Row | readonly Row[] | undefined>;
export function useRemoteQueryStep(input: EntryStepInput): unknown { return step(input); }
