import { Schema } from "effect";
import { RequestWorkerResult } from "./contract.ts";

export const WorkflowWorkerResult = Schema.Struct({ ...RequestWorkerResult.fields,
  scenario: Schema.Literal("product-workflow"), productsPerRequest: Schema.Literals([1, 4]),
  publicationVerified: Schema.Boolean,
  workload: Schema.NullOr(Schema.Struct({ flow: Schema.String, cardinality: Schema.Record(Schema.String, Schema.Int),
    limitations: Schema.optionalKey(Schema.Array(Schema.String)) })),
  timings: Schema.NullOr(Schema.Struct({ provisionAndPrepareMs: Schema.Finite, initialSeedMs: Schema.Finite,
    runtimeConstructionMs: Schema.NullOr(Schema.Finite) })),
});
