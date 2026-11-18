import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ReadTable } from "../query/catalog";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";

const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*$/));
export const GraphPresentation = Schema.Struct({ columns: Schema.Array(Name), companions: Schema.Record(Name, Name) });
export type GraphPresentation = typeof GraphPresentation.Type;
const decodePresentation = commerceDecoder(GraphPresentation, "unsupportedProfile");

/** Module-owned computed output names extend selection, never stored identity,
 * relationship or ordering evidence. Capture within the existing value budget. */
export function captureGraphPresentation(input: unknown, table: ReadTable) {
  return Result.gen(function* () {
    let omitted = false;
    const presentation = yield* captureCommerceInput(input, undefined, () => { omitted = true; }).pipe(Result.flatMap(decodePresentation));
    const columns = new Set(presentation.columns);
    const entries = Object.entries(presentation.companions), targets = entries.map(([, target]) => target);
    if (omitted || columns.size !== presentation.columns.length || presentation.columns.some(column => table.columns.includes(column)) ||
      new Set(targets).size !== targets.length || entries.some(([source, target]) => !columns.has(source) || !columns.has(target) ||
        source === target || Object.hasOwn(presentation.companions, target)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return Object.freeze({ columns: Object.freeze([...presentation.columns]), companions: Object.freeze({ ...presentation.companions }) });
  });
}

export const graphSelectableColumns = (read: { readonly table: ReadTable; readonly presentation?: GraphPresentation }): readonly string[] =>
  read.presentation === undefined ? read.table.columns : [...read.table.columns, ...read.presentation.columns];
