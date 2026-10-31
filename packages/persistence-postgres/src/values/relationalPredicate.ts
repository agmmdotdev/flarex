import type { Json } from "flarex-protocol/json";

/** The relational query owner's validated tree. PostgreSQL-dependent leaves
 * require their execution owner's whole-tree evaluation, never a JS estimate. */
export type NormalizedRelationalPredicate =
  | Readonly<{ kind: "and" | "or"; children: readonly NormalizedRelationalPredicate[] }>
  | Readonly<{ kind: "in"; column: string; values: readonly (string | boolean | null)[] }>
  | Readonly<{ kind: "numericIn"; column: string; values: readonly string[] }>
  | Readonly<{ kind: "numberIn"; column: string; values: readonly number[] }>
  | Readonly<{ kind: "postgresNumericCast"; column: string; operator: "gt" | "gte" | "lt" | "lte"; value: number }>
  | Readonly<{ kind: "indexedPoints"; columns: readonly string[]; values: readonly (readonly (string | boolean)[])[] }>
  | Readonly<{ kind: "isNull"; column: string }>
  | Readonly<{ kind: "textNotEqual" | "greaterThan" | "lessThan"; column: string; value: string }>
  | Readonly<{ kind: "textLikeAscii"; column: string; pattern: string }>
  | Readonly<{ kind: "jsonContains"; column: string; value: Json }>
  | Readonly<{ kind: "postgresText"; column: string; operator: "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "regex" | "fulltext"; value: string }>
  | Readonly<{ kind: "postgresText"; column: string; operator: "notIn"; values: readonly string[] }>
  | Readonly<{ kind: "postgresText"; column: string; operator: "exists"; value: boolean }>;
