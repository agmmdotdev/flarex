import { Result } from "effect";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

export type Predicate =
  | { readonly kind: "in"; readonly column: string; readonly values: readonly Json[] }
  | { readonly kind: "isNull"; readonly column: string }
  | { readonly kind: "and" | "or"; readonly children: readonly Predicate[] }
  | { readonly kind: "greaterThan"; readonly column: string; readonly value: string }
  | { readonly kind: "textLikeAscii"; readonly column: string; readonly pattern: string };
export type Decoder<A> = (input: unknown) => Result.Result<A, CommerceTransactionError>;
export type FilterValue = Json | readonly Json[];
export interface ScalarFilter {
  readonly column: string;
  readonly decode: Decoder<FilterValue>;
}
export interface WherePolicy {
  readonly decode: Decoder<Readonly<Record<string, unknown>>>;
  readonly fields: ReadonlyMap<string, ScalarFilter>;
  readonly selectors?: { readonly decode: Decoder<readonly JsonObject[]>; readonly mode: "tuples" | "membership"; readonly key: string };
  readonly logical?: {
    readonly decodeBranches: Decoder<readonly unknown[]>;
    readonly nodes: number;
    readonly depth: number;
    readonly operands: number;
    readonly unwrapMembership: (input: unknown) => unknown;
  };
}

export const valuePredicate = (column: string, value: FilterValue): Predicate => value === null
  ? Object.freeze({ kind: "isNull", column })
  : Object.freeze({ kind: "in", column, values: Object.freeze(Array.isArray(value) ? [...value] : [value]) });

/** Shared traversal; module schemas retain the accepted grammar and errors.
 * Budget checks precede member decoding, including at nested logical nodes. */
export function compileWhere(input: unknown, policy: WherePolicy): Result.Result<Predicate, CommerceTransactionError> {
  let nodes = 0;
  let operands = 0;
  const visit = (inputWhere: unknown, depth: number): Result.Result<Predicate, CommerceTransactionError> => Result.gen(function* () {
    const logical = policy.logical;
    if (logical !== undefined && (++nodes > logical.nodes || depth > logical.depth)) return yield* Result.fail(commerceError("limitExceeded"));
    const where = yield* policy.decode(inputWhere);
    const children: Predicate[] = [];
    for (const [name, member] of Object.entries(where)) {
      const field = policy.fields.get(name);
      if (field !== undefined) {
        const inputValue = logical === undefined ? member : logical.unwrapMembership(member);
        if (logical !== undefined) {
          operands += Array.isArray(inputValue) ? inputValue.length : 1;
          if (operands > logical.operands) return yield* Result.fail(commerceError("limitExceeded"));
        }
        children.push(valuePredicate(field.column, yield* field.decode(inputValue)));
      } else if (name === "$or" && policy.selectors !== undefined) {
        const selected = yield* policy.selectors.decode(member);
        if (policy.selectors.mode === "tuples") children.push(selectorPredicate(selected));
        else {
          const values: Json[] = [];
          for (const row of selected) {
            const value = row[policy.selectors.key];
            if (value === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
            values.push(value);
          }
          children.push(valuePredicate(policy.selectors.key, [...new Set(values)]));
        }
      } else if (logical !== undefined && (name === "$and" || name === "$or")) {
        const nested: Predicate[] = [];
        for (const child of yield* logical.decodeBranches(member)) nested.push(yield* visit(child, depth + 1));
        children.push(Object.freeze({ kind: name === "$and" ? "and" : "or", children: Object.freeze(nested) }));
      } else return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    return Object.freeze({ kind: "and", children: Object.freeze(children) });
  });
  return visit(input, 0);
}

/** Selector decoding stays with the entry contract; AND keeps each tuple intact. */
export function selectorPredicate(selectors: readonly JsonObject[]): Predicate {
  return Object.freeze({ kind: "or", children: Object.freeze(selectors.map(selector => Object.freeze({ kind: "and", children:
    Object.freeze(Object.entries(selector).map(([column, value]) => valuePredicate(column, value))),
  }))) });
}
