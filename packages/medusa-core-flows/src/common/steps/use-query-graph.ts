import { Result, Schema } from "effect";
import { createStep, StepResponse, WorkflowDefinitionError, type StepOutput } from "@medusajs/workflows-sdk";

// Fork of the pinned common graph step. The native graph keeps array results
// and mandatory bounded pagination; only this compatibility step shapes a single.
const Input = Schema.Struct({
  entity: Schema.String,
  fields: Schema.Array(Schema.String),
  filters: Schema.optionalKey(Schema.JsonObject),
  pagination: Schema.optionalKey(Schema.Struct({ take: Schema.Number,
    skip: Schema.optionalKey(Schema.Number),
    order: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC"]))),
  })),
  options: Schema.optionalKey(Schema.Struct({ isList: Schema.optionalKey(Schema.Boolean) })),
});
export type QueryGraphInput = typeof Input.Type;
type Row = typeof Schema.JsonObject.Type;
type Metadata = { readonly count: number; readonly skip: number; readonly take: number };
export interface WorkflowGraphResource {
  readonly maxPageSize: number;
  readonly graph: (input: Omit<QueryGraphInput, "options" | "pagination"> & { readonly pagination: NonNullable<QueryGraphInput["pagination"]> }) =>
    Promise<{ readonly data: readonly Row[]; readonly metadata: Metadata }>;
}
const decode = Schema.decodeUnknownResult(Input, { onExcessProperty: "error" });
const refusal = (detail: string) => new WorkflowDefinitionError({ reason: "unsupportedProfile", detail });
const step = createStep("use-query-graph-step", async (input: QueryGraphInput, { container }) => {
  // Deliberate Promise/throw compatibility edge for the Medusa step signature.
  const { options, pagination, ...queryInput } = Result.getOrThrow(decode(input).pipe(
    Result.mapError(() => refusal("Unsupported native graph step options")),
  ));
  const query = container.resolve<WorkflowGraphResource>("query");
  const single = options?.isList === false;
  if (single && (pagination?.skip ?? 0) !== 0) throw refusal("A single graph result cannot skip rows");
  const result = await query.graph({ ...queryInput, pagination: pagination ?? { take: query.maxPageSize } });
  if ((pagination === undefined || single) && (result.metadata.skip !== 0 || result.data.length !== result.metadata.count)) {
    throw refusal("The graph step requires a complete bounded result");
  }
  if (single && result.data.length > 1) throw refusal("The graph step expected zero or one record");
  return new StepResponse({ data: single ? result.data.at(0) : result.data, metadata: { ...result.metadata } });
});

// isList controls the runtime shape. Dynamic field selection deliberately exposes
// partial JSON records, never a caller-chosen full module DTO.
export function useQueryGraphStep(input: QueryGraphInput & { readonly options: { readonly isList: false } }): StepOutput<{ readonly data: Row | undefined; readonly metadata: Metadata }>;
export function useQueryGraphStep(input: QueryGraphInput & { readonly options?: { readonly isList?: true } }): StepOutput<{ readonly data: readonly Row[]; readonly metadata: Metadata }>;
export function useQueryGraphStep(input: QueryGraphInput): StepOutput<{ readonly data: Row | readonly Row[] | undefined; readonly metadata: Metadata }>;
export function useQueryGraphStep(input: QueryGraphInput) { return step(input); }
