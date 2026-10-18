import { Effect, Result, Schema } from "effect";
import { coerceFilterValue } from "@medusajs/drizzle/filter-value";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import type { PreparedLocalGraph } from "../local-graph/model";
import type { CommercePromiseOwner } from "../module/promise-owner";
import { commerceDecoder } from "../value/decoder";
import { checkedCommerceValue } from "../value/checked";
import { captureWorkflowInput } from "./value";

const Name = Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/));
const Fields = Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isLengthBetween(1, 256));
const decodeRemote = commerceDecoder(Schema.Union([
  Schema.Struct({ entryPoint: Name, fields: Fields,
    variables: Schema.Struct({ id: Schema.Array(Schema.UndefinedOr(Schema.String)).check(Schema.isMaxLength(commerceLimits.catalogRows)) }) }),
  Schema.Struct({ service: Name, fields: Fields, variables: Schema.Struct({ filters: Schema.JsonObject }) }),
]), "unsupportedProfile");

/** Two selected native callable ABIs over the same authenticated graph. This
 * facade owns no reads, synthetic rows, aliases, transactions or finalization. */
export function bindWorkflowQuery(graph: PreparedLocalGraph, context: AtomicCommerceContext, owner: CommercePromiseOwner) {
  const query = graph.bind(context);
  const remote = (...args: unknown[]) => owner.run(Effect.gen(function* () {
    if (args.length !== 1) return yield* context.refuse(commerceError("unsupportedProfile"));
    const input = yield* checkedCommerceValue(context, () => captureWorkflowInput(args[0]).pipe(Result.flatMap(decodeRemote)));
    const result = yield* "entryPoint" in input
      ? query.native({ entity: input.entryPoint, fields: input.fields,
        filters: { id: input.variables.id.map(value => coerceFilterValue("id", value)) }, pagination: { take: commerceLimits.catalogRows } })
      : query.service({ service: input.service, fields: input.fields, filters: input.variables.filters, pagination: { take: commerceLimits.catalogRows } });
    if (result.metadata.count > commerceLimits.catalogRows) return yield* context.refuse(commerceError("unsupportedProfile"));
    if (result.data.length !== result.metadata.count) return yield* context.refuse(commerceError("storedCorruption"));
    return result.data;
  }));
  return Object.freeze(Object.assign(remote, { maxPageSize: commerceLimits.catalogRows,
    graph: (...args: unknown[]) => owner.run(args.length === 1 ? query.graph(args[0]) : context.refuse(commerceError("unsupportedProfile"))),
  }));
}
