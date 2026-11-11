import { Result, Schema } from "effect";
import { toPopulateTree, type PopulateTree } from "@medusajs/drizzle/relation-query";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProjectionNode } from "../query/projection";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";

const Path = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$/));
export const GraphComputedObject = Schema.Struct({ fields: Schema.Array(Path).check(Schema.isLengthBetween(1, 64),
  Schema.makeFilter(fields => new Set(fields).size === fields.length)) });
export const GraphComputedObjects = Schema.Record(Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*$/)), GraphComputedObject)
  .check(Schema.makeFilter(value => Object.keys(value).length <= 4));
export interface GraphComputedObject { readonly fields: readonly string[] }
const decodeObjects = commerceDecoder(GraphComputedObjects, "unsupportedProfile");
/** Module-owned output grammar. It supplies projection only, never storage or identity. */
export function captureGraphComputedObjects(input: unknown) {
  return Result.gen(function* () {
    let omitted = false;
    const objects = yield* captureCommerceInput(input, undefined, () => { omitted = true; }).pipe(Result.flatMap(decodeObjects));
    if (omitted) return yield* Result.fail(commerceError("unsupportedProfile"));
    return Object.freeze(Object.fromEntries(Object.entries(objects).map(([name, object]) =>
      [name, Object.freeze({ fields: Object.freeze([...object.fields]) })])));
  });
}

export function computedObjectProjection(selection: PopulateTree, object: GraphComputedObject): Result.Result<ProjectionNode, CommerceTransactionError> {
  const allowed = toPopulateTree(object.fields);
  const visit = (selected: PopulateTree, permitted: PopulateTree): Result.Result<ProjectionNode, CommerceTransactionError> => Result.gen(function* () {
    const fields = new Set<string>();
    const children: Array<ProjectionNode["children"][number]> = [];
    const entries = selected.has("*") ? new Map([...permitted, ...[...selected].filter(([name]) => name !== "*")]) : selected;
    for (const [name, child] of entries) {
      const accepted = permitted.get(name);
      if (accepted === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (accepted.size === 0) {
        if (child.size !== 0) return yield* Result.fail(commerceError("unsupportedProfile"));
        fields.add(name);
      } else children.push({ name, many: false, node: yield* visit(child.size === 0 ? accepted : child, accepted) });
    }
    return { fields, children, nullRelations: [], requireFields: true };
  });
  return visit(selection.size === 0 ? allowed : selection, allowed);
}
