import { Result, Schema } from "effect";
import { WorkflowDefinitionError } from "@medusajs/workflows-sdk";
import type { QueryGraphInput, WorkflowGraphResource } from "./use-query-graph";

/** The actual direct Query ABI admits omitted pagination and proves complete
 * bounded results in the shared query owner. */
export interface CheckoutPaymentQueryResource {
  graph(input: QueryGraphInput): ReturnType<WorkflowGraphResource["graph"]>;
}

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Context = Schema.Struct({ customer: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Id }))) });
/** Only the retained native marker's selected view. The module validates
 * complete stored DML rows before graph projection; this checks its exact use. */
const Session = Schema.Struct({ id: Id, payment_collection_id: Id, amount: Schema.Finite,
  raw_amount: Schema.Struct({ value: Schema.String, precision: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })) }),
  provider_id: Id, data: Schema.JsonObject, context: Schema.NullOr(Context),
  payment: Schema.NullOr(Schema.Struct({ id: Id, captured_at: Schema.NullOr(Schema.String) })) });
const decode = Schema.decodeUnknownResult(Schema.Array(Session).check(Schema.isMaxLength(4)));
export const decodeCheckoutPaymentSessions = (input: unknown) => decode(input).pipe(Result.mapError(() =>
  new WorkflowDefinitionError({ reason: "unsupportedProfile", detail: "Invalid native checkout Payment compensation selection" })));
