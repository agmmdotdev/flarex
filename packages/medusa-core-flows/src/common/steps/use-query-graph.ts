import { Result, Schema } from "effect";
import { createStep, StepResponse, WorkflowDefinitionError, type StepOutput } from "@medusajs/workflows-sdk";

// Fork of the pinned common graph step. The native graph keeps array results
// and mandatory bounded pagination; only this compatibility step shapes a single.
export const WorkflowGraphCacheOptions = Schema.Struct({
  cache: Schema.Struct({ enable: Schema.Literal(true) }),
});
export const WorkflowGraphQuery = Schema.Struct({
  entity: Schema.String,
  fields: Schema.Array(Schema.String),
  filters: Schema.optionalKey(Schema.JsonObject),
  pagination: Schema.optionalKey(Schema.Struct({ take: Schema.Number,
    skip: Schema.optionalKey(Schema.Number),
    order: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC"]))),
  })),
});
const Input = Schema.Struct({
  ...WorkflowGraphQuery.fields,
  options: Schema.optionalKey(Schema.Struct({ isList: Schema.optionalKey(Schema.Boolean),
    cache: Schema.optionalKey(WorkflowGraphCacheOptions.fields.cache) })),
});
export type QueryGraphInput = typeof Input.Type;
type Row = typeof Schema.JsonObject.Type;
type Metadata = { readonly count: number; readonly skip: number; readonly take: number };
type GraphResult = { readonly data: readonly Row[]; readonly metadata: Metadata };
export interface WorkflowGraphResource {
  readonly maxPageSize: number;
  readonly graph: (input: Omit<QueryGraphInput, "options" | "pagination"> & { readonly pagination: NonNullable<QueryGraphInput["pagination"]> },
    options?: typeof WorkflowGraphCacheOptions.Type) =>
    Promise<GraphResult>;
}
const decode = Schema.decodeUnknownResult(Input, { onExcessProperty: "error" });
const refusal = (detail: string) => new WorkflowDefinitionError({ reason: "unsupportedProfile", detail });
/** Shared native graph planning keeps omitted-page completeness at the same
 * boundary for both the workflow step and direct Query callers. Cache hints
 * describe the native call; this private execution owner does not cache reads. */
export function prepareWorkflowGraphQuery(input: unknown, maxPageSize: number) {
  return Result.gen(function* () {
    const { options, pagination, ...queryInput } = yield* decode(input).pipe(
      Result.mapError(() => refusal("Unsupported native graph step options")),
    );
    const single = options?.isList === false;
    if (single && (pagination?.skip ?? 0) !== 0) return yield* Result.fail(refusal("A single graph result cannot skip rows"));
    return { query: { ...queryInput, pagination: pagination ?? { take: maxPageSize } }, single,
      cacheOptions: options?.cache === undefined ? undefined : { cache: options.cache },
      validate: (result: GraphResult): Result.Result<undefined, WorkflowDefinitionError> => {
        if ((pagination === undefined || single) && (result.metadata.skip !== 0 || result.data.length !== result.metadata.count)) {
          return Result.fail(refusal("The graph step requires a complete bounded result"));
        }
        return single && result.data.length > 1 ? Result.fail(refusal("The graph step expected zero or one record")) : Result.succeed(undefined);
      },
    };
  });
}
/** The portable Query ABI requires explicit pagination and complete-set proof
 * when a native caller omits it. Reuse this seam in direct native graph calls. */
export function queryWorkflowGraph(input: QueryGraphInput & { readonly options: { readonly isList: false } }, query: WorkflowGraphResource): Promise<{ readonly data: Row | undefined; readonly metadata: Metadata }>;
export function queryWorkflowGraph(input: QueryGraphInput & { readonly options?: { readonly isList?: true } }, query: WorkflowGraphResource): Promise<{ readonly data: readonly Row[]; readonly metadata: Metadata }>;
export function queryWorkflowGraph(input: QueryGraphInput, query: WorkflowGraphResource): Promise<{ readonly data: Row | readonly Row[] | undefined; readonly metadata: Metadata }>;
export async function queryWorkflowGraph(input: QueryGraphInput, query: WorkflowGraphResource) {
  // Deliberate Promise/throw compatibility edge for the Medusa step signature.
  const plan = Result.getOrThrow(prepareWorkflowGraphQuery(input, query.maxPageSize));
  const result = await (plan.cacheOptions === undefined ? query.graph(plan.query) : query.graph(plan.query, plan.cacheOptions));
  Result.getOrThrow(plan.validate(result));
  return { data: plan.single ? result.data.at(0) : result.data, metadata: { ...result.metadata } };
}
const step = createStep("use-query-graph-step", async (input: QueryGraphInput, { container }) => {
  return new StepResponse(await queryWorkflowGraph(input, container.resolve<WorkflowGraphResource>("query")));
});

// isList controls the runtime shape. Dynamic field selection deliberately exposes
// partial JSON records, never a caller-chosen full module DTO.
export function useQueryGraphStep(input: QueryGraphInput & { readonly options: { readonly isList: false } }): StepOutput<{ readonly data: Row | undefined; readonly metadata: Metadata }>;
export function useQueryGraphStep(input: QueryGraphInput & { readonly options?: { readonly isList?: true } }): StepOutput<{ readonly data: readonly Row[]; readonly metadata: Metadata }>;
export function useQueryGraphStep(input: QueryGraphInput): StepOutput<{ readonly data: Row | readonly Row[] | undefined; readonly metadata: Metadata }>;
export function useQueryGraphStep(input: QueryGraphInput) { return step(input); }
