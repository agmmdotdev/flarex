import { Result, Schema } from "effect";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";

export type Predicate =
  | { readonly kind: "in"; readonly column: string; readonly values: readonly Json[] }
  | { readonly kind: "numericIn"; readonly column: string; readonly values: readonly (string | number)[] }
  | { readonly kind: "isNull"; readonly column: string }
  | { readonly kind: "and" | "or"; readonly children: readonly Predicate[] }
  | { readonly kind: "greaterThan"; readonly column: string; readonly value: string }
  | { readonly kind: "textNotEqual"; readonly column: string; readonly value: string }
  | { readonly kind: "postgresText"; readonly column: string; readonly operator: "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "regex" | "fulltext"; readonly value: string }
  | { readonly kind: "postgresText"; readonly column: string; readonly operator: "notIn"; readonly values: readonly string[] }
  | { readonly kind: "postgresText"; readonly column: string; readonly operator: "exists"; readonly value: boolean }
  | { readonly kind: "textLikeAscii"; readonly column: string; readonly pattern: string };
export type Decoder<A> = (input: unknown) => Result.Result<A, CommerceTransactionError>;
export type FilterValue = Json | readonly Json[];
export type ScalarFilter = {
  readonly column: string;
} & ({
  /** Named module grammar may produce a complete shared predicate node. */
  readonly decodePredicate: Decoder<Predicate>;
  readonly decode?: never;
  readonly decodeNotEqual?: never;
} | {
  readonly decode: Decoder<FilterValue>;
  /** Explicit text-field capability; equality/membership decoding is unchanged. */
  readonly decodeNotEqual?: Decoder<string>;
  readonly decodePredicate?: never;
});
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
    readonly emptyLogical?: "ignore";
  };
}

export const valuePredicate = (column: string, value: FilterValue): Predicate => value === null
  ? Object.freeze({ kind: "isNull", column })
  : Object.freeze({ kind: "in", column, values: Object.freeze(Array.isArray(value) ? [...value] : [value]) });

const decodeNotEqualEnvelope = commerceDecoder(Schema.Struct({ $ne: Schema.Unknown }), "unsupportedProfile");

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
        if (field.decodePredicate !== undefined) {
          const predicate = yield* field.decodePredicate(member);
          // Native query builders emit no SQL for empty comparison objects.
          // Preserve real SQL leaves, including empty IN / NOT IN operands.
          if (logical?.emptyLogical !== "ignore" || predicate.kind !== "and" || predicate.children.length > 0)
            children.push(predicate);
        } else if (field.decodeNotEqual !== undefined && member !== null && typeof member === "object" && "$ne" in member) {
          const comparison = yield* decodeNotEqualEnvelope(member);
          children.push(Object.freeze({ kind: "textNotEqual", column: field.column, value: yield* field.decodeNotEqual(comparison.$ne) }));
        } else children.push(valuePredicate(field.column, yield* field.decode(inputValue)));
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
        for (const child of yield* logical.decodeBranches(member)) {
          const predicate = yield* visit(child, depth + 1);
          // Visit before omission so structural emptiness cannot bypass source
          // decoding, depth, node or operand guards. Omission propagates upward.
          if (logical.emptyLogical !== "ignore" || predicate.kind !== "and" || predicate.children.length > 0)
            nested.push(predicate);
        }
        if (nested.length === 0 && logical.emptyLogical === "ignore") continue;
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
