export const currencyColumns = ["code", "symbol", "symbol_native", "name", "decimal_digits",
  "rounding", "raw_rounding", "created_at", "updated_at", "deleted_at"] as const;
export type CurrencyColumn = typeof currencyColumns[number];
import type { Predicate } from "./query/predicate";
export interface CurrencyQuery {
  readonly predicate: Predicate;
  readonly fields: readonly CurrencyColumn[];
  readonly skip: number;
  readonly take: number;
  readonly order: "asc" | "desc";
  readonly withDeleted: boolean;
}
